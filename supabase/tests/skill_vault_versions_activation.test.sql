begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, private, api;

select plan(102);

-- M2.04 is intentionally a private, ungranted authority surface.  The
-- assertions below inspect the applied catalog and then exercise only
-- synthetic rows inside this transaction.

select has_table('private', 'managed_skill_versions',
  'immutable managed skill version table exists');
select has_table('private', 'managed_skill_releases',
  'managed skill release binding table exists');
select has_function('api', 'activate_managed_skill_release',
  array['text', 'text', 'bigint', 'uuid']::text[],
  'activation API has the exact public signature');

select is((
  select pg_catalog.string_agg(column_name || ':' || data_type || ':' || is_nullable,
    ',' order by ordinal_position)
  from information_schema.columns
  where table_schema = 'private' and table_name = 'managed_skill_versions'
), 'id:uuid:NO,public_id:text:NO,account_id:uuid:NO,managed_skill_id:uuid:NO,manifest_schema_version:text:NO,manifest_projection:bytea:NO,manifest_digest:text:NO,content_digest:text:NO,canonical_metadata:jsonb:NO,source:jsonb:NO,provenance_state:text:NO,analysis_state:text:NO,created_at:timestamp with time zone:NO',
  'version table exposes exactly the frozen manifest, digest, provenance, analysis, and identity columns');

select is((
  select pg_catalog.string_agg(column_name || ':' || data_type || ':' || is_nullable,
    ',' order by ordinal_position)
  from information_schema.columns
  where table_schema = 'private' and table_name = 'managed_skill_releases'
), 'id:uuid:NO,public_id:text:NO,account_id:uuid:NO,managed_skill_id:uuid:NO,version_id:uuid:NO,lifecycle_state:text:NO,eligibility_reasons:ARRAY:NO,created_at:timestamp with time zone:NO,activated_at:timestamp with time zone:YES,revoked_at:timestamp with time zone:YES',
  'release table exposes exactly immutable binding, lifecycle, eligibility, and timestamp columns');

select is((
  select pg_catalog.string_agg(column_name || ':' || data_type || ':' || is_nullable,
    ',' order by ordinal_position)
  from information_schema.columns
  where table_schema = 'private' and table_name = 'managed_skills'
), 'id:uuid:NO,public_id:text:NO,account_id:uuid:NO,display_name:text:NO,description:text:YES,created_at:timestamp with time zone:NO,updated_at:timestamp with time zone:NO,active_release_id:uuid:YES,activation_revision:bigint:NO',
  'managed skill gains only the nullable active pointer and nonnegative CAS revision');

select ok((
  select count(*) = 2
  from pg_catalog.pg_constraint
  where conrelid in ('private.managed_skill_versions'::regclass,
                     'private.managed_skill_releases'::regclass)
    and contype = 'p'
), 'version and release primary keys exist before pointer authority can be used');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_versions'::regclass
    and contype = 'f' and pg_catalog.pg_get_constraintdef(oid) like '%managed_skills%'
) and exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_releases'::regclass
    and contype = 'f' and pg_catalog.pg_get_constraintdef(oid) like '%managed_skill_versions%'
), 'version then release account/skill bindings are present before activation');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and contype = 'f'
    and pg_catalog.pg_get_constraintdef(oid) like '%active_release_id%'
    and pg_catalog.pg_get_constraintdef(oid) like '%managed_skill_releases%'
), 'active pointer is a same-account/same-skill composite release binding');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skills'::regclass
    and conname like '%activation_revision%'
    and position('activation_revision >= 0' in pg_catalog.pg_get_constraintdef(oid)) > 0
), 'CAS revision is constrained nonnegative');

select ok(position('^msv_[0-9a-f]{32}$' in (
  select pg_catalog.pg_get_constraintdef(oid)
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_versions'::regclass
    and conname = 'managed_skill_versions_public_id_format_check'
)) > 0, 'version public IDs use the msv lowercase hexadecimal grammar');
select ok(position('^msr_[0-9a-f]{32}$' in (
  select pg_catalog.pg_get_constraintdef(oid)
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_releases'::regclass
    and conname = 'managed_skill_releases_public_id_format_check'
)) > 0, 'release public IDs use the msr lowercase hexadecimal grammar');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_versions'::regclass
    and conname = 'managed_skill_versions_manifest_digest_format_check'
    and pg_catalog.pg_get_constraintdef(oid) like '%sha256:%'
) and exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_versions'::regclass
    and conname = 'managed_skill_versions_content_digest_format_check'
    and pg_catalog.pg_get_constraintdef(oid) like '%sha256:%'
), 'both version digests use the sha256 lowercase hexadecimal grammar');

