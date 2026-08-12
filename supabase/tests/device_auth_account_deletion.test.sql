begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(41);

-- The replacement barrier must own the account-linked cleanup.  This is a
-- contract test as well as a regression guard against restoring the old body.
select ok(
  pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
    like '%delete from private.device_auth_confirmation_attempts%'
    and pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
      like '%delete from private.device_auth_confirmation_handles%'
    and pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
      like '%delete from private.device_auth_pairings%',
  'account deletion barrier purges confirmation and pairing state'
);
select ok(
  pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
    like '%delete from private.device_auth_token_families%'
    and pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
      like '%delete from private.device_auth_code_digests%',
  'account deletion barrier purges token families and pairing digests'
);
select ok(
  pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
    like '%delete from private.device_auth_key_rotation_receipts%'
    and pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
      like '%delete from private.devices as dev%',
  'account deletion barrier purges device-owned rotation receipts before devices'
);
select ok(
  pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
    like '%delete from private.device_auth_key_bindings%'
    and pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
      like '%delete from private.device_auth_proof_nonces%'
    and pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
      like '%delete from private.device_auth_idempotency_receipts%'
    and pg_get_functiondef('private.perform_vault_deletion_barrier()'::regprocedure)
      like '%delete from private.device_auth_rate_buckets%',
  'account deletion barrier purges all device-keyed DeviceAuth residue'
);
select is(
  (select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relkind = 'r' and c.relname like 'device_auth_%'),
  16::bigint,
  'all sixteen DeviceAuth relations are present in private'
);

-- Direct user ownership exists only on these columns.  Device-scoped nonce,
-- rate, idempotency, and key-binding tables have no account identity and are
-- deliberately not guessed during account deletion.
select ok(
  exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_pairings' and column_name = 'confirmed_user_id')
    and exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_pairings' and column_name = 'account_public_id')
    and exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_confirmation_handles' and column_name = 'user_id')
    and exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_confirmation_attempts' and column_name = 'user_id')
    and exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_token_families' and column_name = 'account_id'),
  'user-linked DeviceAuth ownership columns are inventoried'
);
select ok(
  not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_key_bindings' and column_name in ('user_id','account_id'))
    and not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_proof_nonces' and column_name in ('user_id','account_id'))
    and not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_rate_buckets' and column_name in ('user_id','account_id'))
    and not exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'device_auth_idempotency_receipts' and column_name in ('user_id','account_id')),
  'device-scoped DeviceAuth tables have no fabricated account ownership'
);

-- Foreign-key inventory: the barrier deletes the two NO ACTION edges first;
-- descendants of a token family are safe through their explicit cascades.
select ok(
  exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'private.device_auth_confirmation_handles'::regclass and c.confrelid = 'private.device_auth_pairings'::regclass and c.confdeltype = 'a')
    and exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'private.device_auth_token_families'::regclass and c.confrelid = 'private.device_auth_pairings'::regclass and c.confdeltype = 'a'),
  'confirmation handles and token families require explicit pairing cleanup'
);
select ok(
  (select count(*) from pg_catalog.pg_constraint c where c.conrelid in ('private.device_auth_access_tokens'::regclass, 'private.device_auth_refresh_generations'::regclass, 'private.device_auth_refresh_replay_receipts'::regclass, 'private.device_auth_refresh_replay_payloads'::regclass) and c.confdeltype = 'c')
    >= 5,
  'token and replay descendants use cascading family/receipt foreign keys'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'private.device_auth_token_families'::regclass and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'c'),
  'token families also cascade from auth.users as a final safety net'
);

-- Fixtures cover a deleted account A, survivor B, and an unowned pending
-- pairing.  Everything is rolled back at the end of this test.
select lives_ok($sql$
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at,
  updated_at, confirmation_token) values
