import path from 'node:path';
import { readJson, writeJson, hashText } from './fs.js';
import { canonicalJson } from './canonical-payload.js';
import type { IdentityIssue, Inventory } from '../schemas/types.js';

export interface IdentityMoveReceipt {
  version: 1;
  fromSkillId: string;
  toSkillId: string;
  displayName: string;
  contentRevision: string;
  actor: string;
  reason: string;
  approvedAt: string;
  receiptDigest: string;
}

export interface IdentityTombstone {
  version: 1;
  skillId: string;
  displayName: string;
  contentRevision: string;
  rootId: string;
  relativePath: string;
  removedAt: string;
}

export interface ApprovedNewIdentityReceipt {
  version: 1;
  skillId: string;
  displayName: string;
  contentRevision: string;
  actor: string;
  reason: string;
  approvedAt: string;
  receiptDigest: string;
}

interface IdentityMigrationRegistry {
  version: 1;
  moves: IdentityMoveReceipt[];
  tombstones: IdentityTombstone[];
  approvedNewIdentities: ApprovedNewIdentityReceipt[];
}

export function identityMigrationPath(cwd: string): string {
  return path.join(cwd, '.skillmap', 'identity-migrations.json');
}

export async function reconcileIdentityMoves(cwd: string, previous: Inventory | undefined, current: Inventory): Promise<IdentityIssue[]> {
  // Legacy inventories do not carry qualified identities. Treat the first v2
  // scan as an upgrade boundary instead of fabricating moves from undefined IDs.
  if (!previous || previous.version !== 2) return [];
  const previousFixtureDomain = previous.skills.some((skill) => skill.scope === 'fixture');
  const currentFixtureDomain = current.skills.some((skill) => skill.scope === 'fixture');
  if (previousFixtureDomain !== currentFixtureDomain) return [];
  const registry = await readRegistry(cwd);
  const receipts = registry.moves.filter(validReceipt);
  const approvedNew = registry.approvedNewIdentities.filter(validApprovedNewIdentity);
  const currentById = new Map(current.skills.map((skill) => [skill.skillId, skill]));
  const previousPending = (previous.identityIssues ?? [])
    .filter((issue) => issue.code === 'pending-skill-move' && issue.fromSkillId && issue.toSkillId && issue.displayName && issue.contentRevision);
  const previousAmbiguous = (previous.identityIssues ?? [])
    .filter((issue) => issue.code === 'ambiguous-skill-move' && issue.toSkillId && issue.displayName && issue.contentRevision);
  const carried = previousPending
    .flatMap((issue) => {
      const target = currentById.get(issue.toSkillId!);
      if (!target) return [];
      const updated = {
        ...issue,
        displayName: target.name,
        contentRevision: target.contentRevision,
        rootIds: [...new Set([...(issue.rootIds ?? []), target.rootId])],
        relativePaths: [...new Set([...(issue.relativePaths ?? []), target.relativePath])]
      };
      return hasReceipt(receipts, updated) || hasApprovedNewIdentity(approvedNew, target) ? [] : [updated];
    });
  const carriedAmbiguous = previousAmbiguous.flatMap((issue) => {
    const target = currentById.get(issue.toSkillId!);
    if (!target) return [];
    if (hasApprovedNewIdentity(approvedNew, target)) return [];
    return [{
      ...issue,
      displayName: target.name,
      contentRevision: target.contentRevision,
      rootIds: [...new Set([...(issue.rootIds ?? []), target.rootId])],
      relativePaths: [...new Set([...(issue.relativePaths ?? []), target.relativePath])]
    }];
  });

  const previousIds = new Set(previous.skills.map((skill) => skill.skillId));
  const currentIds = new Set(current.skills.map((skill) => skill.skillId));
  const removed = previous.skills.filter((skill) => !currentIds.has(skill.skillId));
  const added = current.skills.filter((skill) => !previousIds.has(skill.skillId));
  const removedAt = new Date().toISOString();
  const tombstonesById = new Map(registry.tombstones.filter(validTombstone).map((item) => [item.skillId, item]));
  for (const skill of removed) {
    if (!tombstonesById.has(skill.skillId)) {
      tombstonesById.set(skill.skillId, {
        version: 1,
        skillId: skill.skillId,
        displayName: skill.name,
        contentRevision: skill.contentRevision,
        rootId: skill.rootId,
        relativePath: skill.relativePath,
        removedAt
      });
    }
  }
  for (const skillId of currentIds) tombstonesById.delete(skillId);
  for (const receipt of receipts) tombstonesById.delete(receipt.fromSkillId);
  registry.tombstones = [...tombstonesById.values()].sort((a, b) => a.removedAt.localeCompare(b.removedAt) || a.skillId.localeCompare(b.skillId));
  await writeJson(identityMigrationPath(cwd), registry);

  const detected: IdentityIssue[] = [];
  for (const target of added) {
    if (hasApprovedNewIdentity(approvedNew, target)) continue;
    const available = registry.tombstones.filter((source) => source.skillId !== target.skillId);
    const nameCandidates = available.filter((source) => source.displayName === target.name);
    const revisionCandidates = available.filter((source) => source.contentRevision === target.contentRevision);
    const candidates = nameCandidates.length
      ? (nameCandidates.filter((source) => source.contentRevision === target.contentRevision).length === 1
          ? nameCandidates.filter((source) => source.contentRevision === target.contentRevision)
          : nameCandidates)
      : revisionCandidates.length
        ? revisionCandidates
        : available.length === 1
          ? available
          : [];
    if (candidates.length === 0) continue;
    if (candidates.length !== 1) {
      detected.push({
        code: 'ambiguous-skill-move',
        message: `Skill ${target.name} may have moved from multiple prior identities; routing is blocked until the identity history is resolved explicitly.`,
        skillIds: [...new Set([...candidates.map((source) => source.skillId), target.skillId])].sort(),
        rootIds: [...new Set([...candidates.map((source) => source.rootId), target.rootId])].sort(),
        relativePaths: [...candidates.map((source) => source.relativePath), target.relativePath].sort(),
        toSkillId: target.skillId,
        displayName: target.name,
        contentRevision: target.contentRevision
      });
      continue;
    }
    const source = candidates[0];
    const ancestor = previousPending.find((issue) => issue.toSkillId === source.skillId);
    const issue = ancestor
      ? moveIssue(ancestor.fromSkillId!, target.skillId, target.name, target.contentRevision, ancestor.relativePaths[0] ?? source.relativePath, target.relativePath, ancestor.rootIds[0] ?? source.rootId, target.rootId)
      : moveIssue(source.skillId, target.skillId, target.name, target.contentRevision, source.relativePath, target.relativePath, source.rootId, target.rootId);
    if (!hasReceipt(receipts, issue)) detected.push(issue);
  }
  const all = [...carried, ...carriedAmbiguous, ...detected];
  return [...new Map(all.map((issue) => [`${issue.code}\0${issue.fromSkillId ?? ''}\0${issue.toSkillId ?? ''}\0${issue.contentRevision}`, issue])).values()];
}

