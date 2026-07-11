import assert from 'node:assert/strict';
import { request as nodeRequest } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyPolicyCommand } from '../dist/commands/apply-policy.js';
import { scanCommand } from '../dist/commands/scan.js';
import { createJob, readJob } from '../dist/core/jobs.js';
import { WorkspaceStateStore } from '../dist/core/workspace-state/index.js';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';
import { startLocalConnector } from '../dist/server/local-connector.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const REVISION = {
  workspaceId: WORKSPACE_ID,
  revisionId: 'r00000000000000000001-00000000-0000-4000-8000-000000000002',
  workspaceRevision: `sha256:${'a'.repeat(64)}`,
  effectiveDigest: `sha256:${'b'.repeat(64)}`,
  effectiveRevisionDigest: `sha256:${'c'.repeat(64)}`
};
const SKILL_ID = `sk_${'A'.repeat(43)}`;
const PRIVATE_PROMPT = 'PRIVATE-EVAL-PROMPT-CANARY perform focused work';
const PRIVATE_PATH = '/home/operator/private-evals.json';

test('backend exposes a revision-bound paginated v3 case trace without prompts or display-name labels', async t => {
  const fixture = await approvedWorkspace(t);
  const suite = {
    version: 2,
    provenance: {
      labelAuthor: 'local-reviewer',
      sourceClass: 'operator-authored',
      createdAt: '2026-07-01T00:00:00.000Z',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      deduplicationResult: 'passed',
      holdoutFrozen: true
    },
    baseline: { top1Rate: 0, top3Rate: 0, avoidHits: 0, abstentionRate: 0, meanAdvisoryBytes: 10_000 },
    evals: [
      { id: `${PRIVATE_PATH}#case-one`, prompt: PRIVATE_PROMPT, expected: ['alpha'], avoid: [], primaryCaseType: 'implicit-natural', membership: 'holdout' },
      { id: 'private-second-case', prompt: 'Prepare focused work without naming a tool.', expected: ['alpha'], avoid: [], primaryCaseType: 'implicit-natural', membership: 'train' }
    ]
  };
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'real-evals.json'), `${JSON.stringify(suite, null, 2)}\n`);
  const suitePublication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: fixture.revisionId,
    approveForRouting: true,
    actor: 'test:eval-suite-review',
    reason: 'Published the reviewed eval suite before executing it.'
  });
  const request = {
    kind: 'skillmap.job-request', schemaVersion: 1, expectedRevision: suitePublication.pointer.revisionId,
    idempotencyKey: 'eval-trace-workflow-1', requestedBy: 'api', confirmation: 'none', parameters: { type: 'eval-run' }
  };
  const created = await createJob(fixture.cwd, request);
  await fixture.backend.runJob(created.stored.job.jobId);
  const completed = await readJob(fixture.cwd, created.stored.job.jobId);
  assert.equal(completed.job.state, 'succeeded');
  const publishedState = await WorkspaceStateStore.open(fixture.cwd).readCurrent({ purpose: 'status' });
  const publication = { pointer: publishedState.currentPointer, manifest: publishedState.revision.manifest };
  const evalReportArtifact = publication.manifest.artifacts.find((artifact) => artifact.path === 'eval-report.json');
  assert.ok(evalReportArtifact, 'eval publication omitted its immutable report artifact');
  assert.equal(completed.job.resultReceipt.evalReportDigest, evalReportArtifact.digest);
  assert.equal(completed.job.resultReceipt.evalEffectiveRevisionDigest, publication.pointer.effectiveRevisionDigest);

  const first = await fixture.backend.evals({ limit: 1 });
  assert.equal(first.present, true);
  assert.equal(first.caseResultsSchemaVersion, 3);
  assert.equal(first.caseTraceState, 'available');
  assert.equal(first.caseResults.length, 1);
  assert.equal(first.caseResultsPagination.total, 2);
  assert.equal(first.caseResultsPagination.hasMore, true);
  assert.match(first.caseResultsPagination.nextCursor, /^[A-Za-z0-9_-]+$/);
  assert.equal(first.currentRun.jobId, created.stored.job.jobId);
  assert.equal(first.currentRun.state, 'succeeded');
  assert.equal(first.currentRun.expectedRevision, suitePublication.pointer.revisionId);
  assert.equal(first.currentRun.resultRevisionId, publication.pointer.revisionId);
  assert.equal(first.currentRun.resultWorkspaceRevision, publication.pointer.workspaceRevision);
  assert.equal(first.currentRun.reportRevision.revisionId, publication.pointer.revisionId);
  assert.equal(first.currentRun.reportBinding, 'result-revision');
  assert.equal(first.currentRun.reportArtifactDigest, evalReportArtifact.digest);
  assert.equal(first.currentRun.reportEffectiveRevisionDigest, publication.pointer.effectiveRevisionDigest);
  assert.deepEqual(first.currentRun.progress, { mode: 'determinate', completedCases: 2, totalCases: 2, ratio: 1 });
  assert.deepEqual(first.caseResults[0].expectedSkillIds, [fixture.skillId]);
  assert.deepEqual(first.caseResults[0].recommendedSkillIds, [fixture.skillId]);
  assert.equal(first.caseResults[0].outcome, 'top1-hit');
  assert.deepEqual(first.caseResults[0].reasonCodes, ['EXPECTED_TOP1']);
  assert.match(first.caseResults[0].caseId, /^evalcase_[A-Za-z0-9_-]{8,100}$/);
  assert.equal(first.caseResults[0].caseId.includes('case-one'), false);

  const second = await fixture.backend.evals({ limit: 1, cursor: first.caseResultsPagination.nextCursor });
  assert.equal(second.caseResults.length, 1);
  assert.notEqual(second.caseResults[0].caseId, first.caseResults[0].caseId);
  assert.equal(second.caseResultsPagination.hasMore, false);
  await assert.rejects(
    fixture.backend.evals({ limit: 1, cursor: `${first.caseResultsPagination.nextCursor}tampered` }),
    error => error?.code === 'EVAL_CURSOR_INVALID'
  );

  const serialized = JSON.stringify([first, second]);
  assert.equal(serialized.includes(PRIVATE_PROMPT), false);
  assert.equal(serialized.includes(PRIVATE_PATH), false);
  assert.equal(serialized.includes('private-second-case'), false);
  assert.equal(serialized.includes('"prompt"'), false);
  assert.equal(serialized.includes('"path"'), false);
  assert.equal(serialized.includes('"body"'), false);

  const carriedPublication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: publication.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:non-eval-review',
    reason: 'Published an unrelated revision while carrying the immutable eval report forward.'
  });
  const carried = await fixture.backend.evals({ limit: 2 });
  assert.notEqual(carried.revision.revisionId, publication.pointer.revisionId);
  assert.equal(carried.revision.revisionId, carriedPublication.pointer.revisionId);
  assert.equal(carried.caseTraceState, 'available');
  assert.equal(carried.currentRun.jobId, created.stored.job.jobId);
  assert.equal(carried.currentRun.resultRevisionId, publication.pointer.revisionId);
  assert.equal(carried.currentRun.resultWorkspaceRevision, publication.pointer.workspaceRevision);
  assert.equal(carried.currentRun.reportRevision.revisionId, carriedPublication.pointer.revisionId);
  assert.equal(carried.currentRun.reportBinding, 'carried-forward');
  assert.equal(carried.currentRun.reportAvailable, true);
  assert.equal(carried.currentRun.reportArtifactDigest, evalReportArtifact.digest);
  assert.equal(carried.currentRun.reportEffectiveRevisionDigest, carriedPublication.pointer.effectiveRevisionDigest);
  assert.deepEqual(carried.currentRun.progress, { mode: 'determinate', completedCases: 2, totalCases: 2, ratio: 1 });
  assert.equal(JSON.stringify(carried).includes(PRIVATE_PROMPT), false);
  assert.equal(JSON.stringify(carried).includes(PRIVATE_PATH), false);
});

