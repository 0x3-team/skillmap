begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

grant usage on schema private to service_role;
grant execute on function private.record_skill_submission_publisher_authorization_unchecked(text,text,text,text,text,text,timestamptz,text) to service_role;
grant execute on function private.disposition_skill_report_unchecked(text,text,text,text,text,text) to service_role;
grant execute on function private.control_catalog_lifecycle_unchecked(text,text,text,text,text) to service_role;
alter table private.audit_events alter column operator_attribution_required set default false;

-- Bind the first public seed version to a truthful immutable submission receipt
-- chain so lifecycle restoration and public evidence projections can be tested.
insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, license_claim, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  '90000000-0000-4000-8000-000000000001', 'sub_90000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/0x3-team/skillmap',
  'd1c23990af82d1c8c99997cb8d9a2c23707d91fa',
  'catalog/first-party/skill-audit/SKILL.md', '1.0.0', 'MIT',
  '90000000-0000-4000-8000-000000000002', 'public-alpha-draft/v1', true, true
);
update api.skill_submissions set state = 'processing',
  active_claim_id = '90000000-0000-4000-8000-000000000003',
  current_worker_version = 'skillmap-worker/0.2.0', attempt_count = 1,
  claimed_at = now(), claim_expires_at = now() + interval '5 minutes'
where id = '90000000-0000-4000-8000-000000000001';

insert into private.skill_audit_receipts (
  id, public_id, submission_id, state, receipt_digest, source_content_digest,
  normalized_content_digest, policy_version, host_profile_version, worker_version,
  finding_counts, public_checks, reason_codes, private_evidence_digest,
  license_state, spdx_expression, permission_scripts, network_indicators, tool_indicators
) values (
  '91000000-0000-4000-8000-000000000001', 'aud_91000000000000000000000000000001',
  '90000000-0000-4000-8000-000000000001', 'passed', 'sha256:' || repeat('1', 64),
  'sha256:4412e0649064c4729dc74959a329dc4b042ff9a0a5bdf74200889b8cd1fa4f4a',
  'sha256:' || repeat('2', 64), 'skillmap-static-audit/v2', 'codex-host/v1',
  'skillmap-worker/0.2.0', '{"critical":0,"high":0,"medium":0,"low":0,"info":0}',
  '[{"code":"source-integrity","outcome":"passed","severity":"info","evidenceDigest":null}]',
  '{}'::text[], 'sha256:' || repeat('3', 64), 'confirmed', 'MIT', false, false, false
);
insert into private.skill_grade_receipts (
  id, public_id, submission_id, audit_receipt_id, state, total_score, confidence,
  receipt_digest, normalized_content_digest, audit_receipt_digest,
  compatibility_evidence_digest, evaluation_suite_digest, rubric_version,
  host_profile_version, evaluator_version, hard_gates, dimensions, reason_codes
) values (
  '92000000-0000-4000-8000-000000000001', 'grd_92000000000000000000000000000001',
  '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
  'provisional', 82, 0.35, 'sha256:' || repeat('5', 64), 'sha256:' || repeat('2', 64),
  'sha256:' || repeat('1', 64), 'sha256:' || repeat('4', 64), null,
  'skillmap-rubric/v1', 'codex-host/v1', 'skillmap-grader/0.1.0',
  '[{"code":"source-identity","passed":true,"evidenceDigest":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}]',
  '[{"code":"instruction-quality","weight":1,"score":82,"evidenceDigest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}]',
  array['behavioral-evidence-incomplete']
);
insert into private.review_cases (
  id, public_id, submission_id, audit_receipt_id, grade_receipt_id, state,
  reason_codes, idempotency_digest
) values (
  '93000000-0000-4000-8000-000000000001', 'rev_93000000000000000000000000000001',
  '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001', 'approved', '{}'::text[],
  'sha256:' || repeat('6', 64)
);
insert into private.worker_runs (
  id, public_id, submission_id, worker_version, attempt_number, outcome,
  disposition_state, input_digest, result_digest, started_at, completed_at
) values (
  '90000000-0000-4000-8000-000000000003', 'wrk_94000000000000000000000000000001',
  '90000000-0000-4000-8000-000000000001', 'skillmap-worker/0.2.0', 1,
  'succeeded', 'accepted', 'sha256:' || repeat('7', 64), 'sha256:' || repeat('8', 64),
  now() - interval '1 second', now()
);
update api.skill_submissions set state = 'accepted', active_claim_id = null,
  claim_expires_at = null, completed_at = now(), audit_state = 'passed',
  audit_receipt_id = '91000000-0000-4000-8000-000000000001',
  audit_receipt_public_id = 'aud_91000000000000000000000000000001',
  audit_receipt_digest = 'sha256:' || repeat('1', 64), grade_state = 'provisional',
  grade_receipt_id = '92000000-0000-4000-8000-000000000001',
  grade_receipt_public_id = 'grd_92000000000000000000000000000001',
  grade_receipt_digest = 'sha256:' || repeat('5', 64), grade_confidence = 0.35,
  review_state = 'approved', review_case_id = '93000000-0000-4000-8000-000000000001',
  review_case_public_id = 'rev_93000000000000000000000000000001',
  last_worker_run_id = '90000000-0000-4000-8000-000000000003',
  last_transition_digest = 'sha256:' || repeat('6', 64)
