import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withPayloadDigest } from '../dist/core/canonical-payload.js';
import {
  WorkspaceStateConflictError,
  WorkspaceStateError,
  WorkspaceStateStore
} from '../dist/core/workspace-state/index.js';
import { listRegularFiles, WORKSPACE_STATE_READ_LIMITS } from '../dist/core/workspace-state/durability.js';

function project(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-workspace-state-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const dir = path.join(cwd, '.skillmap');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const workspaceId = randomUUID();
  const rootId = randomUUID();
  writeFileSync(path.join(dir, 'config.yml'), 'version: 1\nprofile: personal-v1\nroots: []\n');
  writeJson(path.join(dir, 'identity.json'), {
    version: 1,
    identityVersion: 1,
    workspaceId,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    roots: []
  });
  const inventory = {
    version: 2,
    identityVersion: 1,
    workspaceId,
    generatedAt: '2026-07-10T00:00:00.000Z',
    cwd,
    roots: [],
    rootRecords: [],
    skills: [{
      id: 'sk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      skillId: 'sk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      identityVersion: 1,
      rootId,
      relativePath: 'alpha',
      contentRevision: `sha256:${'1'.repeat(64)}`,
      name: 'alpha',
      description: 'fixture',
      path: path.join(cwd, 'skills/alpha/SKILL.md'),
      root: path.join(cwd, 'skills'),
      scope: 'project',
      clientHints: [],
      source: 'filesystem',
      frontmatterValid: true,
      frontmatterErrors: [],
      implicitAllowed: true,
      hasScripts: false,
      scriptPaths: [],
      referenceCount: 0,
      assetCount: 0,
      bodyBytes: 1,
      descriptionBytes: 7,
      mtime: '2026-07-10T00:00:00.000Z',
      hash: '1'.repeat(64)
    }],
    identityIssues: [],
    warnings: []
  };
  writeJson(path.join(dir, 'inventory.json'), inventory);
  writeFileSync(path.join(dir, 'policy.yml'), 'version: 1\nskills:\n  alpha:\n    tier: specialist\n');
  writeJson(path.join(dir, 'effective.json'), {
    version: 2,
    generatedAt: '2026-07-10T00:00:00.000Z',
    inventory,
    policy: { version: 1, skills: { alpha: { tier: 'specialist' } } },
    skills: [],
    graph: { version: 1, generatedAt: '2026-07-10T00:00:00.000Z', mode: 'effective', nodes: [], edges: [] }
  });
  writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 1 });
  return { cwd, dir, workspaceId };
}

test('one fencing lock spans legacy mutation and publication; concurrent writers cannot lose state', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  const migrated = await store.migrateLegacy({ confirm: true, approveForRouting: true });
  assert.match(migrated.pointer.effectiveDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(migrated.pointer.effectiveRevisionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(migrated.pointer.effectiveDigest, migrated.manifest.effectiveDigest);
  assert.equal(migrated.pointer.effectiveRevisionDigest, migrated.manifest.effectiveRevisionDigest);
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const releasePromise = new Promise((resolve) => { release = resolve; });
  const first = store.withMutationLock('held-mutation', async (context) => {
    writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 2 });
    entered();
    await releasePromise;
    return context.publishLegacySnapshot({ expectedRevisionId: migrated.pointer.revisionId });
  });
  await enteredPromise;
  await assert.rejects(
    store.publishLegacySnapshot({ expectedRevisionId: migrated.pointer.revisionId }),
    (error) => error instanceof WorkspaceStateConflictError
  );
  release();
  const published = await first;
  assert.ok(published.pointer.sequence > migrated.pointer.sequence);
  assert.equal((await store.readCurrent()).currentPointer.revisionId, published.pointer.revisionId);
});

test('the initial legacy mutation and migration can share one fencing lock', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  assert.equal(await store.isMigrated(), false);
  const result = await store.withInitialLegacyMutation(
    'initial-scan',
    { confirm: true, approveForRouting: true },
    async () => {
      writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 7 });
      return 'mutated';
    }
  );
  assert.equal(result.value, 'mutated');
  assert.equal(result.publication.pointer.sequence, 1);
  assert.equal(await store.isMigrated(), true);
});

