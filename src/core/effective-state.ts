import { access } from 'node:fs/promises';
import path from 'node:path';
import type { EffectiveRegistry, Inventory, Policy } from '../schemas/types.js';
import { assertQualifiedInventory, isQualifiedInventory } from './identity.js';
import { hashFile, hashText, readJson } from './fs.js';
import { buildEffectiveRegistry, readActivePolicy, readPolicy } from './policy.js';
import { readActivePolicyPointer } from './policy-state.js';
import { canonicalJson } from './canonical-payload.js';

export interface EffectiveFreshness {
  fresh: boolean;
  reasons: string[];
}

export async function resolveCurrentEffective(
  cwd: string,
  inventory?: Inventory,
  saved?: EffectiveRegistry
): Promise<EffectiveRegistry> {
  const currentInventory = inventory ?? await readJson<Inventory>(path.join(cwd, '.skillmap', 'inventory.json'));
  assertQualifiedInventory(currentInventory, 'resolve effective routing state');
  const policy = await resolveCurrentPolicy(cwd, saved);
  return buildEffectiveRegistry(currentInventory, policy);
}

export async function effectiveFreshness(cwd: string, saved: EffectiveRegistry, inventory: Inventory): Promise<EffectiveFreshness> {
  const reasons: string[] = [];
  if (!isQualifiedInventory(inventory)) return { fresh: false, reasons: ['inventory is not qualified v2'] };
  if (!isQualifiedInventory(saved.inventory)) reasons.push('saved registry embeds legacy or malformed inventory identity');
  if (!Array.isArray(saved.skills) || saved.skills.some((skill) => !/^sk_[A-Za-z0-9_-]{43}$/.test(skill.skillId) || !/^sha256:[a-f0-9]{64}$/.test(skill.contentRevision))) {
    reasons.push('saved registry contains legacy or malformed skill identity');
  }
  const inputs = saved.inputs;
  if (!inputs) reasons.push('saved registry has no input digest receipt');
  if (inputs) {
    const inventoryFile = path.join(cwd, '.skillmap', 'inventory.json');
    if (!await exists(inventoryFile) || await hashFile(inventoryFile) !== inputs.inventoryDigest) reasons.push('inventory digest changed');
    const pointer = await readActivePolicyPointer(cwd);
    if (inputs.policySelection === 'explicit') {
      if (pointer) reasons.push('active policy pointer supersedes the explicit saved policy');
      else if (!await exists(inputs.policySource) || await hashFile(inputs.policySource) !== inputs.policyDigest) reasons.push('explicit policy source changed or disappeared');
    } else {
      const active = await readActivePolicy(cwd);
      if (!active.file || path.resolve(active.file) !== path.resolve(inputs.policySource) || !await exists(active.file) || await hashFile(active.file) !== inputs.policyDigest) {
        reasons.push('active policy selection or digest changed');
      }
    }
  }
  if (reasons.length === 0) {
    try {
      const rebuilt = await resolveCurrentEffective(cwd, inventory, saved);
      if (canonicalJson(jsonClean(effectiveProjection(saved))) !== canonicalJson(jsonClean(effectiveProjection(rebuilt)))) reasons.push('saved registry projection does not match recomputed state');
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { fresh: reasons.length === 0, reasons };
}

export function computeEffectiveRevisionDigest(registry: EffectiveRegistry): string {
  return hashText(canonicalJson(jsonClean(effectiveProjection(registry))));
}

async function resolveCurrentPolicy(cwd: string, saved: EffectiveRegistry | undefined): Promise<Policy> {
  const pointer = await readActivePolicyPointer(cwd);
  const inputs = saved?.inputs;
  if (inputs?.policySelection === 'explicit' && !pointer) {
    if (!await exists(inputs.policySource)) throw new Error('Previously applied explicit policy is missing; run `skillmap apply-policy --policy FILE` again.');
    if (await hashFile(inputs.policySource) !== inputs.policyDigest) throw new Error('Previously applied explicit policy changed; run `skillmap apply-policy --policy FILE` again.');
    return readPolicy(inputs.policySource);
  }
  return (await readActivePolicy(cwd)).policy;
}

function effectiveProjection(registry: EffectiveRegistry): unknown {
  return {
    version: registry.version,
    inventoryWorkspaceId: registry.inventory.workspaceId,
    policy: registry.policy,
    skills: registry.skills,
    graph: { version: registry.graph.version, mode: registry.graph.mode, nodes: registry.graph.nodes, edges: registry.graph.edges }
  };
}

function jsonClean(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
