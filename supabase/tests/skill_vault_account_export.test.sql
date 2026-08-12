begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists pgcrypto with schema extensions;
set local search_path = extensions, public, private, api;

select plan(75);

-- M2.13 — authenticated-owner Skill Vault account export.
--
-- Exercises the single `api.export_my_managed_skill_vault()` function added by
-- the M2.13 forward-only migration against a reset local DB under reachable
-- roles (authenticated / anon / service_role). Covers:
--   * exact call surface: exists, zero args, SECURITY DEFINER, empty
--     search_path, postgres owner, jsonb return, plpgsql body;
--   * least-privilege grants: authenticated-only EXECUTE; anon/service_role/
--     definer/public revoked; zero new private-table grants;
--   * fail-closed authority: missing JWT, banned, and deleted accounts;
--   * two-account fixtures spanning every export section: A returns only A,
--     B returns only B, absent sections yield `[]`/count 0;
--   * metadata/version exactness, deterministic ordering, byte-exact repeat
--     (sha256 digest reproducible), row-caps + truncation/count metadata,
--     public-id relation coherence, and forbidden-key/value canaries;
--   * bounded output and zero fixture residue after rollback.

-- Sanity: the ten managed vault tables exist but must be empty before we seed
-- them, so any fixture residue visible after `rollback` would be caught.
select ok(
  (select count(*) = 0 from private.managed_skills)
  and (select count(*) = 0 from private.managed_skill_versions)
  and (select count(*) = 0 from private.managed_skill_releases)
  and (select count(*) = 0 from private.managed_skill_files)
  and (select count(*) = 0 from private.devices)
  and (select count(*) = 0 from private.import_sessions)
  and (select count(*) = 0 from private.import_file_receipts)
  and (select count(*) = 0 from private.route_decisions)
  and (select count(*) = 0 from private.route_decision_selections)
  and (select count(*) = 0 from private.route_corrections),
  'fresh reset DB: the ten managed vault tables are empty before fixtures'
);

-- =============================================================================
-- 1. Exact function surface.
-- =============================================================================
select has_function('api', 'export_my_managed_skill_vault', array[]::text[],
  'api.export_my_managed_skill_vault() exists');

select is(
  (select pronargs::integer
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'export_my_managed_skill_vault'),
  0,
  'export function accepts no arguments'
);

select ok(
  (select prosecdef
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'export_my_managed_skill_vault'),
  'function is SECURITY DEFINER'
);

select ok(
  (select proconfig = array['search_path=""']
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'export_my_managed_skill_vault'),
  'function sets an empty search_path'
);

select is(
  (select pg_catalog.pg_get_userbyid(p.proowner)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'export_my_managed_skill_vault'),
  'postgres',
  'function is owned by postgres (resolves auth.uid()/reads vault without auth grants)'
);

select is(
  (select pg_catalog.pg_get_function_result(p.oid)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'export_my_managed_skill_vault'),
  'jsonb',
  'function returns jsonb'
);

select is(
  (select l.lanname
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'api' and p.proname = 'export_my_managed_skill_vault'),
  'plpgsql',
  'function language is plpgsql'
);

-- =============================================================================
-- 2. Least-privilege grants: authenticated-only EXECUTE.
-- =============================================================================
select ok(
  has_function_privilege('authenticated', 'api.export_my_managed_skill_vault()', 'execute'),
  'authenticated has EXECUTE'
);
select ok(
  not has_function_privilege('anon', 'api.export_my_managed_skill_vault()', 'execute'),
  'anon is denied EXECUTE'
);
select ok(
  not has_function_privilege('service_role', 'api.export_my_managed_skill_vault()', 'execute'),
  'service_role is denied EXECUTE'
);
select ok(
  not has_function_privilege('skillmap_vault_definer', 'api.export_my_managed_skill_vault()', 'execute'),
  'NOLOGIN vault definer is denied EXECUTE'
);
select ok(
  not has_function_privilege('public', 'api.export_my_managed_skill_vault()', 'execute'),
  'PUBLIC is denied EXECUTE'
);

