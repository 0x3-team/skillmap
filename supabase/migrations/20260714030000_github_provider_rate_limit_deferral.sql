begin;

-- GitHub's unauthenticated REST core budget is shared by egress IP. Provider
-- exhaustion is operational backpressure, not a completed audit attempt.
alter table api.skill_submissions
  add column provider_retry_after_at timestamptz,
  add column provider_defer_count integer not null default 0
    check (provider_defer_count >= 0),
  add constraint skill_submissions_provider_retry_state_check check (
    provider_retry_after_at is null or state = 'queued'
  );

create index skill_submissions_provider_retry_idx
  on api.skill_submissions(provider_retry_after_at, created_at, public_id)
  where state = 'queued';

create or replace function private.enforce_submission_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  provider_deferral boolean;
begin
  if row(old.id, old.public_id, old.submitter_user_id, old.repository_url, old.source_commit,
      old.source_path, old.version_label, old.license_claim, old.idempotency_key, old.created_at,
      old.submission_policy_version, old.authority_confirmed, old.untrusted_processing_accepted)
    is distinct from
    row(new.id, new.public_id, new.submitter_user_id, new.repository_url, new.source_commit,
      new.source_path, new.version_label, new.license_claim, new.idempotency_key, new.created_at,
      new.submission_policy_version, new.authority_confirmed, new.untrusted_processing_accepted) then
    raise exception 'submission source coordinates, attestations, and ownership are immutable' using errcode = '23514';
  end if;

  provider_deferral := coalesce(old.state = 'processing'
    and new.state = 'queued'
    and old.active_claim_id is not null
    and current_setting('skillmap.provider_deferral_claim_id', true) = old.active_claim_id::text
    and current_setting('skillmap.provider_deferral_digest', true) = new.last_transition_digest, false);

  if old.state <> new.state and not (
    (old.state = 'queued' and new.state in ('processing', 'withdrawn'))
    or (old.state = 'processing' and new.state in ('accepted', 'changes-requested', 'rejected', 'failed'))
    or (old.state in ('failed', 'changes-requested') and new.state = 'queued')
    or (old.state = 'accepted' and new.state = 'published')
    or provider_deferral
  ) then
    raise exception 'illegal submission state transition: % -> %', old.state, new.state using errcode = '23514';
  end if;

  if new.state = 'withdrawn' then
    new.active_claim_id := null;
    new.current_worker_version := null;
    new.claim_expires_at := null;
    new.completed_at := coalesce(new.completed_at, now());
    new.review_state := case when old.state = 'queued' then 'withdrawn' else new.review_state end;
    new.provider_retry_after_at := null;
  end if;

  if provider_deferral then
    if new.active_claim_id is not null
      or new.current_worker_version is not null
      or new.claimed_at is not null
      or new.claim_expires_at is not null
      or new.completed_at is not null
      or new.attempt_count <> old.attempt_count - 1
      or new.attempt_count < 0
      or new.provider_retry_after_at is null
      or new.provider_retry_after_at <= clock_timestamp()
      or new.provider_retry_after_at > clock_timestamp() + interval '2 hours 5 seconds'
      or new.provider_defer_count <> old.provider_defer_count + 1
      or new.provider_defer_count < 1
      or new.last_transition_digest is null
      or (to_jsonb(old) - array[
          'state', 'active_claim_id', 'current_worker_version', 'attempt_count',
          'claimed_at', 'claim_expires_at', 'provider_retry_after_at',
          'provider_defer_count', 'last_transition_digest', 'updated_at'
        ]::text[]) is distinct from
        (to_jsonb(new) - array[
          'state', 'active_claim_id', 'current_worker_version', 'attempt_count',
          'claimed_at', 'claim_expires_at', 'provider_retry_after_at',
          'provider_defer_count', 'last_transition_digest', 'updated_at'
        ]::text[]) then
      raise exception 'provider deferral transition is structurally invalid' using errcode = '23514';
    end if;
  elsif old.state = 'queued' and new.state = 'processing' then
    if new.provider_retry_after_at is not null
      or new.provider_defer_count is distinct from old.provider_defer_count then
      raise exception 'claim cannot rewrite provider deferral telemetry' using errcode = '23514';
    end if;
  elsif new.state = 'withdrawn' then
    if new.provider_defer_count is distinct from old.provider_defer_count then
      raise exception 'withdrawal cannot rewrite provider deferral telemetry' using errcode = '23514';
    end if;
  elsif old.provider_retry_after_at is distinct from new.provider_retry_after_at
    or old.provider_defer_count is distinct from new.provider_defer_count then
    raise exception 'provider deferral telemetry is server-owned' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create function api.peek_skill_submission_candidate(
  p_submission_id text default null
)
returns table (
  submission_id text,
  repository_url text,
  source_commit text,
  source_path text,
  version_label text,
  license_claim text,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker authority is required' using errcode = '42501';
  end if;
  if p_submission_id is not null and p_submission_id !~ '^sub_[0-9a-f]{32}$' then
    raise exception 'submission id is invalid' using errcode = '22023';
  end if;

  return query
  select candidate.public_id, candidate.repository_url, candidate.source_commit,
    candidate.source_path, candidate.version_label, candidate.license_claim,
    candidate.attempt_count + 1
  from api.skill_submissions candidate
  where (
      (candidate.state = 'queued'
        and (candidate.provider_retry_after_at is null
          or candidate.provider_retry_after_at <= clock_timestamp()))
      or (candidate.state = 'processing' and candidate.claim_expires_at < clock_timestamp())
    )
    and candidate.attempt_count < 5
    and candidate.authority_confirmed and candidate.untrusted_processing_accepted
    and candidate.submission_policy_version = 'public-alpha-draft/v1'
    and (p_submission_id is null or candidate.public_id = p_submission_id)
  order by case when candidate.state = 'queued' then 0 else 1 end,
    candidate.created_at, candidate.public_id
  limit 1;
end;
$$;

create or replace function api.claim_skill_submission(
  p_worker_version text,
  p_submission_id text default null,
  p_lease_seconds integer default 300
)
returns table (
  submission_id text,
  claim_id uuid,
  repository_url text,
  source_commit text,
  source_path text,
  version_label text,
  license_claim text,
  attempt_number integer,
  claim_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  next_claim_id uuid := gen_random_uuid();
  reclaiming_expired_lease boolean := false;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker authority is required' using errcode = '42501';
  end if;
  if p_worker_version is null or length(p_worker_version) not between 1 and 128
    or p_worker_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
    raise exception 'worker version is invalid' using errcode = '22023';
  end if;
  if p_submission_id is not null and p_submission_id !~ '^sub_[0-9a-f]{32}$' then
    raise exception 'submission id is invalid' using errcode = '22023';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception 'claim lease must be between 30 and 900 seconds' using errcode = '22023';
  end if;

  select candidate.id, candidate.state = 'processing' into target_id, reclaiming_expired_lease
  from api.skill_submissions candidate
  where (
      (candidate.state = 'queued'
        and (candidate.provider_retry_after_at is null
          or candidate.provider_retry_after_at <= clock_timestamp()))
      or (candidate.state = 'processing' and candidate.claim_expires_at < clock_timestamp())
    )
    and candidate.attempt_count < 5
    and candidate.authority_confirmed and candidate.untrusted_processing_accepted
    and candidate.submission_policy_version = 'public-alpha-draft/v1'
    and (p_submission_id is null or candidate.public_id = p_submission_id)
  order by case when candidate.state = 'queued' then 0 else 1 end,
    candidate.created_at, candidate.public_id
  for update skip locked
  limit 1;

  if target_id is null then return; end if;

  return query
  update api.skill_submissions submission
  set state = 'processing', active_claim_id = next_claim_id,
    current_worker_version = p_worker_version,
    attempt_count = submission.attempt_count + 1,
    claimed_at = now(),
    claim_expires_at = now() + make_interval(secs => p_lease_seconds),
    provider_retry_after_at = null,
    last_transition_digest = null
  where submission.id = target_id
  returning submission.public_id, next_claim_id, submission.repository_url,
    submission.source_commit, submission.source_path, submission.version_label,
    submission.license_claim, submission.attempt_count, submission.claim_expires_at;

  if reclaiming_expired_lease then
    insert into private.submission_events (
      submission_id, from_state, to_state, actor_type, transition_digest
    ) values (target_id, 'processing', 'processing', 'worker', null);
  end if;
end;
$$;

create function api.defer_skill_submission_provider_limit(
  p_submission_id text,
  p_claim_id uuid,
  p_worker_version text,
  p_retry_after_seconds integer,
  p_idempotency_digest text
)
returns table (
  submission_id text,
  submission_state text,
  attempt_count integer,
  provider_retry_after_at timestamptz,
  provider_defer_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_row api.skill_submissions%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$'
    or p_claim_id is null
    or p_worker_version is null or length(p_worker_version) not between 1 and 128
      or p_worker_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
    or p_retry_after_seconds is null or p_retry_after_seconds not between 60 and 7200
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'provider deferral request is invalid' using errcode = '22023';
  end if;

  select * into submission_row
  from api.skill_submissions submission
  where submission.public_id = p_submission_id
  for update;
  if submission_row.id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;

  if submission_row.state = 'queued'
    and submission_row.last_transition_digest = p_idempotency_digest then
    return query select submission_row.public_id, submission_row.state,
      submission_row.attempt_count, submission_row.provider_retry_after_at,
      submission_row.provider_defer_count;
    return;
  end if;

  if submission_row.state <> 'processing'
    or submission_row.active_claim_id is distinct from p_claim_id
    or submission_row.current_worker_version is distinct from p_worker_version
    or submission_row.attempt_count < 1 then
    raise exception 'provider deferral does not own the exact active claim' using errcode = '55000';
  end if;
  if exists (select 1 from private.worker_runs run where run.id = p_claim_id)
    or exists (
      select 1 from private.submission_license_evidence_receipts evidence
      where evidence.submission_id = submission_row.id and evidence.claim_id = p_claim_id
    ) then
    raise exception 'provider deferral cannot refund a claim with durable audit evidence' using errcode = '55000';
  end if;

  perform set_config('skillmap.provider_deferral_claim_id', p_claim_id::text, true);
  perform set_config('skillmap.provider_deferral_digest', p_idempotency_digest, true);

  return query
  update api.skill_submissions submission
  set state = 'queued',
    active_claim_id = null,
    current_worker_version = null,
    attempt_count = submission.attempt_count - 1,
    claimed_at = null,
    claim_expires_at = null,
    completed_at = null,
    provider_retry_after_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
    provider_defer_count = submission.provider_defer_count + 1,
    last_transition_digest = p_idempotency_digest
  where submission.id = submission_row.id
  returning submission.public_id, submission.state, submission.attempt_count,
    submission.provider_retry_after_at, submission.provider_defer_count;
end;
$$;

revoke all on function api.peek_skill_submission_candidate(text)
  from public, anon, authenticated, service_role;
revoke all on function api.defer_skill_submission_provider_limit(text, uuid, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function api.peek_skill_submission_candidate(text) to service_role;
grant execute on function api.defer_skill_submission_provider_limit(text, uuid, text, integer, text)
  to service_role;

comment on function api.peek_skill_submission_candidate(text) is
  'Service-role-only read-only peek using the exact claim eligibility and ordering contract, including provider retry timing.';
comment on function api.defer_skill_submission_provider_limit(text, uuid, text, integer, text) is
  'Service-role-only exact-claim GitHub provider deferral. Returns processing to queued, refunds one audit attempt, and retains bounded retry timing without a worker-run row.';

commit;
