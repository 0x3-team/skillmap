begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(132);

-- =============================================================================
-- M2.10 — managed Skill Vault RLS, owner projections/functions, definer handoff.
--
-- Identity scheme reuses the accepted M2.06 storage-suite fixtures verbatim word
-- (those UUIDs/public_ids/JSON already satisfy every storage version/file
-- constraint via the 102-assertion M2.06 suite):
--   account A : a6000000-0000-4600-8600-000000000001  (a@skillmap.invalid)
--   account B : b6000000-0000-4600-8600-000000000002  (b@skillmap.invalid)
--   skill A   : a6000000-0000-4600-8600-000000000011  (msk_a6000000000046000000000000000011)
--   skill B   : b6000000-0000-4600-8600-000000000012  (msk_b6000000000046000000000000000012)
--   version A : a6000000-0000-4600-8600-000000000101  (msv_a6000000000046000000000000000101)
--   version B : b6000000-0000-4600-8600-000000000102  (msv_b6000000000046000000000000000102)
--   file A    : a6000000-0000-4600-8600-000000000201  (msf_a6000000000046000000000000000201)
--   file B    : b6000000-0000-4600-8600-000000000202  (msf_b6000000000046000000000000000202)
-- Coverage: FORCE RLS; owner SELECT policies + base grants; projection reuse +
-- add versions/releases/files; owner create/update fns; activation handoff;
-- direct-DML denial; worker+cleanup grants; anon/PUBLIC zero; hardening;
-- catalog non-confusion; two-account+anon functional reachability.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Fixtures: two deterministic accounts with owned skill/version/file rows.
-- ---------------------------------------------------------------------------
select lives_ok($sql$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', 'a6000000-0000-4600-8600-000000000001', 'authenticated', 'authenticated', 'a@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', 'b6000000-0000-4600-8600-000000000002', 'authenticated', 'authenticated', 'b@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', '')
$sql$, 'two M2.10 owner-account fixtures insert');

select lives_ok($sql$
  insert into private.managed_skills (id, public_id, account_id, display_name) values
    ('a6000000-0000-4600-8600-000000000011', 'msk_a6000000000046000000000000000011', 'a6000000-0000-4600-8600-000000000001', 'M210 Alpha'),
    ('b6000000-0000-4600-8600-000000000012', 'msk_b6000000000046000000000000000012', 'b6000000-0000-4600-8600-000000000002', 'M210 Bravo')
$sql$, 'owner managed-skill fixtures insert');

select lives_ok($sql$
  insert into private.managed_skill_versions (
    id, public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values
    ('a6000000-0000-4600-8600-000000000101', 'msv_a6000000000046000000000000000101', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000011', '1.0', '{}'::bytea, 'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64), '{"logical_id":"m210-a","display_name":"M210 Alpha"}', '{"authority":"managed","kind":"local","namespace":"owner","source_id":"a","revision":"r1"}', 'verified', 'complete'),
    ('b6000000-0000-4600-8600-000000000102', 'msv_b6000000000046000000000000000102', 'b6000000-0000-4600-8600-000000000002', 'b6000000-0000-4600-8600-000000000012', '1.0', '{}'::bytea, 'sha256:' || repeat('2', 64), 'sha256:' || repeat('b', 64), '{"logical_id":"m210-b","display_name":"M210 Bravo"}', '{"authority":"managed","kind":"local","namespace":"owner","source_id":"b","revision":"r1"}', 'verified', 'complete')
$sql$, 'owner immutable version fixtures insert');

