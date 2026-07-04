import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { hashFile, readJson } from './fs.js';
import { readPolicy } from './policy.js';
import type { DoctorReport, EffectiveRegistry, Inventory, Policy, SkillTier } from '../schemas/types.js';

export type StatusVerdict = 'ok' | 'attention required' | 'blocked';
export type EvalConfidenceLevel = 'none' | 'demo' | 'weak' | 'meaningful' | 'release';

export interface ArtifactState {
  path: string;
  exists: boolean;
  modifiedAt?: string;
  bytes?: number;
  sha256?: string;
}

export interface PolicyInventoryValidation {
  policyEntries: number;
  matchedEntries: string[];
  unmatchedEntries: string[];
  inventorySkillsWithoutPolicy: string[];
  duplicateInventoryNames: string[];
  tierCounts: Record<string, number>;
  familyCounts: Record<string, number>;
  warnings: string[];
}

export interface EvalConfidence {
  level: EvalConfidenceLevel;
  count: number;
  minRecommended: number;
  warning?: string;
}

export interface SkillMapStatus {
  version: 1;
  generatedAt: string;
  cwd: string;
  verdict: StatusVerdict;
  warnings: string[];
  nextActions: string[];
  artifacts: Record<string, ArtifactState>;
  inventory?: {
    skills: number;
    roots: string[];
    rootTypes: Record<string, number>;
    warnings: number;
    generatedAt: string;
    hasFixtureRoots: boolean;
  };
  doctor?: {
    findings: number;
    duplicateNameGroups: number;
    scriptBearingSkills: number;
    generatedAt: string;
  };
  policy?: {
    entries: number;
    matchedEntries: number;
    unmatchedEntries: number;
    unmatchedSample: string[];
    duplicateInventoryNames: string[];
    tierCounts: Record<string, number>;
    familyCounts: Record<string, number>;
    warnings: string[];
  };
  effective?: {
    skills: number;
    routeEligible: number;
    graphNodes: number;
    graphEdges: number;
    generatedAt: string;
    stale: boolean;
    staleReasons: string[];
  };
  curation?: {
    present: boolean;
    host?: string;
    model?: string;
    modelVerification?: string;
    mode?: string;
    createdAt?: string;
    warnings: string[];
    stale?: boolean;
    staleReasons?: string[];
  };
  eval?: {
    present: boolean;
    count?: number;
    pass?: boolean;
    confidence: EvalConfidence;
    generatedAt?: string;
  };
}

export interface CurationReceipt {
  version: 1;
  createdAt: string;
  agent: {
    host: string;
    model: string;
    modelVerification: 'user-reported' | 'unverified-user-reported' | 'provider-verified';
    mode: 'manual-native-agent';
  };
  inputs: Record<string, ArtifactState>;
  outputs: Record<string, ArtifactState>;
  warnings: string[];
}

interface EvalReportLike {
  count: number;
  pass?: boolean;
  generatedAt?: string;
}

export function skillmapDir(cwd: string): string {
  return path.join(cwd, '.skillmap');
}

