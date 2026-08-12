begin;

set local search_path = '';

-- M3.10 owner device management is deliberately installed behind the same
-- feature-off posture as the preceding DeviceAuth migrations.  The API
-- functions exist for schema review and the later cutover migration, but no
-- request role can execute them yet.

grant usage on schema private to skillmap_device_auth_definer;
grant create on schema private, api to skillmap_device_auth_definer;
grant select, update on private.devices to skillmap_device_auth_definer;
grant select, update on private.device_auth_key_bindings to skillmap_device_auth_definer;
grant select, update on private.device_auth_token_families to skillmap_device_auth_definer;
grant select, update on private.device_auth_access_tokens to skillmap_device_auth_definer;
grant select, update on private.device_auth_refresh_generations to skillmap_device_auth_definer;
grant select, update on private.device_tokens to skillmap_device_auth_definer;

-- Exact UID bridge required by the owner RPCs. No request role, service role,
-- or PUBLIC receives this helper, and no schema-wide authority is granted.
revoke all privileges on function private.current_request_uid() from public, anon, authenticated, service_role;
grant execute on function private.current_request_uid() to skillmap_device_auth_definer;
grant execute on function private.normalize_device_scopes(text[]) to skillmap_device_auth_definer;
grant execute on function private.device_scopes_are_canonical(text[]) to skillmap_device_auth_definer;

-- Resolve the signed top-level role claim through a postgres-owned helper, as
-- the NOLOGIN definer intentionally has no USAGE on provider schema auth.
-- This uses the signed top-level role claim rather than a deprecated role
-- bridge for the M3.10 owner RPCs while preserving the request JWT context.
create function private.current_device_auth_jwt_role()
returns text
language sql stable security definer set search_path = ''
as $function$
  select (select auth.jwt()) ->> 'role'
$function$;

revoke all privileges on function private.current_device_auth_jwt_role() from public, anon, authenticated, service_role;
grant execute on function private.current_device_auth_jwt_role() to skillmap_device_auth_definer;
alter function private.current_device_auth_jwt_role() owner to postgres;

drop policy if exists device_auth_owner_devices_definer on private.devices;
create policy device_auth_owner_devices_definer
  on private.devices as permissive for all to skillmap_device_auth_definer
  using (true) with check (true);

drop policy if exists device_auth_owner_tokens_definer on private.device_tokens;
create policy device_auth_owner_tokens_definer
  on private.device_tokens as permissive for all to skillmap_device_auth_definer
  using (true) with check (true);

drop policy if exists device_auth_owner_keys_definer on private.device_auth_key_bindings;
create policy device_auth_owner_keys_definer
  on private.device_auth_key_bindings as permissive for all to skillmap_device_auth_definer
  using (true) with check (true);

-- The M2.11 trigger froze display_name along with identity fields.  The only
-- forward exception is this NOLOGIN definer, which must still supply the
-- server-owned revision increment.  Direct browser table writes remain
-- impossible because the table has FORCE RLS and no request-role grants.
create or replace function private.enforce_device_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_authority_changed boolean;
  v_display_changed boolean;
begin
  new.display_name := nullif(normalize(pg_catalog.btrim(new.display_name), NFC), ''::text);
  new.locale := nullif(pg_catalog.btrim(new.locale), '');
  new.platform := pg_catalog.lower(new.platform);

  if new.display_name is not null
    and (pg_catalog.octet_length(new.display_name) not between 1 and 64
      or new.display_name ~ '[[:cntrl:]]')
  then
    raise exception 'device display name is outside the normalized UTF-8 bound'
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    v_display_changed := new.display_name is distinct from old.display_name;

    if new.id is distinct from old.id
      or new.public_id is distinct from old.public_id
      or new.account_id is distinct from old.account_id
      or new.platform is distinct from old.platform
      or new.connector_version is distinct from old.connector_version
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

    if v_display_changed then
      if current_user <> 'skillmap_device_auth_definer'
        or new.revision is distinct from old.revision + 1
        or v_authority_changed
      then
        raise exception 'device display name update is not authorized'
          using errcode = '42501';
      end if;
    elsif v_authority_changed then
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

