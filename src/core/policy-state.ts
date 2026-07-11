import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  DuplicateDecision,
  Inventory,
  Policy,
  PolicyMigration,
  PolicyV2,
  SkillPolicyEntry,
  SkillRecord
} from '../schemas/types.js';
import { hashText } from './fs.js';

export const POLICY_MIGRATION_VERSION = 1;

export interface ActivePolicyPointer {
  version: 1;
  activePolicyVersion: 1 | 2;
  policyPath: string;
  rollbackPolicyPath: string;
  sourcePolicyDigest: string;
  updatedAt: string;
}

export interface PolicyMigrationPreview {
  policy: PolicyV2;
  mappedSkills: number;
  unresolvedNames: string[];
  rollbackArtifact: string;
  targetPolicyArtifact: string;
  migrationReceipt: string;
}

export interface PolicyReviewDecisionV1 {
  version: 1;
  kind: 'skillmap.policy-review-decision';
  reviewId: string;
  queue: 'duplicate' | 'unmatched' | 'uncovered' | 'explicit-only' | 'blocked';
  action: 'select-canonical' | 'set-skill-policy' | 'retire-unmatched';
  decision: 'accept' | 'hold' | 'reject';
  expectedRevision: string;
  activePolicyDigest: string;
  queueFingerprint: string;
  proposalDigest: string;
  skillId?: string;
  contentRevision?: string;
  tier?: 'active-default' | 'specialist' | 'explicit-only' | 'archived' | 'blocked';
  actor: string;
  reason: string;
  decidedAt: string;
  policyChanged: boolean;
  decisionDigest: string;
}

type QualifiedSkillRecord = SkillRecord & {
  skillId?: string;
  contentRevision?: string;
};

export function policyStateDir(cwd: string): string {
  return path.join(cwd, '.skillmap', 'policies');
}

export function activePolicyPointerPath(cwd: string): string {
  return path.join(policyStateDir(cwd), 'active.json');
}

export async function readActivePolicyPointer(cwd: string): Promise<ActivePolicyPointer | undefined> {
  const file = activePolicyPointerPath(cwd);
  if (!(await exists(file))) return undefined;
  return validateActivePolicyPointer(JSON.parse(await readFile(file, 'utf8')));
}

export async function resolveActivePolicyFile(cwd: string): Promise<string | undefined> {
  const pointer = await readActivePolicyPointer(cwd);
  if (!pointer) return undefined;
  return resolveLocalPolicyArtifact(cwd, pointer.policyPath);
}

export function validateActivePolicyPointer(value: unknown): ActivePolicyPointer {
  if (!isRecord(value) || value.version !== 1 || (value.activePolicyVersion !== 1 && value.activePolicyVersion !== 2)) {
    throw new Error('Active policy pointer must use version 1 and identify policy version 1 or 2.');
  }
  for (const field of ['policyPath', 'rollbackPolicyPath', 'sourcePolicyDigest', 'updatedAt'] as const) {
    if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`Active policy pointer is missing ${field}.`);
  }
  return value as unknown as ActivePolicyPointer;
}

