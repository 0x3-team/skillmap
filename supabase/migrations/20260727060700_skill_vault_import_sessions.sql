begin;

set local search_path = '';

-- -----------------------------------------------------------------------------
-- M2.08 — resumable import-session authority records.
-- Field authority: M2.02 section 4.6 of the forward-only Skill Vault migration
-- series. This migration owns the import-session and accepted file-receipt
-- authority only. Every mutation path is an ungranted private implementation
-- function (begin / resume / accept / finalize / expire). RLS is enabled and
-- forced with zero policies; device/import grants and policies are owned by
-- M2.11. No public `api` surface, no conversions from `api.skill_submissions`,
-- and no route records (M2.09) are introduced here.
-- -----------------------------------------------------------------------------

create table private.import_sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  imp_ text not null
    default ('imp_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  device_id uuid not null,
  managed_skill_id uuid not null,
  version_id uuid not null,

  manifest_schema_version text not null,
  manifest_digest text not null,
  content_digest text not null,

  expected_file_count integer not null,
  expected_byte_total bigint not null,

  accepted_file_count integer not null default 0,
  accepted_byte_total bigint not null default 0,

  idempotency_key uuid not null,
  state text not null default 'in_progress',
  expiry_at timestamp with time zone not null default
    (pg_catalog.statement_timestamp() + interval '6 hours'),
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  verified_at timestamp with time zone,
  verification_digest text,
  revision bigint not null default 1,

  constraint import_sessions_public_id_key unique (imp_),
  constraint import_sessions_account_id_id_key unique (account_id, id),
  constraint import_sessions_account_device_id_key unique (account_id, device_id, id),
  constraint import_sessions_account_device_idempotency_key
    unique (account_id, device_id, idempotency_key),
  constraint import_sessions_public_id_format_check
    check (imp_ ~ '^imp_[0-9a-f]{32}$'),
  constraint import_sessions_device_fkey
    foreign key (account_id, device_id)
    references private.devices (account_id, id)
    on delete cascade,
  constraint import_sessions_version_fkey
    foreign key (account_id, managed_skill_id, version_id)
    references private.managed_skill_versions (account_id, managed_skill_id, id)
    on delete cascade,
  constraint import_sessions_manifest_schema_version_check
    check (
      pg_catalog.octet_length(manifest_schema_version) between 3 and 16
      and manifest_schema_version ~ '^[0-9]+\.[0-9]+$'
    ),
  constraint import_sessions_manifest_digest_check
    check (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_sessions_content_digest_check
    check (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_sessions_expected_file_count_check
    check (expected_file_count between 1 and 4096),
  constraint import_sessions_expected_byte_total_check
    check (expected_byte_total between 0 and 8589934592),
  constraint import_sessions_accepted_file_count_check
    check (accepted_file_count between 0 and 4096),
  constraint import_sessions_accepted_byte_total_check
    check (accepted_byte_total between 0 and 8589934592),
  constraint import_sessions_accepted_le_expected_check
    check (accepted_file_count <= expected_file_count),
  constraint import_sessions_accepted_byte_le_expected_check
    check (accepted_byte_total <= expected_byte_total),
  constraint import_sessions_state_check
    check (state in ('in_progress', 'verified', 'cancelled', 'expired')),
  constraint import_sessions_expiry_bounded_check
    check (expiry_at > created_at),
  constraint import_sessions_updated_ge_created_check
    check (updated_at >= created_at),
  constraint import_sessions_verified_at_check
    check (verified_at is null or verified_at >= created_at),
  constraint import_sessions_verified_digest_pair_check
    check (
      (state <> 'verified')
      or
      (verified_at is not null and verification_digest is not null)
    ),
  constraint import_sessions_verification_digest_check
    check (verification_digest is null or verification_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_sessions_revision_check
    check (revision > 0)
);

comment on table private.import_sessions is
  'Resumable, idempotent import-session authority with bounded expected/accepted counts, scoped idempotency, expiry, and a terminal verified state. RLS is enabled/forced with zero policies; device/import policies and grants are owned by M2.11.';

create table private.import_file_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null,
  device_id uuid not null,
  session_id uuid not null,
  file_id uuid not null,
  managed_skill_id uuid not null,
  version_id uuid not null,
  relative_path text not null,
  media_type text,
  accepted_byte_size bigint not null,
  file_digest text not null,
  ordinal integer not null,
  accepted_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint import_file_receipts_account_session_file_key
    unique (account_id, session_id, file_id),
  constraint import_file_receipts_session_ordinal_key
    unique (session_id, ordinal),
  constraint import_file_receipts_account_id_id_key unique (account_id, id),
  constraint import_file_receipts_session_fkey
    foreign key (account_id, device_id, session_id)
    references private.import_sessions (account_id, device_id, id)
    on delete cascade,
  constraint import_file_receipts_file_fkey
    foreign key (account_id, managed_skill_id, version_id, file_id)
    references private.managed_skill_files (account_id, managed_skill_id, version_id, id)
    on delete cascade,
  constraint import_file_receipts_relative_path_check
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
  constraint import_file_receipts_media_type_check
    check (
      media_type is null
      or (
        pg_catalog.octet_length(media_type) between 1 and 128
        and media_type = pg_catalog.btrim(media_type)
        and media_type is not distinct from normalize(media_type, NFC)
        and media_type !~ '[[:cntrl:]]'
      )
    ),
  constraint import_file_receipts_accepted_byte_size_check
    check (accepted_byte_size between 0 and 16777216),
  constraint import_file_receipts_file_digest_check
    check (file_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint import_file_receipts_ordinal_check
    check (ordinal >= 0)
);

comment on table private.import_file_receipts is
  'Immutable accepted-file receipts with repeated account/device/session/file binding, exact accepted bytes and digest, ordinal, and timestamp. Receipt rows are the only truth for accepted counters; they are append-only and terminal-immutability protected.';

create index import_sessions_resumable_idx
  on private.import_sessions (account_id, device_id, created_at)
  where state = 'in_progress';
create index import_sessions_account_created_public_idx
  on private.import_sessions (account_id, created_at desc, imp_);
create index import_file_receipts_session_file_idx
  on private.import_file_receipts (account_id, session_id, file_id);
create index import_file_receipts_session_ordinal_idx
  on private.import_file_receipts (session_id, ordinal);

-- Session identity/state trigger: enforce immutability of the identity/bounds
-- and the legal forward-only state machine. Terminal states are immutable.
create function private.enforce_import_session_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if old.state in ('verified', 'cancelled', 'expired') then
      raise exception using
        errcode = '22023',
        message = 'terminal import session rows are immutable';
    end if;

    if new.id is distinct from old.id
      or new.imp_ is distinct from old.imp_
      or new.account_id is distinct from old.account_id
      or new.device_id is distinct from old.device_id
      or new.managed_skill_id is distinct from old.managed_skill_id
      or new.version_id is distinct from old.version_id
      or new.manifest_schema_version is distinct from old.manifest_schema_version
      or new.manifest_digest is distinct from old.manifest_digest
      or new.content_digest is distinct from old.content_digest
      or new.expected_file_count is distinct from old.expected_file_count
      or new.expected_byte_total is distinct from old.expected_byte_total
      or new.idempotency_key is distinct from old.idempotency_key
      or new.created_at is distinct from old.created_at
    then
      raise exception using
        errcode = '22023',
        message = 'import session identity and expected bounds are immutable';
    end if;

    -- Legal transitions. `in_progress` may stay `in_progress` (counter/meta
    -- touch) or advance to a terminal state; it may never jump anywhere else.
    -- A terminal state can never change. `cancelled` is an explicit client-abandon
    -- terminal value reserved for forward use; it is never produced by an
    -- implementation function in this migration and accepts no additional update.
    if old.state = 'in_progress' and new.state not in (
      'in_progress', 'verified', 'expired', 'cancelled')
    then
      raise exception using
        errcode = '22023',
        message = 'illegal import session state transition';
    end if;

    if old.state <> 'in_progress' and new.state is distinct from old.state then
      raise exception using
        errcode = '22023',
        message = 'terminal import session rows are immutable';
    end if;

    -- Unforgeable `verified`: a bare UPDATE may move a session to `verified`
    -- ONLY when (a) the new row carries verified_at and a verification_digest,
    -- (b) the session already holds exact parity with the authoritative version
    -- file set (full count, byte total, contiguous ordinals 0..N-1, no other/
    -- missing/substituted/extra files, and schema/manifest/content identity
    -- parity), and (c) the supplied verification_digest is EXACTLY the
    -- deterministic digest derived from the bound session + accepted receipt set.
    -- Because the digest is recomputed here from the same single helper that
    -- finalize uses, a bare UPDATE cannot smuggle in a manufactured digest: any
    -- digest that does not equal what the receipt set deterministically implies
    -- is rejected. (Audit fixes: P1 forged verified digest, P1 file-set parity.)
    if old.state = 'in_progress' and new.state = 'verified' then
      if new.verified_at is null or new.verification_digest is null then
        raise exception using
          errcode = '22023',
          message = 'verified transition requires verified_at and verification_digest';
      end if;
      if not private.import_session_has_exact_parity(new.account_id, new.id) then
        raise exception using
          errcode = '22023',
          message = 'verified transition requires exact parity with the version file set';
      end if;
      if not (
        exists (
          select 1
          from private.managed_skill_versions as versions
          where versions.account_id = new.account_id
            and versions.managed_skill_id = new.managed_skill_id
            and versions.id = new.version_id
            and versions.manifest_schema_version = new.manifest_schema_version
            and versions.manifest_digest = new.manifest_digest
            and versions.content_digest = new.content_digest
        )
      ) then
        raise exception using
          errcode = '22023',
          message = 'verified transition requires manifest/schema identity parity with the bound version';
      end if;
      -- The supplied digest must be the exact deterministic digest derived from
      -- the bound session and its accepted receipt set. This is the same helper
      -- `finalize_import_session` uses, so no formula drift is possible and a
      -- fabricated digest (e.g. all-zero) cannot forge a verified state.
      if new.verification_digest is distinct from
         private.import_session_verification_digest(new.account_id, new.id)
      then
        raise exception using
          errcode = '22023',
          message = 'verified transition requires the exact deterministic verification digest';
      end if;
    end if;

    new.revision := old.revision + 1;
    new.updated_at := pg_catalog.statement_timestamp();
  end if;

  return new;
end;
$function$;

create trigger trg_import_sessions_enforce_update
before insert or update on private.import_sessions
for each row execute function private.enforce_import_session_update();

-- Exact-parity proof: returns true only when the session's receipt set is exactly
-- the authoritative managed_skill_files set for the bound version (same count and
-- byte total), every receipt ordinal equals the contiguous set 0..N-1 with no
-- duplicates, and each version file has exactly one matching receipt (no missing,
-- substituted, or extra file). Manifest/content/schema identity is compared against
-- the bound version. (Audit fixes: P1 set parity, P1 unforgeable verified.)
create function private.import_session_has_exact_parity(
  p_account_id uuid,
  p_session_id uuid
)
returns boolean
language plpgsql
set search_path = ''
as $function$
declare
  v_session private.import_sessions%rowtype;
  v_count bigint;
  v_bytes bigint;
  v_expected_count bigint;
  v_expected_bytes bigint;
begin
  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = p_account_id
    and sessions.id = p_session_id;

  if not found then
    return false;
  end if;

  select count(*)::bigint, coalesce(sum(r.accepted_byte_size), 0::bigint)
    into v_count, v_bytes
  from private.import_file_receipts as r
  where r.account_id = p_account_id and r.session_id = p_session_id;

  select count(*)::bigint, coalesce(sum(f.byte_size), 0::bigint)
    into v_expected_count, v_expected_bytes
  from private.managed_skill_files as f
  where f.account_id = v_session.account_id
    and f.managed_skill_id = v_session.managed_skill_id
    and f.version_id = v_session.version_id;

  if v_count <> v_expected_count or v_bytes <> v_expected_bytes then
    return false;
  end if;

  -- The session row must itself agree with both aggregates. M2.05 permits DELETE
  -- on managed_skill_files: after a one-file set is deleted, its receipt cascades
  -- and both the authoritative and receipt aggregates drop to 0/0 while the
  -- session still records expected/accepted 1/3. Without these checks the helper
  -- would return true and finalize an empty set. Require all four equalities.
  -- (Final P1: session-row parity.)
  if v_session.expected_file_count::bigint <> v_expected_count
     or v_session.expected_byte_total <> v_expected_bytes
     or v_session.accepted_file_count::bigint <> v_count
     or v_session.accepted_byte_total <> v_bytes
  then
    return false;
  end if;

  -- No missing version file, and no extra/substituted receipt, and contiguous
  -- ordinals 0..N-1 (implied by "every version file has a matching receipt" plus
  -- equal counts plus receipt ordinal uniqueness from the table).
  -- Every authoritative version file must have exactly one matching receipt.
  if exists (
    select 1
    from private.managed_skill_files as f
    where f.account_id = v_session.account_id
      and f.managed_skill_id = v_session.managed_skill_id
      and f.version_id = v_session.version_id
      and not exists (
        select 1
        from private.import_file_receipts as r
        where r.account_id = p_account_id
          and r.session_id = p_session_id
          and r.file_id = f.id
      )
  ) then
    return false;
  end if;

  -- No receipt may reference a file outside this version's set (no extra or
  -- substituted file), and each receipt's ordinal must match the authoritative
  -- ordinal its version file carries.
  if exists (
    select 1
    from private.import_file_receipts as r
    where r.account_id = p_account_id
      and r.session_id = p_session_id
      and (
        not exists (
          select 1
          from private.managed_skill_files as f
          where f.account_id = v_session.account_id
            and f.managed_skill_id = v_session.managed_skill_id
            and f.version_id = v_session.version_id
            and f.id = r.file_id
        )
        or exists (
          select 1
          from private.managed_skill_files as f2
          where f2.account_id = v_session.account_id
            and f2.managed_skill_id = v_session.managed_skill_id
            and f2.version_id = v_session.version_id
            and f2.id = r.file_id
            and f2.ordinal is distinct from r.ordinal
        )
      )
  ) then
    return false;
  end if;

  -- Ordinal completeness: the accepted ordinals must be exactly the contiguous
  -- set 0..N-1 (N = authoritative file count). This is NOT implied by the
  -- bijection checks above because M2.05 only guarantees nonnegative unique
  -- ordinals (e.g. {0,5}); a gapped set must not pass parity. (P1 gapped ordinal
  -- fix.)
  if exists (
    select 1
    from pg_catalog.generate_series(0, v_expected_count - 1) as expected_ordinal
    where not exists (
      select 1
      from private.import_file_receipts as r
      where r.account_id = p_account_id
        and r.session_id = p_session_id
        and r.ordinal = expected_ordinal
    )
  ) then
    return false;
  end if;

  -- Schema/manifest/content identity parity with the bound version.
  if not exists (
    select 1
    from private.managed_skill_versions as versions
    where versions.account_id = v_session.account_id
      and versions.managed_skill_id = v_session.managed_skill_id
      and versions.id = v_session.version_id
      and versions.manifest_schema_version = v_session.manifest_schema_version
      and versions.manifest_digest = v_session.manifest_digest
      and versions.content_digest = v_session.content_digest
  ) then
    return false;
  end if;

  return true;
end;
$function$;

-- Deterministic verification digest for a session: binds the session id, the
-- ordered accepted receipt set (digest:ordinal by ordinal), the expected byte
-- total, and the manifest/content digests. This single helper is used by BOTH
-- `finalize_import_session` (to write the digest) and the verified-transition
-- guard in `enforce_import_session_update` (to reject a forged digest), so the
-- formula cannot drift. (Audit fix: P1 forged verified digest; single source.)
create function private.import_session_verification_digest(
  p_account_id uuid,
  p_session_id uuid
)
returns text
language plpgsql
set search_path = ''
as $function$
declare
  v_session private.import_sessions%rowtype;
  v_order_digest text;
begin
  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = p_account_id
    and sessions.id = p_session_id;

  if not found then
    return null;
  end if;

  select coalesce(
    'sha256:' || pg_catalog.encode(
      extensions.digest(
        convert_to(
          coalesce(
            pg_catalog.string_agg(
              r.file_digest || ':' || r.ordinal::text,
              ','
              order by r.ordinal
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    null
  ) into v_order_digest
  from private.import_file_receipts as r
  where r.account_id = p_account_id
    and r.session_id = p_session_id;

  return 'sha256:' || pg_catalog.encode(
    extensions.digest(
      convert_to(
        p_session_id::text || '|' ||
        coalesce(v_order_digest, '') || '|' ||
        v_session.expected_byte_total::text || '|' ||
        v_session.manifest_digest || '|' ||
        v_session.content_digest,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

-- File receipts are append-only and immutable once written.
create function private.enforce_import_file_receipt_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.account_id is distinct from old.account_id
      or new.device_id is distinct from old.device_id
      or new.session_id is distinct from old.session_id
      or new.file_id is distinct from old.file_id
      or new.managed_skill_id is distinct from old.managed_skill_id
      or new.version_id is distinct from old.version_id
      or new.relative_path is distinct from old.relative_path
      or new.media_type is distinct from old.media_type
      or new.accepted_byte_size is distinct from old.accepted_byte_size
      or new.file_digest is distinct from old.file_digest
      or new.ordinal is distinct from old.ordinal
      or new.accepted_at is distinct from old.accepted_at
    then
      raise exception using
        errcode = '22023',
        message = 'import file receipts are immutable';
    end if;
  end if;
  return new;
end;
$function$;

create trigger trg_import_file_receipts_enforce_immutability
before insert or update on private.import_file_receipts
for each row execute function private.enforce_import_file_receipt_immutability();

-- -----------------------------------------------------------------------------
-- Implementation functions (ungranted until M2.11).
-- -----------------------------------------------------------------------------

-- Begin a resumable import session. The same (account, device, idempotency_key)
-- input resumes the same session; a conflicting reuse fails closed.
create function private.begin_import_session(
  p_account_id uuid,
  p_device_id uuid,
  p_managed_skill_id uuid,
  p_version_id uuid,
  p_manifest_schema_version text,
  p_manifest_digest text,
  p_content_digest text,
  p_expected_file_count integer,
  p_expected_byte_total bigint,
  p_idempotency_key uuid,
  p_expiry_at timestamp with time zone default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_session_id uuid;
  v_existing private.import_sessions%rowtype;
begin
  if p_account_id is null
    or p_device_id is null
    or p_managed_skill_id is null
    or p_version_id is null
    or p_manifest_schema_version is null
    or p_manifest_digest is null
    or p_content_digest is null
    or p_expected_file_count is null
    or p_expected_byte_total is null
    or p_idempotency_key is null
  then
    raise exception 'invalid import session begin request' using errcode = '22023';
  end if;

  if p_expected_file_count < 1 then
    raise exception 'import session expects at least one file' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.devices as devices
    where devices.account_id = p_account_id
      and devices.id = p_device_id
      and devices.state = 'active'
      and devices.revoked_at is null
      and (devices.expires_at is null or devices.expires_at > v_now)
  ) then
    raise exception 'device is not available for import' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.managed_skill_versions as versions
    where versions.account_id = p_account_id
      and versions.managed_skill_id = p_managed_skill_id
      and versions.id = p_version_id
  ) then
    raise exception 'skill version is not available for import' using errcode = '22023';
  end if;

  -- Digest parity: the manifest/content digests declared for this session must
  -- equal the exact immutable digests of the bound managed-skill version. A
  -- caller cannot introduce a different manifest/content identity for an
  -- existing version. (Audit fix: P1 digest parity.)
  if not exists (
    select 1
    from private.managed_skill_versions as versions
    where versions.account_id = p_account_id
      and versions.managed_skill_id = p_managed_skill_id
      and versions.id = p_version_id
      and versions.manifest_digest = p_manifest_digest
      and versions.content_digest = p_content_digest
  ) then
    raise exception 'manifest/content digest does not match the bound skill version' using errcode = '22023';
  end if;

  -- Schema-version parity: the caller-declared manifest schema version must equal
  -- the schema version of the authoritative bound version. A session cannot bind
  -- a schema-version identity different from the version row. (Audit fix: P3.)
  if not exists (
    select 1
    from private.managed_skill_versions as versions
    where versions.account_id = p_account_id
      and versions.managed_skill_id = p_managed_skill_id
      and versions.id = p_version_id
      and versions.manifest_schema_version = pg_catalog.btrim(p_manifest_schema_version)
  ) then
    raise exception 'manifest schema version does not match the bound skill version' using errcode = '22023';
  end if;

  -- expected_file_count and expected_byte_total are NOT caller-chosen: they are
  -- derived from the authoritative full managed_skill_files set of the bound
  -- version. The caller-declared expectations must equal that set. This closes
  -- the "subset expected counts finalize one accepted file" defect. (Audit fix: P1.)
  if not exists (
    select 1
    from (
      select count(*)::integer as cnt, coalesce(sum(files.byte_size), 0::numeric)::bigint as tot
      from private.managed_skill_files as files
      where files.account_id = p_account_id
        and files.managed_skill_id = p_managed_skill_id
        and files.version_id = p_version_id
    ) as authoritative
    where authoritative.cnt = p_expected_file_count
      and authoritative.tot = p_expected_byte_total
  ) then
    raise exception 'expected file count/byte total do not match the bound version file set' using errcode = '22023';
  end if;

  if p_expiry_at is not null and p_expiry_at <= v_now then
    raise exception 'import session expiry must be in the future' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 4)
  );

  select sessions.* into v_existing
  from private.import_sessions as sessions
  where sessions.account_id = p_account_id
    and sessions.device_id = p_device_id
    and sessions.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.state = 'in_progress'
      and v_existing.managed_skill_id = p_managed_skill_id
      and v_existing.version_id = p_version_id
      and v_existing.manifest_schema_version = pg_catalog.btrim(p_manifest_schema_version)
      and v_existing.manifest_digest = p_manifest_digest
      and v_existing.content_digest = p_content_digest
      and v_existing.expected_file_count = p_expected_file_count
      and v_existing.expected_byte_total = p_expected_byte_total
    then
      -- Idempotent resume of the same work: return the existing session id.
      return v_existing.id;
    end if;
    raise exception 'conflicting import session idempotency reuse' using errcode = '22023';
  end if;

  insert into private.import_sessions (
    account_id, device_id, managed_skill_id, version_id,
    manifest_schema_version, manifest_digest, content_digest,
    expected_file_count, expected_byte_total, idempotency_key, expiry_at, state
  ) values (
    p_account_id, p_device_id, p_managed_skill_id, p_version_id,
    pg_catalog.btrim(p_manifest_schema_version), p_manifest_digest, p_content_digest,
    p_expected_file_count, p_expected_byte_total, p_idempotency_key,
    coalesce(p_expiry_at, v_now + interval '6 hours'), 'in_progress'
  ) returning id into v_session_id;

  return v_session_id;
end;
$function$;

-- Provide a read-only projection of a resumable session for its owner (no
-- internal disclosure beyond the owner's own session). Security-invoker so it
-- observes the caller's RLS; in M2.08 it is only reachable by the definer
-- channel used by the connector flow to be granted in M2.11.
create function private.resume_import_session(
  p_account_id uuid,
  p_device_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_session private.import_sessions%rowtype;
begin
  if p_account_id is null or p_device_id is null or p_session_id is null then
    return null;
  end if;

  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = p_account_id
    and sessions.device_id = p_device_id
    and sessions.id = p_session_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'imp_', v_session.imp_,
    'state', v_session.state,
    'expected_file_count', v_session.expected_file_count,
    'accepted_file_count', v_session.accepted_file_count,
    'expected_byte_total', v_session.expected_byte_total,
    'accepted_byte_total', v_session.accepted_byte_total,
    'expiry_at', v_session.expiry_at,
    'revision', v_session.revision
  );
end;
$function$;

-- Accept one file into an open session. The file must be a real
-- `private.managed_skill_files` row in this session's exact (account, skill,
-- version), and the provided byte/digest/ordinal must match it exactly. A
-- veteran replay of an already-accepted file or ordinal fails closed (never
-- double-counts). Counters are reconciled transactionally from the receipt set.
create function private.accept_import_file(
  p_account_id uuid,
  p_device_id uuid,
  p_session_id uuid,
  p_file_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.import_sessions%rowtype;
  v_file private.managed_skill_files%rowtype;
  v_dup_ordinal bigint;
  v_dup_file bigint;
  v_projected_bytes bigint;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if p_account_id is null or p_device_id is null or p_session_id is null or p_file_id is null then
    raise exception 'invalid import file accept request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 4)
  );

  -- The caller must act through the exact device that owns the session. A
  -- different device of the same account cannot accept into it. (Audit fix:
  -- P1 device isolation.)
  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = p_account_id
    and sessions.device_id = p_device_id
    and sessions.id = p_session_id
  for update;

  if not found then
    raise exception 'import session was not found for this account/device' using errcode = '22023';
  end if;

  if v_session.state is distinct from 'in_progress' then
    raise exception 'import session is not open for acceptance' using errcode = '22023';
  end if;

  if v_session.expiry_at is not null and v_session.expiry_at <= v_now then
    raise exception 'import session is expired' using errcode = '42501';
  end if;

  -- The file row is read-only in this function; a plain read (after the account
-- advisory lock and the session row lock, which are both earlier in the global
-- order) cannot be reversed by another import acceptor in the same account. We
-- intentionally do not take `for update` on the file row to preserve the
-- global row-lock order (files precede sessions).
  select files.* into v_file
  from private.managed_skill_files as files
  where files.account_id = p_account_id
    and files.managed_skill_id = v_session.managed_skill_id
    and files.version_id = v_session.version_id
    and files.id = p_file_id;

  if not found then
    raise exception 'file is outside this session account/skill/version' using errcode = '22023';
  end if;

  -- Replay protection first: an already-accepted file (same account/session/file)
  -- must fail closed as a file replay rather than surfacing an ordinal collision,
  -- so a distinguished message reflects the true replay cause.
  select count(*) into v_dup_file
  from private.import_file_receipts as receipts
  where receipts.account_id = p_account_id
    and receipts.session_id = p_session_id
    and receipts.file_id = p_file_id;

  if v_dup_file > 0 then
    raise exception 'import file is already accepted' using errcode = '22023';
  end if;

  -- A different file in the same session may not reuse an ordinal already taken.
  select count(*) into v_dup_ordinal
  from private.import_file_receipts as receipts
  where receipts.account_id = p_account_id
    and receipts.session_id = p_session_id
    and receipts.ordinal = v_file.ordinal;

  if v_dup_ordinal > 0 then
    raise exception 'import file ordinal is already accepted' using errcode = '22023';
  end if;

  -- Over-byte guard: accepting this file must not push the projected accepted
  -- byte total beyond the session's expected byte total. This prevents the
  -- accepted byte total ever exceeding its expectation (audit fix: P1
  -- over-byte acceptance poisoning), even before finalize runs.
  select coalesce(sum(existing_file.accepted_byte_size), 0::numeric)::bigint
    into v_projected_bytes
  from private.import_file_receipts as existing_file
  where existing_file.account_id = p_account_id
    and existing_file.session_id = p_session_id;

  if v_projected_bytes + v_file.byte_size > v_session.expected_byte_total then
    raise exception 'import byte total would exceed the session expectation' using errcode = '22023';
  end if;

  insert into private.import_file_receipts (
    account_id, device_id, session_id, file_id, managed_skill_id, version_id,
    relative_path, media_type, accepted_byte_size, file_digest, ordinal, accepted_at
  ) values (
    v_session.account_id,
    v_session.device_id,
    v_session.id,
    v_file.id,
    v_file.managed_skill_id,
    v_file.version_id,
    v_file.relative_path,
    v_file.media_type,
    v_file.byte_size,
    v_file.file_digest,
    v_file.ordinal,
    v_now
  );

  -- Reconcile the accepted counters strictly from the receipt set.
  update private.import_sessions as sessions
  set
    accepted_file_count = (
      select count(*)::integer
      from private.import_file_receipts as receipts
      where receipts.account_id = p_account_id
        and receipts.session_id = p_session_id
    ),
    accepted_byte_total = (
      select coalesce(sum(receipts.accepted_byte_size), 0::numeric)::bigint
      from private.import_file_receipts as receipts
      where receipts.account_id = p_account_id
        and receipts.session_id = p_session_id
    ),
    updated_at = v_now,
    revision = sessions.revision + 1
  where sessions.account_id = p_account_id
    and sessions.id = p_session_id;
end;
$function$;

-- Finalize: mark the session verified only when the accepted receipts exactly
-- match every expected bound (file count, byte total, per-session ordinal-set
-- completeness, and manifest/content digest parity) and a deterministic
-- verification digest over the accepted set can be computed. Terminal
-- verification is never inferred after a crash; it is only written here after a
-- live read-back proves exact parity.
create function private.finalize_import_session(
  p_account_id uuid,
  p_device_id uuid,
  p_session_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.import_sessions%rowtype;
  v_verified_session_digest text;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if p_account_id is null or p_device_id is null or p_session_id is null then
    raise exception 'invalid import finalize request' using errcode = '22023';
  end if;

  -- The session must belong to the exact caller device; a different device of
  -- the same account cannot finalize it. (Audit fix: P1 device isolation.)
  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = p_account_id
    and sessions.device_id = p_device_id
    and sessions.id = p_session_id
  for update;

  if not found then
    raise exception 'import session was not found for this account/device' using errcode = '22023';
  end if;

  if v_session.state is distinct from 'in_progress' then
    raise exception 'import session is not open for finalization' using errcode = '22023';
  end if;

  if v_session.expiry_at is not null and v_session.expiry_at <= v_now then
    raise exception 'import session is expired' using errcode = '42501';
  end if;

  -- Exact parity is proven against the authoritative version file set (full count,
  -- byte total, contiguous ordinals, no missing/substituted/extra files, and
  -- schema/manifest/content identity parity). finalize may only transition to
  -- `verified` after this proof holds; the session UPDATE trigger re-verifies it
  -- so a bare UPDATE cannot manufacture verified. (Audit fixes: P1 file-set
  -- parity/unforgeable verified; P3 schema-version parity.)
  if not private.import_session_has_exact_parity(p_account_id, p_session_id) then
    raise exception 'import session does not match the authoritative version file set' using errcode = '22023';
  end if;

  -- Deterministic verification digest. This is the single shared helper that the
  -- verified-transition guard also uses, so the digest written here and the one
  -- validated at the UPDATE boundary are computed by the identical formula (no
  -- drift). (Audit fix: P1 forged verified digest, single helper.)
  v_verified_session_digest := private.import_session_verification_digest(p_account_id, p_session_id);

  update private.import_sessions as sessions
  set
    state = 'verified',
    verified_at = v_now,
    verification_digest = v_verified_session_digest,
    updated_at = v_now,
    revision = sessions.revision + 1
  where sessions.account_id = p_account_id
    and sessions.id = p_session_id;

  return p_session_id;
end;
$function$;

-- Idempotently mark an overdue session expired (or a caller-specified terminal
-- cancel). Only an account-own session can be expired; a nonterminal session may
-- be moved to `expired`. Returns true when a transition occurred or the row was
-- already terminal, false when the session is not found for this account.
create function private.expire_import_session(
  p_account_id uuid,
  p_device_id uuid,
  p_session_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session private.import_sessions%rowtype;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if p_account_id is null or p_device_id is null or p_session_id is null then
    return false;
  end if;

  -- The session must belong to the exact caller device. (Audit fix: P1 device
  -- isolation for expiry.)
  select sessions.* into v_session
  from private.import_sessions as sessions
  where sessions.account_id = p_account_id
    and sessions.device_id = p_device_id
    and sessions.id = p_session_id
  for update;

  if not found then
    return false;
  end if;

  if v_session.state in ('verified', 'cancelled', 'expired') then
    return true;
  end if;

  update private.import_sessions as sessions
  set
    state = 'expired',
    updated_at = v_now,
    revision = sessions.revision + 1
  where sessions.account_id = p_account_id
    and sessions.device_id = p_device_id
    and sessions.id = p_session_id;

  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Least-privilege posture (matches M2.07 conventions): revoke everything from
-- every application role and the definer role; RLS enabled and forced; no
-- policies.
-- ---------------------------------------------------------------------------
revoke all privileges on table private.import_sessions
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.import_file_receipts
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_import_session_update()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_import_file_receipt_immutability()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.import_session_has_exact_parity(uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.import_session_verification_digest(uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.begin_import_session(
  uuid, uuid, uuid, uuid, text, text, text, integer, bigint, uuid, timestamp with time zone
) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.resume_import_session(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.accept_import_file(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.finalize_import_session(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.expire_import_session(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

alter table private.import_sessions enable row level security;
alter table private.import_sessions force row level security;
alter table private.import_file_receipts enable row level security;
alter table private.import_file_receipts force row level security;

-- Intentionally no row-level security policies and no grants before M2.11.

commit;