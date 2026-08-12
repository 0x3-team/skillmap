begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(57);

select ok(exists (
  select 1
  from pg_catalog.pg_roles
  where rolname = 'skillmap_vault_definer'
    and not rolcanlogin
    and not rolsuper
    and not rolcreatedb
    and not rolcreaterole
    and not rolinherit
    and not rolreplication
    and not rolbypassrls
), 'vault definer role exists with least-privilege NOLOGIN attributes');

select ok(not exists (
  select 1
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
  join pg_catalog.pg_roles member_role on member_role.oid = membership.member
  where granted_role.rolname = 'skillmap_vault_definer'
    and member_role.rolname in ('anon', 'authenticated', 'service_role')
), 'application roles cannot assume the vault definer role');

select has_table('private', 'managed_skills', 'managed skill identity table exists');
select has_view('api', 'my_managed_skills', 'owner-safe managed skill projection exists');

select ok((
  select count(*) >= 8 and count(*) <= 10
  from information_schema.columns
  where table_schema = 'private' and table_name = 'managed_skills'
    and column_name in ('id','public_id','account_id','display_name','description','created_at','updated_at','active_release_id','activation_revision')
), 'managed skill table has the identity, display metadata, timestamp, and M2.04 CAS columns');

select ok((
  select count(*) = 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and contype = 'p'
    and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
) and (
  select column_default like '%gen_random_uuid%'
  from information_schema.columns
  where table_schema = 'private' and table_name = 'managed_skills' and column_name = 'id'
), 'internal id is a generated UUID primary key');

select ok(exists (
  select 1
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname = 'managed_skills_account_id_fkey'
    and contype = 'f'
    and confrelid = 'auth.users'::regclass
    and confdeltype = 'c'
), 'account ownership references auth.users with cascade deletion');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname = 'managed_skills_public_id_key'
    and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (public_id)'
), 'public ID is globally unique');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname = 'managed_skills_account_id_id_key'
    and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (account_id, id)'
), 'account and internal ID form a composite parent key');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname = 'managed_skills_account_id_public_id_key'
    and pg_catalog.pg_get_constraintdef(oid) = 'UNIQUE (account_id, public_id)'
), 'account and public ID form a bounded lookup key');

select ok(position('^msk_[0-9a-f]{32}$' in (
  select pg_catalog.pg_get_constraintdef(oid)
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname = 'managed_skills_public_id_format_check'
)) > 0, 'public ID constraint freezes the msk_ lowercase hexadecimal grammar');

select ok(position('140' in (
  select pg_catalog.pg_get_constraintdef(oid)
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname = 'managed_skills_display_name_length_check'
)) > 0, 'display name is bounded to the established 140-character skill limit');

select ok(position('20000' in (
  select pg_catalog.pg_get_constraintdef(oid)
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname = 'managed_skills_description_length_check'
)) > 0, 'description is bounded to the established 20000-character skill limit');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname = 'managed_skills_timestamps_order_check'
    and position('updated_at >= created_at' in pg_catalog.pg_get_constraintdef(oid)) > 0
), 'timestamp ordering is constrained');

select ok(exists (
  select 1
  from pg_catalog.pg_trigger
  where tgrelid = 'private.managed_skills'::regclass
    and tgname = 'managed_skills_enforce_stable_fields'
    and not tgisinternal
), 'stable identity and timestamp trigger exists');

select ok(exists (
  select 1
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace on namespace.oid = function_row.pronamespace
  where namespace.nspname = 'private'
    and function_row.proname = 'enforce_managed_skill_stable_fields'
    and not function_row.prosecdef
    and function_row.proconfig @> array['search_path=""']
), 'trigger function is invoker-mode with an empty search path');

select ok((
  select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class relation
  where relation.oid = 'private.managed_skills'::regclass
), 'managed skills table enables and forces RLS');

select ok((select count(*) >= 1 from pg_catalog.pg_policy
  where polrelid = 'private.managed_skills'::regclass
    and polname in ('managed_skills_owner_select','managed_skills_definer_all')),
  'M2.03/M2.10 install owner and definer policies on managed_skills (not zero policies)');

select ok(exists (
  select 1
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
  where index_row.indrelid = 'private.managed_skills'::regclass
    and index_relation.relname = 'managed_skills_owner_created_public_idx'
    and position('(account_id, created_at DESC, public_id)' in pg_catalog.pg_get_indexdef(index_row.indexrelid)) > 0
), 'owner pagination index has equality then descending range and stable public-ID order');

