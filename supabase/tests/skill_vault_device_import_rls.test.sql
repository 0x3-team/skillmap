begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(68);

-- 01-04: FORCE RLS stays enabled on every M2.11 table.
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.devices'::regclass), 'devices force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.device_tokens'::regclass), 'device_tokens force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.import_sessions'::regclass), 'import_sessions force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.import_file_receipts'::regclass), 'import_file_receipts force RLS');

-- 05-08: no application role receives a private-table capability.
select ok(not has_table_privilege('anon','private.devices','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.devices','select,insert,update,delete')
  and not has_table_privilege('service_role','private.devices','select,insert,update,delete'), 'devices have zero application-role base grants');
select ok(not has_table_privilege('anon','private.device_tokens','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_tokens','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_tokens','select,insert,update,delete'), 'device_tokens have zero application-role base grants');
select ok(not has_table_privilege('anon','private.import_sessions','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.import_sessions','select,insert,update,delete')
  and not has_table_privilege('service_role','private.import_sessions','select,insert,update,delete'), 'import_sessions have zero application-role base grants');
select ok(not has_table_privilege('anon','private.import_file_receipts','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.import_file_receipts','select,insert,update,delete')
  and not has_table_privilege('service_role','private.import_file_receipts','select,insert,update,delete'), 'import receipts have zero application-role base grants');

-- 09-25: projection, policy, and exact function-grant inventory.
select has_view('api','my_devices','bounded owner device view exists');
select has_view('api','my_import_sessions','bounded owner import view exists');
select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_catalog.pg_class where oid='api.my_devices'::regclass), 'device view is invoker and barrier');
select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_catalog.pg_class where oid='api.my_import_sessions'::regclass), 'import view is invoker and barrier');
select ok(not exists (
  select 1 from pg_catalog.pg_attribute
  where attrelid in ('api.my_devices'::regclass,'api.my_import_sessions'::regclass)
    and attnum > 0 and not attisdropped
    and attname in ('id','account_id','device_id','token_id','credential_digest','key_version','scopes',
                    'manifest_digest','content_digest','verification_digest','managed_skill_id','version_id')
), 'owner projections expose no internal UUID, verifier, key, scope, or digest');
select ok(has_table_privilege('authenticated','api.my_devices','select')
  and has_table_privilege('authenticated','api.my_import_sessions','select'), 'authenticated can select both bounded owner views');
select ok(not has_table_privilege('anon','api.my_devices','select')
  and not has_table_privilege('anon','api.my_import_sessions','select'), 'anon cannot select either owner view');
select ok(has_function_privilege('authenticated','private.register_my_device(text,text,text,text)','execute')
  and not has_function_privilege('anon','private.register_my_device(text,text,text,text)','execute')
  and not has_function_privilege('service_role','private.register_my_device(text,text,text,text)','execute'), 'register_my_device is authenticated-only');
select ok(has_function_privilege('authenticated','private.revoke_my_device(text,bigint)','execute')
  and not has_function_privilege('anon','private.revoke_my_device(text,bigint)','execute')
  and not has_function_privilege('service_role','private.revoke_my_device(text,bigint)','execute'), 'revoke_my_device is authenticated-only');
select ok(has_function_privilege('authenticated','private.rotate_my_device(text,bigint)','execute')
  and not has_function_privilege('anon','private.rotate_my_device(text,bigint)','execute')
  and not has_function_privilege('service_role','private.rotate_my_device(text,bigint)','execute'), 'rotate_my_device is authenticated-only');
select ok(
  has_function_privilege('service_role','device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamptz,bigint)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamptz)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_begin_import_session(uuid,text,integer,bigint,bigint,text,text,text,text,text,integer,bigint,uuid,timestamptz)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_resume_import_session(uuid,text,integer,bigint,bigint,text)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_accept_import_file(uuid,text,integer,bigint,bigint,text,bigint,text)','execute')
  and has_function_privilege('service_role','device_adapter.adapter_finalize_import_session(uuid,text,integer,bigint,bigint,text,bigint)','execute'),
  'service_role receives all and only the exact adapter wrapper entry points');
