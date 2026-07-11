import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertJobRequest,
  claimJobExecution,
  createJob,
  findIdempotentJob,
  JOB_LEDGER_MAX_ENTRIES,
  listAllJobs,
  listJobs,
  readJob,
  requestJobCancellation,
  transitionJob
} from '../dist/core/jobs.js';
import { buildInventory } from '../dist/core/inventory.js';
import { fetchGithubSkillTree } from '../dist/network/github-source-fetcher.js';
import { WorkspaceStateStore } from '../dist/core/workspace-state/index.js';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';
import { scanCommand } from '../dist/commands/scan.js';
import { applyPolicyCommand } from '../dist/commands/apply-policy.js';
import { prepareEvalRunV3ExecutionContext, prepareEvalRunV3StatusContext } from '../dist/services/eval-release-context.js';
import { openApprovedWorkspaceRead } from '../dist/services/workspace-read-model.js';

const REVISION = `r${'1'.padStart(20, '0')}-11111111-1111-4111-8111-111111111111`;

function workspace(t, prefix = 'skillmap-job-safety-') {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function request(key, overrides = {}) {
  return {
    kind: 'skillmap.job-request',
    schemaVersion: 1,
    expectedRevision: REVISION,
    idempotencyKey: key,
    requestedBy: 'api',
    confirmation: 'none',
    parameters: { type: 'doctor' },
    ...overrides
  };
}

async function approvedWorkspace(t) {
  const cwd = workspace(t);
  const root = path.join(cwd, 'skills');
  const skill = path.join(root, 'alpha');
  mkdirSync(skill, { recursive: true });
  writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: alpha\ndescription: Use for focused alpha work.\n---\n# Alpha\n');
  const backend = new SkillMapLocalBackend(cwd);
  const validation = await backend.validateRoot({ candidate: root });
  const approved = await backend.approveRoot({ validationId: validation.validationId, expectedRevision: null });
  return { cwd, root, backend, revisionId: approved.revision.revisionId };
}

async function routingApprovedWorkspace(t) {
  const fixture = await approvedWorkspace(t);
  await scanCommand(fixture.cwd, {});
  const scanned = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: fixture.revisionId,
    approveForRouting: false,
    actor: 'test:scan',
    reason: 'Captured a qualified inventory for isolated eval context testing.'
  });
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'policy.yml'), 'version: 1\nskills:\n  alpha:\n    tier: active-default\n    preferred_for:\n      - focused work\n');
  await applyPolicyCommand(fixture.cwd, {});
  const approved = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: scanned.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:policy',
    reason: 'Approved the baseline effective registry for routing.'
  });
  return { ...fixture, revisionId: approved.pointer.revisionId, revision: approved.pointer };
}

test('idempotency anchor wins before any public record and concurrent losers cannot leave executable orphans', async (t) => {
  const cwd = workspace(t);
  const results = await Promise.all(Array.from({ length: 24 }, () => createJob(cwd, request('same-request-1'))));
  assert.equal(results.filter((item) => item.created).length, 1);
  assert.equal(new Set(results.map((item) => item.stored.job.jobId)).size, 1);
  assert.equal((await listAllJobs(cwd)).length, 1);

  const anchored = results[0].stored;
  const orphanId = '22222222-2222-4222-8222-222222222222';
  const orphan = { ...anchored, job: { ...anchored.job, jobId: orphanId } };
  writeFileSync(path.join(cwd, '.skillmap', 'operational', 'jobs', 'records', `${orphanId}.json`), `${JSON.stringify(orphan, null, 2)}\n`);
  assert.deepEqual((await listJobs(cwd, 100)).map((item) => item.job.jobId), [anchored.job.jobId]);
});

test('one live execution claim serializes same-job lifecycle transitions across connector instances', async (t) => {
  const cwd = workspace(t);
  const created = await createJob(cwd, request('claim-serialization-1'));
  const [left, right] = await Promise.all([
    claimJobExecution(cwd, created.stored.job.jobId),
    claimJobExecution(cwd, created.stored.job.jobId)
  ]);
  assert.equal([left, right].filter(Boolean).length, 1);
  const winner = left ?? right;
  await transitionJob(cwd, created.stored.job.jobId, 'running', { claim: winner });
  await winner.release();
  assert.equal((await readJob(cwd, created.stored.job.jobId)).job.state, 'running');
});

