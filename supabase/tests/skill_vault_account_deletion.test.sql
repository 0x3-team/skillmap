-- M2.14 — Skill Vault account deletion. Destructive, adversarial, rollback-only.
-- Ownership: this file ONLY. begin ... select plan(N) ... finish() ... rollback.
-- Drives the real surfaces exactly as operator/worker would: api.delete_my_account()
-- (the only delete route), the service-only deletion_adapter.* worker functions,
-- and the 13-owner acknowledgement path. Physical-job completion is gated on the
-- real storage.objects presence; the vendor protect-delete trigger is never
-- bypassed (absence-gated success uses a managed file with no storage.object).

begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists pgcrypto with schema extensions;
set local search_path = extensions, public, private, api;

select plan(92);

-- =============================================================================
-- 0. Reset baseline: the two new tables start empty.
-- =============================================================================
select ok(
  (select count(*) = 0 from private.account_deletion_receipts)
  and (select count(*) = 0 from private.skill_vault_storage_deletion_jobs),
  'reset DB: no deletion receipts or storage deletion jobs before fixtures'
);

-- =============================================================================
-- A. Exact schema: receipts + jobs, FORCE RLS, registry, ack validation.
-- =============================================================================
select has_table('private','account_deletion_receipts',
  'private.account_deletion_receipts exists');
select has_table('private','skill_vault_storage_deletion_jobs',
  'private.skill_vault_storage_deletion_jobs exists');

select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='private.account_deletion_receipts'::regclass),
  'account_deletion_receipts enables AND forces RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='private.skill_vault_storage_deletion_jobs'::regclass),
  'skill_vault_storage_deletion_jobs enables AND forces RLS');

select is(
  private.m1_11_deletion_owner_registry(),
  ARRAY['device_auth','route_idempotency','runtime_bundle_cache',
    'local_quarantine_intent_receipt','vault_blobs','manifest_version_lifecycle',
    'authenticated_projections','feedback','support','analytics_linkage',
    'online_replicas','queues_dead_letters','backup_restore_barrier']::text[],
  'the M1.11 exact 13-owner registry is frozen in canonical order'
);

select ok((select private.m1_11_deletion_acknowledgements_valid(
  '[{"owner":"device_auth","status":"purged","acknowledged_at":"2026-01-01T00:00:00Z","count_bucket":"1"}]'::jsonb)),
  'a single well-formed acknowledgement is valid');
select ok(not (select private.m1_11_deletion_acknowledgements_valid(
  '[{"owner":"device_auth","status":"purged","acknowledged_at":"2026-01-01T00:00:00Z"}]'::jsonb)),
  'an acknowledgement missing count_bucket is invalid');
select ok(not (select private.m1_11_deletion_acknowledgements_valid(
  '[{"owner":"not_an_owner","status":"purged","acknowledged_at":"2026-01-01T00:00:00Z","count_bucket":"1"}]'::jsonb)),
  'an acknowledgement for a non-registry owner is invalid');
select ok(not (select private.m1_11_deletion_acknowledgements_valid(
  '[{"owner":"backup_restore_barrier","status":"purged","acknowledged_at":"2026-01-01T00:00:00Z","count_bucket":"1"}]'::jsonb)),
  'barrier owner must acknowledge as barrier_applied');
select ok(not (select private.m1_11_deletion_acknowledgements_valid(
  '[{"owner":"device_auth","status":"barrier_applied","acknowledged_at":"2026-01-01T00:00:00Z","count_bucket":"1"}]'::jsonb)),
  'barrier_applied is reserved for the backup_restore_barrier owner');
select ok((select private.compute_deletion_proof_digest(
  '[{"owner":"device_auth","status":"purged","acknowledged_at":"2026-01-01T00:00:00Z","count_bucket":"1"}]'::jsonb,
  'del_'||repeat('0',32), now() - interval '1 day', null, now() + interval '29 days') is null),
  'a partial acknowledgement set yields no proof digest');

select ok(exists (select 1 from pg_constraint where conname='account_deletion_receipts_del_format_check'
  and pg_get_constraintdef(oid) like '%^del_[0-9a-f]{32}$%'),
  'del_ is the exact opaque del_ prefix + 32 hex');
select ok(exists (select 1 from pg_constraint where conname='account_deletion_receipts_schema_check'
  and pg_get_constraintdef(oid) like '%skillmap.account-deletion-proof/v1%'),
  'receipt schema_version is pinned to the exact proof schema');
