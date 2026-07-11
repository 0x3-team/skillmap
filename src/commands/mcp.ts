import { randomUUID } from 'node:crypto';
import { flagString } from '../core/args.js';
import { apiSuccess, sanitizeSafeMessage } from '../core/api-envelope.js';
import { canonicalJson } from '../core/canonical-payload.js';
import { hashText, readJson } from '../core/fs.js';
import { createRouteEvent, recordRouteEvent } from '../core/route-events.js';
import { redactedMetadataLabel } from '../core/redacted-metadata.js';
import { executeRouteUseCase } from '../services/route-use-case.js';
import { approvedArtifactPath, openApprovedRoutingState, openApprovedWorkspaceRead } from '../services/workspace-read-model.js';
import type { DoctorReport, EffectiveRegistry, RevisionRef } from '../schemas/types.js';

const MAX_REQUEST_LINE_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const SKILL_ID_PATTERN = '^sk_[A-Za-z0-9_-]{43}$';

const tools = [
  {
    name: 'route_prompt',
    description: 'Return deterministic, prompt-free SkillMap recommendations from one approved revision.',
    inputSchema: objectSchema({
      prompt: { type: 'string', minLength: 1, maxLength: 32768 },
      max: { type: 'integer', minimum: 1, maximum: 10 },
      skillId: { type: 'string', pattern: SKILL_ID_PATTERN }
    }, ['prompt'])
  },
  {
    name: 'search_skills',
    description: 'Search redacted skill metadata in one approved revision.',
    inputSchema: paginatedSchema({ query: { type: 'string', maxLength: 256 } })
  },
  {
    name: 'show_skill',
    description: 'Show one redacted skill record by qualified skillId.',
    inputSchema: objectSchema({ skillId: { type: 'string', pattern: SKILL_ID_PATTERN } }, ['skillId'])
  },
  {
    name: 'show_skillgraph',
    description: 'Page through the redacted effective SkillGraph.',
    inputSchema: paginatedSchema()
  },
  {
    name: 'doctor_summary',
    description: 'Page through compact, redacted doctor findings.',
    inputSchema: paginatedSchema()
  },
  {
    name: 'source_status',
    description: 'Page through redacted source coverage and freshness state.',
    inputSchema: paginatedSchema()
  }
] as const;

type ToolName = typeof tools[number]['name'];

export async function mcpCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const action = positionals[0] ?? 'manifest';
  if (action === 'manifest') return { version: 2, readOnly: true, tools, limits: { requestBytes: MAX_REQUEST_LINE_BYTES, responseBytes: MAX_RESPONSE_BYTES, pageSizeMax: 100 }, summary: `SkillMap MCP manifest: ${tools.length} revision-bound read-only tool(s).` };
  if (action === 'call') {
    const name = positionals[1];
    if (!name) throw new Error('mcp call requires a tool name.');
    const args = {
      prompt: flagString(flags, 'prompt'), query: flagString(flags, 'query'), skillId: flagString(flags, 'skill-id'),
      max: numberArg(flagString(flags, 'max')), limit: numberArg(flagString(flags, 'limit')), cursor: flagString(flags, 'cursor')
    };
    return callTool(cwd, toolName(name), compactUndefined(args));
  }
  if (action === 'serve') {
    await serveJsonRpc(cwd);
    return { hookText: '' };
  }
  throw new Error('Supported mcp commands: mcp manifest, mcp call, mcp serve.');
}

