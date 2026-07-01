import path from 'node:path';
import { flagString, flagStrings } from '../core/args.js';
import { buildInventory, summarizeInventory } from '../core/inventory.js';
import { resolveRoots } from '../core/roots.js';
import { writeJson } from '../core/fs.js';
import { outDir } from './common.js';

export async function scanCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const resolved = await resolveRoots(cwd, flagStrings(flags, 'root'), flagString(flags, 'fixtures'));
  const inventory = await buildInventory(cwd, resolved.roots, resolved.warnings);
  await writeJson(path.join(outDir(cwd), 'inventory.json'), inventory);
  return { inventory, summary: summarizeInventory(inventory) };
}
