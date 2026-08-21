begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(9);

select has_function('private', 'my_owner_import_dashboard', array[]::text[], 'owner dashboard projection helper exists');
select has_view('api', 'my_import_dashboard', 'owner dashboard projection view exists');
select ok(
  has_table_privilege('authenticated', 'api.my_import_dashboard', 'select')
  and not has_table_privilege('anon', 'api.my_import_dashboard', 'select')
  and not has_table_privilege('service_role', 'api.my_import_dashboard', 'select'),
  'only authenticated browser owners can select the dashboard projection'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values
('00000000-0000-0000-0000-000000000000','a4000000-0000-4400-8400-000000000011','authenticated','authenticated','m4-dashboard-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','b4000000-0000-4400-8400-000000000012','authenticated','authenticated','m4-dashboard-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values
('a4000000-0000-4400-8400-000000000111','dev_'||repeat('d',32),'a4000000-0000-4400-8400-000000000011','Dashboard connector','macos','1.0.0','en-US');

create temporary table m4_dashboard_target(response jsonb not null) on commit drop;
create temporary table m4_dashboard_session(response jsonb not null) on commit drop;
grant select, insert on m4_dashboard_target, m4_dashboard_session to service_role;

set local role service_role;
insert into m4_dashboard_target(response)
select device_adapter.adapter_prepare_import_target(
  'acct_a4000000000044008400000000000011','dev_'||repeat('d',32),
  'Dashboard Alpha','Dashboard projection fixture','1.0',
  pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),
  'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),'sha256'),'hex'),
  'sha256:'||repeat('5',64),
  '{"logical_id":"dashboard-alpha","display_name":"Dashboard Alpha","description":"Dashboard projection fixture"}',
  '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"dashboard-alpha","revision":"r1"}',
  'verified',
  '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
  'a4000000-0000-4400-8400-000000000311'
);

insert into m4_dashboard_session(response)
select device_adapter.adapter_begin_import_session_v2(
  'acct_a4000000000044008400000000000011','dev_'||repeat('d',32),
  (select response->>'skill_public_id' from m4_dashboard_target),
  (select response->>'version_public_id' from m4_dashboard_target),
  '1.0',
  (select response->>'manifest_digest' from m4_dashboard_target),
  (select response->>'content_digest' from m4_dashboard_target),
  1,3,'a4000000-0000-4400-8400-000000000312',
  pg_catalog.statement_timestamp() + interval '30 minutes'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4000000-0000-4400-8400-000000000011","is_anonymous":false}', true);
set local role authenticated;

select is((select count(*) from api.my_import_dashboard), 1::bigint, 'owner sees exactly its import dashboard row');
select ok(
  (select projection ?& array['sessionId','state','device','summary','skills','uploadProgress','createdAt','expiresAt','revision']
     and projection->>'state' = 'preview'
     and projection->'device'->>'name' = 'Dashboard connector'
     and projection->'skills'->0->>'skillName' = 'Dashboard Alpha'
     and projection->'skills'->0->'files'->0->>'relativePath' = 'SKILL.md'
   from api.my_import_dashboard),
  'dashboard row is the expected safe workflow projection'
);
select ok(
  (select projection::text !~ 'account_id|managed_skill_id|version_id|device_id|storage_key'
     and projection::text not like '%a4000000-0000-4400-8400-000000000011%'
   from api.my_import_dashboard),
  'dashboard projection contains no internal identifiers or storage keys'
);

reset role;
insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata,user_metadata) values (
  'a4000000-0000-4400-8400-000000000411','skill-vault-private',
  (select response->'files'->0->>'storage_key' from m4_dashboard_target),
  'a4000000-0000-4400-8400-000000000011','a4000000-0000-4400-8400-000000000011',
  '{"mimetype":"text/markdown","size":3}','{}'
);
set local role service_role;
select device_adapter.adapter_accept_import_file_v2(
  'acct_a4000000000044008400000000000011','dev_'||repeat('d',32),
  (select response->>'session_id' from m4_dashboard_session),1,
  (select response->'files'->0->>'file_public_id' from m4_dashboard_target)
);
select device_adapter.adapter_finalize_import_session_v2(
  'acct_a4000000000044008400000000000011','dev_'||repeat('d',32),
  (select response->>'session_id' from m4_dashboard_session),2,
  'a4000000-0000-4400-8400-000000000313'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4000000-0000-4400-8400-000000000011","is_anonymous":false}', true);
set local role authenticated;
select ok(
  (select projection->>'state' = 'cutover_ready'
     and projection->'cutoverReceipt'->>'receiptId' ~ '^rcpt_[0-9a-f]{32}$'
     and projection->'cutoverReceipt'->>'verificationDigest' ~ '^sha256:[0-9a-f]{64}$'
     and projection->'cutoverReceipt'->>'sessionId' = projection->>'sessionId'
   from api.my_import_dashboard),
  'verified session projects a browser-safe cutover receipt and reachable cutover-ready state'
);
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"b4000000-0000-4400-8400-000000000012","is_anonymous":false}', true);
set local role authenticated;
select is((select count(*) from api.my_import_dashboard), 0::bigint, 'another account cannot see the owner dashboard row');
reset role;

set local role anon;
select throws_ok($$select * from api.my_import_dashboard$$, '42501', null, 'anonymous role cannot select the dashboard view');
reset role;

select * from finish();
rollback;
