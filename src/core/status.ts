import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { readSkillMapConfig, type SkillMapConfig } from './config.js';
import { evalConfidence, type EvalConfidence, type EvalConfidenceLevel } from './eval-confidence.js';
import { hashFile, readJson } from './fs.js';
import { readPolicy } from './policy.js';
import { duplicateDecisionMatchesInventory, resolveActivePolicyFile } from './policy-state.js';
import { isQualifiedInventory } from './identity.js';
import { computeEffectiveRevisionDigest, effectiveFreshness, resolveCurrentEffective } from './effective-state.js';
import { inventoryUsesFixtureState, isFixturePath } from '../contracts/fixture-path.js';
import { validateEvalRunV3WithContext, type EvalRunV3ReleaseContext } from '../contracts/validate.js';
import {
  CANONICAL_EVAL_DATASET_REF,
  evaluateEvalSuite,
  evalUsesFixture,
  parseEvalSuite,
} from '../services/eval-use-case.js';
import type { EffectiveRegistry, Inventory, Policy, RevisionRef } from '../schemas/types.js';

export type StatusVerdict = 'ok' | 'attention required' | 'blocked';
export type { EvalConfidence, EvalConfidenceLevel } from './eval-confidence.js';
export type SourceCoverageState = 'not-configured' | 'not-applicable' | 'partial' | 'covered';
export interface SourceCoverageResult {
  coverage: SourceCoverageState;
  inventorySkills: number;
  trackedSkills: number;
  untrackedSkills: string[];
}
export type ReadinessPhase =
  | 'needs-state-migration'
  | 'state-corrupt'
  | 'missing-inventory'
  | 'needs-config'
  | 'empty-inventory'
  | 'identity-invalid'
  | 'fixture-inventory'
  | 'needs-doctor'
  | 'needs-doctor-pack'
  | 'needs-policy'
  | 'needs-duplicate-resolution'
  | 'needs-curation'
  | 'stale-curation'
  | 'needs-effective'
  | 'stale-effective'
  | 'needs-graph'
  | 'needs-sources'
  | 'needs-source-review'
  | 'needs-eval'
  | 'eval-fixture'
  | 'eval-failing'
  | 'needs-routing-approval'
  | 'ready';

export interface ArtifactState {
  path: string;
  present: boolean;
  mtime?: string;
  hash?: string;
}

export interface PolicyInventoryValidation {
  entries: number;
  matchedEntries: number;
  unmatchedEntries: string[];
  duplicateInventoryNameGroups: Array<{ name: string; paths: string[]; skillIds: string[] }>;
  invalidCanonicalDecisions: string[];
  inventoryWithoutPolicy: string[];
  tiers: Record<string, number>;
}


export interface SourceSummary {
  coverage: SourceCoverageState;
  inventorySkills: number;
  trackedSkills: number;
  untrackedSkills: string[];
  external: number;
  localAuthored: number;
  unknown: number;
  modified: number;
  stale: number;
  riskyUpdates: number;
  errors: number;
  reviewedUnknown: number;
  reviewedModified: number;
  reviewedStale: number;
  reviewedRiskyUpdates: number;
  unreviewedNonClean: number;
}

export interface SkillMapStatus {
  version: 1;
  generatedAt: string;
  verdict: StatusVerdict;
  readinessPhase: ReadinessPhase;
  cwd: string;
  artifacts: Record<string, ArtifactState>;
  config?: SkillMapConfig;
  inventory?: {
    skills: number;
    roots: number;
    workspaceId?: string;
    identityIssues: number;
    rootTypes: Record<string, number>;
    generatedAt: string;
    warnings: string[];
  };
  policy?: PolicyInventoryValidation;
  effective?: {
    skills: number;
    routeEligible: number;
    graphNodes: number;
    graphEdges: number;
    generatedAt: string;
    stale: boolean;
  };
  curation?: {
    present: boolean;
    host?: string;
    model?: string;
    modelVerification?: string;
    mode?: string;
    createdAt?: string;
    stale?: boolean;
    staleReasons?: string[];
  };
  eval?: {
    present: boolean;
    count?: number;
    pass?: boolean;
    top1Rate?: number;
    top3Rate?: number;
    avoidHits?: number;
    minCount?: number;
    minTop1?: number;
    minTop3?: number;
    maxAvoidHits?: number;
    fixture?: boolean;
    evidenceLevel?: string;
    releaseEvidenceEligible?: boolean;
    thresholdPass?: boolean;
    datasetDigest?: string;
    effectiveRevisionDigest?: string;
    composition?: unknown;
    holdout?: unknown;
    leakage?: unknown;
    provenance?: unknown;
    baselineComparison?: unknown;
    evidenceIssues?: string[];
    confidence: EvalConfidence;
    generatedAt?: string;
  };
  sources?: SourceSummary;
  warnings: string[];
  nextActions: string[];
}

export interface CurationReceipt {
  version: 1;
  host: 'codex' | 'claude' | string;
  model: string;
  modelVerification: 'user-reported' | 'unverified-user-reported' | 'provider-verified';
  mode: 'manual-native-agent' | string;
  createdAt: string;
  inputs: Record<string, ArtifactState>;
  outputs: Record<string, ArtifactState>;
  warnings: string[];
}

interface EvalReportLike {
  kind?: string;
  schemaVersion?: number;
  version?: number;
  count?: number;
  pass?: boolean;
  top1Rate?: number;
  top3Rate?: number;
  avoidHits?: number;
  minCount?: number;
  minTop1?: number;
  minTop3?: number;
  maxAvoidHits?: number;
  evalFile?: string;
  fixture?: boolean;
  evidenceLevel?: string;
  releaseEvidenceEligible?: boolean;
  thresholdPass?: boolean;
  datasetDigest?: string;
  effectiveRevisionDigest?: string;
  composition?: unknown;
  holdout?: unknown;
  leakage?: unknown;
  provenance?: unknown;
  baselineComparison?: unknown;
  invalidCaseCount?: number;
  validationErrors?: string[];
  generatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  revision?: unknown;
  metrics?: unknown;
  thresholds?: unknown;
  baseline?: unknown;
  caseResults?: unknown[];
}

