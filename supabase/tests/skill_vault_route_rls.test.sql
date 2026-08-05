begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

-- ============================================================================
-- M2.12 pgTAP: route-decision / correction RLS.
-- Two accounts (A,B), two A devices, anon; connector (service_role) + owner
-- (authenticated) surfaces; idempotent replay; stale/foreign/disabled/expired
-- authority denial; correction bounds; direct-DML denial; forced RLS + exact
-- grants + privacy canaries. Service_role never reaches `private`; private-row
-- assertions run under postgres after each connector call (M2.11 temp pattern).
-- ============================================================================
select plan(65);

-- 01-03 FORCE RLS -----------------------------------------------
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.route_decisions'::regclass), 'route_decisions FORCE RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.route_decision_selections'::regclass), 'route_decision_selections FORCE RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.route_corrections'::regclass), 'route_corrections FORCE RLS');

-- 04-06 zero base grants ----------------------------------------
select ok(
  not has_table_privilege('anon','private.route_decisions','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.route_decisions','select,insert,update,delete')
  and not has_table_privilege('service_role','private.route_decisions','select,insert,update,delete'),
  'route_decisions have zero application-role base grants');
select ok(
  not has_table_privilege('anon','private.route_decision_selections','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.route_decision_selections','select,insert,update,delete')
  and not has_table_privilege('service_role','private.route_decision_selections','select,insert,update,delete'),
  'route_decision_selections have zero application-role base grants');
select ok(
  not has_table_privilege('anon','private.route_corrections','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.route_corrections','select,insert,update,delete')
  and not has_table_privilege('service_role','private.route_corrections','select,insert,update,delete'),
  'route_corrections have zero application-role base grants');

-- 07-10 schema / view inventory
select has_schema('route_adapter','route_adapter schema exists');
select has_view('api','my_route_decisions','owner decision view exists');
select has_view('api','my_route_selections','owner selection view exists');
select has_view('api','my_route_corrections','owner correction view exists');

-- 11 service_role receives all three adapter entry points -------------
select ok(
  has_function_privilege('service_role','route_adapter.adapter_record_route_decision(uuid,text,integer,bigint,bigint,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute')
  and has_function_privilege('service_role','route_adapter.adapter_read_route_decision(uuid,text,integer,bigint,bigint,text)','execute')
  and has_function_privilege('service_role','route_adapter.adapter_record_route_correction(uuid,text,integer,bigint,bigint,text,text,text,text,text,uuid,timestamp with time zone)','execute'),
  'service_role receives all three route adapter entry points');

-- 12 browser roles cannot execute adapter wrappers; service_role only reaches adapter schema.
select ok(
  not has_function_privilege('authenticated','route_adapter.adapter_record_route_decision(uuid,text,integer,bigint,bigint,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute')
  and not has_function_privilege('anon','route_adapter.adapter_record_route_decision(uuid,text,integer,bigint,bigint,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute')
  and not has_function_privilege('authenticated','route_adapter.adapter_read_route_decision(uuid,text,integer,bigint,bigint,text)','execute')
  and not has_function_privilege('anon','route_adapter.adapter_read_route_decision(uuid,text,integer,bigint,bigint,text)','execute')
  and has_schema_privilege('service_role','route_adapter','usage')
  and not has_schema_privilege('authenticated','route_adapter','usage')
  and not has_schema_privilege('anon','route_adapter','usage'),
  'adapter wrappers are service_role-only; browser roles get no access');

-- 13 private record functions ungranted to every application role
select ok(
  not has_function_privilege('authenticated','private.record_route_decision(uuid,uuid,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute')
  and not has_function_privilege('service_role','private.record_route_decision(uuid,uuid,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute')
  and not has_function_privilege('anon','private.record_route_decision(uuid,uuid,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute'),
  'no role bypasses the adapter through the private record function');

-- 14 owner projections are authenticated-only -------------------------
select ok(
  has_function_privilege('authenticated','private.my_route_decisions()','execute')
  and has_function_privilege('authenticated','private.my_route_corrections()','execute')
  and has_table_privilege('authenticated','api.my_route_decisions','select')
  and not has_table_privilege('anon','api.my_route_decisions','select')
  and not has_table_privilege('service_role','api.my_route_decisions','select'),
  'owner projections are authenticated-only');

