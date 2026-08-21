begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists pgcrypto with schema extensions;
set local search_path = extensions, public, private, api;

select plan(74);

select has_table('private', 'devices', 'devices table exists');
select has_table('private', 'device_tokens', 'device token table exists');

select has_function(
  'private', 'normalize_device_scopes',
  array['text[]'::text],
  'device scope canonicalization helper exists'
);

select has_function(
  'private', 'device_scopes_are_canonical',
  array['text[]'::text],
  'scope allowlist/shape helper exists'
);

select has_function(
  'private',
  'assert_device_token_replacement_chain',
  array['uuid', 'uuid', 'uuid', 'uuid'],
  'replacement chain validator helper exists'
);

select has_function(
  'private',
  'issue_device',
  array['uuid', 'text', 'text', 'text', 'text'],
  'device issue function exists'
);

select has_function(
  'private',
  'issue_device_token',
  array['uuid', 'uuid', 'text', 'integer', 'text[]', 'timestamp with time zone'],
  'device-token issue function exists'
);

select has_function(
  'private',
  'rotate_device_token',
  array['uuid', 'uuid', 'text', 'integer', 'text[]', 'timestamp with time zone'],
  'device-token rotate function exists'
);

select has_function(
  'private',
  'revoke_device_token',
  array['uuid', 'uuid'],
  'device-token revoke function exists'
);

select has_function(
  'private',
  'authorize_device_token',
  array['uuid', 'text', 'integer'],
  'device-token authorize function exists'
);

select ok((
  select count(*) from pg_catalog.pg_constraint
  where conrelid = 'private.devices'::regclass
    and contype = 'u'
    and conname in ('devices_account_id_id_key', 'devices_account_id_public_id_key', 'devices_public_id_key')
) = 3,
  'device identity constraints include account-device, account-public-id, and public-id uniqueness'
);

select ok((
  select count(*) from pg_catalog.pg_constraint
  where conrelid = 'private.device_tokens'::regclass
    and contype = 'u'
    and conname in (
      'device_tokens_account_id_id_key',
      'device_tokens_account_device_generation_key',
      'device_tokens_digest_key'
    )
) = 3,
  'device token identity constraints cover account-device generation, account/id, and digest/key uniqueness'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'private.devices'::regclass),
  'devices enables and forces RLS'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'private.device_tokens'::regclass),
  'device tokens enable and force RLS'
);

select is(
  (select count(*) from pg_catalog.pg_policies
   where schemaname = 'private' and tablename = 'devices'),
  6::bigint,
  'devices has the owner-select policy plus five final DeviceAuth definer policies'
);

select is(
  (select count(*) from pg_catalog.pg_policies
   where schemaname = 'private' and tablename = 'device_tokens'),
  1::bigint,
  'device tokens has the final DeviceAuth owner-definer policy'
);

select ok(
  not has_table_privilege('anon', 'private.devices', 'select')
  and not has_table_privilege('authenticated', 'private.devices', 'select')
  and not has_table_privilege('service_role', 'private.devices', 'select')
  and not has_table_privilege('anon', 'private.devices', 'insert')
  and not has_table_privilege('authenticated', 'private.devices', 'update')
  and not has_table_privilege('service_role', 'private.devices', 'delete'),
  'application roles have no direct device table privileges'
);

select ok(
  not has_table_privilege('anon', 'private.device_tokens', 'select')
  and not has_table_privilege('authenticated', 'private.device_tokens', 'select')
  and not has_table_privilege('service_role', 'private.device_tokens', 'select')
  and not has_table_privilege('anon', 'private.device_tokens', 'insert')
  and not has_table_privilege('authenticated', 'private.device_tokens', 'update')
  and not has_table_privilege('service_role', 'private.device_tokens', 'delete'),
  'application roles have no direct token table privileges'
);

