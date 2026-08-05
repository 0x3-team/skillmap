begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(80);

-- =============================================================================
-- 1. Schema shape and privilege posture
-- =============================================================================
select has_table('private', 'import_sessions', 'import_sessions table exists');
select has_table('private', 'import_file_receipts', 'import_file_receipts table exists');

select has_function('private', 'begin_import_session',
  array['uuid','uuid','uuid','uuid','text','text','text','integer','bigint','uuid','timestamp with time zone'],
  'begin_import_session exists');
select has_function('private', 'resume_import_session',
  array['uuid','uuid','uuid'], 'resume_import_session exists');
select has_function('private', 'accept_import_file',
  array['uuid','uuid','uuid','uuid'], 'accept_import_file exists');
select has_function('private', 'finalize_import_session',
  array['uuid','uuid','uuid'], 'finalize_import_session exists');
select has_function('private', 'expire_import_session',
  array['uuid','uuid','uuid'], 'expire_import_session exists');
select has_function('private', 'import_session_has_exact_parity',
  array['uuid','uuid'], 'import_session_has_exact_parity exists');
select has_function('private', 'import_session_verification_digest',
  array['uuid','uuid'], 'import_session_verification_digest exists');

select ok((
  select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class where oid = 'private.import_sessions'::regclass),
  'import_sessions enables and forces RLS');
select ok((
  select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class where oid = 'private.import_file_receipts'::regclass),
  'import_file_receipts enables and forces RLS');

select is(
  (select count(*) from pg_catalog.pg_policies
   where schemaname = 'private' and tablename = 'import_sessions'),
  1::bigint, 'import_sessions has exactly the M2.11 owner-select policy');
select is(
  (select count(*) from pg_catalog.pg_policies
   where schemaname = 'private' and tablename = 'import_file_receipts'),
  1::bigint, 'import_file_receipts have exactly the M2.11 owner-select policy');

select ok(
  not has_table_privilege('anon', 'private.import_sessions', 'select')
  and not has_table_privilege('authenticated', 'private.import_sessions', 'select')
  and not has_table_privilege('service_role', 'private.import_sessions', 'select')
  and not has_table_privilege('anon', 'private.import_sessions', 'insert')
  and not has_table_privilege('authenticated', 'private.import_sessions', 'update')
  and not has_table_privilege('service_role', 'private.import_sessions', 'delete'),
  'application roles have no direct import_sessions privileges');
select ok(
  not has_table_privilege('anon', 'private.import_file_receipts', 'select')
  and not has_table_privilege('authenticated', 'private.import_file_receipts', 'select')
  and not has_table_privilege('service_role', 'private.import_file_receipts', 'select')
  and not has_table_privilege('anon', 'private.import_file_receipts', 'insert')
  and not has_table_privilege('authenticated', 'private.import_file_receipts', 'update')
  and not has_table_privilege('service_role', 'private.import_file_receipts', 'delete'),
  'application roles have no direct import_file_receipts privileges');

