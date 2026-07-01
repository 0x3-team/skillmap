import path from 'node:path';
import { flagString } from '../core/args.js';
import { readJson } from '../core/fs.js';
import { routePrompt } from '../core/route.js';
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
    return { prompt: item.prompt, expected: item.expected, recommended: names, avoidedButRecommended: bad };
  });
  return { count: data.evals.length, top1, top3, avoidHits, rows };
}
