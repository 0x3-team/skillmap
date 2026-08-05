begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(74);

-- M2.05 is private relational file/blob-reference authority only.  This test
-- deliberately creates no storage objects, policies, uploads, or public API.

select has_table('private', 'managed_skill_files',
  'managed skill file table exists');

select ok(
  'private.managed_skills'::regclass::oid
    < 'private.managed_skill_versions'::regclass::oid
    and 'private.managed_skill_versions'::regclass::oid
      < 'private.managed_skill_files'::regclass::oid,
  'managed identity, version, then file objects exist in accepted order');

select is((
  select pg_catalog.string_agg(
    column_name || ':' || data_type || ':' || is_nullable,
    ',' order by ordinal_position
  )
  from information_schema.columns
  where table_schema = 'private' and table_name = 'managed_skill_files'
), 'id:uuid:NO,public_id:text:NO,account_id:uuid:NO,managed_skill_id:uuid:NO,version_id:uuid:NO,relative_path:text:NO,media_type:text:NO,byte_size:bigint:NO,file_digest:text:NO,storage_key:text:NO,executable:boolean:NO,ordinal:integer:NO,created_at:timestamp with time zone:NO',
  'file table has exactly the immutable identity, content, blob-reference, and timestamp columns');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'p'
    and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
), 'file internal UUID is the primary key');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'c'
    and position('^msf_[0-9a-f]{32}$' in pg_catalog.pg_get_constraintdef(oid)) > 0
), 'file public ID constraint freezes the msf_ lowercase hexadecimal grammar');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'f'
    and pg_catalog.pg_get_constraintdef(oid) like '%FOREIGN KEY (account_id, managed_skill_id)%'
    and pg_catalog.pg_get_constraintdef(oid) like '%managed_skills%'
    and confdeltype = 'c'
) and exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'f'
    and pg_catalog.pg_get_constraintdef(oid) like '%FOREIGN KEY (account_id, managed_skill_id, version_id)%'
    and pg_catalog.pg_get_constraintdef(oid) like '%managed_skill_versions%'
    and confdeltype = 'c'
), 'file rows use same-account, same-skill, same-version composite ownership FKs');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'c'
    and position('relative_path' in pg_catalog.pg_get_constraintdef(oid)) > 0
    and position('512' in pg_catalog.pg_get_constraintdef(oid)) > 0
    and position('32' in pg_catalog.pg_get_constraintdef(oid)) > 0
),
  'relative paths freeze NFC, slash, length, segment, absolute, control, and dot-segment rules');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'c'
    and position('media_type' in pg_catalog.pg_get_constraintdef(oid)) > 0
    and position('128' in pg_catalog.pg_get_constraintdef(oid)) > 0
),
  'media types use the bounded 128-byte relational field limit');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'c'
    and position('storage_key' in pg_catalog.pg_get_constraintdef(oid)) > 0
    and position('512' in pg_catalog.pg_get_constraintdef(oid)) > 0
),
  'opaque storage keys are bounded to 512 bytes');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'c'
    and position('byte_size' in pg_catalog.pg_get_constraintdef(oid)) > 0
    and position('16777216' in pg_catalog.pg_get_constraintdef(oid)) > 0
),
  'file bytes are bounded to the inherited 16 MiB maximum');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and conname = 'managed_skill_files_skill_markdown_size_check'
    and contype = 'c'
    and position('1048576' in pg_catalog.pg_get_constraintdef(oid)) > 0
), 'SKILL.md bytes are bounded to the inherited 1 MiB maximum');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'c'
    and position('file_digest' in pg_catalog.pg_get_constraintdef(oid)) > 0
    and position('sha256:' in pg_catalog.pg_get_constraintdef(oid)) > 0
),
  'file content digests use the lowercase SHA-256 grammar');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'c'
    and position('ordinal' in pg_catalog.pg_get_constraintdef(oid)) > 0
    and position('>= 0' in pg_catalog.pg_get_constraintdef(oid)) > 0
), 'file ordinals are nonnegative');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'u'
    and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (account_id, version_id, relative_path)'
) and exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'u'
    and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (account_id, version_id, ordinal)'
) and exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_files'::regclass
    and contype = 'u'
    and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (storage_key)'
), 'file path, ordinal, and storage key uniqueness are exact');

