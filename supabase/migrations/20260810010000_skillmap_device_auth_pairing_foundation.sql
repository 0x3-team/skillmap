begin;

set local search_path = '';

-- =============================================================================
-- M3.03 — DeviceAuth pairing foundation (feature-disabled).
-- -----------------------------------------------------------------------------
-- Adds the dedicated definer role, the DeviceAuth pairing/receipt foundation
-- tables, and the server-only `api.device_auth_initiate_v1` RPC for M1.08
-- pairing initiation. Per M3.02 Decision 3/9 this is the first forward-only
-- DeviceAuth lineage migration: every table is RLS-enabled and UNGRANTED, the
-- RPC is un-executable by anon/authenticated/service_role (feature OFF), and
-- legacy grants are untouched. Secret plaintext (device_code/user_code and
-- exchange_code/refresh) is never stored — only purpose-separated SHA-256
-- digests are the cryptographic lookup handle, matching M1.08. Proof signature
-- verification is performed in the Node service layer (crypto.subtle); this
-- RPC validates frozen bounds, enforces idempotency, and persists.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Dedicated definer role + private schema.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'skillmap_device_auth_definer') then
    create role skillmap_device_auth_definer
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end
$$;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- 1. Device key bindings: immutable suite + canonical public key + thumbprint.
-- ---------------------------------------------------------------------------
create table if not exists private.device_auth_key_bindings (
  device_id text not null,
  proof_suite text not null,
  public_key text not null,
  key_thumbprint text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  retired_at timestamptz,
  constraint device_auth_key_bindings_pk primary key (device_id, proof_suite, key_thumbprint),
  constraint device_auth_key_bindings_device_id_matching
    check (device_id ~ '^[A-Za-z0-9_-]{22}$'),
  constraint device_auth_key_bindings_thumbprint_matching
    check (key_thumbprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint device_auth_key_bindings_retirement_check
    check (retired_at is null or (not is_active))
);
-- A device holds at most ONE active binding per proof suite. This partial
-- unique index is the single-writer guarantee: an exact re-initiation plainly
-- upserts the same (device_id, proof_suite, key_thumbprint) row, while a key
-- rotation can only take effect through an explicit retirement, never a silent
-- blanket UPDATE during initiate.
create unique index if not exists device_auth_key_bindings_one_active_per_device
  on private.device_auth_key_bindings (device_id, proof_suite)
  where is_active;
alter table private.device_auth_key_bindings enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Code digests: device/user/exchange code verified digests. Never the
--    raw codes.
-- ---------------------------------------------------------------------------
create table if not exists private.device_auth_code_digests (
  digest_kind text not null,
  digest_hex text not null,
  device_id text not null,
  pairing_id uuid,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint device_auth_code_digests_pk primary key (digest_kind, digest_hex),
  constraint device_auth_code_digests_kind_check
    check (digest_kind in ('device_code','user_code','exchange_code')),
  constraint device_auth_code_digests_sha256_matching
    check (digest_hex ~ '^[0-9a-f]{64}$')
);
alter table private.device_auth_code_digests enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Pairings (pending -> approved -> grant_issued -> exchanged; or terminal).
-- ---------------------------------------------------------------------------
create table if not exists private.device_auth_pairings (
  pairing_id uuid primary key default pg_catalog.gen_random_uuid(),
  device_id text not null,
  key_thumbprint text not null,
  audience_literal text not null,
  requested_scopes text[] not null,
  display_name text,
  platform text not null,
  connector_version text not null,
  locale text,
  verification_uri text not null,
  state text not null default 'pending',
  status_reason text,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  exchanged_at timestamptz,
  account_public_id text,
  constraint device_auth_pairings_platform_check
    check (platform in ('macos','windows','linux')),
  constraint device_auth_pairings_state_check
    check (state in ('pending','approved','blocked','granted','denied','cancelled','expired')),
  constraint device_auth_pairings_expiry_check
    check (expires_at > created_at),
  constraint device_auth_pairings_scopes_nonempty
    check (pg_catalog.cardinality(requested_scopes) between 1 and 5),
  constraint device_auth_pairings_audience_check
    check (audience_literal = 'skillmap.connector.v1'),
  constraint device_auth_pairings_confirm_check
    check (confirmed_at is null or confirmed_at >= created_at)
);
alter table private.device_auth_pairings enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Nonce replay guard (device, purpose, nonce).
-- ---------------------------------------------------------------------------
create table if not exists private.device_auth_proof_nonces (
  device_id text not null,
  proof_purpose text not null,
  nonce text not null,
  issued_at timestamptz not null default pg_catalog.statement_timestamp(),
  expires_at timestamptz not null,
  constraint device_auth_proof_nonces_pk
    primary key (device_id, proof_purpose, nonce),
  constraint device_auth_proof_nonces_nonce_matching
    check (nonce ~ '^[A-Za-z0-9_-]{22}$'),
  constraint device_auth_proof_nonces_expiry_check
    check (expires_at > issued_at)
);
alter table private.device_auth_proof_nonces enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Idempotency receipts: principal/operation/idempotency-key -> bounded
--    outcome JSON + exact request digest. Same key -> same response only.
-- ---------------------------------------------------------------------------
create table if not exists private.device_auth_idempotency_receipts (
  principal_kind text not null,
  principal text not null,
  operation text not null,
  idempotency_key text not null,
  request_digest text not null,
  outcome_json jsonb not null,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  expired_at timestamptz not null,
  constraint device_auth_idempotency_receipts_pk
    primary key (principal, operation, idempotency_key),
  constraint device_auth_idempotency_receipts_op_check
    check (operation = 'initiate'),
  constraint device_auth_idempotency_key_matching
    check (idempotency_key ~ '^[A-Za-z0-9_-]{22}$'),
  constraint device_auth_idempotency_digest_matching
    check (request_digest ~ '^sha256:[0-9a-f]{64}$')
);
alter table private.device_auth_idempotency_receipts enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Non-IP rate buckets (device/pairing/session). N+1 rejects.
-- ---------------------------------------------------------------------------
create table if not exists private.device_auth_rate_buckets (
  bucket_kind text not null,
  bucket_key text not null,
  window_start timestamptz not null default pg_catalog.statement_timestamp(),
  count integer not null default 0,
  constraint device_auth_rate_buckets_pk primary key (bucket_kind, bucket_key),
  constraint device_auth_rate_buckets_count_check check (count >= 0)
);
alter table private.device_auth_rate_buckets enable row level security;

-- ---------------------------------------------------------------------------
-- 7. Bounded error helper (functional, reached only by the definer RPC).
-- ---------------------------------------------------------------------------
create or replace function private.device_auth_error_json(
  p_code text,
  p_description text,
  p_retry integer default 0
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'error', p_code,
    'error_description', p_description,
    'retry_after', p_retry
  );
$function$;

-- ---------------------------------------------------------------------------
-- 8. Pairing secret generation (cryptographic; built-ins only). Only the
--    SHA-256 digests are persisted; raw codes are returned once to the
--    connector in the response.
-- ---------------------------------------------------------------------------
create or replace function private.device_auth_generate_pairing_secrets()
returns table (device_code text, user_code text, device_code_digest text, user_code_digest text)
language sql
security definer
set search_path = ''
as $function$
  with entropy as (
    -- Cryptographic random bytes, not UUID text: never hyphenated, and the
    -- 256 alphabet divides exactly by the 32 Crockford bins, so % 32 below is
    -- unbiased (no signed bigint modulo, no rejection loop needed).
    select
      extensions.gen_random_bytes(32) as device_bits,
      extensions.gen_random_bytes(10) as user_bits
  ),
  encoded as (
    select
      -- device_code: 32 random bytes -> 43-char unpadded base64url (256-bit code).
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.rtrim(pg_catalog.encode(device_bits, 'base64'), '='),
          '+', '-'
        ), '/', '_'
      ) as device_code_raw,
      user_bits
    from entropy
  ),
  user_coded as (
    select
      device_code_raw,
      -- user_code: 10 Crockford base32 chars, one uniform 5-bit group per byte.
      -- 256 = 8 * 32 exactly, so each byte % 32 is a perfectly uniform index.
      substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 0) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 1) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 2) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 3) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 4) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 5) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 6) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 7) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 8) % 32)::int, 1)
        || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (1 + pg_catalog.get_byte(user_bits, 9) % 32)::int, 1) as raw_user_code
    from encoded
  )
  select
    device_code_raw as device_code,
    substr(raw_user_code, 1, 5) || '-' || substr(raw_user_code, 6, 5) as user_code,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(device_code_raw, 'UTF8')), 'hex') as device_code_digest,
    pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(substr(raw_user_code, 1, 5) || '-' || substr(raw_user_code, 6, 5), 'UTF8')),
      'hex'
    ) as user_code_digest
  from user_coded;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Server-only initiate RPC (feature-disabled: no role is granted EXECUTE).
