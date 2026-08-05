begin;

set local search_path = '';

-- -----------------------------------------------------------------------------
-- M2.09 — privacy-safe route decision, selected-lineage, and correction records.
-- Field authority: M2.02 section 4.7 of the forward-only Skill Vault migration
-- series, M1.09 (v1.0.0-draft.3, APPROVED_INDEPENDENT_LUNA_R9_PASS), M1.10, and
-- M1.11 (APPROVED_INDEPENDENT_LUNA_R10_PASS). This migration persists only the
-- exact immutable decision metadata M1.09-M1.11 permit: account/device binding,
-- request id + exact (non-content) request fingerprint, the five M1.09 authority
-- revisions, the exact M1.09 result type (ranked_candidates / multi_skill /
-- no_match / avoid), closed reason codes, bounded timing buckets, expiry and
-- replay window, and the exact immutable Managed Skill / Skill Version / Release
-- lineage of ranked candidates and selected pairs, plus one bounded correction
-- outcome per decision (correct / wrong / unnecessary / missed) with an optional
-- owned alternative lineage. NO raw request, raw classification, context, body,
-- text, embedding, ranking input, feedback text, token, credential, raw error,
-- provider response, storage key, private path, or content digest is persisted.
-- No backfill or conversion from logs, reports, submissions, catalog analytics,
-- or vendor telemetry; this is an empty forward-only create.
--   Every mutation path is an ungranted private implementation function; RLS is
-- enabled and forced with zero policies; public and application-role access is
-- revoked. M2.12 owns browser/connector policies, grants, and public read/write
-- APIs. Locks here are strictly process/transaction-local advisory locks; no
-- model or provider call occurs under or around any lock in this migration.
-- =============================================================================

-- Unique key required to reference a release by (account, skill, version, id).
-- (Codex round 1: required release lineage; the parent did not carry this key.)
alter table private.managed_skill_releases
  add constraint managed_skill_releases_nav_key
  unique (account_id, managed_skill_id, version_id, id);

-- Shared bounded helpers (ungranted, safe search_path).