-- Zero new private-table grants: anon/authenticated/service_role have no role-level
-- privilege on the ten managed vault tables, so the export function is the only
-- read surface.
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'service_role')
      and table_schema = 'private'
      and table_name in (
        'managed_skills','managed_skill_versions','managed_skill_releases',
        'managed_skill_files','devices','import_sessions','import_file_receipts',
        'route_decisions','route_decision_selections','route_corrections'
      )
  ),
  'anon/authenticated/service_role hold zero direct privileges on the ten vault tables'
);

-- =============================================================================
-- 3. Fixtures: one full account (A) spanning every section, one partial account
--    (B) with isolated data, a row-cap account (C), and a byte-cap account (D).
-- =============================================================================
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token) values
  ('00000000-0000-0000-0000-000000000000','a8000000-0000-4800-8800-000000000001','authenticated','authenticated','exp-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','b8000000-0000-4800-8800-000000000002','authenticated','authenticated','exp-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','c8000000-0000-4800-8800-000000000003','authenticated','authenticated','exp-c@example.invalid','',now(),'{}','{}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','d8000000-0000-4800-8800-000000000004','authenticated','authenticated','exp-d@example.invalid','',now(),'{}','{}',now(),now(),'','','','');

-- ---- Account A: one skill, one version, one active release, two files, one
-- ---- device, one import session + one receipt, one route decision + selection + correction.
insert into private.managed_skills (id, public_id, account_id, display_name, description) values
  ('a8000000-0000-4800-8800-000000000011','msk_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','Export Alpha','alpha desc');

insert into private.managed_skill_versions (id, public_id, account_id, managed_skill_id, manifest_schema_version, manifest_projection, manifest_digest, content_digest, canonical_metadata, source, provenance_state, analysis_state) values
  ('a1000000-0000-4000-8000-000000000101','msv_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000011','1.0','{}'::bytea,'sha256:'||repeat('1',64),'sha256:'||repeat('a',64),'{"logical_id":"alpha","display_name":"Export Alpha"}','{"authority":"managed","kind":"local","namespace":"owner","source_id":"a","revision":"r1"}','verified','complete');

insert into private.managed_skill_releases (id, public_id, account_id, managed_skill_id, version_id, lifecycle_state, eligibility_reasons) values
  ('a9000000-0000-4000-8000-000000000001','msr_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000101','active','{}');

update private.managed_skills
set active_release_id = 'a9000000-0000-4000-8000-000000000001',
    activation_revision = 1
where id = 'a8000000-0000-4800-8800-000000000011';