where id = '90000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select authorization_receipt_id as lifecycle_authorization_receipt_id
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_90000000000000000000000000000001','0x3-team','authorized',
  'publisher-owner-approval','authref_' || repeat('a',32),
  'sha256:' || repeat('a',64),now() + interval '30 days',
  'sha256:' || repeat('a',64)
) \gset
reset role;
update private.skill_versions set
  source_submission_id = '90000000-0000-4000-8000-000000000001',
  submission_audit_receipt_id = '91000000-0000-4000-8000-000000000001',
  submission_audit_receipt_public_id = 'aud_91000000000000000000000000000001',
  submission_audit_receipt_digest = 'sha256:' || repeat('1', 64),
  submission_grade_receipt_id = '92000000-0000-4000-8000-000000000001',
  compatibility_state = 'declared', compatibility_profile_version = 'codex-host/v1',
  compatibility_evidence_digest = 'sha256:' || repeat('4', 64),
  evidence_provenance_state = 'source-pinned', evidence_audit_state = 'passed',
  evidence_compatibility_state = 'declared', grade_state = 'provisional',
  grade_confidence = 0.35, grade_receipt_id = 'grd_92000000000000000000000000000001',
  grade_receipt_digest = 'sha256:' || repeat('5', 64), graded_at = now(),
  grade_rubric_version = 'skillmap-rubric/v1', grade_host_profile_version = 'codex-host/v1',
  grade_reason_codes = array['behavioral-evidence-incomplete']
where id = '40000000-0000-4000-8000-000000000001';
update api.skill_submissions set state = 'published', review_state = 'published',
  result_skill_id = 'skl_00000000000000000000000000000001',
  result_version_id = 'skv_00000000000000000000000000000001',
  publication_digest = 'sha256:' || repeat('9', 64),
  last_transition_digest = 'sha256:' || repeat('9', 64)
where id = '90000000-0000-4000-8000-000000000001';

select plan(100);

-- The final exposed publication wrapper must reject retained stale authority
-- before it can enter dual control or append a protected publication event.
update api.skill_submissions
set current_worker_version = null
where public_id = 'sub_90000000000000000000000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{}'::jsonb::text, true);
select throws_ok($sql$
  select * from api.publish_skill_submission(
    'sub_90000000000000000000000000000001', 'sha256:' || repeat('9', 64),
    '0x3-team', '0x3 Team', 'skill-audit', 'Skill Audit',
    'Audit a skill without treating structural checks as a safety certificate.',
    'Audits one immutable Agent Skill version for structure, scope, provenance, license, permissions, and operational risk. It reports evidence and remediation without running bundled scripts.',
    array['skill.audit','skill.provenance','skill.license'],
    'confirmed', 'MIT', false, '{}'::text[], '{}'::text[]
  )
$sql$, 55000, 'submission evidence authority is stale or unsupported',
  'the real publication RPC rejects retained stale authority before execution');
