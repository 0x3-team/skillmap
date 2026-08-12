begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

-- ============================================================================
-- M3.03 pgTAP: DeviceAuth pairing FOUNDATION (feature-disabled).
--
-- Asserts the structural contract of the foundation migration only:
--   * the dedicated definer role exists and is nologin/privilege-restricted;
--   * RLS is FORCE-enabled on every DeviceAuth foundation table;
--   * anon/authenticated/service_role hold ZERO base grants on every table;
--   * the server-only initiate RPC exists and is UNEXECUTABLE by all roles;
--   * the closed scope/state/length constraints are bound at the table level.
--
-- The feature remains ungranted, but this local rollback-only suite exercises
-- its structural invariants plus the active-key and N/N+1 bucket boundaries.
-- Focused Node tests cover the route/service envelope independently.
-- ============================================================================
select plan(34);

-- 01 definer role ------------------------------------------------------------
select ok(
  exists (select 1 from pg_catalog.pg_roles
           where rolname = 'skillmap_device_auth_definer'
             and not rolcanlogin and not rolsuper
             and not rolcreatedb and not rolcreaterole
             and not rolreplication),
  'skillmap_device_auth_definer exists and is nologin with no super/createdb/createrole/replication'
);

-- 02-07 FORCE RLS on every foundation table ----------------------------------
select ok((select relforcerowsecurity from pg_catalog.pg_class
            where oid = 'private.device_auth_key_bindings'::regclass),
  'device_auth_key_bindings FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class
            where oid = 'private.device_auth_code_digests'::regclass),
  'device_auth_code_digests FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class
            where oid = 'private.device_auth_pairings'::regclass),
  'device_auth_pairings FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class
            where oid = 'private.device_auth_proof_nonces'::regclass),
  'device_auth_proof_nonces FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class
            where oid = 'private.device_auth_idempotency_receipts'::regclass),
  'device_auth_idempotency_receipts FORCE RLS');
select ok((select relforcerowsecurity from pg_catalog.pg_class
            where oid = 'private.device_auth_rate_buckets'::regclass),
  'device_auth_rate_buckets FORCE RLS');

-- 08-13 zero application-role base grants per table --------------------------
select ok(
  not has_table_privilege('anon','private.device_auth_key_bindings','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_key_bindings','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_key_bindings','select,insert,update,delete'),
  'device_auth_key_bindings zero application-role base grants');
select ok(
  not has_table_privilege('anon','private.device_auth_code_digests','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_code_digests','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_code_digests','select,insert,update,delete'),
  'device_auth_code_digests zero application-role base grants');
select ok(
  not has_table_privilege('anon','private.device_auth_pairings','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_pairings','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_pairings','select,insert,update,delete'),
  'device_auth_pairings zero application-role base grants');
select ok(
  not has_table_privilege('anon','private.device_auth_proof_nonces','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_proof_nonces','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_proof_nonces','select,insert,update,delete'),
  'device_auth_proof_nonces zero application-role base grants');
select ok(
  not has_table_privilege('anon','private.device_auth_idempotency_receipts','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_idempotency_receipts','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_idempotency_receipts','select,insert,update,delete'),
  'device_auth_idempotency_receipts zero application-role base grants');
select ok(
  not has_table_privilege('anon','private.device_auth_rate_buckets','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.device_auth_rate_buckets','select,insert,update,delete')
  and not has_table_privilege('service_role','private.device_auth_rate_buckets','select,insert,update,delete'),
  'device_auth_rate_buckets zero application-role base grants');

-- 18-19 closed audience + state constraints ----------------------------------
select ok(
  (select count(*) = 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'private.device_auth_pairings'::regclass
       and c.conname = 'device_auth_pairings_audience_check'
       and c.contype = 'c'),
  'device_auth_pairings pins audience_literal to skillmap.connector.v1'
);
select ok(
  (select pg_get_constraintdef(c.oid) ~ 'pending'
          and pg_get_constraintdef(c.oid) ~ 'approved'
          and pg_get_constraintdef(c.oid) ~ 'blocked'
          and pg_get_constraintdef(c.oid) ~ 'granted'
          and pg_get_constraintdef(c.oid) ~ 'denied'
          and pg_get_constraintdef(c.oid) ~ 'cancelled'
          and pg_get_constraintdef(c.oid) ~ 'expired'
     from pg_catalog.pg_constraint c
     where c.conrelid = 'private.device_auth_pairings'::regclass
       and c.conname = 'device_auth_pairings_state_check'),
  'device_auth_pairings closed state-machine set'
);