--    Returns a closed JSON response object, or a bounded error object. Proof
--    authenticity was already verified in the service layer. This function is
--    forward-only (M3.02): it absorbs the M1.08 idempotency/nonce/issued-at/
--    request-digest envelope and a non-IP rate bucket, atomically and in one
--    transaction. Drop any earlier one-signature overload so the registry is
--    single-typed (forward-only lineage; no other schema references it).
-- ---------------------------------------------------------------------------
drop function if exists api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,integer,integer);
create or replace function api.device_auth_initiate_v1(
  p_device_id text,
  p_device_public_key text,
  p_key_thumbprint text,
  p_audience text,
  p_proof_suite text,
  p_requested_scopes text[],
  p_platform text,
  p_connector_version text,
  p_verification_uri_prefix text,
  p_idempotency_key text,
  p_proof_purpose text,
  p_proof_nonce text,
  p_issued_at text,
  p_request_digest text,
  p_display_name text default null,
  p_locale text default null,
  p_expires_in integer default 600,
  p_interval integer default 5,
  p_rate_window_seconds integer default 600,
  p_rate_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pairing_id uuid;
  v_created_at timestamptz := pg_catalog.statement_timestamp();
  v_expires_at timestamptz;
  v_uri text;
  v_device_code text;
  v_user_code text;
  v_device_code_digest text;
  v_user_code_digest text;
  v_nonce_expires_at timestamptz;
  v_receipt_digest text;
  v_stored_outcome jsonb;
  v_rate_count integer;
  v_rate_reset timestamptz;
  v_retry_after integer;
begin
  -- 0. Bounds (fail closed) — every invariant the schema cannot express.
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{22}$' then
    return private.device_auth_error_json('invalid_request', 'device_id is invalid.');
  end if;
  if p_key_thumbprint is null or p_key_thumbprint !~ '^sha256:[0-9a-f]{64}$' then
    return private.device_auth_error_json('invalid_request', 'key_thumbprint is invalid.');
  end if;
  if p_audience is distinct from 'skillmap.connector.v1' then
    return private.device_auth_error_json('invalid_client', 'audience is not supported.');
  end if;
  if p_proof_suite is distinct from 'skillmap.ecdsa-p256-sha256.v2' then
    return private.device_auth_error_json('invalid_client', 'proof_suite is not supported.');
  end if;
  if p_proof_purpose is distinct from 'initiate' then
    return private.device_auth_error_json('invalid_client', 'proof_purpose is not supported.');
  end if;
  if p_device_public_key is null or p_device_public_key !~ '^[A-Za-z0-9_-]{122}$' then
    return private.device_auth_error_json('invalid_request', 'device_public_key is invalid.');
  end if;
  if p_platform is null or p_platform not in ('macos','windows','linux') then
    return private.device_auth_error_json('invalid_request', 'platform is invalid.');
  end if;
  if p_connector_version is null or p_connector_version !~ '^[0-9]+[.][0-9]+[.][0-9]+(-[0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$' then
    return private.device_auth_error_json('invalid_request', 'connector_version is invalid.');
  end if;
  if p_verification_uri_prefix is null or p_verification_uri_prefix !~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$' then
    return private.device_auth_error_json('invalid_request', 'verification_uri_prefix is invalid.');
  end if;
  if p_expires_in is null or p_expires_in not between 1 and 600 then
    return private.device_auth_error_json('invalid_request', 'expires_in is out of bounds.');
  end if;
  if p_interval is null or p_interval not between 1 and 60 then
    return private.device_auth_error_json('invalid_request', 'interval is out of bounds.');
  end if;
  if p_display_name is not null and (pg_catalog.octet_length(p_display_name) > 64 or p_display_name ~ '[[:cntrl:]]') then
    return private.device_auth_error_json('invalid_request', 'display_name is invalid.');
  end if;
  if p_locale is not null and (pg_catalog.octet_length(p_locale) < 2 or pg_catalog.octet_length(p_locale) > 35) then
    return private.device_auth_error_json('invalid_request', 'locale is invalid.');
  end if;
  if p_requested_scopes is null or not private.device_scopes_are_canonical(p_requested_scopes) then
    return private.device_auth_error_json('invalid_scope', 'requested_scopes are not canonical.');
  end if;
  -- M1.08 idempotency / nonce / issued-at / request-digest envelope gates.
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{22}$' then
    return private.device_auth_error_json('invalid_request', 'idempotency_key is invalid.');
  end if;
  if p_proof_nonce is null or p_proof_nonce !~ '^[A-Za-z0-9_-]{22}$' then
    return private.device_auth_error_json('invalid_request', 'proof_nonce is invalid.');
  end if;
  if p_request_digest is null or p_request_digest !~ '^sha256:[0-9a-f]{64}$' then
    return private.device_auth_error_json('invalid_request', 'request_digest is invalid.');
  end if;
  if p_issued_at is null or p_issued_at !~ '^[0-9]{1,20}$' then
    return private.device_auth_error_json('invalid_request', 'issued_at is invalid.');
  end if;
  if p_rate_window_seconds is null or p_rate_window_seconds not between 1 and 86400
     or p_rate_limit is null or p_rate_limit not between 1 and 100000 then
    return private.device_auth_error_json('invalid_request', 'rate inputs are invalid.');
  end if;

  -- 1. Idempotency: an existing receipt for this device/operation/key wins.
  --    Same key + same request digest returns the identical stored outcome
  --    (exact replay); same key + a changed digest is a conflict.
  --
  --    Before any receipt or key-binding read, serialize every initiation for
  --    this device and proof suite. This gives an identical idempotency key
  --    one winner and prevents different keys from racing the one-active-key
  --    check below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'device-auth-initiate:' || p_device_id || ':skillmap.ecdsa-p256-sha256.v2',
      7461
    )
  );

  select ir.request_digest, ir.outcome_json
    into v_receipt_digest, v_stored_outcome
  from private.device_auth_idempotency_receipts ir
   where ir.principal_kind = 'device'
     and ir.principal = p_device_id
     and ir.operation = 'initiate'
     and ir.idempotency_key = p_idempotency_key
   order by ir.created_at desc
   limit 1
  for update;

  if v_stored_outcome is not null then
    if v_receipt_digest = p_request_digest then
      -- Exact replay after the initial response was created: return the same.
      return v_stored_outcome;
    else
      -- Same idempotency key but a different request digest: conflict.
      return private.device_auth_error_json('idempotency_conflict', 'Same idempotency key with a changed request cannot be accepted.');
    end if;
  end if;

  -- 2. Non-IP rate limit: atomic rolling bucket on the device key (M3.02
  --    Decision 5). N succeeds, N+1 returns fixed rate_limited with retry_after.
  insert into private.device_auth_rate_buckets (bucket_kind, bucket_key, window_start, count)
  values ('device-initiate', p_device_id, v_created_at, 1)
  on conflict (bucket_kind, bucket_key) do update
    set
      count = case
        -- Window is still open: increment (and re-anchor the start to keep a
        -- true fixed window is optional; M3.02 uses rolling, this is a near
        -- fixed-window that only matters for the N/N+1 boundary).
        when private.device_auth_rate_buckets.window_start > v_created_at - pg_catalog.make_interval(secs => p_rate_window_seconds)
          then private.device_auth_rate_buckets.count + 1
        -- Window expired: reset to 1 for a fresh window.
        else 1
      end,
      window_start = case
        when private.device_auth_rate_buckets.window_start > v_created_at - pg_catalog.make_interval(secs => p_rate_window_seconds)
          then private.device_auth_rate_buckets.window_start
        else v_created_at
      end
  returning count, window_start into v_rate_count, v_rate_reset;
  if v_rate_count > p_rate_limit then
    v_retry_after := greatest(1, pg_catalog.ceil(extract(epoch from
      (v_rate_reset + pg_catalog.make_interval(secs => p_rate_window_seconds) - v_created_at)
    ))::integer);
    return private.device_auth_error_json('rate_limited', 'Too many initiation attempts.', v_retry_after);
  end if;

  -- 3. Consume the freshness nonce atomically. Reuse (unique PK) = replay.
  v_nonce_expires_at := v_created_at + pg_catalog.make_interval(secs => 600);
  begin
    insert into private.device_auth_proof_nonces (device_id, proof_purpose, nonce, issued_at, expires_at)
    values (p_device_id, 'initiate', p_proof_nonce, v_created_at, v_nonce_expires_at);
  exception when unique_violation then
    return private.device_auth_error_json('proof_invalid', 'Proof nonce was already used or is not fresh.');
  end;

  v_expires_at := v_created_at + pg_catalog.make_interval(secs => p_expires_in);
  v_uri := pg_catalog.rtrim(p_verification_uri_prefix, '/') || '/device';

  -- Persist the device key binding proven by this initiation. Initiate never
  -- retires another active binding: the partial unique index on
  -- (device_id, proof_suite) WHERE is_active enforces at most one active
  -- binding per device/suite. If this device already has an active binding
  -- under a DIFFERENT key, initiate fails closed instead of silently rotating
  -- it and instead of throwing the index's unique_violation. Key rotation is
  -- an explicit later action (own RPC), never a side effect of initiate. This
  -- insert is idempotent for an exact active re-initiation. Retired keys are
  -- never reactivated here.
  if exists (select 1 from private.device_auth_key_bindings
              where device_id = p_device_id
                and proof_suite = 'skillmap.ecdsa-p256-sha256.v2'
                and is_active
                and key_thumbprint <> p_key_thumbprint) then
    return private.device_auth_error_json('invalid_request', 'device already has an active key binding; rotate explicitly.');
  end if;
  if exists (select 1 from private.device_auth_key_bindings
              where device_id = p_device_id
                and proof_suite = 'skillmap.ecdsa-p256-sha256.v2'
                and key_thumbprint = p_key_thumbprint
                and not is_active) then
    return private.device_auth_error_json('invalid_request', 'retired device key cannot be reactivated by initiation.');
  end if;
  if exists (select 1 from private.device_auth_key_bindings
              where device_id = p_device_id
                and proof_suite = 'skillmap.ecdsa-p256-sha256.v2'
                and key_thumbprint = p_key_thumbprint
                and is_active
                and public_key <> p_device_public_key) then
    return private.device_auth_error_json('invalid_request', 'device key binding does not match its public key.');
  end if;
  insert into private.device_auth_key_bindings (
    device_id, proof_suite, public_key, key_thumbprint, is_active, created_at, retired_at
  ) values (
    p_device_id, 'skillmap.ecdsa-p256-sha256.v2', p_device_public_key, p_key_thumbprint,
    true, v_created_at, null
  ) on conflict (device_id, proof_suite, key_thumbprint) do nothing;

  -- Persist the pair and the code digests (never raw codes).
  insert into private.device_auth_pairings (
    device_id, key_thumbprint, audience_literal, requested_scopes, display_name,
    platform, connector_version, locale, verification_uri, state, created_at, expires_at
  ) values (
    p_device_id, p_key_thumbprint, 'skillmap.connector.v1', p_requested_scopes,
    nullif(pg_catalog.btrim(p_display_name), ''), p_platform, p_connector_version,
    p_locale, v_uri, 'pending', v_created_at, v_expires_at
  ) returning pairing_id into v_pairing_id;

  -- The raw device_code/user_code are returned exactly once (to the response);
  -- only their SHA-256 digests are persisted into code_digests.
  select secrets.device_code, secrets.user_code, secrets.device_code_digest, secrets.user_code_digest
    into v_device_code, v_user_code, v_device_code_digest, v_user_code_digest
  from private.device_auth_generate_pairing_secrets() as secrets;

  insert into private.device_auth_code_digests (digest_kind, digest_hex, device_id, pairing_id) values
    ('device_code', v_device_code_digest, p_device_id, v_pairing_id),
    ('user_code',   v_user_code_digest,   p_device_id, v_pairing_id);

  -- Persist the idempotency receipt so an exact retry returns the same body.
  insert into private.device_auth_idempotency_receipts (
    principal_kind, principal, operation, idempotency_key, request_digest, outcome_json, created_at, expired_at
  ) values (
    'device', p_device_id, 'initiate', p_idempotency_key, p_request_digest,
    pg_catalog.jsonb_build_object(
      'device_code', v_device_code,
      'user_code', v_user_code,
      'verification_uri', v_uri,
      'expires_in', p_expires_in,
      'interval', p_interval,
      'display', pg_catalog.jsonb_build_object(
          'name', coalesce(pg_catalog.btrim(p_display_name), 'Connector'),
          'platform', p_platform,
          'connector_version', p_connector_version,
          'locale', p_locale
      ),
      'error', pg_catalog.to_jsonb(null::text),
      'error_description', pg_catalog.to_jsonb(null::text),
      'retry_after', 0
    ),
    v_created_at, v_created_at + pg_catalog.make_interval(secs => 600)
  );

  return pg_catalog.jsonb_build_object(
    'device_code', v_device_code,
    'user_code', v_user_code,
    'verification_uri', v_uri,
    'expires_in', p_expires_in,
    'interval', p_interval,
    'display', pg_catalog.jsonb_build_object(
        'name', coalesce(pg_catalog.btrim(p_display_name), 'Connector'),
        'platform', p_platform,
        'connector_version', p_connector_version,
        'locale', p_locale
    ),
    'error', pg_catalog.to_jsonb(null::text),
    'error_description', pg_catalog.to_jsonb(null::text),
    'retry_after', 0
  );
end
$function$;

-- ---------------------------------------------------------------------------
-- 10. Revoke everything from all roles (feature OFF). Legacy grants untouched.
-- ---------------------------------------------------------------------------
revoke all privileges on table private.device_auth_key_bindings from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_code_digests from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_pairings from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_proof_nonces from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_idempotency_receipts from public, anon, authenticated, service_role;
revoke all privileges on table private.device_auth_rate_buckets from public, anon, authenticated, service_role;

revoke all on function api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)
  from public, anon, authenticated, service_role;

alter table private.device_auth_key_bindings force row level security;
alter table private.device_auth_code_digests force row level security;
alter table private.device_auth_pairings force row level security;
alter table private.device_auth_proof_nonces force row level security;
alter table private.device_auth_idempotency_receipts force row level security;
alter table private.device_auth_rate_buckets force row level security;

commit;
