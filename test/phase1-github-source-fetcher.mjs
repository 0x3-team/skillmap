import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  fetchGithubExactSourceFile,
  fetchGithubSkillTree,
  GithubSourceFetchError,
  validateGithubImmutableCommit,
  validateGithubRef,
  validateGithubRepository,
  validateGithubSourceFilePath,
  validateGithubSubtree
} from '../dist/network/github-source-fetcher.js';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const ROOT_TREE = '1'.repeat(40);
const SKILLS_TREE = '2'.repeat(40);
const SKILL_TREE = '3'.repeat(40);

test('GitHub source coordinates reject ambiguous repositories, refs, and traversal', () => {
  assert.equal(validateGithubRepository('openai/.github'), 'openai/.github');
  assert.equal(validateGithubRef('feature/source-v2'), 'feature/source-v2');
  assert.equal(validateGithubSubtree('skills/frontend-design'), 'skills/frontend-design');
  assert.equal(validateGithubSubtree('.'), '');

  for (const repository of ['https://github.com/openai/repo', 'openai', 'openai/repo/extra', '../repo', 'owner_/repo']) {
    assert.throws(() => validateGithubRepository(repository), errorCode('INVALID_REPOSITORY'));
  }
  for (const ref of ['', '../main', 'refs//heads/main', 'feature/@{one}', 'main?raw=1', 'main%2Fother', '.hidden/main']) {
    assert.throws(() => validateGithubRef(ref), errorCode('INVALID_REF'));
  }
  for (const subtree of ['', '../skill', '/absolute', 'skills\\demo', 'skills//demo', 'skills/./demo']) {
    assert.throws(() => validateGithubSubtree(subtree), errorCode('INVALID_SUBTREE'));
  }
});

test('exact source files are bounded to an immutable commit and verified Git blob identity', async () => {
  const fixture = createExactFileFixture({ content: 'MIT License\n' });
  const file = await fetchGithubExactSourceFile('owner/repo', COMMIT_A, 'LICENSE', {
    transport: fixture.transport,
    maxResponseBytes: 1024
  });
  assert.equal(file.repository, 'owner/repo');
  assert.equal(file.resolvedCommit, COMMIT_A);
  assert.equal(file.path, 'LICENSE');
  assert.equal(Buffer.from(file.bytes).toString(), 'MIT License\n');
  assert.match(file.contentDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(fixture.rawUrls, [`https://raw.githubusercontent.com/owner/repo/${COMMIT_A}/LICENSE`]);
  assert.equal(validateGithubImmutableCommit(COMMIT_A), COMMIT_A);
  assert.equal(validateGithubSourceFilePath('licenses/COPYING.md'), 'licenses/COPYING.md');

  let calls = 0;
  for (const [commit, sourcePath, code] of [
    ['main', 'LICENSE', 'INVALID_REF'],
    [COMMIT_A, '../LICENSE', 'INVALID_SOURCE_PATH']
  ]) {
    await assert.rejects(fetchGithubExactSourceFile('owner/repo', commit, sourcePath, {
      transport: async () => { calls += 1; return response(500); }
    }), errorCode(code));
  }
  assert.equal(calls, 0);

  const mismatchedCommit = createExactFileFixture({ content: 'MIT License\n', resolvedCommit: COMMIT_B });
  await assert.rejects(
    fetchGithubExactSourceFile('owner/repo', COMMIT_A, 'LICENSE', { transport: mismatchedCommit.transport }),
    errorCode('SOURCE_CHANGED')
  );
  assert.equal(mismatchedCommit.rawUrls.length, 0);

  const tampered = createExactFileFixture({ content: 'MIT License\n', rawContent: 'different bytes\n' });
  await assert.rejects(
    fetchGithubExactSourceFile('owner/repo', COMMIT_A, 'LICENSE', { transport: tampered.transport }),
    errorCode('SOURCE_CHANGED')
  );
});

test('mutable refs resolve once, raw reads remain commit-bound, full manifests detect added scripts, and concurrency is bounded', async () => {
  const baselineFixture = createFixtureTransport({
    files: { 'SKILL.md': '# Demo\n' }
  });
  const baseline = await fetchGithubSkillTree('owner/repo', 'feature/source-v2', 'skills/demo', {
    transport: baselineFixture.transport,
    concurrency: 2
  });

  let currentBranchCommit = COMMIT_A;
  let commitRequests = 0;
  const withScriptFixture = createFixtureTransport({
    files: {
      'SKILL.md': '# Demo\n',
      'scripts/pwn.sh': '#!/bin/sh\necho test\n',
      'references/guide.md': '# Guide\n'
    },
    rawDelayMs: 2,
    reverseEntries: true,
    onCommitRequest() {
      commitRequests += 1;
      const resolved = currentBranchCommit;
      currentBranchCommit = COMMIT_B;
      return resolved;
    }
  });
  const withScript = await fetchGithubSkillTree('owner/repo', 'feature/source-v2', 'skills/demo', {
    transport: withScriptFixture.transport,
    concurrency: 2
  });

  assert.equal(commitRequests, 1);
  assert.equal(withScript.resolvedCommit, COMMIT_A);
  assert.equal(withScript.requestedRef, 'feature/source-v2');
  assert.equal(withScriptFixture.commitUrls[0].includes('feature%2Fsource-v2'), true);
  assert.equal(withScriptFixture.rawUrls.every(url => url.includes(`/${COMMIT_A}/`)), true);
  assert.equal(withScriptFixture.rawUrls.some(url => url.includes(`/${COMMIT_B}/`)), false);
  assert.ok(withScriptFixture.maxActiveRaw <= 2);
  assert.ok(withScriptFixture.maxActiveRaw >= 2);
  assert.ok(withScript.entries.some(entry => entry.path === 'scripts' && entry.type === 'directory'));
  assert.ok(withScript.entries.some(entry => entry.path === 'scripts/pwn.sh' && entry.type === 'file'));
  assert.notEqual(withScript.manifestDigest, baseline.manifestDigest);
  assert.match(withScript.manifestDigest, /^sha256:[a-f0-9]{64}$/);

  const reorderedFixture = createFixtureTransport({
    files: {
      'SKILL.md': '# Demo\n',
      'scripts/pwn.sh': '#!/bin/sh\necho test\n',
      'references/guide.md': '# Guide\n'
    }
  });
  const reordered = await fetchGithubSkillTree('owner/repo', 'feature/source-v2', 'skills/demo', {
    transport: reorderedFixture.transport,
    concurrency: 1
  });
  assert.equal(reordered.manifestDigest, withScript.manifestDigest);
  assert.deepEqual(reordered.entries, withScript.entries);
});

test('hung and oversized transports fail within explicit request bounds', async () => {
  await assert.rejects(
    fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
      transport: async () => new Promise(() => {}),
      timeoutMs: 5,
      maxRetries: 0
    }),
    errorCode('REQUEST_TIMEOUT')
  );

  await assert.rejects(
    fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
      transport: async () => response(200, Buffer.alloc(65)),
      maxResponseBytes: 64,
      maxRetries: 0
    }),
    errorCode('RESPONSE_TOO_LARGE')
  );
});