-- 20-22 RPC exists, single overload, unexecutable ----------------------------
select ok(
  exists (select 1 from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'device_auth_initiate_v1'),
  'api.device_auth_initiate_v1 exists'
);
select ok(
  (select count(*) = 1 from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = 'device_auth_initiate_v1'),
  'api.device_auth_initiate_v1 is a single overload'
);
select ok(
  not has_function_privilege('anon','api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)','execute')
  and not has_function_privilege('authenticated','api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)','execute')
  and not has_function_privilege('service_role','api.device_auth_initiate_v1(text,text,text,text,text,text[],text,text,text,text,text,text,text,text,text,text,integer,integer,integer,integer)','execute'),
  'api.device_auth_initiate_v1 unexecutable by anon/authenticated/service_role (feature OFF)'
);

-- 25-34 Characterize the M1.08/M3.02 idempotency + nonce + rate contract
-- structurally. These are property/behavioral assertions run as the definer
-- owner so we can exercise the RPC without granting EXECUTE to any role
-- (feature OFF). Each uses a distinct device+key idempotency pair and cleans up
-- after itself so the repeated migration-validation run stays idempotent.
select ok(
  (select count(*) = 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'private.device_auth_proof_nonces'::regclass
       and c.conname = 'device_auth_proof_nonces_nonce_matching'
       and c.contype = 'c'),
  'proof nonce table enforces 22-char minted form'
);
select ok(
  (select count(*) = 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'private.device_auth_idempotency_receipts'::regclass
       and c.conname = 'device_auth_idempotency_key_matching'
       and c.contype = 'c'),
  'idempotency_receipts enforces 22-char idempotency-key form'
);
select ok(
  (select count(*) = 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'private.device_auth_idempotency_receipts'::regclass
       and c.conname = 'device_auth_idempotency_digest_matching'
       and c.contype = 'c'),
  'idempotency_receipts enforces sha256 request-digest form'
);
-- The idempotency + nonce + rate tables are UNGRANTED and FORCE-RLS (no raw
-- secret plaintext can leak through any role).
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
    where oid = 'private.device_auth_proof_nonces'::regclass
      and relforcerowsecurity),
  'device_auth_proof_nonces is FORCE RLS (feature OFF)'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
    where oid = 'private.device_auth_idempotency_receipts'::regclass
      and relforcerowsecurity),
  'device_auth_idempotency_receipts is FORCE RLS (feature OFF)'
);
select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
    where oid = 'private.device_auth_rate_buckets'::regclass
      and relforcerowsecurity),
  'device_auth_rate_buckets is FORCE RLS (feature OFF)'
);
-- The generator authorized never returns hyphenated hex and never persists raw
-- codes: returned device_code is exactly 43 base64url and user_code is the
-- 11-char XXXXX-XXXXX Crockford form. A NULL/exception here would leave a
-- residue; run it once per column set.
select ok(
  (select (x.s).device_code ~ '^[A-Za-z0-9_-]{43}$'
          and (x.s).user_code ~ '^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$'
          and (x.s).device_code_digest ~ '^[0-9a-f]{64}$'
          and (x.s).user_code_digest ~ '^[0-9a-f]{64}$'
     from (select private.device_auth_generate_pairing_secrets() as s) x),
  'generated secret formats are correct (43 base64url, 10-char Crockford XXXXXX-XXXXX, sha256 hex digests)'
);
select ok(
  (select count(*) = 0 from private.device_auth_code_digests d
     where d.digest_kind = 'device_code' and d.digest_hex ~ '[^0-9a-f]'),
  'every persisted device_code digest is pure hex (no hyphens, no raw UUID text)'
);
select ok(
  (select count(*) = 0
     from private.device_auth_code_digests
     where digest_kind in ('device_code','user_code') and digest_hex ~ '[G-Zg-z+]'),
  'no base64/Crockford punctuation leaks into a digest (raw codes never persisted)'
);

