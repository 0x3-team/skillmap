import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  canonicalJson,
  canonicalPayloadJson,
  computeEvalRouteReplayWorkUnits,
  computeEvalSuiteV3CaseSetDigest,
  computeEvalSuiteV3DatasetDigest,
  computePayloadDigest,
  computeRouteDecisionDigest,
  EVAL_RELEASE_ROUTE_WORK_LIMIT,
  validateEvalRunV3WithContext,
  validateContract
} from '../dist/contracts/validate.js';
import { rankRoutePrompt } from '../dist/contracts/route-ranking.js';
import { isFixturePath } from '../dist/contracts/fixture-path.js';
import { CONTRACT_SCHEMAS } from '../dist/contracts/generated/schema-bundle.js';
import { apiError, apiSuccess } from '../dist/core/api-envelope.js';
import { computeEffectiveRevisionDigest } from '../dist/core/effective-state.js';
import { parseFrontmatter } from '../dist/core/frontmatter.js';
import { createJob, transitionJob } from '../dist/core/jobs.js';
import { buildEffectiveRegistry } from '../dist/core/policy.js';
import { createAndRecordFeedback, createRouteEvent, recordRouteEvent } from '../dist/core/route-events.js';
import { buildSkillMapStatus, inventoryHasFixtureRoots } from '../dist/core/status.js';
import { WorkspaceStateStore } from '../dist/core/workspace-state/index.js';
import { inferClientHints, inferScope } from '../dist/core/roots.js';
import { evaluateEvalSuiteV3, parseEvalSuite } from '../dist/services/eval-use-case.js';
import { executeRouteUseCase } from '../dist/services/route-use-case.js';

const execFileAsync = promisify(execFile);

const repo = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(repo, 'contracts/manifest.json'), 'utf8'));
const canonicalSchemas = await Promise.all(manifest.schemas.map(async (entry) => {
  const value = JSON.parse(await readFile(path.join(repo, 'contracts', entry.path), 'utf8'));
  return { entry, value };
}));

const IDS = Object.fromEntries(manifest.schemas.map((entry) => [entry.name, entry.id]));
const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const ROOT_ID = '00000000-0000-4000-8000-000000000002';
const REVISION_ID = 'r00000000000000000001-00000000-0000-4000-8000-000000000003';
const BASELINE_REVISION_ID = 'r00000000000000000000-00000000-0000-4000-8000-000000000009';
const SKILL_ID = `sk_${'A'.repeat(43)}`;
const SKILL_ID_B = `sk_${'B'.repeat(43)}`;
const SKILL_ID_C = `sk_${'C'.repeat(43)}`;
const SKILL_ID_D = `sk_${'D'.repeat(43)}`;
const SKILL_ID_E = `sk_${'E'.repeat(43)}`;
const ROUTE_ID = '00000000-0000-4000-8000-000000000004';
const JOB_ID = '00000000-0000-4000-8000-000000000005';
const EVENT_ID = '00000000-0000-4000-8000-000000000006';
const FEEDBACK_ID = '00000000-0000-4000-8000-000000000007';
const REQUEST_ID = '00000000-0000-4000-8000-000000000008';
const DEVICE_AUTH_DEVICE_ID = 'D'.repeat(22);
const DEVICE_AUTH_PUBLIC_KEY = 'A'.repeat(122);
const DEVICE_AUTH_KEY_THUMBPRINT = `sha256:${'a'.repeat(64)}`;
const DEVICE_AUTH_DEVICE_CODE = 'B'.repeat(43);
const DEVICE_AUTH_DEVICE_PUBLIC_ID = `dev_${'b'.repeat(32)}`;
const DEVICE_AUTH_ACCOUNT_PUBLIC_ID = `acct_${'c'.repeat(32)}`;
const NOW = '2026-07-10T12:00:00.000Z';
const LATER = '2026-07-10T12:01:00.000Z';
const HOLDOUT_FROZEN = '2026-07-10T12:02:00.000Z';
const BASELINE_COMPLETED = '2026-07-10T12:03:00.000Z';
const DATASET_REVIEWED = '2026-07-10T12:04:00.000Z';
const RUN_STARTED = '2026-07-10T12:05:00.000Z';
const RUN_FINISHED = '2026-07-10T12:06:00.000Z';
const revision = { workspaceId: WORKSPACE_ID, revisionId: REVISION_ID, workspaceRevision: SHA_A, effectiveDigest: SHA_B, effectiveRevisionDigest: SHA_C };
const compatibility = { state: 'compatible', minReaderSchemaVersion: 1, maxReaderSchemaVersion: 1 };
const producer = { name: 'skillmap', version: '0.1.0' };

function withDigest(value) {
  return { ...value, payloadDigest: computePayloadDigest(value) };
}

function clone(value) {
  return structuredClone(value);
}

function assertValid(schemaId, value) {
  const result = validateContract(schemaId, value);
  assert.equal(result.ok, true, `${schemaId} should accept vector; issues=${JSON.stringify(result.issues)}`);
}

function assertInvalid(schemaId, value, pattern) {
  const result = validateContract(schemaId, value);
  assert.equal(result.ok, false, `${schemaId} should reject vector`);
  if (pattern) assert.match(result.issues.map((issue) => `${issue.keyword} ${issue.message}`).join(' '), pattern);
}

function assertValidEvalRunWithContext(run, context) {
  const result = validateEvalRunV3WithContext(run, context);
  assert.equal(result.ok, true, `contextual eval-run/v3 validation should accept vector; issues=${JSON.stringify(result.issues)}`);
}

function assertInvalidEvalRunWithContext(run, context, pattern) {
  const result = validateEvalRunV3WithContext(run, context);
  assert.equal(result.ok, false, 'contextual eval-run/v3 validation should reject vector');
  if (pattern) assert.match(result.issues.map((issue) => `${issue.path} ${issue.keyword} ${issue.message}`).join(' '), pattern);
}

function workspaceRevision() {
  return withDigest({
    kind: 'skillmap.workspace-revision',
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    revisionId: REVISION_ID,
    sequence: 1,
    parentRevisionId: null,
    createdAt: NOW,
    fencingToken: 1,
    mutation: { kind: 'legacy-migration', actor: 'contract-test' },
    canonicalIntentDigest: SHA_A,
    rawTruthDigest: SHA_B,
    routingSafetyDigest: SHA_C,
    readModelDigest: SHA_A,
    workspaceRevision: SHA_A,
    effectiveDigest: SHA_B,
    effectiveRevisionDigest: SHA_C,
    artifacts: [{
      path: 'inventory.json',
      role: 'raw-truth',
      routingCritical: true,
      bytes: 2,
      digest: SHA_A
    }],
    producer,
    compatibility: { minReaderSchemaVersion: 1, maxReaderSchemaVersion: 1 },
    redaction: { classification: 'local-sensitive' }
  });
}

function skillIdentityRef() {
  return {
    kind: 'skillmap.skill-identity-ref',
    schemaVersion: 1,
    skillId: SKILL_ID,
    displayName: 'frontend-design',
    contentRevision: SHA_A
  };
}

function routeResult() {
  const decision = {
    kind: 'skillmap.route-decision',
    schemaVersion: 2,
    revision: clone(revision),
    servingMode: 'current',
    recommendations: [{
      skillId: SKILL_ID,
      displayName: 'frontend-design',
      score: 12,
      tier: 'active-default',
      reasonCodes: ['name-token-match']
    }],
    exclusions: [],
    hookText: 'SkillMap: prefer frontend-design.',
    warningState: 'none',
    warningCodes: []
  };
  return {
    kind: 'skillmap.route-result',
    schemaVersion: 2,
    routeId: ROUTE_ID,
    createdAt: NOW,
    promptStored: false,
    decision,
    decisionDigest: computeRouteDecisionDigest(decision),
    latencyMs: 4.2
  };
}

function dashboardV2() {
  return withDigest({
    version: 2,
    kind: 'skillmap.dashboard-snapshot',
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    workspaceRevision: SHA_A,
    workspaceName: 'Contract fixture',
    generatedAt: NOW,
    producer,
    compatibility: { minReaderSchemaVersion: 2, maxReaderSchemaVersion: 2 },
    inputDigests: { inventory: SHA_A },
    redactionClassification: 'shareable-redacted',
    redacted: true,
    mode: 'attention-required',
    source: 'local-snapshot',
    status: { verdict: 'attention-required', label: 'Attention required', summary: 'Review is required.', warnings: [], nextActions: ['Run a local review'] },
    tokenMetrics: { sampleSize: 1, method: 'workspace-estimate', computedAt: NOW },
    productivity: { routeCount: 0, evalConfidence: 'none', releaseReady: false },
    connector: { state: 'offline', redactionEnabled: true, readOnlyMode: true, allowedCommands: ['skillmap status --json'], message: 'No live connector.' },
    skills: [],
    recentRouteTraces: [],
    policyReviews: [],
    sources: []
  });
}

function dashboardV3() {
  return withDigest({
    version: 3,
    kind: 'skillmap.dashboard-snapshot',
    schemaVersion: 3,
    workspaceId: WORKSPACE_ID,
    revision: clone(revision),
    workspaceName: 'Contract fixture',
    generatedAt: NOW,
    producer,
    compatibility: { state: 'compatible', minReaderSchemaVersion: 3, maxReaderSchemaVersion: 3 },
    inputDigests: { inventory: SHA_A },
    redactionClassification: 'shareable-redacted',
    redacted: true,
    mode: 'attention-required',
    source: 'local-snapshot',
    routeHistorySource: 'none',
    status: { verdict: 'attention-required', label: 'Attention required', summary: 'Review is required.', warnings: [], nextActions: ['Run a local review'] },
    tokenMetrics: { sampleSize: 1, method: 'workspace-estimate', computedAt: NOW },
    productivity: { routeCount: 0, evalConfidence: 'none', releaseReady: false },
    connector: { state: 'offline', redactionEnabled: true, readOnlyMode: true, allowedCommands: [], message: 'No live connector.' },
    skills: [],
    recentRouteEvents: [],
    policyReviews: [],
    sources: []
  });
}

function job() {
  return {
    kind: 'skillmap.job',
    schemaVersion: 1,
    jobId: JOB_ID,
    type: 'scan',
    state: 'queued',
    expectedRevision: REVISION_ID,
    idempotencyKey: SHA_B,
    requestDigest: SHA_A,
    confirmation: 'none',
    createdAt: NOW
  };
}

