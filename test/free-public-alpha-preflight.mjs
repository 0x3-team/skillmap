import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildReleaseReceipt,
  determineLocalVerdict,
  parsePreflightArguments,
  writeExclusiveReceipt
} from '../scripts/free-public-alpha-preflight.mjs';
import { scanRepositorySecretCanaries } from '../scripts/repository-secret-canary.mjs';

test('free public alpha preflight arguments are bounded and explicit', () => {
  assert.deepEqual(parsePreflightArguments([]), { profile: 'static', requireClean: false, output: null });
  assert.deepEqual(parsePreflightArguments(['--profile', 'candidate', '--require-clean', '--output', '/tmp/receipt.json']), {
    profile: 'candidate', requireClean: true, output: '/tmp/receipt.json'
  });
  assert.throws(() => parsePreflightArguments(['--profile', 'full']), /static or candidate/);
  assert.throws(() => parsePreflightArguments(['--profile', 'static', '--profile', 'static']), /only once/);
  assert.throws(() => parsePreflightArguments(['--unknown']), /Unknown preflight argument/);
  assert.throws(() => parsePreflightArguments(['--require-clean', '--require-clean']), /only once/);
});

test('local and public launch verdicts cannot be collapsed', () => {
  assert.equal(determineLocalVerdict([{ status: 'passed' }]), 'passed');
  assert.equal(determineLocalVerdict([{ status: 'passed' }, { status: 'blocked' }]), 'blocked');
  assert.equal(determineLocalVerdict([{ status: 'blocked' }, { status: 'failed' }]), 'failed');
  const receipt = buildReleaseReceipt({
    candidate: { commit: 'a'.repeat(40) },
    gates: [{ id: 'static', status: 'passed' }],
    profile: 'static',
    generatedAt: '2026-07-12T00:00:00.000Z'
  });
  assert.equal(receipt.localVerdict, 'passed');
  assert.equal(receipt.launchVerdict, 'NO_GO');
  assert.match(receipt.launchBoundary, /not push, deployment, live OAuth/i);
});

