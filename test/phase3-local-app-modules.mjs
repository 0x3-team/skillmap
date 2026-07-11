import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertApiEnvelope, assertConnectorCompatibility, assertEndpointPayload, EXPECTED_CONNECTOR_COMPATIBILITY } from '../assets/local-app/v1/modules/api.js';
import { createEvalReviewState, disposeEvalReviewState, parseEvalReviewSuite, summarizeEvalReview, updateEvalReviewCase } from '../assets/local-app/v1/modules/eval-review-state.js';
import {
  createEvalV3ReviewState,
  disposeEvalV3ReviewState,
  finalizeEvalSuiteV3Snapshot,
  legacyV2MigrationPreview,
  migrateEvalSuiteV2ToV3,
  parseEvalSuiteV3,
  refreshEvalSuiteV3Digests,
  summarizeEvalV3Review
} from '../assets/local-app/v1/modules/eval-v3-review-state.js';
import { filterAndSortSkills, parseSkillView, savedSkillViewProjection, skillViewToQuery } from '../assets/local-app/v1/modules/skill-view-state.js';
import { clearPersistedSnapshots, hasPrivateMetadata, recallSnapshot, rememberSnapshot } from '../assets/local-app/v1/modules/state.js';
import { parseLocation, routePath } from '../assets/local-app/v1/modules/router.js';
import { renderJobList } from '../assets/local-app/v1/modules/views/activity.js';
import { renderRouteResult } from '../assets/local-app/v1/modules/views/route-lab.js';
import { parseEvalSuite } from '../dist/services/eval-use-case.js';
import { mcpCommand } from '../dist/commands/mcp.js';
import {
  computeEvalSuiteV3CaseSetDigest,
  computeEvalSuiteV3DatasetDigest,
  computePayloadDigest,
  validateContract
} from '../dist/contracts/validate.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(repo, 'assets', 'local-app', 'v1');
const API_REQUEST_ID = '00000000-0000-4000-8000-000000000009';
const API_REVISION = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  revisionId: 'r00000000000000000001-00000000-0000-4000-8000-000000000002',
  workspaceRevision: `sha256:${'a'.repeat(64)}`,
  effectiveDigest: `sha256:${'b'.repeat(64)}`,
  effectiveRevisionDigest: `sha256:${'c'.repeat(64)}`
};

test('local app is a native ES module graph with contained resolvable imports', () => {
  const files = filesUnder(assets).filter(file => file.endsWith('.js'));
  assert.ok(files.length >= 16, 'feature views were not decomposed into a meaningful module graph');
  for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { cwd: tmpdir(), stdio: 'pipe' });
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      assert.ok(target.startsWith(`${assets}${path.sep}`), `${file} imports outside the immutable asset root`);
      assert.equal(statSync(target).isFile(), true, `${file} import is missing: ${match[1]}`);
    }
  }
  const html = readFileSync(path.join(assets, 'index.html'), 'utf8');
  assert.match(html, /<script src="\/app\.js" type="module"><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/, 'inline executable scripts violate the connector CSP');
  assert.ok(readFileSync(path.join(assets, 'app.js'), 'utf8').split('\n').length <= 8, 'entrypoint regressed into a monolith');
});

test('skill list URL state is bounded, round-trippable, and filters deterministically', () => {
  const parameters = new URLSearchParams('q=alpha&tier=specialist&eligibility=eligible&scripts=yes&variant=noncanonical&sort=revision&direction=desc&columns=tier,scope,eligibility&view=custom');
  const view = parseSkillView(parameters);
  assert.equal(view.q, 'alpha');
  assert.deepEqual(view.columns, ['tier', 'scope', 'eligibility']);
  assert.deepEqual(parseSkillView(skillViewToQuery(view)), view);
  assert.equal(Object.hasOwn(savedSkillViewProjection(view), 'q'), false, 'private search text must not enter localStorage preferences');

  const skills = [
    { skillId: 'sk_b', displayName: 'Alpha', description: 'first', tier: 'specialist', routeEligible: true, hasScripts: true, variantState: 'candidate', contentRevision: 'sha256:b' },
    { skillId: 'sk_a', displayName: 'Alpha', description: 'second', tier: 'specialist', routeEligible: true, hasScripts: true, variantState: 'canonical', contentRevision: 'sha256:a' },
    { skillId: 'sk_c', displayName: 'Beta', description: 'third', tier: 'active-default', routeEligible: true, hasScripts: false, variantState: 'canonical', contentRevision: 'sha256:c' }
  ];
  assert.deepEqual(filterAndSortSkills(skills, view).map(item => item.skillId), ['sk_b']);
  const bounded = parseSkillView(new URLSearchParams(`q=${encodeURIComponent('x'.repeat(500))}`));
  assert.equal([...bounded.q].length, 160);
});

test('skill detail renders only bounded source, policy, and prompt-free route context', () => {
  const source = readFileSync(path.join(assets, 'modules', 'views', 'skills.js'), 'utf8');
  for (const heading of ['Source context', 'Policy context', 'Recent route history']) assert.match(source, new RegExp(heading));
  assert.match(source, /skill\.sourceContext/);
  assert.match(source, /skill\.policyContext/);
  assert.match(source, /skill\.routeHistory/);
  assert.match(source, /items\.slice\(0, 10\)/);
  assert.match(source, /ctx\.tracePermalink\(item\.routeId\)/);
  assert.match(source, /Raw prompts are never returned/);
  assert.doesNotMatch(source, /source\.(?:path|repo|ref)|policy\.(?:notes|reason)|item\.prompt\b/);
});

test('trace detail paths are workspace-owned, validated, and round-trippable', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const traceId = '11111111-1111-4111-8111-111111111111';
  const pathname = routePath('traces', workspaceId, { traceId });
  assert.equal(pathname, `/app/${workspaceId}/traces/${traceId}`);
  assert.deepEqual(parseLocation(pathname), { route: 'traces', skillId: null, traceId });
  assert.deepEqual(parseLocation(`/app/${workspaceId}/traces/not-a-route-id`), { route: 'traces', skillId: null, traceId: null });
  assert.equal(routePath('traces', workspaceId, { traceId: '../escape' }), `/app/${workspaceId}/traces`);
});

