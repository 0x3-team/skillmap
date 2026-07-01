import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { readJson } from '../core/fs.js';
import { routePrompt } from '../core/route.js';
import { buildEffectiveRegistry, readPolicy } from '../core/policy.js';
import type { EffectiveRegistry } from '../schemas/types.js';
import { loadOrBuildInventory, outDir, fileExists } from './common.js';

export async function routeCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const prompt = flagString(flags, 'prompt') ?? positionals.join(' ');
  if (!prompt.trim()) throw new Error('route requires a prompt.');
  const effectivePath = path.join(outDir(cwd), 'effective.json');
  let effective: EffectiveRegistry;
  if (await fileExists(effectivePath)) {
    effective = await readJson<EffectiveRegistry>(effectivePath);
  } else {
    const inventory = await loadOrBuildInventory(cwd, [], undefined);
    const policy = await readPolicy((await fileExists(path.join(outDir(cwd), 'policy.yml'))) ? path.join(outDir(cwd), 'policy.yml') : undefined);
    effective = buildEffectiveRegistry(inventory, policy);
  }
  const result = routePrompt(effective, prompt, Number(flagString(flags, 'max') ?? '3'));
  if (hasFlag(flags, 'trace')) return { result, trace: renderTrace(result) };
  return result;
}

function renderTrace(result: ReturnType<typeof routePrompt>): string {
  const lines = [`SkillMap route trace for: ${result.prompt}`, '', 'Recommendations:'];
  for (const rec of result.recommendations) {
    lines.push(`- ${rec.name} [score=${rec.score}, tier=${rec.tier}${rec.family ? `, family=${rec.family}` : ''}]`);
    for (const reason of rec.reasons.slice(0, 6)) lines.push(`  - ${reason}`);
  }
  if (result.exclusions.length) {
    lines.push('', 'Exclusions:');
    for (const exclusion of result.exclusions.slice(0, 8)) lines.push(`- ${exclusion.name}: ${exclusion.reason}`);
  }
  lines.push('', result.hookText);
  return lines.join('\n');
}
