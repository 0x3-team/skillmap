begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  exists (
    select 1
    from pg_catalog.pg_db_role_setting as settings
    join pg_catalog.pg_roles as roles on roles.oid = settings.setrole
    cross join lateral pg_catalog.unnest(settings.setconfig) as config(value)
    where roles.rolname = 'authenticator'
      and config.value = 'pgrst.db_schemas=public, graphql_public, api, device_adapter, analysis_worker_adapter'
  ),
  'PostgREST exposes the service-role device adapter schema without changing function grants'
);

select function_owner_is(
  'api', 'device_auth_authenticate_import_v1',
  array['text[]','integer[]','text','text','text','text','text','text','text','text'],
  'skillmap_device_auth_definer',
  'protected import authenticator uses the dedicated NOLOGIN owner'
);
select ok(
  has_function_privilege(
    'service_role',
    'api.device_auth_authenticate_import_v1(text[],integer[],text,text,text,text,text,text,text,text)',
    'execute'
  ),
  'service role can invoke the protected import authenticator'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'api.device_auth_authenticate_import_v1(text[],integer[],text,text,text,text,text,text,text,text)',
    'execute'
  ),
  'browser authenticated role cannot invoke the protected import authenticator'
);
select ok(
  not has_function_privilege(
    'anon',
    'api.device_auth_authenticate_import_v1(text[],integer[],text,text,text,text,text,text,text,text)',
    'execute'
  ),
  'anonymous role cannot invoke the protected import authenticator'
);
select is(
  api.device_auth_authenticate_import_v1(
    array['hmac-sha256:' || repeat('a',64)], array[1], repeat('d',22),
    'sha256:' || repeat('b',64), 'skillmap.connector.v1',
    'skillmap.ecdsa-p256-sha256.v2', 'protected.import', repeat('n',22),
    (extract(epoch from pg_catalog.statement_timestamp())::bigint)::text,
    'sha256:' || repeat('c',64)
  )->>'error',
  'invalid_token',
  'protected.import passes request validation and reaches token lookup'
);
select is(
  api.device_auth_authenticate_import_v1(
    array['hmac-sha256:' || repeat('a',64)], array[1], repeat('d',22),
    'sha256:' || repeat('b',64), 'skillmap.connector.v1',
    'skillmap.ecdsa-p256-sha256.v2', 'authenticate', repeat('n',22), '0',
    'sha256:' || repeat('c',64)
  )->>'error',
  'invalid_request',
  'non-import proof purpose is rejected'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'api.device_auth_authenticate_import_v1(text[],integer[],text,text,text,text,text,text,text,text)'::regprocedure
  ) like '%p_device_id, p_proof_purpose, p_proof_nonce%',
  'nonce consumption stores the exact protected purpose instead of the authenticate literal'
);

select * from finish();
rollback;