select ok(
  not has_table_privilege('anon', 'private.managed_skills', 'select')
  and not has_table_privilege('authenticated', 'private.managed_skills', 'select')
  and not has_table_privilege('service_role', 'private.managed_skills', 'select')
  and not has_table_privilege('anon', 'private.managed_skills', 'insert')
  and not has_table_privilege('authenticated', 'private.managed_skills', 'update')
  and not has_table_privilege('service_role', 'private.managed_skills', 'delete'),
  'application roles have no direct managed skill table privileges');

select ok(not exists (
  select 1
  from pg_catalog.pg_class relation,
    lateral pg_catalog.aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
  where relation.oid = 'private.managed_skills'::regclass and acl.grantee = 0
), 'PUBLIC has no managed skill table privileges');

select ok(
  not has_table_privilege('anon', 'api.my_managed_skills', 'select')
  and has_table_privilege('authenticated', 'api.my_managed_skills', 'select')
  and not has_table_privilege('service_role', 'api.my_managed_skills', 'select'),
  'owner projection is granted to authenticated only (M2.10 owner-projection posture)');

select ok((
  select reloptions @> array['security_invoker=true', 'security_barrier=true']
  from pg_catalog.pg_class
  where oid = 'api.my_managed_skills'::regclass
), 'owner projection is security-invoker and security-barrier');

select is((
  select pg_catalog.string_agg(column_name, ',' order by ordinal_position)
  from information_schema.columns
  where table_schema = 'api' and table_name = 'my_managed_skills'
), 'public_id,display_name,description,created_at,updated_at',
  'owner projection exposes only the safe public identity and display metadata');

select ok(position('auth.uid()' in pg_catalog.pg_get_viewdef('api.my_managed_skills'::regclass, true)) > 0,
  'owner projection derives ownership from auth.uid without an account argument');

select ok((
  select count(*)
  from information_schema.columns
  where table_schema = 'private' and table_name = 'managed_skills'
    and column_name in ('active_release_id','activation_revision')
) = 2, 'M2.04 adds exactly the active-pointer and CAS revision columns');

select ok(not exists (
  select 1
  from pg_catalog.pg_views
  where schemaname = 'api'
    and viewname in ('catalog_skills', 'catalog_skill_versions', 'catalog_skill_relationships', 'saved_skill_catalog')
    and definition like '%managed_skills%'
), 'existing catalog projections do not mix in managed identities');

select lives_ok($sql$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4300-8300-000000000001',
      'authenticated', 'authenticated', 'vault-a@skillmap.invalid', '', now(),
      '{"provider":"github","providers":["github"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', 'd4000000-0000-4400-8400-000000000002',
      'authenticated', 'authenticated', 'vault-b@skillmap.invalid', '', now(),
      '{"provider":"github","providers":["github"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', '')
$sql$, 'deterministic account fixtures insert');

select lives_ok($sql$
  insert into private.managed_skills (
    id, account_id, display_name, description, created_at, updated_at
  ) values (
    'c3000000-0000-4300-8300-000000000011',
    'c3000000-0000-4300-8300-000000000001',
    '  Alpha helper  ', '  Display only  ',
    '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'
  )
$sql$, 'valid managed identity inserts with generated public ID');

select ok((
  select public_id ~ '^msk_[0-9a-f]{32}$'
  from private.managed_skills
  where id = 'c3000000-0000-4300-8300-000000000011'
), 'generated public ID satisfies the frozen grammar');

select is((
  select display_name || ':' || description
  from private.managed_skills
  where id = 'c3000000-0000-4300-8300-000000000011'
), 'Alpha helper:Display only', 'display metadata is normalized on insert');

select ok((
  select created_at > '2020-01-01T00:00:00Z'::timestamptz and updated_at = created_at
  from private.managed_skills
  where id = 'c3000000-0000-4300-8300-000000000011'
), 'insert timestamps are server-owned and ordered');

select lives_ok($sql$
  insert into private.managed_skills (
    id, public_id, account_id, display_name, description
  ) values (
    'c3000000-0000-4300-8300-000000000012',
    'msk_c3000000000043008300000000000012',
    'c3000000-0000-4300-8300-000000000001',
    'Empty description', '   '
  )
$sql$, 'empty normalized description inserts');