test('backend projects prompt-free eval-run/v3 metrics and cases, then rejects the trace when routing semantics change', async t => {
  const fixture = await approvedWorkspace(t);
  const datasetDigest = `sha256:${'d'.repeat(64)}`;
  const suite = {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    suiteId: 'evalsuite_projection0001',
    datasetDigest,
    cases: [{ prompt: PRIVATE_PROMPT }],
    baseline: { provenance: { sourceKind: 'operator-declared-no-skillmap' } }
  };
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'real-evals.json'), `${JSON.stringify(suite, null, 2)}\n`);
  const suitePublication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: fixture.revisionId,
    approveForRouting: true,
    actor: 'test:v3-suite-projection',
    reason: 'Published the immutable companion suite before the v3 projection receipt.'
  });
  const caseResults = [
    {
      caseId: 'evalcase_projection0001', primaryCaseType: 'implicit-natural', membership: 'holdout', releaseCounted: true, releaseScored: true,
      expectedSkillIds: [fixture.skillId], avoidSkillIds: [], recommendedSkillIds: [fixture.skillId], avoidedButRecommendedSkillIds: [],
      top1Hit: true, top3Hit: true, abstained: false, advisoryBytes: 80, outcome: 'top1-hit', reasonCodes: ['EXPECTED_TOP1'],
      validationCodes: [], leakageCodes: []
    },
    {
      caseId: 'evalcase_projection0002', primaryCaseType: 'negative-near-miss', membership: 'train', releaseCounted: true, releaseScored: false,
      expectedSkillIds: [], avoidSkillIds: [fixture.skillId], recommendedSkillIds: [fixture.skillId], avoidedButRecommendedSkillIds: [fixture.skillId],
      top1Hit: false, top3Hit: false, abstained: false, advisoryBytes: 40, outcome: 'unsafe', reasonCodes: ['AVOID_TARGET_RECOMMENDED'],
      validationCodes: [], leakageCodes: []
    },
    {
      caseId: 'evalcase_projection0003', primaryCaseType: 'explicit', membership: 'train', releaseCounted: false, releaseScored: false,
      expectedSkillIds: [fixture.skillId], avoidSkillIds: [], qualifiedSkillId: fixture.skillId,
      recommendedSkillIds: [fixture.skillId], avoidedButRecommendedSkillIds: [], top1Hit: true, top3Hit: true, abstained: false,
      advisoryBytes: 80, outcome: 'top1-hit', reasonCodes: ['EXPECTED_TOP1'], validationCodes: [], leakageCodes: []
    }
  ];
  const report = {
    kind: 'skillmap.eval-run', schemaVersion: 3, runId: 'evalrun_projection0001', suiteId: suite.suiteId,
    workspaceId: suitePublication.pointer.workspaceId, revision: suitePublication.pointer, datasetDigest,
    startedAt: '2026-07-10T00:00:00.000Z', finishedAt: '2026-07-10T00:00:01.000Z', fixture: false,
    evidenceLevel: 'candidate', releaseEvidenceEligible: false, thresholdPass: false, pass: false,
    thresholds: { minCount: 150, minTop1: 0.8, minTop3: 0.92, maxAvoidHits: 0 },
    composition: { total: 3, explicit: 1, implicitNatural: 1, multiSkill: 0, negativeNearMiss: 1, untyped: 0, releaseCounted: 2, releaseScored: 1 },
    holdout: { count: 1, requiredCount: 1, ratio: 0.5, pass: true },
    leakage: { count: 0, pass: true, caseIds: [] },
    baseline: { top1Rate: 0, top3Rate: 0, avoidHits: 1, abstentionRate: 0, meanAdvisoryBytes: 80, provenance: { sourceKind: 'operator-declared-no-skillmap' } },
    baselineComparison: { provided: true, nonRegression: true, improvement: true, perfectBaseline: false, pass: true, improvements: ['top1Rate'], regressions: [] },
    metrics: { count: 3, top1: 1, top3: 1, avoidHits: 1, top1Rate: 1, top3Rate: 1, abstentionRate: 0, meanAdvisoryBytes: 60 },
    invalidCaseCount: 0, validationErrors: [], caseResults, redactionClassification: 'local-sensitive',
    payloadDigest: `sha256:${'e'.repeat(64)}`
  };
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'eval-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const reportPublication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: suitePublication.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:v3-report-projection',
    reason: 'Published the immutable prompt-free v3 eval report.'
  });

  const first = await fixture.backend.evals({ limit: 1 });
  assert.equal(first.present, true);
  assert.equal(first.count, 3);
  assert.equal(first.top1Rate, 1);
  assert.equal(first.top3Rate, 1);
  assert.equal(first.avoidHits, 1);
  assert.equal(first.effectiveRevisionDigest, suitePublication.pointer.effectiveRevisionDigest);
  assert.equal(first.caseTraceState, 'available');
  assert.equal(first.caseResults.length, 1);
  assert.equal(first.caseResultsPagination.total, 3);
  assert.equal(first.caseResultsPagination.hasMore, true);
  assert.equal(first.currentRun.runId, report.runId);
  assert.equal(first.currentRun.suiteId, report.suiteId);
  assert.equal(first.currentRun.reportBinding, 'report-only');
  assert.equal(first.currentRun.reportAvailable, true);
  assert.deepEqual(first.currentRun.progress, { mode: 'determinate', completedCases: 3, totalCases: 3, ratio: 1 });
  assert.deepEqual(first.caseResults[0], caseResults[0]);
  const second = await fixture.backend.evals({ limit: 1, cursor: first.caseResultsPagination.nextCursor });
  assert.deepEqual(second.caseResults[0], caseResults[1]);
  const third = await fixture.backend.evals({ limit: 1, cursor: second.caseResultsPagination.nextCursor });
  assert.deepEqual(third.caseResults[0], caseResults[2]);
  assert.equal(third.caseResults[0].qualifiedSkillId, fixture.skillId);
  assert.equal(JSON.stringify([first, second, third]).includes(PRIVATE_PROMPT), false);

  writeFileSync(path.join(fixture.cwd, '.skillmap', 'policy.yml'), 'version: 1\nskills:\n  alpha:\n    tier: specialist\n    preferred_for:\n      - focused work\n');
  await applyPolicyCommand(fixture.cwd, {});
  const stalePublication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: reportPublication.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:routing-semantics-change',
    reason: 'Changed the approved routing semantics while carrying the old report forward.'
  });
  const stale = await fixture.backend.evals({ limit: 2 });
  assert.equal(stale.caseTraceState, 'binding-mismatch');
  assert.deepEqual(stale.caseResults, []);
  assert.equal(stale.currentRun.reportAvailable, false);
  assert.equal(stale.currentRun.reportBinding, 'unavailable');

  writeFileSync(path.join(fixture.cwd, '.skillmap', 'policy.yml'), 'version: 1\nskills:\n  alpha:\n    tier: blocked\n');
  await applyPolicyCommand(fixture.cwd, {});
  const blockedPolicyPublication = await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: stalePublication.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:qualified-policy-block',
    reason: 'Blocked qualified explicit routing for the test skill.'
  });
  const blockedReport = {
    ...report,
    runId: 'evalrun_projectionblocked1',
    revision: blockedPolicyPublication.pointer,
    composition: { total: 1, explicit: 1, implicitNatural: 0, multiSkill: 0, negativeNearMiss: 0, untyped: 0, releaseCounted: 0, releaseScored: 0 },
    metrics: { count: 1, top1: 0, top3: 0, avoidHits: 0, top1Rate: 0, top3Rate: 0, abstentionRate: 0, meanAdvisoryBytes: 0 },
    caseResults: [caseResults[2]],
    payloadDigest: `sha256:${'f'.repeat(64)}`
  };
  writeFileSync(path.join(fixture.cwd, '.skillmap', 'eval-report.json'), `${JSON.stringify(blockedReport, null, 2)}\n`);
  await WorkspaceStateStore.open(fixture.cwd).publishLegacySnapshot({
    expectedRevisionId: blockedPolicyPublication.pointer.revisionId,
    approveForRouting: true,
    actor: 'test:blocked-qualified-report',
    reason: 'Published a report that claims a policy-blocked qualified skill.'
  });
  const blocked = await fixture.backend.evals({ limit: 2 });
  assert.equal(blocked.caseTraceState, 'invalid');
  assert.deepEqual(blocked.caseResults, []);
});