export function validatePolicyV2(value: unknown): PolicyV2 {
  if (!isRecord(value) || value.version !== 2) throw new Error('Policy v2 must set version: 2.');
  if (!isRecord(value.canonicalByName) || !isRecord(value.skillsById) || !isRecord(value.duplicateDecisions)) {
    throw new Error('Policy v2 requires canonicalByName, skillsById, and duplicateDecisions objects.');
  }
  if (!isRecord(value.migration)) throw new Error('Policy v2 requires a migration receipt.');
  for (const [name, skillId] of Object.entries(value.canonicalByName)) {
    if (!name.trim() || typeof skillId !== 'string' || !isSkillId(skillId)) throw new Error(`Invalid canonicalByName entry for ${name || '<empty>'}.`);
  }
  for (const [skillId, entry] of Object.entries(value.skillsById)) {
    if (!isSkillId(skillId)) throw new Error(`Invalid policy v2 skillId: ${skillId}`);
    validatePolicyEntry(entry, skillId);
  }
  for (const [name, decision] of Object.entries(value.duplicateDecisions)) {
    validateDuplicateDecision(decision, name);
  }
  validateMigration(value.migration);
  for (const [name, entry] of Object.entries(value.migration.unresolvedEntries)) validatePolicyEntry(entry, `migration.unresolvedEntries.${name}`);
  const migration = value.migration as unknown as PolicyMigration;
  const unresolvedEntries = safeDictionary<SkillPolicyEntry>();
  for (const [name, entry] of Object.entries(migration.unresolvedEntries)) unresolvedEntries[name] = clonePolicyEntry(entry);
  const canonicalByName = safeDictionary<string>();
  for (const [name, skillId] of Object.entries(value.canonicalByName)) canonicalByName[name] = skillId as string;
  const skillsById = safeDictionary<SkillPolicyEntry>();
  for (const [skillId, entry] of Object.entries(value.skillsById)) skillsById[skillId] = clonePolicyEntry(entry as SkillPolicyEntry);
  const duplicateDecisions = safeDictionary<DuplicateDecision>();
  for (const [name, decision] of Object.entries(value.duplicateDecisions)) duplicateDecisions[name] = JSON.parse(JSON.stringify(decision)) as DuplicateDecision;
  return {
    version: 2,
    canonicalByName,
    skillsById,
    duplicateDecisions,
    migration: { ...migration, unresolvedNames: [...migration.unresolvedNames], unresolvedEntries }
  };
}

export function buildPolicyV2Migration(
  inventory: Inventory,
  sourcePolicy: Policy,
  sourcePolicyBytes: string,
  cwd: string,
  migratedAt = new Date().toISOString()
): PolicyMigrationPreview {
  if (sourcePolicy.version !== 1) throw new Error('Only policy v1 can be migrated by this command.');
  assertQualifiedInventory(inventory);
  const sourcePolicyDigest = hashText(sourcePolicyBytes);
  const digestPart = sourcePolicyDigest.replace('sha256:', '').slice(0, 24);
  const migrationStamp = migratedAt.replace(/[:.]/g, '-');
  const rollbackRelative = path.posix.join('policies', 'rollback', `policy-v1-${digestPart}.yml`);
  const targetRelative = path.posix.join('policies', `policy-v2-migration-${migrationStamp}-${digestPart}.json`);
  const receiptRelative = path.posix.join('policies', `migration-receipt-${migrationStamp}-${digestPart}.json`);
  const byName = groupByDisplayName(inventory);
  const skillsById = safeDictionary<SkillPolicyEntry>();
  const unresolvedNames: string[] = [];
  const unresolvedEntries = safeDictionary<SkillPolicyEntry>();

  for (const [name, entry] of Object.entries(sourcePolicy.skills)) {
    const variants = byName.get(name) ?? [];
    if (variants.length === 1) {
      skillsById[requiredSkillId(variants[0])] = clonePolicyEntry(entry);
    } else {
      unresolvedNames.push(name);
      unresolvedEntries[name] = clonePolicyEntry(entry);
    }
  }
  for (const [name, variants] of byName) {
    if (variants.length > 1 && !unresolvedNames.includes(name)) unresolvedNames.push(name);
  }
  unresolvedNames.sort();

  const migration: PolicyMigration = {
    version: 1,
    sourcePolicyVersion: 1,
    sourcePolicyDigest,
    migrationVersion: POLICY_MIGRATION_VERSION,
    migratedAt,
    unresolvedNames,
    unresolvedEntries,
    rollbackArtifact: rollbackRelative,
    rollbackDigest: sourcePolicyDigest
  };
  const policy: PolicyV2 = {
    version: 2,
    canonicalByName: safeDictionary<string>(),
    skillsById,
    duplicateDecisions: safeDictionary<DuplicateDecision>(),
    migration
  };
  return {
    policy,
    mappedSkills: Object.keys(skillsById).length,
    unresolvedNames,
    rollbackArtifact: resolveLocalPolicyArtifact(cwd, rollbackRelative),
    targetPolicyArtifact: resolveLocalPolicyArtifact(cwd, targetRelative),
    migrationReceipt: resolveLocalPolicyArtifact(cwd, receiptRelative)
  };
}

