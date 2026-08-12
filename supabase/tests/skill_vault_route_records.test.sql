begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(74);

-- ============================================================================
-- 1. Schema / privilege posture.
-- ============================================================================
select has_table('private', 'route_decisions', 'route_decisions exists');
select has_table('private', 'route_decision_selections', 'route_decision_selections exists');
select has_table('private', 'route_corrections', 'route_corrections exists');
select has_function('private', 'record_route_decision',
  array['uuid','uuid','text','text','text','numeric','jsonb','text','text','text','text','text','integer','integer','integer','integer','integer','jsonb'],
  'record_route_decision exists');
select has_function('private', 'record_route_correction',
  array['uuid','uuid','uuid','text','uuid','uuid','uuid','uuid','timestamp with time zone'],
  'record_route_correction exists');
select is((select count(*)::integer from pg_catalog.pg_constraint where conname='route_decisions_idempotency_key' and conrelid='private.route_decisions'::regclass), 1, 'account-scoped idempotency key exists');

-- RLS enable + force on all three M2.09 tables.
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.route_decisions'::regclass), 'route_decisions RLS forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.route_decision_selections'::regclass), 'route_decision_selections RLS forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='private.route_corrections'::regclass), 'route_corrections RLS forced');

-- M2.12 adds exactly one inert browser-owner SELECT policy and one NOLOGIN
-- dashboard-definer SELECT policy per table; direct application grants stay zero.
select is((select count(*)::integer from pg_catalog.pg_policies where schemaname='private' and tablename='route_decisions'), 2, 'route_decisions exact M2.12 policy posture');
select is((select count(*)::integer from pg_catalog.pg_policies where schemaname='private' and tablename='route_decision_selections'), 2, 'route_decision_selections exact M2.12 policy posture');
select is((select count(*)::integer from pg_catalog.pg_policies where schemaname='private' and tablename='route_corrections'), 2, 'route_corrections exact M2.12 policy posture');

-- No direct table privileges for anon/authenticated/service_role on all three.
select ok(
  not has_table_privilege('anon','private.route_decisions','select')
  and not has_table_privilege('authenticated','private.route_decisions','select')
  and not has_table_privilege('service_role','private.route_decisions','insert')
  and not has_table_privilege('anon','private.route_decision_selections','select')
  and not has_table_privilege('authenticated','private.route_decision_selections','update')
  and not has_table_privilege('service_role','private.route_decision_selections','delete')
  and not has_table_privilege('anon','private.route_corrections','select')
  and not has_table_privilege('authenticated','private.route_corrections','insert')
  and not has_table_privilege('service_role','private.route_corrections','update'),
  'no direct table privileges on the three route tables');

-- No execute privileges for the two record functions + helpers.
select ok(
  not has_function_privilege('anon','private.record_route_decision(uuid,uuid,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute')
  and not has_function_privilege('authenticated','private.record_route_decision(uuid,uuid,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute')
  and not has_function_privilege('service_role','private.record_route_decision(uuid,uuid,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)','execute')
  and not has_function_privilege('anon','private.record_route_correction(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,timestamp with time zone)','execute')
  and not has_function_privilege('authenticated','private.record_route_correction(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,timestamp with time zone)','execute')
  and not has_function_privilege('service_role','private.record_route_correction(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,timestamp with time zone)','execute')
  and not has_function_privilege('anon','private.normalize_reason_codes(jsonb)','execute')
  and not has_function_privilege('service_role','private.reason_codes_are_canonical(jsonb)','execute'),
  'application roles cannot execute private record functions or helpers');

-- Privacy canary A: no forbidden semantic column names across the three tables.
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema='private'
    and table_name in ('route_decisions','route_decision_selections','route_corrections')
    and column_name ~* 'prompt|context|body|text|embed|rank.*input|token|secret|credential|raw|storage|path|response|provider|payload'
), 'canary A: no forbidden semantic column name');