select ok(exists (select 1 from pg_constraint where conname='account_deletion_receipts_expiry_check'
  and (pg_get_constraintdef(oid) like '%30%' and pg_get_constraintdef(oid) like '%86400%')),
  'receipt COMPLETED expiry is exactly completed+30d');
select ok(exists (select 1 from pg_constraint where conname='account_deletion_receipts_ageout_upper_check'
  and pg_get_constraintdef(oid) like '%30 * 86400%'),
  'backup physical ageout deadline is bounded by barrier+30d');
select ok(exists (select 1 from pg_constraint where conname='account_deletion_receipts_digest_shape_check'
  and pg_get_constraintdef(oid) like '%^sha256:[0-9a-f]{64}$%'),
  'proof_digest must match the sha256:64hex shape');
select ok(not exists (select 1 from information_schema.columns
  where table_schema='private' and table_name='account_deletion_receipts'
  and column_name in ('account_id','public_id','email','path','owner_id','skill_id','version_id')),
  'receipt keeps no retained account/skill/version/path/email identifier column');
select is((select count(*) from information_schema.columns
  where table_schema='private' and table_name='account_deletion_receipts'
  and column_name in ('id','schema_version','del_','proof_digest')), 4::bigint,
  'the allowed proof metadata columns (id, schema_version, del_, proof_digest) are retained');

select ok(exists (select 1 from pg_constraint where conname='storage_deletion_jobs_bucket_check'
  and pg_get_constraintdef(oid) like '%skill-vault-private%'),
  'storage deletion jobs are pinned to the skill-vault-private bucket only');
select ok(exists (select 1 from pg_constraint where conname='storage_deletion_jobs_error_closed_check'
  and pg_get_constraintdef(oid) like '%attempt_exhausted%'
  and pg_get_constraintdef(oid) like '%storage_read_denied%'),
  'jobs expose only the closed bounded error vocabulary');
select has_index('private','skill_vault_storage_deletion_jobs','storage_deletion_jobs_pending_key_uidx',
  'partial unique pending-key index exists');
select has_index('private','skill_vault_storage_deletion_jobs','storage_deletion_jobs_claim_idx',
  'claim index exists');

-- =============================================================================
-- B. Least privilege: service-only adapter, browser denied, private ungranted.
-- =============================================================================
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='deletion_adapter'), 4::bigint,
  'deletion_adapter exposes exactly four functions');
select ok(has_function_privilege('service_role','deletion_adapter.claim_skill_vault_storage_deletion_jobs(int)','execute')
  and has_function_privilege('service_role','deletion_adapter.complete_skill_vault_storage_deletion_job(uuid)','execute')
  and has_function_privilege('service_role','deletion_adapter.fail_skill_vault_storage_deletion_job(uuid,text,int)','execute')
  and has_function_privilege('service_role','deletion_adapter.acknowledge_account_deletion_owner(text,text,text,text)','execute'),
  'service_role has EXECUTE on the four adapter functions');
select ok(not has_function_privilege('anon','deletion_adapter.claim_skill_vault_storage_deletion_jobs(int)','execute')
  and not has_function_privilege('authenticated','deletion_adapter.claim_skill_vault_storage_deletion_jobs(int)','execute')
  and not has_function_privilege('anon','deletion_adapter.complete_skill_vault_storage_deletion_job(uuid)','execute')
  and not has_function_privilege('authenticated','deletion_adapter.complete_skill_vault_storage_deletion_job(uuid)','execute')
  and not has_function_privilege('anon','deletion_adapter.fail_skill_vault_storage_deletion_job(uuid,text,int)','execute')
  and not has_function_privilege('authenticated','deletion_adapter.fail_skill_vault_storage_deletion_job(uuid,text,int)','execute')
  and not has_function_privilege('anon','deletion_adapter.acknowledge_account_deletion_owner(text,text,text,text)','execute')
  and not has_function_privilege('authenticated','deletion_adapter.acknowledge_account_deletion_owner(text,text,text,text)','execute'),
  'browser roles hold zero adapter usage or execute');
select ok(not has_schema_privilege('service_role','private','usage'),
  'service_role still lacks private schema USAGE');