export function validatePolicyForInventory(inventory: Inventory, policy: Policy): PolicyInventoryValidation {
  const inventoryNames = inventory.skills.map((skill) => skill.name);
  const uniqueInventoryNames = [...new Set(inventoryNames)].sort((a, b) => a.localeCompare(b));
  const inventoryNameSet = new Set(uniqueInventoryNames);
  const counts = new Map<string, number>();
  for (const name of inventoryNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  const duplicateInventoryNames = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort((a, b) => a.localeCompare(b));
  const policyEntries = Object.keys(policy.skills).sort((a, b) => a.localeCompare(b));
  const matchedEntries = policyEntries.filter((name) => inventoryNameSet.has(name));
  const unmatchedEntries = policyEntries.filter((name) => !inventoryNameSet.has(name));
  const inventorySkillsWithoutPolicy = uniqueInventoryNames.filter((name) => !policy.skills[name]);
  const tierCounts: Record<string, number> = {};
  const familyCounts: Record<string, number> = {};
  for (const entry of Object.values(policy.skills)) {
    const tier = entry.tier ?? 'specialist';
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    if (entry.family) familyCounts[entry.family] = (familyCounts[entry.family] ?? 0) + 1;
  }
  const warnings: string[] = [];
  if (unmatchedEntries.length > 0) warnings.push(`${unmatchedEntries.length} policy entr${unmatchedEntries.length === 1 ? 'y does' : 'ies do'} not match the current inventory.`);
  if (duplicateInventoryNames.length > 0) warnings.push(`${duplicateInventoryNames.length} duplicate inventory name group${duplicateInventoryNames.length === 1 ? '' : 's'} share policy entries.`);
  return { policyEntries: policyEntries.length, matchedEntries, unmatchedEntries, inventorySkillsWithoutPolicy, duplicateInventoryNames, tierCounts, familyCounts, warnings };
}

export function inventoryHasFixtureRoots(inventory: Inventory): boolean {
  return inventory.roots.some((root) => root.includes('/test/fixtures/')) || inventory.skills.some((skill) => skill.scope === 'fixture');
}

export function evalConfidence(count: number): EvalConfidence {
  if (count <= 0) return { level: 'none', count, minRecommended: 25, warning: 'No eval cases found.' };
  if (count < 5) return { level: 'demo', count, minRecommended: 25, warning: 'Eval suite is demo-sized; do not use this as release evidence.' };
  if (count < 15) return { level: 'weak', count, minRecommended: 25, warning: 'Eval suite is small; route quality confidence is weak.' };
  if (count < 25) return { level: 'meaningful', count, minRecommended: 25, warning: 'Eval suite is useful but below the stable-alpha target of 25-40 prompts.' };
  return { level: 'release', count, minRecommended: 25 };
}

export async function buildSkillMapStatus(cwd: string): Promise<SkillMapStatus> {
  const dir = skillmapDir(cwd);
  const files = {
    inventory: path.join(dir, 'inventory.json'),
    doctor: path.join(dir, 'doctor.json'),
    policy: path.join(dir, 'policy.yml'),
    effective: path.join(dir, 'effective.json'),
    doctorPack: path.join(dir, 'doctor-pack.md'),
    doctorPackSummary: path.join(dir, 'doctor-pack.summary.md'),
    curationReceipt: path.join(dir, 'curation', 'receipt.json'),
    evalReport: path.join(dir, 'eval-report.json')
  };
  const artifacts: Record<string, ArtifactState> = {};
  for (const [name, file] of Object.entries(files)) artifacts[name] = await artifactState(file);

  const warnings: string[] = [];
  const nextActions: string[] = [];
  const inventory = artifacts.inventory.exists ? await readJson<Inventory>(files.inventory) : undefined;
  const doctor = artifacts.doctor.exists ? await readJson<DoctorReport>(files.doctor) : undefined;
  const policy = artifacts.policy.exists ? await readPolicy(files.policy) : undefined;
  const effective = artifacts.effective.exists ? await readJson<EffectiveRegistry>(files.effective) : undefined;
  const receipt = artifacts.curationReceipt.exists ? await readJson<CurationReceipt>(files.curationReceipt) : undefined;
  const evalReport = artifacts.evalReport.exists ? await readJson<EvalReportLike>(files.evalReport) : undefined;

  let policyValidation: PolicyInventoryValidation | undefined;
  let hasFixtureRoots = false;
  if (!inventory) {
    warnings.push('No inventory found. Run `skillmap scan` first.');
    nextActions.push('Run `skillmap scan`.');
  } else {
    hasFixtureRoots = inventoryHasFixtureRoots(inventory);
    if (inventory.warnings.length > 0) warnings.push(`${inventory.warnings.length} inventory root warning${inventory.warnings.length === 1 ? '' : 's'} present.`);
    if (hasFixtureRoots) warnings.push('Current inventory includes test fixture roots; do not trust route or hook output as real-user evidence.');
  }
  if (!doctor) nextActions.push('Run `skillmap doctor`.');
  if (!artifacts.doctorPack.exists && !artifacts.doctorPackSummary.exists) nextActions.push('Run `skillmap doctor-pack --summary`.');
  if (!policy) {
    warnings.push('No policy found. Curate a policy before trusting route output.');
    nextActions.push('Run `skillmap curate codex --prepare` or create `.skillmap/policy.yml`.');
  }
  if (inventory && policy) {
    policyValidation = validatePolicyForInventory(inventory, policy);
    warnings.push(...policyValidation.warnings);
  }
  const staleReasons: string[] = [];
  if (!effective) {
    warnings.push('No effective registry found. Run `skillmap apply-policy`.');
    nextActions.push('Run `skillmap apply-policy --policy .skillmap/policy.yml`.');
  } else {
    if (inventory && effective.inventory.generatedAt !== inventory.generatedAt) staleReasons.push('effective registry was built from a different inventory timestamp');
    if (policy && stableJson(effective.policy) !== stableJson(policy)) staleReasons.push('effective registry policy differs from current policy file');
    if (staleReasons.length > 0) warnings.push(`Effective registry is stale: ${staleReasons.join('; ')}.`);
  }

  const curationWarnings: string[] = [];
  const curationStaleReasons: string[] = [];
  if (!receipt) {
    curationWarnings.push('No curation receipt found; SOTA native-agent provenance is not recorded.');
    warnings.push('No curation receipt found; SkillMap cannot prove a SOTA native agent curated the current policy.');
  } else {
    curationWarnings.push(...receipt.warnings);
    if (artifacts.inventory.sha256 && receipt.inputs.inventory?.sha256 && artifacts.inventory.sha256 !== receipt.inputs.inventory.sha256) curationStaleReasons.push('inventory hash differs from curation input');
    if (artifacts.doctor.sha256 && receipt.inputs.doctor?.sha256 && artifacts.doctor.sha256 !== receipt.inputs.doctor.sha256) curationStaleReasons.push('doctor hash differs from curation input');
    if (artifacts.policy.sha256 && receipt.outputs.policy?.sha256 && artifacts.policy.sha256 !== receipt.outputs.policy.sha256) curationStaleReasons.push('policy hash differs from curation output');
    if (curationStaleReasons.length > 0) warnings.push(`Curation receipt is stale: ${curationStaleReasons.join('; ')}.`);
  }

  const confidence = evalConfidence(evalReport?.count ?? 0);
  if (evalReport && confidence.warning) warnings.push(confidence.warning);

  const status: SkillMapStatus = {
    version: 1,
    generatedAt: new Date().toISOString(),
    cwd,
    verdict: 'ok',
    warnings: dedupe(warnings),
    nextActions: dedupe(nextActions),
    artifacts
  };
  if (inventory) status.inventory = { skills: inventory.skills.length, roots: inventory.roots, rootTypes: countRootTypes(inventory), warnings: inventory.warnings.length, generatedAt: inventory.generatedAt, hasFixtureRoots };
  if (doctor) status.doctor = { findings: doctor.summary.findingCount, duplicateNameGroups: doctor.summary.duplicateNameCount, scriptBearingSkills: doctor.summary.scriptBearingCount, generatedAt: doctor.generatedAt };
  if (policy && policyValidation) status.policy = { entries: policyValidation.policyEntries, matchedEntries: policyValidation.matchedEntries.length, unmatchedEntries: policyValidation.unmatchedEntries.length, unmatchedSample: policyValidation.unmatchedEntries.slice(0, 20), duplicateInventoryNames: policyValidation.duplicateInventoryNames, tierCounts: policyValidation.tierCounts, familyCounts: policyValidation.familyCounts, warnings: policyValidation.warnings };
  if (effective) status.effective = { skills: effective.skills.length, routeEligible: effective.skills.filter((skill) => skill.routeEligible).length, graphNodes: effective.graph.nodes.length, graphEdges: effective.graph.edges.length, generatedAt: effective.generatedAt, stale: staleReasons.length > 0, staleReasons };
  status.curation = receipt ? { present: true, host: receipt.agent.host, model: receipt.agent.model, modelVerification: receipt.agent.modelVerification, mode: receipt.agent.mode, createdAt: receipt.createdAt, warnings: curationWarnings, stale: curationStaleReasons.length > 0, staleReasons: curationStaleReasons } : { present: false, warnings: curationWarnings };
  status.eval = { present: Boolean(evalReport), count: evalReport?.count, pass: evalReport?.pass, confidence, generatedAt: evalReport?.generatedAt };
  status.verdict = !inventory ? 'blocked' : status.warnings.length > 0 ? 'attention required' : 'ok';
  return status;
}

export async function artifactState(file: string): Promise<ArtifactState> {
  try {
    const st = await stat(file);
    return { path: file, exists: true, modifiedAt: st.mtime.toISOString(), bytes: st.size, sha256: await hashFile(file) };
  } catch {
    return { path: file, exists: false };
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort((a, b) => a.localeCompare(b)).map((key) => [key, sortValue(record[key])]));
  }
  return value;
}

function countRootTypes(inventory: Inventory): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const skill of inventory.skills) counts[skill.scope] = (counts[skill.scope] ?? 0) + 1;
  return counts;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)].filter(Boolean);
}