async function serveJsonRpc(cwd: string): Promise<void> {
  for await (const line of boundedLines(process.stdin, MAX_REQUEST_LINE_BYTES)) {
    if (!line.trim()) continue;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      writeRpc({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
      continue;
    }
    const id = isRecord(request) && validRpcId(request.id) ? request.id ?? null : null;
    try {
      const result = await handleJsonRpc(cwd, request);
      writeRpc({ jsonrpc: '2.0', id, result });
    } catch (error) {
      const rpc = error instanceof JsonRpcError ? error : new JsonRpcError(-32000, safeMessage(error));
      writeRpc({ jsonrpc: '2.0', id, error: { code: rpc.code, message: rpc.message } });
    }
  }
}

async function handleJsonRpc(cwd: string, requestValue: unknown): Promise<unknown> {
  const request = requireRecord(requestValue, -32600, 'Invalid Request.');
  exactKeys(request, ['jsonrpc', 'method'], ['id', 'params'], -32600);
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string' || !validRpcId(request.id)) throw new JsonRpcError(-32600, 'Invalid Request.');
  if (request.method === 'initialize') {
    if (request.params !== undefined && !isRecord(request.params)) throw new JsonRpcError(-32602, 'Invalid params.');
    return { protocolVersion: '2024-11-05', serverInfo: { name: 'skillmap', version: 2 }, capabilities: { tools: { listChanged: false } } };
  }
  if (request.method === 'tools/list') {
    if (request.params !== undefined && (isRecord(request.params) ? Object.keys(request.params).length > 0 : true)) throw new JsonRpcError(-32602, 'Invalid params.');
    return { tools };
  }
  if (request.method === 'tools/call') {
    const params = requireRecord(request.params, -32602, 'Invalid params.');
    exactKeys(params, ['name'], ['arguments'], -32602);
    const name = toolName(params.name);
    const args = params.arguments === undefined ? {} : requireRecord(params.arguments, -32602, 'Invalid tool arguments.');
    const result = await callTool(cwd, name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
  }
  throw new JsonRpcError(-32601, 'Method not found.');
}

async function callTool(cwd: string, name: ToolName, args: Record<string, unknown>): Promise<unknown> {
  validateToolArgs(name, args);
  if (name === 'route_prompt') {
    const state = await openApprovedRoutingState(cwd);
    const execution = executeRouteUseCase(state, {
      prompt: args.prompt as string,
      ...(args.max !== undefined ? { max: args.max as number } : {}),
      ...(args.skillId ? { qualifiedSkillId: args.skillId as string } : {})
    });
    await recordRouteEvent(cwd, createRouteEvent(execution.result, execution.currentRevision, 'mcp'));
    return apiSuccess(execution.result, receipt(state.servingRevision, state.currentRevision, state.servingMode === 'last-known-good' ? 'degraded' : 'compatible'));
  }
  const read = await openApprovedWorkspaceRead(cwd, 'routing');
  const effective = read.effective;
  if (!effective) throw new Error('Approved effective registry is unavailable.');
  const context = receipt(read.servingRevision, read.currentRevision, read.state.source === 'last-known-good' ? 'degraded' : 'compatible');
  if (name === 'search_skills') {
    const query = String(args.query ?? '').toLowerCase();
    const values = effective.skills.filter((skill) => searchable(skill).includes(query)).sort(skillSort).map(redactSkill);
    return apiSuccess(page(name, values, args, read.servingRevision), context);
  }
  if (name === 'show_skill') {
    const skill = effective.skills.find((item) => item.skillId === args.skillId);
    if (!skill) throw new Error('Skill was not found in the approved revision.');
    return apiSuccess({ skill: redactSkill(skill) }, context);
  }
  if (name === 'show_skillgraph') {
    const items = [
      ...effective.graph.nodes.map((node) => ({ kind: 'node' as const, id: node.id, type: node.type, label: redactedMetadataLabel(node.label, node.id) })),
      ...effective.graph.edges.map((edge) => ({ kind: 'edge' as const, from: edge.from, to: edge.to, type: edge.type, source: edge.source, confidence: edge.confidence }))
    ];
    return apiSuccess({ graph: page(name, items, args, read.servingRevision) }, context);
  }
  if (name === 'doctor_summary') {
    const report = await readJson<DoctorReport>(approvedArtifactPath(read, 'doctor.json'));
    const findings = report.findings.map((finding) => ({ id: finding.id, severity: finding.severity, title: finding.title, skillIds: finding.skills.filter((item) => /^sk_/.test(item)).slice(0, 20), recommendationCode: recommendationCode(finding.title) }));
    return apiSuccess({ summary: report.summary, findings: page(name, findings, args, read.servingRevision) }, context);
  }
  const report = await readJson<{ coverage?: string; inventorySkills?: number; trackedSkills?: number; records?: Array<Record<string, unknown>> }>(approvedArtifactPath(read, 'source-status.json'));
  const records = (report.records ?? []).map((record) => ({ skillId: typeof record.skillId === 'string' ? record.skillId : null, displayName: redactedMetadataLabel(record.skill, typeof record.skillId === 'string' ? record.skillId : 'unknown'), contentRevision: digestOrNull(record.contentRevision), state: typeof record.state === 'string' ? record.state : 'unknown', risk: typeof record.risk === 'string' ? record.risk : null, upstreamCommit: typeof record.upstreamCommit === 'string' && /^[a-f0-9]{40,64}$/.test(record.upstreamCommit) ? record.upstreamCommit : null }));
  return apiSuccess({ coverage: report.coverage ?? 'not-configured', inventorySkills: report.inventorySkills ?? 0, trackedSkills: report.trackedSkills ?? 0, records: page(name, records, args, read.servingRevision) }, context);
}

function validateToolArgs(name: ToolName, args: Record<string, unknown>): void {
  const commonPage = ['limit', 'cursor'];
  if (name === 'route_prompt') {
    exactKeys(args, ['prompt'], ['max', 'skillId'], -32602);
    boundedString(args.prompt, 'prompt', 1, 32768);
    if (args.max !== undefined && (!Number.isInteger(args.max) || (args.max as number) < 1 || (args.max as number) > 10)) throw new JsonRpcError(-32602, 'max must be an integer between 1 and 10.');
    if (args.skillId !== undefined) qualifiedId(args.skillId);
    return;
  }
  if (name === 'show_skill') {
    exactKeys(args, ['skillId'], [], -32602);
    qualifiedId(args.skillId);
    return;
  }
  exactKeys(args, [], name === 'search_skills' ? ['query', ...commonPage] : commonPage, -32602);
  if (args.query !== undefined) boundedString(args.query, 'query', 0, 256);
  normalizeLimit(args.limit);
  if (args.cursor !== undefined) boundedString(args.cursor, 'cursor', 1, 1024);
}

function page<T>(tool: string, values: T[], args: Record<string, unknown>, revision: RevisionRef): { items: T[]; limit: number; hasMore: boolean; nextCursor: string | null; sortKey: string } {
  const limit = normalizeLimit(args.limit);
  const binding = hashText(canonicalJson({ tool, revisionId: revision.revisionId, values }));
  const start = args.cursor ? decodeCursor(args.cursor as string, tool, binding) : 0;
  const items = values.slice(start, start + limit);
  const next = start + items.length;
  return { items, limit, hasMore: next < values.length, nextCursor: next < values.length ? encodeCursor(tool, binding, next) : null, sortKey: 'stable-v1' };
}

function encodeCursor(tool: string, binding: string, offset: number): string {
  const body = { version: 1, tool, binding, offset };
  return Buffer.from(JSON.stringify({ ...body, digest: hashText(canonicalJson(body)) }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, tool: string, binding: string): number {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new JsonRpcError(-32602, 'cursor is invalid.'); }
  const record = requireRecord(value, -32602, 'cursor is invalid.');
  exactKeys(record, ['version', 'tool', 'binding', 'offset', 'digest'], [], -32602);
  const { digest, ...body } = record;
  if (record.version !== 1 || record.tool !== tool || record.binding !== binding || !Number.isInteger(record.offset) || (record.offset as number) < 0 || digest !== hashText(canonicalJson(body))) throw new JsonRpcError(-32602, 'cursor is stale or invalid.');
  return record.offset as number;
}

function redactSkill(skill: EffectiveRegistry['skills'][number]): Record<string, unknown> {
  return {
    skillId: skill.skillId,
    displayName: redactedMetadataLabel(skill.name, skill.skillId),
    contentRevision: skill.contentRevision,
    tier: skill.tier,
    routeEligible: skill.routeEligible,
    qualifiedExplicitAllowed: skill.qualifiedExplicitAllowed,
    variantState: skill.variantState,
    hasScripts: skill.hasScripts,
    referenceCount: skill.referenceCount,
    assetCount: skill.assetCount,
    trust: skill.frontmatterValid ? 'parsed' : 'invalid-frontmatter'
  };
}

function searchable(skill: EffectiveRegistry['skills'][number]): string { return [skill.skillId, skill.name, skill.description, ...skill.aliases, ...skill.preferredFor].join(' ').toLowerCase(); }
function skillSort(left: EffectiveRegistry['skills'][number], right: EffectiveRegistry['skills'][number]): number { return left.name.localeCompare(right.name) || left.skillId.localeCompare(right.skillId); }
function receipt(servingRevision: RevisionRef, currentRevision: RevisionRef, compatibility: 'compatible' | 'degraded') { return { servingRevision, currentRevision, compatibility, requestId: randomUUID() }; }
function recommendationCode(title: string): string { return `finding-${hashText(title).slice(-12)}`; }
function digestOrNull(value: unknown): string | null { return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value) ? value : null; }
function normalizeLimit(value: unknown): number { if (value === undefined) return 20; if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) throw new JsonRpcError(-32602, 'limit must be an integer between 1 and 100.'); return value as number; }
function toolName(value: unknown): ToolName { if (typeof value !== 'string' || !tools.some((tool) => tool.name === value)) throw new JsonRpcError(-32602, 'Unknown SkillMap tool.'); return value as ToolName; }
function qualifiedId(value: unknown): string { if (typeof value !== 'string' || !new RegExp(SKILL_ID_PATTERN).test(value)) throw new JsonRpcError(-32602, 'skillId must be a qualified SkillMap id.'); return value; }
function boundedString(value: unknown, label: string, min: number, max: number): string { if (typeof value !== 'string' || value.length < min || Buffer.byteLength(value, 'utf8') > max || value.includes('\0')) throw new JsonRpcError(-32602, `${label} is invalid.`); return value; }
function requireRecord(value: unknown, code: number, message: string): Record<string, unknown> { if (!isRecord(value)) throw new JsonRpcError(code, message); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function exactKeys(record: Record<string, unknown>, required: string[], optional: string[], code: number): void { for (const key of required) if (!Object.hasOwn(record, key)) throw new JsonRpcError(code, `Missing required field: ${key}.`); const allowed = new Set([...required, ...optional]); for (const key of Object.keys(record)) if (!allowed.has(key)) throw new JsonRpcError(code, `Unknown field: ${key}.`); }
function validRpcId(value: unknown): boolean { return value === undefined || value === null || typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value)); }
function numberArg(value: string | undefined): number | undefined { if (value === undefined) return undefined; const number = Number(value); return number; }
function compactUndefined(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
function safeMessage(error: unknown): string { return sanitizeSafeMessage(error instanceof Error ? error.message : 'SkillMap tool call failed.'); }
function objectSchema(properties: Record<string, unknown>, required: string[] = []) { return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) }; }
function paginatedSchema(properties: Record<string, unknown> = {}) { return objectSchema({ ...properties, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, cursor: { type: 'string', maxLength: 1024 } }); }