insert into private.managed_skill_files (id, public_id, account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal) values
  ('a7000000-0000-4700-8700-000000000001','msf_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000101','SKILL.md','text/markdown',3,'sha256:'||repeat('3',64),'exp-a-s0',false,0),
  ('a7000000-0000-4700-8700-000000000002','msf_'||repeat('b',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000101','README.md','text/markdown',5,'sha256:'||repeat('4',64),'exp-a-s1',false,1);

insert into private.devices (id, public_id, account_id, display_name, platform, connector_version, locale) values
  ('a8000000-0000-4800-8800-000000000301','dev_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','Device A','macos','3.0.0','en-US');

insert into private.import_sessions (id, imp_, account_id, device_id, managed_skill_id, version_id, manifest_schema_version, manifest_digest, content_digest, expected_file_count, expected_byte_total, idempotency_key, state) values
  ('a7000000-0000-4700-8700-000000000201','imp_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301','a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000101','2.0','sha256:'||repeat('1',64),'sha256:'||repeat('a',64),2,8,'30000000-0000-4700-8700-0000000000aa','in_progress');

insert into private.import_file_receipts (id, account_id, device_id, session_id, file_id, managed_skill_id, version_id, relative_path, media_type, accepted_byte_size, file_digest, ordinal) values
  ('a7000000-0000-4700-8700-000000000301','a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301','a7000000-0000-4700-8700-000000000201','a7000000-0000-4700-8700-000000000001','a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000101','SKILL.md','text/markdown',3,'sha256:'||repeat('3',64),0);

insert into private.route_decisions (id, rtd_, account_id, device_id, request_id, request_fingerprint, result_type, confidence, reason_codes, account_revision, device_auth_binding_revision, routing_policy_revision, eligibility_revision, audience_revision, deadline_ms, elapsed_ms, segment_binding_ms, segment_eligibility_ms, segment_ranking_ms, replay_guaranteed_until, decision_expiry_at) values
  ('a0000000-0000-4000-8000-000000000401','rtd_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301','70000000-0000-4000-8000-0000000000aa','sha256:'||repeat('a',64),'ranked_candidates',0.9,'["prompt_intent_match"]','acct_rev_1','dev_auth_rev_1','policy_rev_1','elig_rev_1','aud_rev_1',1000,24,4,5,12, now()+interval '2 days', now()+interval '10 days');

insert into private.route_decision_selections (id, account_id, device_id, decision_id, managed_skill_id, version_id, release_id, row_kind, ordinal, role, confidence, reason_codes) values
  ('a0000000-0000-4000-8000-000000000501','a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301','a0000000-0000-4000-8000-000000000401','a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000101','a9000000-0000-4000-8000-000000000001','ranked',1,null,0.9,'["prompt_intent_match"]');

insert into private.route_corrections (id, rtc_, account_id, device_id, decision_id, outcome, idempotency_key) values
  ('a0000000-0000-4000-8000-000000000601','rtc_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301','a0000000-0000-4000-8000-000000000401','correct','40000000-0000-4000-8000-0000000000aa');

-- ---- Account B: skill + version only; every other section must be `[]`.
insert into private.managed_skills (id, public_id, account_id, display_name) values
  ('b8000000-0000-4800-8800-000000000021','msk_'||repeat('b',32),'b8000000-0000-4800-8800-000000000002','Export Bravo');

insert into private.managed_skill_versions (id, public_id, account_id, managed_skill_id, manifest_schema_version, manifest_projection, manifest_digest, content_digest, canonical_metadata, source, provenance_state, analysis_state) values
  ('b1000000-0000-4000-8000-000000000102','msv_'||repeat('b',32),'b8000000-0000-4800-8800-000000000002','b8000000-0000-4800-8800-000000000021','1.0','{}'::bytea,'sha256:'||repeat('2',64),'sha256:'||repeat('b',64),'{"logical_id":"bravo","display_name":"Export Bravo"}','{"authority":"managed","kind":"local","namespace":"owner","source_id":"b","revision":"r1"}','verified','complete');

-- ---- Account C: 110 devices to prove the 100-row device cap + truncation meta.
insert into private.devices (id, public_id, account_id, display_name, platform, connector_version, locale)
select pg_catalog.gen_random_uuid(),
       'dev_' || lpad(to_hex(g), 32, '0'),
       'c8000000-0000-4800-8800-000000000003',
       'Cap-' || g::text,
       'macos', '3.0.0', 'en-US'
from pg_catalog.generate_series(1, 110) as s(g);

-- ---- Account D: variable-width text proves the function enforces a hard
-- ---- 1 MiB response boundary in addition to per-section row caps.
insert into private.managed_skills (id, public_id, account_id, display_name, description)
select pg_catalog.gen_random_uuid(),
       'msk_' || lpad(to_hex(g), 32, '0'),
       'd8000000-0000-4800-8800-000000000004',
       'Oversize-' || g::text,
       repeat('x', 20000)
from pg_catalog.generate_series(1, 60) as s(g);

-- =============================================================================
-- 4. Fail closed without a current, non-deleted, non-banned caller.
-- =============================================================================
-- 4a. anon / service denied at the permission layer.
set local role anon;
select throws_ok(
  $$select api.export_my_managed_skill_vault()$$,
  '42501', null, 'anon EXECUTE denied'
);
reset role;
set local role service_role;
select throws_ok(
  $$select api.export_my_managed_skill_vault()$$,
  '42501', null, 'service_role EXECUTE denied'
);
reset role;

-- 4b. authenticated with no JWT claim.sub: identity is null, fail closed.
set local role authenticated;
select throws_ok(
  $$select api.export_my_managed_skill_vault()$$,
  '42501', 'authenticated account authority is required',
  'missing JWT (no claim.sub) fails closed'
);
reset role;

-- 4c. banned account fails closed (banned_until in the future).
update auth.users set banned_until = now() + interval '1 day'
where id = 'b8000000-0000-4800-8800-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b8000000-0000-4800-8800-000000000002', true);
select throws_ok(
  $$select api.export_my_managed_skill_vault()$$,
  '42501', 'authenticated account authority is required',
  'banned account fails closed'
);
reset role;
update auth.users set banned_until = null
where id = 'b8000000-0000-4800-8800-000000000002';

-- 4d. deleted account fails closed.
update auth.users set deleted_at = now()
where id = 'b8000000-0000-4800-8800-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b8000000-0000-4800-8800-000000000002', true);
select throws_ok(
  $$select api.export_my_managed_skill_vault()$$,
  '42501', 'authenticated account authority is required',
  'deleted account fails closed'
);
reset role;
update auth.users set deleted_at = null
where id = 'b8000000-0000-4800-8800-000000000002';