-- Revision strings obey the closed M1.09 expiry / revision grammar (opaque ids).
create function private.revision_grammar_ok(value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select value ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
$$;

-- Deterministic canonical form (sorted, distinct) of an M1.09 reason-code array.
create function private.normalize_reason_codes(value jsonb)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.jsonb_agg(code order by code)
  from (
    select distinct code
    from pg_catalog.jsonb_array_elements_text(value) as codes(code)
  ) as items
$$;

-- Closed M1.09 reason vocabulary (1..5 distinct codes, canonical form).
create function private.reason_codes_are_canonical(value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    pg_catalog.jsonb_typeof(value) = 'array'
    and pg_catalog.jsonb_array_length(value) between 1 and 5
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(value) as codes(code)
      where code is null
         or pg_catalog.octet_length(code) not between 3 and 48
         or code not in (
           'prompt_intent_match', 'context_signal_match', 'explicit_scope_match',
           'policy_preference', 'eligibility_confirmed', 'device_binding_confirmed',
           'complementary_capability', 'ambiguous_intent', 'no_eligible_skill',
           'below_confidence_threshold', 'policy_denied', 'device_not_authorized',
           'sensitive_input', 'prohibited_request'
         )
    )
    and value = private.normalize_reason_codes(value)
$$;

-- =============================================================================
-- route_decisions: account-scoped idempotency. request_id is the idempotency
-- key within account_public_id (M1.09 section 7); P4 lookup is account-scoped.
-- The device is recorded and validated current, but does not partition the key.
-- =============================================================================
create table private.route_decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  rtd_ text not null
    default ('rtd_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  device_id uuid not null,

  request_id text not null,
  request_fingerprint text not null,

  -- Exact M1.09 result type (this is the lossless mapping; no separate mode).
  result_type text not null,
  confidence numeric(5,4) not null,
  reason_codes jsonb not null,

  account_revision text not null,
  device_auth_binding_revision text not null,
  routing_policy_revision text not null,
  eligibility_revision text not null,
  audience_revision text not null,

  -- Bounded timing buckets (M1.11 permits buckets, not exact timestamps).
  deadline_ms integer not null,
  elapsed_ms integer not null,
  segment_binding_ms integer not null,
  segment_eligibility_ms integer not null,
  segment_ranking_ms integer not null,

  -- Replay window of at least 24 hours and a hard decision expiry no later than
  -- 30 days (M1.09 replay guarantee >= 24h; M1.11 retention is 30d or earlier
  -- revocation/deletion). A stored decision is never served past decision_expiry_at,
  -- and an exact replay is only served inside the replay window.
  replay_guaranteed_until timestamp with time zone not null,
  decision_expiry_at timestamp with time zone not null,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint route_decisions_public_id_key unique (rtd_),
  constraint route_decisions_account_id_id_key unique (account_id, id),
  constraint route_decisions_account_device_id_key unique (account_id, device_id, id),
  -- Idempotency key is account-scoped (M1.09 section 7): the same request id under
  -- one account has exactly one decision, regardless of which current device.
  constraint route_decisions_idempotency_key unique (account_id, request_id),
  constraint route_decisions_device_fkey
    foreign key (account_id, device_id)
    references private.devices (account_id, id)
    on delete cascade,
  constraint route_decisions_rtd_format_check
    check (rtd_ ~ '^rtd_[0-9a-f]{32}$'),
  constraint route_decisions_request_id_format_check
    check (request_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint route_decisions_fingerprint_format_check
    check (request_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint route_decisions_result_type_check
    check (result_type in ('ranked_candidates', 'multi_skill', 'no_match', 'avoid')),
  constraint route_decisions_confidence_check
    check (confidence between 0.0 and 1.0),
  constraint route_decisions_reason_codes_check
    check (private.reason_codes_are_canonical(reason_codes)),
  constraint route_decisions_account_revision_check
    check (private.revision_grammar_ok(account_revision)),
  constraint route_decisions_device_revision_check
    check (private.revision_grammar_ok(device_auth_binding_revision)),
  constraint route_decisions_policy_revision_check
    check (private.revision_grammar_ok(routing_policy_revision)),
  constraint route_decisions_eligibility_revision_check
    check (private.revision_grammar_ok(eligibility_revision)),
  constraint route_decisions_audience_revision_check
    check (private.revision_grammar_ok(audience_revision)),
  constraint route_decisions_deadline_bounds_check
    check (deadline_ms between 100 and 1000),
  constraint route_decisions_elapsed_bounds_check
    check (elapsed_ms between 0 and 1000),
  constraint route_decisions_elapsed_le_deadline_check
    check (elapsed_ms <= deadline_ms),
  constraint route_decisions_timing_bucket_bounds_check
    check (
      segment_binding_ms between 0 and 1000
      and segment_eligibility_ms between 0 and 1000
      and segment_ranking_ms between 0 and 1000
    ),
  constraint route_decisions_timing_bucket_sum_check
    check (segment_binding_ms + segment_eligibility_ms + segment_ranking_ms <= elapsed_ms),
  constraint route_decisions_replay_min_check
    check (replay_guaranteed_until >= created_at + interval '24 hours'),
  constraint route_decisions_expiry_covering_check
    check (decision_expiry_at >= replay_guaranteed_until),
  constraint route_decisions_expiry_max_check
    check (decision_expiry_at <= created_at + interval '30 days')
);

comment on table private.route_decisions is
  'Privacy-safe immutable routing decision authority with account-scoped '
  'idempotency (M1.09 section 7). Persistent content is the non-content request '
  'id + fingerprint, the five M1.09 binding revisions, the exact M1.09 result '
  'type, bounded timing buckets, closed codes, and the expiry/replay window. No '
  'raw prompt, context, body, embed, ranking input, token, credential, content '
  'digest, storage key, or provider response is ever stored here.';

-- =============================================================================
-- route_decision_selections: immutable selected / ranked lineage with the
-- required release. A ranked_candidates decision carries ranked lineage
-- (row_kind='ranked', ordinal = rank 1..20, role null, advisory; rank 1 is the
-- sole authoritative pair). A multi_skill decision result carries selected
-- lineage (row_kind='selected', ordinal = selection order 1..3, role in
-- primary/supporting). no_match / avoid results carry no lineage.
-- =============================================================================
create table private.route_decision_selections (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null,
  device_id uuid not null,
  decision_id uuid not null,
  managed_skill_id uuid not null,
  version_id uuid not null,
  -- Required release lineage (M2.02 section 4.7): the exact owned release
  -- binding for this skill/version at routing time.
  release_id uuid not null,
  row_kind text not null,
  ordinal integer not null,
  role text,
  confidence numeric(5,4) not null,
  reason_codes jsonb not null,
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint route_decision_selections_account_id_id_key unique (account_id, id),
  constraint route_decision_selections_account_device_id_key unique (account_id, device_id, id),
  constraint route_decision_selections_decision_ordinal_key
    unique (decision_id, row_kind, ordinal),
  -- A skill/version/release pair may not repeat within one decision.
  constraint route_decision_selections_binding_key
    unique (decision_id, row_kind, managed_skill_id, version_id, release_id),
  constraint route_decision_selections_decision_fkey
    foreign key (account_id, device_id, decision_id)
    references private.route_decisions (account_id, device_id, id)
    on delete cascade,
  constraint route_decision_selections_release_fkey
    foreign key (account_id, managed_skill_id, version_id, release_id)
    references private.managed_skill_releases (account_id, managed_skill_id, version_id, id)
    on delete cascade,
  constraint route_decision_selections_row_kind_check
    check (row_kind in ('ranked', 'selected')),
  constraint route_decision_selections_ordinal_check
    check (
      (row_kind = 'ranked' and ordinal between 1 and 20)
      or (row_kind = 'selected' and ordinal between 1 and 3)
    ),
  constraint route_decision_selections_role_check
    check (role is null or role in ('primary', 'supporting')),
  constraint route_decision_selections_role_kind_check
    check (
      (row_kind = 'ranked' and role is null)
      or (row_kind = 'selected' and role is not null)
    ),
  constraint route_decision_selections_confidence_check
    check (confidence between 0.0 and 1.0),
  constraint route_decision_selections_reason_codes_check
    check (private.reason_codes_are_canonical(reason_codes))
);

comment on table private.route_decision_selections is
  'Immutable selected lineage: the exact Managed Skill / Skill Version / Release '
  'tuple of each ranked candidate or selected alternative M1.11 permits. '
  'ranked_candidates results use advisory ranked rows (role null, rank 1 is the '
  'authoritative pair); multi_skill results use selected rows with an explicit '
  'role. The per-decision set is re-validated by a statement-level trigger after '
  'each change. No unselected entry, file body, path, or content-derived value is '
  'stored.';

-- =============================================================================
-- route_corrections: the product feedback outcome, with optional owned
-- alternative lineage for a wrong/missed correction. One immutable slot per
-- decision; idempotent replay. No invented processing-status vocabulary.
-- =============================================================================
create table private.route_corrections (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  rtc_ text not null
    default ('rtc_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')),
  account_id uuid not null,
  device_id uuid not null,
  decision_id uuid not null,
  outcome text not null,
  -- Optional owned alternative selected lineage (all-or-none).
  alt_managed_skill_id uuid,
  alt_version_id uuid,
  alt_release_id uuid,
  idempotency_key uuid not null,
  expires_at timestamp with time zone not null default
    (pg_catalog.statement_timestamp() + interval '7 days'),
  created_at timestamp with time zone not null default pg_catalog.statement_timestamp(),

  constraint route_corrections_rtc_public_key unique (rtc_),
  constraint route_corrections_account_id_key unique (account_id, id),
  -- Decision is account-scoped, so one slot per decision is account+decision unique.
  constraint route_corrections_slot_key unique (account_id, decision_id),
  constraint route_corrections_idempotency_key
    unique (account_id, decision_id, idempotency_key),
  constraint route_corrections_decision_fkey
    foreign key (account_id, device_id, decision_id)
    references private.route_decisions (account_id, device_id, id)
    on delete cascade,
  constraint route_corrections_release_fkey
    foreign key (account_id, alt_managed_skill_id, alt_version_id, alt_release_id)
    references private.managed_skill_releases (account_id, managed_skill_id, version_id, id)
    on delete cascade,
  constraint route_corrections_rtc_format_check
    check (rtc_ ~ '^rtc_[0-9a-f]{32}$'),
  -- The four product feedback outcomes (glossary line 143; M5.14/M6.13/M9.09).
  constraint route_corrections_outcome_check
    check (outcome in ('correct', 'wrong', 'unnecessary', 'missed')),
  -- Alternative lineage is all-null or all-non-null (no partial id set).
  constraint route_corrections_alternative_coherence_check
    check (
      (alt_managed_skill_id is null and alt_version_id is null and alt_release_id is null)
      or (alt_managed_skill_id is not null and alt_version_id is not null and alt_release_id is not null)
    ),
  -- Alternative may be supplied at most for a wrong/missed correction.
  constraint route_corrections_alternative_outcome_check
    check (
      alt_managed_skill_id is null
      or outcome in ('wrong', 'missed')
    ),
  constraint route_corrections_expiry_future_check
    check (expires_at > created_at)
);

comment on table private.route_corrections is
  'One bounded, immutable, idempotent feedback outcome per decision '
  '(correct/wrong/unnecessary/missed). wrong/missed may carry an optional owned '
  'alternative skill/version/release lineage (composite FK, all-or-none). No free '
  'text. An expired or foreign decision is never correctable from a restored row.';

-- =============================================================================
-- Immutability trigger functions (INSERT-only; UPDATE and DELETE raise 22023).
-- =============================================================================
create function private.enforce_route_decisions_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using
      errcode = '22023',
      message = 'route decision rows are immutable';
  end if;
  return new;
end;
$function$;

create trigger trg_route_decisions_immutable
before update or delete on private.route_decisions
for each row execute function private.enforce_route_decisions_immutable();

create function private.enforce_route_decision_selections_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using
      errcode = '22023',
      message = 'route decision lineage rows are immutable';
  end if;
  return new;
end;
$function$;

create trigger trg_route_decision_selections_immutable
before update or delete on private.route_decision_selections
for each row execute function private.enforce_route_decision_selections_immutable();

create function private.enforce_route_corrections_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using
      errcode = '22023',
      message = 'route correction rows are immutable';
  end if;
  return new;
end;
$function$;

create trigger trg_route_corrections_immutable
before update or delete on private.route_corrections
for each row execute function private.enforce_route_corrections_immutable();

-- =============================================================================
-- Full-set validation of one decision's lineage. Enforces per-result-type
-- semantics: ranked_candidates (ranked rows, contiguous 1..N, max 20, roles
-- null, non-increasing confidence), multi_skill (selected rows, contiguous
-- 1..N, 2..3 entries, exactly one primary at order 1), and no_match / avoid
-- (zero selections). Roles/kind pairing is closed; no cross-account release.
-- =============================================================================
create function private.assert_route_decision_lineage_valid(
  p_account_id uuid,
  p_device_id uuid,
  p_decision_id uuid
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_result_type text;
  v_count integer;
  v_kind_min text;
  v_kind_max text;
  v_min_ordinal integer;
  v_max_ordinal integer;
  v_primary_count integer;
  v_primary_at integer;
  v_prev_confidence numeric;
  v_row record;
begin
  select result_type into v_result_type
  from private.route_decisions as route_decisions
  where route_decisions.account_id = p_account_id
    and route_decisions.device_id = p_device_id
    and route_decisions.id = p_decision_id;

  if not found then
    return; -- the FK will already have rejected a foreign referencing row.
  end if;

  if v_result_type in ('no_match', 'avoid') then
    if exists (
      select 1
      from private.route_decision_selections as selections
      where selections.account_id = p_account_id
        and selections.device_id = p_device_id
        and selections.decision_id = p_decision_id
    ) then
      raise exception using
        errcode = '22023',
        message = 'no-match/avoid results carry no lineage';
    end if;
    return;
  end if;

  select count(*)::integer, min(s.row_kind), max(s.row_kind),
         min(s.ordinal), max(s.ordinal)
    into v_count, v_kind_min, v_kind_max, v_min_ordinal, v_max_ordinal
  from private.route_decision_selections as s
  where s.account_id = p_account_id
    and s.device_id = p_device_id
    and s.decision_id = p_decision_id;

  if v_count = 0 then
    raise exception using
      errcode = '22023',
      message = 'a selecting result requires at least one lineage row';
  end if;

  if v_kind_min is distinct from v_kind_max then
    raise exception using
      errcode = '22023',
      message = 'a result may not mix ranked and selected lineage rows';
  end if;

  if v_result_type = 'ranked_candidates' then
    if v_kind_min <> 'ranked' then
      raise exception using
        errcode = '22023',
        message = 'ranked_candidates requires ranked lineage rows';
    end if;
    if v_min_ordinal <> 1 or v_max_ordinal <> v_count or v_count > 20 then
      raise exception using
        errcode = '22023',
        message = 'ranked lineage must be contiguous ranks 1..N (max 20)';
    end if;
    if exists (
      select 1
      from private.route_decision_selections as s
      where s.decision_id = p_decision_id and s.role is not null
    ) then
      raise exception using
        errcode = '22023',
        message = 'ranked lineage rows carry no role';
    end if;
    for v_row in
      select s.ordinal as ordinal, s.confidence as confidence
      from private.route_decision_selections as s
      where s.decision_id = p_decision_id
      order by s.ordinal
    loop
      if v_row.confidence > v_prev_confidence then
        raise exception using
          errcode = '22023',
          message = 'ranked confidence must be non-increasing by rank';
      end if;
      v_prev_confidence := v_row.confidence;
    end loop;
  elsif v_result_type = 'multi_skill' then
    if v_kind_min <> 'selected' then
      raise exception using
        errcode = '22023',
        message = 'multi_skill requires selected lineage rows';
    end if;
    if v_min_ordinal <> 1 or v_max_ordinal <> v_count
       or v_count < 2 or v_count > 3
    then
      raise exception using
        errcode = '22023',
        message = 'selected lineage must be contiguous orders 1..N with 2..3 rows';
    end if;
    select count(*)::int, min(s.ordinal) into v_primary_count, v_primary_at
    from private.route_decision_selections as s
    where s.decision_id = p_decision_id and s.role = 'primary';
    if v_primary_count <> 1 or v_primary_at is distinct from 1 then
      raise exception using
        errcode = '22023',
        message = 'selected bundle requires exactly one primary at order 1';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'a selecting result has an invalid result type';
  end if;
end;
$function$;

-- Statement-level validation after the single atomic lineage INSERT. The row
-- immutability trigger pre-empts UPDATE/DELETE, so the only path to change a
-- decision's lineage is the record function's single INSERT...SELECT, which the
-- statement sees as the complete set.
create function private.validate_route_selection_changes()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_account_id uuid;
  v_device_id uuid;
  v_decision_id uuid;
begin
  for v_account_id, v_device_id, v_decision_id in
    select distinct account_id, device_id, decision_id from new_rows
  loop
    perform private.assert_route_decision_lineage_valid(v_account_id, v_device_id, v_decision_id);
  end loop;
  return null;
end;
$function$;

create trigger trg_route_decision_selections_change
after insert on private.route_decision_selections
referencing new table as new_rows
for each statement execute function private.validate_route_selection_changes();

-- =============================================================================
-- Implementation: record one full decision (idempotent, atomic), with account-
-- scoped replay that is dominated by expiry. The current device is validated
-- before ANY idempotency lookup, and an identity that conflicts or is expired is
-- never disclosed/replayed.
-- =============================================================================
create function private.record_route_decision(
  p_account_id uuid,
  p_device_id uuid,
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
  p_selections jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_decision_id uuid;
  v_existing private.route_decisions%rowtype;
  v_match boolean;
  v_replay timestamp with time zone;
  v_expiry timestamp with time zone;
begin
  if p_account_id is null or p_device_id is null
    or p_request_id is null or p_request_fingerprint is null
    or p_result_type is null or p_confidence is null or p_reason_codes is null
    or p_account_revision is null or p_device_auth_binding_revision is null
    or p_routing_policy_revision is null or p_eligibility_revision is null
    or p_audience_revision is null
    or p_deadline_ms is null or p_elapsed_ms is null
    or p_segment_binding_ms is null or p_segment_eligibility_ms is null
    or p_segment_ranking_ms is null
  then
    raise exception 'invalid route decision commit request' using errcode = '22023';
  end if;

  if p_result_type not in ('ranked_candidates', 'multi_skill', 'no_match', 'avoid') then
    raise exception 'invalid route result type' using errcode = '22023';
  end if;
  if p_confidence < 0 or p_confidence > 1 then
    raise exception 'invalid route decision confidence' using errcode = '22023';
  end if;

  if not private.revision_grammar_ok(p_account_revision)
    or not private.revision_grammar_ok(p_device_auth_binding_revision)
    or not private.revision_grammar_ok(p_routing_policy_revision)
    or not private.revision_grammar_ok(p_eligibility_revision)
    or not private.revision_grammar_ok(p_audience_revision)
  then
    raise exception 'invalid route binding revision' using errcode = '22023';
  end if;
  if p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_fingerprint !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception 'invalid route request identity' using errcode = '22023';
  end if;
  if p_deadline_ms < 100 or p_deadline_ms > 1000
    or p_elapsed_ms < 0 or p_elapsed_ms > p_deadline_ms
  then
    raise exception 'invalid route deadline or elapsed timing' using errcode = '22023';
  end if;
  if p_segment_binding_ms < 0 or p_segment_eligibility_ms < 0 or p_segment_ranking_ms < 0
    or p_segment_binding_ms + p_segment_eligibility_ms + p_segment_ranking_ms > p_elapsed_ms
  then
    raise exception 'invalid route timing parameters' using errcode = '22023';
  end if;

  -- P3-style: the M1.08 device must be current and authorized for this account
  -- BEFORE any idempotency lookup / replay disclosure.
  if not exists (
    select 1
    from private.devices as devices
    where devices.account_id = p_account_id
      and devices.id = p_device_id
      and devices.state = 'active'
      and devices.revoked_at is null
      and (devices.expires_at is null or devices.expires_at > v_now)
  ) then
    raise exception 'device is not current and authorized for a route decision'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 5)
  );

  -- P4 account-scoped idempotency lookup (account_id + request_id).
  select route_decisions.* into v_existing
  from private.route_decisions as route_decisions
  where route_decisions.account_id = p_account_id
    and route_decisions.request_id = p_request_id
  for update;

  if found then
    -- Expired decision authority never be served (expiry dominates replay).
    if v_existing.decision_expiry_at <= v_now then
      raise exception 'route decision authority has exceeded its expiry; new request id required'
        using errcode = '22023';
    end if;

    -- Account-scoped idempotency also binds the device. An existing decision for
    -- this account/request id that was recorded on a different device cannot be
    -- replayed (the request fingerprint and device are part of the binding). This
    -- is a non-disclosing conflict; it never leaks whether another device's row
    -- exists. Account-scoped lookup (account_id + request_id) still must not
    -- recur within a different device lineage, because a single(account, id) is one
    -- decision and a changed device is a changed authoritative binding.
    if v_existing.device_id is distinct from p_device_id then
      raise exception 'idempotency conflict for this account route request'
        using errcode = '22023';
    end if;

    -- Exact replay is only served inside the guaranteed replay window.
    if v_now > v_existing.replay_guaranteed_until then
      raise exception 'route decision replay window has expired; new request id required'
        using errcode = '22023';
    end if;

    -- The exact same device/request id must also carry the identical fingerprint
    -- and the five binding revisions.
    v_match :=
      v_existing.request_fingerprint = p_request_fingerprint
      and v_existing.account_revision = p_account_revision
      and v_existing.device_auth_binding_revision = p_device_auth_binding_revision
      and v_existing.routing_policy_revision = p_routing_policy_revision
      and v_existing.eligibility_revision = p_eligibility_revision
      and v_existing.audience_revision = p_audience_revision;
    if not v_match then
      raise exception 'idempotency conflict for this account route request'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  -- Insert path: replay/expiry always use the M1.09/M1.11 default bounds of a
  -- 24-hour replay guarantee and a 30-day decision authority.
  v_replay := v_now + interval '24 hours';
  v_expiry := v_now + interval '30 days';

  insert into private.route_decisions (
    account_id, device_id, request_id, request_fingerprint, result_type,
    confidence, reason_codes,
    account_revision, device_auth_binding_revision, routing_policy_revision,
    eligibility_revision, audience_revision,
    deadline_ms, elapsed_ms, segment_binding_ms, segment_eligibility_ms,
    segment_ranking_ms, replay_guaranteed_until, decision_expiry_at, created_at
  ) values (
    p_account_id, p_device_id, p_request_id, p_request_fingerprint, p_result_type,
    p_confidence, private.normalize_reason_codes(p_reason_codes),
    p_account_revision, p_device_auth_binding_revision, p_routing_policy_revision,
    p_eligibility_revision, p_audience_revision,
    p_deadline_ms, p_elapsed_ms, p_segment_binding_ms, p_segment_eligibility_ms,
    p_segment_ranking_ms, v_replay, v_expiry, v_now
  ) returning id into v_decision_id;

  if p_result_type in ('ranked_candidates', 'multi_skill') then
    if p_selections is null or pg_catalog.jsonb_typeof(p_selections) <> 'array'
       or pg_catalog.jsonb_array_length(p_selections) < 1
    then
      raise exception 'a selecting result requires non-empty lineage' using errcode = '22023';
    end if;
    insert into private.route_decision_selections (
      account_id, device_id, decision_id, managed_skill_id, version_id,
      release_id, row_kind, ordinal, role, confidence, reason_codes
    )
    select
      p_account_id, p_device_id, v_decision_id,
      (lineage.value ->> 'managed_skill_id')::uuid,
      (lineage.value ->> 'version_id')::uuid,
      (lineage.value ->> 'release_id')::uuid,
      lineage.value ->> 'row_kind',
      (lineage.value ->> 'ordinal')::integer,
      lineage.value ->> 'role',
      (lineage.value ->> 'confidence')::numeric(5,4),
      private.normalize_reason_codes(coalesce((lineage.value ->> 'reason_codes')::jsonb, p_reason_codes))
    from pg_catalog.jsonb_array_elements(p_selections) as lineage;
  elsif p_selections is not null then
    raise exception 'no_match/avoid results must carry no lineage' using errcode = '22023';
  end if;

  return v_decision_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- Implementation: record the single bounded feedback (renamed to the product
-- vocabulary) and its optional owned alternative lineage.
-- -----------------------------------------------------------------------------
create function private.record_route_correction(
  p_account_id uuid,
  p_device_id uuid,
  p_decision_id uuid,
  p_outcome text,
  p_alt_managed_skill_id uuid,
  p_alt_version_id uuid,
  p_alt_release_id uuid,
  p_idempotency_key uuid,
  p_expires_at timestamp with time zone default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_correction_id uuid;
  v_decision_expiry timestamp with time zone;
  v_existing private.route_corrections%rowtype;
begin
  if p_account_id is null or p_device_id is null or p_decision_id is null
    or p_outcome is null or p_idempotency_key is null
  then
    raise exception 'invalid route correction request' using errcode = '22023';
  end if;

  if p_outcome not in ('correct', 'wrong', 'unnecessary', 'missed') then
    raise exception 'invalid route correction outcome' using errcode = '22023';
  end if;

  -- Alternative lineage must be all-null or all-non-null.
  if (p_alt_managed_skill_id is null) <> (p_alt_version_id is null)
    or (p_alt_managed_skill_id is null) <> (p_alt_release_id is null)
  then
    raise exception 'invalid route correction alternative lineage' using errcode = '22023';
  end if;

  -- The referenced decision must belong to this account/device and still be
  -- authority (not expired). A foreign or expired decision is never correctable.
  select decision_expiry_at into v_decision_expiry
  from private.route_decisions as route_decisions
  where route_decisions.account_id = p_account_id
    and route_decisions.device_id = p_device_id
    and route_decisions.id = p_decision_id;
  if not found then
    raise exception 'route decision is not available for correction' using errcode = '22023';
  end if;
  if v_decision_expiry <= v_now then
    raise exception 'route decision authority has expired' using errcode = '42501';
  end if;

  -- Alternative release must be real and owned by this account, and current
  -- (a non-expired, non-revoked release) when supplied.
  if p_alt_release_id is not null then
    if not exists (
      select 1
      from private.managed_skill_releases as releases
      where releases.account_id = p_account_id
        and releases.id = p_alt_release_id
        and releases.managed_skill_id = p_alt_managed_skill_id
        and releases.version_id = p_alt_version_id
        and releases.lifecycle_state = 'active'
        and releases.revoked_at is null
    ) then
      raise exception 'route correction alternative is not an owned current release'
        using errcode = '22023';
    end if;
  end if;

  if p_expires_at is not null and p_expires_at <= v_now then
    raise exception 'correction expiry must be in the future' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text, 5)
  );

  -- Scoped idempotency: same (account, decision, key) replays the SAME immutable
  -- payload. A changed outcome/alternative under the same key is an idempotency
  -- conflict, not a silent rewrite of a duplicate row.
  select corrections.* into v_existing
  from private.route_corrections as corrections
  where corrections.account_id = p_account_id
    and corrections.decision_id = p_decision_id
    and corrections.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.outcome is distinct from p_outcome
      or v_existing.alt_managed_skill_id is distinct from p_alt_managed_skill_id
      or v_existing.alt_version_id is distinct from p_alt_version_id
      or v_existing.alt_release_id is distinct from p_alt_release_id
    then
      raise exception 'idempotency conflict for this route correction' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  -- One immutable slot per decision: any other feasible (correct) is rejected by
  -- the single query trust the account+decision unique above.
  insert into private.route_corrections (
    account_id, device_id, decision_id, outcome,
    alt_managed_skill_id, alt_version_id, alt_release_id,
    idempotency_key, expires_at, created_at
  ) values (
    p_account_id, p_device_id, p_decision_id, p_outcome,
    p_alt_managed_skill_id, p_alt_version_id, p_alt_release_id,
    p_idempotency_key, coalesce(p_expires_at, v_now + interval '7 days'), v_now
  ) returning id into v_correction_id;

  return v_correction_id;
end;
$function$;

-- =============================================================================
-- Least-privilege posture: RLS enabled + forced, zero policies, no broad grants.
-- =============================================================================
revoke all privileges on table private.route_decisions
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.route_decision_selections
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on table private.route_corrections
  from public, anon, authenticated, service_role, skillmap_vault_definer;

revoke all privileges on function private.revision_grammar_ok(text)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.normalize_reason_codes(jsonb)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.reason_codes_are_canonical(jsonb)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_route_decisions_immutable()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_route_decision_selections_immutable()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.enforce_route_corrections_immutable()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.assert_route_decision_lineage_valid(uuid,uuid,uuid)
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.validate_route_selection_changes()
  from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.record_route_decision(
  uuid, uuid, text, text, text, numeric, jsonb, text, text, text, text, text,
  integer, integer, integer, integer, integer, jsonb
) from public, anon, authenticated, service_role, skillmap_vault_definer;
revoke all privileges on function private.record_route_correction(
  uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, timestamp with time zone
) from public, anon, authenticated, service_role, skillmap_vault_definer;

alter table private.route_decisions enable row level security;
alter table private.route_decisions force row level security;
alter table private.route_decision_selections enable row level security;
alter table private.route_decision_selections force row level security;
alter table private.route_corrections enable row level security;
alter table private.route_corrections force row level security;

-- Intentionally no row-level security policies and no grants before M2.12.

commit;