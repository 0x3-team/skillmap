import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { readJson, writeJson } from '../core/fs.js';
import { buildInventory } from '../core/inventory.js';
import {
  approvedNewIdentityReceipts,
  createApprovedNewIdentityReceipt,
  createIdentityMoveReceipt,
  identityTombstones,
  manualIdentityMoveIssue,
  persistApprovedNewIdentityReceipt,
  persistIdentityMoveReceipt
} from '../core/identity-migrations.js';
import { readPolicy } from '../core/policy.js';
import {
  createDuplicateDecision,
  persistPolicyRevision,
  readActivePolicyPointer,
  resolveActivePolicyFile,
  validatePolicyV2
} from '../core/policy-state.js';
import type { Inventory, PolicyV2 } from '../schemas/types.js';
import { outDir } from './common.js';
import { isQualifiedInventory } from '../core/identity.js';

export async function identityCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const action = positionals[0] ?? 'status';
  const inventoryFile = path.join(outDir(cwd), 'inventory.json');
  const rawInventory = await readJson<unknown>(inventoryFile);
  if (action === 'status') {
    if (!isQualifiedInventory(rawInventory)) {
      return {
        workspaceId: legacyWorkspaceId(rawInventory),
        identityIssues: [],
        pendingMoves: [],
        legacyIdentity: true,
        nextActions: ['skillmap scan'],
        summary: 'Legacy or malformed inventory identity detected. Run `skillmap scan` before routing or adopting moves.'
      };
    }
    const inventory = rawInventory;
    const pendingMoves = inventory.identityIssues.filter((issue) => issue.code === 'pending-skill-move');
    const tombstones = await identityTombstones(cwd);
    const approvedNewIdentities = await approvedNewIdentityReceipts(cwd);
    return {
      workspaceId: inventory.workspaceId,
      identityIssues: inventory.identityIssues,
      pendingMoves,
      tombstones,
      approvedNewIdentities,
      summary: `Qualified identity: ${inventory.skills.length} skill(s), ${inventory.identityIssues.length} blocking issue(s), ${pendingMoves.length} pending move(s), ${tombstones.length} unadopted removed identity record(s).`
    };
  }
  if (!isQualifiedInventory(rawInventory)) throw new Error('identity adopt-move requires a qualified inventory v2. Run `skillmap scan` first.');
  const inventory = rawInventory;
  if (action === 'approve-new') return approveNewIdentity(cwd, inventory, inventoryFile, flags);
  if (action !== 'adopt-move') throw new Error('Supported identity commands: identity status, identity adopt-move, identity approve-new.');
  const fromSkillId = flagString(flags, 'from');
  const toSkillId = flagString(flags, 'to');
  const actor = flagString(flags, 'actor');
  const reason = flagString(flags, 'reason');
  if (!fromSkillId || !toSkillId) throw new Error('identity adopt-move requires --from OLD_SKILL_ID and --to NEW_SKILL_ID.');
  if (fromSkillId === toSkillId) throw new Error('identity adopt-move requires different old and new skill IDs.');
  if (!actor || !reason) throw new Error('identity adopt-move requires --actor and --reason.');
  const recordedIssue = inventory.identityIssues.find((item) => item.toSkillId === toSkillId && (
    (item.code === 'pending-skill-move' && item.fromSkillId === fromSkillId)
    || (item.code === 'ambiguous-skill-move' && item.skillIds.includes(fromSkillId) && fromSkillId !== item.toSkillId)
  ));
  const manualIssue = recordedIssue ? undefined : await manualIdentityMoveIssue(cwd, inventory, fromSkillId, toSkillId);
  if (!recordedIssue && !manualIssue) throw new Error('No matching pending, ambiguous, or tombstoned identity move exists for the requested IDs.');
  const issue = manualIssue ?? (recordedIssue!.code === 'ambiguous-skill-move'
    ? { ...recordedIssue!, code: 'pending-skill-move' as const, fromSkillId }
    : recordedIssue!);
  const target = inventory.skills.find((skill) => skill.skillId === toSkillId);
  if (!target || target.name !== issue.displayName || target.contentRevision !== issue.contentRevision) throw new Error('Pending identity move no longer matches the target skill content; rescan and review again.');
  const fresh = await buildInventory(cwd, inventory.roots, []);
  const freshTarget = fresh.skills.find((skill) => skill.skillId === toSkillId);
  if (!freshTarget || freshTarget.name !== target.name || freshTarget.contentRevision !== target.contentRevision || fresh.identityIssues.length) {
    throw new Error('Identity move target changed or collided after the last scan. Run `skillmap scan` and review the new receipt before confirming.');
  }
  const receipt = createIdentityMoveReceipt(issue, actor, reason);
  const dryRun = hasFlag(flags, 'dry-run') || !hasFlag(flags, 'confirm');
  if (dryRun) return { dryRun: true, receipt, summary: 'Identity move adoption preview; no receipt, policy, or inventory was changed.' };

  const pointer = await readActivePolicyPointer(cwd);
  let policyArtifact: string | undefined;
  if (pointer?.activePolicyVersion === 2) {
    const activeFile = await resolveActivePolicyFile(cwd);
    if (!activeFile) throw new Error('Active policy v2 artifact is missing during identity adoption.');
    let policy = clonePolicy(validatePolicyV2(await readPolicy(activeFile)));
    const hasSourceEntry = Object.prototype.hasOwnProperty.call(policy.skillsById, fromSkillId);
    const hasTargetEntry = Object.prototype.hasOwnProperty.call(policy.skillsById, toSkillId);
    if (hasSourceEntry && hasTargetEntry && JSON.stringify(policy.skillsById[fromSkillId]) !== JSON.stringify(policy.skillsById[toSkillId])) {
      throw new Error('Identity adoption found conflicting exact policy entries for the old and new IDs; resolve policy state explicitly first.');
    }
    if (hasSourceEntry) policy.skillsById[toSkillId] = policy.skillsById[fromSkillId];
    delete policy.skillsById[fromSkillId];
    const existingDecision = policy.duplicateDecisions[target.name];
    if (existingDecision?.comparedVariants.some((variant) => variant.skillId === fromSkillId) || policy.canonicalByName[target.name] === fromSkillId) {
      const selected = policy.canonicalByName[target.name] === fromSkillId ? toSkillId : policy.canonicalByName[target.name];
      if (!selected) throw new Error(`Identity adoption cannot rebind an incomplete duplicate decision for ${target.name}.`);
      const rebound = createDuplicateDecision(policy, inventory, target.name, selected, actor, reason);
      policy = rebound.policy;
    }
    const persisted = await persistPolicyRevision(cwd, policy, pointer);
    policyArtifact = persisted.policyArtifact;
  }
  await persistIdentityMoveReceipt(cwd, receipt);
  if (recordedIssue) {
    inventory.identityIssues = inventory.identityIssues.filter((item) => item !== recordedIssue);
    inventory.warnings = inventory.warnings.filter((warning) => warning !== recordedIssue.message);
  }
  await writeJson(inventoryFile, inventory);
  return {
    dryRun: false,
    receipt,
    policyArtifact,
    summary: `Adopted identity move ${fromSkillId} -> ${toSkillId}; the receipt is revision-bound and any exact policy entry was transferred.`
  };
}