select ok(
  not has_function_privilege('anon', 'private.begin_import_session(uuid,uuid,uuid,uuid,text,text,text,integer,bigint,uuid,timestamp with time zone)', 'execute')
  and not has_function_privilege('authenticated', 'private.begin_import_session(uuid,uuid,uuid,uuid,text,text,text,integer,bigint,uuid,timestamp with time zone)', 'execute')
  and not has_function_privilege('service_role', 'private.begin_import_session(uuid,uuid,uuid,uuid,text,text,text,integer,bigint,uuid,timestamp with time zone)', 'execute')
  and not has_function_privilege('anon', 'private.accept_import_file(uuid,uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.accept_import_file(uuid,uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.accept_import_file(uuid,uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'private.finalize_import_session(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.finalize_import_session(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.finalize_import_session(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'private.expire_import_session(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.expire_import_session(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.expire_import_session(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'private.import_session_has_exact_parity(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.import_session_has_exact_parity(uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.import_session_has_exact_parity(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'private.import_session_verification_digest(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.import_session_verification_digest(uuid,uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.import_session_verification_digest(uuid,uuid)', 'execute'),
  'application roles have no execute privileges until M2.11');

select ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'private'
    and table_name in ('import_sessions', 'import_file_receipts')
    and (column_name like 'raw%' or column_name in ('prompt','body','token','storage_key','local_path'))
), 'import tables expose no raw, prompt, token, or secret-bearing columns');

-- =============================================================================
-- 2. Fixtures
-- =============================================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'a8000000-0000-4800-8800-000000000001',
    'authenticated', 'authenticated', 'a-in@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b8000000-0000-4800-8800-000000000002',
    'authenticated', 'authenticated', 'b-in@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', '');

insert into private.managed_skills (id, public_id, account_id, display_name) values
  ('a8000000-0000-4800-8800-000000000011', 'msk_' || repeat('1', 32),
    'a8000000-0000-4800-8800-000000000001', 'Skill Alpha'),
  ('a8000000-0000-4800-8800-000000000012', 'msk_' || repeat('7', 32),
    'a8000000-0000-4800-8800-000000000001', 'Skill Two-File'),
  ('b8000000-0000-4800-8800-000000000021', 'msk_' || repeat('2', 32),
    'b8000000-0000-4800-8800-000000000002', 'Skill Foreign');

insert into private.managed_skill_versions (
  id, public_id, account_id, managed_skill_id, manifest_schema_version,
  manifest_projection, manifest_digest, content_digest, canonical_metadata,
  source, provenance_state, analysis_state
) values
  -- version 101: single-file (authoritative {1 file, 3 bytes})
  ('a8000000-0000-4800-8800-000000000101', 'msv_' || repeat('1', 32),
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    '{"logical_id":"alpha","display_name":"Skill Alpha"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"alpha","revision":"r1"}'::jsonb,
    'verified', 'complete'),
  -- version 102: two-file (authoritative {2, 8})
  ('a8000000-0000-4800-8800-000000000102', 'msv_' || repeat('2', 32),
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000012',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('2', 64), 'sha256:' || repeat('b', 64),
    '{"logical_id":"two","display_name":"Skill Two-File"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"two","revision":"r1"}'::jsonb,
    'verified', 'complete'),
  -- version 103: single-file used by over-byte concurrent growth
  ('a8000000-0000-4800-8800-000000000103', 'msv_' || repeat('c', 32),
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('4', 64), 'sha256:' || repeat('c', 64),
    '{"logical_id":"third","display_name":"Skill Third"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"third","revision":"r1"}'::jsonb,
    'verified', 'complete'),
  -- version 104: gapped-ordinal version used by the parity gap probe
  ('a8000000-0000-4800-8800-000000000104', 'msv_' || repeat('4', 32),
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('5', 64), 'sha256:' || repeat('d', 64),
    '{"logical_id":"gap","display_name":"Skill Gap"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"gap","revision":"r1"}'::jsonb,
    'verified', 'complete'),
  -- version 105: single-file disposable version for the delete-cascade parity
  -- probe. The file is deleted mid-test to expose the empty-set finalize defect,
  -- so it must NOT be shared by any other test.
  ('a8000000-0000-4800-8800-000000000105', 'msv_' || repeat('5', 32),
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('6', 64), 'sha256:' || repeat('e', 64),
    '{"logical_id":"del","display_name":"Skill Delete"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"del","revision":"r1"}'::jsonb,
    'verified', 'complete');

insert into private.managed_skill_files (
  account_id, managed_skill_id, version_id, relative_path, media_type,
  byte_size, file_digest, storage_key, executable, ordinal
) values
  -- version 101 file (single)
  ('a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    'a8000000-0000-4800-8800-000000000101', 'SKILL.md', 'text/markdown; charset=utf-8',
    3, 'sha256:' || repeat('d', 64), 'imp-a0', false, 0),
  -- version 102 files (two)
  ('a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000012',
    'a8000000-0000-4800-8800-000000000102', 'SKILL.md', 'text/markdown; charset=utf-8',
    3, 'sha256:' || repeat('e', 64), 'imp-b0', false, 0),
  ('a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000012',
    'a8000000-0000-4800-8800-000000000102', 'docs/x.txt', 'text/plain',
    5, 'sha256:' || repeat('f', 64), 'imp-b1', false, 1),
  -- version 103 file (single, 3 bytes) used for concurrent-add over-byte probe
  ('a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    'a8000000-0000-4800-8800-000000000103', 'SKILL.md', 'text/markdown; charset=utf-8',
    3, 'sha256:' || repeat('9', 64), 'imp-c0', false, 0),
  -- version 104: GAPPED ordinals {2,5} (count=2, bytes=7). M2.05 allows
  -- nonnegative unique non-contiguous ordinals; parity must reject the gap.
  ('a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    'a8000000-0000-4800-8800-000000000104', 'SKILL.md', 'text/markdown; charset=utf-8',
    2, 'sha256:' || repeat('1', 64), 'imp-g0', false, 2),
  ('a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    'a8000000-0000-4800-8800-000000000104', 'docs/x.txt', 'text/plain',
    5, 'sha256:' || repeat('2', 64), 'imp-g1', false, 5),
  -- version 105 file (single, 3 bytes); deleted mid-test by the cascade probe.
  ('a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000011',
    'a8000000-0000-4800-8800-000000000105', 'SKILL.md', 'text/markdown; charset=utf-8',
    3, 'sha256:' || repeat('3', 64), 'imp-h0', false, 0);

insert into private.devices (
  id, public_id, account_id, display_name, platform, connector_version, locale
) values
  ('a8000000-0000-4800-8800-000000000301', 'dev_' || repeat('1', 32),
    'a8000000-0000-4800-8800-000000000001', 'Account A-D1', 'macos', '3.0.0', 'en-US'),
  ('a8000000-0000-4800-8800-000000000305', 'dev_' || repeat('5', 32),
    'a8000000-0000-4800-8800-000000000001', 'Account A-D2', 'linux', '3.0.0', 'en-US'),
  ('b8000000-0000-4800-8800-000000000302', 'dev_' || repeat('2', 32),
    'b8000000-0000-4800-8800-000000000002', 'Brain B', 'linux', '3.0.0', 'en');

insert into private.devices (
  id, public_id, account_id, display_name, platform, connector_version, locale,
  state, issued_at, expires_at, revoked_at
) values
  ('a8000000-0000-4800-8800-000000000303', 'dev_' || repeat('3', 32),
    'a8000000-0000-4800-8800-000000000001', 'Revoked', 'macos', '3.0.0', 'fr',
    'revoked', now(), null, now()),
  ('a8000000-0000-4800-8800-000000000304', 'dev_' || repeat('4', 32),
    'a8000000-0000-4800-8800-000000000001', 'Expired', 'linux', '3.0.0', 'en',
    'active', now() - interval '10 days', now() - interval '1 day', null);

-- =============================================================================
-- 3. begin_import_session
-- =============================================================================
create temp table begin_result (id uuid not null);
insert into begin_result
select private.begin_import_session(
  'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000301',
  'a8000000-0000-4800-8800-000000000011', 'a8000000-0000-4800-8800-000000000101',
  '1.0', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
  1, 3, '25fa9a97-94c9-4b00-88aa-000000000001', null);

select is((select state from private.import_sessions where id = (select id from begin_result)),
  'in_progress', 'begin_import_session writes an in_progress session');
select ok((select account_id = 'a8000000-0000-4800-8800-000000000001'
    and device_id = 'a8000000-0000-4800-8800-000000000301'
    and managed_skill_id = 'a8000000-0000-4800-8800-000000000011'
    and version_id = 'a8000000-0000-4800-8800-000000000101'
    and expected_file_count = 1 and expected_byte_total = 3
    and accepted_file_count = 0 and accepted_byte_total = 0
   from private.import_sessions where id = (select id from begin_result)),
  'session binds full account/device/skill/version coordinates');
select ok((select imp_ ~ '^imp_[0-9a-f]{32}$'
           from private.import_sessions where id = (select id from begin_result)),
  'generated session public id satisfies imp_ grammar');
select ok(not exists (
  select 1 from private.import_sessions where id = (select id from begin_result)
    and (expiry_at is null or expiry_at <= statement_timestamp())
), 'session expiry defaults to the future');

-- same idempotency input resumes the same session
select ok((
  select private.begin_import_session(
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000301',
    'a8000000-0000-4800-8800-000000000011', 'a8000000-0000-4800-8800-000000000101',
    '1.0', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    1, 3, '25fa9a97-94c9-4b00-88aa-000000000001', null)
  ) = (select id from begin_result),
  'same idempotency input resumes the same session id');

-- expected byte total not equal to authoritative version set rejects at begin
select throws_ok($$
  select private.begin_import_session(
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000301',
    'a8000000-0000-4800-8800-000000000011', 'a8000000-0000-4800-8800-000000000101',
    '1.0', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    1, 999, '25faff00-0000-4800-88aa-000000000002', null)
$$, 22023, 'expected file count/byte total do not match the bound version file set',
  'non-authoritative expected byte total is rejected at begin');

-- expected count not authoritative rejects
select throws_ok($$
  select private.begin_import_session(
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000301',
    'a8000000-0000-4800-8800-000000000011', 'a8000000-0000-4800-8800-000000000101',
    '1.0', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    999, 3, '25faff00-0000-4800-88aa-000000000002', null)
$$, 22023, 'expected file count/byte total do not match the bound version file set',
  'non-authoritative expected file count is rejected at begin');

-- schema-version parity: the bound version 101 is schema 1.0; declaring 9.9 must be rejected
select throws_ok($$
  select private.begin_import_session(
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000301',
    'a8000000-0000-4800-8800-000000000011', 'a8000000-0000-4800-8800-000000000101',
    '9.9', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    1, 3, '30000000-0000-4800-88aa-000000000029', null)
$$, 22023, 'manifest schema version does not match the bound skill version',
  'declaring schema version 9.9 for a 1.0 version is rejected at begin');

-- foreign device
select throws_ok($$
  select private.begin_import_session(
    'b8000000-0000-4800-8800-000000000002', 'a8000000-0000-4800-8800-000000000301',
    'a8000000-0000-4800-8800-000000000011', 'a8000000-0000-4800-8800-000000000101',
    '1.0', 'sha256:x', 'sha256:y', 1, 3,
    '30000000-0000-4800-88aa-000000000010', null)
$$, 42501, null, 'foreign device is denied at begin');

-- foreign skill
select throws_ok($$
  select private.begin_import_session(
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000301',
    'b8000000-0000-4800-8800-000000000021', 'b8000000-0000-4800-8800-000000000201',
    '1.0', 'sha256:q', 'sha256:r', 1, 0, '30000000-0000-4800-88aa-000000000011', null)
$$, 22023, null, 'foreign skill/version is denied at begin');

-- revoked / expired devices denied
select throws_ok($$
  select private.begin_import_session(
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000303',
    'a8000000-0000-4800-8800-000000000011', 'a8000000-0000-4800-8800-000000000101',
    '1.0', 'sha256:r', 'sha256:s', 1, 3, '30000000-0000-4800-88aa-000000000012', null)
$$, 42501, null, 'revoked device denied at begin');
select throws_ok($$
  select private.begin_import_session(
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000304',
    'a8000000-0000-4800-8800-000000000011', 'a8000000-0000-4800-8800-000000000101',
    '1.0', 'sha256:e', 'sha256:g', 1, 3, '30000000-0000-4800-88aa-000000000014', null)
$$, 42501, null, 'expired device denied at begin');

-- =============================================================================
-- 4. accept_import_file on a single-file version
-- =============================================================================
do $x$
begin
  perform private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001', 'a8000000-0000-4800-8800-000000000301',
    (select id from begin_result), (select id from private.managed_skill_files where storage_key='imp-a0'));
end
$x$;

select is((select accepted_file_count from private.import_sessions where id=(select id from begin_result)),
  1, 'accepting the single expected file advances accepted_file_count');
select is((select accepted_byte_total from private.import_sessions where id=(select id from begin_result)),
  3::bigint, 'accepted_byte_total matches the file byte size');
select is((select count(*)::bigint from private.import_file_receipts where session_id=(select id from begin_result)),
  1::bigint, 'exactly one receipt is written');
select is((select file_digest from private.import_file_receipts where session_id=(select id from begin_result)),
  'sha256:' || repeat('d', 64), 'receipt records the file digest');
select is((select ordinal from private.import_file_receipts where session_id=(select id from begin_result)),
  0, 'receipt records the file ordinal');
select is((select device_id from private.import_file_receipts where session_id=(select id from begin_result)),
  'a8000000-0000-4800-8800-000000000301', 'receipt binds the session device');

-- re-accept same file (replay) denied
select throws_ok($$select 1 from private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from begin_result),(select id from private.managed_skill_files where storage_key='imp-a0'))$$
  , 22023, 'import file is already accepted', 're-accepting the same file is denied (replay)');