select ok((select count(*) = 3
           from pg_catalog.pg_constraint
           where conrelid = 'private.managed_skill_files'::regclass
             and contype = 'u'
             and pg_catalog.pg_get_constraintdef(oid) in (
               'UNIQUE (public_id)',
               'UNIQUE (account_id, id)',
               'UNIQUE (account_id, managed_skill_id, version_id, id)'
             )), 'public and composite file identity keys are exact');

select ok(exists (
  select 1
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
  where index_row.indrelid = 'private.managed_skill_files'::regclass
    and index_relation.relname = 'managed_skill_files_version_lock_idx'
    and pg_catalog.pg_get_indexdef(index_row.indexrelid) like '%(account_id, managed_skill_id, version_id, id)%'
), 'file version lock index orders the full composite scope then file identity');

select is((select count(*)
           from pg_catalog.pg_constraint
           where conrelid = 'private.managed_skill_files'::regclass),
  18::bigint, 'file table has exactly the frozen constraints plus its deferred constraint-trigger row');

select ok((select relrowsecurity and relforcerowsecurity
           from pg_catalog.pg_class
           where oid = 'private.managed_skill_files'::regclass),
  'file table enables and forces RLS');

select ok((select count(*) >= 1 from pg_catalog.pg_policy
           where polrelid = 'private.managed_skill_files'::regclass
             and polname = 'managed_skill_files_owner_select'),
  'M2.10 adds an owner_select policy on managed_skill_files');

select ok(
  not has_table_privilege('anon', 'private.managed_skill_files', 'select')
  and not has_table_privilege('authenticated', 'private.managed_skill_files', 'select')
  and not has_table_privilege('service_role', 'private.managed_skill_files', 'select')
  and not has_table_privilege('anon', 'private.managed_skill_files', 'insert')
  and not has_table_privilege('authenticated', 'private.managed_skill_files', 'update')
  and not has_table_privilege('service_role', 'private.managed_skill_files', 'delete'),
  'application roles have no direct file table privileges');

select ok(
  not has_function_privilege('anon', 'private.enforce_managed_skill_file_immutability()', 'execute')
  and not has_function_privilege('authenticated', 'private.enforce_managed_skill_file_immutability()', 'execute')
  and not has_function_privilege('service_role', 'private.enforce_managed_skill_file_immutability()', 'execute')
  and not has_function_privilege('anon', 'private.enforce_managed_version_file_bounds()', 'execute')
  and not has_function_privilege('authenticated', 'private.enforce_managed_version_file_bounds()', 'execute')
  and not has_function_privilege('service_role', 'private.enforce_managed_version_file_bounds()', 'execute'),
  'application roles have no direct file trigger-function privileges');

select ok(not exists (
  select 1
  from pg_catalog.pg_class relation,
    lateral pg_catalog.aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
  where relation.oid = 'private.managed_skill_files'::regclass and acl.grantee = 0
), 'PUBLIC has no file table privileges');

select ok(exists (
  select 1
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_proc function_row on function_row.oid = trigger_row.tgfoid
  join pg_catalog.pg_namespace namespace on namespace.oid = function_row.pronamespace
  where trigger_row.tgrelid = 'private.managed_skill_files'::regclass
    and not trigger_row.tgisinternal
    and trigger_row.tgconstraint = 0
    and trigger_row.tgname = 'managed_skill_files_enforce_immutability'
    and namespace.nspname = 'private'
    and pg_catalog.pg_get_functiondef(function_row.oid) like '%relative_path%'
    and pg_catalog.pg_get_functiondef(function_row.oid) like '%file_digest%'
    and pg_catalog.pg_get_functiondef(function_row.oid) like '%storage_key%'
), 'file identity/content immutability trigger exists');

select has_function('private', 'enforce_managed_skill_file_immutability',
  array[]::text[], 'file immutability function has the exact trigger signature');