test('an interrupted unpublished revision is invisible to readers', async (t) => {
  const { cwd, dir } = project(t);
  const baselineStore = WorkspaceStateStore.open(cwd);
  const baseline = await baselineStore.migrateLegacy({ confirm: true, approveForRouting: true });
  writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 2 });
  const interrupted = WorkspaceStateStore.open(cwd, {
    failpoint(name) {
      if (name === 'before-current-pointer-swap') throw new Error('simulated interruption');
    }
  });
  await assert.rejects(interrupted.publishLegacySnapshot({ expectedRevisionId: baseline.pointer.revisionId }), /simulated interruption/);
  const read = await baselineStore.readCurrent();
  assert.equal(read.currentPointer.revisionId, baseline.pointer.revisionId);
  assert.ok(readdirSync(path.join(dir, 'state/revisions')).length >= 2);
});

test('derived current corruption uses only an explicitly approved safety-equivalent LKG', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  const lkg = await store.migrateLegacy({ confirm: true, approveForRouting: true });
  writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 2 });
  const current = await store.publishLegacySnapshot({ expectedRevisionId: lkg.pointer.revisionId, approveForRouting: false });
  writeFileSync(revisionArtifact(dir, current.pointer.revisionId, 'effective.json'), '{"tampered":true}\n');
  const read = await store.readCurrent({ purpose: 'routing' });
  assert.equal(read.source, 'last-known-good');
  assert.equal(read.selectedPointer.revisionId, lkg.pointer.revisionId);
  assert.equal(read.currentFailure?.artifactRole, 'derived');
});

test('routing serves only an explicitly approved revision and blocks unapproved safety changes', async (t) => {
  const derivedProject = project(t);
  const derivedStore = WorkspaceStateStore.open(derivedProject.cwd);
  const approved = await derivedStore.migrateLegacy({ confirm: true, approveForRouting: true });
  writeJson(path.join(derivedProject.dir, 'doctor.json'), { version: 1, generation: 2 });
  const unapprovedDerived = await derivedStore.publishLegacySnapshot({ expectedRevisionId: approved.pointer.revisionId, approveForRouting: false });
  const statusRead = await derivedStore.readCurrent({ purpose: 'status' });
  const routingRead = await derivedStore.readCurrent({ purpose: 'routing' });
  assert.equal(statusRead.currentPointer.revisionId, unapprovedDerived.pointer.revisionId);
  assert.equal(routingRead.source, 'last-known-good');
  assert.equal(routingRead.selectedPointer.revisionId, approved.pointer.revisionId);

  const safetyProject = project(t);
  const safetyStore = WorkspaceStateStore.open(safetyProject.cwd);
  const safetyApproved = await safetyStore.migrateLegacy({ confirm: true, approveForRouting: true });
  writeFileSync(path.join(safetyProject.dir, 'policy.yml'), 'version: 1\nskills:\n  alpha:\n    tier: blocked\n');
  await safetyStore.publishLegacySnapshot({ expectedRevisionId: safetyApproved.pointer.revisionId, approveForRouting: false });
  await assert.rejects(
    safetyStore.readCurrent({ purpose: 'routing' }),
    (error) => error instanceof WorkspaceStateError && error.code === 'STATE_ROUTING_APPROVAL_REQUIRED'
  );
});

test('historical routing approvals are durable and unapproved ancestors never gain approval by ancestry', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  const firstApproved = await store.migrateLegacy({ confirm: true, approveForRouting: true });
  writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 2 });
  const unapproved = await store.publishLegacySnapshot({
    expectedRevisionId: firstApproved.pointer.revisionId,
    approveForRouting: false,
    actor: 'test:unapproved-derived',
    reason: 'Create a verified but deliberately unapproved ancestor.'
  });
  writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 3 });
  const secondApproved = await store.publishLegacySnapshot({
    expectedRevisionId: unapproved.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:approved-derived',
    reason: 'Create a later explicit approval without blessing its parent.'
  });

  assert.equal((await store.findRoutingApprovedRevision(firstApproved.pointer.revisionId)).manifest.revisionId, firstApproved.pointer.revisionId);
  assert.equal((await store.findRoutingApprovedRevision(secondApproved.pointer.revisionId)).manifest.revisionId, secondApproved.pointer.revisionId);
  await assert.rejects(
    store.findRoutingApprovedRevision(unapproved.pointer.revisionId),
    (error) => error instanceof WorkspaceStateError && error.code === 'STATE_ROUTING_APPROVAL_UNTRUSTED'
  );
  assert.equal(
    readdirSync(path.join(dir, 'state/routing-approvals')).some((entry) => entry.startsWith(unapproved.pointer.revisionId)),
    false
  );
});

