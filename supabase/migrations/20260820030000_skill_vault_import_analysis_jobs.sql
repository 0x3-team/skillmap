begin;

set local search_path = '';

create table private.import_analysis_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_id text not null
    default ('iaj_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  managed_skill_id uuid not null,
  version_id uuid not null,
  reason text not null,
  priority integer not null default 50,
  max_attempts integer not null default 5,
  attempt_count integer not null default 0,
  state text not null default 'queued',
  available_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  last_error_code text,
  result_digest text,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  completed_at timestamp with time zone,

  constraint import_analysis_jobs_public_id_key unique (public_id),
  constraint import_analysis_jobs_account_version_key unique (account_id, version_id),
  constraint import_analysis_jobs_account_id_id_key unique (account_id, id),
  constraint import_analysis_jobs_version_fkey
    foreign key (account_id, managed_skill_id, version_id)
    references private.managed_skill_versions (account_id, managed_skill_id, id)
    on delete cascade,
  constraint import_analysis_jobs_public_id_format_check
    check (public_id ~ '^iaj_[0-9a-f]{32}$'),
  constraint import_analysis_jobs_reason_check
    check (reason = 'import_finalized'),
  constraint import_analysis_jobs_priority_check
    check (priority between 0 and 100),
  constraint import_analysis_jobs_attempt_bounds_check
    check (max_attempts between 1 and 10 and attempt_count between 0 and max_attempts),
  constraint import_analysis_jobs_state_check
    check (state in ('queued', 'leased', 'completed', 'dead_lettered')),
  constraint import_analysis_jobs_lease_shape_check
    check (
      (state = 'leased' and lease_owner is not null and lease_token is not null and lease_expires_at is not null)
      or
      (state <> 'leased' and lease_owner is null and lease_token is null and lease_expires_at is null)
    ),
  constraint import_analysis_jobs_lease_owner_check
    check (
      lease_owner is null
      or (
        pg_catalog.octet_length(lease_owner) between 1 and 128
        and lease_owner = pg_catalog.btrim(lease_owner)
        and lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      )
    ),
  constraint import_analysis_jobs_error_code_check
    check (
      last_error_code is null
      or (
        pg_catalog.octet_length(last_error_code) between 1 and 64
        and last_error_code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
      )
    ),
  constraint import_analysis_jobs_result_digest_check
    check (result_digest is null or result_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_analysis_jobs_completion_shape_check
    check (
      (state = 'completed' and completed_at is not null and result_digest is not null)
      or
      (state <> 'completed' and completed_at is null and result_digest is null)
    ),
  constraint import_analysis_jobs_timestamp_order_check
    check (updated_at >= created_at and (completed_at is null or completed_at >= created_at))
);

alter table private.import_analysis_jobs enable row level security;
alter table private.import_analysis_jobs force row level security;
revoke all privileges on table private.import_analysis_jobs
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create index import_analysis_jobs_claim_idx
  on private.import_analysis_jobs (priority desc, available_at, created_at, public_id)
  where state in ('queued', 'leased');

create function private.enforce_import_analysis_job_binding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.public_id is distinct from old.public_id
    or new.account_id is distinct from old.account_id
    or new.managed_skill_id is distinct from old.managed_skill_id
    or new.version_id is distinct from old.version_id
    or new.reason is distinct from old.reason
    or new.priority is distinct from old.priority
    or new.max_attempts is distinct from old.max_attempts
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'import analysis job binding is immutable' using errcode = '22023';
  end if;
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end
$function$;

create trigger import_analysis_jobs_enforce_binding
before update on private.import_analysis_jobs
for each row execute function private.enforce_import_analysis_job_binding();

create function private.enqueue_import_analysis_job(
  p_account_id uuid,
  p_managed_skill_id uuid,
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job private.import_analysis_jobs%rowtype;
begin
  if p_account_id is null or p_managed_skill_id is null or p_version_id is null then
    raise exception 'invalid import analysis job binding' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.managed_skill_versions as versions
    join private.managed_skill_releases as releases
      on releases.account_id = versions.account_id
     and releases.managed_skill_id = versions.managed_skill_id
     and releases.version_id = versions.id
    where versions.account_id = p_account_id
      and versions.managed_skill_id = p_managed_skill_id
      and versions.id = p_version_id
      and versions.analysis_state = 'pending'
      and releases.lifecycle_state = 'needs-review'
      and releases.revoked_at is null
  ) then
    raise exception 'import analysis target is not reviewable' using errcode = '42501';
  end if;

  insert into private.import_analysis_jobs (
    account_id, managed_skill_id, version_id, reason, priority, max_attempts
  ) values (
    p_account_id, p_managed_skill_id, p_version_id, 'import_finalized', 50, 5
  )
  on conflict (account_id, version_id) do nothing;

  select jobs.* into v_job
  from private.import_analysis_jobs as jobs
  where jobs.account_id = p_account_id and jobs.version_id = p_version_id;

  if not found or v_job.managed_skill_id <> p_managed_skill_id or v_job.reason <> 'import_finalized' then
    raise exception 'conflicting import analysis job binding' using errcode = '22023';
  end if;

  return pg_catalog.jsonb_build_object(
    'job_public_id', v_job.public_id,
    'reason', v_job.reason,
    'priority', v_job.priority,
    'max_attempts', v_job.max_attempts,
    'attempt_count', v_job.attempt_count,
    'state', v_job.state,
    'available_at', v_job.available_at
  );
end
$function$;

create function private.enqueue_import_analysis_job_from_finalization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.import_sessions%rowtype;
begin
  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = new.account_id
    and sessions.device_id = new.device_id
    and sessions.id = new.session_id;

  if not found or v_session.state <> 'verified' then
    raise exception 'finalized import session is not verified' using errcode = '22023';
  end if;

  perform private.enqueue_import_analysis_job(
    v_session.account_id, v_session.managed_skill_id, v_session.version_id
  );
  return new;
end
$function$;

create trigger import_finalization_receipts_enqueue_analysis
after insert on private.import_finalization_receipts
for each row execute function private.enqueue_import_analysis_job_from_finalization();

create schema if not exists analysis_worker_adapter;
revoke all on schema analysis_worker_adapter from public;
grant usage on schema analysis_worker_adapter to service_role;

create function analysis_worker_adapter.claim_import_analysis_jobs(
  p_worker_id text,
  p_limit integer default 8,
  p_lease_seconds integer default 60
)
returns table (
  job_public_id text,
  skill_public_id text,
  version_public_id text,
  reason text,
  priority integer,
  attempt_count integer,
  max_attempts integer,
  lease_token uuid,
  lease_expires_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if p_worker_id is null
    or pg_catalog.octet_length(p_worker_id) not between 1 and 128
    or p_worker_id <> pg_catalog.btrim(p_worker_id)
    or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    or p_limit not between 1 and 32
    or p_lease_seconds not between 15 and 300
  then
    raise exception 'invalid import analysis claim' using errcode = '22023';
  end if;

  update private.import_analysis_jobs as jobs
  set
    state = 'dead_lettered',
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = coalesce(jobs.last_error_code, 'lease_expired')
  where jobs.state = 'leased'
    and jobs.lease_expires_at <= v_now
    and jobs.attempt_count >= jobs.max_attempts;

  return query
  with candidates as (
    select jobs.id
    from private.import_analysis_jobs as jobs
    where (
        jobs.state = 'queued'
        or (jobs.state = 'leased' and jobs.lease_expires_at <= v_now)
      )
      and jobs.available_at <= v_now
      and jobs.attempt_count < jobs.max_attempts
    order by jobs.priority desc, jobs.available_at, jobs.created_at, jobs.public_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.import_analysis_jobs as jobs
    set
      state = 'leased',
      attempt_count = jobs.attempt_count + 1,
      lease_owner = p_worker_id,
      lease_token = pg_catalog.gen_random_uuid(),
      lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      last_error_code = null
    from candidates
    where jobs.id = candidates.id
    returning jobs.*
  )
  select
    claimed.public_id,
    skills.public_id,
    versions.public_id,
    claimed.reason,
    claimed.priority,
    claimed.attempt_count,
    claimed.max_attempts,
    claimed.lease_token,
    claimed.lease_expires_at
  from claimed
  join private.managed_skills as skills
    on skills.account_id = claimed.account_id and skills.id = claimed.managed_skill_id
  join private.managed_skill_versions as versions
    on versions.account_id = claimed.account_id
   and versions.managed_skill_id = claimed.managed_skill_id
   and versions.id = claimed.version_id
  order by claimed.priority desc, claimed.available_at, claimed.created_at, claimed.public_id;
end
$function$;

create function analysis_worker_adapter.renew_import_analysis_job(
  p_job_public_id text,
  p_worker_id text,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns timestamp with time zone
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_new_expiry timestamp with time zone;
begin
  if p_lease_seconds not between 15 and 300 then
    raise exception 'invalid import analysis renewal' using errcode = '22023';
  end if;
  update private.import_analysis_jobs as jobs
  set lease_expires_at = pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
  where jobs.public_id = p_job_public_id
    and jobs.state = 'leased'
    and jobs.lease_owner = p_worker_id
    and jobs.lease_token = p_lease_token
    and jobs.lease_expires_at > pg_catalog.statement_timestamp()
  returning jobs.lease_expires_at into v_new_expiry;
  if not found then raise exception 'import analysis lease unavailable' using errcode = '42501'; end if;
  return v_new_expiry;
end
$function$;

create function analysis_worker_adapter.complete_import_analysis_job(
  p_job_public_id text,
  p_worker_id text,
  p_lease_token uuid,
  p_worker_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job private.import_analysis_jobs%rowtype;
  v_version private.managed_skill_versions%rowtype;
  v_release private.managed_skill_releases%rowtype;
  v_session private.import_sessions%rowtype;
  v_manifest_text text;
  v_manifest jsonb;
  v_content_files jsonb;
  v_manifest_files jsonb;
  v_file_count bigint;
  v_byte_total bigint;
  v_result_digest text;
begin
  if p_worker_version is distinct from 'skillmap-import-analysis/0.1.0' then
    raise exception 'invalid import analysis result' using errcode = '22023';
  end if;

  select jobs.* into v_job
  from private.import_analysis_jobs as jobs
  where jobs.public_id = p_job_public_id
    and jobs.state = 'leased'
    and jobs.lease_owner = p_worker_id
    and jobs.lease_token = p_lease_token
    and jobs.lease_expires_at > pg_catalog.statement_timestamp()
  for update;
  if not found then raise exception 'import analysis lease unavailable' using errcode = '42501'; end if;

  select versions.* into v_version
  from private.managed_skill_versions as versions
  where versions.account_id = v_job.account_id
    and versions.managed_skill_id = v_job.managed_skill_id
    and versions.id = v_job.version_id
  for update;
  if not found or v_version.analysis_state <> 'pending' then
    raise exception 'import analysis target is not pending' using errcode = '22023';
  end if;

  select releases.* into v_release
  from private.managed_skill_releases as releases
  where releases.account_id = v_job.account_id
    and releases.managed_skill_id = v_job.managed_skill_id
    and releases.version_id = v_job.version_id
  for update;
  if not found or v_release.lifecycle_state <> 'needs-review' or v_release.revoked_at is not null then
    raise exception 'import analysis target is not reviewable' using errcode = '42501';
  end if;

  begin
    v_manifest_text := pg_catalog.convert_from(v_version.manifest_projection, 'UTF8');
    v_manifest := v_manifest_text::jsonb;
  exception when others then
    raise exception 'import analysis manifest is invalid' using errcode = '22023';
  end;

  if private.canonical_managed_import_manifest(v_manifest) <> v_manifest_text
    or v_version.manifest_digest <> 'sha256:' || pg_catalog.encode(
      extensions.digest(v_version.manifest_projection, 'sha256'), 'hex'
    )
  then
    raise exception 'import analysis manifest is invalid' using errcode = '22023';
  end if;

  select
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'relative_path', files.relative_path,
        'media_type', files.media_type,
        'byte_size', files.byte_size,
        'file_digest', files.file_digest,
        'executable', files.executable,
        'ordinal', files.ordinal
      ) order by pg_catalog.convert_to(files.relative_path, 'UTF8')
    ), '[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'path', files.relative_path,
        'media_type', files.media_type,
        'utf8_bytes', files.byte_size,
        'digest', files.file_digest,
        'executable', files.executable
      ) order by pg_catalog.convert_to(files.relative_path, 'UTF8')
    ), '[]'::jsonb),
    count(*),
    coalesce(sum(files.byte_size), 0)::bigint
  into v_content_files, v_manifest_files, v_file_count, v_byte_total
  from private.managed_skill_files as files
  where files.account_id = v_job.account_id
    and files.managed_skill_id = v_job.managed_skill_id
    and files.version_id = v_job.version_id;

  if v_file_count not between 1 and 2048
    or v_byte_total > 67108864
    or v_manifest -> 'files' <> v_manifest_files
    or private.compute_import_content_digest(v_version.manifest_digest, v_content_files) <> v_version.content_digest
  then
    raise exception 'import analysis content binding is invalid' using errcode = '22023';
  end if;

  select sessions.* into v_session
  from private.import_sessions as sessions
  join private.import_finalization_receipts as finalizations
    on finalizations.account_id = sessions.account_id
   and finalizations.device_id = sessions.device_id
   and finalizations.session_id = sessions.id
  where sessions.account_id = v_job.account_id
    and sessions.managed_skill_id = v_job.managed_skill_id
    and sessions.version_id = v_job.version_id
    and sessions.state = 'verified'
    and sessions.manifest_digest = v_version.manifest_digest
    and sessions.content_digest = v_version.content_digest
  order by finalizations.created_at desc
  limit 1;

  if not found
    or v_session.expected_file_count <> v_file_count
    or v_session.expected_byte_total <> v_byte_total
    or v_session.accepted_file_count <> v_file_count
    or v_session.accepted_byte_total <> v_byte_total
    or exists (
      select 1
      from private.managed_skill_files as files
      left join private.import_file_receipts as receipts
        on receipts.account_id = files.account_id
       and receipts.session_id = v_session.id
       and receipts.file_id = files.id
       and receipts.relative_path = files.relative_path
       and receipts.accepted_byte_size = files.byte_size
       and receipts.file_digest = files.file_digest
       and receipts.ordinal = files.ordinal
      left join storage.objects as objects
        on objects.bucket_id = 'skill-vault-private'
       and objects.name = files.storage_key
      where files.account_id = v_job.account_id
        and files.managed_skill_id = v_job.managed_skill_id
        and files.version_id = v_job.version_id
        and (receipts.id is null or objects.id is null)
    )
  then
    raise exception 'import analysis stored content is incomplete' using errcode = '22023';
  end if;

  v_result_digest := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'SKILLMAP-IMPORT-ANALYSIS-RESULT-V2' || pg_catalog.chr(10) ||
    v_job.public_id || pg_catalog.chr(10) ||
    v_version.public_id || pg_catalog.chr(10) ||
    v_version.manifest_digest || pg_catalog.chr(10) ||
    v_version.content_digest || pg_catalog.chr(10) ||
    v_file_count::text || pg_catalog.chr(10) ||
    v_byte_total::text || pg_catalog.chr(10) ||
    'passed' || pg_catalog.chr(10) ||
    p_worker_version || pg_catalog.chr(10),
    'UTF8'
  ), 'sha256'), 'hex');

  update private.managed_skill_versions as versions
  set analysis_state = 'passed'
  where versions.id = v_version.id;

  update private.import_analysis_jobs as jobs
  set
    state = 'completed',
    result_digest = v_result_digest,
    completed_at = pg_catalog.statement_timestamp(),
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = null
  where jobs.id = v_job.id
  returning jobs.* into v_job;
  return pg_catalog.jsonb_build_object(
    'job_public_id', v_job.public_id,
    'state', v_job.state,
    'analysis_state', 'passed',
    'result_digest', v_job.result_digest,
    'completed_at', v_job.completed_at
  );
