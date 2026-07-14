import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deferGithubRateLimitedClaim,
  estimateGithubCoreRequestBudget,
  inspectGithubCoreRateLimit,
  prepareGithubBudgetedClaim
} from '../apps/worker/src/github-provider-gate.mjs';
import { GithubSourceFetchError } from '../dist/network/github-source-fetcher.js';

const SUBMISSION_ID = `sub_${'1'.repeat(32)}`;
const CLAIM_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_VERSION = 'skillmap-worker/0.1.0';
const RESET_AT = '2026-07-14T04:00:00.000Z';

function candidate() {
  return {
    submission_id: SUBMISSION_ID,
    repository_url: 'https://github.com/example/skills',
    source_commit: 'a'.repeat(40),
    source_path: 'skills/review/SKILL.md',
    version_label: '1.0.0',
    license_claim: 'MIT',
    attempt_number: 1
  };
}

function claim() {
  return {
    ...candidate(),
    claim_id: CLAIM_ID,
    claim_expires_at: '2026-07-14T03:05:00.000Z'
  };
}

test('provider budget counts the exact core API path before a claim', () => {
  assert.equal(estimateGithubCoreRequestBudget('SKILL.md', []), 3);
  assert.equal(estimateGithubCoreRequestBudget('skills/review/SKILL.md', []), 5);
  assert.equal(estimateGithubCoreRequestBudget(
    'skills/review/SKILL.md',
    ['LICENSE', 'skills/LICENSE']
  ), 10);
  assert.throws(
    () => estimateGithubCoreRequestBudget('../SKILL.md', []),
    /safe relative SKILL\.md path/
  );
  assert.throws(
    () => estimateGithubCoreRequestBudget('skills/review/SKILL.md', ['other/LICENSE']),
    /repository root or enclose/
  );
});

test('rate-limit inspection is unauthenticated, bounded, and parses core reset authority', async () => {
  let observed;
  const status = await inspectGithubCoreRateLimit({
    now: () => Date.parse('2026-07-14T03:00:00.000Z'),
    transport: async request => {
      observed = request;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({
          resources: { core: { limit: 60, remaining: 7, reset: Date.parse(RESET_AT) / 1000, used: 53 } }
        }))
      };
    }
  });
  assert.equal(observed.url, 'https://api.github.com/rate_limit');
  assert.equal(Object.keys(observed.headers).some(key => key.toLowerCase() === 'authorization'), false);
  assert.deepEqual(status, {
    limit: 60,
    remaining: 7,
    used: 53,
    resetAt: RESET_AT,
    retryAfterMs: 3_600_000
  });
});

test('an empty peek is idle without touching GitHub or a mutating RPC', async () => {
  const calls = [];
  const result = await prepareGithubBudgetedClaim({
    rpc: {
      async call(name, parameters) {
        calls.push([name, parameters]);
        return [];
      }
    },
    workerVersion: WORKER_VERSION,
    submissionId: null,
    licenseEvidencePaths: []
  }, {
    inspectRateLimit: async () => assert.fail('GitHub must not be inspected without a candidate')
  });
  assert.deepEqual(result, { result: 'idle', mutation: false });
  assert.deepEqual(calls.map(([name]) => name), ['peek_skill_submission_candidate']);
});

test('normal quota exhaustion exits before claim with mutation false', async () => {
  const calls = [];
  const rpc = {
    async call(name, parameters) {
      calls.push([name, parameters]);
      if (name === 'peek_skill_submission_candidate') return [candidate()];
      throw new Error(`Unexpected mutating RPC ${name}`);
    }
  };
  const result = await prepareGithubBudgetedClaim({
    rpc,
    workerVersion: WORKER_VERSION,
    submissionId: null,
    licenseEvidencePaths: []
  }, {
    now: () => Date.parse('2026-07-14T03:00:00.000Z'),
    inspectRateLimit: async () => ({
      limit: 60,
      remaining: 6,
      used: 54,
      resetAt: RESET_AT,
      retryAfterMs: 3_600_000
    })
  });
  assert.deepEqual(result, {
    result: 'provider-deferred',
    mutation: false,
    reason: 'github-core-budget',
    submissionId: SUBMISSION_ID,
    estimatedCoreRequests: 5,
    reserveCoreRequests: 2,
    requiredCoreRequests: 7,
    remainingCoreRequests: 6,
    retryAt: RESET_AT
  });
  assert.deepEqual(calls.map(([name]) => name), ['peek_skill_submission_candidate']);
});

test('normal quota exhaustion clamps a stale reset to a one-minute mutation-free deferral', async () => {
  const calls = [];
  const rpc = {
    async call(name, parameters) {
      calls.push([name, parameters]);
      if (name === 'peek_skill_submission_candidate') return [candidate()];
      throw new Error(`Unexpected mutating RPC ${name}`);
    }
  };
  const result = await prepareGithubBudgetedClaim({
    rpc,
    workerVersion: WORKER_VERSION,
    submissionId: null,
    licenseEvidencePaths: []
  }, {
    now: () => Date.parse('2026-07-14T03:00:00.000Z'),
    inspectRateLimit: async () => ({
      limit: 60,
      remaining: 6,
      used: 54,
      resetAt: '2026-07-14T02:59:59.000Z',
      retryAfterMs: 0
    })
  });
  assert.equal(result.retryAt, '2026-07-14T03:01:00.000Z');
  assert.equal(result.mutation, false);
  assert.deepEqual(calls.map(([name]) => name), ['peek_skill_submission_candidate']);
});