select ok(
  not has_function_privilege('authenticated','device_adapter.adapter_begin_import_session(uuid,text,integer,bigint,bigint,text,text,text,text,text,integer,bigint,uuid,timestamptz)','execute')
  and not has_function_privilege('anon','device_adapter.adapter_begin_import_session(uuid,text,integer,bigint,bigint,text,text,text,text,text,integer,bigint,uuid,timestamptz)','execute')
  and not has_function_privilege('authenticated','device_adapter.adapter_finalize_import_session(uuid,text,integer,bigint,bigint,text,bigint)','execute')
  and not has_function_privilege('anon','device_adapter.adapter_finalize_import_session(uuid,text,integer,bigint,bigint,text,bigint)','execute'),
  'browser roles cannot execute adapter wrappers');
select ok(not has_function_privilege('service_role','private.issue_device(uuid,text,text,text,text)','execute')
  and not has_function_privilege('service_role','private.authorize_device_token(uuid,text,integer)','execute')
  and not has_function_privilege('service_role','private.begin_import_session(uuid,uuid,uuid,uuid,text,text,text,integer,bigint,uuid,timestamptz)','execute')
  and not has_function_privilege('service_role','private.accept_import_file(uuid,uuid,uuid,uuid)','execute'), 'service_role cannot bypass wrappers through implementation functions');
select ok(not has_function_privilege('anon','private.resolve_device_context(uuid,text,integer,bigint,bigint,text)','execute')
  and not has_function_privilege('authenticated','private.resolve_device_context(uuid,text,integer,bigint,bigint,text)','execute')
  and not has_function_privilege('service_role','private.resolve_device_context(uuid,text,integer,bigint,bigint,text)','execute'), 'internal context resolver is ungranted');
select is((select count(*) from pg_catalog.pg_policies where schemaname='private' and policyname in
  ('devices_owner_select','import_sessions_owner_select','import_file_receipts_owner_select')), 3::bigint, 'three catalog owner-select policies exist');
select ok((select count(*) = 7 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='device_adapter' and p.proname like 'adapter\_%' escape '\' and p.prosecdef
    and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
    and p.proconfig @> array['search_path=""']), 'all seven adapter wrappers are postgres-owned definer functions with empty search_path');
select ok(not has_function_privilege('public','device_adapter.adapter_resume_import_session(uuid,text,integer,bigint,bigint,text)','execute')
  and not has_function_privilege('public','device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamptz,bigint)','execute'), 'PUBLIC receives no adapter execute');
select ok(has_schema_privilege('service_role','device_adapter','usage')
  and not has_schema_privilege('authenticated','device_adapter','usage')
  and not has_schema_privilege('anon','device_adapter','usage')
  and not has_schema_privilege('service_role','private','usage'),
  'service_role reaches only the dedicated adapter schema, never private');

