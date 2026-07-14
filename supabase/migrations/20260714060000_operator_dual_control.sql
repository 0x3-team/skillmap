begin;

-- Consequential operator mutations previously trusted one shared service-role
-- credential. Keep that credential as the transport boundary, but require a
-- second, independently held application credential for a named approver or
-- executor. Only high-entropy credential digests are retained.
create table private.operator_principals (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('opr_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^opr_[0-9a-f]{32}$'),
  handle text not null unique check (
    handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(handle) between 2 and 64
  ),
  authority_role text not null check (authority_role in ('approver', 'executor')),
  credential_digest text not null unique
    check (credential_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= created_at)
);

create table private.operator_action_approvals (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('opa_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^opa_[0-9a-f]{32}$'),
  action_kind text not null check (action_kind in (
    'submission.publisher-authorization',
    'submission.collision-review',
    'submission.publish',
    'catalog.lifecycle',
    'report.disposition'
  )),
  subject_type text not null check (subject_type in ('submission', 'skill', 'skill-version', 'report')),
  subject_id text not null check (length(subject_id) between 1 and 128),
  action_payload jsonb not null check (
    jsonb_typeof(action_payload) = 'object'
    and pg_column_size(action_payload) <= 131072
    and action_payload::text !~ 'smo_v1_[0-9a-f]{64}'
  ),
  action_digest text not null unique check (action_digest ~ '^sha256:[0-9a-f]{64}$'),
  operation_id uuid not null unique,
  approver_operator_id uuid not null references private.operator_principals(id) on delete restrict,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);

create table private.operator_action_executions (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('opx_' || replace(gen_random_uuid()::text, '-', ''))
    check (public_id ~ '^opx_[0-9a-f]{32}$'),
  approval_id uuid not null unique references private.operator_action_approvals(id) on delete restrict,
  executor_operator_id uuid not null references private.operator_principals(id) on delete restrict,
  action_digest text not null unique check (action_digest ~ '^sha256:[0-9a-f]{64}$'),
  executed_at timestamptz not null default clock_timestamp()
);

alter table private.operator_principals enable row level security;
alter table private.operator_principals force row level security;
alter table private.operator_action_approvals enable row level security;
alter table private.operator_action_approvals force row level security;
alter table private.operator_action_executions enable row level security;
alter table private.operator_action_executions force row level security;

create function private.enforce_operator_principal_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.public_id is distinct from old.public_id
    or new.handle is distinct from old.handle
    or new.authority_role is distinct from old.authority_role
    or new.credential_digest is distinct from old.credential_digest
    or new.created_at is distinct from old.created_at
    or old.revoked_at is not null
    or new.revoked_at is null
    or new.revoked_at < old.created_at then
    raise exception 'operator principal identity is immutable; only one-way revocation is allowed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger operator_principals_bounded_update
before update on private.operator_principals
for each row execute function private.enforce_operator_principal_update();

create trigger operator_principals_no_delete
before delete on private.operator_principals
for each row execute function private.reject_append_only_mutation();

create trigger operator_action_approvals_append_only
before update or delete on private.operator_action_approvals
for each row execute function private.reject_append_only_mutation();

create trigger operator_action_executions_append_only
before update or delete on private.operator_action_executions
for each row execute function private.reject_append_only_mutation();

create index operator_action_approvals_subject_idx
  on private.operator_action_approvals(subject_type, subject_id, created_at desc);
create index operator_action_approvals_approver_idx
  on private.operator_action_approvals(approver_operator_id, created_at desc);
create index operator_action_executions_executor_idx
  on private.operator_action_executions(executor_operator_id, executed_at desc);