end
$function$;

create or replace function private.enforce_managed_skill_version_immutability()
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
      or new.created_at is distinct from old.created_at
      or (
        new.analysis_state is distinct from old.analysis_state
        and not (old.analysis_state = 'pending' and new.analysis_state = 'passed')
      )
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill version immutable fields are immutable';
    end if;
  end if;
  if tg_op = 'INSERT' then new.created_at := pg_catalog.statement_timestamp(); end if;
  return new;
end
$function$;

create function analysis_worker_adapter.fail_import_analysis_job(
  p_job_public_id text,
  p_worker_id text,
  p_lease_token uuid,
  p_error_code text,
  p_retry_delay_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job private.import_analysis_jobs%rowtype;
begin
  if p_error_code is null
    or pg_catalog.octet_length(p_error_code) not between 1 and 64
    or p_error_code !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    or p_retry_delay_seconds not between 0 and 3600
  then
    raise exception 'invalid import analysis failure' using errcode = '22023';
  end if;

  update private.import_analysis_jobs as jobs
  set
    state = case when jobs.attempt_count >= jobs.max_attempts then 'dead_lettered' else 'queued' end,
    available_at = case
      when jobs.attempt_count >= jobs.max_attempts then jobs.available_at
      else pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => p_retry_delay_seconds)
    end,
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = p_error_code
  where jobs.public_id = p_job_public_id
    and jobs.state = 'leased'
    and jobs.lease_owner = p_worker_id
    and jobs.lease_token = p_lease_token
    and jobs.lease_expires_at > pg_catalog.statement_timestamp()
  returning jobs.* into v_job;
  if not found then raise exception 'import analysis lease unavailable' using errcode = '42501'; end if;

  return pg_catalog.jsonb_build_object(
    'job_public_id', v_job.public_id,
    'state', v_job.state,
    'attempt_count', v_job.attempt_count,
    'max_attempts', v_job.max_attempts,
    'available_at', v_job.available_at,
    'last_error_code', v_job.last_error_code
  );
