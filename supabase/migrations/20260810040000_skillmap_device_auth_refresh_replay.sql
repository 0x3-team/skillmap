begin;

set local search_path = '';

-- M3.08 refresh response-loss recovery. This migration is intentionally
-- additive and feature-OFF: no request role receives EXECUTE. Raw access,
-- refresh, idempotency, or response plaintext is never stored here.

create table if not exists private.device_auth_refresh_replay_receipts (
  idempotency_key_digest text primary key,
  idempotency_key_version integer not null,
  request_digest text not null,
  device_id text not null,
  family_id uuid not null references private.device_auth_token_families(family_id) on delete cascade,
  prior_generation bigint not null,
  successor_generation bigint not null,
  response_issued_at bigint not null,
  replay_until bigint not null,
  runtime_purge_after bigint not null,
  outcome text not null default 'committed',
  db_committed_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  expired_at timestamptz not null,
  constraint device_auth_refresh_replay_receipts_idempotency_check check (idempotency_key_digest ~ '^hmac-sha256:[0-9a-f]{64}$'),
  constraint device_auth_refresh_replay_receipts_version_check check (idempotency_key_version > 0),
  constraint device_auth_refresh_replay_receipts_request_check check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint device_auth_refresh_replay_receipts_device_check check (device_id ~ '^[A-Za-z0-9_-]{22}$'),
  constraint device_auth_refresh_replay_receipts_generation_check check (prior_generation > 0 and successor_generation = prior_generation + 1),
  constraint device_auth_refresh_replay_receipts_time_check check (replay_until = response_issued_at + 600 and runtime_purge_after = response_issued_at + 900 and expired_at >= pg_catalog.to_timestamp(runtime_purge_after)),
  constraint device_auth_refresh_replay_receipts_outcome_check check (outcome = 'committed')
);

create table if not exists private.device_auth_refresh_replay_payloads (
  idempotency_key_digest text primary key references private.device_auth_refresh_replay_receipts(idempotency_key_digest) on delete cascade,
  family_id uuid not null references private.device_auth_token_families(family_id) on delete cascade,
  replay_key_version integer not null,
  nonce text not null,
  ciphertext text not null,
  body_digest text not null,
  body_length integer not null,
  response_issued_at bigint not null,
  replay_until bigint not null,
  runtime_purge_after bigint not null,
  response_format_version text not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint device_auth_refresh_replay_payloads_version_check check (replay_key_version > 0),
  constraint device_auth_refresh_replay_payloads_nonce_check check (nonce ~ '^[A-Za-z0-9_-]{16}$'),
  constraint device_auth_refresh_replay_payloads_ciphertext_check check (ciphertext ~ '^[A-Za-z0-9_-]+$' and pg_catalog.octet_length(pg_catalog.decode(pg_catalog.replace(pg_catalog.replace(ciphertext, '-', '+'), '_', '/') || pg_catalog.repeat('=', (4 - pg_catalog.length(ciphertext) % 4) % 4), 'base64')) between 17 and 2048),
  constraint device_auth_refresh_replay_payloads_body_check check (body_digest ~ '^sha256:[0-9a-f]{64}$' and body_length between 1 and 2032),
  constraint device_auth_refresh_replay_payloads_time_check check (replay_until = response_issued_at + 600 and runtime_purge_after = response_issued_at + 900),
  constraint device_auth_refresh_replay_payloads_format_check check (response_format_version = 'v1'),
  constraint device_auth_refresh_replay_payloads_nonce_unique unique (replay_key_version, nonce)
);

alter table private.device_auth_refresh_replay_receipts enable row level security;
alter table private.device_auth_refresh_replay_receipts force row level security;
alter table private.device_auth_refresh_replay_payloads enable row level security;
alter table private.device_auth_refresh_replay_payloads force row level security;

grant usage on schema private to skillmap_device_auth_definer;
grant select, insert, update on private.device_auth_refresh_replay_receipts to skillmap_device_auth_definer;
grant select, insert, update, delete on private.device_auth_refresh_replay_payloads to skillmap_device_auth_definer;
grant select on private.devices to skillmap_device_auth_definer;

drop policy if exists device_auth_refresh_replay_receipts_definer on private.device_auth_refresh_replay_receipts;
create policy device_auth_refresh_replay_receipts_definer on private.device_auth_refresh_replay_receipts as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_refresh_replay_payloads_definer on private.device_auth_refresh_replay_payloads;
create policy device_auth_refresh_replay_payloads_definer on private.device_auth_refresh_replay_payloads as permissive for all to skillmap_device_auth_definer using (true) with check (true);
drop policy if exists device_auth_refresh_devices_definer on private.devices;
create policy device_auth_refresh_devices_definer on private.devices as permissive for select to skillmap_device_auth_definer using (true);