async function* boundedLines(stream: NodeJS.ReadableStream, maxBytes: number): AsyncGenerator<string> {
  let buffered = Buffer.alloc(0);
  let discardingOversizedLine = false;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    buffered = Buffer.concat([buffered, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (true) {
      if (discardingOversizedLine) {
        const newline = buffered.indexOf(0x0a);
        if (newline < 0) {
          buffered = Buffer.alloc(0);
          break;
        }
        buffered = buffered.subarray(newline + 1);
        discardingOversizedLine = false;
        continue;
      }
      const newline = buffered.indexOf(0x0a);
      if (newline < 0) break;
      if (newline > maxBytes) { buffered = buffered.subarray(newline + 1); writeRpc({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request exceeds the 65536-byte limit.' } }); continue; }
      const line = buffered.subarray(0, newline).toString('utf8').replace(/\r$/, '');
      buffered = buffered.subarray(newline + 1);
      yield line;
    }
    if (buffered.length > maxBytes) {
      discardingOversizedLine = true;
      buffered = Buffer.alloc(0);
      writeRpc({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request exceeds the 65536-byte limit.' } });
    }
  }
  if (!discardingOversizedLine && buffered.length > 0) yield buffered.toString('utf8');
}

function writeRpc(value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Response exceeds the SkillMap MCP size limit.' } })}\n`);
  } else process.stdout.write(body);
}

class JsonRpcError extends Error { constructor(readonly code: number, message: string) { super(message); this.name = 'JsonRpcError'; } }