-- 15-16 privacy: projections expose no raw/carrier/internal column --------
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema='api' and table_name in ('my_route_decisions','my_route_selections','my_route_corrections')
    and column_name ~* 'prompt|context|body|text|embed|token|credential|raw|storage|provider|account_id|device_id|managed_skill_id|version_id|release_id'
), 'owner projections expose no raw/carrier/internal id');
select ok((select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_catalog.pg_class where oid='api.my_route_decisions'::regclass)
  and (select reloptions @> array['security_invoker=true','security_barrier=true'] from pg_catalog.pg_class where oid='api.my_route_corrections'::regclass),
  'owner views are invoker+barrier');

select is(
  (select count(*)::int from pg_catalog.pg_policies
   where schemaname = 'private'
     and tablename in ('route_decisions','route_decision_selections','route_corrections')),
  6,
  'exact owner and definer SELECT policies exist on all route tables');
select ok(
  has_table_privilege('skillmap_vault_definer','private.route_decisions','select')
  and has_table_privilege('skillmap_vault_definer','private.route_decision_selections','select')
  and has_table_privilege('skillmap_vault_definer','private.route_corrections','select')
  and not has_table_privilege('skillmap_vault_definer','private.route_decisions','insert,update,delete'),
  'dashboard definer has owner-scoped SELECT and no route-table writes');
select ok(
  not has_schema_privilege('service_role','private','usage'),
  'service_role still has no private schema usage');
select ok(
  has_function_privilege('authenticated','private.submit_my_route_correction(text,text,text,text,text,uuid,timestamp with time zone)','execute')
  and not has_function_privilege('anon','private.submit_my_route_correction(text,text,text,text,text,uuid,timestamp with time zone)','execute')
  and not has_function_privilege('service_role','private.submit_my_route_correction(text,text,text,text,text,uuid,timestamp with time zone)','execute'),
  'dashboard correction command is authenticated-only');
select ok(not exists (
  select 1
  from information_schema.parameters
  where specific_schema in ('route_adapter','private')
    and (specific_name like 'adapter_%' or specific_name like 'submit_my_route_correction%')
    and parameter_name ~* 'prompt|context|body|raw|embed|provider'
), 'reachable route functions accept no raw prompt/body/context carrier');

-- ============================================================================
-- Fixtures: two accounts, current + disabled releases, devices, live route tokens.
-- ============================================================================
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token) values
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-4110-8110-000000000001','authenticated','authenticated','m212-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','b2000000-0000-4220-8220-000000000002','authenticated','authenticated','m212-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.managed_skills (id,public_id,account_id,display_name) values
  ('a1000000-0000-4110-8110-000000000011','msk_'||repeat('a',32),'a1000000-0000-4110-8110-000000000001','M212A1'),
  ('a1000000-0000-4110-8110-000000000012','msk_'||repeat('b',32),'a1000000-0000-4110-8110-000000000001','M212A2'),
  ('b2000000-0000-4220-8220-000000000041','msk_'||repeat('9',32),'b2000000-0000-4220-8220-000000000002','M212B1'),
  ('b2000000-0000-4220-8220-000000000042','msk_'||repeat('8',32),'b2000000-0000-4220-8220-000000000002','M212B2');

insert into private.managed_skill_versions (id,public_id,account_id,managed_skill_id,manifest_schema_version,manifest_projection,manifest_digest,content_digest,canonical_metadata,source,provenance_state,analysis_state) values
  ('a1000000-0000-4110-8110-000000000101','msv_'||repeat('1',32),'a1000000-0000-4110-8110-000000000001','a1000000-0000-4110-8110-000000000011','1.0','{x}'::bytea,'sha256:'||repeat('1',64),'sha256:'||repeat('1',64),'{"logical_id":"a","display_name":"A1"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"a","revision":"r1"}'::jsonb,'verified','complete'),
  ('a1000000-0000-4110-8110-000000000103','msv_'||repeat('3',32),'a1000000-0000-4110-8110-000000000001','a1000000-0000-4110-8110-000000000012','1.0','{x}'::bytea,'sha256:'||repeat('3',64),'sha256:'||repeat('3',64),'{"logical_id":"b","display_name":"A2"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"b","revision":"r1"}'::jsonb,'verified','complete'),
  ('b2000000-0000-4220-8220-000000000101','msv_'||repeat('4',32),'b2000000-0000-4220-8220-000000000002','b2000000-0000-4220-8220-000000000041','1.0','{x}'::bytea,'sha256:'||repeat('4',64),'sha256:'||repeat('4',64),'{"logical_id":"c","display_name":"B1"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"c","revision":"r1"}'::jsonb,'verified','complete'),
  ('b2000000-0000-4220-8220-000000000102','msv_'||repeat('a',32),'b2000000-0000-4220-8220-000000000002','b2000000-0000-4220-8220-000000000042','1.0','{x}'::bytea,'sha256:'||repeat('8',64),'sha256:'||repeat('8',64),'{"logical_id":"d","display_name":"B2"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"d","revision":"r1"}'::jsonb,'verified','complete');