select ok(position('262144' in (
  select pg_catalog.pg_get_constraintdef(oid)
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_versions'::regclass
    and conname = 'managed_skill_versions_manifest_projection_bytes_check'
)) > 0, 'canonical manifest projection is bounded to 262144 bytes');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_versions'::regclass
    and pg_catalog.pg_get_constraintdef(oid) like '%UNIQUE (account_id, managed_skill_id, manifest_digest)%'
) and exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_versions'::regclass
    and pg_catalog.pg_get_constraintdef(oid) like '%UNIQUE (account_id, managed_skill_id, content_digest)%'
), 'same-skill manifest and content digests are unique');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_releases'::regclass
    and pg_catalog.pg_get_constraintdef(oid) like '%UNIQUE (account_id, managed_skill_id, id)%'
) and exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_releases'::regclass
    and pg_catalog.pg_get_constraintdef(oid) like '%UNIQUE (account_id, managed_skill_id, version_id)%'
), 'release bindings are unique within one account and managed skill');

select ok(exists (
  select 1 from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
  where index_row.indrelid = 'private.managed_skill_releases'::regclass
    and index_row.indpred is not null
    and pg_catalog.pg_get_indexdef(index_row.indexrelid) like '%lifecycle_state%active%'
), 'eligible release lookup is a partial index');

select ok((select relrowsecurity and relforcerowsecurity
           from pg_catalog.pg_class where oid = 'private.managed_skill_versions'::regclass)
  and (select relrowsecurity and relforcerowsecurity
       from pg_catalog.pg_class where oid = 'private.managed_skill_releases'::regclass),
  'both new private tables enable and force RLS');
select ok((select count(*) >= 1 from pg_catalog.pg_policy
           where polrelid in ('private.managed_skill_versions'::regclass,'private.managed_skill_releases'::regclass)
             and polname in ('managed_skill_versions_definer_all','managed_skill_releases_definer_all')),
  'M2.10 adds owner and definer policies on versions and releases');

select ok(
  not has_table_privilege('anon', 'private.managed_skill_versions', 'select')
  and not has_table_privilege('authenticated', 'private.managed_skill_versions', 'select')
  and not has_table_privilege('service_role', 'private.managed_skill_versions', 'select')
  and not has_table_privilege('anon', 'private.managed_skill_releases', 'select')
  and not has_table_privilege('authenticated', 'private.managed_skill_releases', 'select')
  and not has_table_privilege('service_role', 'private.managed_skill_releases', 'select'),
  'application roles have no direct version or release table access');
select ok((select relrowsecurity and relforcerowsecurity
           from pg_catalog.pg_class
           where oid = 'private.managed_skill_activation_receipts'::regclass),
  'activation receipts enable and force RLS');
select ok((select count(*) >= 1 from pg_catalog.pg_policies
           where schemaname = 'private'
             and tablename = 'managed_skill_activation_receipts'
             and policyname = 'managed_skill_activation_receipts_definer_all'),
  'M2.10 adds a per-owner definer_all policy on activation receipts');
select ok(
  not has_table_privilege('anon', 'private.managed_skill_activation_receipts', 'select')
  and not has_table_privilege('authenticated', 'private.managed_skill_activation_receipts', 'select')
  and not has_table_privilege('service_role', 'private.managed_skill_activation_receipts', 'select'),
  'application roles have no direct activation-receipt table access');
select ok(
  has_function_privilege('authenticated', 'api.activate_managed_skill_release(text,text,bigint,uuid)', 'execute')
  and not has_function_privilege('anon', 'api.activate_managed_skill_release(text,text,bigint,uuid)', 'execute')
  and not has_function_privilege('service_role', 'api.activate_managed_skill_release(text,text,bigint,uuid)', 'execute'),
  'M2.10 grants activation to authenticated only; anon and service_role remain ungranted');

select ok((select prosecdef
           from pg_catalog.pg_proc
           where oid = 'api.activate_managed_skill_release(text,text,bigint,uuid)'::regprocedure),
  'activation API has an explicit security-definer boundary');
select ok(position('private.current_request_uid' in (
  select pg_catalog.pg_get_functiondef(
    'private.activate_managed_skill_release(text,text,bigint,uuid)'::regprocedure
  )
)) > 0, 'activation derives account ownership through the bound current_request_uid helper and accepts no account argument (M2.10 auth-helper rebind)');