-- foreign account cannot accept into owner session
select throws_ok($$select 1 from private.accept_import_file(
    'b8000000-0000-4800-8800-000000000002','b8000000-0000-4800-8800-000000000302',
    (select id from begin_result),(select id from private.managed_skill_files where storage_key='imp-a0'))$$
  , 22023, 'import session was not found for this account/device', 'foreign account cannot accept');
-- a second device of same account cannot accept
select throws_ok($$select 1 from private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000305',
    (select id from begin_result),(select id from private.managed_skill_files where storage_key='imp-a0'))$$
  , 22023, 'import session was not found for this account/device', 'a different device of same account cannot accept');

-- =============================================================================
-- 5. finalize on a fully-accepted single-file session
-- =============================================================================
select is((select private.finalize_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from begin_result))),
  (select id from begin_result), 'finalize returns the session under exact parity');
select is((select state from private.import_sessions where id=(select id from begin_result)),
  'verified', 'session becomes verified after exact parity');
select ok((select verified_at is not null from private.import_sessions where id=(select id from begin_result)),
  'verified session carries verified_at');
select is((select verification_digest from private.import_sessions where id=(select id from begin_result)) ~ '^sha256:[0-9a-f]{64}$',
  true, 'terminal verification digest is computed');

-- a newly-accepted (in_progress, but receipts present) session must not be
-- manufacture-verified by a bare UPDATE with a forged (all-zero) digest even
-- though exact parity already holds. (Audit fix: P1 forged verified digest.)
create temp table forge_verify (id uuid not null);
insert into forge_verify
select private.begin_import_session(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  'a8000000-0000-4800-8800-000000000011','a8000000-0000-4800-8800-000000000101',
  '1.0','sha256:'||repeat('1',64),'sha256:'||repeat('a',64),1,3,'30000000-0000-4800-88aa-000000000040',null);
