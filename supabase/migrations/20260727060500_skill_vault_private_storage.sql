begin;

set local search_path = '';

-- M2.06 owns one private bucket only.  An existing bucket is accepted only
-- when it already has this exact contract; a conflicting bucket is never
-- weakened or repaired implicitly.
do $bucket$
declare
  v_name text;
  v_public boolean;
  v_file_size_limit bigint;
  v_allowed_mime_types text[];
begin
  select
    buckets.name,
    buckets.public,
    buckets.file_size_limit,
    buckets.allowed_mime_types
  into
    v_name,
    v_public,
    v_file_size_limit,
    v_allowed_mime_types
  from storage.buckets as buckets
  where buckets.id = 'skill-vault-private'
  for update;

  if not found then
    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    ) values (
      'skill-vault-private',
      'skill-vault-private',
      false,
      16777216,
      null
    );
  elsif v_name is distinct from 'skill-vault-private'
    or v_public is distinct from false
    or v_file_size_limit is distinct from 16777216
    or v_allowed_mime_types is not null
  then
    raise exception using
      errcode = 'check_violation',
      message = 'skill-vault-private bucket exists with a conflicting contract';
  end if;
end
$bucket$;

create function private.enforce_skill_vault_bucket_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and old.id = 'skill-vault-private' then
    raise exception using
      errcode = '23514',
      message = 'skill-vault-private bucket contract is immutable';
  end if;

  if tg_op = 'UPDATE' and old.id = 'skill-vault-private'
    and (
      new.id is distinct from old.id
      or new.name is distinct from 'skill-vault-private'
      or new.public is distinct from false
      or new.file_size_limit is distinct from 16777216
      or new.allowed_mime_types is not null
    )
  then
    raise exception using
      errcode = '23514',
      message = 'skill-vault-private bucket contract is immutable';
  end if;

  if tg_op <> 'DELETE' and new.id = 'skill-vault-private'
    and (
      new.name is distinct from 'skill-vault-private'
      or new.public is distinct from false
      or new.file_size_limit is distinct from 16777216
      or new.allowed_mime_types is not null
    )
  then
    raise exception using
      errcode = '23514',
      message = 'skill-vault-private bucket contract is invalid';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

revoke all privileges on function private.enforce_skill_vault_bucket_contract()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create trigger skill_vault_bucket_enforce_contract
before insert or update or delete on storage.buckets
for each row
execute function private.enforce_skill_vault_bucket_contract();

