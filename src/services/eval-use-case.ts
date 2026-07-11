import { canonicalJson } from '../core/canonical-payload.js';
import {
  compareEvalBaseline,
  evalEvidenceLevel,
  evalHoldoutResult,
  evalReleaseEvidenceEligible,
  evalThresholdPass
} from '../contracts/eval-semantics.js';
import { effectiveRegistryUsesFixtureState, isFixturePath } from '../contracts/fixture-path.js';
import { rankRoutePrompt, validateRoutePrompt, type RouteRankingSkill } from '../contracts/route-ranking.js';
import {
  computePayloadDigest,
  computeEvalRouteReplayWorkUnits,
  EVAL_RELEASE_CASE_LIMIT,
  EVAL_RELEASE_ROUTE_WORK_LIMIT,
  EVAL_RELEASE_SKILL_LIMIT,
  validateContract,
  validateEvalRunV3WithContext,
  type EvalRunV3ReleaseContext
} from '../contracts/validate.js';
import type { EvalRunV3, EvalSuiteV3 } from '../contracts/generated/types.js';
import { computeEffectiveRevisionDigest } from '../core/effective-state.js';
import { evalConfidence } from '../core/eval-confidence.js';
import { hashText } from '../core/fs.js';
import { routePrompt } from '../core/route.js';
import type {
  EffectiveRegistry,
  EvalBaseline,
  EvalCase,
  EvalComposition,
  EvalEvidenceLevel,
  EvalLeakageResult,
  EvalPrimaryCaseType,
  EvalProvenanceResult,
  EvalRunReport,
  EvalRunRow,
  EvalSuite,
  RevisionRef
} from '../schemas/types.js';

export const CANONICAL_EVAL_DATASET_REF = '.skillmap/real-evals.json';
const EVAL_SUITE_V3_SCHEMA_ID = 'https://skillmap.dev/contracts/eval-suite/v3.schema.json';

export type ParsedEvalSuiteDocument =
  | { schemaVersion: 2; suite: EvalSuite }
  | { schemaVersion: 3; suite: EvalSuiteV3 };

export interface EvaluateEvalSuiteOptions {
  evalFile: string;
  generatedAt: string;
  fixture: boolean;
  minCount?: number;
  minTop1?: number;
  minTop3?: number;
  maxAvoidHits?: number;
}

const PRIMARY_CASE_TYPES = new Set<EvalPrimaryCaseType>(['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss']);