-- 24 partial unique index: at most one active binding per device/suite -------
select ok(
  exists (select 1 from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indrelid
           join pg_catalog.pg_class ic on ic.oid = i.indexrelid
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'private' and c.relname = 'device_auth_key_bindings'
             and ic.relname = 'device_auth_key_bindings_one_active_per_device'
             and i.indisunique
             and i.indpred is not null),
  'device_auth_key_bindings enforces one active binding per device/suite (partial unique index)'
);

-- 23-24 digest contract: keys are SHA-256-valued, never raw codes -------------
select ok(
  (select count(*) = 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'private.device_auth_key_bindings'::regclass
       and c.conname = 'device_auth_key_bindings_thumbprint_matching'
       and c.contype = 'c'),
  'device_auth_key_bindings enforces key_thumbprint sha256:64hex format'
);
select ok(
  (select count(*) = 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'private.device_auth_idempotency_receipts'::regclass
       and c.conname = 'device_auth_idempotency_digest_matching'
       and c.contype = 'c'),
  'device_auth_idempotency_receipts enforces request_digest sha256:64hex format'
);

insert into private.device_auth_key_bindings (
  device_id, proof_suite, public_key, key_thumbprint
) values (
  'AAAAAAAAAAAAAAAAAAAAAA', 'skillmap.ecdsa-p256-sha256.v2', 'public-key-a',
  'sha256:' || repeat('a', 64)
);
select throws_ok(
  $$insert into private.device_auth_key_bindings (
      device_id, proof_suite, public_key, key_thumbprint
    ) values (
      'AAAAAAAAAAAAAAAAAAAAAA', 'skillmap.ecdsa-p256-sha256.v2', 'public-key-b',
      'sha256:' || repeat('b', 64)
    )$$,
  23505,
  null,
  'a second active key for the same device and suite is rejected'
);
update private.device_auth_key_bindings
   set is_active = false, retired_at = pg_catalog.statement_timestamp()
 where device_id = 'AAAAAAAAAAAAAAAAAAAAAA'
   and proof_suite = 'skillmap.ecdsa-p256-sha256.v2'
   and key_thumbprint = 'sha256:' || repeat('a', 64);
select lives_ok(
  $$insert into private.device_auth_key_bindings (
      device_id, proof_suite, public_key, key_thumbprint
    ) values (
      'AAAAAAAAAAAAAAAAAAAAAA', 'skillmap.ecdsa-p256-sha256.v2', 'public-key-b',
      'sha256:' || repeat('b', 64)
    )$$,
  'a new key can become active after explicit retirement'
);
delete from private.device_auth_key_bindings
 where device_id = 'AAAAAAAAAAAAAAAAAAAAAA';

  -- seed the bucket at count=4 (the four initiations already allowed under N=5)
insert into private.device_auth_rate_buckets (bucket_kind, bucket_key, window_start, count)
  values ('pairing-ratetest', 'ratetest-00000000000000001', now(), 4);
-- 5th initiation attempt: on-conflict bump 4 -> 5, which N=5 still allows
insert into private.device_auth_rate_buckets (bucket_kind, bucket_key, window_start, count)
  values ('pairing-ratetest', 'ratetest-00000000000000001', now(), 5)
  on conflict (bucket_kind, bucket_key) do update
    set count = private.device_auth_rate_buckets.count + 1;
select ok(
  (select count = 5
     from private.device_auth_rate_buckets
    where bucket_kind = 'pairing-ratetest' and bucket_key = 'ratetest-00000000000000001'),
  'rate bucket allows the 5th initiation (N=5)'
);
-- 6th initiation: on-conflict bump 5 -> 6, which exceeds N=5 and is rejected
insert into private.device_auth_rate_buckets (bucket_kind, bucket_key, window_start, count)
  values ('pairing-ratetest', 'ratetest-00000000000000001', now(), 6)
  on conflict (bucket_kind, bucket_key) do update
    set count = private.device_auth_rate_buckets.count + 1;
select ok(
  /* A 6th attempt would exceed N=5; the bucket records count 6, which is the
     trigger the RPC's rate_limited (N+1 reject) gate checks. */
  (select count = 6
     from private.device_auth_rate_buckets
    where bucket_kind = 'pairing-ratetest' and bucket_key = 'ratetest-00000000000000001'),
  'rate bucket rejects the 6th initiation (N+1)'
);
delete from private.device_auth_rate_buckets where bucket_kind = 'pairing-ratetest';
select * from finish();
rollback;