test('connector enforces eval query bounds and allowlists every run and case-result field', async t => {
  const calls = [];
  const backend = connectorBackend(async input => {
    calls.push(input);
    return maliciousEvalPayload(input.limit);
  });
  const connector = await startLocalConnector({ backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const response = await request(connector.origin, {
    pathname: '/api/v1/evals?limit=2&cursor=fixture_cursor',
    headers: { 'x-skillmap-capability': session.capability }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ cursor: 'fixture_cursor', limit: 2 }]);
  const data = JSON.parse(response.body).data;
  assert.equal(data.caseResults.length, 2, 'connector did not enforce the requested page size');
  assert.equal(data.caseResultsPagination.limit, 2);
  assert.equal(data.caseResultsPagination.total, 3);
  assert.equal(data.caseResultsSchemaVersion, 3);
  assert.deepEqual(Object.keys(data.currentRun).sort(), [
    'completedAt', 'createdAt', 'errorCode', 'expectedRevision', 'jobId', 'progress', 'reportArtifactDigest',
    'reportAvailable', 'reportBinding', 'reportEffectiveRevisionDigest', 'reportRevision', 'resultRevisionId',
    'resultWorkspaceRevision', 'runId', 'startedAt', 'state', 'suiteId'
  ]);
  assert.deepEqual(Object.keys(data.caseResults[0]).sort(), [
    'abstained', 'advisoryBytes', 'avoidSkillIds', 'avoidedButRecommendedSkillIds', 'caseId', 'expectedSkillIds', 'leakageCodes',
    'membership', 'outcome', 'primaryCaseType', 'qualifiedSkillId', 'reasonCodes', 'recommendedSkillIds', 'releaseCounted',
    'releaseScored', 'top1Hit', 'top3Hit', 'validationCodes'
  ]);
  assert.equal(data.evidenceIssues.includes('EVAL_HOLDOUT_INCOMPLETE'), true);
  assert.equal(data.evidenceIssues.includes(PRIVATE_PATH), false);
  const serialized = JSON.stringify(data);
  for (const canary of [PRIVATE_PROMPT, PRIVATE_PATH, 'private free text', '"prompt"', '"path"', '"body"']) assert.equal(serialized.includes(canary), false, canary);

  const unknown = await request(connector.origin, { pathname: '/api/v1/evals?outputPath=private', headers: { 'x-skillmap-capability': session.capability } });
  assert.equal(unknown.status, 400);
  assert.equal(JSON.parse(unknown.body).error.code, 'QUERY_INVALID');
  const oversized = await request(connector.origin, { pathname: '/api/v1/evals?limit=101', headers: { 'x-skillmap-capability': session.capability } });
  assert.equal(oversized.status, 400);
  assert.equal(JSON.parse(oversized.body).error.code, 'LIMIT_INVALID');
  assert.equal(calls.length, 1);
});

test('eval view source renders run progress, bounded per-case traces, pagination, and explicit empty/error states', () => {
  const source = readFileSync(path.join(repo, 'assets', 'local-app', 'v1', 'modules', 'views', 'evals.js'), 'utf8');
  const v3State = readFileSync(path.join(repo, 'assets', 'local-app', 'v1', 'modules', 'eval-v3-review-state.js'), 'utf8');
  const css = readFileSync(path.join(repo, 'assets', 'local-app', 'v1', 'app.css'), 'utf8');
  assert.match(source, /api\(`\/api\/v1\/evals\?limit=\$\{EVAL_CASE_PAGE_SIZE\}`/);
  assert.match(source, /eval-run\/v3/);
  assert.match(source, /Expected skill IDs/);
  assert.match(source, /Actual skill IDs/);
  assert.match(source, /Outcome and reason codes/);
  assert.match(source, /No eval run receipt/);
  assert.match(source, /No revisioned case trace yet/);
  assert.match(source, /Case trace unavailable/);
  assert.match(source, /carried forward unchanged/);
  assert.match(source, /Evidence binding/);
  assert.match(source, /eval-trace-next/);
  assert.match(source, /Only eval-suite\/v3 can become release authority/);
  assert.match(source, /Legacy v2 migration review/);
  assert.match(source, /Import exact v3 suite/);
  assert.match(source, /finalizeEvalSuiteV3Snapshot/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.match(v3State, /MAX_FILE_BYTES = 500 \* 1024/);
  assert.match(v3State, /canonicalPayloadJson/);
  assert.match(v3State, /cryptoApi\.subtle\.digest\('SHA-256'/);
  assert.match(v3State, /legacyV2MigrationPreview/);
  assert.match(css, /\.eval-runtime-grid/);
  assert.match(css, /\.eval-trace-detail/);
  assert.match(css, /\.eval-v3-form-grid/);
  assert.match(css, /\.eval-v3-provenance-strip/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.eval-trace-pagination/);
});

async function approvedWorkspace(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-eval-workflow-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, 'skills');
  mkdirSync(path.join(root, 'alpha'), { recursive: true });
  writeFileSync(path.join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for focused alpha work.\n---\n# Alpha\n');
  const backend = new SkillMapLocalBackend(cwd);
  const validation = await backend.validateRoot({ candidate: root });
  const initialized = await backend.approveRoot({ validationId: validation.validationId, expectedRevision: null });
  await scanCommand(cwd, {});
  const scanned = await WorkspaceStateStore.open(cwd).publishLegacySnapshot({ expectedRevisionId: initialized.revision.revisionId, approveForRouting: false });
  writeFileSync(path.join(cwd, '.skillmap', 'policy.yml'), 'version: 1\nskills:\n  alpha:\n    tier: active-default\n    preferred_for:\n      - focused work\n');
  await applyPolicyCommand(cwd, {});
  const approved = await WorkspaceStateStore.open(cwd).publishLegacySnapshot({ expectedRevisionId: scanned.pointer.revisionId, approveForRouting: true });
  const skills = await backend.listSkills({ limit: 20 });
  return { cwd, backend, revisionId: approved.pointer.revisionId, skillId: skills.items[0].skillId };
}

function connectorBackend(evals) {
  return {
    async revisionContext() { return { servingRevision: REVISION, currentRevision: REVISION, compatibility: 'compatible', etag: '"eval-fixture"' }; },
    async health() { return { status: 'ok' }; },
    async bootstrap() { return { initialized: true }; },
    async workspace() { return { workspaceId: WORKSPACE_ID }; },
    async dashboard() { return {}; },
    async listSkills() { return { items: [] }; },
    async showSkill() { return {}; },
    async previewRoute() { throw new Error('unused'); },
    async recordFeedback() { throw new Error('unused'); },
    async listRoutes() { return { events: [] }; },
    async showRoute() { throw new Error('unused'); },
    async policyReviews() { return { items: [] }; },
    async sources() { return { items: [] }; },
    evals,
    async createJob() { throw new Error('unused'); },
    async showJob() { throw new Error('unused'); }
  };
}

function maliciousEvalPayload(limit) {
  const run = {
    runId: 'evalrun_fixture0001', suiteId: 'evalsuite_fixture0001', jobId: '11111111-1111-4111-8111-111111111111', state: 'succeeded',
    expectedRevision: REVISION.revisionId, resultRevisionId: REVISION.revisionId, resultWorkspaceRevision: REVISION.workspaceRevision,
    reportRevision: REVISION, reportBinding: 'result-revision', reportArtifactDigest: `sha256:${'e'.repeat(64)}`,
    reportEffectiveRevisionDigest: REVISION.effectiveRevisionDigest,
    createdAt: '2026-07-10T00:00:00.000Z', startedAt: '2026-07-10T00:00:01.000Z', completedAt: '2026-07-10T00:00:02.000Z',
    errorCode: null, progress: { mode: 'determinate', completedCases: 3, totalCases: 3, ratio: 1 }, reportAvailable: true,
    prompt: PRIVATE_PROMPT, path: PRIVATE_PATH
  };
  return {
    present: true, evidenceLevel: 'candidate', releaseEvidenceEligible: false, pass: false,
    datasetDigest: `sha256:${'d'.repeat(64)}`, effectiveRevisionDigest: REVISION.effectiveRevisionDigest,
    composition: { total: 3, privateText: 'private free text' }, holdout: { count: 1, pass: false }, leakage: { count: 0, pass: true },
    baselineComparison: { provided: true, pass: false }, count: 3, top1Rate: 1, top3Rate: 1, avoidHits: 0,
    evidenceIssues: ['EVAL_HOLDOUT_INCOMPLETE', PRIVATE_PATH], revision: REVISION, currentRun: run,
    recentRuns: Array.from({ length: 20 }, () => run), caseResultsSchemaVersion: 3,
    caseResults: Array.from({ length: Math.max(3, limit + 1) }, (_unused, index) => caseResult(index)),
    caseResultsPagination: { total: 3, limit: 999, hasMore: true, nextCursor: 'NEXT_CURSOR', privateText: PRIVATE_PROMPT },
    caseTraceState: 'available', promptStored: true, prompt: PRIVATE_PROMPT, path: PRIVATE_PATH, body: 'private free text'
  };
}

function caseResult(index) {
  return {
    caseId: `evalcase_fixture000${index}`,
    primaryCaseType: 'implicit-natural', membership: 'train', releaseCounted: true, releaseScored: true,
    expectedSkillIds: [SKILL_ID], avoidSkillIds: [], qualifiedSkillId: SKILL_ID, recommendedSkillIds: [SKILL_ID], avoidedButRecommendedSkillIds: [],
    top1Hit: true, top3Hit: true, abstained: false, advisoryBytes: 80, outcome: 'top1-hit', reasonCodes: ['EXPECTED_TOP1'], validationCodes: [], leakageCodes: [],
    prompt: PRIVATE_PROMPT, path: PRIVATE_PATH, body: 'private free text'
  };
}

async function exchangeBootstrap(connector) {
  const bootstrap = new URL(connector.bootstrapUrl);
  const exchanged = await request(connector.origin, { pathname: `${bootstrap.pathname}${bootstrap.search}` });
  assert.equal(exchanged.status, 303);
  const redirect = new URL(exchanged.headers.location, connector.origin);
  const fragment = new URLSearchParams(redirect.hash.slice(1));
  const capability = fragment.get('skillmap-capability');
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
  return { capability };
}

function request(origin, { pathname = '/', headers = {} } = {}) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = nodeRequest({ hostname: target.hostname, port: Number(target.port), path: pathname, headers: { connection: 'close', ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
  });
}