test('generic job contracts require exact revision and reject removed or silently ignored parameters', () => {
  assert.throws(() => assertJobRequest(request('null-revision', { expectedRevision: null })), /exact canonical revision/);
  assert.throws(() => assertJobRequest(request('review-confirmation', { confirmation: 'review' })), /confirmation/i);
  assert.throws(() => assertJobRequest(request('apply-policy', { parameters: { type: 'apply-policy' } })), /allowlisted/);
  assert.throws(() => assertJobRequest(request('repair', { parameters: { type: 'repair-projections' } })), /allowlisted/);
  assert.throws(() => assertJobRequest(request('scan-subset', { parameters: { type: 'scan', rootIds: ['11111111-1111-4111-8111-111111111111'] } })), /unknown field rootIds/);
  assert.throws(() => assertJobRequest(request('eval-suite', { parameters: { type: 'eval-run', suiteId: 'reviewed' } })), /unknown field suiteId/);
  assert.throws(() => assertJobRequest(request('source-subset', { parameters: { type: 'sources-check', skillIds: ['sk_invalid'] } })), /unknown field skillIds/);
});

test('job error receipts reject Linux, Windows, UNC, and file URL location canaries', async (t) => {
  const cwd = workspace(t);
  const created = await createJob(cwd, request('privacy-error-1'));
  await transitionJob(cwd, created.stored.job.jobId, 'running');
  for (const message of [
    'failed at /opt/private/state.json',
    'failed at C:\\private\\state.json',
    'failed at \\\\server\\private\\state.json',
    'failed at file:///tmp/private-state.json'
  ]) {
    await assert.rejects(transitionJob(cwd, created.stored.job.jobId, 'failed', {
      error: { code: 'PATH_LEAK', message, retryable: false }
    }), /not safe/);
  }
  await transitionJob(cwd, created.stored.job.jobId, 'failed', {
    error: { code: 'SAFE_FAILURE', message: 'The isolated job failed before publication.', retryable: false }
  });
});

test('scan stages outside the writer lock, preserves logical cwd/scope, and two connectors publish once', async (t) => {
  const fixture = await approvedWorkspace(t);
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const gated = new SkillMapLocalBackend(fixture.cwd, {
    jobLifecycleHooks: {
      async beforeStagedExecution() { enteredResolve(); await release; }
    }
  });
  const jobRequest = request('isolated-scan-1', {
    expectedRevision: fixture.revisionId,
    parameters: { type: 'scan' }
  });
  const created = await createJob(fixture.cwd, jobRequest);
  const running = gated.runJob(created.stored.job.jobId);
  await entered;
  await WorkspaceStateStore.open(fixture.cwd).withMutationLock('job-safety-test-probe', async () => undefined);
  releaseResolve();
  await running;
  const completed = await readJob(fixture.cwd, created.stored.job.jobId);
  assert.equal(completed.job.state, 'succeeded');

  const saved = JSON.parse(readFileSync(path.join(fixture.cwd, '.skillmap', 'inventory.json'), 'utf8'));
  const direct = await buildInventory(fixture.cwd, [fixture.root], [], { persistIdentity: false, logicalCwd: fixture.cwd });
  assert.equal(saved.cwd, fixture.cwd);
  assert.equal(saved.skills[0].scope, 'project');
  assert.equal(JSON.stringify(saved).includes('job-staging'), false);
  assert.deepEqual({ ...saved, generatedAt: direct.generatedAt }, direct);

  const duplicate = await createJob(fixture.cwd, jobRequest);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.stored.job.jobId, completed.job.jobId);
});

