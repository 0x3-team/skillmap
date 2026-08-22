begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

-- Legacy behavioral assertions exercise the relocated implementations directly.
-- The transaction-local grants/default never exist outside this pgTAP session;
-- dual-control wrapper behavior is covered in operator_dual_control.test.sql.
grant usage on schema private to service_role;
grant execute on function private.record_skill_submission_publisher_authorization_unchecked(text,text,text,text,text,text,timestamptz,text) to service_role;
grant execute on function private.review_skill_submission_collisions_unchecked(text,text,text,text,text,text,text) to service_role;
grant execute on function private.publish_skill_submission_unchecked(text,text,text,text,text,text,text,text,text[],text,text,boolean,text[],text[]) to service_role;
grant execute on function private.control_catalog_lifecycle_unchecked(text,text,text,text,text) to service_role;
alter table private.audit_events alter column operator_attribution_required set default false;

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
    'policyVersion', 'skillmap-static-audit/v2',
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

grant execute on function pg_temp.audit_payload(text,text,text,text,text) to service_role;
grant execute on function pg_temp.grade_payload(text,text,text,text,text) to service_role;

select plan(125);

select has_table('private', 'submission_collision_reviews', 'immutable collision review receipt table exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'submission_collision_reviews'), 'collision review receipts force RLS');
select has_table('private', 'submission_publisher_authorization_receipts', 'publisher authorization receipt table exists');
select has_table('private', 'publisher_authorization_revocation_tombstones', 'durable exact-source revocation tombstone table exists');
select has_table('private', 'submission_license_evidence_receipts', 'license evidence receipt table exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'submission_publisher_authorization_receipts'), 'publisher authorization receipts force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'publisher_authorization_revocation_tombstones'), 'revocation tombstones force RLS');
select ok(not has_table_privilege('anon', 'private.publisher_authorization_revocation_tombstones', 'select'), 'anonymous clients cannot read revocation tombstones');
select ok(not has_table_privilege('service_role', 'private.publisher_authorization_revocation_tombstones', 'select'), 'service clients cannot bypass the tombstone RPC boundary');
select ok(not exists (
  select 1 from pg_constraint
  where conrelid = 'private.publisher_authorization_revocation_tombstones'::regclass
    and contype = 'f'
), 'revocation tombstones have no account or submission cascade foreign key');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'submission_license_evidence_receipts'), 'license evidence receipts force RLS');
select ok(has_function_privilege('service_role', 'api.record_skill_submission_publisher_authorization(text,text,text,text,text,text,timestamptz,text)', 'execute'), 'service role can append publisher authorization evidence');
select ok(not has_function_privilege('authenticated', 'api.record_skill_submission_publisher_authorization(text,text,text,text,text,text,timestamptz,text)', 'execute'), 'browser users cannot append publisher authorization evidence');
select ok(has_function_privilege('service_role', 'api.record_skill_submission_license_evidence(text,uuid,text,text,text,jsonb,text,text,text)', 'execute'), 'service role can append exact-claim license evidence');
select ok(not has_function_privilege('authenticated', 'api.record_skill_submission_license_evidence(text,uuid,text,text,text,jsonb,text,text,text)', 'execute'), 'browser users cannot append license evidence');
select ok(has_function_privilege('service_role', 'api.dead_letter_expired_skill_submission(text,text)', 'execute'), 'service role can terminalize an expired max-attempt claim');
select ok(not has_function_privilege('authenticated', 'api.dead_letter_expired_skill_submission(text,text)', 'execute'), 'browser users cannot dead-letter claims');
select ok(has_function_privilege('service_role', 'api.list_skill_submission_collisions(text)', 'execute'), 'service role can read bounded collision evidence');
select ok(not has_function_privilege('authenticated', 'api.list_skill_submission_collisions(text)', 'execute'), 'browser users cannot read operator collision evidence');
select ok(has_function_privilege('service_role', 'api.review_skill_submission_collisions(text,text,text,text,text,text,text)', 'execute'), 'service role can record target-bound collision review');
select ok(not has_function_privilege('authenticated', 'api.review_skill_submission_collisions(text,text,text,text,text,text,text)', 'execute'), 'browser users cannot disposition collisions');
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
  current_worker_version = 'skillmap-worker/0.2.0', attempt_count = 5,
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
  'skillmap-worker/0.2.0','sub_b0000000000000000000000000000001',300) \gset
select is((select submission_state from api.complete_skill_submission(
  'sub_b0000000000000000000000000000001', :'blocked_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'changes-requested', 'sha256:' || repeat('3',64),
  'sha256:' || repeat('4',64),
  pg_temp.audit_payload('blocked','5','sha256:' || repeat('6',64),'sha256:' || repeat('7',64),'skillmap-worker/0.2.0'),
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
  'skillmap-worker/0.2.0','sub_c0000000000000000000000000000001',300) \gset
select set_config('skillmap.test_collision_claim_id', :'collision_claim_id', true);
select throws_ok($$select * from api.record_skill_submission_license_evidence(
  'sub_c0000000000000000000000000000001', current_setting('skillmap.test_collision_claim_id')::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('c',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/copy-owner/copied-skill',
    'sourceCommit',repeat('c',40),'path','../LICENSE',
    'contentDigest','sha256:' || repeat('1',64)
  )), 'licref_' || repeat('2',32), 'sha256:' || repeat('2',64),
  'sha256:' || repeat('6',64))$$,
  22023, 'license evidence does not match the exact submitted source',
  'license evidence rejects traversal before persistence');
select throws_ok($$select * from api.record_skill_submission_license_evidence(
  'sub_c0000000000000000000000000000001', current_setting('skillmap.test_collision_claim_id')::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('c',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/other-owner/other-skill',
    'sourceCommit',repeat('c',40),'path','LICENSE',
    'contentDigest','sha256:' || repeat('1',64)
  )), 'licref_' || repeat('2',32), 'sha256:' || repeat('2',64),
  'sha256:' || repeat('7',64))$$,
  22023, 'license evidence does not match the exact submitted source',
  'license evidence rejects a mismatched repository identity');
select throws_ok($$select * from api.record_skill_submission_license_evidence(
  'sub_c0000000000000000000000000000001', current_setting('skillmap.test_collision_claim_id')::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('c',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/copy-owner/copied-skill',
    'sourceCommit',repeat('c',40),'path','LICENSE',
    'contentDigest',null
  )), 'licref_' || repeat('2',32), 'sha256:' || repeat('2',64),
  'sha256:' || repeat('9',64))$$,
  22023, 'license evidence does not match the exact submitted source',
  'confirmed license evidence rejects a JSON-null exact-byte digest');
reset role;
select is((select count(*) from private.submission_license_evidence_receipts
  where submission_id = 'c0000000-0000-4000-8000-000000000001'),
  0::bigint, 'invalid null-digest evidence cannot persist or authorize publication');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select license_evidence_receipt_id as collision_license_receipt_id