test('browser persistence guard rejects paths and private request fields', () => {
  assert.equal(hasPrivateMetadata({ workspaceId: '00000000-0000-4000-8000-000000000001', readiness: { reasonCode: 'ready' } }), false);
  assert.equal(hasPrivateMetadata({ configuredPath: '/private/skills' }), true);
  assert.equal(hasPrivateMetadata({ warning: 'Inspect /Users/operator/private' }), true);
  assert.equal(hasPrivateMetadata({ prompt: 'private task' }), true);
  assert.equal(hasPrivateMetadata({ promptText: 'private task alias' }), true);
  assert.equal(hasPrivateMetadata({ evidence: { promptPreview: 'private task alias' } }), true);
  assert.equal(hasPrivateMetadata({ nested: { hookText: 'secret' } }), true);
});

test('browser snapshots are schema-bound, compatibility-bound, revalidated, and evicted fail-closed', () => {
  const values = new Map();
  const previous = globalThis.sessionStorage;
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, String(value)); },
      removeItem: key => { values.delete(key); }
    }
  });
  const validateWorkspace = value => {
    if (!value || value.workspaceId !== API_REVISION.workspaceId || value.name !== 'Fixture workspace') throw new Error('invalid');
  };
  const workspace = { workspaceId: API_REVISION.workspaceId, name: 'Fixture workspace' };
  try {
    assert.equal(rememberSnapshot('workspace', workspace, EXPECTED_CONNECTOR_COMPATIBILITY, validateWorkspace), true);
    const stored = JSON.parse(values.get('skillmap:workspace'));
    assert.deepEqual(Object.keys(stored).sort(), ['compatibility', 'data', 'key', 'kind', 'schemaVersion']);
    assert.equal(stored.kind, 'skillmap.safe-snapshot');
    assert.deepEqual(recallSnapshot('workspace', EXPECTED_CONNECTOR_COMPATIBILITY, validateWorkspace), workspace);

    assert.equal(recallSnapshot('workspace', { ...EXPECTED_CONNECTOR_COMPATIBILITY, localAppAssetVersion: 'v2' }, validateWorkspace), null);
    assert.equal(values.has('skillmap:workspace'), false, 'incompatible snapshot was not evicted');
    assert.equal(rememberSnapshot('dashboard', { ...workspace, evidence: { promptPreview: 'PRIVATE-PROMPT-CANARY' } }, EXPECTED_CONNECTOR_COMPATIBILITY, () => {}), false);
    assert.equal(values.has('skillmap:dashboard'), false, 'private snapshot was persisted');
    clearPersistedSnapshots();
    assert.equal(values.size, 0);
  } finally {
    if (previous === undefined) delete globalThis.sessionStorage;
    else Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: previous });
  }
});

