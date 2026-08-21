begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(21);

select has_table('private', 'import_target_preparations', 'target preparation receipt table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'private.import_target_preparations'::regclass),
  'target preparation receipts force RLS'
);
select ok(
  not has_table_privilege('anon', 'private.import_target_preparations', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.import_target_preparations', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.import_target_preparations', 'select,insert,update,delete'),
  'application roles have no target preparation table grants'
);
select ok(
  has_function_privilege(
    'service_role',
    'device_adapter.adapter_prepare_import_target(text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'device_adapter.adapter_prepare_import_target(text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'device_adapter.adapter_prepare_import_target(text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid)',
    'execute'
  ),
  'only service_role can execute target preparation adapter'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values
('00000000-0000-0000-0000-000000000000','a4000000-0000-4400-8400-000000000001','authenticated','authenticated','m4-target-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','b4000000-0000-4400-8400-000000000002','authenticated','authenticated','m4-target-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values
('a4000000-0000-4400-8400-000000000101','dev_'||repeat('4',32),'a4000000-0000-4400-8400-000000000001','M4 target','macos','1.0.0','en-US');

create temporary table m4_target_receipt(response jsonb not null) on commit drop;
create temporary table m4_target_revision(response jsonb not null) on commit drop;
grant select, insert on m4_target_receipt, m4_target_revision to service_role;

set local role service_role;
select lives_ok($$insert into m4_target_receipt(response)
  select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001',
    'dev_'||repeat('4',32),
    'Imported Alpha','Bounded import target','1.0',
    pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),
    'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),'sha256'),'hex'),
    'sha256:'||repeat('5',64),
    '{"logical_id":"alpha","display_name":"Imported Alpha","description":"Bounded import target"}',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000301'
  )$$, 'valid target preparation succeeds');
reset role;

select ok(
  (select response ?& array['skill_public_id','version_public_id','release_public_id','manifest_digest','content_digest','file_count','byte_total','reused','files']
     and not response ?| array['account_id','device_id','managed_skill_id','version_id','storage_root']
   from m4_target_receipt),
  'target response is a closed public projection'
);
select is((select count(*) from private.managed_skills where account_id='a4000000-0000-4400-8400-000000000001'), 1::bigint, 'one managed skill is created');
select is((select count(*) from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001'), 1::bigint, 'one immutable version is created');
select is((select count(*) from private.managed_skill_files where account_id='a4000000-0000-4400-8400-000000000001'), 1::bigint, 'one immutable file row is created');
select ok(
  (select lifecycle_state='needs-review' and eligibility_reasons=array['analysis_pending']::text[]
   from private.managed_skill_releases where account_id='a4000000-0000-4400-8400-000000000001'),
  'prepared target remains non-active and needs review'
);
select is((select count(*) from private.import_target_preparations), 1::bigint, 'one device-scoped idempotency receipt is stored');

set local role service_role;
select is(
  device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Imported Alpha','Bounded import target','1.0',
    pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),
    'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),'sha256'),'hex'),
    'sha256:'||repeat('5',64),
    '{"logical_id":"alpha","display_name":"Imported Alpha","description":"Bounded import target"}',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000301'
  ),
  (select response from m4_target_receipt),
  'exact idempotency replay returns the same response'
);
select throws_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Changed Name','Bounded import target','1.0',
    pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),
    'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),'sha256'),'hex'),
    'sha256:'||repeat('5',64),
    '{"logical_id":"alpha","display_name":"Imported Alpha","description":"Bounded import target"}',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000301')$$,
  22023, 'conflicting import target idempotency reuse', 'changed idempotent request conflicts');
select ok(
  device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Imported Alpha','Bounded import target','1.0',
    pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),
    'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),'sha256'),'hex'),
    'sha256:'||repeat('5',64),
    '{"logical_id":"alpha","display_name":"Imported Alpha","description":"Bounded import target"}',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r1"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000302'
  ) @> '{"reused":true}'::jsonb,
  'a new request exactly reuses the immutable manifest identity without duplicating the skill'
);
select lives_ok($$insert into m4_target_revision(response)
  select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Imported Alpha v2','Changed immutable version','1.0',
    pg_catalog.convert_to('{"schema_version":"1.1"}','UTF8'),
    'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.1"}','UTF8'),'sha256'),'hex'),
    'sha256:'||repeat('7',64),
    '{"logical_id":"alpha","display_name":"Imported Alpha v2","description":"Changed immutable version"}',
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"alpha","revision":"r2"}',
    'verified',
    '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":4,"file_digest":"sha256:8888888888888888888888888888888888888888888888888888888888888888","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000304'
  )$$, 'changed content for one logical skill creates a new immutable version');
reset role;
select ok(
  (select revision.response->>'skill_public_id' = original.response->>'skill_public_id'
      and revision.response->>'version_public_id' <> original.response->>'version_public_id'
   from m4_target_revision as revision cross join m4_target_receipt as original)
  and (select count(*) from private.managed_skills where account_id='a4000000-0000-4400-8400-000000000001') = 1
  and (select count(*) from private.managed_skill_versions where account_id='a4000000-0000-4400-8400-000000000001') = 2,
  'logical identity stays stable while immutable version history grows'
);
set local role service_role;
select lives_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    repeat('N',200),null,'1.0',pg_catalog.convert_to('{"schema_version":"1.2"}','UTF8'),
    'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.2"}','UTF8'),'sha256'),'hex'),
    'sha256:'||repeat('9',64),
    pg_catalog.jsonb_build_object('logical_id','name-bound','display_name',repeat('N',200)),
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"name-bound","revision":"r1"}',
    'verified','[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":1,"file_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000305')$$,
  'a 200-character display name is accepted end to end');
select throws_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    repeat('N',201),null,'1.0',decode('7b7d','hex'),'sha256:'||repeat('0',64),'sha256:'||repeat('1',64),
    pg_catalog.jsonb_build_object('logical_id','name-bound-oversize','display_name',repeat('N',201)),
    '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"name-bound-oversize","revision":"r1"}',
    'verified','[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":1,"file_digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","executable":false,"ordinal":0}]',
    'a4000000-0000-4400-8400-000000000306')$$,
  22023, 'invalid import target preparation', 'a 201-character display name is rejected');
select throws_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_b4000000000044008400000000000002','dev_'||repeat('4',32),
    'Foreign','x','1.0',decode('7b7d','hex'),'sha256:'||repeat('0',64),'sha256:'||repeat('1',64),
    '{}','{}','verified','[]','b4000000-0000-4400-8400-000000000301')$$,
  '42501', 'import authority unavailable', 'foreign account cannot use another account device context');
reset role;
update private.devices
set state='revoked', revoked_at=pg_catalog.statement_timestamp(), revision=revision+1
where id='a4000000-0000-4400-8400-000000000101';
set local role service_role;
select throws_ok($$select device_adapter.adapter_prepare_import_target(
    'acct_a4000000000044008400000000000001','dev_'||repeat('4',32),
    'Inactive','x','1.0',decode('7b7d','hex'),'sha256:'||repeat('0',64),'sha256:'||repeat('1',64),
    '{}','{}','verified','[]','a4000000-0000-4400-8400-000000000303')$$,
  '42501', 'import authority unavailable', 'revoked device cannot prepare an import target');
select throws_ok($$select * from private.import_target_preparations$$, '42501', null, 'service role cannot list private target receipts');
reset role;

select * from finish();
rollback;
