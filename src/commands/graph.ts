import path from 'node:path';
import { hasFlag } from '../core/args.js';
import { buildGraph, renderMermaid } from '../core/graph.js';
import { readJson, writeJson, writeText } from '../core/fs.js';
import type { EffectiveRegistry, Inventory } from '../schemas/types.js';
import { loadOrBuildInventory, outDir } from './common.js';

export async function graphCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (hasFlag(flags, 'effective')) {
    const effective = await readJson<EffectiveRegistry>(path.join(outDir(cwd), 'effective.json'));
    return { graph: effective.graph, mermaid: renderMermaid(effective.graph) };
  }
  const inventory = await loadOrBuildInventory(cwd, [], undefined);
  const graph = buildGraph(inventory as Inventory, 'raw');
  await writeJson(path.join(outDir(cwd), 'graph.raw.json'), graph);
  await writeText(path.join(outDir(cwd), 'graph.raw.mmd'), renderMermaid(graph));
  return { graph, mermaid: renderMermaid(graph) };
}