export function createDuplicateDecision(
  policy: PolicyV2,
  inventory: Inventory,
  displayName: string,
  selectedSkillId: string,
  actor: string,
  reason: string,
  decidedAt = new Date().toISOString()
): { policy: PolicyV2; decision: DuplicateDecision } {
  assertQualifiedInventory(inventory);
  const variants = inventory.skills.filter((skill) => skill.name === displayName);
  if (variants.length < 2) throw new Error(`${displayName} is not a duplicate-name group in the current inventory.`);
  if (!variants.some((skill) => requiredSkillId(skill) === selectedSkillId)) {
    throw new Error(`${selectedSkillId} is not a current ${displayName} variant.`);
  }
  if (!actor.trim()) throw new Error('select-canonical requires a non-empty --actor.');
  if (reason.trim().length < 12) throw new Error('select-canonical requires a substantive --reason (at least 12 characters).');
  const comparedVariants = variants
    .map((skill) => ({ skillId: requiredSkillId(skill), contentRevision: requiredContentRevision(skill) }))
    .sort((a, b) => a.skillId.localeCompare(b.skillId));
  const base = {
    version: 1 as const,
    displayName,
    selectedSkillId,
    comparedVariants,
    actor: actor.trim(),
    reason: reason.trim(),
    decidedAt
  };
  const decision: DuplicateDecision = { ...base, decisionDigest: hashText(canonicalJson(base)) };
  const next = clonePolicyV2(policy);
  next.canonicalByName[displayName] = selectedSkillId;
  next.duplicateDecisions[displayName] = decision;
  const migratedEntry = next.migration.unresolvedEntries[displayName];
  if (!next.skillsById[selectedSkillId]) next.skillsById[selectedSkillId] = migratedEntry ? clonePolicyEntry(migratedEntry) : { tier: 'specialist' };
  next.migration.unresolvedNames = next.migration.unresolvedNames.filter((name) => name !== displayName);
  delete next.migration.unresolvedEntries[displayName];
  return { policy: next, decision };
}

export function duplicateDecisionMatchesInventory(
  policy: PolicyV2,
  inventory: Inventory,
  displayName: string
): boolean {
  const decision = policy.duplicateDecisions[displayName];
  const canonical = policy.canonicalByName[displayName];
  if (!decision || !canonical || canonical !== decision.selectedSkillId) return false;
  try {
    validateDuplicateDecision(decision, displayName);
  } catch {
    return false;
  }
  const current = inventory.skills
    .filter((skill) => skill.name === displayName)
    .map((skill) => ({ skillId: requiredSkillId(skill), contentRevision: requiredContentRevision(skill) }))
    .sort((a, b) => a.skillId.localeCompare(b.skillId));
  return current.length >= 2
    && current.some((variant) => variant.skillId === canonical)
    && canonicalJson(current) === canonicalJson(decision.comparedVariants);
}

export async function persistPolicyMigration(
  cwd: string,
  preview: PolicyMigrationPreview,
  sourcePolicyBytes: string
): Promise<ActivePolicyPointer> {
  await writeExclusive(preview.rollbackArtifact, sourcePolicyBytes);
  await writeJsonExclusive(preview.targetPolicyArtifact, preview.policy);
  await writeJsonExclusive(preview.migrationReceipt, {
    version: 1,
    kind: 'skillmap.policy-migration',
    sourcePolicyDigest: preview.policy.migration.sourcePolicyDigest,
    sourcePolicyVersion: 1,
    targetPolicyVersion: 2,
    migrationVersion: POLICY_MIGRATION_VERSION,
    migratedAt: preview.policy.migration.migratedAt,
    unresolvedNames: preview.unresolvedNames,
    rollbackArtifact: relativeToSkillmap(cwd, preview.rollbackArtifact),
    rollbackDigest: preview.policy.migration.rollbackDigest,
    targetPolicyArtifact: relativeToSkillmap(cwd, preview.targetPolicyArtifact)
  });
  const pointer: ActivePolicyPointer = {
    version: 1,
    activePolicyVersion: 2,
    policyPath: relativeToSkillmap(cwd, preview.targetPolicyArtifact),
    rollbackPolicyPath: relativeToSkillmap(cwd, preview.rollbackArtifact),
    sourcePolicyDigest: preview.policy.migration.sourcePolicyDigest,
    updatedAt: new Date().toISOString()
  };
  await writeActivePolicyPointer(cwd, pointer);
  return pointer;
}

