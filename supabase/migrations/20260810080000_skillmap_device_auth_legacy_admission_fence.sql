begin;

set local search_path = '';

-- M3.02 compatibility fence.  The preceding seven migrations are intentionally
-- feature-off.  This migration is the only place that admits the old device
-- authority while the final cutover is still reversible.
--
-- The six old function bodies are retained under private, ungranted names.  A
-- public legacy entrypoint is replaced by a same-signature wrapper whose first
-- executable operations are the frozen shared lock and DB-owned flag check.
-- This avoids editing an accepted migration and makes a direct call to the
-- legacy name participate in the same admission protocol.

do $preflight$
declare
  v_signature text;
  v_oid oid;
  v_owner text;
  v_search_path text[];
begin
  foreach v_signature in array array[
    'private.register_my_device(text,text,text,text)',
    'private.rotate_my_device(text,bigint)',
    'private.revoke_my_device(text,bigint)',
    'device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint)',
    'device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone)',
    'device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then
      raise exception 'M3.02 legacy admission preflight failed: missing %', v_signature using errcode = 'P0001';
    end if;
    select r.rolname, p.proconfig
      into v_owner, v_search_path
      from pg_catalog.pg_proc p
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = v_oid;
    if v_owner is distinct from 'postgres' then
      raise exception 'M3.02 legacy admission preflight failed: % owner is %, expected postgres', v_signature, v_owner using errcode = 'P0001';
    end if;
    if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid) then
      raise exception 'M3.02 legacy admission preflight failed: % is not SECURITY DEFINER', v_signature using errcode = 'P0001';
    end if;
    if v_search_path is distinct from array['search_path=""']::text[] then
      raise exception 'M3.02 legacy admission preflight failed: % does not pin search_path to empty', v_signature using errcode = 'P0001';
    end if;
  end loop;

  if pg_catalog.to_regprocedure('private.register_my_device_legacy_pre_cutover(text,text,text,text)') is not null
     or pg_catalog.to_regprocedure('private.rotate_my_device_legacy_pre_cutover(text,bigint)') is not null
     or pg_catalog.to_regprocedure('private.revoke_my_device_legacy_pre_cutover(text,bigint)') is not null
     or pg_catalog.to_regprocedure('device_adapter.adapter_issue_device_token_legacy_pre_cutover(uuid,text,text,integer,text[],timestamp with time zone,bigint)') is not null
     or pg_catalog.to_regprocedure('device_adapter.adapter_rotate_device_token_legacy_pre_cutover(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone)') is not null
     or pg_catalog.to_regprocedure('device_adapter.adapter_revoke_device_token_legacy_pre_cutover(uuid,text,integer,bigint,bigint)') is not null then
    raise exception 'M3.02 legacy admission preflight failed: internal legacy names already exist' using errcode = 'P0001';
  end if;
end
$preflight$;

create table private.device_auth_authority_control (
  control_key text primary key,
  legacy_device_authority_enabled boolean not null,
  revision bigint not null,
  changed_at timestamptz not null,
  constraint device_auth_authority_control_singleton
    check (control_key = 'legacy_device_authority'),
  constraint device_auth_authority_control_revision_positive
    check (revision > 0)
);

alter table private.device_auth_authority_control enable row level security;
alter table private.device_auth_authority_control force row level security;
-- PostgreSQL requires the target owner to have CREATE on the containing
-- schema while ownership is transferred.  Grant it only for these DDL
-- statements, then restore the least-privilege posture below.
grant create on schema private to skillmap_device_auth_definer;
alter table private.device_auth_authority_control owner to skillmap_device_auth_definer;

revoke all privileges on table private.device_auth_authority_control
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select, update on table private.device_auth_authority_control to skillmap_device_auth_definer;
drop policy if exists device_auth_authority_control_definer_select on private.device_auth_authority_control;
create policy device_auth_authority_control_definer_select
  on private.device_auth_authority_control for select to skillmap_device_auth_definer
  using (control_key = 'legacy_device_authority');
drop policy if exists device_auth_authority_control_definer_update on private.device_auth_authority_control;
create policy device_auth_authority_control_definer_update
  on private.device_auth_authority_control for update to skillmap_device_auth_definer
  using (control_key = 'legacy_device_authority')
  with check (control_key = 'legacy_device_authority');

insert into private.device_auth_authority_control(
  control_key, legacy_device_authority_enabled, revision, changed_at
)
values ('legacy_device_authority', true, 1, pg_catalog.statement_timestamp());