select is((select count(*) from information_schema.columns
           where table_schema = 'private' and table_name = 'managed_skills'
             and column_name ~ '(lifecycle|version)'), 0::bigint,
  'managed skill has no authoritative lifecycle or version column');
select ok(not exists (
  select 1 from pg_catalog.pg_views
  where schemaname = 'api'
    and viewname in ('catalog_skills', 'catalog_skill_versions', 'catalog_skill_relationships', 'saved_skill_catalog')
    and definition like '%managed_skill_versions%'
), 'catalog projections remain untouched by managed version authority');
select ok(not exists (
  select 1 from information_schema.columns
  where column_name = 'current_version_id'
    and table_schema = 'private'
    and table_name in ('managed_skill_versions', 'managed_skill_releases', 'managed_skills')
), 'catalog current_version_id authority remains untouched');

select lives_ok($sql$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4100-8100-000000000001',
      'authenticated', 'authenticated', 'm204-a@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-4200-8200-000000000002',
      'authenticated', 'authenticated', 'm204-b@skillmap.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', '')
$sql$, 'synthetic M2.04 accounts insert');

select lives_ok($sql$
  insert into private.managed_skills (id, public_id, account_id, display_name)
  values
    ('a1000000-0000-4100-8100-000000000011', 'msk_a1000000000041008100000000000011', 'a1000000-0000-4100-8100-000000000001', 'Alpha'),
    ('a1000000-0000-4100-8100-000000000012', 'msk_a1000000000041008100000000000012', 'a1000000-0000-4100-8100-000000000001', 'Beta'),
    ('b2000000-0000-4200-8200-000000000021', 'msk_b2000000000042008200000000000021', 'b2000000-0000-4200-8200-000000000002', 'Other owner')
$sql$, 'synthetic managed skill accounts and identities insert');

