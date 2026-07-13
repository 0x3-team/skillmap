begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

create function pg_temp.audit_payload(
  audit_state text,
  receipt_seed text,
  source_digest text,
  normalized_digest text,
  worker_version text
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'state', audit_state,
    'receiptDigest', 'sha256:' || repeat(receipt_seed, 64),
    'sourceContentDigest', source_digest,
    'normalizedContentDigest', normalized_digest,
    'policyVersion', 'skillmap-static-audit/v1',
    'hostProfileVersion', 'codex-host/v1',
    'workerVersion', worker_version,
    'findingCounts', case when audit_state = 'blocked'
      then '{"critical":0,"high":1,"medium":0,"low":0,"info":0}'::jsonb
      else '{"critical":0,"high":0,"medium":0,"low":0,"info":0}'::jsonb end,
    'publicChecks', case when audit_state = 'blocked'
      then '[{"code":"invalid-frontmatter","outcome":"blocked","severity":"high","evidenceDigest":null}]'::jsonb
      else '[{"code":"static-audit-complete","outcome":"passed","severity":"info","evidenceDigest":null}]'::jsonb end,
    'reasonCodes', case when audit_state = 'blocked'
      then '["invalid-frontmatter"]'::jsonb else '[]'::jsonb end,
    'privateEvidenceDigest', 'sha256:' || repeat('f', 64),
    'licenseState', 'confirmed',
    'spdxExpression', 'MIT',
    'permissionScripts', false,
    'networkIndicators', false,
    'toolIndicators', false
  );
$$;

create function pg_temp.grade_payload(
  grade_state text,
  receipt_seed text,
  audit_digest text,
  normalized_digest text,
  compatibility_digest text
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'state', grade_state,
    'receiptDigest', 'sha256:' || repeat(receipt_seed, 64),
    'totalScore', case when grade_state = 'provisional' then 82 else null end,
    'confidence', case when grade_state = 'provisional' then 0.35 else null end,
    'normalizedContentDigest', normalized_digest,
    'auditReceiptDigest', audit_digest,
    'compatibilityEvidenceDigest', compatibility_digest,
    'evaluationSuiteDigest', null,
    'rubricVersion', 'skillmap-rubric/v1',
    'hostProfileVersion', 'codex-host/v1',
    'evaluatorVersion', 'skillmap-grader/0.1.0',
    'hardGates', jsonb_build_array(
      jsonb_build_object('code','source-identity','passed',true,'evidenceDigest','sha256:' || repeat('1',64)),
      jsonb_build_object('code','audit-acceptable','passed',grade_state = 'provisional','evidenceDigest',audit_digest),
      jsonb_build_object('code','license-confirmed','passed',true,'evidenceDigest',audit_digest),
      jsonb_build_object('code','compatibility-evidence-bound','passed',compatibility_digest is not null,'evidenceDigest',compatibility_digest),
      jsonb_build_object('code','behavioral-evidence-bound','passed',false,'evidenceDigest',null)
    ),
    'dimensions', jsonb_build_array(
      jsonb_build_object('code','instruction-quality','weight',0.25,'score',82,'evidenceDigest',audit_digest),
      jsonb_build_object('code','safety-and-permissions','weight',0.25,'score',82,'evidenceDigest',audit_digest),
      jsonb_build_object('code','routing-quality','weight',0.20,'score',82,'evidenceDigest',audit_digest),
      jsonb_build_object('code','reproducibility','weight',0.15,'score',82,'evidenceDigest',audit_digest),
      jsonb_build_object('code','maintenance-and-provenance','weight',0.15,'score',82,'evidenceDigest',audit_digest)
    ),
    'reasonCodes', case when grade_state = 'provisional'
      then '["behavioral-evidence-incomplete"]'::jsonb
      else '["audit-blocked","compatibility-receipt-missing","grade-blocked"]'::jsonb end
  );
$$;

select plan(31);