reset role;
select is((select count(*) from private.operator_action_executions execution
  join private.operator_action_approvals approval on approval.id = execution.approval_id
  where approval.action_kind = 'submission.publish'
    and approval.subject_id = 'sub_90000000000000000000000000000001'), 0::bigint,
  'stale publication creates no dual-control execution');
select is((select count(*) from private.audit_events
  where event_type = 'submission.published'
    and subject_id = 'sub_90000000000000000000000000000001'), 0::bigint,
  'stale publication appends no protected publication event');
update api.skill_submissions
set current_worker_version = 'skillmap-worker/0.2.0'
where public_id = 'sub_90000000000000000000000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.headers', '{}'::jsonb::text, true);
select throws_ok($sql$
  select * from api.publish_skill_submission(
    'sub_90000000000000000000000000000001', 'sha256:' || repeat('9', 64),
    '0x3-team', '0x3 Team', 'skill-audit', 'Skill Audit',
    'Audit a skill without treating structural checks as a safety certificate.',
    'Audits one immutable Agent Skill version for structure, scope, provenance, license, permissions, and operational risk. It reports evidence and remediation without running bundled scripts.',
    array['skill.audit','skill.provenance','skill.license'],
    'confirmed', 'MIT', false, '{}'::text[], '{}'::text[]
  )
$sql$, 42501, 'operator credential is invalid',
  'restored current authority reaches the unchanged dual-control boundary');
reset role;

select has_table('api', 'skill_reports', 'authenticated suspicious-listing report table exists');
select has_view('api', 'my_skill_reports', 'owner-safe report projection exists');
select has_column('api', 'my_skill_reports', 'idempotency_key', 'owner-safe report projection exposes exact request-ID recovery authority');
select has_view('api', 'catalog_audit_evidence', 'bounded audit evidence view exists');
select has_view('api', 'catalog_grade_evidence', 'bounded grade evidence view exists');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'api' and c.relname = 'skill_reports'), 'report table enables and forces RLS');
select ok(has_column_privilege('authenticated', 'api.skill_reports', 'skill_id', 'insert'), 'authenticated accounts can insert report targets');
select ok(has_column_privilege('authenticated', 'api.skill_reports', 'idempotency_key', 'select'), 'authenticated owners can resolve only their RLS-filtered request IDs');
select ok(not has_table_privilege('anon', 'api.skill_reports', 'insert'), 'anonymous reporting is explicitly deferred');
select ok(not has_column_privilege('authenticated', 'api.skill_reports', 'state', 'update'), 'browser roles cannot mutate report disposition');
select ok(has_function_privilege('service_role', 'api.disposition_skill_report(text,text,text,text,text,text)', 'execute'), 'service role can atomically disposition reports');
select ok(has_function_privilege('service_role', 'api.list_skill_report_queue(integer,timestamptz,text)', 'execute'), 'service role can paginate the bounded report queue');
select ok(has_function_privilege('service_role', 'api.control_catalog_lifecycle(text,text,text,text,text)', 'execute'), 'service role can control catalog lifecycle');
select ok(has_function_privilege('service_role', 'api.renew_skill_submission_claim(text,uuid,text,integer)', 'execute'), 'service role can renew exact live claims');
select ok(not has_function_privilege('authenticated', 'api.control_catalog_lifecycle(text,text,text,text,text)', 'execute'), 'browser roles cannot control catalog lifecycle');
select ok(has_column_privilege('authenticated', 'api.profiles', 'user_id', 'insert'), 'authenticated account bootstrap can insert only its profile identity');
select ok(not has_column_privilege('authenticated', 'api.profiles', 'created_at', 'insert'), 'authenticated accounts cannot forge profile creation time');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'api' and c.relname in ('catalog_audit_evidence', 'catalog_grade_evidence') and c.reloptions @> array['security_invoker=true','security_barrier=true']), 2::bigint, 'evidence views are security-invoker and security-barrier');
select is((select count(*) from information_schema.columns where table_schema = 'api' and table_name in ('catalog_audit_evidence','catalog_grade_evidence') and column_name in ('submission_id','submitter_user_id','reporter_user_id','private_evidence_digest')), 0::bigint, 'evidence projections omit submission, account, and private-evidence identifiers');
select ok(not has_column_privilege('anon', 'private.skill_audit_receipts', 'private_evidence_digest', 'select'), 'anonymous roles cannot select the private evidence digest');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.prosecdef), 44::bigint, 'API security-definer surface remains the exact forty-four-function reviewed boundary');