test('LKG is denied after canonical routing safety changes', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  const lkg = await store.migrateLegacy({ confirm: true, approveForRouting: true });
  writeFileSync(path.join(dir, 'policy.yml'), 'version: 1\nskills:\n  alpha:\n    tier: blocked\n');
  const current = await store.publishLegacySnapshot({ expectedRevisionId: lkg.pointer.revisionId, approveForRouting: false });
  writeFileSync(revisionArtifact(dir, current.pointer.revisionId, 'effective.json'), '{"tampered":true}\n');
  await assert.rejects(
    store.readCurrent({ purpose: 'routing' }),
    (error) => error instanceof WorkspaceStateError && error.code === 'STATE_LKG_SAFETY_MISMATCH'
  );
});

test('rollback copies a prior valid revision into a new monotonic revision', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  const first = await store.migrateLegacy({ confirm: true, approveForRouting: true });
  writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 2 });
  const second = await store.publishLegacySnapshot({ expectedRevisionId: first.pointer.revisionId });
  const rollback = await store.rollback({
    targetRevisionId: first.pointer.revisionId,
    expectedRevisionId: second.pointer.revisionId,
    actor: 'test-reviewer',
    reason: 'Restore the previously validated workspace state.',
    approveForRouting: true
  });
  assert.ok(rollback.pointer.sequence > second.pointer.sequence);
  assert.notEqual(rollback.pointer.revisionId, first.pointer.revisionId);
  assert.equal(rollback.manifest.mutation.kind, 'rollback');
  assert.equal(rollback.manifest.mutation.targetRevisionId, first.pointer.revisionId);
  assert.equal((await store.readCurrent()).source, 'current');
});

test('pointer and manifest traversal are rejected even with recomputed payload receipts', async (t) => {
  const firstProject = project(t);
  const firstStore = WorkspaceStateStore.open(firstProject.cwd);
  await firstStore.migrateLegacy({ confirm: true, approveForRouting: true });
  const pointerPath = path.join(firstProject.dir, 'state/pointers/current.json');
  const pointer = readJson(pointerPath);
  writeJson(pointerPath, redigest({ ...pointer, revisionId: '../escape' }));
  await assert.rejects(firstStore.readCurrent(), /pointer is missing or invalid/i);

  const secondProject = project(t);
  const secondStore = WorkspaceStateStore.open(secondProject.cwd);
  const migrated = await secondStore.migrateLegacy({ confirm: true, approveForRouting: true });
  const manifestPath = path.join(secondProject.dir, 'state/revisions', migrated.pointer.revisionId, 'manifest.json');
  const manifest = readJson(manifestPath);
  manifest.artifacts[0] = { ...manifest.artifacts[0], path: '../escape' };
  const maliciousManifest = redigest(manifest);
  writeJson(manifestPath, maliciousManifest);
  const currentPath = path.join(secondProject.dir, 'state/pointers/current.json');
  const current = readJson(currentPath);
  writeJson(currentPath, redigest({ ...current, manifestDigest: hash(Buffer.from(`${JSON.stringify(maliciousManifest, null, 2)}\n`)) }));
  await assert.rejects(secondStore.readCurrent(), /manifest is invalid/i);
});