select lives_ok($sql$
  insert into private.managed_skill_versions (
    id, public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values (
    'a1000000-0000-4100-8100-000000000101', 'msv_a1000000000041008100000000000101',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    '{"logical_id":"alpha","display_name":"Alpha"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"alpha","revision":"r1"}'::jsonb,
    'verified', 'complete'
  )
$sql$, 'valid immutable version fixture inserts');

select throws_ok($sql$
  insert into private.managed_skill_versions (
    id, public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values (
    'a1000000-0000-4100-8100-000000000102', 'msv_a1000000000041008100000000000102',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    '1.0', repeat('x', 262145)::bytea, 'sha256:' || repeat('2', 64),
    'sha256:' || repeat('b', 64), '{}'::jsonb, '{}'::jsonb, 'verified', 'complete'
  )
$sql$, 23514, null, 'manifest projection maximum-plus-one is rejected');

select throws_ok($sql$
  insert into private.managed_skill_versions (
    public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values (
    'msv_a1000000000041008100000000000103',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    '1.0', '{"schema_version":"1.0"}'::bytea, 'bad', 'sha256:' || repeat('c', 64),
    '{}'::jsonb, '{}'::jsonb, 'verified', 'complete'
  )
$sql$, 23514, null, 'malformed manifest digest is rejected');

select throws_ok($sql$
  update private.managed_skill_versions
  set content_digest = 'sha256:' || repeat('d', 64)
  where id = 'a1000000-0000-4100-8100-000000000101'
$sql$, 22023, 'managed skill version immutable fields are immutable',
  'version content coordinates cannot be rewritten');

select lives_ok($sql$
  insert into private.managed_skill_versions (
    id, public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values (
    'a1000000-0000-4100-8100-000000000111', 'msv_a1000000000041008100000000000111',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000012',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    '{"logical_id":"beta","display_name":"Beta"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"beta","revision":"r1"}'::jsonb,
    'verified', 'complete'
  )
$sql$, 'equal content across different managed skills is allowed');

select lives_ok($sql$
  insert into private.managed_skill_versions (
    id, public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values
  (
    'a1000000-0000-4100-8100-000000000112', 'msv_a1000000000041008100000000000112',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    '1.0', '{"schema_version":"1.0","revision":"r2"}'::bytea,
    'sha256:' || repeat('2', 64), 'sha256:' || repeat('b', 64),
    '{"logical_id":"alpha","display_name":"Alpha"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"alpha","revision":"r2"}'::jsonb,
    'verified', 'complete'
  ),
  (
    'a1000000-0000-4100-8100-000000000113', 'msv_a1000000000041008100000000000113',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    '1.0', '{"schema_version":"1.0","revision":"r3"}'::bytea,
    'sha256:' || repeat('3', 64), 'sha256:' || repeat('c', 64),
    '{"logical_id":"alpha","display_name":"Alpha"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"alpha","revision":"r3"}'::jsonb,
    'verified', 'complete'
  )
$sql$, 'additional immutable version fixtures insert for rollback and noneligible binding');

select lives_ok($sql$
  insert into private.managed_skill_versions (
    id, public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values (
    'b2000000-0000-4200-8200-000000000121', 'msv_b2000000000042008200000000000121',
    'b2000000-0000-4200-8200-000000000002', 'b2000000-0000-4200-8200-000000000021',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    '{"logical_id":"other","display_name":"Other owner"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"other","revision":"r1"}'::jsonb,
    'verified', 'complete'
  )
$sql$, 'equal content across accounts is allowed');

select throws_ok($sql$
  insert into private.managed_skill_versions (
    public_id, account_id, managed_skill_id, manifest_schema_version,
    manifest_projection, manifest_digest, content_digest, canonical_metadata,
    source, provenance_state, analysis_state
  ) values (
    'msv_a1000000000041008100000000000131',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    '1.0', '{"schema_version":"1.0"}'::bytea,
    'sha256:' || repeat('1', 64), 'sha256:' || repeat('a', 64),
    '{"logical_id":"alpha","display_name":"Alpha"}'::jsonb,
    '{"authority":"managed","kind":"local","namespace":"owner","source_id":"alpha","revision":"r1"}'::jsonb,
    'verified', 'complete'
  )
$sql$, 23505, null, 'same-skill manifest/content duplicate is rejected');

select lives_ok($sql$
  insert into private.managed_skill_releases (
    id, public_id, account_id, managed_skill_id, version_id,
    lifecycle_state, eligibility_reasons
  ) values (
    'a1000000-0000-4100-8100-000000000201', 'msr_a1000000000041008100000000000201',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    'a1000000-0000-4100-8100-000000000101', 'active', '{}'::text[]
  )
$sql$, 'eligible active release fixture inserts');

select lives_ok($sql$
  insert into private.managed_skill_releases (
    id, public_id, account_id, managed_skill_id, version_id,
    lifecycle_state, eligibility_reasons
  ) values (
    'a1000000-0000-4100-8100-000000000202', 'msr_a1000000000041008100000000000202',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    'a1000000-0000-4100-8100-000000000112', 'active', '{}'::text[]
  )
$sql$, 'second eligible release fixture inserts');

select lives_ok($sql$
  insert into private.managed_skill_releases (
    id, public_id, account_id, managed_skill_id, version_id,
    lifecycle_state, eligibility_reasons
  ) values (
    'a1000000-0000-4100-8100-000000000203', 'msr_a1000000000041008100000000000203',
    'a1000000-0000-4100-8100-000000000001', 'a1000000-0000-4100-8100-000000000011',
    'a1000000-0000-4100-8100-000000000113', 'disabled', ARRAY['analysis_required']
  )
$sql$, 'noneligible disabled release fixture inserts');

select lives_ok($sql$
  insert into private.managed_skill_releases (
    id, public_id, account_id, managed_skill_id, version_id,
    lifecycle_state, eligibility_reasons
  ) values (
    'b2000000-0000-4200-8200-000000000221', 'msr_b2000000000042008200000000000221',
    'b2000000-0000-4200-8200-000000000002', 'b2000000-0000-4200-8200-000000000021',
    'b2000000-0000-4200-8200-000000000121', 'active', '{}'::text[]
  )
$sql$, 'foreign-account release fixture inserts');

select ok((
  select pg_catalog.pg_get_constraintdef(oid) like '%importing%'
    and pg_catalog.pg_get_constraintdef(oid) like '%analyzing%'
    and pg_catalog.pg_get_constraintdef(oid) like '%needs-review%'
    and pg_catalog.pg_get_constraintdef(oid) like '%active%'
    and pg_catalog.pg_get_constraintdef(oid) like '%disabled%'
    and pg_catalog.pg_get_constraintdef(oid) like '%quarantined%'
    and pg_catalog.pg_get_constraintdef(oid) like '%archived%'
    and pg_catalog.pg_get_constraintdef(oid) like '%corrupt%'
    and pg_catalog.pg_get_constraintdef(oid) like '%deleting%'
  from pg_catalog.pg_constraint
  where conrelid = 'private.managed_skill_releases'::regclass
    and conname = 'managed_skill_releases_lifecycle_state_check'
), 'all nine exact M1.06 lifecycle states are accepted by the state vocabulary');
select throws_ok($sql$
  update private.managed_skill_releases set lifecycle_state = 'invented'
  where id = 'a1000000-0000-4100-8100-000000000203'
$sql$, 23514, null, 'unknown lifecycle state is rejected');
select throws_ok($sql$
  update private.managed_skill_releases set lifecycle_state = 'needs-review'
  where id = 'a1000000-0000-4100-8100-000000000203'
$sql$, 23514, 'illegal managed skill release lifecycle transition',
  'M1.06 illegal disabled-to-needs-review transition is rejected');
select ok((select cardinality(eligibility_reasons) = 0
           from private.managed_skill_releases
           where id = 'a1000000-0000-4100-8100-000000000201')
  and (select eligibility_reasons = array['analysis_required']
       from private.managed_skill_releases
       where id = 'a1000000-0000-4100-8100-000000000203')
  and (select bool_and(
         cardinality(releases.eligibility_reasons) <= 16
         and not exists (
           select 1
           from unnest(releases.eligibility_reasons) as reason(code)
           group by reason.code
           having count(*) > 1
         )
       )
       from private.managed_skill_releases as releases
       where releases.id in (
         'a1000000-0000-4100-8100-000000000201',
         'a1000000-0000-4100-8100-000000000203'
       )),
  'eligibility reasons are bounded canonical unique codes without an invented closed CHECK vocabulary');

select throws_ok($sql$
  update private.managed_skill_releases
  set managed_skill_id = 'a1000000-0000-4100-8100-000000000012'
  where id = 'a1000000-0000-4100-8100-000000000201'
$sql$, 22023, 'managed skill release binding coordinates are immutable',
  'release binding skill coordinate cannot be rewritten');

select ok((select active_release_id is null and activation_revision = 0
           from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'new managed skill starts without a pointer at CAS revision zero');

select ok(
  set_config(
    'request.jwt.claim.sub',
    'a1000000-0000-4100-8100-000000000001',
    true
  ) is not null,
  'synthetic owner identity is installed for activation fixtures'
);
create temporary table m204_replay_receipt (result jsonb) on commit drop;
select lives_ok($sql$
  insert into m204_replay_receipt
  select to_jsonb(result_row)
  from api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_a1000000000041008100000000000201', 0,
    '11111111-1111-4111-8111-111111111111'
  ) as result_row
$sql$, 'initial eligible activation succeeds');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 1::bigint,
  'initial activation increments CAS revision exactly once');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000201'::uuid,
  'initial activation sets the same-account/same-skill release pointer');

select is((
  select to_jsonb(result_row)
  from api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_a1000000000041008100000000000201', 0,
    '11111111-1111-4111-8111-111111111111'
  ) as result_row
), (select result from m204_replay_receipt),
  'exact idempotency replay returns the original decision');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 1::bigint,
  'exact replay does not increment CAS revision');

select throws_ok($sql$
  select api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_a1000000000041008100000000000202', 1,
    '11111111-1111-4111-8111-111111111111'
  )
$sql$, null, null, 'conflicting idempotency-key reuse fails closed');

select is((
  select result_state
  from api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_a1000000000041008100000000000202', 0,
    '22222222-2222-4222-8222-222222222222'
  )
), 'VAULT_STALE_REVISION', 'stale CAS returns the bounded stale-revision decision');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 1::bigint,
  'stale CAS leaves revision unchanged');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000201'::uuid,
  'stale CAS leaves pointer unchanged');

