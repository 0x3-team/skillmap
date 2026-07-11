import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist/cli.js');

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runFailure(args, cwd) {
  try {
    run(args, cwd);
  } catch (error) {
    return `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
  }
  assert.fail(`Expected command to fail: ${args.join(' ')}`);
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function privateCanaryProject(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-share-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const dir = path.join(cwd, '.skillmap');
  const canaries = {
    prompt: 'CANARY_PROMPT_7F1A',
    body: 'CANARY_SKILL_BODY_84C2',
    secret: 'sk_test_CANARYSECRET5D3E',
    path: '/opt/private-canary-91B4/skill/SKILL.md',
    diff: 'CANARY_PRIVATE_DIFF_2A6F',
    receipt: 'CANARY_SENSITIVE_RECEIPT_3C8D'
  };
  writeJson(path.join(dir, 'inventory.json'), {
    version: 2,
    identityVersion: 1,
    workspaceId: '00000000-0000-4000-8000-000000000001',
    generatedAt: '2026-07-10T00:00:00.000Z',
    cwd,
    roots: [canaries.path],
    rootRecords: [],
    identityIssues: [],
    warnings: [],
    skills: [{
      id: `sk_${'a'.repeat(43)}`,
      skillId: `sk_${'a'.repeat(43)}`,
      identityVersion: 1,
      rootId: '00000000-0000-4000-8000-000000000002',
      relativePath: 'audit-skill',
      contentRevision: `sha256:${'a'.repeat(64)}`,
      name: 'audit-skill',
      description: 'Safe public metadata only.',
      path: canaries.path,
      root: path.dirname(canaries.path),
      scope: 'user',
      clientHints: [],
      source: 'filesystem',
      frontmatterValid: true,
      frontmatterErrors: [],
      implicitAllowed: true,
      hasScripts: false,
      scriptPaths: [],
      referenceCount: 0,
      assetCount: 0,
      bodyBytes: 100,
      descriptionBytes: 26,
      mtime: '2026-07-10T00:00:00.000Z',
      hash: 'a'.repeat(64),
      unexpectedRawSkillBody: canaries.body,
      unexpectedSecret: canaries.secret
    }]
  });
  writeFileSync(path.join(dir, 'policy.yml'), `version: 1\nskills:\n  audit-skill:\n    tier: specialist\n    notes: ${canaries.secret}\n`);
  writeJson(path.join(dir, 'skillgraph.json'), { version: 1, nodes: [], edges: [], privateDiff: canaries.diff });
  writeJson(path.join(dir, 'sources.json'), { version: 1, records: [{ skill: 'audit-skill', localPath: canaries.path, secret: canaries.secret }] });
  writeJson(path.join(dir, 'source-status.json'), { version: 1, records: [{ skill: 'audit-skill', localPath: canaries.path, state: 'unknown', privateDiff: canaries.diff }] });
  writeJson(path.join(dir, 'source-decisions.json'), { version: 1, records: [{ skill: 'audit-skill', decision: 'hold', reason: canaries.receipt }] });
  writeJson(path.join(dir, 'eval-report.json'), { version: 1, count: 1, pass: true, rows: [{ prompt: canaries.prompt, hookText: canaries.secret }] });
  writeJson(path.join(dir, 'curation/receipt.json'), {
    version: 1,
    host: 'codex',
    model: 'local-model',
    modelVerification: 'user-reported',
    mode: 'manual-native-agent',
    createdAt: '2026-07-10T00:00:00.000Z',
    inputs: {},
    outputs: {},
    warnings: [canaries.receipt]
  });
  return { cwd, dir, canaries };
}

test('canonical payload hashing is semantic and transport hashing is byte-exact', async () => {
  const integrity = await import('../dist/core/canonical-payload.js');
  const parityVector = {
    z: 3,
    payloadDigest: 'excluded',
    a: { z: 1, a: 2 },
    list: [{ b: 2, a: 1 }, -0]
  };
  assert.equal(
    integrity.canonicalJson(integrity.canonicalPayloadProjection(parityVector)),
    '{"a":{"a":2,"z":1},"list":[{"a":1,"b":2},0],"z":3}'
  );
  assert.equal(
    integrity.computePayloadDigest(parityVector),
    'sha256:14621e97c81c2ffae8fa42f1966e99dda9b08cb7cd66323f3a9da2917b55803b'
  );
  const first = integrity.withPayloadDigest({
    kind: 'test-envelope',
    schemaVersion: 2,
    payload: { z: [1, 2], a: { y: true, x: 'value' } }
  });
  assert.equal(integrity.verifyPayloadDigest(first), first.payloadDigest);

  const reordered = {
    payload: { a: { x: 'value', y: true }, z: [1, 2] },
    schemaVersion: 2,
    kind: 'test-envelope',
    payloadDigest: first.payloadDigest,
    transportMetadata: { filename: 'renamed.json' }
  };
  assert.equal(integrity.verifyPayloadDigest(reordered), first.payloadDigest);
  assert.notEqual(integrity.computeTransportDigest(JSON.stringify(first)), integrity.computeTransportDigest(`${JSON.stringify(first)}\n`));

  const tampered = structuredClone(first);
  tampered.payload.z[0] = 9;
  assert.throws(() => integrity.verifyPayloadDigest(tampered), /payloadDigest mismatch/);
  assert.throws(() => integrity.assertShareablePayloadPrivacy({ safe: { prompt: 'hidden' } }), /forbidden sensitive field prompt/);
  assert.throws(() => integrity.assertShareablePayloadPrivacy({ displayName: '/opt/private/value' }), /absolute path/);
  assert.throws(() => integrity.assertShareablePayloadPrivacy({ displayName: 'file:///mnt/customer/private' }), /absolute path/);
  assert.throws(() => integrity.assertShareablePayloadPrivacy({ displayName: 'sk_live_1234567890abcdef' }), /secret or privacy canary/);

  const protoOne = JSON.parse('{"kind":"prototype-vector","__proto__":{"value":1}}');
  const protoTwo = JSON.parse('{"kind":"prototype-vector","__proto__":{"value":2}}');
  assert.match(integrity.canonicalJson(protoOne), /"__proto__"/);
  assert.notEqual(integrity.computePayloadDigest(protoOne), integrity.computePayloadDigest(protoTwo));
});

test('default export is an allowlisted verified safe envelope and omits nested canaries', (t) => {
  const { cwd, canaries } = privateCanaryProject(t);
  const output = path.join(cwd, 'safe-export.json');
  const result = JSON.parse(run(['export', '--output', output, '--json'], cwd));
  assert.equal(result.kind, 'skillmap.safe-export');
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.redacted, true);
  assert.equal(result.shareable, true);
  assert.match(result.payloadDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.transportDigest, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(result.payloadDigest, result.transportDigest);

  const text = readFileSync(output, 'utf8');
  const snapshot = JSON.parse(text);
  assert.equal(snapshot.kind, 'skillmap.safe-export');
  assert.equal(snapshot.redaction.classification, 'shareable-redacted');
  assert.equal(snapshot.redacted, true);
  assert.equal(snapshot.cwd, '$PROJECT');
  assert.equal(Object.hasOwn(snapshot, 'artifacts'), false);
  assert.deepEqual(Object.keys(snapshot.payload).sort(), ['curationSummary', 'evalSummary', 'inventorySummary', 'policySummary', 'skills', 'sourceSummary', 'status']);
  assert.equal(snapshot.payload.evalSummary.present, true);
  assert.equal(Object.hasOwn(snapshot.payload.evalSummary, 'datasetDigest'), false);
  assert.equal(Object.hasOwn(snapshot.inputDigests, 'eval'), false);
  const rawEvalArtifactDigest = `sha256:${createHash('sha256').update(readFileSync(path.join(cwd, '.skillmap/eval-report.json'))).digest('hex')}`;
  assert.equal(text.includes(rawEvalArtifactDigest), false, 'safe export exposed the exact prompt-bearing eval artifact digest');
  for (const value of Object.values(canaries)) assert.equal(text.includes(value), false, `safe export leaked ${value}`);
  assert.equal(text.includes(cwd), false);

  const imported = JSON.parse(run(['import', output, '--dry-run', '--json'], cwd));
  assert.equal(imported.verified, true);
  assert.equal(imported.legacyUnverified, false);
  assert.equal(imported.payloadDigest, snapshot.payloadDigest);
  assert.equal(imported.report.format, 'safe-v2');
  assert.deepEqual(imported.report.conflicts, []);

  const deprecatedOutput = path.join(cwd, 'safe-export-redact-flag.json');
  const deprecated = JSON.parse(run(['export', '--redact-paths', '--output', deprecatedOutput, '--json'], cwd));
  assert.equal(deprecated.deprecatedRedactPathsFlagUsed, true);
  assert.equal(JSON.parse(readFileSync(deprecatedOutput, 'utf8')).redaction.classification, 'shareable-redacted');
});

test('safe export revision binds source decisions and every directly consumed status artifact', (t) => {
  const { cwd, dir, canaries } = privateCanaryProject(t);
  const firstFile = path.join(cwd, 'safe-first.json');
  run(['export', '--output', firstFile], cwd);
  const first = JSON.parse(readFileSync(firstFile, 'utf8'));
  assert.equal(first.payload.skills[0].reviewStatus, 'needs-review');
  writeJson(path.join(dir, 'source-decisions.json'), {
    version: 1,
    records: [{
      skill: 'audit-skill',
      localPath: canaries.path,
      appliesToState: 'unknown',
      decision: 'accepted',
      reason: 'Reviewed the unknown source state for this fixture.'
    }]
  });
  const secondFile = path.join(cwd, 'safe-second.json');
  run(['export', '--output', secondFile], cwd);
  const second = JSON.parse(readFileSync(secondFile, 'utf8'));
  assert.equal(second.payload.skills[0].reviewStatus, 'reviewed');
  assert.notEqual(second.workspaceRevision, first.workspaceRevision);
  assert.notEqual(second.payloadDigest, first.payloadDigest);
  assert.match(second.inputDigests.sourceDecisions, /^sha256:[a-f0-9]{64}$/);
  assert.match(second.inputDigests.curationReceipt, /^sha256:[a-f0-9]{64}$/);
});

test('safe export redacts file URL and embedded absolute-path display names', (t) => {
  const { cwd, dir } = privateCanaryProject(t);
  const inventory = JSON.parse(readFileSync(path.join(dir, 'inventory.json'), 'utf8'));
  inventory.skills[0].name = 'file:///mnt/customer/private-skill';
  writeJson(path.join(dir, 'inventory.json'), inventory);
  const output = path.join(cwd, 'safe-path-name.json');
  run(['export', '--output', output], cwd);
  const text = readFileSync(output, 'utf8');
  assert.equal(text.includes('file:///mnt/customer/private-skill'), false);
  assert.match(JSON.parse(text).payload.skills[0].displayName, /^redacted-skill-/);
});

test('safe import rejects semantic tamper and unknown fields before any archive write', async (t) => {
  const { cwd } = privateCanaryProject(t);
  const output = path.join(cwd, 'safe-export.json');
  run(['export', '--output', output], cwd);
  const snapshot = JSON.parse(readFileSync(output, 'utf8'));
  snapshot.payload.status.verdict = snapshot.payload.status.verdict === 'blocked' ? 'ok' : 'blocked';
  const tampered = path.join(cwd, 'tampered.json');
  writeJson(tampered, snapshot);
  assert.match(runFailure(['import', tampered, '--confirm'], cwd), /payloadDigest mismatch/);
  assert.equal(existsSync(path.join(cwd, '.skillmap/imports')), false);

  const integrity = await import('../dist/core/canonical-payload.js');
  const unknownField = JSON.parse(readFileSync(output, 'utf8'));
  unknownField.payload.status.unhashedOverride = 'ok';
  const resigned = integrity.withPayloadDigest(unknownField);
  const unknownFile = path.join(cwd, 'unknown-field.json');
  writeJson(unknownFile, resigned);
  assert.match(runFailure(['import', unknownFile, '--dry-run'], cwd), /unknown field unhashedOverride/);
  assert.equal(existsSync(path.join(cwd, '.skillmap/imports')), false);

  const scalarPoison = JSON.parse(readFileSync(output, 'utf8'));
  scalarPoison.payload.evalSummary.evidenceLevel = 'RAW PROMPT acquire Zephyr before Friday';
  const resignedPoison = integrity.withPayloadDigest(scalarPoison);
  const poisonFile = path.join(cwd, 'scalar-poison.json');
  writeJson(poisonFile, resignedPoison);
  assert.match(runFailure(['import', poisonFile, '--confirm'], cwd), /evidenceLevel/);
  assert.equal(existsSync(path.join(cwd, '.skillmap/imports')), false);
});

test('local-sensitive export is confined, mode 0600, and import requires acknowledgement', (t) => {
  const { cwd, canaries } = privateCanaryProject(t);
  mkdirSync(path.join(cwd, '.skillmap/policies'), { recursive: true });
  writeFileSync(path.join(cwd, '.skillmap/policies/active.json'), '{"version":1}\n');
  const outside = path.join(cwd, 'private-outside.json');
  assert.match(runFailure(['export', '--include-sensitive-local', '--output', outside], cwd), /inside \.skillmap\/private-exports/);
  assert.equal(existsSync(outside), false);

  const target = path.join(cwd, '.skillmap/private-exports/private.json');
  const result = JSON.parse(run(['export', '--include-sensitive-local', '--output', target, '--json'], cwd));
  assert.equal(result.kind, 'skillmap.local-private-export');
  assert.equal(result.shareable, false);
  assert.equal(statSync(target).mode & 0o777, 0o600);
  const text = readFileSync(target, 'utf8');
  assert.ok(Object.values(canaries).some((value) => text.includes(value)));
  assert.equal(JSON.parse(text).artifacts.policyState.present, true);
  assert.match(runFailure(['import', target, '--dry-run'], cwd), /--acknowledge-sensitive-local/);
  const acknowledged = JSON.parse(run(['import', target, '--acknowledge-sensitive-local', '--dry-run', '--json'], cwd));
  assert.equal(acknowledged.verified, true);
  assert.equal(acknowledged.report.format, 'private-v2');
  assert.equal(acknowledged.report.activation, 'none');
});

test('local-sensitive export refuses symlinked artifact files', {
  skip: process.platform === 'win32' ? 'File symlink creation is not reliably available without Windows developer mode or elevated privileges.' : false
}, (t) => {
  const first = privateCanaryProject(t);
  const outsidePolicy = path.join(first.cwd, 'outside-policy.yml');
  writeFileSync(outsidePolicy, 'version: 1\nskills: {}\nOUTSIDE_SECRET_ARTIFACT\n');
  renameSync(path.join(first.dir, 'policy.yml'), path.join(first.cwd, 'original-policy.yml'));
  symlinkSync(outsidePolicy, path.join(first.dir, 'policy.yml'));
  const firstTarget = path.join(first.dir, 'private-exports/symlink-file.json');
  assert.match(runFailure(['export', '--include-sensitive-local', '--output', firstTarget], first.cwd), /refuses symbolic-link sources/);
  assert.equal(existsSync(firstTarget), false);
});

test('local-sensitive export refuses symlinked policy-state roots', (t) => {
  const second = privateCanaryProject(t);
  const outsidePolicies = path.join(second.cwd, 'outside-policies');
  mkdirSync(outsidePolicies);
  writeFileSync(path.join(outsidePolicies, 'secret.json'), '{"secret":"OUTSIDE_SECRET_POLICIES_ROOT"}\n');
  symlinkSync(outsidePolicies, path.join(second.dir, 'policies'), process.platform === 'win32' ? 'junction' : 'dir');
  const secondTarget = path.join(second.dir, 'private-exports/symlink-root.json');
  assert.match(runFailure(['export', '--include-sensitive-local', '--output', secondTarget], second.cwd), /refuses symbolic-link sources/);
  assert.equal(existsSync(secondTarget), false);
});

test('legacy v1 import stays unverified and confirm archives exact bytes without activation', (t) => {
  const { cwd, dir } = privateCanaryProject(t);
  const legacyFile = path.join(cwd, 'legacy.json');
  const legacyText = '{\n  "version": 1,\n  "artifacts": {\n    "policy": {"present": true, "value": "version: 1\\nskills: {}\\n"}\n  }\n}\n';
  writeFileSync(legacyFile, legacyText);
  const activeInventoryBefore = readFileSync(path.join(dir, 'inventory.json'), 'utf8');

  const dryRun = JSON.parse(run(['import', legacyFile, '--dry-run', '--json'], cwd));
  assert.equal(dryRun.verified, false);
  assert.equal(dryRun.legacyUnverified, true);
  assert.equal(dryRun.report.format, 'legacy-v1');
  assert.equal(existsSync(path.join(dir, 'imports')), false);

  const confirmed = JSON.parse(run(['import', legacyFile, '--confirm', '--json'], cwd));
  assert.equal(confirmed.verified, false);
  assert.equal(confirmed.legacyUnverified, true);
  assert.equal(readFileSync(confirmed.archivedSnapshot, 'utf8'), legacyText);
  assert.equal(readFileSync(path.join(dir, 'inventory.json'), 'utf8'), activeInventoryBefore);
  assert.equal(confirmed.report.activation, 'none');
});