('00000000-0000-0000-0000-000000000000','a3000000-0000-4300-8300-000000000001','authenticated','authenticated','m3-delete-a@skillmap.invalid','',now(),'{}','{}',now(),now(),''),
('00000000-0000-0000-0000-000000000000','a3000000-0000-4300-8300-000000000002','authenticated','authenticated','m3-delete-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'');

insert into private.devices (id, public_id, account_id, display_name, platform,
  connector_version, locale, state, revision, issued_at) values
('a3000000-0000-4300-8300-000000000681','dev_'||repeat('1',32),'a3000000-0000-4300-8300-000000000001','Delete A','macos','3.0.0','en-US','active',1,now()),
('a3000000-0000-4300-8300-000000000682','dev_'||repeat('2',32),'a3000000-0000-4300-8300-000000000002','Keep B','macos','3.0.0','en-US','active',1,now());

insert into private.device_auth_pairings
  (pairing_id, device_id, key_thumbprint, audience_literal, requested_scopes,
   display_name, platform, connector_version, locale, verification_uri, state,
   created_at, confirmed_at, confirmed_user_id, account_public_id, expires_at) values
('a3000000-0000-4300-8300-000000000011','AAAAAAAAAAAAAAAAAAAAAA','sha256:'||repeat('a',64),'skillmap.connector.v1','{device.status}','A connector','macos','3.0.0','en-US','https://skillmap.invalid/verify','approved',now()-interval '1 minute',now(),'a3000000-0000-4300-8300-000000000001','acct_a30000000000430083000000000001',now()+interval '1 hour'),
('a3000000-0000-4300-8300-000000000022','AAAAAAAAAAAAAAAAAAAAAA','sha256:'||repeat('b',64),'skillmap.connector.v1','{device.status}','B connector','macos','3.0.0','en-US','https://skillmap.invalid/verify','approved',now()-interval '1 minute',now(),'a3000000-0000-4300-8300-000000000002','acct_a30000000000430083000000000002',now()+interval '1 hour'),
('a3000000-0000-4300-8300-000000000033','CCCCCCCCCCCCCCCCCCCCCC','sha256:'||repeat('c',64),'skillmap.connector.v1','{device.status}','Pending connector','macos','3.0.0','en-US','https://skillmap.invalid/verify','pending',now()-interval '1 minute',null,null,null,now()+interval '1 hour');

insert into private.device_auth_confirmation_handles
  (handle_digest, pairing_id, user_id, confirmation_revision, created_at, expires_at) values
(repeat('1',64),'a3000000-0000-4300-8300-000000000011','a3000000-0000-4300-8300-000000000001',1,now(),now()+interval '5 minutes'),
(repeat('2',64),'a3000000-0000-4300-8300-000000000022','a3000000-0000-4300-8300-000000000002',1,now(),now()+interval '5 minutes');
insert into private.device_auth_confirmation_attempts(user_id, window_start, attempt_count) values
('a3000000-0000-4300-8300-000000000001',now(),1),
('a3000000-0000-4300-8300-000000000002',now(),1);
insert into private.device_auth_code_digests(digest_kind, digest_hex, device_id, pairing_id) values
('user_code',repeat('3',64),'AAAAAAAAAAAAAAAAAAAAAA','a3000000-0000-4300-8300-000000000011'),
('user_code',repeat('4',64),'AAAAAAAAAAAAAAAAAAAAAA','a3000000-0000-4300-8300-000000000022'),
('user_code',repeat('5',64),'CCCCCCCCCCCCCCCCCCCCCC','a3000000-0000-4300-8300-000000000033');

insert into private.device_auth_key_bindings(device_id, proof_suite, public_key, key_thumbprint) values
('AAAAAAAAAAAAAAAAAAAAAA','skillmap.ecdsa-p256-sha256.v2','pub-a','sha256:'||repeat('a',64)),
('CCCCCCCCCCCCCCCCCCCCCC','skillmap.ecdsa-p256-sha256.v2','pub-c','sha256:'||repeat('c',64));
insert into private.device_auth_proof_nonces(device_id, proof_purpose, nonce, issued_at, expires_at) values
('AAAAAAAAAAAAAAAAAAAAAA','initiate','AAAAAAAAAAAAAAAAAAAAAA',now()-interval '1 minute',now()+interval '1 hour'),
('CCCCCCCCCCCCCCCCCCCCCC','initiate','CCCCCCCCCCCCCCCCCCCCCC',now()-interval '1 minute',now()+interval '1 hour');
insert into private.device_auth_idempotency_receipts(principal_kind, principal, operation, idempotency_key, request_digest, outcome_json, expired_at) values
('device','AAAAAAAAAAAAAAAAAAAAAA','initiate','aaaaaaaaaaaaaaaaaaaaaa','sha256:'||repeat('a',64),'{}',now()+interval '1 hour'),
('device','AAAAAAAAAAAAAAAAAAAAAA','poll','bbbbbbbbbbbbbbbbbbbbbb','sha256:'||repeat('b',64),'{}',now()+interval '1 hour'),
('device','CCCCCCCCCCCCCCCCCCCCCC','initiate','cccccccccccccccccccccc','sha256:'||repeat('c',64),'{}',now()+interval '1 hour');
insert into private.device_auth_rate_buckets(bucket_kind, bucket_key, count) values
('device-initiate','AAAAAAAAAAAAAAAAAAAAAA',1),
('device-initiate','CCCCCCCCCCCCCCCCCCCCCC',1);
insert into private.device_auth_key_rotation_receipts(
  device_id, device_public_id, idempotency_key_digest, idempotency_key_version,
  request_digest, old_key_thumbprint, new_key_thumbprint, proof_suite,
  binding_revision, effective_at, response_json
) values
('AAAAAAAAAAAAAAAAAAAAAA','dev_'||repeat('1',32),'hmac-sha256:'||repeat('a',64),1,'sha256:'||repeat('a',64),'sha256:'||repeat('a',64),'sha256:'||repeat('d',64),'skillmap.ecdsa-p256-sha256.v2',2,1,jsonb_build_object('device_public_id','dev_'||repeat('1',32),'effective_at','1','new_device_public_key_thumbprint','sha256:'||repeat('d',64),'rotation_receipt_digest','sha256:'||repeat('e',64))),
('AAAAAAAAAAAAAAAAAAAAAA','dev_'||repeat('2',32),'hmac-sha256:'||repeat('b',64),1,'sha256:'||repeat('b',64),'sha256:'||repeat('b',64),'sha256:'||repeat('e',64),'skillmap.ecdsa-p256-sha256.v2',2,1,jsonb_build_object('device_public_id','dev_'||repeat('2',32),'effective_at','1','new_device_public_key_thumbprint','sha256:'||repeat('e',64),'rotation_receipt_digest','sha256:'||repeat('f',64))),
('CCCCCCCCCCCCCCCCCCCCCC','dev_'||repeat('3',32),'hmac-sha256:'||repeat('c',64),1,'sha256:'||repeat('c',64),'sha256:'||repeat('c',64),'sha256:'||repeat('f',64),'skillmap.ecdsa-p256-sha256.v2',2,1,jsonb_build_object('device_public_id','dev_'||repeat('3',32),'effective_at','1','new_device_public_key_thumbprint','sha256:'||repeat('f',64),'rotation_receipt_digest','sha256:'||repeat('a',64)));

insert into private.device_auth_token_families
  (family_id, token_family_id, pairing_id, account_id, account_public_id,
   device_public_id, device_id, key_thumbprint, proof_suite, audience_literal,
   scopes, issued_at, idle_expires_at, absolute_expires_at) values
('a3000000-0000-4300-8300-000000000101','fam_'||repeat('1',32),'a3000000-0000-4300-8300-000000000011','a3000000-0000-4300-8300-000000000001','acct_'||repeat('1',32),'dev_'||repeat('1',32),'AAAAAAAAAAAAAAAAAAAAAA','sha256:'||repeat('a',64),'skillmap.ecdsa-p256-sha256.v2','skillmap.connector.v1','{device.status}',now(),now()+interval '1 day',now()+interval '2 days'),
('a3000000-0000-4300-8300-000000000102','fam_'||repeat('2',32),'a3000000-0000-4300-8300-000000000022','a3000000-0000-4300-8300-000000000002','acct_'||repeat('2',32),'dev_'||repeat('2',32),'AAAAAAAAAAAAAAAAAAAAAA','sha256:'||repeat('b',64),'skillmap.ecdsa-p256-sha256.v2','skillmap.connector.v1','{device.status}',now(),now()+interval '1 day',now()+interval '2 days');
insert into private.device_auth_access_tokens(access_token_digest,key_version,family_id,generation,issued_at,expires_at) values
('hmac-sha256:'||repeat('1',64),1,'a3000000-0000-4300-8300-000000000101',1,now(),now()+interval '1 hour'),
('hmac-sha256:'||repeat('2',64),1,'a3000000-0000-4300-8300-000000000102',1,now(),now()+interval '1 hour');
insert into private.device_auth_refresh_generations(refresh_token_digest,key_version,family_id,generation,issued_at,idle_expires_at,absolute_expires_at) values
('hmac-sha256:'||repeat('3',64),1,'a3000000-0000-4300-8300-000000000101',1,now(),now()+interval '1 day',now()+interval '2 days'),
('hmac-sha256:'||repeat('4',64),1,'a3000000-0000-4300-8300-000000000102',1,now(),now()+interval '1 day',now()+interval '2 days');
$sql$, 'deleted and survivor DeviceAuth fixtures insert');

