import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { readJson } from '../core/fs.js';
import { readWorkspaceIdentity } from '../core/config.js';
import { buildInventory } from '../core/inventory.js';
import { readPolicy } from '../core/policy.js';
import {
  buildPolicyV2Migration,
  createDuplicateDecision,
  duplicateDecisionMatchesInventory,
  persistPolicyMigration,
  persistPolicyRevision,
  readActivePolicyPointer,
  resolveActivePolicyFile,
  resolveLocalPolicyArtifact,
  rollbackPolicy,
  validatePolicyV2
} from '../core/policy-state.js';
import { resolveRoots } from '../core/roots.js';
import type { Inventory } from '../schemas/types.js';
import { fileExists, outDir } from './common.js';

export async function policyCommand(
  cwd: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>
): Promise<unknown> {
  const action = positionals[0] ?? 'status';
  switch (action) {
    case 'migrate':
      return migratePolicy(cwd, flags);
    case 'select-canonical':
      return selectCanonical(cwd, positionals.slice(1), flags);
    case 'rollback':
      return rollback(cwd, flags);
    case 'status':
      return policyStatus(cwd);
    default:
      throw new Error(`Unknown policy action: ${action}`);
  }
}

async function migratePolicy(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const active = await readActivePolicyPointer(cwd);
  if (active?.activePolicyVersion === 2) throw new Error('Policy v2 is already active. Roll back explicitly before migrating again.');
  const dryRun = hasFlag(flags, 'dry-run') || !hasFlag(flags, 'confirm');
  const inventory = await freshInventory(cwd);
  const sourceFile = active
    ? await requiredActivePolicyFile(cwd)
    : path.join(outDir(cwd), 'policy.yml');
  if (!(await fileExists(sourceFile))) throw new Error('Policy migration requires an existing policy v1 artifact.');
  const sourceBytes = await readFile(sourceFile, 'utf8');
  const sourcePolicy = await readPolicy(sourceFile);
  if (sourcePolicy.version !== 1) throw new Error('Policy migrate accepts only a v1 source policy.');
  const preview = buildPolicyV2Migration(inventory, sourcePolicy, sourceBytes, cwd);
  if (dryRun) {
    return {
      dryRun: true,
      policy: preview.policy,
      mappedSkills: preview.mappedSkills,
      unresolvedNames: preview.unresolvedNames,
      rollbackArtifact: preview.rollbackArtifact,
      targetPolicyArtifact: preview.targetPolicyArtifact,
      migrationReceipt: preview.migrationReceipt,
      summary: `Policy v2 migration preview: ${preview.mappedSkills} unique skill(s) mapped; ${preview.unresolvedNames.length} unresolved name(s); no files written.`
    };
  }
  const pointer = await persistPolicyMigration(cwd, preview, sourceBytes);
  return {
    dryRun: false,
    policy: preview.policy,
    mappedSkills: preview.mappedSkills,
    unresolvedNames: preview.unresolvedNames,
    rollbackArtifact: preview.rollbackArtifact,
    policyArtifact: preview.targetPolicyArtifact,
    migrationReceipt: preview.migrationReceipt,
    pointer,
    summary: `Policy v2 activated without rewriting policy v1 or skill roots. ${preview.unresolvedNames.length} name(s) require explicit resolution.`
  };
}

async function selectCanonical(
  cwd: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>
): Promise<unknown> {
  const displayName = positionals[0];
  const selectedSkillId = flagString(flags, 'skill-id');
  const actor = flagString(flags, 'actor');
  const reason = flagString(flags, 'reason');
  if (!displayName) throw new Error('policy select-canonical requires a display name.');
  if (!selectedSkillId) throw new Error('policy select-canonical requires --skill-id.');
  if (!actor) throw new Error('policy select-canonical requires --actor.');
  if (!reason) throw new Error('policy select-canonical requires --reason.');
  const pointer = await readActivePolicyPointer(cwd);
  if (!pointer || pointer.activePolicyVersion !== 2) throw new Error('policy select-canonical requires an active policy v2 migration.');
  const activeFile = await requiredActivePolicyFile(cwd);
  const activePolicy = validatePolicyV2(await readPolicy(activeFile));
  const dryRun = hasFlag(flags, 'dry-run') || !hasFlag(flags, 'confirm');
  const inventory = await freshInventory(cwd);
  const next = createDuplicateDecision(activePolicy, inventory, displayName, selectedSkillId, actor, reason);
  if (dryRun) {
    return {
      dryRun: true,
      decision: next.decision,
      policy: next.policy,
      summary: `Canonical decision preview for ${displayName}; no active pointer or policy artifact changed.`
    };
  }
  const persisted = await persistPolicyRevision(cwd, next.policy, pointer);
  return {
    dryRun: false,
    decision: next.decision,
    policy: next.policy,
    policyArtifact: persisted.policyArtifact,
    pointer: persisted.pointer,
    summary: `Canonical ${displayName} variant set to ${selectedSkillId}; noncanonical variants remain qualified-explicit only.`
  };
}