set local role anon;
select is((select count(*) from api.catalog_audit_evidence where skill_id = 'skl_00000000000000000000000000000001'), 1::bigint, 'anonymous users can see audit evidence only for a current public version');
select is((select count(*) from api.catalog_grade_evidence where skill_id = 'skl_00000000000000000000000000000001'), 1::bigint, 'anonymous users can see grade evidence only for a current public version');
select is((select receipt_digest from api.catalog_audit_evidence where skill_id = 'skl_00000000000000000000000000000001'), 'sha256:' || repeat('1',64), 'audit projection labels the canonical evidence digest truthfully');
select is((select receipt_digest from api.catalog_grade_evidence where skill_id = 'skl_00000000000000000000000000000001'), 'sha256:' || repeat('5',64), 'grade projection labels the canonical evidence digest truthfully');

reset role;
update private.source_repositories set catalog_state = 'blocked', revoked_at = now(), updated_at = now()
where id = '20000000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from private.skill_audit_receipts), 0::bigint,
  'direct receipt-column defense hides evidence when its source repository is blocked');
reset role;
update private.source_repositories set catalog_state = 'published', revoked_at = null, updated_at = now()
where id = '20000000-0000-4000-8000-000000000001';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select lives_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'security','The listing appears to contain a suspicious instruction boundary.',
    'a1000000-0000-4000-8000-000000000001')$$, 'an authenticated account can report an exact current public listing');
select is((select count(*) from api.my_skill_reports), 1::bigint, 'reporter sees exactly their own report');
select is((select skill_id || ':' || version_id from api.my_skill_reports), 'skl_00000000000000000000000000000001:skv_00000000000000000000000000000001', 'owner view preserves the exact public target without account identifiers');
select is((select idempotency_key::text from api.my_skill_reports), 'a1000000-0000-4000-8000-000000000001', 'owner view binds report recovery to the exact request ID');
select report_id as report_a_id from api.my_skill_reports \gset

reset role;
savepoint report_authorization_gate;
insert into private.submission_publisher_authorization_receipts (
  id, public_id, submission_id, repository_url, source_commit, source_path,
  publisher_handle, decision, authorization_basis, evidence_reference,
  evidence_digest, expires_at, idempotency_digest
) values (
  '95000000-0000-4000-8000-000000000001', 'aut_95000000000000000000000000000001',
  '90000000-0000-4000-8000-000000000001', 'https://github.com/0x3-team/skillmap',
  'd1c23990af82d1c8c99997cb8d9a2c23707d91fa',
  'catalog/first-party/skill-audit/SKILL.md', '0x3-team', 'authorized',
  'publisher-owner-approval', 'authref_' || repeat('b',32),
  'sha256:' || repeat('b',64), clock_timestamp() - interval '1 second',
  'sha256:' || repeat('c',64)
);
select ok(
  exists (
    select 1 from private.skill_versions version
    where version.id = '40000000-0000-4000-8000-000000000001'
      and version.publication_state = 'published'
      and version.quarantined_at is null and version.revoked_at is null
  ) and not private.version_has_current_publisher_authorization(
    '40000000-0000-4000-8000-000000000001'
  ),
  'expired publisher authorization alone hides an otherwise published exact version'
);
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'security','An otherwise public listing must not remain reportable after publisher authorization expires.',
    'b1000000-0000-4000-8000-000000000009')$$,
  23514, 'report target is not an exact current public listing',
  'report insertion composes current publisher authorization with the exact public target');
