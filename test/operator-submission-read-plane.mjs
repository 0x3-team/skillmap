import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  parseSubmissionQueueArguments,
  runSubmissionQueue,
  validateSubmissionQueueRow,
  validateSubmissionQueueSummary
} from '../apps/worker/src/submission-queue.mjs';
import {
  parseSubmissionDetailArguments,
  runSubmissionDetail,
  validateSubmissionDetail
} from '../apps/worker/src/submission-detail.mjs';

const timestamp = '2026-07-13T20:00:00.000Z';
const submissionId = `sub_${'1'.repeat(32)}`;

function summaryFixture() {
  return {
    observed_at: timestamp,
    queued_count: 1,
    processing_count: 0,
    accepted_count: 0,
    changes_requested_count: 0,
    failed_count: 0,
    expired_processing_count: 0,
    retryable_count: 0,
    dead_letter_ready_count: 0,
    oldest_queued_at: timestamp,
    oldest_processing_claim_expires_at: null,
    oldest_accepted_at: null,
    oldest_remediation_at: null
  };
}

function queueFixture() {
  return {
    observed_at: timestamp,
    submission_id: submissionId,
    submission_state: 'queued',
    repository_url: 'https://github.com/example/skills',
    source_commit: 'a'.repeat(40),
    source_path: 'skills/example/SKILL.md',
    version_label: '1.0.0',
    submitter_license_claim: 'MIT',
    attempt_count: 0,
    current_worker_version: null,
    audit_state: 'not-run',
    grade_state: 'ungraded',
    review_state: 'not-started',
    remediation_code: null,
    public_status_message: null,
    result_skill_id: null,
    result_version_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    claimed_at: null,
    claim_expires_at: null,
    completed_at: null,
    claim_expired: false,
    retry_eligible: false,
    dead_letter_ready: false,
    publication_review_ready: false
  };
}

function detailFixture() {
  return {
    observed_at: timestamp,
    submission_id: submissionId,
    submission_state: 'queued',
    repository_url: 'https://github.com/example/skills',
    source_commit: 'a'.repeat(40),
    source_path: 'skills/example/SKILL.md',
    version_label: '1.0.0',
    submitter_license_claim: 'MIT',
    submission_policy_version: 'public-alpha-draft/v1',
    authority_confirmed: true,
    untrusted_processing_accepted: true,
    attempt_count: 0,
    current_worker_version: null,
    audit_state: 'not-run',
    grade_state: 'ungraded',
    review_state: 'not-started',
    remediation_code: null,
    public_status_message: null,
    result_skill_id: null,
    result_version_id: null,
    publication_digest: null,
    last_transition_digest: null,
    created_at: timestamp,
    updated_at: timestamp,
    claimed_at: null,
    claim_expires_at: null,
    completed_at: null,
    claim_expired: false,
    retry_eligible: false,
    dead_letter_ready: false,
    publication_review_ready: false,
    audit_receipt: null,
    grade_receipt: null,
    review_case: null,
    worker_runs: [],
    transition_events: [],
    transition_events_truncated: false,
    license_evidence_receipt: null,
    collision_reviews: [],
    collision_reviews_truncated: false,
    publisher_authorizations: [],
    publisher_authorizations_truncated: false
  };
}

test('operator queue arguments require explicit bounded cursor pairs', () => {
  assert.deepEqual(parseSubmissionQueueArguments([]), {
    help: false,
    execute: false,
    state: null,
    limit: 20,
    afterUpdatedAt: null,
    afterSubmissionId: null
  });
  assert.deepEqual(parseSubmissionQueueArguments([
    '--execute', '--state', 'failed', '--limit', '5',
    '--after-updated-at', timestamp, '--after-submission-id', submissionId
  ]), {
    help: false,
    execute: true,
    state: 'failed',
    limit: 5,
    afterUpdatedAt: timestamp,
    afterSubmissionId: submissionId
  });
  assert.throws(() => parseSubmissionQueueArguments(['--limit', '33']), /1 through 32/);
  assert.throws(() => parseSubmissionQueueArguments(['--state', 'all']), /exact supported/);
  assert.throws(() => parseSubmissionQueueArguments(['--after-updated-at', timestamp]), /supplied together/);
  assert.throws(() => parseSubmissionQueueArguments([
    '--after-updated-at', 'July 13 2026', '--after-submission-id', submissionId
  ]), /ISO timestamp/);
  assert.throws(() => parseSubmissionQueueArguments([
    '--after-updated-at', timestamp, '--after-submission-id', 'sub_bad'
  ]), /valid submission ID/);
});

test('operator summary and queue validators reject expanded or contradictory projections', () => {
  assert.equal(validateSubmissionQueueSummary(summaryFixture()).queued_count, 1);
  assert.equal(validateSubmissionQueueRow(queueFixture()).submission_id, submissionId);
  assert.throws(() => validateSubmissionQueueSummary({ ...summaryFixture(), submitter_user_id: 'canary' }),
    /invalid projection/);
  assert.throws(() => validateSubmissionQueueRow({ ...queueFixture(), active_claim_id: 'canary' }),
    /invalid submission projection/);
  assert.throws(() => validateSubmissionQueueRow({
    ...queueFixture(), dead_letter_ready: true, claim_expired: false
  }), /inconsistent dead-letter/);
});

