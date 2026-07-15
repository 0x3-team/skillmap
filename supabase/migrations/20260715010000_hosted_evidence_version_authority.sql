begin;

-- Evidence authority is a release invariant, not a caller-selected label. Keep
-- the tuple migration-owned so a service-role credential cannot widen it.
create function private.supported_submission_evidence_authority(
  claim_worker_version text,
  audit_policy_version text,
  audit_host_profile_version text,
  audit_worker_version text,
  grade_rubric_version text,
  grade_host_profile_version text,
  grade_evaluator_version text,
  worker_run_version text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select row(
    claim_worker_version,
    audit_policy_version,
    audit_host_profile_version,
    audit_worker_version,
    grade_rubric_version,
    grade_host_profile_version,
    grade_evaluator_version,
    worker_run_version
  ) is not distinct from row(
    'skillmap-worker/0.2.0'::text,
    'skillmap-static-audit/v2'::text,
    'codex-host/v1'::text,
    'skillmap-worker/0.2.0'::text,
    'skillmap-rubric/v1'::text,
    'codex-host/v1'::text,
    'skillmap-grader/0.1.0'::text,
    'skillmap-worker/0.2.0'::text
  );
$$;

revoke all on function private.supported_submission_evidence_authority(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

-- NOT VALID avoids silently blessing historical terminal evidence while still
-- enforcing the exact authority tuple for every new insert or changed row.
-- Add these constraints before the preflight in the same transaction: their
-- table locks close the race where a stale completion could otherwise commit
-- between the preflight query and new-row enforcement.
alter table api.skill_submissions
  add constraint skill_submissions_current_worker_authority_check check (
    current_worker_version is null
    or current_worker_version = 'skillmap-worker/0.2.0'
  ) not valid;

alter table private.skill_audit_receipts
  add constraint skill_audit_receipts_current_authority_check check (
    policy_version = 'skillmap-static-audit/v2'
    and host_profile_version = 'codex-host/v1'
    and worker_version = 'skillmap-worker/0.2.0'
  ) not valid;

alter table private.skill_grade_receipts
  add constraint skill_grade_receipts_current_authority_check check (
    rubric_version = 'skillmap-rubric/v1'
    and host_profile_version = 'codex-host/v1'
    and evaluator_version = 'skillmap-grader/0.1.0'
  ) not valid;

alter table private.worker_runs
  add constraint worker_runs_current_authority_check check (
    worker_version = 'skillmap-worker/0.2.0'
  ) not valid;

-- A remote environment with already accepted or published stale evidence must
-- stop here for explicit re-audit/re-grade. Never grandfather or relabel it.
do $$
begin
  if exists (
    select 1 from api.skill_submissions submission
    where submission.state = 'processing'
      and submission.current_worker_version is distinct from 'skillmap-worker/0.2.0'
  ) then
    raise exception 'processing submissions owned by an unsupported worker must be explicitly drained or requeued before migration'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from api.skill_submissions submission
    left join private.skill_audit_receipts audit_receipt
      on audit_receipt.id = submission.audit_receipt_id
      and audit_receipt.submission_id = submission.id
    left join private.skill_grade_receipts grade_receipt
      on grade_receipt.id = submission.grade_receipt_id
      and grade_receipt.submission_id = submission.id
      and grade_receipt.audit_receipt_id = audit_receipt.id
    left join private.worker_runs worker_run
      on worker_run.id = submission.last_worker_run_id
      and worker_run.submission_id = submission.id
    where submission.state in ('accepted', 'published')
      and private.supported_submission_evidence_authority(
        submission.current_worker_version,
        audit_receipt.policy_version,
        audit_receipt.host_profile_version,
        audit_receipt.worker_version,
        grade_receipt.rubric_version,
        grade_receipt.host_profile_version,
        grade_receipt.evaluator_version,
        worker_run.worker_version
      ) is not true
  ) then
    raise exception 'accepted or published submissions require explicit re-audit with the current evidence authority'
      using errcode = '55000';
  end if;
end;
$$;

-- Preserve the mature structural validators behind exact-version wrappers.
-- The literal table constraints and outer completion wrapper remain independent
-- protection for any session that cached an old function plan before migration.
alter function private.valid_submission_audit_receipt(jsonb, text)
  rename to valid_submission_audit_receipt_unversioned;
revoke all on function private.valid_submission_audit_receipt_unversioned(jsonb, text)
  from public, anon, authenticated, service_role;

create function private.valid_submission_audit_receipt(value jsonb, expected_worker text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return private.supported_submission_evidence_authority(
      expected_worker,
      value ->> 'policyVersion',
      value ->> 'hostProfileVersion',
      value ->> 'workerVersion',
      'skillmap-rubric/v1',
      'codex-host/v1',
      'skillmap-grader/0.1.0',
      expected_worker
    )
    and private.valid_submission_audit_receipt_unversioned(value, expected_worker);
exception when others then
  return false;
end;
$$;

revoke all on function private.valid_submission_audit_receipt(jsonb, text)
  from public, anon, authenticated, service_role;

alter function private.valid_submission_grade_receipt(jsonb, jsonb)
  rename to valid_submission_grade_receipt_unversioned;
revoke all on function private.valid_submission_grade_receipt_unversioned(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create function private.valid_submission_grade_receipt(value jsonb, audit_value jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return private.supported_submission_evidence_authority(
      audit_value ->> 'workerVersion',
      audit_value ->> 'policyVersion',
      audit_value ->> 'hostProfileVersion',
      audit_value ->> 'workerVersion',
      value ->> 'rubricVersion',
      value ->> 'hostProfileVersion',
      value ->> 'evaluatorVersion',
      audit_value ->> 'workerVersion'
    )
    and private.valid_submission_grade_receipt_unversioned(value, audit_value);
exception when others then
  return false;
end;
$$;

revoke all on function private.valid_submission_grade_receipt(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Preserve the provider-deferral-aware claim implementation behind a narrow
-- exact-version wrapper. Unsupported workers fail before row selection, lease,
-- attempt, or event mutation.
revoke all on function api.claim_skill_submission(text, text, integer)
  from public, anon, authenticated, service_role;
alter function api.claim_skill_submission(text, text, integer) set schema private;
alter function private.claim_skill_submission(text, text, integer)
  rename to claim_skill_submission_provider_aware_unchecked;
revoke all on function private.claim_skill_submission_provider_aware_unchecked(text, text, integer)
  from public, anon, authenticated, service_role;

create function api.claim_skill_submission(
  p_worker_version text,
  p_submission_id text default null,
  p_lease_seconds integer default 300
)
returns table (
  submission_id text,
  claim_id uuid,
  repository_url text,
  source_commit text,
  source_path text,
  version_label text,
  license_claim text,
  attempt_number integer,
  claim_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker authority is required' using errcode = '42501';
  end if;
  if p_worker_version is distinct from 'skillmap-worker/0.2.0' then
    raise exception 'worker version is unsupported' using errcode = '22023';
  end if;
  return query
  select * from private.claim_skill_submission_provider_aware_unchecked(
    p_worker_version, p_submission_id, p_lease_seconds
  );
end;
$$;

revoke all on function api.claim_skill_submission(text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function api.claim_skill_submission(text, text, integer) to service_role;

-- Validate the complete receipt tuple before the existing transactional body
-- can retain any audit, grade, review, or worker-run evidence. Failed worker
-- completions intentionally carry no receipts and still require the current
-- worker version.
revoke all on function api.complete_skill_submission(
  text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text
) from public, anon, authenticated, service_role;
alter function api.complete_skill_submission(
  text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text
) set schema private;
alter function private.complete_skill_submission(
  text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text
) rename to complete_skill_submission_evidence_unchecked;
revoke all on function private.complete_skill_submission_evidence_unchecked(
  text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text
) from public, anon, authenticated, service_role;

create function api.complete_skill_submission(
  p_submission_id text,
  p_claim_id uuid,
  p_worker_version text,
  p_disposition text,
  p_input_digest text,
  p_result_digest text,
  p_audit_receipt jsonb,
  p_grade_receipt jsonb,
  p_reason_codes text[],
  p_public_message text,
  p_idempotency_digest text
)
returns table (
  submission_id text,
  submission_state text,
  audit_receipt_id text,
  grade_receipt_id text,
  review_case_id text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'worker authority is required' using errcode = '42501';
  end if;
  if p_worker_version is distinct from 'skillmap-worker/0.2.0' then
    raise exception 'worker version is unsupported' using errcode = '22023';
  end if;
  if p_disposition in ('accepted', 'changes-requested', 'rejected')
    and private.supported_submission_evidence_authority(
      p_worker_version,
      p_audit_receipt ->> 'policyVersion',
      p_audit_receipt ->> 'hostProfileVersion',
      p_audit_receipt ->> 'workerVersion',
      p_grade_receipt ->> 'rubricVersion',
      p_grade_receipt ->> 'hostProfileVersion',
      p_grade_receipt ->> 'evaluatorVersion',
      p_worker_version
    ) is not true then
    raise exception 'submission evidence authority is unsupported' using errcode = '22023';
  end if;
  return query
  select * from private.complete_skill_submission_evidence_unchecked(
    p_submission_id, p_claim_id, p_worker_version, p_disposition,
    p_input_digest, p_result_digest, p_audit_receipt, p_grade_receipt,
    p_reason_codes, p_public_message, p_idempotency_digest
  );
end;
$$;

revoke all on function api.complete_skill_submission(
  text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text
) from public, anon, authenticated, service_role;
grant execute on function api.complete_skill_submission(
  text, uuid, text, text, text, text, jsonb, jsonb, text[], text, text
) to service_role;

create function private.assert_current_submission_evidence_authority(p_submission_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  submission_state text;
  authority_supported boolean;
begin
  select submission.state,
    private.supported_submission_evidence_authority(
      submission.current_worker_version,
      audit_receipt.policy_version,
      audit_receipt.host_profile_version,
      audit_receipt.worker_version,
      grade_receipt.rubric_version,
      grade_receipt.host_profile_version,
      grade_receipt.evaluator_version,
      worker_run.worker_version
    )
  into submission_state, authority_supported
  from api.skill_submissions submission
  left join private.skill_audit_receipts audit_receipt
    on audit_receipt.id = submission.audit_receipt_id
    and audit_receipt.submission_id = submission.id
  left join private.skill_grade_receipts grade_receipt
    on grade_receipt.id = submission.grade_receipt_id
    and grade_receipt.submission_id = submission.id
    and grade_receipt.audit_receipt_id = audit_receipt.id
  left join private.worker_runs worker_run
    on worker_run.id = submission.last_worker_run_id
    and worker_run.submission_id = submission.id
  where submission.public_id = p_submission_id;

  -- The existing publication body retains not-found and invalid-state error
  -- semantics. The new invariant applies only once evidence could publish.
  if not found or submission_state not in ('accepted', 'published') then
    return;
  end if;
  if authority_supported is not true then
    raise exception 'submission evidence authority is stale or unsupported'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function private.assert_current_submission_evidence_authority(text)
  from public, anon, authenticated, service_role;

-- Keep the existing exact-payload/distinct-operator dual-control body intact,
-- but put an evidence-authority guard in front of every publication and replay.
revoke all on function api.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) from public, anon, authenticated, service_role;
alter function api.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) set schema private;
alter function private.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) rename to publish_skill_submission_dual_control_unchecked;
revoke all on function private.publish_skill_submission_dual_control_unchecked(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) from public, anon, authenticated, service_role;

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
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'publication authority is required' using errcode = '42501';
  end if;
  perform private.assert_current_submission_evidence_authority(p_submission_id);
  return query
  select * from private.publish_skill_submission_dual_control_unchecked(
    p_submission_id, p_publication_digest, p_publisher_handle,
    p_publisher_display_name, p_skill_slug, p_skill_display_name, p_summary,
    p_description, p_capabilities, p_license_state, p_spdx_expression,
    p_permission_scripts, p_permission_network, p_permission_tools
  );
end;
$$;

revoke all on function api.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) from public, anon, authenticated, service_role;
grant execute on function api.publish_skill_submission(
  text, text, text, text, text, text, text, text, text[], text, text, boolean, text[], text[]
) to service_role;

commit;