from api.record_skill_submission_license_evidence(
  'sub_c0000000000000000000000000000001', :'collision_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('c',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/copy-owner/copied-skill',
    'sourceCommit',repeat('c',40),'path','LICENSE',
    'contentDigest','sha256:' || repeat('1',64)
  )), 'licref_' || repeat('2',32), 'sha256:' || repeat('2',64),
  'sha256:' || repeat('3',64)
) \gset
select throws_ok($sql$select * from api.complete_skill_submission(
  'sub_c0000000000000000000000000000001',
  current_setting('skillmap.test_collision_claim_id')::uuid,
  'skillmap-worker/0.2.0', 'accepted',
  'sha256:' || encode(digest('null-severity-input','sha256'),'hex'),
  'sha256:' || encode(digest('null-severity-result','sha256'),'hex'),
  jsonb_set(
    pg_temp.audit_payload('passed','c',
      'sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a',
      'sha256:' || repeat('d',64),'skillmap-worker/0.2.0'),
    '{publicChecks,0,severity}', 'null'::jsonb, false
  ),
  pg_temp.grade_payload('provisional','e','sha256:' || repeat('c',64),
    'sha256:' || repeat('d',64),'sha256:' || repeat('f',64)),
  '{}'::text[], null,
  'sha256:' || encode(digest('null-severity-completion','sha256'),'hex'))$sql$,
  22023, 'receipt payload contradicts the public-alpha audit or grade authority',
  'audit public checks reject a JSON-null severity scalar');
select throws_ok($sql$select * from api.complete_skill_submission(
  'sub_c0000000000000000000000000000001',
  current_setting('skillmap.test_collision_claim_id')::uuid,
  'skillmap-worker/0.2.0', 'accepted',
  'sha256:' || encode(digest('null-outcome-input','sha256'),'hex'),
  'sha256:' || encode(digest('null-outcome-result','sha256'),'hex'),
  jsonb_set(
    pg_temp.audit_payload('passed','c',
      'sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a',
      'sha256:' || repeat('d',64),'skillmap-worker/0.2.0'),
    '{publicChecks,0,outcome}', 'null'::jsonb, false
  ),
  pg_temp.grade_payload('provisional','e','sha256:' || repeat('c',64),
    'sha256:' || repeat('d',64),'sha256:' || repeat('f',64)),
  '{}'::text[], null,
  'sha256:' || encode(digest('null-outcome-completion','sha256'),'hex'))$sql$,
  22023, 'receipt payload contradicts the public-alpha audit or grade authority',
  'audit public checks reject a JSON-null outcome scalar');
select throws_ok($sql$select * from api.complete_skill_submission(
  'sub_c0000000000000000000000000000001',
  current_setting('skillmap.test_collision_claim_id')::uuid,
  'skillmap-worker/0.2.0', 'changes-requested',
  'sha256:' || encode(digest('invalid-failed-gate-input','sha256'),'hex'),
  'sha256:' || encode(digest('invalid-failed-gate-result','sha256'),'hex'),
  pg_temp.audit_payload('blocked','1',
    'sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a',
    'sha256:' || repeat('d',64),'skillmap-worker/0.2.0'),
  jsonb_set(
    pg_temp.grade_payload('blocked','2','sha256:' || repeat('1',64),
      'sha256:' || repeat('d',64),'sha256:' || repeat('f',64)),
    '{hardGates,1,evidenceDigest}', to_jsonb('not-a-digest'::text), false
  ),
  array['invalid-frontmatter'], 'Repair the malformed frontmatter before resubmission.',
  'sha256:' || encode(digest('invalid-failed-gate-completion','sha256'),'hex'))$sql$,
  22023, 'receipt payload contradicts the public-alpha audit or grade authority',
  'failed hard gates reject a non-null evidence value that is not a sha256 digest');
reset role;
select is(
  (select count(*) from private.skill_audit_receipts
    where submission_id = 'c0000000-0000-4000-8000-000000000001')
  + (select count(*) from private.skill_grade_receipts
    where submission_id = 'c0000000-0000-4000-8000-000000000001'),
  0::bigint, 'malformed audit and grade payloads persist no receipt authority');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select submission_state from api.complete_skill_submission(
  'sub_c0000000000000000000000000000001', :'collision_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'accepted', 'sha256:' || repeat('a',64),
  'sha256:' || repeat('b',64),
  pg_temp.audit_payload('passed','c','sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a','sha256:' || repeat('d',64),'skillmap-worker/0.2.0'),
  pg_temp.grade_payload('provisional','e','sha256:' || repeat('c',64),'sha256:' || repeat('d',64),'sha256:' || repeat('f',64)),
  '{}'::text[], null, 'sha256:' || repeat('0',64))), 'accepted', 'duplicate-content fixture completes with positive static evidence');
select throws_ok($$select * from api.record_skill_submission_license_evidence(
  'sub_c0000000000000000000000000000001', current_setting('skillmap.test_collision_claim_id')::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('8',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/copy-owner/copied-skill',
    'sourceCommit',repeat('c',40),'path','LICENSE',
    'contentDigest','sha256:' || repeat('8',64)
  )), 'licref_' || repeat('8',32), 'sha256:' || repeat('8',64),
  'sha256:' || repeat('8',64))$$,
  55000, 'license evidence claim is stale, expired, or unauthorized',
  'license evidence cannot be appended after claim completion');
reset role;
select is((select count(*) from private.submission_license_evidence_receipts where submission_id = 'c0000000-0000-4000-8000-000000000001'), 1::bigint, 'exact license evidence persists once for the completed audit digest');
select ok((select (collision_evidence ->> 'totalMatches')::integer > 0 from private.review_cases where submission_id = 'c0000000-0000-4000-8000-000000000001'), 'completion review records the existing catalog content match');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select ok((select collision_found from api.list_skill_submission_collisions('sub_c0000000000000000000000000000001')), 'bounded service lookup reports the collision');
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_c0000000000000000000000000000001','sha256:' || repeat('1',64),
  'copy-owner','Copy Owner','copied-skill','Copied Skill','Reviewed copy fixture.',
  'A metadata-only collision enforcement fixture.',array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication requires an explicit current target-bound collision disposition', 'publication cannot silently publish copied content');
select is((select disposition from private.review_skill_submission_collisions_unchecked(
  'sub_c0000000000000000000000000000001','approved-distinct','manual-source-review',null,null,null,'sha256:' || repeat('2',64))),
  'approved-distinct', 'operator records an explicit digest-bound collision disposition');
select is((select disposition from private.review_skill_submission_collisions_unchecked(
  'sub_c0000000000000000000000000000001','approved-distinct','manual-source-review',null,null,null,'sha256:' || repeat('2',64))),
  'approved-distinct', 'exact collision review replay is idempotent');
select throws_ok($$select * from private.review_skill_submission_collisions_unchecked(
  'sub_c0000000000000000000000000000001','approved-distinct','changed-review-reason',null,null,null,'sha256:' || repeat('2',64))$$,
  23505, 'collision review idempotency digest conflicts with another decision', 'changed collision review replay conflicts');
reset role;
select throws_ok($$update private.submission_collision_reviews set reason_code = 'tampered'$$,
  55000, null, 'collision review receipts are append-only');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_c0000000000000000000000000000001','sha256:' || repeat('1',64),
  'copy-owner','Copy Owner','copied-skill','Copied Skill','Reviewed copy fixture.',
  'A metadata-only collision enforcement fixture.',array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication requires current exact-source publisher authorization',
  'submitter self-attestation cannot substitute for reviewed publisher authorization');
