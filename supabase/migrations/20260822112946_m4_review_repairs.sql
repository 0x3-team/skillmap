begin;

set local search_path = '';

-- Keep future adapter functions closed by default. Individual functions must
-- still receive an explicit, reviewed grant after creation.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

-- Signed upload tokens minted by the trusted server use the service role and
-- therefore create an unowned Storage row. Admit only that exact shape for a
-- file that already belongs to an immutable prepared import target. All other
-- metadata, key, size, and media bindings continue through the original
-- validator. Browser-facing owner policies remain owner-only.
create function private.skill_vault_unowned_import_object_binding_is_valid(
  p_bucket_id text,
  p_object_name text,
  p_owner uuid,
  p_owner_id text,
  p_metadata jsonb,
  p_user_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select private.skill_vault_storage_object_binding_is_valid(
      p_bucket_id,
      p_object_name,
      preparations.account_id,
      preparations.account_id::text,
      p_metadata,
      p_user_metadata
    )
    from private.import_target_preparations as preparations
    join private.managed_skill_files as files
      on files.account_id = preparations.account_id
     and files.managed_skill_id = preparations.managed_skill_id
     and files.version_id = preparations.version_id
     and files.storage_key = p_object_name
    where p_bucket_id = 'skill-vault-private'
      and p_owner is null
      and p_owner_id is null
    limit 1
  ), false);
$function$;

revoke all privileges on function private.skill_vault_unowned_import_object_binding_is_valid(
  text,text,uuid,text,jsonb,jsonb
) from public, anon, authenticated, service_role, skillmap_vault_definer;

create or replace function private.enforce_skill_vault_storage_object_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
    and old.bucket_id = 'skill-vault-private'
    and (
      new.id is distinct from old.id
      or new.bucket_id is distinct from old.bucket_id
      or new.name is distinct from old.name
      or new.owner is distinct from old.owner
      or new.owner_id is distinct from old.owner_id
      or new.created_at is distinct from old.created_at
    )
  then
    raise exception using
      errcode = '22023',
      message = 'skill-vault-private object identity and ownership are immutable';
  end if;

  if new.bucket_id = 'skill-vault-private'
    and not (
      coalesce(private.skill_vault_storage_object_binding_is_valid(
        new.bucket_id, new.name, new.owner, new.owner_id,
        new.metadata, new.user_metadata
      ), false)
      or coalesce(private.skill_vault_unowned_import_object_binding_is_valid(
        new.bucket_id, new.name, new.owner, new.owner_id,
        new.metadata, new.user_metadata
      ), false)
    )
  then
    raise exception using
      errcode = 'check_violation',
      message = 'skill-vault-private object is not bound to one immutable managed file';
  end if;

  return new;
end
$function$;

revoke all privileges on function private.enforce_skill_vault_storage_object_binding()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Expose the policy-relevant file projection to the trusted web boundary and
-- prevent a new signed upload while exact-object cleanup is active.
create or replace function device_adapter.adapter_prepare_import_upload(
  p_account_public_id text,
  p_device_public_id text,
  p_session_public_id text,
  p_expected_session_revision bigint,
  p_file_public_id text,
  p_expires_at timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session private.import_sessions%rowtype;
  v_file private.managed_skill_files%rowtype;
  v_version_public_id text;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);
  if not found then raise exception 'import authority unavailable' using errcode = '42501'; end if;
  if p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + interval '2 hours' then
    raise exception 'invalid import upload expiry' using errcode = '22023';
  end if;

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.imp_ = p_session_public_id
  for update;
  if not found then raise exception 'import authority unavailable' using errcode = '42501'; end if;
  if v_session.revision <> p_expected_session_revision or v_session.state <> 'in_progress' then
    raise exception 'import session revision conflict' using errcode = '40001';
  end if;
  if v_session.expiry_at <= v_now then raise exception 'import session expired' using errcode = '22023'; end if;

  select files.* into v_file
  from private.managed_skill_files as files
  where files.account_id = v_context.account_id
    and files.managed_skill_id = v_session.managed_skill_id
    and files.version_id = v_session.version_id
    and files.public_id = p_file_public_id;
  if not found then raise exception 'import authority unavailable' using errcode = '42501'; end if;

  select versions.public_id into strict v_version_public_id
  from private.managed_skill_versions as versions
  where versions.account_id = v_file.account_id
    and versions.managed_skill_id = v_file.managed_skill_id
    and versions.id = v_file.version_id;
  if v_file.storage_key <> ('v1/' || v_version_public_id || '/' || v_file.public_id) then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.import_file_receipts as receipts
    where receipts.account_id = v_context.account_id
      and receipts.session_id = v_session.id
      and receipts.file_id = v_file.id
  ) then
    raise exception 'import file is already accepted' using errcode = '22023';
  end if;
  if exists (
    select 1
    from private.skill_vault_incomplete_upload_cleanup as cleanup
    where cleanup.bucket_id = 'skill-vault-private'
      and cleanup.object_name = v_file.storage_key
      and cleanup.state <> 'completed'
  ) then
    raise exception 'import upload cleanup conflict' using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'session_id', v_session.imp_,
    'session_revision', v_session.revision,
    'file_public_id', v_file.public_id,
    'version_public_id', v_version_public_id,
    'bucket_id', 'skill-vault-private',
    'object_name', v_file.storage_key,
    'purpose', 'upload',
    'expires_at', p_expires_at,
    'relative_path', v_file.relative_path,
    'content_type', v_file.media_type,
    'declared_size', v_file.byte_size,
    'file_digest', v_file.file_digest,
    'executable', v_file.executable,
    'ordinal', v_file.ordinal
  );
