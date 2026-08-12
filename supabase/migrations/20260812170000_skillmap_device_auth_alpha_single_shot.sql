begin;

set local search_path = '';

-- Alpha-only refresh response-loss seam. The existing receipt relation is
-- overloaded with an explicit mode so account deletion and the historical
-- replay tombstone remain one source of truth. Alpha rows contain no replay
-- key, nonce, ciphertext, response body, or token plaintext.
alter table private.device_auth_refresh_replay_receipts
  add column if not exists refresh_mode text not null default 'exact-replay';

alter table private.device_auth_refresh_replay_receipts
  alter column replay_until drop not null,
  alter column runtime_purge_after drop not null,
  alter column expired_at drop not null;

alter table private.device_auth_refresh_replay_receipts
  drop constraint if exists device_auth_refresh_replay_receipts_time_check,
  drop constraint if exists device_auth_refresh_replay_receipts_outcome_check;

alter table private.device_auth_refresh_replay_receipts
  add constraint device_auth_refresh_replay_receipts_time_check check (
    (refresh_mode = 'exact-replay'
      and replay_until = response_issued_at + 600
      and runtime_purge_after = response_issued_at + 900
      and expired_at >= pg_catalog.to_timestamp(runtime_purge_after))
    or
    (refresh_mode = 'alpha-single-shot'
      and replay_until is null
      and runtime_purge_after is null
      and expired_at is null)
  ),
  add constraint device_auth_refresh_replay_receipts_mode_check check (refresh_mode in ('exact-replay', 'alpha-single-shot')),
  add constraint device_auth_refresh_replay_receipts_outcome_check check (
    (refresh_mode = 'exact-replay' and outcome = 'committed')
    or (refresh_mode = 'alpha-single-shot' and outcome = 'single-shot-committed')
  );

-- A first request consumes one refresh generation. A retry after a lost
-- response finds the alpha tombstone and returns a strict terminal
-- reauthentication result; it never rotates again and never receives a stored
-- token response. `already_consumed` is deliberately distinct from a
-- transient `temporarily_unavailable` result so the client can retire its
-- consumed credential and device identity.
create or replace function api.device_auth_refresh_single_shot_v1(
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
  v_generation private.device_auth_refresh_generations%rowtype;
  v_receipt private.device_auth_refresh_replay_receipts%rowtype;
  v_prior_generation bigint;
  v_successor_generation bigint;
  v_idle_expires_at timestamptz;
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

  -- Lock order matches exact replay: family, device/binding, receipt, then
  -- presented generation. This makes the one-time transition atomic.
  select * into v_family from private.device_auth_token_families
    where token_family_id = p_token_family_id and device_id = p_device_id for update;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  select * into v_device from private.devices
    where public_id = v_family.device_public_id and account_id = v_family.account_id for update;
  if not found then return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.'); end if;
  perform 1 from private.device_auth_key_bindings
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
    -- The response body is intentionally not recoverable. The client must
    -- sign in again after a lost alpha response. This is a terminal
    -- reauthentication signal, not a transport retry signal.
    return private.device_auth_error_json('already_consumed', 'The authorization grant is no longer available.');
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
  update private.device_auth_refresh_generations set replaced_at = v_now where refresh_token_digest = v_generation.refresh_token_digest;
  insert into private.device_auth_access_tokens(access_token_digest,key_version,family_id,generation,issued_at,expires_at)
    values (p_access_token_digest,p_access_token_key_version,v_family.family_id,v_successor_generation,v_response_issued_at,least(v_family.absolute_expires_at,v_response_issued_at + pg_catalog.make_interval(secs => 600)));
  insert into private.device_auth_refresh_generations(refresh_token_digest,key_version,family_id,generation,issued_at,idle_expires_at,absolute_expires_at)
    values (p_successor_refresh_token_digest, p_refresh_token_key_version, v_family.family_id, v_successor_generation, v_response_issued_at, v_idle_expires_at, v_family.absolute_expires_at);
  update private.device_auth_token_families set current_generation = v_successor_generation, idle_expires_at = v_idle_expires_at where family_id = v_family.family_id;
  insert into private.device_auth_refresh_replay_receipts(
    idempotency_key_digest,idempotency_key_version,request_digest,device_id,family_id,prior_generation,successor_generation,
    response_issued_at,refresh_mode,outcome,db_committed_at)
    values (p_idempotency_key_digest,p_idempotency_key_version,p_request_digest,p_device_id,v_family.family_id,v_prior_generation,v_successor_generation,
      p_response_issued_at,'alpha-single-shot','single-shot-committed',v_now);
  return pg_catalog.jsonb_build_object('outcome','committed','device_public_id',v_family.device_public_id,'account_public_id',v_family.account_public_id,
    'token_family_id',v_family.token_family_id,'prior_generation',v_prior_generation,'successor_generation',v_successor_generation,'response_issued_at',p_response_issued_at);
end
$function$;

-- PostgreSQL requires the target owner to hold CREATE on the containing
-- schema during ownership transfer. Keep this privilege temporary.
grant create on schema api to skillmap_device_auth_definer;
alter function api.device_auth_refresh_single_shot_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,text,text,integer) owner to skillmap_device_auth_definer;
revoke create on schema api from skillmap_device_auth_definer;
revoke all on function api.device_auth_refresh_single_shot_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,text,text,integer) from public, anon, authenticated;
grant execute on function api.device_auth_refresh_single_shot_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,text,text,integer) to service_role;

commit;
