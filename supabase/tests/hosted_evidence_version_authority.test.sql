begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

select plan(29);

select has_function(
  'private', 'supported_submission_evidence_authority',
  array['text','text','text','text','text','text','text','text'],
  'the exact evidence-authority predicate exists'
);
select ok(not has_function_privilege(
  'service_role',
  'private.supported_submission_evidence_authority(text,text,text,text,text,text,text,text)',
  'execute'
), 'service-role transport cannot widen or invoke private authority policy');
select ok(
  not has_function_privilege('service_role',
    'private.claim_skill_submission_provider_aware_unchecked(text,text,integer)', 'execute')
  and not has_function_privilege('service_role',
    'private.complete_skill_submission_evidence_unchecked(text,uuid,text,text,text,text,jsonb,jsonb,text[],text,text)', 'execute')
  and not has_function_privilege('service_role',
    'private.publish_skill_submission_dual_control_unchecked(text,text,text,text,text,text,text,text,text[],text,text,boolean,text[],text[])', 'execute'),
  'service-role transport cannot execute relocated claim, completion, or publication delegates'
);
select ok(
  has_function_privilege('service_role', 'api.claim_skill_submission(text,text,integer)', 'execute')
  and has_function_privilege('service_role',
    'api.complete_skill_submission(text,uuid,text,text,text,text,jsonb,jsonb,text[],text,text)', 'execute')
  and has_function_privilege('service_role',
    'api.publish_skill_submission(text,text,text,text,text,text,text,text,text[],text,text,boolean,text[],text[])', 'execute'),
  'service-role transport can execute only the three guarded API boundaries'
);

select ok(private.supported_submission_evidence_authority(
  'skillmap-worker/0.2.0', 'skillmap-static-audit/v2', 'codex-host/v1',
  'skillmap-worker/0.2.0', 'skillmap-rubric/v1', 'codex-host/v1',
  'skillmap-grader/0.1.0', 'skillmap-worker/0.2.0'
), 'the exact current tuple is supported');
select ok(not private.supported_submission_evidence_authority(
  'skillmap-worker/0.1.0', 'skillmap-static-audit/v2', 'codex-host/v1',
  'skillmap-worker/0.2.0', 'skillmap-rubric/v1', 'codex-host/v1',
  'skillmap-grader/0.1.0', 'skillmap-worker/0.2.0'
), 'a stale claim worker is unsupported');
select ok(not private.supported_submission_evidence_authority(
  'skillmap-worker/0.2.0', 'skillmap-static-audit/v1', 'codex-host/v1',
  'skillmap-worker/0.2.0', 'skillmap-rubric/v1', 'codex-host/v1',
  'skillmap-grader/0.1.0', 'skillmap-worker/0.2.0'
), 'a stale audit policy is unsupported');
select ok(not private.supported_submission_evidence_authority(
  'skillmap-worker/0.2.0', 'skillmap-static-audit/v2', 'codex/v1',
  'skillmap-worker/0.2.0', 'skillmap-rubric/v1', 'codex-host/v1',
  'skillmap-grader/0.1.0', 'skillmap-worker/0.2.0'
), 'a stale audit host profile is unsupported');
select ok(not private.supported_submission_evidence_authority(
  'skillmap-worker/0.2.0', 'skillmap-static-audit/v2', 'codex-host/v1',
  'skillmap-worker/0.1.0', 'skillmap-rubric/v1', 'codex-host/v1',
  'skillmap-grader/0.1.0', 'skillmap-worker/0.2.0'
), 'a stale audit worker binding is unsupported');
select ok(not private.supported_submission_evidence_authority(
  'skillmap-worker/0.2.0', 'skillmap-static-audit/v2', 'codex-host/v1',
  'skillmap-worker/0.2.0', 'skillmap-rubric/v2', 'codex-host/v1',
  'skillmap-grader/0.1.0', 'skillmap-worker/0.2.0'
), 'an unknown rubric is unsupported');
select ok(not private.supported_submission_evidence_authority(
  'skillmap-worker/0.2.0', 'skillmap-static-audit/v2', 'codex-host/v1',
  'skillmap-worker/0.2.0', 'skillmap-rubric/v1', 'codex/v1',
  'skillmap-grader/0.1.0', 'skillmap-worker/0.2.0'
), 'a stale grade host profile is unsupported');
select ok(not private.supported_submission_evidence_authority(
  'skillmap-worker/0.2.0', 'skillmap-static-audit/v2', 'codex-host/v1',
  'skillmap-worker/0.2.0', 'skillmap-rubric/v1', 'codex-host/v1',
  'skillmap-grader/0.2.0', 'skillmap-worker/0.2.0'
), 'an unknown evaluator is unsupported');
select ok(not private.supported_submission_evidence_authority(
  'skillmap-worker/0.2.0', 'skillmap-static-audit/v2', 'codex-host/v1',
  'skillmap-worker/0.2.0', 'skillmap-rubric/v1', 'codex-host/v1',
  'skillmap-grader/0.1.0', 'skillmap-worker/0.1.0'
), 'a stale retained worker run is unsupported');