create table private.device_auth_cutover_provenance (
  artifact_id text primary key,
  rollback_floor_artifact_id text not null,
  feature_ready boolean not null,
  created_at timestamptz not null,
  constraint device_auth_cutover_provenance_artifact_check
    check (artifact_id = 'm3-02-device-auth-replacement-aware-disabled'),
  constraint device_auth_cutover_provenance_rollback_check
    check (rollback_floor_artifact_id = artifact_id)
);
alter table private.device_auth_cutover_provenance enable row level security;
alter table private.device_auth_cutover_provenance force row level security;
alter table private.device_auth_cutover_provenance owner to skillmap_device_auth_definer;
revoke all privileges on table private.device_auth_cutover_provenance
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table private.device_auth_cutover_provenance to skillmap_device_auth_definer;
drop policy if exists device_auth_cutover_provenance_definer_select on private.device_auth_cutover_provenance;
create policy device_auth_cutover_provenance_definer_select
  on private.device_auth_cutover_provenance for select to skillmap_device_auth_definer
  using (artifact_id = 'm3-02-device-auth-replacement-aware-disabled');
insert into private.device_auth_cutover_provenance(
  artifact_id, rollback_floor_artifact_id, feature_ready, created_at
)
values (
  'm3-02-device-auth-replacement-aware-disabled',
  'm3-02-device-auth-replacement-aware-disabled',
  true,
  pg_catalog.statement_timestamp()
);

create function private.device_auth_assert_legacy_authority_enabled()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_enabled boolean;
  v_revision bigint;
  v_count integer;
begin
  select count(*)::integer, bool_and(c.legacy_device_authority_enabled), min(c.revision)
    into v_count, v_enabled, v_revision
    from private.device_auth_authority_control c
   where c.control_key = 'legacy_device_authority';
  if v_count <> 1 or v_enabled is distinct from true or v_revision is null or v_revision < 1 then
    raise exception 'legacy device authority is disabled' using errcode = '42501';
  end if;
end
$function$;

alter function private.device_auth_assert_legacy_authority_enabled() owner to skillmap_device_auth_definer;
revoke all privileges on function private.device_auth_assert_legacy_authority_enabled()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.device_auth_assert_legacy_authority_enabled() to postgres;

create function private.device_auth_authority_control_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'device authority control is forward-only' using errcode = '55000';
  end if;
  if old.control_key is distinct from 'legacy_device_authority'
     or new.control_key is distinct from old.control_key
     or old.legacy_device_authority_enabled is distinct from true
     or new.legacy_device_authority_enabled is distinct from false
     or new.revision <> old.revision + 1
     or new.changed_at <= old.changed_at then
    raise exception 'device authority control transition is invalid' using errcode = '55000';
  end if;
  return new;
end
$function$;

alter function private.device_auth_authority_control_guard() owner to skillmap_device_auth_definer;
revoke all privileges on function private.device_auth_authority_control_guard()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create trigger device_auth_authority_control_forward_only
before update or delete on private.device_auth_authority_control
for each row execute function private.device_auth_authority_control_guard();

revoke create on schema private from skillmap_device_auth_definer;

-- Keep the accepted bodies and their clean-reset owners, but remove their old
-- EXECUTE grants before creating the fenced names.  The renamed functions are
-- private implementation details and cannot bypass the flag.
alter function private.register_my_device(text,text,text,text) rename to register_my_device_legacy_pre_cutover;
alter function private.rotate_my_device(text,bigint) rename to rotate_my_device_legacy_pre_cutover;
alter function private.revoke_my_device(text,bigint) rename to revoke_my_device_legacy_pre_cutover;
alter function device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint) rename to adapter_issue_device_token_legacy_pre_cutover;
alter function device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone) rename to adapter_rotate_device_token_legacy_pre_cutover;
alter function device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint) rename to adapter_revoke_device_token_legacy_pre_cutover;

