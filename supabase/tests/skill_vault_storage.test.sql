begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(39);

-- M2.06 is a private Storage-policy boundary.  The fixture creates two
-- disposable accounts and leaves no committed rows because this test ends in
-- ROLLBACK.  It exercises vendor-object policies as each caller, not merely
-- the security-definer binding helper.

select ok(exists (
  select 1 from storage.buckets
  where id = 'skill-vault-private'
), 'the private Skill Vault bucket exists');

select ok((select not public and file_size_limit = 16777216 and allowed_mime_types is null
  from storage.buckets where id = 'skill-vault-private'),
  'the bucket is private and has the exact 16 MiB/no-global-MIME contract');

select is((select count(*) from pg_catalog.pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname like 'skill_vault_private_objects_%'), 4::bigint,
  'exactly four owner-scoped object policies exist');

select ok((select count(*) = 4 from pg_catalog.pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in (
      'skill_vault_private_objects_select_owner',
      'skill_vault_private_objects_insert_owner',
      'skill_vault_private_objects_update_owner',
      'skill_vault_private_objects_delete_owner'
    )), 'the policy names cover only select, insert, update, and delete');

select ok((select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class
  where oid = 'private.skill_vault_incomplete_upload_cleanup'::regclass),
  'cleanup queue enables and forces RLS');

select ok(
  not has_table_privilege('anon', 'private.skill_vault_incomplete_upload_cleanup', 'select')
  and not has_table_privilege('authenticated', 'private.skill_vault_incomplete_upload_cleanup', 'select')
  and not has_table_privilege('service_role', 'private.skill_vault_incomplete_upload_cleanup', 'select'),
  'application roles have no direct cleanup queue read');