end
$function$;

revoke all privileges on function device_adapter.adapter_prepare_import_upload(
  text,text,text,bigint,text,timestamp with time zone
) from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function device_adapter.adapter_prepare_import_upload(
  text,text,text,bigint,text,timestamp with time zone
) to service_role;

create function private.reject_import_receipt_during_upload_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from private.managed_skill_files as files
    join private.skill_vault_incomplete_upload_cleanup as cleanup
      on cleanup.bucket_id = 'skill-vault-private'
     and cleanup.object_name = files.storage_key
     and cleanup.state <> 'completed'
    where files.account_id = new.account_id
      and files.id = new.file_id
  ) then
    raise exception 'import upload cleanup conflict' using errcode = '40001';
  end if;
  return new;
end
$function$;

revoke all privileges on function private.reject_import_receipt_during_upload_cleanup()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create trigger import_file_receipts_reject_active_cleanup
before insert on private.import_file_receipts
for each row execute function private.reject_import_receipt_during_upload_cleanup();

create table private.import_file_policy_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null,
  device_id uuid not null,
  session_id uuid not null,
  file_id uuid not null,
  managed_skill_id uuid not null,
  version_id uuid not null,
  policy_digest text not null,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  constraint import_file_policy_receipts_session_file_key unique (account_id,session_id,file_id),
  constraint import_file_policy_receipts_session_fkey
    foreign key (account_id,device_id,session_id)
    references private.import_sessions (account_id,device_id,id) on delete cascade,
  constraint import_file_policy_receipts_file_fkey
    foreign key (account_id,managed_skill_id,version_id,file_id)
    references private.managed_skill_files (account_id,managed_skill_id,version_id,id) on delete cascade,
  constraint import_file_policy_receipts_digest_check
    check (policy_digest ~ '^sha256:[0-9a-f]{64}$')
);

alter table private.import_file_policy_receipts enable row level security;
alter table private.import_file_policy_receipts force row level security;
revoke all privileges on table private.import_file_policy_receipts
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.compute_hosted_import_policy_digest(
  p_relative_path text,
  p_media_type text,
  p_byte_size bigint,
  p_file_digest text
)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'SKILLMAP-HOSTED-IMPORT-POLICY-V1' || pg_catalog.chr(10) ||
    p_relative_path || pg_catalog.chr(10) ||
    p_media_type || pg_catalog.chr(10) ||
    p_byte_size::text || pg_catalog.chr(10) ||
    p_file_digest || pg_catalog.chr(10) ||
    'allowed' || pg_catalog.chr(10),
    'UTF8'
  ), 'sha256'), 'hex');
$function$;