select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'private.skill_audit_receipts'::regclass
    and conname = 'skill_audit_receipts_current_authority_check'
    and contype = 'c' and not convalidated
), 'new audit receipts enforce current authority without blessing historical rows');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'private.skill_grade_receipts'::regclass
    and conname = 'skill_grade_receipts_current_authority_check'
    and contype = 'c' and not convalidated
), 'new grade receipts enforce current authority without blessing historical rows');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'api.skill_submissions'::regclass
    and conname = 'skill_submissions_current_worker_authority_check'
    and contype = 'c' and not convalidated
), 'new claim-state changes enforce the current worker without relabeling old rows');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'private.worker_runs'::regclass
    and conname = 'worker_runs_current_authority_check'
    and contype = 'c' and not convalidated
), 'new worker runs enforce the current worker without rewriting historical rows');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
  'authenticated', 'authenticated', 'evidence-authority@skillmap.invalid', '', now(),
  '{"provider":"github","providers":["github"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

select lives_ok($$
  insert into api.skill_submissions (
    submitter_user_id, repository_url, source_commit, source_path, version_label,
    idempotency_key, authority_confirmed, untrusted_processing_accepted
  ) values (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
    'https://github.com/evidence-owner/authority-fixture', repeat('e', 40),
    'SKILL.md', '1.0.0', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6', true, true
  )
$$, 'a current-authority claim fixture is queued');

