begin;

set local search_path = '';

create table private.devices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_id text not null
    default ('dev_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  display_name text,
  platform text not null,
  connector_version text not null,
  locale text,
  state text not null default 'active',
  revision bigint not null default 1,
  issued_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  last_used_at timestamp with time zone,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,

  constraint devices_account_id_id_key unique (account_id, id),
  constraint devices_account_id_public_id_key unique (account_id, public_id),
  constraint devices_public_id_key unique (public_id),
  constraint devices_public_id_format_check
    check (public_id ~ '^dev_[0-9a-f]{32}$'),
  constraint devices_platform_check
    check (platform in ('macos', 'windows', 'linux')),
  constraint devices_connector_version_check
    check (
      pg_catalog.octet_length(connector_version) between 1 and 32
      and connector_version ~ '^(?:0|[1-9][0-9]{0,31})\.(?:0|[1-9][0-9]{0,31})\.(?:0|[1-9][0-9]{0,31})(?:-(?:0|[0-9A-Za-z-][0-9A-Za-z.-]*)(?:\.(?:0|[0-9A-Za-z-][0-9A-Za-z.-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
    ),
  constraint devices_state_check
    check (state in ('active', 'disabled', 'revoked', 'compromised')),
  constraint devices_display_name_length_check
    check (display_name is null or pg_catalog.octet_length(display_name) between 1 and 64),
  constraint devices_display_name_normalized_check
    check (
      display_name is null
      or (display_name = pg_catalog.btrim(display_name) and display_name !~ '[[:cntrl:]]')
    ),
  constraint devices_locale_check
    check (
      locale is null
      or (
        pg_catalog.octet_length(locale) between 2 and 35
        and locale ~ '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$'
      )
    ),
  constraint devices_revision_check
    check (revision > 0),
  constraint devices_issued_le_last_used_check
    check (last_used_at is null or last_used_at >= issued_at),
  constraint devices_expiry_check
    check (expires_at is null or expires_at > issued_at),
  constraint devices_revocation_state_check
    check (revoked_at is null or revoked_at >= issued_at),
  constraint devices_fk_account
    foreign key (account_id) references auth.users (id) on delete cascade
);

create function private.normalize_device_scopes(value text[])
returns text[]
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    array_agg(scope order by scope),
    '{}'::text[]
  )
  from (
    select distinct on (lower(pg_catalog.btrim(value_item)))
      lower(pg_catalog.btrim(value_item)) as scope
    from pg_catalog.unnest(value) as value_item(value_item)
    where pg_catalog.octet_length(pg_catalog.btrim(value_item)) between 1 and 48
    order by lower(pg_catalog.btrim(value_item))
  ) as normalized
  where normalized.scope is not null;
$$;