do $f1$ begin
  perform private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from forge_verify), (select id from private.managed_skill_files where storage_key='imp-a0'));
end $f1$;
-- parity holds after accepting the one file
select is(private.import_session_has_exact_parity('a8000000-0000-4800-8800-000000000001',(select id from forge_verify)),
  true, 'exact parity holds after accepting the single file');
-- a bare UPDATE with a forged (all-zero) digest must be rejected even though parity holds
select throws_ok($$update private.import_sessions
    set state='verified', verified_at=now(), verification_digest='sha256:'||repeat('0',64)
    where id=(select id from forge_verify)$$,
  22023, 'verified transition requires the exact deterministic verification digest',
  'bare UPDATE with forged digest is rejected (forged-verified-digest defense)');
-- the session must still be in_progress after the rejected forged write
select is((select state from private.import_sessions where id=(select id from forge_verify)),
  'in_progress', 'the forged direct UPDATE leaves the session in_progress');
-- normal finalize on the same session must succeed and write the deterministic digest
select is((select private.finalize_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from forge_verify))),
  (select id from forge_verify), 'finalize succeeds after the rejected forged update');
select is((select state from private.import_sessions where id=(select id from forge_verify)),
  'verified', 'the session becomes verified via normal finalize');
select is((select verification_digest from private.import_sessions where id=(select id from forge_verify)) =
  private.import_session_verification_digest('a8000000-0000-4800-8800-000000000001',(select id from forge_verify)),
  true, 'normal finalize writes the exact deterministic digest');

