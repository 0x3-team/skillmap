import { flagString } from '../core/args.js';
import type { SkillDiscoveryStrategy, SkillDiscoveryStrategyComparison } from '../core/skill-discovery-index.js';
import { createLocalSkillMapMcpRuntime } from '../mcp/local-runtime.js';
import { createSkillMapMcpServer } from '../mcp/server.js';
import { SKILLMAP_MCP_MANIFEST } from '../mcp/tool-registry.js';
import {
  isSkillMapMcpToolName,
  parseSkillMapMcpToolInput,
  type SkillMapMcpToolInput,
  type SkillMapMcpToolName
} from '../mcp/tool-schemas.js';
import { createBoundedStdioServerTransport } from '../mcp/transports/stdio.js';

export async function mcpCommand(
  cwd: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>
): Promise<unknown> {
  const action = positionals[0] ?? 'manifest';
  if (action === 'manifest') return SKILLMAP_MCP_MANIFEST;

  const runtime = createLocalSkillMapMcpRuntime(cwd, {
    discoveryStrategy: configuredDiscoveryStrategy(),
    onStrategyComparison: reportShadowMismatch
  });
  if (action === 'call') {
    const name = toolName(positionals[1]);
    const rawInput = compactUndefined({
      prompt: flagString(flags, 'prompt'),
      query: flagString(flags, 'query'),
      skillId: flagString(flags, 'skill-id'),
      max: numberArg(flagString(flags, 'max')),
      limit: numberArg(flagString(flags, 'limit')),
      cursor: flagString(flags, 'cursor')
    });
    return runtime.callTool(name, parseCliToolInput(name, rawInput));
  }

  if (action === 'serve') {
    const server = createSkillMapMcpServer(runtime);
    const transport = createBoundedStdioServerTransport({
      onLimitError: (error) => {
        process.stderr.write(`SkillMap MCP closed a connection after a request exceeded the ${error.maxBytes}-byte limit.\n`);
      }
    });
    await server.connect(transport);
    return { hookText: '' };
  }

  throw new Error('Supported mcp commands: mcp manifest, mcp call, mcp serve.');
}

function toolName(value: unknown): SkillMapMcpToolName {
  if (!isSkillMapMcpToolName(value)) {
    if (value === undefined) throw new Error('mcp call requires a tool name.');
    throw new Error('Unknown SkillMap tool.');
  }
  return value;
}

function parseCliToolInput(name: SkillMapMcpToolName, value: Record<string, unknown>): SkillMapMcpToolInput {
  try {
    return parseSkillMapMcpToolInput(name, value);
  } catch {
    throw new Error(inputErrorMessage(name, value));
  }
}

function inputErrorMessage(name: SkillMapMcpToolName, value: Record<string, unknown>): string {
  if (name === 'route_prompt') {
    if (!boundedString(value.prompt, 1, 32 * 1024)) return 'prompt is invalid.';
    if (value.max !== undefined && (!Number.isInteger(value.max) || (value.max as number) < 1 || (value.max as number) > 10)) {
      return 'max must be an integer between 1 and 10.';
    }
    if (value.skillId !== undefined && !qualifiedSkillId(value.skillId)) return 'skillId must be a qualified SkillMap id.';
    return 'Invalid route_prompt arguments.';
  }
  if (name === 'show_skill') {
    return qualifiedSkillId(value.skillId)
      ? 'Invalid show_skill arguments.'
      : 'skillId must be a qualified SkillMap id.';
  }
  if (name === 'search_skills' && value.query !== undefined && !boundedString(value.query, 0, 256)) {
    return 'query is invalid.';
  }
  if (value.limit !== undefined && (!Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)) {
    return 'limit must be an integer between 1 and 100.';
  }
  if (value.cursor !== undefined && !boundedString(value.cursor, 1, 1024)) return 'cursor is invalid.';
  return `Invalid ${name} arguments.`;
}

function configuredDiscoveryStrategy(): SkillDiscoveryStrategy {
  const value = process.env.SKILLMAP_DISCOVERY_STRATEGY ?? 'indexed';
  if (value === 'reference' || value === 'shadow' || value === 'indexed') return value;
  throw new Error('SKILLMAP_DISCOVERY_STRATEGY must be reference, shadow, or indexed.');
}

function reportShadowMismatch(comparison: SkillDiscoveryStrategyComparison): void {
  if (comparison.strategy !== 'shadow' || comparison.matched !== false) return;
  process.stderr.write(
    `SkillMap discovery shadow mismatch for approved revision ${comparison.effectiveRevisionDigest}; reference result retained.\n`
  );
}

function qualifiedSkillId(value: unknown): boolean {
  return typeof value === 'string' && /^sk_[A-Za-z0-9_-]{43}$/.test(value);
}

function boundedString(value: unknown, minimumBytes: number, maximumBytes: number): boolean {
  return typeof value === 'string'
    && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') >= minimumBytes
    && Buffer.byteLength(value, 'utf8') <= maximumBytes;
}

function numberArg(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function compactUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