alter table private.audit_events
  add column operator_approval_id uuid references private.operator_action_approvals(id) on delete restrict,
  add column approver_operator_id uuid references private.operator_principals(id) on delete restrict,
  add column executor_operator_id uuid references private.operator_principals(id) on delete restrict,
  add column operator_attribution_required boolean not null default false,
  drop constraint audit_events_subject_type_check,
  add constraint audit_events_subject_type_check check (
    subject_type in ('publisher', 'repository', 'skill', 'skill-version', 'account', 'report', 'submission')
  ),
  add constraint audit_events_operator_attribution_check check (
    (operator_approval_id is null and approver_operator_id is null and executor_operator_id is null)
    or
    (operator_approval_id is not null and approver_operator_id is not null and executor_operator_id is not null)
  ),
  add constraint audit_events_protected_attribution_check check (
    not operator_attribution_required
    or event_type not in (
      'publisher.authorization-authorized', 'publisher.authorization-revoked',
      'submission.collision-reviewed', 'submission.published',
      'report.dispositioned',
      'catalog.deprecate-skill', 'catalog.revoke-skill', 'catalog.restore-skill',
      'catalog.quarantine-version', 'catalog.revoke-version', 'catalog.restore-version'
    )
    or (operator_approval_id is not null
      and approver_operator_id is not null
      and executor_operator_id is not null)
  );

alter table private.audit_events
  alter column operator_attribution_required set default true;

create index audit_events_operator_approval_idx
  on private.audit_events(operator_approval_id, created_at desc);
create index audit_events_approver_idx
  on private.audit_events(approver_operator_id, created_at desc);
create index audit_events_executor_idx
  on private.audit_events(executor_operator_id, created_at desc);