select lives_ok($sql$
  select api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_a1000000000041008100000000000202', 1,
    '33333333-3333-4333-8333-333333333333'
  )
$sql$, 'rollback to another eligible active release succeeds');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 2::bigint,
  'rollback increments CAS revision exactly once');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000202'::uuid,
  'rollback changes only the managed skill pointer');
select is((select content_digest from private.managed_skill_versions
           where id = 'a1000000-0000-4100-8100-000000000101'),
  'sha256:' || repeat('a', 64), 'rollback does not mutate the original version');
select is((select content_digest from private.managed_skill_versions
           where id = 'a1000000-0000-4100-8100-000000000112'),
  'sha256:' || repeat('b', 64), 'rollback does not mutate the target version');

select is((
  select result_state
  from api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_a1000000000041008100000000000203', 2,
    '44444444-4444-4444-8444-444444444444'
  )
), 'VAULT_RESOURCE_UNAVAILABLE',
  'noneligible release returns the bounded unavailable decision');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 2::bigint,
  'noneligible activation leaves revision unchanged');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000202'::uuid,
  'noneligible activation leaves pointer unchanged');

select throws_ok($sql$
  update private.managed_skill_releases
  set activated_at = statement_timestamp()
  where id = 'a1000000-0000-4100-8100-000000000203'
$sql$, 22023, null,
  'non-active release cannot acquire an activated timestamp');