/** Pure evaluation over one already-approved effective registry and parsed suite. */
export function evaluateEvalSuite(
  effective: EffectiveRegistry,
  suite: EvalSuite,
  options: EvaluateEvalSuiteOptions
): EvalRunReport {
  const minCount = finiteOption(options.minCount, 150, 'minCount');
  const minTop1 = finiteOption(options.minTop1, 0.8, 'minTop1');
  const minTop3 = finiteOption(options.minTop3, 0.92, 'minTop3');
  const maxAvoidHits = finiteOption(options.maxAvoidHits, 0, 'maxAvoidHits');
  const datasetDigest = computeEvalDatasetDigest(suite);
  const effectiveRevisionDigest = computeEffectiveRevisionDigest(effective);

  const seenPrompts = new Set<string>();
  const duplicatePromptIndexes = new Set<number>();
  suite.evals.forEach((item, index) => {
    const normalized = normalizePhrase(item.prompt);
    if (seenPrompts.has(normalized)) duplicatePromptIndexes.add(index);
    seenPrompts.add(normalized);
  });

  const rows: EvalRunRow[] = [];
  let releaseTop1 = 0;
  let releaseTop3 = 0;
  let releaseAvoidHits = 0;
  let regressionTop1 = 0;
  let regressionTop3 = 0;
  let regressionScoredCount = 0;
  let negativeCount = 0;
  let negativeAbstentions = 0;
  let advisoryBytes = 0;

  for (const [index, item] of suite.evals.entries()) {
    const prompt = validateRoutePrompt(item.prompt);
    const primaryCaseType = PRIMARY_CASE_TYPES.has(item.primaryCaseType as EvalPrimaryCaseType)
      ? item.primaryCaseType as EvalPrimaryCaseType
      : undefined;
    const validationErrors = validateEvalCase(item, index, suite.version, primaryCaseType, effective, duplicatePromptIndexes.has(index));
    const leakage = detectLeakage(item, index, primaryCaseType, effective);
    const releaseCounted = Boolean(primaryCaseType && primaryCaseType !== 'explicit' && validationErrors.length === 0);
    const releaseScored = releaseCounted && item.expected.length > 0;
    // Eval deliberately uses the pure router. It never records observed route events.
    const result = routePrompt(effective, prompt, 3);
    const recommended = result.recommendations.map((recommendation) => recommendation.name);
    const avoidedButRecommended = (item.avoid ?? []).filter((name) => recommended.includes(name));
    const expectedHit = primaryCaseType === 'multi-skill'
      ? item.expected.every((name) => recommended.includes(name))
      : item.expected.some((name) => recommended.includes(name));
    const top1Hit = Boolean(recommended[0] && item.expected.includes(recommended[0]));

    if (releaseScored) {
      if (top1Hit) releaseTop1 += 1;
      if (expectedHit) releaseTop3 += 1;
    }
    if (releaseCounted) {
      releaseAvoidHits += avoidedButRecommended.length;
      advisoryBytes += Buffer.byteLength(result.hookText, 'utf8');
      if (primaryCaseType === 'negative-near-miss' && item.expected.length === 0) {
        negativeCount += 1;
        if (recommended.length === 0) negativeAbstentions += 1;
      }
    }
    if (item.expected.length > 0) {
      regressionScoredCount += 1;
      if (top1Hit) regressionTop1 += 1;
      if (expectedHit) regressionTop3 += 1;
    }

    rows.push({
      id: item.id,
      prompt: item.prompt,
      expected: item.expected,
      avoid: item.avoid ?? [],
      primaryCaseType,
      membership: item.membership === 'train' || item.membership === 'holdout' ? item.membership : undefined,
      releaseCounted,
      releaseScored,
      recommended,
      avoidedButRecommended,
      validationErrors,
      leakage: {
        matchedDisplayNames: leakage.matchedDisplayNames,
        matchedAliases: leakage.matchedAliases,
        copiedDescriptions: leakage.copiedDescriptions,
        hasLeakage: hasLeakage(leakage)
      },
      hookText: result.hookText
    });
  }

  const composition = buildComposition(rows);
  const holdoutCount = rows.filter((row) => row.releaseCounted && row.membership === 'holdout').length;
  const holdout = evalHoldoutResult(composition.releaseCounted, holdoutCount);
  const leakageCases = rows.flatMap((row, index) => row.leakage.hasLeakage ? [{
    index,
    id: row.id,
    expectedNames: row.expected,
    matchedDisplayNames: row.leakage.matchedDisplayNames,
    matchedAliases: row.leakage.matchedAliases,
    copiedDescriptions: row.leakage.copiedDescriptions
  }] : []);
  const leakage: EvalLeakageResult = { pass: leakageCases.length === 0, count: leakageCases.length, cases: leakageCases };
  const provenance = validateProvenance(suite, datasetDigest, duplicatePromptIndexes.size === 0);
  const releaseScoredCount = composition.releaseScored;
  const top1Rate = releaseScoredCount === 0 ? 0 : releaseTop1 / releaseScoredCount;
  const top3Rate = releaseScoredCount === 0 ? 0 : releaseTop3 / releaseScoredCount;
  const abstentionRate = negativeCount === 0 ? 0 : negativeAbstentions / negativeCount;
  const meanAdvisoryBytes = composition.releaseCounted === 0 ? 0 : advisoryBytes / composition.releaseCounted;
  const metrics = { top1Rate, top3Rate, avoidHits: releaseAvoidHits, abstentionRate, meanAdvisoryBytes };
  const baselineComparison = compareEvalBaseline(suite.baseline, metrics);
  const invalidCaseCount = rows.filter((row) => row.validationErrors.length > 0).length;
  const validationErrors = rows.flatMap((row, index) => row.validationErrors.map((error) => `${row.id ?? `case ${index + 1}`}: ${error}`));
  const thresholds = { minCount, minTop1, minTop3, maxAvoidHits };
  const thresholdPass = evalThresholdPass(composition.releaseCounted, metrics, thresholds);
  // Eval v2 remains useful compatibility/candidate evidence, but release
  // authority belongs exclusively to context-validated eval-run/v3.
  const legacyCandidateMeetsReleaseShape = evalReleaseEvidenceEligible({
    qualified: suite.version === 2,
    fixture: options.fixture,
    composition,
    holdoutPass: holdout.pass,
    leakagePass: leakage.pass,
    provenanceComplete: provenance.complete,
    baselinePass: baselineComparison.pass,
    invalidCaseCount,
    validationErrorCount: validationErrors.length,
    metrics,
    revisionBound: true
  });
  const releaseEvidenceEligible = false;
  const pass = false;
  const evidenceLevel: EvalEvidenceLevel = evalEvidenceLevel(suite.version, composition.untyped, false);
  const confidence = evalConfidence(suite.evals.length, false);

  return {
    version: 2,
    generatedAt: options.generatedAt,
    evalFile: options.evalFile,
    fixture: options.fixture,
    evidenceLevel,
    releaseEvidenceEligible,
    thresholdPass,
    pass,
    datasetDigest,
    effectiveRevisionDigest,
    composition,
    holdout,
    leakage,
    provenance,
    baselineComparison,
    count: suite.evals.length,
    top1: releaseTop1,
    top3: releaseTop3,
    avoidHits: releaseAvoidHits,
    top1Rate,
    top3Rate,
    abstentionRate,
    meanAdvisoryBytes,
    regression: {
      scoredCount: regressionScoredCount,
      top1: regressionTop1,
      top3: regressionTop3,
      top1Rate: regressionScoredCount === 0 ? 0 : regressionTop1 / regressionScoredCount,
      top3Rate: regressionScoredCount === 0 ? 0 : regressionTop3 / regressionScoredCount
    },
    invalidCaseCount,
    validationErrors,
    confidence,
    minCount,
    minTop1,
    minTop3,
    maxAvoidHits,
    summary: `SkillMap eval v2 compatibility evidence: evidence=${evidenceLevel}, candidate-shape=${legacyCandidateMeetsReleaseShape}, release-counted=${composition.releaseCounted}, composition implicit=${composition.implicitNatural}/multi=${composition.multiSkill}/negative=${composition.negativeNearMiss}/explicit=${composition.explicit}/untyped=${composition.untyped}, top1 ${releaseTop1}/${releaseScoredCount} (${Math.round(top1Rate * 100)}%), top3 ${releaseTop3}/${releaseScoredCount} (${Math.round(top3Rate * 100)}%), avoid hits ${releaseAvoidHits}, holdout=${holdoutCount}/${composition.releaseCounted}, leakage=${leakage.count}, release-pass=false.`,
    rows
  };
}

