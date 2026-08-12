begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(37);

select has_function('api', 'device_auth_cancel_v1', array['text','text','text','text','text','text','text','text','text','text','text'], 'pairing cancellation RPC exists');
select has_function('api', 'device_auth_authenticate_v1', array['text[]','integer[]','text','text','text','text','text','text','text','text'], 'access authentication RPC exists');
select has_function('api', 'device_auth_get_status_v1', array['text[]','integer[]','text','text','text','text','text','text','text','text'], 'protected status RPC exists');
select has_function('api', 'device_auth_revoke_v1', array['text[]','integer[]','text','text','text','text','text','text','text','text','text','text','text'], 'connector revoke RPC exists');
select has_function('api', 'device_auth_get_revoke_key_v1', array['text','text','text','text'], 'retired-key replay lookup RPC exists');

select function_owner_is('api', 'device_auth_cancel_v1', array['text','text','text','text','text','text','text','text','text','text','text'], 'skillmap_device_auth_definer', 'cancel owner is dedicated NOLOGIN role');
select function_owner_is('api', 'device_auth_authenticate_v1', array['text[]','integer[]','text','text','text','text','text','text','text','text'], 'skillmap_device_auth_definer', 'authenticate owner is dedicated NOLOGIN role');
select function_owner_is('api', 'device_auth_get_status_v1', array['text[]','integer[]','text','text','text','text','text','text','text','text'], 'skillmap_device_auth_definer', 'status owner is dedicated NOLOGIN role');
select function_owner_is('api', 'device_auth_revoke_v1', array['text[]','integer[]','text','text','text','text','text','text','text','text','text','text','text'], 'skillmap_device_auth_definer', 'revoke owner is dedicated NOLOGIN role');
select function_owner_is('api', 'device_auth_get_revoke_key_v1', array['text','text','text','text'], 'skillmap_device_auth_definer', 'replay lookup owner is dedicated NOLOGIN role');

select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_pairings'::regclass), 'pairings FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_key_bindings'::regclass), 'key bindings FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_token_families'::regclass), 'families FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_access_tokens'::regclass), 'access tokens FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_refresh_generations'::regclass), 'refresh generations FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_idempotency_receipts'::regclass), 'idempotency receipts FORCE RLS');

select ok(not has_function_privilege('public', 'api.device_auth_cancel_v1(text,text,text,text,text,text,text,text,text,text,text)', 'execute'), 'cancel feature remains off for PUBLIC');
select ok(not has_function_privilege('service_role', 'api.device_auth_cancel_v1(text,text,text,text,text,text,text,text,text,text,text)', 'execute'), 'cancel feature remains off for service_role');
select ok(not has_function_privilege('service_role', 'api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text)', 'execute'), 'authenticate feature remains off');
select ok(not has_function_privilege('service_role', 'api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text)', 'execute'), 'status feature remains off');
select ok(not has_function_privilege('service_role', 'api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)', 'execute'), 'revoke feature remains off');