-- Fixtures: two accounts, one importable version/file, six A devices, one B device.
insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values
('00000000-0000-0000-0000-000000000000','a1100000-0000-4110-8110-000000000001','authenticated','authenticated','m211-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','b1100000-0000-4110-8110-000000000002','authenticated','authenticated','m211-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.managed_skills(id,public_id,account_id,display_name) values
('a1100000-0000-4110-8110-000000000011','msk_'||repeat('a',32),'a1100000-0000-4110-8110-000000000001','M211 A');
insert into private.managed_skill_versions(
  id,public_id,account_id,managed_skill_id,manifest_schema_version,manifest_projection,
  manifest_digest,content_digest,canonical_metadata,source,provenance_state,analysis_state
) values (
  'a1100000-0000-4110-8110-000000000101','msv_'||repeat('a',32),
  'a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000011',
  '1.0','{"schema_version":"1.0"}'::bytea,'sha256:'||repeat('1',64),'sha256:'||repeat('2',64),
  '{"logical_id":"m211","display_name":"M211 A"}',
  '{"authority":"managed","kind":"local","namespace":"owner","source_id":"m211","revision":"r1"}',
  'verified','complete');
insert into private.managed_skill_files(
  id,public_id,account_id,managed_skill_id,version_id,relative_path,media_type,
  byte_size,file_digest,storage_key,executable,ordinal
) values (
  'a1100000-0000-4110-8110-000000000201','msf_'||repeat('a',32),
  'a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000011',
  'a1100000-0000-4110-8110-000000000101','SKILL.md','text/markdown',3,
  'sha256:'||repeat('3',64),'m211/a',false,0);

insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values
('a1100000-0000-4110-8110-000000000301','dev_'||repeat('1',32),'a1100000-0000-4110-8110-000000000001','A import','macos','1.0.0','en-US'),
('a1100000-0000-4110-8110-000000000302','dev_'||repeat('2',32),'a1100000-0000-4110-8110-000000000001','A status','linux','1.0.0','en'),
('a1100000-0000-4110-8110-000000000303','dev_'||repeat('3',32),'a1100000-0000-4110-8110-000000000001','A expired token','linux','1.0.0','en'),
('a1100000-0000-4110-8110-000000000304','dev_'||repeat('4',32),'a1100000-0000-4110-8110-000000000001','A replaced token','linux','1.0.0','en'),
('a1100000-0000-4110-8110-000000000305','dev_'||repeat('5',32),'a1100000-0000-4110-8110-000000000001','A revoked token','linux','1.0.0','en'),
('a1100000-0000-4110-8110-000000000306','dev_'||repeat('6',32),'a1100000-0000-4110-8110-000000000001','A issue target','linux','1.0.0','en'),
('b1100000-0000-4110-8110-000000000301','dev_'||repeat('b',32),'b1100000-0000-4110-8110-000000000002','B import','linux','1.0.0','en');

insert into private.device_tokens(id,account_id,device_id,credential_digest,key_version,scopes,issued_at,expires_at,revoked_at,generation) values
('a1100000-0000-4110-8110-000000000401','a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000301','hmac-sha256:'||repeat('a',64),1,array['device.import'],now(),now()+interval '1 day',null,1),
('a1100000-0000-4110-8110-000000000402','a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000302','hmac-sha256:'||repeat('b',64),1,array['device.status'],now(),now()+interval '1 day',null,1),
('a1100000-0000-4110-8110-000000000403','a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000303','hmac-sha256:'||repeat('c',64),1,array['device.import'],now()-interval '2 days',now()-interval '1 day',null,1),
('a1100000-0000-4110-8110-000000000404','a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000304','hmac-sha256:'||repeat('d',64),1,array['device.import'],now()-interval '1 day',now()+interval '1 day',null,1),
('a1100000-0000-4110-8110-000000000405','a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000304','hmac-sha256:'||repeat('e',64),2,array['device.import'],now(),now()+interval '1 day',null,2),
('a1100000-0000-4110-8110-000000000406','a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000305','hmac-sha256:'||repeat('f',64),1,array['device.import'],now()-interval '1 day',now()+interval '1 day',now(),1),
('b1100000-0000-4110-8110-000000000401','b1100000-0000-4110-8110-000000000002','b1100000-0000-4110-8110-000000000301','hmac-sha256:'||repeat('1',64),1,array['device.import'],now(),now()+interval '1 day',null,1);
update private.device_tokens
set replaced_by_token_id='a1100000-0000-4110-8110-000000000405', revoked_at=now()
where id='a1100000-0000-4110-8110-000000000404';

-- 26-33: real authenticated/anon owner surface and A/B isolation.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1100000-0000-4110-8110-000000000001',true);
select is((select count(*) from api.my_devices),6::bigint,'account A sees its six devices');
select is_empty($$select * from api.my_devices where public_id='dev_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'$$,'A cannot enumerate B device');
select lives_ok($$select * from private.register_my_device('A registered','macos','2.0.0','en-US')$$,'A can register bounded device metadata');
reset role;
select ok((select count(*)=1 and bool_and(state='active' and revision=1) from private.devices where account_id='a1100000-0000-4110-8110-000000000001' and display_name='A registered'),'registration creates one active revision-1 owner device');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b1100000-0000-4110-8110-000000000002',true);
select is_empty($$select * from api.my_devices where display_name='A registered'$$,'B cannot see A registered device');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from private.register_my_device('No JWT','linux','1.0.0',null)$$,'42501',null,'missing owner JWT is denied');
reset role;
set local role anon;
select throws_ok($$select * from api.my_devices$$,'42501',null,'anon cannot read device projection');
select throws_ok($$select * from private.rotate_my_device('dev_11111111111111111111111111111111',1)$$,'42501',null,'anon cannot execute owner rotation');
reset role;