-- Read-only preflight supplies public response identity and generation so the
-- application can seal the exact response before the single transition RPC.
-- It is ungranted alongside the transition until the feature gate is opened.
create or replace function api.device_auth_refresh_context_v1(p_device_id text, p_token_family_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_family private.device_auth_token_families%rowtype;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$' or p_token_family_id is null or p_token_family_id !~ '^fam_[0-9a-f]{32}$' then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  select * into v_family from private.device_auth_token_families where device_id = p_device_id and token_family_id = p_token_family_id;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  return pg_catalog.jsonb_build_object('device_public_id', v_family.device_public_id, 'account_public_id', v_family.account_public_id, 'token_family_id', v_family.token_family_id, 'current_generation', v_family.current_generation, 'absolute_expires_at', pg_catalog.floor(extract(epoch from v_family.absolute_expires_at))::bigint);
end
$function$;

-- Tamper/missing-key recovery is a narrow, ungranted fail-closed mutation.
-- It retains the non-secret receipt tombstone but removes every ciphertext
-- payload for the affected family before the transaction commits.
create or replace function api.device_auth_refresh_fail_closed_v1(p_idempotency_key_digest text, p_token_family_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_family_id uuid;
begin
  if p_idempotency_key_digest is null or p_idempotency_key_digest !~ '^hmac-sha256:[0-9a-f]{64}$' or p_token_family_id is null or p_token_family_id !~ '^fam_[0-9a-f]{32}$' then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  select family_id into v_family_id from private.device_auth_token_families where token_family_id = p_token_family_id for update;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  update private.device_auth_token_families set state = 'revoked', revoked_at = pg_catalog.statement_timestamp() where family_id = v_family_id and state = 'active';
  delete from private.device_auth_refresh_replay_payloads where family_id = v_family_id;
  return pg_catalog.jsonb_build_object('status', 'revoked');
end
$function$;

-- Maintenance caller may remove ciphertext only after runtime_purge_after;
-- receipts/tombstones remain for idempotency conflict and retired detection.
create or replace function api.device_auth_expire_v1(p_runtime_purge_after bigint, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_deleted integer := 0;
  v_now bigint := pg_catalog.floor(extract(epoch from pg_catalog.statement_timestamp()))::bigint;
begin
  if p_runtime_purge_after is null or p_runtime_purge_after < 0 or p_runtime_purge_after > v_now or p_limit is null or p_limit < 1 or p_limit > 1000 then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  with doomed as (
    select idempotency_key_digest from private.device_auth_refresh_replay_payloads
      where runtime_purge_after <= p_runtime_purge_after order by runtime_purge_after, idempotency_key_digest limit p_limit
  )
  delete from private.device_auth_refresh_replay_payloads p using doomed d where p.idempotency_key_digest = d.idempotency_key_digest;
  get diagnostics v_deleted = row_count;
  return pg_catalog.jsonb_build_object('status', 'purged', 'deleted', v_deleted);
end
$function$;

create or replace function api.device_auth_refresh_v1(
  p_refresh_token_digest text,
  p_refresh_token_key_version integer,
  p_successor_refresh_token_digest text,
  p_device_id text,
  p_token_family_id text,
  p_audience text,
  p_proof_suite text,
  p_proof_purpose text,
  p_proof_nonce text,
  p_issued_at text,
  p_request_digest text,
  p_idempotency_key_digest text,
  p_idempotency_key_version integer,
  p_response_issued_at bigint,
  p_replay_key_version integer,
  p_replay_nonce text,
  p_replay_ciphertext text,
  p_replay_body_digest text,
  p_replay_body_length integer,
  p_replay_until bigint,
  p_runtime_purge_after bigint,
  p_response_format_version text,
  p_access_token_digest text,
  p_access_token_key_version integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_response_issued_at timestamptz;
  v_family private.device_auth_token_families%rowtype;
  v_device private.devices%rowtype;
  v_binding private.device_auth_key_bindings%rowtype;
  v_generation private.device_auth_refresh_generations%rowtype;
  v_receipt private.device_auth_refresh_replay_receipts%rowtype;
  v_payload private.device_auth_refresh_replay_payloads%rowtype;
  v_prior_generation bigint;
  v_successor_generation bigint;
  v_idle_expires_at timestamptz;
  v_absolute_remaining integer;
begin
  if p_refresh_token_digest is null or p_refresh_token_digest !~ '^hmac-sha256:[0-9a-f]{64}$'
     or p_refresh_token_key_version is null or p_refresh_token_key_version < 1
     or p_successor_refresh_token_digest is null or p_successor_refresh_token_digest !~ '^hmac-sha256:[0-9a-f]{64}$'
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_token_family_id is null or p_token_family_id !~ '^fam_[0-9a-f]{32}$'
     or p_audience is distinct from 'skillmap.connector.v1'
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2'
     or p_proof_purpose is distinct from 'refresh'
     or p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$'
     or p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$'
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_idempotency_key_digest is null or p_idempotency_key_digest !~ '^hmac-sha256:[0-9a-f]{64}$'
     or p_idempotency_key_version is null or p_idempotency_key_version < 1
     or p_response_issued_at is null or p_response_issued_at < 0 or p_response_issued_at > 9223372036854774900
     or p_replay_key_version is null or p_replay_key_version < 1
     or p_replay_nonce is null or p_replay_nonce !~ '^[A-Za-z0-9_-]{16}$'
     or p_replay_ciphertext is null or p_replay_ciphertext !~ '^[A-Za-z0-9_-]+$'
     or p_replay_body_digest is null or p_replay_body_digest !~ '^sha256:[0-9a-f]{64}$'
     or p_replay_body_length is null or p_replay_body_length < 1 or p_replay_body_length > 2032
     or p_replay_until is distinct from p_response_issued_at + 600
     or p_runtime_purge_after is distinct from p_response_issued_at + 900
     or p_response_format_version is distinct from 'v1'
     or p_access_token_digest is null or p_access_token_digest !~ '^hmac-sha256:[0-9a-f]{64}$'
     or p_access_token_key_version is null or p_access_token_key_version < 1 then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;

  if p_issued_at::numeric > 9223372036854775807 then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;
  v_response_issued_at := pg_catalog.to_timestamp(p_response_issued_at);
  if pg_catalog.abs(extract(epoch from (v_now - v_response_issued_at))) > 30 then
    return private.device_auth_error_json('temporarily_unavailable', 'The service is temporarily unavailable.');
  end if;
  if pg_catalog.abs(extract(epoch from (v_now - pg_catalog.to_timestamp(p_issued_at::bigint)))) > 60 then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;

  -- Canonical lock order: family, replay receipt, presented generation. Every
  -- state transition and exact-replay decision occurs inside this transaction.
  select * into v_family from private.device_auth_token_families
    where token_family_id = p_token_family_id and device_id = p_device_id for update;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  select * into v_device from private.devices
    where public_id = v_family.device_public_id and account_id = v_family.account_id for update;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  select * into v_binding from private.device_auth_key_bindings
    where device_id = v_family.device_id and proof_suite = p_proof_suite and key_thumbprint = v_family.key_thumbprint
      and is_active and retired_at is null for update;
  if not found or v_device.state is distinct from 'active' or v_device.revoked_at is not null
     or v_family.proof_suite is distinct from p_proof_suite or v_family.audience_literal is distinct from p_audience
     or v_family.device_id is distinct from p_device_id then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  if v_family.state <> 'active' or v_family.revoked_at is not null or v_family.idle_expires_at <= v_now or v_family.absolute_expires_at <= v_now then
    if v_family.state = 'active' and v_family.revoked_at is null then
      update private.device_auth_token_families set state = 'expired' where family_id = v_family.family_id;
    end if;
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;

  select * into v_receipt from private.device_auth_refresh_replay_receipts
    where idempotency_key_digest = p_idempotency_key_digest for update;
  if found then
    if v_receipt.request_digest <> p_request_digest or v_receipt.family_id <> v_family.family_id or v_receipt.device_id <> p_device_id then
      return private.device_auth_error_json('idempotency_conflict', 'The request conflicts with a prior operation.');
    end if;
    if v_now >= pg_catalog.to_timestamp(v_receipt.replay_until) then
      update private.device_auth_token_families set state = 'revoked', revoked_at = v_now where family_id = v_family.family_id and state = 'active';
      return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
    end if;
    begin
      insert into private.device_auth_proof_nonces(device_id, proof_purpose, nonce, issued_at, expires_at)
        values (p_device_id, 'refresh', p_proof_nonce, v_now, v_now + pg_catalog.make_interval(secs => 600));
    exception when unique_violation then
      return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
    end;
    select * into v_payload from private.device_auth_refresh_replay_payloads where idempotency_key_digest = p_idempotency_key_digest for update;
    if not found then return pg_catalog.jsonb_build_object('error', 'replay_corrupt'); end if;
    return pg_catalog.jsonb_build_object('outcome','exact_replay','device_public_id',v_family.device_public_id,'account_public_id',v_family.account_public_id,'token_family_id',v_family.token_family_id,'prior_generation',v_receipt.prior_generation,'successor_generation',v_receipt.successor_generation,'response_issued_at',v_payload.response_issued_at,'replay',pg_catalog.jsonb_build_object('replay_key_version',v_payload.replay_key_version,'nonce',v_payload.nonce,'ciphertext',v_payload.ciphertext,'body_digest',v_payload.body_digest,'body_length',v_payload.body_length,'response_issued_at',v_payload.response_issued_at,'replay_until',v_payload.replay_until,'runtime_purge_after',v_payload.runtime_purge_after,'response_format_version',v_payload.response_format_version));
  end if;

  select * into v_generation from private.device_auth_refresh_generations
    where family_id = v_family.family_id and refresh_token_digest = p_refresh_token_digest and key_version = p_refresh_token_key_version for update;
  if not found then
    update private.device_auth_token_families set state = 'revoked', revoked_at = v_now where family_id = v_family.family_id and state = 'active';
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  if v_generation.replaced_at is not null or v_generation.revoked_at is not null or v_generation.generation <> v_family.current_generation or v_generation.idle_expires_at <= v_now or v_generation.absolute_expires_at <= v_now then
    update private.device_auth_token_families set state = 'revoked', revoked_at = v_now where family_id = v_family.family_id and state = 'active';
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  if v_family.absolute_expires_at <= v_response_issued_at then
    update private.device_auth_token_families set state = 'expired' where family_id = v_family.family_id and state = 'active';
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  begin
    insert into private.device_auth_proof_nonces(device_id, proof_purpose, nonce, issued_at, expires_at)
      values (p_device_id, 'refresh', p_proof_nonce, v_now, v_now + pg_catalog.make_interval(secs => 600));
  exception when unique_violation then
    return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;
  v_prior_generation := v_generation.generation;
  v_successor_generation := v_prior_generation + 1;
  v_idle_expires_at := least(v_family.absolute_expires_at, v_response_issued_at + pg_catalog.make_interval(secs => 2592000));
  v_absolute_remaining := greatest(0, pg_catalog.floor(extract(epoch from (v_family.absolute_expires_at - v_response_issued_at)))::integer);
  update private.device_auth_refresh_generations set replaced_at = v_now where refresh_token_digest = v_generation.refresh_token_digest;
  insert into private.device_auth_access_tokens(access_token_digest,key_version,family_id,generation,issued_at,expires_at)
    values (p_access_token_digest,p_access_token_key_version,v_family.family_id,v_successor_generation,v_response_issued_at,least(v_family.absolute_expires_at,v_response_issued_at + pg_catalog.make_interval(secs => 600)));
  insert into private.device_auth_refresh_generations(refresh_token_digest,key_version,family_id,generation,issued_at,idle_expires_at,absolute_expires_at)
    values (p_successor_refresh_token_digest, p_refresh_token_key_version, v_family.family_id, v_successor_generation, v_response_issued_at, v_idle_expires_at, v_family.absolute_expires_at);
  update private.device_auth_token_families set current_generation = v_successor_generation, idle_expires_at = v_idle_expires_at where family_id = v_family.family_id;
  insert into private.device_auth_refresh_replay_receipts(idempotency_key_digest,idempotency_key_version,request_digest,device_id,family_id,prior_generation,successor_generation,response_issued_at,replay_until,runtime_purge_after,db_committed_at,expired_at)
    values (p_idempotency_key_digest,p_idempotency_key_version,p_request_digest,p_device_id,v_family.family_id,v_prior_generation,v_successor_generation,p_response_issued_at,p_replay_until,p_runtime_purge_after,v_now,pg_catalog.to_timestamp(p_runtime_purge_after));
  insert into private.device_auth_refresh_replay_payloads(idempotency_key_digest,family_id,replay_key_version,nonce,ciphertext,body_digest,body_length,response_issued_at,replay_until,runtime_purge_after,response_format_version)
    values (p_idempotency_key_digest,v_family.family_id,p_replay_key_version,p_replay_nonce,p_replay_ciphertext,p_replay_body_digest,p_replay_body_length,p_response_issued_at,p_replay_until,p_runtime_purge_after,p_response_format_version);
  return pg_catalog.jsonb_build_object('outcome','committed','device_public_id',v_family.device_public_id,'account_public_id',v_family.account_public_id,'token_family_id',v_family.token_family_id,'prior_generation',v_prior_generation,'successor_generation',v_successor_generation,'response_issued_at',p_response_issued_at);
end
$function$;

alter function api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer) owner to skillmap_device_auth_definer;
revoke all on function api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer) from public, anon, authenticated, service_role;
alter function api.device_auth_refresh_context_v1(text,text) owner to skillmap_device_auth_definer;
revoke all on function api.device_auth_refresh_context_v1(text,text) from public, anon, authenticated, service_role;
alter function api.device_auth_refresh_fail_closed_v1(text,text) owner to skillmap_device_auth_definer;
revoke all on function api.device_auth_refresh_fail_closed_v1(text,text) from public, anon, authenticated, service_role;
alter function api.device_auth_expire_v1(bigint,integer) owner to skillmap_device_auth_definer;
revoke all on function api.device_auth_expire_v1(bigint,integer) from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_refresh_replay_receipts from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_refresh_replay_payloads from public, anon, authenticated, service_role;

commit;