interface SourceStatusLike {
  coverage?: SourceCoverageState;
  records?: Array<{
    skill?: string;
    skillId?: string;
    contentRevision?: string;
    localPath?: string;
    state?: string;
    risk?: string;
    error?: string;
    currentHash?: string;
    upstreamHash?: string;
    upstreamManifestDigest?: string;
    upstreamCommit?: string;
    upstreamContentRevision?: string;
  }>;
}

interface SourceDecisionRegistryLike {
  records?: Array<{
    skill?: string;
    skillId?: string;
    contentRevision?: string;
    localPath?: string;
    appliesToState?: string;
    decision?: string;
    reason?: string;
    currentHash?: string;
    upstreamHash?: string;
    upstreamManifestDigest?: string;
    upstreamCommit?: string;
    upstreamContentRevision?: string;
  }>;
}

export function skillmapDir(cwd: string): string {
  return path.join(cwd, '.skillmap');
}

export interface BuildSkillMapStatusOptions {
  immutableRevision?: boolean;
  servingRevision?: RevisionRef;
  evalReleaseSnapshot?: {
    report: Record<string, unknown>;
    context: EvalRunV3ReleaseContext;
  };
  evalReleaseContextIssue?: string;
}

export async function buildSkillMapStatus(cwd: string, options: BuildSkillMapStatusOptions = {}): Promise<SkillMapStatus> {
  const dir = skillmapDir(cwd);
  const inventoryPath = path.join(dir, 'inventory.json');
  const identityPath = path.join(dir, 'identity.json');
  const identityMigrationsPath = path.join(dir, 'identity-migrations.json');
  const configPath = path.join(dir, 'config.yml');
  const legacyPolicyPath = path.join(dir, 'policy.yml');
  const activePolicyPath = await resolveActivePolicyFile(cwd);
  const policyPath = activePolicyPath ?? legacyPolicyPath;
  const effectivePath = path.join(dir, 'effective.json');
  const receiptPath = path.join(dir, 'curation/receipt.json');
  const evalPath = path.join(dir, 'eval-report.json');
  const sourcesPath = path.join(dir, 'source-status.json');
  const sourceDecisionsPath = path.join(dir, 'source-decisions.json');
  const graphPath = path.join(dir, 'skillgraph.json');
  const doctorPath = path.join(dir, 'doctor.json');
  const doctorPackPath = path.join(dir, 'doctor-pack.summary.md');
  const fallbackDoctorPackPath = path.join(dir, 'doctor-pack.md');
  const rationalePath = path.join(dir, 'policy-rationale.md');

  const artifacts = {
    config: await artifactState(configPath),
    identity: await artifactState(identityPath),
    identityMigrations: await artifactState(identityMigrationsPath),
    inventory: await artifactState(inventoryPath),
    doctor: await artifactState(doctorPath),
    doctorPack: await artifactState(doctorPackPath),
    doctorPackFull: await artifactState(fallbackDoctorPackPath),
    policy: await artifactState(policyPath),
    policyActivePointer: await artifactState(path.join(dir, 'policies/active.json')),
    policyRationale: await artifactState(rationalePath),
    effective: await artifactState(effectivePath),
    curation: await artifactState(receiptPath),
    eval: await artifactState(evalPath),
    sources: await artifactState(sourcesPath),
    sourceDecisions: await artifactState(sourceDecisionsPath),
    skillgraph: await artifactState(graphPath)
  };

  const warnings: string[] = [];
  let inventory: Inventory | undefined;
  let config: SkillMapConfig | undefined;
  let policy: Policy | undefined;
  let effective: EffectiveRegistry | undefined;
  let curation: CurationReceipt | undefined;
  let evalReport: EvalReportLike | undefined;
  let sourceStatus: SourceStatusLike | undefined;
  let sourceDecisions: SourceDecisionRegistryLike | undefined;

  if (artifacts.config.present) config = await readSkillMapConfig(cwd);
  if (artifacts.inventory.present) inventory = await readJson<Inventory>(inventoryPath);
  if (artifacts.policy.present) policy = await readPolicy(policyPath);
  if (artifacts.effective.present) effective = await readJson<EffectiveRegistry>(effectivePath);
  if (artifacts.curation.present) curation = await readJson<CurationReceipt>(receiptPath);
  if (artifacts.eval.present) {
    evalReport = options.evalReleaseSnapshot?.report as EvalReportLike | undefined
      ?? await readJson<EvalReportLike>(evalPath);
  }
  if (artifacts.sources.present) sourceStatus = await readJson<SourceStatusLike>(sourcesPath);
  if (artifacts.sourceDecisions.present) sourceDecisions = await readJson<SourceDecisionRegistryLike>(sourceDecisionsPath);

  const rootTypes: Record<string, number> = {};
  const qualifiedInventory = inventory ? isQualifiedInventory(inventory) : false;
  if (inventory) {
    for (const skill of inventory.skills) rootTypes[skill.scope] = (rootTypes[skill.scope] ?? 0) + 1;
    if (inventory.skills.length === 0) warnings.push('Inventory has no skills.');
    if (!config) warnings.push('No personal root config found. Run `skillmap init --root PATH` so readiness is tied to explicit roots.');
    if (config && config.roots.length === 0) warnings.push('Personal root config has no roots. Re-run `skillmap init --root PATH` or pass --root to scan.');
    if (inventoryHasFixtureRoots(inventory)) warnings.push('Current inventory includes test fixture roots; do not trust route or hook output as real-user evidence.');
    if (!qualifiedInventory) warnings.push('Inventory uses legacy or malformed identity state; routing and readiness are blocked until `skillmap scan` creates a qualified v2 inventory.');
    if (inventory.warnings?.length) warnings.push(...inventory.warnings.slice(0, 5));
    if (inventory.identityIssues?.length) warnings.push(`${inventory.identityIssues.length} qualified identity collision or normalization issue(s) block readiness.`);
  } else {
    warnings.push('No inventory found. Run `skillmap scan`.');
  }

  let policyValidation: PolicyInventoryValidation | undefined;
  if (inventory && policy && qualifiedInventory) {
    policyValidation = validatePolicyForInventory(inventory, policy);
    if (policyValidation.unmatchedEntries.length) warnings.push(`${policyValidation.unmatchedEntries.length} policy entries do not match the current inventory.`);
    if (policyValidation.duplicateInventoryNameGroups.length) warnings.push(`${policyValidation.duplicateInventoryNameGroups.length} unresolved duplicate inventory name group(s) require qualified identity and a canonical decision.`);
  } else if (inventory && !policy) {
    warnings.push('No policy found. Route output will use fallback specialist tiers.');
  }

  let effectiveStatus: SkillMapStatus['effective'];
  let currentEffectiveRevisionDigest: string | undefined;
  if (effective && qualifiedInventory && Array.isArray(effective.skills) && effective.graph && Array.isArray(effective.graph.nodes) && Array.isArray(effective.graph.edges)
    && effective.skills.every((skill) => /^sk_[A-Za-z0-9_-]{43}$/.test(skill.skillId) && /^sha256:[a-f0-9]{64}$/.test(skill.contentRevision))) {
    const freshness = options.immutableRevision ? { fresh: true, reasons: [] } : await effectiveFreshness(cwd, effective, inventory!);
    try {
      currentEffectiveRevisionDigest = computeEffectiveRevisionDigest(options.immutableRevision ? effective : await resolveCurrentEffective(cwd, inventory!, effective));
    } catch (error) {
      warnings.push(`Current effective revision could not be reconstructed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const stale = !freshness.fresh;
    effectiveStatus = {
      skills: effective.skills.length,
      routeEligible: effective.skills.filter((skill) => skill.routeEligible).length,
      graphNodes: effective.graph.nodes.length,
      graphEdges: effective.graph.edges.length,
      generatedAt: effective.generatedAt,
      stale
    };
    if (stale) warnings.push(`Effective registry is stale or invalid (${freshness.reasons.slice(0, 3).join('; ')}). Run \`skillmap apply-policy\`.`);
  } else if (inventory) {
    warnings.push('No effective registry found. Run `skillmap apply-policy` before trusting route output.');
  }

  if (inventory && !artifacts.doctor.present) warnings.push('No doctor report found. Run `skillmap doctor` before curation.');
  if (inventory && !artifacts.doctorPack.present && !artifacts.doctorPackFull.present) warnings.push('No doctor-pack found. Run `skillmap doctor-pack --summary` before curation.');

  const curationStaleness = curation ? curationStaleReasons(curation, artifacts, policy) : [];
  const curationStatus = curation ? {
    present: true,
    host: curation.host,
    model: curation.model,
    modelVerification: curation.modelVerification,
    mode: curation.mode,
    createdAt: curation.createdAt,
    stale: curationStaleness.length > 0,
    staleReasons: curationStaleness
  } : { present: false };
  if (!curation && inventory) {
    warnings.push('No curation receipt found; SkillMap cannot prove a native agent curated the current policy.');
  } else if (curationStatus.stale) {
    warnings.push(`Curation receipt appears stale: ${curationStaleness.join(', ')}.`);
  }

  const evalEvidence = await validateEvalReportEvidence(
    cwd,
    evalReport,
    effective,
    options.servingRevision?.effectiveRevisionDigest ?? currentEffectiveRevisionDigest,
    options.servingRevision?.effectiveDigest ?? undefined,
    Boolean(options.immutableRevision),
    options
  );
  const evaluatedReport = evalEvidence.recomputed ?? evalReport;
  const releaseEvidenceEligible = evalEvidence.eligible;
  const confidence = evalConfidence(evalReportCount(evaluatedReport), releaseEvidenceEligible);
  const evalUsesFixture = Boolean(evaluatedReport?.fixture || isFixturePath(evaluatedReport?.evalFile));
  if (evalReport && evalUsesFixture) warnings.push('Eval report was generated from fixture evals; it does not count as personal V1 readiness evidence.');
  if (evalReport && !releaseEvidenceEligible) warnings.push('Eval report is candidate-only until a reviewed eval-suite/v3 passes contextual validation against exact current and historical effective artifacts.');
  if (evalReport && evalEvidence.issues.length) warnings.push(`Eval evidence is not release-eligible: ${evalEvidence.issues.slice(0, 5).join('; ')}.`);
  if (evalReport && confidence.level !== 'release') warnings.push(`Eval confidence is ${confidence.level}; ${confidence.message}`);
  if (evaluatedReport && (!releaseEvidenceEligible || evaluatedReport.pass === false)) warnings.push('Eval report does not meet the validated release evidence and threshold gates.');
  if (!evalReport && inventory) warnings.push('No eval report found. Run `skillmap eval --file .skillmap/real-evals.json --save-report` before trusting readiness.');

  const sources = summarizeSources(sourceStatus, inventory, sourceDecisions);
  if (!sourceStatus && inventory) warnings.push('No source-status report found; external skill freshness is unknown.');
  if (sources?.coverage === 'not-configured') warnings.push('Source coverage is not configured; zero tracked records are not clean coverage.');
  if (sources?.coverage === 'partial') warnings.push(`Source coverage is partial; ${sources.untrackedSkills.length} inventoried skill variant(s) have no source classification.`);
  if (sources && sources.unknown > 0) warnings.push(`${sources.unknown} source records have unknown provenance.`);
  if (sources && sources.modified > 0) warnings.push(`${sources.modified} external skills have unreviewed local modifications.`);
  if (sources && sources.stale > 0) warnings.push(`${sources.stale} external skills have upstream updates available.`);
  if (sources && sources.riskyUpdates > 0) warnings.push(`${sources.riskyUpdates} upstream updates are risky and require manual review.`);
  if (sources && sources.errors > 0) warnings.push(`${sources.errors} source records could not be checked cleanly.`);

  const readinessPhase = determineReadinessPhase({
    inventory,
    config,
    artifacts,
    policyValidation,
    effectiveStatus,
    curationStatus,
    policy,
    evalReport: evaluatedReport,
    evalUsesFixture,
    confidence,
    sources
  });
  const nextActions = inventory && !qualifiedInventory
    ? ['skillmap scan']
    : nextActionsForPhase(readinessPhase);
  const verdict: StatusVerdict = !inventory || readinessPhase === 'empty-inventory'
    ? 'blocked'
    : readinessPhase === 'ready' && warnings.length === 0 ? 'ok' : 'attention required';
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    verdict,
    readinessPhase,
    cwd,
    artifacts,
    config,
    inventory: inventory ? { skills: inventory.skills.length, roots: inventory.roots.length, workspaceId: inventory.workspaceId, identityIssues: qualifiedInventory ? inventory.identityIssues.length : 1, rootTypes, generatedAt: inventory.generatedAt, warnings: inventory.warnings ?? [] } : undefined,
    policy: policyValidation,
    effective: effectiveStatus,
    curation: curationStatus,
    eval: {
      present: Boolean(evalReport),
      count: evalReportCount(evaluatedReport),
      pass: releaseEvidenceEligible && evaluatedReport?.pass === true,
      top1Rate: evalReportMetric(evaluatedReport, 'top1Rate'),
      top3Rate: evalReportMetric(evaluatedReport, 'top3Rate'),
      avoidHits: evalReportMetric(evaluatedReport, 'avoidHits'),
      minCount: evalReportThreshold(evaluatedReport, 'minCount'),
      minTop1: evalReportThreshold(evaluatedReport, 'minTop1'),
      minTop3: evalReportThreshold(evaluatedReport, 'minTop3'),
      maxAvoidHits: evalReportThreshold(evaluatedReport, 'maxAvoidHits'),
      fixture: evalUsesFixture,
      evidenceLevel: releaseEvidenceEligible
        ? 'release'
        : evaluatedReport?.evidenceLevel === 'release'
          ? 'demo'
          : evaluatedReport?.evidenceLevel ?? (evaluatedReport ? 'demo' : undefined),
      releaseEvidenceEligible,
      thresholdPass: evaluatedReport?.thresholdPass,
      datasetDigest: evaluatedReport?.datasetDigest,
      effectiveRevisionDigest: evalReportEffectiveRevisionDigest(evaluatedReport),
      composition: evaluatedReport?.composition,
      holdout: evaluatedReport?.holdout,
      leakage: evaluatedReport?.leakage,
      provenance: evaluatedReport?.provenance,
      baselineComparison: evaluatedReport?.baselineComparison,
      evidenceIssues: evalEvidence.issues,
      confidence,
      generatedAt: evalReport?.generatedAt ?? evalReport?.finishedAt
    },
    sources,
    warnings,
    nextActions
  };
}