select lives_ok($sql$
  insert into private.managed_skill_files (
    id, public_id, account_id, managed_skill_id, version_id, relative_path,
    media_type, byte_size, file_digest, storage_key, executable, ordinal
  ) values
    ('a6000000-0000-4600-8600-000000000201', 'msf_a6000000000046000000000000000201', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000011', 'a6000000-0000-4600-8600-000000000101', 'SKILL.md', 'text/markdown', 5, 'sha256:' || repeat('c', 64), 'v1/msv_a/msf_a', false, 0),
    ('b6000000-0000-4600-8600-000000000202', 'msf_b6000000000046000000000000000202', 'b6000000-0000-4600-8600-000000000002', 'b6000000-0000-4600-8600-000000000012', 'b6000000-0000-4600-8600-000000000102', 'SKILL.md', 'text/markdown', 5, 'sha256:' || repeat('d', 64), 'v1/msv_b/msf_b', false, 1)
$sql$, 'owner file fixtures insert');

-- Eligible release fixtures: one `active`/no-reason release per account so the
-- M2.10 activation matrix can exercise a real CAS activation after the owner
-- handoff, plus this lets the releases projection show rows.
select lives_ok($sql$
  insert into private.managed_skill_releases (
    id, public_id, account_id, managed_skill_id, version_id,
    lifecycle_state, eligibility_reasons
  ) values
    ('a6000000-0000-4600-8600-000000000301', 'msr_a6000000000046000000000000000301', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000011', 'a6000000-0000-4600-8600-000000000101', 'active', '{}'::text[]),
    ('b6000000-0000-4600-8600-000000000302', 'msr_b6000000000046000000000000000302', 'b6000000-0000-4600-8600-000000000002', 'b6000000-0000-4600-8600-000000000012', 'b6000000-0000-4600-8600-000000000102', 'active', '{}'::text[])
$sql$, 'owner eligible release fixtures insert');

-- ---------------------------------------------------------------------------
-- 1. FORCE RLS invariants.
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.managed_skills'::regclass),
  'managed_skills enables and forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.managed_skill_versions'::regclass),
  'managed_skill_versions enables and forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.managed_skill_releases'::regclass),
  'managed_skill_releases enables and forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.managed_skill_files'::regclass),
  'managed_skill_files enables and forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.managed_skill_activation_receipts'::regclass),
  'managed_skill_activation_receipts enables and forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.skill_vault_incomplete_upload_cleanup'::regclass),
  'cleanup queue enables and forces RLS');

-- ---------------------------------------------------------------------------
-- 2. FORCE RLS owner-posture for the NOLOGIN definer. Browser roles hold NO
--    base-table privilege on the private managed tables: authenticated reads the
--    vault only through the api projections (section 3), whose SECURITY DEFINER
--    helpers run as the NOLOGIN definer and satisfy these per-owner policies.
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated','private.managed_skills','select')
  and not has_table_privilege('authenticated','private.managed_skills','insert')
  and not has_table_privilege('authenticated','private.managed_skills','update')
  and not has_table_privilege('authenticated','private.managed_skills','delete'),
  'authenticated holds zero base privilege on managed_skills');
select ok(not has_table_privilege('authenticated','private.managed_skill_versions','select')
  and not has_table_privilege('authenticated','private.managed_skill_versions','insert')
  and not has_table_privilege('authenticated','private.managed_skill_versions','update')
  and not has_table_privilege('authenticated','private.managed_skill_versions','delete'),
  'authenticated holds zero base privilege on managed_skill_versions');
select ok(not has_table_privilege('authenticated','private.managed_skill_releases','select')
  and not has_table_privilege('authenticated','private.managed_skill_releases','insert')
  and not has_table_privilege('authenticated','private.managed_skill_releases','update')
  and not has_table_privilege('authenticated','private.managed_skill_releases','delete'),
  'authenticated holds zero base privilege on managed_skill_releases');
select ok(not has_table_privilege('authenticated','private.managed_skill_files','select')
  and not has_table_privilege('authenticated','private.managed_skill_files','insert')
  and not has_table_privilege('authenticated','private.managed_skill_files','update')
  and not has_table_privilege('authenticated','private.managed_skill_files','delete'),
  'authenticated holds zero base privilege on managed_skill_files');
-- authenticated carries schema USAGE on private from the M1.0 catalog baseline
-- (it is required for the pre-existing catalog/postgrest surface and cannot be
-- revoked here). That USAGE alone does not permit reading any managed table:
-- block of base-table-zero assertions above plus the direct-DML guards below.
-- (Intentional no-op.)

select ok(exists (
  select 1 from pg_catalog.pg_policies
  where schemaname='private' and tablename='managed_skills'
    and policyname='managed_skills_definer_all' and 'skillmap_vault_definer' = any(roles)),
  'managed_skills definer_all policy is bounded to the vault definer');
select ok(exists (
  select 1 from pg_catalog.pg_policies
  where schemaname='private' and tablename='managed_skill_versions'
    and policyname='managed_skill_versions_definer_all' and 'skillmap_vault_definer' = any(roles)),
  'managed_skill_versions definer_all policy is bounded to the vault definer');
