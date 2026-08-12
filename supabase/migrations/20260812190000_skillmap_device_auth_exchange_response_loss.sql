begin;

set local search_path = '';

-- Exchange success has no recoverable secret response. If a caller retries
-- the same committed request, the original response may have been lost after
-- Postgres created the device and token lineage. Revoke that unrecoverable
-- lineage before returning the terminal fresh-pairing signal.
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('device-auth-exchange:' || p_device_id, 7461)
  );

  select * into v_receipt
    from private.device_auth_idempotency_receipts r
   where r.principal_kind = 'device'
     and r.principal = p_device_id
     and r.operation = 'exchange'
     and r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_receipt.request_digest <> p_request_digest then
      return private.device_auth_error_json(
        'idempotency_conflict',
        'The request conflicts with a prior operation.'
      );
    end if;

    -- The receipt contains non-secret response metadata only. It cannot
    -- reproduce the access and refresh tokens that the client did not receive.
    -- The receipt and its request digest were committed atomically with the
    -- lineage. Its unique public identifiers are the durable cleanup locator,
    -- even if short-lived exchange-code rows are later pruned.
    select f.* into v_family
      from private.device_auth_token_families f
     where f.device_id = p_device_id
       and f.token_family_id = v_receipt.outcome_json ->> 'token_family_id'
       and f.device_public_id = v_receipt.outcome_json ->> 'device_public_id'
     for update;

    if found then
      update private.devices
         set state = 'revoked',
             revoked_at = coalesce(revoked_at, v_now),
             expires_at = least(coalesce(expires_at, v_now), v_now),
             revision = revision + 1
       where public_id = v_family.device_public_id
         and account_id = v_family.account_id
         and state not in ('revoked', 'compromised');

      update private.device_auth_access_tokens
         set revoked_at = coalesce(revoked_at, v_now),
             expires_at = least(expires_at, v_now)
       where family_id = v_family.family_id;

      update private.device_auth_refresh_generations
         set revoked_at = coalesce(revoked_at, v_now),
             idle_expires_at = least(idle_expires_at, v_now)
       where family_id = v_family.family_id;

      update private.device_auth_token_families
         set state = 'revoked',
             revoked_at = coalesce(revoked_at, v_now),
             idle_expires_at = least(idle_expires_at, v_now)
       where family_id = v_family.family_id;

      -- A later refresh retry must not recover ciphertext for a lineage that
      -- this exchange retry has retired. Keep its non-secret tombstones.
      delete from private.device_auth_refresh_replay_payloads
       where family_id = v_family.family_id;
    end if;

    return private.device_auth_error_json(
      'already_consumed',
      'The authorization grant is no longer available.'
    );
  end if;

  select * into v_family
    from private.device_auth_token_families f
   where f.pairing_id in (
     select cd.pairing_id
       from private.device_auth_code_digests cd
      where cd.digest_kind = 'exchange_code'
        and cd.digest_hex = p_exchange_code_digest
        and cd.device_id = p_device_id
   )
   for update;
  if found then
    return private.device_auth_error_json(
      'already_consumed',
      'The authorization grant is no longer available.'
    );
  end if;

  select cd.pairing_id into v_pairing_id
    from private.device_auth_code_digests cd
   where cd.digest_kind = 'exchange_code'
     and cd.digest_hex = p_exchange_code_digest
     and cd.device_id = p_device_id
   limit 1;
  if v_pairing_id is null then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;

  select * into v_pairing
    from private.device_auth_pairings p
   where p.pairing_id = v_pairing_id
     and p.device_id = p_device_id
   for update;
  if not found or v_pairing.key_thumbprint <> p_key_thumbprint then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  if v_pairing.expires_at <= v_now then
    return private.device_auth_error_json('expired_token', 'The authorization grant has expired.');
  end if;
  if v_pairing.state <> 'granted' or v_pairing.confirmed_user_id is null then
    return private.device_auth_error_json('invalid_grant', 'The authorization grant is invalid.');
  end if;
  if exists (
    select 1
      from pg_catalog.unnest(p_requested_scopes) requested
     where not (requested = any(v_pairing.requested_scopes))
  ) then
    return private.device_auth_error_json('invalid_scope', 'The requested scope is invalid.');
  end if;

  begin
    insert into private.device_auth_proof_nonces(
      device_id, proof_purpose, nonce, issued_at, expires_at
    ) values (
      p_device_id, 'exchange', p_proof_nonce, v_now,
      v_now + pg_catalog.make_interval(secs => 600)
    );
  exception when unique_violation then
    return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;

  v_account_id := v_pairing.confirmed_user_id;
  v_account_public_id := 'acct_' || pg_catalog.replace(v_account_id::text, '-', '');
  insert into private.devices(
    account_id, display_name, platform, connector_version, locale, state,
    revision, issued_at
  ) values (
    v_account_id, v_pairing.display_name, v_pairing.platform,
    v_pairing.connector_version, v_pairing.locale, 'active', 1, v_now
  ) returning public_id into v_device_public_id;

  insert into private.device_auth_token_families(
    token_family_id, pairing_id, account_id, account_public_id,
    device_public_id, device_id, key_thumbprint, proof_suite,
    audience_literal, scopes, issued_at, idle_expires_at, absolute_expires_at
  ) values (
    'fam_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    v_pairing_id, v_account_id, v_account_public_id, v_device_public_id,
    p_device_id, p_key_thumbprint, 'skillmap.ecdsa-p256-sha256.v2',
    'skillmap.connector.v1', p_requested_scopes, v_now,
    v_now + pg_catalog.make_interval(days => 30),
    v_now + pg_catalog.make_interval(days => 90)
  ) returning * into v_family;

  insert into private.device_auth_access_tokens(
    access_token_digest, key_version, family_id, generation, issued_at, expires_at
  ) values (
    p_access_token_digest, p_access_token_key_version, v_family.family_id, 1,
    v_now, v_now + pg_catalog.make_interval(secs => 600)
  );

  insert into private.device_auth_refresh_generations(
    refresh_token_digest, key_version, family_id, generation, issued_at,
    idle_expires_at, absolute_expires_at
  ) values (
    p_refresh_token_digest, p_refresh_token_key_version, v_family.family_id, 1,
    v_now, v_now + pg_catalog.make_interval(days => 30),
    v_now + pg_catalog.make_interval(days => 90)
  );

  update private.device_auth_pairings
     set exchanged_at = v_now, account_public_id = v_account_public_id
   where pairing_id = v_pairing_id
     and state = 'granted';

  v_outcome := pg_catalog.jsonb_build_object(
    'device_public_id', v_device_public_id,
    'account_public_id', v_account_public_id,
    'token_family_id', v_family.token_family_id,
    'expires_in', 600,
    'refresh_idle_expires_in', 2592000,
    'refresh_absolute_expires_in', 7776000
  );

  -- This receipt is a non-secret tombstone and cleanup locator. It is not a
  -- replay envelope and must never be returned as a successful retry.
  insert into private.device_auth_idempotency_receipts(
    principal_kind, principal, operation, idempotency_key, request_digest,
    outcome_json, created_at, expired_at
  ) values (
    'device', p_device_id, 'exchange', p_idempotency_key, p_request_digest,
    v_outcome, v_now, v_now + pg_catalog.make_interval(secs => 600)
  );
  return v_outcome;
end
$function$;

grant create on schema api to skillmap_device_auth_definer;
alter function api.device_auth_exchange_v1(
  text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer
) owner to skillmap_device_auth_definer;
revoke create on schema api from skillmap_device_auth_definer;

revoke all on function api.device_auth_exchange_v1(
  text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer
) from public, anon, authenticated;
grant execute on function api.device_auth_exchange_v1(
  text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer
) to service_role;

commit;
