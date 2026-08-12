begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, api, private;
select plan(81);

select has_function('api', 'device_auth_list_my_devices_v1', array[]::text[], 'owner list RPC exists');
select has_function('api', 'device_auth_rename_my_device_v1', array['text','text','bigint'], 'owner rename RPC exists');
select has_function('api', 'device_auth_revoke_my_device_v1', array['text','bigint'], 'owner revoke RPC exists');
select ok(has_function_privilege('authenticated','api.device_auth_list_my_devices_v1()','execute')
  and not has_function_privilege('public','api.device_auth_list_my_devices_v1()','execute')
  and not has_function_privilege('anon','api.device_auth_list_my_devices_v1()','execute')
  and not has_function_privilege('service_role','api.device_auth_list_my_devices_v1()','execute'), 'owner list is authenticated-only after cutover');
select ok(has_function_privilege('authenticated','api.device_auth_rename_my_device_v1(text,text,bigint)','execute')
  and not has_function_privilege('public','api.device_auth_rename_my_device_v1(text,text,bigint)','execute')
  and not has_function_privilege('anon','api.device_auth_rename_my_device_v1(text,text,bigint)','execute')
  and not has_function_privilege('service_role','api.device_auth_rename_my_device_v1(text,text,bigint)','execute'), 'owner rename is authenticated-only after cutover');
select ok(has_function_privilege('authenticated','api.device_auth_revoke_my_device_v1(text,bigint)','execute')
  and not has_function_privilege('public','api.device_auth_revoke_my_device_v1(text,bigint)','execute')
  and not has_function_privilege('anon','api.device_auth_revoke_my_device_v1(text,bigint)','execute')
  and not has_function_privilege('service_role','api.device_auth_revoke_my_device_v1(text,bigint)','execute'), 'owner revoke is authenticated-only after cutover');
select function_owner_is('api','device_auth_list_my_devices_v1',array[]::text[],'skillmap_device_auth_definer','list is definer-owned');
select function_owner_is('api','device_auth_rename_my_device_v1',array['text','text','bigint'],'skillmap_device_auth_definer','rename is definer-owned');
select function_owner_is('api','device_auth_revoke_my_device_v1',array['text','bigint'],'skillmap_device_auth_definer','revoke is definer-owned');
select function_owner_is('private','current_request_uid',array[]::text[],'postgres','UID bridge remains postgres-owned');
select ok(has_function_privilege('skillmap_device_auth_definer','private.current_request_uid()','execute')
  and not has_function_privilege('public','private.current_request_uid()','execute')
  and not has_function_privilege('anon','private.current_request_uid()','execute')
  and not has_function_privilege('authenticated','private.current_request_uid()','execute')
  and not has_function_privilege('service_role','private.current_request_uid()','execute'), 'UID bridge is executable by the definer only');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='api.device_auth_list_my_devices_v1()'::regprocedure), 'list pins empty search_path');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='api.device_auth_rename_my_device_v1(text,text,bigint)'::regprocedure), 'rename pins empty search_path');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure), 'revoke pins empty search_path');
select ok(pg_get_functiondef('api.device_auth_list_my_devices_v1()'::regprocedure) like '%current_device_auth_is_permanent_user%', 'list checks permanent-user helper');
select ok(pg_get_functiondef('api.device_auth_rename_my_device_v1(text,text,bigint)'::regprocedure) like '%current_device_auth_is_permanent_user%', 'rename checks permanent-user helper');
select ok(pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) like '%current_device_auth_is_permanent_user%', 'revoke checks permanent-user helper');
select ok(pg_get_functiondef('api.device_auth_list_my_devices_v1()'::regprocedure) like '%current_device_auth_jwt_role%'
  and pg_get_functiondef('api.device_auth_rename_my_device_v1(text,text,bigint)'::regprocedure) like '%current_device_auth_jwt_role%'
  and pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) like '%current_device_auth_jwt_role%', 'owner RPCs use signed top-level JWT role helper');