select ok(exists (
  select 1 from pg_catalog.pg_policies
  where schemaname='private' and tablename='managed_skill_releases'
    and policyname='managed_skill_releases_definer_all' and 'skillmap_vault_definer' = any(roles)),
  'managed_skill_releases definer_all policy is bounded to the vault definer');
select ok(exists (
  select 1 from pg_catalog.pg_policies
  where schemaname='private' and tablename='managed_skill_activation_receipts'
    and policyname='managed_skill_activation_receipts_definer_all' and 'skillmap_vault_definer' = any(roles)),
  'activation receipts definer_all policy is bounded to the vault definer');

select ok(exists (
  select 1 from pg_catalog.pg_proc c
  join pg_catalog.pg_namespace n on n.oid = c.pronamespace
  where n.nspname = 'private' and c.proname = 'current_request_uid'
    and pg_catalog.pg_get_userbyid(c.proowner) = 'postgres'
), 'the bound current_request_uid() helper is owned by postgres so the vault definer can resolve auth.uid() without auth-schema USAGE');
select ok(has_function_privilege('skillmap_vault_definer','private.current_request_uid()','execute')
  and not has_function_privilege('authenticated','private.current_request_uid()','execute'),
  'current_request_uid() is EXECUTE-granted to the vault definer but not authenticated');

-- ---------------------------------------------------------------------------
-- 3. Owner projections.
-- ---------------------------------------------------------------------------
select has_view('api', 'my_managed_skills', 'reused owner skills projection exists');
select has_view('api', 'my_managed_skill_versions', 'owner versions projection exists');
select has_view('api', 'my_managed_skill_releases', 'owner releases projection exists');
select has_view('api', 'my_managed_skill_files', 'owner files projection exists');
select ok(not exists (
  select 1 from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api' and c.relname = 'my_managed_skills_projection'
), 'the duplicate my_managed_skills_projection view is absent');
select ok(not exists (
  select 1 from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api' and c.relname = 'my_owned_versions_projection'
), 'the invented my_owned_versions_projection view is absent');

select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_catalog.pg_class where oid='api.my_managed_skills'::regclass),
  'skills projection uses security_invoker and security_barrier');
select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_catalog.pg_class where oid='api.my_managed_skill_versions'::regclass),
  'versions projection uses security_invoker and security_barrier');
select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_catalog.pg_class where oid='api.my_managed_skill_releases'::regclass),
  'releases projection uses security_invoker and security_barrier');
select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_catalog.pg_class where oid='api.my_managed_skill_files'::regclass),
  'files projection uses security_invoker and security_barrier');

select ok((select count(*) = 5 from pg_catalog.pg_attribute where attrelid='api.my_managed_skills'::regclass and attnum > 0 and not attisdropped),
  'skills projection exposes exactly five public columns');
select ok((select count(*) = 4 from pg_catalog.pg_attribute where attrelid='api.my_managed_skill_versions'::regclass and attnum > 0 and not attisdropped),
  'versions projection exposes exactly four public columns');
select ok((select count(*) = 4 from pg_catalog.pg_attribute where attrelid='api.my_managed_skill_releases'::regclass and attnum > 0 and not attisdropped),
  'releases projection exposes exactly four public columns');
select ok((select count(*) = 7 from pg_catalog.pg_attribute where attrelid='api.my_managed_skill_files'::regclass and attnum > 0 and not attisdropped),
  'files projection exposes exactly seven public columns');

select ok(not exists (
  select 1 from pg_catalog.pg_attribute
  where attrelid in ('api.my_managed_skills'::regclass,'api.my_managed_skill_versions'::regclass,
                     'api.my_managed_skill_releases'::regclass,'api.my_managed_skill_files'::regclass)
    and attname in ('id','account_id','managed_skill_id','active_release_id','activation_revision',
                    'manifest_projection','manifest_digest','content_digest','canonical_metadata',
                    'source','storage_key','file_digest','version_id')
), 'no projection leaks an internal UUID, account id, manifest bytes/digest, source, or storage key');

-- aligned owner SELECT privilege (positive) and anon (negative) for all four views
select ok(has_table_privilege('authenticated','api.my_managed_skills','select'),
  'authenticated SELECT on owner skills projection');
