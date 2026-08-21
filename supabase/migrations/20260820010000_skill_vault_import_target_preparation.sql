begin;

set local search_path = '';

alter table private.managed_skills
  drop constraint managed_skills_display_name_length_check;
alter table private.managed_skills
  add constraint managed_skills_display_name_length_check
  check (
    pg_catalog.char_length(display_name) between 1 and 200
    and pg_catalog.octet_length(display_name) <= 800
  ) not valid;
alter table private.managed_skills
  validate constraint managed_skills_display_name_length_check;

create table private.import_target_preparations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null,
  device_id uuid not null,
  idempotency_key uuid not null,
  request_digest text not null,
  managed_skill_id uuid not null,
  version_id uuid not null,
  response jsonb not null,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint import_target_preparations_account_device_key
    unique (account_id, device_id, idempotency_key),
  constraint import_target_preparations_account_id_id_key
    unique (account_id, id),
  constraint import_target_preparations_device_fkey
    foreign key (account_id, device_id)
    references private.devices (account_id, id)
    on delete cascade,
  constraint import_target_preparations_skill_fkey
    foreign key (account_id, managed_skill_id)
    references private.managed_skills (account_id, id)
    on delete cascade,
  constraint import_target_preparations_version_fkey
    foreign key (account_id, managed_skill_id, version_id)
    references private.managed_skill_versions (account_id, managed_skill_id, id)
    on delete cascade,
  constraint import_target_preparations_request_digest_check
    check (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_target_preparations_response_check
    check (
      pg_catalog.jsonb_typeof(response) = 'object'
      and pg_catalog.octet_length(response::text) <= 4194304
    )
);

alter table private.import_target_preparations enable row level security;
alter table private.import_target_preparations force row level security;

revoke all privileges on table private.import_target_preparations
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.resolve_import_owner_context(
  p_account_public_id text,
  p_device_public_id text
)
returns table (account_id uuid, device_id uuid)
language sql
security definer
set search_path = ''
as $function$
  select devices.account_id, devices.id
  from private.devices as devices
  where p_account_public_id ~ '^acct_[0-9a-f]{32}$'
    and p_device_public_id ~ '^dev_[0-9a-f]{32}$'
    and devices.public_id = p_device_public_id
    and p_account_public_id = 'acct_' || pg_catalog.replace(devices.account_id::text, '-', '')
    and devices.state = 'active'
    and devices.revoked_at is null
    and (devices.expires_at is null or devices.expires_at > pg_catalog.statement_timestamp())
  limit 1;
$function$;

create function private.compute_import_content_digest(
  p_manifest_digest text,
  p_files jsonb
)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('skillmap.skill-version', 'UTF8') || pg_catalog.decode('00', 'hex') ||
      pg_catalog.convert_to('v1', 'UTF8') || pg_catalog.decode('00', 'hex') ||
      pg_catalog.convert_to('manifest-digest', 'UTF8') || pg_catalog.decode('00', 'hex') ||
      pg_catalog.convert_to('v1', 'UTF8') || pg_catalog.decode('00', 'hex') ||
      pg_catalog.decode(pg_catalog.substr(p_manifest_digest, 8), 'hex') ||
      pg_catalog.int4send(pg_catalog.jsonb_array_length(p_files)) ||
      coalesce((
        select pg_catalog.string_agg(
          pg_catalog.convert_to('file-entry', 'UTF8') || pg_catalog.decode('00', 'hex') ||
          pg_catalog.convert_to('v1', 'UTF8') || pg_catalog.decode('00', 'hex') ||
          pg_catalog.int4send(pg_catalog.octet_length(pg_catalog.convert_to(item.value ->> 'relative_path', 'UTF8'))) ||
          pg_catalog.convert_to(item.value ->> 'relative_path', 'UTF8') ||
          pg_catalog.int8send((item.value ->> 'byte_size')::bigint) ||
          pg_catalog.convert_to('file-digest', 'UTF8') || pg_catalog.decode('00', 'hex') ||
          pg_catalog.convert_to('v1', 'UTF8') || pg_catalog.decode('00', 'hex') ||
          pg_catalog.decode(pg_catalog.substr(item.value ->> 'file_digest', 8), 'hex'),
          ''::bytea
          order by pg_catalog.convert_to(item.value ->> 'relative_path', 'UTF8')
        )
        from pg_catalog.jsonb_array_elements(p_files) as item(value)
      ), ''::bytea),
      'sha256'
    ),
    'hex'
  );
$function$;