select throws_ok($sql$
  update private.managed_skill_releases
  set lifecycle_state = 'disabled',
      eligibility_reasons = array['administratively_disabled'],
      revoked_at = statement_timestamp()
  where id = 'a1000000-0000-4100-8100-000000000202'
$sql$, 22023, null, 'selected release cannot become revoked before pointer removal');

-- Consume the rejected operation identity before the target becomes eligible.
-- The exact replay must remain unavailable even after a legal lifecycle change.
select lives_ok($sql$
  update private.managed_skill_releases
  set lifecycle_state = 'active',
      eligibility_reasons = '{}'::text[]
  where id = 'a1000000-0000-4100-8100-000000000203'
$sql$, 'unselected disabled release becomes eligible through a legal transition');
select is((
  select result_state
  from api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_a1000000000041008100000000000203', 2,
    '44444444-4444-4444-8444-444444444444'
  )
), 'VAULT_RESOURCE_UNAVAILABLE',
  'rejected noneligible operation replays its original unavailable decision');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 2::bigint,
  'rejected-key replay after eligibility change leaves revision unchanged');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000202'::uuid,
  'rejected-key replay after eligibility change leaves pointer unchanged');
select lives_ok($sql$
  select api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_a1000000000041008100000000000203', 2,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
$sql$, 'fresh key may activate the now-eligible release');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 3::bigint,
  'fresh-key activation increments revision exactly once');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000203'::uuid,
  'fresh-key activation selects the newly eligible release');

select lives_ok($sql$
  update private.managed_skill_releases
  set lifecycle_state = 'disabled',
      eligibility_reasons = array['administratively_disabled']
  where id = 'a1000000-0000-4100-8100-000000000202'
$sql$, 'unselected active release becomes non-active through a legal transition');
select throws_ok($sql$
  update private.managed_skill_releases
  set revoked_at = statement_timestamp()
  where id = 'a1000000-0000-4100-8100-000000000202'
$sql$, 22023, null,
  'revoked timestamp cannot be set after a release became non-active');

select is((
  select result_state
  from api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_b2000000000042008200000000000221', 3,
    '55555555-5555-4555-8555-555555555555'
  )
), 'VAULT_RESOURCE_UNAVAILABLE', 'foreign-account release returns unavailable');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 3::bigint,
  'foreign-account request leaves revision unchanged');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000203'::uuid,
  'foreign-account request leaves pointer unchanged');
select is((
  select result_state
  from api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000012',
    'msr_a1000000000041008100000000000201', 0,
    '66666666-6666-4666-8666-666666666666'
  )
), 'VAULT_RESOURCE_UNAVAILABLE', 'foreign-skill release returns unavailable');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 3::bigint,
  'foreign-skill request leaves revision unchanged');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000203'::uuid,
  'foreign-skill request leaves pointer unchanged');
