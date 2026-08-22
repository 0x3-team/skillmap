begin;

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

  return pg_catalog.jsonb_build_object(
    'session_id', v_session.imp_,
    'session_revision', v_session.revision,
    'file_public_id', v_file.public_id,
    'version_public_id', v_version_public_id,
    'bucket_id', 'skill-vault-private',
    'object_name', v_file.storage_key,
    'purpose', 'upload',
    'expires_at', p_expires_at,
    'content_type', v_file.media_type,
    'declared_size', v_file.byte_size,
    'file_digest', v_file.file_digest,
    'ordinal', v_file.ordinal
  );
end
$function$;

create or replace function private.fail_skill_vault_incomplete_upload_cleanup(
  p_job_id uuid,
  p_retry_delay_seconds integer default 30
)
returns table (
  job_id uuid,
  state text,
  attempt_count integer,
  available_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_retry_delay_seconds is null or p_retry_delay_seconds not between 0 and 3600 then
    raise exception 'cleanup retry delay must be between 0 and 3600 seconds' using errcode = '22023';
  end if;
  update private.skill_vault_incomplete_upload_cleanup as cleanup
  set state = 'queued',
      available_at = pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => p_retry_delay_seconds),
      claimed_at = null,
      updated_at = pg_catalog.statement_timestamp()
  where cleanup.id = p_job_id and cleanup.state = 'claimed';
  if not found then raise exception 'cleanup claim unavailable' using errcode = '42501'; end if;
  return query
  select cleanup.id, cleanup.state, cleanup.attempt_count, cleanup.available_at
  from private.skill_vault_incomplete_upload_cleanup as cleanup
  where cleanup.id = p_job_id;
end
$function$;

create schema if not exists storage_worker_adapter;
revoke all on schema storage_worker_adapter from public, anon, authenticated;
grant usage on schema storage_worker_adapter to service_role;

create or replace function storage_worker_adapter.claim_import_upload_cleanup(p_limit integer default 8)
returns table (
  job_id uuid,
  bucket_id text,
  object_name text,
  cleanup_reason text,
  attempt_count integer,
  claimed_at timestamp with time zone
)
language sql
security definer
set search_path = ''
as $function$
  select * from private.claim_skill_vault_incomplete_upload_cleanup(p_limit);
$function$;

create or replace function storage_worker_adapter.complete_import_upload_cleanup(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_result record;
begin
  select * into v_result from private.complete_skill_vault_incomplete_upload_cleanup(p_job_id);
  if not found or v_result.state <> 'completed' then
    raise exception 'cleanup claim unavailable' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'job_id', v_result.job_id,
    'state', v_result.state,
    'completed_at', v_result.completed_at
  );
end
$function$;

create or replace function storage_worker_adapter.fail_import_upload_cleanup(
  p_job_id uuid,
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
  from private.fail_skill_vault_incomplete_upload_cleanup(p_job_id, p_retry_delay_seconds);
  if not found then raise exception 'cleanup claim unavailable' using errcode = '42501'; end if;
  return pg_catalog.jsonb_build_object(
    'job_id', v_result.job_id,
    'state', v_result.state,
    'attempt_count', v_result.attempt_count,
    'available_at', v_result.available_at
  );
end
$function$;

revoke all privileges on function private.claim_skill_vault_incomplete_upload_cleanup(integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.complete_skill_vault_incomplete_upload_cleanup(uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.fail_skill_vault_incomplete_upload_cleanup(uuid,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function storage_worker_adapter.claim_import_upload_cleanup(integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function storage_worker_adapter.complete_import_upload_cleanup(uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function storage_worker_adapter.fail_import_upload_cleanup(uuid,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

grant execute on function storage_worker_adapter.claim_import_upload_cleanup(integer) to service_role;
grant execute on function storage_worker_adapter.complete_import_upload_cleanup(uuid) to service_role;
grant execute on function storage_worker_adapter.fail_import_upload_cleanup(uuid,integer) to service_role;

comment on schema storage_worker_adapter is
  'Service-role-only exact-object cleanup RPC boundary for failed managed imports.';
comment on function storage_worker_adapter.claim_import_upload_cleanup(integer) is
  'Claims bounded exact-object cleanup jobs; no Storage deletion occurs under the row lock.';
comment on function storage_worker_adapter.complete_import_upload_cleanup(uuid) is
  'Records completion only after the worker deletes the exact claimed object through the Storage API.';
comment on function storage_worker_adapter.fail_import_upload_cleanup(uuid,integer) is
  'Requeues one failed exact-object cleanup claim with a bounded retry delay.';

alter role authenticator set pgrst.db_schemas =
  'public, graphql_public, api, device_adapter, analysis_worker_adapter, storage_worker_adapter';
notify pgrst, 'reload config';

commit;