select ok(
  has_function_privilege('authenticated', 'private.prepare_skill_vault_upload(text,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'private.prepare_skill_vault_read(text,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'private.prepare_skill_vault_delete(text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.prepare_skill_vault_upload(text,timestamptz)', 'execute'),
  'M2.10 grants owner prepare functions to authenticated only; anon stays ungranted');

select ok(exists (
  select 1 from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'storage.objects'::regclass
    and not trigger_row.tgisinternal
    and trigger_row.tgname = 'skill_vault_objects_enforce_binding'
), 'a storage-object binding trigger is installed');

select ok(position('v1/msv_' in pg_catalog.pg_get_functiondef(
  'private.skill_vault_storage_object_binding_is_valid(text,text,uuid,text,jsonb,jsonb)'::regprocedure
)) > 0 and position('relative_path' in pg_catalog.pg_get_functiondef(
  'private.skill_vault_storage_object_binding_is_valid(text,text,uuid,text,jsonb,jsonb)'::regprocedure
)) > 0, 'the binding validator freezes opaque keys and rejects raw-path metadata');

select lives_ok($sql$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', 'a6000000-0000-4600-8600-000000000001', 'authenticated', 'authenticated', 'm206-a@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', 'b6000000-0000-4600-8600-000000000002', 'authenticated', 'authenticated', 'm206-b@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', '')
$sql$, 'two deterministic storage-policy accounts insert');

select lives_ok($sql$
  insert into private.managed_skills (id, public_id, account_id, display_name) values
    ('a6000000-0000-4600-8600-000000000011', 'msk_a6000000000046008600000000000011', 'a6000000-0000-4600-8600-000000000001', 'M206 Alpha'),
    ('b6000000-0000-4600-8600-000000000012', 'msk_b6000000000046008600000000000012', 'b6000000-0000-4600-8600-000000000002', 'M206 Bravo')
$sql$, 'same-account managed-skill fixtures insert');

select lives_ok($sql$
  insert into private.managed_skill_versions (
    id, public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values
    ('a6000000-0000-4600-8600-000000000101', 'msv_a6000000000046008600000000000101', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000011', '1.0', '{}'::bytea, 'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64), '{"logical_id":"m206-a","display_name":"M206 Alpha"}', '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m206-a","revision":"r1"}', 'verified', 'complete'),
    ('b6000000-0000-4600-8600-000000000102', 'msv_b6000000000046008600000000000102', 'b6000000-0000-4600-8600-000000000002', 'b6000000-0000-4600-8600-000000000012', '1.0', '{}'::bytea, 'sha256:' || repeat('2', 64), 'sha256:' || repeat('b', 64), '{"logical_id":"m206-b","display_name":"M206 Bravo"}', '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m206-b","revision":"r1"}', 'verified', 'complete')
$sql$, 'same-account immutable version fixtures insert');

select lives_ok($sql$
  insert into private.managed_skill_files (
    id, public_id, account_id, managed_skill_id, version_id, relative_path,
    media_type, byte_size, file_digest, storage_key, executable, ordinal
  ) values
    ('a6000000-0000-4600-8600-000000000201', 'msf_a6000000000046008600000000000201', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000011', 'a6000000-0000-4600-8600-000000000101', 'SKILL.md', 'text/markdown', 5, 'sha256:' || repeat('c', 64), 'v1/msv_a6000000000046008600000000000101/msf_a6000000000046008600000000000201', false, 0),
    ('b6000000-0000-4600-8600-000000000202', 'msf_b6000000000046008600000000000202', 'b6000000-0000-4600-8600-000000000002', 'b6000000-0000-4600-8600-000000000012', 'b6000000-0000-4600-8600-000000000102', 'SKILL.md', 'text/markdown', 5, 'sha256:' || repeat('d', 64), 'v1/msv_b6000000000046008600000000000102/msf_b6000000000046008600000000000202', false, 0)
$sql$, 'opaque storage keys bind one file in each account');

select lives_ok($sql$
  insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata) values
    ('a6000000-0000-4600-8600-000000000301', 'skill-vault-private', 'v1/msv_a6000000000046008600000000000101/msf_a6000000000046008600000000000201', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000001', '{"mimetype":"text/markdown","size":5}', '{}'),
    ('b6000000-0000-4600-8600-000000000302', 'skill-vault-private', 'v1/msv_b6000000000046008600000000000102/msf_b6000000000046008600000000000202', 'b6000000-0000-4600-8600-000000000002', 'b6000000-0000-4600-8600-000000000002', '{"mimetype":"text/markdown","size":5}', '{}')
$sql$, 'valid exact-bound storage objects insert');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);

select results_eq(
  $$select name from storage.objects where bucket_id = 'skill-vault-private' order by name$$,
  array['v1/msv_a6000000000046008600000000000101/msf_a6000000000046008600000000000201'],
  'account A can list its own exact object only');

select is_empty(
  $$select name from storage.objects where bucket_id = 'skill-vault-private' and name = 'v1/msv_b6000000000046008600000000000102/msf_b6000000000046008600000000000202'$$,
  'account A cannot read or enumerate account B object keys');

select throws_ok(
  $$insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata) values ('a6000000-0000-4600-8600-000000000303', 'skill-vault-private', 'v1/msv_b6000000000046008600000000000102/msf_b6000000000046008600000000000202', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000001', '{"mimetype":"text/markdown","size":5}', '{}')$$,
  '23514', 'skill-vault-private object is not bound to one immutable managed file', 'account A cannot write account B key even with A ownership metadata');

select is((select count(*) from storage.objects
  where bucket_id = 'skill-vault-private'
    and name = 'v1/msv_b6000000000046008600000000000102/msf_b6000000000046008600000000000202'),
  0::bigint, 'account A cannot discover account B object rows through RLS');

select results_eq($$update storage.objects
  set metadata = '{"mimetype":"text/markdown","size":5}'
  where bucket_id = 'skill-vault-private'
    and name = 'v1/msv_b6000000000046008600000000000102/msf_b6000000000046008600000000000202'
  returning id::text$$, array[]::text[],
  'account A cannot update account B object rows through RLS');

select ok(exists (
  select 1 from pg_catalog.pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'skill_vault_private_objects_delete_owner'
    and cmd = 'DELETE'
    and qual like '%auth.uid%'
    and qual like '%owner%'
), 'the delete policy is scoped to the authenticated owner; vendor Storage blocks direct SQL deletion');

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);

select is((select count(*) from private.prepare_skill_vault_upload(
  'msf_a6000000000046008600000000000201', statement_timestamp() + interval '300 seconds')),
  1::bigint, 'owner upload preparation returns one exact short-lived capability record');

select is_empty($$select * from private.prepare_skill_vault_upload('msf_b6000000000046008600000000000202', statement_timestamp() + interval '300 seconds')$$,
  'owner upload preparation cannot resolve a foreign file');

select is_empty($$select * from private.prepare_skill_vault_upload('msf_a6000000000046008600000000000201', statement_timestamp() - interval '1 second')$$,
  'expired upload preparation is denied');

select is_empty($$select * from private.prepare_skill_vault_upload('msf_a6000000000046008600000000000201', statement_timestamp() + interval '301 seconds')$$,
  'upload preparation cannot exceed the five-minute bound');

