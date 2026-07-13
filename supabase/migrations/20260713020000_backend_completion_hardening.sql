begin;

-- A blocked grade may lack compatibility evidence only when its exact
-- compatibility hard gate failed. Positive grades remain compatibility-bound.
create function private.grade_allows_missing_compatibility(
  grade_state text,
  compatibility_digest text,
  hard_gate_rows jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when compatibility_digest is not null then
      compatibility_digest ~ '^sha256:[0-9a-f]{64}$'
    when grade_state <> 'blocked' or jsonb_typeof(hard_gate_rows) <> 'array' then false
    else (
      select count(*) = 1
      from jsonb_array_elements(hard_gate_rows) gate
      where private.jsonb_exact_keys(gate, array['code', 'passed', 'evidenceDigest'])
        and gate ->> 'code' = 'compatibility-evidence-bound'
        and jsonb_typeof(gate -> 'passed') = 'boolean'
        and (gate ->> 'passed')::boolean = false
        and jsonb_typeof(gate -> 'evidenceDigest') = 'null'
    )
  end;
$$;

alter table private.skill_grade_receipts
  alter column compatibility_evidence_digest drop not null,
  add constraint skill_grade_receipts_compatibility_authority check (
    private.grade_allows_missing_compatibility(
      state,
      compatibility_evidence_digest,
      hard_gates
    )
  );

alter table private.review_cases
  add column collision_evidence jsonb,
  add column collision_evidence_digest text
    check (collision_evidence_digest is null or collision_evidence_digest ~ '^sha256:[0-9a-f]{64}$');

create table private.submission_collision_reviews (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('col_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^col_[0-9a-f]{32}$'),
  submission_id uuid not null references api.skill_submissions(id) on delete cascade,
  review_case_id uuid not null,
  audit_receipt_id uuid not null,
  review_subject_digest text not null check (review_subject_digest ~ '^sha256:[0-9a-f]{64}$'),
  disposition text not null check (
    disposition in ('approved-distinct', 'approved-update', 'blocked-duplicate')
  ),
  reason_code text not null check (
    length(reason_code) between 1 and 64
    and reason_code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  idempotency_digest text not null unique check (idempotency_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (review_case_id, submission_id)
    references private.review_cases(id, submission_id) on delete cascade,
  foreign key (audit_receipt_id, submission_id)
    references private.skill_audit_receipts(id, submission_id) on delete cascade,
  unique (submission_id, review_subject_digest)
);

create index submission_collision_reviews_submission_idx
  on private.submission_collision_reviews(submission_id, created_at desc);

alter table private.submission_collision_reviews enable row level security;
alter table private.submission_collision_reviews force row level security;

create function private.skill_submission_collision_evidence(
  submission_uuid uuid,
  audit_uuid uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  audit_row private.skill_audit_receipts%rowtype;
  match_count integer;
  match_rows jsonb;
begin
  select * into submission_row
  from api.skill_submissions submission
  where submission.id = submission_uuid;
  if submission_row.id is null then
    raise exception 'collision subject submission was not found' using errcode = 'P0002';
  end if;

  select * into audit_row
  from private.skill_audit_receipts audit
  where audit.id = coalesce(audit_uuid, submission_row.audit_receipt_id)
    and audit.submission_id = submission_row.id;
  if audit_row.id is null then
    return jsonb_build_object(
      'kind', 'skillmap.catalog-collision-evidence',
      'schemaVersion', 1,
      'status', 'unavailable',
      'submissionId', submission_row.public_id,
      'totalMatches', 0,
      'truncated', false,
      'matches', '[]'::jsonb
    );
  end if;

  with candidates as (
    select
      skill.public_id as skill_id,
      version.public_id as version_id,
      array_remove(array[
        case when repository.repository_url = submission_row.repository_url
          and version.source_commit = submission_row.source_commit
          and version.source_path = submission_row.source_path
          then 'exact-source' end,
        case when version.entrypoint_content_digest = audit_row.source_content_digest
          then 'entrypoint-content' end,
        case when existing_audit.normalized_content_digest = audit_row.normalized_content_digest
          then 'normalized-content' end
      ], null) as match_types
    from private.skills skill
    join private.publishers publisher on publisher.id = skill.publisher_id
    join private.source_repositories repository on repository.id = skill.source_repository_id
    join private.skill_versions version
      on version.skill_id = skill.id and version.id = skill.current_version_id
    left join private.skill_audit_receipts existing_audit
      on existing_audit.id = version.submission_audit_receipt_id
    where publisher.catalog_state = 'published' and publisher.revoked_at is null
      and repository.catalog_state = 'published' and repository.revoked_at is null
      and skill.visibility_state = 'public'
      and skill.lifecycle_state in ('published', 'deprecated') and skill.revoked_at is null
      and version.publication_state = 'published'
      and version.license_state <> 'restricted'
      and version.quarantined_at is null and version.revoked_at is null
      and version.source_submission_id is distinct from submission_row.id
      and (
        (repository.repository_url = submission_row.repository_url
          and version.source_commit = submission_row.source_commit
          and version.source_path = submission_row.source_path)
        or version.entrypoint_content_digest = audit_row.source_content_digest
        or existing_audit.normalized_content_digest = audit_row.normalized_content_digest
      )
  ), bounded as (
    select * from candidates order by skill_id, version_id limit 20
  )
  select
    (select count(*) from candidates),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'skillId', skill_id,
        'versionId', version_id,
        'matchTypes', to_jsonb(match_types)
      ) order by skill_id, version_id)
      from bounded
    ), '[]'::jsonb)
  into match_count, match_rows;

  return jsonb_build_object(
    'kind', 'skillmap.catalog-collision-evidence',
    'schemaVersion', 1,
    'status', 'bound',
    'submissionId', submission_row.public_id,
    'auditReceiptId', audit_row.public_id,
    'auditReceiptDigest', audit_row.receipt_digest,
    'sourceContentDigest', audit_row.source_content_digest,
    'normalizedContentDigest', audit_row.normalized_content_digest,
    'totalMatches', match_count,
    'truncated', match_count > 20,
    'matches', match_rows
  );
