begin;

set local search_path = '';

-- M3.09/M3.11 DeviceAuth lifecycle authority.  The application verifies the
-- canonical P-256 proof before calling these RPCs.  These functions recheck
-- every binding under a transaction lock, consume the purpose-separated
-- nonce, and remain feature-off until the separately approved cutover.

alter table private.device_auth_idempotency_receipts
  drop constraint if exists device_auth_idempotency_receipts_op_check;
alter table private.device_auth_idempotency_receipts
  add constraint device_auth_idempotency_receipts_op_check
  check (operation in ('initiate','poll','exchange','cancel','authenticate','status','revoke'));

grant usage on schema private to skillmap_device_auth_definer;
grant create on schema private, api to skillmap_device_auth_definer;
grant select, update on private.devices to skillmap_device_auth_definer;
grant select, update on private.device_auth_key_bindings to skillmap_device_auth_definer;
grant select, update on private.device_auth_pairings to skillmap_device_auth_definer;
grant select, update on private.device_auth_token_families to skillmap_device_auth_definer;
grant select, update on private.device_auth_access_tokens to skillmap_device_auth_definer;
grant select, update on private.device_auth_refresh_generations to skillmap_device_auth_definer;
grant select, insert on private.device_auth_proof_nonces to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_idempotency_receipts to skillmap_device_auth_definer;

alter table private.devices force row level security;
alter table private.device_auth_key_bindings force row level security;
alter table private.device_auth_pairings force row level security;
alter table private.device_auth_token_families force row level security;
alter table private.device_auth_access_tokens force row level security;
alter table private.device_auth_refresh_generations force row level security;
alter table private.device_auth_proof_nonces force row level security;
alter table private.device_auth_idempotency_receipts force row level security;

drop policy if exists device_auth_lifecycle_devices_definer on private.devices;
create policy device_auth_lifecycle_devices_definer on private.devices
  as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_lifecycle_keys_definer on private.device_auth_key_bindings;
create policy device_auth_lifecycle_keys_definer on private.device_auth_key_bindings
  as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_lifecycle_pairings_definer on private.device_auth_pairings;
create policy device_auth_lifecycle_pairings_definer on private.device_auth_pairings
  as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_lifecycle_families_definer on private.device_auth_token_families;
create policy device_auth_lifecycle_families_definer on private.device_auth_token_families
  as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_lifecycle_access_definer on private.device_auth_access_tokens;
create policy device_auth_lifecycle_access_definer on private.device_auth_access_tokens
  as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_lifecycle_refresh_definer on private.device_auth_refresh_generations;
create policy device_auth_lifecycle_refresh_definer on private.device_auth_refresh_generations
  as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_lifecycle_nonces_definer on private.device_auth_proof_nonces;
create policy device_auth_lifecycle_nonces_definer on private.device_auth_proof_nonces
  as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_lifecycle_receipts_definer on private.device_auth_idempotency_receipts;
create policy device_auth_lifecycle_receipts_definer on private.device_auth_idempotency_receipts
  as permissive for all to skillmap_device_auth_definer using (true) with check (true);