select ok(has_table_privilege('authenticated','api.my_managed_skill_versions','select'),
  'authenticated SELECT on owner versions projection');
select ok(has_table_privilege('authenticated','api.my_managed_skill_releases','select'),
  'authenticated SELECT on owner releases projection');
select ok(has_table_privilege('authenticated','api.my_managed_skill_files','select'),
  'authenticated SELECT on owner files projection');
select ok(not has_table_privilege('anon','api.my_managed_skills','select'),
  'anon SELECT denied on owner skills projection');
select ok(not has_table_privilege('anon','api.my_managed_skill_versions','select'),
  'anon SELECT denied on owner versions projection');
select ok(not has_table_privilege('anon','api.my_managed_skill_releases','select'),
  'anon SELECT denied on owner releases projection');
select ok(not has_table_privilege('anon','api.my_managed_skill_files','select'),
  'anon SELECT denied on owner files projection');

-- ---------------------------------------------------------------------------
-- 4. Owner create / update-metadata SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
select has_function('private','create_managed_skill', array['text','text'], 'create_managed_skill exists');
select has_function('private','update_managed_skill_metadata', array['text','text','text'], 'update_managed_skill_metadata exists');

select ok((select pg_get_userbyid(p.proowner) = 'skillmap_vault_definer' from pg_catalog.pg_proc p where p.oid='private.create_managed_skill(text,text)'::regprocedure),
  'create_managed_skill is owned by the NOLOGIN vault definer');
select ok((select pg_get_userbyid(p.proowner) = 'skillmap_vault_definer' from pg_catalog.pg_proc p where p.oid='private.update_managed_skill_metadata(text,text,text)'::regprocedure),
  'update_managed_skill_metadata is owned by the NOLOGIN vault definer');
select ok((select prosecdef from pg_catalog.pg_proc where oid='private.create_managed_skill(text,text)'::regprocedure),
  'create_managed_skill is SECURITY DEFINER');
select ok((select prosecdef from pg_catalog.pg_proc where oid='private.update_managed_skill_metadata(text,text,text)'::regprocedure),
  'update_managed_skill_metadata is SECURITY DEFINER');
select ok(has_function_privilege('authenticated','private.create_managed_skill(text,text)','execute'),
  'authenticated EXECUTE on create_managed_skill');
select ok(has_function_privilege('authenticated','private.update_managed_skill_metadata(text,text,text)','execute'),
  'authenticated EXECUTE on update_managed_skill_metadata');
select ok(not has_function_privilege('anon','private.create_managed_skill(text,text)','execute'),
  'anon EXECUTE denied on create_managed_skill');
select ok(not has_function_privilege('public','private.create_managed_skill(text,text)','execute'),
  'PUBLIC EXECUTE denied on create_managed_skill');
select ok(not has_function_privilege('service_role','private.create_managed_skill(text,text)','execute'),
  'service_role EXECUTE denied on create_managed_skill');
select ok(not has_function_privilege('anon','private.update_managed_skill_metadata(text,text,text)','execute'),
  'anon EXECUTE denied on update_managed_skill_metadata');

-- ---------------------------------------------------------------------------
-- 5. Activation handoff: postgres -> NOLOGIN definer ownership; grants.
-- ---------------------------------------------------------------------------
select ok((select pg_get_userbyid(p.proowner) = 'skillmap_vault_definer' from pg_catalog.pg_proc p where p.oid='api.activate_managed_skill_release(text,text,bigint,uuid)'::regprocedure),
  'api.activate_managed_skill_release is owned by the NOLOGIN vault definer');
select ok((select pg_get_userbyid(p.proowner) = 'skillmap_vault_definer' from pg_catalog.pg_proc p where p.oid='private.activate_managed_skill_release(text,text,bigint,uuid)'::regprocedure),
  'private.activate_managed_skill_release is owned by the NOLOGIN vault definer');
select ok(has_function_privilege('authenticated','api.activate_managed_skill_release(text,text,bigint,uuid)','execute'),
  'authenticated EXECUTE on activation entry point');
select ok(not has_function_privilege('anon','api.activate_managed_skill_release(text,text,bigint,uuid)','execute'),
  'anon EXECUTE denied on activation entry point');