select has_table('private', 'submission_collision_reviews', 'immutable collision review receipt table exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'submission_collision_reviews'), 'collision review receipts force RLS');
select ok(has_function_privilege('service_role', 'api.dead_letter_expired_skill_submission(text,text)', 'execute'), 'service role can terminalize an expired max-attempt claim');
select ok(not has_function_privilege('authenticated', 'api.dead_letter_expired_skill_submission(text,text)', 'execute'), 'browser users cannot dead-letter claims');
select ok(has_function_privilege('service_role', 'api.list_skill_submission_collisions(text)', 'execute'), 'service role can read bounded collision evidence');
select ok(not has_function_privilege('authenticated', 'api.list_skill_submission_collisions(text)', 'execute'), 'browser users cannot read operator collision evidence');
select ok(has_function_privilege('service_role', 'api.review_skill_submission_collisions(text,text,text,text)', 'execute'), 'service role can record collision review');
select ok(not has_function_privilege('authenticated', 'api.review_skill_submission_collisions(text,text,text,text)', 'execute'), 'browser users cannot disposition collisions');
select ok(private.grade_allows_missing_compatibility(
  'blocked', null,
  '[{"code":"compatibility-evidence-bound","passed":false,"evidenceDigest":null}]'::jsonb
), 'blocked grade may omit compatibility only with the exact failed hard gate');
select ok(not private.grade_allows_missing_compatibility(
  'provisional', null,
  '[{"code":"compatibility-evidence-bound","passed":false,"evidenceDigest":null}]'::jsonb
), 'provisional grade cannot omit compatibility evidence');

-- Simulate a fifth claimed attempt whose worker was killed before completion.
insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'a0000000-0000-4000-8000-000000000001', 'sub_a0000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/recovery-owner/exhausted',
  repeat('a',40), 'SKILL.md', '1.0.0', 'a0000000-0000-4000-8000-000000000002',
  'public-alpha-draft/v1', true, true
);
update api.skill_submissions set state = 'processing',
  active_claim_id = 'a0000000-0000-4000-8000-000000000003',
  current_worker_version = 'skillmap-worker/0.1.0', attempt_count = 5,
  claimed_at = now() - interval '2 minutes', claim_expires_at = now() + interval '1 minute'
where id = 'a0000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select throws_ok($$select * from api.dead_letter_expired_skill_submission(
  'sub_a0000000000000000000000000000001','sha256:' || repeat('1',64))$$,
  42501, null, 'authenticated users cannot invoke dead-letter recovery');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from api.dead_letter_expired_skill_submission(
  'sub_a0000000000000000000000000000001','sha256:' || repeat('1',64))$$,
  55000, 'only an exact expired max-attempt claim can be dead-lettered', 'a live fifth claim cannot be terminalized');
reset role;
update api.skill_submissions set claim_expires_at = now() - interval '1 minute'
where id = 'a0000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select submission_state from api.dead_letter_expired_skill_submission(
  'sub_a0000000000000000000000000000001','sha256:' || repeat('1',64))),
  'failed', 'expired attempt five reaches a supported terminal state');
select is((select submission_state || ':' || attempt_count from api.dead_letter_expired_skill_submission(
  'sub_a0000000000000000000000000000001','sha256:' || repeat('1',64))),
  'failed:5', 'dead-letter replay is idempotent');
select throws_ok($$select * from api.dead_letter_expired_skill_submission(
  'sub_a0000000000000000000000000000001','sha256:' || repeat('2',64))$$,
  55000, 'only an exact expired max-attempt claim can be dead-lettered', 'changed dead-letter replay conflicts with terminal evidence');
reset role;
select is((select outcome || ':' || error_code from private.worker_runs where id = 'a0000000-0000-4000-8000-000000000003'), 'cancelled:RETRY_LIMIT_EXHAUSTED', 'dead-lettering appends a cancelled worker receipt');
select is((select count(*) from private.submission_events where submission_id = 'a0000000-0000-4000-8000-000000000001' and to_state = 'failed' and transition_digest = 'sha256:' || repeat('1',64)), 1::bigint, 'dead-lettering appends one digest-bound transition event');

-- Real adapter shape for malformed frontmatter: blocked grade, null compatibility.
insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'b0000000-0000-4000-8000-000000000001', 'sub_b0000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/audit-owner/malformed',
  repeat('b',40), 'SKILL.md', '1.0.0', 'b0000000-0000-4000-8000-000000000002',
  'public-alpha-draft/v1', true, true
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as blocked_claim_id from api.claim_skill_submission(
  'skillmap-worker/0.1.0','sub_b0000000000000000000000000000001',300) \gset
select is((select submission_state from api.complete_skill_submission(
  'sub_b0000000000000000000000000000001', :'blocked_claim_id'::uuid,
  'skillmap-worker/0.1.0', 'changes-requested', 'sha256:' || repeat('3',64),
  'sha256:' || repeat('4',64),
  pg_temp.audit_payload('blocked','5','sha256:' || repeat('6',64),'sha256:' || repeat('7',64),'skillmap-worker/0.1.0'),
  pg_temp.grade_payload('blocked','8','sha256:' || repeat('5',64),'sha256:' || repeat('7',64),null),
  array['invalid-frontmatter'], 'Repair the malformed frontmatter before resubmission.',
  'sha256:' || repeat('9',64))), 'changes-requested', 'blocked worker adapter evidence persists transactionally');
