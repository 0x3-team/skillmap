import path from 'node:path';
import { hasFlag } from '../core/args.js';
import { writeText } from '../core/fs.js';
import { renderPolicy, EMPTY_POLICY } from '../core/policy.js';
import { outDir } from './common.js';

export async function initCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const dir = outDir(cwd);
  const files = [path.join(dir, 'policy.yml'), path.join(dir, 'evals.json')];
  if (!hasFlag(flags, 'dry-run')) {
    await writeText(files[0], renderPolicy(EMPTY_POLICY));
    await writeText(files[1], '{\n  "evals": []\n}\n');
  }
  return { initialized: !hasFlag(flags, 'dry-run'), files };
}