export function createIdentityMoveReceipt(issue: IdentityIssue, actor: string, reason: string, approvedAt = new Date().toISOString()): IdentityMoveReceipt {
  if (issue.code !== 'pending-skill-move' || !issue.fromSkillId || !issue.toSkillId || !issue.displayName || !issue.contentRevision) {
    throw new Error('Identity move receipt requires a complete pending-skill-move issue.');
  }
  if (!actor.trim()) throw new Error('identity adopt-move requires --actor.');
  if (reason.trim().length < 12) throw new Error('identity adopt-move requires a substantive --reason (at least 12 characters).');
  const base = {
    version: 1 as const,
    fromSkillId: issue.fromSkillId,
    toSkillId: issue.toSkillId,
    displayName: issue.displayName,
    contentRevision: issue.contentRevision,
    actor: actor.trim(),
    reason: reason.trim(),
    approvedAt
  };
  return { ...base, receiptDigest: hashText(canonicalJson(base)) };
}

export async function persistIdentityMoveReceipt(cwd: string, receipt: IdentityMoveReceipt): Promise<void> {
  if (!validReceipt(receipt)) throw new Error('Identity move receipt digest is invalid.');
  const registry = await readRegistry(cwd);
  registry.version = 1;
  registry.moves = [...registry.moves.filter((item) => !(item.fromSkillId === receipt.fromSkillId && item.toSkillId === receipt.toSkillId)), receipt]
    .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt) || a.fromSkillId.localeCompare(b.fromSkillId));
  registry.tombstones = registry.tombstones.filter((item) => item.skillId !== receipt.fromSkillId);
  await writeJson(identityMigrationPath(cwd), registry);
}

export async function identityTombstones(cwd: string): Promise<IdentityTombstone[]> {
  return (await readRegistry(cwd)).tombstones.filter(validTombstone);
}

export async function approvedNewIdentityReceipts(cwd: string): Promise<ApprovedNewIdentityReceipt[]> {
  return (await readRegistry(cwd)).approvedNewIdentities.filter(validApprovedNewIdentity);
}

export function createApprovedNewIdentityReceipt(
  inventory: Inventory,
  skillId: string,
  actor: string,
  reason: string,
  approvedAt = new Date().toISOString()
): ApprovedNewIdentityReceipt {
  const target = inventory.skills.find((skill) => skill.skillId === skillId);
  if (!target) throw new Error('identity approve-new requires a current qualified --skill-id.');
  if (!actor.trim()) throw new Error('identity approve-new requires --actor.');
  if (reason.trim().length < 12) throw new Error('identity approve-new requires a substantive --reason (at least 12 characters).');
  const base = {
    version: 1 as const,
    skillId: target.skillId,
    displayName: target.name,
    contentRevision: target.contentRevision,
    actor: actor.trim(),
    reason: reason.trim(),
    approvedAt
  };
  return { ...base, receiptDigest: hashText(canonicalJson(base)) };
}

