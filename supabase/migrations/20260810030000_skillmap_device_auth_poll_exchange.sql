begin;

set local search_path = '';

-- M3.05 poll/exchange server half. This migration is additive and remains
-- feature-OFF: the owner role and SQL objects exist for controlled local
-- tests, but no request role receives EXECUTE. Raw exchange/access/refresh
-- values never enter Postgres; only purpose-separated digests do.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'skillmap_device_auth_definer') then
    create role skillmap_device_auth_definer nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$$;

grant skillmap_device_auth_definer to postgres;
grant usage, create on schema private to skillmap_device_auth_definer;
grant usage, create on schema api to skillmap_device_auth_definer;

alter table private.device_auth_pairings
  add column if not exists poll_interval_seconds integer not null default 5,
  add column if not exists poll_attempts integer not null default 0,
  add column if not exists last_polled_at timestamptz,
  add column if not exists exchange_code_issued_at timestamptz;
alter table private.device_auth_pairings
  drop constraint if exists device_auth_pairings_poll_interval_check,
  drop constraint if exists device_auth_pairings_poll_attempts_check;
alter table private.device_auth_pairings
  add constraint device_auth_pairings_poll_interval_check check (poll_interval_seconds between 1 and 60),
  add constraint device_auth_pairings_poll_attempts_check check (poll_attempts >= 0);

alter table private.device_auth_idempotency_receipts
  drop constraint if exists device_auth_idempotency_receipts_op_check;
alter table private.device_auth_idempotency_receipts
  add constraint device_auth_idempotency_receipts_op_check
  check (operation in ('initiate','poll','exchange'));

