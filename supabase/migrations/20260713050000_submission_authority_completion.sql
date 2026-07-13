begin;

-- Collision decisions made before target binding cannot authorize a new
-- publication. Retain them as immutable v1 evidence and admit only v2 reviews
-- at the publication gate.
alter table private.submission_collision_reviews
  add column authority_version integer not null default 1
    check (authority_version in (1, 2)),
  add column target_publisher_id uuid references private.publishers(id) on delete restrict,
  add column target_skill_id uuid references private.skills(id) on delete restrict,
  add column target_version_id uuid references private.skill_versions(id) on delete restrict,
  add constraint submission_collision_reviews_v2_target_shape check (
    authority_version = 1
    or (
      authority_version = 2
      and (
        (disposition = 'approved-update'
          and target_publisher_id is not null
          and target_skill_id is not null
          and target_version_id is not null)
        or (disposition in ('approved-distinct', 'blocked-duplicate')
          and target_publisher_id is null
          and target_skill_id is null
          and target_version_id is null)
      )
    )
  ),
  add constraint submission_collision_reviews_target_version_skill_fkey
    foreign key (target_skill_id, target_version_id)
    references private.skill_versions(skill_id, id) on delete restrict;

do $$
declare
  subject_unique_name text;
begin
  select constraint_row.conname into subject_unique_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'private.submission_collision_reviews'::regclass
    and constraint_row.contype = 'u'
    and pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (submission_id, review_subject_digest)';
  if subject_unique_name is null then
    raise exception 'collision subject uniqueness constraint was not found';
  end if;
  execute format(
    'alter table private.submission_collision_reviews drop constraint %I',
    subject_unique_name
  );
end;
$$;
alter table private.submission_collision_reviews
  add constraint submission_collision_reviews_subject_version_key
    unique (submission_id, review_subject_digest, authority_version);