-- Privacy canary B: no wide text/binary/xml carrier column can hold raw content.
-- A raw prompt/body/content carrier would need bytea, xml, or a wide free-text
-- character column. The only text columns permitted are the closed opaque-id /
-- closed-code fields (request_id, request_fingerprint, the five revisions,
-- rtd_/rtc_, and closed vocabularies); every other text/bytea/xml column is a
-- forbidden carrier.
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema='private'
    and table_name in ('route_decisions','route_decision_selections','route_corrections')
    and data_type in ('bytea','xml')
), 'canary B: no bytea/xml carrier column');
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema='private'
    and table_name in ('route_decisions','route_decision_selections','route_corrections')
    and data_type='text'
    and column_name not in (
      'request_id','request_fingerprint','result_type',
      'account_revision','device_auth_binding_revision','routing_policy_revision',
      'eligibility_revision','audience_revision','rtd_','rtc_','row_kind','role',
      'outcome'
    )
), 'canary B: no unauthorized free-text carrier column');
select is((
  select count(*)::integer
  from information_schema.columns
  where table_schema = 'private'
    and table_name = 'route_corrections'
    and column_name in ('alt_managed_skill_id', 'alt_version_id', 'alt_release_id')
    and data_type = 'uuid'
), 3, 'canary C: all alternative-lineage references are UUID columns');

-- ============================================================================
-- 2. Fixtures.
-- ============================================================================
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token) values
  ('00000000-0000-0000-0000-000000000000','a8000000-0000-4800-8800-000000000001','authenticated','authenticated','a@x.in','',now(),'{}','{}',now(),now(),'','','',''),
  ('00000000-0000-0000-0000-000000000000','b8000000-0000-4800-8800-000000000002','authenticated','authenticated','b@x.in','',now(),'{}','{}',now(),now(),'','','','');

insert into private.managed_skills (id, public_id, account_id, display_name) values
  ('a8000000-0000-4800-8800-000000000011','msk_'||repeat('1',32),'a8000000-0000-4800-8800-000000000001','Alpha'),
  ('a8000000-0000-4800-8800-000000000012','msk_'||repeat('2',32),'a8000000-0000-4800-8800-000000000001','Beta'),
  ('a8000000-0000-4800-8800-000000000013','msk_'||repeat('3',32),'a8000000-0000-4800-8800-000000000001','Gamma'),
  ('b8000000-0000-4800-8800-000000000021','msk_'||repeat('7',32),'b8000000-0000-4800-8800-000000000002','Foreign');