revoke all privileges on function private.compute_hosted_import_policy_digest(text,text,bigint,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function device_adapter.adapter_accept_scanned_import_file_v2(
  p_account_public_id text,
  p_device_public_id text,
  p_session_public_id text,
  p_expected_session_revision bigint,
  p_file_public_id text,
  p_verified_file_digest text,
  p_verified_byte_size bigint,
  p_policy_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session private.import_sessions%rowtype;
  v_file private.managed_skill_files%rowtype;
  v_expected_policy_digest text;
  v_existing_digest text;
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id,p_device_public_id);
  if not found then raise exception 'import authority unavailable' using errcode='42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_context.account_id::text,4)
  );

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id=v_context.account_id
    and sessions.device_id=v_context.device_id
    and sessions.imp_=p_session_public_id
  for update;
  if not found then raise exception 'import authority unavailable' using errcode='42501'; end if;
  if v_session.revision<>p_expected_session_revision or v_session.state<>'in_progress' then
    raise exception 'import session revision conflict' using errcode='40001';
  end if;
  if v_session.expiry_at<=pg_catalog.statement_timestamp() then
    raise exception 'import session expired' using errcode='22023';
  end if;

  select files.* into v_file
  from private.managed_skill_files as files
  where files.account_id=v_context.account_id
    and files.managed_skill_id=v_session.managed_skill_id
    and files.version_id=v_session.version_id
    and files.public_id=p_file_public_id;
  if not found then raise exception 'import authority unavailable' using errcode='42501'; end if;

  v_expected_policy_digest := private.compute_hosted_import_policy_digest(
    v_file.relative_path,v_file.media_type,v_file.byte_size,v_file.file_digest
  );
  if p_policy_digest is distinct from v_expected_policy_digest
    or p_verified_file_digest is distinct from v_file.file_digest
    or p_verified_byte_size is distinct from v_file.byte_size
    or v_file.executable
  then
    raise exception 'invalid hosted import policy receipt' using errcode='22023';
  end if;

  if not exists (
    select 1
    from storage.objects as objects
    where objects.bucket_id='skill-vault-private'
      and objects.name=v_file.storage_key
      and (
        private.skill_vault_storage_object_binding_is_valid(
          objects.bucket_id,objects.name,objects.owner,objects.owner_id,
          objects.metadata,objects.user_metadata
        )
        or private.skill_vault_unowned_import_object_binding_is_valid(
          objects.bucket_id,objects.name,objects.owner,objects.owner_id,
          objects.metadata,objects.user_metadata
        )
      )
  ) then
    raise exception 'uploaded object does not match the immutable file binding' using errcode='22023';
  end if;

  insert into private.import_file_policy_receipts(
    account_id,device_id,session_id,file_id,managed_skill_id,version_id,policy_digest
  ) values (
    v_context.account_id,v_context.device_id,v_session.id,v_file.id,
    v_file.managed_skill_id,v_file.version_id,p_policy_digest
  ) on conflict on constraint import_file_policy_receipts_session_file_key do nothing;

  select receipts.policy_digest into v_existing_digest
  from private.import_file_policy_receipts as receipts
  where receipts.account_id=v_context.account_id
    and receipts.session_id=v_session.id
    and receipts.file_id=v_file.id;
  if v_existing_digest is distinct from p_policy_digest then
    raise exception 'conflicting hosted import policy receipt' using errcode='22023';
  end if;

  perform private.accept_import_file(
    v_context.account_id,v_context.device_id,v_session.id,v_file.id
  );

  select sessions.* into strict v_session
  from private.import_sessions as sessions
  where sessions.account_id=v_context.account_id
    and sessions.device_id=v_context.device_id
    and sessions.id=v_session.id;

  return pg_catalog.jsonb_build_object(
    'session_id',v_session.imp_,
    'state',v_session.state,
    'revision',v_session.revision,
    'expected_file_count',v_session.expected_file_count,
    'accepted_file_count',v_session.accepted_file_count,
    'expected_byte_total',v_session.expected_byte_total,
    'accepted_byte_total',v_session.accepted_byte_total,
    'expiry_at',v_session.expiry_at,
    'manifest_digest',v_session.manifest_digest,
    'content_digest',v_session.content_digest,
    'verification_digest',v_session.verification_digest
  );
end
$function$;

revoke execute on function device_adapter.adapter_accept_import_file_v2(
  text,text,text,bigint,text,text,bigint
) from service_role;
revoke all privileges on function device_adapter.adapter_accept_scanned_import_file_v2(
  text,text,text,bigint,text,text,bigint,text
) from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function device_adapter.adapter_accept_scanned_import_file_v2(
  text,text,text,bigint,text,text,bigint,text
) to service_role;