reset role;
rollback to savepoint report_authorization_gate;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select is((select count(*) from api.my_skill_reports), 0::bigint, 'another account cannot read the report');
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000002','skv_00000000000000000000000000000001',
    'security','This mismatched target must not be accepted.',
    'b1000000-0000-4000-8000-000000000001')$$, 23514, 'report target is not an exact current public listing', 'report target must bind an exact skill/version pair');
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'broken','short', 'b1000000-0000-4000-8000-000000000002')$$,
  22023, 'report message is not canonical', 'direct reports enforce the same minimum explanation as the server form');
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'broken',' Padded report explanations are not canonical. ', 'b1000000-0000-4000-8000-000000000003')$$,
  22023, 'report message is not canonical', 'direct reports reject noncanonical surrounding whitespace');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'security','A duplicate report inside the cooldown.',
    'a1000000-0000-4000-8000-000000000002')$$, 'P0001', 'report cooldown active for this target and category', 'per-account target/category cooldown suppresses duplicate reports');
select throws_ok(format('update api.skill_reports set state = ''resolved'' where public_id = %L', :'report_a_id'), 42501, null, 'browser roles cannot resolve their own reports');

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'spam','Anonymous spam.', 'c1000000-0000-4000-8000-000000000001')$$, 42501, null, 'anonymous direct report insertion is denied');

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select report_id from api.list_skill_report_queue(20) limit 1), :'report_a_id', 'service queue lists the oldest queued public report identity');
select throws_ok($$select * from api.list_skill_report_queue(20, now(), null)$$,
  22023, 'report queue cursor is invalid',
  'report queue rejects an unpaired cursor');
select throws_ok(format(
  'select * from private.disposition_skill_report_unchecked(%L,%L,%L,%L,null,%L)',
  :'report_a_id','confirmed','credible-security-report',
  'The report was reviewed and confirmed.','sha256:' || repeat('a',64)
), 22023, 'report disposition is invalid',
  'confirmed report disposition cannot resolve without an exact lifecycle action');
select is((select version_revoked from private.disposition_skill_report_unchecked(
  :'report_a_id','confirmed','credible-security-report',
  'The report was reviewed and confirmed.','revoke-version','sha256:' || repeat('a',64)
)), true, 'confirmed report atomically revokes the exact reported version');
set local role anon;
select is((select count(*) from api.catalog_skills
  where skill_id = 'skl_00000000000000000000000000000001'), 0::bigint,
  'confirmed report cannot resolve while the exact reported version remains public');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select version_revoked from private.control_catalog_lifecycle_unchecked(
  'skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
  'restore-version','independent-appeal-review','sha256:' || repeat('1a',32)
)), false, 'restoration remains a separate receipt-backed lifecycle action');
set local role anon;
select is((select count(*) from api.catalog_skills
  where skill_id = 'skl_00000000000000000000000000000001'), 1::bigint,
  'separately restored exact version returns to the public catalog');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select version_revoked from private.disposition_skill_report_unchecked(
  :'report_a_id','confirmed','credible-security-report',
  'The report was reviewed and confirmed.','revoke-version','sha256:' || repeat('a',64)
)), true, 'exact report retry returns the retained enforcement outcome after a later restore');
reset role;
select is((select count(*) from private.audit_events where subject_type = 'report' and subject_id = :'report_a_id'), 1::bigint, 'report disposition creates one append-only audit event');
select is((select count(*) from private.audit_events
  where event_type = 'catalog.revoke-version'
    and subject_id = 'skv_00000000000000000000000000000001'
    and payload ->> 'sourceReportId' = :'report_a_id'), 1::bigint,
  'atomic report enforcement creates one target-bound catalog lifecycle event');
