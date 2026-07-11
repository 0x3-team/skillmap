begin;

create schema if not exists api;
create schema if not exists private;

comment on schema api is 'The only SkillMap schema exposed through PostgREST.';
comment on schema private is 'Canonical hosted catalog and audit truth; never exposed through PostgREST.';

revoke all on schema api from public, anon, authenticated, service_role;
revoke all on schema private from public, anon, authenticated, service_role;

create function private.valid_text_array(
  value text[],
  maximum_items integer,
  maximum_item_length integer,
  item_pattern text default null
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(value) <= maximum_items
    and cardinality(value) = (select count(distinct item) from unnest(value) as item)
    and coalesce((
      select bool_and(
        length(item) between 1 and maximum_item_length
        and (item_pattern is null or item ~ item_pattern)
      )
      from unnest(value) as item
    ), true);
$$;

create function private.valid_relative_paths(value text[], maximum_items integer)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select cardinality(value) <= maximum_items
    and cardinality(value) = (select count(distinct item) from unnest(value) as item)
    and coalesce((
      select bool_and(
        length(item) between 1 and 500
        and left(item, 1) <> '/'
        and item !~ '(^|/)\.\.(/|$)'
        and position(E'\\' in item) = 0
      )
      from unnest(value) as item
    ), true);
$$;

create table private.publishers (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique check (public_id ~ '^pub_[0-9a-f]{32}$'),
  handle text not null unique check (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(handle) between 2 and 40),
  display_name text not null check (length(display_name) between 1 and 100),
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'identity-verified', 'disputed')),
  catalog_state text not null default 'draft'
    check (catalog_state in ('draft', 'published', 'blocked')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (updated_at >= created_at),
  check (verification_state = 'unverified')
);

create table private.publisher_members (
  publisher_id uuid not null references private.publishers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'maintainer', 'reviewer')),
  created_at timestamptz not null default now(),
  primary key (publisher_id, user_id)
);