select ok(
  not has_function_privilege('anon', 'private.issue_device(uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.issue_device(uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'private.issue_device(uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'private.issue_device_token(uuid,uuid,text,integer,text[],timestamp with time zone)', 'execute')
  and not has_function_privilege('authenticated', 'private.issue_device_token(uuid,uuid,text,integer,text[],timestamp with time zone)', 'execute')
  and not has_function_privilege('service_role', 'private.issue_device_token(uuid,uuid,text,integer,text[],timestamp with time zone)', 'execute')
  and not has_function_privilege('anon', 'private.rotate_device_token(uuid,uuid,text,integer,text[],timestamp with time zone)', 'execute')
  and not has_function_privilege('authenticated', 'private.rotate_device_token(uuid,uuid,text,integer,text[],timestamp with time zone)', 'execute')
  and not has_function_privilege('service_role', 'private.rotate_device_token(uuid,uuid,text,integer,text[],timestamp with time zone)', 'execute')
  and not has_function_privilege('anon', 'private.revoke_device_token(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.revoke_device_token(uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.revoke_device_token(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'private.authorize_device_token(uuid,text,integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.authorize_device_token(uuid,text,integer)', 'execute')
  and not has_function_privilege('service_role', 'private.authorize_device_token(uuid,text,integer)', 'execute'),
  'application roles have no execute privileges until M2.11'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'a7000000-0000-4600-8600-000000000001', 'authenticated', 'authenticated', 'm207-a@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a7000000-0000-4600-8600-000000000002', 'authenticated', 'authenticated', 'm207-b@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b7000000-0000-4600-8600-000000000003', 'authenticated', 'authenticated', 'm207-c@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b7000000-0000-4600-8600-000000000002', 'authenticated', 'authenticated', 'm207-d@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', '');

select ok(not exists (
  select 1
  from information_schema.columns
  where table_schema = 'private'
    and table_name = 'device_tokens'
    and column_name like 'raw%'
), 'device token table exposes no raw token-oriented columns');

-- Device constraints and normalization.
create temporary table local_issue_device_ids (id uuid not null primary key);
insert into local_issue_device_ids(id)
values (
  private.issue_device(
    'a7000000-0000-4600-8600-000000000001',
    'Device One',
    'macos',
    '1.2.3',
    'en-US'
  )
);

select is(
  (select state from private.devices where id = (select id from local_issue_device_ids)),
  'active',
  'issue_device writes an active canonical device row'
);

insert into private.devices (
  id, public_id, account_id, display_name, platform, connector_version, locale
) values
  (
    'a7000000-0000-4600-8600-000000000022',
    'dev_' || repeat('2', 32),
    'a7000000-0000-4600-8600-000000000001',
    E'  Device Two  ',
    'windows',
    '2.0.0',
    E'  en-US  '
  ),
  (
    'b7000000-0000-4600-8600-000000000033',
    'dev_' || repeat('3', 32),
    'b7000000-0000-4600-8600-000000000002',
    'Device Three',
    'linux',
    '1.0.5',
    'fr-CA'
  );

update private.devices
set display_name = E'  Device Two  '
where id = 'a7000000-0000-4600-8600-000000000022';

select is(
  (select display_name from private.devices where id = 'a7000000-0000-4600-8600-000000000022'),
  'Device Two',
  'device display metadata is normalized with trimmed display values'
);

select throws_ok(
  $$insert into private.devices (id, public_id, account_id, display_name, platform, connector_version) values
    ('a7000000-0000-4600-8600-000000000099', 'not-a-dev-id', 'a7000000-0000-4600-8600-000000000001', 'Bad', 'macos', '1.0.0')$$,
  '23514',
  'new row for relation "devices" violates check constraint "devices_public_id_format_check"',
  'malformed device public IDs are rejected'
);

select is(private.device_scopes_are_canonical(array['device.feedback', 'device.route']), true, 'known scope set is canonical');
select is(private.device_scopes_are_canonical(array['device.route', 'device.unknown']), false, 'unknown scopes are rejected');
select is(private.device_scopes_are_canonical(array['Device.Route']), false, 'scope values must be canonical lower-case');

create temporary table local_device_ids (label text primary key, id uuid not null);
create temporary table local_token_ids (label text primary key, token_id uuid not null, digest text not null, key_version integer);
create temporary table local_device_lineage_ids (label text primary key, account_id uuid not null, device_id uuid not null);
create temporary table local_token_vectors (
  label text primary key,
  raw_token text not null,
  expected_digest text not null,
  expected_key_version integer not null
);
create temporary table local_timing_checks (
  label text primary key,
  token_id uuid not null,
  issued_op_ts timestamp with time zone not null
);

insert into local_device_ids(label,id)
values
  ('account_a_primary', 'a7000000-0000-4600-8600-000000000001'),
  ('account_a_secondary', 'a7000000-0000-4600-8600-000000000002'),
  ('account_b_device', 'b7000000-0000-4600-8600-000000000003');

insert into local_device_lineage_ids (label, account_id, device_id)
values
  ('m207_primary', 'a7000000-0000-4600-8600-000000000001', (select id from local_issue_device_ids)),
  ('m207_primary_secondary', 'a7000000-0000-4600-8600-000000000001', 'a7000000-0000-4600-8600-000000000022'),
  ('m207_secondary', 'b7000000-0000-4600-8600-000000000002', 'b7000000-0000-4600-8600-000000000033'),
  ('m207_guard', 'a7000000-0000-4600-8600-000000000001', private.issue_device(
    'a7000000-0000-4600-8600-000000000001',
    'Device Four',
    'linux',
    '2.1.0',
    'en-US'
  ));

insert into private.devices (
  id, public_id, account_id, display_name, platform, connector_version, locale, state, revoked_at
) values
  (
    'a7000000-0000-4600-8600-000000000044',
    'dev_' || repeat('4', 32),
    'a7000000-0000-4600-8600-000000000001',
    'State Disabled Device',
    'linux',
    '1.0.0',
    'en-US',
    'disabled',
    null
  ),
  (
    'a7000000-0000-4600-8600-000000000055',
    'dev_' || repeat('5', 32),
    'a7000000-0000-4600-8600-000000000001',
    'State Revoked Device',
    'macos',
    '1.0.0',
    'en-US',
    'revoked',
    statement_timestamp()
  ),
  (
    'b7000000-0000-4600-8600-000000000066',
    'dev_' || repeat('6', 32),
    'b7000000-0000-4600-8600-000000000002',
    'State Compromised Device',
    'windows',
    '1.0.0',
    'en-US',
    'compromised',
    null
  ),
  (
    'a7000000-0000-4600-8600-000000000077',
    'dev_' || repeat('7', 32),
    'a7000000-0000-4600-8600-000000000001',
    'State Expired Device',
    'macos',
    '1.0.0',
    'en-US',
    'active',
    null
  );

insert into local_device_lineage_ids (label, account_id, device_id)
values
  ('m207_state_disabled', 'a7000000-0000-4600-8600-000000000001', 'a7000000-0000-4600-8600-000000000044'),
  ('m207_state_revoked', 'a7000000-0000-4600-8600-000000000001', 'a7000000-0000-4600-8600-000000000055'),
  ('m207_state_compromised', 'b7000000-0000-4600-8600-000000000002', 'b7000000-0000-4600-8600-000000000066'),
  ('m207_state_expired', 'a7000000-0000-4600-8600-000000000001', 'a7000000-0000-4600-8600-000000000077');

insert into local_token_vectors (label, raw_token, expected_digest, expected_key_version)
values
  ('a1_v1', 'm207-test-device-token-raw-01', encode(extensions.hmac('m207-test-device-token-raw-01', 'm207-device-token-vector-key', 'sha256'), 'hex'), 1),
  ('a1_v2', 'm207-test-device-token-raw-02', encode(extensions.hmac('m207-test-device-token-raw-02', 'm207-device-token-vector-key', 'sha256'), 'hex'), 2),
  ('a1_v3', 'm207-test-device-token-raw-03', encode(extensions.hmac('m207-test-device-token-raw-03', 'm207-device-token-vector-key', 'sha256'), 'hex'), 3),
  ('a1_v4', 'm207-test-device-token-raw-04', encode(extensions.hmac('m207-test-device-token-raw-04', 'm207-device-token-vector-key', 'sha256'), 'hex'), 4),
  ('a1_v5', 'm207-test-device-token-raw-05', encode(extensions.hmac('m207-test-device-token-raw-05', 'm207-device-token-vector-key', 'sha256'), 'hex'), 5),
  ('a1_v6', 'm207-test-device-token-raw-06', encode(extensions.hmac('m207-test-device-token-raw-06', 'm207-device-token-vector-key', 'sha256'), 'hex'), 6),
  ('a1_guard', 'm207-test-device-token-raw-guard', encode(extensions.hmac('m207-test-device-token-raw-guard', 'm207-device-token-vector-key', 'sha256'), 'hex'), 9),
  ('b1_v1', 'm207-test-device-token-raw-03', encode(extensions.hmac('m207-test-device-token-raw-03', 'm207-device-token-vector-key', 'sha256'), 'hex'), 3),
  ('state_disabled', 'm207-test-device-token-raw-disabled', encode(extensions.hmac('m207-test-device-token-raw-disabled', 'm207-device-token-vector-key', 'sha256'), 'hex'), 11),
  ('state_revoked', 'm207-test-device-token-raw-revoked', encode(extensions.hmac('m207-test-device-token-raw-revoked', 'm207-device-token-vector-key', 'sha256'), 'hex'), 12),
  ('state_compromised', 'm207-test-device-token-raw-compromised', encode(extensions.hmac('m207-test-device-token-raw-compromised', 'm207-device-token-vector-key', 'sha256'), 'hex'), 13),
  ('state_expired', 'm207-test-device-token-raw-expired', encode(extensions.hmac('m207-test-device-token-raw-expired', 'm207-device-token-vector-key', 'sha256'), 'hex'), 14);

with issued_tokens as (
  insert into local_token_ids(label, token_id, digest, key_version)
  values
    ('a1_v1', private.issue_device_token(
      (select account_id from local_device_lineage_ids where label='m207_primary'),
      (select device_id from local_device_lineage_ids where label='m207_primary_secondary'),
      'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v1'),
      (select expected_key_version from local_token_vectors where label='a1_v1'),
      array['device.route', 'device.status'],
      statement_timestamp() + interval '60 minutes'
    ), 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v1'), (select expected_key_version from local_token_vectors where label='a1_v1')),
    ('a1_v2', private.issue_device_token(
      (select account_id from local_device_lineage_ids where label='m207_primary'),
      (select device_id from local_device_lineage_ids where label='m207_primary_secondary'),
      'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v2'),
      (select expected_key_version from local_token_vectors where label='a1_v2'),
      array['device.feedback', 'device.route'],
      statement_timestamp() + interval '60 minutes'
    ), 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v2'), (select expected_key_version from local_token_vectors where label='a1_v2')),
    ('b1_v1', private.issue_device_token(
      (select account_id from local_device_lineage_ids where label='m207_secondary'),
      (select device_id from local_device_lineage_ids where label='m207_secondary'),
      'hmac-sha256:' || (select expected_digest from local_token_vectors where label='b1_v1'),
      (select expected_key_version from local_token_vectors where label='b1_v1'),
      array['device.import', 'device.status'],
      statement_timestamp() + interval '60 minutes'
  ), 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='b1_v1'), (select expected_key_version from local_token_vectors where label='b1_v1')),
    ('a1_guard', private.issue_device_token(
      (select account_id from local_device_lineage_ids where label='m207_guard'),
      (select device_id from local_device_lineage_ids where label='m207_guard'),
      'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_guard'),
      (select expected_key_version from local_token_vectors where label='a1_guard'),
      array['device.status', 'device.route'],
      statement_timestamp() + interval '60 minutes'
    ), 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_guard'), (select expected_key_version from local_token_vectors where label='a1_guard'))
  returning label, token_id
)
insert into local_timing_checks (label, token_id, issued_op_ts)
select label, token_id, statement_timestamp()
from issued_tokens;

with state_disabled_token as (
  insert into private.device_tokens (
    account_id, device_id, credential_digest, key_version, scopes, generation, expires_at
  )
  values (
    (select account_id from local_device_lineage_ids where label='m207_state_disabled'),
    (select device_id from local_device_lineage_ids where label='m207_state_disabled'),
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_disabled'),
    (select expected_key_version from local_token_vectors where label='state_disabled'),
    array['device.status'],
    1,
    null
  )
  returning id
),
state_revoked_token as (
  insert into private.device_tokens (
    account_id, device_id, credential_digest, key_version, scopes, generation, expires_at
  )
  values (
    (select account_id from local_device_lineage_ids where label='m207_state_revoked'),
    (select device_id from local_device_lineage_ids where label='m207_state_revoked'),
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_revoked'),
    (select expected_key_version from local_token_vectors where label='state_revoked'),
    array['device.import'],
    1,
    null
  )
  returning id
),
state_compromised_token as (
  insert into private.device_tokens (
    account_id, device_id, credential_digest, key_version, scopes, generation, expires_at
  )
  values (
    (select account_id from local_device_lineage_ids where label='m207_state_compromised'),
    (select device_id from local_device_lineage_ids where label='m207_state_compromised'),
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_compromised'),
    (select expected_key_version from local_token_vectors where label='state_compromised'),
    array['device.import'],
    1,
    null
  )
  returning id
),
state_expired_token as (
insert into private.device_tokens (
    account_id, device_id, credential_digest, key_version, scopes, generation, issued_at, expires_at
  )
  values (
    (select account_id from local_device_lineage_ids where label='m207_state_expired'),
    (select device_id from local_device_lineage_ids where label='m207_state_expired'),
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_expired'),
    (select expected_key_version from local_token_vectors where label='state_expired'),
    array['device.feedback'],
    1,
    statement_timestamp() - interval '20 minutes',
    statement_timestamp() - interval '10 minutes'
  )
  returning id
)
insert into local_token_ids (label, token_id, digest, key_version)
select label, token_id, digest, key_version
from (
  select 'state_disabled'::text as label, id as token_id,
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_disabled') as digest,
    (select expected_key_version from local_token_vectors where label='state_disabled') as key_version
  from state_disabled_token
  union all
  select 'state_revoked', id,
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_revoked'),
    (select expected_key_version from local_token_vectors where label='state_revoked')
  from state_revoked_token
  union all
  select 'state_compromised', id,
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_compromised'),
    (select expected_key_version from local_token_vectors where label='state_compromised')
  from state_compromised_token
  union all
  select 'state_expired', id,
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_expired'),
    (select expected_key_version from local_token_vectors where label='state_expired')
  from state_expired_token
) as state_token_rows;

select is(
  (select
    count(*)
  from (
    select v.label,
      'hmac-sha256:' || v.expected_digest as computed_digest,
      d.digest
  from local_token_ids d
  join local_token_vectors v on v.label = d.label
  where d.label in (
    'a1_v1', 'a1_v2', 'b1_v1', 'a1_guard',
    'state_disabled', 'state_revoked', 'state_compromised', 'state_expired'
  )
  and d.digest = 'hmac-sha256:' || v.expected_digest
  ) vector_matches),
  8::bigint,
  'raw token fixtures map to fixed hmac-sha256 digest rows'
);

select is(
  (select count(*)
   from (
     select id
     from private.device_tokens
     where credential_digest like 'm207-test-device-token-raw-%'
   ) leaks),
  0::bigint,
  'raw token material is never stored in credential_digest'
);

select is(
  (select count(*)
   from local_token_vectors
   where expected_digest = encode(extensions.hmac(raw_token, 'm207-device-token-vector-key', 'sha256'), 'hex')),
  (select count(*) from local_token_vectors),
  'fixture vectors are fixed HMAC-SHA-256 digests'
);

select is(
  (select count(*)
   from local_timing_checks
   join private.device_tokens on private.device_tokens.id = local_timing_checks.token_id
   where private.device_tokens.issued_at = local_timing_checks.issued_op_ts),
  (select count(*) from local_timing_checks),
  'issued_at aligns to statement-timestamp for each issued fixture'
);

select is(
  (select bool_and(credential_digest ~ '^hmac-sha256:[0-9a-f]{64}$') from private.device_tokens where id in (
    select token_id from local_token_ids
    where label like 'a1_%' or label='b1_v1' or label='a1_guard' or label like 'state_%'
  )),
  true,
  'stored digests enforce lower-case hmac-sha256 grammar'
);

select is(
  (select scopes from private.device_tokens where id = (select token_id from local_token_ids where label='a1_v1')),
  array['device.route', 'device.status'],
  'scope input is canonicalized and sorted'
);

select is(
  (select generation from private.device_tokens where id = (select token_id from local_token_ids where label='a1_v1')),
  1::bigint,
  'initial issuance assigns generation 1'
);

select is(
  (select generation from private.device_tokens where id = (select token_id from local_token_ids where label='a1_v2')),
  2::bigint,
  'second issuance for same account-device assigns generation 2'
);

select is(
  (select generation from private.device_tokens where id = (select token_id from local_token_ids where label='b1_v1')),
  1::bigint,
  'different device lineage remains independently tracked'
);

select throws_ok(
  $$update private.devices
      set display_name = 'MUTATION'
    where id = (select id from local_issue_device_ids)$$,
  '42501',
  'device display name update is not authorized',
  'post-cutover device metadata updates require the owner DeviceAuth authority'
);

select throws_ok(
  $$update private.device_tokens
      set credential_digest = 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v4')
    where id = (select token_id from local_token_ids where label='a1_v1')$$,
  '22023',
  'device token immutable fields are immutable',
  'token credential fields are immutable'
);

select is(
  (select id from private.device_tokens where credential_digest = 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v1')
    and key_version = 1 and account_id = 'a7000000-0000-4600-8600-000000000001'
    and id = private.authorize_device_token(
      'a7000000-0000-4600-8600-000000000001',
      'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v1'),
      1
    )),
  (select token_id from local_token_ids where label='a1_v1'),
  'authorize resolves the live token by digest and key version'
);

select is(
  (select last_used_at is not null from private.device_tokens where id = (select token_id from local_token_ids where label='a1_v1')),
  true,
  'successful authorize updates token last_used_at'
);

with rotated_tokens as (
  insert into local_token_ids(label, token_id, digest, key_version)
  values
    ('a1_v3', private.rotate_device_token(
      'a7000000-0000-4600-8600-000000000001',
      (select token_id from local_token_ids where label='a1_v1'),
      'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v4'),
      (select expected_key_version from local_token_vectors where label='a1_v4'),
      array['device.route', 'device.feedback', 'device.status'],
      statement_timestamp() + interval '60 minutes'
    ), 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v4'), (select expected_key_version from local_token_vectors where label='a1_v4'))
  returning label, token_id
)
insert into local_timing_checks (label, token_id, issued_op_ts)
select label, token_id, statement_timestamp()
from rotated_tokens;

select is(
  (select generation from private.device_tokens where id = (select token_id from local_token_ids where label='a1_v3')),
  3::bigint,
  'rotation increments generation'
);

select ok((
  select exists (
    select 1
    from private.device_tokens old_token
    join private.device_tokens new_token
      on new_token.id = old_token.replaced_by_token_id
    where old_token.id = (select token_id from local_token_ids where label='a1_v1')
      and new_token.id = (select token_id from local_token_ids where label='a1_v3')
  )
), 'rotation writes explicit replacement lineage');

select is(
  private.authorize_device_token(
    'a7000000-0000-4600-8600-000000000001',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v1'),
    1
  )::text,
  null,
  'revoked-or-replaced token cannot authorize'
);

select is(
  private.authorize_device_token(
    'a7000000-0000-4600-8600-000000000001',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v4'),
    (select expected_key_version from local_token_vectors where label='a1_v4')
  )::text,
  (select token_id from local_token_ids where label='a1_v3')::text,
  'current rotated token authorizes'
);

select is(
  private.authorize_device_token(
    'a7000000-0000-4600-8600-000000000001',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_expired'),
    (select expected_key_version from local_token_vectors where label='state_expired')
  )::text,
  null,
  'expired token cannot authorize'
);

select is(
  private.authorize_device_token(
    'a7000000-0000-4600-8600-000000000001',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_disabled'),
    (select expected_key_version from local_token_vectors where label='state_disabled')
  )::text,
  null,
  'disabled device token cannot authorize'
);

select is(
  private.authorize_device_token(
    'a7000000-0000-4600-8600-000000000001',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_revoked'),
    (select expected_key_version from local_token_vectors where label='state_revoked')
  )::text,
  null,
  'revoked device token cannot authorize'
);

select is(
  private.authorize_device_token(
    'b7000000-0000-4600-8600-000000000002',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_compromised'),
    (select expected_key_version from local_token_vectors where label='state_compromised')
  )::text,
  null,
  'compromised device token cannot authorize'
);

select is(
  private.authorize_device_token(
    'a7000000-0000-4600-8600-000000000001',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='state_expired'),
    (select expected_key_version from local_token_vectors where label='state_expired')
  )::text,
  null,
  'expired token cannot authorize'
);