test('rate-limit inspection throttling is a mutation-free handled deferral', async () => {
  const calls = [];
  const rpc = {
    async call(name, parameters) {
      calls.push([name, parameters]);
      if (name === 'peek_skill_submission_candidate') return [candidate()];
      throw new Error(`Unexpected mutating RPC ${name}`);
    }
  };
  const result = await prepareGithubBudgetedClaim({
    rpc,
    workerVersion: WORKER_VERSION,
    submissionId: null,
    licenseEvidencePaths: []
  }, {
    now: () => Date.parse('2026-07-14T03:00:00.000Z'),
    inspectRateLimit: async () => {
      throw new GithubSourceFetchError('RATE_LIMITED', 'secondary limit', {
        retryable: true,
        statusCode: 403
      });
    }
  });
  assert.deepEqual(result, {
    result: 'provider-deferred',
    mutation: false,
    reason: 'github-rate-inspection',
    submissionId: SUBMISSION_ID,
    estimatedCoreRequests: 5,
    reserveCoreRequests: 2,
    requiredCoreRequests: 7,
    retryAt: '2026-07-14T03:01:00.000Z'
  });
  assert.deepEqual(calls.map(([name]) => name), ['peek_skill_submission_candidate']);
});

test('budgeted claim binds the mutating claim to the exact peeked candidate', async () => {
  const calls = [];
  const rpc = {
    async call(name, parameters) {
      calls.push([name, parameters]);
      if (name === 'peek_skill_submission_candidate') return [candidate()];
      if (name === 'claim_skill_submission') return [claim()];
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  const result = await prepareGithubBudgetedClaim({
    rpc,
    workerVersion: WORKER_VERSION,
    submissionId: null,
    licenseEvidencePaths: []
  }, {
    inspectRateLimit: async () => ({
      limit: 60,
      remaining: 7,
      used: 53,
      resetAt: RESET_AT,
      retryAfterMs: 3_600_000
    })
  });
  assert.equal(result.result, 'claimed');
  assert.equal(result.claim.submission_id, SUBMISSION_ID);
  assert.deepEqual(calls, [
    ['peek_skill_submission_candidate', { p_submission_id: null }],
    ['claim_skill_submission', {
      p_worker_version: WORKER_VERSION,
      p_submission_id: SUBMISSION_ID,
      p_lease_seconds: 300
    }]
  ]);
});

test('a lost exact-candidate race becomes idle and never claims a replacement', async () => {
  const calls = [];
  const rpc = {
    async call(name, parameters) {
      calls.push([name, parameters]);
      if (name === 'peek_skill_submission_candidate') return [candidate()];
      if (name === 'claim_skill_submission') return [];
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  const result = await prepareGithubBudgetedClaim({
    rpc,
    workerVersion: WORKER_VERSION,
    submissionId: null,
    licenseEvidencePaths: []
  }, {
    inspectRateLimit: async () => ({
      limit: 60,
      remaining: 60,
      used: 0,
      resetAt: RESET_AT,
      retryAfterMs: 3_600_000
    })
  });
  assert.deepEqual(result, { result: 'idle', mutation: false, reason: 'candidate-raced' });
  assert.equal(calls[1][1].p_submission_id, SUBMISSION_ID);
  assert.equal(calls.length, 2);
});

test('a candidate whose request budget exceeds the provider limit fails as operator configuration', async () => {
  const directoryComponents = Array.from({ length: 20 }, (_, index) => `d${index}`);
  const sourcePath = `${directoryComponents.join('/')}/SKILL.md`;
  const licenseEvidencePaths = Array.from({ length: 20 }, (_, depth) => {
    const directory = directoryComponents.slice(0, depth).join('/');
    return directory ? `${directory}/LICENSE` : 'LICENSE';
  });
  const rpc = {
    async call(name) {
      if (name === 'peek_skill_submission_candidate') return [{ ...candidate(), source_path: sourcePath }];
      throw new Error(`Unexpected mutating RPC ${name}`);
    }
  };
  await assert.rejects(
    prepareGithubBudgetedClaim({
      rpc,
      workerVersion: WORKER_VERSION,
      submissionId: null,
      licenseEvidencePaths
    }, {
      inspectRateLimit: async () => ({
        limit: 60,
        remaining: 60,
        used: 0,
        resetAt: RESET_AT,
        retryAfterMs: 3_600_000
      })
    }),
    /exceeds the provider limit 60/
  );
});

test('a raced post-claim GitHub limit uses non-terminal deferral instead of completion', async () => {
  const calls = [];
  const rpc = {
    async call(name, parameters) {
      calls.push([name, parameters]);
      if (name === 'defer_skill_submission_provider_limit') {
        return [{
          submission_id: SUBMISSION_ID,
          submission_state: 'queued',
          attempt_count: 0,
          provider_retry_after_at: RESET_AT,
          provider_defer_count: 1
        }];
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  const error = new GithubSourceFetchError(
    'RATE_LIMITED',
    'GitHub primary rate limit is exhausted.',
    { retryable: true, statusCode: 403, retryAfterMs: 3_600_000 }
  );
  const result = await deferGithubRateLimitedClaim(rpc, claim(), error, {
    workerVersion: WORKER_VERSION
  });
  assert.equal(result.result, 'provider-deferred');
  assert.equal(result.mutation, true);
  assert.equal(result.submission.attempt_count, 0);
  assert.deepEqual(calls.map(([name]) => name), ['defer_skill_submission_provider_limit']);
  assert.equal(calls[0][1].p_retry_after_seconds, 3600);
});