insert into private.managed_skill_releases (id,public_id,account_id,managed_skill_id,version_id,lifecycle_state,eligibility_reasons,activated_at,revoked_at) values
  ('a1000000-0000-4110-8110-000000000201','msr_'||repeat('1',32),'a1000000-0000-4110-8110-000000000001','a1000000-0000-4110-8110-000000000011','a1000000-0000-4110-8110-000000000101','active','{}',now(),null),
  ('a1000000-0000-4110-8110-000000000202','msr_'||repeat('2',32),'a1000000-0000-4110-8110-000000000001','a1000000-0000-4110-8110-000000000012','a1000000-0000-4110-8110-000000000103','active','{}',now(),null),
  ('b2000000-0000-4220-8220-000000000201','msr_'||repeat('7',32),'b2000000-0000-4220-8220-000000000002','b2000000-0000-4220-8220-000000000041','b2000000-0000-4220-8220-000000000101','active','{}',now(),null),
  ('b2000000-0000-4220-8220-000000000202','msr_'||repeat('6',32),'b2000000-0000-4220-8220-000000000002','b2000000-0000-4220-8220-000000000042','b2000000-0000-4220-8220-000000000102','disabled','{}',null,null);

-- The active pointer, not lifecycle_state alone, is authoritative.
update private.managed_skills
set active_release_id = case id
  when 'a1000000-0000-4110-8110-000000000011'::uuid then 'a1000000-0000-4110-8110-000000000201'::uuid
  when 'a1000000-0000-4110-8110-000000000012'::uuid then 'a1000000-0000-4110-8110-000000000202'::uuid
  when 'b2000000-0000-4220-8220-000000000041'::uuid then 'b2000000-0000-4220-8220-000000000201'::uuid
  else active_release_id
end,
activation_revision = activation_revision + 1
where id in (
  'a1000000-0000-4110-8110-000000000011'::uuid,
  'a1000000-0000-4110-8110-000000000012'::uuid,
  'b2000000-0000-4220-8220-000000000041'::uuid
);

insert into private.devices (id,public_id,account_id,display_name,platform,connector_version,locale) values
  ('a1000000-0000-4110-8110-000000000301','dev_'||repeat('1',32),'a1000000-0000-4110-8110-000000000001','A route','macos','1.0.0','en-US'),
  ('a1000000-0000-4110-8110-000000000302','dev_'||repeat('2',32),'a1000000-0000-4110-8110-000000000001','A feedback','linux','1.0.0','en'),
  ('a1000000-0000-4110-8110-000000000303','dev_'||repeat('4',32),'a1000000-0000-4110-8110-000000000001','A expired token','linux','1.0.0','en'),
  ('b2000000-0000-4220-8220-000000000301','dev_'||repeat('3',32),'b2000000-0000-4220-8220-000000000002','B','linux','1.0.0','en');

insert into private.device_tokens (id,account_id,device_id,credential_digest,key_version,scopes,issued_at,expires_at,revoked_at,generation) values
  ('a1000000-0000-4110-8110-000000000401','a1000000-0000-4110-8110-000000000001','a1000000-0000-4110-8110-000000000301','hmac-sha256:'||repeat('a',64),1,array['device.route','device.feedback'],now(),now()+interval '1 day',null,1),
  ('a1000000-0000-4110-8110-000000000402','a1000000-0000-4110-8110-000000000001','a1000000-0000-4110-8110-000000000302','hmac-sha256:'||repeat('b',64),1,array['device.feedback'],now(),now()+interval '1 day',null,1),
  ('a1000000-0000-4110-8110-000000000403','a1000000-0000-4110-8110-000000000001','a1000000-0000-4110-8110-000000000303','hmac-sha256:'||repeat('4',64),1,array['device.route'],now()-interval '2 days',now()-interval '1 day',null,1),
  ('b2000000-0000-4220-8220-000000000401','b2000000-0000-4220-8220-000000000002','b2000000-0000-4220-8220-000000000301','hmac-sha256:'||repeat('3',64),1,array['device.route','device.feedback'],now(),now()+interval '1 day',null,1);