export interface EvaluateEvalSuiteV3Options {
  revision: RevisionRef;
  effectiveArtifact: string;
  baselineEffectiveArtifact: string | null;
  approvedBaselineRevision: unknown;
  startedAt: string;
  now?: () => Date;
  minCount?: number;
  minTop1?: number;
  minTop3?: number;
  maxAvoidHits?: number;
}

/**
 * Produces prompt-free eval-run/v3 evidence and refuses to return it unless the
 * canonical contextual validator accepts the reviewed suite and exact
 * immutable current/baseline effective artifacts.
 */
export function evaluateEvalSuiteV3(
  effective: EffectiveRegistry,
  suite: EvalSuiteV3,
  options: EvaluateEvalSuiteV3Options
): EvalRunV3 {
  const cases = suite.cases as unknown as EvalSuiteV3CaseLike[];
  preflightEvalSuiteV3Replay(cases, effective.skills, options.baselineEffectiveArtifact);
  const thresholds = {
    minCount: finiteOption(options.minCount, 150, 'minCount'),
    minTop1: finiteOption(options.minTop1, 0.8, 'minTop1'),
    minTop3: finiteOption(options.minTop3, 0.92, 'minTop3'),
    maxAvoidHits: finiteOption(options.maxAvoidHits, 0, 'maxAvoidHits')
  };
  const effectiveById = new Map(effective.skills.map((skill) => [skill.skillId, skill]));
  const caseResults = cases.map((item) => evaluateEvalSuiteV3Case(item, effective, effectiveById));
  const finishedAt = (options.now ?? (() => new Date()))().toISOString();
  const composition = {
    total: caseResults.length,
    explicit: caseResults.filter((item) => item.primaryCaseType === 'explicit').length,
    implicitNatural: caseResults.filter((item) => item.primaryCaseType === 'implicit-natural').length,
    multiSkill: caseResults.filter((item) => item.primaryCaseType === 'multi-skill').length,
    negativeNearMiss: caseResults.filter((item) => item.primaryCaseType === 'negative-near-miss').length,
    untyped: 0,
    releaseCounted: caseResults.filter((item) => item.releaseCounted).length,
    releaseScored: caseResults.filter((item) => item.releaseScored).length
  };
  const releaseCounted = caseResults.filter((item) => item.releaseCounted);
  const releaseScored = caseResults.filter((item) => item.releaseScored);
  const negativeCases = releaseCounted.filter((item) => item.primaryCaseType === 'negative-near-miss' && item.expectedSkillIds.length === 0);
  const top1 = releaseScored.filter((item) => item.top1Hit).length;
  const top3 = releaseScored.filter((item) => item.top3Hit).length;
  const metrics = {
    count: caseResults.length,
    top1,
    top3,
    avoidHits: releaseCounted.reduce((sum, item) => sum + item.avoidedButRecommendedSkillIds.length, 0),
    top1Rate: releaseScored.length === 0 ? 0 : top1 / releaseScored.length,
    top3Rate: releaseScored.length === 0 ? 0 : top3 / releaseScored.length,
    abstentionRate: negativeCases.length === 0 ? 0 : negativeCases.filter((item) => item.abstained).length / negativeCases.length,
    meanAdvisoryBytes: releaseCounted.length === 0 ? 0 : releaseCounted.reduce((sum, item) => sum + item.advisoryBytes, 0) / releaseCounted.length
  };
  const holdout = evalHoldoutResult(composition.releaseCounted, releaseCounted.filter((item) => item.membership === 'holdout').length);
  const leakageCaseIds = caseResults.filter((item) => item.leakageCodes.length > 0).map((item) => item.caseId);
  const leakage = { count: leakageCaseIds.length, pass: leakageCaseIds.length === 0, caseIds: leakageCaseIds };
  const baseline = suite.baseline as unknown as EvalBaselineV3Like;
  const baselineComparison = compareEvalBaseline(baseline, metrics);
  const fixture = effectiveRegistryUsesFixtureState(effective);
  const revisionBound = options.revision.effectiveDigest !== null && options.revision.effectiveRevisionDigest !== null;
  const releaseEvidenceEligible = evalReleaseEvidenceEligible({
    qualified: true,
    fixture,
    composition,
    holdoutPass: holdout.pass,
    leakagePass: leakage.pass,
    provenanceComplete: true,
    baselinePass: baselineComparison.pass,
    invalidCaseCount: 0,
    validationErrorCount: 0,
    metrics,
    revisionBound
  });
  const thresholdPass = evalThresholdPass(composition.releaseCounted, metrics, thresholds);
  const pass = releaseEvidenceEligible && thresholdPass;
  const runBase = {
    kind: 'skillmap.eval-run',
    schemaVersion: 3,
    runId: `evalrun_${hashText(canonicalJson({ suiteId: suite.suiteId, datasetDigest: suite.datasetDigest, revisionId: options.revision.revisionId, startedAt: options.startedAt })).slice('sha256:'.length, 'sha256:'.length + 32)}`,
    suiteId: suite.suiteId,
    workspaceId: options.revision.workspaceId,
    revision: options.revision,
    datasetDigest: suite.datasetDigest,
    startedAt: options.startedAt,
    finishedAt,
    fixture,
    evidenceLevel: evalEvidenceLevel(3, 0, pass),
    releaseEvidenceEligible,
    thresholdPass,
    pass,
    thresholds,
    composition,
    holdout,
    leakage,
    baseline: suite.baseline,
    baselineComparison,
    metrics,
    invalidCaseCount: 0,
    validationErrors: [],
    caseResults,
    redactionClassification: 'local-sensitive'
  };
  const run = { ...runBase, payloadDigest: computePayloadDigest(runBase) } as unknown as EvalRunV3;
  const context: EvalRunV3ReleaseContext = {
    companionSuite: suite,
    approvedRevision: options.revision,
    effectiveArtifact: options.effectiveArtifact,
    baselineEffectiveArtifact: options.baselineEffectiveArtifact,
    approvedBaselineRevision: options.approvedBaselineRevision
  };
  const validation = validateEvalRunV3WithContext(run, context);
  if (!validation.ok) {
    const summary = validation.issues.slice(0, 20).map((issue) => `${issue.path} ${issue.message}`).join('; ');
    throw new Error(`eval-run/v3 contextual validation failed: ${summary}`);
  }
  return run;
}