create table private.submission_publisher_authorization_receipts (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('aut_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^aut_[0-9a-f]{32}$'),
  receipt_sequence bigint generated always as identity unique,
  submission_id uuid not null references api.skill_submissions(id) on delete cascade,
  repository_url text not null check (
    repository_url ~ '^https://github[.]com/[a-z0-9][a-z0-9.-]{0,99}/[a-z0-9][a-z0-9_.-]{0,99}$'
    and length(repository_url) <= 226
  ),
  source_commit text not null check (source_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  source_path text not null check (
    length(source_path) between 8 and 500
    and left(source_path, 1) <> '/'
    and source_path !~ '(^|/)[.][.]?(/|$)'
    and source_path !~ '//'
    and source_path !~ '[[:cntrl:]]'
    and position(E'\\' in source_path) = 0
    and source_path ~ '(^|/)SKILL[.]md$'
  ),
  publisher_handle text not null check (
    publisher_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(publisher_handle) between 2 and 40
  ),
  decision text not null check (decision in ('authorized', 'revoked')),
  authorization_basis text check (
    authorization_basis is null
    or authorization_basis in (
      'publisher-consent', 'publisher-owner-approval', 'authorized-delegate-approval'
    )
  ),
  evidence_reference text not null check (evidence_reference ~ '^authref_[0-9a-f]{32}$'),
  evidence_digest text not null check (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz,
  idempotency_digest text not null unique check (idempotency_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (
    (decision = 'authorized' and authorization_basis is not null and expires_at is not null)
    or (decision = 'revoked' and authorization_basis is null and expires_at is null)
  )
);

create index submission_publisher_authorization_current_idx
  on private.submission_publisher_authorization_receipts(
    submission_id, publisher_handle, receipt_sequence desc
  );

-- Revocation is exact-source-global at launch. This redacted tombstone has no
-- submission or account foreign key, so deleting the originating account cannot
-- erase terminal authority. A future identity transfer requires a separate,
-- dual-controlled authority workflow; none exists in the public alpha.
create table private.publisher_authorization_revocation_tombstones (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('arv_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^arv_[0-9a-f]{32}$'),
  repository_url text not null check (
    repository_url ~ '^https://github[.]com/[a-z0-9][a-z0-9.-]{0,99}/[a-z0-9][a-z0-9_.-]{0,99}$'
    and length(repository_url) <= 226
  ),
  source_commit text not null check (source_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  source_path text not null check (
    length(source_path) between 8 and 500
    and left(source_path, 1) <> '/'
    and source_path !~ '(^|/)[.][.]?(/|$)'
    and source_path !~ '//'
    and source_path !~ '[[:cntrl:]]'
    and position(E'\\' in source_path) = 0
    and source_path ~ '(^|/)SKILL[.]md$'
  ),
  publisher_handle text not null check (
    publisher_handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(publisher_handle) between 2 and 40
  ),
  evidence_reference text not null check (evidence_reference ~ '^authref_[0-9a-f]{32}$'),
  evidence_digest text not null check (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  revocation_receipt_public_id text not null check (
    revocation_receipt_public_id ~ '^aut_[0-9a-f]{32}$'
  ),
  idempotency_digest text not null unique check (idempotency_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (repository_url, source_commit, source_path)
);

create table private.submission_license_evidence_receipts (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('lic_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^lic_[0-9a-f]{32}$'),
  submission_id uuid not null references api.skill_submissions(id) on delete cascade,
  claim_id uuid not null,
  worker_version text not null check (
    length(worker_version) between 1 and 128
    and worker_version ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
  ),
  audit_receipt_digest text not null check (audit_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  repository_url text not null,
  source_commit text not null check (source_commit ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  source_path text not null,
  spdx_expression text not null check (private.valid_public_alpha_spdx(spdx_expression)),
  evidence jsonb not null check (
    jsonb_typeof(evidence) = 'array'
    and jsonb_array_length(evidence) between 1 and 20
    and pg_column_size(evidence) <= 32768
  ),
  review_reference text not null check (review_reference ~ '^licref_[0-9a-f]{32}$'),
  review_evidence_digest text not null check (review_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_digest text not null unique check (idempotency_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (submission_id, claim_id, audit_receipt_digest)
);

create index submission_license_evidence_submission_idx
  on private.submission_license_evidence_receipts(submission_id, created_at desc);

alter table private.submission_publisher_authorization_receipts enable row level security;
alter table private.submission_publisher_authorization_receipts force row level security;
alter table private.publisher_authorization_revocation_tombstones enable row level security;
alter table private.publisher_authorization_revocation_tombstones force row level security;
alter table private.submission_license_evidence_receipts enable row level security;
alter table private.submission_license_evidence_receipts force row level security;

create function private.lock_exact_source_authority(
  expected_repository_url text,
  expected_commit text,
  expected_source_path text
)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(
    expected_repository_url || chr(31) || expected_commit || chr(31) || expected_source_path,
    7441
  ));
$$;

create function private.version_has_current_publisher_authorization(version_uuid uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce((
    select not exists (
        select 1
        from private.publisher_authorization_revocation_tombstones tombstone
        where tombstone.repository_url = repository.repository_url
          and tombstone.source_commit = version.source_commit
          and tombstone.source_path = version.source_path
      ) and case
      when version.source_submission_id is null then true
      else not exists (
        select 1
        from private.submission_publisher_authorization_receipts terminal_receipt
        where terminal_receipt.submission_id = version.source_submission_id
          and terminal_receipt.repository_url = repository.repository_url
          and terminal_receipt.source_commit = version.source_commit
          and terminal_receipt.source_path = version.source_path
          and terminal_receipt.decision = 'revoked'
      ) and coalesce((
        select receipt.decision = 'authorized'
          and receipt.expires_at > clock_timestamp()
        from private.submission_publisher_authorization_receipts receipt
        where receipt.submission_id = version.source_submission_id
          and receipt.publisher_handle = publisher.handle
        order by receipt.receipt_sequence desc
        limit 1
      ), false)
    end
    from private.skill_versions version
    join private.skills skill on skill.id = version.skill_id
    join private.publishers publisher on publisher.id = skill.publisher_id
    join private.source_repositories repository on repository.id = skill.source_repository_id
    where version.id = version_uuid
  ), false);
$$;

drop policy skill_versions_public_select on private.skill_versions;
create policy skill_versions_public_select on private.skill_versions
for select to anon, authenticated
using (
  publication_state = 'published'
  and redistribution_state in ('mirrored', 'metadata-only')
  and license_state <> 'restricted'
  and revoked_at is null
  and quarantined_at is null
  and private.version_has_current_publisher_authorization(id)
  and exists (
    select 1 from private.skills skill
    where skill.id = skill_versions.skill_id
  )
);

create trigger submission_publisher_authorization_receipts_append_only
before update or delete on private.submission_publisher_authorization_receipts
for each row execute function private.reject_append_only_mutation();

create trigger publisher_authorization_revocation_tombstones_append_only
before update or delete on private.publisher_authorization_revocation_tombstones
for each row execute function private.reject_append_only_mutation();

create trigger submission_license_evidence_receipts_append_only
before update or delete on private.submission_license_evidence_receipts
for each row execute function private.reject_append_only_mutation();

create function private.valid_submission_license_evidence(
  value jsonb,
  expected_repository_url text,
  expected_commit text,
  expected_source_path text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  item jsonb;
  evidence_directory text;
  source_directory text;
begin
  if jsonb_typeof(value) is distinct from 'array'
    or jsonb_array_length(value) not between 1 and 20
    or pg_column_size(value) > 32768 then
    return false;
  end if;
  source_directory := regexp_replace(expected_source_path, '(^|/)[^/]+$', '');
  if (select count(*) from jsonb_array_elements(value)) <>
    (select count(distinct element ->> 'path') from jsonb_array_elements(value) element) then
    return false;
  end if;
  for item in select element from jsonb_array_elements(value) element loop
    if jsonb_typeof(item) is distinct from 'object'
      or private.jsonb_exact_keys(item, array[
        'repositoryUrl', 'sourceCommit', 'path', 'contentDigest'
      ]) is not true
      or jsonb_typeof(item -> 'repositoryUrl') is distinct from 'string'
      or jsonb_typeof(item -> 'sourceCommit') is distinct from 'string'
      or jsonb_typeof(item -> 'path') is distinct from 'string'
      or jsonb_typeof(item -> 'contentDigest') is distinct from 'string'
      or (item ->> 'repositoryUrl') = ''
      or (item ->> 'sourceCommit') = ''
      or (item ->> 'path') = ''
      or (item ->> 'contentDigest') = ''
      or (item ->> 'repositoryUrl') is distinct from expected_repository_url
      or (item ->> 'sourceCommit') is distinct from expected_commit
      or (item ->> 'contentDigest') !~ '^sha256:[0-9a-f]{64}$'
      or length(item ->> 'path') not between 1 and 500
      or left(item ->> 'path', 1) = '/'
      or (item ->> 'path') ~ '(^|/)[.][.]?(/|$)'
      or (item ->> 'path') ~ '//'
      or (item ->> 'path') ~ '[[:cntrl:]]'
      or position(E'\\' in (item ->> 'path')) > 0
      or (item ->> 'path') !~* '(^|/)(licen[cs]e|copying)([.][a-z0-9_-]+)?$' then
      return false;
    end if;
    evidence_directory := regexp_replace(item ->> 'path', '(^|/)[^/]+$', '');
    if evidence_directory <> ''
      and source_directory <> evidence_directory
      and left(source_directory, length(evidence_directory) + 1) <> (evidence_directory || '/') then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create function api.record_skill_submission_license_evidence(
  p_submission_id text,
  p_claim_id uuid,
  p_worker_version text,
  p_audit_receipt_digest text,
  p_spdx_expression text,
  p_evidence jsonb,
  p_review_reference text,
  p_review_evidence_digest text,
  p_idempotency_digest text
)
returns table (license_evidence_receipt_id text, audit_receipt_digest text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  prior_row private.submission_license_evidence_receipts%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker license evidence authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$'
    or p_claim_id is null
    or p_worker_version is null or length(p_worker_version) not between 1 and 128
      or p_worker_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    or p_audit_receipt_digest is null or p_audit_receipt_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_spdx_expression is null or not private.valid_public_alpha_spdx(p_spdx_expression)
    or p_review_reference is null or p_review_reference !~ '^licref_[0-9a-f]{32}$'
    or p_review_evidence_digest is null or p_review_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'license evidence request is invalid' using errcode = '22023';
  end if;

  select * into submission_row from api.skill_submissions submission
  where submission.public_id = p_submission_id for update;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;
  if private.valid_submission_license_evidence(
      p_evidence, submission_row.repository_url, submission_row.source_commit,
      submission_row.source_path
    ) is not true then
    raise exception 'license evidence does not match the exact submitted source' using errcode = '22023';
  end if;

  select * into prior_row from private.submission_license_evidence_receipts receipt
  where receipt.idempotency_digest = p_idempotency_digest;
  if prior_row.id is not null then
    if prior_row.submission_id = submission_row.id
      and prior_row.claim_id = p_claim_id
      and prior_row.worker_version = p_worker_version
      and prior_row.audit_receipt_digest = p_audit_receipt_digest
      and prior_row.spdx_expression = p_spdx_expression
      and prior_row.evidence = p_evidence
      and prior_row.review_reference = p_review_reference
      and prior_row.review_evidence_digest = p_review_evidence_digest then
      return query select prior_row.public_id, prior_row.audit_receipt_digest;
      return;
    end if;
    raise exception 'license evidence idempotency digest conflicts with retained evidence' using errcode = '23505';
  end if;

  if submission_row.state <> 'processing'
    or submission_row.active_claim_id is distinct from p_claim_id
    or submission_row.current_worker_version is distinct from p_worker_version
    or submission_row.claim_expires_at is null or submission_row.claim_expires_at < now() then
    raise exception 'license evidence claim is stale, expired, or unauthorized' using errcode = '55000';
  end if;

  insert into private.submission_license_evidence_receipts (
    submission_id, claim_id, worker_version, audit_receipt_digest,
    repository_url, source_commit, source_path, spdx_expression, evidence,
    review_reference, review_evidence_digest, idempotency_digest
  ) values (
    submission_row.id, p_claim_id, p_worker_version, p_audit_receipt_digest,
    submission_row.repository_url, submission_row.source_commit, submission_row.source_path,
    p_spdx_expression, p_evidence, p_review_reference, p_review_evidence_digest,
    p_idempotency_digest
  ) returning public_id, submission_license_evidence_receipts.audit_receipt_digest
  into license_evidence_receipt_id, audit_receipt_digest;
  return next;
end;
$$;

create function api.record_skill_submission_publisher_authorization(
  p_submission_id text,
  p_publisher_handle text,
  p_decision text,
  p_authorization_basis text,
  p_evidence_reference text,
  p_evidence_digest text,
  p_expires_at timestamptz,
  p_idempotency_digest text
)
returns table (authorization_receipt_id text, authorization_decision text, authorization_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  prior_row private.submission_publisher_authorization_receipts%rowtype;
  published_version_row private.skill_versions%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'publisher authorization authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$'
    or p_publisher_handle is null or p_publisher_handle !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      or length(p_publisher_handle) not between 2 and 40
    or p_decision not in ('authorized', 'revoked')
    or p_evidence_reference is null or p_evidence_reference !~ '^authref_[0-9a-f]{32}$'
    or p_evidence_digest is null or p_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$'
    or (p_decision = 'authorized' and (
      p_authorization_basis not in (
        'publisher-consent', 'publisher-owner-approval', 'authorized-delegate-approval'
      )
      or p_expires_at is null or p_expires_at <= clock_timestamp()
      or p_expires_at > clock_timestamp() + interval '366 days'
    ))
    or (p_decision = 'revoked' and (
      p_authorization_basis is not null or p_expires_at is not null
    )) then
    raise exception 'publisher authorization request is invalid' using errcode = '22023';
  end if;

  select * into submission_row from api.skill_submissions submission
  where submission.public_id = p_submission_id for update;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;

  perform private.lock_exact_source_authority(
    submission_row.repository_url, submission_row.source_commit, submission_row.source_path
  );

  select * into prior_row from private.submission_publisher_authorization_receipts receipt
  where receipt.idempotency_digest = p_idempotency_digest;
  if prior_row.id is not null then
    if prior_row.submission_id = submission_row.id
      and prior_row.publisher_handle = p_publisher_handle
      and prior_row.decision = p_decision
      and prior_row.authorization_basis is not distinct from p_authorization_basis
      and prior_row.evidence_reference = p_evidence_reference
      and prior_row.evidence_digest = p_evidence_digest
      and prior_row.expires_at is not distinct from p_expires_at then
      if prior_row.decision = 'authorized' and exists (
        select 1
        from private.publisher_authorization_revocation_tombstones tombstone
        where tombstone.repository_url = submission_row.repository_url
          and tombstone.source_commit = submission_row.source_commit
          and tombstone.source_path = submission_row.source_path
      ) then
        raise exception 'publisher authorization revocation is terminal for the exact source'
          using errcode = '55000';
      end if;
      if prior_row.decision = 'authorized'
        and prior_row.expires_at <= clock_timestamp() then
        raise exception 'publisher authorization replay is expired'
          using errcode = '55000';
      end if;
      return query select prior_row.public_id, prior_row.decision, prior_row.expires_at;
      return;
    end if;
    raise exception 'publisher authorization idempotency digest conflicts with retained evidence' using errcode = '23505';
  end if;

  if submission_row.state not in ('accepted', 'published') then
    raise exception 'publisher authorization requires an accepted receipt-backed submission' using errcode = '55000';
  end if;
  if p_decision = 'authorized' and (
    p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '366 days'
  ) then
    raise exception 'publisher authorization request is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from private.publisher_authorization_revocation_tombstones tombstone
    where tombstone.repository_url = submission_row.repository_url
      and tombstone.source_commit = submission_row.source_commit
      and tombstone.source_path = submission_row.source_path
  ) then
    raise exception 'publisher authorization revocation is terminal for the exact source'
      using errcode = '55000';
  end if;
  if p_decision = 'authorized' and exists (
    select 1
    from private.submission_publisher_authorization_receipts terminal_receipt
    where terminal_receipt.submission_id = submission_row.id
      and terminal_receipt.repository_url = submission_row.repository_url
      and terminal_receipt.source_commit = submission_row.source_commit
      and terminal_receipt.source_path = submission_row.source_path
      and terminal_receipt.decision = 'revoked'
  ) then
    raise exception 'publisher authorization revocation is terminal for the exact source'
      using errcode = '55000';
  end if;
  if submission_row.state = 'published' then
    select version.* into published_version_row
    from private.skill_versions version
    join private.skills skill on skill.id = version.skill_id
    join private.publishers publisher on publisher.id = skill.publisher_id
    join private.source_repositories repository on repository.id = skill.source_repository_id
    where version.public_id = submission_row.result_version_id
      and version.source_submission_id = submission_row.id
      and publisher.handle = p_publisher_handle
      and repository.repository_url = submission_row.repository_url
      and version.source_commit = submission_row.source_commit
      and version.source_path = submission_row.source_path
    for update of version;
    if published_version_row.id is null then
      if p_decision = 'revoked' then
        raise exception 'published authorization revocation must match and block the exact source publisher version'
          using errcode = '55000';
      end if;
      raise exception 'published authorization renewal must match the exact source publisher version'
        using errcode = '55000';
    end if;
    if p_decision = 'authorized' and (
      published_version_row.publication_state <> 'published'
      or published_version_row.quarantined_at is not null
      or published_version_row.revoked_at is not null
      or not exists (
        select 1
        from private.skills skill
        join private.publishers publisher on publisher.id = skill.publisher_id
        join private.source_repositories repository on repository.id = skill.source_repository_id
        where skill.id = published_version_row.skill_id
          and skill.current_version_id = published_version_row.id
          and skill.visibility_state = 'public'
          and skill.lifecycle_state in ('published', 'deprecated')
          and skill.revoked_at is null
          and publisher.handle = p_publisher_handle
          and publisher.catalog_state = 'published'
          and publisher.revoked_at is null
          and repository.repository_url = submission_row.repository_url
          and repository.catalog_state = 'published'
          and repository.revoked_at is null
      )
    ) then
      raise exception 'published authorization renewal requires an active non-revoked exact source version'
        using errcode = '55000';
    end if;
  end if;

  insert into private.submission_publisher_authorization_receipts (
    submission_id, repository_url, source_commit, source_path, publisher_handle,
    decision, authorization_basis, evidence_reference, evidence_digest,
    expires_at, idempotency_digest
  ) values (
    submission_row.id, submission_row.repository_url, submission_row.source_commit,
    submission_row.source_path, p_publisher_handle, p_decision, p_authorization_basis,
    p_evidence_reference, p_evidence_digest, p_expires_at, p_idempotency_digest
  ) returning public_id, decision, expires_at
  into authorization_receipt_id, authorization_decision, authorization_expires_at;
  if p_decision = 'revoked' then
    insert into private.publisher_authorization_revocation_tombstones (
      repository_url, source_commit, source_path, publisher_handle,
      evidence_reference, evidence_digest, revocation_receipt_public_id,
      idempotency_digest
    ) values (
      submission_row.repository_url, submission_row.source_commit,
      submission_row.source_path, p_publisher_handle, p_evidence_reference,
      p_evidence_digest, authorization_receipt_id, p_idempotency_digest
    );
    update private.skill_versions version
    set publication_state = 'blocked',
      quarantined_at = coalesce(version.quarantined_at, clock_timestamp()),
      revoked_at = coalesce(version.revoked_at, clock_timestamp())
    from private.skills skill
    join private.source_repositories repository on repository.id = skill.source_repository_id
    where skill.id = version.skill_id
      and repository.repository_url = submission_row.repository_url
      and version.source_commit = submission_row.source_commit
      and version.source_path = submission_row.source_path;
    if submission_row.state = 'published' and not found then
      raise exception 'published authorization revocation must block the exact source publisher version'
        using errcode = '55000';
    end if;
  end if;
  return next;
end;
$$;

create function private.collision_subject_has_target(
  value jsonb,
  target_skill_public_id text,
  target_version_public_id text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select exists (
    select 1
    from (
      select match from jsonb_array_elements(
        coalesce(value #> '{completionEvidence,matches}', '[]'::jsonb)
      ) match
      union all
      select match from jsonb_array_elements(
        coalesce(value #> '{currentEvidence,matches}', '[]'::jsonb)
      ) match
    ) evidence
    where match ->> 'skillId' = target_skill_public_id
      and match ->> 'versionId' = target_version_public_id
  );
$$;

create function private.collision_subject_is_complete(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  evidence_key text;
  evidence_value jsonb;
  total_matches integer;
  is_truncated boolean;
begin
  if jsonb_typeof(value) is distinct from 'object' then return false; end if;
  foreach evidence_key in array array['completionEvidence', 'currentEvidence'] loop
    evidence_value := value -> evidence_key;
    if jsonb_typeof(evidence_value) is distinct from 'object'
      or evidence_value ->> 'status' is distinct from 'bound'
      or jsonb_typeof(evidence_value -> 'matches') is distinct from 'array' then
      return false;
    end if;
    begin
      total_matches := (evidence_value ->> 'totalMatches')::integer;
      is_truncated := (evidence_value ->> 'truncated')::boolean;
    exception when others then
      return false;
    end;
    if total_matches < 0
      or is_truncated is distinct from (total_matches > 20)
      or is_truncated
      or total_matches <> jsonb_array_length(evidence_value -> 'matches') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function api.review_skill_submission_collisions(text, text, text, text)
  from public, anon, authenticated, service_role;
drop function api.review_skill_submission_collisions(text, text, text, text);

create function api.review_skill_submission_collisions(
  p_submission_id text,
  p_disposition text,
  p_reason_code text,
  p_target_publisher_id text,
  p_target_skill_id text,
  p_target_version_id text,
  p_idempotency_digest text
)
returns table (
  collision_review_id text,
  review_subject_digest text,
  disposition text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  audit_row private.skill_audit_receipts%rowtype;
  prior_row private.submission_collision_reviews%rowtype;
  existing_row private.submission_collision_reviews%rowtype;
  target_publisher_row private.publishers%rowtype;
  target_skill_row private.skills%rowtype;
  target_version_row private.skill_versions%rowtype;
  subject_value jsonb;
  subject_digest text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'collision review authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$'
    or p_disposition not in ('approved-distinct', 'approved-update', 'blocked-duplicate')
    or p_reason_code is null or length(p_reason_code) not between 1 and 64
      or p_reason_code !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$'
    or (p_disposition = 'approved-update' and (
      p_target_publisher_id is null or p_target_publisher_id !~ '^pub_[0-9a-f]{32}$'
      or p_target_skill_id is null or p_target_skill_id !~ '^skl_[0-9a-f]{32}$'
      or p_target_version_id is null or p_target_version_id !~ '^skv_[0-9a-f]{32}$'
    ))
    or (p_disposition <> 'approved-update' and (
      p_target_publisher_id is not null or p_target_skill_id is not null
      or p_target_version_id is not null
    )) then
    raise exception 'collision review request is invalid' using errcode = '22023';
  end if;

  select * into submission_row from api.skill_submissions submission
  where submission.public_id = p_submission_id for update;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;
  if submission_row.state <> 'accepted' or submission_row.review_state <> 'approved'
    or submission_row.review_case_id is null or submission_row.audit_receipt_id is null then
    raise exception 'collision review requires an accepted receipt-backed submission' using errcode = '55000';
  end if;

  select * into audit_row from private.skill_audit_receipts audit
  where audit.id = submission_row.audit_receipt_id and audit.submission_id = submission_row.id;
  perform pg_advisory_xact_lock(hashtextextended(audit_row.source_content_digest, 7331));
  perform pg_advisory_xact_lock(hashtextextended(audit_row.normalized_content_digest, 7332));
  subject_value := private.skill_submission_collision_review_subject(submission_row.id);
  subject_digest := private.collision_evidence_digest(subject_value);
  if not private.collision_subject_has_matches(subject_value) then
    raise exception 'collision review is unnecessary because no collision exists' using errcode = '55000';
  end if;
  if not private.collision_subject_is_complete(subject_value)
    and p_disposition in ('approved-distinct', 'approved-update') then
    raise exception 'partial collision evidence cannot authorize publication'
      using errcode = '55000';
  end if;

  if p_disposition = 'approved-update' then
    select * into target_version_row from private.skill_versions version
    where version.public_id = p_target_version_id
      and version.publication_state = 'published'
      and version.quarantined_at is null and version.revoked_at is null;
    select * into target_skill_row from private.skills skill
    where skill.public_id = p_target_skill_id
      and skill.id = target_version_row.skill_id
      and skill.current_version_id = target_version_row.id
      and skill.visibility_state = 'public'
      and skill.lifecycle_state in ('published', 'deprecated') and skill.revoked_at is null;
    select * into target_publisher_row from private.publishers publisher
    where publisher.public_id = p_target_publisher_id
      and publisher.id = target_skill_row.publisher_id
      and publisher.catalog_state = 'published' and publisher.revoked_at is null;
    if target_publisher_row.id is null
      or not private.collision_subject_has_target(
        subject_value, p_target_skill_id, p_target_version_id
      ) then
      raise exception 'approved update target is not the exact current collision identity' using errcode = '22023';
    end if;
  end if;

  select * into prior_row from private.submission_collision_reviews review
  where review.idempotency_digest = p_idempotency_digest;
  if prior_row.id is not null then
    if prior_row.submission_id = submission_row.id
      and prior_row.review_subject_digest = subject_digest
      and prior_row.authority_version = 2
      and prior_row.disposition = p_disposition
      and prior_row.reason_code = p_reason_code
      and prior_row.target_publisher_id is not distinct from target_publisher_row.id
      and prior_row.target_skill_id is not distinct from target_skill_row.id
      and prior_row.target_version_id is not distinct from target_version_row.id then
      return query select prior_row.public_id, prior_row.review_subject_digest, prior_row.disposition;
      return;
    end if;
    raise exception 'collision review idempotency digest conflicts with another decision' using errcode = '23505';
  end if;

  select * into existing_row from private.submission_collision_reviews review
  where review.submission_id = submission_row.id
    and review.review_subject_digest = subject_digest
    and review.authority_version = 2;
  if existing_row.id is not null then
    raise exception 'collision evidence already has an immutable target-bound disposition' using errcode = '23505';
  end if;

  insert into private.submission_collision_reviews (
    submission_id, review_case_id, audit_receipt_id, review_subject_digest,
    authority_version, disposition, reason_code, target_publisher_id,
    target_skill_id, target_version_id, idempotency_digest
  ) values (
    submission_row.id, submission_row.review_case_id, submission_row.audit_receipt_id,
    subject_digest, 2, p_disposition, p_reason_code, target_publisher_row.id,
    target_skill_row.id, target_version_row.id, p_idempotency_digest
  ) returning public_id, submission_collision_reviews.review_subject_digest,
    submission_collision_reviews.disposition
  into collision_review_id, review_subject_digest, disposition;
  return next;
end;
$$;

create or replace function private.enforce_collision_review_before_version_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_row private.skill_audit_receipts%rowtype;
  subject_value jsonb;
  subject_digest text;
  review_row private.submission_collision_reviews%rowtype;
  new_skill_row private.skills%rowtype;
  target_skill_row private.skills%rowtype;
begin
  if new.source_submission_id is null then return new; end if;
  select * into audit_row from private.skill_audit_receipts audit
  where audit.id = new.submission_audit_receipt_id
    and audit.submission_id = new.source_submission_id;
  if audit_row.id is null then
    raise exception 'publication collision gate requires exact audit evidence' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(audit_row.source_content_digest, 7331));
  perform pg_advisory_xact_lock(hashtextextended(audit_row.normalized_content_digest, 7332));
  subject_value := private.skill_submission_collision_review_subject(new.source_submission_id);
  if not private.collision_subject_has_matches(subject_value) then return new; end if;
  if not private.collision_subject_is_complete(subject_value) then
    raise exception 'publication requires complete untruncated collision evidence'
      using errcode = '55000';
  end if;
  subject_digest := private.collision_evidence_digest(subject_value);
  select * into review_row from private.submission_collision_reviews review
  where review.submission_id = new.source_submission_id
    and review.review_subject_digest = subject_digest
    and review.authority_version = 2
    and review.disposition in ('approved-distinct', 'approved-update');
  if review_row.id is null then
    raise exception 'publication requires an explicit current target-bound collision disposition'
      using errcode = '55000';
  end if;

  select * into new_skill_row from private.skills skill where skill.id = new.skill_id;
  if review_row.disposition = 'approved-distinct' then
    if exists (
      select 1
      from (
        select match from jsonb_array_elements(
          coalesce(subject_value #> '{completionEvidence,matches}', '[]'::jsonb)
        ) match
        union all
        select match from jsonb_array_elements(
          coalesce(subject_value #> '{currentEvidence,matches}', '[]'::jsonb)
        ) match
      ) evidence
      where match ->> 'skillId' = new_skill_row.public_id
    ) then
      raise exception 'approved-distinct cannot publish into a matched collision identity' using errcode = '55000';
    end if;
  else
    select * into target_skill_row from private.skills skill
    where skill.id = review_row.target_skill_id for update;
    if new.skill_id is distinct from review_row.target_skill_id
      or target_skill_row.publisher_id is distinct from review_row.target_publisher_id
      or target_skill_row.current_version_id is distinct from review_row.target_version_id then
      raise exception 'publication identity does not match the exact approved update target'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create function private.enforce_submission_authority_before_version_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  publisher_row private.publishers%rowtype;
  authorization_row private.submission_publisher_authorization_receipts%rowtype;
  license_row private.submission_license_evidence_receipts%rowtype;
  audit_row private.skill_audit_receipts%rowtype;
begin
  if new.source_submission_id is null then return new; end if;
  select * into submission_row from api.skill_submissions submission
  where submission.id = new.source_submission_id;
  select publisher.* into publisher_row
  from private.skills skill
  join private.publishers publisher on publisher.id = skill.publisher_id
  where skill.id = new.skill_id;
  if submission_row.id is null or publisher_row.id is null then
    raise exception 'publication authority subject is incomplete' using errcode = '23514';
  end if;
  perform private.lock_exact_source_authority(
    submission_row.repository_url, submission_row.source_commit, submission_row.source_path
  );

  select * into authorization_row
  from private.submission_publisher_authorization_receipts receipt
  where receipt.submission_id = submission_row.id
    and receipt.publisher_handle = publisher_row.handle
  order by receipt.receipt_sequence desc
  limit 1;
  if authorization_row.id is null or authorization_row.decision <> 'authorized'
    or authorization_row.expires_at <= clock_timestamp()
    or authorization_row.repository_url is distinct from submission_row.repository_url
    or authorization_row.source_commit is distinct from submission_row.source_commit
    or authorization_row.source_path is distinct from submission_row.source_path
    or exists (
      select 1
      from private.publisher_authorization_revocation_tombstones tombstone
      where tombstone.repository_url = submission_row.repository_url
        and tombstone.source_commit = submission_row.source_commit
        and tombstone.source_path = submission_row.source_path
    )
    or exists (
      select 1
      from private.submission_publisher_authorization_receipts terminal_receipt
      where terminal_receipt.submission_id = submission_row.id
        and terminal_receipt.repository_url = submission_row.repository_url
        and terminal_receipt.source_commit = submission_row.source_commit
        and terminal_receipt.source_path = submission_row.source_path
        and terminal_receipt.decision = 'revoked'
    ) then
    raise exception 'publication requires current exact-source publisher authorization'
      using errcode = '55000';
  end if;

  select * into audit_row from private.skill_audit_receipts audit
  where audit.id = new.submission_audit_receipt_id
    and audit.submission_id = submission_row.id
    and audit.receipt_digest = new.submission_audit_receipt_digest;
  select * into license_row from private.submission_license_evidence_receipts receipt
  where receipt.submission_id = submission_row.id
    and receipt.claim_id = submission_row.last_worker_run_id
    and receipt.audit_receipt_digest = new.submission_audit_receipt_digest;
  if license_row.id is null
    or audit_row.id is null
    or license_row.claim_id is distinct from submission_row.last_worker_run_id
    or license_row.worker_version is distinct from audit_row.worker_version
    or license_row.repository_url is distinct from submission_row.repository_url
    or license_row.source_commit is distinct from submission_row.source_commit
    or license_row.source_path is distinct from submission_row.source_path
    or license_row.spdx_expression is distinct from new.spdx_expression
    or new.license_state <> 'confirmed'
    or private.valid_submission_license_evidence(
      license_row.evidence, submission_row.repository_url, submission_row.source_commit,
      submission_row.source_path
    ) is not true then
    raise exception 'publication requires exact-commit reviewed license evidence'
      using errcode = '55000';
  end if;
  new.license_files := array(
    select item ->> 'path' from jsonb_array_elements(license_row.evidence) item
    order by item ->> 'path'
  );
  return new;
end;
$$;

create trigger skill_versions_submission_authority
before insert on private.skill_versions
for each row execute function private.enforce_submission_authority_before_version_insert();

create function private.record_expired_claim_reclaim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  input_value jsonb;
  input_digest_value text;
begin
  if old.state = 'processing'
    and old.active_claim_id is not null
    and old.current_worker_version is not null
    and old.claim_expires_at is not null and old.claim_expires_at < now()
    and new.state = 'processing'
    and new.active_claim_id is distinct from old.active_claim_id
    and new.attempt_count = old.attempt_count + 1 then
    input_value := jsonb_build_object(
      'kind', 'skillmap.hosted-expired-claim',
      'schemaVersion', 1,
      'submissionId', old.public_id,
      'claimId', old.active_claim_id,
      'workerVersion', old.current_worker_version,
      'attempt', old.attempt_count,
      'claimedAt', old.claimed_at,
      'expiredAt', old.claim_expires_at
    );
    input_digest_value := 'sha256:' || encode(
      extensions.digest(convert_to(input_value::text, 'UTF8'), 'sha256'), 'hex'
    );
    insert into private.worker_runs (
      id, submission_id, worker_version, attempt_number, outcome, disposition_state,
      input_digest, result_digest, error_code, public_error_message,
      started_at, completed_at
    ) values (
      old.active_claim_id, old.id, old.current_worker_version, old.attempt_count,
      'cancelled', 'failed', input_digest_value, null, 'CLAIM_LEASE_EXPIRED',
      'The prior worker claim expired and was safely replaced.',
      old.claimed_at, old.claim_expires_at
    );
  end if;
  return new;
end;
$$;

create trigger skill_submissions_record_expired_claim
before update on api.skill_submissions
for each row execute function private.record_expired_claim_reclaim();

create or replace function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  purge_user_id uuid;
begin
  purge_user_id := nullif(current_setting('skillmap.account_purge_user_id', true), '')::uuid;
  if tg_op = 'UPDATE' and tg_table_schema = 'private'
    and tg_table_name in ('submission_events', 'audit_events') then
    if pg_trigger_depth() = 2 and purge_user_id is not null
      and old.actor_user_id = purge_user_id and new.actor_user_id is null
      and (to_jsonb(old) - 'actor_user_id') = (to_jsonb(new) - 'actor_user_id') then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' and tg_table_schema = 'private' and pg_trigger_depth() = 2
    and purge_user_id is not null and tg_table_name in (
      'submission_events', 'skill_audit_receipts', 'skill_grade_receipts',
      'review_cases', 'worker_runs', 'submission_collision_reviews',
      'submission_publisher_authorization_receipts',
      'submission_license_evidence_receipts'
    ) then
    return old;
  end if;
  raise exception 'append-only hosted authority rows cannot be changed' using errcode = '55000';
end;
$$;

revoke all on table private.submission_publisher_authorization_receipts
  from public, anon, authenticated, service_role;
revoke all on table private.publisher_authorization_revocation_tombstones
  from public, anon, authenticated, service_role;
revoke all on table private.submission_license_evidence_receipts
  from public, anon, authenticated, service_role;
revoke all on function private.lock_exact_source_authority(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.version_has_current_publisher_authorization(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.valid_submission_license_evidence(jsonb, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.collision_subject_has_target(jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.collision_subject_is_complete(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_collision_review_before_version_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_submission_authority_before_version_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.record_expired_claim_reclaim()
  from public, anon, authenticated, service_role;
revoke all on function api.record_skill_submission_license_evidence(
  text, uuid, text, text, text, jsonb, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function api.record_skill_submission_publisher_authorization(
  text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function api.review_skill_submission_collisions(
  text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function api.record_skill_submission_license_evidence(
  text, uuid, text, text, text, jsonb, text, text, text
) to service_role;
grant execute on function api.record_skill_submission_publisher_authorization(
  text, text, text, text, text, text, timestamptz, text
) to service_role;
grant execute on function api.review_skill_submission_collisions(
  text, text, text, text, text, text, text
) to service_role;
grant execute on function private.version_has_current_publisher_authorization(uuid)
  to anon, authenticated;

comment on table private.submission_publisher_authorization_receipts is
  'Append-only redacted publisher authorization and revocation receipts bound to exact submitted source coordinates.';
comment on table private.submission_license_evidence_receipts is
  'Append-only exact-commit license file evidence and opaque operator review references; source content is never stored.';
comment on function api.record_skill_submission_license_evidence(
  text, uuid, text, text, text, jsonb, text, text, text
) is 'Service-role-only exact-claim license evidence receipt recording before completion.';
comment on function api.record_skill_submission_publisher_authorization(
  text, text, text, text, text, text, timestamptz, text
) is 'Service-role-only redacted publisher authorization or revocation receipt recording.';
comment on function api.review_skill_submission_collisions(
  text, text, text, text, text, text, text
) is 'Service-role-only immutable collision disposition; updates bind the exact current publisher, skill, and version identity.';

commit;