insert into private.managed_skill_versions (id, public_id, account_id, managed_skill_id, manifest_schema_version, manifest_projection, manifest_digest, content_digest, canonical_metadata, source, provenance_state, analysis_state) values
  ('a1000000-0000-4000-8000-000000000001','msv_'||repeat('a',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000011','1.0','{x}'::bytea,'sha256:'||repeat('1',64),'sha256:'||repeat('a',64),'{"logical_id":"a","display_name":"A"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"a","revision":"r1"}'::jsonb,'verified','complete'),
  ('a2000000-0000-4000-8000-000000000002','msv_'||repeat('b',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000012','1.0','{x}'::bytea,'sha256:'||repeat('2',64),'sha256:'||repeat('b',64),'{"logical_id":"b","display_name":"B"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"b","revision":"r1"}'::jsonb,'verified','complete'),
  ('a3000000-0000-4000-8000-000000000003','msv_'||repeat('c',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000013','1.0','{x}'::bytea,'sha256:'||repeat('3',64),'sha256:'||repeat('c',64),'{"logical_id":"g","display_name":"G"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"g","revision":"r1"}'::jsonb,'verified','complete'),
  ('a4000000-0000-4000-8000-000000000004','msv_'||repeat('e',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000013','1.0','{x}'::bytea,'sha256:'||repeat('4',64),'sha256:'||repeat('d',64),'{"logical_id":"h","display_name":"4th"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"h","revision":"r1"}'::jsonb,'verified','complete'),
  ('b1000000-0000-4000-8000-000000000001','msv_'||repeat('d',32),'b8000000-0000-4800-8800-000000000002','b8000000-0000-4800-8800-000000000021','1.0','{x}'::bytea,'sha256:'||repeat('7',64),'sha256:'||repeat('7',64),'{"logical_id":"f","display_name":"F"}'::jsonb,'{"authority":"managed","kind":"local","namespace":"owner","source_id":"f","revision":"r1"}'::jsonb,'verified','complete');

insert into private.managed_skill_releases (id, public_id, account_id, managed_skill_id, version_id, lifecycle_state, eligibility_reasons, activated_at) values
  ('a9000000-0000-4000-8000-000000000001','msr_'||repeat('1',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000001','active','{}',now()),
  ('a9000000-0000-4000-8000-000000000002','msr_'||repeat('2',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000012','a2000000-0000-4000-8000-000000000002','active','{}',now()),
  ('a9000000-0000-4000-8000-000000000003','msr_'||repeat('3',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000013','a3000000-0000-4000-8000-000000000003','active','{}',now()),
  ('a9000000-0000-4000-8000-000000000004','msr_'||repeat('4',32),'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000013','a4000000-0000-4000-8000-000000000004','active','{}',now()),
  ('b9000000-0000-4000-8000-000000000001','msr_'||repeat('7',32),'b8000000-0000-4800-8800-000000000002','b8000000-0000-4800-8800-000000000021','b1000000-0000-4000-8000-000000000001','active','{}',now());

insert into private.devices (id, public_id, account_id, display_name, platform, connector_version, locale) values
  ('a8000000-0000-4800-8800-000000000301','dev_'||repeat('1',32),'a8000000-0000-4800-8800-000000000001','D1','macos','3.0.0','en-US'),
  ('a8000000-0000-4800-8800-000000000305','dev_'||repeat('5',32),'a8000000-0000-4800-8800-000000000001','D2','linux','3.0.0','en-US'),
  ('b8000000-0000-4800-8800-000000000302','dev_'||repeat('2',32),'b8000000-0000-4800-8800-000000000002','DB','linux','3.0.0','en');

-- ============================================================================
-- 3. ranked happy path + exact result type + release lineage.
-- ============================================================================
select ok(
  (select private.record_route_decision(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
    'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
    'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
    1000,24,4,5,12,
    '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.93,"reason_codes":["prompt_intent_match","eligibility_confirmed"]}]'::jsonb) is not null),
  'ranked decision recorded');
select is(
  (select result_type from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111'),
  'ranked_candidates','exact M1.09 result type stored');
select is(
  (select count(*)::integer from private.route_decision_selections where decision_id=(select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111')),
  1,'ranked lineage row stored with required release');
select ok(not exists (
  select 1 from private.route_decision_selections s
  where s.decision_id=(select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111')
    and s.release_id is null),
  'lineage row always carries a release id');

-- exact replay returns same id.
select is(
  (select private.record_route_decision(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
    'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
    'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
    1000,24,4,5,12,null)),
  (select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111'),
  'exact replay returns same decision id');

-- Same account + request id but a different fingerprint (different device binding
-- content) is an account-scoped idempotency conflict; it never creates a second
-- decision and never discloses a stored decision.
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000305',
  '70000000-0000-4000-8000-111111111111','sha256:'||repeat('b',64),
  'ranked_candidates',0.98,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,null)$$,22023,'idempotency conflict for this account route request','account-scoped idempotency conflict (different fingerprint)');
select is((select count(*)::int from private.route_decisions),1,'no row added on account-scoped conflict');

-- Same device, same request id but different fingerprint is also a conflict.
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-111111111111','sha256:'||repeat('b',64),
  'ranked_candidates',0.98,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,null)$$,22023,'idempotency conflict for this account route request','same device + different fingerprint conflict');

-- Cross-account release lineage rejected.
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-333333333333','sha256:'||repeat('c',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"b9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,23503,null,'cross-account release lineage rejected by FK');

-- no_match carries zero lineage.
create temp table dn(id uuid);
insert into dn select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-444444444444','sha256:'||repeat('d',64),
  'no_match',0.89,'["below_confidence_threshold"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,20,4,5,9,null);
select ok((select id from dn) is not null,'no_match decision recorded');

-- ranked lineage: rank 0 rejected (ordinal CHECK).
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-010000000001','sha256:'||repeat('0',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":0,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,23514,null,'rank 0 rejected by ordinal CHECK');

-- ranked lineage: rank 21 rejected (max 20).
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-020000000002','sha256:'||repeat('1',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":21,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,23514,null,'rank 21 rejected (max 20)');

-- ranked lineage: gapped rank (1 and 3) rejected by statement-level validator.
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-030000000003','sha256:'||repeat('2',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000012","version_id":"a2000000-0000-4000-8000-000000000002","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"ranked","ordinal":3,"role":null,"confidence":0.8,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,22023,'ranked lineage must be contiguous ranks 1..N (max 20)','gapped rank rejected');

-- expired replay dominates.
create temp table dexp(id uuid);
insert into dexp select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-555555555555','sha256:'||repeat('e',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb);
select ok((select id from dexp) is not null,'decision for expiry test recorded');
-- Model a restored/aged row whose decision authority has fully lapsed WITHOUT
-- dropping any constraint: backdate created_at by 31 days and set replay/expiry
-- relative to it (replay = created_at+24h, expiry = created_at+30d). All table
-- checks stay satisfied, yet decision_expiry_at is now ~1 day in the past, so the
-- row is exhausted and must never be replayable. The immutability trigger is
-- disabled only to model an already-existing restored row.
do $x$
begin
  alter table private.route_decisions disable trigger trg_route_decisions_immutable;
  update private.route_decisions
     set created_at = statement_timestamp() - interval '31 days',
         replay_guaranteed_until = (statement_timestamp() - interval '31 days') + interval '24 hours',
         decision_expiry_at = (statement_timestamp() - interval '31 days') + interval '30 days'
   where id = (select id from dexp);
  alter table private.route_decisions enable trigger trg_route_decisions_immutable;
end
$x$;
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-555555555555','sha256:'||repeat('e',64),'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,null)$$,22023,'route decision authority has exceeded its expiry; new request id required','expired decision never replayed');

-- Mismatched release/version pairing within lineage is rejected (foreign release).
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-666666666666','sha256:'||repeat('f',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,23503,null,'mismatched release/version pair rejected');

-- multi_skill valid selected lineage (2 rows, primary at order 1).
create temp table dms(id uuid);
insert into dms select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-040000000004','sha256:'||repeat('3',64),
  'multi_skill',0.86,'["complementary_capability"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,30,5,6,15,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"selected","ordinal":1,"role":"primary","confidence":0.91,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000012","version_id":"a2000000-0000-4000-8000-000000000002","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"selected","ordinal":2,"role":"supporting","confidence":0.84,"reason_codes":["complementary_capability"]}]'::jsonb);
select ok((select id from dms) is not null,'multi_skill selected lineage recorded');

-- multi_skill with a primary MISSING is rejected (statement validator).
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-050000000005','sha256:'||repeat('4',64),
  'multi_skill',0.86,'["complementary_capability"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,30,5,6,15,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"selected","ordinal":1,"role":"supporting","confidence":0.91,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000012","version_id":"a2000000-0000-4000-8000-000000000002","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"selected","ordinal":2,"role":"supporting","confidence":0.84,"reason_codes":["complementary_capability"]}]'::jsonb)$$,22023,'selected bundle requires exactly one primary at order 1','multi_skill missing primary rejected');

-- multi_skill with two primaries is rejected.
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-060000000006','sha256:'||repeat('5',64),
  'multi_skill',0.86,'["complementary_capability"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,30,5,6,15,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"selected","ordinal":1,"role":"primary","confidence":0.9,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000012","version_id":"a2000000-0000-4000-8000-000000000002","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"selected","ordinal":2,"role":"primary","confidence":0.8,"reason_codes":["complementary_capability"]}]'::jsonb)$$,22023,'selected bundle requires exactly one primary at order 1','multi_skill two primaries rejected');

-- ============================================================================
-- Corrections: product feedback outcome + optional owned alternative lineage.
-- ============================================================================
create temp table dc(id uuid);
insert into dc select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111'),
  'wrong',
  'a8000000-0000-4800-8800-000000000012','a2000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000001',NULL);
select ok((select id from dc) is not null,'feedback correction recorded');
select is((select count(*) from private.route_corrections),1::bigint,'exactly one correction row');
select is((select alt_managed_skill_id is not null from private.route_corrections where id=(select id from dc)),true,'wrong/missed may carry alternative lineage');

-- idempotent replay returns the same correction id.
select is(
  (select private.record_route_correction(
    'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
    (select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111'),
    'wrong','a8000000-0000-4800-8800-000000000012','a2000000-0000-4000-8000-000000000002','a9000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000001',NULL)),
  (select id from dc),'correction idempotent replay returns same id');
select is((select count(*) from private.route_corrections),1::bigint,'idempotent replay does not duplicate');

-- A changed payload under the same key is an idempotency conflict (different outcome).
select throws_ok($$select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111'),
  'unnecessary',NULL,NULL,NULL,'c0000000-0000-4000-8000-000000000001',NULL)$$,22023,'idempotency conflict for this route correction','changed correction payload under same key conflicts');

select is((select count(*) from private.route_corrections),1::bigint,'conflict leaves the single correction row intact');

-- second correction (new key) on the same decision is blocked by slot unique.
select throws_ok($$select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111'),
  'correct',NULL,NULL,NULL,'c0000000-0000-4000-8000-000000000002',NULL)$$,23505,null,'second correction slot blocked');

-- invalid vocabulary rejected.
select throws_ok($$select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111'),
  'bogus',NULL,NULL,NULL,'c0000000-0000-4000-8000-000000000003',NULL)$$,22023,'invalid route correction outcome','invalid feedback outcome rejected');

-- ============================================================================
-- All four product feedback outcomes accepted structurally (one immutable slot
-- per decision, so use four distinct decisions; each correction rolled back to
-- avoid leaving residue).
-- ============================================================================
-- correct / unnecessary / missed on three further decisions (base decision slot
-- is already taken by the 'wrong' correction above). One throwaway avoid decision
-- supplies the 'unnecessary' target.
create temp table du(id uuid);
insert into du select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-00000000f10f','sha256:'||repeat('0',64),
  'avoid',0.99,'["policy_denied"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,10,1,1,1,null);
do $out$
declare
  v_ok integer := 0;
begin
  begin
    perform private.record_route_correction(
      'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
      (select id from dms where true),'correct',NULL,NULL,NULL,
      'c0000000-0000-4000-8000-000000000020',NULL);
    v_ok := v_ok + 1;
  exception when others then raise exception 'correct outcome rejected';
  end;
  begin
    perform private.record_route_correction(
      'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
      (select id from du),'unnecessary',NULL,NULL,NULL,
      'c0000000-0000-4000-8000-000000000021',NULL);
    v_ok := v_ok + 1;
  exception when others then raise exception 'unnecessary outcome rejected';
  end;
  begin
    perform private.record_route_correction(
      'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
      (select id from dn),'missed','a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001',
      'c0000000-0000-4000-8000-000000000022',NULL);
    v_ok := v_ok + 1;
  exception when others then raise exception 'missed outcome rejected';
  end;
  raise notice 'accepted outcomes: %', v_ok;
end
$out$;
select ok(true, 'correct/unnecessary/missed outcomes accepted structurally (probe)');

-- ============================================================================
-- Alternative lineage cases (fresh decision, distinct slot).
-- ============================================================================
create temp table dal(id uuid);
insert into dal select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-00000000f01f','sha256:'||repeat('a',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,9,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb);
select is((select count(*)::int from dal),1,'alt decision present');

-- foreign-account alternative release rejected.
select throws_ok($$select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from dal),'wrong',
  'b8000000-0000-4800-8800-000000000011','b1000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000023',NULL)$$,22023,'route correction alternative is not an owned current release','foreign-account alternative release rejected');
select throws_ok($$select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from dal),'wrong',
  'a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000024',NULL)$$,22023,'route correction alternative is not an owned current release','wrong skill/version/release tuple alternative rejected');

-- alternative supplied for correct/unnecessary is rejected (only wrong/missed carry it).
select throws_ok($$select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from dms),'unnecessary',
  'a8000000-0000-4800-8800-000000000011','a1000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000025',NULL)$$,23514,null,'alternative supplied for unnecessary rejected');

