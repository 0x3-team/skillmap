import assert from 'node:assert/strict';
import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTrackedSecretScanEntries, scanRepositorySecretCanaries } from './repository-secret-canary.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const PROFILES = new Set(['static', 'candidate']);

export function parsePreflightArguments(argv) {
  const options = { profile: 'static', requireClean: false, output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--require-clean') {
      assert.equal(options.requireClean, false, '--require-clean may be supplied only once');
      options.requireClean = true;
      continue;
    }
    if (argument === '--profile' || argument === '--output') {
      const key = argument === '--profile' ? 'profile' : 'output';
      assert.ok(index + 1 < argv.length, `${argument} requires a value`);
      assert.equal(seen.has(argument), false, `${argument} may be supplied only once`);
      seen.add(argument);
      options[key] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown preflight argument: ${argument}`);
  }
  assert.equal(PROFILES.has(options.profile), true, '--profile must be static or candidate');
  return options;
}

export function determineLocalVerdict(gates) {
  if (gates.some(gate => gate.status === 'failed')) return 'failed';
  if (gates.some(gate => gate.status === 'blocked')) return 'blocked';
  return 'passed';
}

export function buildReleaseReceipt({ candidate, gates, profile, generatedAt = new Date().toISOString() }) {
  const localVerdict = determineLocalVerdict(gates);
  return {
    schemaVersion: 'skillmap-free-public-alpha-preflight/v1',
    generatedAt,
    profile,
    candidate,
    localVerdict,
    launchVerdict: 'NO_GO',
    launchBoundary: 'Local candidate evidence is not push, deployment, live OAuth, backup retention, external-pilot, indexing, or public-launch proof.',
    gates
  };
}

export function writeExclusiveReceipt(target, receipt) {
  const absolute = path.resolve(target);
  mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const fd = openSync(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
    const stats = fstatSync(fd);
    assert.equal(stats.isFile(), true, 'preflight receipt target must remain a regular file');
  } finally {
    closeSync(fd);
  }
  return absolute;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.visible ? 'inherit' : ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw result.error;
  return result;
}

function gitText(args) {
  const result = run('git', args);
  assert.equal(result.status, 0, `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function staticGates(requireClean) {
  const gates = [];
  const porcelain = gitText(['status', '--porcelain=v1', '--untracked-files=all']);
  gates.push({
    id: 'exact-candidate-worktree',
    status: requireClean && porcelain ? 'blocked' : 'passed',
    detail: porcelain
      ? (requireClean ? 'The worktree is not clean, so HEAD is not an exact candidate.' : 'Dirty worktree allowed for development-only checks. Commit and tree fields identify HEAD, while static gates inspect current candidate files; this is not exact-candidate evidence.')
      : 'The worktree is clean and HEAD identifies the exact candidate.'
  });

  const candidatePaths = gitText([
    'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    ':(exclude).chunk/**', ':(exclude).claude/**', ':(exclude).codex/**'
  ]).split('\0').filter(Boolean);
  const findings = scanRepositorySecretCanaries(readTrackedSecretScanEntries(repo, candidatePaths));
  gates.push({
    id: 'tracked-secret-canary',
    status: findings.length ? 'failed' : 'passed',
    detail: findings.length ? findings : `No high-confidence credential canary found in ${candidatePaths.length} candidate files.`
  });

  const leaseMigration = readFileSync(path.join(repo, 'supabase/migrations/20260713003000_launch_safety_reports_lifecycle.sql'), 'utf8');
  const workerSource = readFileSync(path.join(repo, 'apps/worker/src/process-once.mjs'), 'utf8');
  const rpcSource = readFileSync(path.join(repo, 'apps/worker/src/supabase-rpc.mjs'), 'utf8');
  const workerMigrationBound = /create function api\.renew_skill_submission_claim\s*\(/i.test(leaseMigration)
    && /grant execute on function api\.renew_skill_submission_claim\(text, uuid, text, integer\) to service_role/i.test(leaseMigration)
    && /renewClaimLease\(/.test(workerSource)
    && /'renew_skill_submission_claim'/.test(rpcSource);
  gates.push({
    id: 'worker-migration-compatibility',
    status: workerMigrationBound ? 'passed' : 'failed',
    detail: workerMigrationBound
      ? 'Worker lease renewal is source-bound to migration 20260713003000; applying and verifying that migration remains a database gate before worker start.'
      : 'Worker lease renewal is not bound to the required migration and service-role grant.'
  });

  const diffCheck = run('git', ['diff', '--check']);
  gates.push({
    id: 'patch-whitespace',
    status: diffCheck.status === 0 ? 'passed' : 'failed',
    detail: diffCheck.status === 0 ? 'git diff --check passed.' : 'git diff --check failed.'
  });
  return gates;
}

const CANDIDATE_COMMANDS = Object.freeze([
  ['root-typecheck', 'npm', ['run', 'typecheck']],
  ['root-tests', 'npm', ['test']],
  ['contract-generation', 'npm', ['run', 'test:contracts']],
  ['web-check', 'npm', ['run', 'check:web']],
  ['root-production-audit', 'npm', ['audit', '--omit=dev', '--audit-level=high']],
  ['web-production-audit', 'npm', ['--prefix', 'apps/web', 'audit', '--omit=dev', '--audit-level=high']],
  ['release-path', 'npm', ['run', 'test:release-path']],
  ['consumer-install', 'npm', ['run', 'test:consumer-install']],
  ['package-dry-run', 'npm', ['pack', '--dry-run']]
]);

function main(argv) {
  const options = parsePreflightArguments(argv);
  const candidate = {
    commit: gitText(['rev-parse', 'HEAD']),
    tree: gitText(['rev-parse', 'HEAD^{tree}']),
    branch: gitText(['branch', '--show-current']) || null,
    packageVersion: JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version,
    exactWorktree: gitText(['status', '--porcelain=v1', '--untracked-files=all']) === ''
  };
  const gates = staticGates(options.requireClean);
  if (options.profile === 'candidate' && !gates.some(gate => gate.status !== 'passed')) {
    for (const [id, command, args] of CANDIDATE_COMMANDS) {
      process.stderr.write(`[public-alpha-preflight] ${id}\n`);
      const result = run(command, args, { visible: true });
      gates.push({ id, status: result.status === 0 ? 'passed' : 'failed', detail: `${command} ${args.join(' ')} exited ${result.status ?? 1}.` });
      if (result.status !== 0) break;
    }
  } else if (options.profile === 'candidate') {
    gates.push({ id: 'candidate-command-suite', status: 'blocked', detail: 'Candidate commands did not run because a static gate did not pass.' });
  }
  const receipt = buildReleaseReceipt({ candidate, gates, profile: options.profile });
  const output = options.output ? writeExclusiveReceipt(options.output, receipt) : null;
  process.stdout.write(`${JSON.stringify({ ...receipt, ...(output ? { receipt: output } : {}) })}\n`);
  process.exitCode = receipt.localVerdict === 'passed' ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