interface EvalSuiteV3CaseLike {
  caseId: string;
  prompt: string;
  expectedSkillIds: string[];
  avoidSkillIds: string[];
  qualifiedSkillId?: string;
  primaryCaseType: EvalPrimaryCaseType;
  membership: 'train' | 'holdout';
}

interface EvalBaselineV3Like extends EvalBaseline {
  provenance: unknown;
}

function preflightEvalSuiteV3Replay(
  cases: EvalSuiteV3CaseLike[],
  currentSkills: EffectiveRegistry['skills'],
  baselineEffectiveArtifact: string | null
): void {
  if (cases.length > EVAL_RELEASE_CASE_LIMIT) {
    throw new Error(`eval-suite/v3 exceeds the ${EVAL_RELEASE_CASE_LIMIT}-case replay limit before routing`);
  }
  if (currentSkills.length > EVAL_RELEASE_SKILL_LIMIT) {
    throw new Error(`current effective registry exceeds the ${EVAL_RELEASE_SKILL_LIMIT}-skill replay limit before routing`);
  }
  const baselineSkills = baselineEffectiveArtifact === null ? [] : parseReplaySkills(baselineEffectiveArtifact);
  if (baselineSkills.length > EVAL_RELEASE_SKILL_LIMIT) {
    throw new Error(`baseline effective registry exceeds the ${EVAL_RELEASE_SKILL_LIMIT}-skill replay limit before routing`);
  }
  const work = computeEvalRouteReplayWorkUnits(cases as unknown as Record<string, unknown>[], currentSkills, baselineSkills);
  if (work > EVAL_RELEASE_ROUTE_WORK_LIMIT) {
    throw new Error(`eval-suite/v3 replay exceeds the ${EVAL_RELEASE_ROUTE_WORK_LIMIT}-byte work budget before routing`);
  }
}