set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a3000000-0000-4300-8300-000000000001"}',true);
select is(api.delete_my_account(), true, 'account A deletion succeeds');
reset role;

select is((select count(*) from auth.users where id = 'a3000000-0000-4300-8300-000000000001'), 0::bigint, 'account A auth row is removed');
select is((select count(*) from private.devices where account_id = 'a3000000-0000-4300-8300-000000000001'), 0::bigint, 'account A devices are removed');
select is((select count(*) from private.device_auth_pairings where confirmed_user_id = 'a3000000-0000-4300-8300-000000000001' or account_public_id = 'acct_a30000000000430083000000000001'), 0::bigint, 'account A pairings and account metadata are removed');
select is((select count(*) from private.device_auth_confirmation_handles where user_id = 'a3000000-0000-4300-8300-000000000001'), 0::bigint, 'account A confirmation handles are removed');
select is((select count(*) from private.device_auth_confirmation_attempts where user_id = 'a3000000-0000-4300-8300-000000000001'), 0::bigint, 'account A confirmation attempts are removed');
select is((select count(*) from private.device_auth_code_digests where pairing_id = 'a3000000-0000-4300-8300-000000000011'), 0::bigint, 'account A pairing digests are removed');
select is((select count(*) from private.device_auth_token_families where account_id = 'a3000000-0000-4300-8300-000000000001'), 0::bigint, 'account A token families are removed');
select is((select count(*) from private.device_auth_access_tokens where access_token_digest = 'hmac-sha256:'||repeat('1',64)), 0::bigint, 'account A access tokens cascade');
select is((select count(*) from private.device_auth_refresh_generations where refresh_token_digest = 'hmac-sha256:'||repeat('3',64)), 0::bigint, 'account A refresh generations cascade');
select is((select count(*) from private.device_auth_key_bindings where device_id = 'AAAAAAAAAAAAAAAAAAAAAA'), 1::bigint, 'shared A/B key binding survives');
select is((select count(*) from private.device_auth_proof_nonces where device_id = 'AAAAAAAAAAAAAAAAAAAAAA'), 1::bigint, 'shared A/B proof nonce survives');
select is((select count(*) from private.device_auth_idempotency_receipts where principal = 'AAAAAAAAAAAAAAAAAAAAAA'), 2::bigint, 'shared A/B idempotency receipts survive');
select is((select count(*) from private.device_auth_rate_buckets where bucket_key = 'AAAAAAAAAAAAAAAAAAAAAA'), 1::bigint, 'shared A/B rate bucket survives');
select is((select count(*) from private.device_auth_key_rotation_receipts where device_id = 'AAAAAAAAAAAAAAAAAAAAAA'), 1::bigint, 'shared A/B rotation receipts retain B by distinct public device id');
select is((select count(*) from private.device_auth_pairings where confirmed_user_id = 'a3000000-0000-4300-8300-000000000002'), 1::bigint, 'account B pairing survives');
select is((select count(*) from private.device_auth_confirmation_handles where user_id = 'a3000000-0000-4300-8300-000000000002'), 1::bigint, 'account B confirmation handle survives');
select is((select count(*) from private.device_auth_confirmation_attempts where user_id = 'a3000000-0000-4300-8300-000000000002'), 1::bigint, 'account B confirmation attempts survive');
select is((select count(*) from private.device_auth_code_digests where pairing_id = 'a3000000-0000-4300-8300-000000000022'), 1::bigint, 'account B pairing digest survives');
select is((select count(*) from private.device_auth_token_families where account_id = 'a3000000-0000-4300-8300-000000000002'), 1::bigint, 'account B token family survives');
select is((select count(*) from private.device_auth_access_tokens where access_token_digest = 'hmac-sha256:'||repeat('2',64)), 1::bigint, 'account B access token survives');
select is((select count(*) from private.device_auth_refresh_generations where refresh_token_digest = 'hmac-sha256:'||repeat('4',64)), 1::bigint, 'account B refresh generation survives');
select is((select count(*) from private.device_auth_key_rotation_receipts where device_id = 'AAAAAAAAAAAAAAAAAAAAAA'), 1::bigint, 'account B rotation receipt survives by its distinct public device id');
select is((select count(*) from private.device_auth_pairings where pairing_id = 'a3000000-0000-4300-8300-000000000033'), 1::bigint, 'unowned pending pairing survives');
select is((select count(*) from private.device_auth_code_digests where pairing_id = 'a3000000-0000-4300-8300-000000000033'), 1::bigint, 'unowned pending pairing digest survives');
select is((select count(*) from private.device_auth_key_bindings where device_id = 'CCCCCCCCCCCCCCCCCCCCCC'), 1::bigint, 'unowned pending device key binding survives');
select is((select count(*) from private.device_auth_proof_nonces where device_id = 'CCCCCCCCCCCCCCCCCCCCCC'), 1::bigint, 'unowned pending proof nonce survives');
select is((select count(*) from private.device_auth_idempotency_receipts where principal = 'CCCCCCCCCCCCCCCCCCCCCC'), 1::bigint, 'unowned pending idempotency receipt survives');
select is((select count(*) from private.device_auth_rate_buckets where bucket_key = 'CCCCCCCCCCCCCCCCCCCCCC'), 1::bigint, 'unowned pending rate bucket survives');
select is((select count(*) from private.device_auth_key_rotation_receipts where device_id = 'CCCCCCCCCCCCCCCCCCCCCC'), 1::bigint, 'unowned pending key rotation receipt survives');

select * from finish();
rollback;