test('static preflight binds worker lease, completion, receipt validation, and exact-source authority to the required migrations', () => {
  const source = readFileSync(new URL('../scripts/free-public-alpha-preflight.mjs', import.meta.url), 'utf8');
  assert.match(source, /20260727050206_launch_safety_reports_lifecycle\.sql/);
  assert.match(source, /20260727050214_backend_completion_hardening\.sql/);
  assert.match(source, /20260727050220_submission_authority_completion\.sql/);
  assert.match(source, /20260727050300_operator_submission_read_plane\.sql/);
  assert.match(source, /20260727050305_atomic_report_enforcement\.sql/);
  assert.match(source, /20260727050312_github_provider_rate_limit_deferral\.sql/);
  assert.match(source, /20260727050316_report_authorization_enforcement\.sql/);
  assert.match(source, /20260727050320_operator_dual_control\.sql/);
  assert.match(source, /20260727050324_hosted_evidence_version_authority\.sql/);
  assert.match(source, /20260727050328_hosted_report_idempotency_recovery\.sql/);
  assert.match(source, /renew_skill_submission_claim/);
  assert.match(source, /dead_letter_expired_skill_submission/);
  assert.match(source, /list_skill_submission_collisions/);
  assert.match(source, /review_skill_submission_collisions/);
  assert.match(source, /record_skill_submission_license_evidence/);
  assert.match(source, /record_skill_submission_publisher_authorization/);
  assert.match(source, /get_skill_submission_queue_summary/);
  assert.match(source, /list_skill_submission_operator_queue/);
  assert.match(source, /get_skill_submission_operator_detail/);
  assert.match(source, /disposition_skill_report/);
  assert.match(source, /p_lifecycle_action/);
  assert.match(source, /list_skill_report_queue/);
  assert.match(source, /reportAuthorizationMigration/);
  assert.match(source, /version_has_current_publisher_authorization/);
  assert.match(source, /operatorDualControlMigration/);
  assert.match(source, /operatorDualControlSource/);
  assert.match(source, /approve_operator_action/);
  assert.match(source, /x-skillmap-operator-credential/);
  assert.match(source, /x-skillmap-operator-approval/);
  assert.match(source, /supported_submission_evidence_authority/);
  assert.match(source, /assert_current_submission_evidence_authority/);
  assert.match(source, /reportIdempotencyMigration/);
  assert.match(source, /grant select .*idempotency_key/);
  assert.match(source, /peek_skill_submission_candidate/);
  assert.match(source, /defer_skill_submission_provider_limit/);
  assert.match(source, /CORE_REQUEST_RESERVE/);
  assert.match(source, /github-rate-inspection/);
  assert.match(source, /p_after_created_at/);
  assert.match(source, /skillmap-hosted-operations-check/);
  assert.match(source, /Cache-Control/);
  assert.match(source, /p_after_updated_at/);
  assert.match(source, /best-effort-live-by-updated-at-restart-required/);
  assert.match(source, /reconciliationRequired: true/);
  assert.match(source, /MAX_QUEUE_ROWS = 32/);
  assert.match(source, /submissionQueueSource/);
  assert.match(source, /submissionDetailSource/);
  assert.match(source, /private_\?evidence_\?digest/);
  assert.match(source, /collision_subject_is_complete/);
  assert.match(source, /partial collision evidence cannot authorize publication/);
  assert.match(source, /published authorization renewal must match the exact source publisher version/);
  assert.match(source, /publisher_authorization_revocation_tombstones/);
  assert.match(source, /lock_exact_source_authority/);
  assert.match(source, /prior_row\\\.expires_at <= clock_timestamp/);
  assert.match(source, /authorization_row\\\.expires_at <= clock_timestamp/);
  assert.match(source, /contentDigest/);
  assert.match(source, /operatorAuthorityMigration/);
  assert.match(source, /valid_submission_audit_receipt/);
  assert.match(source, /valid_submission_grade_receipt/);
  assert.match(source, /publication replay no longer has current exact-source authority/);
  assert.match(source, /skill_row\\\.current_version_id is distinct from version_row\\\.id/);
  assert.match(source, /worker-migration-compatibility/);
});

test('preflight receipts are exclusive and private by default', { skip: process.platform === 'win32' }, t => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-public-alpha-preflight-test-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const output = path.join(scratch, 'nested', 'receipt.json');
  const receipt = { schemaVersion: 'fixture/v1', localVerdict: 'passed' };
  assert.equal(writeExclusiveReceipt(output, receipt), output);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), receipt);
  assert.equal(readFileSync(output).length > 0, true);
  assert.throws(() => writeExclusiveReceipt(output, receipt), /EEXIST/);
});

test('repository secret canary scan catches credentials and limits the fixture exception', () => {
  const credential = `github_pat_${'A'.repeat(40)}`;
  assert.deepEqual(scanRepositorySecretCanaries([{ path: 'src/runtime.ts', bytes: Buffer.from(credential) }]), [
    { path: 'src/runtime.ts', label: 'GitHub credential' }
  ]);
  assert.deepEqual(scanRepositorySecretCanaries([{
    path: 'test/package-candidate-verifier.mjs',
    bytes: Buffer.from(['-----BEGIN', 'PRIVATE KEY-----'].join(' '))
  }]), []);
  assert.deepEqual(scanRepositorySecretCanaries([{
    path: 'test/fixtures/m3-03-apple-signing-readiness/cases.json',
    bytes: Buffer.from(['-----BEGIN', 'PRIVATE KEY-----'].join(' '))
  }]), []);
  assert.deepEqual(scanRepositorySecretCanaries([{
    path: 'test/another-test.mjs',
    bytes: Buffer.from(['-----BEGIN', 'PRIVATE KEY-----'].join(' '))
  }]), [{ path: 'test/another-test.mjs', label: 'PEM private key' }]);
  const operatorCredential = `smo_v1_${'a'.repeat(64)}`;
  assert.deepEqual(scanRepositorySecretCanaries([{
    path: 'ops/operator.env', bytes: Buffer.from(operatorCredential)
  }]), [{ path: 'ops/operator.env', label: 'SkillMap operator credential' }]);
});
