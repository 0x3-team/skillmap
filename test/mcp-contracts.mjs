import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  SKILLMAP_MCP_MANIFEST,
  SKILLMAP_MCP_TOOL_REGISTRY,
  listSkillMapMcpTools
} from '../dist/mcp/tool-registry.js';
import {
  SKILLMAP_MCP_OUTPUT_SCHEMA_URIS,
  SKILLMAP_MCP_TOOL_NAMES,
  canonicalSkillMapMcpOutputJsonSchema,
  parseSkillMapMcpToolInput
} from '../dist/mcp/tool-schemas.js';
import { mapLocalSkillMapMcpToolError } from '../dist/mcp/local-runtime.js';

const repo = path.resolve(import.meta.dirname, '..');
const fixture = JSON.parse(await readFile(path.join(repo, 'test/fixtures/mcp/v3/manifest.json'), 'utf8'));

test('MCP manifest projection remains byte-contract compatible at v2', () => {
  assert.deepEqual(SKILLMAP_MCP_MANIFEST, fixture);
  assert.equal(JSON.stringify(SKILLMAP_MCP_MANIFEST), JSON.stringify(fixture));
  assert.deepEqual(SKILLMAP_MCP_TOOL_REGISTRY.map((tool) => tool.name), SKILLMAP_MCP_TOOL_NAMES);
  assert.equal(SKILLMAP_MCP_TOOL_REGISTRY.length, 6);
});

test('CLI mcp manifest is the frozen v2 projection rather than the negotiated server version', () => {
  const actual = JSON.parse(execFileSync(process.execPath, [path.join(repo, 'dist', 'cli.js'), 'mcp', 'manifest', '--json'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }));
  assert.deepEqual(actual, fixture);
  assert.equal(actual.version, 2);
});

test('MCP SDK tool definitions are bounded, titled, closed-world, and output-schema declared', () => {
  const tools = listSkillMapMcpTools();
  assert.deepEqual(tools.map((tool) => tool.name), [...SKILLMAP_MCP_TOOL_NAMES]);
  assert.ok(Buffer.byteLength(JSON.stringify({ tools }), 'utf8') <= 16 * 1024);
  for (const tool of tools) {
    assert.equal(typeof tool.title, 'string');
    assert.ok(tool.title.length > 0);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema.type, 'object');
    assert.equal(Object.hasOwn(tool.outputSchema, '$ref'), false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.execution.taskSupport, 'forbidden');
  }
  assert.equal(tools[0].annotations.readOnlyHint, false, 'route_prompt records a prompt-free route event');
  for (const tool of tools.slice(1)) assert.equal(tool.annotations.readOnlyHint, true);
});

test('packaged canonical output contracts freeze every per-tool nested constraint', async () => {
  for (const name of SKILLMAP_MCP_TOOL_NAMES) {
    const slug = name.replaceAll('_', '-');
    const document = JSON.parse(await readFile(path.join(
      repo,
      'contracts',
      `mcp-${slug}-result`,
      'v1.schema.json'
    ), 'utf8'));
    const { $schema, $id, title, ...canonical } = document;
    assert.equal($schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal($id, SKILLMAP_MCP_OUTPUT_SCHEMA_URIS[name]);
    assert.equal(typeof title, 'string');
    assert.deepEqual(canonical, canonicalSkillMapMcpOutputJsonSchema(name));
  }
});

test('MCP parsers enforce byte bounds, qualified ids, defaults, and unknown-key rejection', () => {
  assert.deepEqual(parseSkillMapMcpToolInput('search_skills', {}), {});
  assert.deepEqual(parseSkillMapMcpToolInput('search_skills', { query: 'design', limit: 5 }), { query: 'design', limit: 5 });
  assert.throws(() => parseSkillMapMcpToolInput('search_skills', { query: '😀'.repeat(65) }));
  assert.throws(() => parseSkillMapMcpToolInput('route_prompt', { prompt: '😀'.repeat(8193) }));
  assert.throws(() => parseSkillMapMcpToolInput('route_prompt', { prompt: 'ok', unexpected: true }));
  assert.throws(() => parseSkillMapMcpToolInput('show_skill', { skillId: 'frontend-design' }));
  assert.throws(() => parseSkillMapMcpToolInput('show_skillgraph', { limit: 101 }));
  assert.throws(() => parseSkillMapMcpToolInput('show_skillgraph', { cursor: '' }));
});

test('local runtime errors cross the MCP boundary only through fixed safe messages', () => {
  const canaries = [
    `owner-${crypto.randomUUID()}@example.invalid`,
    `${['Cook', 'ie'].join('')}: session=${crypto.randomUUID()}`,
    `private description ${crypto.randomUUID()}`
  ];
  const mapped = mapLocalSkillMapMcpToolError(new Error(canaries.join(' ')));
  assert.equal(mapped.code, 'TOOL_CALL_FAILED');
  assert.equal(mapped.message, 'The SkillMap tool call failed.');
  for (const canary of canaries) assert.equal(mapped.message.includes(canary), false);

  const approved = mapLocalSkillMapMcpToolError(Object.assign(new Error(canaries.join(' ')), {
    code: 'APPROVED_EFFECTIVE_MISSING'
  }));
  assert.equal(approved.code, 'APPROVED_EFFECTIVE_MISSING');
  assert.equal(approved.message, 'The approved SkillMap state is unavailable.');
  assert.equal(mapLocalSkillMapMcpToolError(new Error(`cursor ${canaries[0]}`)).message, 'Pagination cursor is stale or invalid.');
  assert.equal(mapLocalSkillMapMcpToolError(new Error(`not found ${canaries[1]}`)).message, 'Skill was not found in the approved revision.');
  const stale = mapLocalSkillMapMcpToolError(new Error(
    `Current canonical or raw routing state differs from the last explicitly approved revision. ${canaries[2]}`
  ));
  assert.equal(stale.code, 'APPROVED_REVISION_STALE');
  assert.equal(stale.message, 'Current canonical or raw routing state differs from the last explicitly approved revision.');
});
