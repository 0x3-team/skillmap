begin;

set local search_path = '';

create or replace function api.device_auth_authenticate_import_v1(
  p_access_token_digests text[], p_access_token_key_versions integer[], p_device_id text,
  p_key_thumbprint text, p_audience text, p_proof_suite text, p_proof_purpose text,
  p_proof_nonce text, p_issued_at text, p_request_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_family private.device_auth_token_families%rowtype;
  v_device private.devices%rowtype;
  v_access private.device_auth_access_tokens%rowtype;
  v_key_version integer;
  v_expires timestamptz;
begin
  if p_access_token_digests is null or p_access_token_key_versions is null
     or pg_catalog.cardinality(p_access_token_digests) not between 1 and 2
     or pg_catalog.cardinality(p_access_token_digests) <> pg_catalog.cardinality(p_access_token_key_versions)
     or p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$'
     or p_key_thumbprint is null or p_key_thumbprint !~ '^sha256:[0-9a-f]{64}$'
     or p_audience is distinct from 'skillmap.connector.v1'
     or p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2'
     or p_proof_purpose is distinct from 'protected.import'
     or p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$'
     or p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$'
     or p_issued_at::numeric > 9223372036854775807
     or p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$'
  then
    return private.device_auth_error_json('invalid_request', 'The request is invalid.');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('device-auth-access:' || p_device_id, 7461)
  );

  select * into v_access
  from private.device_auth_access_tokens as access_tokens
  where exists (
    select 1
    from pg_catalog.generate_subscripts(p_access_token_digests, 1) as positions(index)
    where access_tokens.access_token_digest = p_access_token_digests[positions.index]
      and access_tokens.key_version = p_access_token_key_versions[positions.index]
  )
  limit 1
  for update;

  if not found then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;

  select * into v_family
  from private.device_auth_token_families as families
  where families.family_id = v_access.family_id
    and families.device_id = p_device_id
  for update;

  if not found then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;

  select * into v_device
  from private.devices as devices
  where devices.public_id = v_family.device_public_id
    and devices.account_id = v_family.account_id
  for update;

  if not found
     or v_device.state is distinct from 'active'
     or v_device.revoked_at is not null
     or v_family.key_thumbprint is distinct from p_key_thumbprint
     or v_family.proof_suite is distinct from p_proof_suite
     or v_family.audience_literal is distinct from p_audience
     or v_family.state is distinct from 'active'
     or v_family.revoked_at is not null
     or v_access.revoked_at is not null
     or v_access.generation <> v_family.current_generation
     or (v_device.expires_at is not null and v_device.expires_at <= v_now)
     or v_access.expires_at <= v_now
     or v_family.idle_expires_at <= v_now
     or v_family.absolute_expires_at <= v_now
  then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;

  if not exists (
    select 1
    from private.device_auth_key_bindings as bindings
    where bindings.device_id = p_device_id
      and bindings.proof_suite = p_proof_suite
      and bindings.key_thumbprint = p_key_thumbprint
      and bindings.is_active
      and bindings.retired_at is null
  ) then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;

  for v_index in 1..pg_catalog.cardinality(p_access_token_digests) loop
    if v_access.access_token_digest = p_access_token_digests[v_index]
       and v_access.key_version = p_access_token_key_versions[v_index]
    then
      v_key_version := p_access_token_key_versions[v_index];
      exit;
    end if;
  end loop;

  if v_key_version is null then
    return private.device_auth_error_json('invalid_token', 'The access token is invalid.');
  end if;

  begin
    insert into private.device_auth_proof_nonces (
      device_id, proof_purpose, nonce, issued_at, expires_at
    ) values (
      p_device_id, p_proof_purpose, p_proof_nonce,
      pg_catalog.to_timestamp(p_issued_at::bigint),
      v_now + pg_catalog.make_interval(secs => 600)
    );
  exception when unique_violation then
    return private.device_auth_error_json('proof_invalid', 'Device proof is invalid.');
  end;

  v_expires := least(v_access.expires_at, v_family.idle_expires_at, v_family.absolute_expires_at);
  if v_device.expires_at is not null then
    v_expires := least(v_expires, v_device.expires_at);
  end if;

  return pg_catalog.jsonb_build_object(
    'active', true,
    'device_public_id', v_family.device_public_id,
    'account_public_id', v_family.account_public_id,
    'scopes', v_family.scopes,
    'audience', v_family.audience_literal,
    'expires_at', pg_catalog.floor(extract(epoch from v_expires))::bigint
  );
end
$function$;

grant usage, create on schema api to skillmap_device_auth_definer;

alter function api.device_auth_authenticate_import_v1(
  text[],integer[],text,text,text,text,text,text,text,text
) owner to skillmap_device_auth_definer;

revoke all privileges on function api.device_auth_authenticate_import_v1(
  text[],integer[],text,text,text,text,text,text,text,text
) from public, anon, authenticated, service_role;

grant execute on function api.device_auth_authenticate_import_v1(
  text[],integer[],text,text,text,text,text,text,text,text
) to service_role;

revoke create on schema api from skillmap_device_auth_definer;

comment on function api.device_auth_authenticate_import_v1(
  text[],integer[],text,text,text,text,text,text,text,text
) is 'Authenticates an M3 device access token and consumes one protected.import proof nonce for M4 server routes.';

commit;
