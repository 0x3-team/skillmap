import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  computeEvalSuiteV3CaseSetDigest,
  computeEvalSuiteV3DatasetDigest,
  computePayloadDigest,
  validateContract
} from '../dist/contracts/validate.js';
import { rankRoutePrompt } from '../dist/contracts/route-ranking.js';
import { createJob, readJob } from '../dist/core/jobs.js';
import { WorkspaceStateStore } from '../dist/core/workspace-state/index.js';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';
import { buildApprovedStatus } from '../dist/services/status-use-case.js';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist', 'cli.js');
const EVAL_SUITE_V3_SCHEMA = 'https://skillmap.dev/contracts/eval-suite/v3.schema.json';
const CREATED_AT = '2026-07-01T00:00:00.000Z';
const CASE_REVIEWED_AT = '2026-07-02T00:00:00.000Z';
const HOLDOUT_FROZEN_AT = '2026-07-03T00:00:00.000Z';
const BASELINE_COMPLETED_AT = '2026-07-04T00:00:00.000Z';
const DATASET_REVIEWED_AT = '2026-07-05T00:00:00.000Z';
const DATASET_UPDATED_AT = '2026-07-06T00:00:00.000Z';

test('approved revision converges through a real 150-case v3 job without losing exact routing approval', { timeout: 120_000 }, async t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-release-convergence-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, 'operator-skills');
  writeSkill(root, 'alpha-router', 'Supports deliberate interface decisions for complex product systems.');
  writeSkill(root, 'beta-router', 'Coordinates dependable operational outcomes across complex services.');

  run(['init', '--root', root], cwd);
  run(['scan'], cwd);
  run(['doctor'], cwd);
  run(['doctor-pack', '--summary'], cwd);

  const baselinePolicy = [
    'version: 1',
    'skills:',
    '  alpha-router:',
    '    tier: blocked',
    '  beta-router:',
    '    tier: blocked',
    ''
  ].join('\n');
  writeFileSync(path.join(cwd, '.skillmap', 'policy.yml'), baselinePolicy);
  run(['state', 'import-legacy', '--confirm'], cwd);
  run(['apply-policy'], cwd);

  const store = WorkspaceStateStore.open(cwd);
  const baselineRead = await store.readCurrent({ purpose: 'routing' });
  assert.equal(baselineRead.source, 'current');
  const baselineRevision = revisionRef(baselineRead.selectedPointer);
  const baselineEffectiveArtifact = readImmutableArtifact(cwd, baselineRevision.revisionId, 'effective.json');
  const baselineEffective = JSON.parse(baselineEffectiveArtifact);
  assert.equal(baselineEffective.skills.every(skill => skill.routeEligible === false), true);

  const proposals = path.join(cwd, '.skillmap', 'proposals');
  mkdirSync(proposals, { recursive: true });
  const finalPolicyPath = path.join(proposals, 'policy.yml');
  const rationalePath = path.join(proposals, 'policy-rationale.md');
  writeFileSync(finalPolicyPath, [
    'version: 1',
    'skills:',
    '  alpha-router:',
    '    tier: active-default',
    '    preferred_for:',
    '      - responsive interface',
    '  beta-router:',
    '    tier: specialist',
    '    preferred_for:',
    '      - service reliability',
    ''
  ].join('\n'));
  writeFileSync(rationalePath, '# Reviewed policy rationale\n\nBoth unique variants were reviewed against the current doctor pack.\n');
  run(['curate', 'codex', '--prepare'], cwd);
  run([
    'curate', 'codex', '--ingest', finalPolicyPath,
    '--rationale', rationalePath,
    '--model', 'reviewed-acceptance-model',
    '--confirm'
  ], cwd);
  run(['apply-policy'], cwd);
  run(['graph', 'build'], cwd);

  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap', 'inventory.json'), 'utf8'));
  assert.equal(inventory.skills.length, 2);
  for (const skill of inventory.skills) {
    run([
      'sources', 'adopt', '--skill-id', skill.skillId,
      '--local', '--reason', 'Reviewed as locally authored and maintained in this acceptance workspace.'
    ], cwd);
  }
  run(['sources', 'check'], cwd);
  run(['apply-policy'], cwd);

  const skillByName = new Map(inventory.skills.map(skill => [skill.name, skill]));
  const alpha = skillByName.get('alpha-router');
  const beta = skillByName.get('beta-router');
  assert.ok(alpha?.skillId && beta?.skillId);
  const cases = releaseCases(alpha.skillId, beta.skillId);
  const baselineMetrics = routingMetrics(cases, baselineEffective.skills);
  assert.deepEqual(
    { top1Rate: baselineMetrics.top1Rate, top3Rate: baselineMetrics.top3Rate, avoidHits: baselineMetrics.avoidHits },
    { top1Rate: 0, top3Rate: 0, avoidHits: 0 }
  );
  const suite = releaseSuite(cases, baselineMetrics, baselineRevision);
  const suiteValidation = validateContract(EVAL_SUITE_V3_SCHEMA, suite);
  assert.equal(suiteValidation.ok, true, JSON.stringify(suiteValidation.issues));

  writeFileSync(path.join(cwd, '.skillmap', 'real-evals.json'), `${JSON.stringify(suite, null, 2)}\n`);
  run(['state', 'import-legacy', '--confirm'], cwd);
  run(['apply-policy'], cwd);

  const approvedR = await store.readCurrent({ purpose: 'routing' });
  assert.equal(approvedR.source, 'current');
  assert.notEqual(approvedR.currentPointer.revisionId, baselineRevision.revisionId);
  assert.equal(approvedR.currentPointer.revisionId, approvedR.selectedPointer.revisionId);
  const approvedRRef = revisionRef(approvedR.currentPointer);
  const approvedREffectiveArtifact = readImmutableArtifact(cwd, approvedRRef.revisionId, 'effective.json');
  const currentMetrics = routingMetrics(cases, JSON.parse(approvedREffectiveArtifact).skills);
  assert.equal(currentMetrics.top1Rate, 1);
  assert.equal(currentMetrics.top3Rate, 1);
  assert.equal(currentMetrics.avoidHits, 0);

  const backend = new SkillMapLocalBackend(cwd);
  const invalidCases = structuredClone(cases);
  invalidCases[0].expectedSkillIds = [`sk_${'Z'.repeat(43)}`];
  const invalidSuite = releaseSuite(invalidCases, baselineMetrics, baselineRevision);
  await assert.rejects(
    backend.importEvalSuite({ suite: invalidSuite, expectedRevision: approvedRRef.revisionId }),
    error => error?.code === 'EVAL_SKILL_CATALOG_INVALID'
  );
  assert.equal((await store.readCurrent({ purpose: 'status' })).currentPointer.revisionId, approvedRRef.revisionId, 'rejected v3 catalog authority published a revision');
  const created = await createJob(cwd, {
    kind: 'skillmap.job-request',
    schemaVersion: 1,
    expectedRevision: approvedRRef.revisionId,
    idempotencyKey: 'release-convergence-eval-v3-1',
    requestedBy: 'api',
    confirmation: 'none',
    parameters: { type: 'eval-run' }
  });
  await backend.runJob(created.stored.job.jobId);
  const completed = await readJob(cwd, created.stored.job.jobId);
  assert.equal(completed.job.state, 'succeeded', JSON.stringify(completed.job.error));
  assert.ok(completed.job.resultReceipt?.revisionId);

  const resultRevisionId = completed.job.resultReceipt.revisionId;
  const immutableReport = JSON.parse(readImmutableArtifact(cwd, resultRevisionId, 'eval-report.json'));
  assert.equal(immutableReport.schemaVersion, 3);
  assert.equal(immutableReport.revision.revisionId, approvedRRef.revisionId);
  assert.deepEqual(immutableReport.baseline.provenance.sourceRevision, baselineRevision);
  assert.equal(immutableReport.releaseEvidenceEligible, true);
  assert.equal(immutableReport.pass, true);
  const currentAfterJob = await store.readCurrent({ purpose: 'status' });
  const routingAfterJob = await store.readCurrent({ purpose: 'routing' });
  assert.equal(currentAfterJob.currentPointer.revisionId, resultRevisionId);
  assert.equal(routingAfterJob.source, 'current');
  assert.equal(routingAfterJob.currentPointer.revisionId, resultRevisionId);
  assert.equal(routingAfterJob.selectedPointer.revisionId, resultRevisionId);
  assert.equal(routingAfterJob.currentPointer.routingSafetyDigest, approvedR.currentPointer.routingSafetyDigest);
  assert.equal(routingAfterJob.currentPointer.effectiveDigest, approvedR.currentPointer.effectiveDigest);
  assert.equal(routingAfterJob.currentPointer.effectiveRevisionDigest, approvedR.currentPointer.effectiveRevisionDigest);
  assert.equal(
    readImmutableArtifact(cwd, resultRevisionId, 'effective.json'),
    approvedREffectiveArtifact,
    'eval publication changed the exact approved effective artifact'
  );

  const approvedStatus = await buildApprovedStatus(cwd);
  assert.equal(approvedStatus.routingReady, true);
  assert.equal(approvedStatus.routing?.servingRevision.revisionId, resultRevisionId);
  assert.equal(approvedStatus.approved.currentRevision.revisionId, resultRevisionId);
  assert.equal(approvedStatus.status.readinessPhase, 'ready', JSON.stringify(approvedStatus.status.warnings));
  assert.equal(approvedStatus.status.eval?.releaseEvidenceEligible, true, JSON.stringify(approvedStatus.status.eval?.evidenceIssues));
  assert.equal(approvedStatus.status.eval?.pass, true);
  assert.equal(approvedStatus.status.eval?.fixture, false);
  assert.equal(approvedStatus.status.eval?.composition?.releaseCounted, 150);
  assert.equal(approvedStatus.status.eval?.composition?.implicitNatural, 100);
  assert.equal(approvedStatus.status.eval?.composition?.multiSkill, 25);
  assert.equal(approvedStatus.status.eval?.composition?.negativeNearMiss, 25);
  assert.equal(approvedStatus.status.eval?.holdout?.count, 30);
  assert.equal(approvedStatus.status.verdict, 'ok', JSON.stringify(approvedStatus.status.warnings));
});