function parseReplaySkills(effectiveArtifact: string): RouteRankingSkill[] {
  let parsed: unknown;
  try { parsed = JSON.parse(effectiveArtifact) as unknown; } catch {
    throw new Error('baseline effective artifact is not valid JSON');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.skills)) throw new Error('baseline effective artifact has no skills array');
  if (parsed.skills.length > EVAL_RELEASE_SKILL_LIMIT) return parsed.skills as RouteRankingSkill[];
  const skills: RouteRankingSkill[] = [];
  for (const [index, value] of parsed.skills.entries()) {
    if (!isRecord(value)
      || typeof value.skillId !== 'string'
      || typeof value.name !== 'string'
      || typeof value.description !== 'string'
      || typeof value.path !== 'string'
      || !['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'].includes(String(value.tier))
      || !['unique', 'canonical', 'shadowed-duplicate', 'unresolved-duplicate'].includes(String(value.variantState))
      || typeof value.routeEligible !== 'boolean'
      || typeof value.qualifiedExplicitAllowed !== 'boolean'
      || typeof value.hasScripts !== 'boolean'
      || (value.family !== undefined && typeof value.family !== 'string')
      || !['aliases', 'preferredFor', 'avoidFor', 'supersedes'].every((key) => Array.isArray(value[key]) && (value[key] as unknown[]).every((entry) => typeof entry === 'string'))) {
      throw new Error(`baseline effective artifact skill ${index + 1} is invalid for deterministic replay`);
    }
    skills.push(value as unknown as RouteRankingSkill);
  }
  return skills;
}

function evaluateEvalSuiteV3Case(
  item: EvalSuiteV3CaseLike,
  effective: EffectiveRegistry,
  effectiveById: Map<string, EffectiveRegistry['skills'][number]>
): Record<string, unknown> & {
  caseId: string;
  primaryCaseType: EvalPrimaryCaseType;
  membership: 'train' | 'holdout';
  releaseCounted: boolean;
  releaseScored: boolean;
  expectedSkillIds: string[];
  avoidedButRecommendedSkillIds: string[];
  top1Hit: boolean;
  top3Hit: boolean;
  abstained: boolean;
  advisoryBytes: number;
  leakageCodes: string[];
} {
  const prompt = validateRoutePrompt(item.prompt, Boolean(item.qualifiedSkillId));
  const ranked = rankRoutePrompt(effective.skills, prompt || 'qualified skill selection', 3, item.qualifiedSkillId);
  const recommendedSkillIds = ranked.recommendations.map((entry) => entry.skillId);
  const avoidedButRecommendedSkillIds = item.avoidSkillIds.filter((skillId) => recommendedSkillIds.includes(skillId));
  const top1Hit = item.expectedSkillIds.length > 0 && item.expectedSkillIds.includes(recommendedSkillIds[0]);
  const top3Hit = item.expectedSkillIds.length > 0 && (item.primaryCaseType === 'multi-skill'
    ? item.expectedSkillIds.every((skillId) => recommendedSkillIds.slice(0, 3).includes(skillId))
    : item.expectedSkillIds.some((skillId) => recommendedSkillIds.slice(0, 3).includes(skillId)));
  const abstained = recommendedSkillIds.length === 0;
  const leakageCodes = evalSuiteV3LeakageCodes(item, effectiveById);
  const releaseCounted = item.primaryCaseType !== 'explicit';
  const releaseScored = releaseCounted && item.expectedSkillIds.length > 0;
  const invalid = leakageCodes.length > 0;
  const outcome = invalid
    ? 'invalid'
    : avoidedButRecommendedSkillIds.length > 0
      ? 'unsafe'
      : item.primaryCaseType === 'negative-near-miss' && item.expectedSkillIds.length === 0 && abstained
        ? 'correct-abstention'
        : top1Hit
          ? 'top1-hit'
          : top3Hit
            ? 'top3-hit'
            : 'miss';
  const outcomeCode = {
    'top1-hit': 'EXPECTED_TOP1',
    'top3-hit': 'EXPECTED_TOP3',
    'correct-abstention': 'CORRECT_ABSTENTION',
    miss: abstained ? 'EXPECTED_SKILL_ABSTAINED' : 'EXPECTED_SKILL_MISSED',
    unsafe: 'AVOID_TARGET_RECOMMENDED',
    invalid: 'CASE_INVALID'
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
    reasonCodes: [outcomeCode, ...leakageCodes],
    validationCodes: [],
    leakageCodes
  };
}