test('isolated eval resolves a receipt-verified historical baseline before staging and passes a frozen runtime context', async (t) => {
  const fixture = await routingApprovedWorkspace(t);
  const baselineRevision = fixture.revision;
  const baselineEffectiveArtifact = readFileSync(path.join(
    fixture.cwd, '.skillmap', 'state', 'revisions', baselineRevision.revisionId, 'workspace', '.skillmap', 'effective.json'
  ), 'utf8');
  const intermediate = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: baselineRevision.revisionId,
    approveForRouting: true,
    actor: 'test:baseline-gap',
    reason: 'Created an intervening approved revision after the historical eval baseline.'
  });
  const suite = {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    baseline: {
      provenance: {
        sourceKind: 'approved-effective-revision',
        sourceRevision: baselineRevision
      }
    }
  };
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'real-evals.json'), `${JSON.stringify(suite, null, 2)}\n`);
  const suitePublication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: intermediate.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:v3-suite',
    reason: 'Published a v3 suite whose approved baseline is more than one revision behind.'
  });
  let observed;
  const backend = new SkillMapLocalBackend(fixture.cwd, {
    async evalCommandRunner(stage, flags, runtime) {
      observed = {
        stage,
        flags,
        runtime,
        stagedRevisionIds: readdirSync(path.join(stage, '.skillmap', 'state', 'revisions')).sort()
      };
      writeFileSync(path.join(stage, '.skillmap', 'eval-report.json'), '{}\n');
      return {};
    }
  });
  const created = await createJob(fixture.cwd, request('v3-historical-baseline-1', {
    expectedRevision: suitePublication.pointer.revisionId,
    parameters: { type: 'eval-run' }
  }));
  await backend.runJob(created.stored.job.jobId);
  const completed = await readJob(fixture.cwd, created.stored.job.jobId);
  assert.equal(completed.job.state, 'succeeded');
  assert.deepEqual(observed.flags, { 'save-report': true });
  assert.equal(Object.isFrozen(observed.runtime), true);
  assert.equal(Object.isFrozen(observed.runtime.releaseContext), true);
  assert.equal(Object.isFrozen(observed.runtime.releaseContext.approvedRevision), true);
  assert.equal(Object.isFrozen(observed.runtime.releaseContext.approvedBaselineRevision), true);
  assert.equal(observed.runtime.releaseContext.approvedRevision.revisionId, suitePublication.pointer.revisionId);
  assert.deepEqual(observed.runtime.releaseContext.approvedBaselineRevision, {
    workspaceId: baselineRevision.workspaceId,
    revisionId: baselineRevision.revisionId,
    workspaceRevision: baselineRevision.workspaceRevision,
    effectiveDigest: baselineRevision.effectiveDigest,
    effectiveRevisionDigest: baselineRevision.effectiveRevisionDigest
  });
  assert.equal(observed.runtime.releaseContext.baselineEffectiveArtifact, baselineEffectiveArtifact);
  assert.equal(observed.runtime.releaseContext.effectiveArtifact.includes(observed.stage), false);
  assert.equal(observed.runtime.releaseContext.baselineEffectiveArtifact.includes(observed.stage), false);
  assert.deepEqual(observed.stagedRevisionIds, [suitePublication.pointer.revisionId]);
  assert.equal(observed.stagedRevisionIds.includes(baselineRevision.revisionId), false, 'historical baseline directory was copied into the isolated stage');
  const routedAfterEval = await WorkspaceStateStore.open(fixture.cwd).readCurrent({ purpose: 'routing' });
  assert.equal(routedAfterEval.currentPointer.revisionId, completed.job.resultReceipt.revisionId);
  assert.equal(routedAfterEval.selectedPointer.revisionId, routedAfterEval.currentPointer.revisionId);
  assert.equal(routedAfterEval.currentPointer.routingSafetyDigest, suitePublication.pointer.routingSafetyDigest);
});

test('historical eval baseline rejects a verified ancestor that was never routing-approved', async (t) => {
  const fixture = await routingApprovedWorkspace(t);
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'doctor.json'), '{"version":1,"generation":2}\n');
  const unapproved = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: fixture.revision.revisionId,
    approveForRouting: false,
    actor: 'test:unapproved-baseline',
    reason: 'Create an immutable ancestor without a routing approval receipt.'
  });
  const suite = {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    baseline: {
      provenance: {
        sourceKind: 'approved-effective-revision',
        sourceRevision: {
          workspaceId: unapproved.pointer.workspaceId,
          revisionId: unapproved.pointer.revisionId,
          workspaceRevision: unapproved.pointer.workspaceRevision,
          effectiveDigest: unapproved.pointer.effectiveDigest,
          effectiveRevisionDigest: unapproved.pointer.effectiveRevisionDigest
        }
      }
    }
  };
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'real-evals.json'), `${JSON.stringify(suite, null, 2)}\n`);
  await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: unapproved.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:approved-suite-after-unapproved-baseline',
    reason: 'Approve the current suite revision without approving its historical baseline parent.'
  });
  await assert.rejects(
    prepareEvalRunV3ExecutionContext(fixture.cwd, suite),
    (error) => error instanceof Error
      && error.code === 'EVAL_RELEASE_BASELINE_UNAPPROVED'
      && error.cause?.code === 'STATE_ROUTING_APPROVAL_UNTRUSTED'
  );
});

