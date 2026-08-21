import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { importCommand } from '../dist/commands/import.js';
import { CliExitError, CLI_EXIT_CODES } from '../dist/core/cli-exit.js';
import { ImportClientError } from '../dist/network/import-client.js';
import { ManagedImportError } from '../dist/services/managed-import-use-case.js';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist', 'cli.js');
const NOW = new Date('2026-08-20T12:00:00.000Z');

async function projectFixture(t, files = {
  'SKILL.md': '---\nname: Alpha\ndescription: Alpha managed import fixture.\n---\nBody\n',
  'references/guide.txt': 'guide\n'
}) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'skillmap-m4-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, 'skills');
  const skillDir = path.join(root, 'alpha');
  for (const [relativePath, body] of Object.entries(files)) {
    const absolute = path.join(skillDir, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, body, 'utf8');
  }
  execFileSync(process.execPath, [cli, 'init', '--root', root], { cwd, stdio: 'pipe' });
  execFileSync(process.execPath, [cli, 'scan'], { cwd, stdio: 'pipe' });
  return { cwd, root, skillDir };
}

function inertRuntime() {
  return {
    auth: {
      async getAuthStatus() { throw new Error('not used'); },
      async getAccessToken() { throw new Error('not used'); }
    },
    client: {},
    uploader: {}
  };
}

test('M4.16 CLI dry-run produces a path-free preview without auth or checkpoint writes', async (t) => {
  const state = await projectFixture(t);
  let runtimeCalls = 0;
  const result = await importCommand(state.cwd, ['vault', state.skillDir], { 'dry-run': true }, {
    runtimeFactory: async () => { runtimeCalls += 1; return inertRuntime(); },
    now: () => new Date(NOW)
  });
  assert.equal(result.state, 'preview');
  assert.equal(result.preview.importable_skills, 1);
  assert.equal(runtimeCalls, 0);
  assert.equal(JSON.stringify(result).includes(state.cwd), false);
  await assert.rejects(readdir(path.join(state.cwd, '.skillmap', 'imports', 'vault')), { code: 'ENOENT' });
});

test('M4.16 CLI preserves one stable retry checkpoint across the owner-consent pause', async (t) => {
  const state = await projectFixture(t);
  const requests = [];
  let phase = 'awaiting_owner_consent';
  const deps = {
    runtimeFactory: async () => inertRuntime(),
    runManagedImportFn: async (request) => {
      requests.push(request);
      return phase === 'verified'
        ? { state: 'verified', sessionPublicId: `imp_${'a'.repeat(32)}` }
        : { state: 'awaiting_owner_consent', sessionPublicId: `imp_${'a'.repeat(32)}` };
    },
    now: () => new Date(NOW)
  };

  const first = await importCommand(state.cwd, ['vault', state.skillDir], {}, deps);
  const second = await importCommand(state.cwd, ['vault', state.skillDir], {}, deps);
  assert.equal(first.state, 'awaiting_owner_consent');
  assert.equal(second.state, 'awaiting_owner_consent');
  assert.equal(requests[0].sessionStartedAt, NOW.toISOString());
  assert.equal(requests[1].sessionStartedAt, requests[0].sessionStartedAt);

  const checkpointDir = path.join(state.cwd, '.skillmap', 'imports', 'vault');
  const checkpointFiles = await readdir(checkpointDir);
  assert.equal(checkpointFiles.length, 1);
  const checkpointRaw = await readFile(path.join(checkpointDir, checkpointFiles[0]), 'utf8');
  assert.equal(checkpointRaw.includes(state.cwd), false);
  assert.equal(JSON.parse(checkpointRaw).state, 'awaiting_owner_consent');

  phase = 'verified';
  const third = await importCommand(state.cwd, ['vault', state.skillDir], {}, deps);
  assert.equal(third.state, 'verified');
  assert.equal(JSON.parse(await readFile(path.join(checkpointDir, checkpointFiles[0]), 'utf8')).state, 'verified');
});