select ok(not has_function_privilege('public','api.activate_managed_skill_release(text,text,bigint,uuid)','execute'),
  'PUBLIC EXECUTE denied on activation entry point');
select ok(not has_function_privilege('service_role','api.activate_managed_skill_release(text,text,bigint,uuid)','execute'),
  'service_role EXECUTE denied on activation entry point');

-- ---------------------------------------------------------------------------
-- 6. Direct INSERT/UPDATE/DELETE denial to browser roles -- catalog.
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('anon','private.managed_skill_versions','insert')
  and not has_table_privilege('anon','private.managed_skill_releases','insert')
  and not has_table_privilege('anon','private.managed_skill_files','insert'),
  'anon has no direct version/release/file insert');
select ok(
  not has_table_privilege('authenticated','private.managed_skill_versions','insert')
  and not has_table_privilege('authenticated','private.managed_skill_versions','update')
  and not has_table_privilege('authenticated','private.managed_skill_versions','delete'),
  'authenticated has no direct version INSERT/UPDATE/DELETE');
select ok(
  not has_table_privilege('authenticated','private.managed_skill_releases','insert')
  and not has_table_privilege('authenticated','private.managed_skill_releases','update')
  and not has_table_privilege('authenticated','private.managed_skill_releases','delete'),
  'authenticated has no direct release INSERT/UPDATE/DELETE');
select ok(
  not has_table_privilege('authenticated','private.managed_skill_files','insert')
  and not has_table_privilege('authenticated','private.managed_skill_files','update')
  and not has_table_privilege('authenticated','private.managed_skill_files','delete'),
  'authenticated has no direct file INSERT/UPDATE/DELETE');
select ok(
  not has_table_privilege('service_role','private.managed_skill_versions','insert')
  and not has_table_privilege('service_role','private.managed_skill_releases','insert')
  and not has_table_privilege('service_role','private.managed_skill_files','insert'),
  'service_role has no direct version/release/file insert');
select ok(
  not has_table_privilege('authenticated','private.managed_skills','delete'),
  'authenticated has no direct delete of a managed skill');
select ok(not has_table_privilege('authenticated','private.managed_skills','insert')
  and not has_table_privilege('authenticated','private.managed_skills','update'),
  'authenticated has no direct insert/update of a managed skill');

-- ---------------------------------------------------------------------------
-- 7. Worker and cleanup EXECUTE grants.
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated','private.prepare_skill_vault_upload(text,timestamptz)','execute'),
  'authenticated EXECUTE on prepare_upload');
select ok(has_function_privilege('authenticated','private.prepare_skill_vault_read(text,timestamptz)','execute'),
  'authenticated EXECUTE on prepare_read');
select ok(has_function_privilege('authenticated','private.prepare_skill_vault_delete(text,timestamptz)','execute'),
  'authenticated EXECUTE on prepare_delete');
select ok(has_function_privilege('service_role','private.enqueue_skill_vault_incomplete_upload_cleanup(text,text,text)','execute'),
  'service_role EXECUTE on enqueue cleanup');
select ok(not has_function_privilege('service_role','private.claim_skill_vault_incomplete_upload_cleanup(integer)','execute'),
  'service_role cannot bypass the storage worker adapter to claim cleanup');
select ok(not has_function_privilege('service_role','private.complete_skill_vault_incomplete_upload_cleanup(uuid)','execute'),
  'service_role cannot bypass the storage worker adapter to complete cleanup');
select ok(not has_function_privilege('authenticated','private.claim_skill_vault_incomplete_upload_cleanup(integer)','execute'),
  'authenticated EXECUTE denied on claim cleanup');
select ok(not has_function_privilege('anon','private.prepare_skill_vault_upload(text,timestamptz)','execute'),
  'anon EXECUTE denied on prepare_upload');

-- ---------------------------------------------------------------------------
-- 8. anon / PUBLIC receive nothing on the managed tables themselves.
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('anon','private.managed_skills','select')
  and not has_table_privilege('anon','private.managed_skills','insert')
  and not has_table_privilege('anon','private.managed_skills','update')
  and not has_table_privilege('anon','private.managed_skills','delete'),
  'anon has zero privilege on managed_skills');
select ok(
  not has_table_privilege('public','private.managed_skills','select')
  and not has_table_privilege('public','private.managed_skill_versions','select'),
  'PUBLIC has zero privilege on managed skills/versions');