select throws_ok($$update private.audit_events set payload = '{}' where subject_type = 'report'$$, 55000, null, 'private lifecycle audit events are append-only');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select is((select state || ':' || disposition_code from api.my_skill_reports), 'resolved:confirmed', 'owner projection exposes bounded public disposition');
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'security','Resolved reports still observe the cooldown.',
    'a1000000-0000-4000-8000-000000000003')$$, 'P0001', 'report cooldown active for this target and category', 'cooldown remains effective after disposition');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select lives_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  select 'skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    category, 'Independent bounded report for global active-cap verification: ' || category,
    gen_random_uuid()
  from unnest(array['security','malware','misleading','license','privacy']) category$$,
  'an account can queue up to five independent reports');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select report_id as backlog_cursor_id, created_at as backlog_cursor_created_at
from api.list_skill_report_queue(1)
limit 1 \gset
select is((select count(*) from api.list_skill_report_queue(
  50, :'backlog_cursor_created_at'::timestamptz, :'backlog_cursor_id'
)), 4::bigint, 'paired report cursor makes every later backlog row reachable');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'broken','A sixth active report must be rejected by the global account cap.',gen_random_uuid())$$,
  'P0003', 'report active limit exceeded', 'global report active cap prevents category and corpus sweeps');
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
delete from api.skill_reports where reporter_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
insert into api.skill_reports (
  reporter_user_id, skill_id, version_id, category, message, idempotency_key,
  state, disposition_code, resolution_reason_code, public_resolution_message,
  resolution_digest, resolved_at, created_at, updated_at
)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  (array['skl_00000000000000000000000000000001','skl_00000000000000000000000000000002','skl_00000000000000000000000000000003'])[1 + ((item - 1) / 8)],
  (array['skv_00000000000000000000000000000001','skv_00000000000000000000000000000002','skv_00000000000000000000000000000003'])[1 + ((item - 1) / 8)],
  (array['security','malware','misleading','license','privacy','broken','spam','other'])[1 + ((item - 1) % 8)],
  'Resolved rolling-cap fixture number ' || item || ' remains bounded.',gen_random_uuid(),
  'resolved','no-action','rolling-cap-fixture','Fixture resolved without public action.',
  'sha256:' || lpad(to_hex(item),64,'0'),now(),now() - interval '1 hour',now()
from generate_series(1,20) item;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select throws_ok($$insert into api.skill_reports (skill_id, version_id, category, message, idempotency_key)
  values ('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
    'other','A twenty-first report inside the rolling window must be rejected.',gen_random_uuid())$$,
  'P0004', 'report rolling limit exceeded', 'global rolling report cap prevents resolved-report corpus sweeps');
reset role;
delete from api.skill_reports where reporter_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select version_quarantined from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001','quarantine-version','credible-security-report','sha256:' || repeat('b',64))), true, 'service authority quarantines an exact version');
set local role anon;
select is((select count(*) from api.catalog_skills where skill_id = 'skl_00000000000000000000000000000001'), 0::bigint, 'quarantined current versions disappear from catalog');
select is((select (select count(*) from api.catalog_audit_evidence where skill_id = 'skl_00000000000000000000000000000001') + (select count(*) from api.catalog_grade_evidence where skill_id = 'skl_00000000000000000000000000000001')), 0::bigint, 'quarantined versions disappear from both evidence projections');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select version_quarantined from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001','quarantine-version','credible-security-report','sha256:' || repeat('b',64))), true, 'exact quarantine retry is idempotent');
select throws_ok($$select * from private.control_catalog_lifecycle_unchecked(
  'skl_00000000000000000000000000000001','skv_00000000000000000000000000000001',
  'quarantine-version','different-replay-reason','sha256:' || repeat('b',64))$$,
  23505, 'lifecycle idempotency digest conflicts with another event',
  'lifecycle retry rejects a changed reason payload under the same digest');