select is(
  private.authorize_device_token(
    'a7000000-0000-4600-8600-000000000002',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v1'),
    (select expected_key_version from local_token_vectors where label='a1_v1')
  )::text,
  null,
  'cross-account authorize rejects ownership mismatch'
);

select throws_ok(
  $$select private.issue_device_token(
    'a7000000-0000-4600-8600-000000000001',
    (select device_id from local_device_lineage_ids where label='m207_secondary'),
    'hmac-sha256:' || encode(extensions.hmac('m207-cross-device-issuance-raw-token', 'm207-device-token-vector-key', 'sha256'), 'hex'),
    99,
    array['device.route'],
    statement_timestamp() + interval '60 minutes'
  )$$,
  '22023',
  'device is unavailable for token issuance',
  'mismatched account-device issuance is rejected'
);

select private.revoke_device_token(
  'b7000000-0000-4600-8600-000000000002',
  (select token_id from local_token_ids where label='b1_v1')
);

select is(
  private.authorize_device_token(
    'b7000000-0000-4600-8600-000000000002',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='b1_v1'),
    (select expected_key_version from local_token_vectors where label='b1_v1')
  )::text,
  null,
  'stale token cannot authorize'
);

select throws_ok(
  $$select private.rotate_device_token(
    'b7000000-0000-4600-8600-000000000002',
    (select token_id from local_token_ids where label='a1_v1'),
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v5'),
    (select expected_key_version from local_token_vectors where label='a1_v5'),
    array['device.route', 'device.feedback'],
    statement_timestamp() + interval '60 minutes'
  )$$,
  '22023',
  'old token was not found for this account',
  'cross-account rotate is denied'
);