select authorization_receipt_id as wrong_authorization_receipt_id
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_c0000000000000000000000000000001','other-owner','authorized','publisher-consent',
  'authref_' || repeat('3',32),'sha256:' || repeat('3',64),
  now() + interval '30 days','sha256:' || repeat('3',64)
) \gset
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_c0000000000000000000000000000001','sha256:' || repeat('1',64),
  'copy-owner','Copy Owner','copied-skill','Copied Skill','Reviewed copy fixture.',
  'A metadata-only collision enforcement fixture.',array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication requires current exact-source publisher authorization',
  'authorization for another publisher identity cannot authorize publication');
select authorization_receipt_id as collision_authorization_receipt_id
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_c0000000000000000000000000000001','copy-owner','authorized','publisher-consent',
  'authref_' || repeat('4',32),'sha256:' || repeat('4',64),
  now() + interval '30 days','sha256:' || repeat('4',64)
) \gset
select is((select submission_state from private.publish_skill_submission_unchecked(
  'sub_c0000000000000000000000000000001','sha256:' || repeat('1',64),
  'copy-owner','Copy Owner','copied-skill','Copied Skill','Reviewed copy fixture.',
  'A metadata-only collision enforcement fixture.',array['review.audit'],'confirmed','MIT',false,'{}','{}')),
  'published', 'explicit approved collision disposition unlocks transactional publication');
reset role;
select is((select count(*) from api.catalog_skills where publisher_handle = 'copy-owner' and slug = 'copied-skill'), 1::bigint, 'reviewed copy publishes exactly one current catalog row');
select is((select license_files::text from private.skill_versions where source_submission_id = 'c0000000-0000-4000-8000-000000000001'), '{LICENSE}', 'published version exposes only the exact reviewed license evidence paths');
select is((select count(*) from private.submission_collision_reviews where submission_id = 'c0000000-0000-4000-8000-000000000001'), 1::bigint, 'publication retains exactly one immutable collision review receipt');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_c0000000000000000000000000000001','other-owner','revoked',null,
  'authref_' || repeat('8',32),'sha256:' || repeat('8',64),null,
  'sha256:' || repeat('8',64))$$,
  55000, 'published authorization revocation must match and block the exact source publisher version',
  'a mismatched publisher revocation cannot append a passive receipt or mutate the listing');
reset role;
select is((select row(publication_state, quarantined_at is null, revoked_at is null)::text
  from private.skill_versions
  where source_submission_id = 'c0000000-0000-4000-8000-000000000001'),
  '(published,t,t)', 'wrong-handle revocation leaves the exact published version unchanged');
select is((select count(*) from private.submission_publisher_authorization_receipts
  where submission_id = 'c0000000-0000-4000-8000-000000000001'
    and publisher_handle = 'other-owner' and decision = 'revoked'), 0::bigint,
  'wrong-handle revocation leaves no passive authorization receipt');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select authorization_decision from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_c0000000000000000000000000000001','copy-owner','revoked',null,
  'authref_' || repeat('9',32),'sha256:' || repeat('9',64),null,
  'sha256:' || repeat('9',64))), 'revoked',
  'publisher consent withdrawal appends an explicit revocation receipt');
reset role;
select is((select row(publication_state, quarantined_at is not null, revoked_at is not null)::text
  from private.skill_versions
  where source_submission_id = 'c0000000-0000-4000-8000-000000000001'),
  '(blocked,t,t)', 'published consent withdrawal atomically blocks and revokes the exact source version');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_c0000000000000000000000000000001','sha256:' || repeat('1',64),
  'copy-owner','Copy Owner','copied-skill','Copied Skill','Reviewed copy fixture.',
  'A metadata-only collision enforcement fixture.',array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication replay no longer has current exact-source authority',
  'published-state idempotency replay cannot report success after terminal revocation');
reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is((select count(*) from api.catalog_skills
  where publisher_handle = 'copy-owner' and slug = 'copied-skill'), 0::bigint,
  'a publisher-revoked source version cannot remain visible in the public catalog');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_c0000000000000000000000000000001','copy-owner','authorized','publisher-consent',
  'authref_' || repeat('a',32),'sha256:' || repeat('a',64),
  now() + interval '30 days','sha256:' || repeat('a',64))$$,
  55000, 'publisher authorization revocation is terminal for the exact source',
  'explicit revocation is terminal and a blocked exact version cannot be renewed');
reset role;
select is((select count(*) from private.submission_publisher_authorization_receipts
  where submission_id = 'c0000000-0000-4000-8000-000000000001'
    and evidence_reference = 'authref_' || repeat('a',32)), 0::bigint,
  'blocked-version renewal rolls back without appending an authorization receipt');

-- A same-repository follow-up proves approved-update is bound to the exact
-- publisher, skill, and still-current version selected during review.
insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'd0000000-0000-4000-8000-000000000001', 'sub_d0000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/0x3-team/skillmap',
  repeat('9',40), 'incoming/SKILL.md', '2.0.0',
  'd0000000-0000-4000-8000-000000000002', 'public-alpha-draft/v1', true, true
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as update_claim_id from api.claim_skill_submission(
  'skillmap-worker/0.2.0','sub_d0000000000000000000000000000001',300
) \gset
select set_config('skillmap.test_update_claim_id', :'update_claim_id', true);
select throws_ok($$select * from api.record_skill_submission_license_evidence(
  'sub_d0000000000000000000000000000001', current_setting('skillmap.test_update_claim_id')::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('7',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/0x3-team/skillmap',
    'sourceCommit',repeat('9',40),'path','unrelated/LICENSE',
    'contentDigest','sha256:' || repeat('7',64)
  )), 'licref_' || repeat('7',32), 'sha256:' || repeat('7',64),
  'sha256:' || repeat('8',64))$$,
  22023, 'license evidence does not match the exact submitted source',
  'license evidence rejects a sibling path that does not enclose the submitted skill');
select license_evidence_receipt_id as update_license_receipt_id
from api.record_skill_submission_license_evidence(
  'sub_d0000000000000000000000000000001', :'update_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('7',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/0x3-team/skillmap',
    'sourceCommit',repeat('9',40),'path','LICENSE',
    'contentDigest','sha256:' || repeat('7',64)
  )), 'licref_' || repeat('7',32), 'sha256:' || repeat('7',64),
  'sha256:' || repeat('7',64)
) \gset
select submission_state as update_completion_state from api.complete_skill_submission(
  'sub_d0000000000000000000000000000001', :'update_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'accepted', 'sha256:' || repeat('6',64),
  'sha256:' || repeat('7',64),
  pg_temp.audit_payload('passed','7','sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a','sha256:' || repeat('9',64),'skillmap-worker/0.2.0'),
  pg_temp.grade_payload('provisional','8','sha256:' || repeat('7',64),'sha256:' || repeat('9',64),'sha256:' || repeat('a',64)),
  '{}'::text[], null, 'sha256:' || repeat('b',64)
) \gset
select authorization_receipt_id as update_authorization_receipt_id
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_d0000000000000000000000000000001','0x3-team','authorized','publisher-owner-approval',
  'authref_' || repeat('7',32),'sha256:' || repeat('c',64),
  now() + interval '30 days','sha256:' || repeat('c',64)
) \gset
select throws_ok($$select * from private.review_skill_submission_collisions_unchecked(
  'sub_d0000000000000000000000000000001','approved-update','reviewed-version-update',
  null,null,null,'sha256:' || repeat('d',64))$$,
  22023, 'collision review request is invalid',
  'approved-update rejects a missing target tuple');