end
$function$;

revoke all privileges on function private.enforce_import_analysis_job_binding()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enqueue_import_analysis_job(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enqueue_import_analysis_job_from_finalization()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function analysis_worker_adapter.claim_import_analysis_jobs(text,integer,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function analysis_worker_adapter.renew_import_analysis_job(text,text,uuid,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function analysis_worker_adapter.complete_import_analysis_job(text,text,uuid,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function analysis_worker_adapter.fail_import_analysis_job(text,text,uuid,text,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

grant execute on function analysis_worker_adapter.claim_import_analysis_jobs(text,integer,integer)
  to service_role;
grant execute on function analysis_worker_adapter.renew_import_analysis_job(text,text,uuid,integer)
  to service_role;
grant execute on function analysis_worker_adapter.complete_import_analysis_job(text,text,uuid,text)
  to service_role;
grant execute on function analysis_worker_adapter.fail_import_analysis_job(text,text,uuid,text,integer)
  to service_role;

comment on table private.import_analysis_jobs is
  'One bounded, idempotent analysis job for each finalized managed skill version; failures never activate a release.';
comment on function analysis_worker_adapter.claim_import_analysis_jobs(text,integer,integer) is
  'Claims bounded immutable-version analysis jobs using expiring worker-specific leases.';

-- PostgREST must expose the service-role-only worker adapter before the worker
-- can reach its explicitly granted RPCs. Browser roles retain no execute grants.
alter role authenticator set pgrst.db_schemas =
  'public, graphql_public, api, device_adapter, analysis_worker_adapter';
notify pgrst, 'reload config';

commit;
