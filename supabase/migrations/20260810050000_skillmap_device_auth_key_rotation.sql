begin;

set local search_path = '';

-- M3.08 — same-suite DeviceAuth key rotation. This migration is additive and
-- remains feature-OFF: the dedicated NOLOGIN definer owns the transition, but
-- no request role receives EXECUTE. Public keys are retained as bindings;
-- private keys, tokens, proofs, and source credentials never enter Postgres.

alter table private.device_auth_key_bindings
  add column if not exists binding_revision bigint not null default 1,
  add column if not exists rotation_lineage_digest text;
alter table private.device_auth_key_bindings
  drop constraint if exists device_auth_key_bindings_revision_check,
  drop constraint if exists device_auth_key_bindings_lineage_check;
alter table private.device_auth_key_bindings
  add constraint device_auth_key_bindings_revision_check check (binding_revision > 0),
  add constraint device_auth_key_bindings_lineage_check check (rotation_lineage_digest is null or rotation_lineage_digest ~ '^sha256:[0-9a-f]{64}$');

alter table private.device_auth_token_families
  add column if not exists key_binding_revision bigint not null default 1;
alter table private.device_auth_token_families
  drop constraint if exists device_auth_token_families_binding_revision_check;
alter table private.device_auth_token_families
  add constraint device_auth_token_families_binding_revision_check check (key_binding_revision > 0);

alter table private.device_auth_access_tokens
  add column if not exists key_thumbprint text,
  add column if not exists key_binding_revision bigint not null default 1;
alter table private.device_auth_access_tokens
  drop constraint if exists device_auth_access_tokens_binding_check,
  drop constraint if exists device_auth_access_tokens_binding_revision_check;
alter table private.device_auth_access_tokens
  add constraint device_auth_access_tokens_binding_check check (key_thumbprint is null or key_thumbprint ~ '^sha256:[0-9a-f]{64}$'),
  add constraint device_auth_access_tokens_binding_revision_check check (key_binding_revision > 0);