test('legacy divergence distinguishes canonical blockers from derived warnings', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  await store.migrateLegacy({ confirm: true, approveForRouting: true });
  writeJson(path.join(dir, 'doctor.json'), { version: 1, generation: 9 });
  writeFileSync(path.join(dir, 'policy.yml'), 'version: 1\nskills:\n  alpha:\n    tier: blocked\n');
  const read = await store.readCurrent({ purpose: 'status' });
  assert.equal(read.legacyDivergence.find((item) => item.path === 'doctor.json')?.severity, 'warning');
  assert.equal(read.legacyDivergence.find((item) => item.path === 'policy.yml')?.severity, 'blocking');
  await assert.rejects(
    store.readCurrent({ purpose: 'routing' }),
    (error) => error instanceof WorkspaceStateError && error.code === 'STATE_LEGACY_CANONICAL_DIVERGENCE'
  );
});

test('mutable legacy projections may grow within their role cap before immutable publication', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  const baseline = await store.migrateLegacy({ confirm: true, approveForRouting: true });
  const expandedPolicy = `version: 1\nskills:\n  alpha:\n    tier: specialist\n# ${'reviewed-policy-padding'.repeat(128)}\n`;
  assert.ok(Buffer.byteLength(expandedPolicy) > baseline.manifest.artifacts.find(artifact => artifact.path === 'policy.yml').bytes);
  writeFileSync(path.join(dir, 'policy.yml'), expandedPolicy);

  const divergent = await store.readCurrent({ purpose: 'status' });
  assert.equal(divergent.legacyDivergence.find(item => item.path === 'policy.yml')?.code, 'digest-mismatch');
  const published = await store.publishLegacySnapshot({ expectedRevisionId: baseline.pointer.revisionId, approveForRouting: true });
  assert.equal(published.manifest.artifacts.find(artifact => artifact.path === 'policy.yml')?.bytes, Buffer.byteLength(expandedPolicy));
  assert.equal((await store.readCurrent({ purpose: 'status' })).legacyDivergence.length, 0);
});

test('legacy divergence classification caps aggregate reads across individually valid projections', async (t) => {
  const { cwd, dir } = project(t);
  const store = WorkspaceStateStore.open(cwd);
  await store.migrateLegacy({ confirm: true, approveForRouting: true });
  truncateSync(path.join(dir, 'doctor.json'), WORKSPACE_STATE_READ_LIMITS.derivedArtifactBytes);
  truncateSync(path.join(dir, 'effective.json'), WORKSPACE_STATE_READ_LIMITS.derivedArtifactBytes);

  await assert.rejects(
    store.readCurrent({ purpose: 'status' }),
    error => error instanceof WorkspaceStateError && error.code === 'STATE_READ_LIMIT_EXCEEDED'
  );
});

test('workspace-state controls and artifact roles reject oversized sparse files before allocation', async (t) => {
  const rawTruth = project(t);
  truncateSync(path.join(rawTruth.dir, 'inventory.json'), WORKSPACE_STATE_READ_LIMITS.rawTruthArtifactBytes + 1);
  await assert.rejects(
    WorkspaceStateStore.open(rawTruth.cwd).migrateLegacy({ confirm: true }),
    error => error instanceof WorkspaceStateError && error.code === 'STATE_READ_LIMIT_EXCEEDED'
  );

  const canonical = project(t);
  truncateSync(path.join(canonical.dir, 'policy.yml'), WORKSPACE_STATE_READ_LIMITS.canonicalIntentArtifactBytes + 1);
  await assert.rejects(
    WorkspaceStateStore.open(canonical.cwd).migrateLegacy({ confirm: true }),
    error => error instanceof WorkspaceStateError && error.code === 'STATE_READ_LIMIT_EXCEEDED'
  );

  const pointer = project(t);
  const pointerStore = WorkspaceStateStore.open(pointer.cwd);
  await pointerStore.migrateLegacy({ confirm: true, approveForRouting: true });
  truncateSync(path.join(pointer.dir, 'state', 'pointers', 'current.json'), WORKSPACE_STATE_READ_LIMITS.pointerBytes + 1);
  await assert.rejects(
    pointerStore.readCurrent(),
    error => error instanceof WorkspaceStateError
      && error.code === 'STATE_CURRENT_POINTER_INVALID'
      && error.cause instanceof WorkspaceStateError
      && error.cause.code === 'STATE_READ_LIMIT_EXCEEDED'
  );

  const manifest = project(t);
  const manifestStore = WorkspaceStateStore.open(manifest.cwd);
  const migrated = await manifestStore.migrateLegacy({ confirm: true, approveForRouting: true });
  truncateSync(
    path.join(manifest.dir, 'state', 'revisions', migrated.pointer.revisionId, 'manifest.json'),
    WORKSPACE_STATE_READ_LIMITS.manifestBytes + 1
  );
  await assert.rejects(
    manifestStore.readCurrent(),
    error => error instanceof WorkspaceStateError
      && error.code === 'STATE_MANIFEST_INVALID'
      && error.cause instanceof WorkspaceStateError
      && error.cause.code === 'STATE_READ_LIMIT_EXCEEDED'
  );
});