function writeSkill(root, directory, description) {
  const skill = path.join(root, directory);
  mkdirSync(skill, { recursive: true });
  writeFileSync(path.join(skill, 'SKILL.md'), `---\nname: ${directory}\ndescription: ${description}\n---\n# ${directory}\n`);
}

function releaseCases(alphaSkillId, betaSkillId) {
  return Array.from({ length: 150 }, (_unused, index) => {
    const primaryCaseType = index < 100 ? 'implicit-natural' : index < 125 ? 'multi-skill' : 'negative-near-miss';
    const negative = primaryCaseType === 'negative-near-miss';
    const multi = primaryCaseType === 'multi-skill';
    return {
      caseId: `evalcase_convergence${String(index + 1).padStart(8, '0')}`,
      prompt: negative
        ? `Reconcile an unrelated financial ledger and prepare the agenda for scenario ${String(index + 1).padStart(3, '0')}`
        : multi
          ? `Coordinate a responsive interface with service reliability safeguards for scenario ${String(index + 1).padStart(3, '0')}`
          : `Improve the responsive interface workflow for scenario ${String(index + 1).padStart(3, '0')}`,
      expectedSkillIds: negative ? [] : multi ? [alphaSkillId, betaSkillId] : [alphaSkillId],
      avoidSkillIds: negative ? [alphaSkillId] : [],
      primaryCaseType,
      membership: index < 30 ? 'holdout' : 'train',
      labelProvenance: {
        author: 'acceptance-operator',
        sourceClass: 'operator-authored',
        createdAt: CREATED_AT,
        reviewedAt: CASE_REVIEWED_AT
      }
    };
  });
}

