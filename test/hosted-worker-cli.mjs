import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fetchGithubSkillTree } from '../dist/network/github-source-fetcher.js';
import { assertPublicGithubRepository } from '../apps/worker/src/public-github-repository.mjs';
import {
  parseReportDispositionArguments,
  runReportDisposition,
  validateReportDispositionResult
} from '../apps/worker/src/report-disposition.mjs';
import {
  parseReportQueueArguments,
  runReportQueue
} from '../apps/worker/src/report-queue.mjs';

const script = 'apps/worker/src/audit-once.mjs';
const queueScript = 'apps/worker/src/process-once.mjs';
const lifecycleScript = 'apps/worker/src/lifecycle.mjs';
const reportScript = 'apps/worker/src/report-disposition.mjs';
const reportQueueScript = 'apps/worker/src/report-queue.mjs';

test('hosted audit worker documents an exact-commit non-mutating dry run', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exact public GitHub skill version/i);
  assert.match(result.stdout, /without database mutation/i);
  assert.match(result.stdout, /--commit FULL_SHA/);
  assert.match(result.stdout, /unauthenticated public-repository preflight/i);
  assert.match(result.stdout, /GITHUB_TOKEN is not read/i);
  assert.match(result.stdout, /Authorization headers are never sent/i);
});

test('hosted audit worker accepts only matching public repository metadata without authorization', async () => {
  let observedRequest;
  const repository = await assertPublicGithubRepository('example/skills', {
    transport: async request => {
      observedRequest = request;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({
          full_name: 'Example/Skills',
          private: false,
          visibility: 'public'
        }))
      };
    }
  });

  assert.equal(repository, 'example/skills');
  assert.equal(observedRequest.url, 'https://api.github.com/repos/example/skills');
  assert.equal(observedRequest.method, 'GET');
  assert.equal(
    Object.keys(observedRequest.headers).some(name => name.toLowerCase() === 'authorization'),
    false
  );
});

test('hosted audit worker rejects private and other non-public repository metadata', async () => {
  for (const metadata of [
    { full_name: 'example/skills', private: true, visibility: 'private' },
    { full_name: 'example/skills', private: false, visibility: 'internal' },
    { full_name: 'different/skills', private: false, visibility: 'public' }
  ]) {
    await assert.rejects(
      assertPublicGithubRepository('example/skills', {
        transport: async () => ({
          status: 200,
          headers: {},
          body: Buffer.from(JSON.stringify(metadata))
        })
      }),
      /public repositories only|different repository identity/i
    );
  }
});

test('hosted audit worker rejects repository redirects and non-200 responses', async () => {
  for (const response of [
    { status: 301, headers: { location: 'https://api.github.com/repos/new/skills' }, body: Buffer.alloc(0) },
    { status: 403, headers: { 'x-ratelimit-remaining': '42' }, body: Buffer.from('{"message":"Resource not accessible"}') },
    { status: 404, headers: {}, body: Buffer.from('{}') }
  ]) {
    await assert.rejects(
      assertPublicGithubRepository('example/skills', { transport: async () => response }),
      /redirect|requires an unauthenticated 200 response/i
    );
  }
});

test('hosted repository preflight classifies GitHub primary-rate-limit 403 without weakening public checks', async () => {
  await assert.rejects(
    assertPublicGithubRepository('example/skills', {
      now: () => Date.parse('2026-07-14T03:00:00.000Z'),
      transport: async () => ({
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1784001600'
        },
        body: Buffer.from('{"message":"API rate limit exceeded"}')
      })
    }),
    error => {
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.retryable, true);
      assert.equal(error.statusCode, 403);
      assert.equal(error.retryAfterMs, 3_600_000);
      return true;
    }
  );

  await assert.rejects(
    assertPublicGithubRepository('example/skills', {
      transport: async () => ({
        status: 403,
        headers: { 'x-ratelimit-remaining': '42' },
        body: Buffer.from('{"message":"You have exceeded a secondary rate limit."}')
      })
    }),
    error => {
      assert.equal(error.code, 'RATE_LIMITED');
      assert.equal(error.retryable, true);
      assert.equal(error.statusCode, 403);
      assert.equal(error.retryAfterMs, undefined);
      return true;
    }
  );
});