reset role;
select is((select compatibility_evidence_digest from private.skill_grade_receipts where submission_id = 'b0000000-0000-4000-8000-000000000001'), null, 'blocked failed-compatibility receipt retains an explicit null digest');
select is((select collision_evidence ->> 'status' from private.review_cases where submission_id = 'b0000000-0000-4000-8000-000000000001'), 'bound', 'completion-time collision evidence binds the new audit receipt before submission projection update');

-- A positive submission intentionally reuses the current public skill-audit bytes.
insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'c0000000-0000-4000-8000-000000000001', 'sub_c0000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/copy-owner/copied-skill',
  repeat('c',40), 'SKILL.md', '1.0.0', 'c0000000-0000-4000-8000-000000000002',
  'public-alpha-draft/v1', true, true
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as collision_claim_id from api.claim_skill_submission(
  'skillmap-worker/0.1.0','sub_c0000000000000000000000000000001',300) \gset
select is((select submission_state from api.complete_skill_submission(
  'sub_c0000000000000000000000000000001', :'collision_claim_id'::uuid,
  'skillmap-worker/0.1.0', 'accepted', 'sha256:' || repeat('a',64),
  'sha256:' || repeat('b',64),
  pg_temp.audit_payload('passed','c','sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a','sha256:' || repeat('d',64),'skillmap-worker/0.1.0'),
  pg_temp.grade_payload('provisional','e','sha256:' || repeat('c',64),'sha256:' || repeat('d',64),'sha256:' || repeat('f',64)),
  '{}'::text[], null, 'sha256:' || repeat('0',64))), 'accepted', 'duplicate-content fixture completes with positive static evidence');
reset role;
select ok((select (collision_evidence ->> 'totalMatches')::integer > 0 from private.review_cases where submission_id = 'c0000000-0000-4000-8000-000000000001'), 'completion review records the existing catalog content match');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select ok((select collision_found from api.list_skill_submission_collisions('sub_c0000000000000000000000000000001')), 'bounded service lookup reports the collision');
select throws_ok($$select * from api.publish_skill_submission(
  'sub_c0000000000000000000000000000001','sha256:' || repeat('1',64),
  'copy-owner','Copy Owner','copied-skill','Copied Skill','Reviewed copy fixture.',
  'A metadata-only collision enforcement fixture.',array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication requires an explicit current collision disposition', 'publication cannot silently publish copied content');
select is((select disposition from api.review_skill_submission_collisions(
  'sub_c0000000000000000000000000000001','approved-distinct','manual-source-review','sha256:' || repeat('2',64))),
  'approved-distinct', 'operator records an explicit digest-bound collision disposition');
select is((select disposition from api.review_skill_submission_collisions(
  'sub_c0000000000000000000000000000001','approved-distinct','manual-source-review','sha256:' || repeat('2',64))),
  'approved-distinct', 'exact collision review replay is idempotent');
select throws_ok($$select * from api.review_skill_submission_collisions(
  'sub_c0000000000000000000000000000001','approved-distinct','changed-review-reason','sha256:' || repeat('2',64))$$,
  23505, 'collision review idempotency digest conflicts with another decision', 'changed collision review replay conflicts');
reset role;
select throws_ok($$update private.submission_collision_reviews set reason_code = 'tampered'$$,
  55000, null, 'collision review receipts are append-only');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select submission_state from api.publish_skill_submission(
  'sub_c0000000000000000000000000000001','sha256:' || repeat('1',64),
  'copy-owner','Copy Owner','copied-skill','Copied Skill','Reviewed copy fixture.',
  'A metadata-only collision enforcement fixture.',array['review.audit'],'confirmed','MIT',false,'{}','{}')),
  'published', 'explicit approved collision disposition unlocks transactional publication');
reset role;
select is((select count(*) from api.catalog_skills where publisher_handle = 'copy-owner' and slug = 'copied-skill'), 1::bigint, 'reviewed copy publishes exactly one current catalog row');
select is((select count(*) from private.submission_collision_reviews where submission_id = 'c0000000-0000-4000-8000-000000000001'), 1::bigint, 'publication retains exactly one immutable collision review receipt');

select * from finish();
rollback;