async function approveNewIdentity(
  cwd: string,
  inventory: Inventory,
  inventoryFile: string,
  flags: Record<string, string | boolean | string[]>
): Promise<unknown> {
  const skillId = flagString(flags, 'skill-id');
  const actor = flagString(flags, 'actor');
  const reason = flagString(flags, 'reason');
  if (!skillId || !actor || !reason) throw new Error('identity approve-new requires --skill-id, --actor, and --reason.');
  const target = inventory.skills.find((skill) => skill.skillId === skillId);
  if (!target) throw new Error('identity approve-new requires a current qualified --skill-id.');
  const fresh = await buildInventory(cwd, inventory.roots, [], { persistIdentity: false });
  const freshTarget = fresh.skills.find((skill) => skill.skillId === skillId);
  if (!freshTarget || freshTarget.name !== target.name || freshTarget.contentRevision !== target.contentRevision || fresh.identityIssues.length) {
    throw new Error('New identity target changed or collided after the last scan. Run `skillmap scan` and review again.');
  }
  const receipt = createApprovedNewIdentityReceipt(inventory, skillId, actor, reason);
  const dryRun = hasFlag(flags, 'dry-run') || !hasFlag(flags, 'confirm');
  if (dryRun) return { dryRun: true, receipt, summary: 'New-identity approval preview; no receipt or inventory was changed.' };
  await persistApprovedNewIdentityReceipt(cwd, receipt);
  const removedIssues = inventory.identityIssues.filter((item) => item.toSkillId === skillId);
  inventory.identityIssues = inventory.identityIssues.filter((item) => item.toSkillId !== skillId);
  const messages = new Set(removedIssues.map((item) => item.message));
  inventory.warnings = inventory.warnings.filter((warning) => !messages.has(warning));
  await writeJson(inventoryFile, inventory);
  return { dryRun: false, receipt, summary: `Approved ${skillId} as a new identity without transferring any historical policy entry.` };
}

function clonePolicy(policy: PolicyV2): PolicyV2 {
  return validatePolicyV2(JSON.parse(JSON.stringify(policy)));
}

function legacyWorkspaceId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const workspaceId = (value as Record<string, unknown>).workspaceId;
  return typeof workspaceId === 'string' ? workspaceId : undefined;
}
