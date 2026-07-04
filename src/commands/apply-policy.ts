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
  const validation = validatePolicyForInventory(inventory, policy);
  const warnings = [...validation.warnings];
  if (inventoryHasFixtureRoots(inventory)) warnings.push('Current inventory includes test fixture roots; use --allow-fixtures with --strict only for fixture tests.');
  if (hasFlag(flags, 'strict')) {
    const blockers = warnings.filter((warning) => !hasFlag(flags, 'allow-fixtures') || !warning.includes('fixture'));
    if (blockers.length > 0) throw new Error(`Strict policy validation failed:\n- ${blockers.join('\n- ')}`);
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
    writes,
    warnings,
    policyValidation: validation,
    effectiveSummary: { skills: effective.skills.length, routeEligible: effective.skills.filter((skill) => skill.routeEligible).length, edges: effective.graph.edges.length },
    summary: `SkillMap apply-policy ${hasFlag(flags, 'dry-run') ? 'dry run' : 'applied'}: ${effective.skills.length} skills, ${validation.unmatchedEntries.length} unmatched policy entries, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`
  };
}