-- 34-42: service adapter token lifecycle and context denial matrix.
create temporary table m211_session (
  public_id text not null check (public_id ~ '^imp_[0-9a-f]{32}$')
) on commit drop;
grant select, insert on m211_session to service_role;
create temporary table m211_issue (receipt jsonb not null) on commit drop;
grant select, insert on m211_issue to service_role;
set local role service_role;
select lives_ok($$insert into m211_issue(receipt)
  select device_adapter.adapter_issue_device_token(
  'a1100000-0000-4110-8110-000000000001','dev_66666666666666666666666666666666',
  'hmac-sha256:'||repeat('9',64),1,array['device.import'],now()+interval '1 day',1)$$,'service adapter can issue an exact scoped token');
select ok(position('credential' in (select receipt::text from m211_issue))=0,
  'token issuance receipt contains no credential material');
select throws_ok($$select device_adapter.adapter_issue_device_token(
  'a1100000-0000-4110-8110-000000000001','dev_66666666666666666666666666666666',
  'hmac-sha256:'||repeat('8',64),2,array['device.import'],now()+interval '1 day',1)$$,
  22023,'device token already active','adapter issuance cannot create a second live token family');
select throws_ok($$select device_adapter.adapter_begin_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('b',64),1,1,1,
  'msk_'||repeat('a',32),'msv_'||repeat('a',32),'1.0','sha256:'||repeat('1',64),'sha256:'||repeat('2',64),1,3,
  '21100000-0000-4110-8110-000000000001',now()+interval '2 hours')$$,'42501','device authority unavailable','device.status token cannot import');
select throws_ok($$select device_adapter.adapter_resume_import_session(
  'b1100000-0000-4110-8110-000000000002','hmac-sha256:'||repeat('a',64),1,1,1,'imp_'||repeat('0',32))$$,'42501','device authority unavailable','wrong account binding is denied');
select throws_ok($$select device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,2,1,'imp_'||repeat('0',32))$$,'42501','device authority unavailable','stale device revision is denied');
select throws_ok($$select device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,2,'imp_'||repeat('0',32))$$,'42501','device authority unavailable','stale token generation is denied');
select throws_ok($$select device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('c',64),1,1,1,'imp_'||repeat('0',32))$$,'42501','device authority unavailable','expired token is denied');
select throws_ok($$select device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('d',64),1,1,1,'imp_'||repeat('0',32))$$,'42501','device authority unavailable','replaced token is denied');
select throws_ok($$select device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('f',64),1,1,1,'imp_'||repeat('0',32))$$,'42501','device authority unavailable','revoked token is denied');

-- 43-57: valid import, exact replay/conflict, A/B isolation, replay, expiry, finalize.
select lives_ok($$insert into m211_session(public_id)
  select device_adapter.adapter_begin_import_session(
    'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
    'msk_'||repeat('a',32),'msv_'||repeat('a',32),'1.0','sha256:'||repeat('1',64),'sha256:'||repeat('2',64),1,3,
    '21100000-0000-4110-8110-000000000002',now()+interval '2 hours')$$,
  'valid device begins one grammar-checked public import session');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1100000-0000-4110-8110-000000000001',true);
select is((select count(*) from api.my_import_sessions),1::bigint,'A sees its bounded import session');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b1100000-0000-4110-8110-000000000002',true);
select is_empty($$select * from api.my_import_sessions$$,'B cannot enumerate A import sessions');
reset role;

set local role service_role;
select is(device_adapter.adapter_begin_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  'msk_'||repeat('a',32),'msv_'||repeat('a',32),'1.0','sha256:'||repeat('1',64),'sha256:'||repeat('2',64),1,3,
  '21100000-0000-4110-8110-000000000002',now()+interval '2 hours'),
  (select public_id from m211_session), 'exact begin replay returns the same public session');
select throws_ok($$select device_adapter.adapter_begin_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  'msk_'||repeat('a',32),'msv_'||repeat('a',32),'1.0','sha256:'||repeat('1',64),'sha256:'||repeat('2',64),1,3,
  '21100000-0000-4110-8110-000000000002',now()+interval '3 hours')$$,22023,'conflicting import session idempotency reuse','changed expiry conflicts instead of replaying');
