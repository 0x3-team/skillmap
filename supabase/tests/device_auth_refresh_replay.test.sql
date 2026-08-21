begin;
select plan(22);

select has_table('private', 'device_auth_refresh_replay_receipts', 'refresh replay receipts exist');
select has_table('private', 'device_auth_refresh_replay_payloads', 'refresh replay payloads exist');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'device_auth_refresh_replay_receipts'), 'receipt RLS enabled');
select ok((select relforcerowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'device_auth_refresh_replay_receipts'), 'receipt RLS forced');
select ok((select relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'device_auth_refresh_replay_payloads'), 'payload RLS enabled');
select ok((select relforcerowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'device_auth_refresh_replay_payloads'), 'payload RLS forced');
select has_function('api', 'device_auth_refresh_v1', array['text','integer','text','text','text','text','text','text','text','text','text','text','integer','bigint','integer','text','text','text','integer','bigint','bigint','text','text','integer'], 'refresh transition function exists');
select function_owner_is('api', 'device_auth_refresh_v1', array['text','integer','text','text','text','text','text','text','text','text','text','text','integer','bigint','integer','text','text','text','integer','bigint','bigint','text','text','integer'], 'skillmap_device_auth_definer', 'refresh transition has dedicated owner');
select ok(not pg_catalog.has_function_privilege('public', 'api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer)', 'execute'), 'PUBLIC cannot execute refresh transition');
select ok(pg_catalog.has_function_privilege('service_role', 'api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer)', 'execute'), 'service_role can execute refresh after cutover');
select has_function('api', 'device_auth_refresh_fail_closed_v1', array['text','text'], 'fail-closed function exists');
select has_function('api', 'device_auth_expire_v1', array['bigint','integer'], 'maintenance purge function exists');
select ok(not pg_catalog.has_function_privilege('public', 'api.device_auth_refresh_fail_closed_v1(text,text)', 'execute'), 'PUBLIC cannot execute fail-closed mutation');
select ok(pg_catalog.has_function_privilege('service_role', 'api.device_auth_refresh_fail_closed_v1(text,text)', 'execute'), 'service_role can execute fail-closed mutation after cutover');
select ok(not pg_catalog.has_function_privilege('public', 'api.device_auth_expire_v1(bigint,integer)', 'execute'), 'PUBLIC cannot execute maintenance purge');
select ok(pg_catalog.has_function_privilege('service_role', 'api.device_auth_expire_v1(bigint,integer)', 'execute'), 'service_role can execute maintenance purge after cutover');
select has_column('private', 'device_auth_refresh_replay_payloads', 'runtime_purge_after', 'payload carries runtime purge deadline');
select has_column('private', 'device_auth_refresh_replay_payloads', 'nonce', 'payload carries nonce metadata');
select ok((select count(*) = 1 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid = c.conrelid join pg_catalog.pg_namespace n on n.oid = r.relnamespace where n.nspname = 'private' and r.relname = 'device_auth_refresh_replay_payloads' and c.conname = 'device_auth_refresh_replay_payloads_nonce_unique'), 'replay nonce/version uniqueness is enforced');
select ok((select count(*) = 1 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid = c.conrelid join pg_catalog.pg_namespace n on n.oid = r.relnamespace where n.nspname = 'private' and r.relname = 'device_auth_refresh_replay_receipts' and c.conname = 'device_auth_refresh_replay_receipts_time_check'), 'receipt preserves replay/purge timing tombstone');
select ok((select count(*) = 0 from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname in ('device_auth_refresh_replay_receipts','device_auth_refresh_replay_payloads') and a.attname in ('token','access_token','refresh_token','secret','plaintext') and a.attnum > 0), 'replay metadata has no raw token columns');
select ok((select count(*) = 0 from information_schema.role_table_grants where table_schema = 'private' and table_name in ('device_auth_refresh_replay_receipts','device_auth_refresh_replay_payloads') and grantee in ('public','anon','authenticated','service_role')), 'request roles have no replay table grants');

select * from finish();
rollback;