export function validatePolicyForInventory(inventory: Inventory, policy: Policy): PolicyInventoryValidation {
  const byName = new Map<string, Inventory['skills']>();
  for (const skill of inventory.skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  const inventoryById = new Map(inventory.skills.map((skill) => [skill.skillId, skill]));
  const unresolvedMigrationNames = policy.version === 2 ? policy.migration.unresolvedNames : [];
  const unmatchedEntries = policy.version === 1
    ? Object.keys(policy.skills).filter((name) => !byName.has(name)).sort()
    : [...new Set([
      ...Object.keys(policy.skillsById).filter((skillId) => !inventoryById.has(skillId)),
      ...unresolvedMigrationNames.filter((name) => !byName.has(name))
    ])].sort();
  const invalidCanonicalDecisions = policy.version === 2
    ? [...byName.entries()]
      .filter(([, skills]) => skills.length > 1)
      .map(([name]) => name)
      .filter((name) => !duplicateDecisionMatchesInventory(policy, inventory, name))
      .sort()
    : [...byName.entries()].filter(([, skills]) => skills.length > 1).map(([name]) => name).sort();
  const duplicateInventoryNameGroups = [...byName.entries()]
    .filter(([name, skills]) => skills.length > 1 && invalidCanonicalDecisions.includes(name))
    .map(([name, skills]) => ({ name, paths: skills.map((skill) => skill.path), skillIds: skills.map((skill) => skill.skillId).sort() }));
  const inventoryWithoutPolicy = policy.version === 1
    ? [...byName.keys()].filter((name) => !policy.skills[name]).sort()
    : [...new Set(inventory.skills
      .filter((skill) => (byName.get(skill.name)?.length ?? 0) === 1 && !policy.skillsById[skill.skillId])
      .map((skill) => skill.name))].sort();
  const tiers: Record<string, number> = {};
  const entries = policy.version === 1
    ? Object.values(policy.skills)
    : [...Object.values(policy.skillsById), ...Object.values(policy.migration.unresolvedEntries)];
  for (const entry of entries) {
    const tier = entry.tier ?? 'unspecified';
    tiers[tier] = (tiers[tier] ?? 0) + 1;
  }
  return {
    entries: entries.length,
    matchedEntries: entries.length - unmatchedEntries.length,
    unmatchedEntries,
    duplicateInventoryNameGroups,
    invalidCanonicalDecisions,
    inventoryWithoutPolicy,
    tiers
  };
}

export function inventoryHasFixtureRoots(inventory: Inventory): boolean {
  return inventoryUsesFixtureState(inventory);
}

async function validateEvalReportEvidence(
  cwd: string,
  evalReport: EvalReportLike | undefined,
  effective: EffectiveRegistry | undefined,
  currentEffectiveDigest: string | undefined,
  currentEffectiveArtifactDigest: string | undefined,
  immutableRevision: boolean,
  options: BuildSkillMapStatusOptions
): Promise<{ eligible: boolean; issues: string[]; recomputed?: EvalReportLike }> {
  if (!evalReport) return { eligible: false, issues: [] };
  const issues: string[] = [];
  const v3 = evalReport.kind === 'skillmap.eval-run' && evalReport.schemaVersion === 3;
  let recomputed: EvalReportLike | undefined;
  const canonicalDataset = path.join(skillmapDir(cwd), 'real-evals.json');
  let datasetPath: string | undefined;
  let evalFileLabel: string | undefined;

  if (immutableRevision) {
    datasetPath = canonicalDataset;
    evalFileLabel = CANONICAL_EVAL_DATASET_REF;
    if (!v3 && !isCanonicalEvalReference(evalReport.evalFile, canonicalDataset)) {
      issues.push('eval report points to an external or uncontained dataset; immutable release evidence requires .skillmap/real-evals.json');
    }
  } else if (v3) {
    issues.push('eval-run/v3 release evidence must come from an immutable workspace revision');
  } else if (!evalReport.evalFile) {
    issues.push('eval file path is missing');
  } else {
    const resolved = resolveContainedEvalPath(cwd, evalReport.evalFile);
    if (!resolved) issues.push('eval report points to an external or uncontained dataset');
    else {
      datasetPath = resolved;
      evalFileLabel = evalReport.evalFile;
    }
  }

  if (v3) {
    if (options.evalReleaseContextIssue) issues.push(`eval release context is unavailable: ${options.evalReleaseContextIssue}`);
    const snapshot = options.evalReleaseSnapshot;
    const report = snapshot?.report as EvalReportLike | undefined ?? evalReport;
    if (!snapshot) {
      issues.push('eval-run/v3 has no trusted immutable release context');
    } else {
      const validation = validateEvalRunV3WithContext(snapshot.report, snapshot.context);
      for (const entry of validation.issues) issues.push(`${entry.path} ${entry.message}`);
    }
    const reportRevision = objectRecord(report.revision);
    if (!currentEffectiveDigest
      || typeof reportRevision?.effectiveRevisionDigest !== 'string'
      || reportRevision.effectiveRevisionDigest !== currentEffectiveDigest) {
      issues.push('eval-run/v3 effective revision digest is missing or stale for the current serving revision');
    }
    if (!currentEffectiveArtifactDigest
      || typeof reportRevision?.effectiveDigest !== 'string'
      || reportRevision.effectiveDigest !== currentEffectiveArtifactDigest) {
      issues.push('eval-run/v3 effective artifact digest is missing or stale for the current serving revision');
    }
    if (report.releaseEvidenceEligible !== true || report.pass !== true || report.evidenceLevel !== 'release') {
      issues.push('eval-run/v3 did not pass its contextual release gates');
    }
    return { eligible: issues.length === 0, issues, recomputed: report };
  }

  issues.push('legacy eval v2 is candidate-only; release readiness requires a reviewed contextual eval-run/v3');

  if (!effective) issues.push('effective registry is unavailable for eval recomputation');
  if (datasetPath && effective) {
    try {
      if (!await fileExists(datasetPath)) throw new Error('revision-contained real-evals.json is missing');
      const suite = parseEvalSuite(await readJson<unknown>(datasetPath));
      recomputed = evaluateEvalSuite(effective, suite, {
        evalFile: evalFileLabel ?? CANONICAL_EVAL_DATASET_REF,
        generatedAt: evalReport.generatedAt ?? '1970-01-01T00:00:00.000Z',
        fixture: evalUsesFixture(effective, datasetPath),
        minCount: evalReport.minCount ?? 150,
        minTop1: evalReport.minTop1 ?? 0.8,
        minTop3: evalReport.minTop3 ?? 0.92,
        maxAvoidHits: evalReport.maxAvoidHits ?? 0
      });
    } catch (error) {
      issues.push(`eval dataset could not be recomputed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const report = recomputed ?? evalReport;
  const composition = objectRecord(report.composition);
  const holdout = objectRecord(report.holdout);
  const leakage = objectRecord(report.leakage);
  const provenance = objectRecord(report.provenance);
  const baseline = objectRecord(report.baselineComparison);

  if (report.version !== 2) issues.push('report version is not eval v2');
  if (report.evidenceLevel !== 'release') issues.push('recomputed evidence level is not release');
  if (report.releaseEvidenceEligible !== true) issues.push('recomputed release eligibility is false or missing');
  if (report.thresholdPass !== true || report.pass !== true) issues.push('recomputed fixed thresholds did not pass');
  if ((report.invalidCaseCount ?? 1) !== 0 || (report.validationErrors?.length ?? 1) !== 0) issues.push('suite contains invalid cases or validation errors');
  if ((report.minCount ?? 0) < 150 || (report.minTop1 ?? 0) < 0.8 || (report.minTop3 ?? 0) < 0.92 || (report.maxAvoidHits ?? Number.POSITIVE_INFINITY) > 0) issues.push('saved thresholds are weaker than the release floor');
  if ((report.top1Rate ?? 0) < 0.8 || (report.top3Rate ?? 0) < 0.92 || (report.avoidHits ?? Number.POSITIVE_INFINITY) !== 0) issues.push('recomputed release metrics do not meet the fixed floor');

  if (!composition) issues.push('composition receipt is missing');
  else {
    if (numberValue(composition.releaseCounted) < 150) issues.push('release-counted set has fewer than 150 cases');
    if (numberValue(composition.implicitNatural) < 100) issues.push('implicit-natural quota is below 100');
    if (numberValue(composition.multiSkill) < 25) issues.push('multi-skill quota is below 25');
    if (numberValue(composition.negativeNearMiss) < 25) issues.push('negative/near-miss quota is below 25');
    if (numberValue(composition.untyped) !== 0) issues.push('suite contains untyped cases');
  }

  const releaseCounted = composition ? numberValue(composition.releaseCounted) : 0;
  const minimumHoldout = Math.max(30, Math.ceil(releaseCounted * 0.2));
  if (!holdout || holdout.pass !== true || numberValue(holdout.count) < minimumHoldout || numberValue(holdout.ratio) < 0.2) issues.push('frozen holdout quota did not pass');
  if (!leakage || leakage.pass !== true || numberValue(leakage.count) !== 0) issues.push('target-name/alias/description leakage is present or unverified');
  if (!provenance || provenance.provided !== true || provenance.complete !== true || provenance.datasetDigestMatches !== true || provenance.deduplicationResult !== 'passed' || provenance.holdoutFrozen !== true) issues.push('dataset provenance is incomplete or unverified');
  if (!baseline || baseline.provided !== true || baseline.nonRegression !== true || baseline.improvement !== true || baseline.pass !== true) issues.push('baseline non-regression and improvement receipt did not pass');
  if (report.fixture || isFixturePath(report.evalFile)) issues.push('fixture evals are not release evidence');

  if (!evalReport.effectiveRevisionDigest || !currentEffectiveDigest || evalReport.effectiveRevisionDigest !== currentEffectiveDigest) issues.push('effective revision digest is missing or stale');
  if (!recomputed?.datasetDigest || !evalReport.datasetDigest || evalReport.datasetDigest !== recomputed.datasetDigest) issues.push('dataset digest is missing, stale, or does not match recomputation');
  if (!recomputed?.effectiveRevisionDigest || recomputed.effectiveRevisionDigest !== currentEffectiveDigest) issues.push('recomputed effective revision digest does not match current state');
  if (recomputed && stableJson(evalEvidenceSnapshot(evalReport)) !== stableJson(evalEvidenceSnapshot(recomputed))) issues.push('saved eval report does not match recomputed dataset evidence');
  return { eligible: issues.length === 0, issues, ...(recomputed ? { recomputed } : {}) };
}

function isCanonicalEvalReference(value: string | undefined, canonicalDataset: string): boolean {
  if (!value) return false;
  if (value === CANONICAL_EVAL_DATASET_REF || value === '$PROJECT/.skillmap/real-evals.json') return true;
  return path.isAbsolute(value) && path.resolve(value) === path.resolve(canonicalDataset);
}

function resolveContainedEvalPath(cwd: string, value: string): string | undefined {
  if (value === CANONICAL_EVAL_DATASET_REF || value === '$PROJECT/.skillmap/real-evals.json') {
    return path.join(skillmapDir(cwd), 'real-evals.json');
  }
  const root = path.resolve(cwd);
  const resolved = path.resolve(cwd, value);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : undefined;
}

function evalEvidenceSnapshot(report: EvalReportLike): Record<string, unknown> {
  return {
    version: report.version,
    fixture: report.fixture,
    evidenceLevel: report.evidenceLevel,
    releaseEvidenceEligible: report.releaseEvidenceEligible,
    thresholdPass: report.thresholdPass,
    pass: report.pass,
    datasetDigest: report.datasetDigest,
    effectiveRevisionDigest: report.effectiveRevisionDigest,
    composition: report.composition,
    holdout: report.holdout,
    leakage: report.leakage,
    provenance: report.provenance,
    baselineComparison: report.baselineComparison,
    count: report.count,
    top1Rate: report.top1Rate,
    top3Rate: report.top3Rate,
    avoidHits: report.avoidHits,
    invalidCaseCount: report.invalidCaseCount,
    validationErrors: report.validationErrors,
    minCount: report.minCount,
    minTop1: report.minTop1,
    minTop3: report.minTop3,
    maxAvoidHits: report.maxAvoidHits
  };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function evalReportCount(report: EvalReportLike | undefined): number {
  const metrics = objectRecord(report?.metrics);
  const value = metrics?.count ?? report?.count;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function evalReportMetric(report: EvalReportLike | undefined, key: 'top1Rate' | 'top3Rate' | 'avoidHits'): number | undefined {
  const metrics = objectRecord(report?.metrics);
  const value = metrics?.[key] ?? report?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function evalReportThreshold(report: EvalReportLike | undefined, key: 'minCount' | 'minTop1' | 'minTop3' | 'maxAvoidHits'): number | undefined {
  const thresholds = objectRecord(report?.thresholds);
  const value = thresholds?.[key] ?? report?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function evalReportEffectiveRevisionDigest(report: EvalReportLike | undefined): string | undefined {
  const revision = objectRecord(report?.revision);
  const value = revision?.effectiveRevisionDigest ?? report?.effectiveRevisionDigest;
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export async function artifactState(file: string): Promise<ArtifactState> {
  try {
    const st = await stat(file);
    return { path: file, present: true, mtime: st.mtime.toISOString(), hash: await hashFile(file) };
  } catch {
    return { path: file, present: false };
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) result[key] = sortJson((value as Record<string, unknown>)[key]);
    return result;
  }
  return value;
}

function summarizeSources(sourceStatus: SourceStatusLike | undefined, inventory: Inventory | undefined, decisions?: SourceDecisionRegistryLike): SourceSummary | undefined {
  if (!inventory) return undefined;
  const records = sourceStatus?.records ?? [];
  const coverage = computeSourceCoverage(inventory, records);
  const decisionRecords = decisions?.records ?? [];
  const summary: SourceSummary = {
    ...coverage,
    external: 0,
    localAuthored: 0,
    unknown: 0,
    modified: 0,
    stale: 0,
    riskyUpdates: 0,
    errors: 0,
    reviewedUnknown: 0,
    reviewedModified: 0,
    reviewedStale: 0,
    reviewedRiskyUpdates: 0,
    unreviewedNonClean: 0
  };
  for (const record of records) {
    const state = record.state ?? 'unknown';
    const decision = findSourceDecision(record, decisionRecords);
    const reviewed = sourceReviewMatches(record, decision);
    if (state.startsWith('external')) summary.external += 1;
    if (state === 'local-authored') summary.localAuthored += 1;
    if (state === 'unknown') reviewed ? summary.reviewedUnknown += 1 : summary.unknown += 1;
    if (state === 'external-modified') reviewed ? summary.reviewedModified += 1 : summary.modified += 1;
    if (state === 'local-modified') reviewed ? summary.reviewedModified += 1 : summary.modified += 1;
    if (state === 'external-stale') reviewed ? summary.reviewedStale += 1 : summary.stale += 1;
    if (state === 'external-risky-update' || record.risk === 'high') reviewed ? summary.reviewedRiskyUpdates += 1 : summary.riskyUpdates += 1;
    if (record.error) summary.errors += 1;
  }
  summary.unreviewedNonClean = summary.unknown + summary.modified + summary.stale + summary.riskyUpdates + summary.errors;
  return summary;
}

export function computeSourceCoverage(inventory: Inventory, records: Array<{ skill?: string; skillId?: string; localPath?: string }>): SourceCoverageResult {
  const inventoryByPath = new Map(inventory.skills.map((skill) => [skill.path, skill.name]));
  const inventoryById = new Map(inventory.skills.map((skill) => [skill.skillId, skill]));
  const nameCounts = new Map<string, number>();
  for (const skill of inventory.skills) nameCounts.set(skill.name, (nameCounts.get(skill.name) ?? 0) + 1);
  const uniqueNamePaths = new Map(inventory.skills.filter((skill) => nameCounts.get(skill.name) === 1).map((skill) => [skill.name, skill.path]));
  const trackedPaths = new Set(records.map((record) => {
    if (record.skillId) {
      const matched = inventoryById.get(record.skillId);
      if (!matched || (record.skill && matched.name !== record.skill) || (record.localPath && matched.path !== record.localPath)) return undefined;
      return matched.path;
    }
    return record.localPath
      ? inventoryByPath.get(record.localPath) === record.skill ? record.localPath : undefined
      : record.skill ? uniqueNamePaths.get(record.skill) : undefined;
  }).filter((skillPath): skillPath is string => Boolean(skillPath)));
  const untrackedSkills = inventory.skills.filter((skill) => !trackedPaths.has(skill.path)).map((skill) => skill.name);
  const coverage: SourceCoverageState = inventory.skills.length === 0
    ? 'not-applicable'
    : records.length === 0
      ? 'not-configured'
      : untrackedSkills.length > 0
        ? 'partial'
        : 'covered';
  return {
    coverage,
    inventorySkills: inventory.skills.length,
    trackedSkills: trackedPaths.size,
    untrackedSkills
  };
}

function sourceReviewMatches(
  record: NonNullable<SourceStatusLike['records']>[number],
  decision: NonNullable<SourceDecisionRegistryLike['records']>[number] | undefined
): boolean {
  if (!decision?.decision || !['hold', 'accepted', 'ignore'].includes(decision.decision) || decision.appliesToState !== (record.state ?? 'unknown')) return false;
  const externalReviewRequiresImmutableTree = ['external-modified', 'external-stale', 'external-risky-update'].includes(record.state ?? '')
    || record.risk === 'high'
    || Boolean(record.upstreamManifestDigest || record.upstreamCommit || record.upstreamContentRevision);
  if (externalReviewRequiresImmutableTree && (!record.upstreamManifestDigest || !record.upstreamCommit)) return false;
  if (record.currentHash && decision.currentHash !== record.currentHash) return false;
  if (record.upstreamHash && decision.upstreamHash !== record.upstreamHash) return false;
  if (record.upstreamManifestDigest && decision.upstreamManifestDigest !== record.upstreamManifestDigest) return false;
  if (record.upstreamCommit && decision.upstreamCommit !== record.upstreamCommit) return false;
  if (record.upstreamContentRevision && decision.upstreamContentRevision !== record.upstreamContentRevision) return false;
  if (record.contentRevision && decision.contentRevision !== record.contentRevision) return false;
  return true;
}

function findSourceDecision(
  record: NonNullable<SourceStatusLike['records']>[number],
  decisions: NonNullable<SourceDecisionRegistryLike['records']>
): NonNullable<SourceDecisionRegistryLike['records']>[number] | undefined {
  if (record.skillId) return decisions.find((decision) => decision.skillId === record.skillId);
  if (record.localPath) return decisions.find((decision) => !decision.skillId && decision.localPath === record.localPath && decision.skill === record.skill);
  const matches = decisions.filter((decision) => !decision.skillId && decision.skill === record.skill);
  return matches.length === 1 ? matches[0] : undefined;
}

function curationStaleReasons(curation: CurationReceipt, artifacts: Record<string, ArtifactState>, policy: Policy | undefined): string[] {
  const reasons: string[] = [];
  if (artifactChanged(artifacts.inventory, curation.inputs.inventory)) reasons.push('inventory changed');
  if (artifactChanged(artifacts.doctor, curation.inputs.doctor)) reasons.push('doctor report changed');
  const doctorPack = curation.inputs.doctorPack?.path?.endsWith('doctor-pack.md') ? artifacts.doctorPackFull : artifacts.doctorPack;
  if (artifactChanged(doctorPack, curation.inputs.doctorPack)) reasons.push('doctor pack changed');
  const migratedFromCuratedPolicy = policy?.version === 2
    && Boolean(curation.outputs?.policy?.hash)
    && policy.migration.sourcePolicyDigest === curation.outputs?.policy?.hash;
  if (!migratedFromCuratedPolicy && artifactChanged(artifacts.policy, curation.outputs?.policy)) reasons.push('policy changed');
  if (artifactChanged(artifacts.policyRationale, curation.outputs?.rationale)) reasons.push('rationale changed');
  return reasons;
}

function artifactChanged(current: ArtifactState | undefined, recorded: ArtifactState | undefined): boolean {
  if (!recorded?.hash) return false;
  return !current?.present || current.hash !== recorded.hash;
}

function determineReadinessPhase(input: {
  inventory: Inventory | undefined;
  config: SkillMapConfig | undefined;
  artifacts: Record<string, ArtifactState>;
  policyValidation: PolicyInventoryValidation | undefined;
  effectiveStatus: SkillMapStatus['effective'];
  curationStatus: SkillMapStatus['curation'];
  policy: Policy | undefined;
  evalReport: EvalReportLike | undefined;
  evalUsesFixture: boolean;
  confidence: EvalConfidence;
  sources: SourceSummary | undefined;
}): ReadinessPhase {
  const { inventory, config, artifacts, policyValidation, effectiveStatus, curationStatus, policy, evalReport, evalUsesFixture, confidence, sources } = input;
  if (!inventory) return 'missing-inventory';
  if (inventory.skills.length === 0) return 'empty-inventory';
  if (!isQualifiedInventory(inventory)) return 'identity-invalid';
  if (inventory.identityIssues?.length) return 'identity-invalid';
  if (inventoryHasFixtureRoots(inventory)) return 'fixture-inventory';
  if (!artifacts.config.present || !config?.roots.length) return 'needs-config';
  if (!artifacts.doctor.present) return 'needs-doctor';
  if (!artifacts.doctorPack.present && !artifacts.doctorPackFull.present) return 'needs-doctor-pack';
  if (!artifacts.policy.present) return 'needs-policy';
  if (policyValidation?.duplicateInventoryNameGroups.length) return 'needs-duplicate-resolution';
  if (policy?.version === 2 && policyValidation?.inventoryWithoutPolicy.length) return 'needs-policy';
  if (!curationStatus?.present) return 'needs-curation';
  if (curationStatus.stale) return 'stale-curation';
  if (!effectiveStatus) return 'needs-effective';
  if (effectiveStatus.stale) return 'stale-effective';
  if (!artifacts.skillgraph.present) return 'needs-graph';
  if (!sources) return 'needs-sources';
  if (sources.coverage === 'not-configured' || sources.coverage === 'partial') return 'needs-sources';
  if (sources.unreviewedNonClean > 0) return 'needs-source-review';
  if (!evalReport) return 'needs-eval';
  if (evalUsesFixture) return 'eval-fixture';
  if (!evalReport.pass || !confidence.releaseReady) return 'eval-failing';
  return 'ready';
}

function nextActionsForPhase(phase: ReadinessPhase): string[] {
  switch (phase) {
    case 'needs-state-migration':
      return ['skillmap state migrate --confirm'];
    case 'state-corrupt':
      return ['skillmap state status', 'skillmap state recover --confirm'];
    case 'missing-inventory':
      return ['skillmap init --root PATH --root PATH', 'skillmap scan'];
    case 'needs-config':
      return ['skillmap init --root PATH --root PATH', 'skillmap scan'];
    case 'empty-inventory':
    case 'fixture-inventory':
      return ['skillmap scan --root PATH'];
    case 'identity-invalid':
      return [
        'skillmap identity status',
        'For a pending or ambiguous move: skillmap identity adopt-move --from OLD_SKILL_ID --to NEW_SKILL_ID --actor NAME --reason "REVIEW REASON" --dry-run',
        'If the target is unrelated: skillmap identity approve-new --skill-id NEW_SKILL_ID --actor NAME --reason "REVIEW REASON" --dry-run',
        'After review, repeat the chosen command with --confirm; for legacy identity or root/path collisions run skillmap scan after correcting the root set'
      ];
    case 'needs-doctor':
      return ['skillmap doctor'];
    case 'needs-doctor-pack':
      return ['skillmap doctor-pack --summary'];
    case 'needs-policy':
      return ['skillmap doctor-pack --summary', 'skillmap curate codex --prepare'];
    case 'needs-duplicate-resolution':
      return ['skillmap doctor', 'Resolve duplicate-name groups with qualified identities and canonical decisions before enabling hooks'];
    case 'needs-curation':
      return ['skillmap curate codex --prepare', 'skillmap curate codex --ingest FILE --rationale FILE --model MODEL --confirm'];
    case 'stale-curation':
      return ['skillmap doctor-pack --summary', 'skillmap curate codex --prepare'];
    case 'needs-effective':
    case 'stale-effective':
      return ['skillmap apply-policy --dry-run', 'skillmap apply-policy'];
    case 'needs-graph':
      return ['skillmap graph build'];
    case 'needs-sources':
      return ['skillmap sources check'];
    case 'needs-source-review':
      return ['skillmap sources diff SKILL', 'skillmap sources review SKILL --decision hold --reason TEXT'];
    case 'needs-eval':
    case 'eval-fixture':
    case 'eval-failing':
      return ['skillmap eval --file .skillmap/real-evals.json --min-count 150 --min-top1 0.80 --min-top3 0.92 --max-avoid-hits 0 --save-report'];
    case 'needs-routing-approval':
      return ['skillmap apply-policy --dry-run', 'skillmap apply-policy'];
    case 'ready':
      return [];
  }
}