create function private.device_scopes_are_canonical(value text[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_scope text;
begin
  if pg_catalog.cardinality(value) < 1 or pg_catalog.cardinality(value) > 16 then
    return false;
  end if;

  if private.normalize_device_scopes(value) is distinct from value then
    return false;
  end if;

  if private.valid_text_array(value, 16, 48, '^[a-z][a-z0-9._:-]{0,47}$') is not true then
    return false;
  end if;

  foreach v_scope in array value loop
    if v_scope is distinct from lower(v_scope) then
      return false;
    end if;
    if not (v_scope = any(array['device.route','device.feedback','device.import','device.bundle','device.status'])) then
      return false;
    end if;
  end loop;

  return true;
end
$function$;

create function private.enforce_device_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.display_name := nullif(pg_catalog.btrim(new.display_name), '');
  new.locale := nullif(pg_catalog.btrim(new.locale), '');
  new.platform := pg_catalog.lower(new.platform);

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.public_id is distinct from old.public_id
      or new.account_id is distinct from old.account_id
      or new.platform is distinct from old.platform
      or new.connector_version is distinct from old.connector_version
      or new.display_name is distinct from old.display_name
      or new.locale is distinct from old.locale
      or new.revision is distinct from old.revision
      or new.issued_at is distinct from old.issued_at
    then
      raise exception using
        errcode = '22023',
        message = 'device identity and account metadata are immutable';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.issued_at := coalesce(new.issued_at, pg_catalog.statement_timestamp());
  end if;

  return new;
end
$function$;

create trigger devices_enforce_metadata
before insert or update on private.devices
for each row
execute function private.enforce_device_metadata();

create index devices_live_by_account_idx
  on private.devices (account_id, revision, id)
  where revoked_at is null
    and state = 'active';

create function private.enforce_device_token_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_normalized_scopes text[];
begin
  new.scopes := private.normalize_device_scopes(new.scopes);

  if not private.device_scopes_are_canonical(new.scopes) then
    raise exception using
      errcode = '22023',
      message = 'device token scopes must be canonical, sorted, unique, allowlisted values';
  end if;

  if tg_op = 'INSERT' then
    new.issued_at := coalesce(new.issued_at, pg_catalog.statement_timestamp());
    new.generation := coalesce(new.generation, 0) + 0;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.account_id is distinct from old.account_id
      or new.device_id is distinct from old.device_id
      or new.credential_digest is distinct from old.credential_digest
      or new.key_version is distinct from old.key_version
      or new.generation is distinct from old.generation
      or new.issued_at is distinct from old.issued_at
      or new.scopes is distinct from old.scopes
    then
      raise exception using
        errcode = '22023',
        message = 'device token immutable fields are immutable';
    end if;

    if new.replaced_by_token_id is distinct from old.replaced_by_token_id then
      perform private.assert_device_token_replacement_chain(
        new.account_id,
        new.device_id,
        new.id,
        new.replaced_by_token_id
      );
    end if;
  end if;

  return new;
end
$function$;

create table private.device_tokens (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null,
  device_id uuid not null,
  credential_digest text not null,
  key_version integer not null,
  scopes text[] not null,
  issued_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  last_used_at timestamp with time zone,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  generation bigint not null,
  replaced_by_token_id uuid,

  constraint device_tokens_account_id_id_key unique (account_id, id),
  constraint device_tokens_account_device_generation_key unique (account_id, device_id, generation),
  constraint device_tokens_digest_key unique (credential_digest, key_version),
  constraint device_tokens_credential_digest_format_check
    check (credential_digest ~ '^hmac-sha256:[0-9a-f]{64}$'),
  constraint device_tokens_key_version_check
    check (key_version > 0),
  constraint device_tokens_generation_check
    check (generation > 0),
  constraint device_tokens_scopes_check
    check (private.device_scopes_are_canonical(scopes)),
  constraint device_tokens_binding_fkey
    foreign key (account_id, device_id)
    references private.devices (account_id, id) on delete cascade,
  constraint device_tokens_replaced_by_fkey
    foreign key (replaced_by_token_id)
    references private.device_tokens(id) on delete set null,
  constraint device_tokens_last_used_check
    check (last_used_at is null or last_used_at >= issued_at),
  constraint device_tokens_expiry_check
    check (expires_at is null or expires_at > issued_at),
  constraint device_tokens_revocation_check
    check (revoked_at is null or revoked_at >= issued_at),
  constraint device_tokens_replaced_by_self_check
    check (replaced_by_token_id is null or replaced_by_token_id is distinct from id),
  constraint device_tokens_active_time_check
    check (
      revoked_at is null
      or expires_at is null
      or revoked_at <= coalesce(expires_at, revoked_at)
    )
);

create function private.assert_device_token_replacement_chain(
  p_account_id uuid,
  p_device_id uuid,
  p_source_token_id uuid,
  p_target_token_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token_id uuid := p_target_token_id;
  v_token_row private.device_tokens%rowtype;
  v_seen uuid[];
begin
  if p_source_token_id is null and p_target_token_id is null then
    return;
  end if;

  if p_source_token_id is not null then
    if p_source_token_id = p_target_token_id then
      raise exception 'device token replacement cannot self-reference' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from private.device_tokens as tokens
      where tokens.id = p_source_token_id
        and tokens.account_id = p_account_id
        and tokens.device_id = p_device_id
    ) then
      raise exception 'device token replacement source is outside the same account/device lineage'
        using errcode = '22023';
    end if;
  end if;

  if p_target_token_id is null then
    return;
  end if;

  if not exists (
    select 1
    from private.device_tokens as tokens
    where tokens.id = p_target_token_id
      and tokens.account_id = p_account_id
      and tokens.device_id = p_device_id
  ) then
    raise exception 'device token replacement target is outside the same account/device lineage'
      using errcode = '22023';
  end if;

  if exists(
    select 1
    from private.device_tokens as tokens
    where tokens.account_id = p_account_id
      and tokens.device_id = p_device_id
      and tokens.replaced_by_token_id = p_target_token_id
      and tokens.id is distinct from p_source_token_id
  ) then
    raise exception 'device token replacement would create a replacement branch' using errcode = '22023';
  end if;

  while v_token_id is not null loop
    if v_token_id = any (v_seen) then
      raise exception 'device token replacement would create a cycle' using errcode = '22023';
    end if;

    v_seen := array_append(v_seen, v_token_id);

    select tokens.*
    into v_token_row
    from private.device_tokens as tokens
    where tokens.id = v_token_id
      and tokens.account_id = p_account_id
      and tokens.device_id = p_device_id;

    if not found then
      raise exception 'device token replacement target is outside the same account/device lineage'
        using errcode = '22023';
    end if;

    if p_source_token_id is not null and v_token_row.id = p_source_token_id then
      raise exception 'device token replacement would create a cycle' using errcode = '22023';
    end if;

    v_token_id := v_token_row.replaced_by_token_id;
  end loop;
end
$function$;

create index device_tokens_live_by_account_idx
  on private.device_tokens (account_id, device_id, generation)
  where revoked_at is null
    and replaced_by_token_id is null;

create unique index device_tokens_replacement_target_idx
  on private.device_tokens (account_id, device_id, replaced_by_token_id)
  where replaced_by_token_id is not null;

create trigger device_tokens_enforce_immutability
before insert or update on private.device_tokens
for each row
execute function private.enforce_device_token_immutability();

alter table private.device_tokens alter column scopes set not null;

create function private.issue_device(
  p_account_id uuid,
  p_display_name text,
  p_platform text,
  p_connector_version text,
  p_locale text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_device_id uuid;
begin
  if p_account_id is null
    or p_platform is null
    or p_platform not in ('macos', 'windows', 'linux')
    or p_connector_version is null
  then
    raise exception 'invalid device issuance request' using errcode = '22023';
  end if;

  insert into private.devices (
    account_id, display_name, platform, connector_version, locale
  ) values (
    p_account_id,
    p_display_name,
    lower(pg_catalog.btrim(p_platform)),
    p_connector_version,
    p_locale
  ) returning id into v_device_id;

  return v_device_id;
end
$function$;

create function private.issue_device_token(
  p_account_id uuid,
  p_device_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_scopes text[],
  p_expires_at timestamp with time zone default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_device_row private.devices%rowtype;
  v_next_generation bigint;
  v_token_id uuid;
  v_scopes text[];
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if p_account_id is null
    or p_device_id is null
    or p_credential_digest is null
    or p_key_version is null
    or p_key_version <= 0
    or p_scopes is null
  then
    raise exception 'invalid token issuance request' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= v_now then
    raise exception 'token expiry must be in the future' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 0)
  );

  select devices.*
  into v_device_row
  from private.devices as devices
  where devices.account_id = p_account_id
    and devices.id = p_device_id
  for update;

  if not found then
    raise exception 'device is unavailable for token issuance' using errcode = '22023';
  end if;

  if v_device_row.state is distinct from 'active' or v_device_row.revoked_at is not null then
    raise exception 'device is not active' using errcode = '42501';
  end if;

  if v_device_row.expires_at is not null and v_device_row.expires_at <= v_now then
    raise exception 'device is expired' using errcode = '42501';
  end if;

  v_scopes := private.normalize_device_scopes(p_scopes);
  if not private.device_scopes_are_canonical(v_scopes) then
    raise exception 'invalid device token scope set' using errcode = '22023';
  end if;

  select coalesce(max(generation), 0) + 1
  into v_next_generation
  from private.device_tokens as tokens
  where tokens.account_id = p_account_id
    and tokens.device_id = p_device_id;

  insert into private.device_tokens (
    account_id,
    device_id,
    credential_digest,
    key_version,
    scopes,
    issued_at,
    expires_at,
    generation
  ) values (
    p_account_id,
    p_device_id,
    p_credential_digest,
    p_key_version,
    v_scopes,
    v_now,
    p_expires_at,
    v_next_generation
  ) returning id into v_token_id;

  return v_token_id;
end
$function$;

create function private.rotate_device_token(
  p_account_id uuid,
  p_old_token_id uuid,
  p_new_credential_digest text,
  p_new_key_version integer,
  p_new_scopes text[],
  p_new_expires_at timestamp with time zone default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_token private.device_tokens%rowtype;
  v_scopes text[];
  v_next_generation bigint;
  v_new_token_id uuid;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if p_account_id is null
    or p_old_token_id is null
    or p_new_credential_digest is null
    or p_new_key_version is null
    or p_new_key_version <= 0
    or p_new_scopes is null
  then
    raise exception 'invalid token rotation request' using errcode = '22023';
  end if;

  if p_new_expires_at is not null and p_new_expires_at <= v_now then
    raise exception 'token expiry must be in the future' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 0)
  );

  select tokens.*
  into v_old_token
  from private.device_tokens as tokens
  where tokens.account_id = p_account_id
    and tokens.id = p_old_token_id
  for update;

  if not found then
    raise exception 'old token was not found for this account' using errcode = '22023';
  end if;

  if v_old_token.revoked_at is not null
    or v_old_token.replaced_by_token_id is not null
    or (v_old_token.expires_at is not null and v_old_token.expires_at <= v_now)
  then
    raise exception 'old token is not eligible for rotation' using errcode = '22023';
  end if;

  if v_old_token.key_version >= p_new_key_version then
    raise exception 'new key version must be greater than the old key version' using errcode = '22023';
  end if;

  v_scopes := private.normalize_device_scopes(p_new_scopes);
  if not private.device_scopes_are_canonical(v_scopes) then
    raise exception 'invalid device token scope set' using errcode = '22023';
  end if;

  select coalesce(max(generation), 0) + 1
  into v_next_generation
  from private.device_tokens as tokens
  where tokens.account_id = p_account_id
    and tokens.device_id = v_old_token.device_id;

  insert into private.device_tokens (
    account_id,
    device_id,
    credential_digest,
    key_version,
    scopes,
    issued_at,
    expires_at,
    generation
  ) values (
    v_old_token.account_id,
    v_old_token.device_id,
    p_new_credential_digest,
    p_new_key_version,
    v_scopes,
    v_now,
    p_new_expires_at,
    v_next_generation
  ) returning id into v_new_token_id;

  update private.device_tokens
  set
    replaced_by_token_id = v_new_token_id,
    revoked_at = v_now
  where id = p_old_token_id
    and account_id = p_account_id;

  return v_new_token_id;
end
$function$;

create function private.revoke_device_token(
  p_account_id uuid,
  p_token_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token private.device_tokens%rowtype;
begin
  if p_account_id is null or p_token_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 0)
  );

  select tokens.* into v_token
  from private.device_tokens as tokens
  where tokens.account_id = p_account_id
    and tokens.id = p_token_id
  for update;

  if not found then
    return false;
  end if;

  if v_token.revoked_at is not null then
    return true;
  end if;

  update private.device_tokens
  set revoked_at = pg_catalog.statement_timestamp()
  where id = p_token_id and account_id = p_account_id;

  return true;
