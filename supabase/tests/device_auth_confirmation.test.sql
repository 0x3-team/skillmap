begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(26);

select ok(
  exists (select 1 from pg_catalog.pg_class where oid = 'private.device_auth_confirmation_handles'::regclass and relforcerowsecurity),
  'confirmation handles use FORCE RLS'
);
select ok(
  exists (select 1 from pg_catalog.pg_class where oid = 'private.device_auth_confirmation_attempts'::regclass and relforcerowsecurity),
  'confirmation attempts use FORCE RLS'
);
select ok(
  not has_table_privilege('anon', 'private.device_auth_confirmation_handles', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'private.device_auth_confirmation_handles', 'select,insert,update,delete')
    and not has_table_privilege('service_role', 'private.device_auth_confirmation_handles', 'select,insert,update,delete'),
  'confirmation handles have no direct request-role grants'
);
select ok(
  not has_table_privilege('anon', 'private.device_auth_confirmation_attempts', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'private.device_auth_confirmation_attempts', 'select,insert,update,delete')
    and not has_table_privilege('service_role', 'private.device_auth_confirmation_attempts', 'select,insert,update,delete'),
  'confirmation attempts have no direct request-role grants'
);
select ok(has_function_privilege('authenticated', 'api.device_auth_review_my_pairing_v1(text)', 'execute'), 'post-cutover review RPC is granted to authenticated');
select ok(has_function_privilege('authenticated', 'api.device_auth_confirm_my_pairing_v1(text,bigint,text)', 'execute'), 'post-cutover decision RPC is granted to authenticated');
select ok(not has_function_privilege('anon', 'api.device_auth_review_my_pairing_v1(text)', 'execute'), 'anon cannot execute review RPC');
select ok(not has_function_privilege('anon', 'api.device_auth_confirm_my_pairing_v1(text,bigint,text)', 'execute'), 'anon cannot execute decision RPC');
select ok(not has_function_privilege('service_role', 'api.device_auth_review_my_pairing_v1(text)', 'execute'), 'service_role cannot execute owner review RPC');
select ok(not has_function_privilege('service_role', 'api.device_auth_confirm_my_pairing_v1(text,bigint,text)', 'execute'), 'service_role cannot execute owner decision RPC');
select ok(
  not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'private.device_auth_confirmation_handles'::regclass and a.attname in ('device_code','user_code','exchange_code','access_token','refresh_token')),
  'confirmation handle table has no raw code or token columns'
);
select ok(
  exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'private.device_auth_pairings'::regclass and a.attname = 'confirmed_user_id')
    and exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'private.device_auth_pairings'::regclass and a.attname = 'confirmation_revision'),
  'pairings bind the confirming account and revision'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'private.device_auth_confirmation_handles'::regclass and c.conname = 'device_auth_confirmation_handles_digest_check'),
  'handles persist only sha256 digests'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'private.device_auth_confirmation_handles'::regclass and c.conname = 'device_auth_confirmation_handles_expiry_check'),
  'handles have a positive expiry window'
);
select ok(
  pg_get_functiondef('api.device_auth_review_my_pairing_v1(text)'::regprocedure) like '%device_auth_confirmation_authz%'
    and pg_get_functiondef('api.device_auth_confirm_my_pairing_v1(text,bigint,text)'::regprocedure) like '%device_auth_confirmation_authz%'
    and pg_get_functiondef('private.device_auth_confirmation_authz()'::regprocedure) like '%current_request_uid%',
  'both RPCs apply the permanent authenticated-user guard'
);
select ok(
  pg_get_functiondef('api.device_auth_review_my_pairing_v1(text)'::regprocedure) like '%attempt_count%'
    and pg_get_functiondef('api.device_auth_review_my_pairing_v1(text)'::regprocedure) like '%10%',
  'review RPC has a bounded account attempt limit'
);
select ok(
  pg_get_functiondef('api.device_auth_confirm_my_pairing_v1(text,bigint,text)'::regprocedure) like '%used_at%'
    and pg_get_functiondef('api.device_auth_confirm_my_pairing_v1(text,bigint,text)'::regprocedure) like '%for update%',
  'decision RPC is locked and idempotent on duplicate submission'
);
select ok(
  pg_get_functiondef('api.device_auth_confirm_my_pairing_v1(text,bigint,text)'::regprocedure) like '%confirmed_user_id%'
    and pg_get_functiondef('api.device_auth_confirm_my_pairing_v1(text,bigint,text)'::regprocedure) like '%p_decision%',
  'decision binds the authenticated account and supports approve/deny only'
);

-- Execute the identity bridge and owner guard under the actual NOLOGIN definer.
-- These cases deliberately use PostgREST's request.jwt.claims GUC, which is
-- the same input consumed by auth.jwt()/auth.uid() in the accepted helpers.
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","is_anonymous":false}', true);
set role skillmap_device_auth_definer;
set local search_path = extensions, public, private, api;
select set_config('m304.permanent_bridge', private.current_device_auth_is_permanent_user()::text, true);
select set_config('m304.permanent_authz', private.device_auth_confirmation_authz()::text, true);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","is_anonymous":true}', true);
select set_config('m304.anonymous_bridge', private.current_device_auth_is_permanent_user()::text, true);
select set_config('m304.anonymous_authz', private.device_auth_confirmation_authz()::text, true);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"}', true);
select set_config('m304.missing_bridge', private.current_device_auth_is_permanent_user()::text, true);
select set_config('m304.missing_authz', private.device_auth_confirmation_authz()::text, true);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","is_anonymous":"false"}', true);
select set_config('m304.malformed_bridge', private.current_device_auth_is_permanent_user()::text, true);
select set_config('m304.malformed_authz', private.device_auth_confirmation_authz()::text, true);
reset role;

select ok(current_setting('m304.permanent_bridge') = 'true', 'permanent authenticated claim is recognized under the NOLOGIN definer');
select ok(current_setting('m304.permanent_authz') = 'true', 'permanent authenticated claim passes confirmation authorization under the NOLOGIN definer');
select ok(current_setting('m304.anonymous_bridge') = 'false', 'anonymous claim is rejected by the permanent-user bridge under the NOLOGIN definer');
select ok(current_setting('m304.anonymous_authz') = 'false', 'anonymous claim is denied by confirmation authorization under the NOLOGIN definer');
select ok(current_setting('m304.missing_bridge') = 'false', 'missing is_anonymous claim is denied under the NOLOGIN definer');
select ok(current_setting('m304.missing_authz') = 'false', 'missing is_anonymous claim is denied by confirmation authorization');
select ok(current_setting('m304.malformed_bridge') = 'false', 'string false is rejected as malformed under the NOLOGIN definer');
select ok(current_setting('m304.malformed_authz') = 'false', 'malformed is_anonymous claim is denied by confirmation authorization');

select * from finish();
rollback;