create function analysis_worker_adapter.inspect_import_analysis_job(
  p_job_public_id text,
  p_worker_id text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job private.import_analysis_jobs%rowtype;
  v_version private.managed_skill_versions%rowtype;
  v_session_id uuid;
  v_file_count integer;
  v_policy_count integer;
  v_policy_chain text;
  v_analysis_digest text;
begin
  select jobs.* into v_job
  from private.import_analysis_jobs as jobs
  where jobs.public_id=p_job_public_id
    and jobs.state='leased'
    and jobs.lease_owner=p_worker_id
    and jobs.lease_token=p_lease_token
    and jobs.lease_expires_at>pg_catalog.statement_timestamp();
  if not found then raise exception 'import analysis lease unavailable' using errcode='42501'; end if;

  select versions.* into strict v_version
  from private.managed_skill_versions as versions
  where versions.account_id=v_job.account_id
    and versions.managed_skill_id=v_job.managed_skill_id
    and versions.id=v_job.version_id
    and versions.analysis_state='pending';

  select sessions.id into v_session_id
  from private.import_finalization_receipts as finalizations
  join private.import_sessions as sessions
    on sessions.account_id=finalizations.account_id
   and sessions.device_id=finalizations.device_id
   and sessions.id=finalizations.session_id
  where sessions.account_id=v_job.account_id
    and sessions.managed_skill_id=v_job.managed_skill_id
    and sessions.version_id=v_job.version_id
    and sessions.state='verified'
    and sessions.manifest_digest=v_version.manifest_digest
    and sessions.content_digest=v_version.content_digest
  order by finalizations.created_at desc,finalizations.id
  limit 1;
  if not found then raise exception 'import analysis policy evidence is incomplete' using errcode='22023'; end if;

  select count(*)::integer into v_file_count
  from private.managed_skill_files as files
  where files.account_id=v_job.account_id
    and files.managed_skill_id=v_job.managed_skill_id
    and files.version_id=v_job.version_id;

  select count(*)::integer,
    pg_catalog.string_agg(policy.policy_digest,pg_catalog.chr(10) order by files.ordinal)
  into v_policy_count,v_policy_chain
  from private.managed_skill_files as files
  join private.import_file_receipts as accepted
    on accepted.account_id=files.account_id
   and accepted.session_id=v_session_id
   and accepted.file_id=files.id
   and accepted.file_digest=files.file_digest
   and accepted.accepted_byte_size=files.byte_size
  join private.import_file_policy_receipts as policy
    on policy.account_id=files.account_id
   and policy.session_id=v_session_id
   and policy.file_id=files.id
   and policy.managed_skill_id=files.managed_skill_id
   and policy.version_id=files.version_id
   and policy.policy_digest=private.compute_hosted_import_policy_digest(
     files.relative_path,files.media_type,files.byte_size,files.file_digest
   )
  where files.account_id=v_job.account_id
    and files.managed_skill_id=v_job.managed_skill_id
    and files.version_id=v_job.version_id;

  if v_file_count<1 or v_policy_count<>v_file_count then
    raise exception 'import analysis policy evidence is incomplete' using errcode='22023';
  end if;

  v_analysis_digest := 'sha256:' || pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'SKILLMAP-IMPORT-ANALYSIS-EVIDENCE-V1' || pg_catalog.chr(10) ||
    v_job.public_id || pg_catalog.chr(10) ||
    v_version.public_id || pg_catalog.chr(10) ||
    v_version.manifest_digest || pg_catalog.chr(10) ||
    v_version.content_digest || pg_catalog.chr(10) ||
    v_file_count::text || pg_catalog.chr(10) ||
    v_policy_chain || pg_catalog.chr(10),
    'UTF8'
  ),'sha256'),'hex');

  return pg_catalog.jsonb_build_object(
    'job_public_id',v_job.public_id,
    'version_public_id',v_version.public_id,
    'file_count',v_file_count,
    'analysis_digest',v_analysis_digest
  );
end
$function$;