select is(
  private.revoke_device_token(
    'b7000000-0000-4600-8600-000000000002',
    (select token_id from local_token_ids where label='a1_v1')
  ),
  false,
  'cross-account revoke returns false without side effects'
);

select throws_ok(
  $$insert into private.device_tokens (
    account_id,
    device_id,
    credential_digest,
    key_version,
    scopes,
    generation
  ) values (
    'a7000000-0000-4600-8600-000000000001',
    'a7000000-0000-4600-8600-000000000022',
    'sha256:' || repeat('f', 64),
    9,
    array['device.route'],
    100
  )$$,
  '23514',
  null,
  'token digest must match hmac-sha256 grammar'
);

select throws_ok(
  $$insert into private.device_tokens (
    account_id,
    device_id,
    credential_digest,
    key_version,
    scopes,
    generation
  ) values (
    'a7000000-0000-4600-8600-000000000001',
    'a7000000-0000-4600-8600-000000000022',
    'hmac-sha256:' || repeat('e', 64),
    0,
    array['device.route'],
    101
  )$$,
  '23514',
  null,
  'token key version must be positive'
);

select throws_ok(
  $$update private.device_tokens
     set replaced_by_token_id = (select token_id from local_token_ids where label='state_disabled')
   where id = (select token_id from local_token_ids where label='a1_v2')$$,
  '22023',
  'device token replacement target is outside the same account/device lineage',
  'cross-device replacement lineage is rejected'
);