select ok(pg_get_functiondef('api.device_auth_list_my_devices_v1()'::regprocedure) not like '%current_request_role%', 'list does not use deprecated auth.role bridge');
select ok(pg_get_functiondef('api.device_auth_rename_my_device_v1(text,text,bigint)'::regprocedure) not like '%current_request_role%', 'rename does not use deprecated auth.role bridge');
select ok(pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) not like '%current_request_role%', 'revoke does not use deprecated auth.role bridge');
select ok(pg_get_functiondef('api.device_auth_list_my_devices_v1()'::regprocedure) like '%account_id = v_account_id%', 'list derives account ownership');
select ok(pg_get_functiondef('api.device_auth_rename_my_device_v1(text,text,bigint)'::regprocedure) like '%account_id = v_account_id%', 'rename derives account ownership');
select ok(pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) like '%account_id = v_account_id%', 'revoke derives account ownership');
select ok(pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) like '%device_auth_access_tokens%', 'revoke reaches access lineage');
select ok(pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) like '%device_auth_refresh_generations%', 'revoke reaches refresh lineage');
select ok(pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) like '%device_auth_key_bindings%', 'revoke reaches key lineage');
select ok(pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) like '%device_tokens%', 'revoke reaches legacy device token lineage');
select ok(pg_get_functiondef('api.device_auth_revoke_my_device_v1(text,bigint)'::regprocedure) not like '%revoke_all%', 'revoke has no revoke-all operation');
select ok(pg_get_functiondef('api.device_auth_list_my_devices_v1()'::regprocedure) not like '%token_digest%'
  and pg_get_functiondef('api.device_auth_list_my_devices_v1()'::regprocedure) not like '%public_key%'
  and pg_get_functiondef('api.device_auth_list_my_devices_v1()'::regprocedure) not like '%credential_digest%', 'list body names no secret projection fields');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.devices'::regclass), 'devices remain force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.device_auth_token_families'::regclass), 'families remain force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.device_auth_access_tokens'::regclass), 'access tokens remain force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.device_auth_refresh_generations'::regclass), 'refresh generations remain force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.device_auth_key_bindings'::regclass), 'key bindings remain force RLS');

-- Behavioral owner matrix. All rows are rolled back with this test transaction.
insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
  confirmation_token,email_change,email_change_token_new,recovery_token
) values
('00000000-0000-0000-0000-000000000000','a3100000-0000-4310-8310-000000000001','authenticated','authenticated','m310-a@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','',''),
('00000000-0000-0000-0000-000000000000','b3100000-0000-4310-8310-000000000002','authenticated','authenticated','m310-b@skillmap.invalid','',now(),'{}','{}',now(),now(),'','','','');

insert into private.devices(id,public_id,account_id,display_name,platform,connector_version,locale,state,revision,issued_at,last_used_at,expires_at)
values
('a3100000-0000-4310-8310-000000000011','dev_'||repeat('1',32),'a3100000-0000-4310-8310-000000000001','A active','macos','1.0.0','en-US','active',1,now()-interval '2 days',now()-interval '1 hour',now()+interval '30 days'),
('a3100000-0000-4310-8310-000000000012','dev_'||repeat('2',32),'a3100000-0000-4310-8310-000000000001','A expiring','linux','1.0.0','en','active',1,now()-interval '2 days',null,now()+interval '1 day'),
('a3100000-0000-4310-8310-000000000013','dev_'||repeat('3',32),'a3100000-0000-4310-8310-000000000001','A expired','linux','1.0.0','en','active',1,now()-interval '2 days',null,now()-interval '1 hour'),
('b3100000-0000-4310-8310-000000000021','dev_'||repeat('b',32),'b3100000-0000-4310-8310-000000000002','B active','windows','1.0.0','en','active',1,now()-interval '2 days',null,now()+interval '30 days');

insert into private.device_auth_pairings(
  pairing_id,device_id,key_thumbprint,audience_literal,requested_scopes,display_name,platform,connector_version,locale,verification_uri,state,expires_at
) values (
  'a3100000-0000-4310-8310-000000000101','aaaaaaaaaaaaaaaaaaaaaa','sha256:'||repeat('a',64),'skillmap.connector.v1',array['device.route'],'A expiring','linux','1.0.0','en','https://skillmap.test/device','granted',now()+interval '10 minutes'
);
insert into private.device_auth_key_bindings(device_id,proof_suite,public_key,key_thumbprint,is_active)
values ('aaaaaaaaaaaaaaaaaaaaaa','skillmap.ecdsa-p256-sha256.v2','public-key-fixture','sha256:'||repeat('a',64),true);
insert into private.device_auth_token_families(
  family_id,token_family_id,pairing_id,account_id,account_public_id,device_public_id,device_id,key_thumbprint,proof_suite,audience_literal,scopes,issued_at,idle_expires_at,absolute_expires_at
) values (
  'a3100000-0000-4310-8310-000000000102','fam_'||repeat('a',32),'a3100000-0000-4310-8310-000000000101','a3100000-0000-4310-8310-000000000001','acct_'||repeat('a',32),'dev_'||repeat('2',32),'aaaaaaaaaaaaaaaaaaaaaa','sha256:'||repeat('a',64),'skillmap.ecdsa-p256-sha256.v2','skillmap.connector.v1',array['device.route'],now(),now()+interval '1 day',now()+interval '30 days'
);
insert into private.device_auth_access_tokens(access_token_digest,key_version,family_id,generation,issued_at,expires_at)
values ('hmac-sha256:'||repeat('c',64),1,'a3100000-0000-4310-8310-000000000102',1,now(),now()+interval '10 minutes');
insert into private.device_auth_refresh_generations(refresh_token_digest,key_version,family_id,generation,issued_at,idle_expires_at,absolute_expires_at)
values ('hmac-sha256:'||repeat('d',64),1,'a3100000-0000-4310-8310-000000000102',1,now(),now()+interval '1 day',now()+interval '30 days');