-- Revoke is the one terminal retry that may need a retired proof key. The
-- lookup is usable with a retired key only when the exact public-device,
-- idempotency key, and request digest already have a committed receipt.
create or replace function api.device_auth_get_revoke_key_v1(
  p_device_id text, p_device_public_id text, p_idempotency_key text, p_request_digest text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_family private.device_auth_token_families%rowtype;
  v_receipt private.device_auth_idempotency_receipts%rowtype;
  v_binding private.device_auth_key_bindings%rowtype;
  v_has_receipt boolean := false;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_device_public_id is null or p_device_public_id !~ '^dev_[0-9a-f]{32}$'
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{22}$'
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$' then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  select * into v_receipt from private.device_auth_idempotency_receipts r
   where r.principal_kind = 'device' and r.principal = p_device_public_id
     and r.operation = 'revoke' and r.idempotency_key = p_idempotency_key;
  v_has_receipt := found;
  if v_has_receipt and v_receipt.request_digest is distinct from p_request_digest then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  select * into v_family from private.device_auth_token_families f
   where f.device_public_id = p_device_public_id and f.device_id = p_device_id
   order by f.issued_at desc, f.family_id desc limit 1;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  select * into v_binding from private.device_auth_key_bindings k
   where k.device_id = p_device_id and k.proof_suite = 'skillmap.ecdsa-p256-sha256.v2'
     and k.key_thumbprint = v_family.key_thumbprint
     and (k.is_active or v_has_receipt)
   order by k.is_active desc, k.created_at desc limit 1;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  if not v_has_receipt then
    if not v_binding.is_active then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  elsif v_receipt.expired_at <= pg_catalog.statement_timestamp() then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  return pg_catalog.jsonb_build_object('public_key',v_binding.public_key,'key_thumbprint',v_binding.key_thumbprint,'proof_suite',v_binding.proof_suite);
end
$function$;

create or replace function api.device_auth_cancel_v1(
  p_device_code_digest text, p_device_id text, p_key_thumbprint text,
  p_audience text, p_proof_suite text, p_proof_purpose text,
  p_proof_nonce text, p_issued_at text, p_request_digest text,
  p_idempotency_key text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_pairing private.device_auth_pairings%rowtype;
  v_pairing_id uuid;
  v_receipt private.device_auth_idempotency_receipts%rowtype;
begin
  if p_device_code_digest is null or p_device_code_digest !~ '^[0-9a-f]{64}$'
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_key_thumbprint is null or p_key_thumbprint !~ '^sha256:[0-9a-f]{64}$'
     or p_audience is distinct from 'skillmap.connector.v1'
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2'
     or p_proof_purpose is distinct from 'cancel'
     or p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$'
     or p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$' or p_issued_at::numeric > 9223372036854775807
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{22}$'
     or p_reason is null or p_reason not in ('user_cancelled','timeout','local_shutdown') then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('device-auth-cancel:' || p_device_id, 7461));
  select * into v_receipt from private.device_auth_idempotency_receipts
   where principal_kind = 'device' and principal = p_device_id and operation = 'cancel' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_receipt.request_digest <> p_request_digest then return private.device_auth_error_json('idempotency_conflict', 'The request conflicts with a prior operation.'); end if;
    return v_receipt.outcome_json;
  end if;
  select cd.pairing_id into v_pairing_id from private.device_auth_code_digests cd
   where cd.digest_kind = 'device_code' and cd.digest_hex = p_device_code_digest and cd.device_id = p_device_id limit 1;
  if v_pairing_id is null then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  select * into v_pairing from private.device_auth_pairings p where p.pairing_id = v_pairing_id and p.device_id = p_device_id for update;
  if not found or v_pairing.key_thumbprint is distinct from p_key_thumbprint then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  if not exists (select 1 from private.device_auth_key_bindings k where k.device_id = p_device_id and k.proof_suite = p_proof_suite and k.key_thumbprint = p_key_thumbprint and k.is_active and k.retired_at is null) then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  if v_pairing.state = 'cancelled' then
    insert into private.device_auth_idempotency_receipts(principal_kind,principal,operation,idempotency_key,request_digest,outcome_json,created_at,expired_at)
      values ('device',p_device_id,'cancel',p_idempotency_key,p_request_digest,pg_catalog.jsonb_build_object('status','cancelled'),v_now,v_now + pg_catalog.make_interval(secs => 600));
    return pg_catalog.jsonb_build_object('status','cancelled');
  end if;
  if v_pairing.expires_at <= v_now and v_pairing.state not in ('denied','expired') then
    update private.device_auth_pairings set state = 'expired', status_reason = 'expired' where pairing_id = v_pairing_id and state in ('pending','approved','granted');
    return private.device_auth_error_json('expired_token', 'The authorization grant has expired.');
  end if;
  if v_pairing.state = 'expired' then
    return private.device_auth_error_json('expired_token', 'The authorization grant has expired.');
  end if;
  if v_pairing.state not in ('pending','approved','granted') then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  begin
    insert into private.device_auth_proof_nonces(device_id,proof_purpose,nonce,issued_at,expires_at)
      values (p_device_id,'cancel',p_proof_nonce,pg_catalog.to_timestamp(p_issued_at::bigint),v_now + pg_catalog.make_interval(secs => 600));
  exception when unique_violation then return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;
  update private.device_auth_pairings set state = 'cancelled', status_reason = p_reason where pairing_id = v_pairing_id and device_id = p_device_id and state in ('pending','approved','granted');
  insert into private.device_auth_idempotency_receipts(principal_kind,principal,operation,idempotency_key,request_digest,outcome_json,created_at,expired_at)
    values ('device',p_device_id,'cancel',p_idempotency_key,p_request_digest,pg_catalog.jsonb_build_object('status','cancelled'),v_now,v_now + pg_catalog.make_interval(secs => 600));
  return pg_catalog.jsonb_build_object('status','cancelled');
end
$function$;

create or replace function api.device_auth_authenticate_v1(
  p_access_token_digests text[], p_access_token_key_versions integer[], p_device_id text,
  p_key_thumbprint text, p_audience text, p_proof_suite text, p_proof_purpose text,
  p_proof_nonce text, p_issued_at text, p_request_digest text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_family private.device_auth_token_families%rowtype;
  v_device private.devices%rowtype;
  v_access private.device_auth_access_tokens%rowtype;
  v_key_version integer;
  v_index integer;
  v_expires timestamptz;
begin
  if p_access_token_digests is null or p_access_token_key_versions is null
     or pg_catalog.cardinality(p_access_token_digests) not between 1 and 2
     or pg_catalog.cardinality(p_access_token_digests) <> pg_catalog.cardinality(p_access_token_key_versions)
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_key_thumbprint is null or p_key_thumbprint !~ '^sha256:[0-9a-f]{64}$'
     or p_audience is distinct from 'skillmap.connector.v1'
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2'
     or p_proof_purpose is distinct from 'authenticate'
     or p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$'
     or p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$' or p_issued_at::numeric > 9223372036854775807
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$' then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('device-auth-access:' || p_device_id, 7461));
  select * into v_access from private.device_auth_access_tokens a
   where exists (
     select 1 from pg_catalog.generate_subscripts(p_access_token_digests, 1) s
      where a.access_token_digest = p_access_token_digests[s]
        and a.key_version = p_access_token_key_versions[s]
   )
   limit 1 for update;
  if not found then return private.device_auth_error_json('invalid_token', 'The access token is invalid.'); end if;
  select * into v_family from private.device_auth_token_families f where f.family_id = v_access.family_id and f.device_id = p_device_id for update;
  if not found then return private.device_auth_error_json('invalid_token', 'The access token is invalid.'); end if;
  select * into v_device from private.devices d where d.public_id = v_family.device_public_id and d.account_id = v_family.account_id for update;
  if not found or v_device.state is distinct from 'active' or v_device.revoked_at is not null
     or v_family.key_thumbprint is distinct from p_key_thumbprint or v_family.proof_suite is distinct from p_proof_suite
     or v_family.audience_literal is distinct from p_audience or v_family.state is distinct from 'active'
     or v_family.revoked_at is not null or v_access.revoked_at is not null or v_access.generation <> v_family.current_generation
     or (v_device.expires_at is not null and v_device.expires_at <= v_now)
     or v_access.expires_at <= v_now or v_family.idle_expires_at <= v_now or v_family.absolute_expires_at <= v_now then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;
  if not exists (select 1 from private.device_auth_key_bindings k where k.device_id = p_device_id and k.proof_suite = p_proof_suite and k.key_thumbprint = p_key_thumbprint and k.is_active and k.retired_at is null) then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;
  for v_index in 1..pg_catalog.cardinality(p_access_token_digests) loop
    if v_access.access_token_digest = p_access_token_digests[v_index] and v_access.key_version = p_access_token_key_versions[v_index] then v_key_version := p_access_token_key_versions[v_index]; exit; end if;
  end loop;
  if v_key_version is null then return private.device_auth_error_json('invalid_token', 'The access token is invalid.'); end if;
  begin
    insert into private.device_auth_proof_nonces(device_id,proof_purpose,nonce,issued_at,expires_at)
      values (p_device_id,'authenticate',p_proof_nonce,pg_catalog.to_timestamp(p_issued_at::bigint),v_now + pg_catalog.make_interval(secs => 600));
  exception when unique_violation then return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;
  v_expires := least(v_access.expires_at, v_family.idle_expires_at, v_family.absolute_expires_at);
  if v_device.expires_at is not null then v_expires := least(v_expires, v_device.expires_at); end if;
  return pg_catalog.jsonb_build_object('active',true,'device_public_id',v_family.device_public_id,'account_public_id',v_family.account_public_id,'scopes',v_family.scopes,'audience',v_family.audience_literal,'expires_at',pg_catalog.floor(extract(epoch from v_expires))::bigint);
end
$function$;

create or replace function api.device_auth_get_status_v1(
  p_access_token_digests text[], p_access_token_key_versions integer[], p_device_id text,
  p_device_public_id text, p_key_thumbprint text, p_audience text, p_proof_suite text,
  p_proof_purpose text, p_proof_nonce text, p_issued_at text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_family private.device_auth_token_families%rowtype;
  v_device private.devices%rowtype;
  v_access private.device_auth_access_tokens%rowtype;
  v_expires timestamptz;
begin
  if p_access_token_digests is null or p_access_token_key_versions is null or pg_catalog.cardinality(p_access_token_digests) not between 1 and 2
     or pg_catalog.cardinality(p_access_token_digests) <> pg_catalog.cardinality(p_access_token_key_versions)
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$' or p_device_public_id is null or p_device_public_id !~ '^dev_[0-9a-f]{32}$'
     or p_key_thumbprint is null or p_key_thumbprint !~ '^sha256:[0-9a-f]{64}$' or p_audience is distinct from 'skillmap.connector.v1'
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2' or p_proof_purpose is distinct from 'protected.status'
     or p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$' or p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$' or p_issued_at::numeric > 9223372036854775807 then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('device-auth-status:' || p_device_public_id, 7461));
  select * into v_access from private.device_auth_access_tokens a
   where exists (
     select 1 from pg_catalog.generate_subscripts(p_access_token_digests, 1) s
      where a.access_token_digest = p_access_token_digests[s]
        and a.key_version = p_access_token_key_versions[s]
   )
   limit 1 for update;
  if not found then return private.device_auth_error_json('invalid_token', 'The access token is invalid.'); end if;
  select * into v_family from private.device_auth_token_families f where f.family_id = v_access.family_id and f.device_id = p_device_id and f.device_public_id = p_device_public_id for update;
  select * into v_device from private.devices d where d.public_id = p_device_public_id and d.account_id = v_family.account_id for update;
  if not found or v_device.state is distinct from 'active' or v_device.revoked_at is not null or (v_device.expires_at is not null and v_device.expires_at <= v_now) or v_family.state is distinct from 'active'
     or v_family.revoked_at is not null or v_family.key_thumbprint is distinct from p_key_thumbprint or v_family.audience_literal is distinct from p_audience or v_family.proof_suite is distinct from p_proof_suite
     or v_access.revoked_at is not null or v_access.generation <> v_family.current_generation or v_access.expires_at <= v_now
     or v_family.idle_expires_at <= v_now or v_family.absolute_expires_at <= v_now or not ('device.status' = any(v_family.scopes)) then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;
  if not exists (select 1 from private.device_auth_key_bindings k where k.device_id = p_device_id and k.proof_suite = p_proof_suite and k.key_thumbprint = p_key_thumbprint and k.is_active and k.retired_at is null) then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;
  begin
    insert into private.device_auth_proof_nonces(device_id,proof_purpose,nonce,issued_at,expires_at)
      values (p_device_id,'protected.status',p_proof_nonce,pg_catalog.to_timestamp(p_issued_at::bigint),v_now + pg_catalog.make_interval(secs => 600));
  exception when unique_violation then return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;
  v_expires := least(v_access.expires_at, v_family.idle_expires_at, v_family.absolute_expires_at);
  if v_device.expires_at is not null then v_expires := least(v_expires, v_device.expires_at); end if;
  return pg_catalog.jsonb_build_object('device_public_id',v_device.public_id,'account_public_id',v_family.account_public_id,'state','active','scopes',v_family.scopes,'expires_at',pg_catalog.floor(extract(epoch from v_expires))::bigint,'key_thumbprint',v_family.key_thumbprint);
end
$function$;

create or replace function api.device_auth_revoke_v1(
  p_access_token_digests text[], p_access_token_key_versions integer[], p_device_id text,
  p_device_public_id text, p_key_thumbprint text, p_audience text, p_proof_suite text,
  p_proof_purpose text, p_proof_nonce text, p_issued_at text, p_request_digest text,
  p_idempotency_key text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_family private.device_auth_token_families%rowtype;
  v_device private.devices%rowtype;
  v_access private.device_auth_access_tokens%rowtype;
  v_receipt private.device_auth_idempotency_receipts%rowtype;
  v_response jsonb;
begin
  if p_access_token_digests is null or p_access_token_key_versions is null or pg_catalog.cardinality(p_access_token_digests) not between 1 and 2
     or pg_catalog.cardinality(p_access_token_digests) <> pg_catalog.cardinality(p_access_token_key_versions)
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$' or p_device_public_id is null or p_device_public_id !~ '^dev_[0-9a-f]{32}$'
     or p_key_thumbprint is null or p_key_thumbprint !~ '^sha256:[0-9a-f]{64}$' or p_audience is distinct from 'skillmap.connector.v1'
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2' or p_proof_purpose is distinct from 'revoke'
     or p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$' or p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$' or p_issued_at::numeric > 9223372036854775807
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$' or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{22}$'
     or p_reason is null or p_reason not in ('user_offboarded','suspected_compromise','account_disabled','owner_requested','operator_incident') then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('device-auth-revoke:' || p_device_public_id, 7461));
  select * into v_receipt from private.device_auth_idempotency_receipts where principal_kind = 'device' and principal = p_device_public_id and operation = 'revoke' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_receipt.request_digest <> p_request_digest then return private.device_auth_error_json('idempotency_conflict', 'The request conflicts with a prior operation.'); end if;
    return v_receipt.outcome_json;
  end if;
  select * into v_device from private.devices d where d.public_id = p_device_public_id for update;
  if not found then return private.device_auth_error_json('invalid_token', 'The access token is invalid.'); end if;
  select * into v_family from private.device_auth_token_families f where f.device_public_id = p_device_public_id and f.device_id = p_device_id and f.account_id = v_device.account_id order by f.issued_at desc, f.family_id desc limit 1 for update;
  if not found then return private.device_auth_error_json('invalid_token', 'The access token is invalid.'); end if;
  select * into v_access from private.device_auth_access_tokens a
   where a.family_id = v_family.family_id
     and exists (
       select 1 from pg_catalog.generate_subscripts(p_access_token_digests, 1) s
        where a.access_token_digest = p_access_token_digests[s]
          and a.key_version = p_access_token_key_versions[s]
     )
   limit 1 for update;
  if not found or v_family.key_thumbprint is distinct from p_key_thumbprint or v_family.proof_suite is distinct from p_proof_suite or v_family.audience_literal is distinct from p_audience
     or v_access.revoked_at is not null and v_device.state = 'active' then return private.device_auth_error_json('invalid_token', 'The access token is invalid.'); end if;
  if v_device.state = 'active' and not exists (select 1 from private.device_auth_key_bindings k where k.device_id = p_device_id and k.proof_suite = p_proof_suite and k.key_thumbprint = p_key_thumbprint and k.is_active and k.retired_at is null) then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;
  if v_device.state = 'active' and (v_family.state is distinct from 'active' or v_family.revoked_at is not null or v_access.generation <> v_family.current_generation or v_access.expires_at <= v_now or v_family.idle_expires_at <= v_now or v_family.absolute_expires_at <= v_now) then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;
  if v_device.state = 'revoked' and v_device.revoked_at is not null then
    v_response := pg_catalog.jsonb_build_object('status','revoked','device_public_id',p_device_public_id);
  else
    begin
      insert into private.device_auth_proof_nonces(device_id,proof_purpose,nonce,issued_at,expires_at)
        values (p_device_id,'revoke',p_proof_nonce,pg_catalog.to_timestamp(p_issued_at::bigint),v_now + pg_catalog.make_interval(secs => 600));
    exception when unique_violation then return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
    end;
    update private.device_auth_access_tokens set revoked_at = coalesce(revoked_at,v_now) where family_id in (select f.family_id from private.device_auth_token_families f where f.account_id = v_device.account_id and f.device_public_id = p_device_public_id and f.device_id = p_device_id);
    update private.device_auth_refresh_generations set revoked_at = coalesce(revoked_at,v_now) where family_id in (select f.family_id from private.device_auth_token_families f where f.account_id = v_device.account_id and f.device_public_id = p_device_public_id and f.device_id = p_device_id);
    update private.device_auth_token_families set state = 'revoked', revoked_at = coalesce(revoked_at,v_now) where account_id = v_device.account_id and device_public_id = p_device_public_id and device_id = p_device_id;
    -- A connector device_id/key can be reused by more than one public device
    -- lineage (including across accounts). Retire only bindings with no other
    -- active family dependency outside the exact target account/public ID.
    update private.device_auth_key_bindings k
       set is_active = false, retired_at = coalesce(k.retired_at,v_now)
     where k.device_id = p_device_id and k.is_active
       and not exists (
         select 1 from private.device_auth_token_families other
          where other.device_id = k.device_id and other.key_thumbprint = k.key_thumbprint
            and other.state = 'active'
            and not (other.account_id = v_device.account_id and other.device_public_id = p_device_public_id)
       );
    -- Confirmed pairings are account-bound by the authenticated owner UUID,
    -- not by the nullable presentation-only account_public_id. Unconfirmed
    -- rows are safe to cancel only when their pairing_id is the exact
    -- exchanged lineage; a shared device_id/key is otherwise ambiguous.
    update private.device_auth_pairings p
       set state = 'cancelled', status_reason = 'device_revoked'
     where p.device_id = p_device_id and p.state in ('pending','approved','granted')
       and (
         (p.confirmed_user_id is not null and p.confirmed_user_id = v_device.account_id)
         or (
           p.confirmed_user_id is null
           and p.pairing_id = v_family.pairing_id
           and p.key_thumbprint = v_family.key_thumbprint
         )
       );
    update private.devices set state = 'revoked', revoked_at = coalesce(revoked_at,v_now), revision = revision + 1 where id = v_device.id and state not in ('revoked','compromised');
    v_response := pg_catalog.jsonb_build_object('status','revoked','device_public_id',p_device_public_id);
  end if;
  insert into private.device_auth_idempotency_receipts(principal_kind,principal,operation,idempotency_key,request_digest,outcome_json,created_at,expired_at)
    values ('device',p_device_public_id,'revoke',p_idempotency_key,p_request_digest,v_response,v_now,v_now + pg_catalog.make_interval(secs => 600));
  return v_response;
end
$function$;

alter function api.device_auth_cancel_v1(text,text,text,text,text,text,text,text,text,text,text) owner to skillmap_device_auth_definer;
alter function api.device_auth_get_revoke_key_v1(text,text,text,text) owner to skillmap_device_auth_definer;
alter function api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text) owner to skillmap_device_auth_definer;
alter function api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text) owner to skillmap_device_auth_definer;
alter function api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text) owner to skillmap_device_auth_definer;

revoke all on function api.device_auth_cancel_v1(text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function api.device_auth_get_revoke_key_v1(text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;

revoke create on schema private, api from skillmap_device_auth_definer;

commit;