select ok(not exists (select 1 from information_schema.role_table_grants
  where grantee in ('anon','authenticated','service_role')
    and table_schema='private'
    and table_name in ('account_deletion_receipts','skill_vault_storage_deletion_jobs')),
  'browser/service hold zero direct grants on both new tables');
select ok(not has_function_privilege('authenticated','private.perform_vault_deletion_barrier()','execute')
  and not has_function_privilege('service_role','private.perform_vault_deletion_barrier()','execute'),
  'private implementation functions stay ungranted to browser and service');

select has_function('api','delete_my_account', array[]::text[],
  'api.delete_my_account() exists');
select is((select pronargs::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.proname='delete_my_account'), 0,
  'api.delete_my_account accepts no target-account argument');
select ok(has_function_privilege('authenticated','api.delete_my_account()','execute'),
  'authenticated has EXECUTE on api.delete_my_account');
select ok(not has_function_privilege('anon','api.delete_my_account()','execute')
  and not has_function_privilege('service_role','api.delete_my_account()','execute')
  and not has_function_privilege('public','api.delete_my_account()','execute'),
  'anon/service_role/PUBLIC are denied api.delete_my_account EXECUTE');

-- =============================================================================
-- C. Fixtures: full account A (self-deletes), full survivor B, zero-row C.
-- =============================================================================
select lives_ok($sql$
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token) values
('00000000-0000-0000-0000-000000000000','93000000-0000-4300-8300-000000000001','authenticated','authenticated','m214-a@skillmap.invalid','',now(),'{}','{}',now(),now(),''),
('00000000-0000-0000-0000-000000000000','93020000-0000-4300-8300-000000000002','authenticated','authenticated','m214-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'');
$sql$, 'accounts A and B insert');