-- ============================================================================
-- foreign account cannot correct.
select throws_ok($$select private.record_route_correction(
  'b8000000-0000-4800-8800-000000000002','b8000000-0000-4800-8800-000000000302',
  (select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111'),
  'correct',NULL,NULL,NULL,'c0000000-0000-4000-8000-000000000004',NULL)$$,22023,'route decision is not available for correction','foreign account cannot correct');

-- expired decision not correctable.
select throws_ok($$select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from dexp),'correct',NULL::uuid,NULL::uuid,NULL::uuid,'c0000000-0000-4000-8000-000000000005',NULL)$$,42501,'route decision authority has expired','expired decision not correctable');

-- partial alternative lineage rejected.
select throws_ok($$select private.record_route_correction(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  (select id from dn),'wrong',
  'a8000000-0000-4800-8800-000000000011',NULL,NULL,'c0000000-0000-4000-8000-000000000006',NULL)$$,22023,'invalid route correction alternative lineage','partial alternative rejected');

-- ============================================================================
-- Test executed-idempotency: same account/request/fingerprint/revisions through a
-- DIFFERENT current device is a binding conflict (device is part of the binding).
-- ============================================================================
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000305',
  '70000000-0000-4000-8000-111111111111','sha256:'||repeat('a',64),
  'ranked_candidates',0.93,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,24,4,5,12,null)$$,22023,'idempotency conflict for this account route request','same exact id+fp through a different current device conflicts (device binding)');