function evalSuiteV3LeakageCodes(item: EvalSuiteV3CaseLike, effectiveById: Map<string, EffectiveRegistry['skills'][number]>): string[] {
  if (item.primaryCaseType === 'explicit') return [];
  let displayName = false;
  let alias = false;
  let description = false;
  for (const skillId of item.expectedSkillIds) {
    const skill = effectiveById.get(skillId);
    if (!skill) continue;
    if (containsPhrase(item.prompt, skill.name)) displayName = true;
    if (skill.aliases.some((entry) => containsPhrase(item.prompt, entry))) alias = true;
    if (copiesDescription(item.prompt, skill.description)) description = true;
  }
  return [
    ...(displayName ? ['EXPECTED_DISPLAY_NAME_LEAKAGE'] : []),
    ...(alias ? ['EXPECTED_ALIAS_LEAKAGE'] : []),
    ...(description ? ['EXPECTED_DESCRIPTION_LEAKAGE'] : [])
  ];
}

/** Dataset identity excludes its optional author-declared digest. */
export function computeEvalDatasetDigest(suite: EvalSuite): string {
  const provenance = suite.provenance ? { ...suite.provenance } : undefined;
  if (provenance) delete provenance.datasetDigest;
  const projection = {
    version: suite.version ?? 1,
    ...(provenance ? { provenance } : {}),
    ...(suite.baseline ? { baseline: suite.baseline } : {}),
    evals: suite.evals
  };
  return hashText(canonicalJson(JSON.parse(JSON.stringify(projection))));
}

export function persistedEvalReport(report: EvalRunReport, evalFile = report.evalFile): Record<string, unknown> {
  return {
    ...report,
    evalFile,
    promptStored: false,
    hookTextStored: false,
    rows: report.rows.map((row) => ({
      id: row.id,
      primaryCaseType: row.primaryCaseType,
      membership: row.membership,
      releaseCounted: row.releaseCounted,
      releaseScored: row.releaseScored,
      expected: row.expected,
      avoid: row.avoid,
      recommended: row.recommended,
      avoidedButRecommended: row.avoidedButRecommended,
      advisoryBytes: Buffer.byteLength(row.hookText, 'utf8'),
      validationErrors: row.validationErrors,
      leakage: row.leakage,
      promptStored: false,
      hookTextStored: false
    }))
  };
}