function releaseSuite(cases, baselineMetrics, baselineRevision) {
  const caseSetDigest = computeEvalSuiteV3CaseSetDigest({ schemaVersion: 3, cases });
  const base = {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    suiteId: 'evalsuite_releaseconvergence0001',
    name: 'Release convergence acceptance suite',
    createdAt: CREATED_AT,
    updatedAt: DATASET_UPDATED_AT,
    provenance: {
      labelAuthor: 'acceptance-operator',
      reviewedBy: 'acceptance-reviewer',
      sourceClass: 'operator-authored',
      createdAt: CREATED_AT,
      holdoutFrozenAt: HOLDOUT_FROZEN_AT,
      reviewedAt: DATASET_REVIEWED_AT,
      deduplicationResult: 'passed',
      holdoutFrozen: true,
      frozenCaseSetDigest: caseSetDigest
    },
    baseline: {
      ...baselineMetrics,
      provenance: {
        sourceKind: 'approved-effective-revision',
        completedAt: BASELINE_COMPLETED_AT,
        caseSetDigest,
        sourceRevision: baselineRevision
      }
    },
    cases,
    redactionClassification: 'local-sensitive'
  };
  const withDataset = { ...base, datasetDigest: computeEvalSuiteV3DatasetDigest(base) };
  return { ...withDataset, payloadDigest: computePayloadDigest(withDataset) };
}