-- ============================================================================
-- ranked adversarial: role on a ranked row rejected.
-- ============================================================================
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-070000000007','sha256:'||repeat('7',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":"primary","confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,23514,null,'ranked row with role rejected (role_kind CHECK)');

-- ranked confidence INCREASING by rank is rejected (non-increasing is required).
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-0f100000000f','sha256:'||repeat('9',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.6,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000012","version_id":"a2000000-0000-4000-8000-000000000002","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"ranked","ordinal":2,"role":null,"confidence":0.99,"reason_codes":["complementary_capability"]}]'::jsonb)$$,22023,'ranked confidence must be non-increasing by rank','ranked confidence increasing by rank rejected');

-- ============================================================================
-- duplicate skill/version/release binding inside one decision rejected.
-- ============================================================================
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-080000000008','sha256:'||repeat('8',64),
  'ranked_candidates',0.9,'["prompt_intent_match"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,5,1,1,1,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":2,"role":null,"confidence":0.8,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,23505,null,'duplicate skill/version/release binding rejected (binding unique)');

-- ============================================================================
-- multi_skill: one selected row rejected (minimum 2).
-- ============================================================================
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-090000000009','sha256:'||repeat('9',64),
  'multi_skill',0.86,'["complementary_capability"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,30,5,6,15,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"selected","ordinal":1,"role":"primary","confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,22023,'selected lineage must be contiguous orders 1..N with 2..3 rows','one selected row rejected');

