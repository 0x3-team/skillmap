import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { hashFile, readJson } from './fs.js';
import { readPolicy } from './policy.js';
import type { EffectiveRegistry, Inventory, Policy } from '../schemas/types.js';

export type StatusVerdict = 'ok' | 'attention required' | 'blocked';
export type EvalConfidenceLevel = 'none' | 'demo' | 'weak' | 'alpha' | 'release';

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
  duplicateInventoryNameGroups: Array<{ name: string; paths: string[] }>;
  inventoryWithoutPolicy: string[];
  tiers: Record<string, number>;
}

export interface EvalConfidence {
  level: EvalConfidenceLevel;
  count: number;
  releaseReady: boolean;
  message: string;
}

export interface SourceSummary {
  external: number;
  localAuthored: number;
  unknown: number;
  modified: number;
  stale: number;
  riskyUpdates: number;
  errors: number;
  reviewedUnknown: number;
  reviewedStale: number;
  reviewedRiskyUpdates: number;
}

export interface SkillMapStatus {
  version: 1;
  generatedAt: string;
  verdict: StatusVerdict;
  cwd: string;
  artifacts: Record<string, ArtifactState>;
  inventory?: {
    skills: number;
    roots: number;
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
  };
  eval?: {
    present: boolean;
    count?: number;
    pass?: boolean;
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
  count?: number;
  pass?: boolean;
  generatedAt?: string;
}

interface SourceStatusLike {
  records?: Array<{ skill?: string; state?: string; risk?: string; error?: string }>;
}

interface SourceDecisionRegistryLike {
  records?: Array<{ skill?: string; appliesToState?: string; decision?: string; reason?: string }>;
}

export function skillmapDir(cwd: string): string {
  return path.join(cwd, '.skillmap');
}

export async function buildSkillMapStatus(cwd: string): Promise<SkillMapStatus> {
  const dir = skillmapDir(cwd);
  const inventoryPath = path.join(dir, 'inventory.json');
  const policyPath = path.join(dir, 'policy.yml');
  const effectivePath = path.join(dir, 'effective.json');
  const receiptPath = path.join(dir, 'curation/receipt.json');
  const evalPath = path.join(dir, 'eval-report.json');
  const sourcesPath = path.join(dir, 'source-status.json');
  const sourceDecisionsPath = path.join(dir, 'source-decisions.json');
  const graphPath = path.join(dir, 'skillgraph.json');

  const artifacts = {
    inventory: await artifactState(inventoryPath),
    policy: await artifactState(policyPath),
    effective: await artifactState(effectivePath),
    curation: await artifactState(receiptPath),
    eval: await artifactState(evalPath),
    sources: await artifactState(sourcesPath),
    sourceDecisions: await artifactState(sourceDecisionsPath),
    skillgraph: await artifactState(graphPath)
  };

  const warnings: string[] = [];
  const nextActions: string[] = [];
  let inventory: Inventory | undefined;
  let policy: Policy | undefined;
  let effective: EffectiveRegistry | undefined;
  let curation: CurationReceipt | undefined;
  let evalReport: EvalReportLike | undefined;
  let sourceStatus: SourceStatusLike | undefined;
  let sourceDecisions: SourceDecisionRegistryLike | undefined;

  if (artifacts.inventory.present) inventory = await readJson<Inventory>(inventoryPath);
  if (artifacts.policy.present) policy = await readPolicy(policyPath);
  if (artifacts.effective.present) effective = await readJson<EffectiveRegistry>(effectivePath);
  if (artifacts.curation.present) curation = await readJson<CurationReceipt>(receiptPath);
  if (artifacts.eval.present) evalReport = await readJson<EvalReportLike>(evalPath);
  if (artifacts.sources.present) sourceStatus = await readJson<SourceStatusLike>(sourcesPath);
  if (artifacts.sourceDecisions.present) sourceDecisions = await readJson<SourceDecisionRegistryLike>(sourceDecisionsPath);

  const rootTypes: Record<string, number> = {};
  if (inventory) {
    for (const skill of inventory.skills) rootTypes[skill.scope] = (rootTypes[skill.scope] ?? 0) + 1;
    if (inventory.skills.length === 0) warnings.push('Inventory has no skills.');
    if (inventoryHasFixtureRoots(inventory)) warnings.push('Current inventory includes test fixture roots; do not trust route or hook output as real-user evidence.');
    if (inventory.warnings.length) warnings.push(...inventory.warnings.slice(0, 5));
  } else {
    warnings.push('No inventory found. Run `skillmap scan`.');
    nextActions.push('skillmap scan');
  }

  let policyValidation: PolicyInventoryValidation | undefined;
  if (inventory && policy) {
    policyValidation = validatePolicyForInventory(inventory, policy);
    if (policyValidation.unmatchedEntries.length) warnings.push(`${policyValidation.unmatchedEntries.length} policy entries do not match the current inventory.`);
    if (policyValidation.duplicateInventoryNameGroups.length) warnings.push(`${policyValidation.duplicateInventoryNameGroups.length} duplicate inventory name group share policy entries.`);
  } else if (inventory && !policy) {
    warnings.push('No policy found. Route output will use fallback specialist tiers.');
    nextActions.push('skillmap doctor-pack --summary');
  }

  let effectiveStatus: SkillMapStatus['effective'];
  if (effective) {
    const stale = Boolean(artifacts.inventory.mtime && artifacts.effective.mtime && artifacts.inventory.mtime > artifacts.effective.mtime)
      || Boolean(artifacts.policy.mtime && artifacts.effective.mtime && artifacts.policy.mtime > artifacts.effective.mtime);
    effectiveStatus = {
      skills: effective.skills.length,
      routeEligible: effective.skills.filter((skill) => skill.routeEligible).length,
      graphNodes: effective.graph.nodes.length,
      graphEdges: effective.graph.edges.length,
      generatedAt: effective.generatedAt,
      stale
    };
    if (stale) warnings.push('Effective registry appears stale relative to inventory or policy. Run `skillmap apply-policy`.');
  } else if (inventory) {
    warnings.push('No effective registry found. Run `skillmap apply-policy` before trusting route output.');
    nextActions.push('skillmap apply-policy --dry-run');
  }

  const curationStatus = curation ? {
    present: true,
    host: curation.host,
    model: curation.model,
    modelVerification: curation.modelVerification,
    mode: curation.mode,
    createdAt: curation.createdAt,
    stale: Boolean(artifacts.inventory.hash && curation.inputs.inventory?.hash && artifacts.inventory.hash !== curation.inputs.inventory.hash)
  } : { present: false };
  if (!curation) {
    warnings.push('No curation receipt found; SkillMap cannot prove a native agent curated the current policy.');
    nextActions.push('skillmap curate codex --prepare');
  } else if (curationStatus.stale) {
    warnings.push('Curation receipt appears stale relative to the current inventory.');
  }

  const confidence = evalConfidence(Number(evalReport?.count ?? 0));
  if (evalReport && confidence.level !== 'release') warnings.push(`Eval confidence is ${confidence.level}; ${confidence.message}`);
  if (!evalReport && inventory) nextActions.push('skillmap eval --save-report');

  const sources = summarizeSources(sourceStatus, sourceDecisions);
  if (!sourceStatus && inventory) warnings.push('No source-status report found; external skill freshness is unknown.');
  if (sources && sources.unknown > 0) warnings.push(`${sources.unknown} source records have unknown provenance.`);
  if (sources && sources.stale > 0) warnings.push(`${sources.stale} external skills have upstream updates available.`);
  if (sources && sources.riskyUpdates > 0) warnings.push(`${sources.riskyUpdates} upstream updates are risky and require manual review.`);

  const verdict: StatusVerdict = !inventory ? 'blocked' : warnings.length ? 'attention required' : 'ok';
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    verdict,
    cwd,
    artifacts,
    inventory: inventory ? { skills: inventory.skills.length, roots: inventory.roots.length, rootTypes, generatedAt: inventory.generatedAt, warnings: inventory.warnings } : undefined,
    policy: policyValidation,
    effective: effectiveStatus,
    curation: curationStatus,
    eval: { present: Boolean(evalReport), count: evalReport?.count, pass: evalReport?.pass, confidence, generatedAt: evalReport?.generatedAt },
    sources,
    warnings,
    nextActions: [...new Set(nextActions)]
  };
}