test('API envelope and connector versions fail closed on any unsupported shape', () => {
  const job = {
    kind: 'skillmap.job', schemaVersion: 1, jobId: '00000000-0000-4000-8000-000000000010', type: 'scan', state: 'queued',
    expectedRevision: API_REVISION.revisionId, idempotencyKey: `sha256:${'d'.repeat(64)}`, requestDigest: `sha256:${'e'.repeat(64)}`,
    confirmation: 'none', createdAt: '2026-07-10T12:00:00.000Z'
  };
  const freshness = {
    state: 'clean', filesystemDirty: false, reasonCode: null, observedAt: null, lastVerifiedAt: '2026-07-10T12:00:00.000Z',
    observedDigest: `sha256:${'f'.repeat(64)}`, expectedDigest: `sha256:${'f'.repeat(64)}`, rootIds: [], suggestedJobType: null
  };
  const dashboard = {
    workspace: { workspaceId: API_REVISION.workspaceId, name: 'Fixture workspace' }, revision: API_REVISION, currentRevision: API_REVISION,
    servingMode: 'current', routingReady: true, filesystemDirty: false, filesystemFreshness: freshness,
    readiness: { verdict: 'ok', phase: 'ready', warnings: [], nextActions: [] },
    counts: { skills: 1, routeEligible: 1, sourceTracked: 1, evalCases: 0 },
    evidence: {
      inventorySkills: 1, observedRoutes: 0, evalConfidence: 'demo', releaseEvidenceEligible: false, tokenMetricsSource: 'not-measured',
      doctorPresent: true, doctorPackPresent: true, curationPresent: true, curationStale: false
    }
  };
  const rootId = '00000000-0000-4000-8000-000000000020';
  const workspace = {
    workspaceId: API_REVISION.workspaceId,
    name: 'Fixture workspace',
    readiness: dashboard.readiness,
    revision: API_REVISION,
    currentRevision: API_REVISION,
    servingMode: 'current',
    routingReady: true,
    filesystemDirty: false,
    filesystemFreshness: freshness,
    roots: [{ rootId, label: 'Fixture root', approvedAt: '2026-07-10T12:00:00.000Z' }]
  };
  const success = {
    kind: 'skillmap.api-response', schemaVersion: 1, ok: true, requestId: API_REQUEST_ID,
    servingRevision: API_REVISION, currentRevision: API_REVISION, compatibility: 'compatible', data: { items: [] }
  };
  const failure = {
    kind: 'skillmap.api-response', schemaVersion: 1, ok: false, requestId: API_REQUEST_ID,
    servingRevision: API_REVISION, currentRevision: API_REVISION, compatibility: 'degraded',
    error: { code: 'REVISION_CHANGED_RETRY', message: 'The workspace changed.', retryable: true }
  };
  const successWithoutData = { ...success };
  delete successWithoutData.data;
  for (const compatibility of ['compatible', 'degraded', 'upgrade-required', 'client-too-new', 'incompatible']) {
    assert.doesNotThrow(() => assertApiEnvelope({ ...success, compatibility }));
  }
  assert.doesNotThrow(() => assertApiEnvelope(failure));
  assert.doesNotThrow(() => assertConnectorCompatibility(EXPECTED_CONNECTOR_COMPATIBILITY));
  for (const invalid of [
    { ...success, schemaVersion: 2 },
    { ...success, compatibility: 'unknown' },
    { ...success, requestId: 'not-a-request-id' },
    successWithoutData,
    { ...success, error: failure.error },
    { ...failure, error: undefined },
    { ...failure, data: {} }
  ]) assert.throws(() => assertApiEnvelope(invalid), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  const approvedBootstrap = { state: 'ready', initialized: true, routingReady: true, productReady: false, nextAction: 'route', readiness: { verdict: 'blocked', phase: 'needs-eval' }, connectorCompatibility: EXPECTED_CONNECTOR_COMPATIBILITY };
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/bootstrap', approvedBootstrap));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/bootstrap', { ...approvedBootstrap, productReady: true, readiness: { verdict: 'ok', phase: 'ready' } }));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/skills', { items: [], nextCursor: null, hasMore: false, limit: 100 }));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/jobs', { items: [], total: 0 }, 'GET'));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/jobs', { job, created: true }, 'POST'));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/dashboard', dashboard));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/workspace', workspace));
  const inactiveFreshness = { state: 'inactive', filesystemDirty: false, reasonCode: null, observedAt: null, lastVerifiedAt: null, observedDigest: null, expectedDigest: null, rootIds: [], suggestedJobType: null };
  const unavailableFreshness = { ...inactiveFreshness, state: 'unavailable', reasonCode: 'workspace-uninitialized', lastVerifiedAt: '2026-07-10T12:00:00.000Z' };
  const pendingFreshness = { ...inactiveFreshness, state: 'dirty', filesystemDirty: true, reasonCode: 'verification-pending', observedAt: '2026-07-10T12:00:00.000Z', suggestedJobType: 'scan' };
  const dirtyFreshness = { ...pendingFreshness, reasonCode: 'manifest-mismatch', lastVerifiedAt: '2026-07-10T12:00:00.000Z', observedDigest: `sha256:${'7'.repeat(64)}`, expectedDigest: `sha256:${'8'.repeat(64)}`, rootIds: [rootId] };
  for (const filesystemFreshness of [inactiveFreshness, unavailableFreshness, pendingFreshness, dirtyFreshness]) {
    assert.doesNotThrow(() => assertEndpointPayload('/api/v1/dashboard', { ...dashboard, filesystemDirty: filesystemFreshness.filesystemDirty, filesystemFreshness }));
  }
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/state/recover', { state: 'recovered', recovered: true, revision: API_REVISION, warningCount: 0 }, 'POST'));
  const policyDecision = { state: 'recorded', decisionDigest: `sha256:${'1'.repeat(64)}`, revision: API_REVISION, routingApprovalRequired: true, tier: 'specialist' };
  const policyReview = {
    reviewId: 'pr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', queue: 'uncovered', action: 'set-skill-policy', state: 'needs-review',
    blocking: true, displayName: 'Fixture review', skillIds: [`sk_${'A'.repeat(43)}`], contentRevisions: [`sha256:${'2'.repeat(64)}`],
    queueFingerprint: `sha256:${'3'.repeat(64)}`
  };
  const policyProposal = {
    state: 'proposed', proposalId: '00000000-0000-4000-8000-000000000021', proposalDigest: `sha256:${'4'.repeat(64)}`,
    reviewId: policyReview.reviewId, queue: 'uncovered', action: 'set-skill-policy', expectedRevision: API_REVISION.revisionId,
    expiresAt: '2026-07-10T13:00:00.000Z', decisionOptions: ['accept', 'hold', 'reject'], wouldPublish: false
  };
  const sourceReview = { state: 'recorded', skillId: `sk_${'A'.repeat(43)}`, decision: 'hold', revision: API_REVISION, routingApprovalRequired: true };
  const rootApproval = { state: 'approved', approved: true, alreadyApproved: false, rootId: '00000000-0000-4000-8000-000000000020', revision: API_REVISION, routingApprovalRequired: true };
  const partialLegacy = { state: 'adopted', adopted: true, revision: API_REVISION, routingApprovalRequired: true };
  const sources = { coverage: 'not-configured', inventorySkills: 1, trackedSkills: 0, items: [], untrackedItems: [], untrackedTotal: 0, untrackedTruncated: false, revision: API_REVISION };
  const hookVerification = { host: 'codex', action: 'dry-run', readiness: { verdict: 'ok', phase: 'ready', allowed: true, routingReady: true }, hookText: '', promptStored: false, installPerformed: false };
  const routeFeedback = {
    kind: 'skillmap.route-feedback', schemaVersion: 1, feedbackId: '00000000-0000-4000-8000-000000000022', routeId: '00000000-0000-4000-8000-000000000023',
    createdAt: '2026-07-10T12:00:00.000Z', revision: API_REVISION, outcome: 'correct', selectedSkillIds: [], expectedSkillIds: [], unsafeSkillIds: [],
    reasonCode: 'operator-correct', idempotencyKeyHash: `sha256:${'5'.repeat(64)}`, promptStored: false, commentStored: false, payloadDigest: `sha256:${'6'.repeat(64)}`
  };
  const routeResult = {
    kind: 'skillmap.route-result', schemaVersion: 2, routeId: routeFeedback.routeId, createdAt: '2026-07-10T12:00:00.000Z', promptStored: false,
    decision: {
      kind: 'skillmap.route-decision', schemaVersion: 2, revision: API_REVISION, servingMode: 'current',
      recommendations: [{ skillId: `sk_${'A'.repeat(43)}`, displayName: 'Fixture skill', score: 1, tier: 'specialist', reasonCodes: ['description-match'] }],
      exclusions: [], hookText: '', warningState: 'none', warningCodes: []
    },
    decisionDigest: `sha256:${'7'.repeat(64)}`, latencyMs: 1
  };
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/health', { status: 'ok', process: 'skillmap-dashboard', version: '0.1.0', compatibility: 'compatible' }));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/policy/decisions', policyDecision, 'POST'));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/policy/reviews', { items: [policyReview], actionable: 1, blocking: 1, policyVersion: 2, revision: API_REVISION }));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/policy/proposals', policyProposal, 'POST'));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/sources/reviews', sourceReview, 'POST'));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/roots/approve', rootApproval, 'POST'));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/state/adopt-partial-legacy', partialLegacy, 'POST'));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/sources', sources));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/integrations/hook/verify', hookVerification, 'POST'));
  assert.doesNotThrow(() => assertEndpointPayload(`/api/v1/routes/${routeFeedback.routeId}/feedback`, routeFeedback, 'POST'));
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/routes/preview', routeResult, 'POST'));
  assert.throws(() => assertEndpointPayload('/api/v1/bootstrap', { initialized: true }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/bootstrap', { state: 'uninitialized', initialized: false, routingReady: true, productReady: true, nextAction: 'route', connectorCompatibility: EXPECTED_CONNECTOR_COMPATIBILITY }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/bootstrap', { ...approvedBootstrap, productReady: true }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/bootstrap', { ...approvedBootstrap, state: 'attention-required' }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/skills', { items: {} }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/jobs', { items: [] }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/jobs', { job: {} }, 'GET'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/dashboard', { counts: {}, readiness: {}, promptText: 'PRIVATE-PROMPT-CANARY' }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/dashboard', { ...dashboard, evidence: { ...dashboard.evidence, promptPreview: 'PRIVATE-PROMPT-CANARY' } }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/jobs', { job: { ...job, promptText: 'PRIVATE-PROMPT-CANARY' }, created: 'yes' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/skills', { items: [{ promptPreview: 'PRIVATE-PROMPT-CANARY' }], nextCursor: 1, hasMore: 'yes', limit: '100' }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/state/recover', { state: [], recovered: 'yes', revision: { promptPreview: 'PRIVATE-PROMPT-CANARY' }, warningCount: -1 }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/policy/reviews', { items: [{ safeUnexpected: 'x' }], actionable: 0, blocking: 0 }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/evals', {
    present: false, releaseEvidenceEligible: false, pass: false, evidenceIssues: [], revision: API_REVISION,
    currentRun: { safeUnexpected: 'x' }, recentRuns: [], caseResults: [], caseResultsPagination: { safeUnexpected: 'x' },
    caseTraceState: 'unavailable', promptStored: false
  }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/workspaces/validate', { state: 'validated', validationId: {}, mode: [], label: 4, expiresInSeconds: 300, confirmationRequired: true }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/integrations/mcp', { version: 2, readOnly: true, tools: [{ safeUnexpected: 'x' }], limits: {}, verifiedLocally: true }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/integrations/hook/verify', { host: 'codex', action: 'dry-run', readiness: { safeUnexpected: 'x' }, hookText: '', promptStored: false, installPerformed: false }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/integrations/hook/verify', { ...hookVerification, readiness: { verdict: 'blocked', phase: 'needs-eval', allowed: true, routingReady: true } }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/health', { status: 'ok', process: 'skillmap-dashboard', version: '0.1.0', compatibility: 'future-mode' }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/policy/decisions', { ...policyDecision, state: 'nonsense' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/policy/decisions', { ...policyDecision, tier: 'future-tier' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/sources/reviews', { ...sourceReview, state: 'nonsense' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/roots/approve', { ...rootApproval, state: 'nonsense', rootId: 'not-a-root-uuid' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/state/adopt-partial-legacy', { ...partialLegacy, state: 'nonsense' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/sources', { ...sources, coverage: 'future' }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload(`/api/v1/routes/${routeFeedback.routeId}/feedback`, { ...routeFeedback, reasonCode: 'operator-wrong' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  for (const decision of [
    { ...routeResult.decision, recommendations: [{ ...routeResult.decision.recommendations[0], reasonCodes: ['<img-src=x-onerror=alert(1)>'] }] },
    { ...routeResult.decision, warningCodes: ['<svg-onload=alert(1)>'] }
  ]) assert.throws(() => assertEndpointPayload('/api/v1/routes/preview', { ...routeResult, decision }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/workspace', { ...workspace, roots: [{ ...workspace.roots[0], rootId: 'not-a-root-uuid' }] }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/workspace', { ...workspace, filesystemFreshness: { ...workspace.filesystemFreshness, rootIds: ['not-a-root-uuid'] } }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  for (const filesystemFreshness of [
    { ...freshness, filesystemDirty: true }, { ...freshness, reasonCode: 'watch-event' }, { ...freshness, observedAt: '2026-07-10T12:00:00.000Z' },
    { ...freshness, lastVerifiedAt: null }, { ...freshness, expectedDigest: `sha256:${'8'.repeat(64)}` }, { ...freshness, rootIds: [rootId] }, { ...freshness, suggestedJobType: 'scan' },
    { ...dirtyFreshness, filesystemDirty: false }, { ...dirtyFreshness, reasonCode: null }, { ...dirtyFreshness, observedAt: null }, { ...dirtyFreshness, lastVerifiedAt: null },
    { ...dirtyFreshness, observedDigest: null }, { ...dirtyFreshness, rootIds: [] }, { ...dirtyFreshness, suggestedJobType: null }
  ]) assert.throws(() => assertEndpointPayload('/api/v1/dashboard', { ...dashboard, filesystemDirty: true, filesystemFreshness }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/dashboard', { ...dashboard, filesystemDirty: false, filesystemFreshness: dirtyFreshness }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/policy/reviews', { items: [{ ...policyReview, reviewId: 'not a machine code' }], actionable: 1, blocking: 1 }), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/policy/proposals', { ...policyProposal, reviewId: 'not a machine code' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/policy/decisions', { ...policyDecision, reviewId: 'not a machine code' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/unknown', {}), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertEndpointPayload('/api/v1/jobs', { job: {}, created: true, promptText: 'PRIVATE-PROMPT-CANARY' }, 'POST'), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
  assert.throws(() => assertConnectorCompatibility({ ...EXPECTED_CONNECTOR_COMPATIBILITY, localAppAssetVersion: 'v2' }), error => error?.code === 'LOCAL_APP_VERSION_MISMATCH');
  assert.throws(() => assertConnectorCompatibility({ ...EXPECTED_CONNECTOR_COMPATIBILITY, extra: 'unsupported' }), error => error?.code === 'LOCAL_APP_VERSION_MISMATCH');
  assert.throws(() => assertConnectorCompatibility(null), error => error?.code === 'LOCAL_APP_VERSION_MISMATCH');
});

test('route result rendering escapes reason and warning labels even before contract admission', () => {
  const payload = '<img src=x onerror=globalThis.routeXss=1>';
  const html = renderRouteResult({
    routeId: '00000000-0000-4000-8000-000000000023', latencyMs: 1, promptStored: false, decisionDigest: `sha256:${'7'.repeat(64)}`,
    decision: {
      revision: API_REVISION, servingMode: 'current', warningCodes: [payload], exclusions: [],
      recommendations: [{ skillId: `sk_${'A'.repeat(43)}`, displayName: 'Fixture skill', score: 1, reasonCodes: [payload] }]
    }
  }, { skillPermalink: () => '#' });
  assert.equal(html.includes(payload), false);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img src=x onerror=globalthis\.routexss=1&gt;/i);
});

test('the real MCP manifest producer matches the exact local-app endpoint contract', async () => {
  const manifest = await mcpCommand(repo, ['manifest'], {});
  const projected = {
    version: manifest.version,
    readOnly: manifest.readOnly,
    tools: manifest.tools,
    limits: manifest.limits,
    verifiedLocally: true
  };
  assert.doesNotThrow(() => assertEndpointPayload('/api/v1/integrations/mcp', projected));
  assert.equal(projected.tools.some(tool => Object.hasOwn(tool.inputSchema?.properties || {}, 'prompt')), true, 'positive producer regression did not exercise the prompt JSON-Schema key');
  const swapped = structuredClone(projected);
  [swapped.tools[0].inputSchema, swapped.tools[1].inputSchema] = [swapped.tools[1].inputSchema, swapped.tools[0].inputSchema];
  assert.throws(() => assertEndpointPayload('/api/v1/integrations/mcp', swapped), error => error?.code === 'API_ENVELOPE_INCOMPATIBLE');
});

test('revision, rollback, and cancellation views call only the finalized exact endpoints', () => {
  const settings = readFileSync(path.join(assets, 'modules', 'views', 'settings.js'), 'utf8');
  const activity = readFileSync(path.join(assets, 'modules', 'views', 'activity.js'), 'utf8');
  assert.match(settings, /api\(`\/api\/v1\/state\/revisions\?limit=50/);
  assert.match(settings, /api\('\/api\/v1\/state\/rollback', \{ body: \{/);
  for (const field of ['targetRevision', 'expectedRevision', 'actor', 'reason', 'confirm']) assert.match(settings, new RegExp(`\\b${field}\\b`));
  assert.match(activity, /api\(`\/api\/v1\/jobs\/\$\{jobId\}\/cancel`, \{ body: \{ idempotencyKey:/);
  assert.match(activity, /api\(`\/api\/v1\/routes\/\$\{encodeURIComponent\(descriptor\.traceId\)\}`, \{ cache: false \}\)/);
  assert.match(activity, /Feedback backlog/);
  assert.match(activity, /feedbackBacklog/);
  assert.match(settings, /Export redacted diagnostics/);
  assert.match(settings, /npm uninstall -g skillmap/);
  assert.match(settings, /backgroundNetworkChecks: false/);
  assert.doesNotMatch(`${settings}\n${activity}`, /FUTURE_API|not yet available|Backend route not available/);
});

test('integrations view gives exact project-local install, trust, verification, and rollback handoffs without browser mutation', () => {
  const integrations = readFileSync(path.join(assets, 'modules', 'views', 'integrations.js'), 'utf8');
  for (const expected of [
    '[mcp_servers.skillmap]', 'args = ["mcp", "serve"]', 'enabled_tools = [', '.codex/config.toml',
    'skillmap mcp manifest --json', 'skillmap mcp call route_prompt', 'codex mcp list',
    'skillmap hook install codex --passive --dry-run --json', 'skillmap hook install codex --passive --json',
    'skillmap hook uninstall codex --dry-run --json', 'skillmap hook uninstall codex --json', '/hooks', 'backupPath'
  ]) assert.match(integrations, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(integrations, /default target is <code>\.codex\/hooks\.json<\/code>/);
  assert.match(integrations, /browser never edits Codex configuration or installs a hook/i);
  assert.doesNotMatch(integrations, /api\/v1\/integrations\/(?:mcp|hook)\/(?:install|uninstall)|data-job=/);
  assert.doesNotMatch(integrations, /Install MCP configuration|Install passive hook/);
});

test('activity renders bounded terminal receipts and safe failures while filtering private receipt fields', () => {
  const base = {
    kind: 'skillmap.job', schemaVersion: 1, expectedRevision: 'r00000000000000000001-00000000-0000-4000-8000-000000000001',
    idempotencyKey: `sha256:${'1'.repeat(64)}`, requestDigest: `sha256:${'2'.repeat(64)}`, confirmation: 'none',
    createdAt: '2026-07-10T12:00:00.000Z', completedAt: '2026-07-10T12:01:00.000Z'
  };
  const html = renderJobList([
    { ...base, jobId: '11111111-1111-4111-8111-111111111111', type: 'scan', state: 'succeeded', resultReceipt: { revisionId: 'r00000000000000000002-safe', skillCount: 12, configuredPath: '/private/skills', note: 'CANARY_PRIVATE' } },
    { ...base, jobId: '22222222-2222-4222-8222-222222222222', type: 'doctor', state: 'failed', error: { code: 'JOB_SAFE_FAILURE', message: '<script>alert(1)</script>', retryable: true } },
    { ...base, jobId: '33333333-3333-4333-8333-333333333333', type: 'sources-check', state: 'cancelled', resultReceipt: { publicationPrevented: true, cancelledFrom: 'running' } }
  ]);
  assert.match(html, /Result receipt · 2 fields/);
  assert.match(html, /Cancellation receipt · 2 fields/);
  assert.match(html, /Completed/);
  assert.match(html, /JOB_SAFE_FAILURE/);
  assert.match(html, /Retryable after reviewing the current revision/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|\/private\/skills|CANARY_PRIVATE|configuredPath/);
  assert.match(renderJobList([]), /No maintenance jobs/);
  assert.match(renderJobList([{ ...base, completedAt: undefined, jobId: '44444444-4444-4444-8444-444444444444', type: 'eval-run', state: 'queued' }]), /No completion receipt exists yet/);
  assert.match(renderJobList([{ ...base, jobId: '55555555-5555-4555-8555-555555555555', type: 'graph-build', state: 'cancelled' }]), /no safe result fields were exposed/);
});

test('policy preview, source adoption/diff, and eval import use exact product endpoints without client simulation', () => {
  const policies = readFileSync(path.join(assets, 'modules', 'views', 'policies.js'), 'utf8');
  const sources = readFileSync(path.join(assets, 'modules', 'views', 'sources.js'), 'utf8');
  const evals = readFileSync(path.join(assets, 'modules', 'views', 'evals.js'), 'utf8');
  const policyActions = readFileSync(path.join(assets, 'modules', 'policy-actions.js'), 'utf8');
  assert.match(policies, /api\('\/api\/v1\/policy\/preview', \{ body: \{ expectedRevision, confirmation: 'review' \} \}\)/);
  assert.match(policyActions, /api\('\/api\/v1\/policy\/proposals'/);
  assert.match(policyActions, /api\('\/api\/v1\/policy\/decisions'/);
  for (const outcome of ['accept', 'hold', 'reject']) assert.match(policies, new RegExp(`data-policy-decision="${outcome}"`));
  for (const queue of ['duplicate', 'unmatched', 'uncovered', 'explicit-only', 'blocked']) assert.match(policies, new RegExp(queue));
  assert.match(sources, /api\('\/api\/v1\/sources\/adoptions', \{ body \}\)/);
  assert.match(sources, /api\('\/api\/v1\/sources\/diff', \{ body: \{ skillId: button\.dataset\.skillId, expectedRevision \} \}\)/);
  assert.match(evals, /api\('\/api\/v1\/evals\/import', \{ body: \{ suite: state\.suite, expectedRevision \} \}\)/);
  assert.match(evals, /api\('\/api\/v1\/evals\/import', \{ body: \{ suite: finalized\.suite, expectedRevision \} \}\)/);
  assert.doesNotMatch(`${policies}\n${sources}`, /No backend call|client-side dry-run|localStorage|sessionStorage/);
});

test('eval review supports a 150-case credible suite, editable labels, warning-only iteration evidence, and disposal', () => {
  const suite = credibleEvalSuite();
  const state = createEvalReviewState(parseEvalReviewSuite(JSON.stringify(suite)));
  const summary = summarizeEvalReview(state);
  assert.equal(summary.credible, true);
  assert.equal(summary.releaseCounted, 150);
  assert.equal(summary.releaseHoldout, 30);
  assert.equal(summary.canImport, true);

  updateEvalReviewCase(state, 0, { expected: ['edited-label'], membership: 'holdout' });
  assert.deepEqual(state.suite.evals[0].expected, ['edited-label']);
  assert.equal(Object.hasOwn(state.suite.provenance, 'datasetDigest'), false, 'an edit retained a stale declared digest');

  state.suite.provenance.deduplicationResult = 'not-run';
  state.suite.evals[1].prompt = state.suite.evals[0].prompt;
  const iteration = summarizeEvalReview(state);
  assert.equal(iteration.canImport, true, 'credible-evidence warnings incorrectly blocked a structurally valid iteration suite');
  assert.equal(iteration.credible, false);
  assert.ok(iteration.warnings.some(item => /deduplication/i.test(item)));

  updateEvalReviewCase(state, 0, { avoid: ['edited-label'] });
  assert.equal(summarizeEvalReview(state).canImport, false, 'overlapping expected/avoid labels did not block import');
  disposeEvalReviewState(state);
  assert.equal(state.suite, null);
});

test('eval review rejects obvious v2 schema faults before POST and blocks a zero-case suite', () => {
  const suite = credibleEvalSuite();
  assert.throws(() => parseEvalReviewSuite(JSON.stringify({ ...suite, unexpected: true })), /unsupported field/);
  assert.throws(() => parseEvalReviewSuite(JSON.stringify({ ...suite, provenance: { ...suite.provenance, privateNotes: 'no' } })), /unsupported field/);
  assert.throws(() => parseEvalReviewSuite(JSON.stringify({ ...suite, baseline: { ...suite.baseline, top1Rate: 2 } })), /between 0 and 1/);
  assert.throws(() => parseEvalReviewSuite(JSON.stringify({ ...suite, evals: [{ ...suite.evals[0], id: 'x'.repeat(201) }] })), /id must be/);
  assert.throws(() => parseEvalReviewSuite(JSON.stringify({ ...suite, evals: [{ ...suite.evals[0], prompt: 'x'.repeat(32769) }] })), /32768/);
  const empty = createEvalReviewState(parseEvalReviewSuite(JSON.stringify({ ...suite, evals: [] })));
  assert.equal(summarizeEvalReview(empty).canImport, false);
});

test('browser and canonical eval parser share the exact 32768 UTF-8-byte prompt boundary', () => {
  const suite = credibleEvalSuite();
  suite.evals = [{ ...suite.evals[0], prompt: 'x'.repeat(32768) }];
  assert.doesNotThrow(() => parseEvalReviewSuite(JSON.stringify(suite)));
  assert.doesNotThrow(() => parseEvalSuite(suite));
  suite.evals[0].prompt += 'x';
  assert.throws(() => parseEvalReviewSuite(JSON.stringify(suite)), /32768/);
  assert.throws(() => parseEvalSuite(suite), /32768/);

  const unicode = credibleEvalSuite();
  unicode.evals = [{ ...unicode.evals[0], prompt: '😀'.repeat(8193) }];
  assert.throws(() => parseEvalReviewSuite(JSON.stringify(unicode)), /32768/);
  assert.throws(() => parseEvalSuite(unicode), /32768/);
});

test('v3 browser review computes the exact canonical runtime digests without mutating its input snapshot', async () => {
  const suite = evalSuiteV3();
  const original = structuredClone(suite);
  const finalized = await finalizeEvalSuiteV3Snapshot(suite);
  assert.deepEqual(suite, original, 'digest computation mutated the live draft before its version guard');
  assert.notEqual(finalized.suite, suite);
  assert.equal(finalized.caseSetDigest, computeEvalSuiteV3CaseSetDigest(finalized.suite));
  assert.equal(finalized.datasetDigest, computeEvalSuiteV3DatasetDigest(finalized.suite));
  assert.equal(finalized.payloadDigest, computePayloadDigest(finalized.suite));
  assert.equal(validateContract('https://skillmap.dev/contracts/eval-suite/v3.schema.json', finalized.suite).ok, true);

  const rejectedApply = await refreshEvalSuiteV3Digests(suite, { canApply: () => false });
  assert.equal(rejectedApply.applied, false);
  assert.deepEqual(suite, original, 'a stale async digest task overwrote the newer draft');
});

test('v3 review cross-checks qualified IDs and exact historical RevisionRef while keeping release approval separate', async () => {
  const finalized = await finalizeEvalSuiteV3Snapshot(evalSuiteV3());
  const state = createEvalV3ReviewState(finalized.suite);
  const catalogs = evalV3Catalogs();
  const summary = summarizeEvalV3Review(state, catalogs);
  assert.equal(summary.canImport, true);
  assert.equal(summary.releaseCompositionMet, false, 'a one-case contract was mislabeled as meeting release composition');
  assert.ok(summary.warnings.some((item) => /operator-entered|replay/i.test(item)));

  catalogs.revisions[0].routingApprovalRecorded = false;
  assert.equal(summarizeEvalV3Review(state, catalogs).canImport, false, 'verified ancestry without durable approval was labeled as an approved baseline');
  catalogs.revisions[0].routingApprovalRecorded = true;

  const unavailableCatalog = { ...catalogs, skills: [], skillCatalogAvailable: false };
  assert.equal(summarizeEvalV3Review(state, unavailableCatalog).canImport, false, 'an unavailable approved skill catalog left v3 import enabled');
  const emptyCatalog = { ...catalogs, skills: [], skillCatalogAvailable: true };
  assert.equal(summarizeEvalV3Review(state, emptyCatalog).canImport, false, 'an empty approved skill catalog treated unknown IDs as verified');

  state.suite.cases[0].expectedSkillIds = [`sk_${'Z'.repeat(43)}`];
  assert.equal(summarizeEvalV3Review(state, catalogs).canImport, false, 'an unknown qualified label bypassed the approved skill catalog');
  disposeEvalV3ReviewState(state);
  assert.equal(state.suite, null);
});

test('legacy v2 migration refuses ambiguous names and produces only an in-memory qualified v3 draft', () => {
  const legacy = {
    version: 2,
    provenance: { labelAuthor: 'operator-a', sourceClass: 'imported', createdAt: '2026-07-11T00:00:00.000Z', reviewedAt: '2026-07-11T01:00:00.000Z', deduplicationResult: 'passed', holdoutFrozen: true },
    baseline: { top1Rate: 0.5, top3Rate: 0.75, avoidHits: 0, abstentionRate: 0, meanAdvisoryBytes: 90 },
    evals: [{ id: 'legacy-one', prompt: 'Prepare the focused alpha workflow.', expected: ['alpha'], avoid: [], primaryCaseType: 'implicit-natural', membership: 'holdout' }]
  };
  const [skill] = evalV3Catalogs().skills;
  const ambiguous = legacyV2MigrationPreview(legacy, [skill, { ...skill, skillId: `sk_${'B'.repeat(43)}` }]);
  assert.equal(ambiguous.canConvert, false);
  assert.throws(() => migrateEvalSuiteV2ToV3(legacy, [skill, { ...skill, skillId: `sk_${'B'.repeat(43)}` }]), /exactly one/);

  let sequence = 0;
  const migrated = migrateEvalSuiteV2ToV3(legacy, [skill], { now: '2026-07-11T01:00:00.000Z', idFactory: (length) => `${String(++sequence).padStart(length, 'A')}`.slice(-length) });
  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.cases[0].expectedSkillIds, [skill.skillId]);
  assert.equal(migrated.baseline.provenance.sourceKind, 'operator-declared-no-skillmap');
  assert.equal(summarizeEvalV3Review(createEvalV3ReviewState(migrated), evalV3Catalogs()).canImport, false, 'migration guessed a historical baseline authority');
});

test('v3 browser parser admits the 150-case release floor above the legacy 60 KiB cap but stays below 500 KiB', async () => {
  const suite = evalSuiteV3();
  suite.cases = Array.from({ length: 150 }, (_item, index) => ({
    ...structuredClone(suite.cases[0]),
    caseId: `evalcase_releasefloor${String(index).padStart(4, '0')}`,
    prompt: `Natural reviewed operator request ${index} with enough local context to exercise the bounded browser authority workflow.`
  }));
  const finalized = await finalizeEvalSuiteV3Snapshot(suite);
  const bytes = new TextEncoder().encode(JSON.stringify(finalized.suite)).length;
  assert.ok(bytes > 60 * 1024, `fixture did not exceed the legacy bound: ${bytes}`);
  assert.ok(bytes < 500 * 1024, `fixture exceeded the v3 browser bound: ${bytes}`);
  assert.equal(parseEvalSuiteV3(JSON.stringify(finalized.suite)).cases.length, 150);
});

test('onboarding exposes exact native-agent curation handoff without browser execution', () => {
  const onboarding = readFileSync(path.join(assets, 'modules', 'views', 'onboarding.js'), 'utf8');
  assert.match(onboarding, /skillmap curate codex --prepare/);
  assert.match(onboarding, /skillmap curate codex --ingest \.skillmap\/proposals\/policy\.yml --rationale \.skillmap\/proposals\/policy-rationale\.md --model MODEL --confirm/);
  assert.match(onboarding, /docs\/curation\.md/);
  assert.match(onboarding, /doctorPresent/);
  assert.match(onboarding, /doctorPackPresent/);
  assert.match(onboarding, /inventorySkills/);
  assert.match(onboarding, /curationPresent/);
  assert.match(onboarding, /curationStale/);
  assert.doesNotMatch(onboarding, /data-job="curation"/);
  assert.doesNotMatch(onboarding, /scanned: \(dashboardEvidence\.inventorySkills \|\| ctx\.state\.dashboard/);
});

test('responsive styles provide card alternatives and an explicit 320px containment breakpoint', () => {
  const css = readFileSync(path.join(assets, 'app.css'), 'utf8');
  assert.match(css, /@media \(max-width: 1200px\)[\s\S]*\.filter-bar[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.skill-cards[\s\S]*display: block/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /min-width: 320px/);
  assert.match(css, /prefers-reduced-motion/);
}
);

function filesUnder(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) result.push(target);
    }
  }
  return result.sort();
}

function credibleEvalSuite() {
  const evals = [];
  for (let index = 0; index < 100; index += 1) evals.push(evalCase(index, 'implicit-natural'));
  for (let index = 100; index < 125; index += 1) evals.push(evalCase(index, 'multi-skill'));
  for (let index = 125; index < 150; index += 1) evals.push(evalCase(index, 'negative-near-miss'));
  return {
    version: 2,
    provenance: {
      labelAuthor: 'fixture-reviewer', sourceClass: 'reviewed-local-prompts', createdAt: '2026-07-01T00:00:00.000Z',
      reviewedAt: '2026-07-10T00:00:00.000Z', deduplicationResult: 'passed', holdoutFrozen: true,
      datasetDigest: `sha256:${'a'.repeat(64)}`
    },
    baseline: { top1Rate: 0.8, top3Rate: 0.92, avoidHits: 0, abstentionRate: 0.1, meanAdvisoryBytes: 120 },
    evals
  };
}

function evalCase(index, primaryCaseType) {
  const expected = primaryCaseType === 'multi-skill' ? [`expected-${index}-a`, `expected-${index}-b`] : primaryCaseType === 'negative-near-miss' ? [] : [`expected-${index}`];
  return {
    id: `case-${index}`,
    prompt: `Natural operator task number ${index}`,
    expected,
    avoid: primaryCaseType === 'negative-near-miss' ? [`avoid-${index}`] : [],
    primaryCaseType,
    membership: index < 30 ? 'holdout' : 'train'
  };
}

function evalSuiteV3() {
  const catalogs = evalV3Catalogs();
  const baselineRevision = catalogs.revisions[0].revision;
  return {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    suiteId: 'evalsuite_browserreview01',
    name: 'Browser review fixture',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T05:00:00.000Z',
    datasetDigest: `sha256:${'0'.repeat(64)}`,
    provenance: {
      labelAuthor: 'operator-a', reviewedBy: 'reviewer-b', sourceClass: 'operator-authored',
      createdAt: '2026-07-11T00:00:00.000Z', holdoutFrozenAt: '2026-07-11T02:00:00.000Z', reviewedAt: '2026-07-11T04:00:00.000Z',
      deduplicationResult: 'passed', holdoutFrozen: true, frozenCaseSetDigest: `sha256:${'0'.repeat(64)}`
    },
    baseline: {
      top1Rate: 0.5, top3Rate: 0.75, avoidHits: 0, abstentionRate: 0, meanAdvisoryBytes: 90,
      provenance: { sourceKind: 'approved-effective-revision', completedAt: '2026-07-11T03:00:00.000Z', caseSetDigest: `sha256:${'0'.repeat(64)}`, sourceRevision: baselineRevision }
    },
    cases: [{
      caseId: 'evalcase_browserreview01', prompt: 'Prepare the focused workflow.', expectedSkillIds: [catalogs.skills[0].skillId], avoidSkillIds: [],
      primaryCaseType: 'implicit-natural', membership: 'holdout',
      labelProvenance: { author: 'operator-a', sourceClass: 'operator-authored', createdAt: '2026-07-11T00:00:00.000Z', reviewedAt: '2026-07-11T01:00:00.000Z' }
    }],
    redactionClassification: 'local-sensitive',
    payloadDigest: `sha256:${'0'.repeat(64)}`
  };
}

function evalV3Catalogs() {
  const workspaceId = '00000000-0000-4000-8000-000000000001';
  const baselineRevision = {
    workspaceId,
    revisionId: 'r00000000000000000001-00000000-0000-4000-8000-000000000002',
    workspaceRevision: `sha256:${'1'.repeat(64)}`,
    effectiveDigest: `sha256:${'2'.repeat(64)}`,
    effectiveRevisionDigest: `sha256:${'3'.repeat(64)}`
  };
  return {
    skills: [{ displayName: 'alpha', skillId: `sk_${'A'.repeat(43)}`, routeEligible: true, qualifiedExplicitAllowed: true, variantState: 'unique' }],
    revisions: [{ revision: baselineRevision, sequence: 1, isCurrent: false, routingApprovalRecorded: true }],
    currentRevisionId: 'r00000000000000000002-00000000-0000-4000-8000-000000000003',
    skillCatalogAvailable: true,
    revisionCatalogAvailable: true
  };
}