async function rollback(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const pointer = await readActivePolicyPointer(cwd);
  if (!pointer) throw new Error('No policy migration pointer exists to roll back.');
  const rollbackArtifact = resolveLocalPolicyArtifact(cwd, pointer.rollbackPolicyPath);
  if (!hasFlag(flags, 'confirm')) {
    return {
      dryRun: true,
      activePolicyVersion: pointer.activePolicyVersion,
      rollbackArtifact,
      summary: 'Policy rollback preview only; pass --confirm to change the active pointer.'
    };
  }
  const next = await rollbackPolicy(cwd, pointer);
  return {
    dryRun: false,
    activePolicyVersion: next.activePolicyVersion,
    rollbackArtifact,
    pointer: next,
    summary: 'Policy v1 rollback artifact is active. Skill roots and the original .skillmap/policy.yml were not rewritten.'
  };
}

async function policyStatus(cwd: string): Promise<unknown> {
  const pointer = await readActivePolicyPointer(cwd);
  if (!pointer) {
    const legacy = path.join(outDir(cwd), 'policy.yml');
    return {
      activePolicyVersion: await fileExists(legacy) ? 1 : undefined,
      policyFile: await fileExists(legacy) ? legacy : undefined,
      migrated: false,
      unresolvedNames: [],
      summary: await fileExists(legacy) ? 'Legacy policy v1 is active; no migration pointer exists.' : 'No policy artifact is configured.'
    };
  }
  const activeFile = await requiredActivePolicyFile(cwd);
  const policy = await readPolicy(activeFile);
  let unresolvedNames: string[] = [];
  let invalidDuplicateDecisions: string[] = [];
  if (policy.version === 2) {
    const validated = validatePolicyV2(policy);
    const inventory = await readCurrentInventory(cwd);
    const duplicateNames = inventory ? duplicateDisplayNames(inventory) : [];
    invalidDuplicateDecisions = inventory
      ? duplicateNames.filter((name) => !duplicateDecisionMatchesInventory(validated, inventory, name))
      : [];
    unresolvedNames = [...new Set([...validated.migration.unresolvedNames, ...invalidDuplicateDecisions])].sort();
  }
  return {
    activePolicyVersion: pointer.activePolicyVersion,
    policyFile: activeFile,
    migrated: true,
    unresolvedNames,
    invalidDuplicateDecisions,
    pointer,
    summary: `Policy v${pointer.activePolicyVersion} is active; ${unresolvedNames.length} duplicate or migration name(s) are unresolved.`
  };
}

async function freshInventory(cwd: string): Promise<Inventory> {
  const resolved = await resolveRoots(cwd, [], undefined);
  if (resolved.warnings.length) throw new Error(`Policy v2 requires every configured root to be available: ${resolved.warnings.join('; ')}`);
  const identity = await readWorkspaceIdentity(cwd);
  if (!identity) throw new Error('Policy v2 requires an approved workspace identity. Run `skillmap init --root PATH` and `skillmap scan` first.');
  for (const root of resolved.roots) {
    const resolvedRoot = await realpath(root);
    if (!identity.roots.some((record) => record.realPath === resolvedRoot)) {
      throw new Error(`Policy v2 refuses an unapproved root: ${root}. Run skillmap init/scan to approve it first.`);
    }
  }
  const inventory = await buildInventory(cwd, resolved.roots, resolved.warnings);
  const persistedFile = path.join(outDir(cwd), 'inventory.json');
  if (!(await fileExists(persistedFile))) throw new Error('Policy v2 requires an existing qualified inventory. Run `skillmap scan` first.');
  const persisted = await readJson<Inventory>(persistedFile);
  if (JSON.stringify(inventorySemanticProjection(persisted)) !== JSON.stringify(inventorySemanticProjection(inventory))) {
    throw new Error('Fresh inventory differs from .skillmap/inventory.json. Run `skillmap scan`, review identity changes, and refresh curation before policy migration.');
  }
  return inventory;
}

async function readCurrentInventory(cwd: string): Promise<Inventory | undefined> {
  const file = path.join(outDir(cwd), 'inventory.json');
  if (!(await fileExists(file))) return undefined;
  return JSON.parse(await readFile(file, 'utf8')) as Inventory;
}

async function requiredActivePolicyFile(cwd: string): Promise<string> {
  const file = await resolveActivePolicyFile(cwd);
  if (!file) throw new Error('Active policy pointer is missing a resolvable policy artifact.');
  if (!(await fileExists(file))) throw new Error(`Active policy artifact is missing: ${file}`);
  return file;
}

function duplicateDisplayNames(inventory: Inventory): string[] {
  const counts = new Map<string, number>();
  for (const skill of inventory.skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name).sort();
}

function inventorySemanticProjection(inventory: Inventory): unknown {
  return {
    version: inventory.version,
    identityVersion: inventory.identityVersion,
    workspaceId: inventory.workspaceId,
    roots: [...inventory.roots].sort(),
    rootRecords: [...(inventory.rootRecords ?? [])]
      .map((root) => ({ rootId: root.rootId, realPath: root.realPath }))
      .sort((a, b) => a.rootId.localeCompare(b.rootId)),
    skills: [...inventory.skills]
      .map((skill) => ({
        skillId: skill.skillId,
        rootId: skill.rootId,
        relativePath: skill.relativePath,
        contentRevision: skill.contentRevision,
        name: skill.name,
        frontmatterValid: skill.frontmatterValid,
        implicitAllowed: skill.implicitAllowed
      }))
      .sort((a, b) => a.skillId.localeCompare(b.skillId)),
    identityIssues: inventory.identityIssues ?? []
  };
}
