import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parsePolicyYaml, validatePolicy } from '../core/policy.js';
import { outDir } from './common.js';

export async function ingestAgentReviewCommand(cwd: string, positionals: string[]): Promise<unknown> {
  const source = positionals[0];
  if (!source) throw new Error('ingest-agent-review requires a review file path.');
  const text = await readFile(path.resolve(cwd, source), 'utf8');
  const match = text.match(/```(?:yaml|yml)\n([\s\S]*?)```/) ?? text.match(/```json\n([\s\S]*?)```/);
  const raw = match ? match[1] : text;
  const policy = validatePolicy(raw.trim().startsWith('{') ? JSON.parse(raw) : parsePolicyYaml(raw));
  if (policy.version !== 1) throw new Error('ingest-agent-review accepts a policy v1 proposal; use policy migration commands for policy v2.');
  const dir = path.join(outDir(cwd), 'proposals');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `policy-${new Date().toISOString().replace(/[:.]/g, '-')}.yml`);
  await writeFile(file, raw.trimEnd() + '\n', 'utf8');
  return { file, skills: Object.keys(policy.skills).length };
}
