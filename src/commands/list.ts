import { readJson } from '../core/fs.js';
import type { Inventory } from '../schemas/types.js';
import { outDir } from './common.js';
import path from 'node:path';

export async function listCommand(cwd: string): Promise<unknown> {
  const inventory = await readJson<Inventory>(path.join(outDir(cwd), 'inventory.json'));
  return { skills: inventory.skills.map((skill) => ({ name: skill.name, description: skill.description, scope: skill.scope, path: skill.path })) };
}
