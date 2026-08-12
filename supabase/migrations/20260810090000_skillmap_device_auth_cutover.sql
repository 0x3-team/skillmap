begin;

set local search_path = '';

-- M3.02 final cutover.  This is deliberately forward-only.  The exclusive
-- lock waits for every shared-lock legacy call, then the authority flag,
-- replacement grants, legacy revokes, and PostgREST reload notification are
-- committed by this one transaction or none of them are.

select pg_catalog.pg_advisory_xact_lock(1397442892, 1145132372);

do $preflight$
declare
  v_signature text;
  v_oid oid;
  v_owner text;
  v_expected_owner text;
  v_enabled boolean;
  v_revision bigint;
  v_count integer;
  v_relname text;
begin
  if current_user is distinct from 'postgres' then
    raise exception 'M3.02 cutover preflight failed: migration principal is %, expected postgres', current_user using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'skillmap_device_auth_definer') then
    raise exception 'M3.02 cutover preflight failed: skillmap_device_auth_definer is missing' using errcode = 'P0001';
  end if;

  select count(*)::integer, bool_and(c.legacy_device_authority_enabled), min(c.revision)
    into v_count, v_enabled, v_revision
    from private.device_auth_authority_control c
   where c.control_key = 'legacy_device_authority';
  if v_count <> 1 or v_enabled is distinct from true or v_revision <> 1 then
    raise exception 'M3.02 cutover preflight failed: authority flag is not true at revision 1' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from private.device_auth_cutover_provenance p
     where p.artifact_id = 'm3-02-device-auth-replacement-aware-disabled'
       and p.rollback_floor_artifact_id = 'm3-02-device-auth-replacement-aware-disabled'
       and p.feature_ready
  ) then
    raise exception 'M3.02 cutover preflight failed: accepted replacement-aware rollback floor is missing' using errcode = 'P0001';
  end if;

  -- A live legacy token is not safely inferable into the P-256/family
  -- authority.  Stop for a separately accepted revoke-and-re-pair procedure.
  if to_regclass('private.device_tokens') is not null and exists (
    select 1 from private.device_tokens t
     where t.revoked_at is null
       and (t.expires_at is null or t.expires_at > pg_catalog.statement_timestamp())
  ) then
    raise exception 'M3.02 cutover preflight failed: live legacy device token exists' using errcode = 'P0001';
  end if;
  if to_regclass('private.import_sessions') is not null and exists (
    select 1 from private.import_sessions s where s.state = 'in_progress'
  ) then
    raise exception 'M3.02 cutover preflight failed: nonterminal legacy import operation exists' using errcode = 'P0001';
  end if;

  -- Every replacement RPC is SECURITY DEFINER with an empty search path.  The
  -- initiation function is intentionally owned by postgres; every later
  -- transition is owned by the dedicated NOLOGIN definer role.
  foreach v_signature in array array[
    'api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)',
    'api.device_auth_review_my_pairing_v1(text)',
    'api.device_auth_confirm_my_pairing_v1(text,bigint,text)',
    'api.device_auth_get_active_key_v1(text)',
    'api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)',
    'api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)',
    'api.device_auth_refresh_context_v1(text,text)',
    'api.device_auth_refresh_fail_closed_v1(text,text)',
    'api.device_auth_expire_v1(bigint,integer)',
    'api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer)',
    'api.device_auth_get_rotation_receipt_v1(text,text,integer,text)',
    'api.device_auth_rotate_key_v1(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,integer)',
    'api.device_auth_get_revoke_key_v1(text,text,text,text)',
    'api.device_auth_cancel_v1(text,text,text,text,text,text,text,text,text,text,text)',
    'api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text)',
    'api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text)',
    'api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)',
    'api.device_auth_list_my_devices_v1()',
    'api.device_auth_rename_my_device_v1(text,text,bigint)',
    'api.device_auth_revoke_my_device_v1(text,bigint)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then
      raise exception 'M3.02 cutover preflight failed: missing replacement %', v_signature using errcode = 'P0001';
    end if;
    select r.rolname into v_owner
      from pg_catalog.pg_proc p
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = v_oid;
    v_expected_owner := case when v_signature like 'api.device_auth_initiate_v1(%' then 'postgres' else 'skillmap_device_auth_definer' end;
    if v_owner is distinct from v_expected_owner then
      raise exception 'M3.02 cutover preflight failed: % owner is %, expected %', v_signature, v_owner, v_expected_owner using errcode = 'P0001';
    end if;
    if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid)
       or (select coalesce(p.proconfig, '{}'::text[]) from pg_catalog.pg_proc p where p.oid = v_oid)
          is distinct from array['search_path=""']::text[] then
      raise exception 'M3.02 cutover preflight failed: % is not an empty-search-path SECURITY DEFINER', v_signature using errcode = 'P0001';
    end if;
  end loop;

  -- The six compatibility wrappers must still be the exact clean-reset
  -- functions, owned by postgres, with their pre-cutover grants intact.
  foreach v_signature in array array[
    'private.register_my_device(text,text,text,text)',
    'private.rotate_my_device(text,bigint)',
    'private.revoke_my_device(text,bigint)',
    'device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint)',
    'device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone)',
    'device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    if v_oid is null
       or (select r.rolname from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner where p.oid = v_oid) is distinct from 'postgres'
       or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_oid)
       or (select coalesce(p.proconfig, '{}'::text[]) from pg_catalog.pg_proc p where p.oid = v_oid) is distinct from array['search_path=""']::text[] then
      raise exception 'M3.02 cutover preflight failed: fenced wrapper definition drift for %', v_signature using errcode = 'P0001';
    end if;
    if v_signature like 'private.%' then
      if not has_function_privilege('authenticated', v_signature, 'execute')
         or has_function_privilege('service_role', v_signature, 'execute') then
        raise exception 'M3.02 cutover preflight failed: owner wrapper grant drift for %', v_signature using errcode = 'P0001';
      end if;
    elsif not has_function_privilege('service_role', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'M3.02 cutover preflight failed: adapter wrapper grant drift for %', v_signature using errcode = 'P0001';
    end if;
  end loop;

  -- All DeviceAuth state and the reused devices aggregate must be FORCE RLS.
  foreach v_relname in array array[
    'device_auth_key_bindings', 'device_auth_code_digests', 'device_auth_pairings',
    'device_auth_proof_nonces', 'device_auth_idempotency_receipts', 'device_auth_rate_buckets',
    'device_auth_confirmation_handles', 'device_auth_confirmation_attempts',
    'device_auth_token_families', 'device_auth_access_tokens', 'device_auth_refresh_generations',
    'device_auth_refresh_replay_receipts', 'device_auth_refresh_replay_payloads',
    'device_auth_key_rotation_receipts', 'devices'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private' and c.relname = v_relname
         and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception 'M3.02 cutover preflight failed: private.% is not FORCE RLS', v_relname using errcode = 'P0001';
    end if;
  end loop;

  if pg_catalog.to_regclass('private.device_auth_key_bindings_one_active_per_device') is null
     or pg_catalog.to_regclass('private.device_auth_confirmation_handles_pairing_idx') is null then
    raise exception 'M3.02 cutover preflight failed: required replacement index is missing' using errcode = 'P0001';
  end if;

  -- No request role receives direct data privileges.  SECURITY DEFINER RPCs
  -- are the only replacement authority surface.
  foreach v_relname in array array[
    'device_auth_key_bindings', 'device_auth_code_digests', 'device_auth_pairings',
    'device_auth_proof_nonces', 'device_auth_idempotency_receipts', 'device_auth_rate_buckets',
    'device_auth_confirmation_handles', 'device_auth_confirmation_attempts',
    'device_auth_token_families', 'device_auth_access_tokens', 'device_auth_refresh_generations',
    'device_auth_refresh_replay_receipts', 'device_auth_refresh_replay_payloads',
    'device_auth_key_rotation_receipts'
  ] loop
    if has_table_privilege('anon', format('private.%I', v_relname), 'select,insert,update,delete')
       or has_table_privilege('authenticated', format('private.%I', v_relname), 'select,insert,update,delete')
       or has_table_privilege('service_role', format('private.%I', v_relname), 'select,insert,update,delete') then
      raise exception 'M3.02 cutover preflight failed: request-role table privilege on private.%', v_relname using errcode = 'P0001';
    end if;
  end loop;
end
$preflight$;

do $flip$
begin
  update private.device_auth_authority_control
     set legacy_device_authority_enabled = false,
         revision = revision + 1,
         changed_at = pg_catalog.statement_timestamp()
   where control_key = 'legacy_device_authority'
     and legacy_device_authority_enabled
     and revision = 1;
  if not found then
    raise exception 'M3.02 cutover failed: authority flag was not true at revision 1' using errcode = 'P0001';
  end if;
end
$flip$;

-- Replacement service surface.  Each grant is explicit; there is no broad
-- schema or ALL-FUNCTIONS grant.  expire_v1 is the maintenance-only grant.
grant execute on function api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer) to service_role;
grant execute on function api.device_auth_get_active_key_v1(text) to service_role;
grant execute on function api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer) to service_role;
grant execute on function api.device_auth_refresh_context_v1(text,text) to service_role;
grant execute on function api.device_auth_refresh_fail_closed_v1(text,text) to service_role;
grant execute on function api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer) to service_role;
grant execute on function api.device_auth_get_rotation_receipt_v1(text,text,integer,text) to service_role;
grant execute on function api.device_auth_rotate_key_v1(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,integer) to service_role;
grant execute on function api.device_auth_get_revoke_key_v1(text,text,text,text) to service_role;
grant execute on function api.device_auth_cancel_v1(text,text,text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text) to service_role;
grant execute on function api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text) to service_role;
grant execute on function api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function api.device_auth_expire_v1(bigint,integer) to service_role;

