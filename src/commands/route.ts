import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { readJson } from '../core/fs.js';
import { routePrompt } from '../core/route.js';
import { buildEffectiveRegistry, readPolicy } from '../core/policy.js';
import type { EffectiveRegistry } from '../schemas/types.js';
import { loadOrBuildInventory, outDir, fileExists } from './common.js';

export async function routeCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const hookMode = hasFlag(flags, 'hook');
  const prompt = await resolvePrompt(positionals, flags, hookMode);
  if (!prompt.trim()) throw new Error('route requires a prompt.');
  const effective = await loadEffective(cwd);
  const result = routePrompt(effective, prompt, Number(flagString(flags, 'max') ?? '3'));
  if (hookMode) {
    const hookText = result.recommendations.length === 0 ? '' : result.hookText;
    if (hasFlag(flags, 'json')) return { hookText, result };
    return { hookText };
  }
  if (hasFlag(flags, 'trace')) return { result, trace: renderTrace(result) };
  return result;
}

export async function loadEffective(cwd: string): Promise<EffectiveRegistry> {
  const effectivePath = path.join(outDir(cwd), 'effective.json');
  if (await fileExists(effectivePath)) return readJson<EffectiveRegistry>(effectivePath);
  const inventory = await loadOrBuildInventory(cwd, [], undefined);
  const policy = await readPolicy((await fileExists(path.join(outDir(cwd), 'policy.yml'))) ? path.join(outDir(cwd), 'policy.yml') : undefined);
  return buildEffectiveRegistry(inventory, policy);
}

async function resolvePrompt(positionals: string[], flags: Record<string, string | boolean | string[]>, hookMode: boolean): Promise<string> {
  const explicit = flagString(flags, 'prompt') ?? positionals.join(' ');
  if (explicit.trim() || !hookMode) return explicit;
  const stdin = await readStdinIfAvailable();
  if (!stdin.trim()) return '';
  try {
    const input = JSON.parse(stdin) as { prompt?: unknown };
    return typeof input.prompt === 'string' ? input.prompt : '';
  } catch {
    return stdin;
  }
}

async function readStdinIfAvailable(): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
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