export async function persistPolicyRevision(
  cwd: string,
  policy: PolicyV2,
  previous: ActivePolicyPointer
): Promise<{ pointer: ActivePolicyPointer; policyArtifact: string }> {
  const digest = hashText(canonicalJson(policy)).replace('sha256:', '').slice(0, 24);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifact = resolveLocalPolicyArtifact(cwd, path.posix.join('policies', `policy-v2-${stamp}-${digest}.json`));
  await writeJsonExclusive(artifact, policy);
  const pointer: ActivePolicyPointer = {
    ...previous,
    activePolicyVersion: 2,
    policyPath: relativeToSkillmap(cwd, artifact),
    updatedAt: new Date().toISOString()
  };
  await writeActivePolicyPointer(cwd, pointer);
  return { pointer, policyArtifact: artifact };
}

export async function persistPolicyReviewDecision(cwd: string, decision: PolicyReviewDecisionV1): Promise<string> {
  const validated = validatePolicyReviewDecision(decision);
  const stamp = validated.decidedAt.replace(/[:.]/g, '-');
  const digest = validated.decisionDigest.slice('sha256:'.length, 'sha256:'.length + 24);
  const artifact = resolveLocalPolicyArtifact(cwd, path.posix.join('policies', 'reviews', `${stamp}-${digest}.json`));
  await writeJsonExclusive(artifact, validated);
  return artifact;
}

export async function rollbackPolicy(cwd: string, pointer: ActivePolicyPointer): Promise<ActivePolicyPointer> {
  const rollbackArtifact = resolveLocalPolicyArtifact(cwd, pointer.rollbackPolicyPath);
  const bytes = await readFile(rollbackArtifact, 'utf8');
  if (hashText(bytes) !== pointer.sourcePolicyDigest) throw new Error('Rollback artifact digest does not match the migration source digest.');
  const next: ActivePolicyPointer = {
    ...pointer,
    activePolicyVersion: 1,
    policyPath: pointer.rollbackPolicyPath,
    updatedAt: new Date().toISOString()
  };
  const receipt = path.join(policyStateDir(cwd), `rollback-receipt-${Date.now()}.json`);
  await writeJsonExclusive(receipt, {
    version: 1,
    kind: 'skillmap.policy-rollback',
    rolledBackAt: next.updatedAt,
    sourcePolicyDigest: pointer.sourcePolicyDigest,
    rollbackArtifact: pointer.rollbackPolicyPath,
    previousPolicyPath: pointer.policyPath
  });
  await writeActivePolicyPointer(cwd, next);
  return next;
}