select ok(exists (
  select 1
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_proc function_row on function_row.oid = trigger_row.tgfoid
  join pg_catalog.pg_namespace namespace on namespace.oid = function_row.pronamespace
  where trigger_row.tgrelid = 'private.managed_skill_files'::regclass
    and not trigger_row.tgisinternal
    and trigger_row.tgconstraint <> 0
    and trigger_row.tgname = 'managed_skill_files_enforce_version_bounds'
    and trigger_row.tgdeferrable
    and trigger_row.tginitdeferred
    and namespace.nspname = 'private'
    and function_row.proname = 'enforce_managed_version_file_bounds'
), 'file aggregate bounds use a deferred initially-deferred constraint trigger');

select ok((select pg_catalog.pg_get_functiondef(
  'private.enforce_managed_version_file_bounds()'::regprocedure
) ilike '%for update%'
  and pg_catalog.pg_get_functiondef(
    'private.enforce_managed_version_file_bounds()'::regprocedure
  ) ilike '%order by files.id%'
  and position('managed_skill_versions' in pg_catalog.pg_get_functiondef(
    'private.enforce_managed_version_file_bounds()'::regprocedure
  )) < position('managed_skill_files' in pg_catalog.pg_get_functiondef(
    'private.enforce_managed_version_file_bounds()'::regprocedure
  ))
  and position('2048' in pg_catalog.pg_get_functiondef(
    'private.enforce_managed_version_file_bounds()'::regprocedure
  )) > 0
  and position('67108864' in pg_catalog.pg_get_functiondef(
    'private.enforce_managed_version_file_bounds()'::regprocedure
  )) > 0
  and not pg_catalog.pg_get_functiondef(
    'private.enforce_managed_version_file_bounds()'::regprocedure
  ) ilike '%http%'),
  'bounds trigger locks the version before deterministically ordered file rows and performs no external operation');

select lives_ok($sql$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-4500-8500-000000000001',
      'authenticated', 'authenticated', 'm205-a@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', 'b6000000-0000-4600-8600-000000000002',
      'authenticated', 'authenticated', 'm205-b@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', '')
$sql$, 'deterministic M2.05 account fixtures insert');

select lives_ok($sql$
  insert into private.managed_skills (id, public_id, account_id, display_name)
  values
    ('a5000000-0000-4500-8500-000000000011', 'msk_a5000000000045008500000000000011', 'a5000000-0000-4500-8500-000000000001', 'M205 Alpha'),
    ('a5000000-0000-4500-8500-000000000012', 'msk_a5000000000045008500000000000012', 'a5000000-0000-4500-8500-000000000001', 'M205 Beta'),
    ('b6000000-0000-4600-8600-000000000021', 'msk_b6000000000046008600000000000021', 'b6000000-0000-4600-8600-000000000002', 'M205 Foreign')
$sql$, 'same-account and foreign managed skill fixtures insert');