function routeEvent() {
  return withDigest({
    kind: 'skillmap.route-event',
    schemaVersion: 1,
    eventId: EVENT_ID,
    routeId: ROUTE_ID,
    createdAt: NOW,
    revision,
    currentRevision: revision,
    surface: 'api',
    outcome: 'recommended',
    selectedSkillIds: [SKILL_ID],
    reasonCodes: ['name-token-match'],
    warningCodes: [],
    latencyBucket: 'lt-10ms',
    decisionDigest: SHA_A,
    promptStored: false
  });
}

function feedback() {
  return withDigest({
    kind: 'skillmap.route-feedback',
    schemaVersion: 1,
    feedbackId: FEEDBACK_ID,
    routeId: ROUTE_ID,
    createdAt: NOW,
    revision,
    outcome: 'correct',
    selectedSkillIds: [SKILL_ID],
    expectedSkillIds: [SKILL_ID],
    unsafeSkillIds: [],
    reasonCode: 'operator-correct',
    idempotencyKeyHash: SHA_B,
    promptStored: false,
    commentStored: false
  });
}

function evalSuiteV2() {
  return {
    version: 2,
    provenance: { labelAuthor: 'operator', sourceClass: 'operator-authored', createdAt: NOW, reviewedAt: LATER, deduplicationResult: 'passed', holdoutFrozen: true },
    baseline: { top1Rate: 0.8, top3Rate: 0.92, avoidHits: 0, abstentionRate: 0.5, meanAdvisoryBytes: 120 },
    evals: [{ id: 'case-1', prompt: 'Polish the responsive interface', expected: ['frontend-design'], avoid: [], primaryCaseType: 'implicit-natural', membership: 'train' }]
  };
}

function evalSuiteV3() {
  const cases = [{
    caseId: 'evalcase_case0001',
    prompt: 'Polish the responsive interface',
    expectedSkillIds: [SKILL_ID],
    avoidSkillIds: [],
    primaryCaseType: 'implicit-natural',
    membership: 'train',
    labelProvenance: { author: 'operator', sourceClass: 'operator-authored', createdAt: NOW, reviewedAt: LATER }
  }];
  const caseSetDigest = computeEvalSuiteV3CaseSetDigest({ schemaVersion: 3, cases });
  const base = {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    suiteId: 'evalsuite_suite0001',
    name: 'Qualified route suite',
    createdAt: NOW,
    updatedAt: DATASET_REVIEWED,
    provenance: {
      labelAuthor: 'operator', reviewedBy: 'operator', sourceClass: 'operator-authored', createdAt: NOW,
      holdoutFrozenAt: HOLDOUT_FROZEN, reviewedAt: DATASET_REVIEWED,
      deduplicationResult: 'passed', holdoutFrozen: true, frozenCaseSetDigest: caseSetDigest
    },
    baseline: {
      top1Rate: 0, top3Rate: 0, avoidHits: 0, abstentionRate: 1, meanAdvisoryBytes: 0,
      provenance: { sourceKind: 'operator-declared-no-skillmap', completedAt: BASELINE_COMPLETED, caseSetDigest, sourceRevision: null }
    },
    cases,
    redactionClassification: 'local-sensitive'
  };
  const withDataset = { ...base, datasetDigest: computeEvalSuiteV3DatasetDigest(base) };
  return withDigest(withDataset);
}

const composition = { total: 1, explicit: 0, implicitNatural: 1, multiSkill: 0, negativeNearMiss: 0, untyped: 0, releaseCounted: 1, releaseScored: 1 };
const holdout = { count: 0, requiredCount: 30, ratio: 0, pass: false };
const baselineComparison = { provided: true, nonRegression: true, improvement: false, perfectBaseline: false, pass: false, improvements: [], regressions: [] };

function evalRunV2() {
  return {
    version: 2,
    generatedAt: NOW,
    evalFile: '$PROJECT/.skillmap/real-evals.json',
    fixture: false,
    evidenceLevel: 'candidate',
    releaseEvidenceEligible: false,
    thresholdPass: false,
    pass: false,
    datasetDigest: SHA_A,
    effectiveRevisionDigest: SHA_B,
    composition,
    holdout,
    leakage: { pass: true, count: 0, cases: [] },
    provenance: { provided: true, complete: true, issues: [] },
    baselineComparison,
    count: 1,
    top1: 1,
    top3: 1,
    avoidHits: 0,
    top1Rate: 1,
    top3Rate: 1,
    abstentionRate: 0,
    meanAdvisoryBytes: 100,
    regression: { scoredCount: 1, top1: 1, top3: 1, top1Rate: 1, top3Rate: 1 },
    invalidCaseCount: 0,
    validationErrors: [],
    confidence: { level: 'alpha', count: 1, releaseReady: false, message: 'Candidate evidence.' },
    minCount: 150,
    minTop1: 0.8,
    minTop3: 0.92,
    maxAvoidHits: 0,
    summary: 'Candidate evidence.',
    rows: []
  };
}

function evalRunV3() {
  return withDigest({
    kind: 'skillmap.eval-run',
    schemaVersion: 3,
    runId: 'evalrun_run00001',
    suiteId: 'evalsuite_suite0001',
    workspaceId: WORKSPACE_ID,
    revision: clone(revision),
    datasetDigest: SHA_A,
    startedAt: NOW,
    finishedAt: LATER,
    fixture: false,
    evidenceLevel: 'candidate',
    releaseEvidenceEligible: false,
    thresholdPass: false,
    pass: false,
    thresholds: { minCount: 150, minTop1: 0.8, minTop3: 0.92, maxAvoidHits: 0 },
    composition,
    holdout,
    leakage: { count: 0, pass: true, caseIds: [] },
    baseline: {
      top1Rate: 1, top3Rate: 1, avoidHits: 0, abstentionRate: 0, meanAdvisoryBytes: 100,
      provenance: { sourceKind: 'approved-effective-revision', completedAt: NOW, caseSetDigest: SHA_A, sourceRevision: clone(revision) }
    },
    baselineComparison: { provided: true, nonRegression: true, improvement: false, perfectBaseline: true, pass: false, improvements: [], regressions: [] },
    metrics: { count: 1, top1: 1, top3: 1, avoidHits: 0, top1Rate: 1, top3Rate: 1, abstentionRate: 0, meanAdvisoryBytes: 100 },
    invalidCaseCount: 0,
    validationErrors: [],
    caseResults: [{
      caseId: 'evalcase_case0001',
      primaryCaseType: 'implicit-natural',
      membership: 'train',
      releaseCounted: true,
      releaseScored: true,
      expectedSkillIds: [SKILL_ID],
      avoidSkillIds: [],
      recommendedSkillIds: [SKILL_ID],
      avoidedButRecommendedSkillIds: [],
      top1Hit: true,
      top3Hit: true,
      abstained: false,
      advisoryBytes: 100,
      outcome: 'top1-hit',
      reasonCodes: ['EXPECTED_TOP1'],
      validationCodes: [],
      leakageCodes: []
    }],
    redactionClassification: 'local-sensitive'
  });
}

function releaseEvalCases() {
  return Array.from({ length: 150 }, (_, index) => {
    const primaryCaseType = index < 100 ? 'implicit-natural' : index < 125 ? 'multi-skill' : 'negative-near-miss';
    const negative = primaryCaseType === 'negative-near-miss';
    const multi = primaryCaseType === 'multi-skill';
    const expectedSkillIds = negative ? [] : multi ? [SKILL_ID, SKILL_ID_B] : [SKILL_ID];
    return {
      caseId: `evalcase_release${String(index + 1).padStart(8, '0')}`,
      prompt: negative
        ? `Assess an unrelated finance ledger scenario ${String(index + 1).padStart(3, '0')}`
        : multi
          ? `Coordinate a responsive interface and service reliability scenario ${String(index + 1).padStart(3, '0')}`
          : `Improve a responsive interface scenario ${String(index + 1).padStart(3, '0')}`,
      expectedSkillIds,
      avoidSkillIds: negative ? [SKILL_ID] : [],
      primaryCaseType,
      membership: index < 30 ? 'holdout' : 'train',
      labelProvenance: { author: 'operator', sourceClass: 'operator-authored', createdAt: NOW, reviewedAt: LATER }
    };
  });
}

const releaseBaselineBySuite = new WeakMap();

function releaseEvalSuiteV3() {
  const cases = releaseEvalCases();
  const caseSetDigest = computeEvalSuiteV3CaseSetDigest({ schemaVersion: 3, cases });
  const baselineEvidence = releaseEffectiveEvidence(false, BASELINE_REVISION_ID, SHA_B);
  const baselineMetrics = releaseRoutingMetrics(cases, baselineEvidence.effective.skills);
  const base = {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    suiteId: 'evalsuite_release001',
    name: 'Qualified release route suite',
    createdAt: NOW,
    updatedAt: DATASET_REVIEWED,
    provenance: {
      labelAuthor: 'operator', reviewedBy: 'operator', sourceClass: 'operator-authored', createdAt: NOW,
      holdoutFrozenAt: HOLDOUT_FROZEN, reviewedAt: DATASET_REVIEWED,
      deduplicationResult: 'passed', holdoutFrozen: true, frozenCaseSetDigest: caseSetDigest
    },
    baseline: {
      ...baselineMetrics,
      provenance: {
        sourceKind: 'approved-effective-revision', completedAt: BASELINE_COMPLETED,
        caseSetDigest, sourceRevision: baselineEvidence.revision
      }
    },
    cases,
    redactionClassification: 'local-sensitive'
  };
  const withDataset = { ...base, datasetDigest: computeEvalSuiteV3DatasetDigest(base) };
  const suite = withDigest(withDataset);
  releaseBaselineBySuite.set(suite, baselineEvidence);
  return suite;
}

function refreshEvalSuiteV3(suite) {
  const caseSetDigest = computeEvalSuiteV3CaseSetDigest(suite);
  suite.provenance.frozenCaseSetDigest = caseSetDigest;
  suite.baseline.provenance.caseSetDigest = caseSetDigest;
  suite.datasetDigest = computeEvalSuiteV3DatasetDigest(suite);
  suite.payloadDigest = computePayloadDigest(suite);
}

function rebindEvalRunV3(run, suite) {
  run.datasetDigest = suite.datasetDigest;
  run.payloadDigest = computePayloadDigest(run);
}

function releaseEvalContext(suite = releaseEvalSuiteV3()) {
  const current = releaseEffectiveEvidence(true, REVISION_ID, SHA_A);
  const baseline = releaseBaselineBySuite.get(suite);
  assert.ok(baseline, 'release suite must retain its exact historical baseline artifact');
  return {
    companionSuite: suite,
    approvedRevision: current.revision,
    effectiveArtifact: current.effectiveArtifact,
    baselineEffectiveArtifact: baseline.effectiveArtifact,
    approvedBaselineRevision: clone(baseline.revision)
  };
}

