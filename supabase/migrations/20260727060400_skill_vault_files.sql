begin;

set local search_path = '';

create table private.managed_skill_files (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_id text not null
    default ('msf_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  managed_skill_id uuid not null,
  version_id uuid not null,

  relative_path text not null,
  media_type text not null,
  byte_size bigint not null,
  file_digest text not null,
  storage_key text not null,
  executable boolean not null,
  ordinal integer not null,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint managed_skill_files_public_id_key unique (public_id),
  constraint managed_skill_files_account_id_id_key unique (account_id, id),
  constraint managed_skill_files_account_skill_version_id_key
    unique (account_id, managed_skill_id, version_id, id),
  constraint managed_skill_files_skill_fkey
    foreign key (account_id, managed_skill_id)
    references private.managed_skills (account_id, id)
    on delete cascade,
  constraint managed_skill_files_version_fkey
    foreign key (account_id, managed_skill_id, version_id)
    references private.managed_skill_versions (account_id, managed_skill_id, id)
    on delete cascade,
  constraint managed_skill_files_public_id_format_check
    check (public_id ~ '^msf_[0-9a-f]{32}$'),
  constraint managed_skill_files_relative_path_check
    check (
      pg_catalog.octet_length(relative_path) between 1 and 512
      and relative_path is not distinct from normalize(relative_path, NFC)
      and left(relative_path, 1) <> '/'
      and relative_path !~ '^[A-Za-z][A-Za-z0-9+.-]*:'
      and position(E'\\' in relative_path) = 0
      and relative_path !~ '(^|/)(/|$)'
      and relative_path !~ '(^|/)[.][.]?(/|$)'
      and relative_path !~ '[[:cntrl:]]'
      and pg_catalog.cardinality(pg_catalog.string_to_array(relative_path, '/')) between 1 and 32
    ),
  constraint managed_skill_files_media_type_check
    check (
      pg_catalog.octet_length(media_type) between 1 and 128
      and media_type = pg_catalog.btrim(media_type)
      and media_type is not distinct from normalize(media_type, NFC)
      and media_type !~ '[[:cntrl:]]'
    ),
  constraint managed_skill_files_byte_size_check
    check (byte_size between 0 and 16777216),
  constraint managed_skill_files_skill_markdown_size_check
    check (relative_path <> 'SKILL.md' or byte_size <= 1048576),
  constraint managed_skill_files_file_digest_format_check
    check (file_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint managed_skill_files_storage_key_check
    check (
      pg_catalog.octet_length(storage_key) between 1 and 512
      and storage_key !~ '[[:cntrl:]]'
    ),
  constraint managed_skill_files_ordinal_check
    check (ordinal >= 0),
  constraint managed_skill_files_version_path_key
    unique (account_id, version_id, relative_path),
  constraint managed_skill_files_version_ordinal_key
    unique (account_id, version_id, ordinal),
  constraint managed_skill_files_storage_key_key
    unique (storage_key)
);

create index managed_skill_files_version_lock_idx
  on private.managed_skill_files (account_id, managed_skill_id, version_id, id);

comment on table private.managed_skill_files is
  'Private immutable per-version file identity and opaque blob-reference metadata; storage objects are owned by a later migration.';
comment on column private.managed_skill_files.id is
  'Internal UUID identity; never exposed through an API projection.';
comment on column private.managed_skill_files.public_id is
  'Stable public file identifier in msf_ plus 32 lowercase hexadecimal format.';
comment on column private.managed_skill_files.relative_path is
  'Already-canonical NFC relative path; SQL stores no normalized alias or alternate spelling.';
comment on column private.managed_skill_files.file_digest is
  'SHA-256 digest of the exact accepted file bytes, represented as lowercase sha256 text.';
comment on column private.managed_skill_files.storage_key is
  'Opaque bounded reference reserved for the later private-storage binding; no storage object is created here.';

create function private.enforce_managed_skill_file_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.public_id is distinct from old.public_id
      or new.account_id is distinct from old.account_id
      or new.managed_skill_id is distinct from old.managed_skill_id
      or new.version_id is distinct from old.version_id
      or new.relative_path is distinct from old.relative_path
      or new.media_type is distinct from old.media_type
      or new.byte_size is distinct from old.byte_size
      or new.file_digest is distinct from old.file_digest
      or new.storage_key is distinct from old.storage_key
      or new.executable is distinct from old.executable
      or new.ordinal is distinct from old.ordinal
      or new.created_at is distinct from old.created_at
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill file identity and content coordinates are immutable';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.statement_timestamp();
  end if;
  return new;
end
$function$;

create trigger managed_skill_files_enforce_immutability
before insert or update on private.managed_skill_files
for each row
execute function private.enforce_managed_skill_file_immutability();

create function private.enforce_managed_version_file_bounds()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_managed_skill_id uuid;
  v_version_id uuid;
  v_locked_version_id uuid;
  v_parent_exists boolean;
  v_file_id uuid;
  v_file_count bigint;
  v_total_bytes numeric;
begin
  if tg_op = 'DELETE' then
    v_account_id := old.account_id;
    v_managed_skill_id := old.managed_skill_id;
    v_version_id := old.version_id;
  else
    v_account_id := new.account_id;
    v_managed_skill_id := new.managed_skill_id;
    v_version_id := new.version_id;
  end if;

  select versions.id
  into v_locked_version_id
  from private.managed_skill_versions as versions
  where versions.account_id = v_account_id
    and versions.managed_skill_id = v_managed_skill_id
    and versions.id = v_version_id
  for update;
  v_parent_exists := found;

  -- Cascading deletion of a version may leave deferred file events after the
  -- parent is gone. No aggregate remains to validate in that case.
  if not v_parent_exists then
    return null;
  end if;

  -- The parent version is locked before any child file row. The ordered loop
  -- acquires every matching file-row lock in the global ID order and performs
  -- no external operation.
  for v_file_id in
    select files.id
    from private.managed_skill_files as files
    where files.account_id = v_account_id
      and files.managed_skill_id = v_managed_skill_id
      and files.version_id = v_version_id
    order by files.id
    for update
  loop
    null;
  end loop;

  select count(*)::bigint, coalesce(sum(files.byte_size), 0::numeric)
  into v_file_count, v_total_bytes
  from private.managed_skill_files as files
  where files.account_id = v_account_id
    and files.managed_skill_id = v_managed_skill_id
    and files.version_id = v_version_id;

  if v_file_count > 2048 then
    raise exception using
      errcode = '23514',
      message = 'managed skill version file count exceeds the bounded maximum';
  end if;

  if v_total_bytes > 67108864::numeric then
    raise exception using
      errcode = '23514',
      message = 'managed skill version aggregate file bytes exceed the bounded maximum';
  end if;

  return null;
end
$function$;

create constraint trigger managed_skill_files_enforce_version_bounds
after insert or update or delete on private.managed_skill_files
deferrable initially deferred
for each row
execute function private.enforce_managed_version_file_bounds();

revoke all privileges on table private.managed_skill_files
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_managed_skill_file_immutability()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_managed_version_file_bounds()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

alter table private.managed_skill_files enable row level security;
alter table private.managed_skill_files force row level security;

-- Intentionally no row-level security policies are created in this migration.

commit;