export function parseEvalSuite(value: unknown): EvalSuite {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('eval file must be a JSON object with an evals array');
  const raw = value as Record<string, unknown>;
  if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) throw new Error('eval file version must be 1 or 2');
  if (!Array.isArray(raw.evals)) throw new Error('eval file must be a JSON object with an evals array');
  const allowedSuiteKeys = new Set(['version', 'provenance', 'baseline', 'evals']);
  for (const key of Object.keys(raw)) if (!allowedSuiteKeys.has(key)) throw new Error(`eval file contains unknown field: ${key}`);
  const evals = raw.evals.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`eval case ${index + 1} must be an object`);
    const item = entry as Record<string, unknown>;
    const allowedCaseKeys = new Set(['id', 'prompt', 'expected', 'avoid', 'primaryCaseType', 'membership']);
    for (const key of Object.keys(item)) if (!allowedCaseKeys.has(key)) throw new Error(`eval case ${index + 1} contains unknown field: ${key}`);
    let prompt: string;
    try { prompt = validateRoutePrompt(item.prompt); } catch (error) {
      throw new Error(`eval case ${index + 1} prompt is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(item.expected) || item.expected.some((name) => typeof name !== 'string' || !name.trim())) throw new Error(`eval case ${index + 1} expected must be an array of non-empty strings`);
    if (item.avoid !== undefined && (!Array.isArray(item.avoid) || item.avoid.some((name) => typeof name !== 'string' || !name.trim()))) throw new Error(`eval case ${index + 1} avoid must be an array of non-empty strings`);
    return {
      id: typeof item.id === 'string' ? item.id : undefined,
      prompt,
      expected: item.expected as string[],
      avoid: item.avoid as string[] | undefined,
      primaryCaseType: item.primaryCaseType as EvalCase['primaryCaseType'],
      membership: item.membership as EvalCase['membership']
    };
  });
  return {
    version: raw.version as EvalSuite['version'],
    provenance: parseProvenance(raw.provenance),
    baseline: parseBaseline(raw.baseline),
    evals
  };
}

export function parseEvalSuiteDocument(value: unknown): ParsedEvalSuiteDocument {
  if (isRecord(value) && value.kind === 'skillmap.eval-suite' && value.schemaVersion === 3) {
    const validation = validateContract(EVAL_SUITE_V3_SCHEMA_ID, value);
    if (!validation.ok) {
      const summary = validation.issues.slice(0, 20).map((issue) => `${issue.path} ${issue.message}`).join('; ');
      throw new Error(`eval-suite/v3 validation failed: ${summary}`);
    }
    return { schemaVersion: 3, suite: value as unknown as EvalSuiteV3 };
  }
  return { schemaVersion: 2, suite: parseEvalSuite(value) };
}

export function evalUsesFixture(effective: EffectiveRegistry, evalFile: string): boolean {
  return isFixturePath(evalFile)
    || effectiveRegistryUsesFixtureState(effective);
}

function parseProvenance(value: unknown): EvalSuite['provenance'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('eval provenance must be an object');
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['labelAuthor', 'sourceClass', 'createdAt', 'reviewedAt', 'deduplicationResult', 'holdoutFrozen', 'datasetDigest']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`eval provenance contains unknown field: ${key}`);
  for (const key of ['labelAuthor', 'sourceClass', 'createdAt', 'reviewedAt']) if (typeof raw[key] !== 'string') throw new Error(`eval provenance ${key} must be a string`);
  if (!['passed', 'failed', 'not-run'].includes(String(raw.deduplicationResult))) throw new Error('eval provenance deduplicationResult is invalid');
  if (typeof raw.holdoutFrozen !== 'boolean') throw new Error('eval provenance holdoutFrozen must be boolean');
  if (raw.datasetDigest !== undefined && (typeof raw.datasetDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(raw.datasetDigest))) throw new Error('eval provenance datasetDigest must be a sha256 digest');
  return raw as unknown as NonNullable<EvalSuite['provenance']>;
}

function parseBaseline(value: unknown): EvalSuite['baseline'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('eval baseline must be an object');
  const raw = value as Record<string, unknown>;
  const required = ['top1Rate', 'top3Rate', 'avoidHits', 'abstentionRate', 'meanAdvisoryBytes'];
  for (const key of Object.keys(raw)) if (!required.includes(key)) throw new Error(`eval baseline contains unknown field: ${key}`);
  for (const key of required) if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) throw new Error(`eval baseline ${key} must be a finite number`);
  return raw as unknown as EvalBaseline;
}

function validateEvalCase(
  item: EvalCase,
  index: number,
  version: EvalSuite['version'],
  primaryCaseType: EvalPrimaryCaseType | undefined,
  effective: EffectiveRegistry,
  duplicatePrompt: boolean
): string[] {
  const errors: string[] = [];
  if (!primaryCaseType) errors.push('primaryCaseType must be explicit, implicit-natural, multi-skill, or negative-near-miss');
  if (item.membership !== 'train' && item.membership !== 'holdout') errors.push('membership must be train or holdout');
  if (version !== 2) errors.push('legacy/unversioned case is demo-only; eval v2 is required');
  if (duplicatePrompt) errors.push('prompt duplicates an earlier case after normalization');
  const expectedNames = new Set(item.expected);
  const avoidNames = new Set(item.avoid ?? []);
  if (expectedNames.size !== item.expected.length) errors.push('expected labels must be distinct');
  if (avoidNames.size !== (item.avoid ?? []).length) errors.push('avoid labels must be distinct');
  for (const name of expectedNames) if (avoidNames.has(name)) errors.push(`skill cannot be both expected and avoided: ${name}`);
  const knownNames = new Set(effective.skills.map((skill) => skill.name));
  for (const expected of item.expected) if (!knownNames.has(expected)) errors.push(`expected skill is not in the effective registry: ${expected}`);
  for (const avoid of item.avoid ?? []) if (!knownNames.has(avoid)) errors.push(`avoid skill is not in the effective registry: ${avoid}`);
  if (primaryCaseType === 'explicit' && item.expected.length === 0) errors.push('explicit cases require at least one expected skill');
  if (primaryCaseType === 'implicit-natural' && item.expected.length === 0) errors.push('implicit-natural cases require at least one expected skill');
  if (primaryCaseType === 'multi-skill' && expectedNames.size < 2) errors.push('multi-skill cases require at least two distinct expected skills');
  if (primaryCaseType === 'multi-skill' && expectedNames.size > 3) errors.push('multi-skill cases may declare at most three distinct expected skills for top-3 scoring');
  if (primaryCaseType === 'negative-near-miss' && (item.avoid ?? []).length === 0) errors.push('negative-near-miss cases require at least one avoid target');
  if (item.id !== undefined && !item.id.trim()) errors.push(`case ${index + 1} id must not be empty`);
  return errors;
}

function detectLeakage(item: EvalCase, index: number, primaryCaseType: EvalPrimaryCaseType | undefined, effective: EffectiveRegistry): EvalLeakageResult['cases'][number] {
  const result: EvalLeakageResult['cases'][number] = {
    index,
    id: item.id,
    expectedNames: item.expected,
    matchedDisplayNames: [],
    matchedAliases: [],
    copiedDescriptions: []
  };
  if (primaryCaseType === 'explicit') return result;
  const expectedSkills = effective.skills.filter((skill) => item.expected.includes(skill.name));
  for (const name of [...new Set(item.expected)]) if (containsPhrase(item.prompt, name)) result.matchedDisplayNames.push(name);
  for (const skill of expectedSkills) {
    for (const alias of skill.aliases) if (containsPhrase(item.prompt, alias)) result.matchedAliases.push(alias);
    if (copiesDescription(item.prompt, skill.description)) result.copiedDescriptions.push(skill.name);
  }
  result.matchedAliases = [...new Set(result.matchedAliases)].sort();
  result.copiedDescriptions = [...new Set(result.copiedDescriptions)].sort();
  return result;
}

function buildComposition(rows: EvalRunRow[]): EvalComposition {
  return {
    total: rows.length,
    explicit: rows.filter((row) => row.primaryCaseType === 'explicit').length,
    implicitNatural: rows.filter((row) => row.primaryCaseType === 'implicit-natural').length,
    multiSkill: rows.filter((row) => row.primaryCaseType === 'multi-skill').length,
    negativeNearMiss: rows.filter((row) => row.primaryCaseType === 'negative-near-miss').length,
    untyped: rows.filter((row) => !row.primaryCaseType).length,
    releaseCounted: rows.filter((row) => row.releaseCounted).length,
    releaseScored: rows.filter((row) => row.releaseScored).length
  };
}

function validateProvenance(suite: EvalSuite, datasetDigest: string, deduplicated: boolean): EvalProvenanceResult {
  const provenance = suite.provenance;
  const issues: string[] = [];
  if (!provenance) issues.push('provenance is missing');
  if (!provenance?.labelAuthor?.trim()) issues.push('labelAuthor is missing');
  if (!provenance?.sourceClass?.trim()) issues.push('sourceClass is missing');
  if (!isIsoDate(provenance?.createdAt)) issues.push('createdAt is missing or invalid');
  if (!isIsoDate(provenance?.reviewedAt)) issues.push('reviewedAt is missing or invalid');
  if (isIsoDate(provenance?.createdAt) && isIsoDate(provenance?.reviewedAt) && Date.parse(provenance!.reviewedAt) < Date.parse(provenance!.createdAt)) issues.push('reviewedAt precedes createdAt');
  if (provenance?.deduplicationResult !== 'passed') issues.push('deduplicationResult must be passed');
  if (!deduplicated) issues.push('duplicate normalized prompts were detected');
  if (provenance?.holdoutFrozen !== true) issues.push('holdoutFrozen must be true');
  const datasetDigestMatches = provenance?.datasetDigest === undefined || provenance.datasetDigest === datasetDigest;
  if (!datasetDigestMatches) issues.push('declared dataset digest does not match the eval file');
  return {
    provided: Boolean(provenance),
    complete: suite.version === 2 && issues.length === 0,
    issues,
    labelAuthor: provenance?.labelAuthor,
    sourceClass: provenance?.sourceClass,
    createdAt: provenance?.createdAt,
    reviewedAt: provenance?.reviewedAt,
    deduplicationResult: provenance?.deduplicationResult,
    holdoutFrozen: provenance?.holdoutFrozen,
    declaredDatasetDigest: provenance?.datasetDigest,
    datasetDigestMatches
  };
}

function hasLeakage(result: EvalLeakageResult['cases'][number]): boolean {
  return result.matchedDisplayNames.length > 0 || result.matchedAliases.length > 0 || result.copiedDescriptions.length > 0;
}

function containsPhrase(text: string, phrase: string): boolean {
  const normalizedText = ` ${normalizePhrase(text)} `;
  const normalizedPhrase = normalizePhrase(phrase);
  return normalizedPhrase.length > 0 && normalizedText.includes(` ${normalizedPhrase} `);
}

function copiesDescription(prompt: string, description: string): boolean {
  const promptTokens = normalizePhrase(prompt).split(' ').filter(Boolean);
  const descriptionTokens = normalizePhrase(description).split(' ').filter(Boolean);
  if (descriptionTokens.length === 0) return false;
  if (descriptionTokens.length < 4) return containsPhrase(promptTokens.join(' '), descriptionTokens.join(' '));
  const windowSize = Math.min(8, descriptionTokens.length);
  const promptText = ` ${promptTokens.join(' ')} `;
  for (let index = 0; index <= descriptionTokens.length - windowSize; index += 1) {
    const window = descriptionTokens.slice(index, index + windowSize).join(' ');
    if (promptText.includes(` ${window} `)) return true;
  }
  return false;
}

function normalizePhrase(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function isIsoDate(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finiteOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) throw new Error(`${name} must be a finite number.`);
  return resolved;
}