select public_id as authority_submission_id
from api.skill_submissions
where repository_url = 'https://github.com/evidence-owner/authority-fixture' \gset

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  format('select * from api.claim_skill_submission(%L,%L,300)',
    'skillmap-worker/0.1.0', :'authority_submission_id'),
  22023, 'worker version is unsupported',
  'a stale worker is rejected before claim mutation'
);
select throws_ok(
  format('select * from api.claim_skill_submission(%L,%L,300)',
    'skillmap-worker/0.3.0', :'authority_submission_id'),
  22023, 'worker version is unsupported',
  'an unknown future worker is rejected before claim mutation'
);
reset role;
select is(
  (select row(state, attempt_count, active_claim_id, current_worker_version)::text
   from api.skill_submissions where public_id = :'authority_submission_id'),
  '(queued,0,,)',
  'unsupported workers leave queue, attempt, lease, and worker authority unchanged'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as authority_claim_id
from api.claim_skill_submission('skillmap-worker/0.2.0', :'authority_submission_id', 300) \gset
select ok(:'authority_claim_id'::uuid is not null, 'the exact current worker can claim');
reset role;
select is(
  (select row(state, attempt_count, current_worker_version)::text
   from api.skill_submissions where public_id = :'authority_submission_id'),
  '(processing,1,skillmap-worker/0.2.0)',
  'the current worker owns exactly one bounded attempt'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  format($sql$select * from api.complete_skill_submission(
    %L, %L::uuid, 'skillmap-worker/0.2.0', 'accepted',
    'sha256:%s', 'sha256:%s',
    '{"policyVersion":"skillmap-static-audit/v1","hostProfileVersion":"codex-host/v1","workerVersion":"skillmap-worker/0.2.0"}'::jsonb,
    '{"rubricVersion":"skillmap-rubric/v1","hostProfileVersion":"codex-host/v1","evaluatorVersion":"skillmap-grader/0.1.0"}'::jsonb,
    '{}'::text[], null, 'sha256:%s')$sql$,
    :'authority_submission_id', :'authority_claim_id', repeat('1',64), repeat('2',64), repeat('3',64)),
  22023, 'submission evidence authority is unsupported',
  'completion rejects stale audit authority before payload retention'
);
select throws_ok(
  format($sql$select * from api.complete_skill_submission(
    %L, %L::uuid, 'skillmap-worker/0.2.0', 'accepted',
    'sha256:%s', 'sha256:%s',
    '{"policyVersion":"skillmap-static-audit/v2","hostProfileVersion":"codex/v1","workerVersion":"skillmap-worker/0.2.0"}'::jsonb,
    '{"rubricVersion":"skillmap-rubric/v1","hostProfileVersion":"codex-host/v1","evaluatorVersion":"skillmap-grader/0.1.0"}'::jsonb,
    '{}'::text[], null, 'sha256:%s')$sql$,
    :'authority_submission_id', :'authority_claim_id', repeat('1',64), repeat('2',64), repeat('4',64)),
  22023, 'submission evidence authority is unsupported',
  'completion rejects a wrong audit host before payload retention'
);
select throws_ok(
  format($sql$select * from api.complete_skill_submission(
    %L, %L::uuid, 'skillmap-worker/0.2.0', 'accepted',
    'sha256:%s', 'sha256:%s',
    '{"policyVersion":"skillmap-static-audit/v2","hostProfileVersion":"codex-host/v1","workerVersion":"skillmap-worker/0.2.0"}'::jsonb,
    '{"rubricVersion":"skillmap-rubric/v1","hostProfileVersion":"codex/v1","evaluatorVersion":"skillmap-grader/0.1.0"}'::jsonb,
    '{}'::text[], null, 'sha256:%s')$sql$,
    :'authority_submission_id', :'authority_claim_id', repeat('1',64), repeat('2',64), repeat('5',64)),
  22023, 'submission evidence authority is unsupported',
  'completion rejects a wrong grade host before payload retention'
);
select throws_ok(
  format($sql$select * from api.complete_skill_submission(
    %L, %L::uuid, 'skillmap-worker/0.2.0', 'accepted',
    'sha256:%s', 'sha256:%s',
    '{"policyVersion":"skillmap-static-audit/v2","hostProfileVersion":"codex-host/v1","workerVersion":"skillmap-worker/0.2.0"}'::jsonb,
    '{"rubricVersion":"skillmap-rubric/v1","hostProfileVersion":"codex-host/v1","evaluatorVersion":"skillmap-grader/0.2.0"}'::jsonb,
    '{}'::text[], null, 'sha256:%s')$sql$,
    :'authority_submission_id', :'authority_claim_id', repeat('1',64), repeat('2',64), repeat('6',64)),
  22023, 'submission evidence authority is unsupported',
  'completion rejects a wrong evaluator before payload retention'
);
reset role;
select is(
  (select count(*) from private.skill_audit_receipts receipt
    join api.skill_submissions submission on submission.id = receipt.submission_id
    where submission.public_id = :'authority_submission_id')
  + (select count(*) from private.skill_grade_receipts receipt
    join api.skill_submissions submission on submission.id = receipt.submission_id
    where submission.public_id = :'authority_submission_id')
  + (select count(*) from private.worker_runs worker_run
    join api.skill_submissions submission on submission.id = worker_run.submission_id
    where submission.public_id = :'authority_submission_id'),
  0::bigint,
  'rejected stale completion retains no audit, grade, or worker-run evidence'
);
select is(
  (select state from api.skill_submissions where public_id = :'authority_submission_id'),
  'processing',
  'rejected stale completion leaves the current claim retryable'
);

select * from finish();
rollback;