select is((select count(*) from private.audit_events where event_type = 'catalog.quarantine-version' and subject_id = 'skv_00000000000000000000000000000001'), 1::bigint, 'quarantine retry creates no duplicate history');
select is((select version_quarantined from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001','restore-version','manual-review-cleared','sha256:' || repeat('c',64))), false, 'valid receipt-backed version can be restored');
select is((select version_quarantined from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001','quarantine-version','credible-security-report','sha256:' || repeat('b',64))), true, 'stale quarantine retry returns its retained historical outcome after restore');
set local role anon;
select is((select count(*) from api.catalog_skills where skill_id = 'skl_00000000000000000000000000000001'), 1::bigint, 'restored version returns to catalog');
select is((select count(*) from api.catalog_audit_evidence where skill_id = 'skl_00000000000000000000000000000001'), 1::bigint, 'restored version returns to evidence projection');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select version_revoked from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001','revoke-version','confirmed-policy-violation','sha256:' || repeat('d',64))), true, 'service authority revokes an exact version');
set local role anon;
select is((select count(*) from api.catalog_skills where skill_id = 'skl_00000000000000000000000000000001'), 0::bigint, 'revoked current versions disappear from catalog');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select version_revoked from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001','skv_00000000000000000000000000000001','restore-version','appeal-approved','sha256:' || repeat('e',64))), false, 'receipt-backed revoked version can be restored');
select is((select skill_lifecycle_state from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001',null,'deprecate-skill','superseded-capability','sha256:' || repeat('f',64))), 'deprecated', 'service authority deprecates an exact skill');
set local role anon;
select is((select lifecycle_state from api.catalog_skills where skill_id = 'skl_00000000000000000000000000000001'), 'deprecated', 'deprecated skill remains visible with truthful lifecycle state');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select skill_revoked from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001',null,'revoke-skill','confirmed-policy-violation','sha256:' || repeat('0',64))), true, 'service authority revokes an exact skill');
set local role anon;
select is((select count(*) from api.catalog_skills where skill_id = 'skl_00000000000000000000000000000001'), 0::bigint, 'revoked skills disappear from catalog');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select skill_lifecycle_state from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000001',null,'restore-skill','appeal-approved','sha256:' || repeat('a0',32))), 'published', 'skill restore requires and accepts the valid current receipt chain');
set local role anon;
select is((select lifecycle_state from api.catalog_skills where skill_id = 'skl_00000000000000000000000000000001'), 'published', 'restored skill returns as published');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select version_quarantined from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000002','skv_00000000000000000000000000000002','quarantine-version','manual-review-required','sha256:' || repeat('b0',32))), true, 'an unverified seed version can be quarantined');
select throws_ok($$select * from private.control_catalog_lifecycle_unchecked('skl_00000000000000000000000000000002','skv_00000000000000000000000000000002','restore-version','manual-review-cleared','sha256:' || repeat('c0',32))$$, 55000, 'version restore requires valid non-restricted receipt-backed evidence', 'unverified versions cannot be restored');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', true);
select throws_ok($$insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/bad--owner/repository','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','SKILL.md','1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true)$$, 22023, 'submission repository is not canonical', 'direct insert rejects noncanonical GitHub owner coordinates');
select throws_ok($$insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/good-owner/repository.git','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','SKILL.md','1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true)$$, 22023, 'submission repository is not canonical', 'direct insert rejects dot-git aliases');
select throws_ok($$insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,license_claim,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/good-owner/repository','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','SKILL.md','1.0.0','MIT OR Apache-2.0',gen_random_uuid(),'public-alpha-draft/v1',true,true)$$, 22023, 'submission license claim is not approved for public alpha', 'direct insert rejects unsupported compound license claims');
select throws_ok($$insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/good-owner/version-space','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','SKILL.md',' 1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true)$$, 22023, 'submission version label is not canonical', 'direct insert rejects noncanonical version labels');
select throws_ok($$insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/good-owner/path-space','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',' skills/example/SKILL.md','1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true)$$, 22023, 'submission source path is not canonical', 'direct insert rejects noncanonical source paths');
select lives_ok($test$do $block$ begin for item in 1..3 loop
  insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/abuse-owner/active-' || item, repeat(item::text,40),'SKILL.md','1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true);
end loop; end $block$;$test$, 'three active submissions are admitted');
select throws_ok($$insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/abuse-owner/active-4','4444444444444444444444444444444444444444','SKILL.md','1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true)$$, 'P0001', 'submission active limit exceeded', 'fourth active direct insert receives deterministic quota error');
select lives_ok($$update api.skill_submissions set state = 'withdrawn' where repository_url like 'https://github.com/abuse-owner/active-%'$$, 'owner can retire active quota rows');
select lives_ok($test$do $block$ begin for item in 4..10 loop
  insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/abuse-owner/daily-' || item, repeat((item % 10)::text,40),'SKILL.md','1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true);
  update api.skill_submissions set state = 'withdrawn' where repository_url = 'https://github.com/abuse-owner/daily-' || item;
end loop; end $block$;$test$, 'rolling quota admits exactly ten created submissions with no more than three active');
select throws_ok($$insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/abuse-owner/daily-11','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','SKILL.md','1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true)$$, 'P0001', 'submission rolling limit exceeded', 'eleventh rolling direct insert receives deterministic quota error');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select lives_ok($$insert into api.skill_submissions (repository_url,source_commit,source_path,version_label,idempotency_key,submission_policy_version,authority_confirmed,untrusted_processing_accepted)
  values ('https://github.com/lease-owner/renewable','cccccccccccccccccccccccccccccccccccccccc','SKILL.md','1.0.0',gen_random_uuid(),'public-alpha-draft/v1',true,true)$$, 'lease renewal fixture is queued');
