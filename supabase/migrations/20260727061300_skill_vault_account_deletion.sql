begin;

set local search_path = '';

-- =============================================================================
-- M2.14 — authenticated-owner Skill Vault account deletion.
-- Authority: M2.02 section 4.12 and M1.11 section 6.
-- ---------------------------------------------------------------------------
-- Frozen order (M2.02 4.12): derive caller from verified auth (no target id);
-- account advisory lock; create/replay receipt + barrier; revoke devices/tokens;
-- purge route + import state; snapshot exact owned object keys; delete managed
-- files/releases/versions/skills child-to-parent; commit relational purge +
-- durable jobs. External object deletion is a later worker; the receipt is
-- completed only when all 13 exact M1.11 owners acknowledge.
--
-- Proof schema (M1.11): schema_version, opaque del_, closed fail-closed state
-- (unknown/failed NEVER serialized as COMPLETED), barrier/completion
-- timestamps, backup_physical_ageout_deadline <= barrier + 30d, the canonical
-- 13 acknowledgement objects in canonical registry order
-- (owner/status/acknowledged_at/count_bucket), and proof_digest as the SOLE
-- digest, computed only at truthful completion. Completed receipt retention is
-- completion + 30 days.
--
-- Compatibility (M2.02 4.12): api.delete_my_account() keeps its boolean
-- no-argument contract, returning true only after relational inaccessibility
-- and durable queue/receipt commit; it never asserts external blob completion
-- and never self-finalizes the proof. The private request/result exposes only
-- del_/state/count-bucket; no account identifier.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. M1.11 exact 13-owner closed deletion registry + validation.
--    This literal array is the ONLY place the registry is declared. No
--    implementation may add, rename, merge, or omit an owner without reopening
--    M1.11.
-- ---------------------------------------------------------------------------
create function private.m1_11_deletion_owner_registry()
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select array[
    'device_auth',
    'route_idempotency',
    'runtime_bundle_cache',
    'local_quarantine_intent_receipt',
    'vault_blobs',
    'manifest_version_lifecycle',
    'authenticated_projections',
    'feedback',
    'support',
    'analytics_linkage',
    'online_replicas',
    'queues_dead_letters',
    'backup_restore_barrier'
  ]::text[];
$function$;

revoke all privileges on function private.m1_11_deletion_owner_registry()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Canonical registry-position of an owner (1..13), or NULL.
create function private.m1_11_deletion_owner_position(p_owner text)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.array_position(private.m1_11_deletion_owner_registry(), p_owner);
$function$;