-- =============================================================================
-- 6. Two-file version: subset / substitution finalize must be rejected
-- =============================================================================
create temp table two_sess (id uuid not null);
insert into two_sess
select private.begin_import_session(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  'a8000000-0000-4800-8800-000000000012','a8000000-0000-4800-8800-000000000102',
  '1.0','sha256:'||repeat('2',64),'sha256:'||repeat('b',64),2,8,'30000000-0000-4800-88aa-000000000031',null);

-- accept only one of two files; finalize must reject (P1 subset omitted)
do $t1$ begin
  perform private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from two_sess), (select id from private.managed_skill_files where storage_key='imp-b0'));
end $t1$;
select throws_ok($$select private.finalize_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from two_sess))$$,
  22023, 'import session does not match the authoritative version file set',
  'finalize rejects a two-file version with only one file accepted');

-- accept the second file; now subset full and finalize succeeds
do $t2$ begin
  perform private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from two_sess),(select id from private.managed_skill_files where storage_key='imp-b1'));
end $t2$;
select is((select private.finalize_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from two_sess))),
  (select id from two_sess), 'two-file session finalizes once all files accepted');

-- =============================================================================
-- 6b. Gapped-ordinal version: finalize must reject non-contiguous ordinal set
-- =============================================================================
-- version 104 files carry ordinals {2,5} (count=2, bytes=7). M2.05 permits
-- nonnegative unique non-contiguous ordinals, so the parity proof must reject
-- the gap even though count and bytes agree. (P1 gapped ordinal fix.)
create temp table gap_sess (id uuid not null);
insert into gap_sess
select private.begin_import_session(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  'a8000000-0000-4800-8800-000000000011','a8000000-0000-4800-8800-000000000104',
  '1.0','sha256:'||repeat('5',64),'sha256:'||repeat('d',64),2,7,'30000000-0000-4800-88aa-000000000041',null);
