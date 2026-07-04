import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { readJson, writeJson } from '../core/fs.js';
import { routePrompt } from '../core/route.js';
import { evalConfidence, inventoryHasFixtureRoots, validatePolicyForInventory } from '../core/status.js';
import type { EffectiveRegistry } from '../schemas/types.js';
import { outDir } from './common.js';

interface EvalFile { evals: Array<{ prompt: string; expected: string[]; avoid?: string[] }> }

export async function evalCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const evalFile = flagString(flags, 'file') ?? path.join(cwd, 'test/fixtures/evals.json');
  const effective = await readJson<EffectiveRegistry>(path.join(outDir(cwd), 'effective.json'));
  const data = await readJson<EvalFile>(evalFile);
  let top1 = 0;
  let top3 = 0;
  let avoidHits = 0;
  const rows = data.evals.map((item) => {
    const result = routePrompt(effective, item.prompt, 3);
    const names = result.recommendations.map((rec) => rec.name);
    const expectedHit = item.expected.some((name) => names.includes(name));
    if (names[0] && item.expected.includes(names[0])) top1 += 1;
    if (expectedHit) top3 += 1;
    const bad = (item.avoid ?? []).filter((name) => names.includes(name));
    avoidHits += bad.length;
    return { prompt: item.prompt, expected: item.expected, recommended: names, avoidedButRecommended: bad, hookText: result.hookText };
  });
  const count = data.evals.length;
  const top1Rate = count === 0 ? 0 : top1 / count;
  const top3Rate = count === 0 ? 0 : top3 / count;
  const minCount = Number(flagString(flags, 'min-count') ?? '0');
  if (!Number.isFinite(minCount) || minCount < 0) throw new Error('--min-count must be a non-negative number.');
  const confidence = evalConfidence(count);
  const warnings = [...validatePolicyForInventory(effective.inventory, effective.policy).warnings];
  if (inventoryHasFixtureRoots(effective.inventory)) warnings.push('Current effective registry was built from test fixture roots.');
  if (confidence.warning) warnings.push(confidence.warning);
  const meetsMinCount = minCount === 0 || count >= minCount;
  if (!meetsMinCount) warnings.push(`Eval file has ${count} cases, below --min-count ${minCount}.`);
  const pass = count > 0 && top1Rate >= 0.75 && top3Rate >= 0.9 && avoidHits === 0 && meetsMinCount;
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count,
    top1,
    top3,
    avoidHits,
    top1Rate,
    top3Rate,
    pass,
    confidence,
    warnings,
    summary: `SkillMap eval: top1 ${top1}/${count} (${Math.round(top1Rate * 100)}%), top3 ${top3}/${count} (${Math.round(top3Rate * 100)}%), avoid hits ${avoidHits}, confidence=${confidence.level}, pass=${pass}.`,
    rows
  };
  if (hasFlag(flags, 'save-report')) await writeJson(path.join(outDir(cwd), 'eval-report.json'), output);
  return output;
}