test('M4.16 CLI blocks canaries before runtime creation or checkpoint mutation', async (t) => {
  const state = await projectFixture(t, {
    'SKILL.md': '---\nname: Blocked\ndescription: Blocked managed import fixture.\n---\nBody\n',
    '.env': 'TOKEN=synthetic-only\n'
  });
  let runtimeCalls = 0;
  const result = await importCommand(state.cwd, ['vault', state.skillDir], {}, {
    runtimeFactory: async () => { runtimeCalls += 1; return inertRuntime(); },
    now: () => new Date(NOW)
  });
  assert.equal(result.state, 'blocked');
  assert.equal(runtimeCalls, 0);
  assert.equal(JSON.stringify(result).includes(state.cwd), false);
  await assert.rejects(readdir(path.join(state.cwd, '.skillmap', 'imports', 'vault')), { code: 'ENOENT' });
});

test('M4.16 CLI rejects a source changed after inventory before runtime or checkpoint mutation', async (t) => {
  const state = await projectFixture(t);
  await writeFile(path.join(state.skillDir, 'SKILL.md'), '---\nname: Alpha\ndescription: Changed after inventory.\n---\nBody changed\n', 'utf8');
  let runtimeCalls = 0;

  await assert.rejects(
    importCommand(state.cwd, ['vault', state.skillDir], {}, {
      runtimeFactory: async () => { runtimeCalls += 1; return inertRuntime(); },
      now: () => new Date(NOW)
    }),
    (error) => error instanceof CliExitError
      && error.code === 'IMPORT_SOURCE_CHANGED'
      && error.exitCode === CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR
      && error.message === 'The local import source changed after scanning.'
  );

  assert.equal(runtimeCalls, 0);
  await assert.rejects(readdir(path.join(state.cwd, '.skillmap', 'imports', 'vault')), { code: 'ENOENT' });
});

test('M4.16 CLI reserves an explicit vault subcommand and rejects ambiguous arguments', async (t) => {
  const state = await projectFixture(t);
  await assert.rejects(
    importCommand(state.cwd, ['vault'], {}, {}),
    (error) => error?.code === 'usage_error' && error?.exitCode === 64
  );
  await assert.rejects(
    importCommand(state.cwd, ['vault', state.skillDir, 'extra'], {}, {}),
    (error) => error?.code === 'usage_error' && error?.exitCode === 64
  );
  await assert.rejects(
    importCommand(state.cwd, ['vault', state.skillDir], { confirm: true }, {}),
    (error) => error?.code === 'usage_error' && error?.exitCode === 64
  );
});

test('M4.16 CLI maps managed import service failures to safe messages and exact exit categories', async (t) => {
  const state = await projectFixture(t);
  const cases = [
    ['unauthorized', 401, CLI_EXIT_CODES.UNAUTHENTICATED, 'The import request is not authorized.'],
    ['insufficient_scope', 403, CLI_EXIT_CODES.UNAUTHENTICATED, 'The token does not permit this operation.'],
    ['invalid_request', 400, CLI_EXIT_CODES.USAGE, 'The request is invalid.'],
    ['session_expired', 410, CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR, 'The import session has expired.'],
    ['owner_consent_required', 409, CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR, 'Owner consent is required before this import can be finalized.'],
    ['rate_limited', 429, CLI_EXIT_CODES.UNREACHABLE, 'Too many requests.'],
    ['temporarily_unavailable', 503, CLI_EXIT_CODES.UNREACHABLE, 'The service is temporarily unavailable.'],
    ['invalid_response', 502, CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR, 'The import service returned an invalid response.']
  ];

  for (const [code, status, exitCode, message] of cases) {
    await assert.rejects(
      importCommand(state.cwd, ['vault', state.skillDir], {}, {
        runtimeFactory: async () => inertRuntime(),
        runManagedImportFn: async () => { throw new ImportClientError(status, code); },
        now: () => new Date(NOW)
      }),
      (error) => error instanceof CliExitError
        && error.code === code
        && error.exitCode === exitCode
        && error.message === message
    );
  }
});

test('M4.16 CLI maps local integrity failures to a fixed safe message', async (t) => {
  const state = await projectFixture(t);
  await assert.rejects(
    importCommand(state.cwd, ['vault', state.skillDir], {}, {
      runtimeFactory: async () => inertRuntime(),
      runManagedImportFn: async () => {
        throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'untrusted local detail');
      },
      now: () => new Date(NOW)
    }),
    (error) => error instanceof CliExitError
      && error.code === 'IMPORT_SOURCE_CHANGED'
      && error.exitCode === CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR
      && error.message === 'The local import source changed after scanning.'
  );
});