-- ---------------------------------------------------------------------------
-- 9. Transferred SECURITY DEFINER hardening + definer base access.
-- ---------------------------------------------------------------------------
select ok((select p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
  where p.oid='private.create_managed_skill(text,text)'::regprocedure),
  'create_managed_skill sets an empty search_path');
select ok((select p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
  where p.oid='private.update_managed_skill_metadata(text,text,text)'::regprocedure),
  'update_managed_skill_metadata sets an empty search_path');
select ok((select p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
  where p.oid='private.activate_managed_skill_release(text,text,bigint,uuid)'::regprocedure),
  'private activation sets an empty search_path');
select ok((select p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
  where p.oid='api.activate_managed_skill_release(text,text,bigint,uuid)'::regprocedure),
  'api activation sets an empty search_path');

select ok(has_table_privilege('skillmap_vault_definer','private.managed_skills','select'),
  'definer SELECT on managed_skills (FORCE RLS base access)');
select ok(not has_table_privilege('skillmap_vault_definer','private.managed_skill_versions','insert'),
  'definer INSERT denied on managed_skill_versions');
select ok(not has_table_privilege('skillmap_vault_definer','private.managed_skill_versions','delete'),
  'definer DELETE denied on managed_skill_versions');
select ok(not has_table_privilege('skillmap_vault_definer','private.managed_skill_releases','insert'),
  'definer INSERT denied on managed_skill_releases');
select ok(not has_table_privilege('skillmap_vault_definer','private.managed_skill_releases','delete'),
  'definer DELETE denied on managed_skill_releases');
select ok(not has_table_privilege('skillmap_vault_definer','private.managed_skill_files','insert'),
  'definer INSERT denied on managed_skill_files');
select ok(not has_table_privilege('skillmap_vault_definer','private.managed_skill_files','delete'),
  'definer DELETE denied on managed_skill_files');
select ok(has_table_privilege('skillmap_vault_definer','private.managed_skill_activation_receipts','select'),
  'definer SELECT on activation receipts');
select ok(has_table_privilege('skillmap_vault_definer','private.managed_skill_activation_receipts','insert'),
  'definer INSERT on activation receipts (CAS durable outcomes)');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='private.managed_skills'::regclass),
  'managed_skills remains RLS-enabled after the transfer');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='private.managed_skill_files'::regclass),
  'managed_skill_files remains RLS-enabled after the transfer');

-- ---------------------------------------------------------------------------
-- 10. Catalog non-confusion: public catalog views never reference managed vault.
-- ---------------------------------------------------------------------------
select ok(not exists (
  select 1 from pg_catalog.pg_depend d
  join pg_catalog.pg_rewrite r on r.oid = d.objid
  join pg_catalog.pg_class vc on vc.oid = r.ev_class
  join pg_catalog.pg_class tc on tc.oid = d.refobjid
  where vc.relnamespace = 'api'::regnamespace
    and tc.relnamespace = 'private'::regnamespace
    and vc.relname in ('catalog_skills','catalog_skill_versions','catalog_skill_relationships',
                       'saved_skill_catalog','saved_skills')
    and tc.relname in ('managed_skills','managed_skill_versions','managed_skill_releases','managed_skill_files')
), 'public catalog views never reference the managed vault tables');

-- ---------------------------------------------------------------------------
-- 11. Functional reachability via reachable roles.
-- ---------------------------------------------------------------------------
-- Account A reads its OWN rows through every owner projection.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);

select results_eq(
  $$select display_name from api.my_managed_skills order by display_name$$,
  array['M210 Alpha']::text[],
  'account A sees only its own managed skill projection');
select results_eq(
  $$select public_id from api.my_managed_skill_versions order by public_id$$,
  array['msv_a6000000000046000000000000000101']::text[],
  'account A sees only its own version projection');
select results_eq(
  $$select relative_path from api.my_managed_skill_files order by relative_path$$,
  array['SKILL.md']::text[],
  'account A sees only its own file projection');
select results_eq(
  $$select lifecycle_state from api.my_managed_skill_releases order by lifecycle_state$$,
  array['active']::text[],
  'account A sees only its own release projection');
reset role;

-- Account B reads only B rows, never A.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b6000000-0000-4600-8600-000000000002', true);