export function validatePolicyForInventory(inventory: Inventory, policy: Policy): PolicyInventoryValidation {
  const byName = new Map<string, Inventory['skills']>();
  for (const skill of inventory.skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  const unmatchedEntries = Object.keys(policy.skills).filter((name) => !byName.has(name)).sort();
  const duplicateInventoryNameGroups = [...byName.entries()]
    .filter(([name, skills]) => skills.length > 1 && policy.skills[name])
    .map(([name, skills]) => ({ name, paths: skills.map((skill) => skill.path) }));
  const inventoryWithoutPolicy = [...byName.keys()].filter((name) => !policy.skills[name]).sort();
  const tiers: Record<string, number> = {};
  for (const entry of Object.values(policy.skills)) {
    const tier = entry.tier ?? 'unspecified';
    tiers[tier] = (tiers[tier] ?? 0) + 1;
  }
  return {
    entries: Object.keys(policy.skills).length,
    matchedEntries: Object.keys(policy.skills).length - unmatchedEntries.length,
    unmatchedEntries,
    duplicateInventoryNameGroups,
    inventoryWithoutPolicy,
    tiers
  };
}

export function inventoryHasFixtureRoots(inventory: Inventory): boolean {
  return inventory.skills.some((skill) => skill.scope === 'fixture') || inventory.roots.some((root) => root.includes('/test/fixtures/'));
}

export function evalConfidence(count: number): EvalConfidence {
  if (count <= 0) return { level: 'none', count, releaseReady: false, message: 'no saved eval report is available' };
  if (count < 5) return { level: 'demo', count, releaseReady: false, message: 'fewer than 5 evals is demo-only evidence' };
  if (count < 25) return { level: 'weak', count, releaseReady: false, message: 'fewer than 25 evals is weak evidence' };
  if (count < 150) return { level: 'alpha', count, releaseReady: false, message: 'fewer than 150 evals is alpha evidence' };
  return { level: 'release', count, releaseReady: true, message: 'eval count meets v1 release evidence threshold' };
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
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) result[key] = sortJson((value as Record<string, unknown>)[key]);
    return result;
  }
  return value;
}