test('408/429/5xx retries are bounded, Retry-After is capped, and 401 is never retried', async () => {
  const fixture = createFixtureTransport({ files: { 'SKILL.md': '# Demo\n' } });
  let commitAttempts = 0;
  const sleeps = [];
  const retried = await fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
    transport: async request => {
      if (request.url.includes('/commits/')) {
        commitAttempts += 1;
        if (commitAttempts === 1) return response(429, 'rate limited', { 'retry-after': '100' });
      }
      return fixture.transport(request);
    },
    maxRetries: 1,
    maxRetryAfterMs: 25,
    sleep: async milliseconds => { sleeps.push(milliseconds); }
  });
  assert.equal(retried.resolvedCommit, COMMIT_A);
  assert.equal(commitAttempts, 2);
  assert.deepEqual(sleeps, [25]);

  const token = 'private-token-that-must-never-leak';
  let unauthorizedCalls = 0;
  await assert.rejects(
    fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
      token,
      maxRetries: 5,
      transport: async request => {
        unauthorizedCalls += 1;
        assert.equal(request.headers.authorization, `Bearer ${token}`);
        return response(401, `server echoed ${token}`);
      }
    }),
    error => {
      assert.ok(error instanceof GithubSourceFetchError);
      assert.equal(error.code, 'HTTP_ERROR');
      assert.equal(error.statusCode, 401);
      assert.equal(String(error).includes(token), false);
      assert.equal(JSON.stringify(error).includes(token), false);
      return true;
    }
  );
  assert.equal(unauthorizedCalls, 1);

  await assert.rejects(
    fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
      token,
      transport: async () => { throw new Error(token); }
    }),
    error => {
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.equal(String(error).includes(token), false);
      return true;
    }
  );
});

