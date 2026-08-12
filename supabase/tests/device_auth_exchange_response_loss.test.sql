begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e1200000-0000-4120-8120-000000000001',
  'authenticated', 'authenticated', 'm3-exchange-loss@skillmap.invalid', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);

insert into private.device_auth_key_bindings (
  device_id, proof_suite, public_key, key_thumbprint, is_active
) values (
  repeat('E', 22), 'skillmap.ecdsa-p256-sha256.v2', 'exchange-loss-public-key',
  'sha256:' || repeat('e', 64), true
);

insert into private.device_auth_pairings (
  pairing_id, device_id, key_thumbprint, audience_literal, requested_scopes,
  display_name, platform, connector_version, locale, verification_uri, state,
  created_at, expires_at, confirmed_at, confirmed_user_id, exchange_code_issued_at
) values (
  'e1200000-0000-4120-8120-000000000010', repeat('E', 22),
  'sha256:' || repeat('e', 64), 'skillmap.connector.v1', array['device.status'],
  'Exchange loss fixture', 'macos', '0.1.0', 'en-US',
  'https://skillmap.test/device', 'granted', now() - interval '1 minute',
  now() + interval '10 minutes', now() - interval '30 seconds',
  'e1200000-0000-4120-8120-000000000001', now() - interval '20 seconds'
);

insert into private.device_auth_code_digests (
  digest_kind, digest_hex, device_id, pairing_id
) values (
  'exchange_code', repeat('e', 64), repeat('E', 22),
  'e1200000-0000-4120-8120-000000000010'
);

select matches(
  api.device_auth_exchange_v1(
    repeat('e', 64), repeat('E', 22), 'sha256:' || repeat('e', 64),
    'skillmap.connector.v1', array['device.status'],
    'skillmap.ecdsa-p256-sha256.v2', 'exchange', repeat('N', 22),
    (extract(epoch from statement_timestamp())::bigint)::text,
    'sha256:' || repeat('f', 64), repeat('I', 22),
    'hmac-sha256:' || repeat('a', 64), 1,
    'hmac-sha256:' || repeat('b', 64), 1
  )->>'token_family_id',
  '^fam_[0-9a-f]{32}$',
  'first exchange commits one token lineage'
);

select is(
  api.device_auth_exchange_v1(
    repeat('e', 64), repeat('E', 22), 'sha256:' || repeat('e', 64),
    'skillmap.connector.v1', array['device.status'],
    'skillmap.ecdsa-p256-sha256.v2', 'exchange', repeat('M', 22),
    (extract(epoch from statement_timestamp())::bigint)::text,
    'sha256:' || repeat('f', 64), repeat('I', 22),
    'hmac-sha256:' || repeat('a', 64), 1,
    'hmac-sha256:' || repeat('b', 64), 1
  )->>'error',
  'already_consumed',
  'lost exchange response retry requires fresh pairing'
);

select is(
  (select state from private.devices where account_id = 'e1200000-0000-4120-8120-000000000001'),
  'revoked',
  'lost response retry revokes the orphan device'
);

select ok(
  (select revoked_at is not null and expires_at <= statement_timestamp() and revision = 2
     from private.devices where account_id = 'e1200000-0000-4120-8120-000000000001'),
  'orphan device authority is expired and revisioned'
);

select is(
  (select state from private.device_auth_token_families where device_id = repeat('E', 22)),
  'revoked',
  'lost response retry revokes the orphan token family'
);

select ok(
  (select revoked_at is not null and idle_expires_at <= statement_timestamp()
     from private.device_auth_token_families where device_id = repeat('E', 22)),
  'orphan family authority is expired'
);

select is(
  (select count(*)
     from private.device_auth_access_tokens
    where family_id = (
      select family_id from private.device_auth_token_families
       where device_id = repeat('E', 22)
    )
      and revoked_at is null),
  0::bigint,
  'orphan access artifacts are inactive'
);

select is(
  (select count(*)
     from private.device_auth_refresh_generations
    where family_id = (
      select family_id from private.device_auth_token_families
       where device_id = repeat('E', 22)
    )
      and revoked_at is null),
  0::bigint,
  'orphan refresh artifacts are inactive'
);

select is(
  api.device_auth_authenticate_v1(
    array['hmac-sha256:' || repeat('a', 64)], array[1], repeat('E', 22),
    'sha256:' || repeat('e', 64), 'skillmap.connector.v1',
    'skillmap.ecdsa-p256-sha256.v2', 'authenticate', repeat('A', 22),
    (extract(epoch from statement_timestamp())::bigint)::text,
    'sha256:' || repeat('c', 64)
  )->>'error',
  'invalid_token',
  'orphan access token cannot authenticate'
);

select is(
  api.device_auth_get_status_v1(
    array['hmac-sha256:' || repeat('a', 64)], array[1], repeat('E', 22),
    (select device_public_id from private.device_auth_token_families where device_id = repeat('E', 22)),
    'sha256:' || repeat('e', 64), 'skillmap.connector.v1',
    'skillmap.ecdsa-p256-sha256.v2', 'protected.status', repeat('S', 22),
    (extract(epoch from statement_timestamp())::bigint)::text
  )->>'error',
  'invalid_token',
  'orphan access token cannot read protected status'
);

select is(
  api.device_auth_refresh_single_shot_v1(
    'hmac-sha256:' || repeat('b', 64), 1,
    'hmac-sha256:' || repeat('c', 64), repeat('E', 22),
    (select token_family_id from private.device_auth_token_families where device_id = repeat('E', 22)),
    'skillmap.connector.v1', 'skillmap.ecdsa-p256-sha256.v2', 'refresh',
    repeat('R', 22), (extract(epoch from statement_timestamp())::bigint)::text,
    'sha256:' || repeat('d', 64), 'hmac-sha256:' || repeat('d', 64), 1,
    extract(epoch from statement_timestamp())::bigint, 'v1',
    'hmac-sha256:' || repeat('e', 64), 1
  )->>'error',
  'invalid_grant',
  'orphan refresh token cannot rotate'
);

select ok(
  pg_get_functiondef(
    'api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer)'::regprocedure
  ) like '%device_auth_refresh_replay_payloads%',
  'exact refresh replay remains backed by ciphertext material'
);

select ok(
  pg_get_functiondef(
    'api.device_auth_refresh_single_shot_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,text,text,integer)'::regprocedure
  ) not like '%device_auth_refresh_replay_payloads%',
  'alpha refresh remains single-shot without ciphertext replay'
);

select * from finish();
rollback;
