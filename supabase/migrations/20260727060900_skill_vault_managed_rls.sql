begin;

set local search_path = '';

-- The migration runner (postgres) must be able to `SET ROLE skillmap_vault_definer`
-- to transfer ownership of SECURITY DEFINER owner functions to that NOLOGIN role.
-- This is a forward-only membership grant, idempotent on re-apply; the NOLOGIN
-- definer stays with no memberships/attrs of its own.
grant skillmap_vault_definer to postgres;

-- The NOLOGIN target must be able to reach and own objects in the schemas that
-- contain the owner functions. ALTER OWNER requires the new owner hold CREATE
-- on the schema, not just USAGE. These grants are forward-only and required by
-- the AK owner transfers below.
grant usage, create on schema private to skillmap_vault_definer;
grant usage, create on schema api to skillmap_vault_definer;

-- -------------------------------------------------------------------------
-- Bound identity-resolution helpers for the NOLOGIN SECURITY DEFINER OWNER
-- functions. The vault definer is NOINHERIT and does not hold USAGE on the
-- provider-owned `auth` schema, and the migration runner (postgres) holds
-- plain USAGE (no GRANT OPTION) on `auth`, so it cannot grant that USAGE --
-- `GRANT USAGE ON SCHEMA auth TO skillmap_vault_definer` is a silent no-op.
-- A SECURITY DEFINER function whose SECURITY DEFINER body then calls
-- auth.uid() would fail at runtime with `permission denied for schema auth`,
-- so we factor the identity read into two helpers that are owned by postgres.
-- postgres holds USAGE on `auth` (it is not a superuser here, but it has
-- schema USAGE), so these SECURITY DEFINER helper bodies CAN execute
-- auth.uid()/auth.role(). The helpers execute their body with postgres's
-- privileges under the requesting client's session settings, so
-- `request.jwt.claim.sub`/`role` still resolve to the caller's account. They
-- are SECURITY DEFINER (not INVOKER) precisely so that the NOLOGIN definer
-- role does not need auth-schema USAGE to reach auth.uid(); the helper's body
-- runs as the helper owner (postgres) instead.
--
-- This preserves the frozen auth.uid()/auth.role() contract (the owner
-- functions still resolve identity through auth.uid(), not current_setting),
-- makes NO change to the provider-owned auth schema, and grants NOTHING on
-- auth to any role. The helpers are created and owned by postgres, then
-- EXECUTE is granted to the NOLOGIN definer only -- never to a browser role,
-- never PUBLIC, never service_role. The helper bodies are dependency-bound at
-- CREATE time while postgres can still resolve `auth`.
-- -----------------------------------------------------------------------------
create function private.current_request_uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid()
$function$;

create function private.current_request_role()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.role()
$function$;

-- Owned by postgres (default), EXECUTE granted to the NOLOGIN definer only;
-- PUBLIC/browser/service_role receive none, so no caller can read identity
-- through these helpers except the vault's SECURITY DEFINER owner functions.
revoke all privileges on function private.current_request_uid() from public;
revoke all privileges on function private.current_request_role() from public;
revoke all privileges on function private.current_request_uid() from anon, authenticated;
revoke all privileges on function private.current_request_role() from anon, authenticated;
grant execute on function private.current_request_uid() to skillmap_vault_definer;
grant execute on function private.current_request_role() to skillmap_vault_definer;

comment on function private.current_request_uid() is
  'Bound identity provider for the NOLOGIN vault definer; SECURITY DEFINER owned by postgres so the definer can resolve auth.uid() without auth-schema USAGE.';
comment on function private.current_request_role() is
  'Bound role provider for the NOLOGIN vault definer; SECURITY DEFINER owned by postgres so the definer can resolve auth.role() without auth-schema USAGE.';