-- temp container for the captured public decision/correction ids.
create temp table m212_rtd (rtd text) on commit drop;
grant select, insert on m212_rtd to service_role;
create temp table m212_no_match_rtd (rtd text) on commit drop;
grant select, insert on m212_no_match_rtd to service_role, authenticated;
create temp table m212_rtc (rtc text) on commit drop;
grant select, insert on m212_rtc to service_role;

-- ============================================================================
-- 17..22  CONNECTOR decision happy path + exact replay + conflict.
-- ============================================================================
set local role service_role;
select lives_ok($$insert into m212_rtd(rtd)
  select route_adapter.adapter_record_route_decision(
    'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
    '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
    'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
    'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
    1000,24,4,5,12,
    '[{"managed_skill_id":"a1000000-0000-4110-8110-000000000011","version_id":"a1000000-0000-4110-8110-000000000101","release_id":"a1000000-0000-4110-8110-000000000201","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.93,"reason_codes":["prompt_intent_match"]}]'::jsonb) ->> 'decision_id'$$,
  'A route device records one valid decision');
reset role;
select is((select count(*)::int from private.route_decisions),1,'exactly one decision row');

-- exact replay returns the same decision id.
set local role service_role;
select is(
  route_adapter.adapter_record_route_decision(
    'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
    '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
    'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
    'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
    1000,24,4,5,12,null) ->> 'decision_id',
  (select rtd from m212_rtd),
  'exact replay returns the same decision id');
reset role;

-- changed fingerprint is a conflict.
set local role service_role;
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  '70000000-0000-4000-8000-111111111111','sha256:'||repeat('b',64),
  'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,24,4,5,12,null)$$,22023,'idempotency conflict for this account route request','changed fingerprint conflicts');
reset role;
set local role service_role;
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
  'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_CHANGED','eligibility_rev_31','audience_rev_08',
  1000,24,4,5,12,null)$$,22023,'idempotency conflict for this account route request','changed binding revision conflicts');
reset role;
select is((select count(*)::int from private.route_decisions),1,'conflict leaves the single decision row');

-- a fresh request records (second decision).
set local role service_role;
select lives_ok($$insert into m212_no_match_rtd(rtd)
  select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  '70000000-0000-4000-8000-999999999999','sha256:'||repeat('c',64),
  'no_match',0.89,'["below_confidence_threshold"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,null) ->> 'decision_id'$$,'a fresh no-match request from the same device records');
reset role;
select is((select count(*)::int from private.route_decisions),2,'two decisions after two distinct requests');

-- ============================================================================
-- 22..31  stale/foreign/disabled/revoked authority denial matrix.
-- ============================================================================
set local role service_role;
-- wrong credential digest
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('x',64),1,1,1,
  '70000000-0000-4000-8000-333333333333','sha256:'||repeat('d',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a1000000-0000-4110-8110-000000000011","version_id":"a1000000-0000-4110-8110-000000000101","release_id":"a1000000-0000-4110-8110-000000000201","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,'42501','device authority unavailable','foreign credential denied');
-- stale device revision
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,2,1,
  '70000000-0000-4000-8000-333333333333','sha256:'||repeat('e',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,null)$$,'42501','device authority unavailable','stale device revision denied');
-- wrong account binding (B token cannot route into A account)
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'b2000000-0000-4220-8220-000000000002','hmac-sha256:'||repeat('a',64),1,1,1,
  '70000000-0000-4000-8000-333333333333','sha256:'||repeat('e',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,null)$$,'42501','device authority unavailable','account/digest mismatch denied');
