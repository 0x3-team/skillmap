import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  loadOperationsPolicy,
  parseOperationsCheckArguments,
  runOperationsCheck
} from '../apps/worker/src/operations-check.mjs';

const observedAt = '2026-07-14T02:00:00.000Z';
const policy = Object.freeze({
  maxQueuedAgeSeconds: 3600,
  maxAcceptedAgeSeconds: 7200,
  maxRemediationAgeSeconds: 86400,
  maxReportAgeSeconds: 3600,
  maxQueuedSubmissions: 32,
  maxQueuedReports: 20
});

function submissionSummary(overrides = {}) {
  return {
    observed_at: observedAt,
    queued_count: 1,
    processing_count: 0,
    accepted_count: 0,
    changes_requested_count: 0,
    failed_count: 0,
    expired_processing_count: 0,
    retryable_count: 0,
    dead_letter_ready_count: 0,
    oldest_queued_at: '2026-07-14T01:55:00.000Z',
    oldest_processing_claim_expires_at: null,
    oldest_accepted_at: null,
    oldest_remediation_at: null,
    ...overrides
  };
}

function reportRow(index, createdAt = '2026-07-14T01:50:00.000Z') {
  const suffix = index.toString(16).padStart(32, '0');
  return {
    report_id: `rpt_${suffix}`,
    skill_id: `skl_${suffix}`,
    version_id: `skv_${suffix}`,
    category: 'security',
    message: `Bounded private report fixture ${index} remains outside the operations receipt.`,
    created_at: createdAt
  };
}

function rpcFixture(summary, reports) {
  return {
    async call(name) {
      if (name === 'get_skill_submission_queue_summary') return [summary];
      if (name === 'list_skill_submission_operator_queue') return [];
      if (name === 'list_skill_report_queue') return reports;
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
}

test('operations check emits an identifier-free passing receipt for healthy bounded queues', async () => {
  const receipt = await runOperationsCheck(
    parseOperationsCheckArguments(['--execute']),
    { rpc: rpcFixture(submissionSummary(), [reportRow(1)]), policy }
  );
  assert.equal(receipt.result, 'passed');
  assert.equal(receipt.mutation, false);
  assert.equal(receipt.metrics.submissions.oldestQueuedSeconds, 300);
  assert.equal(receipt.metrics.reports.oldestQueuedSeconds, 600);
  assert.deepEqual(receipt.alerts, []);
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /rpt_|skl_|skv_|private report fixture/i);
});

test('operations check exits the happy path for lease, retry, dead-letter, age, and backlog alerts', async () => {
  const reports = Array.from({ length: 21 }, (_, index) => reportRow(index + 1, '2026-07-14T00:00:00.000Z'));
  const receipt = await runOperationsCheck(
    parseOperationsCheckArguments(['--execute']),
    {
      rpc: rpcFixture(submissionSummary({
        queued_count: 40,
        accepted_count: 1,
        failed_count: 1,
        expired_processing_count: 1,
        retryable_count: 1,
        dead_letter_ready_count: 1,
        oldest_queued_at: '2026-07-14T00:00:00.000Z',
        oldest_accepted_at: '2026-07-13T23:00:00.000Z'
      }), reports),
      policy
    }
  );
  assert.equal(receipt.result, 'alert');
  const codes = new Set(receipt.alerts.map(alert => alert.code));
  for (const code of [
    'SUBMISSION_QUEUE_COUNT_HIGH',
    'SUBMISSION_QUEUE_AGE_HIGH',
    'PUBLICATION_REVIEW_AGE_HIGH',
    'EXPIRED_PROCESSING_CLAIM',
    'RETRYABLE_SUBMISSION_PENDING',
    'DEAD_LETTER_ACTION_REQUIRED',
    'FAILED_SUBMISSION_PRESENT',
    'REPORT_QUEUE_COUNT_HIGH',
    'REPORT_QUEUE_AGE_HIGH'
  ]) assert.equal(codes.has(code), true, code);
});

test('operations thresholds are bounded canonical integers', () => {
  assert.deepEqual(loadOperationsPolicy({}), policy);
  assert.equal(loadOperationsPolicy({
    SKILLMAP_OPS_MAX_QUEUED_AGE_SECONDS: '600'
  }).maxQueuedAgeSeconds, 600);
  for (const value of [' 600', '0', '-1', '60.5', '999999999999999999999']) {
    assert.throws(
      () => loadOperationsPolicy({ SKILLMAP_OPS_MAX_QUEUED_AGE_SECONDS: value }),
      /canonical positive integer|must be from/
    );
  }
});

test('operations check refuses credential access before loading secrets', () => {
  const result = spawnSync(process.execPath, ['apps/worker/src/operations-check.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-CANARY-SERVICE-ROLE-KEY-DO-NOT-PRINT'
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /without the explicit --execute flag/i);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-CANARY/);
});