revoke all privileges on function private.register_my_device_legacy_pre_cutover(text,text,text,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.rotate_my_device_legacy_pre_cutover(text,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.revoke_my_device_legacy_pre_cutover(text,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_issue_device_token_legacy_pre_cutover(uuid,text,text,integer,text[],timestamp with time zone,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_rotate_device_token_legacy_pre_cutover(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_revoke_device_token_legacy_pre_cutover(uuid,text,integer,bigint,bigint)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.register_my_device(
  p_display_name text, p_platform text, p_connector_version text, p_locale text default null
)
returns table (public_id text, state text, revision bigint, issued_at timestamp with time zone)
language plpgsql security definer set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(1397442892, 1145132372);
  perform private.device_auth_assert_legacy_authority_enabled();
  if coalesce((select auth.jwt()) ->> 'role', '') <> 'authenticated'
     or (select auth.uid()) is null
     or coalesce((select auth.jwt()) -> 'is_anonymous', 'true'::jsonb) <> 'false'::jsonb then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;
  return query
  select * from private.register_my_device_legacy_pre_cutover(
    p_display_name, p_platform, p_connector_version, p_locale
  );
end
$function$;

create function private.rotate_my_device(p_device_public_id text, p_expected_revision bigint)
returns table (public_id text, state text, revision bigint)
language plpgsql security definer set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(1397442892, 1145132372);
  perform private.device_auth_assert_legacy_authority_enabled();
  if coalesce((select auth.jwt()) ->> 'role', '') <> 'authenticated'
     or (select auth.uid()) is null
     or coalesce((select auth.jwt()) -> 'is_anonymous', 'true'::jsonb) <> 'false'::jsonb then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;
  return query select * from private.rotate_my_device_legacy_pre_cutover(p_device_public_id, p_expected_revision);
end
$function$;

create function private.revoke_my_device(p_device_public_id text, p_expected_revision bigint)
returns table (public_id text, state text, revision bigint, revoked_at timestamp with time zone)
language plpgsql security definer set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(1397442892, 1145132372);
  perform private.device_auth_assert_legacy_authority_enabled();
  if coalesce((select auth.jwt()) ->> 'role', '') <> 'authenticated'
     or (select auth.uid()) is null
     or coalesce((select auth.jwt()) -> 'is_anonymous', 'true'::jsonb) <> 'false'::jsonb then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;
  return query select * from private.revoke_my_device_legacy_pre_cutover(p_device_public_id, p_expected_revision);
end
$function$;

create function device_adapter.adapter_issue_device_token(
  p_account_id uuid, p_device_public_id text, p_credential_digest text, p_key_version integer,
  p_scopes text[], p_expires_at timestamp with time zone, p_expected_device_revision bigint
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(1397442892, 1145132372);
  perform private.device_auth_assert_legacy_authority_enabled();
  if coalesce((select auth.jwt()) ->> 'role', '') <> 'service_role' then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;
  return device_adapter.adapter_issue_device_token_legacy_pre_cutover(
    p_account_id, p_device_public_id, p_credential_digest, p_key_version,
    p_scopes, p_expires_at, p_expected_device_revision
  );
end
$function$;

create function device_adapter.adapter_rotate_device_token(
  p_account_id uuid, p_credential_digest text, p_key_version integer,
  p_expected_device_revision bigint, p_expected_token_generation bigint,
  p_new_credential_digest text, p_new_key_version integer, p_new_scopes text[],
  p_new_expires_at timestamp with time zone
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(1397442892, 1145132372);
  perform private.device_auth_assert_legacy_authority_enabled();
  if coalesce((select auth.jwt()) ->> 'role', '') <> 'service_role' then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;
  return device_adapter.adapter_rotate_device_token_legacy_pre_cutover(
    p_account_id, p_credential_digest, p_key_version, p_expected_device_revision,
    p_expected_token_generation, p_new_credential_digest, p_new_key_version,
    p_new_scopes, p_new_expires_at
  );
end
$function$;

create function device_adapter.adapter_revoke_device_token(
  p_account_id uuid, p_credential_digest text, p_key_version integer,
  p_expected_device_revision bigint, p_expected_token_generation bigint
)
returns boolean language plpgsql security definer set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(1397442892, 1145132372);
  perform private.device_auth_assert_legacy_authority_enabled();
  if coalesce((select auth.jwt()) ->> 'role', '') <> 'service_role' then
    raise exception 'device authority unavailable' using errcode = '42501';
  end if;
  return device_adapter.adapter_revoke_device_token_legacy_pre_cutover(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation
  );
end
$function$;

alter function private.register_my_device(text,text,text,text) owner to postgres;
alter function private.rotate_my_device(text,bigint) owner to postgres;
alter function private.revoke_my_device(text,bigint) owner to postgres;
alter function device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint) owner to postgres;
alter function device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone) owner to postgres;
alter function device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint) owner to postgres;

revoke all privileges on function private.register_my_device(text,text,text,text) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.rotate_my_device(text,bigint) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.revoke_my_device(text,bigint) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint) from public, anon, authenticated, service_role, skillmap_vault_definer;

grant execute on function private.register_my_device(text,text,text,text) to authenticated;
grant execute on function private.rotate_my_device(text,bigint) to authenticated;
grant execute on function private.revoke_my_device(text,bigint) to authenticated;
grant execute on function device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint) to service_role;
grant execute on function device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone) to service_role;
grant execute on function device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint) to service_role;

commit;
