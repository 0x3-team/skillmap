begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, private, api;

\ir fixtures/hosted_catalog_test_seed.sql.inc

grant usage on schema private to service_role;
grant execute on function private.record_skill_submission_publisher_authorization_unchecked(text,text,text,text,text,text,timestamptz,text) to service_role;
alter table private.audit_events alter column operator_attribution_required set default false;

create function pg_temp.operator_audit_payload()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'state', 'passed',
    'receiptDigest', 'sha256:' || repeat('5', 64),
    'sourceContentDigest', 'sha256:' || repeat('6', 64),
    'normalizedContentDigest', 'sha256:' || repeat('7', 64),
    'policyVersion', 'skillmap-static-audit/v2',
    'hostProfileVersion', 'codex-host/v1',
    'workerVersion', 'skillmap-worker/0.2.0',
    'findingCounts', '{"critical":0,"high":0,"medium":0,"low":0,"info":0}'::jsonb,
    'publicChecks', '[{"code":"static-audit-complete","outcome":"passed","severity":"info","evidenceDigest":null}]'::jsonb,
    'reasonCodes', '[]'::jsonb,
    'privateEvidenceDigest', 'sha256:' || repeat('f', 64),
    'licenseState', 'confirmed',
    'spdxExpression', 'MIT',
    'permissionScripts', false,
    'networkIndicators', false,
    'toolIndicators', false
  );
$$;

create function pg_temp.operator_grade_payload()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'state', 'provisional',
    'receiptDigest', 'sha256:' || repeat('8', 64),
    'totalScore', 82,
    'confidence', 0.35,
    'normalizedContentDigest', 'sha256:' || repeat('7', 64),
    'auditReceiptDigest', 'sha256:' || repeat('5', 64),
    'compatibilityEvidenceDigest', 'sha256:' || repeat('c', 64),
    'evaluationSuiteDigest', null,
    'rubricVersion', 'skillmap-rubric/v1',
    'hostProfileVersion', 'codex-host/v1',
    'evaluatorVersion', 'skillmap-grader/0.1.0',
    'hardGates', jsonb_build_array(
      jsonb_build_object('code','source-identity','passed',true,'evidenceDigest','sha256:' || repeat('1',64)),
      jsonb_build_object('code','audit-acceptable','passed',true,'evidenceDigest','sha256:' || repeat('5',64)),
      jsonb_build_object('code','license-confirmed','passed',true,'evidenceDigest','sha256:' || repeat('5',64)),
      jsonb_build_object('code','compatibility-evidence-bound','passed',true,'evidenceDigest','sha256:' || repeat('c',64)),
      jsonb_build_object('code','behavioral-evidence-bound','passed',false,'evidenceDigest',null)
    ),
    'dimensions', jsonb_build_array(
      jsonb_build_object('code','instruction-quality','weight',0.25,'score',82,'evidenceDigest','sha256:' || repeat('5',64)),
      jsonb_build_object('code','safety-and-permissions','weight',0.25,'score',82,'evidenceDigest','sha256:' || repeat('5',64)),
      jsonb_build_object('code','routing-quality','weight',0.20,'score',82,'evidenceDigest','sha256:' || repeat('5',64)),
      jsonb_build_object('code','reproducibility','weight',0.15,'score',82,'evidenceDigest','sha256:' || repeat('5',64)),
      jsonb_build_object('code','maintenance-and-provenance','weight',0.15,'score',82,'evidenceDigest','sha256:' || repeat('5',64))
    ),
    'reasonCodes', '["behavioral-evidence-incomplete"]'::jsonb
  );
$$;

select plan(17);

