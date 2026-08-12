begin;

set local search_path = '';

-- M3.04 browser confirmation. This migration is intentionally additive and
-- feature-off: the only exposed objects are the two owner RPCs below. Raw
-- user/device/exchange codes are never stored; the review handle is random,
-- short-lived, account-bound, and stored only as a digest.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'skillmap_device_auth_definer') then
    create role skillmap_device_auth_definer
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$$;

-- The migration runner must be able to transfer ownership to the NOLOGIN
-- definer without granting that role login, inheritance, or broad privileges.
grant skillmap_device_auth_definer to postgres;
grant usage, create on schema private to skillmap_device_auth_definer;
grant usage, create on schema api to skillmap_device_auth_definer;

alter table private.device_auth_pairings
  add column if not exists confirmation_revision bigint not null default 0,
  add column if not exists confirmed_user_id uuid,
  add column if not exists confirmation_attempts integer not null default 0;

create table if not exists private.device_auth_confirmation_handles (
  handle_digest text primary key,
  pairing_id uuid not null references private.device_auth_pairings(pairing_id),
  user_id uuid not null,
  confirmation_revision bigint not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  outcome_json jsonb,
  constraint device_auth_confirmation_handles_digest_check
    check (handle_digest ~ '^[0-9a-f]{64}$'),
  constraint device_auth_confirmation_handles_revision_check
    check (confirmation_revision > 0),
  constraint device_auth_confirmation_handles_expiry_check
    check (expires_at > created_at),
  constraint device_auth_confirmation_handles_outcome_check
    check (outcome_json is null or outcome_json ? 'status')
);

create index if not exists device_auth_confirmation_handles_pairing_idx
  on private.device_auth_confirmation_handles (pairing_id, user_id, confirmation_revision);

create table if not exists private.device_auth_confirmation_attempts (
  user_id uuid primary key,
  window_start timestamptz not null default pg_catalog.statement_timestamp(),
  attempt_count integer not null default 0,
  constraint device_auth_confirmation_attempts_count_check check (attempt_count >= 0)
);

alter table private.device_auth_confirmation_handles enable row level security;
alter table private.device_auth_confirmation_handles force row level security;
alter table private.device_auth_confirmation_attempts enable row level security;
alter table private.device_auth_confirmation_attempts force row level security;

grant usage on schema private to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_pairings to skillmap_device_auth_definer;
grant select on private.device_auth_code_digests to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_confirmation_handles to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_confirmation_attempts to skillmap_device_auth_definer;

drop policy if exists device_auth_pairings_confirmation_definer on private.device_auth_pairings;
create policy device_auth_pairings_confirmation_definer
  on private.device_auth_pairings
  as permissive for all to skillmap_device_auth_definer
  using (true) with check (true);
drop policy if exists device_auth_code_digests_confirmation_definer on private.device_auth_code_digests;
create policy device_auth_code_digests_confirmation_definer
  on private.device_auth_code_digests
  as permissive for select to skillmap_device_auth_definer
  using (true);
drop policy if exists device_auth_confirmation_handles_definer on private.device_auth_confirmation_handles;
create policy device_auth_confirmation_handles_definer
  on private.device_auth_confirmation_handles
  as permissive for all to skillmap_device_auth_definer
  using (true) with check (true);
drop policy if exists device_auth_confirmation_attempts_definer on private.device_auth_confirmation_attempts;
create policy device_auth_confirmation_attempts_definer
  on private.device_auth_confirmation_attempts
  as permissive for all to skillmap_device_auth_definer
  using (true) with check (true);

-- Reuse the accepted postgres-owned identity bridge. The NOLOGIN definer never
-- receives USAGE on provider-owned schema auth; only these narrowly granted
-- helpers can resolve the caller JWT while search_path remains empty.
grant execute on function private.current_request_uid() to skillmap_device_auth_definer;
grant execute on function private.current_request_role() to skillmap_device_auth_definer;

create or replace function private.current_device_auth_is_permanent_user()
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select coalesce((select auth.jwt()) -> 'is_anonymous', 'true'::jsonb) = 'false'::jsonb
$function$;

revoke all privileges on function private.current_device_auth_is_permanent_user() from public, anon, authenticated, service_role;
grant execute on function private.current_device_auth_is_permanent_user() to skillmap_device_auth_definer;
alter function private.current_device_auth_is_permanent_user() owner to postgres;

create or replace function private.device_auth_confirmation_authz()
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select coalesce((select private.current_request_role()), '') = 'authenticated'
    and (select private.current_request_uid()) is not null
    and (select private.current_device_auth_is_permanent_user());
$function$;

revoke all on function private.device_auth_confirmation_authz() from public, anon, authenticated, service_role;
grant execute on function private.device_auth_confirmation_authz() to skillmap_device_auth_definer;
alter function private.device_auth_confirmation_authz() owner to skillmap_device_auth_definer;