-- This validator is deliberately internal.  It is SECURITY DEFINER so the
-- vendor service role and other BYPASSRLS writers cannot evade the relational
-- binding merely by lacking access to the private Skill Vault tables.  It
-- returns only a boolean and performs no Storage API operation.
create function private.skill_vault_storage_object_binding_is_valid(
  p_bucket_id text,
  p_object_name text,
  p_owner uuid,
  p_owner_id text,
  p_metadata jsonb,
  p_user_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_version_public_id text;
  v_file_public_id text;
  v_account_id uuid;
  v_loaded_version_public_id text;
  v_loaded_file_public_id text;
  v_relative_path text;
  v_media_type text;
  v_byte_size bigint;
  v_object_metadata_text text;
  v_user_metadata_text text;
begin
  if p_bucket_id is distinct from 'skill-vault-private'
    or p_object_name is null
    or p_object_name !~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
  then
    return false;
  end if;

  v_version_public_id := pg_catalog.split_part(p_object_name, '/', 2);
  v_file_public_id := pg_catalog.split_part(p_object_name, '/', 3);

  -- Resolve every public coordinate through the composite account/skill/
  -- version relations and require the immutable storage key to be exact.
  select
    files.account_id,
    versions.public_id,
    files.public_id,
    files.relative_path,
    files.media_type,
    files.byte_size
  into
    v_account_id,
    v_loaded_version_public_id,
    v_loaded_file_public_id,
    v_relative_path,
    v_media_type,
    v_byte_size
  from private.managed_skill_files as files
  join private.managed_skill_versions as versions
    on versions.account_id = files.account_id
   and versions.managed_skill_id = files.managed_skill_id
   and versions.id = files.version_id
  join private.managed_skills as skills
    on skills.account_id = files.account_id
   and skills.id = files.managed_skill_id
  where files.storage_key = p_object_name
    and files.public_id = v_file_public_id
    and versions.public_id = v_version_public_id;

  if not found
    or v_loaded_version_public_id is distinct from v_version_public_id
    or v_loaded_file_public_id is distinct from v_file_public_id
  then
    return false;
  end if;

  -- Both vendor owner coordinates must agree with the same account.  Neither
  -- coordinate is accepted as caller-controlled metadata.
  if p_owner is null
    or p_owner_id is null
    or p_owner <> v_account_id
    or p_owner_id <> p_owner::text
  then
    return false;
  end if;

  -- Storage API metadata uses mimetype plus a numeric size declaration.  The
  -- declaration must equal the immutable relational file row exactly; there
  -- is intentionally no MIME allowlist here.
  if p_metadata is null
    or pg_catalog.jsonb_typeof(p_metadata) <> 'object'
    or not (p_metadata ? 'mimetype')
    or p_metadata ->> 'mimetype' is distinct from v_media_type
    or pg_catalog.jsonb_typeof(p_metadata -> 'size') is distinct from 'number'
    or p_metadata -> 'size' is distinct from pg_catalog.to_jsonb(v_byte_size)
  then
    return false;
  end if;

  -- Coordinate-shaped metadata is not an alternate authorization channel.
  -- The value checks also catch nested user metadata without requiring a
  -- recursive JSON parser or persisting another normalized copy.
  if p_metadata ?| array[
      'account_id', 'managed_skill_id', 'version_id', 'relative_path', 'storage_key'
    ]
    or coalesce(p_user_metadata, '{}'::jsonb) ?| array[
      'account_id', 'managed_skill_id', 'version_id', 'relative_path', 'storage_key'
    ]
  then
    return false;
  end if;

  v_object_metadata_text := pg_catalog.lower(coalesce(p_metadata::text, ''));
  v_user_metadata_text := pg_catalog.lower(
    coalesce(p_user_metadata, '{}'::jsonb)::text
  );

  if pg_catalog.strpos(
      v_object_metadata_text,
      pg_catalog.lower(pg_catalog.to_jsonb(v_account_id::text)::text)
    ) > 0
    or pg_catalog.strpos(
      v_user_metadata_text,
      pg_catalog.lower(pg_catalog.to_jsonb(v_account_id::text)::text)
    ) > 0
    or pg_catalog.strpos(
      p_metadata::text,
      pg_catalog.to_jsonb(v_relative_path)::text
    ) > 0
    or pg_catalog.strpos(
      coalesce(p_user_metadata::text, ''),
      pg_catalog.to_jsonb(v_relative_path)::text
    ) > 0
    or pg_catalog.strpos(pg_catalog.lower(p_object_name), pg_catalog.lower(v_account_id::text)) > 0
  then
    return false;
  end if;

  return true;
end
$function$;

revoke all privileges on function private.skill_vault_storage_object_binding_is_valid(
  text, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on function private.skill_vault_storage_object_binding_is_valid(
  text, text, uuid, text, jsonb, jsonb
) is
  'Internal fail-closed validator for one private Storage object and one immutable managed file; boolean only and no object I/O.';

-- The trigger is the persistence boundary.  It runs for vendor service-role
-- and BYPASSRLS writes as well as ordinary writes, so policies cannot be the
-- sole defense against foreign, malformed, or metadata-spoofed rows.
create function private.enforce_skill_vault_storage_object_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
    and old.bucket_id = 'skill-vault-private'
    and (
      new.id is distinct from old.id
      or new.bucket_id is distinct from old.bucket_id
      or new.name is distinct from old.name
      or new.owner is distinct from old.owner
      or new.owner_id is distinct from old.owner_id
      or new.created_at is distinct from old.created_at
    )
  then
    raise exception using
      errcode = '22023',
      message = 'skill-vault-private object identity and ownership are immutable';
  end if;

  if new.bucket_id = 'skill-vault-private'
    and not coalesce(
      private.skill_vault_storage_object_binding_is_valid(
        new.bucket_id,
        new.name,
        new.owner,
        new.owner_id,
        new.metadata,
        new.user_metadata
      ),
      false
    )
  then
    raise exception using
      errcode = 'check_violation',
      message = 'skill-vault-private object is not bound to one immutable managed file';
  end if;

  return new;
end
$function$;

revoke all privileges on function private.enforce_skill_vault_storage_object_binding()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on function private.enforce_skill_vault_storage_object_binding() is
  'Vendor-table trigger guard for the exact M2.06 bucket/key/file/account binding; no external effects.';

create trigger skill_vault_objects_enforce_binding
before insert or update
on storage.objects
for each row
execute function private.enforce_skill_vault_storage_object_binding();

-- Direct Storage access is owner-scoped and exact-key-shaped.  The trigger
-- above remains authoritative for the private-table join and metadata match.
-- No policy is created for anon or service_role; service_role is still subject
-- to the trigger despite its vendor BYPASSRLS attribute.
create policy skill_vault_private_objects_select_owner
on storage.objects
for select
to authenticated
using (
  bucket_id = 'skill-vault-private'
  and (select auth.uid()) is not null
  and owner = (select auth.uid())
  and owner_id = ((select auth.uid())::text)
  and name ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
);

create policy skill_vault_private_objects_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'skill-vault-private'
  and (select auth.uid()) is not null
  and owner = (select auth.uid())
  and owner_id = ((select auth.uid())::text)
  and name ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
  and metadata is not null
  and pg_catalog.jsonb_typeof(metadata) = 'object'
  and metadata ? 'mimetype'
  and pg_catalog.jsonb_typeof(metadata -> 'size') = 'number'
);

create policy skill_vault_private_objects_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'skill-vault-private'
  and (select auth.uid()) is not null
  and owner = (select auth.uid())
  and owner_id = ((select auth.uid())::text)
  and name ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
)
with check (
  bucket_id = 'skill-vault-private'
  and (select auth.uid()) is not null
  and owner = (select auth.uid())
  and owner_id = ((select auth.uid())::text)
  and name ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
  and metadata is not null
  and pg_catalog.jsonb_typeof(metadata) = 'object'
  and metadata ? 'mimetype'
  and pg_catalog.jsonb_typeof(metadata -> 'size') = 'number'
);