insert into api.skill_submissions (
  id, public_id, submitter_user_id, repository_url, source_commit, source_path,
  version_label, license_claim, idempotency_key, submission_policy_version,
  authority_confirmed, untrusted_processing_accepted
) values (
  'f2000000-0000-4000-8000-000000000001', 'sub_f2000000000000000000000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://github.com/operator-owner/receipt-skill',
  repeat('2', 40), 'skills/receipt/SKILL.md', '1.0.0', 'MIT',
  'f2000000-0000-4000-8000-000000000002', 'public-alpha-draft/v1', true, true
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select claim_id as operator_claim_id
from api.claim_skill_submission(
  'skillmap-worker/0.2.0', 'sub_f2000000000000000000000000000001', 300
) \gset

select license_evidence_receipt_id as operator_license_receipt_id
from api.record_skill_submission_license_evidence(
  'sub_f2000000000000000000000000000001', :'operator_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'sha256:' || repeat('5', 64), 'MIT',
  jsonb_build_array(jsonb_build_object(
    'repositoryUrl', 'https://github.com/operator-owner/receipt-skill',
    'sourceCommit', repeat('2', 40),
    'path', 'LICENSE',
    'contentDigest', 'sha256:' || repeat('4', 64)
  )),
  'licref_' || repeat('3', 32), 'sha256:' || repeat('4', 64),
  'sha256:' || repeat('d', 64)
) \gset

select is((select submission_state from api.complete_skill_submission(
  'sub_f2000000000000000000000000000001', :'operator_claim_id'::uuid,
  'skillmap-worker/0.2.0', 'accepted',
  'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64),
  pg_temp.operator_audit_payload(), pg_temp.operator_grade_payload(),
  '{}'::text[], null, 'sha256:' || repeat('9', 64)
)), 'accepted', 'receipt-backed fixture completes through normal worker authority');

select authorization_receipt_id as operator_authorization_receipt_id
from private.record_skill_submission_publisher_authorization_unchecked(
  'sub_f2000000000000000000000000000001', 'operator-owner', 'authorized',
  'publisher-consent', 'authref_' || repeat('a', 32), 'sha256:' || repeat('a', 64),
  statement_timestamp() + interval '30 days', 'sha256:' || repeat('e', 64)
) \gset

select is((select submission_state from api.get_skill_submission_operator_detail(
  'sub_f2000000000000000000000000000001')), 'accepted',
  'operator detail returns the accepted workflow state');
select ok((select (audit_receipt ->> 'receiptId') ~ '^aud_[0-9a-f]{32}$'
  from api.get_skill_submission_operator_detail(
    'sub_f2000000000000000000000000000001')),
  'operator audit projection exposes only the public current receipt identity');
select is((select audit_receipt ->> 'receiptDigest' from api.get_skill_submission_operator_detail(
  'sub_f2000000000000000000000000000001')), 'sha256:' || repeat('5', 64),
  'operator audit projection retains the public receipt digest');
select ok((select not audit_receipt ? 'privateEvidenceDigest'
  from api.get_skill_submission_operator_detail(
    'sub_f2000000000000000000000000000001')),
  'operator audit projection excludes the private evidence digest');
select is((select grade_receipt ->> 'receiptDigest' from api.get_skill_submission_operator_detail(
  'sub_f2000000000000000000000000000001')), 'sha256:' || repeat('8', 64),
  'operator grade projection retains its receipt digest');
select is((select grade_receipt ->> 'state' from api.get_skill_submission_operator_detail(
  'sub_f2000000000000000000000000000001')), 'provisional',
  'operator grade projection preserves provisional grade truth');
select is((select review_case ->> 'state' from api.get_skill_submission_operator_detail(
  'sub_f2000000000000000000000000000001')), 'approved',
  'operator review projection is bound to the completion review');
select is((select jsonb_array_length(worker_runs) from api.get_skill_submission_operator_detail(
  'sub_f2000000000000000000000000000001')), 1,
  'operator detail returns one bounded public worker run');
select is((select worker_runs #>> '{0,disposition}' from api.get_skill_submission_operator_detail(
  'sub_f2000000000000000000000000000001')), 'accepted',
  'operator worker history retains its disposition');
select is((select jsonb_array_length(transition_events) from api.get_skill_submission_operator_detail(
  'sub_f2000000000000000000000000000001')), 3,
  'operator detail returns the queued, processing, and accepted transitions');
select is((select license_evidence_receipt ->> 'receiptId'
  from api.get_skill_submission_operator_detail(
    'sub_f2000000000000000000000000000001')), :'operator_license_receipt_id',
  'operator detail returns only the current claim-bound license evidence receipt');
select is((select license_evidence_receipt #>> '{evidence,0,path}'
  from api.get_skill_submission_operator_detail(
    'sub_f2000000000000000000000000000001')), 'LICENSE',
  'license evidence projection contains bounded path and digest metadata');
select is((select jsonb_array_length(publisher_authorizations)
  from api.get_skill_submission_operator_detail(
    'sub_f2000000000000000000000000000001')), 1,
  'operator detail returns bounded publisher authorization history');
select is((select publisher_authorizations #>> '{0,authorizationId}'
  from api.get_skill_submission_operator_detail(
    'sub_f2000000000000000000000000000001')), :'operator_authorization_receipt_id',
  'authorization history is bound to its public receipt identity');
select ok((select not transition_events_truncated
    and not collision_reviews_truncated and not publisher_authorizations_truncated
  from api.get_skill_submission_operator_detail(
    'sub_f2000000000000000000000000000001')),
  'receipt fixture reports no false history truncation');
select ok((select pg_column_size(to_jsonb(detail)) < 262144
  from api.get_skill_submission_operator_detail(
    'sub_f2000000000000000000000000000001') detail),
  'full receipt-backed detail remains below the client response cap');

reset role;
select * from finish();
rollback;