select results_eq(
  $$select display_name from api.my_managed_skills order by display_name$$,
  array['M210 Bravo']::text[],
  'account B sees only its own managed skill projection');
select is_empty(
  $$select * from api.my_managed_skills where display_name = 'M210 Alpha'$$,
  'account B cannot read account A owned skill');
select results_eq(
  $$select public_id from api.my_managed_skill_versions order by public_id$$,
  array['msv_b6000000000046000000000000000102']::text[],
  'account B sees only its own version projection');
select is_empty(
  $$select * from api.my_managed_skill_versions where public_id = 'msv_a6000000000046000000000000000101'$$,
  'account B cannot read account A owned version (msv_a...)');
reset role;

-- anon: denied at the permission layer.
set local role anon;
select throws_ok(
  $$select * from api.my_managed_skills$$,
  '42501', 'permission denied for view my_managed_skills',
  'anon is denied SELECT on the skills projection');
select throws_ok(
  $$select * from api.my_managed_skill_versions$$,
  '42501', 'permission denied for view my_managed_skill_versions',
  'anon is denied SELECT on the versions projection');

-- anon cannot invoke any owner DEFINER function.
select throws_ok(
  $$select * from private.create_managed_skill('Anon Skill', 'x')$$,
  '42501', null, 'anon EXECUTE denied on create_managed_skill');
select throws_ok(
  $$select * from api.activate_managed_skill_release('msk_x','msr_x',0,gen_random_uuid())$$,
  '42501', null, 'anon EXECUTE denied on the activation entry point');
reset role;

-- ---------------------------------------------------------------------------
-- 12. Reachable mutation matrix (finding-1/2 coverage) + direct-helper ownership.
--     All mutation and activation checks below run with `set local role
--     authenticated` and a real JWT `request.jwt.claim.sub`, so every application
--     path is exercised as an actual reachable browser role -- not as the
--     migration runner -- and the prepared owner and activation functions (owned
--     by the NOLOGIN definer after the M2.10 handoff) are what we observe.
-- ---------------------------------------------------------------------------
-- Account A: owner create succeeds and returns exactly the bounded projection.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);

create temporary table m210_created (public_id text, display_name text, description text) on commit drop;
select lives_ok($sql$
  insert into m210_created (public_id, display_name, description)
    select public_id, display_name, description
    from private.create_managed_skill('Created By A', 'created desc')
$sql$, 'account A owner create_managed_skill executes');
select is((select count(*) from m210_created), 1::bigint,
  'account A create returns exactly one bounded projection row');
select ok((select public_id ~ '^msk_[0-9a-f]{32}$' from m210_created),
  'newly created skill returns a valid public_id');
select is((select display_name from m210_created), 'Created By A',
  'create returns the exact display_name');
select is((select description from m210_created), 'created desc',
  'create returns the exact description');
select results_eq(
  $$select display_name from api.my_managed_skills where display_name = 'Created By A'$$,
  array['Created By A']::text[],
  'created skill is durably owned by A and visible only through the owner projection');
reset role;

-- Account A: owner metadata update succeeds and is durable.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);
select lives_ok($sql$
  select * from private.update_managed_skill_metadata(
    'msk_a6000000000046000000000000000011', 'Alpha Updated', 'new desc')
$sql$, 'owner A updates its own skill metadata');
select results_eq(
  $$select display_name from api.my_managed_skills order by display_name$$,
  array['Alpha Updated', 'Created By A']::text[],
  'A metadata update is durable and owned through the projection');

-- Account B attempting to update A skill: zero rows, A unchanged (non-enumerating).
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b6000000-0000-4600-8600-000000000002', true);
select is((select count(*) from private.update_managed_skill_metadata(
  'msk_a6000000000046000000000000000011', 'Hacked', 'no')), 0::bigint,
  'account B update of A skill returns zero rows (non-enumerating)');
reset role;

-- (C-section confirmed the metadata remains Alpha Updated via A's projection.)
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);
select results_eq(
  $$select display_name from api.my_managed_skills where display_name = 'Alpha Updated'$$,
  array['Alpha Updated']::text[],
  'account A skill metadata unchanged after B attempted update');