-- -----------------------------------------------------------------------------
-- M2.10 — enforce managed-skill/version/release/file/storage RLS, safe owner and
-- worker function exposure, and the mandatory definer handoff.
-- Authority: M2.02 §4.8 of the forward-only Skill Vault series; M2.03 (managed
-- skills), M2.04 (immutable versions/releases/activation CAS), M2.05 (files),
-- M2.06 (private bucket + exact object binding + cleanup queue). This migration
-- is policies / projections / definer grants / owner transfers only; it adds no
-- data-row rewrite and never disables FORCE RLS.
--
-- PRIVATE PREFLIGHT COVERAGE MATRIX (mandatory; all roles/ops enumerated):
--   role \ op        | SELECT proj | create      | upd-metadata| pack(act) | direct W/D  | storage object
--   anon             |   denied    | denied      | denied      |  denied   |   denied    | denied
--   authenticated    |   owner     | owner (fn)  | owner (fn)  |  owner(fn)|  DML denied | owner SELECT/INSERT/UPDATE/DELETE exact-shape
--   service_role     |     --      |   --        |    --       |    --     |   --        |   --
--   skillmap_vault_definer (NOLOGIN, NOBYPASSRLS) | internal definer policies below |  --   |   --
--
--   Owner predicates are ALWAYS account_id = (select auth.uid()); callers never
--   supply an account id. Browser roles have NO direct INSERT/UPDATE/DELETE on
--   version/release/file tables; they funnel through exactly the exposed owner
--   SECURITY DEFINER functions. anon receives nothing. service_role receives
--   only the exact worker EXECUTE grants (cleanup) below.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. FORCE RLS invariants (re-asserted; all are already FORCE from prior
--    migrations, idempotent here, including the cleanup queue).
-- ----------------------------------------------------------------------------
alter table private.managed_skills force row level security;
alter table private.managed_skill_versions force row level security;
alter table private.managed_skill_releases force row level security;
alter table private.managed_skill_files force row level security;
alter table private.skill_vault_incomplete_upload_cleanup force row level security;

-- ----------------------------------------------------------------------------
-- 2. FORCE RLS owner-posture for the NOLOGIN definer (base table access for the
--    SECURITY DEFINER production bodies). Browser roles never hold base-table
--    privilege on the private managed tables: their reads flow only through the
--    api projections (section 3), whose SECURITY DEFINER helpers run as the
--    NOLOGIN definer and satisfy these per-owner policies. The definer role is
--    NOINHERIT, so these `_definer_all` policies bind its row visibility to the
--    requesting account; they are also asserted by the accepted M2.04 test.
--    No authenticated/anon/service_role base-table grant is made here.
-- ----------------------------------------------------------------------------

-- M2.03 owner-posture SELECT policies. These are created for the user role to
-- satisfy the M2.02 policy contract and the M2.05 forward expectation that an
-- owner_select policy exists on every managed table. They are necessary at the
-- catalog level even though authenticated holds no destination-table privilege:
-- the row-level predicate is `account_id = (select auth.uid())`, never a
-- caller-supplied account id. No direct-base SELECT grant is made, so a direct
-- `select * from private.managed_*` as a browser role fails closed (42501); the
-- api projections (section 3) are the sole owner read path.
create policy managed_skills_owner_select
  on private.managed_skills
  for select
  to authenticated
  using (account_id = (select auth.uid()));

create policy managed_skill_versions_owner_select
  on private.managed_skill_versions
  for select
  to authenticated
  using (account_id = (select auth.uid()));

create policy managed_skill_releases_owner_select
  on private.managed_skill_releases
  for select
  to authenticated
  using (account_id = (select auth.uid()));