create table private.source_repositories (
  id uuid primary key default gen_random_uuid(),
  publisher_id uuid not null references private.publishers(id) on delete restrict,
  repository_url text not null unique
    check (repository_url ~ '^https://[^[:space:]]+$' and length(repository_url) <= 2048),
  catalog_state text not null default 'draft'
    check (catalog_state in ('draft', 'published', 'blocked')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (updated_at >= created_at),
  unique (id, publisher_id)
);

create table private.skills (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique check (public_id ~ '^skl_[0-9a-f]{32}$'),
  publisher_id uuid not null references private.publishers(id) on delete restrict,
  source_repository_id uuid not null references private.source_repositories(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 100),
  display_name text not null check (length(display_name) between 1 and 140),
  summary text not null check (length(summary) between 1 and 500),
  description text not null check (length(description) between 1 and 20000),
  capabilities text[] not null default '{}'::text[]
    check (private.valid_text_array(capabilities, 50, 100, '^[a-z0-9]+([.:/-][a-z0-9]+)*$')),
  visibility_state text not null default 'private'
    check (visibility_state in ('private', 'public')),
  lifecycle_state text not null default 'draft'
    check (lifecycle_state in ('draft', 'published', 'deprecated', 'retired')),
  current_version_id uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    to_tsvector(
      'simple'::regconfig,
      coalesce(display_name, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(description, '')
    )
  ) stored,
  unique (publisher_id, slug),
  foreign key (source_repository_id, publisher_id)
    references private.source_repositories(id, publisher_id) on delete restrict,
  check (updated_at >= created_at)
);

create table private.skill_versions (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique check (public_id ~ '^skv_[0-9a-f]{32}$'),
  skill_id uuid not null references private.skills(id) on delete restrict,
  version_label text not null check (length(version_label) between 1 and 100),
  source_commit text not null check (source_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  source_path text not null check (
    length(source_path) between 1 and 500
    and left(source_path, 1) <> '/'
    and source_path !~ '(^|/)\.\.(/|$)'
    and position(E'\\' in source_path) = 0
  ),
  entrypoint_content_digest text not null check (entrypoint_content_digest ~ '^sha256:[0-9a-f]{64}$'),
  raw_snapshot_digest text check (raw_snapshot_digest is null or raw_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact_availability text not null default 'metadata-only'
    check (artifact_availability in ('metadata-only', 'mirrored')),
  normalized_artifact_digest text
    check (normalized_artifact_digest is null or normalized_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  manifest_digest text check (manifest_digest is null or manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  license_state text not null check (license_state in ('confirmed', 'noassertion', 'restricted')),
  spdx_expression text check (spdx_expression is null or length(spdx_expression) between 2 and 200),
  redistribution_state text not null check (redistribution_state in ('mirrored', 'metadata-only', 'blocked')),
  license_files text[] not null default '{}'::text[]
    check (private.valid_relative_paths(license_files, 20)),
  compatibility_state text not null default 'not-tested'
    check (compatibility_state in ('not-tested', 'declared', 'compatible', 'stale', 'incompatible')),
  compatibility_profile_version text check (compatibility_profile_version is null or length(compatibility_profile_version) <= 64),
  compatibility_evidence_digest text
    check (compatibility_evidence_digest is null or compatibility_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  permission_scripts boolean not null default false,
  permission_network text[] not null default '{}'::text[]
    check (private.valid_text_array(permission_network, 50, 200)),
  permission_tools text[] not null default '{}'::text[]
    check (private.valid_text_array(permission_tools, 50, 200)),
  evidence_provenance_state text not null default 'unverified'
    check (evidence_provenance_state in ('unverified', 'source-pinned', 'attested', 'stale', 'blocked')),
  evidence_audit_state text not null default 'not-run'
    check (evidence_audit_state in ('not-run', 'passed', 'warnings', 'stale', 'blocked')),
  evidence_compatibility_state text not null default 'not-tested'
    check (evidence_compatibility_state in ('not-tested', 'declared', 'compatible', 'stale', 'incompatible')),
  grade_state text not null default 'ungraded'
    check (grade_state in ('ungraded', 'provisional', 'current', 'stale', 'blocked', 'revoked')),
  grade_band text check (grade_band is null or grade_band in ('A', 'B', 'C', 'D', 'F')),
  grade_confidence double precision check (grade_confidence is null or grade_confidence between 0 and 1),
  grade_receipt_id text check (grade_receipt_id is null or grade_receipt_id ~ '^grd_[0-9a-f]{32}$'),
  grade_receipt_digest text check (grade_receipt_digest is null or grade_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  graded_at timestamptz,
  grade_rubric_version text check (grade_rubric_version is null or length(grade_rubric_version) <= 64),
  grade_host_profile_version text check (grade_host_profile_version is null or length(grade_host_profile_version) <= 64),
  grade_invalidated_at timestamptz,
  grade_reason_codes text[] not null default '{}'::text[]
    check (private.valid_text_array(grade_reason_codes, 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$')),
  publication_state text not null default 'draft'
    check (publication_state in ('draft', 'published', 'blocked')),
  published_at timestamptz,
  quarantined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (skill_id, id),
  unique (skill_id, version_label),
  check (
    (artifact_availability = 'metadata-only')
    or (artifact_availability = 'mirrored' and normalized_artifact_digest is not null and manifest_digest is not null)
  ),
  check (
    redistribution_state <> 'mirrored'
    or (
      license_state = 'confirmed'
      and artifact_availability = 'mirrored'
      and normalized_artifact_digest is not null
      and manifest_digest is not null
    )
  ),
  check ((license_state = 'confirmed' and spdx_expression is not null) or license_state <> 'confirmed'),
  check (
    (compatibility_state = 'not-tested' and compatibility_profile_version is null and compatibility_evidence_digest is null)
    or compatibility_state = 'declared'
    or (compatibility_state in ('compatible', 'stale', 'incompatible') and compatibility_profile_version is not null and compatibility_evidence_digest is not null)
  ),
  check (evidence_compatibility_state = compatibility_state),
  check (evidence_provenance_state = 'unverified'),
  check (evidence_audit_state = 'not-run'),
  check (compatibility_state = 'not-tested'),
  constraint skill_versions_phase1_grade_authority check (grade_state = 'ungraded'),
  check (
    (grade_state = 'ungraded'
      and grade_band is null and grade_confidence is null and grade_receipt_id is null
      and grade_receipt_digest is null and graded_at is null and grade_rubric_version is null
      and grade_host_profile_version is null and grade_invalidated_at is null)
    or (grade_state = 'provisional'
      and grade_band is null and grade_confidence is not null and grade_receipt_id is not null
      and grade_receipt_digest is not null and graded_at is not null and grade_rubric_version is not null
      and grade_host_profile_version is not null and grade_invalidated_at is null
      and cardinality(grade_reason_codes) > 0)
    or (grade_state = 'current'
      and grade_band is not null and grade_confidence is not null and grade_receipt_id is not null
      and grade_receipt_digest is not null and graded_at is not null and grade_rubric_version is not null
      and grade_host_profile_version is not null and grade_invalidated_at is null
      and cardinality(grade_reason_codes) = 0)
    or (grade_state = 'stale'
      and grade_band is not null and grade_confidence is not null and grade_receipt_id is not null
      and grade_receipt_digest is not null and graded_at is not null and grade_rubric_version is not null
      and grade_host_profile_version is not null and grade_invalidated_at is not null
      and grade_invalidated_at >= graded_at and cardinality(grade_reason_codes) > 0)
    or (grade_state = 'blocked'
      and grade_band is null and grade_confidence is null and grade_receipt_id is not null
      and grade_receipt_digest is not null and graded_at is not null and grade_rubric_version is not null
      and grade_host_profile_version is not null and grade_invalidated_at is null
      and cardinality(grade_reason_codes) > 0)
    or (grade_state = 'revoked'
      and grade_band is null and grade_confidence is null and grade_receipt_id is not null
      and grade_receipt_digest is not null and graded_at is not null and grade_rubric_version is not null
      and grade_host_profile_version is not null and grade_invalidated_at is not null
      and grade_invalidated_at >= graded_at and cardinality(grade_reason_codes) > 0)
  ),
  check ((publication_state = 'published' and published_at is not null) or publication_state <> 'published')
);

alter table private.skills
  add constraint skills_current_version_belongs_to_skill
  foreign key (id, current_version_id)
  references private.skill_versions(skill_id, id)
  deferrable initially deferred;

create table private.skill_relationships (
  id uuid primary key default gen_random_uuid(),
  source_version_id uuid not null references private.skill_versions(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('alternative', 'complement', 'prerequisite', 'conflict', 'duplicate', 'supersedes')),
  target_skill_id uuid not null references private.skills(id) on delete restrict,
  evidence_state text not null default 'declared'
    check (evidence_state in ('declared', 'reviewed', 'evaluated')),
  reason text not null check (length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (source_version_id, relationship_type, target_skill_id),
  check (evidence_state = 'declared')
);

create table private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),
  subject_type text not null check (subject_type in ('publisher', 'repository', 'skill', 'skill-version', 'account')),
  subject_id text not null check (length(subject_id) between 1 and 128),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create table api.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table api.saved_skills (
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id text not null references private.skills(public_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);

create index publisher_members_user_id_idx on private.publisher_members(user_id);
create index source_repositories_publisher_id_idx on private.source_repositories(publisher_id);
create index source_repositories_public_idx on private.source_repositories(catalog_state, revoked_at);
create index skills_publisher_id_idx on private.skills(publisher_id);
create index skills_source_repository_id_idx on private.skills(source_repository_id);
create index skills_current_version_id_idx on private.skills(current_version_id);
create index skills_public_visibility_idx on private.skills(visibility_state, lifecycle_state, revoked_at);
create index skills_search_document_idx on private.skills using gin(search_document);
create index skill_versions_skill_id_idx on private.skill_versions(skill_id);
create index skill_versions_publication_idx on private.skill_versions(publication_state, revoked_at, quarantined_at, published_at desc, public_id);
create index skill_relationships_source_version_id_idx on private.skill_relationships(source_version_id);
create index skill_relationships_target_skill_id_idx on private.skill_relationships(target_skill_id);
create index audit_events_actor_user_id_idx on private.audit_events(actor_user_id);
create index audit_events_subject_idx on private.audit_events(subject_type, subject_id, created_at desc);
create index saved_skills_skill_id_idx on api.saved_skills(skill_id);

create function private.enforce_immutable_skill_version_coordinates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    old.id,
    old.public_id,
    old.skill_id,
    old.version_label,
    old.source_commit,
    old.source_path,
    old.entrypoint_content_digest,
    old.raw_snapshot_digest,
    old.artifact_availability,
    old.normalized_artifact_digest,
    old.manifest_digest
  ) is distinct from row(
    new.id,
    new.public_id,
    new.skill_id,
    new.version_label,
    new.source_commit,
    new.source_path,
    new.entrypoint_content_digest,
    new.raw_snapshot_digest,
    new.artifact_availability,
    new.normalized_artifact_digest,
    new.manifest_digest
  ) then
    raise exception 'immutable skill-version coordinates cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.enforce_immutable_publisher_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.public_id, old.handle) is distinct from row(new.id, new.public_id, new.handle) then
    raise exception 'publisher identity cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.enforce_immutable_repository_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.publisher_id, old.repository_url) is distinct from row(new.id, new.publisher_id, new.repository_url) then
    raise exception 'repository identity cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.enforce_immutable_skill_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.public_id, old.publisher_id, old.source_repository_id, old.slug)
    is distinct from row(new.id, new.public_id, new.publisher_id, new.source_repository_id, new.slug) then
    raise exception 'skill identity and source ownership cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_immutable_skill_version_coordinates() from public, anon, authenticated, service_role;

create trigger skill_versions_immutable_coordinates
before update on private.skill_versions
for each row execute function private.enforce_immutable_skill_version_coordinates();

create trigger publishers_immutable_identity
before update on private.publishers
for each row execute function private.enforce_immutable_publisher_identity();

create trigger source_repositories_immutable_identity
before update on private.source_repositories
for each row execute function private.enforce_immutable_repository_identity();

create trigger skills_immutable_identity
before update on private.skills
for each row execute function private.enforce_immutable_skill_identity();

alter table private.publishers enable row level security;
alter table private.publishers force row level security;
alter table private.publisher_members enable row level security;
alter table private.publisher_members force row level security;
alter table private.source_repositories enable row level security;
alter table private.source_repositories force row level security;
alter table private.skills enable row level security;
alter table private.skills force row level security;
alter table private.skill_versions enable row level security;
alter table private.skill_versions force row level security;
alter table private.skill_relationships enable row level security;
alter table private.skill_relationships force row level security;
alter table private.audit_events enable row level security;
alter table private.audit_events force row level security;
alter table api.profiles enable row level security;
alter table api.profiles force row level security;
alter table api.saved_skills enable row level security;
alter table api.saved_skills force row level security;

create policy publishers_public_select on private.publishers
for select to anon, authenticated
using (catalog_state = 'published' and revoked_at is null);

create policy source_repositories_public_select on private.source_repositories
for select to anon, authenticated
using (
  catalog_state = 'published'
  and revoked_at is null
  and exists (
    select 1 from private.publishers publisher
    where publisher.id = source_repositories.publisher_id
  )
);

create policy skills_public_select on private.skills
for select to anon, authenticated
using (
  visibility_state = 'public'
  and lifecycle_state in ('published', 'deprecated')
  and revoked_at is null
  and exists (
    select 1 from private.publishers publisher
    where publisher.id = skills.publisher_id
  )
  and exists (
    select 1 from private.source_repositories repository
    where repository.id = skills.source_repository_id
      and repository.publisher_id = skills.publisher_id
  )
);

create policy skill_versions_public_select on private.skill_versions
for select to anon, authenticated
using (
  publication_state = 'published'
  and redistribution_state in ('mirrored', 'metadata-only')
  and license_state <> 'restricted'
  and revoked_at is null
  and quarantined_at is null
  and exists (
    select 1 from private.skills skill
    where skill.id = skill_versions.skill_id
  )
);

create policy skill_relationships_public_select on private.skill_relationships
for select to anon, authenticated
using (
  exists (select 1 from private.skill_versions v where v.id = source_version_id)
  and exists (select 1 from private.skills s where s.id = target_skill_id)
);

create view api.catalog_skill_versions
with (security_invoker = true, security_barrier = true)
as
select
  s.public_id as skill_id,
  p.public_id as publisher_id,
  p.handle as publisher_handle,
  p.display_name as publisher_display_name,
  p.verification_state as publisher_verification_state,
  s.slug,
  s.display_name,
  s.summary,
  s.description,
  s.lifecycle_state,
  s.capabilities,
  s.updated_at,
  v.public_id as version_id,
  v.version_label as version,
  v.published_at,
  r.repository_url,
  v.source_commit,
  v.source_path,
  v.entrypoint_content_digest,
  v.raw_snapshot_digest,
  v.artifact_availability,
  v.normalized_artifact_digest,
  v.manifest_digest,
  v.license_state,
  v.spdx_expression,
  v.redistribution_state,
  v.license_files,
  v.compatibility_state,
  v.compatibility_profile_version,
  v.compatibility_evidence_digest,
  v.permission_scripts,
  v.permission_network,
  v.permission_tools,
  v.evidence_provenance_state,
  v.evidence_audit_state,
  v.evidence_compatibility_state,
  v.grade_state,
  v.grade_band,
  v.grade_confidence,
  v.grade_receipt_id,
  v.grade_receipt_digest,
  v.graded_at,
  v.grade_rubric_version,
  v.grade_host_profile_version,
  v.grade_invalidated_at,
  v.grade_reason_codes,
  s.search_document
from private.skills s
join private.publishers p on p.id = s.publisher_id
join private.source_repositories r on r.id = s.source_repository_id
join private.skill_versions v on v.skill_id = s.id and v.id = s.current_version_id
where p.catalog_state = 'published'
  and p.revoked_at is null
  and r.catalog_state = 'published'
  and r.revoked_at is null
  and s.visibility_state = 'public'
  and s.lifecycle_state in ('published', 'deprecated')
  and s.revoked_at is null
  and v.publication_state = 'published'
  and v.redistribution_state in ('mirrored', 'metadata-only')
  and v.license_state <> 'restricted'
  and v.revoked_at is null
  and v.quarantined_at is null;

create view api.catalog_skills
with (security_invoker = true, security_barrier = true)
as
select
  skill_id,
  publisher_id,
  publisher_handle,
  publisher_display_name,
  publisher_verification_state,
  slug,
  display_name,
  summary,
  lifecycle_state,
  capabilities,
  updated_at,
  version_id,
  version,
  entrypoint_content_digest,
  license_state,
  redistribution_state,
  compatibility_state,
  grade_state,
  grade_band,
  grade_confidence,
  grade_receipt_id,
  grade_receipt_digest,
  graded_at,
  grade_rubric_version,
  grade_host_profile_version,
  grade_invalidated_at,
  grade_reason_codes,
  published_at,
  search_document
from api.catalog_skill_versions;

create view api.catalog_skill_relationships
with (security_invoker = true, security_barrier = true)
as
select
  source_skill.public_id as source_skill_id,
  source_version.public_id as source_version_id,
  relationship.relationship_type,
  target_skill.public_id as target_skill_id,
  relationship.evidence_state,
  relationship.reason
from private.skill_relationships relationship
join private.skill_versions source_version on source_version.id = relationship.source_version_id
join private.skills source_skill on source_skill.id = source_version.skill_id
join private.publishers source_publisher on source_publisher.id = source_skill.publisher_id
join private.source_repositories source_repository on source_repository.id = source_skill.source_repository_id
join private.skills target_skill on target_skill.id = relationship.target_skill_id
join private.publishers target_publisher on target_publisher.id = target_skill.publisher_id
join private.source_repositories target_repository on target_repository.id = target_skill.source_repository_id
join private.skill_versions target_version on target_version.skill_id = target_skill.id and target_version.id = target_skill.current_version_id
where source_publisher.catalog_state = 'published' and source_publisher.revoked_at is null
  and source_repository.catalog_state = 'published' and source_repository.revoked_at is null
  and source_skill.visibility_state = 'public'
  and source_skill.lifecycle_state in ('published', 'deprecated')
  and source_skill.revoked_at is null
  and source_version.id = source_skill.current_version_id
  and source_version.publication_state = 'published'
  and source_version.redistribution_state in ('mirrored', 'metadata-only')
  and source_version.license_state <> 'restricted'
  and source_version.revoked_at is null and source_version.quarantined_at is null
  and target_publisher.catalog_state = 'published' and target_publisher.revoked_at is null
  and target_repository.catalog_state = 'published' and target_repository.revoked_at is null
  and target_skill.visibility_state = 'public'
  and target_skill.lifecycle_state in ('published', 'deprecated')
  and target_skill.revoked_at is null
  and target_version.publication_state = 'published'
  and target_version.redistribution_state in ('mirrored', 'metadata-only')
  and target_version.license_state <> 'restricted'
  and target_version.revoked_at is null and target_version.quarantined_at is null;

create view api.saved_skill_catalog
with (security_invoker = true, security_barrier = true)
as
select
  saved.user_id,
  saved.created_at as saved_at,
  catalog.*
from api.saved_skills saved
join api.catalog_skills catalog on catalog.skill_id = saved.skill_id;

create policy profiles_own_select on api.profiles
for select to authenticated
using (user_id = (select auth.uid()));

create policy profiles_own_insert on api.profiles
for insert to authenticated
with check (user_id = (select auth.uid()));

create policy saved_skills_own_select on api.saved_skills
for select to authenticated
using (user_id = (select auth.uid()));

create policy saved_skills_own_public_insert on api.saved_skills
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from api.catalog_skills catalog where catalog.skill_id = saved_skills.skill_id)
);

create policy saved_skills_own_delete on api.saved_skills
for delete to authenticated
using (user_id = (select auth.uid()));

revoke all on all tables in schema api from public, anon, authenticated, service_role;
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema api from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema api from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

grant usage on schema api, private to anon, authenticated;
grant select on private.publishers, private.source_repositories, private.skills,
  private.skill_versions, private.skill_relationships to anon, authenticated;
grant select on api.catalog_skill_versions, api.catalog_skills, api.catalog_skill_relationships to anon, authenticated;
grant select on api.saved_skill_catalog to authenticated;
grant select, insert on api.profiles to authenticated;
grant select, insert, delete on api.saved_skills to authenticated;

alter default privileges for role postgres in schema api revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema api revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema api revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated, service_role;

comment on view api.catalog_skills is 'Bounded public catalog summary projection; no private, draft, revoked, quarantined, or legally blocked rows.';
comment on view api.catalog_skill_versions is 'Current public skill-version detail projection with independent trust evidence states.';
comment on table api.saved_skills is 'Free-account bookmarks only; not an entitlement or billing table.';

commit;