create table if not exists private.device_auth_key_rotation_receipts (
  device_id text not null,
  device_public_id text not null,
  idempotency_key_digest text not null,
  idempotency_key_version integer not null,
  request_digest text not null,
  old_key_thumbprint text not null,
  new_key_thumbprint text not null,
  proof_suite text not null,
  binding_revision bigint not null,
  effective_at bigint not null,
  response_json jsonb not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint device_auth_key_rotation_receipts_pk primary key (device_id, idempotency_key_digest, idempotency_key_version),
  constraint device_auth_key_rotation_receipts_device_check check (device_id ~ '^[A-Za-z0-9_-]{22}$'),
  constraint device_auth_key_rotation_receipts_public_id_check check (device_public_id ~ '^dev_[0-9a-f]{32}$'),
  constraint device_auth_key_rotation_receipts_idempotency_check check (idempotency_key_digest ~ '^hmac-sha256:[0-9a-f]{64}$' and idempotency_key_version > 0),
  constraint device_auth_key_rotation_receipts_request_check check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint device_auth_key_rotation_receipts_old_key_check check (old_key_thumbprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint device_auth_key_rotation_receipts_new_key_check check (new_key_thumbprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint device_auth_key_rotation_receipts_suite_check check (proof_suite = 'skillmap.ecdsa-p256-sha256.v2'),
  constraint device_auth_key_rotation_receipts_revision_check check (binding_revision > 0),
  constraint device_auth_key_rotation_receipts_effective_check check (effective_at >= 0),
  constraint device_auth_key_rotation_receipts_response_check check (pg_catalog.jsonb_typeof(response_json) = 'object')
);

alter table private.device_auth_key_rotation_receipts enable row level security;
alter table private.device_auth_key_rotation_receipts force row level security;
grant create on schema private, api to skillmap_device_auth_definer;
alter table private.device_auth_key_rotation_receipts owner to skillmap_device_auth_definer;

grant usage on schema private to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_key_bindings to skillmap_device_auth_definer;
grant select on private.devices to skillmap_device_auth_definer;
grant select, update on private.device_auth_token_families to skillmap_device_auth_definer;
grant select, update on private.device_auth_access_tokens to skillmap_device_auth_definer;
grant select, update on private.device_auth_pairings to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_proof_nonces to skillmap_device_auth_definer;
grant select, insert on private.device_auth_key_rotation_receipts to skillmap_device_auth_definer;

create function private.validate_device_auth_key_rotation_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_keys text[];
begin
  if pg_catalog.jsonb_typeof(new.response_json) is distinct from 'object' then
    raise exception 'device auth rotation response must be an object' using errcode = '23514';
  end if;
  select pg_catalog.array_agg(k order by k) into v_keys
    from pg_catalog.jsonb_object_keys(new.response_json) as keys(k);
  if v_keys is distinct from array['device_public_id','effective_at','new_device_public_key_thumbprint','rotation_receipt_digest']
     or new.response_json->>'device_public_id' is distinct from new.device_public_id
     or new.response_json->>'new_device_public_key_thumbprint' is distinct from new.new_key_thumbprint
     or new.response_json->>'rotation_receipt_digest' !~ '^sha256:[0-9a-f]{64}$'
     or new.response_json->>'effective_at' is distinct from new.effective_at::text then
    raise exception 'device auth rotation response contract mismatch' using errcode = '23514';
  end if;
  return new;
end
$function$;

alter function private.validate_device_auth_key_rotation_receipt() owner to skillmap_device_auth_definer;
revoke all privileges on function private.validate_device_auth_key_rotation_receipt() from public, anon, authenticated, service_role;
create trigger device_auth_key_rotation_receipt_contract
before insert or update on private.device_auth_key_rotation_receipts
for each row execute function private.validate_device_auth_key_rotation_receipt();

drop policy if exists device_auth_key_rotation_bindings_definer on private.device_auth_key_bindings;
create policy device_auth_key_rotation_bindings_definer
  on private.device_auth_key_bindings as permissive for all to skillmap_device_auth_definer
  using (true) with check (true);
drop policy if exists device_auth_key_rotation_devices_definer on private.devices;
create policy device_auth_key_rotation_devices_definer
  on private.devices as permissive for select to skillmap_device_auth_definer using (true);
drop policy if exists device_auth_key_rotation_families_definer on private.device_auth_token_families;
create policy device_auth_key_rotation_families_definer
  on private.device_auth_token_families as permissive for update to skillmap_device_auth_definer
  using (true) with check (true);
drop policy if exists device_auth_key_rotation_access_definer on private.device_auth_access_tokens;
create policy device_auth_key_rotation_access_definer
  on private.device_auth_access_tokens as permissive for update to skillmap_device_auth_definer
  using (true) with check (true);
drop policy if exists device_auth_key_rotation_pairings_definer on private.device_auth_pairings;
create policy device_auth_key_rotation_pairings_definer
  on private.device_auth_pairings as permissive for update to skillmap_device_auth_definer
  using (true) with check (true);
drop policy if exists device_auth_key_rotation_nonces_definer on private.device_auth_proof_nonces;
create policy device_auth_key_rotation_nonces_definer
  on private.device_auth_proof_nonces as permissive for all to skillmap_device_auth_definer
  using (true) with check (true);
drop policy if exists device_auth_key_rotation_receipts_definer on private.device_auth_key_rotation_receipts;
create policy device_auth_key_rotation_receipts_definer
  on private.device_auth_key_rotation_receipts as permissive for select to skillmap_device_auth_definer
  using (true);
drop policy if exists device_auth_key_rotation_receipts_insert_definer on private.device_auth_key_rotation_receipts;
create policy device_auth_key_rotation_receipts_insert_definer
  on private.device_auth_key_rotation_receipts as permissive for insert to skillmap_device_auth_definer
  with check (true);

-- Exact retries are bounded to the committed non-secret receipt. This helper
-- deliberately has no public grant and never returns a key or token.
create or replace function api.device_auth_get_rotation_receipt_v1(
  p_device_public_id text,
  p_idempotency_key_digest text,
  p_idempotency_key_version integer,
  p_request_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_receipt private.device_auth_key_rotation_receipts%rowtype;
  v_family record;
  v_device private.devices%rowtype;
  v_active private.device_auth_key_bindings%rowtype;
  v_active_family_count integer := 0;
  v_invalid_active_family boolean := false;
  v_account_id uuid;
begin
  if p_device_public_id is null or p_device_public_id !~ '^dev_[0-9a-f]{32}$'
     or p_idempotency_key_digest is null or p_idempotency_key_digest !~ '^hmac-sha256:[0-9a-f]{64}$'
     or p_idempotency_key_version is null or p_idempotency_key_version <= 0
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$' then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  select * into v_receipt from private.device_auth_key_rotation_receipts r
   where r.device_public_id = p_device_public_id
     and r.idempotency_key_digest = p_idempotency_key_digest
     and r.idempotency_key_version = p_idempotency_key_version;
  if not found then return pg_catalog.jsonb_build_object('status', 'absent'); end if;

  -- Match rotation's family -> device lock order before examining a receipt.
  for v_family in
    select f.* from private.device_auth_token_families f
     where f.device_id = v_receipt.device_id
     order by f.family_id
     for update
  loop
    if v_family.state = 'active' then
      if v_family.device_public_id is distinct from p_device_public_id
         or v_family.revoked_at is not null
         or v_family.idle_expires_at <= v_now
         or v_family.absolute_expires_at <= v_now then
        v_invalid_active_family := true;
      else
        v_active_family_count := v_active_family_count + 1;
        v_account_id := v_family.account_id;
      end if;
    end if;
  end loop;
  if v_active_family_count <> 1 or v_invalid_active_family then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  select * into v_device from private.devices d
   where d.public_id = p_device_public_id and d.account_id = v_account_id
   for update;
  if not found or v_device.state is distinct from 'active' or v_device.revoked_at is not null
     or (v_device.expires_at is not null and v_device.expires_at <= v_now) then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  select * into v_active from private.device_auth_key_bindings k
   where k.device_id = v_receipt.device_id
     and k.proof_suite = 'skillmap.ecdsa-p256-sha256.v2'
     and k.is_active
   for update;
  if not found then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  if v_receipt.request_digest <> p_request_digest then
    return private.device_auth_error_json('idempotency_conflict', 'The request conflicts with a prior operation.');
  end if;
  return v_receipt.response_json;
end
$function$;

create or replace function api.device_auth_rotate_key_v1(
  p_device_public_id text,
  p_device_id text,
  p_old_key_thumbprint text,
  p_new_public_key text,
  p_new_key_thumbprint text,
  p_audience text,
  p_proof_suite text,
  p_old_proof_purpose text,
  p_new_proof_purpose text,
  p_old_proof_nonce text,
  p_new_proof_nonce text,
  p_old_issued_at text,
  p_new_issued_at text,
  p_request_digest text,
  p_idempotency_key_digest text,
  p_idempotency_key_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_effective_at bigint;
  v_device private.devices%rowtype;
  v_active private.device_auth_key_bindings%rowtype;
  v_pairing private.device_auth_pairings%rowtype;
  v_existing private.device_auth_key_rotation_receipts%rowtype;
  v_family record;
  v_selected_family record;
  v_new_bytes bytea;
  v_new_revision bigint;
  v_lineage_digest text;
  v_receipt_digest text;
  v_response jsonb;
  v_active_family_count integer := 0;
  v_invalid_active_family boolean := false;
begin
  if p_device_public_id is null or p_device_public_id !~ '^dev_[0-9a-f]{32}$'
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_old_key_thumbprint is null or p_old_key_thumbprint !~ '^sha256:[0-9a-f]{64}$'
     or p_new_public_key is null or p_new_public_key !~ '^[A-Za-z0-9_-]{122}$'
     or p_new_key_thumbprint is null or p_new_key_thumbprint !~ '^sha256:[0-9a-f]{64}$'
     or p_audience is distinct from 'skillmap.connector.v1'
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2'
     or p_old_proof_purpose is distinct from 'rotate-old'
     or p_new_proof_purpose is distinct from 'rotate-new'
     or p_old_proof_nonce is null or p_old_proof_nonce !~ '^[A-Za-z0-9_-]{22}$'
     or p_new_proof_nonce is null or p_new_proof_nonce !~ '^[A-Za-z0-9_-]{22}$'
     or p_old_proof_nonce = p_new_proof_nonce
     or p_old_issued_at is null or p_old_issued_at !~ '^(0|[1-9][0-9]{0,19})$'
     or p_new_issued_at is null or p_new_issued_at !~ '^(0|[1-9][0-9]{0,19})$'
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_idempotency_key_digest is null or p_idempotency_key_digest !~ '^hmac-sha256:[0-9a-f]{64}$'
     or p_idempotency_key_version is null or p_idempotency_key_version <= 0 then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;

  -- The initiation lock is shared with M3.03. Acquire it before any pairing
  -- state can be invalidated, then use the same family -> device -> key order
  -- as the accepted refresh transition. This prevents refresh/rotation
  -- deadlocks and makes a concurrent pairing/rotation outcome coherent.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'device-auth-initiate:' || p_device_id || ':skillmap.ecdsa-p256-sha256.v2', 7461
    )
  );

  -- Lock every lineage row for this immutable device_id in deterministic order.
  -- Terminal historical families are harmless, but every live family must be
  -- active, unrevoked, unexpired, and bound to this exact public device.
  for v_family in
    select f.* from private.device_auth_token_families f
     where f.device_id = p_device_id
     order by f.family_id
     for update
  loop
    if v_family.state = 'active' then
      if v_family.device_public_id is distinct from p_device_public_id
         or v_family.revoked_at is not null
         or v_family.idle_expires_at <= v_now
         or v_family.absolute_expires_at <= v_now then
        v_invalid_active_family := true;
      else
        v_active_family_count := v_active_family_count + 1;
        v_selected_family := v_family;
      end if;
    end if;
  end loop;
  if v_active_family_count <> 1 or v_invalid_active_family then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;

  select * into v_device from private.devices d
   where d.public_id = p_device_public_id
     and d.account_id = v_selected_family.account_id
   for update;
  if not found or v_device.state is distinct from 'active' or v_device.revoked_at is not null
     or (v_device.expires_at is not null and v_device.expires_at <= v_now) then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;

  select * into v_active from private.device_auth_key_bindings k
   where k.device_id = p_device_id
     and k.proof_suite = p_proof_suite
     and k.is_active
   for update;
  if not found or v_active.key_thumbprint <> p_old_key_thumbprint then
    return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end if;
  -- The family, its pairing, and the active binding form one lineage. A
  -- stale or cross-lineage family must fail closed before receipt replay or
  -- any binding/token/pairing mutation is possible.
  if v_selected_family.device_public_id is distinct from p_device_public_id
     or v_selected_family.device_id is distinct from p_device_id
     or v_selected_family.key_thumbprint is distinct from v_active.key_thumbprint
     or v_selected_family.proof_suite is distinct from v_active.proof_suite
     or v_selected_family.key_binding_revision is distinct from v_active.binding_revision
     or v_selected_family.current_generation is null
     or v_selected_family.current_generation <= 0 then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  select * into v_pairing from private.device_auth_pairings p
   where p.pairing_id = v_selected_family.pairing_id
   for update;
  if not found
     or v_pairing.device_id is distinct from p_device_id
     or v_pairing.key_thumbprint is distinct from v_active.key_thumbprint
     or v_pairing.state not in ('approved','granted') then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;

  -- Receipt is checked only after the family, device, and active binding are
  -- locked and proven live. Revocation/disablement/expiry always dominates an
  -- exact retry and can never be masked by a historical success body.
  select * into v_existing from private.device_auth_key_rotation_receipts r
   where r.device_id = p_device_id
     and r.idempotency_key_digest = p_idempotency_key_digest
     and r.idempotency_key_version = p_idempotency_key_version
   for update;
  if found then
    if v_existing.request_digest <> p_request_digest then
      return private.device_auth_error_json('idempotency_conflict', 'The request conflicts with a prior operation.');
    end if;
    return v_existing.response_json;
  end if;
  if p_new_key_thumbprint = p_old_key_thumbprint then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;

  begin
    v_new_bytes := pg_catalog.decode(
      pg_catalog.replace(pg_catalog.replace(p_new_public_key, '-', '+'), '_', '/')
        || pg_catalog.repeat('=', (4 - pg_catalog.length(p_new_public_key) % 4) % 4), 'base64');
  exception when others then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end;
  if pg_catalog.octet_length(v_new_bytes) <> 91
     or pg_catalog.encode(pg_catalog.substring(v_new_bytes, 1, 26), 'hex') <> '3059301306072a8648ce3d020106082a8648ce3d030107034200'
     or pg_catalog.get_byte(v_new_bytes, 26) <> 4
     or ('sha256:' || pg_catalog.encode(pg_catalog.sha256(v_new_bytes), 'hex')) <> p_new_key_thumbprint then
    return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end if;

  begin
    insert into private.device_auth_proof_nonces(device_id, proof_purpose, nonce, issued_at, expires_at)
    values (p_device_id, 'rotate-old', p_old_proof_nonce, pg_catalog.to_timestamp(p_old_issued_at::bigint), v_now + pg_catalog.make_interval(secs => 600));
    insert into private.device_auth_proof_nonces(device_id, proof_purpose, nonce, issued_at, expires_at)
    values (p_device_id, 'rotate-new', p_new_proof_nonce, pg_catalog.to_timestamp(p_new_issued_at::bigint), v_now + pg_catalog.make_interval(secs => 600));
  exception when unique_violation then
    return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;

  v_effective_at := pg_catalog.floor(extract(epoch from v_now))::bigint;
  v_new_revision := v_active.binding_revision + 1;
  v_lineage_digest := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'SKILLMAP-DEVICE-ROTATION-LINEAGE-V1' || E'\n' || p_device_id || E'\n' ||
    v_active.key_thumbprint || E'\n' || p_new_key_thumbprint || E'\n' || v_new_revision::text || E'\n', 'UTF8')), 'hex');
  v_receipt_digest := 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'SKILLMAP-DEVICE-ROTATION-RECEIPT-V1' || E'\n' || p_device_public_id || E'\n' ||
    p_new_key_thumbprint || E'\n' || v_new_revision::text || E'\n' || v_effective_at::text || E'\n', 'UTF8')), 'hex');
  v_response := pg_catalog.jsonb_build_object(
    'device_public_id', p_device_public_id,
    'new_device_public_key_thumbprint', p_new_key_thumbprint,
    'rotation_receipt_digest', v_receipt_digest,
    'effective_at', v_effective_at
  );

  update private.device_auth_key_bindings
     set is_active = false, retired_at = v_now, rotation_lineage_digest = v_lineage_digest
   where device_id = p_device_id and proof_suite = p_proof_suite and key_thumbprint = v_active.key_thumbprint and is_active;
  insert into private.device_auth_key_bindings(
    device_id, proof_suite, public_key, key_thumbprint, is_active, created_at, binding_revision, rotation_lineage_digest
  ) values (
    p_device_id, p_proof_suite, p_new_public_key, p_new_key_thumbprint, true, v_now, v_new_revision, v_lineage_digest
  );
  -- The frozen contract permits exactly one live family lineage: rebind that
  -- locked family and its still-live access rows to the successor revision;
  -- pending/approved/granted pairings are cancelled so no stale key can mint
  -- another lineage during the rotation.
  update private.device_auth_token_families
     set key_thumbprint = p_new_key_thumbprint, key_binding_revision = v_new_revision
   where family_id = v_selected_family.family_id and state = 'active';
  update private.device_auth_access_tokens
     set key_thumbprint = p_new_key_thumbprint, key_binding_revision = v_new_revision
   where family_id = v_selected_family.family_id
     and revoked_at is null
     and expires_at > v_now;
  update private.device_auth_pairings
     set state = 'cancelled', status_reason = 'key_rotated'
   where device_id = p_device_id
     and pairing_id = v_selected_family.pairing_id
     and key_thumbprint = v_active.key_thumbprint
     and state in ('pending','approved','granted');

  insert into private.device_auth_key_rotation_receipts(
    device_id, device_public_id, idempotency_key_digest, idempotency_key_version, request_digest, old_key_thumbprint,
    new_key_thumbprint, proof_suite, binding_revision, effective_at, response_json
  ) values (
    p_device_id, p_device_public_id, p_idempotency_key_digest, p_idempotency_key_version, p_request_digest, v_active.key_thumbprint,
    p_new_key_thumbprint, p_proof_suite, v_new_revision, v_effective_at, v_response
  );
  return v_response;