select throws_ok($$select * from private.review_skill_submission_collisions_unchecked(
  'sub_d0000000000000000000000000000001','approved-update','reviewed-version-update',
  'pub_00000000000000000000000000000001',
  'skl_00000000000000000000000000000002',
  'skv_00000000000000000000000000000002',
  'sha256:' || repeat('e',64))$$,
  22023, 'approved update target is not the exact current collision identity',
  'approved-update rejects a valid catalog identity absent from collision evidence');
select is((select disposition from private.review_skill_submission_collisions_unchecked(
  'sub_d0000000000000000000000000000001','approved-update','reviewed-version-update',
  'pub_00000000000000000000000000000001',
  'skl_00000000000000000000000000000001',
  'skv_00000000000000000000000000000001',
  'sha256:' || repeat('f',64))), 'approved-update',
  'approved-update records the exact current collision target tuple');
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_d0000000000000000000000000000001','sha256:' || repeat('0',64),
  '0x3-team','0x3 Team','skill-quality-review','Skill Quality Review',
  'Wrong target fixture.','This update intentionally selects the wrong reviewed skill.',
  array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication identity does not match the exact approved update target',
  'publication cannot redirect an approved update to another skill identity');
select is((select submission_state from private.publish_skill_submission_unchecked(
  'sub_d0000000000000000000000000000001','sha256:' || repeat('0',64),
  '0x3-team','0x3 Team','skill-audit','Skill Audit',
  'Reviewed exact-target update fixture.',
  'This metadata-only version proves target-bound collision update authority.',
  array['review.audit'],'confirmed','MIT',false,'{}','{}')),
  'published', 'exact publisher, skill, and current-version target permits publication');
reset role;

-- A worker crash after the license receipt but before completion must not make
-- a deterministic audit digest unretryable. Both receipts remain append-only,
-- while publication admits only the claim that actually completed.
insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'e0000000-0000-4000-8000-000000000001', 'sub_e0000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/retry-owner/nested-skill',
  repeat('e',40), 'skills/retry/SKILL.md', '1.0.0',
  'e0000000-0000-4000-8000-000000000002', 'public-alpha-draft/v1', true, true
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as retry_claim_a from api.claim_skill_submission(
  'skillmap-worker/0.2.0','sub_e0000000000000000000000000000001',300
) \gset
select license_evidence_receipt_id as retry_license_receipt_a
from api.record_skill_submission_license_evidence(
  'sub_e0000000000000000000000000000001', :'retry_claim_a'::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('6',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/retry-owner/nested-skill',
    'sourceCommit',repeat('e',40),'path','LICENSE',
    'contentDigest','sha256:' || repeat('4',64)
  )), 'licref_' || repeat('4',32), 'sha256:' || repeat('4',64),
  'sha256:' || repeat('4',64)
) \gset
reset role;
update api.skill_submissions set claimed_at = now() - interval '2 minutes',
  claim_expires_at = now() - interval '1 second'
where id = 'e0000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as retry_claim_b from api.claim_skill_submission(
  'skillmap-worker/0.2.0','sub_e0000000000000000000000000000001',300
) \gset
select ok(:'retry_claim_a'::uuid <> :'retry_claim_b'::uuid,
  'expired retry rotates to a new claim after the first receipt-only attempt');
select license_evidence_receipt_id as retry_license_receipt_b
from api.record_skill_submission_license_evidence(
  'sub_e0000000000000000000000000000001', :'retry_claim_b'::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('6',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/retry-owner/nested-skill',
    'sourceCommit',repeat('e',40),'path','LICENSE',
    'contentDigest','sha256:' || repeat('4',64)
  )), 'licref_' || repeat('4',32), 'sha256:' || repeat('4',64),
  'sha256:' || repeat('5',64)
) \gset
reset role;
select is((select count(*) from private.submission_license_evidence_receipts
  where submission_id = 'e0000000-0000-4000-8000-000000000001'), 2::bigint,
  'claim-scoped license receipts retain both deterministic retry attempts');
select is((select outcome || ':' || error_code from private.worker_runs
  where id = :'retry_claim_a'::uuid), 'cancelled:CLAIM_LEASE_EXPIRED',
  'receipt-only crashed attempt retains an explicit cancelled worker-run receipt');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select submission_state from api.complete_skill_submission(
  'sub_e0000000000000000000000000000001', :'retry_claim_b'::uuid,
  'skillmap-worker/0.2.0', 'accepted',
  'sha256:' || encode(digest('retry-input','sha256'),'hex'),
  'sha256:' || encode(digest('retry-result','sha256'),'hex'),
  pg_temp.audit_payload('passed','6','sha256:' || repeat('2',64),
    'sha256:' || repeat('3',64),'skillmap-worker/0.2.0'),
  pg_temp.grade_payload('provisional','5','sha256:' || repeat('6',64),
    'sha256:' || repeat('3',64),'sha256:' || repeat('4',64)),
  '{}'::text[], null,
  'sha256:' || encode(digest('retry-completion','sha256'),'hex'))),
  'accepted', 'retry claim completes with the same deterministic audit digest');
select authorization_receipt_id as retry_authorization_receipt_id
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_e0000000000000000000000000000001','retry-owner','authorized','publisher-owner-approval',
  'authref_' || repeat('8',32),'sha256:' || repeat('8',64),
  clock_timestamp() + interval '2 seconds','sha256:' || repeat('8',64)
) \gset
select is((select submission_state from private.publish_skill_submission_unchecked(
  'sub_e0000000000000000000000000000001',
  'sha256:' || encode(digest('retry-publication','sha256'),'hex'),
  'retry-owner','Retry Owner','nested-skill','Nested Skill',
  'Crash-safe exact-claim retry fixture.',
  'A nested skill with exact root-license evidence and deterministic retry authority.',
  array['review.audit'],'confirmed','MIT',false,'{}','{}')),
  'published', 'publication selects the license receipt for the exact completed retry claim');
reset role;
select is((select license_files::text from private.skill_versions
  where source_submission_id = 'e0000000-0000-4000-8000-000000000001'),
  '{LICENSE}', 'retry publication exposes the exact reviewed root license path');
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is((select count(*) from api.catalog_skills
  where publisher_handle = 'retry-owner' and slug = 'nested-skill'), 1::bigint,
  'an unexpired current publisher authorization exposes the exact source version');
select pg_sleep(2.1);
select is((select count(*) from api.catalog_skills
  where publisher_handle = 'retry-owner' and slug = 'nested-skill'), 0::bigint,
  'authorization expiry automatically fails closed at the public catalog policy boundary');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_e0000000000000000000000000000001','other-owner','authorized','publisher-owner-approval',
  'authref_' || repeat('b',32),'sha256:' || encode(digest('retry-wrong-handle','sha256'),'hex'),
  now() + interval '30 days','sha256:' || encode(digest('retry-wrong-handle-operation','sha256'),'hex'))$$,
  55000, 'published authorization renewal must match the exact source publisher version',
  'post-publication renewal rejects a different publisher handle');