select lives_ok($sql$
  insert into private.managed_skill_versions (
    id, public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values
    ('a5000000-0000-4500-8500-000000000101', 'msv_a5000000000045008500000000000101',
      'a5000000-0000-4500-8500-000000000001', 'a5000000-0000-4500-8500-000000000011',
      '1.0', '{}'::bytea, 'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
      '{"logical_id":"m205","display_name":"M205"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m205","revision":"r1"}'::jsonb,
      'verified', 'complete'),
    ('a5000000-0000-4500-8500-000000000102', 'msv_a5000000000045008500000000000102',
      'a5000000-0000-4500-8500-000000000001', 'a5000000-0000-4500-8500-000000000012',
      '1.0', '{}'::bytea, 'sha256:' || repeat('2', 64), 'sha256:' || repeat('b', 64),
      '{"logical_id":"m205","display_name":"M205"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m205","revision":"r1"}'::jsonb,
      'verified', 'complete'),
    ('a5000000-0000-4500-8500-000000000104', 'msv_a5000000000045008500000000000104',
      'a5000000-0000-4500-8500-000000000001', 'a5000000-0000-4500-8500-000000000011',
      '1.0', '{}'::bytea, 'sha256:' || repeat('4', 64), 'sha256:' || repeat('d', 64),
      '{"logical_id":"m205","display_name":"M205"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m205","revision":"r1"}'::jsonb,
      'verified', 'complete'),
    ('a5000000-0000-4500-8500-000000000105', 'msv_a5000000000045008500000000000105',
      'a5000000-0000-4500-8500-000000000001', 'a5000000-0000-4500-8500-000000000011',
      '1.0', '{}'::bytea, 'sha256:' || repeat('5', 64), 'sha256:' || repeat('e', 64),
      '{"logical_id":"m205","display_name":"M205"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m205","revision":"r1"}'::jsonb,
      'verified', 'complete'),
    ('a5000000-0000-4500-8500-000000000106', 'msv_a5000000000045008500000000000106',
      'a5000000-0000-4500-8500-000000000001', 'a5000000-0000-4500-8500-000000000011',
      '1.0', '{}'::bytea, 'sha256:' || repeat('6', 64), 'sha256:' || repeat('f', 64),
      '{"logical_id":"m205","display_name":"M205"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m205","revision":"r1"}'::jsonb,
      'verified', 'complete'),
    ('a5000000-0000-4500-8500-000000000107', 'msv_a5000000000045008500000000000107',
      'a5000000-0000-4500-8500-000000000001', 'a5000000-0000-4500-8500-000000000011',
      '1.0', '{}'::bytea, 'sha256:' || repeat('7', 64), 'sha256:' || repeat('0', 64),
      '{"logical_id":"m205","display_name":"M205"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m205","revision":"r1"}'::jsonb,
      'verified', 'complete'),
    ('b6000000-0000-4600-8600-000000000201', 'msv_b6000000000046008600000000000201',
      'b6000000-0000-4600-8600-000000000002', 'b6000000-0000-4600-8600-000000000021',
      '1.0', '{}'::bytea, 'sha256:' || repeat('3', 64), 'sha256:' || repeat('c', 64),
      '{"logical_id":"m205-foreign","display_name":"M205 Foreign"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m205-foreign","revision":"r1"}'::jsonb,
      'verified', 'complete')
$sql$, 'same-scope and foreign version fixtures insert');

select lives_ok($sql$
  insert into private.managed_skill_files (
    id, public_id, account_id, managed_skill_id, version_id, relative_path,
    media_type, byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000001001', 'msf_a5000000000045008500000000001001',
    'a5000000-0000-4500-8500-000000000001', 'a5000000-0000-4500-8500-000000000011',
    'a5000000-0000-4500-8500-000000000101', 'SKILL.md',
    'text/markdown; charset=utf-8', 5, 'sha256:' || repeat('4', 64),
    'opaque-key-1001', false, 0
  )
$sql$, 'valid SKILL.md file fixture inserts');

select is((select public_id from private.managed_skill_files
           where id = 'a5000000-0000-4500-8500-000000001001'),
  'msf_a5000000000045008500000000001001', 'explicit file public ID is retained');

select lives_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000000001', 'a5000000-0000-4500-8500-000000000011',
    'a5000000-0000-4500-8500-000000000101', 'docs/readme.txt', 'text/plain',
    0, 'sha256:' || repeat('5', 64), 'opaque-key-generated', false, 1
  )
$sql$, 'zero-byte file with generated public ID inserts');

select ok((select public_id ~ '^msf_[0-9a-f]{32}$'
           from private.managed_skill_files
           where storage_key = 'opaque-key-generated'),
  'generated file public ID satisfies the msf_ grammar');