-- The role is intentionally not granted pgTAP access by production SQL. Grant
-- only this assertion helper inside the rolled-back test transaction so the
-- following calls exercise the real NOLOGIN definer role without losing pgTAP
-- result recording when the role changes.
grant usage on schema extensions to skillmap_device_auth_definer;
grant execute on function extensions.ok(boolean, text) to skillmap_device_auth_definer;
set role skillmap_device_auth_definer;
set local search_path = extensions, public, private, api;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a3100000-0000-4310-8310-000000000001","is_anonymous":false}', true);
select ok((private.current_request_uid() = 'a3100000-0000-4310-8310-000000000001'::uuid), 'UID bridge is callable under the device definer');
select ok((api.device_auth_list_my_devices_v1()->>'status') = 'ok', 'permanent authenticated owner can list');
select ok((api.device_auth_list_my_devices_v1()::text like '%11111111%')
  and (api.device_auth_list_my_devices_v1()::text not like '%bbbbbbbb%'), 'account A cannot list account B device');
select ok((api.device_auth_list_my_devices_v1()::text like '%expiring%'), 'projection includes deterministic expiring state');
select ok((api.device_auth_list_my_devices_v1()::text like '%expired%'), 'projection includes expired state');
select ok((api.device_auth_list_my_devices_v1()::text not like '%account_id%')
  and api.device_auth_list_my_devices_v1()::text not like '%family_id%'
  and api.device_auth_list_my_devices_v1()::text not like '%key_thumbprint%'
  and api.device_auth_list_my_devices_v1()::text not like '%hmac-sha256%', 'owner output has no internal UUID/token/digest/key');
select ok((api.device_auth_rename_my_device_v1('11111111','Cafe'||U&'\\0301',1)->'device'->>'display_name') = U&'Caf\\00E9', 'rename canonicalizes NFC display name');
select ok((api.device_auth_rename_my_device_v1('11111111','stale',1)->>'status') = 'conflict', 'stale rename returns conflict');
select ok((api.device_auth_rename_my_device_v1('bbbbbbbb','foreign',1)->>'status') = 'unavailable', 'foreign rename is indistinguishable');
select ok((api.device_auth_revoke_my_device_v1('22222222',1)->'device'->>'state') = 'revoked', 'exact revoke returns revoked device');
select ok((select revoked_at is not null from private.device_auth_access_tokens where access_token_digest='hmac-sha256:'||repeat('c',64)), 'exact revoke revokes access token');
select ok((select revoked_at is not null from private.device_auth_refresh_generations where refresh_token_digest='hmac-sha256:'||repeat('d',64)), 'exact revoke revokes refresh generation');
select ok((select not is_active from private.device_auth_key_bindings where device_id='aaaaaaaaaaaaaaaaaaaaaa'), 'exact revoke retires active key');
select ok((select state = 'active' from private.devices where public_id = 'dev_'||repeat('1',32))
  and (select state = 'revoked' from private.devices where public_id = 'dev_'||repeat('2',32)), 'other owner device continuity and exactness hold');

-- Every malformed or anonymous claim is denied consistently by all three
-- owner APIs, and each denied rename/revoke group is followed by an exact
-- snapshot comparison covering every owner device and token lineage row.
create temp table m310_device_snapshot on commit drop as
select account_id, public_id, display_name, state, revision, revoked_at
  from private.devices
 where account_id = 'a3100000-0000-4310-8310-000000000001'::uuid;
create temp table m310_family_snapshot on commit drop as
select family_id, state, current_generation
  from private.device_auth_token_families
 where account_id = 'a3100000-0000-4310-8310-000000000001'::uuid;
create temp table m310_access_snapshot on commit drop as
select access_token_digest, family_id, generation, revoked_at
  from private.device_auth_access_tokens;
create temp table m310_refresh_snapshot on commit drop as
select refresh_token_digest, family_id, generation, replaced_at, revoked_at
  from private.device_auth_refresh_generations;
create temp table m310_key_snapshot on commit drop as
select device_id, key_thumbprint, is_active
  from private.device_auth_key_bindings;
create temp table m310_legacy_token_snapshot on commit drop as
select account_id, device_id, credential_digest, generation, revoked_at
  from private.device_tokens
 where account_id = 'a3100000-0000-4310-8310-000000000001'::uuid;