test('hosted audit worker cannot opt content fetching into GitHub authorization', async () => {
  for (const workerSource of [readFileSync(script, 'utf8'), readFileSync(queueScript, 'utf8')]) {
    assert.doesNotMatch(workerSource, /process\.env\.GITHUB_TOKEN/);
    assert.doesNotMatch(workerSource, /\btoken\s*:/);
  }

  let observedRequest;
  await assert.rejects(fetchGithubSkillTree('example/skills', 'a'.repeat(40), '.', {
    maxRetries: 0,
    transport: async request => {
      observedRequest = request;
      throw new Error('stop after observing the first content request');
    }
  }));
  assert.ok(observedRequest, 'expected the content fetcher to issue a request');
  assert.equal(
    Object.keys(observedRequest.headers).some(name => name.toLowerCase() === 'authorization'),
    false
  );
});

test('hosted audit worker rejects mutable refs and traversal before network access', () => {
  const mutable = spawnSync(process.execPath, [script,
    '--repository', 'example/skills', '--commit', 'main', '--source-path', 'SKILL.md', '--license-state', 'noassertion'
  ], { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: 'PRIVATE-CANARY-TOKEN' } });
  assert.equal(mutable.status, 1);
  assert.match(mutable.stderr, /immutable lowercase 40- or 64-hex commit/i);
  assert.doesNotMatch(mutable.stderr + mutable.stdout, /PRIVATE-CANARY-TOKEN/);

  for (const sourcePath of ['../SKILL.md', './SKILL.md', 'skills//SKILL.md', 'skills/./SKILL.md']) {
    const invalid = spawnSync(process.execPath, [script,
      '--repository', 'example/skills', '--commit', 'a'.repeat(40), '--source-path', sourcePath, '--license-state', 'noassertion'
    ], { encoding: 'utf8' });
    assert.equal(invalid.status, 1, sourcePath);
    assert.match(invalid.stderr, /safe relative path/i, sourcePath);
  }
});

test('hosted audit worker rejects duplicate and unknown options', () => {
  for (const args of [
    ['--unknown', 'value'],
    ['--repository', 'one/repo', '--repository', 'two/repo']
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown option|only once/);
  }
});