select is(private.import_session_has_exact_parity('a8000000-0000-4800-8800-000000000001',(select id from gap_sess)),
  false, 'empty gap session is not at parity (no receipts)');
-- accept both gapped files
do $g1$ begin
  perform private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from gap_sess),(select id from private.managed_skill_files where storage_key='imp-g0'));
  perform private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from gap_sess),(select id from private.managed_skill_files where storage_key='imp-g1'));
end $g1$;
-- count and bytes now match (2 and 7) but ordinals are the gapped {2,5}
select is((select count(*)::bigint from private.import_file_receipts where session_id=(select id from gap_sess)), 2::bigint,
  'gapped session has both accepted receipts');
select is((select coalesce(sum(accepted_byte_size),0)::bigint from private.import_file_receipts where session_id=(select id from gap_sess)), 7::bigint,
  'gapped session accepted bytes = 7');
select is(private.import_session_has_exact_parity('a8000000-0000-4800-8800-000000000001',(select id from gap_sess)),
  false, 'gapped ordinals {2,5} fail parity (not contiguous 0..1)');
select throws_ok($$select private.finalize_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from gap_sess))$$,
  22023, 'import session does not match the authoritative version file set',
  'finalize rejects a version with gapped ordinals despite matching count/bytes');
select is((select state from private.import_sessions where id=(select id from gap_sess)),
  'in_progress', 'the gapped session stays in_progress after rejected finalize');

