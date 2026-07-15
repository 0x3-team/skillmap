import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260715010000_hosted_evidence_version_authority.sql',
  import.meta.url
), 'utf8');
const auditRuntime = readFileSync(new URL('../src/hosted/audit-grade.ts', import.meta.url), 'utf8');
const workerRuntime = readFileSync(new URL('../apps/worker/src/process-once.mjs', import.meta.url), 'utf8');
const receiptRuntime = readFileSync(new URL('../apps/worker/src/operator-receipts.mjs', import.meta.url), 'utf8');

const expected = {
  worker: 'skillmap-worker/0.2.0',
  audit: 'skillmap-static-audit/v2',
  rubric: 'skillmap-rubric/v1',
  evaluator: 'skillmap-grader/0.1.0',
  host: 'codex-host/v1'
};

test('migration-owned evidence authority matches every runtime issuer', () => {
  assert.match(workerRuntime, new RegExp(expected.worker.replaceAll('.', '[.]')));
  assert.match(auditRuntime, new RegExp(expected.audit.replace('/', '\\/')));
  for (const value of Object.values(expected)) assert.match(migration, new RegExp(value.replaceAll('.', '[.]')));
  assert.match(auditRuntime, new RegExp(expected.rubric.replace('/', '\\/')));
  assert.match(receiptRuntime, new RegExp(expected.evaluator.replaceAll('.', '[.]').replace('/', '\\/')));
  assert.match(workerRuntime, new RegExp(expected.host.replace('/', '\\/')));
});

test('claim and completion reject unsupported authority before delegated mutation', () => {
  assert.match(migration, /worker version is unsupported[\s\S]+claim_skill_submission_provider_aware_unchecked/);
  assert.match(migration, /submission evidence authority is unsupported[\s\S]+complete_skill_submission_evidence_unchecked/);
  assert.match(migration, /skill_audit_receipts_current_authority_check/);
  assert.match(migration, /skill_grade_receipts_current_authority_check/);
  assert.match(migration, /valid_submission_audit_receipt_unversioned/);
  assert.match(migration, /valid_submission_grade_receipt_unversioned/);
  assert.match(migration, /processing submissions owned by an unsupported worker must be explicitly drained or requeued/);
});

test('publication checks retained authority before entering dual control', () => {
  const guard = migration.indexOf('perform private.assert_current_submission_evidence_authority(p_submission_id)');
  const delegate = migration.indexOf('private.publish_skill_submission_dual_control_unchecked(', guard);
  assert.ok(guard > 0);
  assert.ok(delegate > guard);
  assert.match(migration, /accepted or published submissions require explicit re-audit/);
  const exposedPublication = migration.slice(migration.indexOf('create function api.publish_skill_submission('));
  assert.doesNotMatch(exposedPublication, /private[.]publish_skill_submission_unchecked[(]/);
});

test('new-row constraints close before the stale-authority preflight', () => {
  const preflight = migration.indexOf("processing submissions owned by an unsupported worker");
  assert.ok(preflight > 0);
  for (const constraint of [
    'skill_submissions_current_worker_authority_check',
    'skill_audit_receipts_current_authority_check',
    'skill_grade_receipts_current_authority_check',
    'worker_runs_current_authority_check'
  ]) {
    const position = migration.indexOf(constraint);
    assert.ok(position > 0, constraint);
    assert.ok(position < preflight, `${constraint} must precede the preflight`);
  }
});