test('ETag cache reuses only digest-verified content and never stores credentials', async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'skillmap-github-cache-'));
  const token = 'cache-private-token';
  const initialFixture = createFixtureTransport({ files: { 'SKILL.md': '# Cached Demo\n' }, etags: true });
  const first = await fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
    transport: initialFixture.transport,
    cacheDir,
    token
  });
  assert.equal(JSON.stringify(first).includes(token), false);
  const initialCacheFiles = listFiles(cacheDir);
  assert.ok(initialCacheFiles.length >= 4);
  assert.equal(initialCacheFiles.some(file => readFileSync(file, 'utf8').includes(token)), false);

  let conditionalRequests = 0;
  const validatingTransport = async request => {
    if (request.headers['if-none-match']) {
      conditionalRequests += 1;
      return response(304, '', { etag: request.headers['if-none-match'] });
    }
    throw new Error('expected a conditional cache request');
  };
  const second = await fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
    transport: validatingTransport,
    cacheDir,
    token
  });
  assert.equal(second.manifestDigest, first.manifestDigest);
  assert.ok(conditionalRequests >= 4);

  for (const file of listFiles(cacheDir)) {
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    cached.bodyBase64 = Buffer.from('tampered-cache-body').toString('base64');
    writeFileSync(file, `${JSON.stringify(cached)}\n`);
  }
  const recoveryFixture = createFixtureTransport({ files: { 'SKILL.md': '# Cached Demo\n' }, etags: true });
  let staleValidators = 0;
  const recovered = await fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
    cacheDir,
    token,
    transport: async request => {
      if (request.headers['if-none-match']) staleValidators += 1;
      return recoveryFixture.transport(request);
    }
  });
  assert.equal(staleValidators, 0);
  assert.equal(recovered.manifestDigest, first.manifestDigest);
  assert.equal(listFiles(cacheDir).some(file => readFileSync(file, 'utf8').includes(token)), false);
});

test('recursive manifests reject traversal, symlinks, submodules, unsupported modes, and entry/byte overflow', async () => {
  const invalidEntries = [
    { path: '../escape', mode: '100644', type: 'blob', sha: '7'.repeat(40), size: 1 },
    { path: 'linked', mode: '120000', type: 'blob', sha: '7'.repeat(40), size: 4 },
    { path: 'nested-repo', mode: '160000', type: 'commit', sha: '7'.repeat(40) },
    { path: 'device', mode: '100600', type: 'blob', sha: '7'.repeat(40), size: 1 }
  ];
  for (const invalidEntry of invalidEntries) {
    const fixture = createFixtureTransport({
      files: { 'SKILL.md': '# Demo\n' },
      extraEntries: [invalidEntry]
    });
    await assert.rejects(
      fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', { transport: fixture.transport }),
      error => {
        assert.ok(['INVALID_RESPONSE', 'UNSUPPORTED_ENTRY'].includes(error.code));
        return true;
      }
    );
    assert.equal(fixture.rawUrls.length, 0);
  }

  const oversizedFixture = createFixtureTransport({ files: { 'SKILL.md': '# This tree is larger than ten bytes.\n' } });
  await assert.rejects(
    fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
      transport: oversizedFixture.transport,
      maxTotalBytes: 10
    }),
    errorCode('SOURCE_TREE_TOO_LARGE')
  );
  assert.equal(oversizedFixture.rawUrls.length, 0);

  const entryFixture = createFixtureTransport({
    files: { 'SKILL.md': '# Demo\n', 'scripts/check.sh': '#!/bin/sh\n' }
  });
  await assert.rejects(
    fetchGithubSkillTree('owner/repo', 'main', 'skills/demo', {
      transport: entryFixture.transport,
      maxEntries: 1
    }),
    errorCode('SOURCE_ENTRY_LIMIT')
  );
  assert.equal(entryFixture.rawUrls.length, 0);
});