end;
$$;

create function private.collision_evidence_digest(value jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'sha256:' || encode(extensions.digest(convert_to(value::text, 'UTF8'), 'sha256'), 'hex');
$$;

create function private.bind_review_collision_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.collision_evidence := private.skill_submission_collision_evidence(
    new.submission_id,
    new.audit_receipt_id
  );
  new.collision_evidence_digest := private.collision_evidence_digest(new.collision_evidence);
  return new;
end;
$$;

alter table private.review_cases disable trigger review_cases_append_only;
update private.review_cases review
set collision_evidence = private.skill_submission_collision_evidence(review.submission_id);
update private.review_cases review
set collision_evidence_digest = private.collision_evidence_digest(review.collision_evidence);
alter table private.review_cases enable trigger review_cases_append_only;

alter table private.review_cases
  alter column collision_evidence set not null,
  alter column collision_evidence_digest set not null;

create trigger review_cases_bind_collision_evidence
before insert on private.review_cases
for each row execute function private.bind_review_collision_evidence();

create function private.skill_submission_collision_review_subject(submission_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  review_row private.review_cases%rowtype;
  current_evidence jsonb;
begin
  select * into review_row
  from private.review_cases review
  where review.submission_id = submission_uuid
  order by review.created_at desc, review.id desc
  limit 1;
  if review_row.id is null then
    raise exception 'collision review requires a completed review case' using errcode = '55000';
  end if;
  current_evidence := private.skill_submission_collision_evidence(submission_uuid);
  return jsonb_build_object(
    'kind', 'skillmap.catalog-collision-review-subject',
    'schemaVersion', 1,
    'completionEvidence', review_row.collision_evidence,
    'currentEvidence', current_evidence
  );
end;
$$;

create function private.collision_subject_has_matches(value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce((value #>> '{completionEvidence,totalMatches}')::integer, 0) > 0
    or coalesce((value #>> '{currentEvidence,totalMatches}')::integer, 0) > 0;
$$;

create function api.list_skill_submission_collisions(p_submission_id text)
returns table (
  review_subject jsonb,
  review_subject_digest text,
  collision_found boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  subject_value jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'collision review authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$' then
    raise exception 'collision lookup request is invalid' using errcode = '22023';
  end if;
  select * into submission_row from api.skill_submissions submission
  where submission.public_id = p_submission_id;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;
  if submission_row.review_case_id is null or submission_row.audit_receipt_id is null then
    raise exception 'collision lookup requires completed evidence' using errcode = '55000';
  end if;
  subject_value := private.skill_submission_collision_review_subject(submission_row.id);
  return query select subject_value, private.collision_evidence_digest(subject_value),
    private.collision_subject_has_matches(subject_value);
end;
$$;

create function api.review_skill_submission_collisions(
  p_submission_id text,
  p_disposition text,
  p_reason_code text,
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
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$' then
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

  select * into prior_row from private.submission_collision_reviews review
  where review.idempotency_digest = p_idempotency_digest;
  if prior_row.id is not null then
    if prior_row.submission_id = submission_row.id
      and prior_row.review_subject_digest = subject_digest
      and prior_row.disposition = p_disposition
      and prior_row.reason_code = p_reason_code then
      return query select prior_row.public_id, prior_row.review_subject_digest, prior_row.disposition;
      return;
    end if;
    raise exception 'collision review idempotency digest conflicts with another decision' using errcode = '23505';
  end if;

  select * into existing_row from private.submission_collision_reviews review
  where review.submission_id = submission_row.id
    and review.review_subject_digest = subject_digest;
  if existing_row.id is not null then
    raise exception 'collision evidence already has an immutable reviewed disposition' using errcode = '23505';
  end if;

  insert into private.submission_collision_reviews (
    submission_id, review_case_id, audit_receipt_id, review_subject_digest,
    disposition, reason_code, idempotency_digest
  ) values (
    submission_row.id, submission_row.review_case_id, submission_row.audit_receipt_id,
    subject_digest, p_disposition, p_reason_code, p_idempotency_digest
  ) returning public_id, submission_collision_reviews.review_subject_digest,
    submission_collision_reviews.disposition
  into collision_review_id, review_subject_digest, disposition;
  return next;
end;
$$;

create function private.enforce_collision_review_before_version_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_row private.skill_audit_receipts%rowtype;
  subject_value jsonb;
  subject_digest text;
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
  subject_digest := private.collision_evidence_digest(subject_value);
  if not exists (
    select 1 from private.submission_collision_reviews review
    where review.submission_id = new.source_submission_id
      and review.review_subject_digest = subject_digest
      and review.disposition in ('approved-distinct', 'approved-update')
  ) then
    raise exception 'publication requires an explicit current collision disposition'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger skill_versions_collision_review
before insert on private.skill_versions
for each row execute function private.enforce_collision_review_before_version_insert();

create trigger submission_collision_reviews_append_only
before update or delete on private.submission_collision_reviews
for each row execute function private.reject_append_only_mutation();

create or replace function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  purge_user_id uuid;
begin
  purge_user_id := nullif(current_setting('skillmap.account_purge_user_id', true), '')::uuid;
  if tg_op = 'UPDATE' and tg_table_schema = 'private' and tg_table_name in ('submission_events', 'audit_events') then
    if pg_trigger_depth() = 2 and purge_user_id is not null
      and old.actor_user_id = purge_user_id and new.actor_user_id is null
      and (to_jsonb(old) - 'actor_user_id') = (to_jsonb(new) - 'actor_user_id') then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' and tg_table_schema = 'private' and pg_trigger_depth() = 2
    and purge_user_id is not null and tg_table_name in (
      'submission_events', 'skill_audit_receipts', 'skill_grade_receipts',
      'review_cases', 'worker_runs', 'submission_collision_reviews'
    ) then
    return old;
  end if;
  raise exception 'append-only hosted authority rows cannot be changed' using errcode = '55000';
end;
$$;

create function api.dead_letter_expired_skill_submission(
  p_submission_id text,
  p_idempotency_digest text
)
returns table (submission_id text, submission_state text, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
  public_message constant text := 'The worker retry limit was exhausted. An operator must review this submission.';
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker recovery authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$'
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'dead-letter request is invalid' using errcode = '22023';
  end if;
  select * into submission_row from api.skill_submissions submission
  where submission.public_id = p_submission_id for update;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;

  if submission_row.state = 'failed'
    and submission_row.remediation_code = 'RETRY_LIMIT_EXHAUSTED'
    and submission_row.last_transition_digest = p_idempotency_digest
    and exists (
      select 1 from private.worker_runs run
      where run.id = submission_row.last_worker_run_id
        and run.submission_id = submission_row.id
        and run.outcome = 'cancelled'
        and run.disposition_state = 'failed'
        and run.error_code = 'RETRY_LIMIT_EXHAUSTED'
    ) then
    return query select submission_row.public_id, submission_row.state, submission_row.attempt_count;
    return;
  end if;

  if submission_row.state <> 'processing'
    or submission_row.active_claim_id is null
    or submission_row.current_worker_version is null
    or submission_row.claim_expires_at is null or submission_row.claim_expires_at > now()
    or submission_row.attempt_count < 5 then
    raise exception 'only an exact expired max-attempt claim can be dead-lettered' using errcode = '55000';
  end if;

  insert into private.worker_runs (
    id, submission_id, worker_version, attempt_number, outcome, disposition_state,
    input_digest, result_digest, error_code, public_error_message, started_at, completed_at
  ) values (
    submission_row.active_claim_id, submission_row.id, submission_row.current_worker_version,
    submission_row.attempt_count, 'cancelled', 'failed', p_idempotency_digest, null,
    'RETRY_LIMIT_EXHAUSTED', public_message, submission_row.claimed_at, now()
  );

  update api.skill_submissions submission
  set state = 'failed', active_claim_id = null, claim_expires_at = null,
    completed_at = now(), last_worker_run_id = submission_row.active_claim_id,
    remediation_code = 'RETRY_LIMIT_EXHAUSTED', public_status_message = public_message,
    last_transition_digest = p_idempotency_digest
  where submission.id = submission_row.id
  returning submission.public_id, submission.state, submission.attempt_count
  into submission_id, submission_state, attempt_count;
  return next;
end;
$$;

revoke all on table private.submission_collision_reviews from public, anon, authenticated, service_role;
revoke all on function api.list_skill_submission_collisions(text) from public, anon, authenticated, service_role;
revoke all on function api.review_skill_submission_collisions(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function api.dead_letter_expired_skill_submission(text, text) from public, anon, authenticated, service_role;
revoke all on function private.grade_allows_missing_compatibility(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.skill_submission_collision_evidence(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.collision_evidence_digest(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.bind_review_collision_evidence() from public, anon, authenticated, service_role;
revoke all on function private.skill_submission_collision_review_subject(uuid) from public, anon, authenticated, service_role;
revoke all on function private.collision_subject_has_matches(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.enforce_collision_review_before_version_insert() from public, anon, authenticated, service_role;

grant execute on function api.list_skill_submission_collisions(text) to service_role;
grant execute on function api.review_skill_submission_collisions(text, text, text, text) to service_role;
grant execute on function api.dead_letter_expired_skill_submission(text, text) to service_role;

comment on function api.dead_letter_expired_skill_submission(text, text) is
  'Service-role-only idempotent terminalization of an exact expired max-attempt claim with append-only worker and transition evidence.';
comment on function api.list_skill_submission_collisions(text) is
  'Service-role-only bounded current-catalog source and content collision evidence for a completed submission review.';
comment on function api.review_skill_submission_collisions(text, text, text, text) is
  'Service-role-only immutable disposition bound to completion-time and current collision evidence. Publication accepts only explicit approval.';

commit;