-- ---- A: skill, version, release, two files, device, token, import + receipt,
-- ---- route decision + ranked lineage + correction.
select lives_ok($sql$
insert into private.managed_skills (id, public_id, account_id, display_name,
  activation_revision, created_at, updated_at) values
('93000000-0000-4300-8300-000000000011','msk_'||repeat('9',32),'93000000-0000-4300-8300-000000000001','Alpha Rune',0,now(),now());
insert into private.managed_skill_versions (id, public_id, account_id, managed_skill_id,
  manifest_schema_version, manifest_projection, manifest_digest, content_digest,
  canonical_metadata, source, provenance_state, analysis_state, created_at) values
('93000000-0000-4300-8300-000000000101','msv_'||repeat('f',32),'93000000-0000-4300-8300-000000000001',
 '93000000-0000-4300-8300-000000000011','1.0','{}'::bytea,'sha256:'||repeat('1',64),'sha256:'||repeat('a',64),
 '{"logical_id":"alpha","display_name":"Alpha Rune"}',
 '{"authority":"managed","kind":"local","namespace":"owner","source_id":"alpha","revision":"r1"}','verified','complete',now());
insert into private.managed_skill_files (id, public_id, account_id, managed_skill_id, version_id,
  relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal, created_at) values
('93000000-0000-4300-8300-000000000271','msf_'||repeat('1',32),'93000000-0000-4300-8300-000000000001',
 '93000000-0000-4300-8300-000000000011','93000000-0000-4300-8300-000000000101','SKILL.md','text/markdown',5,
 'sha256:'||repeat('2',64),'v1/msv_'||repeat('f',32)||'/msf_'||repeat('1',32),false,0,now()),
('93000000-0000-4300-8300-000000000272','msf_'||repeat('2',32),'93000000-0000-4300-8300-000000000001',
 '93000000-0000-4300-8300-000000000011','93000000-0000-4300-8300-000000000101','README.md','text/markdown',6,
 'sha256:'||repeat('3',64),'v1/msv_'||repeat('f',32)||'/msf_'||repeat('2',32),false,1,now());
insert into private.managed_skill_releases (id, public_id, account_id, managed_skill_id, version_id,
  lifecycle_state, eligibility_reasons, created_at) values
('93000000-0000-4300-8300-000000000591','msr_'||repeat('3',32),'93000000-0000-4300-8300-000000000001',
 '93000000-0000-4300-8300-000000000011','93000000-0000-4300-8300-000000000101','active','{}'::text[],now());
update private.managed_skills set active_release_id='93000000-0000-4300-8300-000000000591', activation_revision=1
 where id='93000000-0000-4300-8300-000000000011';
insert into private.devices (id, public_id, account_id, display_name, platform,
  connector_version, locale, state, revision, issued_at) values
('93000000-0000-4300-8300-000000000681','dev_'||repeat('7',32),'93000000-0000-4300-8300-000000000001',
 'Alpha device','macos','3.0.0','en-US','active',1,now());
insert into private.device_tokens (id, account_id, device_id, credential_digest, key_version,
  scopes, issued_at, generation) values
('93000000-0000-4300-8300-000000000781','93000000-0000-4300-8300-000000000001','93000000-0000-4300-8300-000000000681',
 'hmac-sha256:'||repeat('e',64),1,'{device.status}',now(),1);
insert into private.import_sessions (id, imp_, account_id, device_id, managed_skill_id, version_id,
  manifest_schema_version, manifest_digest, content_digest, expected_file_count, expected_byte_total,
  idempotency_key, state, expiry_at, created_at, updated_at, revision) values
('93000000-0000-4300-8300-000000000881','imp_'||repeat('9',32),'93000000-0000-4300-8300-000000000001',
 '93000000-0000-4300-8300-000000000681','93000000-0000-4300-8300-000000000011','93000000-0000-4300-8300-000000000101',
 '2.0','sha256:'||repeat('1',64),'sha256:'||repeat('a',64),2,11,'40000000-0000-0000-0000-0000000000aa','in_progress',
 now()+interval '1 day',now(),now(),1);
insert into private.import_file_receipts (id, account_id, device_id, session_id, file_id,
  managed_skill_id, version_id, relative_path, media_type, accepted_byte_size, file_digest, ordinal, accepted_at) values
('93000000-0000-4300-8300-000000000981','93000000-0000-4300-8300-000000000001','93000000-0000-4300-8300-000000000681',
 '93000000-0000-4300-8300-000000000881','93000000-0000-4300-8300-000000000271','93000000-0000-4300-8300-000000000011',
 '93000000-0000-4300-8300-000000000101','SKILL.md','text/markdown',5,'sha256:'||repeat('2',64),0,now());
create temporary table m214_route (id uuid primary key);
insert into m214_route (id)
select private.record_route_decision(
  '93000000-0000-4300-8300-000000000001',
  '93000000-0000-4300-8300-000000000681',
  '70000000-4000-4300-8300-0000000000aa',
  'sha256:'||repeat('d',64), 'ranked_candidates', 0.9,
  '["prompt_intent_match"]'::jsonb,
  'acct_rev_1','dev_auth_rev_1','policy_rev_1','elig_rev_1','aud_rev_1',
  1000,24,4,5,12,
  '[{"managed_skill_id":"93000000-0000-4300-8300-000000000011","version_id":"93000000-0000-4300-8300-000000000101","release_id":"93000000-0000-4300-8300-000000000591","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb
);
select private.record_route_correction(
  '93000000-0000-4300-8300-000000000001',
  '93000000-0000-4300-8300-000000000681',
  (select id from m214_route), 'correct', null, null, null,
  '40000000-0000-0000-0000-0000000000ab', null
);
$sql$, 'account A inserts complete owned fixtures');

-- B: survivor fixture + its own storage object (must stay untouched).
select lives_ok($sql$
insert into private.managed_skills (id, public_id, account_id, display_name,
  activation_revision, created_at, updated_at) values
('93020000-0000-4300-8300-000000000022','msk_'||repeat('c',32),'93020000-0000-4300-8300-000000000002','Bravo Rune',1,now(),now());
insert into private.managed_skill_versions (id, public_id, account_id, managed_skill_id,
  manifest_schema_version, manifest_projection, manifest_digest, content_digest,
  canonical_metadata, source, provenance_state, analysis_state, created_at) values
('93020000-0000-4300-8300-000000000102','msv_'||repeat('d',32),'93020000-0000-4300-8300-000000000002',
 '93020000-0000-4300-8300-000000000022','1.0','{}'::bytea,'sha256:'||repeat('4',64),'sha256:'||repeat('c',64),
 '{"logical_id":"bravo","display_name":"Bravo Runa"}',
 '{"authority":"managed","kind":"local","namespace":"owner","source_id":"bravo","revision":"r1"}','verified','complete',now());
insert into private.managed_skill_files (id, public_id, account_id, managed_skill_id, version_id,
  relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal, created_at) values
('93020000-0000-4300-8300-000000000203','msf_'||repeat('e',32),'93020000-0000-4300-8300-000000000002',
 '93020000-0000-4300-8300-000000000022','93020000-0000-4300-8300-000000000102','SKILL.md','text/markdown',7,
 'sha256:'||repeat('e',64),'v1/msv_'||repeat('d',32)||'/msf_'||repeat('e',32),false,0,now());
insert into private.devices (id, public_id, account_id, display_name, platform,
  connector_version, locale, state, revision, issued_at) values
('93020000-0000-4300-8300-000000000682','dev_'||repeat('c',32),'93020000-0000-4300-8300-000000000002',
 'Bravo device','macos','3.0.0','en-US','active',1,now());
$sql$, 'account B inserts a survivor fixture');

