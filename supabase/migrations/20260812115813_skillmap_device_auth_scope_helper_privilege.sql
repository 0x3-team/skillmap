begin;

set local search_path = '';

-- device_scopes_are_canonical() is an invoker helper and delegates to
-- valid_text_array(). DeviceAuth mutations therefore need this exact nested
-- execution privilege when table constraints run as the NOLOGIN definer.
grant execute on function private.valid_text_array(text[], integer, integer, text)
  to skillmap_device_auth_definer;

commit;
