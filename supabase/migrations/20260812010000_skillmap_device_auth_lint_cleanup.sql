begin;

-- Replace the final M3 device-auth RPC definitions without changing their
-- signatures, owners, grants, or behavior. These definitions remove only
-- variables that PostgreSQL 17 reports as unused or shadowed.

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
  returning attempt_count into v_attempts;
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
    returning public_id into v_device_public_id;
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
  v_generation private.device_auth_refresh_generations%rowtype;
  v_receipt private.device_auth_refresh_replay_receipts%rowtype;
  v_payload private.device_auth_refresh_replay_payloads%rowtype;
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
  perform 1 from private.device_auth_key_bindings k
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

commit;