test('operator queue command calls only the bounded read RPCs and emits a cursor', async () => {
  const calls = [];
  const rpc = {
    async call(name, parameters) {
      calls.push([name, parameters]);
      if (name === 'get_skill_submission_queue_summary') return [summaryFixture()];
      if (name === 'list_skill_submission_operator_queue') return [queueFixture()];
      throw new Error('unexpected RPC');
    }
  };
  const result = await runSubmissionQueue(parseSubmissionQueueArguments(['--execute', '--limit', '1']), { rpc });
  assert.equal(result.mutation, false);
  assert.equal(result.count, 1);
  assert.equal(result.cursorSemantics, 'best-effort-live-by-updated-at-restart-required');
  assert.equal(result.reconciliationRequired, true);
  assert.deepEqual(result.nextCursor, { updatedAt: timestamp, submissionId });
  assert.deepEqual(calls.map(([name]) => name), [
    'get_skill_submission_queue_summary', 'list_skill_submission_operator_queue'
  ]);
  assert.equal(calls[1][1].p_limit, 1);
  assert.equal(calls[1][1].p_after_updated_at, null);
});

test('operator validators count Unicode code points like PostgreSQL', () => {
  const versionLabel = '😀'.repeat(100);
  assert.equal(validateSubmissionQueueRow({ ...queueFixture(), version_label: versionLabel }).version_label,
    versionLabel);
  assert.equal(validateSubmissionDetail({ ...detailFixture(), version_label: versionLabel }).version_label,
    versionLabel);
  assert.throws(() => validateSubmissionQueueRow({
    ...queueFixture(), version_label: '😀'.repeat(101)
  }), /invalid submission projection/);
});

test('maximum legal 32-row queue projection stays below the RPC response cap', () => {
  const rows = Array.from({ length: 32 }, (_, index) => validateSubmissionQueueRow({
    ...queueFixture(),
    submission_id: `sub_${index.toString(16).padStart(32, '0')}`,
    repository_url: `https://github.com/${'a'.repeat(100)}/${'b'.repeat(99)}${index % 10}`,
    source_path: `${'😀'.repeat(491)}/SKILL.md`,
    version_label: '😀'.repeat(100),
    submitter_license_claim: 'A'.repeat(200),
    current_worker_version: 'w'.repeat(128),
    remediation_code: 'A'.repeat(64),
    public_status_message: '😀'.repeat(500),
    result_skill_id: `skl_${index.toString(16).padStart(32, '0')}`,
    result_version_id: `skv_${index.toString(16).padStart(32, '0')}`
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(rows), 'utf8') < 262_144);
});

test('operator detail arguments require one exact public submission ID', () => {
  assert.deepEqual(parseSubmissionDetailArguments(['--execute', '--submission-id', submissionId]), {
    help: false, execute: true, submissionId
  });
  assert.throws(() => parseSubmissionDetailArguments([]), /valid submission ID/);
  assert.throws(() => parseSubmissionDetailArguments(['--submission-id', 'bad']), /valid submission ID/);
  assert.throws(() => parseSubmissionDetailArguments([
    '--submission-id', submissionId, '--submission-id', submissionId
  ]), /only once/);
});

test('operator detail validator is exact-key and history-cap fail closed', () => {
  assert.equal(validateSubmissionDetail(detailFixture()).submission_id, submissionId);
  assert.throws(() => validateSubmissionDetail({
    ...detailFixture(), private_evidence_digest: `sha256:${'f'.repeat(64)}`
  }), /invalid core projection/);
  assert.throws(() => validateSubmissionDetail({
    ...detailFixture(),
    transition_events: Array.from({ length: 51 }, () => ({}))
  }), /invalid transition history/);
  assert.throws(() => validateSubmissionDetail({
    ...detailFixture(), transition_events_truncated: true
  }), /invalid transition history/);
});

test('operator detail command calls only the exact read RPC', async () => {
  const calls = [];
  const rpc = {
    async call(name, parameters) {
      calls.push([name, parameters]);
      return [detailFixture()];
    }
  };
  const result = await runSubmissionDetail({ execute: true, submissionId }, { rpc });
  assert.equal(result.mutation, false);
  assert.equal(result.submission.submission_id, submissionId);
  assert.deepEqual(calls, [[
    'get_skill_submission_operator_detail', { p_submission_id: submissionId }
  ]]);
});

test('operator commands refuse credential use before loading environment secrets', () => {
  for (const [script, args] of [
    ['apps/worker/src/submission-queue.mjs', []],
    ['apps/worker/src/submission-detail.mjs', ['--submission-id', submissionId]]
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-CANARY-SERVICE-ROLE-KEY-DO-NOT-PRINT'
      }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /without the explicit --execute flag/i);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-CANARY/);
  }
});
