begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

create function pg_temp.audit_payload(audit_state text, seed text)
returns jsonb
language plpgsql
as $$
begin
  return jsonb_build_object(
    'state', audit_state,
    'receiptDigest', 'sha256:' || repeat(seed, 64),
    'sourceContentDigest', 'sha256:' || repeat('a', 64),
    'normalizedContentDigest', 'sha256:' || repeat('b', 64),
    'policyVersion', 'skillmap-static-audit/v1',
    'hostProfileVersion', 'codex-host/v1',
    'workerVersion', 'skillmap-worker/1.0.0',
    'findingCounts', case when audit_state = 'passed'
      then '{"critical":0,"high":0,"medium":0,"low":0,"info":0}'::jsonb
      else '{"critical":0,"high":1,"medium":0,"low":0,"info":0}'::jsonb end,
    'publicChecks', case when audit_state = 'passed'
      then jsonb_build_array(jsonb_build_object(
        'code', 'source-integrity', 'outcome', 'passed', 'severity', 'info',
        'evidenceDigest', 'sha256:' || repeat('c', 64)))
      else jsonb_build_array(jsonb_build_object(
        'code', 'license-confirmed', 'outcome', 'blocked', 'severity', 'high',
        'evidenceDigest', 'sha256:' || repeat('c', 64))) end,
    'reasonCodes', case when audit_state = 'passed'
      then '[]'::jsonb else '["license-unresolved"]'::jsonb end,
    'privateEvidenceDigest', 'sha256:' || repeat('d', 64),
    'licenseState', case when audit_state = 'passed' then 'confirmed' else 'noassertion' end,
    'spdxExpression', case when audit_state = 'passed' then 'MIT' else null end,
    'permissionScripts', false,
    'networkIndicators', false,
    'toolIndicators', false
  );
end;
$$;

create function pg_temp.grade_payload(grade_state text, seed text, audit_digest text, total_override integer default null)
returns jsonb
language plpgsql
as $$
begin
  return jsonb_build_object(
    'state', grade_state,
    'receiptDigest', 'sha256:' || repeat(seed, 64),
    'totalScore', case when grade_state = 'provisional' then coalesce(total_override, 82) else null end,
    'confidence', case when grade_state = 'provisional' then 0.35 else null end,
    'normalizedContentDigest', 'sha256:' || repeat('b', 64),
    'auditReceiptDigest', audit_digest,
    'compatibilityEvidenceDigest', 'sha256:' || repeat('e', 64),
    'evaluationSuiteDigest', null,
    'rubricVersion', 'skillmap-rubric/v1',
    'hostProfileVersion', 'codex-host/v1',
    'evaluatorVersion', 'skillmap-grader/1.0.0',
    'hardGates', case when grade_state = 'provisional' then jsonb_build_array(
      jsonb_build_object('code', 'source-identity', 'passed', true, 'evidenceDigest', 'sha256:' || repeat('f', 64)),
      jsonb_build_object('code', 'audit-acceptable', 'passed', true, 'evidenceDigest', 'sha256:' || repeat('f', 64)),
      jsonb_build_object('code', 'license-confirmed', 'passed', true, 'evidenceDigest', 'sha256:' || repeat('f', 64)),
      jsonb_build_object('code', 'compatibility-evidence-bound', 'passed', true, 'evidenceDigest', 'sha256:' || repeat('e', 64)),
      jsonb_build_object('code', 'behavioral-evidence-bound', 'passed', false, 'evidenceDigest', null)
    ) else jsonb_build_array(
      jsonb_build_object('code', 'source-identity', 'passed', true, 'evidenceDigest', 'sha256:' || repeat('f', 64)),
      jsonb_build_object('code', 'audit-acceptable', 'passed', false, 'evidenceDigest', null),
      jsonb_build_object('code', 'license-confirmed', 'passed', false, 'evidenceDigest', null),
      jsonb_build_object('code', 'compatibility-evidence-bound', 'passed', true, 'evidenceDigest', 'sha256:' || repeat('e', 64)),
      jsonb_build_object('code', 'behavioral-evidence-bound', 'passed', false, 'evidenceDigest', null)
    ) end,
    'dimensions', jsonb_build_array(
      jsonb_build_object('code', 'instruction-quality', 'weight', 0.25, 'score', 83, 'evidenceDigest', 'sha256:' || repeat('1', 64)),
      jsonb_build_object('code', 'safety-and-permissions', 'weight', 0.25, 'score', 82, 'evidenceDigest', 'sha256:' || repeat('1', 64)),
      jsonb_build_object('code', 'routing-quality', 'weight', 0.20, 'score', 82, 'evidenceDigest', 'sha256:' || repeat('1', 64)),
      jsonb_build_object('code', 'reproducibility', 'weight', 0.15, 'score', 82, 'evidenceDigest', 'sha256:' || repeat('1', 64)),
      jsonb_build_object('code', 'maintenance-and-provenance', 'weight', 0.15, 'score', 78, 'evidenceDigest', 'sha256:' || repeat('1', 64))
    ),
    'reasonCodes', case when grade_state = 'provisional'
      then '["behavioral-evidence-incomplete"]'::jsonb
      else '["audit-blocked","license-unresolved"]'::jsonb end
  );