reset role;
select is((select count(*) from private.submission_publisher_authorization_receipts
  where submission_id = 'e0000000-0000-4000-8000-000000000001'
    and publisher_handle = 'other-owner'), 0::bigint,
  'wrong-handle renewal rolls back without appending an authorization receipt');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select authorization_receipt_id as retry_renewal_receipt_id,
  authorization_expires_at as retry_renewal_expires_at
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_e0000000000000000000000000000001','retry-owner','authorized','publisher-owner-approval',
  'authref_' || repeat('c',32),'sha256:' || encode(digest('retry-renewal','sha256'),'hex'),
  now() + interval '30 days','sha256:' || encode(digest('retry-renewal-operation','sha256'),'hex')
) \gset
select is((select authorization_decision from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_e0000000000000000000000000000001','retry-owner','authorized','publisher-owner-approval',
  'authref_' || repeat('c',32),'sha256:' || encode(digest('retry-renewal','sha256'),'hex'),
  :'retry_renewal_expires_at'::timestamptz,
  'sha256:' || encode(digest('retry-renewal-operation','sha256'),'hex'))),
  'authorized', 'exact post-publication renewal replay remains idempotent');
reset role;
select is((select count(*) from private.submission_publisher_authorization_receipts
  where submission_id = 'e0000000-0000-4000-8000-000000000001'
    and idempotency_digest = 'sha256:' || encode(digest('retry-renewal-operation','sha256'),'hex')),
  1::bigint, 'exact renewal replay appends one authorization receipt');
select is((select row(publication_state, quarantined_at is null, revoked_at is null)::text
  from private.skill_versions
  where source_submission_id = 'e0000000-0000-4000-8000-000000000001'),
  '(published,t,t)', 'renewal preserves the active exact source version without republishing');
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is((select count(*) from api.catalog_skills
  where publisher_handle = 'retry-owner' and slug = 'nested-skill'), 1::bigint,
  'renewal makes the expired exact-source listing visible again without a new submission');
reset role;
select result_skill_id as retry_skill_public_id
from api.skill_submissions
where id = 'e0000000-0000-4000-8000-000000000001' \gset
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select skill_revoked from private.control_catalog_lifecycle_unchecked(
  :'retry_skill_public_id', null, 'revoke-skill', 'confirmed-policy-violation',
  'sha256:' || encode(digest('retry-skill-revocation','sha256'),'hex')
)), true, 'service lifecycle authority revokes the published exact-source skill');
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_e0000000000000000000000000000001',
  'sha256:' || encode(digest('retry-publication','sha256'),'hex'),
  'retry-owner','Retry Owner','nested-skill','Nested Skill',
  'Crash-safe exact-claim retry fixture.',
  'A nested skill with exact root-license evidence and deterministic retry authority.',
  array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication replay no longer has current exact-source authority',
  'published-state replay cannot report success after skill lifecycle revocation');
reset role;
select is(
  jsonb_build_object(
    'submissionState', (select state from api.skill_submissions
      where id = 'e0000000-0000-4000-8000-000000000001'),
    'publicationDigest', (select publication_digest from api.skill_submissions
      where id = 'e0000000-0000-4000-8000-000000000001'),
    'versionCount', (select count(*) from private.skill_versions
      where source_submission_id = 'e0000000-0000-4000-8000-000000000001'),
    'versionState', (select publication_state from private.skill_versions
      where source_submission_id = 'e0000000-0000-4000-8000-000000000001'),
    'versionQuarantined', (select quarantined_at is not null from private.skill_versions
      where source_submission_id = 'e0000000-0000-4000-8000-000000000001'),
    'versionRevoked', (select revoked_at is not null from private.skill_versions
      where source_submission_id = 'e0000000-0000-4000-8000-000000000001'),
    'authorizationCount', (select count(*)
      from private.submission_publisher_authorization_receipts
      where submission_id = 'e0000000-0000-4000-8000-000000000001')
  ),
  jsonb_build_object(
    'submissionState', 'published',
    'publicationDigest', 'sha256:' || encode(digest('retry-publication','sha256'),'hex'),
    'versionCount', 1,
    'versionState', 'published',
    'versionQuarantined', false,
    'versionRevoked', false,
    'authorizationCount', 2
  ),
  'rejected lifecycle replay mutates no submission, version, or authorization authority');

-- The public/operator collision payload remains bounded, so publication
-- authority must never infer absence from an omitted twenty-first identity.
insert into private.publishers (
  id, public_id, handle, display_name, verification_state, catalog_state
) values (
  'f1000000-0000-4000-8000-000000000001',
  'pub_' || repeat('f',31) || '1', 'bulk-owner', 'Bulk Owner',
  'unverified', 'published'
);
insert into private.source_repositories (
  id, publisher_id, repository_url, catalog_state
) values (
  'f1000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000001',
  'https://github.com/bulk-owner/collision-corpus', 'published'
);
insert into private.skills (
  id, public_id, publisher_id, source_repository_id, slug, display_name,
  summary, description, capabilities, visibility_state, lifecycle_state
)
select
  ('f2000000-0000-4000-8000-' || lpad(index::text, 12, '0'))::uuid,
  'skl_f' || lpad(to_hex(index), 31, '0'),
  'f1000000-0000-4000-8000-000000000001'::uuid,
  'f1000000-0000-4000-8000-000000000002'::uuid,
  'collision-' || index, 'Collision ' || index,
  'Bounded collision fixture ' || index || '.',
  'One of twenty-one exact immutable collision identities.',
  array['review.audit'], 'public', 'published'
from generate_series(1, 21) index;
insert into private.skill_versions (
  id, public_id, skill_id, version_label, source_commit, source_path,
  entrypoint_content_digest, artifact_availability, license_state,
  spdx_expression, redistribution_state, compatibility_state,
  permission_scripts, permission_network, permission_tools,
  evidence_provenance_state, evidence_audit_state,
  evidence_compatibility_state, grade_state, grade_reason_codes,
  publication_state, published_at
)
select
  ('f3000000-0000-4000-8000-' || lpad(index::text, 12, '0'))::uuid,
  'skv_f' || lpad(to_hex(index), 31, '0'),
  ('f2000000-0000-4000-8000-' || lpad(index::text, 12, '0'))::uuid,
  '1.0.0', repeat('f',40), 'SKILL.md',
  'sha256:' || encode(digest('bulk-collision-source','sha256'),'hex'),
  'metadata-only', 'confirmed', 'MIT', 'metadata-only', 'not-tested',
  false, '{}'::text[], '{}'::text[], 'unverified', 'not-run',
  'not-tested', 'ungraded', '{}'::text[], 'published', clock_timestamp()
from generate_series(1, 21) index;
update private.skills skill
set current_version_id = (
  'f3000000-0000-4000-8000-' || right(skill.id::text, 12)
)::uuid
where skill.publisher_id = 'f1000000-0000-4000-8000-000000000001';

insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'f0000000-0000-4000-8000-000000000001',
  'sub_f0000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'https://github.com/bulk-owner/collision-corpus', repeat('f',40),
  'SKILL.md', '2.0.0', 'f0000000-0000-4000-8000-000000000002',
  'public-alpha-draft/v1', true, true
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as bulk_collision_claim_id from api.claim_skill_submission(
  'skillmap-worker/0.2.0','sub_f0000000000000000000000000000001',300
) \gset
select license_evidence_receipt_id as bulk_collision_license_id
from api.record_skill_submission_license_evidence(
  'sub_f0000000000000000000000000000001', :'bulk_collision_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('1',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/bulk-owner/collision-corpus',
    'sourceCommit',repeat('f',40),'path','LICENSE',
    'contentDigest','sha256:' || encode(digest('bulk-license','sha256'),'hex')
  )), 'licref_' || repeat('d',32),
  'sha256:' || encode(digest('bulk-license-review','sha256'),'hex'),
  'sha256:' || encode(digest('bulk-license-operation','sha256'),'hex')
) \gset
select is((select submission_state from api.complete_skill_submission(
  'sub_f0000000000000000000000000000001', :'bulk_collision_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'accepted',
  'sha256:' || encode(digest('bulk-input','sha256'),'hex'),
  'sha256:' || encode(digest('bulk-result','sha256'),'hex'),
  pg_temp.audit_payload('passed','1',
    'sha256:' || encode(digest('bulk-collision-source','sha256'),'hex'),
    'sha256:' || encode(digest('bulk-collision-normalized','sha256'),'hex'),
    'skillmap-worker/0.2.0'),
  pg_temp.grade_payload('provisional','2','sha256:' || repeat('1',64),
    'sha256:' || encode(digest('bulk-collision-normalized','sha256'),'hex'),
    'sha256:' || encode(digest('bulk-compatibility','sha256'),'hex')),
  '{}'::text[], null,
  'sha256:' || encode(digest('bulk-completion','sha256'),'hex'))),
  'accepted', 'twenty-one-collision submission completes with bounded evidence');
reset role;
select is((select (collision_evidence ->> 'totalMatches')::integer
  from private.review_cases
  where submission_id = 'f0000000-0000-4000-8000-000000000001'),
  21, 'completion evidence records the exact unbounded collision count');
select is((select jsonb_array_length(collision_evidence -> 'matches')
  from private.review_cases
  where submission_id = 'f0000000-0000-4000-8000-000000000001'),
  20, 'completion evidence retains the bounded twenty-match operator sample');
select ok((select (collision_evidence ->> 'truncated')::boolean
  from private.review_cases
  where submission_id = 'f0000000-0000-4000-8000-000000000001'),
  'completion evidence explicitly marks the omitted collision identity');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select (review_subject #>> '{currentEvidence,totalMatches}')::integer
  from api.list_skill_submission_collisions('sub_f0000000000000000000000000000001')),
  21, 'operator collision lookup preserves the unbounded current match count');
select is((select jsonb_array_length(review_subject #> '{currentEvidence,matches}')
  from api.list_skill_submission_collisions('sub_f0000000000000000000000000000001')),
  20, 'operator collision lookup remains bounded to twenty identities');
select ok((select pg_column_size(review_subject) < 32768
  from api.list_skill_submission_collisions('sub_f0000000000000000000000000000001')),
  'bounded operator collision output remains below the public evidence size ceiling');
reset role;
select ok(not exists (
  select 1
  from private.review_cases review,
    jsonb_array_elements(review.collision_evidence -> 'matches') completion_match,
    jsonb_array_elements(
      private.skill_submission_collision_review_subject(review.submission_id)
        #> '{currentEvidence,matches}'
    ) current_match
  where review.submission_id = 'f0000000-0000-4000-8000-000000000001'
    and (completion_match ->> 'skillId' = 'skl_f' || lpad(to_hex(21),31,'0')
      or current_match ->> 'skillId' = 'skl_f' || lpad(to_hex(21),31,'0'))
), 'the twenty-first exact collision identity is omitted from both bounded arrays');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.review_skill_submission_collisions_unchecked(
  'sub_f0000000000000000000000000000001','approved-distinct',
  'independently-reviewed-source',null,null,null,
  'sha256:' || encode(digest('bulk-distinct-review','sha256'),'hex'))$$,
  55000, 'partial collision evidence cannot authorize publication',
  'approved-distinct cannot infer safety from a truncated collision subject');
select throws_ok($$select * from private.review_skill_submission_collisions_unchecked(
  'sub_f0000000000000000000000000000001','approved-update',
  'reviewed-version-update','pub_' || repeat('f',31) || '1',
  'skl_f' || lpad(to_hex(21),31,'0'),
  'skv_f' || lpad(to_hex(21),31,'0'),
  'sha256:' || encode(digest('bulk-update-review','sha256'),'hex'))$$,
  55000, 'partial collision evidence cannot authorize publication',
  'approved-update cannot target the omitted twenty-first collision identity');
reset role;

-- Simulate a pre-hardening/stale approval to prove the publication trigger is
-- independently fail-closed even if an authorizing receipt already exists.
insert into private.submission_collision_reviews (
  submission_id, review_case_id, audit_receipt_id, review_subject_digest,
  authority_version, disposition, reason_code, idempotency_digest
)
select submission.id, submission.review_case_id, submission.audit_receipt_id,
  private.collision_evidence_digest(
    private.skill_submission_collision_review_subject(submission.id)
  ), 2, 'approved-distinct', 'stale-partial-subject',
  'sha256:' || encode(digest('bulk-stale-review','sha256'),'hex')
from api.skill_submissions submission
where submission.id = 'f0000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select authorization_receipt_id as bulk_collision_authorization_id
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_f0000000000000000000000000000001','bulk-owner','authorized',
  'publisher-owner-approval','authref_' || repeat('e',32),
  'sha256:' || encode(digest('bulk-authorization','sha256'),'hex'),
  now() + interval '30 days',
  'sha256:' || encode(digest('bulk-authorization-operation','sha256'),'hex')
) \gset
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_f0000000000000000000000000000001',
  'sha256:' || encode(digest('bulk-publication','sha256'),'hex'),
  'bulk-owner','Bulk Owner','collision-21','Collision 21',
  'Bounded collision fixture 21.',
  'One of twenty-one exact immutable collision identities.',
  array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication requires complete untruncated collision evidence',
  'publication independently rejects a stale approval targeting the omitted identity');
reset role;
select is((select count(*) from private.skill_versions
  where source_submission_id = 'f0000000-0000-4000-8000-000000000001'),
  0::bigint, 'partial collision authority cannot insert a source-derived version');