-- ===========================================================================
-- multi_skill: four selected rows rejected (maximum 3).
-- ===========================================================================
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-0a000000000a','sha256:'||repeat('a',64),'multi_skill',0.86,'["complementary_capability"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,30,5,6,15,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"selected","ordinal":1,"role":"primary","confidence":0.9,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000012","version_id":"a2000000-0000-4000-8000-000000000002","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"selected","ordinal":2,"role":"supporting","confidence":0.5,"reason_codes":["complementary_capability"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000013","version_id":"a3000000-0000-4000-8000-000000000003","release_id":"a9000000-0000-4000-8000-000000000003","row_kind":"selected","ordinal":3,"role":"supporting","confidence":0.5,"reason_codes":["complementary_capability"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000013","version_id":"a4000000-0000-4000-8000-000000000004","release_id":"a9000000-0000-4000-8000-000000000004","row_kind":"selected","ordinal":4,"role":"supporting","confidence":0.5,"reason_codes":["complementary_capability"]}]'::jsonb)$$,23514,null,'four selected rows rejected (max 3)');

-- ===========================================================================
-- multi_skill: gapped selection order rejected.
-- ===========================================================================
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-0b000000000b','sha256:'||repeat('b',64),
  'multi_skill',0.86,'["complementary_capability"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,30,5,6,15,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"selected","ordinal":1,"role":"primary","confidence":0.9,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000012","version_id":"a2000000-0000-4000-8000-000000000002","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"selected","ordinal":3,"role":"supporting","confidence":0.5,"reason_codes":["complementary_capability"]}]'::jsonb)$$,22023,'selected lineage must be contiguous orders 1..N with 2..3 rows','gapped selection order rejected');