test('status rejects a v3 report that labels an unapproved ancestor as its approved run revision', async (t) => {
  const fixture = await routingApprovedWorkspace(t);
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'doctor.json'), '{"version":1,"generation":3}\n');
  const unapproved = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: fixture.revision.revisionId,
    approveForRouting: false,
    actor: 'test:unapproved-run-revision',
    reason: 'Create an unapproved ancestor for a hostile carried report.'
  });
  const suite = {
    kind: 'skillmap.eval-suite', schemaVersion: 3,
    baseline: { provenance: { sourceKind: 'operator-declared-no-skillmap', sourceRevision: null } }
  };
  const report = {
    kind: 'skillmap.eval-run', schemaVersion: 3,
    revision: {
      workspaceId: unapproved.pointer.workspaceId,
      revisionId: unapproved.pointer.revisionId,
      workspaceRevision: unapproved.pointer.workspaceRevision,
      effectiveDigest: unapproved.pointer.effectiveDigest,
      effectiveRevisionDigest: unapproved.pointer.effectiveRevisionDigest
    }
  };
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'real-evals.json'), `${JSON.stringify(suite, null, 2)}\n`);
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'eval-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: unapproved.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:hostile-carried-report',
    reason: 'Publish the hostile report in a later approved revision.'
  });
  const approved = await openApprovedWorkspaceRead(fixture.cwd, 'status');
  await assert.rejects(
    prepareEvalRunV3StatusContext(fixture.cwd, approved),
    (error) => error instanceof Error
      && error.code === 'EVAL_RELEASE_REVISION_UNAPPROVED'
      && error.cause?.code === 'STATE_ROUTING_APPROVAL_UNTRUSTED'
  );
});

test('an eval job cannot succeed by carrying a pre-existing report through a no-op runner', async (t) => {
  const fixture = await routingApprovedWorkspace(t);
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'eval-report.json'), '{"version":2,"count":0}\n');
  const seeded = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: fixture.revision.revisionId,
    approveForRouting: true,
    actor: 'test:seed-old-eval-report',
    reason: 'Seed a prior report that the next isolated runner must replace.'
  });
  const backend = new SkillMapLocalBackend(fixture.cwd, { async evalCommandRunner() { return {}; } });
  const created = await createJob(fixture.cwd, request('eval-no-op-runner-1', {
    expectedRevision: seeded.pointer.revisionId,
    parameters: { type: 'eval-run' }
  }));
  await backend.runJob(created.stored.job.jobId);
  const completed = await readJob(fixture.cwd, created.stored.job.jobId);
  assert.equal(completed.job.state, 'failed');
  assert.equal(completed.job.error.code, 'JOB_OUTPUT_UNCHANGED');
  const current = await WorkspaceStateStore.open(fixture.cwd).readCurrent({ purpose: 'status' });
  assert.equal(current.currentPointer.revisionId, seeded.pointer.revisionId);
});

test('post-publication receipt failure reconciles to succeeded instead of recording a false failure', async (t) => {
  const fixture = await approvedWorkspace(t);
  const backend = new SkillMapLocalBackend(fixture.cwd, {
    jobLifecycleHooks: {
      async afterPublication() { throw new Error('simulated receipt interruption'); }
    }
  });
  const created = await createJob(fixture.cwd, request('post-publish-reconcile-1', {
    expectedRevision: fixture.revisionId,
    parameters: { type: 'scan' }
  }));
  await backend.runJob(created.stored.job.jobId);
  const completed = await readJob(fixture.cwd, created.stored.job.jobId);
  assert.equal(completed.job.state, 'succeeded');
  assert.equal(completed.job.resultReceipt.recoveredReceipt, true);
});

