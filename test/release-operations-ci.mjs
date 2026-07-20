import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(import.meta.dirname, '..');
const pinnedOfficialActions = Object.freeze({
  'actions/checkout': 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
  'actions/setup-node': 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact': 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'actions/download-artifact': 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093'
});

function workflow(relativePath) {
  return YAML.parse(readFileSync(path.join(repo, relativePath), 'utf8'));
}

test('both CI authorities run the clean exact-candidate secret preflight', () => {
  for (const relativePath of ['.gitea/workflows/ci.yml', '.github/workflows/ci.yml']) {
    const jobs = workflow(relativePath).jobs;
    const commands = Object.values(jobs).flatMap(job => (job.steps ?? []).map(step => step.run).filter(run => typeof run === 'string'));
    const preflight = commands.find(command => command.includes('preflight:public-alpha:static'));
    assert.ok(preflight, `${relativePath} does not run the public-alpha static preflight`);
    assert.match(preflight, /--require-clean/, `${relativePath} can issue exact-candidate evidence from a dirty worktree`);
    assert.match(preflight, /--output/, `${relativePath} does not retain a preflight receipt`);
  }
});

test('GitHub CI pins every official action and tests the web app on supported Node lines', () => {
  const relativePath = '.github/workflows/ci.yml';
  const source = readFileSync(path.join(repo, relativePath), 'utf8');
  const jobs = workflow(relativePath).jobs;
  const officialUses = Object.values(jobs)
    .flatMap(job => job.steps ?? [])
    .map(step => step.uses)
    .filter(uses => typeof uses === 'string' && uses.startsWith('actions/'));

  assert.doesNotMatch(source, /uses:\s*actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@v\d+/,
    'official actions must not use mutable major-version tags');
  assert.deepEqual([...new Set(officialUses.map(uses => uses.split('@')[0]))].sort(),
    Object.keys(pinnedOfficialActions).sort());
  for (const uses of officialUses) {
    const [action, ref] = uses.split('@');
    assert.match(ref ?? '', /^[0-9a-f]{40}$/, `${uses} is not pinned to an immutable commit`);
    assert.equal(uses, pinnedOfficialActions[action], `${action} does not use the reviewed immutable pin`);
  }

  const webNodeMatrix = jobs.web?.strategy?.matrix?.node;
  assert.deepEqual(webNodeMatrix, [22, 24], 'web CI must cover the supported Node 22 and 24 lines');
  assert.equal(webNodeMatrix.includes(20), false, 'web CI must not exercise unsupported Node 20');
});

test('Gitea database authority runs pgTAP and type parity against the restored candidate', () => {
  const job = workflow('.gitea/workflows/ci.yml').jobs['hosted-database'];
  const steps = job.steps ?? [];
  const recovery = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('preflight:public-alpha:recovery'));
  const pgTap = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('pg_prove'));
  const types = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('supabase gen types'));
  assert.ok(recovery >= 0 && pgTap === recovery && types > pgTap, 'pgTAP and generated-type parity must validate the restored candidate');
  assert.ok(steps[recovery].run.indexOf('preflight:public-alpha:recovery') < steps[recovery].run.indexOf('pg_prove'), 'recovery replay must finish before pgTAP starts');
  assert.match(steps[recovery].run, /--execute/);
  assert.match(steps[recovery].run, /--output/);
});

test('Gitea retains exact-commit static and recovery receipts in bounded job logs', () => {
  const jobs = workflow('.gitea/workflows/ci.yml').jobs;
  const commands = Object.values(jobs).flatMap(job => (job.steps ?? []).map(step => step.run).filter(run => typeof run === 'string'));
  const staticGate = commands.find(command => command.includes('preflight:public-alpha:static'));
  const recoveryGate = commands.find(command => command.includes('preflight:public-alpha:recovery'));
  assert.match(staticGate, /emit-ci-gate-receipt[.]mjs --kind static-preflight --receipt "\$receipt"/);
  assert.match(recoveryGate, /emit-ci-gate-receipt[.]mjs --kind database-recovery --receipt "\$receipt"/);

  const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-ci-receipt-test-'));
  try {
    const commit = 'a'.repeat(40);
    const tree = 'b'.repeat(40);
    const receiptPath = path.join(scratch, 'receipt.json');
    writeFileSync(receiptPath, `${JSON.stringify({ sourceCommit: commit, sourceTree: tree, verdict: 'passed' })}\n`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [
      path.join(repo, 'scripts/emit-ci-gate-receipt.mjs'),
      '--kind', 'database-recovery', '--receipt', receiptPath
    ], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_SHA: commit, GITHUB_RUN_ID: '42', GITHUB_JOB: 'hosted-database' }
    });
    assert.equal(result.status, 0, result.stderr);
    const retained = JSON.parse(result.stdout);
    assert.equal(retained.sourceCommit, commit);
    assert.equal(retained.sourceTree, tree);
    assert.equal(retained.receipt.verdict, 'passed');
    assert.match(retained.receiptSha256, /^sha256:[0-9a-f]{64}$/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('GitHub retained package candidate carries the exact-commit preflight receipt', () => {
  const job = workflow('.github/workflows/ci.yml').jobs['package-candidate'];
  const steps = job.steps ?? [];
  const preflight = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('free-public-alpha-preflight.json'));
  const pack = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('npm pack --json'));
  const upload = steps.findIndex(step => step.uses === pinnedOfficialActions['actions/upload-artifact']
    && step.with?.name === 'skillmap-package-candidate');
  assert.ok(preflight >= 0 && pack > preflight && upload > pack, 'preflight receipt must be created before and retained with the exact package candidate');
  assert.equal(steps[upload].with.path, 'artifacts/package');
});