-- Every SQL-representable M1.04 path denial is exercised independently.
select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','/absolute.txt','text/plain',1,'sha256:'||repeat('6',64),'path-denial-absolute',false,2)
$sql$, 23514, null, 'absolute paths are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','C:/drive.txt','text/plain',1,'sha256:'||repeat('7',64),'path-denial-drive',false,3)
$sql$, 23514, null, 'drive-relative paths are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','\\windows.txt','text/plain',1,'sha256:'||repeat('8',64),'path-denial-backslash',false,4)
$sql$, 23514, null, 'backslash paths are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','a//b.txt','text/plain',1,'sha256:'||repeat('9',64),'path-denial-empty-segment',false,5)
$sql$, 23514, null, 'empty path segments are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','a/./b.txt','text/plain',1,'sha256:'||repeat('a',64),'path-denial-dot',false,6)
$sql$, 23514, null, 'dot segments are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','a/../b.txt','text/plain',1,'sha256:'||repeat('b',64),'path-denial-dotdot',false,7)
$sql$, 23514, null, 'dotdot segments are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','','text/plain',1,'sha256:'||repeat('b',64),'path-denial-empty',false,7)
$sql$, 23514, null, 'empty relative paths are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','a/	b.txt','text/plain',1,'sha256:'||repeat('c',64),'path-denial-control',false,8)
$sql$, 23514, null, 'control characters are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101',convert_from(decode('65cc812e747874','hex'),'UTF8'),'text/plain',1,'sha256:'||repeat('d',64),'path-denial-nfd',false,9)
$sql$, 23514, null, 'non-NFC paths are rejected');

/* The original format()-based boundary fixtures are retained as historical
   draft text but disabled; direct SQL expressions below avoid literal-format
   ambiguity in pg_prove.

select throws_ok(format($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101,'%s','text/plain',1,'sha256:%s','path-denial-513',false,10)
$sql$, repeat('a/',31) || repeat('b',451), 'sha256:' || repeat('e',64)),
  23514, null, '513 UTF-8 path bytes are rejected');

select lives_ok(format($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101,'%s','text/plain',1,'sha256:%s','path-boundary-512',false,11)
$sql$, repeat('a/',31) || repeat('b',448) || 'é', repeat('f',64)),
  '512 UTF-8 bytes including a multibyte character and 32 segments are accepted');

select throws_ok(format($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101,'%s','text/plain',1,'sha256:%s','path-denial-utf8-513',false,12)
$sql$, repeat('a/',31) || repeat('b',449) || 'é', repeat('f',64)),
  23514, null, '513 UTF-8 bytes are rejected even when character count is lower');

select throws_ok(format($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101,'%s','text/plain',1,'sha256:%s','path-denial-33-segments',false,12)
$sql$, repeat('a/',32) || 'b', repeat('0',64)),
  23514, null, '33 path segments are rejected');
*/

select throws_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000000001',
    'a5000000-0000-4500-8500-000000000011',
    'a5000000-0000-4500-8500-000000000101',
    repeat('a/', 31) || repeat('b', 451), 'text/plain', 1,
    'sha256:' || repeat('e', 64), 'path-denial-513', false, 10
  )
$sql$, 23514, null, '513 UTF-8 path bytes are rejected');

select lives_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000000001',
    'a5000000-0000-4500-8500-000000000011',
    'a5000000-0000-4500-8500-000000000101',
    repeat('a/', 31) || repeat('b', 448) || 'é', 'text/plain', 1,
    'sha256:' || repeat('f', 64), 'path-boundary-512', false, 11
  )
$sql$, '512 UTF-8 bytes including a multibyte character and 32 segments are accepted');

select throws_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000000001',
    'a5000000-0000-4500-8500-000000000011',
    'a5000000-0000-4500-8500-000000000101',
    repeat('a/', 31) || repeat('b', 449) || 'é', 'text/plain', 1,
    'sha256:' || repeat('f', 64), 'path-denial-utf8-513', false, 12
  )
$sql$, 23514, null, '513 UTF-8 bytes are rejected even when character count is lower');

select throws_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000000001',
    'a5000000-0000-4500-8500-000000000011',
    'a5000000-0000-4500-8500-000000000101',
    repeat('a/', 32) || 'b', 'text/plain', 1,
    'sha256:' || repeat('0', 64), 'path-denial-33-segments', false, 12
  )
$sql$, 23514, null, '33 path segments are rejected');