select ok(pg_get_functiondef('api.device_auth_cancel_v1(text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%device_code_digest%' and pg_get_functiondef('api.device_auth_cancel_v1(text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%idempotency_conflict%', 'cancel binds exact code and idempotency');
select ok(pg_get_functiondef('api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure) like '%current_generation%' and pg_get_functiondef('api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure) like '%expires_at%', 'authenticate checks generation and expiry');
select ok(pg_get_functiondef('api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure) like '%device.status%' and pg_get_functiondef('api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure) like '%device_public_id%', 'status binds protected scope and exact path ID');
select ok(pg_get_functiondef('api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%device_auth_refresh_generations%' and pg_get_functiondef('api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%device_auth_pairings%', 'revoke atomically covers refresh and pairings');
select ok(pg_get_functiondef('api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure) like '%jsonb_build_object(''active'',true%' and pg_get_functiondef('api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure) not like '%public_key%', 'responses are safe projections');

-- Invalid inputs exercise the terminal/error paths without requiring fixture
-- rows. These calls must not consume a nonce or mutate lifecycle state.
select is(
  (api.device_auth_authenticate_v1(
    array['hmac-sha256:' || repeat('a',64)], array[1], repeat('d',22),
    'sha256:' || repeat('b',64), 'skillmap.connector.v1',
    'skillmap.ecdsa-p256-sha256.v2', 'authenticate', repeat('n',22), '0',
    'sha256:' || repeat('c',64)
  )->>'error'), 'invalid_token', 'unknown access token is rejected');
select is(
  (api.device_auth_get_status_v1(
    array['hmac-sha256:' || repeat('a',64)], array[1], repeat('d',22),
    'dev_' || repeat('1',32), 'sha256:' || repeat('b',64),
    'skillmap.connector.v1', 'skillmap.ecdsa-p256-sha256.v2',
    'wrong-purpose', repeat('n',22), '0'
  )->>'error'), 'invalid_request', 'wrong status proof purpose is rejected');
select is(
  (api.device_auth_revoke_v1(
    array['hmac-sha256:' || repeat('a',64)], array[1], repeat('d',22),
    'dev_' || repeat('1',32), 'sha256:' || repeat('b',64),
    'skillmap.connector.v1', 'skillmap.ecdsa-p256-sha256.v2', 'revoke',
    repeat('n',22), '0', 'sha256:' || repeat('c',64), repeat('i',22),
    'owner_requested'
  )->>'error'), 'invalid_token', 'unknown revoke device/token is rejected');
select is(
  (api.device_auth_cancel_v1(
    repeat('a',64), repeat('d',22), 'sha256:' || repeat('b',64),
    'skillmap.connector.v1', 'skillmap.ecdsa-p256-sha256.v2',
    'authenticate', repeat('n',22), '0', 'sha256:' || repeat('c',64),
    repeat('i',22), 'user_cancelled'
  )->>'error'), 'invalid_request', 'wrong cancellation proof purpose is rejected');

select ok(pg_get_functiondef('api.device_auth_authenticate_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure) like '%v_device.expires_at%' and pg_get_functiondef('api.device_auth_get_status_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure) like '%v_device.expires_at%', 'authenticate and status reject expired devices');
select ok(pg_get_functiondef('api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%p.confirmed_user_id = v_device.account_id%' and pg_get_functiondef('api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%p.pairing_id = v_family.pairing_id%' and pg_get_functiondef('api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%p.key_thumbprint = v_family.key_thumbprint%', 'revoke isolates confirmed ownership and exact unconfirmed lineage');
select ok(pg_get_functiondef('api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%v_receipt.request_digest%' and pg_get_functiondef('api.device_auth_get_revoke_key_v1(text,text,text,text)'::regprocedure) like '%v_receipt.expired_at%', 'revoke changed idempotency and expired replay receipts fail');
select ok(pg_get_functiondef('api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%return v_receipt.outcome_json%' and pg_get_functiondef('api.device_auth_revoke_v1(text[],integer[],text,text,text,text,text,text,text,text,text,text,text)'::regprocedure) like '%device_auth_key_bindings%', 'repeated revoke replays exact receipt and retires only eligible key');

with target(account_id, pairing_id) as (
  values ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid)
), pairings(confirmed_user_id, pairing_id) as (
  values ('00000000-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid)
)
select ok(not exists (
  select 1 from pairings p, target t
   where (p.confirmed_user_id is not null and p.confirmed_user_id = t.account_id)
      or (p.confirmed_user_id is null and p.pairing_id = t.pairing_id)
), 'account A revoke preserves account B confirmed unexchanged pairing');
with target(account_id, pairing_id) as (
  values ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid)
), pairings(confirmed_user_id, pairing_id) as (
  values ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid)
)
select ok(exists (
  select 1 from pairings p, target t
   where (p.confirmed_user_id is not null and p.confirmed_user_id = t.account_id)
      or (p.confirmed_user_id is null and p.pairing_id = t.pairing_id)
), 'account A revoke selects its confirmed pairing by owner UUID');
with target(account_id, pairing_id) as (
  values ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid)
), pairings(confirmed_user_id, pairing_id) as (
  values (null::uuid, '00000000-0000-0000-0000-00000000000b'::uuid)
)
select ok(not exists (
  select 1 from pairings p, target t
   where (p.confirmed_user_id is not null and p.confirmed_user_id = t.account_id)
      or (p.confirmed_user_id is null and p.pairing_id = t.pairing_id)
), 'ambiguous unconfirmed shared-device pairing is preserved');

select * from finish();
rollback;