-- =============================================================================
-- 5. Account A export: metadata, structure, sections, ordering, coherence.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a8000000-0000-4800-8800-000000000001', true);

select is(
  (select api.export_my_managed_skill_vault() ->> 'schema_version'),
  '1.0', 'schema_version is exactly 1.0'
);
select ok(
  (select api.export_my_managed_skill_vault() ? 'generated_at'),
  'generated_at metadata is present'
);
select ok(
  (select jsonb_typeof(api.export_my_managed_skill_vault() -> 'generated_at') = 'string'),
  'generated_at is an ISO-8601 timestamp string'
);
select is(
  (select count(*)::int from jsonb_object_keys(api.export_my_managed_skill_vault() -> 'sections')),
  10, 'sections object has exactly ten keys'
);

-- Every section carries { count, total, truncated, items }.
select ok(
  (select count(*) = 10
    from jsonb_each(api.export_my_managed_skill_vault() -> 'sections') sec)
    and (select bool_and(
            sec.value ? 'count' and sec.value ? 'total'
            and sec.value ? 'truncated' and sec.value ? 'items')
          from jsonb_each(api.export_my_managed_skill_vault() -> 'sections') sec),
  'each of the ten sections exposes count/total/truncated/items'
);

-- ---- managed_skills
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skills' ->> 'count'),
  '1', 'A: managed_skills count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skills' ->> 'total'),
  '1', 'A: managed_skills total = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skills' ->> 'truncated'),
  'false', 'A: managed_skills not truncated'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skills' -> 'items' -> 0 ->> 'public_id'),
  'msk_'||repeat('a',32), 'A: managed_skills item 0 is account A skill'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skills' -> 'items' -> 0 ->> 'active_release_public_id'),
  'msr_'||repeat('a',32), 'A: managed_skills exposes the active release by public id'
);

-- ---- versions + releases -----
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_versions' ->> 'count'),
  '1', 'A: versions count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_versions' -> 'items' -> 0 ->> 'skill_public_id'),
  'msk_'||repeat('a',32), 'A: version relation uses public skill id'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_releases' ->> 'count'),
  '1', 'A: releases count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_releases' -> 'items' -> 0 ->> 'lifecycle_state'),
  'active', 'A: release lifecycle_state active'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_releases' -> 'items' -> 0 ->> 'version_public_id'),
  'msv_'||repeat('a',32), 'A: release relation uses public version id'
);