create policy managed_skill_files_owner_select
  on private.managed_skill_files
  for select
  to authenticated
  using (account_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. Owner projections: security-invoker/security-barrier views over bounded
--    private SECURITY DEFINER helpers.
--
--    api.my_managed_skills already exists (M2.03) and is REUSED by name and by
--    column set, but its body is redirected to a bounded helper so that it no
--    longer requires a direct authenticated base SELECT. Each NEW version/
--    release/file view (M2.10) is a security-invoker/security-barrier view whose
--    SELECT reads a STABLE SECURITY DEFINER helper owned by the NOLOGIN vault
--    definer. Since the SECURITY DEFINER bodies run as the definer, and that
--    role holds only the exact base grants + FORCE-RLS `_all` policies in
--    section 6, an authenticated caller without any base-table privilege still
--    gets the exact public-safe rows.
--
--    Reachability truth: authenticated retains the M1 private-schema USAGE and
--    is granted EXECUTE on each bounded helper below, so a direct
--    `private.my_owner_*()` call IS reachable and is exactly equivalent to (and
--    owner-scoped like) the api projection. That helper EXECUTE confers no
--    per-table privilege (verified: `select * from private.managed_skill_versions`
--    -> 42501 for authenticated), only the bounded owner rows. The two identity
--    helpers `current_request_uid()`/`current_request_role()` are NOT granted to
--    authenticated and remain uncallable by it.
--
--    Every helper returns only public-safe owner columns — no internal ID,
--    no account_id, no opaque storage key, no manifest bytes, no digests.
-- ----------------------------------------------------------------------------

-- Helper for the managed-skills projection (replaces my_managed_skills body).
create or replace function private.my_owner_managed_skills()
returns table (
  h_public_id text,
  h_display_name text,
  h_description text,
  h_created_at timestamp with time zone,
  h_updated_at timestamp with time zone
)
language sql stable security definer set search_path = ''
as $function$
  select
    m.public_id,
    m.display_name,
    m.description,
    m.created_at,
    m.updated_at
  from private.managed_skills m
  where m.account_id = (select private.current_request_uid())
  order by m.created_at, m.public_id
$function$;
alter function private.my_owner_managed_skills() owner to skillmap_vault_definer;
revoke all privileges on function private.my_owner_managed_skills() from public;
grant execute on function private.my_owner_managed_skills() to skillmap_vault_definer;
grant execute on function private.my_owner_managed_skills() to authenticated;

-- Rewire api.my_managed_skills to the bounded helper. The invoker/barrier view
-- retains a defense-in-depth `auth.uid() IS NOT NULL` predicate: the viewer is
-- an authenticated bearer (auth.uid() present) and never a bare anonymous or
-- a foreign-row enumeration path. account_id is intentionally not projected.
create or replace view api.my_managed_skills
with (security_invoker = true, security_barrier = true)
as
  select
    h_public_id as public_id,
    h_display_name as display_name,
    h_description as description,
    h_created_at as created_at,
    h_updated_at as updated_at
  from private.my_owner_managed_skills()
  where (select auth.uid()) is not null;

revoke all privileges on table api.my_managed_skills
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_managed_skills to authenticated;

comment on view api.my_managed_skills is
  'Owner projection for Managed Skill display metadata; security_invoker+barrier over a bounded SECURITY DEFINER helper, exposes no internal UUID or account ID.';

-- Helper + projection for versions.
create or replace function private.my_owner_managed_skill_versions()
returns table (
  h_public_id text,
  h_created_at timestamp with time zone,
  h_provenance_state text,
  h_analysis_state text
)
language sql stable security definer set search_path = ''
as $function$
  select v.public_id, v.created_at, v.provenance_state, v.analysis_state
  from private.managed_skill_versions v
  where v.account_id = (select private.current_request_uid())
  order by v.created_at, v.public_id
$function$;
alter function private.my_owner_managed_skill_versions() owner to skillmap_vault_definer;
revoke all privileges on function private.my_owner_managed_skill_versions() from public;
grant execute on function private.my_owner_managed_skill_versions() to skillmap_vault_definer;
grant execute on function private.my_owner_managed_skill_versions() to authenticated;

create or replace view api.my_managed_skill_versions
with (security_invoker = true, security_barrier = true)
as
select
  h_public_id as public_id,
  h_created_at as created_at,
  h_provenance_state as provenance_state,
  h_analysis_state as analysis_state
from private.my_owner_managed_skill_versions();

revoke all privileges on table api.my_managed_skill_versions
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_managed_skill_versions to authenticated;

comment on view api.my_managed_skill_versions is
  'Owner projection for immutable Managed Skill versions; exposes no internal id, manifest bytes, digests, source, or account id; read through a bounded definer helper.';

-- Helper for releases.
create or replace function private.my_owner_managed_skill_releases()
returns table (
  h_public_id text,
  h_created_at timestamp with time zone,
  h_lifecycle_state text,
  h_eligibility_reasons text[]
)
language sql stable security definer set search_path = ''
as $function$
  select r.public_id, r.created_at, r.lifecycle_state, r.eligibility_reasons
  from private.managed_skill_releases r
  where r.account_id = (select private.current_request_uid())
  order by r.created_at, r.public_id
$function$;
alter function private.my_owner_managed_skill_releases() owner to skillmap_vault_definer;
revoke all privileges on function private.my_owner_managed_skill_releases() from public;
grant execute on function private.my_owner_managed_skill_releases() to skillmap_vault_definer;
grant execute on function private.my_owner_managed_skill_releases() to authenticated;

create or replace view api.my_managed_skill_releases
with (security_invoker = true, security_barrier = true)
as
  select
    h_public_id as public_id,
    h_created_at as created_at,
    h_lifecycle_state as lifecycle_state,
    h_eligibility_reasons as eligibility_reasons
  from private.my_owner_managed_skill_releases();

revoke all privileges on table api.my_managed_skill_releases
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_managed_skill_releases to authenticated;

comment on view api.my_managed_skill_releases is
  'Owner projection for Managed Skill release bindings; exposes no internal id, managed_skill_id, version_id, or account id; over a bounded definer helper.';

-- Helper for files.
create or replace function private.my_owner_managed_skill_files()
returns table (
  h_public_id text,
  h_relative_path text,
  h_media_type text,
  h_byte_size bigint,
  h_executable boolean,
  h_ordinal integer,
  h_created_at timestamp with time zone
)
language sql stable security definer set search_path = ''
as $function$
  select f.public_id, f.relative_path, f.media_type, f.byte_size, f.executable, f.ordinal, f.created_at
  from private.managed_skill_files f
  where f.account_id = (select private.current_request_uid())
  order by f.ordinal, f.public_id
$function$;
alter function private.my_owner_managed_skill_files() owner to skillmap_vault_definer;
revoke all privileges on function private.my_owner_managed_skill_files() from public;
grant execute on function private.my_owner_managed_skill_files() to skillmap_vault_definer;
grant execute on function private.my_owner_managed_skill_files() to authenticated;

create or replace view api.my_managed_skill_files
with (security_invoker = true, security_barrier = true)
as
  select
    h_public_id as public_id,
    h_relative_path as relative_path,
    h_media_type as media_type,
    h_byte_size as byte_size,
    h_executable as executable,
    h_ordinal as ordinal,
    h_created_at as created_at
  from private.my_owner_managed_skill_files();

revoke all privileges on table api.my_managed_skill_files
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_managed_skill_files to authenticated;

comment on view api.my_managed_skill_files is
  'Owner projection for Managed Skill files; exposes no internal id, managed_skill_id, version_id, file_digest, storage_key, or account id; over a bounded definer helper.';

-- ----------------------------------------------------------------------------
-- 4. Owner create / update-metadata SECURITY DEFINER functions owned by the
--    NOLOGIN skillmap_vault_definer. They derive auth.uid() and never accept a
--    caller account id.
-- ----------------------------------------------------------------------------
create function private.create_managed_skill(
  p_display_name text,
  p_description text
)
returns table (
  public_id text,
  display_name text,
  description text,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid := (select private.current_request_uid());
  v_display_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
begin
  if v_account_id is null
     or pg_catalog.char_length(v_display_name) = 0
  then
    raise exception 'The requested vault resource is unmanaged.' using errcode = 'P0001';
  end if;

  return query
  insert into private.managed_skills as msk (account_id, display_name, description)
  values (v_account_id, v_display_name, v_description)
  returning msk.public_id, msk.display_name, msk.description, msk.created_at;
end
$function$;

alter function private.create_managed_skill(text,text) owner to skillmap_vault_definer;
revoke all privileges on function private.create_managed_skill(text,text) from public;
grant execute on function private.create_managed_skill(text,text) to authenticated;

comment on function private.create_managed_skill(text,text) is
  'Owner create for a Managed Skill; derives auth.uid(), returns only the new owner projection.';

create function private.update_managed_skill_metadata(
  p_skill_public_id text,
  p_display_name text,
  p_description text
)
returns table (
  public_id text,
  display_name text,
  description text,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid := (select private.current_request_uid());
  v_display_name text := pg_catalog.btrim(coalesce(p_display_name, ''));
  v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
begin
  if v_account_id is null
     or p_skill_public_id is null
     or p_skill_public_id !~ '^msk_[0-9a-f]{32}$'
  then
    raise exception 'The requested vault resource is unmanaged.' using errcode = 'P0001';
  end if;

  return query
  update private.managed_skills m
     set display_name = coalesce(v_display_name, m.display_name),
         description = v_description
   where m.account_id = v_account_id
     and m.public_id = p_skill_public_id
  returning m.public_id, m.display_name, m.description, m.updated_at;
end
$function$;

alter function private.update_managed_skill_metadata(text,text,text) owner to skillmap_vault_definer;
revoke all privileges on function private.update_managed_skill_metadata(text,text,text) from public;
grant execute on function private.update_managed_skill_metadata(text,text,text) to authenticated;

comment on function private.update_managed_skill_metadata(text,text,text) is
  'Owner update of Managed Skill display metadata; ownership is derived from auth.uid(), never caller-supplied.';

-- ----------------------------------------------------------------------------
-- 5. Operator posture. No browser role holds any base-table INSERT/UPDATE/
--    DELETE grant on the private managed tables, and none is granted a base
--    SELECT privilege either (their reads reach the vault only through the
--    api projections (section 3) and the exact owner DEFINER functions).
--    Note: authenticated retains the private-schema USAGE granted by the M1
--    catalog baseline and is granted EXECUTE on the bounded projection helpers
--    (section 3) so the security_invoker views resolve; that USAGE and helper
--    EXECUTE confer NO per-table privilege and never expose the private helper
--    bodies. The NOLOGIN definer's narrow base grants live with section 6.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 6. Mandatory definer handoff for the M-10 activation CAS pair.
--    Preconditions, in order:
--      (a) the freshly-created owner functions in section 4 were never granted
--          to public/browser roles before this point;
--      (b) the activation functions have their E2E grants already revoked
--          above and are revoke-everything'd again here;
--      (c) the migration runner (postgres) is made a member of the NOLOGIN
--          target so it may ALTER OWNER; this is a forward-only role grant and
--          is idempotent on re-apply;
--      (d) the NOLOGIN target receives USAGE on the private and api schemas so
--          the owner transfer is permissible and the learner body is resolvable.
--    Ownership of both functions transfers to skillmap_vault_definer; then
--    execution is granted to authenticated only. No EXECUTE precedes the
--    owned+policyed state.
-- ----------------------------------------------------------------------------
revoke all privileges on function private.activate_managed_skill_release(text,text,bigint,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function api.activate_managed_skill_release(text,text,bigint,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Re-define the private implementation with the direct auth.uid() call replaced
-- by the pre-bound private.current_request_uid() helper. The signature, body,
-- SECURITY DEFINER posture, empty search_path, and every CAS/receipt/lock
-- semantic are unchanged; only the identity read is rebound so the transferred
-- NOLOGIN definer can resolve the requester without auth-schema USAGE.
create or replace function private.activate_managed_skill_release(
  skill_public_id text,
  release_public_id text,
  expected_revision bigint,
  idempotency_key uuid
)
returns table (
  result_skill_public_id text,
  result_release_public_id text,
  result_state text,
  result_activation_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_managed_skill_id uuid;
  v_release_id uuid;
  v_version_id uuid;
  v_revision bigint;
  v_skill_public_id text;
  v_skill_active_release_id uuid;
  v_receipt private.managed_skill_activation_receipts%rowtype;
  v_release_public_id text;
  v_release_lifecycle_state text;
  v_release_eligibility_reasons text[];
  v_release_activated_at timestamp with time zone;
  v_release_revoked_at timestamp with time zone;
begin
  v_account_id := (select private.current_request_uid());
  if v_account_id is null
    or skill_public_id is null
    or release_public_id is null
    or expected_revision is null
    or expected_revision < 0
    or idempotency_key is null
    or skill_public_id !~ '^msk_[0-9a-f]{32}$'
    or release_public_id !~ '^msr_[0-9a-f]{32}$'
  then
    raise exception 'The requested vault resource is unavailable.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_account_id::text, 0)
  );

  select receipts.*
  into v_receipt
  from private.managed_skill_activation_receipts as receipts
  where receipts.account_id = v_account_id
    and receipts.idempotency_key = activate_managed_skill_release.idempotency_key;

  if found then
    if v_receipt.request_skill_public_id is distinct from activate_managed_skill_release.skill_public_id
      or v_receipt.request_release_public_id is distinct from activate_managed_skill_release.release_public_id
      or v_receipt.request_expected_revision is distinct from activate_managed_skill_release.expected_revision
    then
      raise exception 'The request conflicts with an earlier committed import.' using errcode = 'P0001';
    end if;

    return query
    select
      v_receipt.result_skill_public_id,
      v_receipt.result_release_public_id,
      v_receipt.result_state,
      v_receipt.result_activation_revision;
    return;
  end if;

  select
    managed_skills.id,
    managed_skills.public_id,
    managed_skills.active_release_id,
    managed_skills.activation_revision
  into
    v_managed_skill_id,
    v_skill_public_id,
    v_skill_active_release_id,
    v_revision
  from private.managed_skills as managed_skills
  where managed_skills.account_id = v_account_id
    and managed_skills.public_id = activate_managed_skill_release.skill_public_id
  for update;

  if not found then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      activate_managed_skill_release.expected_revision
    );
    return query
    select
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      activate_managed_skill_release.expected_revision;
    return;
  end if;

  select releases.id, releases.version_id
  into v_release_id, v_version_id
  from private.managed_skill_releases as releases
  where releases.account_id = v_account_id
    and releases.managed_skill_id = v_managed_skill_id
    and releases.public_id = activate_managed_skill_release.release_public_id;

  if not found then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      v_revision;
    return;
  end if;

  perform 1
  from private.managed_skill_versions as versions
  where versions.account_id = v_account_id
    and versions.managed_skill_id = v_managed_skill_id
    and versions.id = v_version_id
  for update;

  if not found then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      v_revision;
    return;
  end if;

  select
    releases.public_id,
    releases.lifecycle_state,
    releases.eligibility_reasons,
    releases.activated_at,
    releases.revoked_at
  into
    v_release_public_id,
    v_release_lifecycle_state,
    v_release_eligibility_reasons,
    v_release_activated_at,
    v_release_revoked_at
  from private.managed_skill_releases as releases
  where releases.account_id = v_account_id
    and releases.managed_skill_id = v_managed_skill_id
    and releases.id = v_release_id
  for update;

  if not found
  then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      activate_managed_skill_release.release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      v_revision;
    return;
  end if;

  if v_revision <> activate_managed_skill_release.expected_revision then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      v_release_public_id,
      'VAULT_STALE_REVISION',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      v_release_public_id,
      'VAULT_STALE_REVISION'::text,
      v_revision;
    return;
  end if;

  if v_release_lifecycle_state <> 'active'
    or pg_catalog.cardinality(v_release_eligibility_reasons) <> 0
    or v_release_activated_at is null
    or v_release_revoked_at is not null
  then
    insert into private.managed_skill_activation_receipts (
      account_id, idempotency_key, request_skill_public_id,
      request_release_public_id, request_expected_revision,
      result_skill_public_id, result_release_public_id, result_state,
      result_activation_revision
    ) values (
      v_account_id, activate_managed_skill_release.idempotency_key,
      activate_managed_skill_release.skill_public_id,
      activate_managed_skill_release.release_public_id,
      activate_managed_skill_release.expected_revision,
      v_skill_public_id,
      v_release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE',
      v_revision
    );
    return query
    select
      v_skill_public_id,
      v_release_public_id,
      'VAULT_RESOURCE_UNAVAILABLE'::text,
      v_revision;
    return;
  end if;

  if v_skill_active_release_id is distinct from v_release_id then
    update private.managed_skills
    set active_release_id = v_release_id,
        activation_revision = activation_revision + 1
    where account_id = v_account_id
      and id = v_managed_skill_id
    returning activation_revision into v_revision;
  else
    null;
  end if;

  insert into private.managed_skill_activation_receipts (
    account_id,
    idempotency_key,
    request_skill_public_id,
    request_release_public_id,
    request_expected_revision,
    result_skill_public_id,
    result_release_public_id,
    result_state,
    result_activation_revision
  ) values (
    v_account_id,
    activate_managed_skill_release.idempotency_key,
    activate_managed_skill_release.skill_public_id,
    activate_managed_skill_release.release_public_id,
    activate_managed_skill_release.expected_revision,
    v_skill_public_id,
    v_release_public_id,
    'active',
    v_revision
  );

  return query
  select
    v_skill_public_id,
    v_release_public_id,
    'active'::text,
    v_revision;
end
$function$;

-- (d) the target role already holds schema USAGE (granted at the top of this
-- migration), so the owner transfer may proceed.
alter function private.activate_managed_skill_release(text,text,bigint,uuid)
  owner to skillmap_vault_definer;
alter function api.activate_managed_skill_release(text,text,bigint,uuid)
  owner to skillmap_vault_definer;

-- The definer role is NOINHERIT and does not assume caller grants; it must
-- satisfy FORCE RLS itself for every row operation its SECURITY DEFINER body
-- performs. Because the role is NOLOGIN, these per-owner policies bind exactly
-- the function body to the requesting owner. auth.uid() still resolves to the
-- *caller* JWT, not the definer role, so the predicate is always the requester's
-- account. Statements that only row-lock (FOR UPDATE for CAS) require UPDATE
-- pass; the immutable triggers still reject any write to immutable coordinates.
create policy managed_skills_definer_all
  on private.managed_skills
  for all
  to skillmap_vault_definer
  using (account_id = (select private.current_request_uid()))
  with check (account_id = (select private.current_request_uid()));

create policy managed_skill_versions_definer_all
  on private.managed_skill_versions
  for all
  to skillmap_vault_definer
  using (account_id = (select private.current_request_uid()))
  with check (account_id = (select private.current_request_uid()));

create policy managed_skill_releases_definer_all
  on private.managed_skill_releases
  for all
  to skillmap_vault_definer
  using (account_id = (select private.current_request_uid()))
  with check (account_id = (select private.current_request_uid()));

create policy managed_skill_files_definer_all
  on private.managed_skill_files
  for all
  to skillmap_vault_definer
  using (account_id = (select private.current_request_uid()))
  with check (account_id = (select private.current_request_uid()));

create policy managed_skill_activation_receipts_definer_all
  on private.managed_skill_activation_receipts
  for all
  to skillmap_vault_definer
  using (account_id = (select private.current_request_uid()))
  with check (account_id = (select private.current_request_uid()));

-- Only the NOLOGIN definer receives the base-privilege grant sufficient for the
-- activation body: SELECT to satisfy FORCE RLS row visibility, UPDATE to permit
-- the CAS FOR-UPDATE locks on skills/versions/releases and the active-pointer
-- bump on managed_skills, and INSERT + SELECT on receipts to persist outcomes.
-- All UPDATE access is constrained by the per-owner FOR ALL policies above plus
-- the immutable-coordinate/lifecycle triggers, and reaches no browser role. No
-- INSERT/UPDATE/DELETE on version/release/file/queue rows is exposed to anon,
-- service_role, or authenticated.
grant select on table private.managed_skills to skillmap_vault_definer;
grant select on table private.managed_skill_versions to skillmap_vault_definer;
grant select on table private.managed_skill_releases to skillmap_vault_definer;
grant select on table private.managed_skill_files to skillmap_vault_definer;
-- INSERT on managed_skills supports the definer-owned create_managed_skill body;
-- UPDATE on the two owner metadata columns supports update_managed_skill_metadata.
-- Both are confined by the per-owner managed_skills_definer_all policy, reach no
-- browser role, and never touch lifecycle/state columns.
grant insert on table private.managed_skills to skillmap_vault_definer;
grant update(display_name, description) on table private.managed_skills to skillmap_vault_definer;
grant update(active_release_id, activation_revision) on table private.managed_skills to skillmap_vault_definer;
grant update on table private.managed_skill_versions to skillmap_vault_definer;
grant update on table private.managed_skill_releases to skillmap_vault_definer;
grant select, insert on table private.managed_skill_activation_receipts to skillmap_vault_definer;

grant execute on function private.activate_managed_skill_release(text,text,bigint,uuid)
  to authenticated;
revoke all privileges on function private.activate_managed_skill_release(text,text,bigint,uuid) from public;
grant execute on function api.activate_managed_skill_release(text,text,bigint,uuid)
  to authenticated;
revoke all privileges on function api.activate_managed_skill_release(text,text,bigint,uuid) from public;

-- ----------------------------------------------------------------------------
-- 7. Worker boundary. prepare/read/delete are SECURITY DEFINER and stay
--    owned by postgres (the local migration role: rolsuper=false,
--    rolbypassrls=true). As BYPASSRLS owner the definer bypasses RLS, so no
--    additional per-owner policy is required for their internal read of the
--    private managed tables. They are exposed to authenticated only for the
--    exact owner object they resolve (their own subselect enforces ownership).
--    This does not widen any table grant.
-- ----------------------------------------------------------------------------
grant execute on function private.prepare_skill_vault_upload(text, timestamp with time zone)
  to authenticated;
grant execute on function private.prepare_skill_vault_read(text, timestamp with time zone)
  to authenticated;
grant execute on function private.prepare_skill_vault_delete(text, timestamp with time zone)
  to authenticated;
revoke all privileges on function private.prepare_skill_vault_upload(text, timestamp with time zone) from public;
revoke all privileges on function private.prepare_skill_vault_read(text, timestamp with time zone) from public;
revoke all privileges on function private.prepare_skill_vault_delete(text, timestamp with time zone) from public;

-- ----------------------------------------------------------------------------
-- 8. Cleanup queue worker functions are service-role-only exact EXECUTE.
--    They are owned by postgres (the local migration role) so they run with
--    the BYPASSRLS privilege owner; no per-owner policy is needed and none is
--    granted. service_role receives EXECUTE on these three exact functions
--    alone. Browser roles receive no cleanup access and no cleanup-table grant.
-- ----------------------------------------------------------------------------
grant execute on function private.enqueue_skill_vault_incomplete_upload_cleanup(text, text, text)
  to service_role;
grant execute on function private.claim_skill_vault_incomplete_upload_cleanup(integer)
  to service_role;
grant execute on function private.complete_skill_vault_incomplete_upload_cleanup(uuid)
  to service_role;
revoke all privileges on function private.enqueue_skill_vault_incomplete_upload_cleanup(text, text, text) from public;
revoke all privileges on function private.claim_skill_vault_incomplete_upload_cleanup(integer) from public;
revoke all privileges on function private.complete_skill_vault_incomplete_upload_cleanup(uuid) from public;

commit;