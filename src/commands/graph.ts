import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { buildGraph, renderMermaid } from '../core/graph.js';
import { writeJson, writeText } from '../core/fs.js';
import type { Inventory, SkillGraph } from '../schemas/types.js';
import { loadOrBuildInventory, outDir } from './common.js';
import { openApprovedRoutingState } from '../services/workspace-read-model.js';

export async function graphCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const action = positionals[0] ?? (hasFlag(flags, 'effective') ? 'effective' : 'build');
  if (action === 'effective') return effectiveGraph(cwd);
  if (action === 'raw') return rawGraph(cwd);
  if (action === 'build') return buildSkillGraph(cwd, flags);
  if (action === 'query') return queryGraph(cwd, positionals.slice(1).join(' '));
  if (action === 'explain') return explainGraph(cwd, positionals.slice(1).join(' '));
  if (action === 'duplicates') return duplicateGraph(cwd);
  if (action === 'conflicts') return conflictGraph(cwd);
  if (action === 'export') return exportGraph(cwd, flagString(flags, 'format') ?? 'mermaid');
  throw new Error('Supported graph commands: graph build|query|explain|duplicates|conflicts|export.');
}

async function effectiveGraph(cwd: string): Promise<unknown> {
  const effective = (await openApprovedRoutingState(cwd)).effective;
  return { graph: effective.graph, mermaid: renderMermaid(effective.graph) };
}

async function rawGraph(cwd: string): Promise<unknown> {
  const inventory = await loadOrBuildInventory(cwd, [], undefined);
  const graph = buildGraph(inventory as Inventory, 'raw');
  await writeJson(path.join(outDir(cwd), 'graph.raw.json'), graph);
  await writeText(path.join(outDir(cwd), 'graph.raw.mmd'), renderMermaid(graph));
  return { graph, mermaid: renderMermaid(graph) };
}

async function buildSkillGraph(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (hasFlag(flags, 'raw')) return rawGraph(cwd);
  const effective = (await openApprovedRoutingState(cwd)).effective;
  await writeJson(path.join(outDir(cwd), 'skillgraph.json'), effective.graph);
  await writeText(path.join(outDir(cwd), 'skillgraph.mmd'), renderMermaid(effective.graph));
  return { graph: effective.graph, mermaid: renderMermaid(effective.graph), summary: `SkillMap graph build: ${effective.graph.nodes.length} nodes, ${effective.graph.edges.length} edges.` };
}

async function queryGraph(cwd: string, query: string): Promise<unknown> {
  if (!query.trim()) throw new Error('graph query requires search text.');
  const graph = await loadGraph(cwd);
  const q = query.toLowerCase();
  const nodes = graph.nodes.filter((node) => node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) || nodeIds.has(edge.to));
  return { query, nodes, edges, summary: `SkillMap graph query: ${nodes.length} node(s), ${edges.length} edge(s).` };
}

async function explainGraph(cwd: string, query: string): Promise<unknown> {
  const result = await queryGraph(cwd, query) as { query: string; nodes: Array<{ id: string; type: string; label: string }>; edges: Array<{ from: string; to: string; type: string; source: string }> };
  const lines = [`SkillMap graph explanation for: ${result.query}`, '', 'Matching nodes:'];
  for (const node of result.nodes.slice(0, 12)) lines.push(`- ${node.label} (${node.type})`);
  if (result.edges.length) {
    lines.push('', 'Related edges:');
    for (const edge of result.edges.slice(0, 20)) lines.push(`- ${edge.from} --${edge.type}/${edge.source}--> ${edge.to}`);
  }
  return { ...result, summary: lines.join('\n') };
}

async function duplicateGraph(cwd: string): Promise<unknown> {
  const inventory = await loadOrBuildInventory(cwd, [], undefined);
  const groups = new Map<string, Inventory['skills']>();
  for (const skill of inventory.skills) groups.set(skill.name, [...(groups.get(skill.name) ?? []), skill]);
  const duplicates = [...groups.entries()].filter(([, skills]) => skills.length > 1).map(([name, skills]) => ({
    name,
    variants: skills.map((skill) => ({ skillId: skill.skillId, contentRevision: skill.contentRevision, path: skill.path }))
  }));
  return { duplicates, summary: `SkillMap graph duplicates: ${duplicates.length} duplicate name group(s).` };
}

async function conflictGraph(cwd: string): Promise<unknown> {
  const graph = await loadGraph(cwd);
  const conflicts = graph.edges.filter((edge) => ['overlaps', 'supersedes', 'avoid_for'].includes(edge.type));
  return { conflicts, summary: `SkillMap graph conflicts: ${conflicts.length} overlap/supersession/avoid edge(s).` };
}

async function exportGraph(cwd: string, format: string): Promise<unknown> {
  const graph = await loadGraph(cwd);
  if (format === 'json') return { graph, summary: JSON.stringify(graph, null, 2) };
  return { graph, mermaid: renderMermaid(graph) };
}

async function loadGraph(cwd: string): Promise<SkillGraph> {
  return (await openApprovedRoutingState(cwd)).effective.graph;
}