-- disabled/revoked foreign release cannot route (stale authority)
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'b2000000-0000-4220-8220-000000000002','hmac-sha256:'||repeat('3',64),1,1,1,
  '70000000-0000-4000-8000-555555555555','sha256:'||repeat('f',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"b2000000-0000-4220-8220-000000000042","version_id":"b2000000-0000-4220-8220-000000000102","release_id":"b2000000-0000-4220-8220-000000000202","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,'42501','routing authority unavailable','disabled/revoked release cannot route');
-- foreign/never-owned release tuple cannot route (no foreign disclosure)
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  '70000000-0000-4000-8000-555555666666','sha256:'||repeat('9',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"b2000000-0000-4220-8220-000000000041","version_id":"b2000000-0000-4220-8220-000000000101","release_id":"b2000000-0000-4220-8220-000000000201","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,'42501','routing authority unavailable','foreign/never-owned release cannot route');
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('4',64),1,1,1,
  '70000000-0000-4000-8000-777777777777','sha256:'||repeat('7',64),
  'no_match',0.8,'["below_confidence_threshold"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,null)$$,'42501','device authority unavailable','expired token denies routing');
reset role;
update auth.users
set banned_until = now() + interval '1 day'
where id = 'a1000000-0000-4110-8110-000000000001';
set local role service_role;
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
  'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,24,4,5,12,null)$$,'42501','routing authority unavailable','banned account denies replay before disclosure');
reset role;
update auth.users
set banned_until = null
where id = 'a1000000-0000-4110-8110-000000000001';
-- expired decision cannot be replayed (age the row under postgres first, then retry).
---- (disable immutability trigger to model an already-restored aged row)
-- captured for later; do the read-face tests next.

-- ============================================================================
-- 32..35  read face: same device may read; foreign / nonexistent returns NULL.
-- ============================================================================
set local role service_role;
select is(
  route_adapter.adapter_read_route_decision(
    'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
    (select rtd from m212_rtd limit 1)) ->> 'result_type',
  'ranked_candidates','owning device reads its decision back');
select is(
  route_adapter.adapter_read_route_decision(
    'b2000000-0000-4220-8220-000000000002','hmac-sha256:'||repeat('3',64),1,1,1,
    (select rtd from m212_rtd limit 1)),
  null::jsonb,'foreign device cannot read a decision');
select is(
  route_adapter.adapter_read_route_decision(
    'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,'rtd_'||repeat('0',32)),
  null::jsonb,'nonexistent rtd is non-enumerating');

-- ============================================================================
-- 32..35  connector correction bounds.
-- ============================================================================
select lives_ok($$insert into m212_rtc(rtc)
  select route_adapter.adapter_record_route_correction(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select rtd from m212_rtd limit 1),'correct',NULL,NULL,NULL,
  'c0000000-0000-4000-8000-000000000001',NULL) ->> 'correction_id'$$,'same durable device records one bounded correction');
reset role;
select is((select count(*)::int from private.route_corrections),1,'exactly one correction row');
set local role service_role;
select is(route_adapter.adapter_record_route_correction(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select rtd from m212_rtd limit 1),'correct',NULL,NULL,NULL,
  'c0000000-0000-4000-8000-000000000001',NULL) ->> 'correction_id',
  (select rtc from m212_rtc),
  'exact correction replay returns the same bounded receipt');
reset role;
select is((select count(*)::int from private.route_corrections),1,'exact correction replay adds no row');
set local role service_role;
-- foreign account cannot correct a decision they do not own.
select throws_ok($$select route_adapter.adapter_record_route_correction(
  'b2000000-0000-4220-8220-000000000002','hmac-sha256:'||repeat('3',64),1,1,1,
  (select rtd from m212_rtd limit 1),'wrong',
  NULL,NULL,NULL,'c0000000-0000-4000-8000-000000000002',NULL)$$,'42501','routing authority unavailable','foreign account cannot correct');
-- second correction on the taken slot is blocked (one slot per decision).
select throws_ok($$select route_adapter.adapter_record_route_correction(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select rtd from m212_rtd limit 1),'unnecessary',NULL,NULL,NULL,
  'c0000000-0000-4000-8000-000000000003',NULL)$$,23505,null,'second correction slot blocked by uniqueness');
reset role;