-- No internal coordinate is returned by this helper.  It joins only inside
-- the definer transaction and emits the bounded owner projection used by all
-- three public RPCs.
create or replace function private.device_auth_owner_device_projection(p_device_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_device private.devices%rowtype;
  v_family private.device_auth_token_families%rowtype;
  v_expiry timestamptz;
  v_state text;
begin
  select d.* into v_device
    from private.devices d
   where d.id = p_device_id;
  if not found then return null; end if;

  select f.* into v_family
    from private.device_auth_token_families f
   where f.account_id = v_device.account_id
     and f.device_public_id = v_device.public_id
   order by f.issued_at desc, f.family_id desc
   limit 1;

  v_expiry := case
    when v_family.family_id is not null then least(
      v_family.idle_expires_at,
      v_family.absolute_expires_at,
      v_device.expires_at
    )
    else v_device.expires_at
  end;

  -- M3 web/CLI contract: an unexpired authority at or below seven days is
  -- expiring; the threshold is deterministic and never client supplied.
  v_state := v_device.state;
  if v_state = 'active' and v_family.family_id is not null then
    if v_family.state in ('revoked', 'expired') then
      v_state := v_family.state;
    elsif v_expiry is not null then
      if v_expiry <= pg_catalog.statement_timestamp() then
        v_state := 'expired';
      elsif v_expiry <= pg_catalog.statement_timestamp() + pg_catalog.make_interval(days => 7) then
        v_state := 'expiring';
      end if;
    end if;
  elsif v_state = 'active' and v_expiry is not null
  then
    if v_expiry <= pg_catalog.statement_timestamp() then
      v_state := 'expired';
    elsif v_expiry <= pg_catalog.statement_timestamp() + pg_catalog.make_interval(days => 7) then
      v_state := 'expiring';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'public_id_suffix', pg_catalog.right(v_device.public_id, 8),
    'display_name', coalesce(v_device.display_name, 'Unnamed device'),
    'platform', v_device.platform,
    'created_at', v_device.issued_at,
    'last_seen_at', v_device.last_used_at,
    'expires_at', v_expiry,
    'state', v_state,
    'scopes', coalesce(v_family.scopes, '{}'::text[]),
    'revision', v_device.revision
  );
end
$function$;

revoke all on function private.device_auth_owner_device_projection(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.device_auth_owner_device_projection(uuid)
  to skillmap_device_auth_definer;
alter function private.device_auth_owner_device_projection(uuid)
  owner to skillmap_device_auth_definer;

create or replace function api.device_auth_list_my_devices_v1()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_devices jsonb;
begin
  if coalesce((select private.current_device_auth_jwt_role()), '') <> 'authenticated'
    or (select private.current_request_uid()) is null
    or not (select private.current_device_auth_is_permanent_user())
  then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  v_account_id := (select private.current_request_uid());

  select coalesce(pg_catalog.jsonb_agg(
    private.device_auth_owner_device_projection(d.id)
    order by d.issued_at, d.public_id
  ), '[]'::jsonb)
    into v_devices
    from private.devices d
   where d.account_id = v_account_id;
  return pg_catalog.jsonb_build_object('status', 'ok', 'devices', v_devices);
end
$function$;

create or replace function api.device_auth_rename_my_device_v1(
  p_public_id_suffix text,
  p_display_name text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_device private.devices%rowtype;
  v_display_name text;
  v_matches integer;
begin
  if coalesce((select private.current_device_auth_jwt_role()), '') <> 'authenticated'
    or (select private.current_request_uid()) is null
    or not (select private.current_device_auth_is_permanent_user())
  then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  v_account_id := (select private.current_request_uid());
  v_display_name := nullif(normalize(pg_catalog.btrim(p_display_name), NFC), ''::text);
  if p_public_id_suffix is null or p_public_id_suffix !~ '^[0-9a-f]{8}$'
    or v_display_name is null
    or pg_catalog.octet_length(v_display_name) not between 1 and 64
    or v_display_name ~ '[[:cntrl:]]'
    or p_expected_revision is null or p_expected_revision < 1
  then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_account_id::text, 7461));
  select count(*)::integer into v_matches
    from private.devices d
   where d.account_id = v_account_id
     and pg_catalog.right(d.public_id, 8) = p_public_id_suffix;
  if v_matches <> 1 then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  select d.* into v_device
    from private.devices d
   where d.account_id = v_account_id
     and pg_catalog.right(d.public_id, 8) = p_public_id_suffix
   for update;
  if v_device.revision <> p_expected_revision
    or v_device.state in ('revoked', 'compromised')
  then
    return pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'device', private.device_auth_owner_device_projection(v_device.id)
    );
  end if;

  update private.devices
     set display_name = v_display_name,
         revision = private.devices.revision + 1
   where id = v_device.id and account_id = v_account_id;
  select d.* into v_device from private.devices d where d.id = v_device.id;
  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'device', private.device_auth_owner_device_projection(v_device.id)
  );