function releaseEffectiveEvidence(tuned, revisionId, workspaceRevision) {
  const inventorySkills = [
    releaseInventorySkill(SKILL_ID, 'frontend-design', SHA_A, 'Crafts resilient presentation systems for product teams.'),
    releaseInventorySkill(SKILL_ID_B, 'backend-reliability', SHA_B, 'Maintains dependable server operations under load.')
  ];
  const inventory = {
    version: 2,
    identityVersion: 1,
    workspaceId: WORKSPACE_ID,
    generatedAt: NOW,
    cwd: '/tmp/contract-workspace',
    roots: ['/tmp/contract-skills'],
    rootRecords: [],
    skills: inventorySkills,
    identityIssues: [],
    warnings: []
  };
  const policy = {
    version: 1,
    skills: {
      'frontend-design': tuned
        ? { tier: 'active-default', aliases: ['visual-craft'], preferred_for: ['responsive interface'] }
        : { tier: 'specialist' },
      'backend-reliability': tuned
        ? { tier: 'specialist', aliases: ['server-stability'], preferred_for: ['service reliability'] }
        : { tier: 'specialist' }
    }
  };
  const effective = buildEffectiveRegistry(inventory, policy);
  const effectiveArtifact = `${JSON.stringify(effective, null, 2)}\n`;
  const approvedRevision = {
    ...revision,
    revisionId,
    workspaceRevision,
    effectiveDigest: `sha256:${createHash('sha256').update(effectiveArtifact).digest('hex')}`,
    effectiveRevisionDigest: computeEffectiveRevisionDigest(effective)
  };
  return { effective, revision: approvedRevision, effectiveArtifact };
}

function releaseRoutingMetrics(cases, skills) {
  const results = cases.filter((item) => item.primaryCaseType !== 'explicit').map((item) => {
    const ranked = rankRoutePrompt(skills, item.prompt, 3);
    const recommended = ranked.recommendations.map((entry) => entry.skillId);
    return { item, ranked, recommended };
  });
  const scored = results.filter(({ item }) => item.expectedSkillIds.length > 0);
  const negative = results.filter(({ item }) => item.primaryCaseType === 'negative-near-miss' && item.expectedSkillIds.length === 0);
  return {
    top1Rate: scored.length === 0 ? 0 : scored.filter(({ item, recommended }) => item.expectedSkillIds.includes(recommended[0])).length / scored.length,
    top3Rate: scored.length === 0 ? 0 : scored.filter(({ item, recommended }) => item.primaryCaseType === 'multi-skill'
      ? item.expectedSkillIds.every((skillId) => recommended.slice(0, 3).includes(skillId))
      : item.expectedSkillIds.some((skillId) => recommended.slice(0, 3).includes(skillId))).length / scored.length,
    avoidHits: results.reduce((sum, { item, recommended }) => sum + item.avoidSkillIds.filter((skillId) => recommended.includes(skillId)).length, 0),
    abstentionRate: negative.length === 0 ? 0 : negative.filter(({ recommended }) => recommended.length === 0).length / negative.length,
    meanAdvisoryBytes: results.length === 0 ? 0 : results.reduce((sum, { ranked }) => sum + Buffer.byteLength(ranked.hookText, 'utf8'), 0) / results.length
  };
}

function releaseInventorySkill(skillId, name, contentRevision, description) {
  return {
    id: skillId,
    skillId,
    identityVersion: 1,
    rootId: ROOT_ID,
    relativePath: name,
    contentRevision,
    name,
    description,
    path: `/tmp/contract-skills/${name}/SKILL.md`,
    root: '/tmp/contract-skills',
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
    bodyBytes: 128,
    descriptionBytes: description.length,
    mtime: NOW,
    hash: contentRevision
  };
}

function releaseEvalCaseResults(suite, context) {
  const effective = JSON.parse(context.effectiveArtifact);
  return suite.cases.map((item) => {
    const ranked = rankRoutePrompt(effective.skills, item.prompt || 'qualified skill selection', 3, item.qualifiedSkillId);
    const recommendedSkillIds = ranked.recommendations.map((entry) => entry.skillId);
    const top1Hit = item.expectedSkillIds.length > 0 && item.expectedSkillIds.includes(recommendedSkillIds[0]);
    const top3Hit = item.expectedSkillIds.length > 0 && (item.primaryCaseType === 'multi-skill'
      ? item.expectedSkillIds.every((skillId) => recommendedSkillIds.slice(0, 3).includes(skillId))
      : item.expectedSkillIds.some((skillId) => recommendedSkillIds.slice(0, 3).includes(skillId)));
    const abstained = recommendedSkillIds.length === 0;
    const releaseCounted = item.primaryCaseType !== 'explicit';
    const releaseScored = releaseCounted && item.expectedSkillIds.length > 0;
    const avoidedButRecommendedSkillIds = item.avoidSkillIds.filter((skillId) => recommendedSkillIds.includes(skillId));
    const outcome = avoidedButRecommendedSkillIds.length > 0
      ? 'unsafe'
      : item.primaryCaseType === 'negative-near-miss' && item.expectedSkillIds.length === 0 && abstained
        ? 'correct-abstention'
        : top1Hit
          ? 'top1-hit'
          : top3Hit
            ? 'top3-hit'
            : 'miss';
    const reasonCode = {
      'top1-hit': 'EXPECTED_TOP1',
      'top3-hit': 'EXPECTED_TOP3',
      'correct-abstention': 'CORRECT_ABSTENTION',
      miss: abstained ? 'EXPECTED_SKILL_ABSTAINED' : 'EXPECTED_SKILL_MISSED',
      unsafe: 'AVOID_TARGET_RECOMMENDED'
    }[outcome];
    return {
      caseId: item.caseId,
      primaryCaseType: item.primaryCaseType,
      membership: item.membership,
      releaseCounted,
      releaseScored,
      expectedSkillIds: item.expectedSkillIds,
      avoidSkillIds: item.avoidSkillIds,
      ...(item.qualifiedSkillId ? { qualifiedSkillId: item.qualifiedSkillId } : {}),
      recommendedSkillIds,
      avoidedButRecommendedSkillIds,
      top1Hit,
      top3Hit,
      abstained,
      advisoryBytes: Buffer.byteLength(ranked.hookText, 'utf8'),
      outcome,
      reasonCodes: [reasonCode],
      validationCodes: [],
      leakageCodes: []
    };
  });
}

function releaseEvalRunV3(suite = releaseEvalSuiteV3(), context = releaseEvalContext(suite)) {
  const caseResults = releaseEvalCaseResults(suite, context);
  const releaseCounted = caseResults.filter((item) => item.releaseCounted);
  const releaseScored = caseResults.filter((item) => item.releaseScored);
  const meanAdvisoryBytes = releaseCounted.reduce((sum, item) => sum + item.advisoryBytes, 0) / releaseCounted.length;
  const top1 = releaseScored.filter((item) => item.top1Hit).length;
  const top3 = releaseScored.filter((item) => item.top3Hit).length;
  const composition = {
    total: caseResults.length,
    explicit: caseResults.filter((item) => item.primaryCaseType === 'explicit').length,
    implicitNatural: caseResults.filter((item) => item.primaryCaseType === 'implicit-natural').length,
    multiSkill: caseResults.filter((item) => item.primaryCaseType === 'multi-skill').length,
    negativeNearMiss: caseResults.filter((item) => item.primaryCaseType === 'negative-near-miss').length,
    untyped: 0,
    releaseCounted: releaseCounted.length,
    releaseScored: releaseScored.length
  };
  const improvements = [
    ...(1 > suite.baseline.top1Rate ? ['top1Rate'] : []),
    ...(1 > suite.baseline.top3Rate ? ['top3Rate'] : []),
    ...(1 > suite.baseline.abstentionRate ? ['abstentionRate'] : []),
    ...(meanAdvisoryBytes < suite.baseline.meanAdvisoryBytes ? ['meanAdvisoryBytes'] : [])
  ];
  return withDigest({
    kind: 'skillmap.eval-run',
    schemaVersion: 3,
    runId: 'evalrun_release0001',
    suiteId: suite.suiteId,
    workspaceId: WORKSPACE_ID,
    revision: clone(context.approvedRevision),
    datasetDigest: suite.datasetDigest,
    startedAt: RUN_STARTED,
    finishedAt: RUN_FINISHED,
    fixture: false,
    evidenceLevel: 'release',
    releaseEvidenceEligible: true,
    thresholdPass: true,
    pass: true,
    thresholds: { minCount: 150, minTop1: 0.8, minTop3: 0.92, maxAvoidHits: 0 },
    composition,
    holdout: { count: 30, requiredCount: 30, ratio: 0.2, pass: true },
    leakage: { count: 0, pass: true, caseIds: [] },
    baseline: clone(suite.baseline),
    baselineComparison: {
      provided: true,
      nonRegression: true,
      improvement: true,
      perfectBaseline: false,
      pass: true,
      improvements,
      regressions: []
    },
    metrics: { count: caseResults.length, top1, top3, avoidHits: 0, top1Rate: top1 / releaseScored.length, top3Rate: top3 / releaseScored.length, abstentionRate: 1, meanAdvisoryBytes },
    invalidCaseCount: 0,
    validationErrors: [],
    caseResults,
    redactionClassification: 'local-sensitive'
  });
}

function syncEnvelope() {
  return withDigest({
    kind: 'skillmap.sync-envelope',
    schemaVersion: 1,
    syncId: 'sync_0000000000000001',
    workspaceId: WORKSPACE_ID,
    deviceId: 'device_0000000000000001',
    direction: 'local-to-cloud',
    sequence: '1',
    idempotencyKey: 'sync:000000000001',
    baseRevision: revision,
    targetRevision: revision,
    createdAt: NOW,
    payloadType: 'workspace-summary',
    payload: {
      type: 'workspace-summary',
      revision,
      skillCount: 1,
      routeEligibleCount: 1,
      blockedCount: 0,
      readiness: 'attention-required',
      policyDigest: SHA_A,
      evalSummaryDigest: null
    },
    redactionClassification: 'metadata-only',
    signature: null
  });
}

function apiEnvelope() {
  return {
    kind: 'skillmap.api-response',
    schemaVersion: 1,
    ok: true,
    requestId: REQUEST_ID,
    servingRevision: revision,
    currentRevision: revision,
    compatibility: 'compatible',
    data: { status: 'ok' }
  };
}