function routingMetrics(cases, skills) {
  const counted = cases.filter(item => item.primaryCaseType !== 'explicit');
  const scored = counted.filter(item => item.expectedSkillIds.length > 0);
  const results = counted.map(item => {
    const ranked = rankRoutePrompt(skills, item.prompt, 3);
    const recommended = ranked.recommendations.map(entry => entry.skillId);
    return { item, recommended, advisoryBytes: Buffer.byteLength(ranked.hookText, 'utf8') };
  });
  const negative = results.filter(({ item }) => item.primaryCaseType === 'negative-near-miss' && item.expectedSkillIds.length === 0);
  return {
    top1Rate: scored.length === 0 ? 0 : results.filter(({ item, recommended }) => item.expectedSkillIds.length > 0 && item.expectedSkillIds.includes(recommended[0])).length / scored.length,
    top3Rate: scored.length === 0 ? 0 : results.filter(({ item, recommended }) => item.expectedSkillIds.length > 0 && (item.primaryCaseType === 'multi-skill'
      ? item.expectedSkillIds.every(skillId => recommended.slice(0, 3).includes(skillId))
      : item.expectedSkillIds.some(skillId => recommended.slice(0, 3).includes(skillId)))).length / scored.length,
    avoidHits: results.reduce((sum, { item, recommended }) => sum + item.avoidSkillIds.filter(skillId => recommended.includes(skillId)).length, 0),
    abstentionRate: negative.length === 0 ? 0 : negative.filter(({ recommended }) => recommended.length === 0).length / negative.length,
    meanAdvisoryBytes: counted.length === 0 ? 0 : results.reduce((sum, item) => sum + item.advisoryBytes, 0) / counted.length
  };
}

function revisionRef(pointer) {
  return {
    workspaceId: pointer.workspaceId,
    revisionId: pointer.revisionId,
    workspaceRevision: pointer.workspaceRevision,
    effectiveDigest: pointer.effectiveDigest,
    effectiveRevisionDigest: pointer.effectiveRevisionDigest
  };
}

function readImmutableArtifact(cwd, revisionId, artifact) {
  return readFileSync(path.join(
    cwd, '.skillmap', 'state', 'revisions', revisionId, 'workspace', '.skillmap', artifact
  ), 'utf8');
}

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
}
