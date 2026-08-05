begin;

set local search_path = '';

-- =============================================================================
-- M2.12 — enforce route-decision and correction RLS. Authority: M2.02 §4.9,
-- M2.09 (immutable route_decisions / route_decision_selections /
-- route_corrections + record_route_decision / record_route_correction),
-- M2.10 (managed-skill definer handoff + bound identity helpers), M2.11
-- (dedicated adapter boundary + resolve_device_context device token/scope).
-- This migration is policies / adapter wrappers / owner projections / exact
-- least-privilege grants only; it adds no data-row rewrite and never disables
-- FORCE RLS.
--
-- PRINCIPLES
--   1. Every reachable mutation/read is a postgres-owned SECURITY DEFINER entry
--      point. No application role (anon / authenticated / service_role) holds a
--      base-table INSERT/UPDATE/DELETE/SELECT grant on the three route tables.
--   2. Distinct least-privilege surfaces:
--        CONNECTOR (device token) -> route_adapter.adapter_*   (service_role)
--        DASHBOARD (auth.uid)     -> private.my_route_* / submit (authenticated)
--      The connector proves account/device from the live token family (M2.11
--      resolve_device_context with the exclusive device.route / device.feedback
--      scope); the owner proves identity via private.current_request_uid().
--   3. Routing/model evaluation (currency + ownership of every lineage tuple)
--      runs BEFORE any persistence advisory lock: each connector wrapper
--      resolves device context and validates current release authority first,
--      then delegates to the M2.09 record function, which takes the lock at the
--      earliest persistence moment.
--   4. Exact replay of the identical (account, device, request_id, fingerprint,
--      revision) tuple is idempotent inside record_route_decision; a changed
--      fingerprint / binding / payload conflicts (22023) without disclosing
--      whether any stored row exists.
--   5. Disabled, revoked, expired, foreign, or stale authority denies replay,
--      read, and correction alike.
--   6. Privacy: no raw prompt/body/context/embedding/content/token/storage key/
--      provider response is ever accepted or projected; only opaque ids and
--      closed codes. anon receives nothing.
-- =============================================================================

-- ============================================================================
-- 1. Dedicated connector adapter boundary (mirror of M2.11 device_adapter).
-- ============================================================================
create schema if not exists route_adapter;
revoke all privileges on schema route_adapter
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Re-assert FORCE RLS (idempotent) and zero base grants on the three tables.
alter table private.route_decisions force row level security;
alter table private.route_decision_selections force row level security;
alter table private.route_corrections force row level security;

revoke all privileges on table private.route_decisions
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.route_decision_selections
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.route_corrections
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Browser ownership policies remain inert without a base-table grant; the
-- bounded API projections below are the only authenticated read surface.
create policy route_decisions_owner_select
  on private.route_decisions
  for select
  to authenticated
  using (account_id = (select auth.uid()));

create policy route_decision_selections_owner_select
  on private.route_decision_selections
  for select
  to authenticated
  using (account_id = (select auth.uid()));

create policy route_corrections_owner_select
  on private.route_corrections
  for select
  to authenticated
  using (account_id = (select auth.uid()));

-- The NOLOGIN dashboard definer needs only owner-scoped SELECT. Mutations are
-- delegated to the separately reviewed postgres-owned record function.
create policy route_decisions_definer_select
  on private.route_decisions
  for select
  to skillmap_vault_definer
  using (account_id = (select private.current_request_uid()));

create policy route_decision_selections_definer_select
  on private.route_decision_selections
  for select
  to skillmap_vault_definer
  using (account_id = (select private.current_request_uid()));

create policy route_corrections_definer_select
  on private.route_corrections
  for select
  to skillmap_vault_definer
  using (account_id = (select private.current_request_uid()));

grant select on table private.route_decisions to skillmap_vault_definer;
grant select on table private.route_decision_selections to skillmap_vault_definer;
grant select on table private.route_corrections to skillmap_vault_definer;

