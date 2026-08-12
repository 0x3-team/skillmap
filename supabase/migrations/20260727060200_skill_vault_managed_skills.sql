begin;

set local search_path = '';

-- This role is reserved as the owner of future, narrowly scoped vault
-- SECURITY DEFINER functions. It receives no object privileges here.
do $role$
declare
  member_role_name text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'skillmap_vault_definer'
  ) then
    create role skillmap_vault_definer
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  elsif exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'skillmap_vault_definer'
      and (
        rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit
        or rolreplication or rolbypassrls
      )
  ) then
    raise exception 'existing skillmap_vault_definer role is not least privilege'
      using errcode = '42501';
  end if;

  for member_role_name in
    select member_role.rolname
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
    where granted_role.rolname = 'skillmap_vault_definer'
      and member_role.rolname in ('anon', 'authenticated', 'service_role')
  loop
    execute pg_catalog.format(
      'revoke skillmap_vault_definer from %I',
      member_role_name
    );
  end loop;
end
$role$;

-- A pre-existing role must already satisfy the same attributes; the block
-- above fails closed rather than requiring superuser-only ALTER ROLE clauses.
alter role skillmap_vault_definer set search_path = '';

create table private.managed_skills (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_id text not null
    default ('msk_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  display_name text not null,
  description text,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint managed_skills_public_id_key unique (public_id),
  constraint managed_skills_account_id_id_key unique (account_id, id),
  constraint managed_skills_account_id_public_id_key unique (account_id, public_id),
  constraint managed_skills_account_id_fkey
    foreign key (account_id)
    references auth.users (id)
    on delete cascade,
  constraint managed_skills_public_id_format_check
    check (public_id ~ '^msk_[0-9a-f]{32}$'),
  constraint managed_skills_display_name_length_check
    check (pg_catalog.char_length(display_name) between 1 and 140),
  constraint managed_skills_display_name_normalized_check
    check (display_name = pg_catalog.btrim(display_name) and display_name !~ '[[:cntrl:]]'),
  constraint managed_skills_description_length_check
    check (description is null or pg_catalog.char_length(description) <= 20000),
  constraint managed_skills_description_normalized_check
    check (
      description is null
      or (description = pg_catalog.btrim(description) and description !~ '[[:cntrl:]]')
    ),
  constraint managed_skills_timestamps_order_check
    check (updated_at >= created_at)
);

revoke all privileges on table private.managed_skills
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on table private.managed_skills is
  'Private owner-scoped identity and aggregate display metadata for managed skills.';
comment on column private.managed_skills.id is
  'Internal UUID identity; never exposed through the API projection.';
comment on column private.managed_skills.public_id is
  'Stable public identifier in msk_ plus 32 lowercase hexadecimal format.';
comment on column private.managed_skills.account_id is
  'Owning auth.users account; immutable after insertion.';

-- Supports deterministic owner pagination without duplicating the indexes
-- required by the identity and owner-scoped uniqueness contracts.
create index managed_skills_owner_created_public_idx
  on private.managed_skills (account_id, created_at desc, public_id);

create function private.enforce_managed_skill_stable_fields()
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
      or new.created_at is distinct from old.created_at
    then
      raise exception using
        errcode = '22023',
        message = 'managed skill identity, ownership, and creation timestamp are immutable';
    end if;
  end if;

  new.display_name := pg_catalog.btrim(new.display_name);
  new.description := nullif(pg_catalog.btrim(new.description), '');

  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.statement_timestamp();
  end if;
  new.updated_at := pg_catalog.statement_timestamp();

  return new;
end
$function$;

revoke all privileges on function private.enforce_managed_skill_stable_fields()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on function private.enforce_managed_skill_stable_fields() is
  'Normalizes display metadata, preserves stable identity and ownership, and owns timestamps.';

create trigger managed_skills_enforce_stable_fields
before insert or update on private.managed_skills
for each row
execute function private.enforce_managed_skill_stable_fields();

alter table private.managed_skills enable row level security;
alter table private.managed_skills force row level security;

-- Intentionally no row-level security policies are created in this migration.

create view api.my_managed_skills
with (security_invoker = true, security_barrier = true)
as
select
  managed_skills.public_id,
  managed_skills.display_name,
  managed_skills.description,
  managed_skills.created_at,
  managed_skills.updated_at
from private.managed_skills as managed_skills
where managed_skills.account_id = (select auth.uid());

revoke all privileges on table api.my_managed_skills
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on view api.my_managed_skills is
  'Ungranted owner projection for managed skill display metadata; exposes no internal UUID or account ID.';

commit;