-- ============================================================================
-- 36..42  direct-DML denial + row survival.
-- ============================================================================
select throws_ok($$UPDATE private.route_decisions SET result_type='avoid'$$,'22023','route decision rows are immutable','direct UPDATE decision rejected');
select throws_ok($$DELETE FROM private.route_decisions$$,'22023','route decision rows are immutable','direct DELETE decision rejected');
select throws_ok($$UPDATE private.route_decision_selections SET ordinal=99$$,'22023','route decision lineage rows are immutable','direct lineage UPDATE rejected');
select throws_ok($$DELETE FROM private.route_decision_selections$$,'22023','route decision lineage rows are immutable','direct lineage DELETE rejected');
select throws_ok($$UPDATE private.route_corrections SET outcome='missed'$$,'22023','route correction rows are immutable','direct correction UPDATE rejected');
select throws_ok($$DELETE FROM private.route_corrections$$,'22023','route correction rows are immutable','direct correction DELETE rejected');
select ok((select count(*)::int from private.route_decisions)>0,'decision rows survive');

-- ============================================================================
-- 43..46 anon + dashboard owner surface.
-- ============================================================================
set role anon;
select throws_ok($$select * from api.my_route_decisions$$,'42501',null,'anon cannot read decision projection');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4110-8110-000000000001',true);
select is((select count(*) from api.my_route_decisions),2::bigint,'A sees its two decisions in history');
select is((select count(*) from api.my_route_corrections),1::bigint,'A sees its one correction');
select lives_ok($$select private.submit_my_route_correction(
  (select rtd from m212_no_match_rtd),
  'correct',NULL,NULL,NULL,'c0000000-0000-4000-8000-000000000004',NULL
)$$,'dashboard owner records a bounded correction without account/device input');
select is((select count(*) from api.my_route_corrections),2::bigint,'dashboard correction is visible in bounded owner history');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','b2000000-0000-4220-8220-000000000002',true);
select is_empty($$select * from api.my_route_decisions$$,'B cannot enumerate A decisions');
reset role;

-- Stored authority is revalidated for replay, read, correction, and dashboard
-- visibility. Caller-supplied replay selections are intentionally NULL.
update private.managed_skills
set active_release_id = null,
    activation_revision = activation_revision + 1
where id = 'a1000000-0000-4110-8110-000000000011';
set local role service_role;
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
  'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,24,4,5,12,null)$$,'42501','routing authority unavailable','active-release pointer mismatch denies exact replay');
reset role;

update private.managed_skill_releases
set lifecycle_state = 'disabled'
where id = 'a1000000-0000-4110-8110-000000000201';
set local role service_role;
select throws_ok($$select route_adapter.adapter_record_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
  'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,24,4,5,12,null)$$,'42501','routing authority unavailable','disabled stored release denies exact replay');
select throws_ok($$select route_adapter.adapter_read_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select rtd from m212_rtd limit 1))$$,'42501','routing authority unavailable','disabled stored release denies read');
select throws_ok($$select route_adapter.adapter_record_route_correction(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select rtd from m212_rtd limit 1),'correct',NULL,NULL,NULL,
  'c0000000-0000-4000-8000-000000000005',NULL)$$,'42501','routing authority unavailable','disabled stored release denies correction');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','a1000000-0000-4110-8110-000000000001',true);
select is((select count(*) from api.my_route_decisions),1::bigint,'dashboard hides decisions whose stored authority is stale');
reset role;

alter table private.route_decisions disable trigger trg_route_decisions_immutable;
update private.route_decisions
set created_at = now() - interval '31 days',
    replay_guaranteed_until = now() - interval '30 days',
    decision_expiry_at = now() - interval '1 day'
where request_id = '70000000-0000-4000-8000-999999999999';
alter table private.route_decisions enable trigger trg_route_decisions_immutable;
set local role service_role;
select throws_ok($$select route_adapter.adapter_read_route_decision(
  'a1000000-0000-4110-8110-000000000001','hmac-sha256:'||repeat('a',64),1,1,1,
  (select rtd from m212_no_match_rtd))$$,
  '42501','routing authority unavailable','expired decision authority denies read');
reset role;

-- ============================================================================
-- 47..50 privacy canary + final.
-- ============================================================================
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema='private' and table_name in ('route_decisions','route_decision_selections','route_corrections')
    and column_name ~* 'prompt|context|body|text|embed|storage|provider|response'
), 'canary: no raw prompt/body/context column');
reset role;

select * from finish();
rollback;
