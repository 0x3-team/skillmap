begin;

set local search_path = '';

create table private.import_finalization_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null,
  device_id uuid not null,
  session_id uuid not null,
  idempotency_key uuid not null,
  expected_session_revision bigint not null,
  request_digest text not null,
  response jsonb not null,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint import_finalization_receipts_account_device_idem_key
    unique (account_id, device_id, idempotency_key),
  constraint import_finalization_receipts_session_key
    unique (account_id, device_id, session_id),
  constraint import_finalization_receipts_session_fkey
    foreign key (account_id, device_id, session_id)
    references private.import_sessions (account_id, device_id, id)
    on delete cascade,
  constraint import_finalization_receipts_request_digest_check
    check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_finalization_receipts_expected_revision_check
    check (expected_session_revision >= 1),
  constraint import_finalization_receipts_response_check
    check (pg_catalog.jsonb_typeof(response) = 'object' and pg_catalog.octet_length(response::text) <= 16384)
);

alter table private.import_finalization_receipts enable row level security;
alter table private.import_finalization_receipts force row level security;
revoke all privileges on table private.import_finalization_receipts
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function device_adapter.adapter_begin_import_session_v2(
  p_account_public_id text,
  p_device_public_id text,
  p_skill_public_id text,
  p_version_public_id text,
  p_manifest_schema_version text,
  p_manifest_digest text,
  p_content_digest text,
  p_expected_file_count integer,
  p_expected_byte_total bigint,
  p_idempotency_key uuid,
  p_expiry_at timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_skill_id uuid;
  v_version_id uuid;
  v_session_id uuid;
  v_existing private.import_sessions%rowtype;
  v_session private.import_sessions%rowtype;
  v_finalization_expected_revision bigint;
begin
  if p_expiry_at is null
    or p_expiry_at <= pg_catalog.statement_timestamp()
    or p_expiry_at > pg_catalog.statement_timestamp() + interval '6 hours'
  then
    raise exception 'import expiry must be explicit and within six hours' using errcode = '22023';
  end if;

  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  select skills.id, versions.id into v_skill_id, v_version_id
  from private.managed_skills as skills
  join private.managed_skill_versions as versions
    on versions.account_id = skills.account_id
   and versions.managed_skill_id = skills.id
  where skills.account_id = v_context.account_id
    and skills.public_id = p_skill_public_id
    and versions.public_id = p_version_public_id;

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_context.account_id::text, 4)
  );

  select sessions.* into v_existing
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.idempotency_key = p_idempotency_key
  for update;

  if found and (
    v_existing.managed_skill_id is distinct from v_skill_id
    or v_existing.version_id is distinct from v_version_id
    or v_existing.manifest_schema_version is distinct from pg_catalog.btrim(p_manifest_schema_version)
    or v_existing.manifest_digest is distinct from p_manifest_digest
    or v_existing.content_digest is distinct from p_content_digest
    or v_existing.expected_file_count is distinct from p_expected_file_count
    or v_existing.expected_byte_total is distinct from p_expected_byte_total
    or v_existing.expiry_at is distinct from p_expiry_at
  ) then
    raise exception 'conflicting import session idempotency reuse' using errcode = '22023';
  end if;

  if found then
    select receipts.expected_session_revision into v_finalization_expected_revision
    from private.import_finalization_receipts as receipts
    where receipts.account_id = v_context.account_id
      and receipts.device_id = v_context.device_id
      and receipts.session_id = v_existing.id;
    return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'session_id', v_existing.imp_,
      'state', v_existing.state,
      'revision', v_existing.revision,
      'expected_file_count', v_existing.expected_file_count,
      'accepted_file_count', v_existing.accepted_file_count,
      'expected_byte_total', v_existing.expected_byte_total,
      'accepted_byte_total', v_existing.accepted_byte_total,
      'expiry_at', v_existing.expiry_at,
      'manifest_digest', v_existing.manifest_digest,
      'content_digest', v_existing.content_digest,
      'verification_digest', v_existing.verification_digest,
      'finalization_expected_revision', v_finalization_expected_revision
    ));
  end if;

  v_session_id := private.begin_import_session(
    v_context.account_id, v_context.device_id, v_skill_id, v_version_id,
    p_manifest_schema_version, p_manifest_digest, p_content_digest,
    p_expected_file_count, p_expected_byte_total, p_idempotency_key, p_expiry_at
  );

  select sessions.* into strict v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.id = v_session_id;

  return pg_catalog.jsonb_build_object(
    'session_id', v_session.imp_,
    'state', v_session.state,
    'revision', v_session.revision,
    'expected_file_count', v_session.expected_file_count,
    'accepted_file_count', v_session.accepted_file_count,
    'expected_byte_total', v_session.expected_byte_total,
    'accepted_byte_total', v_session.accepted_byte_total,
    'expiry_at', v_session.expiry_at
  );