select is((
  select description from private.managed_skills
  where id = 'c3000000-0000-4300-8300-000000000012'
), null, 'empty normalized description becomes null');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('skl_c3000000000043008300000000000021', 'c3000000-0000-4300-8300-000000000001', 'Wrong prefix')
$sql$, 23514, null, 'catalog-style prefix is rejected');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('msk_C3000000000043008300000000000022', 'c3000000-0000-4300-8300-000000000001', 'Uppercase')
$sql$, 23514, null, 'uppercase public ID is rejected');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('msk_c300', 'c3000000-0000-4300-8300-000000000001', 'Too short')
$sql$, 23514, null, 'short public ID is rejected');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('msk_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', 'c3000000-0000-4300-8300-000000000001', 'Non hex')
$sql$, 23514, null, 'non-hexadecimal public ID is rejected');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('msk_c3000000000043008300000000000012', 'd4000000-0000-4400-8400-000000000002', 'Duplicate public ID')
$sql$, 23505, null, 'public ID cannot be reused across accounts');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('msk_c3000000000043008300000000000023', 'e5000000-0000-4500-8500-000000000003', 'Unknown account')
$sql$, 23503, null, 'unknown account ownership is rejected');

select lives_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('msk_c3000000000043008300000000000024', 'c3000000-0000-4300-8300-000000000001', repeat('n', 140))
$sql$, '140-character display name is accepted');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('msk_c3000000000043008300000000000025', 'c3000000-0000-4300-8300-000000000001', repeat('n', 141))
$sql$, 23514, null, '141-character display name is rejected');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name)
  values ('msk_c3000000000043008300000000000026', 'c3000000-0000-4300-8300-000000000001', E'bad\nname')
$sql$, 23514, null, 'display-name control characters are rejected');

select lives_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name, description)
  values ('msk_c3000000000043008300000000000027', 'c3000000-0000-4300-8300-000000000001', 'Maximum description', repeat('d', 20000))
$sql$, '20000-character description is accepted');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name, description)
  values ('msk_c3000000000043008300000000000028', 'c3000000-0000-4300-8300-000000000001', 'Long description', repeat('d', 20001))
$sql$, 23514, null, '20001-character description is rejected');

select throws_ok($sql$
  insert into private.managed_skills (public_id, account_id, display_name, description)
  values ('msk_c3000000000043008300000000000029', 'c3000000-0000-4300-8300-000000000001', 'Control description', E'bad\tdescription')
$sql$, 23514, null, 'description control characters are rejected');

select throws_ok($sql$
  update private.managed_skills set id = 'c3000000-0000-4300-8300-000000000099'
  where id = 'c3000000-0000-4300-8300-000000000011'
$sql$, 22023, 'managed skill identity, ownership, and creation timestamp are immutable',
  'internal identity is immutable');

select throws_ok($sql$
  update private.managed_skills set public_id = 'msk_c3000000000043008300000000000099'
  where id = 'c3000000-0000-4300-8300-000000000011'
$sql$, 22023, 'managed skill identity, ownership, and creation timestamp are immutable',
  'public identity is immutable');

select throws_ok($sql$
  update private.managed_skills set account_id = 'd4000000-0000-4400-8400-000000000002'
  where id = 'c3000000-0000-4300-8300-000000000011'
$sql$, 22023, 'managed skill identity, ownership, and creation timestamp are immutable',
  'account ownership is immutable');

select throws_ok($sql$
  update private.managed_skills set created_at = created_at + interval '1 second'
  where id = 'c3000000-0000-4300-8300-000000000011'
$sql$, 22023, 'managed skill identity, ownership, and creation timestamp are immutable',
  'creation timestamp is immutable');

select lives_ok($sql$
  update private.managed_skills
  set display_name = '  Updated helper  ', description = '   ', updated_at = '2000-01-01T00:00:00Z'
  where id = 'c3000000-0000-4300-8300-000000000011'
$sql$, 'display metadata remains the only mutable aggregate surface');

select ok((
  select display_name = 'Updated helper'
    and description is null
    and updated_at >= created_at
    and updated_at > '2020-01-01T00:00:00Z'::timestamptz
  from private.managed_skills
  where id = 'c3000000-0000-4300-8300-000000000011'
), 'updates normalize display metadata and reject caller-owned timestamps');

set local role authenticated;
select throws_ok($sql$select * from private.managed_skills$sql$, 42501, null,
  'authenticated role cannot read the private managed table');
select lives_ok($sql$select * from api.my_managed_skills$sql$,
  'authenticated role can read the granted owner projection');
reset role;

set local role anon;
select throws_ok($sql$select * from private.managed_skills$sql$, 42501, null,
  'anonymous role cannot read the private managed table');
select throws_ok($sql$select * from api.my_managed_skills$sql$, 42501, null,
  'anonymous role cannot read the ungranted owner projection');
reset role;

delete from auth.users where id = 'c3000000-0000-4300-8300-000000000001';
select is((
  select count(*) from private.managed_skills
  where account_id = 'c3000000-0000-4300-8300-000000000001'
), 0::bigint, 'account deletion cascades all owned managed skill identities');

select * from finish();
rollback;
