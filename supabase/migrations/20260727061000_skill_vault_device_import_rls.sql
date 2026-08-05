begin;

set local search_path = '';

-- M2.11: device/token/import least-privilege boundary.
--
-- M1.08 is an architecture-only protocol contract; this migration therefore
-- exposes the database side of that adapter only through exact service_role
-- SECURITY DEFINER wrappers. Browser callers never supply account_id/device_id
-- authority, and no application role receives a private-table grant.

create schema if not exists device_adapter;
revoke all privileges on schema device_adapter
  from public, anon, authenticated, service_role, skillmap_vault_definer;

alter table private.devices force row level security;
alter table private.device_tokens force row level security;
alter table private.import_sessions force row level security;
alter table private.import_file_receipts force row level security;

revoke all privileges on table private.devices
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.device_tokens
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.import_sessions
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.import_file_receipts
  from public, anon, authenticated, service_role, skillmap_vault_definer;

revoke all privileges on function private.issue_device(uuid,text,text,text,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.issue_device_token(uuid,uuid,text,integer,text[],timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.rotate_device_token(uuid,uuid,text,integer,text[],timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.revoke_device_token(uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.authorize_device_token(uuid,text,integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.begin_import_session(uuid,uuid,uuid,uuid,text,text,text,integer,bigint,uuid,timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.resume_import_session(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.accept_import_file(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.finalize_import_session(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.expire_import_session(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Catalog-level owner policies. Direct base-table access remains unavailable;
-- bounded projections below are the only browser read surface.
create policy devices_owner_select
  on private.devices
  for select
  to authenticated
  using (account_id = (select auth.uid()));

create policy import_sessions_owner_select
  on private.import_sessions
  for select
  to authenticated
  using (account_id = (select auth.uid()));

create policy import_file_receipts_owner_select
  on private.import_file_receipts
  for select
  to authenticated
  using (account_id = (select auth.uid()));

-- Permit an authority revision bump while retaining immutable device identity.
-- A state/revocation change must advance exactly one revision; last-used-only
-- authentication writes preserve the revision. Terminal states cannot reopen.
create or replace function private.enforce_device_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_authority_changed boolean;
begin
  new.display_name := nullif(pg_catalog.btrim(new.display_name), '');
  new.locale := nullif(pg_catalog.btrim(new.locale), '');
  new.platform := pg_catalog.lower(new.platform);

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.public_id is distinct from old.public_id
      or new.account_id is distinct from old.account_id
      or new.platform is distinct from old.platform
      or new.connector_version is distinct from old.connector_version
      or new.display_name is distinct from old.display_name
      or new.locale is distinct from old.locale
      or new.issued_at is distinct from old.issued_at
    then
      raise exception 'device identity and account metadata are immutable'
        using errcode = '22023';
    end if;

    if old.state in ('revoked', 'compromised')
       and new.state is distinct from old.state
    then
      raise exception 'terminal device state is immutable' using errcode = '22023';
    end if;

    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'device revocation is immutable' using errcode = '22023';
    end if;

    v_authority_changed :=
      new.state is distinct from old.state
      or new.expires_at is distinct from old.expires_at
      or new.revoked_at is distinct from old.revoked_at;

    if v_authority_changed then
      if new.revision is distinct from old.revision + 1 then
        raise exception 'device authority change requires one revision increment'
          using errcode = '22023';
      end if;
    elsif new.revision is distinct from old.revision
      and new.revision is distinct from old.revision + 1
    then
      raise exception 'device revision must be unchanged or increment by one'
        using errcode = '22023';
    end if;
  else
    new.issued_at := coalesce(new.issued_at, pg_catalog.statement_timestamp());
  end if;

  return new;
end
$function$;

-- Bounded owner projections. These postgres-owned SECURITY DEFINER helpers
-- explicitly scope to auth.uid() and return no account/internal UUID, token
-- digest, key version, token scopes, manifest/content digest, or storage key.
create function private.my_owner_devices()
returns table (
  h_public_id text,
  h_display_name text,
  h_platform text,
  h_connector_version text,
  h_locale text,
  h_state text,
  h_revision bigint,
  h_issued_at timestamp with time zone,
  h_last_used_at timestamp with time zone,
  h_expires_at timestamp with time zone,
  h_revoked_at timestamp with time zone
)
language sql
stable
security definer
set search_path = ''
as $function$
  select d.public_id, d.display_name, d.platform, d.connector_version,
         d.locale, d.state, d.revision, d.issued_at, d.last_used_at,
         d.expires_at, d.revoked_at
  from private.devices d
  where d.account_id = (select private.current_request_uid())
  order by d.issued_at, d.public_id
$function$;

revoke all privileges on function private.my_owner_devices()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.my_owner_devices() to authenticated;

create view api.my_devices
with (security_invoker = true, security_barrier = true)
as
select
  h_public_id as public_id,
  h_display_name as display_name,
  h_platform as platform,
  h_connector_version as connector_version,
  h_locale as locale,
  h_state as state,
  h_revision as revision,
  h_issued_at as issued_at,
  h_last_used_at as last_used_at,
  h_expires_at as expires_at,
  h_revoked_at as revoked_at
from private.my_owner_devices();

revoke all privileges on table api.my_devices
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_devices to authenticated;

create function private.my_owner_import_sessions()
returns table (
  h_public_id text,
  h_state text,
  h_expected_file_count integer,
  h_accepted_file_count integer,
  h_expected_byte_total bigint,
  h_accepted_byte_total bigint,
  h_expiry_at timestamp with time zone,
  h_created_at timestamp with time zone,
  h_updated_at timestamp with time zone,
  h_verified_at timestamp with time zone,
  h_revision bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select s.imp_, s.state, s.expected_file_count, s.accepted_file_count,
         s.expected_byte_total, s.accepted_byte_total, s.expiry_at,
         s.created_at, s.updated_at, s.verified_at, s.revision
  from private.import_sessions s
  where s.account_id = (select private.current_request_uid())
  order by s.created_at desc, s.imp_
$function$;

revoke all privileges on function private.my_owner_import_sessions()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.my_owner_import_sessions() to authenticated;

create view api.my_import_sessions
with (security_invoker = true, security_barrier = true)
as
select
  h_public_id as public_id,
  h_state as state,
  h_expected_file_count as expected_file_count,
  h_accepted_file_count as accepted_file_count,
  h_expected_byte_total as expected_byte_total,
  h_accepted_byte_total as accepted_byte_total,
  h_expiry_at as expiry_at,
  h_created_at as created_at,
  h_updated_at as updated_at,
  h_verified_at as verified_at,
  h_revision as revision
from private.my_owner_import_sessions();

revoke all privileges on table api.my_import_sessions
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_import_sessions to authenticated;

-- Browser owner functions. Identity is always derived from auth.uid(). Device
-- rotation here invalidates the current token family and advances the device
-- authority revision; a new credential is issued only by the service adapter.
create function private.register_my_device(
  p_display_name text,
  p_platform text,
  p_connector_version text,
  p_locale text default null
)
returns table (
  public_id text,
  state text,
  revision bigint,
  issued_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid := (select private.current_request_uid());
  v_device_id uuid;
begin
  if v_account_id is null then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  v_device_id := private.issue_device(
    v_account_id, p_display_name, p_platform, p_connector_version, p_locale
  );

  return query
  select d.public_id, d.state, d.revision, d.issued_at
  from private.devices d
  where d.account_id = v_account_id and d.id = v_device_id;
end
$function$;

revoke all privileges on function private.register_my_device(text,text,text,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.register_my_device(text,text,text,text)
  to authenticated;

create function private.revoke_my_device(
  p_device_public_id text,
  p_expected_revision bigint
)
returns table (
  public_id text,
  state text,
  revision bigint,
  revoked_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid := (select private.current_request_uid());
  v_device private.devices%rowtype;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if v_account_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_account_id::text, 0)
  );

  select d.* into v_device
  from private.devices d
  where d.account_id = v_account_id and d.public_id = p_device_public_id
  for update;

  if not found then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  if v_device.state = 'revoked' and v_device.revision = p_expected_revision then
    return query select v_device.public_id, v_device.state, v_device.revision, v_device.revoked_at;
    return;
  end if;

  if v_device.revision <> p_expected_revision or v_device.state in ('revoked', 'compromised') then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  update private.device_tokens t
  set revoked_at = coalesce(t.revoked_at, v_now)
  where t.account_id = v_account_id
    and t.device_id = v_device.id
    and t.revoked_at is null;

  update private.devices d
  set state = 'revoked', revoked_at = v_now, revision = d.revision + 1
  where d.account_id = v_account_id and d.id = v_device.id
  returning d.* into v_device;

  return query select v_device.public_id, v_device.state, v_device.revision, v_device.revoked_at;
end
$function$;

revoke all privileges on function private.revoke_my_device(text,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.revoke_my_device(text,bigint) to authenticated;

create function private.rotate_my_device(
  p_device_public_id text,
  p_expected_revision bigint
)
returns table (
  public_id text,
  state text,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid := (select private.current_request_uid());
  v_device private.devices%rowtype;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if v_account_id is null or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_account_id::text, 0)
  );

  select d.* into v_device
  from private.devices d
  where d.account_id = v_account_id and d.public_id = p_device_public_id
  for update;

  if not found
     or v_device.revision <> p_expected_revision
     or v_device.state <> 'active'
     or v_device.revoked_at is not null
     or (v_device.expires_at is not null and v_device.expires_at <= v_now)
  then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  update private.device_tokens t
  set revoked_at = coalesce(t.revoked_at, v_now)
  where t.account_id = v_account_id
    and t.device_id = v_device.id
    and t.revoked_at is null;

  update private.devices d
  set revision = d.revision + 1
  where d.account_id = v_account_id and d.id = v_device.id
  returning d.* into v_device;

  return query select v_device.public_id, v_device.state, v_device.revision;
end
$function$;

revoke all privileges on function private.rotate_my_device(text,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.rotate_my_device(text,bigint) to authenticated;

-- Internal token-to-device context. It is never granted to an application
-- role. The adapter supplies a verifier/key version, not device authority.
create function private.resolve_device_context(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_required_scope text default null
)
returns table (token_id uuid, device_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token_id uuid;
  v_token private.device_tokens%rowtype;
  v_device private.devices%rowtype;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if p_account_id is null
     or p_expected_device_revision is null or p_expected_device_revision < 1
     or p_expected_token_generation is null or p_expected_token_generation < 1
     or (p_required_scope is not null and p_required_scope !~ '^[a-z][a-z0-9._:-]{0,47}$')
  then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  v_token_id := private.authorize_device_token(
    p_account_id, p_credential_digest, p_key_version
  );

  select t.* into v_token
  from private.device_tokens t
  where t.account_id = p_account_id and t.id = v_token_id;

  if not found
     or v_token.generation <> p_expected_token_generation
     or v_token.revoked_at is not null
     or v_token.replaced_by_token_id is not null
     or (v_token.expires_at is not null and v_token.expires_at <= v_now)
     or (p_required_scope is not null and not (p_required_scope = any(v_token.scopes)))
  then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  select d.* into v_device
  from private.devices d
  where d.account_id = p_account_id and d.id = v_token.device_id;

  if not found
     or v_device.revision <> p_expected_device_revision
     or v_device.state <> 'active'
     or v_device.revoked_at is not null
     or (v_device.expires_at is not null and v_device.expires_at <= v_now)
  then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  return query select v_token.id, v_device.id;
end
$function$;

revoke all privileges on function private.resolve_device_context(uuid,text,integer,bigint,bigint,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Exact DeviceAuth adapter token lifecycle functions. They return only bounded
-- receipts; token/device internal UUIDs and verifier material are never output.
create function device_adapter.adapter_issue_device_token(
  p_account_id uuid,
  p_device_public_id text,
  p_credential_digest text,
  p_key_version integer,
  p_scopes text[],
  p_expires_at timestamp with time zone,
  p_expected_device_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_device private.devices%rowtype;
  v_token_id uuid;
  v_generation bigint;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 0)
  );

  select d.* into v_device
  from private.devices d
  where d.account_id = p_account_id and d.public_id = p_device_public_id
  for update;

  if not found
     or v_device.revision <> p_expected_device_revision
     or v_device.state <> 'active'
     or v_device.revoked_at is not null
     or (v_device.expires_at is not null and v_device.expires_at <= v_now)
  then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;

  if exists (
    select 1
    from private.device_tokens t
    where t.account_id = p_account_id
      and t.device_id = v_device.id
      and t.revoked_at is null
      and t.replaced_by_token_id is null
      and (t.expires_at is null or t.expires_at > v_now)
  ) then
    raise exception 'device token already active' using errcode = '22023';
  end if;

  v_token_id := private.issue_device_token(
    p_account_id, v_device.id, p_credential_digest, p_key_version,
    p_scopes, p_expires_at
  );

  select t.generation into v_generation
  from private.device_tokens t
  where t.account_id = p_account_id and t.id = v_token_id;

  return pg_catalog.jsonb_build_object(
    'device_public_id', v_device.public_id,
    'device_revision', v_device.revision,
    'token_generation', v_generation,
    'expires_at', p_expires_at
  );
end
$function$;

create function device_adapter.adapter_rotate_device_token(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_new_credential_digest text,
  p_new_key_version integer,
  p_new_scopes text[],
  p_new_expires_at timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_new_token_id uuid;
  v_new_generation bigint;
  v_device_public_id text;
begin
  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, null
  );

  v_new_token_id := private.rotate_device_token(
    p_account_id, v_context.token_id, p_new_credential_digest,
    p_new_key_version, p_new_scopes, p_new_expires_at
  );

  select t.generation, d.public_id
  into v_new_generation, v_device_public_id
  from private.device_tokens t
  join private.devices d
    on d.account_id = t.account_id and d.id = t.device_id
  where t.account_id = p_account_id and t.id = v_new_token_id;

  return pg_catalog.jsonb_build_object(
    'device_public_id', v_device_public_id,
    'device_revision', p_expected_device_revision,
    'token_generation', v_new_generation,
    'expires_at', p_new_expires_at
  );
end
$function$;

create function device_adapter.adapter_revoke_device_token(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
begin
  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, null
  );

  return private.revoke_device_token(p_account_id, v_context.token_id);
end
$function$;

-- Device-scoped import wrappers. Each call resolves the device from the live
-- token family and exact device.import scope. Session/file IDs are public IDs;
-- account/device/internal UUIDs are derived inside the transaction.
create function device_adapter.adapter_begin_import_session(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_skill_public_id text,
  p_version_public_id text,
  p_manifest_schema_version text,
  p_manifest_digest text,
  p_content_digest text,
  p_expected_file_count integer,
  p_expected_byte_total bigint,
  p_idempotency_key uuid,
  p_expiry_at timestamp with time zone default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_skill_id uuid;
  v_version_id uuid;
  v_session_id uuid;
  v_session_public_id text;
  v_existing private.import_sessions%rowtype;
begin
  if p_expiry_at is null or p_expiry_at <= pg_catalog.statement_timestamp() then
    raise exception 'import expiry must be explicit and in the future' using errcode = '22023';
  end if;

  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, 'device.import'
  );

  select m.id, v.id into v_skill_id, v_version_id
  from private.managed_skills m
  join private.managed_skill_versions v
    on v.account_id = m.account_id and v.managed_skill_id = m.id
  where m.account_id = p_account_id
    and m.public_id = p_skill_public_id
    and v.public_id = p_version_public_id;

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  -- Close the adapter-level exact replay boundary before delegating to M2.08.
  -- M2.08 intentionally keys the row by account/device/idempotency, but its
  -- historical equality check did not include an explicitly requested expiry.
  -- A changed explicit expiry is therefore a conflict, never a silent replay.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 4)
  );

  select s.* into v_existing
  from private.import_sessions s
  where s.account_id = p_account_id
    and s.device_id = v_context.device_id
    and s.idempotency_key = p_idempotency_key
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

  v_session_id := private.begin_import_session(
    p_account_id, v_context.device_id, v_skill_id, v_version_id,
    p_manifest_schema_version, p_manifest_digest, p_content_digest,
    p_expected_file_count, p_expected_byte_total, p_idempotency_key, p_expiry_at
  );

  select s.imp_ into v_session_public_id
  from private.import_sessions s
  where s.account_id = p_account_id
    and s.device_id = v_context.device_id
    and s.id = v_session_id;

  return v_session_public_id;
end
$function$;

create function device_adapter.adapter_resume_import_session(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_session_public_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session_id uuid;
begin
  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, 'device.import'
  );

  select s.id into v_session_id
  from private.import_sessions s
  where s.account_id = p_account_id
    and s.device_id = v_context.device_id
    and s.imp_ = p_session_public_id
    and s.state = 'in_progress'
    and s.expiry_at > pg_catalog.statement_timestamp();

  if not found then
    return null;
  end if;

  return private.resume_import_session(p_account_id, v_context.device_id, v_session_id);
end
$function$;

create function device_adapter.adapter_accept_import_file(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_session_public_id text,
  p_expected_session_revision bigint,
  p_file_public_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session private.import_sessions%rowtype;
  v_file_id uuid;
begin
  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, 'device.import'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 4)
  );

  select s.* into v_session
  from private.import_sessions s
  where s.account_id = p_account_id
    and s.device_id = v_context.device_id
    and s.imp_ = p_session_public_id
  for update;

  if not found or v_session.revision <> p_expected_session_revision then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  select f.id into v_file_id
  from private.managed_skill_files f
  where f.account_id = p_account_id
    and f.managed_skill_id = v_session.managed_skill_id
    and f.version_id = v_session.version_id
    and f.public_id = p_file_public_id;

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  perform private.accept_import_file(
    p_account_id, v_context.device_id, v_session.id, v_file_id
  );

  return private.resume_import_session(p_account_id, v_context.device_id, v_session.id);
end
$function$;

create function device_adapter.adapter_finalize_import_session(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_session_public_id text,
  p_expected_session_revision bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_session private.import_sessions%rowtype;
begin
  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, 'device.import'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 4)
  );

  select s.* into v_session
  from private.import_sessions s
  where s.account_id = p_account_id
    and s.device_id = v_context.device_id
    and s.imp_ = p_session_public_id
  for update;

  if not found or v_session.revision <> p_expected_session_revision then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  perform private.finalize_import_session(
    p_account_id, v_context.device_id, v_session.id
  );

  return v_session.imp_;
end
$function$;

-- Revoke wrappers from every role before the final allowlist grant.
revoke all privileges on function device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_begin_import_session(uuid,text,integer,bigint,bigint,text,text,text,text,text,integer,bigint,uuid,timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_resume_import_session(uuid,text,integer,bigint,bigint,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_accept_import_file(uuid,text,integer,bigint,bigint,text,bigint,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_finalize_import_session(uuid,text,integer,bigint,bigint,text,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- A dedicated non-exposed schema prevents service_role from gaining reach to
-- any unrelated PUBLIC-executable helper in `private`. Schema USAGE plus the
-- exact seven EXECUTE grants below is the complete database adapter surface.
grant usage on schema device_adapter to service_role;

grant execute on function device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint)
  to service_role;
grant execute on function device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone)
  to service_role;
grant execute on function device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint)
  to service_role;
grant execute on function device_adapter.adapter_begin_import_session(uuid,text,integer,bigint,bigint,text,text,text,text,text,integer,bigint,uuid,timestamp with time zone)
  to service_role;
grant execute on function device_adapter.adapter_resume_import_session(uuid,text,integer,bigint,bigint,text)
  to service_role;
grant execute on function device_adapter.adapter_accept_import_file(uuid,text,integer,bigint,bigint,text,bigint,text)
  to service_role;
grant execute on function device_adapter.adapter_finalize_import_session(uuid,text,integer,bigint,bigint,text,bigint)
  to service_role;

commit;
