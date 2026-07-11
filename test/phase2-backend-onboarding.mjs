import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJob, readJob, transitionJob } from '../dist/core/jobs.js';
import { initCommand } from '../dist/commands/init.js';
import { scanCommand } from '../dist/commands/scan.js';
import { applyPolicyCommand } from '../dist/commands/apply-policy.js';
import { hookCommand } from '../dist/commands/hook.js';
import { WorkspaceStateStore } from '../dist/core/workspace-state/index.js';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';

function workspace(t, prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

test('config-only legacy bootstrap is classified as partial instead of offering an impossible migration', async (t) => {
  const cwd = workspace(t, 'skillmap-legacy-bootstrap-');
  mkdirSync(path.join(cwd, '.skillmap'), { recursive: true });
  writeFileSync(path.join(cwd, '.skillmap', 'config.yml'), 'version: 1\nprofile: personal-v1\nroots: []\n');
  const backend = new SkillMapLocalBackend(cwd);
  assert.deepEqual(await backend.bootstrap(), {
    state: 'partial-legacy',
    initialized: false,
    routingReady: false,
    productReady: false,
    configuredRootCount: 0,
    nextAction: 'approve-roots'
  });
});

test('reviewed config-only roots can be validated, adopted, and migrated without routing approval', async (t) => {
  const cwd = workspace(t, 'skillmap-partial-legacy-adopt-');
  const root = path.join(cwd, 'skills');
  mkdirSync(path.join(root, 'alpha'), { recursive: true });
  writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for focused alpha work.\n---\n# Alpha\n');
  mkdirSync(path.join(cwd, '.skillmap'), { recursive: true });
  writeFileSync(path.join(cwd, '.skillmap', 'config.yml'), `version: 1\nprofile: personal-v1\nroots:\n  - ${JSON.stringify(root)}\n`);
  const backend = new SkillMapLocalBackend(cwd);
  const before = await backend.bootstrap();
  assert.equal(before.state, 'partial-legacy');
  assert.equal(before.configuredRootCount, 1);
  assert.equal(before.nextAction, 'adopt-configured-roots');

  const adopted = await backend.adoptPartialLegacy({ confirm: true });
  assert.equal(adopted.adopted, true);
  assert.equal(adopted.rootCount, 1);
  assert.equal(adopted.routingApprovalRequired, true);
  assert.match(adopted.revision.revisionId, /^r[0-9]{20}-/);
  const after = await backend.bootstrap();
  assert.equal(after.initialized, true);
  assert.equal(after.routingReady, false);
  assert.equal(after.nextAction, 'continue-onboarding');
});

test('reviewed legacy state can migrate through the local backend without routing approval', async (t) => {
  const cwd = workspace(t, 'skillmap-reviewed-migration-');
  const root = path.join(cwd, 'skills');
  mkdirSync(root, { recursive: true });
  await initCommand(cwd, { root });
  const backend = new SkillMapLocalBackend(cwd);
  assert.equal((await backend.bootstrap()).state, 'needs-state-migration');
  const migration = await backend.migrateState({ confirm: true });
  assert.equal(migration.migrated, true);
  assert.equal(migration.alreadyMigrated, false);
  assert.equal(migration.revision.effectiveDigest, null);
  const bootstrap = await backend.bootstrap();
  assert.equal(bootstrap.initialized, true);
  assert.equal(bootstrap.nextAction, 'continue-onboarding');
});

test('fresh root approval creates a resumable workspace before the first scan', async (t) => {
  const cwd = workspace(t, 'skillmap-fresh-bootstrap-');
  const root = path.join(cwd, 'skills');
  const skill = path.join(root, 'alpha');
  mkdirSync(skill, { recursive: true });
  writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: alpha\ndescription: Use for focused alpha work.\n---\n# Alpha\n');
  const backend = new SkillMapLocalBackend(cwd);
  const validation = await backend.validateRoot({ candidate: root });
  const approved = await backend.approveRoot({ validationId: validation.validationId, expectedRevision: null });
  assert.equal(approved.approved, true);
  assert.match(approved.revision.revisionId, /^r[0-9]{20}-/);
  const bootstrap = await backend.bootstrap();
  assert.equal(bootstrap.initialized, true);
  assert.equal(bootstrap.nextAction, 'continue-onboarding');
  const view = await backend.workspace();
  assert.equal(view.workspaceId, approved.revision.workspaceId);
  assert.equal(view.roots.length, 1);
  assert.equal(view.readiness.phase, 'missing-inventory');

  const imported = await backend.importEvalSuite({
    expectedRevision: approved.revision.revisionId,
    suite: { version: 2, evals: [{ prompt: 'Review responsive layout', expected: ['alpha'], avoid: [], primaryCaseType: 'implicit-natural', membership: 'train' }] }
  });
  assert.equal(imported.imported, true);
  assert.equal(imported.cases, 1);
  assert.notEqual(imported.revision.revisionId, approved.revision.revisionId);
  const savedSuite = JSON.parse(readFileSync(path.join(cwd, '.skillmap', 'real-evals.json'), 'utf8'));
  assert.equal(savedSuite.evals[0].prompt, 'Review responsive layout');
});

test('connector restart gives an interrupted running job a durable retryable failure receipt', async (t) => {
  const cwd = workspace(t, 'skillmap-job-restart-');
  const root = path.join(cwd, 'skills');
  mkdirSync(path.join(root, 'alpha'), { recursive: true });
  writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for focused alpha work.\n---\n# Alpha\n');
  const backend = new SkillMapLocalBackend(cwd);
  const validation = await backend.validateRoot({ candidate: root });
  const approved = await backend.approveRoot({ validationId: validation.validationId, expectedRevision: null });
  const request = {
    kind: 'skillmap.job-request',
    schemaVersion: 1,
    expectedRevision: approved.revision.revisionId,
    idempotencyKey: 'restart-recovery-job-1',
    requestedBy: 'api',
    confirmation: 'none',
    parameters: { type: 'doctor' }
  };
  const created = await createJob(cwd, request);
  await transitionJob(cwd, created.stored.job.jobId, 'running');
  await new SkillMapLocalBackend(cwd).resumeInterruptedJobs();
  const recovered = await readJob(cwd, created.stored.job.jobId);
  assert.equal(recovered.job.state, 'failed');
  assert.equal(recovered.job.error.code, 'CONNECTOR_RESTARTED');
  assert.equal(recovered.job.error.retryable, true);
});

test('derived corruption is the only bootstrap state that offers automatic recovery', async (t) => {
  const { cwd, backend, approved } = await approvedWorkspace(t, 'skillmap-derived-recovery-');
  const store = WorkspaceStateStore.open(cwd);
  writeFileSync(path.join(cwd, '.skillmap', 'doctor.json'), '{"version":1,"derived":true}\n');
  const current = await store.publishLegacySnapshot({ expectedRevisionId: approved.revisionId, approveForRouting: false });
  writeFileSync(path.join(cwd, '.skillmap', 'state', 'revisions', current.pointer.revisionId, 'workspace', '.skillmap', 'effective.json'), '{"tampered":true}\n');

  const bootstrap = await backend.bootstrap();
  assert.equal(bootstrap.state, 'recovery-required');
  assert.equal(bootstrap.recoverable, true);
  assert.equal(bootstrap.routingReady, false);
  assert.equal(bootstrap.nextAction, 'state-recover');
  const context = await backend.revisionContext();
  assert.equal(context.servingRevision.revisionId, approved.revisionId);
  assert.equal(context.currentRevision.revisionId, current.pointer.revisionId);
  assert.equal(context.compatibility, 'degraded');
});

test('marker, pointer, and manifest corruption keep diagnostics reachable without offering impossible recovery', async (t) => {
  for (const target of ['marker', 'pointer', 'manifest']) {
    await t.test(target, async (st) => {
      const { cwd, backend, approved } = await approvedWorkspace(st, `skillmap-${target}-corrupt-`);
      const file = target === 'marker'
        ? path.join(cwd, '.skillmap', 'state-version.json')
        : target === 'pointer'
          ? path.join(cwd, '.skillmap', 'state', 'pointers', 'current.json')
          : path.join(cwd, '.skillmap', 'state', 'revisions', approved.revisionId, 'manifest.json');
      writeFileSync(file, '{"corrupt":true}\n');
      const health = await backend.health();
      assert.equal(health.status, 'state-unavailable');
      const bootstrap = await backend.bootstrap();
      assert.equal(bootstrap.state, 'manual-repair-required');
      assert.equal(bootstrap.recoverable, false);
      assert.equal(bootstrap.routingReady, false);
      assert.equal(bootstrap.nextAction, 'state-status');
      assert.match(bootstrap.guidance, /state status --json/);
      assert.doesNotMatch(JSON.stringify(bootstrap), new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  }
});

test('status views and route execution agree on the prior serving revision during an unapproved derived-only current revision', async (t) => {
  const { cwd, backend, approved } = await approvedWorkspace(t, 'skillmap-serving-equivalence-');
  writeFileSync(path.join(cwd, '.skillmap', 'doctor.json'), '{"version":1,"generation":2}\n');
  const current = await WorkspaceStateStore.open(cwd).publishLegacySnapshot({ expectedRevisionId: approved.revisionId, approveForRouting: false });
  const context = await backend.revisionContext();
  const bootstrap = await backend.bootstrap();
  const workspaceView = await backend.workspace();
  const dashboardView = await backend.dashboard();
  const route = await backend.previewRoute({ prompt: 'focused alpha work' });
  for (const serving of [context.servingRevision, bootstrap.revision, workspaceView.revision, dashboardView.revision, route.result.decision.revision]) {
    assert.equal(serving.revisionId, approved.revisionId);
  }
  assert.equal(context.currentRevision.revisionId, current.pointer.revisionId);
  assert.equal(workspaceView.currentRevision.revisionId, current.pointer.revisionId);
  assert.equal(workspaceView.servingMode, 'last-known-good');
  assert.equal(bootstrap.servingMode, 'last-known-good');
  assert.equal(workspaceView.routingReady, false);
  assert.equal(route.result.decision.servingMode, 'last-known-good');
  const hook = await hookCommand(cwd, ['dry-run', 'codex', 'focused alpha work'], {});
  assert.notEqual(hook.readiness.phase, 'state-corrupt');
  assert.equal(hook.readiness.warnings.some((warning) => /failed derived validation|recover/i.test(warning)), false);
  assert.equal(hook.readiness.allowed, false);
  assert.equal(hook.readiness.routingReady, false);
  const projectedHook = await backend.verifyHook({ prompt: 'focused alpha work' });
  assert.deepEqual(Object.keys(projectedHook.readiness).sort(), ['allowed', 'phase', 'routingReady', 'verdict']);
  assert.equal(projectedHook.readiness.routingReady, false);
  assert.equal(projectedHook.readiness.allowed, false);
});

async function approvedWorkspace(t, prefix) {
  const cwd = workspace(t, prefix);
  const root = path.join(cwd, 'skills');
  mkdirSync(path.join(root, 'alpha'), { recursive: true });
  writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for focused alpha work.\n---\n# Alpha\n');
  const backend = new SkillMapLocalBackend(cwd);
  const validation = await backend.validateRoot({ candidate: root });
  const initialized = await backend.approveRoot({ validationId: validation.validationId, expectedRevision: null });
  await scanCommand(cwd, {});
  const scanned = await WorkspaceStateStore.open(cwd).publishLegacySnapshot({ expectedRevisionId: initialized.revision.revisionId, approveForRouting: false });
  await applyPolicyCommand(cwd, {});
  const publication = await WorkspaceStateStore.open(cwd).publishLegacySnapshot({ expectedRevisionId: scanned.pointer.revisionId, approveForRouting: true });
  return { cwd, backend, approved: { revisionId: publication.pointer.revisionId } };
}