revoke all privileges on function private.m1_11_deletion_owner_position(text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Validate the exact M1.11 acknowledgement shape and canonical registry order.
create function private.m1_11_deletion_acknowledgements_valid(
  p_acks jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_registry text[] := private.m1_11_deletion_owner_registry();
  v_need text[] := array['acknowledged_at', 'count_bucket', 'owner', 'status'];
  v_n integer;
  v_obj jsonb;
  v_owner text;
  v_status text;
  v_bucket text;
  v_acknowledged_at timestamp with time zone;
  v_pos integer;
  v_prev integer := 0;
  v_keys text[];
begin
  if p_acks is null or p_acks = '[]'::jsonb then
    return true;
  end if;
  if pg_catalog.jsonb_typeof(p_acks) <> 'array' then
    return false;
  end if;

  v_n := pg_catalog.jsonb_array_length(p_acks);
  if v_n > 13 then
    return false;
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_obj := p_acks -> v_i;
    if pg_catalog.jsonb_typeof(v_obj) <> 'object' then
      return false;
    end if;

    select coalesce(array_agg(k order by k), '{}'::text[]) into v_keys
    from pg_catalog.jsonb_object_keys(v_obj) as k;
    if v_keys is distinct from v_need then
      return false;
    end if;

    v_owner := v_obj ->> 'owner';
    v_status := v_obj ->> 'status';
    if v_owner is null or v_status is null
      or v_status not in ('purged', 'unlinked', 'barrier_applied', 'no_account_scope')
    then
      return false;
    end if;

    if pg_catalog.jsonb_typeof(v_obj -> 'acknowledged_at') is distinct from 'string'
      or v_obj ->> 'acknowledged_at' is null
      or pg_catalog.jsonb_typeof(v_obj -> 'count_bucket') is distinct from 'string'
    then
      return false;
    end if;
    v_bucket := v_obj ->> 'count_bucket';
    if v_bucket not in ('0', '1', '2-10', '11-100', '101+') then
      return false;
    end if;

    begin
      v_acknowledged_at := (v_obj ->> 'acknowledged_at')::timestamp with time zone;
    exception when others then
      return false;
    end;
    if v_acknowledged_at is null then
      return false;
    end if;

    v_pos := pg_catalog.array_position(v_registry, v_owner);
    if v_pos is null then
      return false; -- owner not in the exact registry
    end if;
    if v_pos <= v_prev then
      return false; -- duplicate or out of canonical registry order
    end if;
    v_prev := v_pos;

    if v_owner = 'local_quarantine_intent_receipt' and v_status <> 'purged' then
      return false;
    end if;
    if v_owner = 'backup_restore_barrier' and v_status <> 'barrier_applied' then
      return false;
    end if;
    if v_owner <> 'backup_restore_barrier' and v_status = 'barrier_applied' then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

revoke all privileges on function private.m1_11_deletion_acknowledgements_valid(jsonb)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Count of acknowledged owners in a validated acknowledgement array.
create function private.m1_11_deletion_acknowledged_count(p_acks jsonb)
returns smallint
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_array_length(coalesce(p_acks, '[]'::jsonb))::smallint;
$function$;

revoke all privileges on function private.m1_11_deletion_acknowledged_count(jsonb)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

create function private.m1_11_deletion_acknowledgements_within_window(
  p_acks jsonb,
  p_barrier_committed_at timestamp with time zone,
  p_completed_at timestamp with time zone
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ack jsonb;
  v_acknowledged_at timestamp with time zone;
begin
  if p_barrier_committed_at is null then
    return p_acks = '[]'::jsonb;
  end if;
  for v_ack in select value from pg_catalog.jsonb_array_elements(coalesce(p_acks, '[]'::jsonb)) loop
    begin
      v_acknowledged_at := (v_ack ->> 'acknowledged_at')::timestamp with time zone;
    exception when others then
      return false;
    end;
    if v_acknowledged_at < p_barrier_committed_at
      or (p_completed_at is not null and v_acknowledged_at > p_completed_at)
    then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

revoke all privileges on function private.m1_11_deletion_acknowledgements_within_window(
  jsonb, timestamp with time zone, timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Proof digest over the canonical completed proof with only proof_digest
-- omitted. jsonb canonicalization makes the byte representation deterministic;
-- acknowledgement array order remains the exact registry order.
create function private.compute_deletion_proof_digest(
  p_acks jsonb,
  p_del_ text,
  p_barrier_committed_at timestamp with time zone,
  p_completed_at timestamp with time zone,
  p_backup_physical_ageout_deadline timestamp with time zone
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_proof jsonb;
begin
  if p_acks is null or private.m1_11_deletion_acknowledged_count(p_acks) <> 13 then
    return null;
  end if;

  v_proof := pg_catalog.jsonb_build_object(
    'schema_version', 'skillmap.account-deletion-proof/v1',
    'deletion_request_id', p_del_,
    'state', 'COMPLETED',
    'barrier_committed_at', p_barrier_committed_at,
    'completed_at', p_completed_at,
    'backup_physical_ageout_deadline', p_backup_physical_ageout_deadline,
    'acknowledgements', p_acks
  );

  return 'sha256:' || pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_proof::text, 'UTF8')),
    'hex'
  );
end;
$function$;

revoke all privileges on function private.compute_deletion_proof_digest(
  jsonb, text, timestamp with time zone, timestamp with time zone, timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- ---------------------------------------------------------------------------
-- 1. account_deletion_receipts — exact M1.11 deletion-proof tombstone.
--    Retains no account/device/skill/version/path/content identifier or digest.
-- ---------------------------------------------------------------------------
create table private.account_deletion_receipts (
  id uuid primary key,
  schema_version text not null default 'skillmap.account-deletion-proof/v1',
  del_ text not null
    default ('del_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  state text not null default 'PENDING',
  barrier_initiated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  barrier_committed_at timestamp with time zone,
  queued_at timestamp with time zone,
  cleanup_started_at timestamp with time zone,
  completed_at timestamp with time zone,
  expiry_at timestamp with time zone,
  backup_physical_ageout_deadline timestamp with time zone,
  attempt_count integer not null default 0,
  acknowledgements jsonb not null default '[]'::jsonb,
  owner_completed_count smallint not null default 0,
  proof_digest text,

  constraint account_deletion_receipts_del_key unique (del_),
  constraint account_deletion_receipts_del_format_check
    check (del_ ~ '^del_[0-9a-f]{32}$'),
  constraint account_deletion_receipts_schema_check
    check (schema_version = 'skillmap.account-deletion-proof/v1'),
  constraint account_deletion_receipts_state_check
    check (state in (
      'PENDING', 'BARRIER_COMMITTED', 'CLEANUP_IN_PROGRESS',
      'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN'
    )),
  constraint account_deletion_receipts_expiry_check
    check (
      (state = 'COMPLETED' and expiry_at = completed_at + pg_catalog.make_interval(secs => 30 * 86400))
      or (state <> 'COMPLETED' and expiry_at is null)
    ),
  constraint account_deletion_receipts_ack_valid_check
    check (private.m1_11_deletion_acknowledgements_valid(acknowledgements)),
  constraint account_deletion_receipts_ack_count_check
    check (owner_completed_count = private.m1_11_deletion_acknowledged_count(acknowledgements)),
  constraint account_deletion_receipts_ack_window_check
    check (private.m1_11_deletion_acknowledgements_within_window(
      acknowledgements, barrier_committed_at, completed_at
    )),
  constraint account_deletion_receipts_digest_shape_check
    check (proof_digest is null or proof_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint account_deletion_receipts_timestamps_order_check
    check (
      (barrier_committed_at is null or barrier_committed_at >= barrier_initiated_at)
      and (queued_at is null or queued_at >= barrier_initiated_at)
      and (cleanup_started_at is null or cleanup_started_at >= barrier_initiated_at)
      and (completed_at is null or completed_at >= barrier_initiated_at)
    ),
  constraint account_deletion_receipts_ageout_lower_check
    check (
      backup_physical_ageout_deadline is null
      or backup_physical_ageout_deadline >= coalesce(barrier_committed_at, barrier_initiated_at)
    ),
  constraint account_deletion_receipts_ageout_upper_check
    check (
      backup_physical_ageout_deadline is null
      or backup_physical_ageout_deadline <= barrier_initiated_at + pg_catalog.make_interval(secs => 30 * 86400)
    ),
  constraint account_deletion_receipts_attempt_check
    check (attempt_count between 0 and 1000),
  constraint account_deletion_receipts_state_machine_check
    check (
      (
        state = 'PENDING'
        and barrier_committed_at is null and queued_at is null
        and cleanup_started_at is null and completed_at is null
      )
      or (
        state = 'BARRIER_COMMITTED'
        and barrier_committed_at is not null and queued_at is not null
        and cleanup_started_at is null and completed_at is null
        and proof_digest is null
      )
      or (
        state = 'CLEANUP_IN_PROGRESS'
        and barrier_committed_at is not null and queued_at is not null
        and cleanup_started_at is not null and completed_at is null
        and proof_digest is null
        and owner_completed_count < 13
      )
      or (
        state = 'COMPLETED'
        and barrier_committed_at is not null and queued_at is not null
        and cleanup_started_at is not null and completed_at is not null
        and completed_at >= cleanup_started_at
        and owner_completed_count = 13
        and owner_completed_count = private.m1_11_deletion_acknowledged_count(acknowledgements)
        and proof_digest is not null
        and proof_digest = private.compute_deletion_proof_digest(
          acknowledgements, del_, barrier_committed_at, completed_at,
          backup_physical_ageout_deadline
        )
      )
      or (
        state in ('FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN')
        and barrier_committed_at is not null and queued_at is not null
        and completed_at is null and proof_digest is null
      )
    )
);

revoke all on table private.account_deletion_receipts
  from public, anon, authenticated, service_role, skillmap_vault_definer;

alter table private.account_deletion_receipts enable row level security;
alter table private.account_deletion_receipts force row level security;

comment on table private.account_deletion_receipts is
  'Exact M1.11 deletion-proof tombstone: schema_version, fail-closed closed
  state (never serializes completed for unknown/failed), barrier/completion
  timestamps, backup ageout <= barrier+30d, canonical 13 owners in canonical
  order, and proof_digest as the sole digest at truthful completion.';

-- ---------------------------------------------------------------------------
-- 2. skill_vault_storage_deletion_jobs — one idempotent exact-object job per
--    receipt/bucket/object. Pending exact key uniqueness is enforced by a
--    partial unique index over PENDING/CLAIMED rows; terminal completion clears
--    object_name to a fixed sentinel so many completed rows cannot collide. No
--    list/prefix surface; no object I/O under lock.
-- ---------------------------------------------------------------------------
create table private.skill_vault_storage_deletion_jobs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  deletion_receipt_id uuid not null
    references private.account_deletion_receipts (id) on delete cascade,
  bucket_id text not null,
  object_name text not null,
  state text not null default 'PENDING',
  attempt_count integer not null default 0,
  next_attempt_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  claimed_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_code text,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  updated_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint storage_deletion_jobs_state_check
    check (state in ('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED', 'FAILED_TERMINAL')),
  constraint storage_deletion_jobs_bucket_check
    check (bucket_id = 'skill-vault-private'),
  constraint storage_deletion_jobs_object_shape_check
    check (
      (
        state in ('PENDING', 'CLAIMED', 'FAILED', 'FAILED_TERMINAL')
        and pg_catalog.octet_length(object_name) between 1 and 512
        and object_name !~ '[[:cntrl:]]'
        and object_name ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
      )
      or (
        state = 'COMPLETED'
        and object_name = 'CLEARED'
      )
    ),
  constraint storage_deletion_jobs_attempt_check
    check (attempt_count between 0 and 1000),
  constraint storage_deletion_jobs_error_closed_check
    check (error_code is null or error_code in (
      'storage_object_not_found','storage_delete_failed','storage_read_denied',
      'storage_unreachable','attempt_exhausted'
    )),
  constraint storage_deletion_jobs_timestamps_check
    check (
      next_attempt_at >= created_at
      and updated_at >= created_at
      and (claimed_at is null or claimed_at >= created_at)
      and (completed_at is null or completed_at >= created_at)
    ),
  constraint storage_deletion_jobs_state_ts_check
    check (
      (
        state = 'PENDING'
        and claimed_at is null and completed_at is null
      )
      or (
        state = 'CLAIMED'
        and claimed_at is not null and completed_at is null
      )
      or (
        state in ('FAILED', 'FAILED_TERMINAL')
        and claimed_at is not null and completed_at is null
      )
      or (
        state = 'COMPLETED'
        and claimed_at is not null and completed_at is not null
        and completed_at >= claimed_at
      )
    )
);

-- One exact pending key per (receipt,bucket,object); completed/cleared rows are
-- excluded so finishing many jobs cannot collide. This is the idempotency
-- coordinate: re-inserting the same exact object for the same receipt no-ops
-- only while it is still pending.
create unique index storage_deletion_jobs_pending_key_uidx
  on private.skill_vault_storage_deletion_jobs (
    deletion_receipt_id, bucket_id, object_name
  )
  where state <> 'COMPLETED';

create index storage_deletion_jobs_claim_idx
  on private.skill_vault_storage_deletion_jobs (next_attempt_at, id)
  where state in ('PENDING', 'FAILED');

revoke all on table private.skill_vault_storage_deletion_jobs
  from public, anon, authenticated, service_role, skillmap_vault_definer;

alter table private.skill_vault_storage_deletion_jobs enable row level security;
alter table private.skill_vault_storage_deletion_jobs force row level security;

comment on table private.skill_vault_storage_deletion_jobs is
  'Private binary exact-object deletion queue. One idempotent job per
  receipt/bucket/object; pending exact key unique under a partial index, cleared
  at final completion; never exposes a list or prefix selector.';

-- Route records are immutable during normal operation, but account deletion
-- must purge one caller's owned history. The barrier sets a transaction-local
-- account coordinate; it does not grant table authority to any caller.
create or replace function private.enforce_route_decisions_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
    and pg_catalog.current_setting('skillmap.account_deletion_account_id', true) = old.account_id::text
  then return old;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using errcode = '22023', message = 'route decision rows are immutable';
  end if;
  return new;
end;
$function$;

create or replace function private.enforce_route_decision_selections_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
    and pg_catalog.current_setting('skillmap.account_deletion_account_id', true) = old.account_id::text
  then return old;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using errcode = '22023', message = 'route decision lineage rows are immutable';
  end if;
  return new;
end;
$function$;

create or replace function private.enforce_route_corrections_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
    and pg_catalog.current_setting('skillmap.account_deletion_account_id', true) = old.account_id::text
  then return old;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using errcode = '22023', message = 'route correction rows are immutable';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. barrier — one atomic purge transaction.
-- ---------------------------------------------------------------------------
create function private.perform_vault_deletion_barrier()
returns table (
  receipt_del_ text,
  state_ text,
  queued_object_count bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller uuid;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_receipt_id uuid;
  v_ageout timestamp with time zone := v_now + pg_catalog.make_interval(secs => 30 * 86400);
  v_receipt_del text;
  v_queued bigint := 0;
begin
  v_caller := (select auth.uid());
  if v_caller is null
    or (select auth.role()) <> 'authenticated'
    or not exists (
      select 1 from auth.users as u
      where u.id = v_caller
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= v_now)
    )
  then
    raise exception 'authenticated account authority is required' using errcode = '42501';
  end if;

  -- M2.02 global lock order: the account advisory lock is first.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_caller::text, 0)
  );
  perform pg_catalog.set_config(
    'skillmap.account_deletion_account_id', v_caller::text, true
  );

  v_receipt_id := pg_catalog.gen_random_uuid();

  insert into private.account_deletion_receipts (
    id, del_, state, barrier_committed_at, queued_at,
    backup_physical_ageout_deadline, attempt_count
  ) values (
    v_receipt_id,
    'del_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    'BARRIER_COMMITTED',
    v_now,
    v_now,
    v_ageout,
    1
  );

  select deletion_receipts.del_ into v_receipt_del
  from private.account_deletion_receipts as deletion_receipts
  where deletion_receipts.id = v_receipt_id;

  -- Revoke device/token authority. The owned device rows are deleted below.
  delete from private.device_tokens as tok
  using private.devices as dev
  where dev.id = tok.device_id and dev.account_id = v_caller;

  -- Purge route records (decisions cascade selections/corrections) and import
  -- sessions (sessions cascade file receipts).
  delete from private.route_decisions as d
  where d.account_id = v_caller;

  delete from private.import_sessions as s
  where s.account_id = v_caller;

  -- Snapshot exact owned object keys into idempotent jobs BEFORE deleting
  -- managed files. Replay/new receipt with a still-present object no-ops via
  -- the partial unique index (DO NOTHING); this is the crash/retry safe path.
  insert into private.skill_vault_storage_deletion_jobs (
    deletion_receipt_id, bucket_id, object_name, state, next_attempt_at
  )
  select v_receipt_id, 'skill-vault-private', f.storage_key, 'PENDING', v_now
  from private.managed_skill_files as f
  where f.account_id = v_caller
    and f.storage_key ~ '^v1/msv_[0-9a-f]{32}/msf_[0-9a-f]{32}$'
  on conflict (
    deletion_receipt_id, bucket_id, object_name
  ) where state <> 'COMPLETED' do nothing;

  get diagnostics v_queued = row_count;

  -- Delete managed files/releases/versions/skills child-to-parent, clearing the
  -- active-release pointer first so the releases delete is not blocked.
  update private.managed_skills as s
  set active_release_id = null, updated_at = v_now
  where s.account_id = v_caller;

  delete from private.managed_skill_releases as r where r.account_id = v_caller;
  delete from private.managed_skill_versions as vv where vv.account_id = v_caller;
  delete from private.managed_skill_files as f where f.account_id = v_caller;
  delete from private.managed_skills as s where s.account_id = v_caller;
  delete from private.devices as dev where dev.account_id = v_caller;

  perform pg_catalog.set_config(
    'skillmap.account_deletion_account_id', '', true
  );

  return query
  select v_receipt_del, 'BARRIER_COMMITTED'::text, v_queued;
end;
$function$;

revoke all on function private.perform_vault_deletion_barrier()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

comment on function private.perform_vault_deletion_barrier() is
  'Internal ungranted atomic self-deletion barrier; performs no object I/O.
  Returns only del_ state and the queued-object count; no account identifier.';

-- ---------------------------------------------------------------------------
-- 4. Worker surface — bounded SKIP LOCKED claim + idempotent complete // fail.
--    Complete/fail bind an opaque job_id from a claim (never reselect by raw
--    object name), and exact replay is a no-op. Exposed to the exact
--    least-privilege service_role only (no private table reads, no browser).
-- ---------------------------------------------------------------------------
create function private.claim_skill_vault_storage_deletion_jobs(
  p_limit integer default 32
)
returns table (
  job_id uuid,
  deletion_receipt_id uuid,
  bucket_id text,
  object_name text,
  attempt_count integer,
  claimed_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_limit is null or p_limit not between 1 and 64 then
    raise exception 'claim limit must be between 1 and 64' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select jobs.id
    from private.skill_vault_storage_deletion_jobs as jobs
    join private.account_deletion_receipts as receipts
      on receipts.id = jobs.deletion_receipt_id
    where jobs.bucket_id = 'skill-vault-private'
      and jobs.state in ('PENDING', 'FAILED')
      and jobs.next_attempt_at <= pg_catalog.statement_timestamp()
      and receipts.state in (
        'BARRIER_COMMITTED', 'CLEANUP_IN_PROGRESS', 'FAILED_RETRYABLE'
      )
    order by jobs.next_attempt_at, jobs.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update private.skill_vault_storage_deletion_jobs as jobs
    set state = 'CLAIMED',
        attempt_count = jobs.attempt_count + 1,
        claimed_at = pg_catalog.statement_timestamp(),
        updated_at = pg_catalog.statement_timestamp()
    from candidates
    where jobs.id = candidates.id
    returning jobs.id, jobs.deletion_receipt_id, jobs.bucket_id,
              jobs.object_name, jobs.attempt_count, jobs.claimed_at
  ), progressed as (
    update private.account_deletion_receipts as receipts
    set state = 'CLEANUP_IN_PROGRESS',
        cleanup_started_at = coalesce(
          receipts.cleanup_started_at, pg_catalog.statement_timestamp()
        ),
        attempt_count = least(receipts.attempt_count + 1, 1000)
    where receipts.id in (select claimed.deletion_receipt_id from claimed)
    returning receipts.id
  )
  select claimed.id, claimed.deletion_receipt_id, claimed.bucket_id,
         claimed.object_name, claimed.attempt_count, claimed.claimed_at
  from claimed
  cross join lateral (select pg_catalog.count(*) from progressed) as progress_guard;
end;
$function$;

revoke all on function private.claim_skill_vault_storage_deletion_jobs(integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Complete binds an opaque job_id; idempotent and safe on replay.
create function private.complete_skill_vault_storage_deletion_job(p_job_id uuid)
returns table (
  job_id uuid, state text, completed_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_job private.skill_vault_storage_deletion_jobs;
begin
  select jobs.* into v_job
  from private.skill_vault_storage_deletion_jobs as jobs
  where jobs.id = p_job_id;

  if not found then
    raise exception 'deletion job does not exist' using errcode = 'P0002';
  end if;

  if v_job.state = 'COMPLETED' then
    return query select v_job.id, 'COMPLETED'::text, v_job.completed_at;
    return;
  end if;

  if v_job.state <> 'CLAIMED' then
    raise exception 'deletion job is not claimed' using errcode = '55000';
  end if;

  if exists (
    select 1
    from storage.objects as objects
    where objects.bucket_id = v_job.bucket_id
      and objects.name = v_job.object_name
  ) then
    raise exception 'storage object residue prevents deletion completion'
      using errcode = '55000';
  end if;

  update private.skill_vault_storage_deletion_jobs as jobs
  set state = 'COMPLETED',
      object_name = 'CLEARED',
      completed_at = v_now,
      error_code = null,
      updated_at = v_now
  where jobs.id = p_job_id
  returning jobs.state, jobs.completed_at into v_job.state, v_job.completed_at;

  return query select v_job.id, v_job.state, v_job.completed_at;
end;
$function$;

revoke all on function private.complete_skill_vault_storage_deletion_job(uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Fail/requeue binds an opaque job_id, uses the closed error vocabulary, and
-- decrements the backoff. A job at the attempt ceiling transitions to a bounded
-- terminal FAILED so the receipt can then move to FAILED_TERMINAL; never
-- COMPLETED.
create function private.fail_skill_vault_storage_deletion_job(
  p_job_id uuid,
  p_error_code text,
  p_requeue_after_seconds integer default 60
)
returns table (
  job_id uuid,
  state text,
  next_attempt_at timestamp with time zone
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job private.skill_vault_storage_deletion_jobs;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_terminal boolean := false;
  v_next_attempt timestamp with time zone;
begin
  if p_error_code is null
    or pg_catalog.octet_length(p_error_code) not between 1 and 64
    or p_error_code not in (
      'storage_object_not_found','storage_delete_failed','storage_read_denied',
      'storage_unreachable','attempt_exhausted'
    )
  then
    raise exception 'error code must be a closed vocabulary member' using errcode = '22023';
  end if;
  if p_requeue_after_seconds is null
    or p_requeue_after_seconds < 1
    or p_requeue_after_seconds > 172800
  then
    raise exception 'requeue delay must be bounded' using errcode = '22023';
  end if;

  select jobs.* into v_job
  from private.skill_vault_storage_deletion_jobs as jobs
  where jobs.id = p_job_id
  for update;

  if not found then
    raise exception 'deletion job does not exist' using errcode = 'P0002';
  end if;

  if v_job.state in ('FAILED', 'FAILED_TERMINAL')
    and v_job.error_code = p_error_code
  then
    return query
    select v_job.id, v_job.state, v_job.next_attempt_at;
    return;
  end if;

  if v_job.state <> 'CLAIMED' then
    raise exception 'deletion job is not claimed' using errcode = '55000';
  end if;

  if v_job.attempt_count >= 1000 or p_error_code = 'attempt_exhausted' then
    v_terminal := true;
  end if;

  v_next_attempt := v_now + pg_catalog.make_interval(secs => p_requeue_after_seconds);
  if v_terminal then
    v_next_attempt := v_now + pg_catalog.make_interval(secs => 3600);
  end if;

  update private.skill_vault_storage_deletion_jobs as jobs
  set state = case when v_terminal then 'FAILED_TERMINAL' else 'FAILED' end,
      next_attempt_at = v_next_attempt,
      error_code = p_error_code,
      updated_at = v_now
  where jobs.id = p_job_id;

  update private.account_deletion_receipts as receipts
  set state = case when v_terminal then 'FAILED_TERMINAL' else 'FAILED_RETRYABLE' end,
      cleanup_started_at = coalesce(receipts.cleanup_started_at, v_now),
      attempt_count = least(receipts.attempt_count + 1, 1000)
  where receipts.id = v_job.deletion_receipt_id
    and receipts.state <> 'COMPLETED';

  return query
  select jobs.id, jobs.state, jobs.next_attempt_at
  from private.skill_vault_storage_deletion_jobs as jobs
  where jobs.id = p_job_id;
end;
$function$;

revoke all on function private.fail_skill_vault_storage_deletion_job(uuid, text, integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Record one exact M1.11 owner acknowledgement in canonical order and finalize
-- only after all thirteen owners have acknowledged. The function accepts only
-- the opaque del_ request id; it never accepts or retains an account id.
create function private.acknowledge_account_deletion_owner(
  p_deletion_request_id text,
  p_owner text,
  p_status text,
  p_count_bucket text
)
returns table (
  deletion_request_id text,
  state text,
  completed boolean,
  owner_completed_count smallint,
  proof_digest text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt private.account_deletion_receipts;
  v_registry text[] := private.m1_11_deletion_owner_registry();
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_next_position integer;
  v_existing jsonb;
  v_acknowledgements jsonb;
  v_job_total bigint;
  v_job_outstanding bigint;
  v_expected_bucket text;
  v_completed_at timestamp with time zone;
  v_proof_digest text;
begin
  if p_deletion_request_id is null
    or p_deletion_request_id !~ '^del_[0-9a-f]{32}$'
    or p_status not in ('purged', 'unlinked', 'barrier_applied', 'no_account_scope')
    or p_count_bucket not in ('0', '1', '2-10', '11-100', '101+')
  then
    raise exception 'invalid deletion acknowledgement' using errcode = '22023';
  end if;

  select receipts.* into v_receipt
  from private.account_deletion_receipts as receipts
  where receipts.del_ = p_deletion_request_id
  for update;

  if not found then
    raise exception 'deletion receipt does not exist' using errcode = 'P0002';
  end if;

  select ack.value into v_existing
  from pg_catalog.jsonb_array_elements(v_receipt.acknowledgements) as ack(value)
  where ack.value ->> 'owner' = p_owner;

  if v_existing is not null then
    if v_existing ->> 'status' = p_status
      and v_existing ->> 'count_bucket' = p_count_bucket
    then
      return query
      select v_receipt.del_, v_receipt.state,
             v_receipt.state = 'COMPLETED',
             v_receipt.owner_completed_count, v_receipt.proof_digest;
      return;
    end if;
    raise exception 'deletion acknowledgement replay conflicts'
      using errcode = '23505';
  end if;

  if v_receipt.state in ('COMPLETED', 'FAILED_TERMINAL', 'UNKNOWN') then
    raise exception 'deletion receipt is not acknowledgeable' using errcode = '55000';
  end if;

  v_next_position := pg_catalog.jsonb_array_length(v_receipt.acknowledgements) + 1;
  if v_next_position > 13 or v_registry[v_next_position] is distinct from p_owner then
    raise exception 'deletion acknowledgements must follow canonical owner order'
      using errcode = '22023';
  end if;

  if p_owner = 'local_quarantine_intent_receipt' and p_status <> 'purged' then
    raise exception 'local quarantine receipt acknowledgement must be purged'
      using errcode = '22023';
  end if;
  if p_owner = 'backup_restore_barrier' and p_status <> 'barrier_applied' then
    raise exception 'backup restore acknowledgement must be barrier_applied'
      using errcode = '22023';
  end if;
  if p_owner <> 'backup_restore_barrier' and p_status = 'barrier_applied' then
    raise exception 'barrier_applied is reserved for backup_restore_barrier'
      using errcode = '22023';
  end if;

  if p_owner = 'vault_blobs' then
    select pg_catalog.count(*),
           pg_catalog.count(*) filter (where jobs.state <> 'COMPLETED')
    into v_job_total, v_job_outstanding
    from private.skill_vault_storage_deletion_jobs as jobs
    where jobs.deletion_receipt_id = v_receipt.id;

    if v_job_outstanding <> 0 then
      raise exception 'storage deletion has outstanding jobs' using errcode = '55000';
    end if;

    v_expected_bucket := case
      when v_job_total = 0 then '0'
      when v_job_total = 1 then '1'
      when v_job_total <= 10 then '2-10'
      when v_job_total <= 100 then '11-100'
      else '101+'
    end;
    if p_count_bucket <> v_expected_bucket
      or (v_job_total = 0 and p_status <> 'no_account_scope')
      or (v_job_total > 0 and p_status <> 'purged')
    then
      raise exception 'vault blob acknowledgement does not match terminal jobs'
        using errcode = '22023';
    end if;
  end if;

  v_acknowledgements := v_receipt.acknowledgements || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'owner', p_owner,
      'status', p_status,
      'acknowledged_at', v_now,
      'count_bucket', p_count_bucket
    )
  );

  if pg_catalog.jsonb_array_length(v_acknowledgements) = 13 then
    v_completed_at := v_now;
    v_proof_digest := private.compute_deletion_proof_digest(
      v_acknowledgements, v_receipt.del_, v_receipt.barrier_committed_at,
      v_completed_at, v_receipt.backup_physical_ageout_deadline
    );
    update private.account_deletion_receipts as receipts
    set acknowledgements = v_acknowledgements,
        owner_completed_count = 13,
        state = 'COMPLETED',
        cleanup_started_at = coalesce(receipts.cleanup_started_at, v_now),
        completed_at = v_completed_at,
        expiry_at = v_completed_at + pg_catalog.make_interval(secs => 30 * 86400),
        proof_digest = v_proof_digest
    where receipts.id = v_receipt.id;
  else
    update private.account_deletion_receipts as receipts
    set acknowledgements = v_acknowledgements,
        owner_completed_count = pg_catalog.jsonb_array_length(v_acknowledgements),
        state = 'CLEANUP_IN_PROGRESS',
        cleanup_started_at = coalesce(receipts.cleanup_started_at, v_now)
    where receipts.id = v_receipt.id;
  end if;

  return query
  select receipts.del_, receipts.state, receipts.state = 'COMPLETED',
         receipts.owner_completed_count, receipts.proof_digest
  from private.account_deletion_receipts as receipts
  where receipts.id = v_receipt.id;
end;
$function$;

revoke all on function private.acknowledge_account_deletion_owner(text, text, text, text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- ---------------------------------------------------------------------------
-- 5. Dedicated worker adapter. service_role keeps zero private-schema USAGE
--    and zero table grants; postgres-owned wrappers expose only exact bounded
--    commands. Browser roles receive neither schema USAGE nor EXECUTE.
-- ---------------------------------------------------------------------------
create schema deletion_adapter;

revoke all privileges on schema deletion_adapter
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant usage on schema deletion_adapter to service_role;

create function deletion_adapter.claim_skill_vault_storage_deletion_jobs(
  p_limit integer default 32
)
returns table (
  job_id uuid,
  deletion_request_id text,
  bucket_id text,
  object_name text,
  attempt_count integer,
  claimed_at timestamp with time zone
)
language sql
security definer
set search_path = ''
as $function$
  select claimed.job_id, receipts.del_, claimed.bucket_id,
         claimed.object_name, claimed.attempt_count, claimed.claimed_at
  from private.claim_skill_vault_storage_deletion_jobs(p_limit) as claimed
  join private.account_deletion_receipts as receipts
    on receipts.id = claimed.deletion_receipt_id;
$function$;

alter function deletion_adapter.claim_skill_vault_storage_deletion_jobs(integer)
  owner to postgres;
revoke all on function deletion_adapter.claim_skill_vault_storage_deletion_jobs(integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function deletion_adapter.claim_skill_vault_storage_deletion_jobs(integer)
  to service_role;

create function deletion_adapter.complete_skill_vault_storage_deletion_job(
  p_job_id uuid
)
returns table (
  job_id uuid,
  state text,
  completed_at timestamp with time zone
)
language sql
security definer
set search_path = ''
as $function$
  select * from private.complete_skill_vault_storage_deletion_job(p_job_id);
$function$;

alter function deletion_adapter.complete_skill_vault_storage_deletion_job(uuid)
  owner to postgres;
revoke all on function deletion_adapter.complete_skill_vault_storage_deletion_job(uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function deletion_adapter.complete_skill_vault_storage_deletion_job(uuid)
  to service_role;

create function deletion_adapter.fail_skill_vault_storage_deletion_job(
  p_job_id uuid,
  p_error_code text,
  p_requeue_after_seconds integer default 60
)
returns table (
  job_id uuid,
  state text,
  next_attempt_at timestamp with time zone
)
language sql
security definer
set search_path = ''
as $function$
  select * from private.fail_skill_vault_storage_deletion_job(
    p_job_id, p_error_code, p_requeue_after_seconds
  );
$function$;

alter function deletion_adapter.fail_skill_vault_storage_deletion_job(uuid, text, integer)
  owner to postgres;
revoke all on function deletion_adapter.fail_skill_vault_storage_deletion_job(uuid, text, integer)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function deletion_adapter.fail_skill_vault_storage_deletion_job(uuid, text, integer)
  to service_role;

create function deletion_adapter.acknowledge_account_deletion_owner(
  p_deletion_request_id text,
  p_owner text,
  p_status text,
  p_count_bucket text
)
returns table (
  deletion_request_id text,
  state text,
  completed boolean,
  owner_completed_count smallint,
  proof_digest text
)
language sql
security definer
set search_path = ''
as $function$
  select * from private.acknowledge_account_deletion_owner(
    p_deletion_request_id, p_owner, p_status, p_count_bucket
  );
$function$;

alter function deletion_adapter.acknowledge_account_deletion_owner(text, text, text, text)
  owner to postgres;
revoke all on function deletion_adapter.acknowledge_account_deletion_owner(text, text, text, text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function deletion_adapter.acknowledge_account_deletion_owner(text, text, text, text)
  to service_role;

comment on schema deletion_adapter is
  'Service-only bounded account-deletion worker commands; no private table read or browser access.';

-- ---------------------------------------------------------------------------
-- 6. api.delete_my_account() boolean compatibility wrapper. Returns true only
--    after relational purge + durable queue/receipt commit. Never asserts
--    external blob completion and never self-finalizes the proof; the receipt
--    completes later under all-13-owner acknowledgement by the owning leaves.
-- ---------------------------------------------------------------------------
create or replace function api.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller uuid := (select auth.uid());
  v_del text;
  v_state text;
begin
  if (select auth.role()) <> 'authenticated' or v_caller is null then
    raise exception 'authenticated account authority is required' using errcode = '42501';
  end if;

  -- Atomic relational purge + durable snapshot; returns only after commit.
  select barrier.receipt_del_, barrier.state_
  into v_del, v_state
  from private.perform_vault_deletion_barrier() as barrier;

  if v_del is null or v_state <> 'BARRIER_COMMITTED' then
    raise exception 'deletion barrier did not commit' using errcode = 'P0002';
  end if;

  -- Compose the legacy auth.user removal so relational inaccessibility is total.
  delete from auth.users where id = v_caller;
  if not found then
    raise exception 'account was not found' using errcode = 'P0002';
  end if;

  return true;
end;
$function$;

revoke all on function api.delete_my_account()
  from public, anon, authenticated, service_role;
grant execute on function api.delete_my_account() to authenticated;

comment on function api.delete_my_account() is
  'Authenticated self-service account deletion (no target id). Returns true only
  after the relational purge and durable queue/receipt commit; never asserts
  external blob completion. Receipt completion is at the owning leaves.';

commit;