-- Storage: A f1 has a storage.object; A f2 has none (absence-gated completion).
-- B has its own object; the vendor protect-delete trigger is never fired.
insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata) values
('93000000-0000-4000-8000-000000000e01', 'skill-vault-private',
 'v1/msv_'||repeat('f',32)||'/msf_'||repeat('1',32),
 '93000000-0000-4300-8300-000000000001','93000000-0000-4300-8300-000000000001',
 '{"mimetype":"text/markdown","size":5}','{}'),
('93020000-0000-4000-8000-000000000e02', 'skill-vault-private',
 'v1/msv_'||repeat('d',32)||'/msf_'||repeat('e',32),
 '93020000-0000-4300-8300-000000000002','93020000-0000-4300-8300-000000000002',
 '{"mimetype":"text/markdown","size":7}','{}');
select is((select count(*) from storage.objects where bucket_id='skill-vault-private'),
  2::bigint, 'two storage.objects exist before deletion (A f1 + B)');
create temporary table m214_catalog_before as
select (select count(*) from private.skills) as skills,
       (select count(*) from private.skill_versions) as versions;

-- =============================================================================
-- D. Authority fail-closed before any delete.
-- =============================================================================
set role anon;
select throws_ok($$select api.delete_my_account()$$, '42501', null, 'anon EXECUTE denied');
reset role;
set role service_role;
select throws_ok($$select api.delete_my_account()$$, '42501', null, 'service_role denied');
reset role;
set role authenticated;
select throws_ok($$select api.delete_my_account()$$, '42501',
  'authenticated account authority is required', 'authenticated with no claim.sub fails closed');
reset role;
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','99990000-0000-0000-0000-000000000000',true);
select throws_ok($$select api.delete_my_account()$$, '42501', null, 'unknown identity fails closed');
reset role;
update auth.users set banned_until = now() + interval '1 day' where id='93020000-0000-4300-8300-000000000002';
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93020000-0000-4300-8300-000000000002',true);
select throws_ok($$select api.delete_my_account()$$, '42501', null, 'banned account fails closed');
reset role;
update auth.users set banned_until = null where id='93020000-0000-4300-8300-000000000002';

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4300-8300-000000000001',true);
select set_config('skillmap.account_deletion_account_id','93000000-0000-4300-8300-000000000001',true);
select throws_ok(
  $$delete from private.route_decisions where account_id='93000000-0000-4300-8300-000000000001'$$,
  '42501', null,
  'setting the internal transaction coordinate alone grants no direct delete authority'
);
reset role;

-- =============================================================================
-- E. Delete A via the api wrapper: immediate relational inaccessibility.
-- =============================================================================
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4300-8300-000000000001',true);
select is(api.delete_my_account(), true, 'A api.delete_my_account() returns true');
reset role;