select is((
  select result_state
  from api.activate_managed_skill_release(
    'msk_a1000000000041008100000000000011',
    'msr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 3,
    '77777777-7777-4777-8777-777777777777'
  )
), 'VAULT_RESOURCE_UNAVAILABLE', 'missing release returns unavailable');
select is((select activation_revision from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'), 3::bigint,
  'missing-release request leaves revision unchanged');
select is((select active_release_id from private.managed_skills
           where id = 'a1000000-0000-4100-8100-000000000011'),
  'a1000000-0000-4100-8100-000000000203'::uuid,
  'missing-release request leaves pointer unchanged');

-- Real concurrency proof. These fixtures are committed through autonomous
-- dblink sessions so both workers can race against the same revision while
-- this pgTAP transaction remains rollback-only. Cleanup is committed before
-- either connection is closed.
select lives_ok(
  pg_catalog.format(
    'select extensions.dblink_connect(%L, %L)',
    'm204_cas_one',
    'host=host.docker.internal port=54322 dbname=' || pg_catalog.current_database()
      || ' user=' || current_user || ' password=' || current_user
  ),
  'first autonomous CAS session connects'
);
select lives_ok(
  pg_catalog.format(
    'select extensions.dblink_connect(%L, %L)',
    'm204_cas_two',
    'host=host.docker.internal port=54322 dbname=' || pg_catalog.current_database()
      || ' user=' || current_user || ' password=' || current_user
  ),
  'second autonomous CAS session connects'
);

select lives_ok($tap$
  select extensions.dblink_exec('m204_cas_one', $remote$
    begin;
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      'cc000000-0000-4c00-8c00-000000000001',
      'authenticated', 'authenticated', 'm204-cas@skillmap.invalid', '', now(),
      '{}', '{}', now(), now(), '', '', '', ''
    );
    insert into private.managed_skills (id, public_id, account_id, display_name)
    values (
      'cc000000-0000-4c00-8c00-000000000011',
      'msk_cc00000000004c008c00000000000011',
      'cc000000-0000-4c00-8c00-000000000001',
      'Concurrent CAS'
    );
    insert into private.managed_skill_versions (
      id, public_id, account_id, managed_skill_id, manifest_schema_version,
      manifest_projection, manifest_digest, content_digest, canonical_metadata,
      source, provenance_state, analysis_state
    ) values
    (
      'cc000000-0000-4c00-8c00-000000000101',
      'msv_cc00000000004c008c00000000000101',
      'cc000000-0000-4c00-8c00-000000000001',
      'cc000000-0000-4c00-8c00-000000000011',
      '1.0', '{"schema_version":"1.0","revision":"race-a"}'::bytea,
      'sha256:' || repeat('4', 64), 'sha256:' || repeat('d', 64),
      '{"logical_id":"cas","display_name":"Concurrent CAS"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"cas","revision":"race-a"}'::jsonb,
      'verified', 'complete'
    ),
    (
      'cc000000-0000-4c00-8c00-000000000102',
      'msv_cc00000000004c008c00000000000102',
      'cc000000-0000-4c00-8c00-000000000001',
      'cc000000-0000-4c00-8c00-000000000011',
      '1.0', '{"schema_version":"1.0","revision":"race-b"}'::bytea,
      'sha256:' || repeat('5', 64), 'sha256:' || repeat('e', 64),
      '{"logical_id":"cas","display_name":"Concurrent CAS"}'::jsonb,
      '{"authority":"managed","kind":"local","namespace":"owner","source_id":"cas","revision":"race-b"}'::jsonb,
      'verified', 'complete'
    );
    insert into private.managed_skill_releases (
      id, public_id, account_id, managed_skill_id, version_id,
      lifecycle_state, eligibility_reasons
    ) values
    (
      'cc000000-0000-4c00-8c00-000000000201',
      'msr_cc00000000004c008c00000000000201',
      'cc000000-0000-4c00-8c00-000000000001',
      'cc000000-0000-4c00-8c00-000000000011',
      'cc000000-0000-4c00-8c00-000000000101',
      'active', '{}'::text[]
    ),
    (
      'cc000000-0000-4c00-8c00-000000000202',
      'msr_cc00000000004c008c00000000000202',
      'cc000000-0000-4c00-8c00-000000000001',
      'cc000000-0000-4c00-8c00-000000000011',
      'cc000000-0000-4c00-8c00-000000000102',
      'active', '{}'::text[]
    );
    commit;
  $remote$)
$tap$, 'autonomous concurrent-CAS fixtures commit');

select lives_ok($sql$
  select extensions.dblink_exec(
    'm204_cas_one',
    'set request.jwt.claim.sub = ''cc000000-0000-4c00-8c00-000000000001'''
  )
$sql$, 'first CAS session binds the synthetic owner');
select lives_ok($sql$
  select extensions.dblink_exec(
    'm204_cas_two',
    'set request.jwt.claim.sub = ''cc000000-0000-4c00-8c00-000000000001'''
  )
$sql$, 'second CAS session binds the synthetic owner');

select ok(extensions.dblink_send_query('m204_cas_one', $remote$
  select *
  from api.activate_managed_skill_release(
    'msk_cc00000000004c008c00000000000011',
    'msr_cc00000000004c008c00000000000201',
    0,
    '88888888-8888-4888-8888-888888888888'
  )
$remote$) = 1, 'first concurrent CAS request is dispatched asynchronously');
select ok(extensions.dblink_send_query('m204_cas_two', $remote$
  select *
  from api.activate_managed_skill_release(
    'msk_cc00000000004c008c00000000000011',
    'msr_cc00000000004c008c00000000000202',
    0,
    '99999999-9999-4999-8999-999999999999'
  )
$remote$) = 1, 'second concurrent CAS request is dispatched asynchronously');

