begin;

set local search_path = '';

-- M2.04 authority: M1.03/M1.05 own the immutable manifest and digest
-- contract; M1.06 owns release lifecycle semantics. This migration creates
-- storage and a locked, ungranted activation primitive only. It does not add
-- files, storage objects, routing selection, policy grants, or catalog state.

create table private.managed_skill_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_id text not null
    default ('msv_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  managed_skill_id uuid not null,

  -- These are the exact canonical bytes produced by M1.03/M1.05. They are
  -- deliberately bytea so PostgreSQL cannot parse and reserialize JSON.
  manifest_schema_version text not null,
  manifest_projection bytea not null,
  manifest_digest text not null,
  content_digest text not null,

  canonical_metadata jsonb not null,
  source jsonb not null,
  provenance_state text not null,

  -- Analysis is an adjunct evidence status, not lifecycle authority. The
  -- vocabulary remains owned by the analysis contract and is intentionally
  -- not closed here.
  analysis_state text not null default 'pending',
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint managed_skill_versions_public_id_key unique (public_id),
  constraint managed_skill_versions_account_id_id_key unique (account_id, id),
  constraint managed_skill_versions_account_id_public_id_key unique (account_id, public_id),
  constraint managed_skill_versions_account_skill_id_key
    unique (account_id, managed_skill_id, id),
  constraint managed_skill_versions_account_skill_manifest_key
    unique (account_id, managed_skill_id, manifest_digest),
  constraint managed_skill_versions_account_skill_content_key
    unique (account_id, managed_skill_id, content_digest),
  constraint managed_skill_versions_skill_fkey
    foreign key (account_id, managed_skill_id)
    references private.managed_skills (account_id, id)
    on delete cascade,
  constraint managed_skill_versions_public_id_format_check
    check (public_id ~ '^msv_[0-9a-f]{32}$'),
  constraint managed_skill_versions_schema_version_check
    check (
      pg_catalog.octet_length(manifest_schema_version) between 3 and 16
      and manifest_schema_version ~ '^[0-9]+\.[0-9]+$'
    ),
  constraint managed_skill_versions_manifest_projection_bytes_check
    check (pg_catalog.octet_length(manifest_projection) between 1 and 262144),
  constraint managed_skill_versions_manifest_digest_format_check
    check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint managed_skill_versions_content_digest_format_check
    check (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint managed_skill_versions_canonical_metadata_check
    check (
      pg_catalog.jsonb_typeof(canonical_metadata) = 'object'
      and pg_catalog.octet_length(canonical_metadata::text) <= 16384
      and canonical_metadata ?& array['logical_id', 'display_name']
      and (canonical_metadata - array['logical_id', 'display_name', 'description']) = '{}'::jsonb
      and pg_catalog.jsonb_typeof(canonical_metadata -> 'logical_id') = 'string'
      and pg_catalog.jsonb_typeof(canonical_metadata -> 'display_name') = 'string'
      and pg_catalog.octet_length(canonical_metadata ->> 'logical_id') between 1 and 128
      and pg_catalog.char_length(canonical_metadata ->> 'display_name') between 1 and 200
      and pg_catalog.octet_length(canonical_metadata ->> 'display_name') <= 800
      and canonical_metadata ->> 'logical_id' = pg_catalog.btrim(canonical_metadata ->> 'logical_id')
      and canonical_metadata ->> 'display_name' = pg_catalog.btrim(canonical_metadata ->> 'display_name')
      and (canonical_metadata ->> 'logical_id') !~ '[[:cntrl:]]'
      and (canonical_metadata ->> 'display_name') !~ '[[:cntrl:]]'
      and (
        not (canonical_metadata ? 'description')
        or (canonical_metadata -> 'description') = 'null'::jsonb
        or (
          pg_catalog.jsonb_typeof(canonical_metadata -> 'description') = 'string'
          and pg_catalog.octet_length(canonical_metadata ->> 'description') <= 2048
          and canonical_metadata ->> 'description' = pg_catalog.btrim(canonical_metadata ->> 'description')
          and (canonical_metadata ->> 'description') !~ '[[:cntrl:]]'
        )
      )
    ),
  constraint managed_skill_versions_source_check
    check (
      pg_catalog.jsonb_typeof(source) = 'object'
      and pg_catalog.octet_length(source::text) <= 8192
      and source ?& array['authority', 'kind', 'namespace', 'source_id', 'revision']
      and (source - array['authority', 'kind', 'namespace', 'source_id', 'revision']) = '{}'::jsonb
      and pg_catalog.jsonb_typeof(source -> 'authority') = 'string'
      and pg_catalog.jsonb_typeof(source -> 'kind') = 'string'
      and pg_catalog.jsonb_typeof(source -> 'namespace') = 'string'
      and pg_catalog.jsonb_typeof(source -> 'source_id') = 'string'
      and pg_catalog.jsonb_typeof(source -> 'revision') = 'string'
      and pg_catalog.octet_length(source ->> 'authority') between 1 and 512
      and pg_catalog.octet_length(source ->> 'kind') between 1 and 512
      and pg_catalog.octet_length(source ->> 'namespace') between 1 and 512
      and pg_catalog.octet_length(source ->> 'source_id') between 1 and 512
      and pg_catalog.octet_length(source ->> 'revision') between 1 and 512
      and source ->> 'authority' = pg_catalog.btrim(source ->> 'authority')
      and source ->> 'kind' = pg_catalog.btrim(source ->> 'kind')
      and source ->> 'namespace' = pg_catalog.btrim(source ->> 'namespace')
      and source ->> 'source_id' = pg_catalog.btrim(source ->> 'source_id')
      and source ->> 'revision' = pg_catalog.btrim(source ->> 'revision')
      and (source ->> 'authority') !~ '[[:cntrl:]]'
      and (source ->> 'kind') !~ '[[:cntrl:]]'
      and (source ->> 'namespace') !~ '[[:cntrl:]]'
      and (source ->> 'source_id') !~ '[[:cntrl:]]'
      and (source ->> 'revision') !~ '[[:cntrl:]]'
    ),
  constraint managed_skill_versions_provenance_state_check
    check (
      pg_catalog.octet_length(provenance_state) between 1 and 64
      and provenance_state ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
  constraint managed_skill_versions_analysis_state_check
    check (
      pg_catalog.octet_length(analysis_state) between 1 and 64
      and analysis_state ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    )
);

create function private.enforce_managed_skill_version_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.public_id is distinct from old.public_id
      or new.account_id is distinct from old.account_id
      or new.managed_skill_id is distinct from old.managed_skill_id
      or new.manifest_schema_version is distinct from old.manifest_schema_version
      or new.manifest_projection is distinct from old.manifest_projection
      or new.manifest_digest is distinct from old.manifest_digest
      or new.content_digest is distinct from old.content_digest
      or new.canonical_metadata is distinct from old.canonical_metadata
      or new.source is distinct from old.source
      or new.provenance_state is distinct from old.provenance_state
      or new.analysis_state is distinct from old.analysis_state
      or new.created_at is distinct from old.created_at
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill version immutable fields are immutable';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.statement_timestamp();
  end if;
  return new;
end
$function$;

create trigger managed_skill_versions_enforce_immutability
before insert or update on private.managed_skill_versions
for each row
execute function private.enforce_managed_skill_version_immutability();

revoke all privileges on table private.managed_skill_versions
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_managed_skill_version_immutability()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on table private.managed_skill_versions is
  'Private immutable Managed Skill Vault versions; M1.03/M1.05 canonical bytes and digests are authoritative.';
comment on column private.managed_skill_versions.manifest_projection is
  'Exact M1.03 canonical UTF-8 bytes, stored as bytea and never JSON-reserialized.';
comment on column private.managed_skill_versions.canonical_metadata is
  'Bounded canonical metadata envelope; the exact manifest projection remains authoritative for digest meaning.';
comment on column private.managed_skill_versions.source is
  'Bounded qualified source tuple from the M1.03 manifest; no credentials or local roots.';
comment on column private.managed_skill_versions.provenance_state is
  'Bounded provenance adjunct state; vocabulary is owned by the provenance contract.';
comment on column private.managed_skill_versions.analysis_state is
  'Bounded adjunct analysis status; not M1.06 lifecycle and not sufficient for routing authorization.';

create function private.managed_skill_release_reason_codes_are_canonical(value text[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select
    pg_catalog.cardinality(value) between 0 and 16
    and not exists (
      select 1
      from pg_catalog.unnest(value) as codes(code)
      where code is null
        or pg_catalog.octet_length(code) not between 1 and 64
        or code !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    )
    and value = coalesce(
      (
        select pg_catalog.array_agg(code order by code)
        from pg_catalog.unnest(value) as codes(code)
      ),
      '{}'::text[]
    )
    and pg_catalog.cardinality(value) = (
      select count(distinct code)::integer
      from pg_catalog.unnest(value) as codes(code)
    );
$function$;

revoke all privileges on function private.managed_skill_release_reason_codes_are_canonical(text[])
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create table private.managed_skill_releases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_id text not null
    default ('msr_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  managed_skill_id uuid not null,
  version_id uuid not null,

  lifecycle_state text not null,
  eligibility_reasons text[] not null default '{}'::text[],
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  activated_at timestamp with time zone,
  revoked_at timestamp with time zone,

  constraint managed_skill_releases_public_id_key unique (public_id),
  constraint managed_skill_releases_account_id_id_key unique (account_id, id),
  constraint managed_skill_releases_account_skill_id_key
    unique (account_id, managed_skill_id, id),
  constraint managed_skill_releases_binding_key
    unique (account_id, managed_skill_id, version_id),
  constraint managed_skill_releases_skill_fkey
    foreign key (account_id, managed_skill_id)
    references private.managed_skills (account_id, id)
    on delete cascade,
  constraint managed_skill_releases_version_fkey
    foreign key (account_id, managed_skill_id, version_id)
    references private.managed_skill_versions (account_id, managed_skill_id, id)
    on delete cascade,
  constraint managed_skill_releases_public_id_format_check
    check (public_id ~ '^msr_[0-9a-f]{32}$'),
  constraint managed_skill_releases_lifecycle_state_check
    check (
      lifecycle_state in (
        'importing', 'analyzing', 'needs-review', 'active', 'disabled',
        'quarantined', 'archived', 'corrupt', 'deleting'
      )
    ),
  constraint managed_skill_releases_reason_codes_shape_check
    check (private.managed_skill_release_reason_codes_are_canonical(eligibility_reasons)),
  constraint managed_skill_releases_eligibility_consistency_check
    check (
      lifecycle_state <> 'active'
      or pg_catalog.cardinality(eligibility_reasons) = 0
    ),
  constraint managed_skill_releases_active_revocation_check
    check (lifecycle_state <> 'active' or revoked_at is null),
  constraint managed_skill_releases_activation_time_check
    check (activated_at is null or activated_at >= created_at),
  constraint managed_skill_releases_revocation_time_check
    check (
      revoked_at is null
      or (activated_at is not null and revoked_at >= activated_at)
    )
);

create index managed_skill_releases_eligible_idx
  on private.managed_skill_releases (account_id, managed_skill_id, created_at desc, public_id)
  where lifecycle_state = 'active'
    and pg_catalog.cardinality(eligibility_reasons) = 0
    and revoked_at is null;

create function private.enforce_managed_skill_release_binding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.public_id is distinct from old.public_id
      or new.account_id is distinct from old.account_id
      or new.managed_skill_id is distinct from old.managed_skill_id
      or new.version_id is distinct from old.version_id
      or new.created_at is distinct from old.created_at
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill release binding coordinates are immutable';
    end if;

    if old.activated_at is not null
      and new.activated_at is distinct from old.activated_at
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill release activation timestamp is immutable';
    end if;

    if old.revoked_at is not null
      and new.revoked_at is distinct from old.revoked_at
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill release revocation timestamp is immutable';
    end if;

    if old.activated_at is null
      and new.activated_at is not null
      and new.lifecycle_state <> 'active'
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill release activation requires active lifecycle';
    end if;

    if old.revoked_at is null
      and new.revoked_at is not null
      and (old.lifecycle_state <> 'active' or old.activated_at is null)
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill release revocation requires prior active lifecycle';
    end if;

    if new.lifecycle_state is distinct from old.lifecycle_state
      and not (
        (old.lifecycle_state = 'importing'
          and new.lifecycle_state in ('analyzing', 'quarantined', 'corrupt', 'deleting'))
        or (old.lifecycle_state = 'analyzing'
          and new.lifecycle_state in ('needs-review', 'active', 'quarantined', 'corrupt', 'deleting'))
        or (old.lifecycle_state = 'needs-review'
          and new.lifecycle_state in ('analyzing', 'active', 'disabled', 'quarantined', 'archived', 'corrupt', 'deleting'))
        or (old.lifecycle_state = 'active'
          and new.lifecycle_state in ('analyzing', 'disabled', 'quarantined', 'archived', 'corrupt', 'deleting'))
        or (old.lifecycle_state = 'disabled'
          and new.lifecycle_state in ('analyzing', 'active', 'quarantined', 'archived', 'corrupt', 'deleting'))
        or (old.lifecycle_state = 'quarantined'
          and new.lifecycle_state in ('analyzing', 'disabled', 'archived', 'corrupt', 'deleting'))
        or (old.lifecycle_state = 'archived'
          and new.lifecycle_state in ('disabled', 'corrupt', 'deleting'))
        or (old.lifecycle_state = 'corrupt'
          and new.lifecycle_state in ('analyzing', 'archived', 'deleting'))
      )
    then
      raise exception using
        errcode = '23514',
        message = 'illegal managed skill release lifecycle transition';
    end if;

    if old.lifecycle_state = 'active'
      and (
        new.lifecycle_state is distinct from old.lifecycle_state
        or (new.revoked_at is distinct from old.revoked_at and new.revoked_at is not null)
        or (
          new.lifecycle_state = 'active'
          and new.eligibility_reasons is distinct from old.eligibility_reasons
          and pg_catalog.cardinality(new.eligibility_reasons) > 0
        )
      )
    then
      if exists (
        select 1
        from private.managed_skills as managed_skills
        where managed_skills.account_id = old.account_id
          and managed_skills.id = old.managed_skill_id
          and managed_skills.active_release_id = old.id
      ) then
        raise exception using
          errcode = '22023',
          message = 'active release must be unselected before lifecycle change';
      end if;
    end if;

  end if;

  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.statement_timestamp();

    if new.lifecycle_state = 'active' then
      if new.revoked_at is not null then
        raise exception using
          errcode = '22023',
          message = 'managed skill release active insert cannot be revoked';
      end if;
      new.activated_at := pg_catalog.statement_timestamp();
    elsif new.activated_at is not null or new.revoked_at is not null then
      raise exception using
        errcode = '22023',
        message = 'managed skill release non-active insert cannot carry lifecycle timestamps';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and old.activated_at is null
    and new.lifecycle_state = 'active'
  then
    new.activated_at := pg_catalog.statement_timestamp();
  end if;

  if tg_op = 'UPDATE'
    and old.revoked_at is null
    and new.revoked_at is not null
  then
    if old.lifecycle_state <> 'active' or old.activated_at is null then
      raise exception using
        errcode = '22023',
        message = 'managed skill release revocation requires prior active lifecycle';
    end if;
    new.revoked_at := pg_catalog.statement_timestamp();
  end if;
  return new;
end
$function$;

create trigger managed_skill_releases_enforce_binding
before insert or update on private.managed_skill_releases
for each row
execute function private.enforce_managed_skill_release_binding();

revoke all privileges on table private.managed_skill_releases
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_managed_skill_release_binding()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on table private.managed_skill_releases is
  'Private lifecycle binding between one Managed Skill and one immutable version; lifecycle lives here, not on versions.';
comment on column private.managed_skill_releases.eligibility_reasons is
  'Canonical bounded syntax-only reason codes; vocabulary is owned by later evidence/analysis contracts.';
comment on column private.managed_skill_releases.activated_at is
  'First active transition timestamp; never changes after being set.';
comment on column private.managed_skill_releases.revoked_at is
  'Monotonic revocation fact when eligibility is withdrawn after activation; not a ninth lifecycle state.';

-- Frozen M2.04 DDL order: the parent tables and their immutable/binding
-- enforcement exist before the Managed Skill receives an active pointer.
alter table private.managed_skills
  add column active_release_id uuid,
  add column activation_revision bigint not null default 0,
  add constraint managed_skills_activation_revision_check
    check (activation_revision >= 0);

alter table private.managed_skills
  add constraint managed_skills_active_release_fkey
  foreign key (account_id, id, active_release_id)
  references private.managed_skill_releases (account_id, managed_skill_id, id);

create table private.managed_skill_activation_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null,
  idempotency_key uuid not null,
  request_skill_public_id text not null,
  request_release_public_id text not null,
  request_expected_revision bigint not null,
  result_skill_public_id text not null,
  result_release_public_id text not null,
  result_state text not null,
  result_activation_revision bigint not null,
  committed_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint managed_skill_activation_receipts_scope_key
    unique (account_id, idempotency_key),
  constraint managed_skill_activation_receipts_expected_revision_check
    check (request_expected_revision >= 0),
  constraint managed_skill_activation_receipts_result_revision_check
    check (result_activation_revision >= 0),
  constraint managed_skill_activation_receipts_skill_id_check
    check (request_skill_public_id ~ '^msk_[0-9a-f]{32}$'),
  constraint managed_skill_activation_receipts_release_id_check
    check (request_release_public_id ~ '^msr_[0-9a-f]{32}$'),
  constraint managed_skill_activation_receipts_result_skill_id_check
    check (result_skill_public_id ~ '^msk_[0-9a-f]{32}$'),
  constraint managed_skill_activation_receipts_result_release_id_check
    check (result_release_public_id ~ '^msr_[0-9a-f]{32}$'),
  constraint managed_skill_activation_receipts_state_check
    check (result_state in ('active', 'VAULT_RESOURCE_UNAVAILABLE', 'VAULT_STALE_REVISION'))
);

alter table private.managed_skill_activation_receipts
  add constraint managed_skill_activation_receipts_account_fkey
  foreign key (account_id) references auth.users (id) on delete cascade;

alter table private.managed_skill_activation_receipts enable row level security;
alter table private.managed_skill_activation_receipts force row level security;

revoke all privileges on table private.managed_skill_activation_receipts
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on table private.managed_skill_activation_receipts is
  'Private durable receipt for committed activation outcomes and rejected decisions; key reuse replays the bounded result or conflicts closed.';
comment on column private.managed_skill_activation_receipts.request_expected_revision is
  'Exact CAS input fingerprint component; a stale retry is a new command, not last-writer-wins.';

create function private.activate_managed_skill_release(
  skill_public_id text,
  release_public_id text,
  expected_revision bigint,
  idempotency_key uuid
)
returns table (
  result_skill_public_id text,
  result_release_public_id text,
  result_state text,
  result_activation_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_managed_skill_id uuid;
  v_release_id uuid;
  v_version_id uuid;
  v_revision bigint;
  v_skill_public_id text;
  v_skill_active_release_id uuid;
  v_receipt private.managed_skill_activation_receipts%rowtype;
  v_release_public_id text;
  v_release_lifecycle_state text;
  v_release_eligibility_reasons text[];
  v_release_activated_at timestamp with time zone;
  v_release_revoked_at timestamp with time zone;
begin
  v_account_id := auth.uid();
  if v_account_id is null
    or skill_public_id is null
    or release_public_id is null
    or expected_revision is null
    or expected_revision < 0
    or idempotency_key is null
    or skill_public_id !~ '^msk_[0-9a-f]{32}$'
    or release_public_id !~ '^msr_[0-9a-f]{32}$'
  then
    raise exception 'The requested vault resource is unavailable.' using errcode = 'P0001';
  end if;

  -- M2.02 global lock order begins with the account advisory lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_account_id::text, 0)
  );

  select receipts.*
  into v_receipt
  from private.managed_skill_activation_receipts as receipts
  where receipts.account_id = v_account_id
    and receipts.idempotency_key = activate_managed_skill_release.idempotency_key;

  if found then
    if v_receipt.request_skill_public_id is distinct from activate_managed_skill_release.skill_public_id
      or v_receipt.request_release_public_id is distinct from activate_managed_skill_release.release_public_id
      or v_receipt.request_expected_revision is distinct from activate_managed_skill_release.expected_revision
    then
      raise exception 'The request conflicts with an earlier committed import.' using errcode = 'P0001';
    end if;

    return query
    select
      v_receipt.result_skill_public_id,
      v_receipt.result_release_public_id,
      v_receipt.result_state,
      v_receipt.result_activation_revision;
    return;
  end if;

  -- Lock the Managed Skill before resolving child rows. The version and
  -- release locks below follow it and are ordered by their UUID identity.
  select
    managed_skills.id,
    managed_skills.public_id,
    managed_skills.active_release_id,
    managed_skills.activation_revision
  into
    v_managed_skill_id,
    v_skill_public_id,
    v_skill_active_release_id,
    v_revision
  from private.managed_skills as managed_skills
  where managed_skills.account_id = v_account_id
    and managed_skills.public_id = activate_managed_skill_release.skill_public_id
  for update;

  if not found then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      activate_managed_skill_release.expected_revision
    );
    return query
    select
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      activate_managed_skill_release.expected_revision;
    return;
  end if;

  -- Resolve the release under the locked skill, then lock its immutable
  -- version before locking the mutable release binding.
  select releases.id, releases.version_id
  into v_release_id, v_version_id
  from private.managed_skill_releases as releases
  where releases.account_id = v_account_id
    and releases.managed_skill_id = v_managed_skill_id
    and releases.public_id = activate_managed_skill_release.release_public_id;

  if not found then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      v_revision;
    return;
  end if;

  perform 1
  from private.managed_skill_versions as versions
  where versions.account_id = v_account_id
    and versions.managed_skill_id = v_managed_skill_id
    and versions.id = v_version_id
  for update;

  if not found then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      v_revision;
    return;
  end if;

  select
    releases.public_id,
    releases.lifecycle_state,
    releases.eligibility_reasons,
    releases.activated_at,
    releases.revoked_at
  into
    v_release_public_id,
    v_release_lifecycle_state,
    v_release_eligibility_reasons,
    v_release_activated_at,
    v_release_revoked_at
  from private.managed_skill_releases as releases
  where releases.account_id = v_account_id
    and releases.managed_skill_id = v_managed_skill_id
    and releases.id = v_release_id
  for update;

  if not found
  then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      v_revision;
    return;
  end if;

  if v_revision <> activate_managed_skill_release.expected_revision then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      v_release_public_id,
      'VAULT_STALE_REVISION',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      v_release_public_id,
      'VAULT_STALE_REVISION'::text,
      v_revision;
    return;
  end if;

  if v_release_lifecycle_state <> 'active'
    or pg_catalog.cardinality(v_release_eligibility_reasons) <> 0
    or v_release_activated_at is null
    or v_release_revoked_at is not null
  then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      v_release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      v_release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      v_revision;
    return;
  end if;

  if v_skill_active_release_id is distinct from v_release_id then
    update private.managed_skills
    set active_release_id = v_release_id,
        activation_revision = activation_revision + 1
    where account_id = v_account_id
      and id = v_managed_skill_id
    returning activation_revision into v_revision;
  else
    null;
  end if;

  insert into private.managed_skill_activation_receipts (
    account_id,
    idempotency_key,
    request_skill_public_id,
    request_release_public_id,
    request_expected_revision,
    result_skill_public_id,
    result_release_public_id,
    result_state,
    result_activation_revision
  ) values (
    v_account_id,
    activate_managed_skill_release.idempotency_key,
    activate_managed_skill_release.skill_public_id,
    activate_managed_skill_release.release_public_id,
    activate_managed_skill_release.expected_revision,
    v_skill_public_id,
    v_release_public_id,
    'active',
    v_revision
  );

  return query
  select
    v_skill_public_id,
    v_release_public_id,
    'active'::text,
    v_revision;
end
$function$;

revoke all privileges on function private.activate_managed_skill_release(text, text, bigint, uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on function private.activate_managed_skill_release(text, text, bigint, uuid) is
  'Unexposed M2.04 SECURITY DEFINER CAS implementation; the migration BYPASSRLS owner is temporary while FORCE RLS has no policies, and M2.10 must transfer ownership to the NOLOGIN vault definer atomically with its exact policies and grants.';

create function api.activate_managed_skill_release(
  skill_public_id text,
  release_public_id text,
  expected_revision bigint,
  idempotency_key uuid
)
returns table (
  result_skill_public_id text,
  result_release_public_id text,
  result_state text,
  result_activation_revision bigint
)
language sql
security definer
set search_path = ''
as $function$
  select *
  from private.activate_managed_skill_release(
    $1,
    $2,
    $3,
    $4
  );
$function$;

revoke all privileges on function api.activate_managed_skill_release(text, text, bigint, uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on function api.activate_managed_skill_release(text, text, bigint, uuid) is
  'Unexposed M2.04 activation entry point; later M2.10 owns NOLOGIN-definer transfer, reviewed policies, grants, and public exposure in one transaction.';

alter table private.managed_skill_versions enable row level security;
alter table private.managed_skill_versions force row level security;
alter table private.managed_skill_releases enable row level security;
alter table private.managed_skill_releases force row level security;

-- Intentionally no RLS policies or application grants are created here.

commit;