test('reviewed policy apply uses its dedicated exact-revision endpoint and advances routing approval', async (t) => {
  const fixture = await approvedWorkspace(t);
  const scan = await createJob(fixture.cwd, request('policy-prerequisite-scan-1', {
    expectedRevision: fixture.revisionId,
    parameters: { type: 'scan' }
  }));
  await fixture.backend.runJob(scan.stored.job.jobId);
  const afterScan = await WorkspaceStateStore.open(fixture.cwd).readCurrent({ purpose: 'status' });
  const applied = await fixture.backend.applyReviewedPolicy({
    expectedRevision: afterScan.currentPointer.revisionId,
    confirmation: 'review'
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.routingApproved, true);
  const routing = await WorkspaceStateStore.open(fixture.cwd).readCurrent({ purpose: 'routing' });
  assert.equal(routing.currentPointer.revisionId, applied.revision.revisionId);
  assert.equal(routing.selectedPointer.revisionId, applied.revision.revisionId);
});

test('connector shutdown aborts an in-flight isolated source check and publishes no workspace side effect', async (t) => {
  const fixture = await approvedWorkspace(t);
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const backend = new SkillMapLocalBackend(fixture.cwd, {
    jobLifecycleHooks: {
      async beforeStagedExecution({ type, signal }) {
        if (type !== 'sources-check') return;
        enteredResolve();
        await new Promise((_resolve, reject) => {
          const cancel = () => reject(new Error('simulated cancellable network wait'));
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) cancel();
        });
      }
    }
  });
  const created = await backend.createJob(request('source-shutdown-1', {
    expectedRevision: fixture.revisionId,
    parameters: { type: 'sources-check' }
  }));
  await entered;
  await backend.close();
  const stopped = await readJob(fixture.cwd, created.job.jobId);
  assert.equal(stopped.job.state, 'failed');
  assert.equal(stopped.job.error.retryable, true);
  const current = await WorkspaceStateStore.open(fixture.cwd).readCurrent({ purpose: 'status' });
  assert.equal(current.currentPointer.revisionId, fixture.revisionId);
});

test('GitHub source transport receives connector cancellation without waiting for its request timeout', async () => {
  const controller = new AbortController();
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const running = fetchGithubSkillTree('owner/repository', 'main', 'skills/alpha', {
    signal: controller.signal,
    timeoutMs: 120_000,
    maxRetries: 0,
    transport: async ({ signal }) => {
      enteredResolve();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true }));
    }
  });
  await entered;
  controller.abort();
  await assert.rejects(running, (error) => error?.code === 'REQUEST_ABORTED');
});

test('recovery processes every anchored nonterminal job beyond the first 100', { timeout: 30_000 }, async (t) => {
  const cwd = workspace(t);
  for (let index = 0; index < 101; index += 1) {
    const created = await createJob(cwd, request(`recovery-${String(index).padStart(3, '0')}`));
    await transitionJob(cwd, created.stored.job.jobId, 'running');
  }
  await new SkillMapLocalBackend(cwd).resumeInterruptedJobs();
  const jobs = await listAllJobs(cwd);
  assert.equal(jobs.length, 101);
  assert.equal(jobs.every((item) => item.job.state === 'failed' && item.job.error?.code === 'CONNECTOR_RESTARTED'), true);
});

test('identical retry after a successful publication resolves the original idempotency transaction', async (t) => {
  const fixture = await approvedWorkspace(t);
  const jobRequest = request('retry-after-success-1', { expectedRevision: fixture.revisionId, parameters: { type: 'scan' } });
  const created = await createJob(fixture.cwd, jobRequest);
  await fixture.backend.runJob(created.stored.job.jobId);
  assert.equal((await readJob(fixture.cwd, created.stored.job.jobId)).job.state, 'succeeded');
  const existing = await findIdempotentJob(fixture.cwd, jobRequest);
  assert.equal(existing.job.jobId, created.stored.job.jobId);
  const retried = await fixture.backend.createJob(jobRequest);
  assert.equal(retried.created, false);
  assert.equal(retried.job.jobId, created.stored.job.jobId);
});