end;
$$;

select plan(78);

select ok(has_function_privilege('service_role', 'api.complete_skill_submission(text,uuid,text,text,text,text,jsonb,jsonb,text[],text,text)', 'execute'), 'service role can complete a claim');
select ok(has_function_privilege('service_role', 'api.requeue_skill_submission(text,text)', 'execute'), 'service role can requeue an eligible submission');
select ok(has_function_privilege('service_role', 'api.publish_skill_submission(text,text,text,text,text,text,text,text,text[],text,text,boolean,text[],text[])', 'execute'), 'service role can publish approved metadata');
select ok(has_function_privilege('authenticated', 'api.delete_my_account()', 'execute'), 'authenticated users can execute self-delete');
select ok(not has_function_privilege('authenticated', 'api.complete_skill_submission(text,uuid,text,text,text,text,jsonb,jsonb,text[],text,text)', 'execute'), 'browser users cannot complete claims');
select ok(not has_function_privilege('authenticated', 'api.requeue_skill_submission(text,text)', 'execute'), 'browser users cannot requeue claims');
select ok(not has_function_privilege('authenticated', 'api.publish_skill_submission(text,text,text,text,text,text,text,text,text[],text,text,boolean,text[],text[])', 'execute'), 'browser users cannot publish');
select ok(not has_function_privilege('service_role', 'api.delete_my_account()', 'execute'), 'service role cannot invoke browser self-delete');
select ok(not has_function_privilege('anon', 'api.delete_my_account()', 'execute'), 'anonymous users cannot invoke self-delete');
select ok(has_column_privilege('authenticated', 'api.skill_submissions', 'submission_policy_version', 'insert'), 'browser insert grant includes the policy version');
select ok(has_column_privilege('authenticated', 'api.skill_submissions', 'authority_confirmed', 'insert'), 'browser insert grant includes repository authority attestation');
select ok(has_column_privilege('authenticated', 'api.skill_submissions', 'untrusted_processing_accepted', 'insert'), 'browser insert grant includes untrusted-processing acceptance');
select ok(not has_column_privilege('authenticated', 'api.skill_submissions', 'authority_confirmed', 'update'), 'attestations are not browser-mutable');
select is(
  (select count(*) from information_schema.columns where table_schema = 'api'
    and table_name = 'my_skill_submissions'
    and column_name in ('authority_confirmed', 'untrusted_processing_accepted')),
  0::bigint,
  'owner projection exposes the policy version but not attestation booleans'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prosecdef),
  12::bigint,
  'the API security-definer boundary contains exactly twelve reviewed functions'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prosecdef and p.proname in (
      'claim_skill_submission', 'complete_skill_submission', 'requeue_skill_submission',
      'dead_letter_expired_skill_submission',
      'publish_skill_submission', 'delete_my_account', 'disposition_skill_report',
      'control_catalog_lifecycle', 'renew_skill_submission_claim', 'list_skill_report_queue',
      'list_skill_submission_collisions', 'review_skill_submission_collisions')),
  12::bigint,
  'all API security-definer functions are on the reviewed allowlist'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select throws_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, idempotency_key
    ) values (
      'https://github.com/launch-owner/missing-attestation',
      '1111111111111111111111111111111111111111', 'SKILL.md', '1.0.0',
      '10000000-0000-4000-8000-000000000001'
    )$$,
  42501, null, 'queue insertion fails closed when attestations are omitted'
);
select throws_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/launch-owner/false-attestation',
      '2222222222222222222222222222222222222222', 'SKILL.md', '1.0.0',
      '10000000-0000-4000-8000-000000000002', 'public-alpha-draft/v1', false, true
    )$$,
  42501, null, 'queue insertion rejects a false authority attestation'
);
select lives_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, license_claim, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/launch-owner/launch-skill',
      '3333333333333333333333333333333333333333', 'skills/launch/SKILL.md',
      '1.0.0', 'MIT', '10000000-0000-4000-8000-000000000003',
      'public-alpha-draft/v1', true, true
    )$$,
  'an authenticated owner can queue an attested immutable source'
);
select is(
  (select submission_policy_version from api.my_skill_submissions
    where repository_url = 'https://github.com/launch-owner/launch-skill'),
  'public-alpha-draft/v1',
  'the owner projection reports the exact accepted policy version'
);
select submission_id as launch_submission_id
from api.my_skill_submissions
where repository_url = 'https://github.com/launch-owner/launch-skill' \gset

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select count(*) from api.claim_skill_submission(
    'skillmap-worker/1.0.0',
    :'launch_submission_id',
    300)),
  1::bigint,
  'service authority claims the queued source exactly once'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$select * from api.complete_skill_submission(
      (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
      gen_random_uuid(), 'skillmap-worker/1.0.0', 'accepted',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      pg_temp.audit_payload('passed', '2'),
      pg_temp.grade_payload('provisional', '3', 'sha256:' || repeat('2', 64)),
      '{}'::text[], null, 'sha256:' || repeat('4', 64))$$,
  55000, null, 'a stale claim ID cannot complete another worker claim'
);
select throws_ok(
  $$select * from api.complete_skill_submission(
      (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
      (select active_claim_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
      'skillmap-worker/1.0.0', 'accepted',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      jsonb_set(pg_temp.audit_payload('passed', '2'), '{findingCounts,medium}', '1'::jsonb),
      pg_temp.grade_payload('provisional', '3', 'sha256:' || repeat('2', 64)),
      '{}'::text[], null, 'sha256:' || repeat('4', 64))$$,
  22023, null, 'completion rejects contradictory passed-audit counts'
);
select throws_ok(
  $$select * from api.complete_skill_submission(
      (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
      (select active_claim_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
      'skillmap-worker/1.0.0', 'accepted',
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      pg_temp.audit_payload('passed', '2'),
      pg_temp.grade_payload('provisional', '3', 'sha256:' || repeat('2', 64), 81),
      '{}'::text[], null, 'sha256:' || repeat('4', 64))$$,
  22023, null, 'completion rejects a grade total that is not the rounded weighted score'
);
select is(
  (select submission_state from api.complete_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    (select active_claim_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'skillmap-worker/1.0.0', 'accepted',
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    pg_temp.audit_payload('passed', '2'),
    pg_temp.grade_payload('provisional', '3', 'sha256:' || repeat('2', 64)),
    '{}'::text[], null, 'sha256:' || repeat('4', 64))),
  'accepted',
  'valid evidence atomically completes the claim as accepted'
);
select is((select state from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'), 'accepted', 'accepted state is persisted');
select is((select count(*) from private.skill_audit_receipts), 1::bigint, 'one immutable audit receipt is persisted');
select is((select count(*) from private.skill_grade_receipts), 1::bigint, 'one immutable grade receipt is persisted');
select is((select count(*) from private.review_cases), 1::bigint, 'one immutable review case is persisted');
select is((select count(*) from private.worker_runs), 1::bigint, 'one immutable worker run is persisted');
select is((select count(*) from private.submission_events where submission_id = (
  select id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill')), 3::bigint, 'queued, processing, and accepted transitions are recorded');
select is(
  (select submission_state from api.complete_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    (select last_worker_run_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'skillmap-worker/1.0.0', 'accepted',
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    pg_temp.audit_payload('passed', '2'),
    pg_temp.grade_payload('provisional', '3', 'sha256:' || repeat('2', 64)),
    '{}'::text[], null, 'sha256:' || repeat('4', 64))),
  'accepted',
  'an exact completion retry is idempotent'
);
select is(
  (select (select count(*) from private.skill_audit_receipts)
    + (select count(*) from private.skill_grade_receipts)
    + (select count(*) from private.review_cases)
    + (select count(*) from private.worker_runs)),
  4::bigint,
  'completion retry creates no duplicate authority rows'
);
select is((select count(*) from private.skill_versions where grade_state = 'current'), 0::bigint, 'no current grade exists before publication');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select lives_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/launch-owner/retry-skill',
      '4444444444444444444444444444444444444444', 'SKILL.md', '1.0.0',
      '10000000-0000-4000-8000-000000000004', 'public-alpha-draft/v1', true, true
    )$$,
  'a second attested submission is queued for retry tests'
);
select submission_id as retry_submission_id
from api.my_skill_submissions
where repository_url = 'https://github.com/launch-owner/retry-skill' \gset

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.claim_skill_submission('skillmap-worker/1.0.0',
  :'retry_submission_id', 300)), 1::bigint, 'retry fixture is claimed');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select submission_state from api.complete_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill'),
    (select active_claim_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill'),
    'skillmap-worker/1.0.0', 'failed', 'sha256:' || repeat('5', 64), 'sha256:' || repeat('6', 64),
    null, null, array['worker-timeout'], 'The worker timed out safely.', 'sha256:' || repeat('7', 64))),
  'failed', 'a failed worker run completes without fabricated receipts'
);
select is((select remediation_code from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill'), 'WORKER_FAILED', 'failed completion exposes bounded remediation');
select is((select submission_state from api.requeue_skill_submission(
  (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill'),
  'sha256:' || repeat('8', 64))), 'queued', 'failed submissions can be requeued');
select is((select row(state, attempt_count, audit_state, grade_state, review_state)::text from api.skill_submissions
  where repository_url = 'https://github.com/launch-owner/retry-skill'), '(queued,1,not-run,ungraded,not-started)', 'requeue clears active projections but preserves attempt history');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.claim_skill_submission('skillmap-worker/1.0.0',
  :'retry_submission_id', 300)), 1::bigint, 'requeued work can be claimed again');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select submission_state from api.complete_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill'),
    (select active_claim_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill'),
    'skillmap-worker/1.0.0', 'changes-requested', 'sha256:' || repeat('9', 64), 'sha256:' || repeat('a', 64),
    pg_temp.audit_payload('blocked', '5'),
    pg_temp.grade_payload('blocked', '6', 'sha256:' || repeat('5', 64)),
    array['license-unresolved'], 'Confirm an approved license before resubmission.', 'sha256:' || repeat('b', 64))),
  'changes-requested', 'review authority can request changes with blocked receipts'
);
select is((select submission_state from api.requeue_skill_submission(
  (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill'),
  'sha256:' || repeat('c', 64))), 'queued', 'changes-requested submissions can be requeued');
select is((select attempt_count from api.requeue_skill_submission(
  (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill'),
  'sha256:' || repeat('c', 64))), 2, 'an exact requeue retry is idempotent');
select is((select count(*) from private.submission_events where submission_id = (
  select id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/retry-skill')), 7::bigint, 'retry transitions are append-only and idempotent');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.claim_skill_submission('skillmap-worker/1.0.0',
  :'retry_submission_id', 300)), 1::bigint, 'the second requeue can be claimed for an operator reconsideration');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  (select submission_state from api.complete_skill_submission(
    :'retry_submission_id',
    (select active_claim_id from api.skill_submissions where public_id = :'retry_submission_id'),
    'skillmap-worker/1.0.0', 'changes-requested', 'sha256:' || repeat('d', 64), 'sha256:' || repeat('e', 64),
    pg_temp.audit_payload('blocked', '5'),
    pg_temp.grade_payload('blocked', '6', 'sha256:' || repeat('5', 64)),
    array['license-unresolved'], 'Confirm an approved license before resubmission.', 'sha256:' || repeat('f', 64))),
  'changes-requested', 'a later review can reuse an identical immutable evidence receipt'
);
select is(
  (select (select count(*) from private.skill_audit_receipts receipt where receipt.submission_id = submission.id)
    + (select count(*) from private.skill_grade_receipts receipt where receipt.submission_id = submission.id)
   from api.skill_submissions submission where submission.public_id = :'retry_submission_id'),
  2::bigint,
  'evidence reuse does not duplicate canonical audit or grade receipts'
);
select throws_ok(
  $$insert into private.review_cases (
      submission_id, audit_receipt_id, grade_receipt_id, state, idempotency_digest
    ) select retry.id, accepted.audit_receipt_id, accepted.grade_receipt_id, 'approved',
      'sha256:' || repeat('d', 64)
    from api.skill_submissions retry cross join api.skill_submissions accepted
    where retry.repository_url = 'https://github.com/launch-owner/retry-skill'
      and accepted.repository_url = 'https://github.com/launch-owner/launch-skill'$$,
  23503, null, 'review cases cannot forge a cross-submission receipt chain'
);

select throws_ok(
  $$select * from api.publish_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'sha256:' || repeat('e', 64), 'launch-owner', 'Launch Owner', 'launch-skill', 'Launch Skill',
    'A safely reviewed public-alpha skill.', 'A metadata-only catalog entry backed by immutable evidence.',
    array['review.audit'], 'confirmed', 'MIT OR Apache-2.0', false, '{}'::text[], '{}'::text[])$$,
  22023, null, 'publication rejects compound SPDX expressions outside the exact alpha allowlist'
);
select throws_ok(
  $$select * from api.publish_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'sha256:' || repeat('e', 64), 'launch-owner', 'Launch Owner', 'launch-skill', 'Launch Skill',
    'A safely reviewed public-alpha skill.', 'A metadata-only catalog entry backed by immutable evidence.',
    array['review.audit'], 'confirmed', 'Apache-2.0', false, '{}'::text[], '{}'::text[])$$,
  23514, null, 'publication SPDX must equal the license bound into the immutable audit receipt'
);
select throws_ok(
  $$select * from api.publish_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'sha256:' || repeat('e', 64), 'launch-owner', 'Launch Owner', 'launch-skill', 'Launch Skill',
    'A safely reviewed public-alpha skill.', 'A metadata-only catalog entry backed by immutable evidence.',
    array['review.audit'], 'confirmed', 'MIT', true, '{}'::text[], '{}'::text[])$$,
  23514, null, 'publication cannot invent script permissions absent from the audit inventory'
);
select throws_ok(
  $$select * from api.publish_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'sha256:' || repeat('e', 64), 'launch-owner', 'Launch Owner', 'launch-skill', 'Launch Skill',
    'A safely reviewed public-alpha skill.', 'A metadata-only catalog entry backed by immutable evidence.',
    array['review.audit'], 'confirmed', 'MIT', false, array['api.example.invalid'], '{}'::text[])$$,
  23514, null, 'publication network disclosure must match the audit indicator'
);
select throws_ok(
  $$select * from api.publish_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'sha256:' || repeat('e', 64), 'launch-owner', 'Launch Owner', 'launch-skill', 'Launch Skill',
    'A safely reviewed public-alpha skill.', 'A metadata-only catalog entry backed by immutable evidence.',
    array['review.audit'], 'confirmed', 'MIT', false, '{}'::text[], array['bash'])$$,
  23514, null, 'publication tool disclosure must match the audit indicator'
);
select is(
  (select submission_state from api.publish_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'sha256:' || repeat('e', 64), 'launch-owner', 'Launch Owner', 'launch-skill', 'Launch Skill',
    'A safely reviewed public-alpha skill.', 'A metadata-only catalog entry backed by immutable evidence.',
    array['review.audit'], 'confirmed', 'MIT', false, '{}'::text[], '{}'::text[])),
  'published',
  'approved evidence publishes one metadata-only catalog version transactionally'
);
select ok((select result_skill_id is not null and result_version_id is not null from api.skill_submissions
  where repository_url = 'https://github.com/launch-owner/launch-skill'), 'publication stores owner-safe catalog result identifiers');
