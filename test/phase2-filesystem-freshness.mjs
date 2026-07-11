import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deriveSkillId, hashSkillTree } from '../dist/core/identity.js';
import { ApprovedRootFreshnessMonitor, verifyApprovedRootManifest } from '../dist/server/filesystem-freshness.js';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';
import { startLocalConnector } from '../dist/server/local-connector.js';
import { assertEndpointPayload } from '../assets/local-app/v1/modules/api.js';

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const REVISION = {
  workspaceId: WORKSPACE_ID,
  revisionId: 'r00000000000000000001-33333333-3333-4333-8333-333333333333',
  workspaceRevision: `sha256:${'1'.repeat(64)}`,
  effectiveDigest: null,
  effectiveRevisionDigest: null
};

test('approved-root watcher marks a changed skill dirty, full verification supplies redacted digests, and close stops observation', async t => {
  const fixture = await createFixture(t, 'skillmap-freshness-watch-');
  const original = skillText('alpha', 'Use for focused alpha work.');
  await writeFile(fixture.skillFile, original);
  const baseline = await createBaseline(fixture.root, fixture.skillDirectory);
  const monitor = new ApprovedRootFreshnessMonitor(fixture.cwd, {
    debounceMs: 20,
    verificationIntervalMs: 60_000,
    loadBaseline: async () => baseline
  });
  t.after(() => monitor.close());

  await monitor.start();
  assert.equal(monitor.snapshot().state, 'clean');
  assert.equal(monitor.snapshot().filesystemDirty, false);
  assert.equal(monitor.snapshot().observedDigest, monitor.snapshot().expectedDigest);

  const installedWatcherEntry = [...monitor.watchers.entries()][0];
  assert.ok(installedWatcherEntry, 'clean verification must install watcher coverage before changes are observed');
  const [watchedDirectory, installedWatcher] = installedWatcherEntry;
  installedWatcher.watcher.close();
  monitor.watchers.delete(watchedDirectory);
  const changed = skillText('alpha', 'Use for changed alpha work with different behavior.');
  await writeFile(fixture.skillFile, changed);
  // Native fs.watch delivery is intentionally only a hint and varies across
  // macOS FSEvents, kqueue, and loaded CI hosts. Close its native delivery
  // before the fixture write, exercise its registered callback deterministically,
  // then let the full verification install fresh watcher coverage.
  installedWatcher.watcher.emit('change', 'change', 'SKILL.md');
  assert.equal(monitor.snapshot().reasonCode, 'watch-event');
  await monitor.verifyNow();
  assert.equal(monitor.snapshot().reasonCode, 'manifest-mismatch');
  const dirty = monitor.snapshot();
  assert.equal(dirty.filesystemDirty, true);
  assert.equal(dirty.suggestedJobType, 'scan');
  assert.deepEqual(dirty.rootIds, [ROOT_ID]);
  assert.match(dirty.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(dirty.observedDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(dirty.expectedDigest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(dirty.observedDigest, dirty.expectedDigest);
  assert.equal(JSON.stringify(dirty).includes(fixture.root), false, 'freshness metadata must not expose approved root paths');
  assert.equal(await readFile(fixture.skillFile, 'utf8'), changed, 'observation must not rewrite skill-root content');

  await writeFile(fixture.skillFile, original);
  await monitor.verifyNow();
  assert.equal(monitor.snapshot().state, 'clean');
  assert.equal(monitor.snapshot().filesystemDirty, false);

  await monitor.close();
  const stopped = monitor.snapshot();
  await writeFile(fixture.skillFile, changed);
  await delay(80);
  assert.deepEqual(monitor.snapshot(), stopped, 'closed watchers and timers must not observe later changes');
});

test('periodic-grade full manifest verification detects added skills and fails closed at configured limits', async t => {
  const fixture = await createFixture(t, 'skillmap-freshness-bounds-');
  await writeFile(fixture.skillFile, skillText('alpha', 'Use for focused alpha work.'));
  const baseline = await createBaseline(fixture.root, fixture.skillDirectory);

  const clean = await verifyApprovedRootManifest(baseline);
  assert.equal(clean.changedRootIds.length, 0);

  let periodicLoads = 0;
  let periodicClockTick = 0;
  const periodic = new ApprovedRootFreshnessMonitor(fixture.cwd, {
    verificationIntervalMs: 30,
    loadBaseline: async () => { periodicLoads += 1; return baseline; },
    now: () => new Date(Date.UTC(2026, 0, 1) + periodicClockTick++)
  });
  t.after(() => periodic.close());
  await periodic.start();
  const initialVerifiedAt = periodic.snapshot().lastVerifiedAt;
  // macOS may emit a conservative watch hint while the periodic verification
  // is still in flight. Prove that the next full verification finished before
  // asserting the state it is responsible for restoring.
  await waitFor(() => {
    const snapshot = periodic.snapshot();
    return periodicLoads >= 2 && snapshot.lastVerifiedAt !== initialVerifiedAt && snapshot.state === 'clean';
  });
  assert.equal(periodic.snapshot().state, 'clean');
  await periodic.close();

  const second = path.join(fixture.root, 'beta');
  await mkdir(second);
  await writeFile(path.join(second, 'SKILL.md'), skillText('beta', 'Use for focused beta work.'));
  const added = await verifyApprovedRootManifest(baseline);
  assert.deepEqual(added.changedRootIds, [ROOT_ID]);
  assert.notEqual(added.observedDigest, added.expectedDigest);

  const limited = new ApprovedRootFreshnessMonitor(fixture.cwd, {
    verificationIntervalMs: 60_000,
    loadBaseline: async () => baseline,
    limits: { maxFileBytes: 8 }
  });
  t.after(() => limited.close());
  await limited.start();
  assert.equal(limited.snapshot().state, 'dirty');
  assert.equal(limited.snapshot().reasonCode, 'verification-limit');
  assert.equal(limited.snapshot().filesystemDirty, true);
});

test('a watcher error removes the failed instance before a full verification can report clean', async t => {
  const fixture = await createFixture(t, 'skillmap-freshness-watcher-error-');
  await writeFile(fixture.skillFile, skillText('alpha', 'Use for focused alpha work.'));
  const baseline = await createBaseline(fixture.root, fixture.skillDirectory);
  const monitor = new ApprovedRootFreshnessMonitor(fixture.cwd, {
    debounceMs: 60_000,
    verificationIntervalMs: 60_000,
    loadBaseline: async () => baseline
  });
  t.after(() => monitor.close());

  await monitor.start();
  assert.equal(monitor.snapshot().state, 'clean');
  const initialWatchers = [...monitor.watchers.values()];
  assert.ok(initialWatchers.length > 0, 'clean verification must install at least one watcher');
  const failed = initialWatchers[0].watcher;
  failed.emit('error', new Error('simulated watcher failure'));

  assert.equal(monitor.snapshot().state, 'dirty');
  assert.equal(monitor.snapshot().reasonCode, 'watcher-unavailable');
  assert.equal([...monitor.watchers.values()].some(item => item.watcher === failed), false, 'failed watcher must not remain registered');

  await monitor.verifyNow();
  assert.equal(monitor.snapshot().state, 'clean');
  assert.ok([...monitor.watchers.values()].some(item => item.watcher !== failed), 'full verification must create replacement watcher coverage');
});

test('workspace and dashboard expose observed dirty state without local paths', async t => {
  const fixture = await createFixture(t, 'skillmap-freshness-backend-');
  await writeFile(fixture.skillFile, skillText('alpha', 'Use for focused alpha work.'));
  const freshness = new ApprovedRootFreshnessMonitor(fixture.cwd, { debounceMs: 20, verificationIntervalMs: 60_000 });
  const backend = new SkillMapLocalBackend(fixture.cwd, { filesystemFreshness: freshness });
  t.after(() => backend.close());

  const validation = await backend.validateRoot({ candidate: fixture.root });
  await backend.approveRoot({ validationId: validation.validationId, expectedRevision: null });
  await backend.start();
  const workspace = await backend.workspace();
  const dashboard = await backend.dashboard();

  for (const [route, view] of [['/api/v1/workspace', workspace], ['/api/v1/dashboard', dashboard]]) {
    assert.doesNotThrow(() => assertEndpointPayload(route, view), `${route} rejected a real dirty freshness producer`);
    assert.equal(view.filesystemDirty, true);
    assert.equal(view.filesystemFreshness.reasonCode, 'manifest-mismatch');
    assert.match(view.filesystemFreshness.observedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(view.filesystemFreshness.observedDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(view.filesystemFreshness).includes(fixture.root), false);
  }

  const dirtyEtag = (await backend.revisionContext()).etag;
  await rm(fixture.skillDirectory, { recursive: true, force: true });
  await delay(50);
  await freshness.verifyNow();
  await waitFor(() => freshness.snapshot().state === 'clean');
  const cleanWorkspace = await backend.workspace();
  const cleanDashboard = await backend.dashboard();
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/workspace', cleanWorkspace), 'workspace rejected a real clean freshness producer');
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/dashboard', cleanDashboard), 'dashboard rejected a real clean freshness producer');
  const cleanEtag = (await backend.revisionContext()).etag;
  assert.notEqual(cleanEtag, dirtyEtag, 'freshness transitions must invalidate revision-bound dashboard ETags');
});

test('connector starts and closes backend lifecycle hooks exactly once', async () => {
  let starts = 0;
  let closes = 0;
  const connector = await startLocalConnector({
    backend: {
      async start() { starts += 1; },
      async close() { closes += 1; }
    }
  });
  assert.equal(starts, 1);
  await connector.close();
  await connector.close();
  assert.equal(closes, 1);
});

async function createFixture(t, prefix) {
  const cwd = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, 'skills');
  const skillDirectory = path.join(root, 'alpha');
  await mkdir(skillDirectory, { recursive: true });
  return { cwd, root, skillDirectory, skillFile: path.join(skillDirectory, 'SKILL.md') };
}

async function createBaseline(root, skillDirectory) {
  const relativePath = 'alpha';
  const tree = await hashSkillTree(skillDirectory);
  const rootRealPath = await realpath(root);
  return {
    revision: REVISION,
    roots: [{ rootId: ROOT_ID, configuredPath: root, realPath: rootRealPath, approvedAt: '2026-07-10T00:00:00.000Z' }],
    skills: [{ rootId: ROOT_ID, relativePath, skillId: deriveSkillId(ROOT_ID, relativePath), contentRevision: tree.contentRevision }]
  };
}

function skillText(name, description) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('Timed out waiting for filesystem freshness observation.');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