create function device_adapter.adapter_prepare_import_target(
  p_account_public_id text,
  p_device_public_id text,
  p_display_name text,
  p_description text,
  p_manifest_schema_version text,
  p_manifest_projection bytea,
  p_manifest_digest text,
  p_content_digest text,
  p_canonical_metadata jsonb,
  p_source jsonb,
  p_provenance_state text,
  p_files jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_request_digest text;
  v_existing private.import_target_preparations%rowtype;
  v_skill private.managed_skills%rowtype;
  v_version private.managed_skill_versions%rowtype;
  v_release private.managed_skill_releases%rowtype;
  v_file jsonb;
  v_file_id uuid;
  v_file_public_id text;
  v_files_response jsonb;
  v_response jsonb;
  v_count integer;
  v_total numeric;
  v_reused boolean := false;
  v_manifest jsonb;
  v_manifest_files jsonb;
  v_expected_metadata jsonb;
begin
  select * into v_context
  from private.resolve_import_owner_context(p_account_public_id, p_device_public_id);

  if not found then
    raise exception 'import authority unavailable' using errcode = '42501';
  end if;

  if p_idempotency_key is null
    or p_display_name is null
    or pg_catalog.char_length(pg_catalog.btrim(p_display_name)) not between 1 and 200
    or pg_catalog.octet_length(pg_catalog.btrim(p_display_name)) > 800
    or (p_description is not null and pg_catalog.octet_length(p_description) > 2048)
    or p_manifest_schema_version !~ '^[0-9]+\.[0-9]+$'
    or pg_catalog.octet_length(p_manifest_projection) not between 1 and 262144
    or p_manifest_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_content_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_manifest_digest <> 'sha256:' || pg_catalog.encode(extensions.digest(p_manifest_projection, 'sha256'), 'hex')
    or pg_catalog.jsonb_typeof(p_canonical_metadata) <> 'object'
    or pg_catalog.jsonb_typeof(p_source) <> 'object'
    or p_provenance_state is null
    or p_provenance_state !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    or pg_catalog.jsonb_typeof(p_files) <> 'array'
    or pg_catalog.jsonb_array_length(p_files) not between 1 and 2048
  then
    raise exception 'invalid import target preparation' using errcode = '22023';
  end if;

  begin
    v_manifest := pg_catalog.convert_from(p_manifest_projection, 'UTF8')::jsonb;
  exception
    when character_not_in_repertoire or untranslatable_character or invalid_text_representation then
      raise exception 'invalid canonical import manifest' using errcode = '22023';
  end;

  if pg_catalog.jsonb_typeof(v_manifest) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_manifest -> 'schema_version') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_manifest -> 'identity') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_manifest #> '{identity,logical_id}') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_manifest -> 'display') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_manifest #> '{display,name}') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_manifest #> '{display,description}') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_manifest -> 'source') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_manifest -> 'files') is distinct from 'array'
  then
    raise exception 'invalid canonical import manifest' using errcode = '22023';
  end if;

  v_expected_metadata := pg_catalog.jsonb_build_object(
    'logical_id', pg_catalog.btrim(v_manifest #>> '{identity,logical_id}'),
    'display_name', pg_catalog.btrim(v_manifest #>> '{display,name}')
  );
  if nullif(pg_catalog.btrim(v_manifest #>> '{display,description}'), '') is not null then
    v_expected_metadata := v_expected_metadata || pg_catalog.jsonb_build_object(
      'description', pg_catalog.btrim(v_manifest #>> '{display,description}')
    );
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'relative_path', item.value ->> 'path',
      'media_type', item.value ->> 'media_type',
      'byte_size', item.value -> 'utf8_bytes',
      'file_digest', item.value ->> 'digest',
      'executable', item.value -> 'executable',
      'ordinal', item.ordinality - 1
    ) order by item.ordinality
  ) into v_manifest_files
  from pg_catalog.jsonb_array_elements(v_manifest -> 'files') with ordinality as item(value, ordinality);

  v_manifest_files := coalesce(v_manifest_files, '[]'::jsonb);

  if pg_catalog.btrim(p_manifest_schema_version) <> v_manifest ->> 'schema_version'
    or pg_catalog.btrim(p_display_name) <> pg_catalog.btrim(v_manifest #>> '{display,name}')
    or coalesce(p_description, '') <> v_manifest #>> '{display,description}'
    or p_canonical_metadata <> v_expected_metadata
    or p_source <> v_manifest -> 'source'
    or p_files <> v_manifest_files
  then
    raise exception 'import target projection does not match canonical manifest' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_files) as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
      or (item.value - array['relative_path', 'media_type', 'byte_size', 'file_digest', 'executable', 'ordinal']) <> '{}'::jsonb
      or not (item.value ?& array['relative_path', 'media_type', 'byte_size', 'file_digest', 'executable', 'ordinal'])
      or pg_catalog.jsonb_typeof(item.value -> 'relative_path') <> 'string'
      or pg_catalog.jsonb_typeof(item.value -> 'media_type') <> 'string'
      or pg_catalog.jsonb_typeof(item.value -> 'byte_size') <> 'number'
      or pg_catalog.jsonb_typeof(item.value -> 'file_digest') <> 'string'
      or pg_catalog.jsonb_typeof(item.value -> 'executable') <> 'boolean'
      or pg_catalog.jsonb_typeof(item.value -> 'ordinal') <> 'number'
      or (item.value ->> 'relative_path') !~ '^[^/\\[:cntrl:]]+(?:/[^/\\[:cntrl:]]+)*$'
      or (item.value ->> 'relative_path') ~ '(^|/)[.][.]?(/|$)'
      or (item.value ->> 'file_digest') !~ '^sha256:[0-9a-f]{64}$'
      or ((item.value ->> 'byte_size')::numeric % 1) <> 0
      or ((item.value ->> 'byte_size')::numeric) not between 0 and 16777216
      or ((item.value ->> 'ordinal')::numeric % 1) <> 0
      or ((item.value ->> 'ordinal')::numeric) < 0
  ) then
    raise exception 'invalid import target file projection' using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer, coalesce(pg_catalog.sum((item.value ->> 'byte_size')::numeric), 0::numeric)
  into v_count, v_total
  from pg_catalog.jsonb_array_elements(p_files) as item(value);

  if v_total > 67108864
    or v_count <> (
      select pg_catalog.count(distinct (item.value ->> 'ordinal'))::integer
      from pg_catalog.jsonb_array_elements(p_files) as item(value)
    )
    or v_count <> (
      select pg_catalog.count(distinct (item.value ->> 'relative_path'))::integer
      from pg_catalog.jsonb_array_elements(p_files) as item(value)
    )
    or exists (
      select 1
      from pg_catalog.generate_series(0, v_count - 1) as expected(ordinal)
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_files) as item(value)
        where (item.value ->> 'ordinal')::integer = expected.ordinal
      )
    )
  then
    raise exception 'import target file projection is not exact' using errcode = '22023';
  end if;

  if p_content_digest <> private.compute_import_content_digest(p_manifest_digest, p_files) then
    raise exception 'import content digest does not match canonical projection' using errcode = '22023';
  end if;

  v_request_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'display_name', pg_catalog.btrim(p_display_name),
          'description', nullif(pg_catalog.btrim(p_description), ''),
          'manifest_schema_version', pg_catalog.btrim(p_manifest_schema_version),
          'manifest_projection_base64', pg_catalog.encode(p_manifest_projection, 'base64'),
          'manifest_digest', p_manifest_digest,
          'content_digest', p_content_digest,
          'canonical_metadata', p_canonical_metadata,
          'source', p_source,
          'provenance_state', p_provenance_state,
          'files', p_files
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_context.account_id::text, 4));

  select preparations.* into v_existing
  from private.import_target_preparations as preparations
  where preparations.account_id = v_context.account_id
    and preparations.device_id = v_context.device_id
    and preparations.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.request_digest <> v_request_digest then
      raise exception 'conflicting import target idempotency reuse' using errcode = '22023';
    end if;
    return v_existing.response;
  end if;

  select versions.* into v_version
  from private.managed_skill_versions as versions
  where versions.account_id = v_context.account_id
    and versions.manifest_digest = p_manifest_digest
    and versions.content_digest = p_content_digest
    and versions.canonical_metadata = p_canonical_metadata
    and versions.source = p_source
  order by versions.created_at, versions.public_id
  limit 1;

  if found then
    select skills.* into strict v_skill
    from private.managed_skills as skills
    where skills.account_id = v_version.account_id
      and skills.id = v_version.managed_skill_id;

    if v_count <> (
      select pg_catalog.count(*)::integer
      from private.managed_skill_files as files
      where files.account_id = v_context.account_id and files.version_id = v_version.id
    ) or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_files) as item(value)
      where not exists (
        select 1
        from private.managed_skill_files as files
        where files.account_id = v_context.account_id
          and files.version_id = v_version.id
          and files.relative_path = item.value ->> 'relative_path'
          and files.media_type = item.value ->> 'media_type'
          and files.byte_size = (item.value ->> 'byte_size')::bigint
          and files.file_digest = item.value ->> 'file_digest'
          and files.executable = (item.value ->> 'executable')::boolean
          and files.ordinal = (item.value ->> 'ordinal')::integer
      )
    ) then
      raise exception 'existing manifest identity has a conflicting file projection' using errcode = '22023';
    end if;
    v_reused := true;
  else
    select skills.* into v_skill
    from private.managed_skills as skills
    join private.managed_skill_versions as versions
      on versions.account_id = skills.account_id
     and versions.managed_skill_id = skills.id
    where skills.account_id = v_context.account_id
      and versions.canonical_metadata ->> 'logical_id' = p_canonical_metadata ->> 'logical_id'
    order by skills.created_at, skills.public_id, versions.created_at, versions.public_id
    limit 1
    for update of skills;

    if not found then
      insert into private.managed_skills (account_id, display_name, description)
      values (v_context.account_id, pg_catalog.btrim(p_display_name), nullif(pg_catalog.btrim(p_description), ''))
      returning * into v_skill;
    else
      update private.managed_skills as skills
      set display_name = pg_catalog.btrim(p_display_name),
          description = nullif(pg_catalog.btrim(p_description), ''),
          updated_at = pg_catalog.statement_timestamp()
      where skills.account_id = v_skill.account_id and skills.id = v_skill.id
      returning skills.* into v_skill;
    end if;

    insert into private.managed_skill_versions (
      account_id, managed_skill_id, manifest_schema_version, manifest_projection,
      manifest_digest, content_digest, canonical_metadata, source,
      provenance_state, analysis_state
    ) values (
      v_context.account_id, v_skill.id, pg_catalog.btrim(p_manifest_schema_version), p_manifest_projection,
      p_manifest_digest, p_content_digest, p_canonical_metadata, p_source,
      p_provenance_state, 'pending'
    ) returning * into v_version;

    for v_file in
      select item.value
      from pg_catalog.jsonb_array_elements(p_files) as item(value)
      order by (item.value ->> 'ordinal')::integer
    loop
      v_file_id := pg_catalog.gen_random_uuid();
      v_file_public_id := 'msf_' || pg_catalog.replace(v_file_id::text, '-', '');
      insert into private.managed_skill_files (
        id, public_id, account_id, managed_skill_id, version_id,
        relative_path, media_type, byte_size, file_digest, storage_key,
        executable, ordinal
      ) values (
        v_file_id, v_file_public_id, v_context.account_id, v_skill.id, v_version.id,
        v_file ->> 'relative_path', v_file ->> 'media_type',
        (v_file ->> 'byte_size')::bigint, v_file ->> 'file_digest',
        'v1/' || v_version.public_id || '/' || v_file_public_id,
        (v_file ->> 'executable')::boolean, (v_file ->> 'ordinal')::integer
      );
    end loop;
  end if;

  insert into private.managed_skill_releases (
    account_id, managed_skill_id, version_id, lifecycle_state, eligibility_reasons
  ) values (
    v_context.account_id, v_skill.id, v_version.id, 'needs-review', array['analysis_pending']::text[]
  )
  on conflict (account_id, managed_skill_id, version_id) do nothing;

  select releases.* into v_release
  from private.managed_skill_releases as releases
  where releases.account_id = v_context.account_id
    and releases.managed_skill_id = v_skill.id
    and releases.version_id = v_version.id;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'file_public_id', files.public_id,
        'relative_path', files.relative_path,
        'media_type', files.media_type,
        'byte_size', files.byte_size,
        'file_digest', files.file_digest,
        'storage_key', files.storage_key,
        'executable', files.executable,
        'ordinal', files.ordinal
      ) order by files.ordinal
    ),
    '[]'::jsonb
  ) into v_files_response
  from private.managed_skill_files as files
  where files.account_id = v_context.account_id and files.version_id = v_version.id;

  v_response := pg_catalog.jsonb_build_object(
    'skill_public_id', v_skill.public_id,
    'version_public_id', v_version.public_id,
    'release_public_id', v_release.public_id,
    'manifest_digest', v_version.manifest_digest,
    'content_digest', v_version.content_digest,
    'file_count', v_count,
    'byte_total', v_total::bigint,
    'reused', v_reused,
    'files', v_files_response
  );

  insert into private.import_target_preparations (
    account_id, device_id, idempotency_key, request_digest,
    managed_skill_id, version_id, response
  ) values (
    v_context.account_id, v_context.device_id, p_idempotency_key, v_request_digest,
    v_skill.id, v_version.id, v_response
  );

  return v_response;
end
$function$;

revoke all privileges on function private.resolve_import_owner_context(text,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.compute_import_content_digest(text,jsonb)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

revoke all privileges on function device_adapter.adapter_prepare_import_target(
  text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid
) from public, anon, authenticated, service_role, skillmap_vault_definer;

grant execute on function device_adapter.adapter_prepare_import_target(
  text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid
) to service_role;

comment on table private.import_target_preparations is
  'Device-scoped idempotency receipts for atomic managed skill/version/file target preparation.';
comment on function device_adapter.adapter_prepare_import_target(
  text,text,text,text,text,bytea,text,text,jsonb,jsonb,text,jsonb,uuid
) is 'Uses a separately authenticated M3 public owner/device context to create or exactly reuse one non-active managed import target.';

commit;