create policy skill_vault_private_objects_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'skill-vault-private'
  and (select auth.uid()) is not null
  and owner = (select auth.uid())
  and owner_id = ((select auth.uid())::text)
  and name ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
);

-- Capability preparation is relational authorization metadata only.  These
-- functions never mint a Storage-valid URL/token, never call the Storage API,
-- never list a prefix, and are intentionally ungranted until M2.10 review.
create function private.prepare_skill_vault_upload(
  p_file_public_id text,
  p_expires_at timestamp with time zone
)
returns table (
  bucket_id text,
  object_name text,
  purpose text,
  expires_at timestamp with time zone,
  content_type text,
  declared_size bigint,
  version_public_id text,
  file_public_id text
)
language sql
security definer
set search_path = ''
as $function$
  select
    'skill-vault-private'::text,
    files.storage_key,
    'upload'::text,
    p_expires_at,
    files.media_type,
    files.byte_size,
    versions.public_id,
    files.public_id
  from private.managed_skill_files as files
  join private.managed_skill_versions as versions
    on versions.account_id = files.account_id
   and versions.managed_skill_id = files.managed_skill_id
   and versions.id = files.version_id
  join private.managed_skills as skills
    on skills.account_id = files.account_id
   and skills.id = files.managed_skill_id
  where files.public_id = p_file_public_id
    and files.account_id = (select auth.uid())
    and files.storage_key ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
    and files.storage_key = 'v1/' || versions.public_id || '/' || files.public_id
    and p_expires_at > pg_catalog.statement_timestamp()
    and p_expires_at <= pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => 300);
$function$;

revoke all privileges on function private.prepare_skill_vault_upload(text, timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.prepare_skill_vault_read(
  p_file_public_id text,
  p_expires_at timestamp with time zone
)
returns table (
  bucket_id text,
  object_name text,
  purpose text,
  expires_at timestamp with time zone,
  content_type text,
  declared_size bigint,
  version_public_id text,
  file_public_id text
)
language sql
security definer
set search_path = ''
as $function$
  select
    'skill-vault-private'::text,
    files.storage_key,
    'read'::text,
    p_expires_at,
    files.media_type,
    files.byte_size,
    versions.public_id,
    files.public_id
  from private.managed_skill_files as files
  join private.managed_skill_versions as versions
    on versions.account_id = files.account_id
   and versions.managed_skill_id = files.managed_skill_id
   and versions.id = files.version_id
  join private.managed_skills as skills
    on skills.account_id = files.account_id
   and skills.id = files.managed_skill_id
  where files.public_id = p_file_public_id
    and files.account_id = (select auth.uid())
    and files.storage_key ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
    and files.storage_key = 'v1/' || versions.public_id || '/' || files.public_id
    and p_expires_at > pg_catalog.statement_timestamp()
    and p_expires_at <= pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => 300)
    and exists (
      select 1
      from storage.objects as objects
      where objects.bucket_id = 'skill-vault-private'
        and objects.name = files.storage_key
        and private.skill_vault_storage_object_binding_is_valid(
          objects.bucket_id,
          objects.name,
          objects.owner,
          objects.owner_id,
          objects.metadata,
          objects.user_metadata
        )
    );
$function$;