test('hosted queue worker is mutation-explicit and documents server-only authority', () => {
  assert.match(readFileSync(queueScript, 'utf8'), /const WORKER_VERSION = 'skillmap-worker\/0\.2\.0';/);
  const help = spawnSync(process.execPath, [queueScript, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /service-role-only RPCs/i);
  assert.match(help.stdout, /Mutation requires: --execute/i);
  assert.match(help.stdout, /never a current letter grade/i);
  assert.match(help.stdout, /explicit root or enclosing files at the claimed exact commit/i);

  const refused = spawnSync(process.execPath, [queueScript], {
    encoding: 'utf8',
    env: { ...process.env, SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-CANARY-SERVICE-ROLE' }
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /without the explicit --execute flag/i);
  assert.doesNotMatch(refused.stderr + refused.stdout, /PRIVATE-CANARY/);

  const missingLicenseEvidence = spawnSync(process.execPath, [
    queueScript, '--license-state', 'confirmed', '--spdx', 'MIT'
  ], { encoding: 'utf8' });
  assert.equal(missingLicenseEvidence.status, 1);
  assert.match(missingLicenseEvidence.stderr, /license-review-reference is required/i);

  const reviewedButNotExecuted = spawnSync(process.execPath, [
    queueScript, '--license-state', 'confirmed', '--spdx', 'MIT',
    '--license-review-reference', `licref_${'1'.repeat(32)}`,
    '--license-review-evidence-digest', `sha256:${'2'.repeat(64)}`,
    '--license-evidence-path', 'LICENSE'
  ], { encoding: 'utf8' });
  assert.equal(reviewedButNotExecuted.status, 1);
  assert.match(reviewedButNotExecuted.stderr, /without the explicit --execute flag/i);

  for (const [args, pattern] of [
    [['--license-evidence-path', 'LICENSE'], /accepted only with a confirmed license/i],
    [[
      '--license-state', 'confirmed', '--spdx', 'MIT',
      '--license-review-reference', `licref_${'1'.repeat(32)}`,
      '--license-review-evidence-digest', `sha256:${'2'.repeat(64)}`,
      '--license-evidence-path', '../LICENSE'
    ], /safe relative LICENSE or COPYING file/i],
    [[
      '--license-state', 'confirmed', '--spdx', 'MIT',
      '--license-review-reference', `licref_${'1'.repeat(32)}`,
      '--license-review-evidence-digest', `sha256:${'2'.repeat(64)}`,
      '--license-evidence-path', 'LICENSE', '--license-evidence-path', 'LICENSE'
    ], /values must be unique/i]
  ]) {
    const invalidEvidence = spawnSync(process.execPath, [queueScript, ...args], { encoding: 'utf8' });
    assert.equal(invalidEvidence.status, 1);
    assert.match(invalidEvidence.stderr, pattern);
  }
});

test('catalog lifecycle and report disposition commands are mutation-explicit', () => {
  for (const [scriptPath, authority] of [
    [lifecycleScript, /Service-role-only, idempotent deprecation/i],
    [reportScript, /service-role-only idempotent RPC/i]
  ]) {
    const helpResult = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8' });
    assert.equal(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, authority);
    assert.match(helpResult.stdout, /exactly one mode/i);
    assert.match(helpResult.stdout, /--approve[\s\S]+--execute requires --approval-id/i);
    const refused = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-CANARY-SERVICE-ROLE' }
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Exactly one of --approve or --execute/i);
    assert.doesNotMatch(refused.stderr + refused.stdout, /PRIVATE-CANARY/);
  }
  const lifecycleSource = readFileSync(lifecycleScript, 'utf8');
  assert.match(lifecycleSource, /options[.]action === 'quarantine-version' && row[.]version_quarantined !== true/);
  assert.match(lifecycleSource, /options[.]action === 'restore-version'[\s\S]+row[.]version_revoked !== false/);
});

test('confirmed report disposition requires one exact atomic lifecycle action', () => {
  const base = [
    '--execute',
    '--approval-id', `opa_${'a'.repeat(32)}`,
    '--report-id', `rpt_${'1'.repeat(32)}`,
    '--disposition', 'confirmed',
    '--reason-code', 'credible-security-report',
    '--public-message', 'The exact reported version was quarantined.',
    '--operation-id', '11111111-1111-4111-8111-111111111111'
  ];
  assert.throws(
    () => parseReportDispositionArguments(base),
    /lifecycle-action must be quarantine-version or revoke-version/
  );
  assert.equal(
    parseReportDispositionArguments([...base, '--lifecycle-action', 'quarantine-version']).lifecycleAction,
    'quarantine-version'
  );
  assert.throws(
    () => parseReportDispositionArguments([
      '--execute',
      '--approval-id', `opa_${'a'.repeat(32)}`,
      '--report-id', `rpt_${'1'.repeat(32)}`,
      '--disposition', 'no-action',
      '--reason-code', 'not-confirmed',
      '--public-message', 'The report did not require catalog enforcement.',
      '--lifecycle-action', 'quarantine-version',
      '--operation-id', '11111111-1111-4111-8111-111111111111'
    ]),
    /only for a confirmed report/
  );
});

test('report disposition command binds the retained enforcement result to the RPC request', async () => {
  const options = parseReportDispositionArguments([
    '--execute',
    '--approval-id', `opa_${'a'.repeat(32)}`,
    '--report-id', `rpt_${'1'.repeat(32)}`,
    '--disposition', 'confirmed',
    '--reason-code', 'credible-security-report',
    '--public-message', 'The exact reported version was revoked.',
    '--lifecycle-action', 'revoke-version',
    '--operation-id', '11111111-1111-4111-8111-111111111111'
  ]);
  const calls = [];
  const row = {
    report_id: options.reportId,
    report_state: 'resolved',
    disposition_code: 'confirmed',
    skill_id: `skl_${'2'.repeat(32)}`,
    version_id: `skv_${'3'.repeat(32)}`,
    lifecycle_action: 'revoke-version',
    version_quarantined: false,
    version_revoked: true
  };
  const receipt = await runReportDisposition(options, {
    rpc: {
      async call(name, parameters) {
        calls.push([name, parameters]);
        return [row];
      }
    }
  });
  assert.equal(receipt.mutation, true);
  assert.match(receipt.idempotencyDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.report[0].version_revoked, true);
  assert.equal(calls[0][0], 'disposition_skill_report');
  assert.equal(calls[0][1].p_lifecycle_action, 'revoke-version');
  assert.equal(calls[0][1].p_idempotency_digest, receipt.idempotencyDigest);
  assert.throws(
    () => validateReportDispositionResult([{ ...row, version_revoked: false }], options),
    /invalid report projection/
  );
  assert.throws(
    () => validateReportDispositionResult([{ ...row, version_quarantined: 'not-a-boolean' }], options),
    /invalid report projection/
  );
});

test('report queue access is bounded, read-only, and credential-explicit', () => {
  const helpResult = spawnSync(process.execPath, [reportQueueScript, '--help'], { encoding: 'utf8' });
  assert.equal(helpResult.status, 0, helpResult.stderr);
  assert.match(helpResult.stdout, /at most 50 queued reports after an exact paired cursor/i);
  assert.match(helpResult.stdout, /remains read-only/i);
  const refused = spawnSync(process.execPath, [reportQueueScript], {
    encoding: 'utf8',
    env: { ...process.env, SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-CANARY-SERVICE-ROLE' }
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /without the explicit --execute flag/i);
  assert.doesNotMatch(refused.stderr + refused.stdout, /PRIVATE-CANARY/);
  const invalidLimit = spawnSync(process.execPath, [reportQueueScript, '--execute', '--limit', '51'], { encoding: 'utf8' });
  assert.equal(invalidLimit.status, 1);
  assert.match(invalidLimit.stderr, /from 1 through 50/i);
});

test('report queue paired cursor makes rows after the first page reachable', async () => {
  const createdAt = '2026-07-14T01:00:00.000Z';
  const reportId = `rpt_${'4'.repeat(32)}`;
  assert.throws(
    () => parseReportQueueArguments(['--after-created-at', createdAt]),
    /Both report cursor options/
  );
  const options = parseReportQueueArguments([
    '--execute', '--limit', '1',
    '--after-created-at', createdAt,
    '--after-report-id', reportId
  ]);
  const calls = [];
  const next = {
    report_id: `rpt_${'5'.repeat(32)}`,
    skill_id: `skl_${'6'.repeat(32)}`,
    version_id: `skv_${'7'.repeat(32)}`,
    category: 'security',
    message: 'A later report remains reachable through the exact paired cursor.',
    created_at: '2026-07-14T01:01:00.000Z'
  };
  const result = await runReportQueue(options, {
    rpc: {
      async call(name, parameters) {
        calls.push([name, parameters]);
        return [next];
      }
    }
  });
  assert.equal(result.count, 1);
  assert.deepEqual(result.nextCursor, {
    createdAt: next.created_at,
    reportId: next.report_id
  });
  assert.deepEqual(calls, [[
    'list_skill_report_queue',
    {
      p_limit: 1,
      p_after_created_at: createdAt,
      p_after_report_id: reportId
    }
  ]]);
});