insert into private.managed_skill_files (
  account_id, managed_skill_id, version_id, relative_path, media_type,
  byte_size, file_digest, storage_key, executable, ordinal
) values (
  'a5000000-0000-4500-8500-000000000001',
  'a5000000-0000-4500-8500-000000000011',
  'a5000000-0000-4500-8500-000000000101',
  'unique/path.txt', 'text/plain', 1,
  'sha256:' || repeat('1', 64), 'duplicate-path-fixture', false, 100
);

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','unique/path.txt','text/plain',1,'sha256:'||repeat('1',64),'path-denial-duplicate-path',false,13)
$sql$, 23505, null, 'duplicate per-version paths are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','duplicate/ordinal.txt','text/plain',1,'sha256:'||repeat('2',64),'path-denial-duplicate-ordinal',false,0)
$sql$, 23505, null, 'duplicate per-version ordinals are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','duplicate/storage.txt','text/plain',1,'sha256:'||repeat('3',64),'opaque-key-1001',false,14)
$sql$, 23505, null, 'storage keys are globally unique');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','invalid/media.txt',repeat('m',129),1,'sha256:'||repeat('4',64),'media-overflow',false,15)
$sql$, 23514, null, '129-byte media types are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','invalid/storage.txt','text/plain',1,'sha256:'||repeat('5',64),repeat('s',513),false,16)
$sql$, 23514, null, '513-byte storage keys are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','invalid/negative.txt','text/plain',-1,'sha256:'||repeat('6',64),'negative-bytes',false,17)
$sql$, 23514, null, 'negative byte sizes are rejected');

select lives_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','boundary/max-file.bin','application/octet-stream',16777216,'sha256:'||repeat('7',64),'max-file-bytes',true,18)
$sql$, '16 MiB file size is accepted');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','boundary/overflow.bin','application/octet-stream',16777217,'sha256:'||repeat('8',64),'overflow-file-bytes',false,19)
$sql$, 23514, null, '16 MiB plus one file size is rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','boundary/negative-ordinal.txt','text/plain',1,'sha256:'||repeat('9',64),'negative-ordinal',false,-1)
$sql$, 23514, null, 'negative ordinals are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','invalid/digest.txt','text/plain',1,'sha256:BAD','invalid-digest',false,20)
$sql$, 23514, null, 'malformed content digests are rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','invalid/digest-case.txt','text/plain',1,'SHA256:'||repeat('b',64),'invalid-digest-case',false,21)
$sql$, 23514, null, 'uppercase digest prefixes are rejected');

select lives_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000106','SKILL.md','text/markdown',1048576,'sha256:'||repeat('c',64),'skill-md-max',false,22)
$sql$, '1 MiB SKILL.md is accepted');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000107','SKILL.md','text/markdown',1048577,'sha256:'||repeat('d',64),'skill-md-overflow',false,23)
$sql$, 23514, null, '1 MiB plus one SKILL.md is rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('b6000000-0000-4600-8600-000000000002','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101','foreign/account.txt','text/plain',1,'sha256:'||repeat('e',64),'foreign-account',false,0)
$sql$, 23503, null, 'cross-account skill attachment is rejected');

/* Replaced below with a non-colliding ordinal so FK scope, rather than the
   independent ordinal uniqueness constraint, determines the failure.
select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000012','a5000000-0000-4500-8500-000000000101','foreign/skill.txt','text/plain',1,'sha256:'||repeat('f',64),'foreign-skill',false,0)
$sql$, 23503, null, 'cross-skill version attachment is rejected');
*/

select throws_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000000001',
    'a5000000-0000-4500-8500-000000000012',
    'a5000000-0000-4500-8500-000000000101',
    'foreign/skill.txt', 'text/plain', 1,
    'sha256:' || repeat('f', 64), 'foreign-skill', false, 999
  )
$sql$, 23503, null, 'cross-skill version attachment is rejected');

select throws_ok($sql$
  insert into private.managed_skill_files (account_id, managed_skill_id, version_id, relative_path, media_type, byte_size, file_digest, storage_key, executable, ordinal)
  values ('a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000102','foreign/version.txt','text/plain',1,'sha256:'||repeat('0',64),'foreign-version',false,0)
$sql$, 23503, null, 'cross-version attachment is rejected');

select throws_ok($sql$
  update private.managed_skill_files
  set relative_path = 'rewritten/SKILL.md'
  where id = 'a5000000-0000-4500-8500-000000001001'
$sql$, 22023, null, 'file paths are immutable');

