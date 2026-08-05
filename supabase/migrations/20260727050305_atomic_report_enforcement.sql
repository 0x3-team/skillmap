begin;

-- A confirmed report must never be resolved independently from the exact
-- catalog restriction that makes the reported version non-public. Replace the
-- original disposition RPC with a target-bound atomic operation. Non-confirmed
-- dispositions remain report-only, while confirmed dispositions require one
-- explicit version quarantine or revocation action.
--
-- The preceding RPC did not retain enough evidence to prove that a legacy
-- confirmed disposition hid its exact target. Refuse to upgrade a populated
-- target with any legacy resolved report instead of silently blessing an
-- incomplete receipt. Operators must reconcile those reports and their exact
-- catalog state in a reviewed forward migration before retrying this migration.
do $$
begin
  if exists (
    select 1
    from api.skill_reports report
    where report.state = 'resolved'
  ) then
    raise exception 'atomic report enforcement migration requires zero legacy resolved reports; reconcile them in a reviewed forward migration first'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function api.disposition_skill_report(text, text, text, text, text)
  from public, anon, authenticated, service_role;
drop function api.disposition_skill_report(text, text, text, text, text);

create function api.disposition_skill_report(
  p_report_id text,
  p_disposition_code text,
  p_reason_code text,
  p_public_message text,
  p_lifecycle_action text,
  p_idempotency_digest text
)
returns table (
  report_id text,
  report_state text,
  disposition_code text,
  skill_id text,
  version_id text,
  lifecycle_action text,
  version_quarantined boolean,
  version_revoked boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row api.skill_reports%rowtype;
  skill_row private.skills%rowtype;
  version_row private.skill_versions%rowtype;
  prior_event private.audit_events%rowtype;
  lifecycle_digest text;
  outcome_quarantined boolean;
  outcome_revoked boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'report disposition authority is required' using errcode = '42501';
  end if;
  if p_report_id is null or p_report_id !~ '^rpt_[0-9a-f]{32}$'
    or p_disposition_code not in ('confirmed', 'no-action', 'duplicate', 'invalid')
    or p_reason_code is null or length(p_reason_code) not between 1 and 64
      or p_reason_code !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_public_message is null or not private.safe_public_message(p_public_message, 500)
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$'
    or (p_disposition_code = 'confirmed'
      and (p_lifecycle_action is null
        or p_lifecycle_action not in ('quarantine-version', 'revoke-version')))
    or (p_disposition_code <> 'confirmed' and p_lifecycle_action is not null) then
    raise exception 'report disposition is invalid' using errcode = '22023';
  end if;

  select * into report_row
  from api.skill_reports report
  where report.public_id = p_report_id
  for update;
  if report_row.id is null then
    raise exception 'report was not found' using errcode = 'P0002';
  end if;

  if report_row.state = 'resolved' then
    if report_row.resolution_digest is distinct from p_idempotency_digest
      or report_row.disposition_code is distinct from p_disposition_code
      or report_row.resolution_reason_code is distinct from p_reason_code
      or report_row.public_resolution_message is distinct from p_public_message then
      raise exception 'report is already resolved by another disposition' using errcode = '55000';
    end if;

    select * into prior_event
    from private.audit_events event
    where event.idempotency_digest = p_idempotency_digest;
    if prior_event.id is null
      or prior_event.event_type <> 'report.dispositioned'
      or prior_event.subject_type <> 'report'
      or prior_event.subject_id <> report_row.public_id
      or prior_event.payload ->> 'dispositionCode' is distinct from p_disposition_code
      or prior_event.payload ->> 'reasonCode' is distinct from p_reason_code
      or prior_event.payload ->> 'lifecycleAction' is distinct from p_lifecycle_action
      or prior_event.payload ->> 'skillId' is distinct from report_row.skill_id
      or prior_event.payload ->> 'versionId' is distinct from report_row.version_id
      or coalesce(jsonb_typeof(prior_event.payload -> 'result'), 'missing') <> 'object'
      or coalesce(jsonb_typeof(prior_event.payload #> '{result,versionQuarantined}'), 'missing')
        not in ('boolean', 'null')
      or coalesce(jsonb_typeof(prior_event.payload #> '{result,versionRevoked}'), 'missing')
        not in ('boolean', 'null') then
      raise exception 'report enforcement receipt is incomplete or contradictory' using errcode = '55000';
    end if;

    return query select
      report_row.public_id,
      report_row.state,
      report_row.disposition_code,
      report_row.skill_id,
      report_row.version_id,
      p_lifecycle_action,
      (prior_event.payload #>> '{result,versionQuarantined}')::boolean,
      (prior_event.payload #>> '{result,versionRevoked}')::boolean;
    return;
  end if;

  if p_disposition_code = 'confirmed' then
    select * into skill_row
    from private.skills skill
    where skill.public_id = report_row.skill_id
    for update;
    if skill_row.id is null then
      raise exception 'reported skill was not found' using errcode = 'P0002';
    end if;

    select * into version_row
    from private.skill_versions version
    where version.public_id = report_row.version_id
      and version.skill_id = skill_row.id
    for update;
    if version_row.id is null then
      raise exception 'reported version does not belong to the exact skill' using errcode = '23514';
    end if;

    if p_lifecycle_action = 'quarantine-version' then
      update private.skill_versions
      set quarantined_at = coalesce(quarantined_at, now())
      where id = version_row.id
      returning * into version_row;
    else
      update private.skill_versions
      set revoked_at = coalesce(revoked_at, now())
      where id = version_row.id
      returning * into version_row;
    end if;
    outcome_quarantined := version_row.quarantined_at is not null;
    outcome_revoked := version_row.revoked_at is not null;

    lifecycle_digest := 'sha256:' || encode(
      extensions.digest(
        convert_to(p_idempotency_digest || ':catalog:' || p_lifecycle_action, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    insert into private.audit_events (
      event_type, subject_type, subject_id, idempotency_digest, payload
    ) values (
      'catalog.' || p_lifecycle_action,
      'skill-version',
      report_row.version_id,
      lifecycle_digest,
      jsonb_build_object(
        'reasonCode', p_reason_code,
        'sourceReportId', report_row.public_id,
        'result', jsonb_build_object(
          'versionQuarantined', outcome_quarantined,
          'versionRevoked', outcome_revoked
        )
      )
    );
  else
    outcome_quarantined := null;
    outcome_revoked := null;
  end if;

  update api.skill_reports report
  set state = 'resolved',
    disposition_code = p_disposition_code,
    resolution_reason_code = p_reason_code,
    public_resolution_message = p_public_message,
    resolution_digest = p_idempotency_digest,
    resolved_at = now()
  where report.id = report_row.id
  returning * into report_row;

  insert into private.audit_events (
    event_type, subject_type, subject_id, idempotency_digest, payload
  ) values (
    'report.dispositioned',
    'report',
    report_row.public_id,
    p_idempotency_digest,
    jsonb_build_object(
      'dispositionCode', p_disposition_code,
      'reasonCode', p_reason_code,
      'lifecycleAction', p_lifecycle_action,
      'skillId', report_row.skill_id,
      'versionId', report_row.version_id,
      'result', jsonb_build_object(
        'versionQuarantined', outcome_quarantined,
        'versionRevoked', outcome_revoked
      )
    )
  );

  return query select
    report_row.public_id,
    report_row.state,
    report_row.disposition_code,
    report_row.skill_id,
    report_row.version_id,
    p_lifecycle_action,
    outcome_quarantined,
    outcome_revoked;
end;
$$;

revoke all on function api.disposition_skill_report(text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function api.disposition_skill_report(text, text, text, text, text, text)
  to service_role;

comment on function api.disposition_skill_report(text, text, text, text, text, text) is
  'Service-role-only idempotent report disposition. A confirmed disposition atomically quarantines or revokes the exact reported version and retains the original enforcement outcome for safe replay.';

-- Account creation time is server-owned evidence. Authenticated clients need
-- only the user_id column; created_at must always use the database default.
revoke insert on api.profiles from authenticated;
grant insert (user_id) on api.profiles to authenticated;

-- The original report queue always restarted from the oldest row, making rows
-- beyond the first 50 unreachable during a sustained backlog. Bind the queue
-- to the same exact paired-cursor pattern as the submission operator plane.
revoke all on function api.list_skill_report_queue(integer)
  from public, anon, authenticated, service_role;
drop function api.list_skill_report_queue(integer);

create function api.list_skill_report_queue(
  p_limit integer default 20,
  p_after_created_at timestamptz default null,
  p_after_report_id text default null
)
returns table (
  report_id text,
  skill_id text,
  version_id text,
  category text,
  message text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'report queue authority is required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'report queue limit must be between 1 and 50' using errcode = '22023';
  end if;
  if (p_after_created_at is null) <> (p_after_report_id is null)
    or (p_after_report_id is not null and p_after_report_id !~ '^rpt_[0-9a-f]{32}$') then
    raise exception 'report queue cursor is invalid' using errcode = '22023';
  end if;

  return query
  select report.public_id, report.skill_id, report.version_id,
    report.category, report.message, report.created_at
  from api.skill_reports report
  where report.state = 'queued'
    and (
      p_after_created_at is null
      or (report.created_at, report.public_id) > (p_after_created_at, p_after_report_id)
    )
  order by report.created_at, report.public_id
  limit p_limit;
end;
$$;

revoke all on function api.list_skill_report_queue(integer, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function api.list_skill_report_queue(integer, timestamptz, text)
  to service_role;

comment on function api.list_skill_report_queue(integer, timestamptz, text) is
  'Service-role-only bounded queued-report listing, oldest first after an exact paired cursor, without reporter or internal identifiers.';

-- Lifecycle idempotency must return the outcome retained by the original
-- operation. Returning today's mutable catalog state makes a quarantine retry
-- appear unsuccessful after a later reviewed restore. New receipts retain the
-- complete result; pre-existing legacy receipts fail closed because they do
-- not contain enough evidence to reconstruct the historical outcome.
create or replace function api.control_catalog_lifecycle(
  p_skill_id text,
  p_version_id text,
  p_action text,
  p_reason_code text,
  p_idempotency_digest text
)
returns table (
  skill_id text,
  version_id text,
  skill_lifecycle_state text,
  skill_revoked boolean,
  version_quarantined boolean,
  version_revoked boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  skill_row private.skills%rowtype;
  version_row private.skill_versions%rowtype;
  prior_event private.audit_events%rowtype;
  subject_type_value text;
  subject_id_value text;
  outcome_skill_state text;
  outcome_skill_revoked boolean;
  outcome_version_quarantined boolean;
  outcome_version_revoked boolean;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'catalog lifecycle authority is required' using errcode = '42501';
  end if;
  if p_skill_id is null or p_skill_id !~ '^skl_[0-9a-f]{32}$'
    or p_action not in ('deprecate-skill', 'revoke-skill', 'restore-skill',
      'quarantine-version', 'revoke-version', 'restore-version')
    or p_reason_code is null or length(p_reason_code) not between 1 and 64
      or p_reason_code !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_idempotency_digest is null or p_idempotency_digest !~ '^sha256:[0-9a-f]{64}$'
    or (p_action like '%-skill' and p_version_id is not null)
    or (p_action like '%-version'
      and (p_version_id is null or p_version_id !~ '^skv_[0-9a-f]{32}$')) then
    raise exception 'catalog lifecycle request is invalid' using errcode = '22023';
  end if;

  select * into skill_row
  from private.skills skill
  where skill.public_id = p_skill_id
  for update;
  if skill_row.id is null then
    raise exception 'skill was not found' using errcode = 'P0002';
  end if;

  if p_version_id is not null then
    select * into version_row
    from private.skill_versions version
    where version.public_id = p_version_id
      and version.skill_id = skill_row.id
    for update;
    if version_row.id is null then
      raise exception 'version does not belong to the exact skill' using errcode = '23514';
    end if;
  end if;

  subject_type_value := case when p_version_id is null then 'skill' else 'skill-version' end;
  subject_id_value := coalesce(p_version_id, p_skill_id);
  select * into prior_event
  from private.audit_events event
  where event.idempotency_digest = p_idempotency_digest;
  if prior_event.id is not null then
    if prior_event.subject_type <> subject_type_value
      or prior_event.subject_id <> subject_id_value
      or prior_event.event_type <> 'catalog.' || p_action
      or prior_event.payload ->> 'reasonCode' is distinct from p_reason_code then
      raise exception 'lifecycle idempotency digest conflicts with another event' using errcode = '23505';
    end if;
    if coalesce(jsonb_typeof(prior_event.payload -> 'result'), 'missing') <> 'object'
      or coalesce(prior_event.payload #>> '{result,skillLifecycleState}', '')
        not in ('published', 'deprecated')
      or coalesce(jsonb_typeof(prior_event.payload #> '{result,skillRevoked}'), 'missing') <> 'boolean'
      or coalesce(jsonb_typeof(prior_event.payload #> '{result,versionQuarantined}'), 'missing') <> 'boolean'
      or coalesce(jsonb_typeof(prior_event.payload #> '{result,versionRevoked}'), 'missing') <> 'boolean' then
      raise exception 'legacy lifecycle receipt is incomplete; reviewed reconciliation is required'
        using errcode = '55000';
    end if;
    return query select
      skill_row.public_id,
      p_version_id,
      prior_event.payload #>> '{result,skillLifecycleState}',
      (prior_event.payload #>> '{result,skillRevoked}')::boolean,
      (prior_event.payload #>> '{result,versionQuarantined}')::boolean,
      (prior_event.payload #>> '{result,versionRevoked}')::boolean;
    return;
  end if;

  case p_action
    when 'deprecate-skill' then
      update private.skills
      set lifecycle_state = 'deprecated', updated_at = now()
      where id = skill_row.id
      returning * into skill_row;
    when 'revoke-skill' then
      update private.skills
      set revoked_at = coalesce(revoked_at, now()), updated_at = now()
      where id = skill_row.id
      returning * into skill_row;
    when 'restore-skill' then
      if skill_row.current_version_id is null
        or not private.receipt_backed_version_is_restorable(skill_row.current_version_id) then
        raise exception 'skill restore requires a valid non-restricted receipt-backed current version'
          using errcode = '55000';
      end if;
      update private.skills
      set lifecycle_state = 'published', revoked_at = null, updated_at = now()
      where id = skill_row.id
      returning * into skill_row;
    when 'quarantine-version' then
      update private.skill_versions
      set quarantined_at = coalesce(quarantined_at, now())
      where id = version_row.id
      returning * into version_row;
    when 'revoke-version' then
      update private.skill_versions
      set revoked_at = coalesce(revoked_at, now())
      where id = version_row.id
      returning * into version_row;
    when 'restore-version' then
      if not private.receipt_backed_version_is_restorable(version_row.id) then
        raise exception 'version restore requires valid non-restricted receipt-backed evidence'
          using errcode = '55000';
      end if;
      update private.skill_versions
      set quarantined_at = null, revoked_at = null
      where id = version_row.id
      returning * into version_row;
  end case;

  outcome_skill_state := skill_row.lifecycle_state;
  outcome_skill_revoked := skill_row.revoked_at is not null;
  outcome_version_quarantined := version_row.quarantined_at is not null;
  outcome_version_revoked := version_row.revoked_at is not null;
  insert into private.audit_events (
    event_type, subject_type, subject_id, idempotency_digest, payload
  ) values (
    'catalog.' || p_action,
    subject_type_value,
    subject_id_value,
    p_idempotency_digest,
    jsonb_build_object(
      'reasonCode', p_reason_code,
      'result', jsonb_build_object(
        'skillLifecycleState', outcome_skill_state,
        'skillRevoked', outcome_skill_revoked,
        'versionQuarantined', outcome_version_quarantined,
        'versionRevoked', outcome_version_revoked
      )
    )
  );
  return query select
    skill_row.public_id,
    p_version_id,
    outcome_skill_state,
    outcome_skill_revoked,
    outcome_version_quarantined,
    outcome_version_revoked;
end;
$$;

comment on function api.control_catalog_lifecycle(text, text, text, text, text) is
  'Service-role-only exact catalog lifecycle control with receipt-backed restoration and retained historical outcomes for idempotent replay.';

commit;