export function resolveLocalPolicyArtifact(cwd: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error('Policy artifact paths must be relative to .skillmap.');
  const base = path.resolve(cwd, '.skillmap');
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('Policy artifact path traversal is not allowed.');
  return target;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function validateDuplicateDecision(value: unknown, expectedName: string): asserts value is DuplicateDecision {
  if (!isRecord(value) || value.version !== 1 || value.displayName !== expectedName) throw new Error(`Invalid duplicate decision for ${expectedName}.`);
  if (typeof value.selectedSkillId !== 'string' || !isSkillId(value.selectedSkillId)) throw new Error(`Duplicate decision for ${expectedName} has an invalid selectedSkillId.`);
  if (typeof value.actor !== 'string' || !value.actor.trim() || typeof value.reason !== 'string' || value.reason.trim().length < 12) {
    throw new Error(`Duplicate decision for ${expectedName} requires actor and substantive reason.`);
  }
  if (typeof value.decidedAt !== 'string' || !value.decidedAt || typeof value.decisionDigest !== 'string') throw new Error(`Duplicate decision for ${expectedName} is incomplete.`);
  if (!Array.isArray(value.comparedVariants) || value.comparedVariants.length < 2) throw new Error(`Duplicate decision for ${expectedName} must compare every variant.`);
  const compared = value.comparedVariants.map((variant) => {
    if (!isRecord(variant) || typeof variant.skillId !== 'string' || !isSkillId(variant.skillId) || typeof variant.contentRevision !== 'string' || !isDigest(variant.contentRevision)) {
      throw new Error(`Duplicate decision for ${expectedName} contains an invalid compared variant.`);
    }
    return { skillId: variant.skillId, contentRevision: variant.contentRevision };
  });
  const ids = compared.map((variant) => variant.skillId);
  if (new Set(ids).size !== ids.length || !ids.includes(value.selectedSkillId)) throw new Error(`Duplicate decision for ${expectedName} has duplicate or missing selected variants.`);
  if (canonicalJson(compared) !== canonicalJson([...compared].sort((a, b) => a.skillId.localeCompare(b.skillId)))) throw new Error(`Duplicate decision for ${expectedName} must sort compared variants by skillId.`);
  const { decisionDigest: _ignored, ...base } = value;
  if (hashText(canonicalJson(base)) !== value.decisionDigest) throw new Error(`Duplicate decision digest does not validate for ${expectedName}.`);
}

function validateMigration(value: unknown): asserts value is PolicyMigration {
  if (!isRecord(value) || value.version !== 1 || value.sourcePolicyVersion !== 1 || value.migrationVersion !== POLICY_MIGRATION_VERSION) {
    throw new Error('Policy v2 migration receipt is incompatible.');
  }
  if (typeof value.sourcePolicyDigest !== 'string' || !isDigest(value.sourcePolicyDigest) || typeof value.rollbackDigest !== 'string' || !isDigest(value.rollbackDigest)) {
    throw new Error('Policy v2 migration digests are invalid.');
  }
  if (value.sourcePolicyDigest !== value.rollbackDigest) throw new Error('Policy v2 rollback digest must match the exact source policy digest.');
  if (typeof value.migratedAt !== 'string' || typeof value.rollbackArtifact !== 'string' || !Array.isArray(value.unresolvedNames) || !isRecord(value.unresolvedEntries)) {
    throw new Error('Policy v2 migration receipt is incomplete.');
  }
  if (value.unresolvedNames.some((name) => typeof name !== 'string' || !name.trim()) || new Set(value.unresolvedNames).size !== value.unresolvedNames.length) {
    throw new Error('Policy v2 migration unresolvedNames must be unique non-empty strings.');
  }
}

function validatePolicyEntry(value: unknown, label: string): asserts value is SkillPolicyEntry {
  if (!isRecord(value)) throw new Error(`Policy entry ${label} must be an object.`);
  const allowed = new Set(['tier', 'family', 'aliases', 'preferred_for', 'avoid_for', 'overlaps', 'supersedes', 'notes']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Policy entry ${label} contains unknown field(s): ${unknown.join(', ')}.`);
  const tiers = new Set(['active-default', 'specialist', 'explicit-only', 'archived', 'blocked']);
  if (value.tier !== undefined && (typeof value.tier !== 'string' || !tiers.has(value.tier))) throw new Error(`Invalid tier for ${label}.`);
  if (value.family !== undefined && typeof value.family !== 'string') throw new Error(`${label}.family must be a string.`);
  if (value.notes !== undefined && typeof value.notes !== 'string') throw new Error(`${label}.notes must be a string.`);
  for (const key of ['aliases', 'preferred_for', 'avoid_for', 'overlaps', 'supersedes']) {
    const nested = value[key];
    if (nested !== undefined && (!Array.isArray(nested) || nested.some((item) => typeof item !== 'string'))) throw new Error(`${label}.${key} must be a string list.`);
  }
}

function validatePolicyReviewDecision(value: PolicyReviewDecisionV1): PolicyReviewDecisionV1 {
  if (value.version !== 1 || value.kind !== 'skillmap.policy-review-decision') throw new Error('Policy review decision version is invalid.');
  if (!/^pr_[a-f0-9]{40}$/.test(value.reviewId)) throw new Error('Policy review decision reviewId is invalid.');
  if (!['duplicate', 'unmatched', 'uncovered', 'explicit-only', 'blocked'].includes(value.queue)) throw new Error('Policy review decision queue is invalid.');
  if (!['select-canonical', 'set-skill-policy', 'retire-unmatched'].includes(value.action)) throw new Error('Policy review decision action is invalid.');
  if (!['accept', 'hold', 'reject'].includes(value.decision)) throw new Error('Policy review decision outcome is invalid.');
  for (const digest of [value.activePolicyDigest, value.queueFingerprint, value.proposalDigest, value.decisionDigest]) {
    if (!isDigest(digest)) throw new Error('Policy review decision digest is invalid.');
  }
  if (!/^r[0-9]{20}-[0-9a-f-]{36}$/i.test(value.expectedRevision)) throw new Error('Policy review decision revision is invalid.');
  if (!value.actor.trim() || value.actor.length > 80 || value.reason.trim().length < 12 || value.reason.length > 1000) throw new Error('Policy review decision rationale is invalid.');
  if (!Number.isFinite(Date.parse(value.decidedAt))) throw new Error('Policy review decision timestamp is invalid.');
  if (value.skillId !== undefined && !isSkillId(value.skillId)) throw new Error('Policy review decision skillId is invalid.');
  if (value.contentRevision !== undefined && !isDigest(value.contentRevision)) throw new Error('Policy review decision contentRevision is invalid.');
  if (value.tier !== undefined && !['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'].includes(value.tier)) throw new Error('Policy review decision tier is invalid.');
  const { decisionDigest: _ignored, ...base } = value;
  if (hashText(canonicalJson(base)) !== value.decisionDigest) throw new Error('Policy review decision digest does not validate.');
  return value;
}

function assertQualifiedInventory(inventory: Inventory): void {
  const missing = inventory.skills.filter((skill) => !isSkillId((skill as QualifiedSkillRecord).skillId) || !isDigest((skill as QualifiedSkillRecord).contentRevision));
  if (missing.length) throw new Error(`Policy v2 requires a freshly scanned qualified inventory; ${missing.length} skill(s) lack skillId/contentRevision.`);
  const ids = inventory.skills.map(requiredSkillId);
  if (new Set(ids).size !== ids.length) throw new Error('Policy v2 migration is blocked by a qualified skillId collision.');
}

function groupByDisplayName(inventory: Inventory): Map<string, SkillRecord[]> {
  const grouped = new Map<string, SkillRecord[]>();
  for (const skill of inventory.skills) grouped.set(skill.name, [...(grouped.get(skill.name) ?? []), skill]);
  return grouped;
}

function requiredSkillId(skill: SkillRecord): string {
  const value = (skill as QualifiedSkillRecord).skillId;
  if (!value || !isSkillId(value)) throw new Error(`Skill ${skill.name} lacks a valid qualified skillId.`);
  return value;
}

function requiredContentRevision(skill: SkillRecord): string {
  const value = (skill as QualifiedSkillRecord).contentRevision;
  if (!value || !isDigest(value)) throw new Error(`Skill ${skill.name} lacks a valid contentRevision.`);
  return value;
}

function clonePolicyEntry(entry: SkillPolicyEntry): SkillPolicyEntry {
  return JSON.parse(JSON.stringify(entry)) as SkillPolicyEntry;
}

function clonePolicyV2(policy: PolicyV2): PolicyV2 {
  return validatePolicyV2(JSON.parse(JSON.stringify(policy)));
}

function relativeToSkillmap(cwd: string, file: string): string {
  const base = path.resolve(cwd, '.skillmap');
  const target = path.resolve(file);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Policy artifact is outside .skillmap.');
  return path.relative(base, target).split(path.sep).join('/');
}

async function writeActivePolicyPointer(cwd: string, pointer: ActivePolicyPointer): Promise<void> {
  const file = activePolicyPointerPath(cwd);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(pointer, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

async function writeJsonExclusive(file: string, value: unknown): Promise<void> {
  await writeExclusive(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeExclusive(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(file, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (getCode(error) !== 'EEXIST') throw error;
    const existing = await readFile(file, 'utf8');
    if (existing !== value) throw new Error(`Refusing to overwrite existing policy artifact: ${file}`);
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSkillId(value: unknown): value is string {
  return typeof value === 'string' && /^sk_[A-Za-z0-9_-]{43}$/.test(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isRecord(value)) {
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) out[key] = sortJson(value[key]);
    return out;
  }
  return value;
}

function safeDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function getCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}