export async function persistApprovedNewIdentityReceipt(cwd: string, receipt: ApprovedNewIdentityReceipt): Promise<void> {
  if (!validApprovedNewIdentity(receipt)) throw new Error('Approved-new identity receipt digest is invalid.');
  const registry = await readRegistry(cwd);
  registry.approvedNewIdentities = [
    ...registry.approvedNewIdentities.filter((item) => item.skillId !== receipt.skillId),
    receipt
  ].sort((a, b) => a.approvedAt.localeCompare(b.approvedAt) || a.skillId.localeCompare(b.skillId));
  await writeJson(identityMigrationPath(cwd), registry);
}

export async function manualIdentityMoveIssue(cwd: string, inventory: Inventory, fromSkillId: string, toSkillId: string): Promise<IdentityIssue | undefined> {
  const target = inventory.skills.find((skill) => skill.skillId === toSkillId);
  const source = (await identityTombstones(cwd)).find((item) => item.skillId === fromSkillId);
  if (!source || !target || source.skillId === target.skillId) return undefined;
  return moveIssue(source.skillId, target.skillId, target.name, target.contentRevision, source.relativePath, target.relativePath, source.rootId, target.rootId);
}

export function validIdentityMoveReceipt(receipt: IdentityMoveReceipt): boolean {
  return validReceipt(receipt);
}

function moveIssue(fromSkillId: string, toSkillId: string, displayName: string, contentRevision: string, fromPath: string, toPath: string, fromRoot: string, toRoot: string): IdentityIssue {
  return {
    code: 'pending-skill-move',
    message: `Skill ${displayName} may be a moved or unrelated new identity; routing is blocked until identity adopt-move or identity approve-new is confirmed.`,
    skillIds: [fromSkillId, toSkillId],
    rootIds: [...new Set([fromRoot, toRoot])],
    relativePaths: [fromPath, toPath],
    fromSkillId,
    toSkillId,
    displayName,
    contentRevision
  };
}

async function readRegistry(cwd: string): Promise<IdentityMigrationRegistry> {
  try {
    const registry = await readJson<IdentityMigrationRegistry>(identityMigrationPath(cwd));
    if (!registry || registry.version !== 1 || !Array.isArray(registry.moves) || (registry.tombstones !== undefined && !Array.isArray(registry.tombstones))
      || (registry.approvedNewIdentities !== undefined && !Array.isArray(registry.approvedNewIdentities))) {
      throw new Error('Identity migration registry is malformed; refusing to discard identity history.');
    }
    if (registry.moves.some((item) => !validReceipt(item)) || (registry.tombstones ?? []).some((item) => !validTombstone(item))
      || (registry.approvedNewIdentities ?? []).some((item) => !validApprovedNewIdentity(item))) {
      throw new Error('Identity migration registry contains an invalid receipt or tombstone.');
    }
    return { version: 1, moves: registry.moves, tombstones: registry.tombstones ?? [], approvedNewIdentities: registry.approvedNewIdentities ?? [] };
  } catch (error) {
    if (!isMissing(error)) throw error;
    return { version: 1, moves: [], tombstones: [], approvedNewIdentities: [] };
  }
}

function hasReceipt(receipts: IdentityMoveReceipt[], issue: IdentityIssue): boolean {
  return receipts.some((receipt) => receipt.fromSkillId === issue.fromSkillId
    && receipt.toSkillId === issue.toSkillId
    && receipt.displayName === issue.displayName
    && receipt.contentRevision === issue.contentRevision);
}

function validReceipt(receipt: IdentityMoveReceipt): boolean {
  if (!receipt || receipt.version !== 1 || !receipt.fromSkillId || !receipt.toSkillId || !receipt.displayName || !receipt.contentRevision || !receipt.actor || receipt.reason.length < 12 || !receipt.approvedAt) return false;
  const { receiptDigest, ...base } = receipt;
  return /^sha256:[a-f0-9]{64}$/.test(receiptDigest) && hashText(canonicalJson(base)) === receiptDigest;
}

function validTombstone(value: IdentityTombstone): boolean {
  return Boolean(value && value.version === 1
    && /^sk_[A-Za-z0-9_-]{43}$/.test(value.skillId)
    && value.displayName
    && /^sha256:[a-f0-9]{64}$/.test(value.contentRevision)
    && value.rootId
    && value.relativePath
    && !Number.isNaN(Date.parse(value.removedAt)));
}

function validApprovedNewIdentity(value: ApprovedNewIdentityReceipt): boolean {
  if (!value || value.version !== 1 || !/^sk_[A-Za-z0-9_-]{43}$/.test(value.skillId) || !value.displayName
    || !/^sha256:[a-f0-9]{64}$/.test(value.contentRevision) || !value.actor || value.reason.length < 12 || !value.approvedAt) return false;
  const { receiptDigest, ...base } = value;
  return /^sha256:[a-f0-9]{64}$/.test(receiptDigest) && hashText(canonicalJson(base)) === receiptDigest;
}

function hasApprovedNewIdentity(receipts: ApprovedNewIdentityReceipt[], target: Inventory['skills'][number]): boolean {
  return receipts.some((receipt) => receipt.skillId === target.skillId
    && receipt.displayName === target.name
    && receipt.contentRevision === target.contentRevision);
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT');
}