function createFixtureTransport({
  files,
  extraEntries = [],
  reverseEntries = false,
  rawDelayMs = 0,
  etags = false,
  onCommitRequest = () => COMMIT_A
}) {
  const fileBuffers = new Map(Object.entries(files).map(([file, content]) => [file, Buffer.from(content)]));
  const directoryPaths = new Set();
  for (const file of fileBuffers.keys()) {
    const components = file.split('/');
    for (let index = 1; index < components.length; index += 1) directoryPaths.add(components.slice(0, index).join('/'));
  }
  const recursiveEntries = [
    ...[...directoryPaths].map(directory => ({
      path: directory,
      mode: '040000',
      type: 'tree',
      sha: createHash('sha1').update(`tree:${directory}`).digest('hex')
    })),
    ...[...fileBuffers.entries()].map(([file, bytes]) => ({
      path: file,
      mode: file.endsWith('.sh') ? '100755' : '100644',
      type: 'blob',
      sha: gitBlobSha(bytes),
      size: bytes.length
    })),
    ...extraEntries
  ];
  if (reverseEntries) recursiveEntries.reverse();

  let activeRaw = 0;
  const state = {
    rawUrls: [],
    commitUrls: [],
    maxActiveRaw: 0
  };
  state.transport = async request => {
    const target = new URL(request.url);
    if (target.hostname === 'api.github.com' && target.pathname.includes('/commits/')) {
      state.commitUrls.push(request.url);
      return jsonResponse({ sha: onCommitRequest(), commit: { tree: { sha: ROOT_TREE } } }, request.url, etags);
    }
    if (target.hostname === 'api.github.com' && target.pathname.endsWith(`/git/trees/${ROOT_TREE}`) && !target.search) {
      return jsonResponse({ sha: ROOT_TREE, truncated: false, tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: SKILLS_TREE }] }, request.url, etags);
    }
    if (target.hostname === 'api.github.com' && target.pathname.endsWith(`/git/trees/${SKILLS_TREE}`) && !target.search) {
      return jsonResponse({ sha: SKILLS_TREE, truncated: false, tree: [{ path: 'demo', mode: '040000', type: 'tree', sha: SKILL_TREE }] }, request.url, etags);
    }
    if (target.hostname === 'api.github.com' && target.pathname.endsWith(`/git/trees/${SKILL_TREE}`) && target.searchParams.get('recursive') === '1') {
      return jsonResponse({ sha: SKILL_TREE, truncated: false, tree: recursiveEntries }, request.url, etags);
    }
    if (target.hostname === 'raw.githubusercontent.com') {
      state.rawUrls.push(request.url);
      activeRaw += 1;
      state.maxActiveRaw = Math.max(state.maxActiveRaw, activeRaw);
      try {
        if (rawDelayMs > 0) await new Promise(resolve => setTimeout(resolve, rawDelayMs));
        const prefix = `/${COMMIT_A}/skills/demo/`;
        const marker = target.pathname.indexOf(prefix);
        if (marker < 0) return response(404, 'wrong immutable commit');
        const remotePath = target.pathname.slice(marker + prefix.length).split('/').map(decodeURIComponent).join('/');
        const bytes = fileBuffers.get(remotePath);
        if (!bytes) return response(404, 'missing fixture file');
        return response(200, bytes, etags ? { etag: etagFor(request.url) } : {});
      } finally {
        activeRaw -= 1;
      }
    }
    return response(404, 'unknown fixture request');
  };
  return state;
}

function createExactFileFixture({ content, rawContent = content, resolvedCommit = COMMIT_A }) {
  const declaredBytes = Buffer.from(content);
  const rawBytes = Buffer.from(rawContent);
  const state = { rawUrls: [] };
  state.transport = async request => {
    const target = new URL(request.url);
    if (target.hostname === 'api.github.com' && target.pathname.includes('/commits/')) {
      return jsonResponse({ sha: resolvedCommit, commit: { tree: { sha: ROOT_TREE } } }, request.url, false);
    }
    if (target.hostname === 'api.github.com' && target.pathname.endsWith(`/git/trees/${ROOT_TREE}`) && !target.search) {
      return jsonResponse({
        sha: ROOT_TREE,
        truncated: false,
        tree: [{
          path: 'LICENSE', mode: '100644', type: 'blob',
          sha: gitBlobSha(declaredBytes), size: declaredBytes.length
        }]
      }, request.url, false);
    }
    if (target.hostname === 'raw.githubusercontent.com') {
      state.rawUrls.push(request.url);
      return response(200, rawBytes);
    }
    return response(404, 'unknown fixture request');
  };
  return state;
}

function jsonResponse(value, url, etags) {
  return response(200, JSON.stringify(value), {
    'content-type': 'application/json',
    ...(etags ? { etag: etagFor(url) } : {})
  });
}

function response(status, body = '', headers = {}) {
  return {
    status,
    headers,
    body: body instanceof Uint8Array ? body : Buffer.from(body)
  };
}

function etagFor(value) {
  return `"${createHash('sha256').update(value).digest('hex')}"`;
}

function gitBlobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function errorCode(code) {
  return error => {
    assert.ok(error instanceof GithubSourceFetchError);
    assert.equal(error.code, code);
    return true;
  };
}

function listFiles(root) {
  const result = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  };
  visit(root);
  return result.sort();
}