-- =============================================================================
-- 7. Over-byte accept is rejected at the real reachable accept-time boundary
-- =============================================================================
-- Begin a session on version 103 while its authoritative set is exactly one
-- 3-byte file (imp-c0), so expected={1,3}. Accept that single file (count 1/1,
-- bytes 3/3). Then we add a SECOND same-version (103) 3-byte file at ordinal 1
-- to the authoritative set; accepting it would push the projected accepted byte
-- total (3 + 3 = 6) over the recorded expected_byte_total (3), so the over-byte
-- guard must reject it with the exact over-byte message and leave counters at
-- 1/3. This is the real reachable path Codex proved; it is not the foreign-file
-- path. (P2 fix.)
create temp table over_sess (id uuid not null);
insert into over_sess
select private.begin_import_session(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  'a8000000-0000-4800-8800-000000000011','a8000000-0000-4800-8800-000000000103',
  '1.0','sha256:'||repeat('4',64),'sha256:'||repeat('c',64),1,3,'30000000-0000-4800-88aa-000000000032',null);
-- accept the one authoritative file
do $ob$ begin
  perform private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from over_sess), (select id from private.managed_skill_files where storage_key='imp-c0'));
end $ob$;
select is((select accepted_file_count from private.import_sessions where id=(select id from over_sess)), 1,
  'first 3-byte v103 file accepted (count 1)');
select is((select accepted_byte_total from private.import_sessions where id=(select id from over_sess)), 3::bigint,
  'first 3-byte v103 file accepted (bytes 3)');
-- add a second same-version (103) 3-byte file at ordinal 1 to the authoritative set
insert into private.managed_skill_files (
  account_id,managed_skill_id,version_id,relative_path,media_type,byte_size,file_digest,storage_key,executable,ordinal
) values (
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000011',
  'a8000000-0000-4800-8800-000000000103','docs/extra.txt','text/plain',
  3,'sha256:'||repeat('8',64),'imp-c2',false,1);
-- accepting it must raise the exact over-byte error
select throws_ok($$select 1 from private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from over_sess),(select id from private.managed_skill_files where storage_key='imp-c2'))$$
  , 22023, 'import byte total would exceed the session expectation',
  'accepting a same-version file that would exceed the bound byte total is rejected');
select is((select accepted_file_count from private.import_sessions where id=(select id from over_sess)), 1,
  'the rejected second accept does not advance accepted_file_count (stays 1)');
select is((select accepted_byte_total from private.import_sessions where id=(select id from over_sess)), 3::bigint,
  'the rejected second accept leaves accepted_byte_total at 3');

-- =============================================================================
-- 8. Expiry
-- =============================================================================
create temp table exp_sess (id uuid not null);
insert into exp_sess
select private.begin_import_session(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  'a8000000-0000-4800-8800-000000000011','a8000000-0000-4800-8800-000000000101',
  '1.0','sha256:'||repeat('1',64),'sha256:'||repeat('a',64),1,3,'30000000-0000-4800-88aa-000000000033',now()+interval '30 minutes');
