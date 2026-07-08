import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { writeJson, writeText } from '../core/fs.js';
import { buildEffectiveRegistry, readPolicy } from '../core/policy.js';
import { renderMermaid } from '../core/graph.js';
import { inventoryHasFixtureRoots, validatePolicyForInventory } from '../core/status.js';
import { loadOrBuildInventory, outDir } from './common.js';

export async function applyPolicyCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const inventory = await loadOrBuildInventory(cwd, [], undefined);
  const policyFile = flagString(flags, 'policy') ?? path.join(outDir(cwd), 'policy.yml');
  const policy = await readPolicy(policyFile);
  const policyValidation = validatePolicyForInventory(inventory, policy);
  const fixtureRoots = inventoryHasFixtureRoots(inventory);
  const warnings: string[] = [];
  if (policyValidation.unmatchedEntries.length) warnings.push(`${policyValidation.unmatchedEntries.length} policy entries do not match the current inventory.`);
  if (policyValidation.duplicateInventoryNameGroups.length) warnings.push(`${policyValidation.duplicateInventoryNameGroups.length} duplicate inventory name group share policy entries.`);
  if (fixtureRoots) warnings.push('Current inventory includes test fixture roots; use --allow-fixtures with --strict only for fixture tests.');
  if (hasFlag(flags, 'strict') && (policyValidation.unmatchedEntries.length || policyValidation.duplicateInventoryNameGroups.length || (fixtureRoots && !hasFlag(flags, 'allow-fixtures')))) {
    throw new Error(`Strict policy validation failed:\n- ${warnings.join('\n- ')}`);
  }
  const effective = buildEffectiveRegistry(inventory, policy);
  const writes = [path.join(outDir(cwd), 'effective.json'), path.join(outDir(cwd), 'graph.effective.json'), path.join(outDir(cwd), 'graph.effective.mmd')];
  if (!hasFlag(flags, 'dry-run')) {
    await writeJson(writes[0], effective);
    await writeJson(writes[1], effective.graph);
    await writeText(writes[2], renderMermaid(effective.graph));
  }
  return {
    dryRun: hasFlag(flags, 'dry-run'),
    policyFile,
    warnings,
    policyValidation,
    writes,
    effectiveSummary: { skills: effective.skills.length, routeEligible: effective.skills.filter((skill) => skill.routeEligible).length, edges: effective.graph.edges.length },
    summary: `SkillMap apply-policy: ${effective.skills.length} skills, ${effective.skills.filter((skill) => skill.routeEligible).length} route eligible, ${warnings.length} warning(s).`
  };
}