create or replace function api.device_auth_review_my_pairing_v1(p_user_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid := (select private.current_request_uid());
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_digest text;
  v_pairing_id uuid;
  v_revision bigint;
  v_handle text;
  v_handle_digest text;
  v_attempts integer;
  v_window timestamptz;
  v_pairing private.device_auth_pairings%rowtype;
begin
  if not private.device_auth_confirmation_authz() then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  if v_user_id is null or p_user_code is null
     or p_user_code !~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$' then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  insert into private.device_auth_confirmation_attempts(user_id, window_start, attempt_count)
  values (v_user_id, v_now, 1)
  on conflict (user_id) do update set
    attempt_count = case
      when private.device_auth_confirmation_attempts.window_start > v_now - pg_catalog.make_interval(mins => 10)
        then private.device_auth_confirmation_attempts.attempt_count + 1
      else 1
    end,
    window_start = case
      when private.device_auth_confirmation_attempts.window_start > v_now - pg_catalog.make_interval(mins => 10)
        then private.device_auth_confirmation_attempts.window_start
      else v_now
    end
  returning attempt_count, window_start into v_attempts, v_window;
  if v_attempts > 10 then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_user_code, 'UTF8')), 'hex');
  select cd.pairing_id into v_pairing_id
    from private.device_auth_code_digests cd
   where cd.digest_kind = 'user_code' and cd.digest_hex = v_digest
   limit 1;
  if v_pairing_id is null then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  select * into v_pairing
    from private.device_auth_pairings p
   where p.pairing_id = v_pairing_id
   for update;
  if not found or v_pairing.state <> 'pending' or v_pairing.confirmed_user_id is not null then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  if v_pairing.expires_at <= v_now then
    update private.device_auth_pairings
       set state = 'expired', status_reason = 'expired'
     where pairing_id = v_pairing_id and state = 'pending';
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;

  v_revision := v_pairing.confirmation_revision + 1;
  v_handle := pg_catalog.replace(pg_catalog.replace(pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(16), 'base64'), '='), '+', '-'), '/', '_');
  v_handle_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_handle, 'UTF8')), 'hex');
  update private.device_auth_pairings
     set confirmation_revision = v_revision,
         confirmation_attempts = confirmation_attempts + 1
   where pairing_id = v_pairing_id;
  insert into private.device_auth_confirmation_handles(
    handle_digest, pairing_id, user_id, confirmation_revision, created_at, expires_at
  ) values (
    v_handle_digest, v_pairing_id, v_user_id, v_revision, v_now,
    least(v_pairing.expires_at, v_now + pg_catalog.make_interval(mins => 5))
  );
  return pg_catalog.jsonb_build_object(
    'status', 'reviewed',
    'confirmation_handle', v_handle,
    'confirmation_revision', v_revision,
    'device', pg_catalog.jsonb_build_object(
      'name', coalesce(nullif(pg_catalog.btrim(v_pairing.display_name), ''), 'Connector'),
      'platform', v_pairing.platform,
      'connector_version', v_pairing.connector_version,
      'scopes', v_pairing.requested_scopes
    )
  );
end
$function$;

alter function api.device_auth_review_my_pairing_v1(text) owner to skillmap_device_auth_definer;

create or replace function api.device_auth_confirm_my_pairing_v1(
  p_confirmation_handle text,
  p_confirmation_revision bigint,
  p_decision text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid := (select private.current_request_uid());
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_digest text;
  v_pairing_id uuid;
  v_status text;
  v_outcome jsonb;
  v_handle private.device_auth_confirmation_handles%rowtype;
  v_pairing private.device_auth_pairings%rowtype;
begin
  if not private.device_auth_confirmation_authz() then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  if p_confirmation_handle is null or p_confirmation_handle !~ '^[A-Za-z0-9_-]{22}$'
     or p_confirmation_revision is null or p_confirmation_revision < 1
     or p_decision not in ('approve', 'deny') then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_confirmation_handle, 'UTF8')), 'hex');
  select * into v_handle
    from private.device_auth_confirmation_handles h
   where h.handle_digest = v_digest and h.user_id = v_user_id
   for update;
  if not found or v_handle.confirmation_revision <> p_confirmation_revision then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  if v_handle.used_at is not null then
    return coalesce(v_handle.outcome_json, pg_catalog.jsonb_build_object('status', 'unavailable'));
  end if;
  if v_handle.expires_at <= v_now then
    v_outcome := pg_catalog.jsonb_build_object('status', 'expired');
    update private.device_auth_confirmation_handles
       set used_at = v_now, outcome_json = v_outcome
     where handle_digest = v_digest;
    return v_outcome;
  end if;

  select * into v_pairing from private.device_auth_pairings p
   where p.pairing_id = v_handle.pairing_id for update;
  if not found or v_pairing.confirmation_revision <> p_confirmation_revision then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  if v_pairing.expires_at <= v_now then
    update private.device_auth_pairings set state = 'expired', status_reason = 'expired'
      where pairing_id = v_pairing.pairing_id and state = 'pending';
    v_status := 'expired';
  elsif v_pairing.state = 'pending' and v_pairing.confirmed_user_id is null then
    v_status := case when p_decision = 'approve' then 'approved' else 'denied' end;
    update private.device_auth_pairings
       set state = v_status, status_reason = case when p_decision = 'approve' then null else 'owner_denied' end,
           confirmed_user_id = v_user_id, confirmed_at = v_now
     where pairing_id = v_pairing.pairing_id and state = 'pending' and confirmed_user_id is null;
  else
    v_status := case when v_pairing.state in ('approved','granted') then 'approved' when v_pairing.state = 'denied' then 'denied' else 'unavailable' end;
  end if;
  v_outcome := pg_catalog.jsonb_build_object('status', v_status);
  update private.device_auth_confirmation_handles
     set used_at = v_now, outcome_json = v_outcome
   where handle_digest = v_digest and used_at is null;
  return v_outcome;
end
$function$;

alter function api.device_auth_confirm_my_pairing_v1(text,bigint,text) owner to skillmap_device_auth_definer;

-- M3.04 remains feature-OFF. The final cutover migration may grant these exact
-- owner RPCs; this foundation migration exposes neither RPC to request roles.
revoke all on function api.device_auth_review_my_pairing_v1(text) from public, anon, authenticated, service_role;
revoke all on function api.device_auth_confirm_my_pairing_v1(text,bigint,text) from public, anon, authenticated, service_role;

revoke all privileges on table private.device_auth_confirmation_handles from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_confirmation_attempts from public, anon, authenticated, service_role;

commit;