select is((select state from private.import_sessions where id=(select id from exp_sess)),'in_progress','future-dated expiry begins as in_progress');
select is((select private.expire_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',(select id from exp_sess)))
  ,true,'expire returns true');
select is((select state from private.import_sessions where id=(select id from exp_sess)),'expired','session becomes expired');
select is((select private.expire_import_session(
    'b8000000-0000-4800-8800-000000000002','b8000000-0000-4800-8800-000000000302',(select id from exp_sess)))
  ,false,'foreign account cannot expire');
select is((select private.expire_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000305',(select id from exp_sess)))
  ,false,'a different device cannot expire');

-- =============================================================================
-- 9. resume isolation
-- =============================================================================
select is((select private.resume_import_session(
    'b8000000-0000-4800-8800-000000000002','b8000000-0000-4800-8800-000000000302',(select id from begin_result)))
  ,null,'foreign account resume returns null');
select is((select private.resume_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000305',(select id from begin_result)))
  ,null,'different device resume returns null');
select is((select (private.resume_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',(select id from begin_result)))->>'state')
  ,'verified','owner resume reflects the terminal verified state');

-- =============================================================================
-- 10. direct-UPDATE terminal re-open is rejected (verified cannot be reopened)
-- =============================================================================
select throws_ok($$update private.import_sessions set state='in_progress'
    where id=(select id from begin_result)$$,
  22023, 'terminal import session rows are immutable', 'verified sessions cannot be re-opened');

-- =============================================================================
-- 11. Deleted-authoritative-file: session-row parity must reject finalize
-- =============================================================================
-- version 105 has a single 3-byte file. Begin a session (expected/accepted
-- counters 1/3), accept the file, then DELETE the authoritative managed_skill_file
-- so its receipt cascades. The session still records accepted 1/3 while both the
-- authoritative and receipt aggregates become 0/0. The parity helper must now
-- return false (session-row equality), finalize must raise 22023, and the session
-- must stay in_progress. This is the final P1: M2.05 permits DELETE, so parity
-- must compare the session row to both aggregates, not just the two aggregates.
create temp table del_sess (id uuid not null);
insert into del_sess
select private.begin_import_session(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  'a8000000-0000-4800-8800-000000000011','a8000000-0000-4800-8800-000000000105',
  '1.0','sha256:'||repeat('6',64),'sha256:'||repeat('e',64),1,3,'30000000-0000-4800-88aa-000000000050',null);
-- accept the sole 3-byte file
do $del_acpt$ begin
  perform private.accept_import_file(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from del_sess),(select id from private.managed_skill_files where storage_key='imp-h0'));
end $del_acpt$;
select is((select accepted_file_count from private.import_sessions where id=(select id from del_sess)), 1,
  'before delete, accepted_file_count = 1');
select is((select accepted_byte_total from private.import_sessions where id=(select id from del_sess)), 3::bigint,
  'before delete, accepted_byte_total = 3');
select is(private.import_session_has_exact_parity('a8000000-0000-4800-8800-000000000001',(select id from del_sess)),
  true, 'parity holds while the authoritative set is the accepted 1/3');
-- delete the authoritative file; its receipt cascades (M2.05 permits DELETE)
do $del2$ begin
  delete from private.managed_skill_files where storage_key='imp-h0';
end $del2$;
select is((select count(*)::bigint from private.import_file_receipts where session_id=(select id from del_sess)), 0::bigint,
  'deleting the authoritative file cascades the receipt (receipt count 0)');
select is((select count(*)::bigint from private.managed_skill_files
    where account_id='a8000000-0000-4800-8800-000000000001'
      and managed_skill_id='a8000000-0000-4800-8800-000000000011'
      and version_id='a8000000-0000-4800-8800-000000000105'),
  0::bigint, 'deleted authoritative file leaves the version with zero files');
select is((select accepted_file_count from private.import_sessions where id=(select id from del_sess)), 1,
  'deleted-file session still records accepted_file_count = 1');
select is((select accepted_byte_total from private.import_sessions where id=(select id from del_sess)), 3::bigint,
  'deleted-file session still records accepted_byte_total = 3');
select is(private.import_session_has_exact_parity('a8000000-0000-4800-8800-000000000001',(select id from del_sess)),
  false, 'parity helper returns false after the authoritative file is deleted (session vs aggregate imbalance)');
select throws_ok($$select private.finalize_import_session(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from del_sess))$$,
  22023, 'import session does not match the authoritative version file set',
  'finalize raises 22023 after the authoritative file is deleted');
select is((select state from private.import_sessions where id=(select id from del_sess)),
  'in_progress', 'the deleted-file session stays in_progress after rejected finalize');

select * from finish();
rollback;