select throws_ok($sql$
  update private.managed_skill_files
  set file_digest = 'sha256:' || repeat('1', 64)
  where id = 'a5000000-0000-4500-8500-000000001001'
$sql$, 22023, null, 'file content digests are immutable');

select throws_ok($sql$
  update private.managed_skill_files
  set account_id = 'b6000000-0000-4600-8600-000000000002'
  where id = 'a5000000-0000-4500-8500-000000001001'
$sql$, 22023, null, 'file account ownership is immutable');

savepoint m205_rollback_fixture;
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000101',
    'rollback/only.txt','text/plain',1,'sha256:'||repeat('1',64),'rollback-only-key',false,24
  );
rollback to savepoint m205_rollback_fixture;

select is((select count(*) from private.managed_skill_files
           where storage_key = 'rollback-only-key'), 0::bigint,
  'rolled-back file fixture leaves no row');

select lives_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  )
  select 'a5000000-0000-4500-8500-000000000001',
    'a5000000-0000-4500-8500-000000000011',
    'a5000000-0000-4500-8500-000000000105',
    'count/' || lpad(g::text, 4, '0') || '.bin', 'application/octet-stream',
    32768, 'sha256:' || lpad(to_hex(g), 64, '0'), 'count-key-' || g, false, g - 1
  from generate_series(1, 2048) as series(g);
  set constraints all immediate;
  set constraints all deferred;
$sql$, 'exactly 2,048 files and exactly 64 MiB aggregate are accepted');

select is((select count(*) from private.managed_skill_files
           where version_id = 'a5000000-0000-4500-8500-000000000105'),
  2048::bigint, 'the exact count fixture retains 2,048 rows');

select throws_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  ) values (
    'a5000000-0000-4500-8500-000000000001','a5000000-0000-4500-8500-000000000011','a5000000-0000-4500-8500-000000000105',
    'count/2049.bin','application/octet-stream',1,'sha256:'||repeat('2',64),'count-key-overflow',false,2048
  );
  set constraints all immediate;
$sql$, 23514, null, '2,049 files are rejected at deferred constraint check');

select lives_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  )
  select 'a5000000-0000-4500-8500-000000000001',
    'a5000000-0000-4500-8500-000000000012',
    'a5000000-0000-4500-8500-000000000102',
    'aggregate/' || lpad(g::text, 4, '0') || '.bin', 'application/octet-stream',
    32768, 'sha256:' || lpad(to_hex(g + 10000), 64, '0'), 'aggregate-key-' || g, false, g - 1
  from generate_series(1, 2048) as series(g);
  set constraints all immediate;
  set constraints all deferred;
$sql$, 'a second exact 64 MiB version aggregate is accepted');

select throws_ok($sql$
  insert into private.managed_skill_files (
    account_id, managed_skill_id, version_id, relative_path, media_type,
    byte_size, file_digest, storage_key, executable, ordinal
  )
  select 'a5000000-0000-4500-8500-000000000001',
    'a5000000-0000-4500-8500-000000000011',
    'a5000000-0000-4500-8500-000000000104',
    'aggregate-over/' || lpad(g::text, 4, '0') || '.bin', 'application/octet-stream',
    case when g = 2048 then 32769 else 32768 end,
    'sha256:' || lpad(to_hex(g + 20000), 64, '0'), 'aggregate-over-key-' || g, false, g - 1
  from generate_series(1, 2048) as series(g);
  set constraints all immediate;
$sql$, 23514, null, 'aggregate bytes plus one are rejected at deferred constraint check');

set constraints all immediate;
delete from auth.users
where id = 'a5000000-0000-4500-8500-000000000001';

select is((select count(*) from private.managed_skill_files
           where account_id = 'a5000000-0000-4500-8500-000000000001'),
  0::bigint, 'account cascade removes all owned file rows');

select is((select count(*) from private.managed_skill_versions
           where account_id = 'a5000000-0000-4500-8500-000000000001'),
  0::bigint, 'account cascade removes the parent versions after file rows');

select is((select count(*) from private.managed_skills
           where account_id = 'a5000000-0000-4500-8500-000000000001'),
  0::bigint, 'account cascade removes the managed skill parents');

select * from finish();
rollback;