create function analysis_worker_adapter.complete_verified_import_analysis_job(
  p_job_public_id text,
  p_worker_id text,
  p_lease_token uuid,
  p_analysis_digest text,
  p_worker_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_analysis jsonb;
begin
  v_analysis := analysis_worker_adapter.inspect_import_analysis_job(
    p_job_public_id,p_worker_id,p_lease_token
  );
  if p_analysis_digest is distinct from v_analysis->>'analysis_digest' then
    raise exception 'invalid import analysis digest' using errcode='22023';
  end if;
  return analysis_worker_adapter.complete_import_analysis_job(
    p_job_public_id,p_worker_id,p_lease_token,p_worker_version
  );
end
$function$;

revoke all privileges on function analysis_worker_adapter.inspect_import_analysis_job(text,text,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function analysis_worker_adapter.complete_verified_import_analysis_job(text,text,uuid,text,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke execute on function analysis_worker_adapter.complete_import_analysis_job(text,text,uuid,text)
  from service_role;
grant execute on function analysis_worker_adapter.inspect_import_analysis_job(text,text,uuid)
  to service_role;
grant execute on function analysis_worker_adapter.complete_verified_import_analysis_job(text,text,uuid,text,text)
  to service_role;

-- Upgrade the cleanup queue from a permanent claim bit to an exact expiring
-- lease with bounded terminal exhaustion.
alter table private.skill_vault_incomplete_upload_cleanup
  add column max_attempts integer not null default 10,
  add column lease_token uuid,
  add column lease_expires_at timestamp with time zone;

alter table private.skill_vault_incomplete_upload_cleanup
  drop constraint skill_vault_cleanup_state_check,
  drop constraint skill_vault_cleanup_timestamp_state_check;

alter table private.skill_vault_incomplete_upload_cleanup
  add constraint skill_vault_cleanup_max_attempts_check
    check (max_attempts between 1 and 1000 and attempt_count between 0 and max_attempts),
  add constraint skill_vault_cleanup_state_check
    check (state in ('queued', 'claimed', 'completed', 'dead_lettered')),
  add constraint skill_vault_cleanup_timestamp_state_check
    check (
      (state = 'queued' and claimed_at is null and completed_at is null and lease_token is null and lease_expires_at is null)
      or (state = 'claimed' and claimed_at is not null and completed_at is null and lease_token is not null and lease_expires_at is not null and lease_expires_at > claimed_at)
      or (state = 'completed' and claimed_at is not null and completed_at is not null and completed_at >= claimed_at and lease_token is null and lease_expires_at is null)
      or (state = 'dead_lettered' and claimed_at is null and completed_at is null and lease_token is null and lease_expires_at is null)
    );

drop index private.skill_vault_cleanup_claim_idx;
create index skill_vault_cleanup_claim_idx
  on private.skill_vault_incomplete_upload_cleanup (available_at, id)
  where state in ('queued', 'claimed');

create or replace function private.enqueue_skill_vault_incomplete_upload_cleanup(
  p_bucket_id text,
  p_object_name text,
  p_cleanup_reason text
)
returns table (
  job_id uuid,
  bucket_id text,
  object_name text,
  cleanup_reason text,
  state text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_id uuid;
begin
  if p_bucket_id is distinct from 'skill-vault-private'
    or p_object_name is null
    or pg_catalog.octet_length(p_object_name) not between 1 and 512
    or p_object_name ~ '[[:cntrl:]]'
    or p_object_name !~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
    or p_cleanup_reason is null
    or pg_catalog.octet_length(p_cleanup_reason) not between 1 and 64
    or p_cleanup_reason !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  then
    raise exception using errcode = 'check_violation', message = 'invalid exact Skill Vault cleanup target';
  end if;

  if not exists (
    select 1
    from private.managed_skill_files as files
    join private.managed_skill_versions as versions
      on versions.account_id = files.account_id
     and versions.managed_skill_id = files.managed_skill_id
     and versions.id = files.version_id
    where files.storage_key = p_object_name
      and p_object_name = 'v1/' || versions.public_id || '/' || files.public_id
  ) then
    raise exception using errcode = '23514', message = 'cleanup target is not bound to one immutable managed file';
  end if;

  insert into private.skill_vault_incomplete_upload_cleanup (
    bucket_id, object_name, cleanup_reason
  ) values (p_bucket_id, p_object_name, p_cleanup_reason)
  on conflict on constraint skill_vault_cleanup_idempotency_key do nothing
  returning id into v_job_id;

  if v_job_id is null then
    update private.skill_vault_incomplete_upload_cleanup as cleanup
    set state = 'queued',
        attempt_count = 0,
        available_at = pg_catalog.statement_timestamp(),
        claimed_at = null,
        completed_at = null,
        lease_token = null,
        lease_expires_at = null,
        updated_at = pg_catalog.statement_timestamp()
    where cleanup.bucket_id = p_bucket_id
      and cleanup.object_name = p_object_name
      and cleanup.cleanup_reason = p_cleanup_reason
      and cleanup.state = 'completed'
    returning cleanup.id into v_job_id;
  end if;
  if v_job_id is null then
    select cleanup.id into v_job_id
    from private.skill_vault_incomplete_upload_cleanup as cleanup
    where cleanup.bucket_id = p_bucket_id
      and cleanup.object_name = p_object_name
      and cleanup.cleanup_reason = p_cleanup_reason;
  end if;

  return query
  select cleanup.id, cleanup.bucket_id, cleanup.object_name, cleanup.cleanup_reason, cleanup.state
  from private.skill_vault_incomplete_upload_cleanup as cleanup
  where cleanup.id = v_job_id;
end
$function$;

revoke all privileges on function storage_worker_adapter.claim_import_upload_cleanup(integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function storage_worker_adapter.complete_import_upload_cleanup(uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function storage_worker_adapter.fail_import_upload_cleanup(uuid,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
drop function storage_worker_adapter.claim_import_upload_cleanup(integer);
drop function storage_worker_adapter.complete_import_upload_cleanup(uuid);
drop function storage_worker_adapter.fail_import_upload_cleanup(uuid,integer);
drop function private.claim_skill_vault_incomplete_upload_cleanup(integer);
drop function private.complete_skill_vault_incomplete_upload_cleanup(uuid);
drop function private.fail_skill_vault_incomplete_upload_cleanup(uuid,integer);

create function private.claim_skill_vault_incomplete_upload_cleanup(
  p_limit integer default 32,
  p_lease_seconds integer default 60
)
returns table (
  job_id uuid,
  bucket_id text,
  object_name text,
  cleanup_reason text,
  attempt_count integer,
  claimed_at timestamp with time zone,
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
  if p_limit is null or p_limit not between 1 and 64 then
    raise exception 'cleanup claim limit must be between 1 and 64' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then
    raise exception 'cleanup lease must be between 15 and 300 seconds' using errcode = '22023';
  end if;

  update private.skill_vault_incomplete_upload_cleanup as cleanup
  set state = 'dead_lettered',
      claimed_at = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where cleanup.attempt_count >= cleanup.max_attempts
    and (
      cleanup.state = 'queued'
      or (cleanup.state = 'claimed' and cleanup.lease_expires_at <= v_now)
    );

  return query
  with candidates as (
    select cleanup.id
    from private.skill_vault_incomplete_upload_cleanup as cleanup
    where cleanup.attempt_count < cleanup.max_attempts
      and (
        (cleanup.state = 'queued' and cleanup.available_at <= v_now)
        or (cleanup.state = 'claimed' and cleanup.lease_expires_at <= v_now)
      )
    order by cleanup.available_at, cleanup.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.skill_vault_incomplete_upload_cleanup as cleanup
    set state = 'claimed',
        attempt_count = cleanup.attempt_count + 1,
        claimed_at = v_now,
        lease_token = pg_catalog.gen_random_uuid(),
        lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = v_now
    from candidates
    where cleanup.id = candidates.id
    returning cleanup.id, cleanup.bucket_id, cleanup.object_name,
      cleanup.cleanup_reason, cleanup.attempt_count, cleanup.claimed_at,
      cleanup.lease_token, cleanup.lease_expires_at
  )
  select claimed.id, claimed.bucket_id, claimed.object_name, claimed.cleanup_reason,
    claimed.attempt_count, claimed.claimed_at, claimed.lease_token, claimed.lease_expires_at
  from claimed;
end
$function$;

create function private.complete_skill_vault_incomplete_upload_cleanup(
  p_job_id uuid,
  p_lease_token uuid
)
returns table (job_id uuid, state text, completed_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update private.skill_vault_incomplete_upload_cleanup as cleanup
  set state = 'completed',
      completed_at = pg_catalog.statement_timestamp(),
      lease_token = null,
      lease_expires_at = null,
      updated_at = pg_catalog.statement_timestamp()
  where cleanup.id = p_job_id
    and cleanup.state = 'claimed'
    and cleanup.lease_token = p_lease_token
    and cleanup.lease_expires_at > pg_catalog.statement_timestamp();
  if not found then raise exception 'cleanup claim unavailable' using errcode = '42501'; end if;
  return query select cleanup.id, cleanup.state, cleanup.completed_at
  from private.skill_vault_incomplete_upload_cleanup as cleanup
  where cleanup.id = p_job_id;
end
$function$;

create function private.fail_skill_vault_incomplete_upload_cleanup(
  p_job_id uuid,
  p_lease_token uuid,
  p_retry_delay_seconds integer default 30
)
returns table (job_id uuid, state text, attempt_count integer, available_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_retry_delay_seconds is null or p_retry_delay_seconds not between 0 and 3600 then
    raise exception 'cleanup retry delay must be between 0 and 3600 seconds' using errcode = '22023';
  end if;
  update private.skill_vault_incomplete_upload_cleanup as cleanup
  set state = case when cleanup.attempt_count >= cleanup.max_attempts then 'dead_lettered' else 'queued' end,
      available_at = case
        when cleanup.attempt_count >= cleanup.max_attempts then cleanup.available_at
        else pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => p_retry_delay_seconds)
      end,
      claimed_at = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = pg_catalog.statement_timestamp()
  where cleanup.id = p_job_id
    and cleanup.state = 'claimed'
    and cleanup.lease_token = p_lease_token
    and cleanup.lease_expires_at > pg_catalog.statement_timestamp();
  if not found then raise exception 'cleanup claim unavailable' using errcode = '42501'; end if;
  return query select cleanup.id, cleanup.state, cleanup.attempt_count, cleanup.available_at
  from private.skill_vault_incomplete_upload_cleanup as cleanup
  where cleanup.id = p_job_id;
end
$function$;

create function storage_worker_adapter.claim_import_upload_cleanup(
  p_limit integer default 8,
  p_lease_seconds integer default 60
)
returns table (
  job_id uuid,
  bucket_id text,
  object_name text,
  cleanup_reason text,
  attempt_count integer,
  claimed_at timestamp with time zone,
  lease_token uuid,
  lease_expires_at timestamp with time zone
)
language sql
security definer
set search_path = ''
as $function$
  select * from private.claim_skill_vault_incomplete_upload_cleanup(p_limit, p_lease_seconds);
$function$;

create function storage_worker_adapter.complete_import_upload_cleanup(p_job_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_result record;
begin
  select * into v_result from private.complete_skill_vault_incomplete_upload_cleanup(p_job_id, p_lease_token);
  return pg_catalog.jsonb_build_object(
    'job_id', v_result.job_id,
    'state', v_result.state,
    'completed_at', v_result.completed_at
  );
end
$function$;

create function storage_worker_adapter.fail_import_upload_cleanup(
  p_job_id uuid,
  p_lease_token uuid,
  p_retry_delay_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_result record;
begin
  select * into v_result
  from private.fail_skill_vault_incomplete_upload_cleanup(p_job_id, p_lease_token, p_retry_delay_seconds);
  return pg_catalog.jsonb_build_object(
    'job_id', v_result.job_id,
    'state', v_result.state,
    'attempt_count', v_result.attempt_count,
    'available_at', v_result.available_at
  );
end
$function$;

revoke all privileges on function private.claim_skill_vault_incomplete_upload_cleanup(integer,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.complete_skill_vault_incomplete_upload_cleanup(uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.fail_skill_vault_incomplete_upload_cleanup(uuid,uuid,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function storage_worker_adapter.claim_import_upload_cleanup(integer,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function storage_worker_adapter.complete_import_upload_cleanup(uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function storage_worker_adapter.fail_import_upload_cleanup(uuid,uuid,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

grant execute on function storage_worker_adapter.claim_import_upload_cleanup(integer,integer) to service_role;
grant execute on function storage_worker_adapter.complete_import_upload_cleanup(uuid,uuid) to service_role;
grant execute on function storage_worker_adapter.fail_import_upload_cleanup(uuid,uuid,integer) to service_role;

comment on function private.skill_vault_unowned_import_object_binding_is_valid(text,text,uuid,text,jsonb,jsonb) is
  'Internal exact import-target exception for service-role signed uploads that create an unowned Storage row.';
comment on function storage_worker_adapter.claim_import_upload_cleanup(integer,integer) is
  'Claims one bounded exact-object cleanup lease and reclaims only expired leases.';

commit;