-- ---- managed_skill_files: two files, deterministic ordinal order ----
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_files' ->> 'count'),
  '2', 'A: files count = 2'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_files' ->> 'total'),
  '2', 'A: files total = 2'
);
select is(
  (select (api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_files' -> 'items' -> 0 ->> 'ordinal')::integer),
  0, 'A file ordered by ordinal'
);
select is(
  (select (api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_files' -> 'items' -> 1 ->> 'ordinal')::integer),
  1, 'A file ordered second'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_files' -> 'items' -> 0 ->> 'public_id'),
  'msf_'||repeat('a',32), 'A: files deterministic order by public id tie-break'
);

-- ---- devices ----
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'devices' ->> 'count'),
  '1', 'A: devices count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'devices' -> 'items' -> 0 ->> 'public_id'),
  'dev_'||repeat('a',32), 'A: device projects public id only'
);

-- ---- import_sessions / import_file_receipts ------------------------
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'import_sessions' ->> 'count'),
  '1', 'A: import_sessions count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'import_sessions' -> 'items' -> 0 ->> 'device_public_id'),
  'dev_'||repeat('a',32), 'A: import session device relation uses public id'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'import_file_receipts' ->> 'count'),
  '1', 'A: import_file_receipts count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'import_file_receipts' -> 'items' -> 0 ->> 'session_public_id'),
  'imp_'||repeat('a',32), 'A: import receipt relation uses session public id'
);

-- ---- route decisions / selections / corrections --------------------
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_decisions' ->> 'count'),
  '1', 'A: route_decisions count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_decisions' -> 'items' -> 0 ->> 'result_type'),
  'ranked_candidates', 'A: route decision metadata projects result_type'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_decision_selections' ->> 'count'),
  '1', 'A: route_decision_selections count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_decision_selections' -> 'items' -> 0 ->> 'release_public_id'),
  'msr_'||repeat('a',32), 'A: route selection relation uses public release id'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_corrections' ->> 'count'),
  '1', 'A: route_corrections count = 1'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_corrections' -> 'items' -> 0 ->> 'decision_public_id'),
  'rtd_'||repeat('a',32), 'A: route correction relation uses public decision id'
);

-- A returns ONLY A (no B public ids leaked into any item).
select ok(
  not (api.export_my_managed_skill_vault()::text ilike '%msk_' || repeat('b',32) || '%')
  and not (api.export_my_managed_skill_vault()::text ilike '%msv_' || repeat('b',32) || '%')
  and not (api.export_my_managed_skill_vault()::text ilike '%dev_' || repeat('b',32) || '%'),
  'A export leaks none of B public identifiers'
);

-- ---- deterministic byte-exact repeat + sha256 digest -----------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a8000000-0000-4800-8800-000000000001', true);
select ok(
  (select api.export_my_managed_skill_vault() = api.export_my_managed_skill_vault()),
  'two invocations in one statement are byte-identical (deterministic)'
);
select ok(
  (select extensions.digest(api.export_my_managed_skill_vault()::text::bytea, 'sha256')
     = extensions.digest(api.export_my_managed_skill_vault()::text::bytea, 'sha256')),
  'recomputed sha256 digest of the same export is reproducible'
);
-- bounded output: the assembled draft stays well under a declared byte bound.
select ok(
  (select pg_catalog.octet_length(api.export_my_managed_skill_vault()::text) < 1048576),
  'export payload stays within the 1 MiB declared byte bound'
);
reset role;

-- =============================================================================
-- 6. Account B export: only B, and absent sections are empty arrays.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b8000000-0000-4800-8800-000000000002', true);

select is(
  (select api.export_my_managed_skill_vault() ->> 'schema_version'),
  '1.0', 'B: schema_version is exactly 1.0'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skills' -> 'items' -> 0 ->> 'public_id'),
  'msk_'||repeat('b',32), 'B: managed_skills returns B own skill only'
);

-- B's absent repository sections must be zero-length.
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_releases' ->> 'count'),
  '0', 'B: releases is empty (count 0)'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_releases' -> 'items'),
  '[]'::jsonb, 'B: releases items is empty array'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skill_files' ->> 'count'),
  '0', 'B: files empty (count 0)'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'devices' ->> 'count'),
  '0', 'B: devices empty (count 0)'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'import_sessions' ->> 'count'),
  '0', 'B: import_sessions empty (count 0)'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'import_file_receipts' ->> 'count'),
  '0', 'B: import_file_receipts empty (count 0)'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_decisions' ->> 'count'),
  '0', 'B: route_decisions empty (count 0)'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_decision_selections' ->> 'count'),
  '0', 'B: route_decision_selections empty (count 0)'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'route_corrections' ->> 'count'),
  '0', 'B: route_corrections empty (count 0)'
);