function mcpEnvelope(data) {
  return { ...apiEnvelope(), data };
}

function mcpSkillSummary() {
  return {
    skillId: SKILL_ID,
    displayName: 'alpha-skill',
    contentRevision: SHA_A,
    tier: 'active-default',
    routeEligible: true,
    qualifiedExplicitAllowed: true,
    variantState: 'unique',
    hasScripts: false,
    referenceCount: 0,
    assetCount: 0,
    trust: 'parsed'
  };
}

function mcpPage(items) {
  return { items, limit: 20, hasMore: false, nextCursor: null, sortKey: 'stable-v1' };
}

const validVectors = new Map([
  [IDS['workspace-revision-v1'], workspaceRevision()],
  [IDS['skill-identity-v1'], skillIdentityRef()],
  [IDS['route-result-v2'], routeResult()],
  [IDS['dashboard-v2'], dashboardV2()],
  [IDS['dashboard-v3'], dashboardV3()],
  [IDS['job-v1'], job()],
  [IDS['event-v1'], routeEvent()],
  [IDS['route-feedback-v1'], feedback()],
  [IDS['eval-suite-v2'], evalSuiteV2()],
  [IDS['eval-suite-v3'], evalSuiteV3()],
  [IDS['eval-run-v2'], evalRunV2()],
  [IDS['eval-run-v3'], evalRunV3()],
  [IDS['sync-envelope-v1'], syncEnvelope()],
  [IDS['api-envelope-v1'], apiEnvelope()],
  [IDS['mcp-route-prompt-result-v1'], mcpEnvelope(routeResult())],
  [IDS['mcp-search-skills-result-v1'], mcpEnvelope(mcpPage([mcpSkillSummary()]))],
  [IDS['mcp-show-skill-result-v1'], mcpEnvelope({ skill: mcpSkillSummary() })],
  [IDS['mcp-show-skillgraph-result-v1'], mcpEnvelope({
    graph: mcpPage([{ kind: 'node', id: `skill:${SKILL_ID}`, type: 'skill', label: 'alpha-skill' }])
  })],
  [IDS['mcp-doctor-summary-result-v1'], mcpEnvelope({
    summary: { skillCount: 1, duplicateNameCount: 0, scriptBearingCount: 0, findingCount: 0 },
    findings: mcpPage([])
  })],
  [IDS['mcp-source-status-result-v1'], mcpEnvelope({
    coverage: 'covered',
    inventorySkills: 1,
    trackedSkills: 1,
    records: mcpPage([])
  })],
  [IDS['device-auth-error-v1'], {
    error: 'invalid_request',
    error_description: 'Invalid request',
    retry_after: 0
  }],
  [IDS['device-auth-initiate-request-v1'], {
    device_id: DEVICE_AUTH_DEVICE_ID,
    device_public_key: DEVICE_AUTH_PUBLIC_KEY,
    key_thumbprint: DEVICE_AUTH_KEY_THUMBPRINT,
    audience: 'skillmap.connector.v1',
    proof_suite: 'skillmap.ecdsa-p256-sha256.v2',
    requested_scopes: ['device.status'],
    platform: 'macos',
    connector_version: '1.0.0'
  }],
  [IDS['device-auth-initiate-response-v1'], {
    device_code: DEVICE_AUTH_DEVICE_CODE,
    user_code: 'ABCDE-12345',
    verification_uri: 'https://skillmap.dev/device',
    expires_in: 600,
    interval: 5,
    display: {
      name: '',
      platform: 'macos',
      connector_version: '1.0.0',
      locale: 'en-US'
    }
  }],
  [IDS['device-auth-cancel-request-v1'], {
    device_code: DEVICE_AUTH_DEVICE_CODE,
    device_id: DEVICE_AUTH_DEVICE_ID,
    audience: 'skillmap.connector.v1',
    reason: 'user_cancelled'
  }],
  [IDS['device-auth-cancel-response-v1'], { status: 'cancelled' }],
  [IDS['device-auth-authenticate-request-v1'], {
    device_id: DEVICE_AUTH_DEVICE_ID,
    audience: 'skillmap.connector.v1'
  }],
  [IDS['device-auth-authenticate-response-v1'], {
    active: true,
    device_public_id: DEVICE_AUTH_DEVICE_PUBLIC_ID,
    account_public_id: DEVICE_AUTH_ACCOUNT_PUBLIC_ID,
    scopes: ['device.status'],
    audience: 'skillmap.connector.v1',
    expires_at: 1735689600
  }],
  [IDS['device-auth-status-response-v1'], {
    device_public_id: DEVICE_AUTH_DEVICE_PUBLIC_ID,
    account_public_id: DEVICE_AUTH_ACCOUNT_PUBLIC_ID,
    state: 'active',
    scopes: ['device.status'],
    expires_at: 1735689600,
    key_thumbprint: DEVICE_AUTH_KEY_THUMBPRINT
  }],
  [IDS['device-auth-revoke-request-v1'], { reason: 'user_offboarded' }],
  [IDS['device-auth-revoke-response-v1'], {
    status: 'revoked',
    device_public_id: DEVICE_AUTH_DEVICE_PUBLIC_ID
  }]
]);

const dedicatedContractSchemas = new Set([
  IDS['device-auth-common-v1'],
  IDS['hosted-grade-summary-v1'],
  IDS['hosted-skill-v1'],
  IDS['hosted-skill-list-v1'],
  IDS['hosted-api-response-v1'],
  IDS['hosted-review-state-v1'],
  IDS['hosted-audit-summary-v1'],
  IDS['hosted-audit-receipt-v1'],
  IDS['hosted-grade-receipt-v1'],
  IDS['hosted-submission-v1']
]);

test('frontmatter parsing accepts LF and CRLF delimiters without rewriting body bytes', () => {
  const lf = parseFrontmatter('---\nname: portable-skill\ndescription: Use for portable skill parsing.\n---\n# Body\n');
  const crlf = parseFrontmatter('---\r\nname: portable-skill\r\ndescription: Use for portable skill parsing.\r\n---\r\n# Body\r\n');
  assert.equal(lf.valid, true);
  assert.equal(crlf.valid, true);
  assert.deepEqual(crlf.data, lf.data);
  assert.equal(lf.body, '# Body\n');
  assert.equal(crlf.body, '# Body\r\n');
});