-- A terminal consent withdrawal is exact-source-global. It remains effective
-- after receipt/account deletion and cannot be evaded with a second account,
-- a different publisher handle, collision exclusion, or a lifecycle restore.
insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'a4000000-0000-4000-8000-000000000001',
  'sub_a4000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'https://github.com/terminal-owner/terminal-skill', repeat('1',40),
  'SKILL.md', '1.0.0', 'a4000000-0000-4000-8000-000000000002',
  'public-alpha-draft/v1', true, true
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as terminal_claim_id from api.claim_skill_submission(
  'skillmap-worker/0.2.0','sub_a4000000000000000000000000000001',300
) \gset
select license_evidence_receipt_id as terminal_license_id
from api.record_skill_submission_license_evidence(
  'sub_a4000000000000000000000000000001', :'terminal_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('a',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/terminal-owner/terminal-skill',
    'sourceCommit',repeat('1',40),'path','LICENSE',
    'contentDigest','sha256:' || encode(digest('terminal-license','sha256'),'hex')
  )), 'licref_' || repeat('1',32),
  'sha256:' || encode(digest('terminal-license-review','sha256'),'hex'),
  'sha256:' || encode(digest('terminal-license-operation','sha256'),'hex')
) \gset
select submission_state as terminal_completion_state
from api.complete_skill_submission(
  'sub_a4000000000000000000000000000001', :'terminal_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'accepted',
  'sha256:' || encode(digest('terminal-input','sha256'),'hex'),
  'sha256:' || encode(digest('terminal-result','sha256'),'hex'),
  pg_temp.audit_payload('passed','a',
    'sha256:' || encode(digest('terminal-source','sha256'),'hex'),
    'sha256:' || encode(digest('terminal-normalized','sha256'),'hex'),
    'skillmap-worker/0.2.0'),
  pg_temp.grade_payload('provisional','b','sha256:' || repeat('a',64),
    'sha256:' || encode(digest('terminal-normalized','sha256'),'hex'),
    'sha256:' || encode(digest('terminal-compatibility','sha256'),'hex')),
  '{}'::text[], null,
  'sha256:' || encode(digest('terminal-completion','sha256'),'hex')
) \gset
select authorization_receipt_id as terminal_authorization_receipt_id,
  authorization_expires_at as terminal_authorization_expires_at
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_a4000000000000000000000000000001','terminal-owner','authorized',
  'publisher-owner-approval','authref_' || repeat('2',32),
  'sha256:' || encode(digest('terminal-authorization','sha256'),'hex'),
  clock_timestamp() + interval '30 days',
  'sha256:' || encode(digest('terminal-authorization-operation','sha256'),'hex')
) \gset
select set_config(
  'skillmap.test_terminal_authorization_expires_at',
  :'terminal_authorization_expires_at', true
);
reset role;

-- A separately published legacy row at the exact source proves revocation
-- blocks all matching versions, not only the revoking submission's result.
insert into private.publishers (
  id, public_id, handle, display_name, verification_state, catalog_state
) values (
  'a2000000-0000-4000-8000-000000000001',
  'pub_a2000000000000000000000000000001',
  'terminal-owner', 'Terminal Owner', 'unverified', 'published'
);
insert into private.source_repositories (
  id, publisher_id, repository_url, catalog_state
) values (
  'a2000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  'https://github.com/terminal-owner/terminal-skill', 'published'
);
insert into private.skills (
  id, public_id, publisher_id, source_repository_id, slug, display_name,
  summary, description, capabilities, visibility_state, lifecycle_state
) values (
  'a2000000-0000-4000-8000-000000000003',
  'skl_a2000000000000000000000000000003',
  'a2000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  'terminal-shadow', 'Terminal Shadow', 'Terminal source restore fixture.',
  'A legacy publication at the exact source coordinates.',
  array['review.audit'], 'public', 'published'
);
insert into private.skill_versions (
  id, public_id, skill_id, version_label, source_commit, source_path,
  entrypoint_content_digest, artifact_availability, license_state,
  spdx_expression, redistribution_state, compatibility_state,
  permission_scripts, permission_network, permission_tools,
  evidence_provenance_state, evidence_audit_state,
  evidence_compatibility_state, grade_state, grade_reason_codes,
  publication_state, published_at
) values (
  'a2000000-0000-4000-8000-000000000004',
  'skv_a2000000000000000000000000000004',
  'a2000000-0000-4000-8000-000000000003', '0.9.0', repeat('1',40),
  'SKILL.md', 'sha256:' || encode(digest('terminal-source','sha256'),'hex'),
  'metadata-only', 'confirmed', 'MIT', 'metadata-only', 'not-tested',
  false, '{}'::text[], '{}'::text[], 'unverified', 'not-run', 'not-tested',
  'ungraded', '{}'::text[], 'published', clock_timestamp()
);
update private.skills
set current_version_id = 'a2000000-0000-4000-8000-000000000004'
where id = 'a2000000-0000-4000-8000-000000000003';

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select authorization_receipt_id as terminal_revocation_receipt_id
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_a4000000000000000000000000000001','terminal-owner','revoked',null,
  'authref_' || repeat('3',32),
  'sha256:' || encode(digest('terminal-revocation','sha256'),'hex'),null,
  'sha256:' || encode(digest('terminal-revocation-operation','sha256'),'hex')
) \gset
select throws_ok($$select * from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_a4000000000000000000000000000001','terminal-owner','authorized',
  'publisher-owner-approval','authref_' || repeat('2',32),
  'sha256:' || encode(digest('terminal-authorization','sha256'),'hex'),
  current_setting('skillmap.test_terminal_authorization_expires_at')::timestamptz,
  'sha256:' || encode(digest('terminal-authorization-operation','sha256'),'hex'))$$,
  55000, 'publisher authorization revocation is terminal for the exact source',
  'a stale historical authorization replay cannot report current authority');
select is((select authorization_receipt_id from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_a4000000000000000000000000000001','terminal-owner','revoked',null,
  'authref_' || repeat('3',32),
  'sha256:' || encode(digest('terminal-revocation','sha256'),'hex'),null,
  'sha256:' || encode(digest('terminal-revocation-operation','sha256'),'hex'))),
  :'terminal_revocation_receipt_id',
  'exact terminal revocation replay returns the retained revocation receipt');
reset role;
select is((select decision from private.submission_publisher_authorization_receipts
  where submission_id = 'a4000000-0000-4000-8000-000000000001'
  order by receipt_sequence desc limit 1), 'revoked',
  'historical replay leaves the terminal receipt latest');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_a4000000000000000000000000000001','terminal-owner','authorized',
  'publisher-owner-approval','authref_' || repeat('4',32),
  'sha256:' || encode(digest('terminal-reauthorization','sha256'),'hex'),
  clock_timestamp() + interval '30 days',
  'sha256:' || encode(digest('terminal-reauthorization-operation','sha256'),'hex'))$$,
  55000, 'publisher authorization revocation is terminal for the exact source',
  'new same-handle authorization cannot supersede terminal revocation');
select throws_ok($$select * from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_a4000000000000000000000000000001','replacement-owner','authorized',
  'publisher-owner-approval','authref_' || repeat('5',32),
  'sha256:' || encode(digest('terminal-handle-switch','sha256'),'hex'),
  clock_timestamp() + interval '30 days',
  'sha256:' || encode(digest('terminal-handle-switch-operation','sha256'),'hex'))$$,
  55000, 'publisher authorization revocation is terminal for the exact source',
  'new cross-handle authorization cannot evade terminal revocation');
reset role;
select is((select count(*) from private.submission_publisher_authorization_receipts
  where submission_id = 'a4000000-0000-4000-8000-000000000001'),
  2::bigint, 'rejected authorization attempts append no receipt');