test('queued cancellation is durable, idempotent, private, and rejects a conflicting cancellation key', async (t) => {
  const fixture = await approvedWorkspace(t);
  const created = await createJob(fixture.cwd, request('queued-cancel-job-1', { expectedRevision: fixture.revisionId }));
  const first = await fixture.backend.cancelJob(created.stored.job.jobId, { idempotencyKey: 'cancel-queued-private-canary-1' });
  assert.equal(first.state, 'cancelled');
  assert.equal(first.jobState, 'cancelled');
  assert.equal(first.idempotent, false);
  assert.equal(first.publicationPrevented, true);
  const repeated = await fixture.backend.cancelJob(created.stored.job.jobId, { idempotencyKey: 'cancel-queued-private-canary-1' });
  assert.equal(repeated.state, 'cancelled');
  assert.equal(repeated.idempotent, true);
  await assert.rejects(
    fixture.backend.cancelJob(created.stored.job.jobId, { idempotencyKey: 'cancel-queued-different-2' }),
    (error) => error?.code === 'JOB_CANCELLATION_IDEMPOTENCY_CONFLICT'
  );
  const corpus = readdirSync(path.join(fixture.cwd, '.skillmap', 'operational', 'jobs', 'cancellations'))
    .map((name) => readFileSync(path.join(fixture.cwd, '.skillmap', 'operational', 'jobs', 'cancellations', name), 'utf8')).join('\n');
  assert.equal(corpus.includes('cancel-queued-private-canary-1'), false);
  assert.match(first.cancellationDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await WorkspaceStateStore.open(fixture.cwd).readCurrent()).currentPointer.revisionId, fixture.revisionId);
});

