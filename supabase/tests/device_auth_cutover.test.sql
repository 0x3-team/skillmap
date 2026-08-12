begin;

select plan(33);

select has_table('private', 'device_auth_authority_control', 'cutover authority control exists');
select is((select count(*)::integer from private.device_auth_authority_control), 1, 'authority control is a singleton');
select is((select legacy_device_authority_enabled from private.device_auth_authority_control where control_key = 'legacy_device_authority'), false, 'legacy authority is terminally disabled');
select is((select revision from private.device_auth_authority_control where control_key = 'legacy_device_authority'), 2::bigint, 'cutover advances the authority revision exactly once');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'device_auth_authority_control'), 'authority control is FORCE RLS');
select is((select r.rolname from pg_catalog.pg_class c join pg_catalog.pg_roles r on r.oid = c.relowner where c.oid = 'private.device_auth_authority_control'::regclass), 'skillmap_device_auth_definer', 'authority control is definer-owned');
select ok(not has_table_privilege('anon', 'private.device_auth_authority_control', 'select,update') and not has_table_privilege('authenticated', 'private.device_auth_authority_control', 'select,update') and not has_table_privilege('service_role', 'private.device_auth_authority_control', 'select,update'), 'request roles have no authority-control table privilege');
select ok(exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'device_auth_authority_control' and policyname = 'device_auth_authority_control_definer_select'), 'definer SELECT policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'device_auth_authority_control' and policyname = 'device_auth_authority_control_definer_update'), 'definer forward UPDATE policy exists');
select ok(has_table_privilege('skillmap_device_auth_definer', 'private.device_auth_authority_control', 'select,update'), 'definer has only narrow control table privilege');

select ok(position('pg_advisory_xact_lock_shared(1397442892, 1145132372)' in pg_get_functiondef('private.register_my_device(text,text,text,text)'::regprocedure)) > 0, 'register wrapper acquires the frozen shared lock');
select ok(position('device_auth_assert_legacy_authority_enabled' in pg_get_functiondef('private.register_my_device(text,text,text,text)'::regprocedure)) > 0, 'register wrapper checks the DB-owned flag');
select ok(position('pg_advisory_xact_lock_shared(1397442892, 1145132372)' in pg_get_functiondef('private.rotate_my_device(text,bigint)'::regprocedure)) > 0, 'rotate wrapper acquires the frozen shared lock');
select ok(position('pg_advisory_xact_lock_shared(1397442892, 1145132372)' in pg_get_functiondef('private.revoke_my_device(text,bigint)'::regprocedure)) > 0, 'revoke wrapper acquires the frozen shared lock');
select ok(position('pg_advisory_xact_lock_shared' in pg_get_functiondef('device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint)'::regprocedure)) > 0, 'issue adapter acquires the frozen shared lock');
select ok(position('pg_advisory_xact_lock_shared' in pg_get_functiondef('device_adapter.adapter_rotate_device_token(uuid,text,integer,bigint,bigint,text,integer,text[],timestamp with time zone)'::regprocedure)) > 0, 'rotate adapter acquires the frozen shared lock');
select ok(position('pg_advisory_xact_lock_shared' in pg_get_functiondef('device_adapter.adapter_revoke_device_token(uuid,text,integer,bigint,bigint)'::regprocedure)) > 0, 'revoke adapter acquires the frozen shared lock');
select ok(not has_function_privilege('public', 'private.register_my_device(text,text,text,text)', 'execute') and not has_function_privilege('authenticated', 'private.register_my_device(text,text,text,text)', 'execute'), 'legacy register grant is revoked after cutover');
select ok(not has_function_privilege('service_role', 'device_adapter.adapter_issue_device_token(uuid,text,text,integer,text[],timestamp with time zone,bigint)', 'execute'), 'legacy issue grant is revoked after cutover');

select ok(has_function_privilege('service_role', 'api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)', 'execute'), 'service role can execute initiate after cutover');
select ok(has_function_privilege('service_role', 'api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer)', 'execute'), 'service role can execute refresh after cutover');
select ok(has_function_privilege('service_role', 'api.device_auth_expire_v1(bigint,integer)', 'execute'), 'maintenance receives only its exact replacement grant');
select ok(has_function_privilege('authenticated', 'api.device_auth_review_my_pairing_v1(text)', 'execute') and has_function_privilege('authenticated', 'api.device_auth_confirm_my_pairing_v1(text,bigint,text)', 'execute'), 'permanent owner pairing RPCs are granted');
select ok(has_function_privilege('authenticated', 'api.device_auth_list_my_devices_v1()', 'execute') and has_function_privilege('authenticated', 'api.device_auth_rename_my_device_v1(text,text,bigint)', 'execute') and has_function_privilege('authenticated', 'api.device_auth_revoke_my_device_v1(text,bigint)', 'execute'), 'permanent owner device RPCs are granted');
select ok(not has_function_privilege('anon', 'api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)', 'execute') and not has_function_privilege('authenticated', 'api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)', 'execute'), 'server replacement RPCs remain unavailable to request roles');

select ok((select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'private.device_auth_assert_legacy_authority_enabled()'::regprocedure), 'flag helper is SECURITY DEFINER');
select ok((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = 'private.device_auth_assert_legacy_authority_enabled()'::regprocedure), 'flag helper pins an empty search path');
select ok((select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'api.device_auth_refresh_v1(text,integer,text,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,text,integer,bigint,bigint,text,text,integer)'::regprocedure), 'refresh replacement is SECURITY DEFINER');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'private.device_auth_refresh_replay_payloads'::regclass), 'replay payloads remain FORCE RLS');
select ok(to_regclass('private.device_auth_key_bindings_one_active_per_device') is not null and to_regclass('private.device_auth_confirmation_handles_pairing_idx') is not null, 'replacement contract indexes exist');

select throws_ok($$update private.device_auth_authority_control set legacy_device_authority_enabled = true, revision = revision + 1, changed_at = statement_timestamp() where control_key = 'legacy_device_authority'$$, '55000', 'device authority control transition is invalid', 'false cannot roll back to true');
select throws_ok($$delete from private.device_auth_authority_control where control_key = 'legacy_device_authority'$$, '55000', 'device authority control is forward-only', 'authority row cannot be deleted');
select is((select count(*)::integer from private.device_auth_refresh_replay_payloads), 0, 'cutover creates no replay key or payload');

select * from finish();
rollback;