select is((select count(*) from private.publisher_authorization_revocation_tombstones
  where repository_url = 'https://github.com/terminal-owner/terminal-skill'
    and source_commit = repeat('1',40) and source_path = 'SKILL.md'
    and publisher_handle = 'terminal-owner'
    and evidence_digest = 'sha256:' || encode(digest('terminal-revocation','sha256'),'hex')),
  1::bigint, 'one redacted source-global tombstone retains original publisher evidence');
select is((select row(publication_state, quarantined_at is not null, revoked_at is not null)::text
  from private.skill_versions where id = 'a2000000-0000-4000-8000-000000000004'),
  '(blocked,t,t)', 'accepted-state revocation atomically blocks every published exact-source version');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_a4000000000000000000000000000001',
  'sha256:' || encode(digest('terminal-publication','sha256'),'hex'),
  'terminal-owner','Terminal Owner','terminal-skill','Terminal Skill',
  'Terminal publication fixture.','A terminal source cannot be republished.',
  array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication requires current exact-source publisher authorization',
  'terminal revocation blocks publication after collision exclusion');
reset role;
select is((select count(*) from private.skill_versions
  where source_submission_id = 'a4000000-0000-4000-8000-000000000001'),
  0::bigint, 'terminally revoked submission cannot insert a source-derived version');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select ok(api.delete_my_account(), 'originating account deletion completes through the reviewed cascade');
reset role;
select is((select count(*) from private.publisher_authorization_revocation_tombstones
  where repository_url = 'https://github.com/terminal-owner/terminal-skill'
    and source_commit = repeat('1',40) and source_path = 'SKILL.md'),
  1::bigint, 'account and submission deletion cannot erase terminal source authority');
select is((select count(*) from private.submission_publisher_authorization_receipts
  where repository_url = 'https://github.com/terminal-owner/terminal-skill'),
  0::bigint, 'account deletion removes account-linked authorization receipts');

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'b4000000-0000-4000-8000-000000000001',
  'sub_b4000000000000000000000000000001',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'https://github.com/terminal-owner/terminal-skill', repeat('1',40),
  'SKILL.md', '2.0.0', 'b4000000-0000-4000-8000-000000000002',
  'public-alpha-draft/v1', true, true
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as terminal_second_claim_id from api.claim_skill_submission(
  'skillmap-worker/0.2.0','sub_b4000000000000000000000000000001',300
) \gset
select license_evidence_receipt_id as terminal_second_license_id
from api.record_skill_submission_license_evidence(
  'sub_b4000000000000000000000000000001', :'terminal_second_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('c',64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl','https://github.com/terminal-owner/terminal-skill',
    'sourceCommit',repeat('1',40),'path','LICENSE',
    'contentDigest','sha256:' || encode(digest('terminal-second-license','sha256'),'hex')
  )), 'licref_' || repeat('6',32),
  'sha256:' || encode(digest('terminal-second-license-review','sha256'),'hex'),
  'sha256:' || encode(digest('terminal-second-license-operation','sha256'),'hex')
) \gset
select is((select submission_state from api.complete_skill_submission(
  'sub_b4000000000000000000000000000001', :'terminal_second_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'accepted',
  'sha256:' || encode(digest('terminal-second-input','sha256'),'hex'),
  'sha256:' || encode(digest('terminal-second-result','sha256'),'hex'),
  pg_temp.audit_payload('passed','c',
    'sha256:' || encode(digest('terminal-source','sha256'),'hex'),
    'sha256:' || encode(digest('terminal-second-normalized','sha256'),'hex'),
    'skillmap-worker/0.2.0'),
  pg_temp.grade_payload('provisional','d','sha256:' || repeat('c',64),
    'sha256:' || encode(digest('terminal-second-normalized','sha256'),'hex'),
    'sha256:' || encode(digest('terminal-second-compatibility','sha256'),'hex')),
  '{}'::text[], null,
  'sha256:' || encode(digest('terminal-second-completion','sha256'),'hex'))),
  'accepted', 'second account can complete review without acquiring authority');
reset role;
select is((select (collision_evidence ->> 'totalMatches')::integer
  from private.review_cases
  where submission_id = 'b4000000-0000-4000-8000-000000000001'),
  0, 'blocked exact-source versions are excluded from collision evidence without erasing the tombstone');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_b4000000000000000000000000000001','terminal-owner','authorized',
  'publisher-owner-approval','authref_' || repeat('7',32),
  'sha256:' || encode(digest('terminal-second-same-handle','sha256'),'hex'),
  clock_timestamp() + interval '30 days',
  'sha256:' || encode(digest('terminal-second-same-operation','sha256'),'hex'))$$,
  55000, 'publisher authorization revocation is terminal for the exact source',
  'a second account cannot reauthorize the terminal source under the original handle');
select throws_ok($$select * from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_b4000000000000000000000000000001','replacement-owner','authorized',
  'publisher-owner-approval','authref_' || repeat('8',32),
  'sha256:' || encode(digest('terminal-second-cross-handle','sha256'),'hex'),
  clock_timestamp() + interval '30 days',
  'sha256:' || encode(digest('terminal-second-cross-operation','sha256'),'hex'))$$,
  55000, 'publisher authorization revocation is terminal for the exact source',
  'a second account cannot switch publisher handles to evade terminal authority');
reset role;
select is((select count(*) from private.submission_publisher_authorization_receipts
  where submission_id = 'b4000000-0000-4000-8000-000000000001'),
  0::bigint, 'second-account bypass attempts append no authorization receipt');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($$select * from private.publish_skill_submission_unchecked(
  'sub_b4000000000000000000000000000001',
  'sha256:' || encode(digest('terminal-second-publication','sha256'),'hex'),
  'terminal-owner','Terminal Owner','terminal-skill','Terminal Skill',
  'Terminal publication fixture.','A terminal source cannot be republished.',
  array['review.audit'],'confirmed','MIT',false,'{}','{}')$$,
  55000, 'publication requires current exact-source publisher authorization',
  'publication remains blocked for a second account after tombstone retention');
reset role;
select is((select count(*) from private.skill_versions
  where source_submission_id = 'b4000000-0000-4000-8000-000000000001'),
  0::bigint, 'second-account terminal bypass cannot insert a version');
select throws_ok($$delete from private.publisher_authorization_revocation_tombstones
  where repository_url = 'https://github.com/terminal-owner/terminal-skill'$$,
  55000, null, 'terminal tombstones remain append-only after account purge');

update private.skill_versions
set publication_state = 'published', quarantined_at = null, revoked_at = null
where id = 'a2000000-0000-4000-8000-000000000004';
select ok(not private.version_has_current_publisher_authorization(
  'a2000000-0000-4000-8000-000000000004'
), 'tombstone lookup remains effective when source_submission_id is null');
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is((select count(*) from api.catalog_skills
  where publisher_handle = 'terminal-owner' and slug = 'terminal-shadow'),
  0::bigint, 'a lifecycle restore cannot expose a detached terminal exact source');
reset role;
select ok(private.version_has_current_publisher_authorization(
  '40000000-0000-4000-8000-000000000001'
), 'an unrelated legacy source remains unaffected by the terminal tombstone');

select * from finish();
rollback;
