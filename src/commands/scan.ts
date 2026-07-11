import { flagString, flagStrings } from '../core/args.js';
import { summarizeInventory } from '../core/inventory.js';
import { buildAndPersistInventory } from './common.js';

export async function scanCommand(cwd: string, flags: Record<string, string | boolean | string[]>, options: { logicalCwd?: string } = {}): Promise<unknown> {
  const inventory = await buildAndPersistInventory(cwd, flagStrings(flags, 'root'), flagString(flags, 'fixtures'), options);
  return { inventory, summary: summarizeInventory(inventory) };
}