test('workspace-state reads reject symlinked final files and nested revision ancestors', async (t) => {
  const finalLink = project(t);
  const finalStore = WorkspaceStateStore.open(finalLink.cwd);
  await finalStore.migrateLegacy({ confirm: true, approveForRouting: true });
  const currentPointer = path.join(finalLink.dir, 'state', 'pointers', 'current.json');
  const outsidePointer = path.join(finalLink.cwd, 'outside-current.json');
  renameSync(currentPointer, outsidePointer);
  symlinkSync(outsidePointer, currentPointer, 'file');
  await assert.rejects(
    finalStore.readCurrent(),
    error => error instanceof WorkspaceStateError
      && error.code === 'STATE_CURRENT_POINTER_INVALID'
      && error.cause instanceof WorkspaceStateError
      && error.cause.code === 'STATE_UNSAFE_PATH'
  );

  const ancestorLink = project(t);
  const ancestorStore = WorkspaceStateStore.open(ancestorLink.cwd);
  await ancestorStore.migrateLegacy({ confirm: true, approveForRouting: true });
  const revisions = path.join(ancestorLink.dir, 'state', 'revisions');
  const outsideRevisions = path.join(ancestorLink.cwd, 'outside-revisions');
  renameSync(revisions, outsideRevisions);
  symlinkSync(outsideRevisions, revisions, directoryLinkType());
  await assert.rejects(
    ancestorStore.readCurrent(),
    error => error instanceof WorkspaceStateError
      && error.code === 'STATE_MARKER_INVALID'
      && error.cause instanceof WorkspaceStateError
      && error.cause.code === 'STATE_UNSAFE_PATH'
  );
});

test('workspace-state traversal enforces entry and depth budgets while preserving bounded reads', async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-workspace-traversal-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, 'root');
  mkdirSync(path.join(root, 'nested'), { recursive: true });
  writeFileSync(path.join(root, 'one.json'), '{}\n');
  writeFileSync(path.join(root, 'two.json'), '{}\n');
  writeFileSync(path.join(root, 'nested', 'three.json'), '{}\n');

  await assert.rejects(
    listRegularFiles(root, { boundaryRoot: root, maxEntries: 2, maxDepth: 2 }),
    error => error instanceof WorkspaceStateError && error.code === 'STATE_TRAVERSAL_LIMIT_EXCEEDED'
  );
  await assert.rejects(
    listRegularFiles(root, { boundaryRoot: root, maxEntries: 4, maxDepth: 0 }),
    error => error instanceof WorkspaceStateError && error.code === 'STATE_TRAVERSAL_LIMIT_EXCEEDED'
  );
  assert.deepEqual(
    await listRegularFiles(root, { boundaryRoot: root, maxEntries: 4, maxDepth: 1 }),
    ['nested/three.json', 'one.json', 'two.json']
  );
});

function revisionArtifact(skillmapDir, revisionId, relative) {
  return path.join(skillmapDir, 'state/revisions', revisionId, 'workspace/.skillmap', ...relative.split('/'));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function redigest(value) {
  const next = { ...value };
  delete next.payloadDigest;
  return withPayloadDigest(next);
}

function hash(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function directoryLinkType() {
  return process.platform === 'win32' ? 'junction' : 'dir';
}
