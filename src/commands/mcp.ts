import readline from 'node:readline';
import path from 'node:path';
import { flagString } from '../core/args.js';
import { readJson } from '../core/fs.js';
import { routePrompt } from '../core/route.js';
import { fileExists } from '../core/status.js';
import type { DoctorReport, EffectiveRegistry, Inventory, SkillGraph } from '../schemas/types.js';
import { outDir } from './common.js';

const tools = [
  { name: 'route_prompt', description: 'Return deterministic SkillMap route recommendations for a prompt.' },
  { name: 'search_skills', description: 'Search skills by name, alias, preferred use, and description.' },
  { name: 'show_skill', description: 'Show one skill registry record by name.' },
  { name: 'show_skillgraph', description: 'Return the persisted SkillGraph or effective graph.' },
  { name: 'doctor_summary', description: 'Return compact doctor findings.' },
  { name: 'source_status', description: 'Return copied/external source freshness status.' }
];

export async function mcpCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const action = positionals[0] ?? 'manifest';
  if (action === 'manifest') return { version: 1, readOnly: true, tools, summary: `SkillMap MCP manifest: ${tools.length} read-only tool(s).` };
  if (action === 'call') {
    const name = positionals[1];
    if (!name) throw new Error('mcp call requires a tool name.');
    return callTool(cwd, name, { prompt: flagString(flags, 'prompt'), query: flagString(flags, 'query'), name: flagString(flags, 'name') });
  }
  if (action === 'serve') {
    await serveJsonRpc(cwd);
    return { hookText: '' };
  }
  throw new Error('Supported mcp commands: mcp manifest, mcp call, mcp serve.');
}

async function serveJsonRpc(cwd: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let request: any;
    try {
      request = JSON.parse(line);
      const result = await handleJsonRpc(cwd, request);
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id ?? null, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })}\n`);
    }
  }
}

async function handleJsonRpc(cwd: string, request: any): Promise<unknown> {
  if (request.method === 'initialize') return { protocolVersion: '2024-11-05', serverInfo: { name: 'skillmap', version: 1 }, capabilities: { tools: {} } };
  if (request.method === 'tools/list') return { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: { type: 'object' } })) };
  if (request.method === 'tools/call') {
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    const result = await callTool(cwd, name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
  throw new Error(`Unsupported MCP method: ${request.method}`);
}

async function callTool(cwd: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'route_prompt') {
    const prompt = stringArg(args.prompt, 'prompt');
    const effective = await readJson<EffectiveRegistry>(path.join(outDir(cwd), 'effective.json'));
    return routePrompt(effective, prompt, 5);
  }
  if (name === 'search_skills') {
    const query = String(args.query ?? '').toLowerCase();
    const effective = await readJson<EffectiveRegistry>(path.join(outDir(cwd), 'effective.json'));
    return { skills: effective.skills.filter((skill) => searchable(skill).includes(query)).slice(0, 20) };
  }
  if (name === 'show_skill') {
    const skillName = stringArg(args.name, 'name');
    const effective = await readJson<EffectiveRegistry>(path.join(outDir(cwd), 'effective.json'));
    const skill = effective.skills.find((item) => item.name === skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);
    return { skill };
  }
  if (name === 'show_skillgraph') {
    const graphPath = path.join(outDir(cwd), 'skillgraph.json');
    if (await fileExists(graphPath)) return readJson<SkillGraph>(graphPath);
    const effective = await readJson<EffectiveRegistry>(path.join(outDir(cwd), 'effective.json'));
    return effective.graph;
  }
  if (name === 'doctor_summary') {
    const report = await readJson<DoctorReport>(path.join(outDir(cwd), 'doctor.json'));
    return { summary: report.summary, findings: report.findings.slice(0, 25) };
  }
  if (name === 'source_status') return readJson<unknown>(path.join(outDir(cwd), 'source-status.json'));
  throw new Error(`Unknown MCP tool: ${name}`);
}

function searchable(skill: EffectiveRegistry['skills'][number]): string {
  return [skill.name, skill.description, ...skill.aliases, ...skill.preferredFor].join(' ').toLowerCase();
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}
