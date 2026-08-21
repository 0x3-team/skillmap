begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(24);

select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_token_families'::regclass), 'token families FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_access_tokens'::regclass), 'access digests FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_refresh_generations'::regclass), 'refresh generations FORCE RLS');

select ok(
  not has_table_privilege('anon','private.device_auth_token_families','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_token_families','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_token_families','select,insert,update,delete'),
  'token families have no request-role grants'
);
select ok(
  not has_table_privilege('anon','private.device_auth_access_tokens','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_access_tokens','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_access_tokens','select,insert,update,delete'),
  'access digests have no request-role grants'
);
select ok(
  not has_table_privilege('anon','private.device_auth_refresh_generations','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_refresh_generations','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_refresh_generations','select,insert,update,delete'),
  'refresh generations have no request-role grants'
);

select ok(not has_function_privilege('anon','api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)','execute'), 'anon cannot execute poll after cutover');
select ok(not has_function_privilege('authenticated','api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)','execute'), 'authenticated cannot execute poll after cutover');
select ok(has_function_privilege('service_role','api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)','execute'), 'service_role can execute poll after cutover');
select ok(exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = 'device_auth_get_active_key_v1'), 'active proof-key lookup exists');
select ok(has_function_privilege('service_role','api.device_auth_get_active_key_v1(text)','execute'), 'service_role can look up the active proof key after cutover');
select ok(not has_function_privilege('anon','api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)','execute'), 'anon cannot execute exchange after cutover');
select ok(not has_function_privilege('authenticated','api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)','execute'), 'authenticated cannot execute exchange after cutover');
select ok(has_function_privilege('service_role','api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)','execute'), 'service_role can execute exchange after cutover');

select ok(not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'private.device_auth_token_families'::regclass and attname in ('access_token','refresh_token','exchange_code')), 'family table has no raw credentials');
select ok(not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'private.device_auth_access_tokens'::regclass and attname = 'access_token'), 'access table has no raw token column');
select ok(not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'private.device_auth_refresh_generations'::regclass and attname = 'refresh_token'), 'refresh table has no raw token column');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'private.device_auth_access_tokens'::regclass and pg_get_constraintdef(oid) like '%hmac-sha256%'), 'access digest is HMAC-shaped');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'private.device_auth_refresh_generations'::regclass and pg_get_constraintdef(oid) like '%hmac-sha256%'), 'refresh digest is HMAC-shaped');
select ok(pg_get_functiondef('api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)'::regprocedure) like '%poll_interval_seconds%' and pg_get_functiondef('api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)'::regprocedure) like '%last_polled_at%', 'poll RPC enforces stored interval and attempts');
select ok(pg_get_functiondef('api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)'::regprocedure) like '%v_remaining_seconds%' and pg_get_functiondef('api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)'::regprocedure) like '%expired_token%', 'approved near-expiry poll fails closed instead of returning zero expires_in');
select ok(pg_get_functiondef('api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)'::regprocedure) like '%pg_advisory_xact_lock%' and pg_get_functiondef('api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)'::regprocedure) like '%device_auth_refresh_generations%', 'exchange RPC is serialized and writes one refresh generation');
select ok(pg_get_functiondef('api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)'::regprocedure) like '%key_thumbprint%' and pg_get_functiondef('api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)'::regprocedure) like '%requested_scopes%', 'exchange binds key and scopes');
select ok(pg_get_functiondef('api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)'::regprocedure) like '%already_consumed%' and pg_get_functiondef('api.device_auth_exchange_v1(text,text,text,text,text[],text,text,text,text,text,text,text,integer,text,integer)'::regprocedure) like '%already_consumed%', 'replay terminal outcome is explicit');

select * from finish();
rollback;
