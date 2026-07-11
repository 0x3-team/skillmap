import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJob, transitionJob } from '../dist/core/jobs.js';
import { SkillMapLocalBackend, workspaceFilesystemIdentity } from '../dist/server/skillmap-backend.js';

function sandbox(t, prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function monitorFactory(log) {
  return (cwd) => {
    const entry = { cwd, starts: 0, closes: 0 };
    log.push(entry);
    return {
      async start() { entry.starts += 1; },
      async close() { entry.closes += 1; },
      requestVerification() {},
      etagToken() { return `monitor-${log.length}`; },
      snapshot() { return { state: 'inactive', filesystemDirty: false, reasonCode: null, observedAt: null, lastVerifiedAt: null, observedDigest: null, expectedDigest: null, rootIds: [], suggestedJobType: null }; }
    };
  };
}

test('foreground workspace selection is two-step, redacted, clears stale tokens, and restarts freshness', async (t) => {
  const parent = sandbox(t, 'skillmap-workspace-switch-');
  const initial = path.join(parent, 'initial');
  const selected = path.join(parent, 'selected');
  const root = path.join(initial, 'candidate-root');
  mkdirSync(root, { recursive: true });
  mkdirSync(selected, { recursive: true });
  mkdirSync(path.join(selected, '.skillmap'), { recursive: true });
  writeFileSync(path.join(selected, '.skillmap', 'config.yml'), 'version: 1\nprofile: personal-v1\nroots: []\n');
  const lifecycle = [];
  const backend = new SkillMapLocalBackend(initial, { filesystemFreshnessFactory: monitorFactory(lifecycle) });
  await backend.start();

  const staleRoot = await backend.validateRoot({ candidate: root });
  const staleWorkspace = await backend.validateWorkspace({ candidate: initial, mode: 'select-existing' });
  const validated = await backend.validateWorkspace({ candidate: selected, mode: 'select-existing' });
  assert.equal(validated.state, 'validated');
  assert.equal(validated.mode, 'select-existing');
  assert.equal(validated.confirmationRequired, true);
  assert.equal(JSON.stringify(validated).includes(selected), false);
  assert.equal((await backend.bootstrap()).state, 'uninitialized', 'validation must not switch the active workspace');

  const switched = await backend.selectWorkspace({ validationId: validated.validationId, confirm: true });
  assert.equal(switched.state, 'selected');
  assert.equal(switched.created, false);
  assert.equal(switched.alreadySelected, false);
  assert.equal(switched.bootstrapState, 'partial-legacy');
  assert.equal(JSON.stringify(switched).includes(selected), false);
  assert.equal((await backend.bootstrap()).state, 'partial-legacy');
  assert.equal(lifecycle.length, 2);
  assert.deepEqual(lifecycle.map((item) => [item.starts, item.closes]), [[1, 1], [1, 0]]);

  await assert.rejects(
    backend.selectWorkspace({ validationId: staleWorkspace.validationId, confirm: true }),
    (error) => error.code === 'WORKSPACE_VALIDATION_INVALID'
  );
  await assert.rejects(
    backend.approveRoot({ validationId: staleRoot.validationId, expectedRevision: null }),
    /missing or expired/
  );
  await backend.close();
  assert.equal(lifecycle[1].closes, 1);
});

test('new workspace creation does not write before explicit confirmation and creates only the validated directory', async (t) => {
  const parent = sandbox(t, 'skillmap-workspace-create-');
  const initial = path.join(parent, 'initial');
  const created = path.join(parent, 'new-workspace');
  mkdirSync(initial);
  const backend = new SkillMapLocalBackend(initial);
  const validation = await backend.validateWorkspace({ candidate: created, mode: 'create-new' });
  assert.equal(validation.mode, 'create-new');
  assert.equal(existsSync(created), false);
  const receipt = await backend.selectWorkspace({ validationId: validation.validationId, confirm: true });
  assert.equal(receipt.created, true);
  assert.equal(existsSync(created), true);
  assert.equal(lstatSync(created).isDirectory(), true);
  assert.equal(lstatSync(created).isSymbolicLink(), false);
  if (process.platform !== 'win32') assert.equal(lstatSync(created).mode & 0o777, 0o700);
  assert.equal((await backend.bootstrap()).state, 'uninitialized');
  assert.equal(JSON.stringify(receipt).includes(created), false);
});

test('workspace identity preserves device and inode values beyond the safe-number boundary', () => {
  const device = BigInt(Number.MAX_SAFE_INTEGER) + 17n;
  const inode = device + 1n;
  assert.deepEqual(
    workspaceFilesystemIdentity({ dev: device, ino: inode }, 'WORKSPACE_CANDIDATE_INVALID', 'invalid identity'),
    { device: device.toString(10), inode: inode.toString(10) }
  );
  assert.throws(
    () => workspaceFilesystemIdentity({ dev: -1n, ino: 1n }, 'WORKSPACE_CANDIDATE_INVALID', 'invalid identity'),
    (error) => error.code === 'WORKSPACE_CANDIDATE_INVALID'
  );
});

test('steady workspace and dashboard names redact secret-bearing and supported control-bearing directory basenames', async (t) => {
  const parent = sandbox(t, 'skillmap-workspace-label-');
  const secretCanary = 'Bearer token WORKSPACE_LABEL_CANARY';
  const controlCanary = process.platform === 'win32' ? '' : '\nCONTROL_CANARY';
  const cwd = path.join(parent, `${secretCanary}${controlCanary}`);
  const root = path.join(cwd, 'skills');
  mkdirSync(path.join(root, 'alpha'), { recursive: true });
  writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for alpha work.\n---\n# Alpha\n');
  const backend = new SkillMapLocalBackend(cwd);
  const validated = await backend.validateRoot({ candidate: root });
  await backend.approveRoot({ validationId: validated.validationId, expectedRevision: null });
  const workspace = await backend.workspace();
  const dashboard = await backend.dashboard();
  assert.equal(workspace.name, 'Local workspace');
  assert.equal(dashboard.workspace.name, 'Local workspace');
  for (const value of [workspace, dashboard]) {
    const text = JSON.stringify(value);
    assert.equal(text.includes('WORKSPACE_LABEL_CANARY'), false);
    if (controlCanary) assert.equal(text.includes('CONTROL_CANARY'), false);
  }
});

test('workspace confirmation rejects selected-directory and parent-directory symlink races', async (t) => {
  const parent = sandbox(t, 'skillmap-workspace-race-');
  const initial = path.join(parent, 'initial');
  const selected = path.join(parent, 'selected');
  const selectedMoved = path.join(parent, 'selected-moved');
  const alternate = path.join(parent, 'alternate');
  mkdirSync(initial);
  mkdirSync(selected);
  mkdirSync(alternate);
  const backend = new SkillMapLocalBackend(initial);
  await assert.rejects(
    backend.validateWorkspace({ candidate: path.join(parent, 'missing-existing'), mode: 'select-existing' }),
    (error) => error.code === 'WORKSPACE_CANDIDATE_INVALID'
  );
  await assert.rejects(
    backend.validateWorkspace({ candidate: path.join(parent, 'missing-parent', 'new'), mode: 'create-new' }),
    (error) => error.code === 'WORKSPACE_PARENT_INVALID'
  );
  const selection = await backend.validateWorkspace({ candidate: selected, mode: 'select-existing' });
  renameSync(selected, selectedMoved);
  symlinkSync(alternate, selected, directoryLinkType());
  await assert.rejects(
    backend.selectWorkspace({ validationId: selection.validationId, confirm: true }),
    (error) => error.code === 'WORKSPACE_VALIDATION_CHANGED'
  );
  await assert.rejects(
    backend.selectWorkspace({ validationId: selection.validationId, confirm: true }),
    (error) => error.code === 'WORKSPACE_VALIDATION_INVALID',
    'an identity-changed validation token must be consumed'
  );

  const createParent = path.join(parent, 'create-parent');
  const createParentMoved = path.join(parent, 'create-parent-moved');
  mkdirSync(createParent);
  const creation = await backend.validateWorkspace({ candidate: path.join(createParent, 'new'), mode: 'create-new' });
  renameSync(createParent, createParentMoved);
  symlinkSync(alternate, createParent, directoryLinkType());
  await assert.rejects(
    backend.selectWorkspace({ validationId: creation.validationId, confirm: true }),
    (error) => error.code === 'WORKSPACE_VALIDATION_CHANGED'
  );
});

function directoryLinkType() {
  return process.platform === 'win32' ? 'junction' : 'dir';
}

test('foreground switching rejects a current workspace with a nonterminal job', async (t) => {
  const parent = sandbox(t, 'skillmap-workspace-job-gate-');
  const current = path.join(parent, 'current');
  const selected = path.join(parent, 'selected');
  const root = path.join(current, 'skills');
  mkdirSync(path.join(root, 'alpha'), { recursive: true });
  mkdirSync(selected);
  writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for alpha work.\n---\n# Alpha\n');
  const backend = new SkillMapLocalBackend(current);
  const rootValidation = await backend.validateRoot({ candidate: root });
  const initialized = await backend.approveRoot({ validationId: rootValidation.validationId, expectedRevision: null });
  const activeJob = await createJob(current, {
    kind: 'skillmap.job-request', schemaVersion: 1,
    expectedRevision: initialized.revision.revisionId,
    idempotencyKey: 'workspace-switch-active-job-1', requestedBy: 'api', confirmation: 'none',
    parameters: { type: 'doctor' }
  });
  const validation = await backend.validateWorkspace({ candidate: selected, mode: 'select-existing' });
  await assert.rejects(
    backend.selectWorkspace({ validationId: validation.validationId, confirm: true }),
    (error) => error.code === 'WORKSPACE_SWITCH_JOBS_ACTIVE'
  );
  assert.equal((await backend.bootstrap()).state !== 'uninitialized', true, 'failed switch must keep the current workspace active');
  await transitionJob(current, activeJob.stored.job.jobId, 'cancelled');
  const switched = await backend.selectWorkspace({ validationId: validation.validationId, confirm: true });
  assert.equal(switched.state, 'selected', 'a job-blocked validation must remain retryable after the job becomes terminal');
});

test('foreground switching rejects a selected workspace with a nonterminal job', async (t) => {
  const parent = sandbox(t, 'skillmap-workspace-target-job-gate-');
  const current = path.join(parent, 'current');
  const selected = path.join(parent, 'selected');
  const root = path.join(selected, 'skills');
  mkdirSync(current);
  mkdirSync(path.join(root, 'alpha'), { recursive: true });
  writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for alpha work.\n---\n# Alpha\n');

  const selectedBackend = new SkillMapLocalBackend(selected);
  const rootValidation = await selectedBackend.validateRoot({ candidate: root });
  const initialized = await selectedBackend.approveRoot({ validationId: rootValidation.validationId, expectedRevision: null });
  await selectedBackend.close();
  await createJob(selected, {
    kind: 'skillmap.job-request', schemaVersion: 1,
    expectedRevision: initialized.revision.revisionId,
    idempotencyKey: 'workspace-switch-target-job-1', requestedBy: 'api', confirmation: 'none',
    parameters: { type: 'doctor' }
  });

  const backend = new SkillMapLocalBackend(current);
  const validation = await backend.validateWorkspace({ candidate: selected, mode: 'select-existing' });
  await assert.rejects(
    backend.selectWorkspace({ validationId: validation.validationId, confirm: true }),
    (error) => error.code === 'WORKSPACE_SWITCH_JOBS_ACTIVE'
  );
  assert.equal((await backend.bootstrap()).state, 'uninitialized', 'failed switch must keep the current workspace active');
});

test('root and workspace validation registries cap active tokens and admit again after expiry pruning', async (t) => {
  const parent = sandbox(t, 'skillmap-validation-cap-');
  const cwd = path.join(parent, 'current');
  const root = path.join(parent, 'root');
  const selected = path.join(parent, 'selected');
  mkdirSync(cwd);
  mkdirSync(root);
  mkdirSync(selected);
  const backend = new SkillMapLocalBackend(cwd);

  for (let index = 0; index < 32; index += 1) await backend.validateRoot({ candidate: root });
  await assert.rejects(
    backend.validateRoot({ candidate: root }),
    (error) => error.code === 'ROOT_VALIDATION_LIMIT' && /Approve or wait/.test(error.message)
  );
  backend.rootValidations.values().next().value.createdAt = 0;
  assert.equal(typeof (await backend.validateRoot({ candidate: root })).validationId, 'string');

  for (let index = 0; index < 32; index += 1) {
    await backend.validateWorkspace({ candidate: selected, mode: 'select-existing' });
  }
  await assert.rejects(
    backend.validateWorkspace({ candidate: selected, mode: 'select-existing' }),
    (error) => error.code === 'WORKSPACE_VALIDATION_LIMIT' && /Confirm or wait/.test(error.message)
  );
  backend.workspaceValidations.values().next().value.createdAt = 0;
  assert.equal(typeof (await backend.validateWorkspace({ candidate: selected, mode: 'select-existing' })).validationId, 'string');
});