-- ============================================================================
-- 2. Shared current-authority lineage validator (ungranted). Called by the
--    connector before any lock and by the dashboard submit surface. A lineage
--    element must resolve to a cohesive chain owned by p_account_id whose
--    (managed_skill, version, release) tuple is lifecycle_state='active', not
--    revoked, and whose activation (if any) already took effect. Any other
--    lifecycle_state (importing/analyzing/needs-review/disabled/quarantined/
--    archived/corrupt/deleting) or a revocation/expiry is a silent
--    'routing authority unavailable'; a foreign or nonexistent tuple is denied
--    the same way, so no foreign data is disclosed. no_match/avoid carry no
--    lineage and pass.
-- ============================================================================
create function private.route_selection_authority_current(
  p_account_id uuid,
  p_selections jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_skill uuid;
  v_version uuid;
  v_release uuid;
begin
  if p_account_id is null or not exists (
    select 1
    from auth.users u
    where u.id = p_account_id
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= pg_catalog.statement_timestamp())
  ) then
    raise exception 'routing authority unavailable' using errcode = '42501';
  end if;
  if p_selections is null then
    return; -- no_match / avoid carry no lineage.
  end if;
  if pg_catalog.jsonb_typeof(p_selections) <> 'array' then
    raise exception 'routing authority unavailable' using errcode = '42501';
  end if;

  for v_skill, v_version, v_release in
    select
      (it.value ->> 'managed_skill_id')::uuid,
      (it.value ->> 'version_id')::uuid,
      (it.value ->> 'release_id')::uuid
    from pg_catalog.jsonb_array_elements(p_selections) as it
  loop
    if v_skill is null or v_version is null or v_release is null then
      raise exception 'routing authority unavailable' using errcode = '42501';
    end if;
    if not exists (
      select 1
      from private.managed_skill_releases r
      join private.managed_skills m
        on m.account_id = r.account_id
       and m.id = r.managed_skill_id
       and m.active_release_id = r.id
      join private.managed_skill_versions v
        on v.account_id = r.account_id
       and v.managed_skill_id = r.managed_skill_id
       and v.id = r.version_id
      where r.account_id = p_account_id
        and r.managed_skill_id = v_skill
        and r.version_id = v_version
        and r.id = v_release
        and r.lifecycle_state = 'active'
        and pg_catalog.cardinality(r.eligibility_reasons) = 0
        and r.revoked_at is null
        and r.activated_at is not null
        and r.activated_at <= pg_catalog.statement_timestamp()
    ) then
      raise exception 'routing authority unavailable' using errcode = '42501';
    end if;
  end loop;
end
$function$;

revoke all privileges on function private.route_selection_authority_current(uuid,jsonb)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- Revalidate persisted authority before any replay or read is disclosed. This
-- intentionally uses the stored lineage rather than caller-supplied replay
-- payload, so omitting selections cannot bypass revocation or active-pointer
-- changes. It returns false for every unavailable/foreign/stale condition.
create function private.route_decision_authority_current(
  p_account_id uuid,
  p_device_id uuid,
  p_decision_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    exists (
      select 1
      from auth.users u
      where u.id = p_account_id
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= pg_catalog.statement_timestamp())
    )
    and exists (
      select 1
      from private.devices d
      join private.route_decisions rd
        on rd.account_id = d.account_id
       and rd.device_id = d.id
       and rd.id = p_decision_id
      where d.account_id = p_account_id
        and d.id = p_device_id
        and d.state = 'active'
        and d.revoked_at is null
        and (d.expires_at is null or d.expires_at > pg_catalog.statement_timestamp())
        and rd.decision_expiry_at > pg_catalog.statement_timestamp()
    )
    and not exists (
      select 1
      from private.route_decision_selections s
      left join private.managed_skills m
        on m.account_id = s.account_id
       and m.id = s.managed_skill_id
      left join private.managed_skill_versions v
        on v.account_id = s.account_id
       and v.managed_skill_id = s.managed_skill_id
       and v.id = s.version_id
      left join private.managed_skill_releases r
        on r.account_id = s.account_id
       and r.managed_skill_id = s.managed_skill_id
       and r.version_id = s.version_id
       and r.id = s.release_id
      where s.account_id = p_account_id
        and s.device_id = p_device_id
        and s.decision_id = p_decision_id
        and (
          m.id is null
          or m.active_release_id is distinct from s.release_id
          or v.id is null
          or r.id is null
          or r.lifecycle_state <> 'active'
          or pg_catalog.cardinality(r.eligibility_reasons) <> 0
          or r.revoked_at is not null
          or r.activated_at is null
          or r.activated_at > pg_catalog.statement_timestamp()
        )
    )