end
$function$;

create function device_adapter.adapter_prepare_import_upload(
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

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  if p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + interval '5 minutes' then
    raise exception 'invalid import upload expiry' using errcode = '22023';
  end if;

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.imp_ = p_session_public_id
  for update;

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;
  if v_session.revision <> p_expected_session_revision or v_session.state <> 'in_progress' then
    raise exception 'import session revision conflict' using errcode = '40001';
  end if;
  if v_session.expiry_at <= v_now then
    raise exception 'import session expired' using errcode = '22023';
  end if;

  select files.* into v_file
  from private.managed_skill_files as files
  where files.account_id = v_context.account_id
    and files.managed_skill_id = v_session.managed_skill_id
    and files.version_id = v_session.version_id
    and files.public_id = p_file_public_id;

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  select versions.public_id into strict v_version_public_id
  from private.managed_skill_versions as versions
  where versions.account_id = v_file.account_id
    and versions.managed_skill_id = v_file.managed_skill_id
    and versions.id = v_file.version_id;

  if v_file.storage_key <> ('v1/' || v_version_public_id || '/' || v_file.public_id) then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  if exists (
    select 1
    from private.import_file_receipts as receipts
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

create function device_adapter.adapter_list_import_file_receipts(
  p_account_public_id text,
  p_device_public_id text,
  p_session_public_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session private.import_sessions%rowtype;
  v_receipts jsonb;
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.imp_ = p_session_public_id;

  if not found then return null; end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'file_public_id', files.public_id,
        'relative_path', receipts.relative_path,
        'accepted_byte_size', receipts.accepted_byte_size,
        'file_digest', receipts.file_digest,
        'ordinal', receipts.ordinal,
        'accepted_at', receipts.accepted_at
      ) order by receipts.ordinal
    ),
    '[]'::jsonb
  ) into v_receipts
  from private.import_file_receipts as receipts
  join private.managed_skill_files as files
    on files.account_id = receipts.account_id
   and files.managed_skill_id = receipts.managed_skill_id
   and files.version_id = receipts.version_id
   and files.id = receipts.file_id
  where receipts.account_id = v_context.account_id and receipts.session_id = v_session.id;

  return pg_catalog.jsonb_build_object(
    'session_id', v_session.imp_,
    'state', v_session.state,
    'revision', v_session.revision,
    'expected_file_count', v_session.expected_file_count,
    'accepted_file_count', v_session.accepted_file_count,
    'expected_byte_total', v_session.expected_byte_total,
    'accepted_byte_total', v_session.accepted_byte_total,
    'expiry_at', v_session.expiry_at,
    'receipts', v_receipts
  );
end
$function$;