test('canonical schema manifest compiles under Draft 2020-12 and matches the embedded bundle', () => {
  const ajv = new Ajv2020({
    allErrors: true,
    strictSchema: true,
    strictRequired: true,
    strictTypes: false,
    strictTuples: false,
    validateFormats: false
  });
  for (const { entry, value } of canonicalSchemas) {
    assert.equal(value.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(value.$id, entry.id);
    ajv.addSchema(value);
  }
  for (const { entry } of canonicalSchemas) assert.ok(ajv.getSchema(entry.id), `${entry.id} must compile`);
  assert.deepEqual(CONTRACT_SCHEMAS, canonicalSchemas.map(({ value }) => value));
});

test('checked-in root and web generated bundles, type facades, and validators remain converged', async () => {
  const rootBundle = await readFile(path.join(repo, 'src/contracts/generated/schema-bundle.ts'), 'utf8');
  const webBundle = await readFile(path.join(repo, 'apps/web/lib/contracts/generated/schema-bundle.ts'), 'utf8');
  const rootTypes = await readFile(path.join(repo, 'src/contracts/generated/types.ts'), 'utf8');
  const webTypes = await readFile(path.join(repo, 'apps/web/lib/contracts/generated/types.ts'), 'utf8');
  const rootValidator = await readFile(path.join(repo, 'src/contracts/validate.ts'), 'utf8');
  const webValidator = await readFile(path.join(repo, 'apps/web/lib/contracts/generated/validate.server.ts'), 'utf8');
  const rootEvalSemantics = await readFile(path.join(repo, 'src/contracts/eval-semantics.ts'), 'utf8');
  const webEvalSemantics = await readFile(path.join(repo, 'apps/web/lib/contracts/generated/eval-semantics.ts'), 'utf8');
  const rootFixturePath = await readFile(path.join(repo, 'src/contracts/fixture-path.ts'), 'utf8');
  const webFixturePath = await readFile(path.join(repo, 'apps/web/lib/contracts/generated/fixture-path.ts'), 'utf8');
  assert.equal(webBundle, rootBundle);
  assert.equal(webTypes, rootTypes);
  assert.notEqual(webValidator, rootValidator);
  assert.match(webValidator, /CONTRACT_STANDALONE_VALIDATORS/);
  assert.doesNotMatch(webValidator, /Ajv2020|ajv\/dist|cloudflareStaticValidation|new Function|\beval\s*\(/);
  assert.equal(webEvalSemantics,
    `// Generated by scripts/generate-contracts.mjs from src/contracts/eval-semantics.ts. Do not edit by hand.\n${rootEvalSemantics}`);
  assert.equal(webFixturePath,
    `// Generated by scripts/generate-contracts.mjs from src/contracts/fixture-path.ts. Do not edit by hand.\n${rootFixturePath}`);
  assert.match(rootTypes, /interface EvalSuiteCaseV3[\s\S]*qualifiedSkillId\?: SkillId;/);
  assert.match(rootTypes, /interface EvalBaselineV3[\s\S]*provenance: EvalBaselineProvenanceV3;/);
  assert.match(rootTypes, /interface EvalRunCaseResultV3[\s\S]*qualifiedSkillId\?: SkillId;/);
});

test('Cloudflare-static mode uses generated standalone validators for adversarial contract cases', async () => {
  const eventSchemaId = IDS['event-v1'];
  const workspaceId = WORKSPACE_ID;
  const revisionRef = {
    workspaceId,
    revisionId: REVISION_ID,
    workspaceRevision: SHA_A,
    effectiveDigest: SHA_B,
    effectiveRevisionDigest: SHA_C
  };
  const validEvent = {
    kind: 'skillmap.event.revision-published',
    schemaVersion: 1,
    eventId: EVENT_ID,
    sequence: '1',
    workspaceId,
    occurredAt: NOW,
    revision: revisionRef,
    redactionClassification: 'metadata-only',
    previousRevisionId: null
  };
  const cases = {
    valid: validEvent,
    invalidType: { ...validEvent, schemaVersion: '1' },
    missingRequired: Object.fromEntries(Object.entries(validEvent).filter(([key]) => key !== 'previousRevisionId')),
    additionalProperty: { ...validEvent, unexpected: true },
    invalidFormat: { ...validEvent, occurredAt: '2026-02-30T12:00:00.000Z' }
  };
  const childScript = `
    import { validateContract } from './dist/contracts/validate.js';
    const cases = ${JSON.stringify(cases)};
    const result = Object.fromEntries(Object.entries(cases).map(([name, value]) => [name, validateContract(${JSON.stringify(eventSchemaId)}, value)]));
    let unknownSchemaError = null;
    try { validateContract('https://skillmap.dev/contracts/unknown.schema.json', {}); } catch (error) { unknownSchemaError = error instanceof Error ? error.message : String(error); }
    process.stdout.write(JSON.stringify({ result, unknownSchemaError }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: repo,
    env: { ...process.env, SKILLMAP_CONTRACT_VALIDATION_MODE: 'cloudflare-static', NEXT_PUBLIC_SKILLMAP_CONTRACT_VALIDATION_MODE: 'cloudflare-static' }
  });
  const output = JSON.parse(stdout);
  assert.equal(output.result.valid.ok, true);
  assert.equal(output.result.invalidType.ok, false);
  assert.equal(output.result.missingRequired.ok, false);
  assert.equal(output.result.additionalProperty.ok, false);
  assert.equal(output.result.invalidFormat.ok, false);
  assert.ok(output.result.invalidType.issues.length > 0);
  assert.match(output.result.missingRequired.issues.map((issue) => issue.keyword).join(' '), /required/);
  assert.match(output.result.additionalProperty.issues.map((issue) => issue.keyword).join(' '), /additionalProperties/);
  assert.match(output.result.invalidFormat.issues.map((issue) => issue.keyword).join(' '), /format/);
  assert.match(output.unknownSchemaError, /Unknown SkillMap contract schema/);
});

test('generated standalone validator modules are root/web-identical and Worker-safe', async () => {
  const rootStandalone = await readFile(path.join(repo, 'src/contracts/generated/standalone-validators.ts'), 'utf8');
  const webStandalone = await readFile(path.join(repo, 'apps/web/lib/contracts/generated/standalone-validators.ts'), 'utf8');
  assert.equal(webStandalone, rootStandalone);
  assert.match(rootStandalone, /CONTRACT_STANDALONE_VALIDATORS/);
  assert.doesNotMatch(rootStandalone, /new Function|\beval\s*\(|\brequire\s*\(/i);
});

test('contract generator keeps standalone roots collision-free and idempotent', async () => {
  const generatedPaths = [
    'src/contracts/generated/schema-bundle.ts',
    'src/contracts/generated/types.ts',
    'src/contracts/generated/standalone-validators.ts',
    'apps/web/lib/contracts/generated/schema-bundle.ts',
    'apps/web/lib/contracts/generated/types.ts',
    'apps/web/lib/contracts/generated/standalone-validators.ts',
    'apps/web/lib/contracts/generated/validate.server.ts',
    'apps/web/lib/contracts/generated/hosted-api-response-validator.ts',
    'apps/web/lib/contracts/generated/eval-semantics.ts',
    'apps/web/lib/contracts/generated/route-ranking.ts',
    'apps/web/lib/contracts/generated/fixture-path.ts'
  ];
  const runGenerator = () => execFileAsync(process.execPath, ['scripts/generate-contracts.mjs'], { cwd: repo });
  await runGenerator();
  const first = await Promise.all(generatedPaths.map((relativePath) => readFile(path.join(repo, relativePath))));
  await runGenerator();
  const second = await Promise.all(generatedPaths.map((relativePath) => readFile(path.join(repo, relativePath))));
  assert.deepEqual(second, first, 'a second normal generation must not change any generated output');

  const standalone = second[2].toString('utf8');
  const exportedRoots = [...standalone.matchAll(/export const (contractSchema\d+) =/g)].map((match) => match[1]);
  assert.equal(exportedRoots.length, manifest.schemas.length);
  assert.equal(new Set(exportedRoots).size, exportedRoots.length, 'standalone validator exports must be unique');
  assert.doesNotMatch(standalone, /export const schema\d+\s*=/, 'manifest roots must not use Ajv internal schema names');

  const standaloneEntries = [...standalone.matchAll(/\n  "([^"]+)": (contractSchema\d+),?/g)];
  assert.deepEqual(standaloneEntries.map(([, schemaId]) => schemaId), manifest.schemas.map(({ id }) => id));
  assert.equal(new Set(standaloneEntries.map(([, schemaId]) => schemaId)).size, manifest.schemas.length);
  assert.equal(new Set(manifest.schemas.map(({ id }) => id)).size, manifest.schemas.length, 'manifest schema IDs must be unique');
});

function normalizeOnlySchemaId(schema) {
  const normalized = structuredClone(schema);
  delete normalized.$id;
  return normalized;
}

function readGeneratedHostedApiErrorSchema(source) {
  const match = source.match(/const schema\d+ = (\{[\s\S]*?\});const pattern/);
  assert.ok(match, 'generated hosted API error validator must embed its derived schema');
  return JSON.parse(match[1]);
}

test('generated hosted API error validator is narrow, canonical, and Worker-safe', async () => {
  const source = await readFile(path.join(repo, 'apps/web/lib/contracts/generated/hosted-api-response-validator.ts'), 'utf8');
  assert.match(source, /HOSTED_API_ERROR_SCHEMA_ID/);
  assert.match(source, /validateHostedApiErrorResponse/);
  assert.doesNotMatch(source, /Ajv|new Function|\beval\s*\(|\brequire\s*\(/i);
  assert.ok(source.length < 20_000, `Narrow hosted API validator unexpectedly grew to ${source.length} bytes.`);

  const canonicalHostedApiResponse = canonicalSchemas.find(({ entry }) => entry.id === IDS['hosted-api-response-v1']).value;
  const generatedSchema = readGeneratedHostedApiErrorSchema(source);
  assert.equal(generatedSchema.$id, 'https://skillmap.dev/contracts/hosted-api-error/v1.schema.json');
  assert.deepEqual(
    normalizeOnlySchemaId(generatedSchema),
    normalizeOnlySchemaId(canonicalHostedApiResponse.$defs.Error),
    'derived hosted API error schema must stay structurally identical to canonical $defs.Error'
  );
});

test('fixture path classification includes fixture directory boundaries on POSIX and Windows', () => {
  for (const fixturePath of [
    '/workspace/test/fixtures',
    '/workspace/test/fixtures/basic',
    'C:\\workspace\\test\\fixtures',
    'C:\\workspace\\test\\fixtures\\basic'
  ]) {
    assert.equal(isFixturePath(fixturePath), true, fixturePath);
    assert.equal(inferScope(fixturePath, '/workspace'), 'fixture', fixturePath);
    assert.equal(inferClientHints(fixturePath).includes('fixture'), true, fixturePath);
  }
  assert.equal(isFixturePath('/workspace/test/fixtures-old'), false);
  assert.equal(isFixturePath('/workspace/approved-skills/fixtures/SKILL.md'), false);
  assert.equal(isFixturePath('/workspace/approved-skills/my-fixtures/SKILL.md'), false);
});

test('status derives fixture state from a nested path even when stale scope claims project', () => {
  const inventory = clone(releaseEffectiveEvidence(true, REVISION_ID, SHA_A).effective.inventory);
  inventory.roots = ['/tmp/workspace/test'];
  inventory.skills[0].scope = 'project';
  inventory.skills[0].clientHints = [];
  inventory.skills[0].relativePath = 'fixtures';
  inventory.skills[0].path = '/tmp/workspace/test/fixtures/SKILL.md';
  assert.equal(inventoryHasFixtureRoots(inventory), true);
});

test('canonicalization vectors remain stable', async () => {
  const vectors = JSON.parse(await readFile(path.join(repo, 'contracts/test-vectors/canonicalization-v1.json'), 'utf8')).vectors;
  const first = vectors[0];
  assert.equal(canonicalPayloadJson(first.input), first.canonicalPayloadJson);
  assert.equal(computePayloadDigest(first.input), first.payloadDigest);
  const hostile = JSON.parse(vectors[1].inputJson);
  assert.equal(canonicalPayloadJson(hostile), vectors[1].canonicalPayloadJson);
  assert.match(canonicalJson(hostile), /"__proto__"/);
  assert.equal(canonicalPayloadJson(vectors[2].input), vectors[2].canonicalPayloadJson);
});

test('every canonical product contract accepts its valid bounded vector', () => {
  assert.equal(manifest.schemas.length, 41, 'canonical contract manifest count is frozen');
  assert.equal(validVectors.size, 30, 'generic valid-vector count is frozen');
  assert.equal(dedicatedContractSchemas.size, 10, 'dedicated definitions/hosted contract count is frozen');
  assert.equal(validVectors.size + dedicatedContractSchemas.size, 40,
    'all product schemas except the canonical common definitions need a generic or dedicated valid vector');
  for (const [schemaId, vector] of validVectors) assertValid(schemaId, vector);
});

test('every product contract rejects an unknown top-level property', () => {
  for (const [schemaId, vector] of validVectors) {
    const poisoned = { ...clone(vector), unexpectedField: true };
    assertInvalid(schemaId, poisoned, /additionalProperties|oneOf/);
  }
});

test('semantic validation rejects tamper, unsafe job receipts, contradictory feedback, and disallowed sync direction', () => {
  const tamperedRoute = routeResult();
  tamperedRoute.decision.hookText = 'tampered';
  assertInvalid(IDS['route-result-v2'], tamperedRoute, /decisionDigest/);

  const unsafeJob = {
    ...job(),
    state: 'succeeded',
    startedAt: NOW,
    completedAt: LATER,
    resultReceipt: { outputPath: 'private' }
  };
  assertInvalid(IDS['job-v1'], unsafeJob, /privacy/);

  const impossibleTimestampJob = { ...job(), createdAt: '2026-02-30T12:00:00Z' };
  assertInvalid(IDS['job-v1'], impossibleTimestampJob, /skillmap-utc-timestamp|format/);

  const contradictoryFeedback = feedback();
  contradictoryFeedback.unsafeSkillIds = [SKILL_ID];
  contradictoryFeedback.payloadDigest = computePayloadDigest(contradictoryFeedback);
  assertInvalid(IDS['route-feedback-v1'], contradictoryFeedback, /disjoint/);

  const wrongDirection = syncEnvelope();
  wrongDirection.direction = 'cloud-to-local';
  wrongDirection.payloadDigest = computePayloadDigest(wrongDirection);
  assertInvalid(IDS['sync-envelope-v1'], wrongDirection, /signature|syncDirection/);
});

test('eval run v3 rejects contradictory derived claims after payload redigest', () => {
  const cases = [
    ['threshold result', (run) => { run.thresholdPass = true; }, /thresholdPass/],
    ['release eligibility', (run) => { run.releaseEvidenceEligible = true; }, /releaseEvidenceEligible/],
    ['overall pass', (run) => { run.pass = true; }, /\/pass|pass/],
    ['composition', (run) => { run.composition.implicitNatural = 0; }, /composition/],
    ['holdout', (run) => { run.holdout.pass = true; }, /holdout/],
    ['leakage', (run) => { run.leakage.pass = false; }, /leakage/],
    ['baseline comparison', (run) => { run.baselineComparison.pass = true; }, /baselineComparison/],
    ['metric count', (run) => { run.metrics.top1 = 0; }, /metrics/],
    ['invalid case count', (run) => { run.invalidCaseCount = 1; }, /invalidCaseCount/],
    ['case hit flag', (run) => { run.caseResults[0].top1Hit = false; }, /top1Hit/],
    ['case outcome', (run) => { run.caseResults[0].outcome = 'miss'; }, /outcome/],
    ['workspace binding', (run) => { run.workspaceId = ROOT_ID; }, /workspaceId/],
    ['approved revision binding', (run) => { run.revision.effectiveRevisionDigest = null; }, /effectiveRevisionDigest/]
  ];
  for (const [label, mutate, pattern] of cases) {
    const run = evalRunV3();
    mutate(run);
    run.payloadDigest = computePayloadDigest(run);
    assertInvalid(IDS['eval-run-v3'], run, pattern);
  }

  const staleDigest = evalRunV3();
  staleDigest.metrics.top3 = 0;
  assertInvalid(IDS['eval-run-v3'], staleDigest, /payloadDigest/);
});

test('eval run v3 requires a validated companion suite before granting release evidence', () => {
  const suite = releaseEvalSuiteV3();
  const context = releaseEvalContext(suite);
  const run = releaseEvalRunV3(suite, context);
  assertInvalid(IDS['eval-run-v3'], run, /releaseContext|releaseEvidenceEligible/);
  assertValidEvalRunWithContext(run, context);

  const nonPlainRun = Object.assign(new (class ContractCarrier {})(), run);
  assertInvalid(IDS['eval-run-v3'], nonPlainRun, /jsonDataModel|plain JSON/);

  const inheritedBaselineRun = releaseEvalRunV3(suite, context);
  inheritedBaselineRun.baseline = Object.create(inheritedBaselineRun.baseline);
  assertInvalidEvalRunWithContext(inheritedBaselineRun, context, /jsonDataModel|semanticValidation|plain JSON/);
});

test('eval suite v3 admits qualified identity only for an explicit expected label', () => {
  const suite = evalSuiteV3();
  suite.cases[0].primaryCaseType = 'explicit';
  suite.cases[0].qualifiedSkillId = SKILL_ID;
  suite.cases[0].prompt = '';
  refreshEvalSuiteV3(suite);
  assertValid(IDS['eval-suite-v3'], suite);

  suite.cases[0].primaryCaseType = 'implicit-natural';
  refreshEvalSuiteV3(suite);
  assertInvalid(IDS['eval-suite-v3'], suite, /qualifiedSkillId|explicit case/);
});

test('contextual eval v3 replays a blank qualified invocation as the exact pinned skill', () => {
  const suite = releaseEvalSuiteV3();
  suite.cases.push({
    caseId: 'evalcase_qualifiedblank0001',
    prompt: '',
    expectedSkillIds: [SKILL_ID],
    avoidSkillIds: [],
    qualifiedSkillId: SKILL_ID,
    primaryCaseType: 'explicit',
    membership: 'train',
    labelProvenance: { author: 'operator', sourceClass: 'operator-authored', createdAt: NOW, reviewedAt: LATER }
  });
  refreshEvalSuiteV3(suite);
  const context = releaseEvalContext(suite);
  const run = releaseEvalRunV3(suite, context);
  assertValidEvalRunWithContext(run, context);
  assert.deepEqual(run.caseResults.at(-1).recommendedSkillIds, [SKILL_ID]);
  assert.equal(run.caseResults.at(-1).releaseCounted, false);
});

test('release replay byte budget admits a realistic 150-skill pair and rejects byte-heavy or phrase-heavy registries', () => {
  const skills = Array.from({ length: 150 }, (_, index) => ({
    skillId: `sk_${String(index).padStart(43, '0')}`,
    name: `skill-${index}`,
    description: `Reviewed routing description ${'x'.repeat(480)}`,
    tier: 'specialist',
    path: `/approved/skill-${index}`,
    aliases: [`alias-${index}`, `alternate-${index}`],
    preferredFor: [`reviewed workflow ${index}`],
    avoidFor: [`unrelated workflow ${index}`],
    supersedes: [],
    routeEligible: true,
    qualifiedExplicitAllowed: true,
    variantState: 'unique',
    hasScripts: false
  }));
  const cases = Array.from({ length: 150 }, (_, index) => ({
    prompt: `Reviewed natural routing prompt ${String(index).padStart(3, '0')} ${'p'.repeat(120)}`
  }));
  const realisticWork = computeEvalRouteReplayWorkUnits(cases, skills, skills);
  assert.ok(realisticWork < EVAL_RELEASE_ROUTE_WORK_LIMIT, `${realisticWork} should fit the calibrated byte-work budget`);

  const hostile = clone(skills);
  hostile[0].aliases = Array.from({ length: 256 }, (_, index) => `${'x'.repeat(3990)}${String(index).padStart(3, '0')}`);
  assert.ok(computeEvalRouteReplayWorkUnits(cases, hostile, skills) > EVAL_RELEASE_ROUTE_WORK_LIMIT);

  const phraseHeavy = [{
    ...clone(skills[0]),
    aliases: Array.from({ length: 1000 }, (_, index) => `a${index}`),
    preferredFor: Array.from({ length: 1000 }, (_, index) => `p${index}`),
    avoidFor: Array.from({ length: 1000 }, (_, index) => `v${index}`)
  }];
  const maximumPrompts = Array.from({ length: 150 }, () => ({ prompt: 'q'.repeat(32 * 1024) }));
  assert.ok(
    computeEvalRouteReplayWorkUnits(maximumPrompts, phraseHeavy, []) > EVAL_RELEASE_ROUTE_WORK_LIMIT,
    'thousands of short phrase scans over maximum prompts must be rejected before routing'
  );
});

test('operational eval v3 preflights replay work and records completion after routing', () => {
  const suite = releaseEvalSuiteV3();
  const context = releaseEvalContext(suite);
  const effective = JSON.parse(context.effectiveArtifact);
  const run = evaluateEvalSuiteV3(effective, suite, {
    revision: clone(context.approvedRevision),
    effectiveArtifact: context.effectiveArtifact,
    baselineEffectiveArtifact: context.baselineEffectiveArtifact,
    approvedBaselineRevision: clone(context.approvedBaselineRevision),
    startedAt: RUN_STARTED,
    now: () => new Date(RUN_FINISHED)
  });
  assert.equal(run.startedAt, RUN_STARTED);
  assert.equal(run.finishedAt, RUN_FINISHED);
  assert.equal(run.releaseEvidenceEligible, true);
  assert.equal(run.pass, true);

  const tooManyCases = clone(suite);
  tooManyCases.cases = Array.from({ length: 10001 }, (_, index) => ({
    ...clone(suite.cases[0]),
    caseId: `evalcase_preflight${String(index).padStart(8, '0')}`,
    prompt: index === 0 ? 'must-not-route\u0000' : `preflight case ${index}`
  }));
  assert.throws(() => evaluateEvalSuiteV3(effective, tooManyCases, {
    revision: clone(context.approvedRevision),
    effectiveArtifact: context.effectiveArtifact,
    baselineEffectiveArtifact: context.baselineEffectiveArtifact,
    approvedBaselineRevision: clone(context.approvedBaselineRevision),
    startedAt: RUN_STARTED
  }), /case replay limit before routing/);

  const oversizedRegistry = clone(effective);
  oversizedRegistry.skills[0].aliases = Array.from({ length: 256 }, (_, index) =>
    `${'x'.repeat(3990)}${String(index).padStart(3, '0')}`);
  const noRouteSuite = clone(suite);
  noRouteSuite.cases[0].prompt = 'must-not-route\u0000';
  assert.throws(() => evaluateEvalSuiteV3(oversizedRegistry, noRouteSuite, {
    revision: clone(context.approvedRevision),
    effectiveArtifact: context.effectiveArtifact,
    baselineEffectiveArtifact: context.baselineEffectiveArtifact,
    approvedBaselineRevision: clone(context.approvedBaselineRevision),
    startedAt: RUN_STARTED
  }), /byte work budget before routing/);
});

test('legacy eval v2 parsing shares the runtime NUL and UTF-8 prompt boundary', () => {
  const suite = (prompt) => ({ version: 2, evals: [{ prompt, expected: ['frontend-design'] }] });
  assert.equal(parseEvalSuite(suite('review this interface')).evals[0].prompt, 'review this interface');
  assert.throws(() => parseEvalSuite(suite('review\u0000this')), /forbidden NUL byte/);
  assert.throws(() => parseEvalSuite(suite('😀'.repeat(9000))), /32768-byte limit/);
});

test('status consumes the receipt-verified v3 snapshot and rejects carried stale routing evidence', async t => {
  const suite = releaseEvalSuiteV3();
  const context = releaseEvalContext(suite);
  const run = releaseEvalRunV3(suite, context);
  const effective = JSON.parse(context.effectiveArtifact);
  const cwd = await mkdtemp(path.join(tmpdir(), 'skillmap-v3-status-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const dir = path.join(cwd, '.skillmap');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'inventory.json'), `${JSON.stringify(effective.inventory, null, 2)}\n`);
  await writeFile(path.join(dir, 'effective.json'), context.effectiveArtifact);
  const forgedPlainRead = clone(run);
  forgedPlainRead.metrics.top1Rate = 0;
  await writeFile(path.join(dir, 'eval-report.json'), `${JSON.stringify(forgedPlainRead, null, 2)}\n`);

  const status = await buildSkillMapStatus(cwd, {
    immutableRevision: true,
    servingRevision: clone(context.approvedRevision),
    evalReleaseSnapshot: { report: run, context }
  });
  assert.equal(status.eval.releaseEvidenceEligible, true, JSON.stringify(status.eval.evidenceIssues));
  assert.equal(status.eval.top1Rate, 1, 'status must project the receipt-verified report, not a second plain read');

  const staleStatus = await buildSkillMapStatus(cwd, {
    immutableRevision: true,
    servingRevision: {
      ...clone(context.approvedRevision),
      effectiveDigest: `sha256:${'e'.repeat(64)}`,
      effectiveRevisionDigest: `sha256:${'f'.repeat(64)}`
    },
    evalReleaseSnapshot: { report: run, context }
  });
  assert.equal(staleStatus.eval.releaseEvidenceEligible, false);
  assert.match(staleStatus.eval.evidenceIssues.join('\n'), /stale for the current serving revision/);
});

test('contextual eval run v3 rejects hostile release mutations', () => {
  const suite = releaseEvalSuiteV3();
  const context = releaseEvalContext(suite);
  const cases = [
    ['fixture eligibility', (run) => { run.fixture = true; }, /releaseEvidenceEligible|pass|evidenceLevel/],
    ['declared threshold', (run) => { run.thresholds.minCount = 151; }, /thresholdPass|pass|evidenceLevel/],
    ['composition arithmetic', (run) => { run.composition.implicitNatural = 99; run.composition.explicit = 1; }, /composition/],
    ['metric arithmetic', (run) => { run.metrics.top1 = 124; }, /metrics/],
    ['rate arithmetic', (run) => { run.metrics.top3Rate = 0.99; }, /metrics/],
    ['advisory arithmetic', (run) => { run.caseResults[0].advisoryBytes = 81; }, /metrics/],
    ['holdout arithmetic', (run) => { run.holdout.count = 29; }, /holdout/],
    ['baseline inputs', (run) => { run.baseline.meanAdvisoryBytes = 80; }, /baseline|baselineComparison/],
    ['baseline comparison list', (run) => { run.baselineComparison.improvements = []; }, /baselineComparison/],
    ['release eligibility claim', (run) => { run.releaseEvidenceEligible = false; }, /releaseEvidenceEligible/],
    ['threshold claim', (run) => { run.thresholdPass = false; }, /thresholdPass/],
    ['pass claim', (run) => { run.pass = false; }, /\/pass|pass/],
    ['evidence level claim', (run) => { run.evidenceLevel = 'candidate'; }, /evidenceLevel/],
    ['case release scoring', (run) => { run.caseResults[0].releaseScored = false; }, /releaseScored/],
    ['unbound qualified identity', (run) => { run.caseResults[0].qualifiedSkillId = SKILL_ID; }, /qualifiedSkillId/],
    ['rank-four top-three claim', (run) => {
      run.caseResults[0].recommendedSkillIds = [SKILL_ID_C, SKILL_ID_D, SKILL_ID_E, SKILL_ID];
    }, /maxItems|top3Hit|outcome/],
    ['case avoidance intersection', (run) => { run.caseResults[125].recommendedSkillIds = [SKILL_ID]; }, /avoidedButRecommendedSkillIds|abstained|outcome/],
    ['case validation projection', (run) => {
      run.caseResults[0].validationCodes = ['CASE_LABEL_COUNT_INVALID'];
      run.caseResults[0].reasonCodes = ['CASE_INVALID', 'CASE_LABEL_COUNT_INVALID'];
      run.caseResults[0].outcome = 'invalid';
    }, /releaseCounted|invalidCaseCount|validationErrors|composition/],
    ['case leakage projection', (run) => {
      run.caseResults[0].leakageCodes = ['TARGET_LEAKAGE'];
      run.caseResults[0].reasonCodes = ['CASE_INVALID', 'TARGET_LEAKAGE'];
      run.caseResults[0].outcome = 'invalid';
    }, /leakage|releaseEvidenceEligible|pass/],
    ['reason code', (run) => { run.caseResults[0].reasonCodes = ['EXPECTED_TOP3']; }, /reasonCodes/],
    ['workspace binding', (run) => { run.revision.workspaceId = ROOT_ID; }, /workspaceId/],
    ['effective digest binding', (run) => { run.revision.effectiveDigest = null; }, /effectiveDigest/]
  ];
  for (const [label, mutate, pattern] of cases) {
    const run = releaseEvalRunV3(suite, context);
    mutate(run);
    run.payloadDigest = computePayloadDigest(run);
    assertInvalidEvalRunWithContext(run, context, pattern);
  }

  const suiteDigestTamper = evalSuiteV3();
  suiteDigestTamper.datasetDigest = SHA_B;
  suiteDigestTamper.payloadDigest = computePayloadDigest(suiteDigestTamper);
  assertInvalid(IDS['eval-suite-v3'], suiteDigestTamper, /datasetDigest/);
});

test('contextual eval run v3 rejects invalid or mismatched companion suites', () => {
  const cases = [
    ['suite id', (run) => { run.suiteId = 'evalsuite_other0001'; run.payloadDigest = computePayloadDigest(run); }, /suiteId/],
    ['dataset digest', (run) => { run.datasetDigest = SHA_B; run.payloadDigest = computePayloadDigest(run); }, /datasetDigest/],
    ['provenance completeness', (run, suite) => {
      delete suite.provenance.labelAuthor;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /companionSuite\/provenance|required|labelAuthor/],
    ['reviewer completeness', (run, suite) => {
      suite.provenance.reviewedBy = '   ';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /reviewedBy|datasetProvenance/],
    ['case provenance author', (run, suite) => {
      suite.cases[0].labelProvenance.author = '   ';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /labelProvenance|author/],
    ['case provenance timestamp', (run, suite) => {
      suite.cases[0].labelProvenance.reviewedAt = '2026-02-30T12:00:00Z';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /timestampOrder|real UTC dates/],
    ['case reviewed after freeze', (run, suite) => {
      suite.cases[0].labelProvenance.reviewedAt = BASELINE_COMPLETED;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /timestampOrder|prior timestamp/],
    ['baseline completed before freeze', (run, suite) => {
      suite.baseline.provenance.completedAt = LATER;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /timestampOrder|prior timestamp/],
    ['dataset reviewed before baseline', (run, suite) => {
      suite.provenance.reviewedAt = HOLDOUT_FROZEN;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /timestampOrder|prior timestamp/],
    ['normalized empty prompt', (run, suite) => {
      suite.cases[0].prompt = '   !!!   ';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /prompt|normalization/],
    ['holdout freeze', (run, suite) => {
      suite.provenance.holdoutFrozen = false;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /holdoutFrozen/],
    ['deduplication declaration', (run, suite) => {
      suite.provenance.deduplicationResult = 'failed';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /deduplicationResult/],
    ['actual normalized prompt deduplication', (run, suite) => {
      suite.cases[1].prompt = `  ${suite.cases[0].prompt.toUpperCase()}!!! `;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /duplicates normalized prompt/],
    ['holdout membership', (run, suite) => {
      suite.cases[0].membership = 'train';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /membership|holdout/],
    ['case identity', (run, suite) => {
      suite.cases[0].caseId = 'evalcase_replaced00000001';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /caseId|ordered/],
    ['ordered case set', (run, suite) => {
      [suite.cases[0], suite.cases[1]] = [suite.cases[1], suite.cases[0]];
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /caseId|ordered/],
    ['expected labels', (run, suite) => {
      suite.cases[0].expectedSkillIds = [SKILL_ID_B];
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /expectedSkillIds/],
    ['baseline binding', (run, suite) => {
      suite.baseline.meanAdvisoryBytes = 101;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /baseline/]
  ];
  for (const [label, mutate, pattern] of cases) {
    const suite = releaseEvalSuiteV3();
    const context = releaseEvalContext(suite);
    const run = releaseEvalRunV3(suite, context);
    mutate(run, suite, context);
    assertInvalidEvalRunWithContext(run, context, pattern);
  }
});

test('contextual eval release binds the trusted revision, effective registry, real router, leakage, and freeze receipts', () => {
  const cases = [
    ['stale approved revision', (run) => {
      run.revision.workspaceRevision = SHA_B;
      run.payloadDigest = computePayloadDigest(run);
    }, /trusted approved state-store revision/],
    ['effective artifact bytes', (_run, _suite, context) => {
      context.effectiveArtifact += '\n';
    }, /effectiveDigest/],
    ['effective semantic digest', (run, _suite, context) => {
      const effective = JSON.parse(context.effectiveArtifact);
      effective.skills[0].aliases.push('new-reviewed-alias');
      context.effectiveArtifact = `${JSON.stringify(effective, null, 2)}\n`;
      const digest = `sha256:${createHash('sha256').update(context.effectiveArtifact).digest('hex')}`;
      context.approvedRevision.effectiveDigest = digest;
      run.revision.effectiveDigest = digest;
      run.payloadDigest = computePayloadDigest(run);
    }, /effectiveRevisionDigest/],
    ['unknown expected identity', (run, suite) => {
      suite.cases[0].expectedSkillIds = [SKILL_ID_C];
      run.caseResults[0].expectedSkillIds = [SKILL_ID_C];
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /unknown expected skillId/],
    ['display-name leakage', (run, suite) => {
      suite.cases[0].prompt = 'Use frontend-design for this reviewed scenario';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /leakageCodes|DISPLAY_NAME_LEAKAGE/],
    ['alias leakage', (run, suite) => {
      suite.cases[0].prompt = 'Use visual-craft for this reviewed scenario';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /leakageCodes|ALIAS_LEAKAGE/],
    ['description leakage', (run, suite) => {
      suite.cases[0].prompt = 'Crafts resilient presentation systems for product teams in scenario 001';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /leakageCodes|DESCRIPTION_LEAKAGE/],
    ['runtime NUL prompt boundary', (run, suite) => {
      suite.cases[0].prompt = 'Improve a responsive interface\u0000 scenario 001';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /routePrompt|runtime route prompt boundary/],
    ['runtime UTF-8 prompt byte boundary', (run, suite) => {
      suite.cases[0].prompt = `Improve a responsive interface ${'😀'.repeat(9000)}`;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /routePrompt|runtime route prompt boundary/],
    ['reported recommendation forgery', (run, suite) => {
      suite.cases[0].prompt = 'Assess an unrelated finance ledger scenario 001';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /deterministic approved-registry route result/],
    ['synthetic dataset provenance', (run, suite) => {
      suite.provenance.sourceClass = 'synthetic';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /non-synthetic/],
    ['synthetic case provenance', (run, suite) => {
      suite.cases[0].labelProvenance.sourceClass = 'synthetic';
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /must not use synthetic provenance/],
    ['run before dataset review', (run) => {
      run.startedAt = BASELINE_COMPLETED;
      run.payloadDigest = computePayloadDigest(run);
    }, /after the reviewed frozen suite/],
    ['fixture-derived context', (run, _suite, context) => {
      const effective = JSON.parse(context.effectiveArtifact);
      effective.inventory.skills[0].scope = 'fixture';
      effective.skills[0].scope = 'fixture';
      context.effectiveArtifact = `${JSON.stringify(effective, null, 2)}\n`;
      context.approvedRevision.effectiveDigest = `sha256:${createHash('sha256').update(context.effectiveArtifact).digest('hex')}`;
      context.approvedRevision.effectiveRevisionDigest = computeEffectiveRevisionDigest(effective);
      run.revision = clone(context.approvedRevision);
      run.payloadDigest = computePayloadDigest(run);
    }, /fixture state true/],
    ['exact fixture-root context', (run, _suite, context) => {
      const effective = JSON.parse(context.effectiveArtifact);
      effective.inventory.roots = ['/tmp/workspace/test/fixtures'];
      context.effectiveArtifact = `${JSON.stringify(effective, null, 2)}\n`;
      context.approvedRevision.effectiveDigest = `sha256:${createHash('sha256').update(context.effectiveArtifact).digest('hex')}`;
      context.approvedRevision.effectiveRevisionDigest = computeEffectiveRevisionDigest(effective);
      run.revision = clone(context.approvedRevision);
      run.payloadDigest = computePayloadDigest(run);
    }, /fixture state true/],
    ['fixture child under a non-fixture configured root', (run, _suite, context) => {
      const effective = JSON.parse(context.effectiveArtifact);
      effective.inventory.roots = ['/tmp/workspace/test'];
      effective.inventory.skills[0].root = '/tmp/workspace/test';
      effective.inventory.skills[0].relativePath = 'fixtures';
      effective.inventory.skills[0].path = '/tmp/workspace/test/fixtures/SKILL.md';
      effective.skills[0].relativePath = 'fixtures';
      effective.skills[0].path = '/tmp/workspace/test/fixtures/SKILL.md';
      context.effectiveArtifact = `${JSON.stringify(effective, null, 2)}\n`;
      context.approvedRevision.effectiveDigest = `sha256:${createHash('sha256').update(context.effectiveArtifact).digest('hex')}`;
      context.approvedRevision.effectiveRevisionDigest = computeEffectiveRevisionDigest(effective);
      run.revision = clone(context.approvedRevision);
      run.payloadDigest = computePayloadDigest(run);
    }, /fixture state true/],
    ['release replay work budget', (run, suite) => {
      const template = suite.cases[0];
      suite.cases = Array.from({ length: 10001 }, (_, index) => ({
        ...clone(template),
        caseId: `evalcase_budget${String(index + 1).padStart(8, '0')}`,
        prompt: `Improve a responsive interface budget scenario ${String(index + 1).padStart(5, '0')}`
      }));
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /work budget/],
    ['long registry phrase work budget', (run, _suite, context) => {
      const effective = JSON.parse(context.effectiveArtifact);
      effective.skills[0].aliases = Array.from({ length: 256 }, (_, index) =>
        `${'x'.repeat(3990)}${String(index).padStart(3, '0')}`);
      context.effectiveArtifact = `${JSON.stringify(effective, null, 2)}\n`;
      context.approvedRevision.effectiveDigest = `sha256:${createHash('sha256').update(context.effectiveArtifact).digest('hex')}`;
      context.approvedRevision.effectiveRevisionDigest = computeEffectiveRevisionDigest(effective);
      run.revision = clone(context.approvedRevision);
      run.payloadDigest = computePayloadDigest(run);
    }, /work budget/],
    ['stale frozen case-set receipt', (run, suite) => {
      suite.cases[0].prompt = 'Improve a responsive interface changed after freeze';
      suite.datasetDigest = computeEvalSuiteV3DatasetDigest(suite);
      suite.payloadDigest = computePayloadDigest(suite);
      rebindEvalRunV3(run, suite);
    }, /caseSetDigest|frozen ordered case projection/],
    ['approved baseline requires historical artifact', (_run, _suite, context) => {
      context.baselineEffectiveArtifact = null;
    }, /historical effective artifact/],
    ['approved baseline requires independently resolved history', (_run, _suite, context) => {
      context.approvedBaselineRevision = null;
    }, /independently resolved from immutable history/],
    ['suite cannot invent an approved baseline revision', (run, suite) => {
      suite.baseline.provenance.sourceRevision.revisionId = 'r00000000000000000000-00000000-0000-4000-8000-000000000010';
      refreshEvalSuiteV3(suite);
      run.baseline = clone(suite.baseline);
      rebindEvalRunV3(run, suite);
    }, /independently resolved historical RevisionRef/],
    ['operator-declared baseline remains candidate-only', (run, suite) => {
      suite.baseline.provenance.sourceKind = 'operator-declared-no-skillmap';
      suite.baseline.provenance.sourceRevision = null;
      refreshEvalSuiteV3(suite);
      rebindEvalRunV3(run, suite);
    }, /cannot independently satisfy the release baseline gate/],
    ['historical baseline metrics', (run, suite) => {
      suite.baseline.top1Rate = 0.5;
      refreshEvalSuiteV3(suite);
      run.baseline = clone(suite.baseline);
      run.payloadDigest = computePayloadDigest(run);
    }, /historical approved-registry replay value/],
    ['current revision cannot masquerade as a weak historical baseline', (run, suite, context) => {
      suite.baseline.provenance.sourceRevision = clone(context.approvedRevision);
      context.baselineEffectiveArtifact = context.effectiveArtifact;
      context.approvedBaselineRevision = clone(context.approvedRevision);
      refreshEvalSuiteV3(suite);
      run.baseline = clone(suite.baseline);
      run.payloadDigest = computePayloadDigest(run);
    }, /must predate the current approved revision/]
  ];
  for (const [label, mutate, pattern] of cases) {
    const suite = releaseEvalSuiteV3();
    const context = releaseEvalContext(suite);
    const run = releaseEvalRunV3(suite, context);
    mutate(run, suite, context);
    assertInvalidEvalRunWithContext(run, context, pattern);
  }
});

test('redacted contracts reject raw prompt, absolute path, and secret canaries', () => {
  const rawPrompt = { ...routeResult(), prompt: 'raw input' };
  assertInvalid(IDS['route-result-v2'], rawPrompt, /additionalProperties/);

  const absolutePath = dashboardV3();
  absolutePath.status.summary = 'Found state in /home/operator/private';
  absolutePath.payloadDigest = computePayloadDigest(absolutePath);
  assertInvalid(IDS['dashboard-v3'], absolutePath, /privacy/);

  const secret = syncEnvelope();
  secret.payload.readiness = 'Bearer abcdefghijklmnopqrstuvwxyz';
  secret.payloadDigest = computePayloadDigest(secret);
  assertInvalid(IDS['sync-envelope-v1'], secret, /enum|privacy/);
});

test('route, API, job, event, and feedback producers emit their canonical contracts', async (t) => {
  const routeOutput = executeRouteUseCase({
    servingRevision: revision,
    currentRevision: revision,
    servingMode: 'current',
    warningCodes: [],
    effective: {
      skills: [{
        skillId: SKILL_ID,
        name: 'frontend-design',
        description: 'Design responsive interfaces',
        tier: 'active-default',
        aliases: [],
        preferredFor: ['responsive interfaces'],
        avoidFor: [],
        supersedes: [],
        routeEligible: true,
        qualifiedExplicitAllowed: true,
        variantState: 'unique',
        hasScripts: false
      }]
    }
  }, { prompt: 'Design a responsive interface', max: 3 });
  assertValid(IDS['route-result-v2'], routeOutput.result);

  const success = apiSuccess({ status: 'ok' }, {
    requestId: REQUEST_ID,
    servingRevision: revision,
    currentRevision: revision
  });
  assertValid(IDS['api-envelope-v1'], success);
  const failure = apiError('route unavailable', 'No approved routing state is available.', {
    requestId: '00000000-0000-4000-8000-000000000009',
    servingRevision: null,
    currentRevision: revision
  }, { retryable: true, details: { state: 'blocked' } });
  assertValid(IDS['api-envelope-v1'], failure);

  const cwd = await mkdtemp(path.join(tmpdir(), 'skillmap-contract-producers-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const created = await createJob(cwd, {
    kind: 'skillmap.job-request',
    schemaVersion: 1,
    expectedRevision: REVISION_ID,
    idempotencyKey: 'contract-producer-job-1',
    requestedBy: 'api',
    confirmation: 'none',
    parameters: { type: 'doctor' }
  });
  assertValid(IDS['job-v1'], created.stored.job);
  await transitionJob(cwd, created.stored.job.jobId, 'running');
  const finished = await transitionJob(cwd, created.stored.job.jobId, 'succeeded', {
    resultReceipt: { revisionId: REVISION_ID, checked: true }
  });
  assertValid(IDS['job-v1'], finished.job);

  const event = createRouteEvent(routeOutput.result, revision, 'api');
  assertValid(IDS['event-v1'], event);
  await recordRouteEvent(cwd, event);
  const recordedFeedback = await createAndRecordFeedback(cwd, {
    routeId: routeOutput.result.routeId,
    outcome: 'correct',
    reasonCode: 'operator-correct',
    idempotencyKey: 'contract-producer-feedback-1'
  });
  assertValid(IDS['route-feedback-v1'], recordedFeedback);
});

test('WorkspaceStateStore emits canonical manifest, current pointer, and state marker objects', async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'skillmap-contract-state-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const skillmap = path.join(cwd, '.skillmap');
  await mkdir(skillmap, { recursive: true });
  await writeFile(path.join(skillmap, 'config.yml'), 'version: 1\nprofile: personal-v1\nroots: []\n');
  await writeFile(path.join(skillmap, 'identity.json'), `${JSON.stringify({
    version: 1,
    identityVersion: 1,
    workspaceId: WORKSPACE_ID,
    createdAt: NOW,
    updatedAt: NOW,
    roots: []
  }, null, 2)}\n`);

  const publication = await WorkspaceStateStore.open(cwd).migrateLegacy({ confirm: true, actor: 'contract-test' });
  assertValid(IDS['workspace-revision-v1'], publication.manifest);
  assertValid(IDS['workspace-revision-v1'], publication.pointer);
  const marker = JSON.parse(await readFile(path.join(skillmap, 'state-version.json'), 'utf8'));
  assertValid(IDS['workspace-revision-v1'], marker);
});

test('revision IDs use the state-store r-sequence-uuid format exactly', () => {
  const legacy = workspaceRevision();
  legacy.revisionId = 'rev_00000000000000000001';
  legacy.payloadDigest = computePayloadDigest(legacy);
  assertInvalid(IDS['workspace-revision-v1'], legacy, /pattern|oneOf/);
  assertValid(IDS['workspace-revision-v1'], workspaceRevision());
});
