begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(6);

select ok(
  has_schema_privilege('skillmap_device_auth_definer', 'extensions', 'usage'),
  'DeviceAuth definer can resolve the pgcrypto schema'
);

select ok(
  has_function_privilege(
    'skillmap_device_auth_definer',
    'extensions.gen_random_bytes(integer)',
    'execute'
  ),
  'DeviceAuth definer can execute only the required randomness function'
);

select is(
  (
    select r.rolname
      from pg_catalog.pg_proc p
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = 'api.device_auth_review_my_pairing_v1(text)'::regprocedure
  ),
  'skillmap_device_auth_definer',
  'browser review remains owned by the NOLOGIN DeviceAuth definer'
);

select is(
  (
    select r.rolname
      from pg_catalog.pg_proc p
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where p.oid = 'api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)'::regprocedure
  ),
  'skillmap_device_auth_definer',
  'pairing poll remains owned by the NOLOGIN DeviceAuth definer'
);

set role skillmap_device_auth_definer;
select set_config(
  'm314.random_bytes_length',
  pg_catalog.octet_length(extensions.gen_random_bytes(16))::text,
  true
);
reset role;

select is(
  current_setting('m314.random_bytes_length'),
  '16',
  'DeviceAuth definer can generate a 16-byte confirmation handle seed'
);

select ok(
  position(
    'extensions.gen_random_bytes(16)' in
    pg_catalog.pg_get_functiondef('api.device_auth_review_my_pairing_v1(text)'::regprocedure)
  ) > 0
  and position(
    'extensions.gen_random_bytes(32)' in
    pg_catalog.pg_get_functiondef(
      'api.device_auth_poll_v1(text,text,text,text,text,text,text,text,text)'::regprocedure
    )
  ) > 0,
  'both runtime paths use the explicitly granted randomness function'
);

select * from finish();
rollback;