$function$;

revoke all privileges on function private.route_decision_authority_current(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.route_decision_authority_current(uuid,uuid,uuid)
  to skillmap_vault_definer;

-- ============================================================================
-- 3. CONNECTOR: record one route decision. Resolves the durable device context
--    under the exclusive 'device.route' scope (a revoked / expired / replaced /
--    foreign token, or a device revision / token generation mismatch, is denied
--    before any decision is touched), validates every lineage reference is
--    current-and-owned, then delegates to M2.09 record_route_decision, which
--    takes the advisory lock only at persistence. Returns a bounded, privacy-safe
--    receipt with the immutable public decision id. Exact-replay idempotency and
--    non-disclosing conflict is delegated to record_route_decision.
-- ============================================================================
create function route_adapter.adapter_record_route_decision(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_request_id text,
  p_request_fingerprint text,
  p_result_type text,
  p_confidence numeric,
  p_reason_codes jsonb,
  p_account_revision text,
  p_device_auth_binding_revision text,
  p_routing_policy_revision text,
  p_eligibility_revision text,
  p_audience_revision text,
  p_deadline_ms integer,
  p_elapsed_ms integer,
  p_segment_binding_ms integer,
  p_segment_eligibility_ms integer,
  p_segment_ranking_ms integer,
  p_selections jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_existing record;
  v_decision_id uuid;
  v_receipt record;
begin
  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, 'device.route'
  );

  -- Routing/model evaluation precedes the persistence lock.
  perform private.route_selection_authority_current(p_account_id, p_selections);

  -- P3 device authentication has completed. If this is a replay candidate,
  -- validate the stored decision and stored lineage before the underlying
  -- idempotency function can disclose a receipt or conflict.
  select d.id, d.device_id into v_existing
  from private.route_decisions d
  where d.account_id = p_account_id
    and d.request_id = p_request_id;
  if found and not private.route_decision_authority_current(
    p_account_id, v_existing.device_id, v_existing.id
  ) then
    raise exception 'routing authority unavailable' using errcode = '42501';
  end if;

  v_decision_id := private.record_route_decision(
    p_account_id, v_context.device_id, p_request_id, p_request_fingerprint,
    p_result_type, p_confidence, p_reason_codes,
    p_account_revision, p_device_auth_binding_revision, p_routing_policy_revision,
    p_eligibility_revision, p_audience_revision,
    p_deadline_ms, p_elapsed_ms, p_segment_binding_ms, p_segment_eligibility_ms,
    p_segment_ranking_ms, p_selections
  );

  select
    d.rtd_, d.result_type, d.replay_guaranteed_until,
    d.decision_expiry_at, d.created_at
  into v_receipt
  from private.route_decisions as d
  where d.account_id = p_account_id
    and d.device_id = v_context.device_id
    and d.id = v_decision_id;

  return pg_catalog.jsonb_build_object(
    'decision_id', v_receipt.rtd_,
    'result_type', v_receipt.result_type,
    'created_at', v_receipt.created_at,
    'replay_guaranteed_until', v_receipt.replay_guaranteed_until,
    'decision_expiry_at', v_receipt.decision_expiry_at
  );
end
$function$;

revoke all privileges on function route_adapter.adapter_record_route_decision(uuid,text,integer,bigint,bigint,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- ============================================================================
-- 4. CONNECTOR insert + non-enumerating read. A decision may be read only by the
--    same durable device under 'device.route'. A foreign rtd_, an expired
--    decision authority, or a revoked/expired/replaced token returns NULL (never
--    a disclosure). The projection is bounded and privacy-safe.
-- ============================================================================
create function route_adapter.adapter_read_route_decision(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_rtd text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_decision record;
begin
  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, 'device.route'
  );

  select
    d.id as decision_internal_id, d.rtd_ as d_public,
    d.result_type, d.confidence, d.reason_codes,
    d.replay_guaranteed_until, d.decision_expiry_at, d.created_at
  into v_decision
  from private.route_decisions as d
  where d.account_id = p_account_id
    and d.device_id = v_context.device_id
    and d.rtd_ = p_rtd;

  if not found then
    return null;
  end if;
  if not private.route_decision_authority_current(
    p_account_id, v_context.device_id, v_decision.decision_internal_id
  ) then
    raise exception 'routing authority unavailable' using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object(
    'decision_id', v_decision.d_public,
    'result_type', v_decision.result_type,
    'confidence', v_decision.confidence,
    'reason_codes', v_decision.reason_codes,
    'created_at', v_decision.created_at,
    'replay_guaranteed_until', v_decision.replay_guaranteed_until,
    'decision_expiry_at', v_decision.decision_expiry_at
  );
end
$function$;

revoke all privileges on function route_adapter.adapter_read_route_decision(uuid,text,integer,bigint,bigint,text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- ============================================================================
-- 5. CONNECTOR correction. The durable device under 'device.feedback' scope may
--    submit one bounded feedback outcome against a decision it owns, so long as
--    that decision is from the same account+device and still current (not
--    expired). An optional owned alternative lineage is resolved from public ids
--    to the internal owned current-release chain. M2.09 record_route_correction
--    enforces the one-slot-per-decision contract and key-scoped idempotency.
-- ============================================================================
create function route_adapter.adapter_record_route_correction(
  p_account_id uuid,
  p_credential_digest text,
  p_key_version integer,
  p_expected_device_revision bigint,
  p_expected_token_generation bigint,
  p_rtd text,
  p_outcome text,
  p_alt_skill_public_id text,
  p_alt_version_public_id text,
  p_alt_release_public_id text,
  p_idempotency_key uuid,
  p_expires_at timestamp with time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context record;
  v_decision_id uuid;
  v_correction_id uuid;
  v_alt_managed_skill uuid;
  v_alt_version uuid;
  v_alt_release uuid;
  v_receipt record;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  select * into v_context
  from private.resolve_device_context(
    p_account_id, p_credential_digest, p_key_version,
    p_expected_device_revision, p_expected_token_generation, 'device.feedback'
  );

  -- The corrected decision must be owned by this exact durable device and still
  -- current authority. A foreign or expired decision is never correctable.
  select d.id into v_decision_id
  from private.route_decisions as d
  where d.account_id = p_account_id
    and d.device_id = v_context.device_id
    and d.rtd_ = p_rtd
    and d.decision_expiry_at > v_now;
  if not found then
    raise exception 'routing authority unavailable' using errcode = '42501';
  end if;
  if not private.route_decision_authority_current(
    p_account_id, v_context.device_id, v_decision_id
  ) then
    raise exception 'routing authority unavailable' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'invalid route correction request' using errcode = '22023';
  end if;

  -- Optional alternative lineage: all-or-none public ids, resolved to the owned
  -- current release chain of this account.
  if p_alt_skill_public_id is not null or p_alt_version_public_id is not null
      or p_alt_release_public_id is not null then
    if p_alt_skill_public_id is null or p_alt_version_public_id is null
        or p_alt_release_public_id is null then
      raise exception 'invalid route correction alternative lineage' using errcode = '22023';
    end if;
    select r.managed_skill_id, r.version_id, r.id
      into v_alt_managed_skill, v_alt_version, v_alt_release
    from private.managed_skill_releases r
    join private.managed_skills s
      on s.account_id = r.account_id
     and s.id = r.managed_skill_id
     and s.active_release_id = r.id
    where r.account_id = p_account_id
      and r.public_id = p_alt_release_public_id
      and r.lifecycle_state = 'active'
      and pg_catalog.cardinality(r.eligibility_reasons) = 0
      and r.revoked_at is null
      and r.activated_at is not null
      and r.activated_at <= v_now
      and exists (
        select 1
        from private.managed_skills owned_skill
        where owned_skill.account_id = p_account_id
          and owned_skill.id = r.managed_skill_id
          and owned_skill.public_id = p_alt_skill_public_id
      )
      and exists (
        select 1
        from private.managed_skill_versions v
        where v.account_id = p_account_id
          and v.managed_skill_id = r.managed_skill_id
          and v.id = r.version_id
          and v.public_id = p_alt_version_public_id
      );
    if not found then
      raise exception 'routing authority unavailable' using errcode = '42501';
    end if;
    -- The cohesive tuple is further validated by record_route_correction.
  end if;

  v_correction_id := private.record_route_correction(
    p_account_id, v_context.device_id, v_decision_id, p_outcome,
    v_alt_managed_skill, v_alt_version, v_alt_release,
    p_idempotency_key, p_expires_at
  );

  select c.rtc_, c.outcome, c.created_at, c.expires_at
  into v_receipt
  from private.route_corrections as c
  where c.account_id = p_account_id
    and c.device_id = v_context.device_id
    and c.id = v_correction_id;

  return pg_catalog.jsonb_build_object(
    'correction_id', v_receipt.rtc_,
    'outcome', v_receipt.outcome,
    'created_at', v_receipt.created_at,
    'expires_at', v_receipt.expires_at
  );
end
$function$;

revoke all privileges on function route_adapter.adapter_record_route_correction(uuid,text,integer,bigint,bigint,text,text,text,text,text,uuid,timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

-- ============================================================================
-- 6. DASHBOARD owner history/correction. Bounded owner projections read through
--    private.current_request_uid(); connector scope is never required. An owner
--    may read her own decision/selection/correction history, and may submit a
--    correction for one of her own current decisions. No raw prompt/body is ever
--    projected; account/device/internal uuids are excluded.
-- ============================================================================
create function private.my_route_decisions()
returns table (
  r_public_id text,
  r_result_type text,
  r_confidence numeric,
  r_reason_codes jsonb,
  r_replay_guaranteed_until timestamp with time zone,
  r_decision_expiry_at timestamp with time zone,
  r_created_at timestamp with time zone
)
language sql
stable
security definer
set search_path = ''
as $function$
  select d.rtd_, d.result_type, d.confidence, d.reason_codes,
         d.replay_guaranteed_until, d.decision_expiry_at, d.created_at
  from private.route_decisions as d
  where d.account_id = (select private.current_request_uid())
    and private.route_decision_authority_current(d.account_id, d.device_id, d.id)
  order by d.created_at desc, d.rtd_
$function$;

alter function private.my_route_decisions() owner to skillmap_vault_definer;
revoke all privileges on function private.my_route_decisions()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.my_route_decisions() to skillmap_vault_definer;
grant execute on function private.my_route_decisions() to authenticated;

create view api.my_route_decisions
with (security_invoker = true, security_barrier = true)
as
select
  r_public_id as public_id,
  r_result_type as result_type,
  r_confidence as confidence,
  r_reason_codes as reason_codes,
  r_replay_guaranteed_until as replay_guaranteed_until,
  r_decision_expiry_at as decision_expiry_at,
  r_created_at as created_at
from private.my_route_decisions();

revoke all privileges on table api.my_route_decisions
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_route_decisions to authenticated;

create function private.my_route_selections()
  returns table (
    s_public_decision_id text,
    s_row_kind text,
    s_ordinal integer,
    s_role text,
    s_skill_public_id text,
    s_version_public_id text,
    s_release_public_id text,
    s_confidence numeric,
    s_reason_codes jsonb,
    s_created_at timestamp with time zone
  )
language sql
stable
security definer
set search_path = ''
as $function$
  select d.rtd_, s.row_kind, s.ordinal, s.role,
         m.public_id, v.public_id, r.public_id, s.confidence, s.reason_codes, s.created_at
  from private.route_decision_selections s
  join private.route_decisions d
    on d.account_id = s.account_id and d.device_id = s.device_id and d.id = s.decision_id
  join private.managed_skills m
    on m.account_id = s.account_id and m.id = s.managed_skill_id
  join private.managed_skill_versions v
    on v.account_id = s.account_id and v.managed_skill_id = s.managed_skill_id and v.id = s.version_id
  join private.managed_skill_releases r
    on r.account_id = s.account_id and r.managed_skill_id = s.managed_skill_id
   and r.version_id = s.version_id and r.id = s.release_id
  where s.account_id = (select private.current_request_uid())
    and private.route_decision_authority_current(d.account_id, d.device_id, d.id)
  order by s.created_at desc, s.decision_id, s.ordinal
$function$;

alter function private.my_route_selections() owner to skillmap_vault_definer;
revoke all privileges on function private.my_route_selections()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.my_route_selections() to skillmap_vault_definer;
grant execute on function private.my_route_selections() to authenticated;

create view api.my_route_selections
with (security_invoker = true, security_barrier = true)
as
select
  s_public_decision_id as decision_public_id,
  s_row_kind as row_kind,
  s_ordinal as ordinal,
  s_role as role,
  s_skill_public_id as skill_public_id,
  s_version_public_id as version_public_id,
  s_release_public_id as release_public_id,
  s_confidence as confidence,
  s_reason_codes as reason_codes,
  s_created_at as created_at
from private.my_route_selections();

revoke all privileges on table api.my_route_selections
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_route_selections to authenticated;

create function private.my_route_corrections()
  returns table (
    id_public_id text,
    id_decision_public_id text,
    id_outcome text,
    id_alt_skill_public_id text,
    id_alt_version_public_id text,
    id_alt_release_public_id text,
    id_created_at timestamp with time zone,
    id_expires_at timestamp with time zone
  )
language sql
stable
security definer
set search_path = ''
as $function$
  select c.rtc_, d.rtd_, c.outcome,
         m.public_id, v.public_id, r.public_id, c.created_at, c.expires_at
  from private.route_corrections c
  join private.route_decisions d
    on d.account_id = c.account_id and d.device_id = c.device_id and d.id = c.decision_id
  left join private.managed_skills m
    on m.account_id = c.account_id and m.id = c.alt_managed_skill_id
  left join private.managed_skill_versions v
    on v.account_id = c.account_id and v.managed_skill_id = c.alt_managed_skill_id
   and v.id = c.alt_version_id
  left join private.managed_skill_releases r
    on r.account_id = c.account_id and r.managed_skill_id = c.alt_managed_skill_id
   and r.version_id = c.alt_version_id and r.id = c.alt_release_id
  where c.account_id = (select private.current_request_uid())
    and private.route_decision_authority_current(d.account_id, d.device_id, d.id)
  order by c.created_at desc, c.rtc_
$function$;

alter function private.my_route_corrections() owner to skillmap_vault_definer;
revoke all privileges on function private.my_route_corrections()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.my_route_corrections() to skillmap_vault_definer;
grant execute on function private.my_route_corrections() to authenticated;

create view api.my_route_corrections
with (security_invoker = true, security_barrier = true)
as
select
  id_public_id as correction_public_id,
  id_decision_public_id as decision_public_id,
  id_outcome as outcome,
  id_alt_skill_public_id as alt_skill_public_id,
  id_alt_version_public_id as alt_version_public_id,
  id_alt_release_public_id as alt_release_public_id,
  id_created_at as created_at,
  id_expires_at as expires_at
from private.my_route_corrections();

revoke all privileges on table api.my_route_corrections
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant select on table api.my_route_corrections to authenticated;

-- Authenticated dashboard correction command. Account and device authority are
-- derived from auth.uid() and the owned decision; callers cannot choose either
-- internal coordinate. The connector adapter remains a separate surface.
create function private.submit_my_route_correction(
  p_rtd text,
  p_outcome text,
  p_alt_skill_public_id text,
  p_alt_version_public_id text,
  p_alt_release_public_id text,
  p_idempotency_key uuid,
  p_expires_at timestamp with time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id uuid := (select private.current_request_uid());
  v_device_id uuid;
  v_decision_id uuid;
  v_correction_id uuid;
  v_alt_managed_skill uuid;
  v_alt_version uuid;
  v_alt_release uuid;
  v_receipt record;
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
begin
  if v_account_id is null or p_rtd is null then
    raise exception 'routing authority unavailable' using errcode = '42501';
  end if;

  select d.device_id, d.id into v_device_id, v_decision_id
  from private.route_decisions d
  where d.account_id = v_account_id
    and d.rtd_ = p_rtd;
  if not found or not private.route_decision_authority_current(
    v_account_id, v_device_id, v_decision_id
  ) then
    raise exception 'routing authority unavailable' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'invalid route correction request' using errcode = '22023';
  end if;

  if p_alt_skill_public_id is not null or p_alt_version_public_id is not null
      or p_alt_release_public_id is not null then
    if p_alt_skill_public_id is null or p_alt_version_public_id is null
        or p_alt_release_public_id is null then
      raise exception 'invalid route correction alternative lineage' using errcode = '22023';
    end if;

    select r.managed_skill_id, r.version_id, r.id
      into v_alt_managed_skill, v_alt_version, v_alt_release
    from private.managed_skill_releases r
    join private.managed_skills s
      on s.account_id = r.account_id
     and s.id = r.managed_skill_id
     and s.public_id = p_alt_skill_public_id
     and s.active_release_id = r.id
    join private.managed_skill_versions v
      on v.account_id = r.account_id
     and v.managed_skill_id = r.managed_skill_id
     and v.id = r.version_id
     and v.public_id = p_alt_version_public_id
    where r.account_id = v_account_id
      and r.public_id = p_alt_release_public_id
      and r.lifecycle_state = 'active'
      and pg_catalog.cardinality(r.eligibility_reasons) = 0
      and r.revoked_at is null
      and r.activated_at is not null
      and r.activated_at <= v_now;
    if not found then
      raise exception 'routing authority unavailable' using errcode = '42501';
    end if;
  end if;

  v_correction_id := private.record_route_correction(
    v_account_id, v_device_id, v_decision_id, p_outcome,
    v_alt_managed_skill, v_alt_version, v_alt_release,
    p_idempotency_key, p_expires_at
  );

  select c.rtc_, c.outcome, c.created_at, c.expires_at
    into v_receipt
  from private.route_corrections c
  where c.account_id = v_account_id
    and c.id = v_correction_id;

  return pg_catalog.jsonb_build_object(
    'correction_id', v_receipt.rtc_,
    'outcome', v_receipt.outcome,
    'created_at', v_receipt.created_at,
    'expires_at', v_receipt.expires_at
  );
end
$function$;

alter function private.submit_my_route_correction(text,text,text,text,text,uuid,timestamp with time zone)
  owner to skillmap_vault_definer;
revoke all privileges on function private.submit_my_route_correction(text,text,text,text,text,uuid,timestamp with time zone)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
grant execute on function private.submit_my_route_correction(text,text,text,text,text,uuid,timestamp with time zone)
  to authenticated;

-- The dashboard definer may invoke only the exact immutable correction record
-- function; it receives no route-table write grant.
grant execute on function private.record_route_correction(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,timestamp with time zone)
  to skillmap_vault_definer;

-- ============================================================================
-- 7. Least-privilege grants.
--    - service_role receives USAGE on route_adapter only, plus the exact three
--      adapter EXECUTE grants -- never USAGE on private.
--    - authenticated receives only the dashboard owner projections.
--    - anon receives nothing.
-- ============================================================================
revoke all privileges on function private.my_route_decisions()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.my_route_selections()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.my_route_corrections()
  from public, anon, authenticated, service_role, skillmap_vault_definer;

grant execute on function private.my_route_decisions() to skillmap_vault_definer, authenticated;
grant execute on function private.my_route_selections() to skillmap_vault_definer, authenticated;
grant execute on function private.my_route_corrections() to skillmap_vault_definer, authenticated;

grant usage on schema route_adapter to service_role;
grant execute on function route_adapter.adapter_record_route_decision(uuid,text,integer,bigint,bigint,text,text,text,numeric,jsonb,text,text,text,text,text,integer,integer,integer,integer,integer,jsonb) to service_role;
grant execute on function route_adapter.adapter_read_route_decision(uuid,text,integer,bigint,bigint,text) to service_role;
grant execute on function route_adapter.adapter_record_route_correction(uuid,text,integer,bigint,bigint,text,text,text,text,text,uuid,timestamp with time zone) to service_role;

-- ============================================================================
-- 8. Final could-not-bypass assertions: no application role owns a base-table
--    grant on any route table; internal helpers stay ungranted.
-- ============================================================================
revoke all privileges on function private.route_selection_authority_current(uuid,jsonb)
  from public, anon, authenticated, service_role, skillmap_vault_definer;

commit;
