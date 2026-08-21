begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;

select plan(15);

select has_table('private', 'import_cutover_consents', 'cutover consent authority table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'private.import_cutover_consents'::regclass),
  'cutover consents force RLS'
);
select ok(
  has_function_privilege('authenticated', 'api.authorize_my_import_cutover(text,bigint,text)', 'execute')
  and not has_function_privilege('anon', 'api.authorize_my_import_cutover(text,bigint,text)', 'execute')
  and not has_function_privilege('service_role', 'api.authorize_my_import_cutover(text,bigint,text)', 'execute')
  and has_function_privilege('service_role', 'device_adapter.adapter_require_import_cutover_consent(text,text,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'device_adapter.adapter_require_import_cutover_consent(text,text,text,bigint)', 'execute'),
  'browser consent and connector enforcement privileges are separated'
);
select ok(
  has_table_privilege('authenticated', 'api.my_import_cutover_consents', 'select')
  and not has_table_privilege('anon', 'api.my_import_cutover_consents', 'select')
  and not has_table_privilege('service_role', 'api.my_import_cutover_consents', 'select'),
  'only authenticated owners can read the safe consent projection'
);

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values
('00000000-0000-0000-0000-000000000000','a4200000-0000-4420-8420-000000000001','authenticated','authenticated','m4-consent-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','b4200000-0000-4420-8420-000000000002','authenticated','authenticated','m4-consent-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale) values
('a4200000-0000-4420-8420-000000000101','dev_'||repeat('8',32),'a4200000-0000-4420-8420-000000000001','Consent connector','macos','1.0.0','en-US');

create temporary table m4_consent_target(response jsonb not null) on commit drop;
create temporary table m4_consent_session(public_id text not null, manifest_digest text not null, revision bigint not null) on commit drop;
create temporary table m4_consent_receipt(response jsonb not null) on commit drop;
grant select, insert on m4_consent_target, m4_consent_session to service_role;
grant select on m4_consent_session to authenticated;
grant select, insert on m4_consent_receipt to authenticated;
grant select on m4_consent_receipt to service_role;

set local role service_role;
insert into m4_consent_target(response)
select device_adapter.adapter_prepare_import_target(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  'Consent Alpha','Consent fixture','1.0',
  pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),
  'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('{"schema_version":"1.0"}','UTF8'),'sha256'),'hex'),
  'sha256:'||repeat('5',64),
  '{"logical_id":"consent-alpha","display_name":"Consent Alpha","description":"Consent fixture"}',
  '{"authority":"local-owner","kind":"skill-directory","namespace":"skillmap","source_id":"consent-alpha","revision":"r1"}',
  'verified',
  '[{"relative_path":"SKILL.md","media_type":"text/markdown","byte_size":3,"file_digest":"sha256:6666666666666666666666666666666666666666666666666666666666666666","executable":false,"ordinal":0}]',
  'a4200000-0000-4420-8420-000000000301'
);
insert into m4_consent_session(public_id, manifest_digest, revision)
select response->>'session_id', (select response->>'manifest_digest' from m4_consent_target), (response->>'revision')::bigint
from (
  select device_adapter.adapter_begin_import_session_v2(
    'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
    (select response->>'skill_public_id' from m4_consent_target),
    (select response->>'version_public_id' from m4_consent_target),
    '1.0',(select response->>'manifest_digest' from m4_consent_target),
    (select response->>'content_digest' from m4_consent_target),
    1,3,'a4200000-0000-4420-8420-000000000302',
    pg_catalog.statement_timestamp() + interval '30 minutes'
  ) as response
) as started;

select throws_ok($$select device_adapter.adapter_require_import_cutover_consent(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  (select public_id from m4_consent_session),1
)$$, '42501', 'import cutover consent required', 'connector cannot finalize before owner consent');
reset role;

update private.import_sessions
set accepted_file_count=expected_file_count, accepted_byte_total=expected_byte_total
where imp_=(select public_id from m4_consent_session);
update m4_consent_session as fixture
set revision=sessions.revision
from private.import_sessions as sessions
where sessions.imp_=fixture.public_id;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4200000-0000-4420-8420-000000000001","is_anonymous":true}', true);
set local role authenticated;
select throws_ok($$select api.authorize_my_import_cutover(
  (select public_id from m4_consent_session),(select revision from m4_consent_session),(select manifest_digest from m4_consent_session)
)$$, '22023', 'invalid import cutover consent', 'anonymous Auth user cannot authorize cutover');
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a4200000-0000-4420-8420-000000000001","is_anonymous":false}', true);
set local role authenticated;
select lives_ok($$insert into m4_consent_receipt(response)
  select api.authorize_my_import_cutover(
    (select public_id from m4_consent_session),(select revision from m4_consent_session),(select manifest_digest from m4_consent_session)
  )$$, 'owner can authorize an exact complete import revision');
select ok(
  (select response ?& array['owner_consent_id','session_public_id','revision','manifest_digest','consent_digest','explicit_consent_at','consent_expires_at']
     and response->>'owner_consent_id' ~ '^icn_[0-9a-f]{32}$'
     and response->>'consent_digest' ~ '^sha256:[0-9a-f]{64}$'
   from m4_consent_receipt),
  'consent receipt is a closed public binding'
);
select ok(
  (select (response->>'consent_expires_at')::timestamptz > (response->>'explicit_consent_at')::timestamptz
     and (response->>'consent_expires_at')::timestamptz <= (response->>'explicit_consent_at')::timestamptz + interval '10 minutes'
   from m4_consent_receipt),
  'consent receipt is short lived'
);
select is(
  api.authorize_my_import_cutover(
    (select public_id from m4_consent_session),(select revision from m4_consent_session),(select manifest_digest from m4_consent_session)
  ),
  (select response from m4_consent_receipt),
  'exact owner consent replay is idempotent'
);
select is((select count(*) from api.my_import_cutover_consents),1::bigint,'owner sees one active safe consent row');
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"b4200000-0000-4420-8420-000000000002","is_anonymous":false}', true);
set local role authenticated;
select is((select count(*) from api.my_import_cutover_consents),0::bigint,'another account cannot see owner consent');
reset role;

set local role service_role;
select ok(
  device_adapter.adapter_require_import_cutover_consent(
    'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
    (select public_id from m4_consent_session),(select revision from m4_consent_session)
  ) @> (select response - array['session_public_id','revision','manifest_digest'] from m4_consent_receipt),
  'connector receives the exact active owner consent binding'
);
reset role;

update private.import_cutover_consents set revoked_at=pg_catalog.statement_timestamp();
set local role service_role;
select throws_ok($$select device_adapter.adapter_require_import_cutover_consent(
  'acct_a4200000000044208420000000000001','dev_'||repeat('8',32),
  (select public_id from m4_consent_session),(select revision from m4_consent_session)
)$$, '42501', 'import cutover consent required', 'revoked consent cannot authorize finalization');
reset role;

set local role anon;
select throws_ok($$select * from api.my_import_cutover_consents$$, '42501', null, 'anonymous role cannot select consent projection');
reset role;

select * from finish();
rollback;