create table if not exists private.device_auth_token_families (
  family_id uuid primary key default pg_catalog.gen_random_uuid(),
  token_family_id text not null unique default ('fam_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  pairing_id uuid not null unique references private.device_auth_pairings(pairing_id),
  account_id uuid not null references auth.users(id) on delete cascade,
  account_public_id text not null,
  device_public_id text not null,
  device_id text not null,
  key_thumbprint text not null,
  proof_suite text not null,
  audience_literal text not null,
  scopes text[] not null,
  current_generation bigint not null default 1,
  state text not null default 'active',
  issued_at timestamptz not null default pg_catalog.statement_timestamp(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint device_auth_token_families_public_id_check check (token_family_id ~ '^fam_[0-9a-f]{32}$'),
  constraint device_auth_token_families_account_public_id_check check (account_public_id ~ '^acct_[0-9a-f]{32}$'),
  constraint device_auth_token_families_device_public_id_check check (device_public_id ~ '^dev_[0-9a-f]{32}$'),
  constraint device_auth_token_families_device_id_check check (device_id ~ '^[A-Za-z0-9_-]{22}$'),
  constraint device_auth_token_families_thumbprint_check check (key_thumbprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint device_auth_token_families_suite_check check (proof_suite = 'skillmap.ecdsa-p256-sha256.v2'),
  constraint device_auth_token_families_audience_check check (audience_literal = 'skillmap.connector.v1'),
  constraint device_auth_token_families_generation_check check (current_generation > 0),
  constraint device_auth_token_families_state_check check (state in ('active','revoked','expired')),
  constraint device_auth_token_families_expiry_check check (idle_expires_at > issued_at and absolute_expires_at >= idle_expires_at),
  constraint device_auth_token_families_scopes_check check (private.device_scopes_are_canonical(scopes))
);

create table if not exists private.device_auth_access_tokens (
  access_token_digest text primary key,
  key_version integer not null,
  family_id uuid not null references private.device_auth_token_families(family_id) on delete cascade,
  generation bigint not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint device_auth_access_tokens_digest_check check (access_token_digest ~ '^hmac-sha256:[0-9a-f]{64}$'),
  constraint device_auth_access_tokens_key_version_check check (key_version > 0),
  constraint device_auth_access_tokens_generation_check check (generation > 0),
  constraint device_auth_access_tokens_expiry_check check (expires_at > issued_at),
  constraint device_auth_access_tokens_family_generation_key unique (family_id, generation)
);

create table if not exists private.device_auth_refresh_generations (
  refresh_token_digest text primary key,
  key_version integer not null,
  family_id uuid not null references private.device_auth_token_families(family_id) on delete cascade,
  generation bigint not null,
  issued_at timestamptz not null,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  replaced_at timestamptz,
  revoked_at timestamptz,
  constraint device_auth_refresh_generations_digest_check check (refresh_token_digest ~ '^hmac-sha256:[0-9a-f]{64}$'),
  constraint device_auth_refresh_generations_key_version_check check (key_version > 0),
  constraint device_auth_refresh_generations_generation_check check (generation > 0),
  constraint device_auth_refresh_generations_expiry_check check (idle_expires_at > issued_at and absolute_expires_at >= idle_expires_at),
  constraint device_auth_refresh_generations_family_generation_key unique (family_id, generation)
);

alter table private.device_auth_token_families enable row level security;
alter table private.device_auth_token_families force row level security;
alter table private.device_auth_access_tokens enable row level security;
alter table private.device_auth_access_tokens force row level security;
alter table private.device_auth_refresh_generations enable row level security;
alter table private.device_auth_refresh_generations force row level security;

grant usage on schema private to skillmap_device_auth_definer;
grant select on private.device_auth_key_bindings to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_pairings to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_code_digests to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_proof_nonces to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_idempotency_receipts to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_token_families to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_access_tokens to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_refresh_generations to skillmap_device_auth_definer;
grant select, insert on private.devices to skillmap_device_auth_definer;
grant usage, select on all sequences in schema private to skillmap_device_auth_definer;

drop policy if exists device_auth_poll_exchange_pairings_definer on private.device_auth_pairings;
create policy device_auth_poll_exchange_pairings_definer on private.device_auth_pairings as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_poll_exchange_keys_definer on private.device_auth_key_bindings;
create policy device_auth_poll_exchange_keys_definer on private.device_auth_key_bindings as permissive for select to skillmap_device_auth_definer using (true);
drop policy if exists device_auth_poll_exchange_codes_definer on private.device_auth_code_digests;
create policy device_auth_poll_exchange_codes_definer on private.device_auth_code_digests as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_poll_exchange_nonces_definer on private.device_auth_proof_nonces;
create policy device_auth_poll_exchange_nonces_definer on private.device_auth_proof_nonces as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_poll_exchange_receipts_definer on private.device_auth_idempotency_receipts;
create policy device_auth_poll_exchange_receipts_definer on private.device_auth_idempotency_receipts as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_token_families_definer on private.device_auth_token_families;
create policy device_auth_token_families_definer on private.device_auth_token_families as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_access_tokens_definer on private.device_auth_access_tokens;
create policy device_auth_access_tokens_definer on private.device_auth_access_tokens as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_refresh_generations_definer on private.device_auth_refresh_generations;
create policy device_auth_refresh_generations_definer on private.device_auth_refresh_generations as permissive for all to skillmap_device_auth_definer using (true) with check (true);

drop policy if exists device_auth_poll_exchange_devices_definer on private.devices;
create policy device_auth_poll_exchange_devices_definer on private.devices as permissive for insert to skillmap_device_auth_definer with check (true);

-- Read-only proof-key lookup. The application verifies the signature against
-- this active binding before it invokes either state-changing RPC; this RPC
-- never consumes a nonce and never returns pairing or token state.
create or replace function api.device_auth_get_active_key_v1(p_device_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_key private.device_auth_key_bindings%rowtype;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$' then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  select * into v_key
    from private.device_auth_key_bindings k
   where k.device_id = p_device_id
     and k.proof_suite = 'skillmap.ecdsa-p256-sha256.v2'
     and k.is_active
   limit 1;
  if not found then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  return pg_catalog.jsonb_build_object(
    'public_key', v_key.public_key,
    'key_thumbprint', v_key.key_thumbprint,
    'proof_suite', v_key.proof_suite
  );
end
$function$;

create or replace function api.device_auth_poll_v1(
  p_device_code_digest text,
  p_device_id text,
  p_audience text,
  p_proof_suite text,
  p_proof_purpose text,
  p_proof_nonce text,
  p_issued_at text,
  p_request_digest text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_pairing private.device_auth_pairings%rowtype;
  v_pairing_id uuid;
  v_receipt private.device_auth_idempotency_receipts%rowtype;
  v_exchange text;
  v_exchange_digest text;
  v_scopes text[];
  v_remaining_seconds integer;
begin
  if p_device_code_digest is null or p_device_code_digest !~ '^[0-9a-f]{64}$'
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_audience is distinct from 'skillmap.connector.v1'
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2'
     or p_proof_purpose is distinct from 'poll'
     or p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$'
     or p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$'
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{22}$' then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('device-auth-poll:' || p_device_id, 7461));
  select * into v_receipt from private.device_auth_idempotency_receipts r
   where r.principal_kind = 'device' and r.principal = p_device_id and r.operation = 'poll' and r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_receipt.request_digest <> p_request_digest then return private.device_auth_error_json('idempotency_conflict', 'The request conflicts with a prior operation.'); end if;
    return v_receipt.outcome_json;
  end if;
  begin
    insert into private.device_auth_proof_nonces(device_id, proof_purpose, nonce, issued_at, expires_at)
    values (p_device_id, 'poll', p_proof_nonce, v_now, v_now + pg_catalog.make_interval(secs => 600));
  exception when unique_violation then
    return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;
  select cd.pairing_id into v_pairing_id from private.device_auth_code_digests cd
   where cd.digest_kind = 'device_code' and cd.digest_hex = p_device_code_digest and cd.device_id = p_device_id limit 1;
  if v_pairing_id is null then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  select * into v_pairing from private.device_auth_pairings p where p.pairing_id = v_pairing_id and p.device_id = p_device_id for update;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  if v_pairing.expires_at <= v_now then
    update private.device_auth_pairings set state = 'expired', status_reason = 'expired' where pairing_id = v_pairing_id and state not in ('denied','cancelled','expired');
    return private.device_auth_error_json('expired_token', 'The authorization grant has expired.');
  end if;
  if v_pairing.state = 'denied' then return private.device_auth_error_json('access_denied', 'Authorization was not granted.'); end if;
  if v_pairing.state in ('cancelled','expired') then return private.device_auth_error_json('expired_token', 'The authorization grant has expired.'); end if;
  if v_pairing.state = 'granted' then return private.device_auth_error_json('already_consumed', 'The authorization grant is no longer available.'); end if;
  if v_pairing.poll_attempts >= 120 then
    update private.device_auth_pairings set state = 'expired', status_reason = 'poll_attempt_limit' where pairing_id = v_pairing_id and state in ('pending','approved');
    return private.device_auth_error_json('expired_token', 'The authorization grant has expired.');
  end if;
  if v_pairing.last_polled_at is not null and v_pairing.last_polled_at + pg_catalog.make_interval(secs => v_pairing.poll_interval_seconds) > v_now then
    update private.device_auth_pairings set poll_attempts = poll_attempts + 1, poll_interval_seconds = least(60, poll_interval_seconds + 5), last_polled_at = v_now where pairing_id = v_pairing_id;
    insert into private.device_auth_idempotency_receipts(principal_kind,principal,operation,idempotency_key,request_digest,outcome_json,created_at,expired_at)
      values ('device',p_device_id,'poll',p_idempotency_key,p_request_digest,private.device_auth_error_json('slow_down','Polling must slow down.',v_pairing.poll_interval_seconds + 5),v_now,v_pairing.expires_at);
    return private.device_auth_error_json('slow_down', 'Polling must slow down.', v_pairing.poll_interval_seconds + 5);
  end if;
  update private.device_auth_pairings set poll_attempts = poll_attempts + 1, last_polled_at = v_now where pairing_id = v_pairing_id;
  if v_pairing.state = 'pending' then
    insert into private.device_auth_idempotency_receipts(principal_kind,principal,operation,idempotency_key,request_digest,outcome_json,created_at,expired_at)
      values ('device',p_device_id,'poll',p_idempotency_key,p_request_digest,private.device_auth_error_json('authorization_pending','Authorization is pending.'),v_now,v_pairing.expires_at);
    return private.device_auth_error_json('authorization_pending', 'Authorization is pending.');
  end if;
  if v_pairing.state = 'approved' then
    v_remaining_seconds := floor(extract(epoch from (v_pairing.expires_at - v_now)))::integer;
    if v_remaining_seconds < 1 then
      update private.device_auth_pairings set state = 'expired', status_reason = 'expired' where pairing_id = v_pairing_id and state = 'approved';
      return private.device_auth_error_json('expired_token', 'The authorization grant has expired.');
    end if;
    select pg_catalog.replace(pg_catalog.replace(pg_catalog.rtrim(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '='), '+', '-'), '/', '_') into v_exchange;
    v_exchange_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_exchange, 'UTF8')), 'hex');
    insert into private.device_auth_code_digests(digest_kind,digest_hex,device_id,pairing_id) values ('exchange_code',v_exchange_digest,p_device_id,v_pairing_id);
    update private.device_auth_pairings set state = 'granted', exchange_code_issued_at = v_now where pairing_id = v_pairing_id and state = 'approved';
    v_scopes := v_pairing.requested_scopes;
    -- Do not put the one-time exchange code in an idempotency receipt. A
    -- response-loss retry is intentionally terminal until M3.08 adds an
    -- approved replay envelope; only the digest remains in code_digests.
    insert into private.device_auth_idempotency_receipts(principal_kind,principal,operation,idempotency_key,request_digest,outcome_json,created_at,expired_at)
      values ('device',p_device_id,'poll',p_idempotency_key,p_request_digest,private.device_auth_error_json('already_consumed','The authorization grant is no longer available.'),v_now,v_pairing.expires_at);
    return pg_catalog.jsonb_build_object('exchange_code',v_exchange,'expires_in',least(600,v_remaining_seconds),'scopes',v_scopes);
  end if;
  return private.device_auth_error_json('authorization_pending', 'Authorization is pending.');
end
$function$;

create or replace function api.device_auth_exchange_v1(
  p_exchange_code_digest text,
  p_device_id text,
  p_key_thumbprint text,
  p_audience text,
  p_requested_scopes text[],
  p_proof_suite text,
  p_proof_purpose text,
  p_proof_nonce text,
  p_issued_at text,
  p_request_digest text,
  p_idempotency_key text,
  p_access_token_digest text,
  p_access_token_key_version integer,
  p_refresh_token_digest text,
  p_refresh_token_key_version integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_pairing private.device_auth_pairings%rowtype;
  v_pairing_id uuid;
  v_account_id uuid;
  v_device_id uuid;
  v_device_public_id text;
  v_account_public_id text;
  v_family private.device_auth_token_families%rowtype;
  v_receipt private.device_auth_idempotency_receipts%rowtype;
  v_outcome jsonb;
begin
  if p_exchange_code_digest is null or p_exchange_code_digest !~ '^[0-9a-f]{64}$'
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_key_thumbprint is null or p_key_thumbprint !~ '^sha256:[0-9a-f]{64}$'
     or p_audience is distinct from 'skillmap.connector.v1'
     or p_requested_scopes is null or not private.device_scopes_are_canonical(p_requested_scopes)
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2'
     or p_proof_purpose is distinct from 'exchange'
     or p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$'
     or p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$'
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{22}$'
     or p_access_token_digest is null or p_access_token_digest !~ '^hmac-sha256:[0-9a-f]{64}$'
     or p_refresh_token_digest is null or p_refresh_token_digest !~ '^hmac-sha256:[0-9a-f]{64}$'
     or p_access_token_key_version is null or p_access_token_key_version < 1
     or p_refresh_token_key_version is null or p_refresh_token_key_version < 1 then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('device-auth-exchange:' || p_device_id, 7461));
  select * into v_receipt from private.device_auth_idempotency_receipts r
   where r.principal_kind = 'device' and r.principal = p_device_id and r.operation = 'exchange' and r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_receipt.request_digest <> p_request_digest then return private.device_auth_error_json('idempotency_conflict', 'The request conflicts with a prior operation.'); end if;
    return private.device_auth_error_json('already_consumed', 'The authorization grant is no longer available.');
  end if;
  select * into v_family from private.device_auth_token_families f where f.pairing_id in (
    select cd.pairing_id from private.device_auth_code_digests cd where cd.digest_kind = 'exchange_code' and cd.digest_hex = p_exchange_code_digest and cd.device_id = p_device_id
  ) for update;
  if found then return private.device_auth_error_json('already_consumed', 'The authorization grant is no longer available.'); end if;
  select cd.pairing_id into v_pairing_id from private.device_auth_code_digests cd where cd.digest_kind = 'exchange_code' and cd.digest_hex = p_exchange_code_digest and cd.device_id = p_device_id limit 1;
  if v_pairing_id is null then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  select * into v_pairing from private.device_auth_pairings p where p.pairing_id = v_pairing_id and p.device_id = p_device_id for update;
  if not found or v_pairing.key_thumbprint <> p_key_thumbprint then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  if v_pairing.expires_at <= v_now then return private.device_auth_error_json('expired_token', 'The authorization grant has expired.'); end if;
  if v_pairing.state <> 'granted' or v_pairing.confirmed_user_id is null then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  if exists (select 1 from pg_catalog.unnest(p_requested_scopes) requested where not (requested = any(v_pairing.requested_scopes))) then return private.device_auth_error_json('invalid_scope', 'The requested scope is invalid.'); end if;
  begin
    insert into private.device_auth_proof_nonces(device_id,proof_purpose,nonce,issued_at,expires_at) values (p_device_id,'exchange',p_proof_nonce,v_now,v_now + pg_catalog.make_interval(secs => 600));
  exception when unique_violation then return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;
  v_account_id := v_pairing.confirmed_user_id;
  v_account_public_id := 'acct_' || pg_catalog.replace(v_account_id::text, '-', '');
  insert into private.devices(account_id,display_name,platform,connector_version,locale,state,revision,issued_at)
    values (v_account_id,v_pairing.display_name,v_pairing.platform,v_pairing.connector_version,v_pairing.locale,'active',1,v_now)
    returning id,public_id into v_device_id,v_device_public_id;
  insert into private.device_auth_token_families(token_family_id,pairing_id,account_id,account_public_id,device_public_id,device_id,key_thumbprint,proof_suite,audience_literal,scopes,issued_at,idle_expires_at,absolute_expires_at)
    values ('fam_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),v_pairing_id,v_account_id,v_account_public_id,v_device_public_id,p_device_id,p_key_thumbprint,'skillmap.ecdsa-p256-sha256.v2','skillmap.connector.v1',p_requested_scopes,v_now,v_now + pg_catalog.make_interval(days => 30),v_now + pg_catalog.make_interval(days => 90))
    returning * into v_family;
  insert into private.device_auth_access_tokens(access_token_digest,key_version,family_id,generation,issued_at,expires_at)
    values (p_access_token_digest,p_access_token_key_version,v_family.family_id,1,v_now,v_now + pg_catalog.make_interval(secs => 600));
  insert into private.device_auth_refresh_generations(refresh_token_digest,key_version,family_id,generation,issued_at,idle_expires_at,absolute_expires_at)
    values (p_refresh_token_digest,p_refresh_token_key_version,v_family.family_id,1,v_now,v_now + pg_catalog.make_interval(days => 30),v_now + pg_catalog.make_interval(days => 90));
  update private.device_auth_pairings set exchanged_at = v_now, account_public_id = v_account_public_id where pairing_id = v_pairing_id and state = 'granted';
  v_outcome := pg_catalog.jsonb_build_object('device_public_id',v_device_public_id,'account_public_id',v_account_public_id,'token_family_id',v_family.token_family_id,'expires_in',600,'refresh_idle_expires_in',2592000,'refresh_absolute_expires_in',7776000);
  -- The receipt deliberately excludes the raw token response. Exact response
  -- replay after a lost exchange response is the M3.08 provider-storage gap;
  -- this milestone preserves one-success/one-lineage semantics instead of
  -- inventing deterministic bearer-token reproduction.
  insert into private.device_auth_idempotency_receipts(principal_kind,principal,operation,idempotency_key,request_digest,outcome_json,created_at,expired_at)
    values ('device',p_device_id,'exchange',p_idempotency_key,p_request_digest,v_outcome,v_now,v_now + pg_catalog.make_interval(secs => 600));
  return v_outcome;
end
$function$;

alter function api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text) owner to skillmap_device_auth_definer;
alter function api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer) owner to skillmap_device_auth_definer;
alter function api.device_auth_get_active_key_v1(text) owner to skillmap_device_auth_definer;
revoke all on function api.device_auth_get_active_key_v1(text) from public, anon, authenticated, service_role;
revoke all on function api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer) from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_token_families from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_access_tokens from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_refresh_generations from public, anon, authenticated, service_role;

commit;