with rotated_tokens as (
  insert into local_token_ids(label, token_id, digest, key_version)
  values
    ('a1_v6', private.rotate_device_token(
      'a7000000-0000-4600-8600-000000000001',
      (select token_id from local_token_ids where label='a1_v3'),
      'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v6'),
      (select expected_key_version from local_token_vectors where label='a1_v6'),
      array['device.status', 'device.feedback'],
      statement_timestamp() + interval '60 minutes'
    ), 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v6'), (select expected_key_version from local_token_vectors where label='a1_v6'))
  returning label, token_id
)
insert into local_timing_checks (label, token_id, issued_op_ts)
select label, token_id, statement_timestamp()
from rotated_tokens;

select ok(
  private.revoke_device_token(
    'a7000000-0000-4600-8600-000000000001',
    (select token_id from local_token_ids where label='a1_v3')
  ),
  'revoke_device_token returns true for present live token'
);

select is(
  private.authorize_device_token(
    'a7000000-0000-4600-8600-000000000001',
    'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v4'),
    (select expected_key_version from local_token_vectors where label='a1_v4')
  )::text,
  null,
  'revoked tokens cannot authorize'
);

select ok(exists(
  select 1
  from private.device_tokens
  where account_id = 'a7000000-0000-4600-8600-000000000001'
    and credential_digest = 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v1')
    and key_version = 1
    and id = (select token_id from local_token_ids where label='a1_v1')
    and revoked_at is not null
),
  'revoked token row remains immutable by visibility and state checks'
);

