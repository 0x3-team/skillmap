begin;

create function private.safe_public_message(value text, maximum_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value is null or (
    length(value) between 1 and maximum_length
    and value !~ '[[:cntrl:]]'
  );
$$;

create table api.skill_submissions (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('sub_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^sub_[0-9a-f]{32}$'),
  submitter_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  repository_url text not null check (
    repository_url ~ '^https://github[.]com/[A-Za-z0-9][A-Za-z0-9.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'
    and repository_url = lower(repository_url)
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
  version_label text not null check (
    length(version_label) between 1 and 100 and version_label !~ '[[:cntrl:]]'
  ),
  license_claim text check (
    license_claim is null
    or (length(license_claim) between 2 and 200 and license_claim ~ '^[A-Za-z0-9 .()+-]+$')
  ),
  idempotency_key uuid not null,
  state text not null default 'queued' check (state in ('queued', 'processing', 'withdrawn')),
  active_claim_id uuid,
  current_worker_version text check (
    current_worker_version is null
    or (length(current_worker_version) between 1 and 128 and current_worker_version ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submitter_user_id, idempotency_key),
  unique (submitter_user_id, repository_url, source_commit, source_path),
  unique (id, public_id),
  check (updated_at >= created_at),
  check (
    (state = 'queued' and active_claim_id is null and current_worker_version is null
      and claimed_at is null and claim_expires_at is null and completed_at is null and attempt_count = 0)
    or (state = 'processing' and active_claim_id is not null and current_worker_version is not null
      and claimed_at is not null and claim_expires_at > claimed_at and completed_at is null and attempt_count > 0)
    or (state = 'withdrawn' and active_claim_id is null and claim_expires_at is null and completed_at is not null)
  )
);

create table private.submission_events (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('sev_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^sev_[0-9a-f]{32}$'),
  submission_id uuid not null references api.skill_submissions(id) on delete cascade,
  from_state text check (from_state is null or from_state in ('queued', 'processing', 'withdrawn')),
  to_state text not null check (to_state in ('queued', 'processing', 'withdrawn')),
  actor_type text not null check (actor_type in ('submitter', 'worker', 'system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table private.skill_audit_receipts (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('aud_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^aud_[0-9a-f]{32}$'),
  submission_id uuid not null references api.skill_submissions(id) on delete cascade,
  state text not null check (state in ('passed', 'warnings', 'blocked')),
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_content_digest text not null check (source_content_digest ~ '^sha256:[0-9a-f]{64}$'),
  normalized_content_digest text not null check (normalized_content_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_version text not null check (length(policy_version) between 1 and 64),
  host_profile_version text not null check (length(host_profile_version) between 1 and 64),
  worker_version text not null check (length(worker_version) between 1 and 128),
  finding_counts jsonb not null check (
    jsonb_typeof(finding_counts) = 'object' and pg_column_size(finding_counts) <= 2048
  ),
  public_checks jsonb not null check (
    jsonb_typeof(public_checks) = 'array' and jsonb_array_length(public_checks) between 1 and 100
    and pg_column_size(public_checks) <= 32768
  ),
  reason_codes text[] not null default '{}'::text[]
    check (private.valid_text_array(reason_codes, 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$')),
  private_evidence_digest text not null check (private_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, submission_id),
  unique (submission_id, receipt_digest)
);

create table private.skill_grade_receipts (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('grd_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^grd_[0-9a-f]{32}$'),
  submission_id uuid not null references api.skill_submissions(id) on delete cascade,
  audit_receipt_id uuid not null,
  state text not null check (state in ('provisional', 'blocked')),
  band text check (band is null),
  total_score double precision check (total_score is null or total_score between 0 and 100),
  confidence double precision check (confidence is null or confidence between 0 and 1),
  receipt_digest text not null check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  normalized_content_digest text not null check (normalized_content_digest ~ '^sha256:[0-9a-f]{64}$'),
  audit_receipt_digest text not null check (audit_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  compatibility_evidence_digest text not null check (compatibility_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  evaluation_suite_digest text not null check (evaluation_suite_digest ~ '^sha256:[0-9a-f]{64}$'),
  rubric_version text not null check (length(rubric_version) between 1 and 64),
  host_profile_version text not null check (length(host_profile_version) between 1 and 64),
  evaluator_version text not null check (length(evaluator_version) between 1 and 128),
  hard_gates jsonb not null check (
    jsonb_typeof(hard_gates) = 'array' and jsonb_array_length(hard_gates) between 1 and 50
    and pg_column_size(hard_gates) <= 16384
  ),
  dimensions jsonb not null check (
    jsonb_typeof(dimensions) = 'array' and jsonb_array_length(dimensions) between 1 and 20
    and pg_column_size(dimensions) <= 16384
  ),
  reason_codes text[] not null
    check (cardinality(reason_codes) > 0 and private.valid_text_array(reason_codes, 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$')),
  created_at timestamptz not null default now(),
  foreign key (audit_receipt_id, submission_id)
    references private.skill_audit_receipts(id, submission_id) on delete cascade,
  unique (id, submission_id),
  unique (submission_id, receipt_digest),
  check (
    (state = 'provisional' and band is null and total_score is not null and confidence is not null)
    or (state = 'blocked' and band is null and total_score is null and confidence is null)
  )
);

create table private.review_cases (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('rev_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^rev_[0-9a-f]{32}$'),
  submission_id uuid not null references api.skill_submissions(id) on delete cascade,
  audit_receipt_id uuid,
  grade_receipt_id uuid,
  state text not null check (state in ('pending', 'approved', 'changes-requested', 'rejected')),
  reason_codes text[] not null default '{}'::text[]
    check (private.valid_text_array(reason_codes, 20, 64, '^[a-z0-9]+(-[a-z0-9]+)*$')),
  public_message text check (private.safe_public_message(public_message, 500)),
  idempotency_digest text not null unique check (idempotency_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (audit_receipt_id, submission_id)
    references private.skill_audit_receipts(id, submission_id) on delete cascade,
  foreign key (grade_receipt_id, submission_id)
    references private.skill_grade_receipts(id, submission_id) on delete cascade,
  check (
    (state in ('pending', 'approved'))
    or (cardinality(reason_codes) > 0 and public_message is not null)
  )
);

create table private.worker_runs (
  id uuid primary key,
  public_id text not null unique default ('wrk_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^wrk_[0-9a-f]{32}$'),
  submission_id uuid not null references api.skill_submissions(id) on delete cascade,
  worker_version text not null check (length(worker_version) between 1 and 128),
  attempt_number integer not null check (attempt_number between 1 and 20),
  outcome text not null check (outcome in ('succeeded', 'failed', 'cancelled')),
  input_digest text not null check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  result_digest text check (result_digest is null or result_digest ~ '^sha256:[0-9a-f]{64}$'),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  public_error_message text check (private.safe_public_message(public_error_message, 240)),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (submission_id, attempt_number),
  check (completed_at >= started_at),
  check (
    (outcome = 'succeeded' and result_digest is not null and error_code is null and public_error_message is null)
    or (outcome in ('failed', 'cancelled') and error_code is not null and public_error_message is not null)
  )
);

create index skill_submissions_owner_page_idx
  on api.skill_submissions(submitter_user_id, created_at desc, public_id);
create index skill_submissions_queue_idx
  on api.skill_submissions(created_at, public_id) where state = 'queued';
create index submission_events_submission_idx
  on private.submission_events(submission_id, created_at, id);
create index skill_audit_receipts_submission_idx
  on private.skill_audit_receipts(submission_id, created_at desc);
create index skill_grade_receipts_submission_idx
  on private.skill_grade_receipts(submission_id, created_at desc);
create index skill_grade_receipts_audit_idx
  on private.skill_grade_receipts(audit_receipt_id);
create index review_cases_submission_idx
  on private.review_cases(submission_id, created_at desc);
create index review_cases_audit_idx on private.review_cases(audit_receipt_id);
create index review_cases_grade_idx on private.review_cases(grade_receipt_id);
create index worker_runs_submission_idx
  on private.worker_runs(submission_id, created_at desc);

create function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  purge_user_id uuid;
begin
  purge_user_id := nullif(current_setting('skillmap.account_purge_user_id', true), '')::uuid;
  if tg_op = 'UPDATE' and tg_table_schema = 'private' and tg_table_name = 'submission_events' then
    if pg_trigger_depth() = 2 and purge_user_id is not null
      and old.actor_user_id = purge_user_id and new.actor_user_id is null
      and (to_jsonb(old) - 'actor_user_id') = (to_jsonb(new) - 'actor_user_id') then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' and tg_table_schema = 'private' and pg_trigger_depth() = 2
    and purge_user_id is not null and tg_table_name in (
      'submission_events', 'skill_audit_receipts', 'skill_grade_receipts', 'review_cases', 'worker_runs'
    ) then
    return old;
  end if;
  raise exception 'append-only hosted authority rows cannot be changed' using errcode = '55000';
end;
$$;

create function private.mark_account_purge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('skillmap.account_purge_user_id', old.id::text, true);
  return old;
end;
$$;

create function private.enforce_submission_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.id, old.public_id, old.submitter_user_id, old.repository_url, old.source_commit,
      old.source_path, old.version_label, old.license_claim, old.idempotency_key, old.created_at)
    is distinct from
    row(new.id, new.public_id, new.submitter_user_id, new.repository_url, new.source_commit,
      new.source_path, new.version_label, new.license_claim, new.idempotency_key, new.created_at) then
    raise exception 'submission source coordinates and ownership are immutable' using errcode = '23514';
  end if;

  if old.state <> new.state and not (
    (old.state = 'queued' and new.state in ('processing', 'withdrawn'))
  ) then
    raise exception 'illegal submission state transition: % -> %', old.state, new.state using errcode = '23514';
  end if;

  new.updated_at := now();
  if new.state = 'withdrawn' then
    new.active_claim_id := null;
    new.current_worker_version := null;
    new.claim_expires_at := null;
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;

create function private.enforce_grade_receipt_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_normalized_digest text;
  expected_audit_digest text;
begin
  select audit.normalized_content_digest, audit.receipt_digest
  into expected_normalized_digest, expected_audit_digest
  from private.skill_audit_receipts audit
  where audit.id = new.audit_receipt_id and audit.submission_id = new.submission_id;

  if expected_normalized_digest is null then
    raise exception 'grade receipt audit subject was not found' using errcode = '23503';
  end if;
  if new.normalized_content_digest is distinct from expected_normalized_digest
    or new.audit_receipt_digest is distinct from expected_audit_digest then
    raise exception 'grade receipt does not bind the exact audit subject and receipt' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.append_submission_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.state is distinct from new.state then
    insert into private.submission_events (
      submission_id, from_state, to_state, actor_type, actor_user_id
    ) values (
      new.id,
      case when tg_op = 'INSERT' then null else old.state end,
      new.state,
      case
        when (select auth.role()) = 'service_role' then 'worker'
        when (select auth.uid()) is not null then 'submitter'
        else 'system'
      end,
      case when (select auth.role()) = 'authenticated' then (select auth.uid()) else null end
    );
  end if;
  return new;
end;
$$;

create trigger skill_submissions_enforce_update
before update on api.skill_submissions
for each row execute function private.enforce_submission_update();

create trigger skillmap_account_purge_context
before delete on auth.users
for each row execute function private.mark_account_purge();

create trigger skill_submissions_append_event
after insert or update on api.skill_submissions
for each row execute function private.append_submission_event();

create trigger submission_events_append_only
before update or delete on private.submission_events
for each row execute function private.reject_append_only_mutation();
create trigger skill_audit_receipts_append_only
before update or delete on private.skill_audit_receipts
for each row execute function private.reject_append_only_mutation();
create trigger skill_grade_receipts_append_only
before update or delete on private.skill_grade_receipts
for each row execute function private.reject_append_only_mutation();
create trigger skill_grade_receipts_bind_audit
before insert on private.skill_grade_receipts
for each row execute function private.enforce_grade_receipt_binding();
create trigger review_cases_append_only
before update or delete on private.review_cases
for each row execute function private.reject_append_only_mutation();
create trigger worker_runs_append_only
before update or delete on private.worker_runs
for each row execute function private.reject_append_only_mutation();

alter table api.skill_submissions enable row level security;
alter table api.skill_submissions force row level security;
alter table private.submission_events enable row level security;
alter table private.submission_events force row level security;
alter table private.skill_audit_receipts enable row level security;
alter table private.skill_audit_receipts force row level security;
alter table private.skill_grade_receipts enable row level security;
alter table private.skill_grade_receipts force row level security;
alter table private.review_cases enable row level security;
alter table private.review_cases force row level security;
alter table private.worker_runs enable row level security;
alter table private.worker_runs force row level security;

create policy skill_submissions_own_select on api.skill_submissions
for select to authenticated
using (submitter_user_id = (select auth.uid()));

create policy skill_submissions_own_queued_insert on api.skill_submissions
for insert to authenticated
with check (
  submitter_user_id = (select auth.uid())
  and state = 'queued'
  and active_claim_id is null
  and current_worker_version is null
  and attempt_count = 0
  and claimed_at is null
  and claim_expires_at is null
  and completed_at is null
);

create policy skill_submissions_own_withdraw on api.skill_submissions
for update to authenticated
using (submitter_user_id = (select auth.uid()) and state = 'queued')
with check (submitter_user_id = (select auth.uid()) and state = 'withdrawn');

create view api.my_skill_submissions
with (security_invoker = true, security_barrier = true)
as
select
  public_id as submission_id,
  repository_url,
  source_commit,
  source_path,
  version_label,
  license_claim,
  state,
  created_at,
  updated_at,
  claimed_at,
  completed_at
from api.skill_submissions;

create function api.claim_skill_submission(
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

  select candidate.id
  into target_id
  from api.skill_submissions candidate
  where candidate.state = 'queued'
    and (p_submission_id is null or candidate.public_id = p_submission_id)
  order by candidate.created_at, candidate.public_id
  for update skip locked
  limit 1;

  if target_id is null then
    return;
  end if;

  return query
  update api.skill_submissions submission
  set
    state = 'processing',
    active_claim_id = next_claim_id,
    current_worker_version = p_worker_version,
    attempt_count = submission.attempt_count + 1,
    claimed_at = now(),
    claim_expires_at = now() + make_interval(secs => p_lease_seconds)
  where submission.id = target_id
  returning
    submission.public_id,
    next_claim_id,
    submission.repository_url,
    submission.source_commit,
    submission.source_path,
    submission.version_label,
    submission.license_claim,
    submission.attempt_count,
    submission.claim_expires_at;
end;
$$;

revoke all on table api.skill_submissions from public, anon, authenticated, service_role;
revoke all on table private.submission_events from public, anon, authenticated, service_role;
revoke all on table private.skill_audit_receipts from public, anon, authenticated, service_role;
revoke all on table private.skill_grade_receipts from public, anon, authenticated, service_role;
revoke all on table private.review_cases from public, anon, authenticated, service_role;
revoke all on table private.worker_runs from public, anon, authenticated, service_role;
revoke all on api.my_skill_submissions from public, anon, authenticated, service_role;
revoke all on function api.claim_skill_submission(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function private.append_submission_event() from public, anon, authenticated, service_role;
revoke all on function private.enforce_submission_update() from public, anon, authenticated, service_role;
revoke all on function private.enforce_grade_receipt_binding() from public, anon, authenticated, service_role;
revoke all on function private.reject_append_only_mutation() from public, anon, authenticated, service_role;
revoke all on function private.mark_account_purge() from public, anon, authenticated, service_role;

grant usage on schema api to service_role;
grant select (
  public_id, repository_url, source_commit, source_path, version_label,
  license_claim, state, created_at, updated_at, claimed_at, completed_at
) on api.skill_submissions to authenticated;
grant insert (
  repository_url, source_commit, source_path, version_label, license_claim, idempotency_key
) on api.skill_submissions to authenticated;
grant update (state) on api.skill_submissions to authenticated;
grant select on api.my_skill_submissions to authenticated;
grant execute on function api.claim_skill_submission(text, text, integer) to service_role;

comment on table api.skill_submissions is 'Account-owned exact-commit submission intents. Browser roles can queue and withdraw only; evidence and publication authority remain private.';
comment on function api.claim_skill_submission(text, text, integer) is 'Batch 1 service-role-only queued-to-processing claim. Completion, retry, receipt promotion, and publication remain fail-closed until later migrations.';
comment on table private.skill_grade_receipts is 'Append-only Batch 1 grade evidence. Current letter grades are structurally forbidden; only provisional or blocked receipts are admitted.';

commit;