test('running cancellation propagates AbortSignal and cannot publish after the accepted cancellation', async (t) => {
  const fixture = await approvedWorkspace(t);
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const backend = new SkillMapLocalBackend(fixture.cwd, {
    jobLifecycleHooks: {
      async beforePublication({ signal }) {
        enteredResolve();
        await new Promise((_resolve, reject) => {
          const abort = () => reject(new Error('cancelled before publication'));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
      }
    }
  });
  const created = await createJob(fixture.cwd, request('running-cancel-job-1', { expectedRevision: fixture.revisionId, parameters: { type: 'scan' } }));
  const running = backend.runJob(created.stored.job.jobId);
  await entered;
  const cancelled = await backend.cancelJob(created.stored.job.jobId, { idempotencyKey: 'cancel-running-1' });
  await running;
  assert.equal(cancelled.state, 'cancelled');
  const stored = await readJob(fixture.cwd, created.stored.job.jobId);
  assert.equal(stored.job.state, 'cancelled');
  assert.equal(stored.job.resultReceipt.publicationPrevented, true);
  assert.equal((await WorkspaceStateStore.open(fixture.cwd).readCurrent()).currentPointer.revisionId, fixture.revisionId);
});

test('publication wins an exact cancel race only when the revision already committed', async (t) => {
  const fixture = await approvedWorkspace(t);
  let publishedResolve;
  let releaseResolve;
  const published = new Promise((resolve) => { publishedResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const backend = new SkillMapLocalBackend(fixture.cwd, {
    jobLifecycleHooks: {
      async afterPublication() { publishedResolve(); await release; }
    }
  });
  const created = await createJob(fixture.cwd, request('publish-wins-cancel-race-1', { expectedRevision: fixture.revisionId, parameters: { type: 'scan' } }));
  const running = backend.runJob(created.stored.job.jobId);
  await published;
  await assert.rejects(
    backend.cancelJob(created.stored.job.jobId, { idempotencyKey: 'cancel-after-publication-1' }),
    (error) => error?.code === 'JOB_PUBLICATION_COMMITTED'
  );
  releaseResolve();
  await running;
  assert.equal((await readJob(fixture.cwd, created.stored.job.jobId)).job.state, 'succeeded');
  assert.notEqual((await WorkspaceStateStore.open(fixture.cwd).readCurrent()).currentPointer.revisionId, fixture.revisionId);
});

test('restart reconciliation turns durable queued and running cancellation requests into cancelled receipts', async (t) => {
  const fixture = await approvedWorkspace(t);
  const queued = await createJob(fixture.cwd, request('restart-cancel-queued-1', { expectedRevision: fixture.revisionId }));
  await requestJobCancellation(fixture.cwd, queued.stored.job.jobId, 'restart-cancel-key-queued');
  const running = await createJob(fixture.cwd, request('restart-cancel-running-1', { expectedRevision: fixture.revisionId }));
  await transitionJob(fixture.cwd, running.stored.job.jobId, 'running');
  await requestJobCancellation(fixture.cwd, running.stored.job.jobId, 'restart-cancel-key-running');
  await new SkillMapLocalBackend(fixture.cwd).resumeInterruptedJobs();
  assert.equal((await readJob(fixture.cwd, queued.stored.job.jobId)).job.state, 'cancelled');
  assert.equal((await readJob(fixture.cwd, running.stored.job.jobId)).job.state, 'cancelled');
  assert.equal((await WorkspaceStateStore.open(fixture.cwd).readCurrent()).currentPointer.revisionId, fixture.revisionId);
});

test('concurrent cancellation requests converge for one key and reject a different key', async (t) => {
  const fixture = await approvedWorkspace(t);
  const same = await createJob(fixture.cwd, request('concurrent-cancel-same-job-1', { expectedRevision: fixture.revisionId }));
  const sameResults = await Promise.all([
    fixture.backend.cancelJob(same.stored.job.jobId, { idempotencyKey: 'concurrent-cancel-same-key' }),
    fixture.backend.cancelJob(same.stored.job.jobId, { idempotencyKey: 'concurrent-cancel-same-key' })
  ]);
  assert.equal(sameResults.every((item) => ['cancelled', 'cancellation-requested'].includes(item.state)), true);
  assert.equal((await readJob(fixture.cwd, same.stored.job.jobId)).job.state, 'cancelled');

  const different = await createJob(fixture.cwd, request('concurrent-cancel-different-job-1', { expectedRevision: fixture.revisionId }));
  const differentResults = await Promise.allSettled([
    fixture.backend.cancelJob(different.stored.job.jobId, { idempotencyKey: 'concurrent-cancel-left' }),
    fixture.backend.cancelJob(different.stored.job.jobId, { idempotencyKey: 'concurrent-cancel-right' })
  ]);
  assert.equal(differentResults.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(differentResults.filter((item) => item.status === 'rejected' && item.reason?.code === 'JOB_CANCELLATION_IDEMPOTENCY_CONFLICT').length, 1);
});

test('job-ledger admission retains a hard bound, evicts terminal triples, and preserves all nonterminal jobs', async (t) => {
  const cwd = workspace(t, 'skillmap-job-ledger-retention-');
  const evicted = await createJob(cwd, request('ledger-terminal-000'));
  await requestJobCancellation(cwd, evicted.stored.job.jobId, 'ledger-terminal-cancel');
  await transitionJob(cwd, evicted.stored.job.jobId, 'cancelled', {
    resultReceipt: { publicationPrevented: true, cancelledFrom: 'queued' }
  });

  for (let index = 1; index < JOB_LEDGER_MAX_ENTRIES; index += 1) {
    await createJob(cwd, request(`ledger-queued-${String(index).padStart(3, '0')}`));
  }
  const jobsRoot = path.join(cwd, '.skillmap', 'operational', 'jobs');
  assert.equal(readdirSync(path.join(jobsRoot, 'idempotency')).length, JOB_LEDGER_MAX_ENTRIES);
  assert.equal(readdirSync(path.join(jobsRoot, 'records')).length, JOB_LEDGER_MAX_ENTRIES);
  assert.equal(readdirSync(path.join(jobsRoot, 'cancellations')).length, 1);

  await createJob(cwd, request('ledger-retention-trigger'));
  await assert.rejects(readJob(cwd, evicted.stored.job.jobId), /not found/);
  assert.equal(readdirSync(path.join(jobsRoot, 'idempotency')).length, JOB_LEDGER_MAX_ENTRIES);
  assert.equal(readdirSync(path.join(jobsRoot, 'records')).length, JOB_LEDGER_MAX_ENTRIES);
  assert.equal(readdirSync(path.join(jobsRoot, 'cancellations')).length, 0);
  assert.equal((await listAllJobs(cwd)).every((stored) => stored.job.state === 'queued'), true);

  const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_unused, index) =>
    createJob(cwd, request(`ledger-over-cap-${index}`))));
  assert.equal(attempts.every((item) => item.status === 'rejected'), true);
  assert.equal(attempts.every((item) => ['JOB_LEDGER_CAPACITY', 'JOB_LEDGER_BUSY'].includes(item.reason?.code)), true);
  assert.equal(readdirSync(path.join(jobsRoot, 'idempotency')).length, JOB_LEDGER_MAX_ENTRIES);
  assert.equal(readdirSync(path.join(jobsRoot, 'records')).length, JOB_LEDGER_MAX_ENTRIES);
});

test('job-ledger reads reject an over-cap directory before parsing attacker-controlled records', async (t) => {
  const cwd = workspace(t, 'skillmap-job-ledger-over-cap-');
  const anchors = path.join(cwd, '.skillmap', 'operational', 'jobs', 'idempotency');
  mkdirSync(anchors, { recursive: true });
  for (let index = 0; index <= JOB_LEDGER_MAX_ENTRIES; index += 1) {
    const name = index.toString(16).padStart(64, '0');
    writeFileSync(path.join(anchors, `${name}.json`), '{ attacker-controlled malformed json');
  }
  await assert.rejects(listAllJobs(cwd), (error) => /scan cap/.test(error?.message) && !/JSON/.test(error?.message));
});

test('job and cancellation idempotency keys are domain-hashed before disk or backend API exposure', async (t) => {
  const cwd = workspace(t, 'skillmap-job-key-privacy-');
  const rawJobKey = 'sk_live_JOB_IDEMPOTENCY_SECRET_CANARY';
  const rawCancellationKey = 'sk_live_CANCEL_IDEMPOTENCY_SECRET_CANARY';
  const created = await createJob(cwd, request(rawJobKey));
  await requestJobCancellation(cwd, created.stored.job.jobId, rawCancellationKey);
  assert.match(created.stored.job.idempotencyKey, /^sha256:[a-f0-9]{64}$/);
  assert.equal(created.stored.request.idempotencyKey, created.stored.job.idempotencyKey);

  const root = path.join(cwd, '.skillmap', 'operational', 'jobs');
  const corpus = ['idempotency', 'records', 'cancellations'].flatMap((directory) =>
    readdirSync(path.join(root, directory)).map((name) => readFileSync(path.join(root, directory, name), 'utf8'))).join('\n');
  assert.equal(corpus.includes(rawJobKey), false);
  assert.equal(corpus.includes(rawCancellationKey), false);

  const backend = new SkillMapLocalBackend(cwd);
  const shown = await backend.showJob(created.stored.job.jobId);
  const listed = await backend.listJobs();
  const exposed = JSON.stringify({ shown, listed });
  assert.equal(exposed.includes(rawJobKey), false);
  assert.equal(exposed.includes(rawCancellationKey), false);
});

test('job-ledger ancestors reject symlink escapes before reads, writes, cancellation, or claims', async (t) => {
  const parent = workspace(t, 'skillmap-job-symlink-boundary-');
  const cwd = path.join(parent, 'workspace');
  const outside = path.join(parent, 'outside');
  mkdirSync(path.join(cwd, '.skillmap', 'operational', 'jobs'), { recursive: true });
  mkdirSync(outside);
  const canary = path.join(outside, 'OUTSIDE-CANARY.txt');
  writeFileSync(canary, 'OUTSIDE_JOB_LEDGER_CANARY');

  symlinkSync(outside, path.join(cwd, '.skillmap', 'operational', 'jobs', 'records'), directoryLinkType());
  await assert.rejects(createJob(cwd, request('symlink-records-job-1')), /symbolic links/i);
  assert.deepEqual(readdirSync(outside), ['OUTSIDE-CANARY.txt']);
  rmSync(path.join(cwd, '.skillmap', 'operational', 'jobs', 'records'));

  const created = await createJob(cwd, request('symlink-cancellation-job-1'));
  symlinkSync(outside, path.join(cwd, '.skillmap', 'operational', 'jobs', 'cancellations'), directoryLinkType());
  await assert.rejects(requestJobCancellation(cwd, created.stored.job.jobId, 'symlink-cancellation-key-1'), /symbolic links/i);
  assert.deepEqual(readdirSync(outside), ['OUTSIDE-CANARY.txt']);
  rmSync(path.join(cwd, '.skillmap', 'operational', 'jobs', 'cancellations'));

  symlinkSync(outside, path.join(cwd, '.skillmap', 'operational', 'jobs', 'claims'), directoryLinkType());
  await assert.rejects(transitionJob(cwd, created.stored.job.jobId, 'running'), /symbolic links/i);
  assert.equal(readFileSync(canary, 'utf8'), 'OUTSIDE_JOB_LEDGER_CANARY');
  assert.deepEqual(readdirSync(outside), ['OUTSIDE-CANARY.txt']);
});

function directoryLinkType() {
  return process.platform === 'win32' ? 'junction' : 'dir';
}