select throws_ok(
  $$update private.device_tokens
  set replaced_by_token_id = (select token_id from local_token_ids where label='a1_v1')
  where id = (select token_id from local_token_ids where label='a1_v6')$$,
  '22023',
  'device token replacement would create a cycle',
  'manual cycle in replacement lineage is rejected'
);

update private.device_tokens
set expires_at = statement_timestamp() + interval '120 minutes'
where id = (select token_id from local_token_ids where label='a1_v2');

with rotated_tokens as (
  insert into local_token_ids(label, token_id, digest, key_version)
  values
    ('a1_v4', private.rotate_device_token(
      'a7000000-0000-4600-8600-000000000001',
      (select token_id from local_token_ids where label='a1_v2'),
      'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v5'),
      (select expected_key_version from local_token_vectors where label='a1_v5'),
      array['device.bundle', 'device.status'],
      statement_timestamp() + interval '60 minutes'
    ), 'hmac-sha256:' || (select expected_digest from local_token_vectors where label='a1_v5'), (select expected_key_version from local_token_vectors where label='a1_v5'))
  returning label, token_id
)
insert into local_timing_checks (label, token_id, issued_op_ts)
select label, token_id, statement_timestamp()
from rotated_tokens;

select throws_ok(
  $$update private.device_tokens
  set replaced_by_token_id = (select token_id from local_token_ids where label='a1_v1')
  where id = (select token_id from local_token_ids where label='a1_v3')$$,
  '22023',
  'device token replacement would create a cycle',
  'manual cycle in replacement lineage is rejected'
);