select is((select count(*) from private.prepare_skill_vault_read(
  'msf_a6000000000046008600000000000201', statement_timestamp() + interval '300 seconds')),
  1::bigint, 'owner read preparation requires and finds the exact valid object');

select is((select count(*) from private.prepare_skill_vault_delete(
  'msf_a6000000000046008600000000000201', statement_timestamp() + interval '300 seconds')),
  1::bigint, 'owner delete preparation is single-object and short-lived');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a6000000-0000-4600-8600-000000000001', true);

select results_eq($$update storage.objects
  set metadata = '{"mimetype":"text/markdown","size":5}'
  where bucket_id = 'skill-vault-private'
    and name = 'v1/msv_a6000000000046008600000000000101/msf_a6000000000046008600000000000201'
  returning id::text$$,
  array['a6000000-0000-4600-8600-000000000301'],
  'account A can update its own exact valid object through the owner policy');

select ok(exists (
  select 1 from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'storage'
    and procedure_row.proname = 'protect_delete'
), 'direct object-table deletion remains guarded by the vendor Storage API boundary');

reset role;

select throws_ok($sql$
  insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata) values
    ('a6000000-0000-4600-8600-000000000304', 'skill-vault-private', 'v1/not-a-key', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000001', '{"mimetype":"text/markdown","size":5}', '{}')
$sql$, '23514', 'skill-vault-private object is not bound to one immutable managed file', 'malformed storage keys are rejected by the persistence trigger');

select throws_ok($sql$
  insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata) values
    ('a6000000-0000-4600-8600-000000000305', 'skill-vault-private', 'v1/msv_a6000000000046008600000000000101/msf_a6000000000046008600000000000201', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000001', '{"mimetype":"text/markdown","size":6}', '{}')
$sql$, '23514', 'skill-vault-private object is not bound to one immutable managed file', 'declared object size must equal immutable file size');

select throws_ok($sql$
  insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata) values
    ('a6000000-0000-4600-8600-000000000306', 'skill-vault-private', 'v1/msv_a6000000000046008600000000000101/msf_a6000000000046008600000000000201', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000001', '{"mimetype":"text/plain","size":5}', '{}')
$sql$, '23514', 'skill-vault-private object is not bound to one immutable managed file', 'declared object media type must equal immutable file media type');

select throws_ok($sql$
  insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata) values
    ('a6000000-0000-4600-8600-000000000307', 'skill-vault-private', 'v1/msv_a6000000000046008600000000000101/msf_a6000000000046008600000000000201', 'a6000000-0000-4600-8600-000000000001', 'a6000000-0000-4600-8600-000000000001', '{"mimetype":"text/markdown","size":5,"relative_path":"SKILL.md"}', '{}')
$sql$, '23514', 'skill-vault-private object is not bound to one immutable managed file', 'metadata cannot carry the raw relative path');

select is((select state from private.enqueue_skill_vault_incomplete_upload_cleanup(
  'skill-vault-private', 'v1/msv_a6000000000046008600000000000101/msf_a6000000000046008600000000000201', 'upload.incomplete')),
  'queued', 'valid exact-object cleanup enqueue is queued');

select is((select count(*) from private.skill_vault_incomplete_upload_cleanup),
  1::bigint, 'cleanup enqueue is idempotent by bucket, exact object, and reason');

select throws_ok($$select * from private.enqueue_skill_vault_incomplete_upload_cleanup('skill-vault-private', 'v1/not-a-key', 'upload.incomplete')$$,
  '23514', 'invalid exact Skill Vault cleanup target', 'cleanup cannot enqueue a prefix or malformed key');

select throws_ok($$select * from private.claim_skill_vault_incomplete_upload_cleanup(65,60)$$,
  '22023', 'cleanup claim limit must be between 1 and 64', 'cleanup claims have a bounded batch size');

create temporary table m4_storage_cleanup_claim on commit drop as
select * from private.claim_skill_vault_incomplete_upload_cleanup(1,60);

select is((select attempt_count from m4_storage_cleanup_claim limit 1),
  1, 'cleanup claim transitions one queued exact-object job with its first attempt');

select is((select state from private.complete_skill_vault_incomplete_upload_cleanup(
  (select job_id from m4_storage_cleanup_claim limit 1),
  (select lease_token from m4_storage_cleanup_claim limit 1)) limit 1),
  'completed', 'cleanup completion records a terminal relational receipt only');

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select is_empty($$select name from storage.objects where bucket_id = 'skill-vault-private'$$,
  'anonymous callers cannot list private Skill Vault objects');

reset role;
select * from finish();
rollback;