-- Permanent authenticated owner surface, including the pairing review used by
-- the browser confirmation flow.  Every function performs its own claim check.
grant execute on function api.device_auth_review_my_pairing_v1(text) to authenticated;
grant execute on function api.device_auth_confirm_my_pairing_v1(text,bigint,text) to authenticated;
grant execute on function api.device_auth_list_my_devices_v1() to authenticated;
grant execute on function api.device_auth_rename_my_device_v1(text,text,bigint) to authenticated;
grant execute on function api.device_auth_revoke_my_device_v1(text,bigint) to authenticated;

-- The exact six legacy grants are removed only after the exclusive lock is
-- held.  Import adapters remain untouched for the later M4 displacement.
revoke all privileges on function private.register_my_device(text,text,text,text) from public, anon, authenticated, service_role;
revoke all privileges on function private.rotate_my_device(text,bigint) from public, anon, authenticated, service_role;
revoke all privileges on function private.revoke_my_device(text,bigint) from public, anon, authenticated, service_role;
revoke all privileges on function device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint) from public, anon, authenticated, service_role;
revoke all privileges on function device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone) from public, anon, authenticated, service_role;
revoke all privileges on function device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint) from public, anon, authenticated, service_role;

-- Refresh remains unavailable until an accepted replay-key provider is
-- configured by runtime operations.  This schema migration creates no key,
-- secret, replay row, or provider credential.
notify pgrst, 'reload schema';

commit;