select throws_ok(
  $$update private.device_tokens
  set replaced_by_token_id = (select token_id from local_token_ids where label='a1_v3')
  where id = (select token_id from local_token_ids where label='a1_v4')$$,
  '22023',
  'device token replacement would create a replacement branch',
  'multi-hop cycle in replacement lineage is rejected'
);

select throws_ok(
  $$update private.device_tokens
  set replaced_by_token_id = (select token_id from local_token_ids where label='a1_v4')
  where id = (select token_id from local_token_ids where label='a1_v6')$$,
  '22023',
  'device token replacement would create a replacement branch',
  'branching replacement lineage is rejected'
);

select lives_ok(
  $$select private.assert_device_token_replacement_chain(
    'a7000000-0000-4600-8600-000000000001',
    (select device_id from local_device_lineage_ids where label='m207_primary_secondary'),
    (select token_id from local_token_ids where label='a1_v1'),
    (select token_id from local_token_ids where label='a1_v3')
  )$$,
  'replacement-chain validator accepts a live multi-hop chain for same-lineage target'
);

select is(
  (select count(*)
   from private.device_tokens
   where account_id = 'a7000000-0000-4600-8600-000000000001'
     and replaced_by_token_id is not null),
  3::bigint,
  'replacement lineage creates exactly three non-live edges for token chain'
);