revoke all privileges on function private.prepare_skill_vault_read(text, timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.prepare_skill_vault_delete(
  p_file_public_id text,
  p_expires_at timestamp with time zone
)
returns table (
  bucket_id text,
  object_name text,
  purpose text,
  expires_at timestamp with time zone,
  content_type text,
  declared_size bigint,
  version_public_id text,
  file_public_id text
)
language sql
security definer
set search_path = ''
as $function$
  select
    'skill-vault-private'::text,
    files.storage_key,
    'delete'::text,
    p_expires_at,
    files.media_type,
    files.byte_size,
    versions.public_id,
    files.public_id
  from private.managed_skill_files as files
  join private.managed_skill_versions as versions
    on versions.account_id = files.account_id
   and versions.managed_skill_id = files.managed_skill_id
   and versions.id = files.version_id
  join private.managed_skills as skills
    on skills.account_id = files.account_id
   and skills.id = files.managed_skill_id
  where files.public_id = p_file_public_id
    and files.account_id = (select auth.uid())
    and files.storage_key ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
    and files.storage_key = 'v1/' || versions.public_id || '/' || files.public_id
    and p_expires_at > pg_catalog.statement_timestamp()
    and p_expires_at <= pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => 300)
    and exists (
      select 1
      from storage.objects as objects
      where objects.bucket_id = 'skill-vault-private'
        and objects.name = files.storage_key
        and private.skill_vault_storage_object_binding_is_valid(
          objects.bucket_id,
          objects.name,
          objects.owner,
          objects.owner_id,
          objects.metadata,
          objects.user_metadata
        )
    );
$function$;