end
$function$;

create or replace function api.device_auth_revoke_my_device_v1(
  p_public_id_suffix text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_device private.devices%rowtype;
  v_now timestamptz;
  v_matches integer;
begin
  if coalesce((select private.current_device_auth_jwt_role()), '') <> 'authenticated'
    or (select private.current_request_uid()) is null
    or not (select private.current_device_auth_is_permanent_user())
  then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  v_account_id := (select private.current_request_uid());
  if p_public_id_suffix is null or p_public_id_suffix !~ '^[0-9a-f]{8}$'
    or p_expected_revision is null or p_expected_revision < 1
  then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_account_id::text, 7461));
  select count(*)::integer into v_matches
    from private.devices d
   where d.account_id = v_account_id
     and pg_catalog.right(d.public_id, 8) = p_public_id_suffix;
  if v_matches <> 1 then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  select d.* into v_device
    from private.devices d
   where d.account_id = v_account_id
     and pg_catalog.right(d.public_id, 8) = p_public_id_suffix
   for update;
  if v_device.revision <> p_expected_revision then
    return pg_catalog.jsonb_build_object(
      'status', 'conflict',
      'device', private.device_auth_owner_device_projection(v_device.id)
    );
  end if;
  if v_device.state in ('revoked', 'compromised') then
    return pg_catalog.jsonb_build_object(
      'status', 'ok',
      'device', private.device_auth_owner_device_projection(v_device.id)
    );
  end if;

  v_now := pg_catalog.statement_timestamp();
  -- One transaction, one exact public device lineage.  No account-wide or
  -- account-wide revoke operation exists: every mutation below is joined through this row's
  -- public ID and account ownership.
  update private.device_auth_access_tokens a
     set revoked_at = coalesce(a.revoked_at, v_now)
   where a.family_id in (
     select f.family_id from private.device_auth_token_families f
      where f.account_id = v_account_id and f.device_public_id = v_device.public_id
   );
  update private.device_auth_refresh_generations r
     set revoked_at = coalesce(r.revoked_at, v_now)
   where r.family_id in (
     select f.family_id from private.device_auth_token_families f
      where f.account_id = v_account_id and f.device_public_id = v_device.public_id
   );
  update private.device_auth_token_families f
     set state = 'revoked', revoked_at = coalesce(f.revoked_at, v_now)
   where f.account_id = v_account_id and f.device_public_id = v_device.public_id;
  update private.device_auth_key_bindings k
     set is_active = false, retired_at = coalesce(k.retired_at, v_now)
   where k.device_id in (
     select f.device_id from private.device_auth_token_families f
      where f.account_id = v_account_id and f.device_public_id = v_device.public_id
   ) and k.is_active;
  update private.device_tokens t
     set revoked_at = coalesce(t.revoked_at, v_now)
   where t.account_id = v_account_id and t.device_id = v_device.id
     and t.revoked_at is null;
  update private.devices d
     set state = 'revoked', revoked_at = v_now, revision = d.revision + 1
   where d.id = v_device.id and d.account_id = v_account_id;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'device', private.device_auth_owner_device_projection(v_device.id)
  );
end
$function$;

alter function api.device_auth_list_my_devices_v1() owner to skillmap_device_auth_definer;
alter function api.device_auth_rename_my_device_v1(text,text,bigint) owner to skillmap_device_auth_definer;
alter function api.device_auth_revoke_my_device_v1(text,bigint) owner to skillmap_device_auth_definer;

-- Explicit feature-off posture: no PUBLIC, anon, authenticated, or
-- service_role execution until the separately gated atomic cutover.
revoke all on function api.device_auth_list_my_devices_v1() from public, anon, authenticated, service_role;
revoke all on function api.device_auth_rename_my_device_v1(text,text,bigint) from public, anon, authenticated, service_role;
revoke all on function api.device_auth_revoke_my_device_v1(text,bigint) from public, anon, authenticated, service_role;

revoke create on schema private, api from skillmap_device_auth_definer;

commit;