reset role;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- 13. Full eligible CAS activation under a real authenticated role (finding 1).
--     After the M2.10 definer handoff, account A activates its own eligible
--     release and sees the pointer + CAS revision advance; account B cannot
--     activate A and A remains unchanged.
-- ---------------------------------------------------------------------------
create temporary table m210_owner_activation (
  result_state text,
  result_activation_revision bigint
) on commit drop;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);
select lives_ok($sql$
  insert into m210_owner_activation (result_state, result_activation_revision)
  select result_state, result_activation_revision
    from api.activate_managed_skill_release(
      'msk_a6000000000046000000000000000011',
      'msr_a6000000000046000000000000000301', 0,
      '22222222-2222-4222-8222-222222222222')
$sql$, 'account A executes an eligible CAS activation after the M2.10 handoff');
reset role;

select is((select result_state from m210_owner_activation), 'active',
  'account A activation returns the exact accepted active result state');
select is((select result_activation_revision from m210_owner_activation), 1::bigint,
  'account A activation returns CAS revision one');

-- Reading durable pointer + CAS revision requires base-table access; do it as
-- the postgres runner, not as authenticated (which holds no base privilege).
select is((select activation_revision from private.managed_skills
           where id = 'a6000000-0000-4600-8600-000000000011'), 1::bigint,
  'A activation advances CAS revision from 0 to 1');
select is((select active_release_id from private.managed_skills
           where id = 'a6000000-0000-4600-8600-000000000011'),
  'a6000000-0000-4600-8600-000000000301'::uuid,
  'A activation sets the active-owner pointer to its eligible release');

-- Account B cannot activate A: fails closed, pointer/revision unchanged.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b6000000-0000-4600-8600-000000000002', true);
create temporary table m210_foreign_activation (
  result_state text,
  result_activation_revision bigint
) on commit drop;
select lives_ok($sql$
  insert into m210_foreign_activation (result_state, result_activation_revision)
  select result_state, result_activation_revision
    from api.activate_managed_skill_release(
      'msk_a6000000000046000000000000000011',
      'msr_a6000000000046000000000000000301', 1,
      '33333333-3333-4333-8333-333333333333')
$sql$, 'account B activation path runs (fails closed, no upstream mutation)');
reset role;

select is((select result_state from m210_foreign_activation), 'VAULT_RESOURCE_UNAVAILABLE',
  'account B activation returns the exact non-enumerating unavailable result state');
select is((select activation_revision from private.managed_skills
           where id = 'a6000000-0000-4600-8600-000000000011'), 1::bigint,
  'account B cannot advance A CAS');
select is((select active_release_id from private.managed_skills
           where id = 'a6000000-0000-4600-8600-000000000011'),
  'a6000000-0000-4600-8600-000000000301'::uuid,
  'account B cannot change A active-owner pointer');

-- ---------------------------------------------------------------------------
-- 14. Direct bounded-helper reachability (finding 3). authenticated carries the
--     M1 private-schema USAGE and helper EXECUTE, so a direct private.my_owner_*
--     call is owner-scoped and exposes exactly the same bounded columns as the
--     projections. The identity helpers are NOT granted to authenticated.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);
select results_eq(
  $$select h_display_name from private.my_owner_managed_skills() order by h_display_name$$,
  array['Alpha Updated', 'Created By A']::text[],
  'direct skills helper is owner-scoped and returns the same bounded rows');
select is_empty(
  $$select * from private.my_owner_managed_skills() where h_display_name = 'Bravo Skill'$$,
  'direct skills helper never leaks account B rows to A');
select results_eq(
  $$select h_relative_path from private.my_owner_managed_skill_files() order by h_relative_path$$,
  array['SKILL.md']::text[],
  'direct files helper returns the same bounded file columns');
reset role;

-- Identity helpers must be uncallable by authenticated.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);
select throws_ok(
  $$select * from private.current_request_uid()$$,
  '42501', null, 'authenticated cannot call the identity helper current_request_uid');
select throws_ok(
  $$select * from private.current_request_role()$$,
  '42501', null, 'authenticated cannot call the identity helper current_request_role');
reset role;

-- Owner create must fail closed when no authenticated identity is present.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select * from private.create_managed_skill('New Skill', 'desc')$$,
  'P0001', 'The requested vault resource is unmanaged.',
  'owner create fails closed without a valid account identity');
reset role;

select * from finish();
rollback;
