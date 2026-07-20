begin;

create function api.get_skill_submission_queue_summary()
returns table (
  observed_at timestamptz,
  queued_count bigint,
  processing_count bigint,
  accepted_count bigint,
  changes_requested_count bigint,
  failed_count bigint,
  expired_processing_count bigint,
  retryable_count bigint,
  dead_letter_ready_count bigint,
  oldest_queued_at timestamptz,
  oldest_processing_claim_expires_at timestamptz,
  oldest_accepted_at timestamptz,
  oldest_remediation_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_at timestamptz := statement_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'submission queue read authority is required' using errcode = '42501';
  end if;

  return query
  select snapshot_at,
    count(*) filter (where submission.state = 'queued'),
    count(*) filter (where submission.state = 'processing'),
    count(*) filter (where submission.state = 'accepted'),
    count(*) filter (where submission.state = 'changes-requested'),
    count(*) filter (where submission.state = 'failed'),
    count(*) filter (
      where submission.state = 'processing'
        and submission.claim_expires_at <= snapshot_at
    ),
    count(*) filter (
      where submission.state in ('failed', 'changes-requested')
        and submission.attempt_count < 5
    ),
    count(*) filter (
      where submission.state = 'processing'
        and submission.claim_expires_at <= snapshot_at
        and submission.attempt_count >= 5
    ),
    min(submission.created_at) filter (where submission.state = 'queued'),
    min(submission.claim_expires_at) filter (where submission.state = 'processing'),
    min(submission.completed_at) filter (where submission.state = 'accepted'),
    min(submission.completed_at) filter (
      where submission.state in ('failed', 'changes-requested')
    )
  from api.skill_submissions submission;
end;
$$;

create function api.list_skill_submission_operator_queue(
  p_state text default null,
  p_limit integer default 20,
  p_after_updated_at timestamptz default null,
  p_after_submission_id text default null
)
returns table (
  observed_at timestamptz,
  submission_id text,
  submission_state text,
  repository_url text,
  source_commit text,
  source_path text,
  version_label text,
  submitter_license_claim text,
  attempt_count integer,
  current_worker_version text,
  audit_state text,
  grade_state text,
  review_state text,
  remediation_code text,
  public_status_message text,
  result_skill_id text,
  result_version_id text,
  created_at timestamptz,
  updated_at timestamptz,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  completed_at timestamptz,
  claim_expired boolean,
  retry_eligible boolean,
  dead_letter_ready boolean,
  publication_review_ready boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_at timestamptz := statement_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'submission queue read authority is required' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in (
    'queued', 'processing', 'changes-requested', 'rejected', 'failed',
    'accepted', 'published', 'withdrawn'
  ) then
    raise exception 'submission queue state is invalid' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 32 then
    raise exception 'submission queue limit must be between 1 and 32' using errcode = '22023';
  end if;
  if (p_after_updated_at is null) <> (p_after_submission_id is null)
    or (p_after_submission_id is not null
      and p_after_submission_id !~ '^sub_[0-9a-f]{32}$') then
    raise exception 'submission queue cursor is invalid' using errcode = '22023';
  end if;

  return query
  select snapshot_at,
    submission.public_id,
    submission.state,
    submission.repository_url,
    submission.source_commit,
    submission.source_path,
    submission.version_label,
    submission.license_claim,
    submission.attempt_count,
    submission.current_worker_version,
    submission.audit_state,
    submission.grade_state,
    submission.review_state,
    submission.remediation_code,
    submission.public_status_message,
    submission.result_skill_id,
    submission.result_version_id,
    submission.created_at,
    submission.updated_at,
    submission.claimed_at,
    submission.claim_expires_at,
    submission.completed_at,
    submission.state = 'processing' and submission.claim_expires_at <= snapshot_at,
    submission.state in ('failed', 'changes-requested') and submission.attempt_count < 5,
    submission.state = 'processing' and submission.claim_expires_at <= snapshot_at
      and submission.attempt_count >= 5,
    submission.state = 'accepted' and submission.review_state = 'approved'
  from api.skill_submissions submission
  where (
      (p_state is null and submission.state in (
        'queued', 'processing', 'accepted', 'changes-requested', 'failed'
      ))
      or submission.state = p_state
    )
    and (
      p_after_updated_at is null
      or (submission.updated_at, submission.public_id) >
        (p_after_updated_at, p_after_submission_id)
    )
  order by submission.updated_at, submission.public_id
  limit p_limit;
end;
$$;

create index skill_submissions_operator_queue_idx
  on api.skill_submissions(state, updated_at, public_id);

create function api.get_skill_submission_operator_detail(p_submission_id text)
returns table (
  observed_at timestamptz,
  submission_id text,
  submission_state text,
  repository_url text,
  source_commit text,
  source_path text,
  version_label text,
  submitter_license_claim text,
  submission_policy_version text,
  authority_confirmed boolean,
  untrusted_processing_accepted boolean,
  attempt_count integer,
  current_worker_version text,
  audit_state text,
  grade_state text,
  review_state text,
  remediation_code text,
  public_status_message text,
  result_skill_id text,
  result_version_id text,
  publication_digest text,
  last_transition_digest text,
  created_at timestamptz,
  updated_at timestamptz,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  completed_at timestamptz,
  claim_expired boolean,
  retry_eligible boolean,
  dead_letter_ready boolean,
  publication_review_ready boolean,
  audit_receipt jsonb,
  grade_receipt jsonb,
  review_case jsonb,
  worker_runs jsonb,
  transition_events jsonb,
  transition_events_truncated boolean,
  license_evidence_receipt jsonb,
  collision_reviews jsonb,
  collision_reviews_truncated boolean,
  publisher_authorizations jsonb,
  publisher_authorizations_truncated boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_at timestamptz := statement_timestamp();
  target_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'submission detail read authority is required' using errcode = '42501';
  end if;
  if p_submission_id is null or p_submission_id !~ '^sub_[0-9a-f]{32}$' then
    raise exception 'submission id is invalid' using errcode = '22023';
  end if;
  select submission.id into target_id
  from api.skill_submissions submission
  where submission.public_id = p_submission_id;
  if target_id is null then
    raise exception 'submission was not found' using errcode = 'P0002';
  end if;

  return query
  select snapshot_at,
    submission.public_id,
    submission.state,
    submission.repository_url,
    submission.source_commit,
    submission.source_path,
    submission.version_label,
    submission.license_claim,
    submission.submission_policy_version,
    submission.authority_confirmed,
    submission.untrusted_processing_accepted,
    submission.attempt_count,
    submission.current_worker_version,
    submission.audit_state,
    submission.grade_state,
    submission.review_state,
    submission.remediation_code,
    submission.public_status_message,
    submission.result_skill_id,
    submission.result_version_id,
    submission.publication_digest,
    submission.last_transition_digest,
    submission.created_at,
    submission.updated_at,
    submission.claimed_at,
    submission.claim_expires_at,
    submission.completed_at,
    submission.state = 'processing' and submission.claim_expires_at <= snapshot_at,
    submission.state in ('failed', 'changes-requested') and submission.attempt_count < 5,
    submission.state = 'processing' and submission.claim_expires_at <= snapshot_at
      and submission.attempt_count >= 5,
    submission.state = 'accepted' and submission.review_state = 'approved',
    case when audit.id is null then null else jsonb_build_object(
      'receiptId', audit.public_id,
      'receiptDigest', audit.receipt_digest,
      'sourceContentDigest', audit.source_content_digest,
      'normalizedContentDigest', audit.normalized_content_digest,
      'state', audit.state,
      'findingCounts', audit.finding_counts,
      'publicChecks', audit.public_checks,
      'reasonCodes', to_jsonb(audit.reason_codes),
      'policyVersion', audit.policy_version,
      'hostProfileVersion', audit.host_profile_version,
      'workerVersion', audit.worker_version,
      'licenseState', audit.license_state,
      'spdxExpression', audit.spdx_expression,
      'permissionScripts', audit.permission_scripts,
      'networkIndicators', audit.network_indicators,
      'toolIndicators', audit.tool_indicators,
      'createdAt', audit.created_at
    ) end,
    case when grade.id is null then null else jsonb_build_object(
      'receiptId', grade.public_id,
      'receiptDigest', grade.receipt_digest,
      'auditReceiptDigest', grade.audit_receipt_digest,
      'state', grade.state,
      'band', grade.band,
      'totalScore', grade.total_score,
      'confidence', grade.confidence,
      'normalizedContentDigest', grade.normalized_content_digest,
      'compatibilityEvidenceDigest', grade.compatibility_evidence_digest,
      'evaluationSuiteDigest', grade.evaluation_suite_digest,
      'rubricVersion', grade.rubric_version,
      'hostProfileVersion', grade.host_profile_version,
      'evaluatorVersion', grade.evaluator_version,
      'hardGates', grade.hard_gates,
      'dimensions', grade.dimensions,
      'reasonCodes', to_jsonb(grade.reason_codes),
      'createdAt', grade.created_at
    ) end,
    case when review.id is null then null else jsonb_build_object(
      'reviewId', review.public_id,
      'state', review.state,
      'reasonCodes', to_jsonb(review.reason_codes),
      'publicMessage', review.public_message,
      'idempotencyDigest', review.idempotency_digest,
      'collisionEvidenceDigest', review.collision_evidence_digest,
      'createdAt', review.created_at
    ) end,
    coalesce(worker_history.rows, '[]'::jsonb),
    coalesce(event_history.rows, '[]'::jsonb),
    coalesce(event_history.total_count, 0) > 50,
    license_evidence.row,
    coalesce(collision_history.rows, '[]'::jsonb),
    coalesce(collision_history.total_count, 0) > 20,
    coalesce(authorization_history.rows, '[]'::jsonb),
    coalesce(authorization_history.total_count, 0) > 20
  from api.skill_submissions submission
  left join private.skill_audit_receipts audit
    on audit.id = submission.audit_receipt_id and audit.submission_id = submission.id
  left join private.skill_grade_receipts grade
    on grade.id = submission.grade_receipt_id and grade.submission_id = submission.id
  left join private.review_cases review
    on review.id = submission.review_case_id and review.submission_id = submission.id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'runId', worker.public_id,
      'workerVersion', worker.worker_version,
      'attemptNumber', worker.attempt_number,
      'outcome', worker.outcome,
      'disposition', worker.disposition_state,
      'inputDigest', worker.input_digest,
      'resultDigest', worker.result_digest,
      'errorCode', worker.error_code,
      'publicErrorMessage', worker.public_error_message,
      'startedAt', worker.started_at,
      'completedAt', worker.completed_at
    ) order by worker.attempt_number, worker.public_id) as rows
    from private.worker_runs worker
    where worker.submission_id = submission.id
  ) worker_history on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
        'eventId', event.public_id,
        'fromState', event.from_state,
        'toState', event.to_state,
        'actorType', event.actor_type,
        'transitionDigest', event.transition_digest,
        'createdAt', event.created_at
      ) order by event.created_at, event.public_id) filter (where event.public_id is not null) as rows,
      max(event.total_count) as total_count
    from (
      select event.*, count(*) over () as total_count
      from private.submission_events event
      where event.submission_id = submission.id
      order by event.created_at, event.public_id
      limit 50
    ) event
  ) event_history on true
  left join lateral (
    select jsonb_build_object(
      'receiptId', evidence.public_id,
      'workerVersion', evidence.worker_version,
      'auditReceiptDigest', evidence.audit_receipt_digest,
      'spdxExpression', evidence.spdx_expression,
      'evidence', evidence.evidence,
      'reviewReference', evidence.review_reference,
      'reviewEvidenceDigest', evidence.review_evidence_digest,
      'createdAt', evidence.created_at
    ) as row
    from private.submission_license_evidence_receipts evidence
    where evidence.submission_id = submission.id
      and evidence.claim_id = submission.last_worker_run_id
      and evidence.audit_receipt_digest = submission.audit_receipt_digest
    order by evidence.created_at desc, evidence.public_id desc
    limit 1
  ) license_evidence on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
        'reviewId', collision.public_id,
        'reviewSubjectDigest', collision.review_subject_digest,
        'authorityVersion', collision.authority_version,
        'disposition', collision.disposition,
        'reasonCode', collision.reason_code,
        'targetPublisherId', target_publisher.public_id,
        'targetSkillId', target_skill.public_id,
        'targetVersionId', target_version.public_id,
        'idempotencyDigest', collision.idempotency_digest,
        'createdAt', collision.created_at
      ) order by collision.created_at, collision.public_id) filter (where collision.public_id is not null) as rows,
      max(collision.total_count) as total_count
    from (
      select collision.*, count(*) over () as total_count
      from private.submission_collision_reviews collision
      where collision.submission_id = submission.id
      order by collision.created_at, collision.public_id
      limit 20
    ) collision
    left join private.publishers target_publisher on target_publisher.id = collision.target_publisher_id
    left join private.skills target_skill on target_skill.id = collision.target_skill_id
    left join private.skill_versions target_version on target_version.id = collision.target_version_id
  ) collision_history on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
        'authorizationId', auth_receipt.public_id,
        'publisherHandle', auth_receipt.publisher_handle,
        'decision', auth_receipt.decision,
        'authorizationBasis', auth_receipt.authorization_basis,
        'evidenceReference', auth_receipt.evidence_reference,
        'evidenceDigest', auth_receipt.evidence_digest,
        'expiresAt', auth_receipt.expires_at,
        'idempotencyDigest', auth_receipt.idempotency_digest,
        'createdAt', auth_receipt.created_at
      ) order by auth_receipt.receipt_sequence desc) filter (where auth_receipt.public_id is not null) as rows,
      max(auth_receipt.total_count) as total_count
    from (
      select receipt.*, count(*) over () as total_count
      from private.submission_publisher_authorization_receipts receipt
      where receipt.submission_id = submission.id
      order by receipt.receipt_sequence desc
      limit 20
    ) auth_receipt
  ) authorization_history on true
  where submission.id = target_id;
end;
$$;

revoke all on function api.get_skill_submission_queue_summary()
  from public, anon, authenticated, service_role;
revoke all on function api.list_skill_submission_operator_queue(text, integer, timestamptz, text)
  from public, anon, authenticated, service_role;
revoke all on function api.get_skill_submission_operator_detail(text)
  from public, anon, authenticated, service_role;

grant execute on function api.get_skill_submission_queue_summary() to service_role;
grant execute on function api.list_skill_submission_operator_queue(text, integer, timestamptz, text)
  to service_role;
grant execute on function api.get_skill_submission_operator_detail(text) to service_role;

comment on function api.get_skill_submission_queue_summary() is
  'Service-role-only non-mutating submission queue counters and lease deadlines observed at one statement timestamp.';
comment on function api.list_skill_submission_operator_queue(text, integer, timestamptz, text) is
  'Service-role-only bounded cursor page of redacted submission workflow projections; no account identity or claim authority is returned.';
comment on function api.get_skill_submission_operator_detail(text) is
  'Service-role-only exact redacted submission receipt history with bounded event, collision, and authorization projections.';

commit;