exception when unique_violation then
  -- A concurrent winner can only be an exact idempotency receipt. The unique
  -- active-binding index and receipt key both roll back this transaction.
  if exists (select 1 from private.device_auth_key_rotation_receipts r where r.device_id = p_device_id and r.idempotency_key_digest = p_idempotency_key_digest and r.idempotency_key_version = p_idempotency_key_version and r.request_digest = p_request_digest) then
    return (select response_json from private.device_auth_key_rotation_receipts r where r.device_id = p_device_id and r.idempotency_key_digest = p_idempotency_key_digest and r.idempotency_key_version = p_idempotency_key_version);
  end if;
  return private.device_auth_error_json('temporarily_unavailable', 'The service is temporarily unavailable.');
end
$function$;

alter function api.device_auth_get_rotation_receipt_v1(text,text,integer,text) owner to skillmap_device_auth_definer;
alter function api.device_auth_rotate_key_v1(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,integer) owner to skillmap_device_auth_definer;
revoke all privileges on function api.device_auth_get_rotation_receipt_v1(text,text,integer,text) from public, anon, authenticated, service_role;
revoke all privileges on function api.device_auth_rotate_key_v1(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_key_rotation_receipts from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_key_bindings from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_token_families from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_access_tokens from public, anon, authenticated, service_role;
-- The migration owner creates objects and transfers ownership above. The
-- narrow NOLOGIN definer only needs schema USAGE and the table/function grants
-- listed above; it must not retain persistent schema CREATE authority.
revoke create on schema private, api from skillmap_device_auth_definer;

commit;
