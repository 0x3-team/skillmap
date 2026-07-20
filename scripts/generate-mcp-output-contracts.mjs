#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSkillMapMcpServer } from '../dist/mcp/server.js';
import { listSkillMapMcpTools } from '../dist/mcp/tool-registry.js';
import {
  SKILLMAP_MCP_OUTPUT_SCHEMA_URIS,
  SKILLMAP_MCP_TOOL_NAMES,
  canonicalSkillMapMcpOutputJsonSchema
} from '../dist/mcp/tool-schemas.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const stale = [];

for (const name of SKILLMAP_MCP_TOOL_NAMES) {
  const slug = name.replaceAll('_', '-');
  const target = path.join(repo, 'contracts', `mcp-${slug}-result`, 'v1.schema.json');
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: SKILLMAP_MCP_OUTPUT_SCHEMA_URIS[name],
    title: `SkillMap MCP ${name} success result v1`,
    ...canonicalSkillMapMcpOutputJsonSchema(name)
  };
  const source = `${JSON.stringify(document, null, 2)}\n`;
  if (check) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== source) stale.push(path.relative(repo, target));
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source, 'utf8');
  }
}

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createSkillMapMcpServer({
  async callTool() { throw new Error('The tools/list fixture runtime cannot execute tools.'); }
});
const client = new Client({ name: 'skillmap-tools-list-fixture', version: '1.0.0' }, { capabilities: {} });
await server.connect(serverTransport);
await client.connect(clientTransport);
const actualToolsList = await client.listTools();
await client.close();
await server.close().catch(() => undefined);
const helperToolsList = { tools: listSkillMapMcpTools() };
if (JSON.stringify(actualToolsList.tools.map((tool) => tool.name)) !== JSON.stringify(helperToolsList.tools.map((tool) => tool.name))) {
  throw new Error('SDK and helper tools/list order diverged.');
}
const toolsListTarget = path.join(repo, 'test', 'fixtures', 'mcp', 'v3', 'tools-list.json');
const toolsListSource = `${JSON.stringify(actualToolsList, null, 2)}\n`;
if (check) {
  const current = await readFile(toolsListTarget, 'utf8').catch(() => '');
  if (current !== toolsListSource) stale.push(path.relative(repo, toolsListTarget));
} else {
  await mkdir(path.dirname(toolsListTarget), { recursive: true });
  await writeFile(toolsListTarget, toolsListSource, 'utf8');
}

if (stale.length > 0) {
  throw new Error(`Generated MCP output contracts are stale: ${stale.join(', ')}. Run npm run generate:mcp-contracts.`);
}

if (!check) process.stdout.write(`Generated ${SKILLMAP_MCP_TOOL_NAMES.length} MCP output contracts and the SDK tools/list fixture.\n`);