select ok(
  not exists (
    select 1 from jsonb_array_elements(api.export_my_managed_skill_vault() -> 'sections' -> 'managed_skills' -> 'items') it
    where it ->> 'public_id' = 'msk_'||repeat('a',32)
  ),
  'B export contains none of A devices/skills'
);
reset role;

-- =============================================================================
-- 7. Explicit row-cap / truncation / count metadata (account C devices).
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c8000000-0000-4800-8800-000000000003', true);

select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'devices' ->> 'count'),
  '100', 'C: devices row cap yields count = 100'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'devices' ->> 'total'),
  '110', 'C: devices total = 110 (pre-truncation)'
);
select is(
  (select api.export_my_managed_skill_vault() -> 'sections' -> 'devices' ->> 'truncated'),
  'true', 'C: devices truncated = true (110 rows over 100-row cap)'
);
select ok(
  (select pg_catalog.jsonb_array_length(
    api.export_my_managed_skill_vault() -> 'sections' -> 'devices' -> 'items') = 100),
  'C: devices items length exactly 100 at the cap'
);
reset role;

-- =============================================================================
-- 7b. Hard byte cap: bounded row counts cannot hide unbounded text width.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd8000000-0000-4800-8800-000000000004', true);
select throws_ok(
  $$select api.export_my_managed_skill_vault()$$,
  '54000',
  'managed vault export exceeds bounded response size',
  'D: variable-width content over 1 MiB fails closed at the RPC boundary'
);
reset role;

-- =============================================================================
-- 8. Forbidden-key/value canaries: internal coordinate never projected.
--    The export must never carry internal UUID coordinate keys, account id,
--    credential digest, key version, token scopes/verifier, raw prompt/body/
--    context, manifest/body bytes, storage bucket/object key, foreign
--    identifiers, cleanup/deletion internals, or worker data.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a8000000-0000-4800-8800-000000000001', true);

select ok(
  (api.export_my_managed_skill_vault()::text !~ 'request_fingerprint')
  and (api.export_my_managed_skill_vault()::text !~ 'storage_key')
  and (api.export_my_managed_skill_vault()::text !~ 'manifest_digest')
  and (api.export_my_managed_skill_vault()::text !~ 'manifest_projection')
  and (api.export_my_managed_skill_vault()::text !~ 'verification_digest')
  and (api.export_my_managed_skill_vault()::text !~ 'idempotency_key')
  and (api.export_my_managed_skill_vault()::text !~ 'account_id')
  and (api.export_my_managed_skill_vault()::text !~ 'device_id')
  and (api.export_my_managed_skill_vault()::text !~ 'session_id')
  and (api.export_my_managed_skill_vault()::text !~ 'decision_id'),
  'A export excludes every internal foreign-key/id and secret-bearing coordinate');

-- values: no raw prompt/body/context, no token verifier digest, no worker field.
select ok(
  (api.export_my_managed_skill_vault()::text !~* 'rawPrompt|rawBody|rawContext|tokenScope|tokenVerifier|workerData|bucketName|objectKey|request_fingerprint|verification_digest'),
  'A export carries no raw prompt/body/context, token verifier/scope, storage bucket/object, worker data, fingerprint, or digest values');

-- cleanup / deletion internals are not projected.
select ok(
  (api.export_my_managed_skill_vault()::text !~ 'deleted_at')
  and (api.export_my_managed_skill_vault()::text !~ 'cleanup')
  and (api.export_my_managed_skill_vault()::text !~ 'worker'),
  'cleanup/deletion internals and worker fields are never projected'
);
reset role;

-- Rollback leaves zero residue: any fixture rolling back with this transaction
-- would leave the ten vault tables non-empty. The successful `finish()` below
-- proves the assertions passed; `rollback` then discards all inserted fixtures.
select * from finish();
rollback;
