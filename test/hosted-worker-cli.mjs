import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fetchGithubSkillTree } from '../dist/network/github-source-fetcher.js';
import { assertPublicGithubRepository } from '../apps/worker/src/public-github-repository.mjs';

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
    { status: 404, headers: {}, body: Buffer.from('{}') }
  ]) {
    await assert.rejects(
      assertPublicGithubRepository('example/skills', { transport: async () => response }),
      /redirect|requires an unauthenticated 200 response/i
    );
  }
});

test('hosted audit worker cannot opt content fetching into GitHub authorization', async () => {
  const workerSource = readFileSync(script, 'utf8');
  assert.doesNotMatch(workerSource, /process\.env\.GITHUB_TOKEN/);
  assert.doesNotMatch(workerSource, /\btoken\s*:/);

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
  const help = spawnSync(process.execPath, [queueScript, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /service-role-only RPCs/i);
  assert.match(help.stdout, /Mutation requires: --execute/i);
  assert.match(help.stdout, /never a current letter grade/i);

  const refused = spawnSync(process.execPath, [queueScript], {
    encoding: 'utf8',
    env: { ...process.env, SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-CANARY-SERVICE-ROLE' }
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /without the explicit --execute flag/i);
  assert.doesNotMatch(refused.stderr + refused.stdout, /PRIVATE-CANARY/);
});

test('catalog lifecycle and report disposition commands are mutation-explicit', () => {
  for (const [scriptPath, authority] of [
    [lifecycleScript, /Service-role-only, idempotent deprecation/i],
    [reportScript, /service-role-only idempotent RPC/i]
  ]) {
    const helpResult = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8' });
    assert.equal(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, authority);
    assert.match(helpResult.stdout, /Mutation requires: --execute/i);
    const refused = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: 'PRIVATE-CANARY-SERVICE-ROLE' }
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /without the explicit --execute flag|Refusing report disposition/i);
    assert.doesNotMatch(refused.stderr + refused.stdout, /PRIVATE-CANARY/);
  }
});

test('report queue access is bounded, read-only, and credential-explicit', () => {
  const helpResult = spawnSync(process.execPath, [reportQueueScript, '--help'], { encoding: 'utf8' });
  assert.equal(helpResult.status, 0, helpResult.stderr);
  assert.match(helpResult.stdout, /at most 50 oldest queued reports/i);
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