create temporary table m204_concurrent_cas_results (
  connection_name text not null,
  result_skill_public_id text not null,
  result_release_public_id text not null,
  result_state text not null,
  result_activation_revision bigint not null
) on commit drop;

insert into m204_concurrent_cas_results
select 'm204_cas_one', result.*
from extensions.dblink_get_result('m204_cas_one', false) as result(
  result_skill_public_id text,
  result_release_public_id text,
  result_state text,
  result_activation_revision bigint
);
insert into m204_concurrent_cas_results
select 'm204_cas_two', result.*
from extensions.dblink_get_result('m204_cas_two', false) as result(
  result_skill_public_id text,
  result_release_public_id text,
  result_state text,
  result_activation_revision bigint
);

-- libpq can expose an additional empty result boundary after an asynchronous
-- remote error. Drain both sessions before issuing cleanup commands.
create temporary table m204_concurrent_cas_drain
(like m204_concurrent_cas_results including all) on commit drop;
insert into m204_concurrent_cas_drain
select 'm204_cas_one', result.*
from extensions.dblink_get_result('m204_cas_one', false) as result(
  result_skill_public_id text,
  result_release_public_id text,
  result_state text,
  result_activation_revision bigint
);
insert into m204_concurrent_cas_drain
select 'm204_cas_two', result.*
from extensions.dblink_get_result('m204_cas_two', false) as result(
  result_skill_public_id text,
  result_release_public_id text,
  result_state text,
  result_activation_revision bigint
);

select is((select count(*) from m204_concurrent_cas_results), 2::bigint,
  'both concurrent expected-revision-zero requests return committed decisions');
select ok((
  select managed_skills.activation_revision = 1
    and receipts.receipt_count = 2
    and winning_release.public_id = active_result.result_release_public_id
    and active_result.result_activation_revision = 1
    and stale_result.result_activation_revision = 1
    and active_result.result_state = 'active'
    and stale_result.result_state = 'VAULT_STALE_REVISION'
    and active_result.result_release_public_id <> stale_result.result_release_public_id
  from private.managed_skills as managed_skills
  join private.managed_skill_releases as winning_release
    on winning_release.id = managed_skills.active_release_id
  cross join (
    select count(*)::bigint as receipt_count
    from private.managed_skill_activation_receipts
    where account_id = 'cc000000-0000-4c00-8c00-000000000001'
  ) as receipts
  cross join lateral (
    select result.*
    from m204_concurrent_cas_results as result
    where result.result_state = 'active'
  ) as active_result
  cross join lateral (
    select result.*
    from m204_concurrent_cas_results as result
    where result.result_state = 'VAULT_STALE_REVISION'
  ) as stale_result
  where managed_skills.id = 'cc000000-0000-4c00-8c00-000000000011'
), 'concurrent CAS leaves exactly one active winner and one stale decision, with two receipts');

select lives_ok($tap$
  select extensions.dblink_exec('m204_cas_one', $remote$
    begin;
    update private.managed_skills
    set active_release_id = null,
        activation_revision = activation_revision + 1
    where account_id = 'cc000000-0000-4c00-8c00-000000000001';
    delete from auth.users
    where id = 'cc000000-0000-4c00-8c00-000000000001';
    commit;
  $remote$)
$tap$, 'autonomous concurrent-CAS fixtures are removed');
select lives_ok($sql$
  select extensions.dblink_disconnect('m204_cas_one')
$sql$, 'first autonomous CAS session disconnects');
select lives_ok($sql$
  select extensions.dblink_disconnect('m204_cas_two')
$sql$, 'second autonomous CAS session disconnects');

set local role authenticated;
select throws_ok($sql$select * from private.managed_skill_versions$sql$, 42501, null,
  'authenticated role cannot read private versions');
select throws_ok($sql$select * from private.managed_skill_releases$sql$, 42501, null,
  'authenticated role cannot read private releases');
select throws_ok($sql$select api.activate_managed_skill_release('x','y',0,gen_random_uuid())$sql$, 'P0001', null,
  'authenticated role can invoke activation but malformed coordinates fail closed');
reset role;

select * from finish();
rollback;