create or replace function pg_temp.m310_owner_state_unchanged()
returns boolean
language sql stable set search_path = ''
as $function$
  select not exists (
    select 1
      from pg_temp.m310_device_snapshot s
      full join private.devices d using (account_id, public_id)
     where s.public_id is null or d.public_id is null
        or s.display_name is distinct from d.display_name
        or s.state is distinct from d.state
        or s.revision is distinct from d.revision
        or s.revoked_at is distinct from d.revoked_at
  )
  and not exists (
    select 1
      from pg_temp.m310_family_snapshot s
      full join private.device_auth_token_families f using (family_id)
     where s.family_id is null or f.family_id is null
        or s.state is distinct from f.state
        or s.current_generation is distinct from f.current_generation
  )
  and not exists (
    select 1
      from pg_temp.m310_access_snapshot s
      full join private.device_auth_access_tokens a using (access_token_digest)
     where s.access_token_digest is null or a.access_token_digest is null
        or s.family_id is distinct from a.family_id
        or s.generation is distinct from a.generation
        or s.revoked_at is distinct from a.revoked_at
  )
  and not exists (
    select 1
      from pg_temp.m310_refresh_snapshot s
      full join private.device_auth_refresh_generations r using (refresh_token_digest)
     where s.refresh_token_digest is null or r.refresh_token_digest is null
        or s.family_id is distinct from r.family_id
        or s.generation is distinct from r.generation
        or s.replaced_at is distinct from r.replaced_at
        or s.revoked_at is distinct from r.revoked_at
  )
  and not exists (
    select 1
      from pg_temp.m310_key_snapshot s
      full join private.device_auth_key_bindings k using (device_id, key_thumbprint)
     where s.device_id is null or k.device_id is null
        or s.is_active is distinct from k.is_active
  )
  and not exists (
    select 1
      from pg_temp.m310_legacy_token_snapshot s
      full join private.device_tokens t using (account_id, device_id, credential_digest, generation)
     where s.credential_digest is null or t.credential_digest is null
        or s.revoked_at is distinct from t.revoked_at
  )
$function$;

create or replace function pg_temp.m310_list_status()
returns text language plpgsql set search_path = '' as $function$
begin
  return coalesce((select api.device_auth_list_my_devices_v1()->>'status'), 'unavailable');
exception when others then
  return 'unavailable';
end
$function$;
create or replace function pg_temp.m310_rename_status()
returns text language plpgsql set search_path = '' as $function$
begin
  return coalesce((select api.device_auth_rename_my_device_v1('11111111','blocked',2)->>'status'), 'unavailable');
exception when others then
  return 'unavailable';
end
$function$;
create or replace function pg_temp.m310_revoke_status()
returns text language plpgsql set search_path = '' as $function$
begin
  return coalesce((select api.device_auth_revoke_my_device_v1('11111111',2)->>'status'), 'unavailable');
exception when others then
  return 'unavailable';
end
$function$;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a3100000-0000-4310-8310-000000000001","is_anonymous":true}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'boolean true anonymous claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'boolean true claim leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a3100000-0000-4310-8310-000000000001"}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'missing is_anonymous claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'missing is_anonymous claim leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a3100000-0000-4310-8310-000000000001","is_anonymous":"false"}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'string false anonymous claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'string false claim leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a3100000-0000-4310-8310-000000000001","is_anonymous":null}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'JSON null anonymous claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'JSON null claim leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"a3100000-0000-4310-8310-000000000001","is_anonymous":{}}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'object anonymous claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'object claim leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"role":"anon","sub":"a3100000-0000-4310-8310-000000000001","is_anonymous":false}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'wrong top-level role denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'wrong role leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '[]', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'JSON array claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'JSON array leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '1', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'JSON number claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'JSON number leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '"arbitrary string"', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'arbitrary string claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'arbitrary string leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '"false"', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'JSON string false claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'JSON string false leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', 'null', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'JSON null JWT denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'JSON null JWT leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', 'true', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'JSON boolean true claim denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'JSON boolean true leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"sub":"a3100000-0000-4310-8310-000000000001","is_anonymous":false}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'missing top-level role denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'missing role leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"role":"authenticated","is_anonymous":false}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'missing sub UID denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'missing sub leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":null,"is_anonymous":false}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'null sub UID denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'null sub leaves devices revisions names states and tokens unchanged');

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"malformed-uid","is_anonymous":false}', true);
select ok(pg_temp.m310_list_status() = 'unavailable' and pg_temp.m310_rename_status() = 'unavailable' and pg_temp.m310_revoke_status() = 'unavailable', 'malformed sub UID denied by list rename revoke');
select ok(pg_temp.m310_owner_state_unchanged(), 'malformed sub leaves devices revisions names states and tokens unchanged');
reset role;

rollback;