select submission_id as lease_submission_id from api.my_skill_submissions where repository_url = 'https://github.com/lease-owner/renewable' \gset
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.claim_skill_submission('skillmap-worker/0.2.0', :'lease_submission_id', 30)), 1::bigint, 'service worker claims renewal fixture');
reset role;
select active_claim_id as lease_claim_id, claim_expires_at as lease_old_expiry from api.skill_submissions where public_id = :'lease_submission_id' \gset
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(format('select * from api.renew_skill_submission_claim(%L,gen_random_uuid(),''skillmap-worker/0.2.0'',900)', :'lease_submission_id'), 55000, 'only the exact live claim can be renewed', 'wrong claim cannot renew a live lease');
select ok((select claim_expires_at > :'lease_old_expiry'::timestamptz from api.renew_skill_submission_claim(:'lease_submission_id',:'lease_claim_id'::uuid,'skillmap-worker/0.2.0',900)), 'exact live claim renews and never shortens its deadline');
update api.skill_submissions set claimed_at = now() - interval '20 minutes', claim_expires_at = now() - interval '1 minute' where public_id = :'lease_submission_id';
select throws_ok(format('select * from api.renew_skill_submission_claim(%L,%L::uuid,''skillmap-worker/0.2.0'',300)', :'lease_submission_id', :'lease_claim_id'), 55000, 'only the exact live claim can be renewed', 'expired claim cannot be resurrected by renewal');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is((select count(*) from api.claim_skill_submission('skillmap-worker/0.2.0', :'lease_submission_id', 300)), 1::bigint, 'expired lease remains reclaimable through the exact current-worker claim path');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', true);
select is(api.delete_my_account(), true, 'self-delete removes report owner and owned launch-safety rows');
reset role;
select is((select count(*) from api.skill_reports where public_id = :'report_a_id'), 0::bigint, 'account deletion cascades owned reports');
select is((select count(*) from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'), 1::bigint, 'account deletion leaves other reporters and submitters untouched');

select * from finish();
rollback;