revoke all privileges on function private.prepare_skill_vault_delete(text, timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on function private.prepare_skill_vault_upload(text, timestamp with time zone) is
  'Ungranted exact-single-object upload authorization metadata; no URL, token, prefix, or object I/O.';
comment on function private.prepare_skill_vault_read(text, timestamp with time zone) is
  'Ungranted exact-single-object read authorization metadata; no URL, token, prefix, or object I/O.';
comment on function private.prepare_skill_vault_delete(text, timestamp with time zone) is
  'Ungranted exact-single-object delete authorization metadata; no URL, token, prefix, or object I/O.';

create table private.skill_vault_incomplete_upload_cleanup (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bucket_id text not null,
  object_name text not null,
  cleanup_reason text not null,
  state text not null default 'queued',
  attempt_count integer not null default 0,
  available_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  claimed_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint skill_vault_cleanup_bucket_check
    check (bucket_id = 'skill-vault-private'),
  constraint skill_vault_cleanup_object_name_check
    check (
      pg_catalog.octet_length(object_name) between 1 and 512
      and object_name !~ '[[:cntrl:]]'
      and object_name ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
    ),
  constraint skill_vault_cleanup_reason_check
    check (
      pg_catalog.octet_length(cleanup_reason) between 1 and 64
      and cleanup_reason ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
  constraint skill_vault_cleanup_state_check
    check (state in ('queued', 'claimed', 'completed')),
  constraint skill_vault_cleanup_attempt_count_check
    check (attempt_count between 0 and 1000),
  constraint skill_vault_cleanup_timestamp_state_check
    check (
      (
        state = 'queued'
        and claimed_at is null
        and completed_at is null
      )
      or (
        state = 'claimed'
        and claimed_at is not null
        and completed_at is null
      )
      or (
        state = 'completed'
        and claimed_at is not null
        and completed_at is not null
        and completed_at >= claimed_at
      )
    ),
  constraint skill_vault_cleanup_time_order_check
    check (
      available_at >= created_at
      and updated_at >= created_at
      and (claimed_at is null or claimed_at >= created_at)
      and (completed_at is null or completed_at >= created_at)
    ),
  constraint skill_vault_cleanup_idempotency_key
    unique (bucket_id, object_name, cleanup_reason)
);

revoke all privileges on table private.skill_vault_incomplete_upload_cleanup
  from public, anon, authenticated, service_role, skillmap_vault_definer;

alter table private.skill_vault_incomplete_upload_cleanup enable row level security;
alter table private.skill_vault_incomplete_upload_cleanup force row level security;

create index skill_vault_cleanup_claim_idx
  on private.skill_vault_incomplete_upload_cleanup (available_at, id)
  where state = 'queued';

comment on table private.skill_vault_incomplete_upload_cleanup is
  'Private durable exact-object cleanup queue; external Storage deletion is owned by a later worker boundary.';
comment on column private.skill_vault_incomplete_upload_cleanup.object_name is
  'One exact Storage object name; never a prefix or list selector.';

create function private.enqueue_skill_vault_incomplete_upload_cleanup(
  p_bucket_id text,
  p_object_name text,
  p_cleanup_reason text
)
returns table (
  job_id uuid,
  bucket_id text,
  object_name text,
  cleanup_reason text,
  state text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_id uuid;
begin
  if p_bucket_id is distinct from 'skill-vault-private'
    or p_object_name is null
    or pg_catalog.octet_length(p_object_name) not between 1 and 512
    or p_object_name ~ '[[:cntrl:]]'
    or p_object_name !~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
    or p_cleanup_reason is null
    or pg_catalog.octet_length(p_cleanup_reason) not between 1 and 64
    or p_cleanup_reason !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  then
    raise exception using
      errcode = 'check_violation',
      message = 'invalid exact Skill Vault cleanup target';
  end if;

  if not exists (
    select 1
    from private.managed_skill_files as files
    join private.managed_skill_versions as versions
      on versions.account_id = files.account_id
     and versions.managed_skill_id = files.managed_skill_id
     and versions.id = files.version_id
    where files.storage_key = p_object_name
      and p_object_name = 'v1/' || versions.public_id || '/' || files.public_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'cleanup target is not bound to one immutable managed file';
  end if;

  insert into private.skill_vault_incomplete_upload_cleanup (
    bucket_id, object_name, cleanup_reason
  ) values (
    p_bucket_id, p_object_name, p_cleanup_reason
  )
  on conflict on constraint skill_vault_cleanup_idempotency_key do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select cleanup.id
    into v_job_id
    from private.skill_vault_incomplete_upload_cleanup as cleanup
    where cleanup.bucket_id = p_bucket_id
      and cleanup.object_name = p_object_name
      and cleanup.cleanup_reason = p_cleanup_reason;
  end if;

  return query
  select cleanup.id, cleanup.bucket_id, cleanup.object_name,
         cleanup.cleanup_reason, cleanup.state
  from private.skill_vault_incomplete_upload_cleanup as cleanup
  where cleanup.id = v_job_id;
end
$function$;

revoke all privileges on function private.enqueue_skill_vault_incomplete_upload_cleanup(
  text, text, text
) from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.claim_skill_vault_incomplete_upload_cleanup(
  p_limit integer default 32
)
returns table (
  job_id uuid,
  bucket_id text,
  object_name text,
  cleanup_reason text,
  attempt_count integer,
  claimed_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_limit is null or p_limit not between 1 and 64 then
    raise exception using
      errcode = '22023',
      message = 'cleanup claim limit must be between 1 and 64';
  end if;

  return query
  with candidates as (
    select cleanup.id
    from private.skill_vault_incomplete_upload_cleanup as cleanup
    where cleanup.state = 'queued'
      and cleanup.available_at <= pg_catalog.statement_timestamp()
    order by cleanup.available_at, cleanup.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.skill_vault_incomplete_upload_cleanup as cleanup
    set state = 'claimed',
        attempt_count = cleanup.attempt_count + 1,
        claimed_at = pg_catalog.statement_timestamp(),
        updated_at = pg_catalog.statement_timestamp()
    from candidates
    where cleanup.id = candidates.id
    returning cleanup.id, cleanup.bucket_id, cleanup.object_name,
              cleanup.cleanup_reason, cleanup.attempt_count, cleanup.claimed_at
  )
  select claimed.id, claimed.bucket_id, claimed.object_name,
         claimed.cleanup_reason, claimed.attempt_count, claimed.claimed_at
  from claimed;
end
$function$;

revoke all privileges on function private.claim_skill_vault_incomplete_upload_cleanup(integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.complete_skill_vault_incomplete_upload_cleanup(
  p_job_id uuid
)
returns table (
  job_id uuid,
  state text,
  completed_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update private.skill_vault_incomplete_upload_cleanup as cleanup
  set state = 'completed',
      completed_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
  where cleanup.id = p_job_id
    and cleanup.state = 'claimed';

  return query
  select cleanup.id, cleanup.state, cleanup.completed_at
  from private.skill_vault_incomplete_upload_cleanup as cleanup
  where cleanup.id = p_job_id;
end
$function$;

revoke all privileges on function private.complete_skill_vault_incomplete_upload_cleanup(uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on function private.enqueue_skill_vault_incomplete_upload_cleanup(text, text, text) is
  'Ungranted idempotent exact-object cleanup enqueue; stores no prefix and performs no object I/O.';
comment on function private.claim_skill_vault_incomplete_upload_cleanup(integer) is
  'Ungranted bounded SKIP LOCKED cleanup claim; no Storage deletion occurs under the row lock.';
comment on function private.complete_skill_vault_incomplete_upload_cleanup(uuid) is
  'Ungranted cleanup state completion marker; object deletion remains outside this transaction.';

commit;
