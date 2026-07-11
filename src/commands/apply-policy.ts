import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { hashFile, hashText, readJson, writeJson, writeText } from '../core/fs.js';
import { canonicalJson } from '../core/canonical-payload.js';
import { buildEffectiveRegistry, readActivePolicy } from '../core/policy.js';
import { renderMermaid } from '../core/graph.js';
import { inventoryHasFixtureRoots, validatePolicyForInventory } from '../core/status.js';
import { loadOrBuildInventory, outDir } from './common.js';
import type { Inventory } from '../schemas/types.js';
import { assertQualifiedInventory } from '../core/identity.js';

export async function applyPolicyCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const dryRun = hasFlag(flags, 'dry-run');
  const inventoryPath = path.join(outDir(cwd), 'inventory.json');
  const inventory = dryRun
    ? await readExistingInventory(inventoryPath)
    : await loadOrBuildInventory(cwd, [], undefined);
  const requestedPolicyFile = flagString(flags, 'policy');
  const active = await readActivePolicy(cwd, requestedPolicyFile);
  let policyFile = active.file ?? requestedPolicyFile ?? path.join(outDir(cwd), 'policy.yml');
  const policy = active.policy;
  assertQualifiedInventory(inventory, 'apply policy');
  const policyValidation = validatePolicyForInventory(inventory, policy);
  if (inventory.identityIssues?.length) throw new Error(`Policy application blocked by ${inventory.identityIssues.length} qualified identity issue(s). Run \`skillmap identity status\`.`);
  const fixtureRoots = inventoryHasFixtureRoots(inventory);
  const warnings: string[] = [];
  if (policyValidation.unmatchedEntries.length) warnings.push(`${policyValidation.unmatchedEntries.length} policy entries do not match the current inventory.`);
  if (policyValidation.duplicateInventoryNameGroups.length) warnings.push(`${policyValidation.duplicateInventoryNameGroups.length} unresolved duplicate inventory name group(s) require qualified identity and a canonical decision.`);
  if (fixtureRoots) warnings.push('Current inventory includes test fixture roots; use --allow-fixtures with --strict only for fixture tests.');
  if (hasFlag(flags, 'strict') && (policyValidation.unmatchedEntries.length || policyValidation.duplicateInventoryNameGroups.length || (fixtureRoots && !hasFlag(flags, 'allow-fixtures')))) {
    throw new Error(`Strict policy validation failed:\n- ${warnings.join('\n- ')}`);
  }
  const effective = buildEffectiveRegistry(inventory, policy);
  if (requestedPolicyFile && !dryRun) {
    const semanticDigest = hashText(canonicalJson(policy)).slice('sha256:'.length);
    policyFile = path.join(outDir(cwd), 'policies', 'applied', `policy-${semanticDigest}.json`);
    await writeText(policyFile, JSON.stringify(policy, null, 2));
  }
  effective.inputs = {
    inventoryDigest: await hashFile(inventoryPath),
    policyDigest: await hashFile(path.resolve(cwd, policyFile)),
    policySource: path.resolve(cwd, policyFile),
    policySelection: requestedPolicyFile ? 'explicit' : 'active'
  };
  const writes = [path.join(outDir(cwd), 'effective.json'), path.join(outDir(cwd), 'graph.effective.json'), path.join(outDir(cwd), 'graph.effective.mmd')];
  if (!dryRun) {
    await writeJson(writes[0], effective);
    await writeJson(writes[1], effective.graph);
    await writeText(writes[2], renderMermaid(effective.graph));
  }
  return {
    dryRun,
    policyFile,
    warnings,
    policyValidation,
    writes,
    effectiveSummary: { skills: effective.skills.length, routeEligible: effective.skills.filter((skill) => skill.routeEligible).length, edges: effective.graph.edges.length },
    summary: `SkillMap apply-policy: ${effective.skills.length} skills, ${effective.skills.filter((skill) => skill.routeEligible).length} route eligible, ${warnings.length} warning(s).`
  };
}

async function readExistingInventory(file: string): Promise<Inventory> {
  try {
    return await readJson<Inventory>(file);
  } catch {
    throw new Error('apply-policy --dry-run requires an existing inventory. Run `skillmap scan` first; dry-run does not create artifacts.');
  }
}