create function private.operator_request_header(header_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw_headers text;
  headers jsonb;
begin
  if header_name is null or header_name !~ '^x-skillmap-[a-z-]+$' then
    return null;
  end if;
  raw_headers := current_setting('request.headers', true);
  if raw_headers is null or raw_headers = '' then return null; end if;
  begin
    headers := raw_headers::jsonb;
  exception when others then
    return null;
  end;
  if jsonb_typeof(headers) <> 'object' then return null; end if;
  return headers ->> lower(header_name);
end;
$$;

create function private.require_operator_principal(required_role text)
returns private.operator_principals
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_credential text;
  digest_value text;
  principal private.operator_principals%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service operator authority is required' using errcode = '42501';
  end if;
  if required_role not in ('approver', 'executor') then
    raise exception 'operator authority role is invalid' using errcode = '22023';
  end if;
  raw_credential := private.operator_request_header('x-skillmap-operator-credential');
  if raw_credential is null
    or raw_credential !~ '^smo_v1_[0-9a-f]{64}$' then
    raise exception 'operator credential is invalid' using errcode = '42501';
  end if;
  digest_value := 'sha256:' || encode(
    extensions.digest(convert_to(raw_credential, 'UTF8'), 'sha256'), 'hex'
  );
  select * into principal
  from private.operator_principals candidate
  where candidate.credential_digest = digest_value;
  if principal.id is null or principal.revoked_at is not null
    or principal.authority_role <> required_role then
    raise exception 'operator credential is invalid' using errcode = '42501';
  end if;
  return principal;
end;
$$;

create function private.operator_action_subject_is_valid(
  action_kind text,
  subject_type text,
  subject_id text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case action_kind
    when 'submission.publisher-authorization' then
      subject_type = 'submission' and subject_id ~ '^sub_[0-9a-f]{32}$'
    when 'submission.collision-review' then
      subject_type = 'submission' and subject_id ~ '^sub_[0-9a-f]{32}$'
    when 'submission.publish' then
      subject_type = 'submission' and subject_id ~ '^sub_[0-9a-f]{32}$'
    when 'catalog.lifecycle' then
      (subject_type = 'skill' and subject_id ~ '^skl_[0-9a-f]{32}$')
      or (subject_type = 'skill-version' and subject_id ~ '^skv_[0-9a-f]{32}$')
    when 'report.disposition' then
      subject_type = 'report' and subject_id ~ '^rpt_[0-9a-f]{32}$'
    else false
  end;
$$;

create function api.approve_operator_action(
  p_action_kind text,
  p_subject_type text,
  p_subject_id text,
  p_action_payload jsonb,
  p_action_digest text,
  p_operation_id uuid
)
returns table (
  approval_id text,
  action_digest text,
  approver_id text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approver private.operator_principals%rowtype;
  prior private.operator_action_approvals%rowtype;
  approved_at_value timestamptz := clock_timestamp();
begin
  approver := private.require_operator_principal('approver');
  if p_action_kind not in (
      'submission.publisher-authorization', 'submission.collision-review',
      'submission.publish', 'catalog.lifecycle', 'report.disposition'
    )
    or not private.operator_action_subject_is_valid(p_action_kind, p_subject_type, p_subject_id)
    or p_action_payload is null or jsonb_typeof(p_action_payload) <> 'object'
    or pg_column_size(p_action_payload) > 131072
    or p_action_payload::text ~ 'smo_v1_[0-9a-f]{64}'
    or p_action_digest is null or p_action_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_operation_id is null then
    raise exception 'operator approval request is invalid' using errcode = '22023';
  end if;

  -- Serialize both replay identities in a fixed order. Concurrent exact
  -- approval retries then observe and return the first immutable row instead
  -- of surfacing a provider-specific unique-constraint race.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 7461));
  perform pg_advisory_xact_lock(hashtextextended(p_action_digest, 7462));

  select * into prior
  from private.operator_action_approvals approval
  where approval.action_digest = p_action_digest
     or approval.operation_id = p_operation_id
  order by case when approval.action_digest = p_action_digest then 0 else 1 end
  limit 1
  for update;
  if prior.id is not null then
    if prior.action_kind is distinct from p_action_kind
      or prior.subject_type is distinct from p_subject_type
      or prior.subject_id is distinct from p_subject_id
      or prior.action_payload is distinct from p_action_payload
      or prior.action_digest is distinct from p_action_digest
      or prior.operation_id is distinct from p_operation_id
      or prior.approver_operator_id is distinct from approver.id then
      raise exception 'operator approval operation conflicts with retained evidence'
        using errcode = '23505';
    end if;
    if prior.expires_at <= clock_timestamp() then
      raise exception 'operator approval is expired; use a new operation identifier'
        using errcode = '55000';
    end if;
    return query select prior.public_id, prior.action_digest, approver.public_id, prior.expires_at;
    return;
  end if;

  insert into private.operator_action_approvals (
    action_kind, subject_type, subject_id, action_payload, action_digest,
    operation_id, approver_operator_id, created_at, expires_at
  ) values (
    p_action_kind, p_subject_type, p_subject_id, p_action_payload, p_action_digest,
    p_operation_id, approver.id, approved_at_value, approved_at_value + interval '30 minutes'
  ) returning public_id, operator_action_approvals.action_digest,
    approved_at_value + interval '30 minutes'
  into approval_id, action_digest, expires_at;
  approver_id := approver.public_id;
  return next;
end;
$$;

create function private.begin_operator_execution(
  expected_action_kind text,
  expected_subject_type text,
  expected_subject_id text,
  expected_action_payload jsonb,
  expected_action_digest text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  executor private.operator_principals%rowtype;
  approval private.operator_action_approvals%rowtype;
  execution private.operator_action_executions%rowtype;
  approval_public_id text;
begin
  executor := private.require_operator_principal('executor');
  approval_public_id := private.operator_request_header('x-skillmap-operator-approval');
  if approval_public_id is null or approval_public_id !~ '^opa_[0-9a-f]{32}$' then
    raise exception 'operator approval is required' using errcode = '42501';
  end if;
  select * into approval
  from private.operator_action_approvals candidate
  where candidate.public_id = approval_public_id
  for update;
  if approval.id is null then
    raise exception 'operator approval is invalid' using errcode = '42501';
  end if;
  if approval.action_kind is distinct from expected_action_kind
    or approval.subject_type is distinct from expected_subject_type
    or approval.subject_id is distinct from expected_subject_id
    or approval.action_payload is distinct from expected_action_payload
    or approval.action_digest is distinct from expected_action_digest then
    raise exception 'operator approval does not match the exact action envelope'
      using errcode = '23514';
  end if;
  if approval.approver_operator_id = executor.id then
    raise exception 'operator approver and executor must be distinct'
      using errcode = '42501';
  end if;

  select * into execution
  from private.operator_action_executions retained
  where retained.approval_id = approval.id;
  if execution.id is not null and (
      execution.executor_operator_id is distinct from executor.id
      or execution.action_digest is distinct from expected_action_digest
    ) then
    raise exception 'operator approval was executed by another authority'
      using errcode = '23505';
  end if;
  if execution.id is null and approval.expires_at <= clock_timestamp() then
    raise exception 'operator approval is expired' using errcode = '55000';
  end if;

  perform set_config('skillmap.operator_approval_id', approval.id::text, true);
  perform set_config('skillmap.operator_approver_id', approval.approver_operator_id::text, true);
  perform set_config('skillmap.operator_executor_id', executor.id::text, true);
  return approval.id;
end;
$$;

create function private.complete_operator_execution(
  approval_id_value uuid,
  expected_action_digest text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  executor_id_value uuid;
  retained private.operator_action_executions%rowtype;
begin
  if approval_id_value is null then return; end if;
  executor_id_value := nullif(current_setting('skillmap.operator_executor_id', true), '')::uuid;
  if executor_id_value is null then
    raise exception 'operator execution context is missing' using errcode = '55000';
  end if;
  select * into retained
  from private.operator_action_executions execution
  where execution.approval_id = approval_id_value;
  if retained.id is not null then
    if retained.executor_operator_id is distinct from executor_id_value
      or retained.action_digest is distinct from expected_action_digest then
      raise exception 'operator execution receipt conflicts with retained evidence'
        using errcode = '23505';
    end if;
    perform set_config('skillmap.operator_approval_id', '', true);
    perform set_config('skillmap.operator_approver_id', '', true);
    perform set_config('skillmap.operator_executor_id', '', true);
    return;
  end if;
  insert into private.operator_action_executions (
    approval_id, executor_operator_id, action_digest
  ) values (
    approval_id_value, executor_id_value, expected_action_digest
  );
  perform set_config('skillmap.operator_approval_id', '', true);
  perform set_config('skillmap.operator_approver_id', '', true);
  perform set_config('skillmap.operator_executor_id', '', true);
end;
$$;

create function private.bind_operator_audit_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_id_value uuid := nullif(current_setting('skillmap.operator_approval_id', true), '')::uuid;
  approver_id_value uuid := nullif(current_setting('skillmap.operator_approver_id', true), '')::uuid;
  executor_id_value uuid := nullif(current_setting('skillmap.operator_executor_id', true), '')::uuid;
begin
  if approval_id_value is null and approver_id_value is null and executor_id_value is null then
    return new;
  end if;
  if approval_id_value is null or approver_id_value is null or executor_id_value is null then
    raise exception 'operator audit attribution context is incomplete' using errcode = '55000';
  end if;
  if new.operator_approval_id is not null and new.operator_approval_id <> approval_id_value
    or new.approver_operator_id is not null and new.approver_operator_id <> approver_id_value
    or new.executor_operator_id is not null and new.executor_operator_id <> executor_id_value then
    raise exception 'operator audit attribution cannot be overridden' using errcode = '42501';
  end if;
  new.operator_approval_id := approval_id_value;
  new.approver_operator_id := approver_id_value;
  new.executor_operator_id := executor_id_value;
  new.operator_attribution_required := true;
  return new;
end;
$$;

create trigger audit_events_bind_operator_attribution
before insert on private.audit_events
for each row execute function private.bind_operator_audit_attribution();

-- Relocate the old service-role-only bodies out of the exposed schema before
-- recreating the same API signatures as mandatory dual-control wrappers.
revoke all on function api.record_skill_submission_publisher_authorization(
  text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
alter function api.record_skill_submission_publisher_authorization(
  text, text, text, text, text, text, timestamptz, text
) set schema private;
alter function private.record_skill_submission_publisher_authorization(
  text, text, text, text, text, text, timestamptz, text
) rename to record_skill_submission_publisher_authorization_unchecked;

revoke all on function api.review_skill_submission_collisions(
  text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
alter function api.review_skill_submission_collisions(
  text, text, text, text, text, text, text
) set schema private;
alter function private.review_skill_submission_collisions(
  text, text, text, text, text, text, text
) rename to review_skill_submission_collisions_unchecked;

revoke all on function api.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) from public, anon, authenticated, service_role;
alter function api.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) set schema private;
alter function private.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) rename to publish_skill_submission_unchecked;

revoke all on function api.disposition_skill_report(
  text, text, text, text, text, text
) from public, anon, authenticated, service_role;
alter function api.disposition_skill_report(
  text, text, text, text, text, text
) set schema private;
alter function private.disposition_skill_report(
  text, text, text, text, text, text
) rename to disposition_skill_report_unchecked;

revoke all on function api.control_catalog_lifecycle(
  text, text, text, text, text
) from public, anon, authenticated, service_role;
alter function api.control_catalog_lifecycle(
  text, text, text, text, text
) set schema private;
alter function private.control_catalog_lifecycle(
  text, text, text, text, text
) rename to control_catalog_lifecycle_unchecked;

create function private.append_operator_audit_event(
  event_type_value text,
  subject_type_value text,
  subject_id_value text,
  idempotency_digest_value text,
  payload_value jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  retained private.audit_events%rowtype;
begin
  select * into retained
  from private.audit_events event
  where event.idempotency_digest = idempotency_digest_value;
  if retained.id is null then
    insert into private.audit_events (
      event_type, subject_type, subject_id, idempotency_digest, payload
    ) values (
      event_type_value, subject_type_value, subject_id_value,
      idempotency_digest_value, payload_value
    );
    return;
  end if;
  if retained.event_type is distinct from event_type_value
    or retained.subject_type is distinct from subject_type_value
    or retained.subject_id is distinct from subject_id_value
    or retained.payload is distinct from payload_value then
    raise exception 'operator audit digest conflicts with retained evidence'
      using errcode = '23505';
  end if;
end;
$$;

create function api.record_skill_submission_publisher_authorization(
  p_submission_id text,
  p_publisher_handle text,
  p_decision text,
  p_authorization_basis text,
  p_evidence_reference text,
  p_evidence_digest text,
  p_expires_at timestamptz,
  p_idempotency_digest text
)
returns table (
  authorization_receipt_id text,
  authorization_decision text,
  authorization_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_id_value uuid;
  action_payload_value jsonb;
  receipt_id_value text;
  decision_value text;
  expires_at_value timestamptz;
begin
  action_payload_value := jsonb_build_object(
    'schemaVersion', 1,
    'submissionId', p_submission_id,
    'publisherHandle', p_publisher_handle,
    'decision', p_decision,
    'authorizationBasis', p_authorization_basis,
    'evidenceReference', p_evidence_reference,
    'evidenceDigest', p_evidence_digest,
    'expiresAt', case when p_expires_at is null then null else
      to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
  );
  approval_id_value := private.begin_operator_execution(
    'submission.publisher-authorization', 'submission', p_submission_id,
    action_payload_value, p_idempotency_digest
  );
  select * into receipt_id_value, decision_value, expires_at_value
  from private.record_skill_submission_publisher_authorization_unchecked(
    p_submission_id, p_publisher_handle, p_decision, p_authorization_basis,
    p_evidence_reference, p_evidence_digest, p_expires_at, p_idempotency_digest
  );
  perform private.append_operator_audit_event(
    'publisher.authorization-' || p_decision,
    'submission', p_submission_id, p_idempotency_digest,
    jsonb_build_object(
      'publisherHandle', p_publisher_handle,
      'decision', p_decision,
      'authorizationReceiptId', receipt_id_value,
      'evidenceReference', p_evidence_reference,
      'evidenceDigest', p_evidence_digest,
      'expiresAt', case when expires_at_value is null then null else
        to_char(expires_at_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    )
  );
  perform private.complete_operator_execution(approval_id_value, p_idempotency_digest);
  return query select receipt_id_value, decision_value, expires_at_value;
end;
$$;

create function api.review_skill_submission_collisions(
  p_submission_id text,
  p_disposition text,
  p_reason_code text,
  p_target_publisher_id text,
  p_target_skill_id text,
  p_target_version_id text,
  p_idempotency_digest text
)
returns table (
  collision_review_id text,
  review_subject_digest text,
  disposition text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_id_value uuid;
  action_payload_value jsonb;
  review_id_value text;
  subject_digest_value text;
  disposition_value text;
begin
  action_payload_value := jsonb_build_object(
    'schemaVersion', 1,
    'submissionId', p_submission_id,
    'disposition', p_disposition,
    'reasonCode', p_reason_code,
    'targetPublisherId', p_target_publisher_id,
    'targetSkillId', p_target_skill_id,
    'targetVersionId', p_target_version_id
  );
  approval_id_value := private.begin_operator_execution(
    'submission.collision-review', 'submission', p_submission_id,
    action_payload_value, p_idempotency_digest
  );
  select * into review_id_value, subject_digest_value, disposition_value
  from private.review_skill_submission_collisions_unchecked(
    p_submission_id, p_disposition, p_reason_code, p_target_publisher_id,
    p_target_skill_id, p_target_version_id, p_idempotency_digest
  );
  perform private.append_operator_audit_event(
    'submission.collision-reviewed',
    'submission', p_submission_id, p_idempotency_digest,
    jsonb_build_object(
      'collisionReviewId', review_id_value,
      'reviewSubjectDigest', subject_digest_value,
      'disposition', disposition_value,
      'reasonCode', p_reason_code,
      'targetPublisherId', p_target_publisher_id,
      'targetSkillId', p_target_skill_id,
      'targetVersionId', p_target_version_id
    )
  );
  perform private.complete_operator_execution(approval_id_value, p_idempotency_digest);
  return query select review_id_value, subject_digest_value, disposition_value;
end;
$$;

create function api.publish_skill_submission(
  p_submission_id text,
  p_publication_digest text,
  p_publisher_handle text,
  p_publisher_display_name text,
  p_skill_slug text,
  p_skill_display_name text,
  p_summary text,
  p_description text,
  p_capabilities text[],
  p_license_state text,
  p_spdx_expression text,
  p_permission_scripts boolean,
  p_permission_network text[],
  p_permission_tools text[]
)
returns table (
  submission_id text,
  publisher_id text,
  skill_id text,
  version_id text,
  submission_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_id_value uuid;
  action_payload_value jsonb;
  result_submission_id text;
  result_publisher_id text;
  result_skill_id text;
  result_version_id text;
  result_submission_state text;
begin
  action_payload_value := jsonb_build_object(
    'schemaVersion', 1,
    'submissionId', p_submission_id,
    'publisherHandle', p_publisher_handle,
    'publisherDisplayName', p_publisher_display_name,
    'skillSlug', p_skill_slug,
    'skillDisplayName', p_skill_display_name,
    'summary', p_summary,
    'description', p_description,
    'capabilities', to_jsonb(p_capabilities),
    'licenseState', p_license_state,
    'spdxExpression', p_spdx_expression,
    'permissionScripts', p_permission_scripts,
    'permissionNetwork', to_jsonb(p_permission_network),
    'permissionTools', to_jsonb(p_permission_tools)
  );
  approval_id_value := private.begin_operator_execution(
    'submission.publish', 'submission', p_submission_id,
    action_payload_value, p_publication_digest
  );
  select * into result_submission_id, result_publisher_id, result_skill_id,
    result_version_id, result_submission_state
  from private.publish_skill_submission_unchecked(
    p_submission_id, p_publication_digest, p_publisher_handle,
    p_publisher_display_name, p_skill_slug, p_skill_display_name, p_summary,
    p_description, p_capabilities, p_license_state, p_spdx_expression,
    p_permission_scripts, p_permission_network, p_permission_tools
  );
  perform private.append_operator_audit_event(
    'submission.published',
    'submission', p_submission_id, p_publication_digest,
    jsonb_build_object(
      'publisherId', result_publisher_id,
      'skillId', result_skill_id,
      'versionId', result_version_id,
      'submissionState', result_submission_state
    )
  );
  perform private.complete_operator_execution(approval_id_value, p_publication_digest);
  return query select result_submission_id, result_publisher_id, result_skill_id,
    result_version_id, result_submission_state;
end;
$$;

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
  approval_id_value uuid;
  action_payload_value jsonb;
  result_report_id text;
  result_report_state text;
  result_disposition_code text;
  result_skill_id text;
  result_version_id text;
  result_lifecycle_action text;
  result_version_quarantined boolean;
  result_version_revoked boolean;
begin
  action_payload_value := jsonb_build_object(
    'schemaVersion', 1,
    'reportId', p_report_id,
    'dispositionCode', p_disposition_code,
    'reasonCode', p_reason_code,
    'publicMessage', p_public_message,
    'lifecycleAction', p_lifecycle_action
  );
  approval_id_value := private.begin_operator_execution(
    'report.disposition', 'report', p_report_id,
    action_payload_value, p_idempotency_digest
  );
  select * into result_report_id, result_report_state, result_disposition_code,
    result_skill_id, result_version_id, result_lifecycle_action,
    result_version_quarantined, result_version_revoked
  from private.disposition_skill_report_unchecked(
    p_report_id, p_disposition_code, p_reason_code, p_public_message,
    p_lifecycle_action, p_idempotency_digest
  );
  perform private.complete_operator_execution(approval_id_value, p_idempotency_digest);
  return query select result_report_id, result_report_state, result_disposition_code,
    result_skill_id, result_version_id, result_lifecycle_action,
    result_version_quarantined, result_version_revoked;
end;
$$;

create function api.control_catalog_lifecycle(
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
  approval_id_value uuid;
  action_payload_value jsonb;
  subject_type_value text := case when p_version_id is null then 'skill' else 'skill-version' end;
  subject_id_value text := coalesce(p_version_id, p_skill_id);
  result_skill_id text;
  result_version_id text;
  result_skill_lifecycle_state text;
  result_skill_revoked boolean;
  result_version_quarantined boolean;
  result_version_revoked boolean;
begin
  action_payload_value := jsonb_build_object(
    'schemaVersion', 1,
    'skillId', p_skill_id,
    'versionId', p_version_id,
    'action', p_action,
    'reasonCode', p_reason_code
  );
  approval_id_value := private.begin_operator_execution(
    'catalog.lifecycle', subject_type_value, subject_id_value,
    action_payload_value, p_idempotency_digest
  );
  select * into result_skill_id, result_version_id, result_skill_lifecycle_state,
    result_skill_revoked, result_version_quarantined, result_version_revoked
  from private.control_catalog_lifecycle_unchecked(
    p_skill_id, p_version_id, p_action, p_reason_code, p_idempotency_digest
  );
  perform private.complete_operator_execution(approval_id_value, p_idempotency_digest);
  return query select result_skill_id, result_version_id,
    result_skill_lifecycle_state, result_skill_revoked,
    result_version_quarantined, result_version_revoked;
end;
$$;

revoke all on table private.operator_principals
  from public, anon, authenticated, service_role;
revoke all on table private.operator_action_approvals
  from public, anon, authenticated, service_role;
revoke all on table private.operator_action_executions
  from public, anon, authenticated, service_role;
revoke all on function private.operator_request_header(text)
  from public, anon, authenticated, service_role;
revoke all on function private.require_operator_principal(text)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_operator_principal_update()
  from public, anon, authenticated, service_role;
revoke all on function private.operator_action_subject_is_valid(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.begin_operator_execution(text, text, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_operator_execution(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.bind_operator_audit_attribution()
  from public, anon, authenticated, service_role;
revoke all on function private.append_operator_audit_event(text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.record_skill_submission_publisher_authorization_unchecked(
  text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function private.review_skill_submission_collisions_unchecked(
  text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.publish_skill_submission_unchecked(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) from public, anon, authenticated, service_role;
revoke all on function private.disposition_skill_report_unchecked(
  text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.control_catalog_lifecycle_unchecked(
  text, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function api.approve_operator_action(text, text, text, jsonb, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function api.record_skill_submission_publisher_authorization(
  text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function api.review_skill_submission_collisions(
  text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function api.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) from public, anon, authenticated, service_role;
revoke all on function api.disposition_skill_report(text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function api.control_catalog_lifecycle(text, text, text, text, text)
  from public, anon, authenticated, service_role;

grant execute on function api.approve_operator_action(text, text, text, jsonb, text, uuid)
  to service_role;
grant execute on function api.record_skill_submission_publisher_authorization(
  text, text, text, text, text, text, timestamptz, text
) to service_role;
grant execute on function api.review_skill_submission_collisions(
  text, text, text, text, text, text, text
) to service_role;
grant execute on function api.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) to service_role;
grant execute on function api.disposition_skill_report(text, text, text, text, text, text)
  to service_role;
grant execute on function api.control_catalog_lifecycle(text, text, text, text, text)
  to service_role;

comment on table private.operator_principals is
  'Deployment-provisioned operator identities. Stores only high-entropy credential digests; raw credentials are never persisted.';
comment on table private.operator_action_approvals is
  'Immutable, short-lived, exact-envelope approvals for consequential operator actions.';
comment on table private.operator_action_executions is
  'Immutable one-per-approval execution receipts binding a distinct executor and action digest.';
comment on function api.approve_operator_action(text, text, text, jsonb, text, uuid) is
  'Service-role plus independently held approver credential. Creates or replays one exact short-lived operator approval.';

commit;