function summarizeSources(sourceStatus: SourceStatusLike | undefined, decisions?: SourceDecisionRegistryLike): SourceSummary | undefined {
  if (!sourceStatus?.records) return undefined;
  const decisionsBySkill = new Map((decisions?.records ?? []).map((record) => [record.skill, record]));
  const summary: SourceSummary = { external: 0, localAuthored: 0, unknown: 0, modified: 0, stale: 0, riskyUpdates: 0, errors: 0, reviewedUnknown: 0, reviewedStale: 0, reviewedRiskyUpdates: 0 };
  for (const record of sourceStatus.records) {
    const state = record.state ?? 'unknown';
    const decision = decisionsBySkill.get(record.skill);
    const reviewed = Boolean(decision?.decision && decision.appliesToState === state);
    if (state.startsWith('external')) summary.external += 1;
    if (state === 'local-authored') summary.localAuthored += 1;
    if (state === 'unknown') reviewed ? summary.reviewedUnknown += 1 : summary.unknown += 1;
    if (state === 'external-modified') summary.modified += 1;
    if (state === 'external-stale') reviewed ? summary.reviewedStale += 1 : summary.stale += 1;
    if (state === 'external-risky-update' || record.risk === 'high') reviewed ? summary.reviewedRiskyUpdates += 1 : summary.riskyUpdates += 1;
    if (record.error) summary.errors += 1;
  }
  return summary;
}
