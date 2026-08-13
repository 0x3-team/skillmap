begin;

grant usage on schema extensions to skillmap_device_auth_definer;
grant execute on function extensions.gen_random_bytes(integer) to skillmap_device_auth_definer;

notify pgrst, 'reload schema';

commit;