select is((select count(*) from m211_session),1::bigint,'failed/replayed begins leave exactly one captured session');
select is(device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select public_id from m211_session))->>'revision','1','live owner device resumes revision 1');
select is(device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,'imp_'||repeat('0',32)),null::jsonb,'foreign session public id is non-enumerating');
select is(device_adapter.adapter_accept_import_file(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select public_id from m211_session),1,'msf_'||repeat('a',32))->>'revision','2','valid file accept advances session revision');
select throws_ok($$select device_adapter.adapter_accept_import_file(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select public_id from m211_session),2,'msf_'||repeat('a',32))$$,22023,'import file is already accepted','accepted file replay is denied');
select throws_ok($$select device_adapter.adapter_finalize_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select public_id from m211_session),1)$$,'42501','import authority unavailable','stale session revision cannot finalize');
select is(device_adapter.adapter_resume_import_session(
  'b1100000-0000-4110-8110-000000000002','hmac-sha256:'||repeat('1',64),1,1,1,
  (select public_id from m211_session)),null::jsonb,'foreign account/device cannot enumerate owner session');
select is(device_adapter.adapter_finalize_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select public_id from m211_session),2),
  (select public_id from m211_session),'exact accepted session finalizes');
reset role;
select is((select state from private.import_sessions where imp_=(select public_id from m211_session)),'verified','finalized session is verified');
set local role service_role;
select is(device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select public_id from m211_session)),null::jsonb,'terminal session is not resumable');
reset role;

insert into private.import_sessions(
  id,imp_,account_id,device_id,managed_skill_id,version_id,manifest_schema_version,
  manifest_digest,content_digest,expected_file_count,expected_byte_total,idempotency_key,
  state,created_at,updated_at,expiry_at
) values (
  'a1100000-0000-4110-8110-000000000501','imp_'||repeat('e',32),
  'a1100000-0000-4110-8110-000000000001','a1100000-0000-4110-8110-000000000301',
  'a1100000-0000-4110-8110-000000000011','a1100000-0000-4110-8110-000000000101','1.0',
  'sha256:'||repeat('1',64),'sha256:'||repeat('2',64),1,3,'21100000-0000-4110-8110-000000000003',
  'in_progress',now()-interval '2 hours',now()-interval '2 hours',now()-interval '1 hour');
set local role service_role;
select is(device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,'imp_'||repeat('e',32)),null::jsonb,'expired session is not resumable');
reset role;

-- 58-65: owner rotation/revocation, post-change denial, and direct-access probes.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1100000-0000-4110-8110-000000000001',true);
select is((select revision from private.rotate_my_device('dev_'||repeat('1',32),1)),2::bigint,'owner rotation advances device revision');
reset role;
select ok((select revoked_at is not null from private.device_tokens where id='a1100000-0000-4110-8110-000000000401'),'owner rotation revokes the live token family');
set local role service_role;
select throws_ok($$select device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,2,1,'imp_'||repeat('e',32))$$,'42501','device authority unavailable','rotated old token cannot regain authority');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1100000-0000-4110-8110-000000000001',true);
select is((select state from private.revoke_my_device('dev_'||repeat('2',32),1)),'revoked','owner revoke moves device to terminal revoked');
reset role;
select ok((select revision=2 and revoked_at is not null from private.devices where id='a1100000-0000-4110-8110-000000000302'),'owner revoke increments revision and records revocation');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1100000-0000-4110-8110-000000000001',true);
select throws_ok($$update private.devices set state='disabled' where id='a1100000-0000-4110-8110-000000000301'$$,'42501',null,'authenticated direct device DML is denied');
reset role;
set local role service_role;
select throws_ok($$select * from private.device_tokens$$,'42501',null,'service_role direct token listing is denied');
select throws_ok($$select device_adapter.adapter_resume_import_session(
  'a1100000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('b',64),1,2,1,'imp_'||repeat('e',32))$$,'42501','device authority unavailable','revoked owner device remains denied');
reset role;

select * from finish();
rollback;