-- ===========================================================================
-- multi_skill: primary at order 2 rejected (must be exactly one primary at order 1).
-- ===========================================================================
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-0c000000000c','sha256:'||repeat('c',64),
  'multi_skill',0.86,'["complementary_capability"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,30,5,6,15,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"selected","ordinal":1,"role":"supporting","confidence":0.5,"reason_codes":["prompt_intent_match"]},
    {"managed_skill_id":"a8000000-0000-4800-8800-000000000012","version_id":"a2000000-0000-4000-8000-000000000002","release_id":"a9000000-0000-4000-8000-000000000002","row_kind":"selected","ordinal":2,"role":"primary","confidence":0.9,"reason_codes":["complementary_capability"]}]'::jsonb)$$,22023,'selected bundle requires exactly one primary at order 1','primary at order 2 rejected');

-- ===========================================================================
-- no_match with non-null/non-empty lineage is refused and leaves no decision row.
-- ===========================================================================
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-0d000000000d','sha256:'||repeat('d',64),
  'no_match',0.89,'["below_confidence_threshold"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,20,4,5,9,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,22023,'no_match/avoid results must carry no lineage','no_match with lineage rejected');
select ok(not exists (
  select 1 from private.route_decisions where request_id='70000000-0000-4000-8000-0d000000000d'),
  'rejected no_match leaves no decision row');

-- avoid with non-empty lineage is rejected.
select throws_ok($$select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-0e000000000e','sha256:'||repeat('e',64),
  'avoid',0.99,'["policy_denied"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,18,4,4,8,
  '[{"managed_skill_id":"a8000000-0000-4800-8800-000000000011","version_id":"a1000000-0000-4000-8000-000000000001","release_id":"a9000000-0000-4000-8000-000000000001","row_kind":"ranked","ordinal":1,"role":null,"confidence":0.9,"reason_codes":["prompt_intent_match"]}]'::jsonb)$$,22023,'no_match/avoid results must carry no lineage','avoid with lineage rejected');

-- valid avoid with zero lineage is accepted.
create temp table dav(id uuid);
insert into dav select private.record_route_decision(
  'a8000000-0000-4800-8800-000000000001','a8000000-0000-4800-8800-000000000301',
  '70000000-0000-4000-8000-0f000000000f','sha256:'||repeat('f',64),
  'avoid',0.99,'["policy_denied"]'::jsonb,
  'acct_rev_42','device_auth_rev_12','routing_policy_rev_19','eligibility_rev_31','audience_rev_08',
  1000,18,1,1,1,null);
select ok((select id is not null from dav),'avoid zero lineage accepted');
select is((select count(*)::int from private.route_decision_selections where decision_id=(select id::uuid from dav)),0,'avoid carries zero lineage');

-- ============================================================================
-- direct UPDATE/DELETE rejected for all three tables; rows survive.
-- ============================================================================
create temp table base_decision(id uuid);
insert into base_decision select id from private.route_decisions where request_id='70000000-0000-4000-8000-111111111111';
select throws_ok($$update private.route_decisions set result_type='avoid' where id=(select id from base_decision)$$,22023,'route decision rows are immutable','UPDATE decision rejected');
select throws_ok($$delete from private.route_decisions where id=(select id from base_decision)$$,22023,'route decision rows are immutable','DELETE decision rejected');
select throws_ok($$update private.route_decision_selections set ordinal=2 where decision_id=(select id from base_decision)$$,22023,'route decision lineage rows are immutable','UPDATE lineage rejected');
select throws_ok($$delete from private.route_decision_selections where decision_id=(select id from base_decision)$$,22023,'route decision lineage rows are immutable','DELETE lineage rejected');
select throws_ok($$update private.route_corrections set outcome='correct' where id=(select id from dc)$$,22023,'route correction rows are immutable','UPDATE correction rejected');
select throws_ok($$delete from private.route_corrections where id=(select id from dc)$$,22023,'route correction rows are immutable','DELETE correction rejected');
select ok((select count(*)::int from private.route_decisions)>0,'decision rows survive DIRECT DML writes');

select * from finish();
rollback;