create function device_adapter.adapter_expire_import_session(
  p_account_public_id text,
  p_device_public_id text,
  p_session_public_id text,
  p_expected_session_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session private.import_sessions%rowtype;
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.imp_ = p_session_public_id
  for update;

  if not found then return null; end if;
  if p_expected_session_revision is null
    or p_expected_session_revision < 1
    or v_session.revision <> p_expected_session_revision
  then
    raise exception 'import session revision conflict' using errcode = '40001';
  end if;
  if v_session.state = 'in_progress' then
    perform private.expire_import_session(v_context.account_id, v_context.device_id, v_session.id);
    select sessions.* into v_session
    from private.import_sessions as sessions
    where sessions.account_id = v_context.account_id and sessions.id = v_session.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'session_id', v_session.imp_,
    'state', v_session.state,
    'revision', v_session.revision
  );
end
$function$;

create function device_adapter.adapter_enqueue_import_upload_cleanup(
  p_account_public_id text,
  p_device_public_id text,
  p_session_public_id text,
  p_file_public_id text,
  p_cleanup_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_storage_key text;
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  select files.storage_key into v_storage_key
  from private.import_sessions as sessions
  join private.managed_skill_files as files
    on files.account_id = sessions.account_id
   and files.managed_skill_id = sessions.managed_skill_id
   and files.version_id = sessions.version_id
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.imp_ = p_session_public_id
    and files.public_id = p_file_public_id;

  if not found then raise exception 'import authority unavailable' using errcode = '42501'; end if;
  perform private.enqueue_skill_vault_incomplete_upload_cleanup(
    'skill-vault-private', v_storage_key, p_cleanup_reason
  );
  return true;
end
$function$;

create function device_adapter.adapter_accept_import_file_v2(
  p_account_public_id text,
  p_device_public_id text,
  p_session_public_id text,
  p_expected_session_revision bigint,
  p_file_public_id text,
  p_verified_file_digest text,
  p_verified_byte_size bigint
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
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_context.account_id::text, 4));

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.imp_ = p_session_public_id
  for update;

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;
  if v_session.revision <> p_expected_session_revision or v_session.state <> 'in_progress' then
    raise exception 'import session revision conflict' using errcode = '40001';
  end if;
  if v_session.expiry_at <= pg_catalog.statement_timestamp() then
    raise exception 'import session expired' using errcode = '22023';
  end if;

  select files.* into v_file
  from private.managed_skill_files as files
  where files.account_id = v_context.account_id
    and files.managed_skill_id = v_session.managed_skill_id
    and files.version_id = v_session.version_id
    and files.public_id = p_file_public_id;

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;
  if p_verified_file_digest is distinct from v_file.file_digest
    or p_verified_byte_size is distinct from v_file.byte_size
  then
    raise exception 'uploaded object checksum does not match the immutable file binding' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from storage.objects as objects
    where objects.bucket_id = 'skill-vault-private'
      and objects.name = v_file.storage_key
      and private.skill_vault_storage_object_binding_is_valid(
        objects.bucket_id,
        objects.name,
        objects.owner,
        objects.owner_id,
        objects.metadata,
        objects.user_metadata
      )
  ) then
    raise exception 'uploaded object does not match the immutable file binding' using errcode = '22023';
  end if;

  perform private.accept_import_file(
    v_context.account_id, v_context.device_id, v_session.id, v_file.id
  );

  select sessions.* into strict v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.id = v_session.id;

  return pg_catalog.jsonb_build_object(
    'session_id', v_session.imp_,
    'state', v_session.state,
    'revision', v_session.revision,
    'expected_file_count', v_session.expected_file_count,
    'accepted_file_count', v_session.accepted_file_count,
    'expected_byte_total', v_session.expected_byte_total,
    'accepted_byte_total', v_session.accepted_byte_total,
    'expiry_at', v_session.expiry_at,
    'manifest_digest', v_session.manifest_digest,
    'content_digest', v_session.content_digest,
    'verification_digest', v_session.verification_digest
  );
end
$function$;