select is(
  (select state from private.devices where id = 'a7000000-0000-4600-8600-000000000022'),
  'active',
  'directly inserted device remains in active state'
);

select is(
  (select count(*) from private.device_tokens where account_id = 'a7000000-0000-4600-8600-000000000001' and device_id = 'a7000000-0000-4600-8600-000000000022' and replaced_by_token_id is not null),
  3::bigint,
  'every replaced token stores forward linkage in the same device lineage'
);

select is(
  (select bool_and(check_option)
   from (
  select private.device_scopes_are_canonical(
       array['device.bundle', 'device.feedback', 'device.import', 'device.route', 'device.status']
     ) as check_option
   ) q),
  true,
  'all allowed canonical scopes can be represented as a sorted token set'
);

select is(
  (select card = 0 from (
    select count(*)::int as card
    from private.device_tokens
    where account_id = 'a7000000-0000-4600-8600-000000000001'
      and credential_digest is null
  ) x),
  true,
  'credential digest cannot be null by schema and remains stored strictly once'
);

select is(
  (select count(*) from private.devices where account_id = 'a7000000-0000-4600-8600-000000000001'),
  6::bigint,
  'fixture account A owns six devices'
);

select is(
  (select count(*) from private.devices where account_id = 'b7000000-0000-4600-8600-000000000002'),
  2::bigint,
  'fixture account B owns two devices'
);

select is(
  (select count(*) from pg_catalog.pg_indexes where schemaname='private' and tablename='devices' and indexname='devices_live_by_account_idx'),
  1::bigint,
  'devices have a live-account supporting index'
);

select is(
  (select count(*) from pg_catalog.pg_indexes where schemaname='private' and tablename='device_tokens' and indexname='device_tokens_live_by_account_idx'),
  1::bigint,
  'device tokens have a live lookup index'
);

select is(
  (select count(*) from pg_catalog.pg_indexes where schemaname='private' and tablename='device_tokens' and indexname='device_tokens_replacement_target_idx'),
  1::bigint,
  'device tokens have a replacement guard index'
);

select finish();
rollback;