select is((select count(*) from private.managed_skills where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A skills purged');
select is((select count(*) from private.managed_skill_versions where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A versions purged');
select is((select count(*) from private.managed_skill_releases where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A releases purged');
select is((select count(*) from private.managed_skill_files where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A files purged');
select is((select count(*) from private.devices where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A devices purged');
select is((select count(*) from private.device_tokens where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A tokens purged');
select is((select count(*) from private.import_sessions where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A imports purged');
select is((select count(*) from private.import_file_receipts where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A import receipts purged');
select is((select count(*) from private.route_decisions where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A route decisions purged');
select is((select count(*) from private.route_decision_selections where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A route lineage purged');
select is((select count(*) from private.route_corrections where account_id='93000000-0000-4300-8300-000000000001'),0::bigint,'A route corrections purged');
select is((select count(*) from auth.users where id='93000000-0000-4300-8300-000000000001'),0::bigint,'A auth identity is removed');
select is((select count(*) from storage.objects where bucket_id='skill-vault-private'
  and name='v1/msv_'||repeat('f',32)||'/msf_'||repeat('1',32)),1::bigint,
  'A physical residue remains until the asynchronous worker deletes it');
select is((select count(*) from private.account_deletion_receipts),1::bigint,'exactly one receipt is durable');
select is((select state from private.account_deletion_receipts),'BARRIER_COMMITTED','A receipt BARRIER_COMMITTED');
select is((select count(*) from private.skill_vault_storage_deletion_jobs),2::bigint,'two A jobs queued');
select ok((select bool_and(object_name ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$')
  from private.skill_vault_storage_deletion_jobs), 'both queued jobs carry exact opaque keys');
select is((select count(*) from private.managed_skills where account_id='93020000-0000-4300-8300-000000000002'),1::bigint,'B managed_skills untouched');
select is((select count(*) from private.managed_skill_versions where account_id='93020000-0000-4300-8300-000000000002'),1::bigint,'B managed_skill_versions untouched');
select is((select count(*) from private.managed_skill_files where account_id='93020000-0000-4300-8300-000000000002'),1::bigint,'B managed_skill_files untouched');
select is((select count(*) from private.devices where account_id='93020000-0000-4300-8300-000000000002'),1::bigint,'B devices untouched');
select is((select count(*) from auth.users where id='93020000-0000-4300-8300-000000000002'),1::bigint,'B auth identity untouched');
select is((select count(*) from storage.objects where bucket_id='skill-vault-private'),2::bigint,'A residue and B object both remain after the relational barrier');
select ok((select skills=(select count(*) from private.skills)
  and versions=(select count(*) from private.skill_versions)
  from m214_catalog_before), 'public catalog skills and versions remain unchanged');

-- =============================================================================
-- F. Worker boundary: claim bounds + fail-closed on a live object + absence path.
-- =============================================================================
set role service_role;
select throws_ok($$select * from deletion_adapter.claim_skill_vault_storage_deletion_jobs(0)$$,
  '22023', 'claim limit must be between 1 and 64', 'claim limit below 1 rejects');
select throws_ok($$select * from deletion_adapter.claim_skill_vault_storage_deletion_jobs(65)$$,
  '22023', 'claim limit must be between 1 and 64', 'claim limit above 64 rejects');
select lives_ok($sql$
  create temporary table m214_claims (id uuid primary key, object_name text not null);
  insert into m214_claims (id, object_name)
  select c.job_id, c.object_name
  from deletion_adapter.claim_skill_vault_storage_deletion_jobs(64) c;
$sql$, 'the worker claims both A jobs into an opaque temp table');
reset role;
select is((select count(*) from private.skill_vault_storage_deletion_jobs where state='CLAIMED'),
  2::bigint, 'both A jobs transition to CLAIMED');
select is((select state from private.account_deletion_receipts),'CLEANUP_IN_PROGRESS',
  'claiming transitions the receipt to CLEANUP_IN_PROGRESS');
-- absence-gated success: f2 has no storage.object, so the job completes.
set role service_role;
select is((select count(*) from deletion_adapter.complete_skill_vault_storage_deletion_job(
  (select z.id from m214_claims z
   where z.object_name like '%/msf_'||repeat('2',32)))), 1::bigint,
  'the absence-gated job (f2) completes fine');
reset role;
select is((select count(*) from private.skill_vault_storage_deletion_jobs
  where state='COMPLETED' and object_name='CLEARED' and completed_at is not null),1::bigint,
  'the completed job is terminal CLEARED with a completed_at');
select is((select count(*) from private.skill_vault_storage_deletion_jobs where state='CLAIMED'),1::bigint,
  'exactly one job (f1) is left CLAIMED');
-- fail-closed on the surviving physical object (A f1 still present in storage).
set role service_role;
select throws_ok($$select * from deletion_adapter.complete_skill_vault_storage_deletion_job(
  (select c.id from m214_claims c
   where c.object_name like '%/msf_'||repeat('1',32))
  )$$, '55000', null,
  'the surviving-object job (f1) cannot complete (fail closed)');
reset role;

-- A failed object deletion is retryable and exact replay is idempotent.
set role service_role;
select is((select state from deletion_adapter.fail_skill_vault_storage_deletion_job(
  (select c.id from m214_claims c
   where c.object_name like '%/msf_'||repeat('1',32)), 'storage_delete_failed', 60)), 'FAILED',
  'worker records a retryable closed-vocabulary failure');
select is((select state from deletion_adapter.fail_skill_vault_storage_deletion_job(
  (select c.id from m214_claims c
   where c.object_name like '%/msf_'||repeat('1',32)), 'storage_delete_failed', 60)), 'FAILED',
  'an exact failure replay is idempotent');
reset role;
select is((select state from private.account_deletion_receipts where state <> 'COMPLETED'),
  'FAILED_RETRYABLE', 'retryable job failure keeps the receipt fail closed');
update private.skill_vault_storage_deletion_jobs
set next_attempt_at = statement_timestamp()
where state='FAILED';
set role service_role;
select is((select count(*) from deletion_adapter.claim_skill_vault_storage_deletion_jobs(1)),
  1::bigint, 'a due failed job can be claimed again safely');
reset role;
select is((select attempt_count from private.skill_vault_storage_deletion_jobs where state='CLAIMED'),
  2, 'retry claim increments the bounded attempt count');

-- =============================================================================
-- G. A zero-object account completes only after the exact 13-owner proof.
-- =============================================================================
select lives_ok($sql$
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token)
values ('00000000-0000-0000-0000-000000000000',
  '93010000-0000-4300-8300-000000000003','authenticated','authenticated',
  'm214-c@skillmap.invalid','','{}','{}',now(),now(),'');
$sql$, 'zero-object account C inserts');
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93010000-0000-4300-8300-000000000003',true);
select is(api.delete_my_account(), true, 'zero-object account C crosses the relational barrier');
reset role;
create temporary table m214_c_receipt (del_ text primary key);
insert into m214_c_receipt
select del_ from private.account_deletion_receipts
where state='BARRIER_COMMITTED'
order by barrier_initiated_at desc limit 1;
grant select on m214_c_receipt to service_role;
select is((select count(*) from private.skill_vault_storage_deletion_jobs j
  join private.account_deletion_receipts r on r.id=j.deletion_receipt_id
  where r.del_=(select del_ from m214_c_receipt)), 0::bigint,
  'zero-object account C queues no storage jobs');
set role service_role;
select lives_ok($sql$
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'device_auth','purged','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'route_idempotency','purged','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'runtime_bundle_cache','no_account_scope','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'local_quarantine_intent_receipt','purged','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'vault_blobs','no_account_scope','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'manifest_version_lifecycle','purged','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'authenticated_projections','purged','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'feedback','purged','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'support','no_account_scope','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'analytics_linkage','unlinked','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'online_replicas','purged','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'queues_dead_letters','purged','0');
select * from deletion_adapter.acknowledge_account_deletion_owner((select del_ from m214_c_receipt),'backup_restore_barrier','barrier_applied','0');
$sql$, 'the exact canonical 13-owner acknowledgement sequence completes');
select is((select state from deletion_adapter.acknowledge_account_deletion_owner(
  (select del_ from m214_c_receipt),'backup_restore_barrier','barrier_applied','0')),
  'COMPLETED', 'identical final acknowledgement replay is idempotent');
reset role;
select is((select owner_completed_count from private.account_deletion_receipts
  where del_=(select del_ from m214_c_receipt)), 13::smallint,
  'completed proof contains all 13 owners');
select matches((select proof_digest from private.account_deletion_receipts
  where del_=(select del_ from m214_c_receipt)), '^sha256:[0-9a-f]{64}$',
  'completed proof has the bounded SHA-256 digest');
select is((select expiry_at - completed_at from private.account_deletion_receipts
  where del_=(select del_ from m214_c_receipt)), interval '30 days',
  'completed proof expires exactly 30 days after completion');
select ok((select backup_physical_ageout_deadline <= barrier_initiated_at + interval '30 days'
  from private.account_deletion_receipts where del_=(select del_ from m214_c_receipt)),
  'backup physical age-out remains bounded by barrier plus 30 days');
select is((select count(*) from private.account_deletion_receipts where state='COMPLETED'),
  1::bigint, 'only the fully acknowledged C receipt is complete');

select * from finish();
rollback;