end
$function$;

create function private.authorize_device_token(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token_row private.device_tokens%rowtype;
  v_device_row private.devices%rowtype;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if p_account_id is null
    or p_credential_digest is null
    or p_key_version is null
    or p_key_version <= 0
  then
    return null;
  end if;

  if p_credential_digest !~ '^hmac-sha256:[0-9a-f]{64}$' then
    return null;
  end if;

  select tokens.*
    into v_token_row
  from private.device_tokens as tokens
  where tokens.account_id = p_account_id
    and tokens.credential_digest = p_credential_digest
    and tokens.key_version = p_key_version
    and tokens.revoked_at is null
    and tokens.replaced_by_token_id is null
    and (tokens.expires_at is null or tokens.expires_at > v_now)
  limit 1;

  if not found then
    return null;
  end if;

  select devices.*
    into v_device_row
  from private.devices as devices
  where devices.account_id = p_account_id
    and devices.id = v_token_row.device_id
  for update;

  if not found
    or v_device_row.state is distinct from 'active'
    or v_device_row.revoked_at is not null
    or (v_device_row.expires_at is not null and v_device_row.expires_at <= v_now)
  then
    return null;
  end if;

  update private.device_tokens
  set last_used_at = v_now
  where id = v_token_row.id
    and account_id = p_account_id;

  update private.devices
  set last_used_at = v_now
  where id = v_device_row.id
    and account_id = p_account_id;

  return v_token_row.id;
end
$function$;

revoke all privileges on table private.devices
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.device_tokens
  from public, anon, authenticated, service_role, skillmap_vault_definer;

revoke all privileges on function private.normalize_device_scopes(text[])
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.device_scopes_are_canonical(text[])
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.assert_device_token_replacement_chain(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_device_metadata()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_device_token_immutability()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.issue_device(
  uuid, text, text, text, text
) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.issue_device_token(
  uuid, uuid, text, integer, text[], timestamp with time zone
) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.rotate_device_token(
  uuid, uuid, text, integer, text[], timestamp with time zone
) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.revoke_device_token(uuid, uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.authorize_device_token(uuid, text, integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

alter table private.devices enable row level security;
alter table private.devices force row level security;
alter table private.device_tokens enable row level security;
alter table private.device_tokens force row level security;

-- Intentionally no row-level security policies and no grants before M2.11.

commit;