create function device_adapter.adapter_finalize_import_session_v2(
  p_account_public_id text,
  p_device_public_id text,
  p_session_public_id text,
  p_expected_session_revision bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session private.import_sessions%rowtype;
  v_existing private.import_finalization_receipts%rowtype;
  v_request_digest text;
  v_version_public_id text;
  v_release_public_id text;
  v_response jsonb;
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);
  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_expected_session_revision is null or p_expected_session_revision < 1 then
    raise exception 'invalid import finalization request' using errcode = '22023';
  end if;

  v_request_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'session_id', p_session_public_id,
          'expected_session_revision', p_expected_session_revision
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_context.account_id::text, 4));

  select receipts.* into v_existing
  from private.import_finalization_receipts as receipts
  where receipts.account_id = v_context.account_id
    and receipts.device_id = v_context.device_id
    and receipts.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.request_digest <> v_request_digest then
      raise exception 'conflicting import finalization idempotency reuse' using errcode = '22023';
    end if;
    return v_existing.response;
  end if;

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id
    and sessions.device_id = v_context.device_id
    and sessions.imp_ = p_session_public_id
  for update;

  if not found or v_session.state <> 'in_progress' or v_session.revision <> p_expected_session_revision then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  if exists (
    select 1 from private.import_finalization_receipts as receipts
    where receipts.account_id = v_context.account_id
      and receipts.device_id = v_context.device_id
      and receipts.session_id = v_session.id
  ) then
    raise exception 'conflicting import finalization idempotency reuse' using errcode = '22023';
  end if;

  perform private.finalize_import_session(v_context.account_id, v_context.device_id, v_session.id);

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = v_context.account_id and sessions.id = v_session.id;

  select versions.public_id, releases.public_id
  into strict v_version_public_id, v_release_public_id
  from private.import_sessions as sessions
  join private.managed_skill_versions as versions
    on versions.account_id = sessions.account_id and versions.id = sessions.version_id
  join private.managed_skill_releases as releases
    on releases.account_id = versions.account_id
   and releases.managed_skill_id = versions.managed_skill_id
   and releases.version_id = versions.id
  where sessions.account_id = v_context.account_id and sessions.id = v_session.id;

  v_response := pg_catalog.jsonb_build_object(
    'session_id', v_session.imp_,
    'state', v_session.state,
    'revision', v_session.revision,
    'verification_digest', v_session.verification_digest,
    'version_public_id', v_version_public_id,
    'release_public_id', v_release_public_id,
    'analysis_state', 'pending'
  );

  insert into private.import_finalization_receipts (
    account_id, device_id, session_id, idempotency_key, expected_session_revision, request_digest, response
  ) values (
    v_context.account_id, v_context.device_id, v_session.id, p_idempotency_key,
    p_expected_session_revision, v_request_digest, v_response
  );
  return v_response;
end
$function$;

revoke all privileges on function device_adapter.adapter_begin_import_session_v2(text,text,text,text,text,text,text,integer,bigint,uuid,timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_prepare_import_upload(text,text,text,bigint,text,timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_list_import_file_receipts(text,text,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_expire_import_session(text,text,text,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_enqueue_import_upload_cleanup(text,text,text,text,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_accept_import_file_v2(text,text,text,bigint,text,text,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_finalize_import_session_v2(text,text,text,bigint,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

grant execute on function device_adapter.adapter_begin_import_session_v2(text,text,text,text,text,text,text,integer,bigint,uuid,timestamp with time zone)
  to service_role;
grant execute on function device_adapter.adapter_prepare_import_upload(text,text,text,bigint,text,timestamp with time zone)
  to service_role;
grant execute on function device_adapter.adapter_list_import_file_receipts(text,text,text)
  to service_role;
grant execute on function device_adapter.adapter_expire_import_session(text,text,text,bigint)
  to service_role;
grant execute on function device_adapter.adapter_enqueue_import_upload_cleanup(text,text,text,text,text)
  to service_role;
grant execute on function device_adapter.adapter_accept_import_file_v2(text,text,text,bigint,text,text,bigint)
  to service_role;
grant execute on function device_adapter.adapter_finalize_import_session_v2(text,text,text,bigint,uuid)
  to service_role;

commit;
