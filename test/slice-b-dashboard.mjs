import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist/cli.js');
const webChecker = path.join(repo, 'apps/web/scripts/check-dashboard-snapshot.mjs');

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function project(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-dashboard-v2-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  cpSync(path.join(repo, 'test/fixtures'), path.join(cwd, 'test/fixtures'), { recursive: true });
  run(['init', '--root', 'test/fixtures/basic'], cwd);
  run(['scan'], cwd);
  cpSync(path.join(repo, 'test/fixtures/policy.yml'), path.join(cwd, '.skillmap/policy.yml'));
  run(['state', 'import-legacy', '--confirm'], cwd);
  run(['policy', 'migrate', '--confirm'], cwd);
  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'));
  const canonical = inventory.skills.find((skill) => skill.name === 'frontend-design');
  run([
    'policy',
    'select-canonical',
    'frontend-design',
    '--skill-id',
    canonical.skillId,
    '--actor',
    'dashboard-fixture-reviewer',
    '--reason',
    'Reviewed both fixture variants before approving the dashboard routing state.',
    '--confirm'
  ], cwd);
  run(['apply-policy'], cwd);
  run(['eval', '--file', path.join(repo, 'test/fixtures/evals.json'), '--save-report'], cwd);
  return cwd;
}

test('dashboard v2 producer and web consumer agree on canonical payload integrity', async (t) => {
  const cwd = project(t);
  const output = path.join(cwd, '.skillmap/dashboard-snapshot.json');
  const exported = JSON.parse(run(['export', '--dashboard-snapshot', '--redact-paths', '--output', output, '--json'], cwd));
  const raw = readFileSync(output, 'utf8');
  const snapshot = JSON.parse(raw);
  const identity = JSON.parse(readFileSync(path.join(cwd, '.skillmap/identity.json'), 'utf8'));

  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.kind, 'skillmap.dashboard-snapshot');
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.workspaceId, identity.workspaceId);
  assert.match(snapshot.workspaceId, /^[0-9a-f-]{36}$/i);
  assert.match(snapshot.workspaceRevision, /^sha256:[a-f0-9]{64}$/);
  assert.match(snapshot.payloadDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(snapshot.redactionClassification, 'shareable-redacted');
  assert.ok(Object.keys(snapshot.inputDigests).length > 0);
  assert.equal(Object.hasOwn(snapshot, 'snapshotHash'), false);
  assert.equal(Object.hasOwn(snapshot.connector, 'lastSnapshotHash'), false);
  assert.equal(exported.payloadDigest, snapshot.payloadDigest);

  const integrity = await import('../dist/core/canonical-payload.js');
  assert.equal(integrity.verifyPayloadDigest(snapshot), snapshot.payloadDigest);
  const webValid = spawnSync(process.execPath, [webChecker, output], { encoding: 'utf8' });
  assert.equal(webValid.status, 0, `web checker failed: ${webValid.stderr}`);
  assert.match(webValid.stdout, /payloadDigest=/);

  const tampered = structuredClone(snapshot);
  tampered.status.summary = 'one-byte semantic tamper';
  const tamperedFile = path.join(cwd, '.skillmap/dashboard-snapshot.tampered.json');
  writeFileSync(tamperedFile, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(() => integrity.verifyPayloadDigest(tampered), /payloadDigest mismatch/);
  const webTampered = spawnSync(process.execPath, [webChecker, tamperedFile], { encoding: 'utf8' });
  assert.equal(webTampered.status, 1);
  assert.match(webTampered.stderr, /payloadDigest does not match canonical payload bytes/);

  const compactTransport = JSON.stringify(snapshot);
  assert.equal(integrity.verifyPayloadDigest(JSON.parse(compactTransport)), snapshot.payloadDigest);
  assert.notEqual(integrity.computeTransportDigest(compactTransport), integrity.computeTransportDigest(raw));
  assert.equal(raw.includes(cwd), false);

  writeFileSync(path.join(cwd, '.skillmap/identity-migrations.json'), `${JSON.stringify({ version: 1, moves: [], tombstones: [], approvedNewIdentities: [] }, null, 2)}\n`);
  run(['state', 'import-legacy', '--confirm'], cwd);
  const historyOutput = path.join(cwd, '.skillmap/dashboard-snapshot.history.json');
  run(['export', '--dashboard-snapshot', '--redact-paths', '--output', historyOutput], cwd);
  const historySnapshot = JSON.parse(readFileSync(historyOutput, 'utf8'));
  assert.notEqual(historySnapshot.workspaceRevision, snapshot.workspaceRevision);
  assert.match(historySnapshot.inputDigests.identityMigrations, /^sha256:[a-f0-9]{64}$/);

  writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify({ version: 'x'.repeat(2000) })}\n`);
  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap/inventory.json'), 'utf8'));
  writeFileSync(path.join(cwd, '.skillmap/source-status.json'), `${JSON.stringify({
    version: 1,
    generatedAt: 'not-a-timestamp',
    records: [{ skill: inventory.skills[0].name, skillId: inventory.skills[0].skillId, state: 'unknown' }]
  }, null, 2)}\n`);
  run(['state', 'import-legacy', '--confirm'], cwd);
  const normalizedOutput = path.join(cwd, '.skillmap/dashboard-snapshot.normalized.json');
  run(['export', '--dashboard-snapshot', '--redact-paths', '--output', normalizedOutput], cwd);
  const normalized = JSON.parse(readFileSync(normalizedOutput, 'utf8'));
  assert.equal(normalized.producer.version, '0.0.0-unknown');
  assert.equal(normalized.connector.cliVersion, '0.0.0-unknown');
  assert.ok(normalized.sources.every((source) => Number.isFinite(Date.parse(source.lastCheckedAt))));
  const normalizedValid = spawnSync(process.execPath, [webChecker, normalizedOutput], { encoding: 'utf8' });
  assert.equal(normalizedValid.status, 0, `web checker rejected normalized producer output: ${normalizedValid.stderr}`);
});