set local role anon;
select is((select count(*) from api.catalog_skills where publisher_handle = 'launch-owner' and slug = 'launch-skill'), 1::bigint, 'published metadata is visible in the anonymous catalog');
reset role;
select is(
  (select row(artifact_availability, redistribution_state, evidence_provenance_state,
    compatibility_state, grade_state, grade_band, publication_state)::text
   from private.skill_versions where source_submission_id = (
     select id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill')),
  '(metadata-only,metadata-only,source-pinned,declared,provisional,,published)',
  'the catalog version is receipt-backed, metadata-only, provisional, and has no band'
);
select is((select count(*) from private.skill_versions where grade_state = 'current'), 0::bigint, 'publication never mints a current letter grade');
select is((select count(*) from api.catalog_skill_versions where repository_url = 'https://github.com/launch-owner/retry-skill'), 0::bigint, 'failed and changes-requested work never leaks into the catalog');
select is((select submission_state from api.publish_skill_submission(
  (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
  'sha256:' || repeat('e', 64), 'launch-owner', 'Launch Owner', 'launch-skill', 'Launch Skill',
  'A safely reviewed public-alpha skill.', 'A metadata-only catalog entry backed by immutable evidence.',
  array['review.audit'], 'confirmed', 'MIT', false, '{}'::text[], '{}'::text[])), 'published', 'an exact publication retry is idempotent');
select is((select count(*) from private.skill_versions where source_submission_id = (
  select id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill')), 1::bigint, 'publication retry creates no duplicate version');
select throws_ok(
  $$select * from api.publish_skill_submission(
    (select public_id from api.skill_submissions where repository_url = 'https://github.com/launch-owner/launch-skill'),
    'sha256:' || repeat('e', 64), 'launch-owner', 'Launch Owner', 'launch-skill', 'Changed Name',
    'A safely reviewed public-alpha skill.', 'A metadata-only catalog entry backed by immutable evidence.',
    array['review.audit'], 'confirmed', 'MIT', false, '{}'::text[], '{}'::text[])$$,
  23505, null, 'publication replay rejects conflicting metadata even with a reused digest'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select throws_ok(
  $$update api.skill_submissions set audit_state = 'passed'
    where repository_url = 'https://github.com/launch-owner/retry-skill'$$,
  42501, null, 'browser users cannot forge audit projections'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select lives_ok(
  $$insert into api.skill_submissions (
      repository_url, source_commit, source_path, version_label, idempotency_key,
      submission_policy_version, authority_confirmed, untrusted_processing_accepted
    ) values (
      'https://github.com/lease-owner/reclaimable-skill',
      '5555555555555555555555555555555555555555', 'SKILL.md', '1.0.0',
      '10000000-0000-4000-8000-000000000005', 'public-alpha-draft/v1', true, true
    )$$,
  'a lease-recovery fixture is queued'
);
select submission_id as lease_submission_id
from api.my_skill_submissions
where repository_url = 'https://github.com/lease-owner/reclaimable-skill' \gset
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.claim_skill_submission('skillmap-worker/1.0.0',
  :'lease_submission_id', 300)), 1::bigint, 'the lease fixture receives its first claim');
select is((select count(*) from api.claim_skill_submission('skillmap-worker/2.0.0',
  :'lease_submission_id', 300)), 0::bigint, 'a live lease cannot be stolen');
reset role;
update api.skill_submissions set claimed_at = now() - interval '10 minutes',
  claim_expires_at = now() - interval '1 minute'
where repository_url = 'https://github.com/lease-owner/reclaimable-skill';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.claim_skill_submission('skillmap-worker/2.0.0',
  :'lease_submission_id', 300)), 1::bigint, 'an expired processing lease is atomically reclaimed');
select is((select count(*) from api.claim_skill_submission('skillmap-worker/3.0.0',
  :'lease_submission_id', 300)), 0::bigint, 'a reclaimed live lease cannot be reclaimed twice');
reset role;
select is((select row(attempt_count, current_worker_version, state)::text from api.skill_submissions
  where repository_url = 'https://github.com/lease-owner/reclaimable-skill'), '(2,skillmap-worker/2.0.0,processing)', 'reclaim rotates worker authority and increments the bounded attempt');
select is((select count(*) from private.submission_events where submission_id = (
  select id from api.skill_submissions where repository_url = 'https://github.com/lease-owner/reclaimable-skill')
  and from_state = 'processing' and to_state = 'processing'), 1::bigint, 'expired-lease reclaim emits an explicit processing receipt');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select is(api.delete_my_account(), true, 'authenticated self-delete removes only the caller account');
reset role;
select is((select count(*) from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 0::bigint, 'the caller auth account is deleted');
select is((select count(*) from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'), 1::bigint, 'another account remains untouched');
select is((select count(*) from api.skill_submissions where submitter_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 0::bigint, 'self-delete cascades caller-owned submissions');
select is((select count(*) from private.skill_audit_receipts receipt left join api.skill_submissions submission on submission.id = receipt.submission_id where submission.id is null), 0::bigint, 'self-delete leaves no orphan private receipts');
set local role anon;
select is((select count(*) from api.catalog_skills where publisher_handle = 'launch-owner' and slug = 'launch-skill'), 0::bigint, 'deleting the evidence owner quarantines the derived public version');
reset role;
select is((select row(source_submission_id, evidence_provenance_state, grade_state, publication_state, quarantined_at is not null)::text
  from private.skill_versions version join private.skills skill on skill.id = version.skill_id
  where skill.slug = 'launch-skill'), '(,unverified,ungraded,blocked,t)', 'detached publication is evidence-cleared, blocked, and quarantined');

select * from finish();
rollback;
