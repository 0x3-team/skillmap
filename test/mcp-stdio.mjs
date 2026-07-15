import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readRouteEvents } from '../dist/core/route-events.js';
import { SKILLMAP_MCP_TOOL_NAMES } from '../dist/mcp/tool-schemas.js';
import { SKILLMAP_PRODUCT_VERSION } from '../dist/server/compatibility.js';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist', 'cli.js');

test('official StdioClientTransport drives the built CLI lifecycle and all six tools', { timeout: 60_000 }, async (t) => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-mcp-stdio-'));
  const workspace = path.join(scratch, 'workspace');
  const skillRoot = path.join(scratch, 'skills');
  const emailName = `owner-${randomUUID()}@example.invalid`;
  const cookieName = `${['Cook', 'ie'].join('')}: session=${randomUUID()}`;
  const windowsName = `prefix:C:/Users/${randomUUID()}/private-skill`;
  const duplicatePrivateDescription = `PRIVATE_BODY_CANARY_${randomUUID().replaceAll('-', '')}`;
  const privateDescription = `private description ${randomUUID()}`;
  const privateMetadataCanaries = [
    emailName,
    cookieName,
    windowsName,
    duplicatePrivateDescription,
    privateDescription,
    ['/', 'home', randomUUID(), 'private', 'SKILL.md'].join('/'),
    `${['Bear', 'er'].join('')} ${randomUUID().replaceAll('-', '')}`
  ];
  const forbiddenOutputs = [...privateMetadataCanaries, workspace, skillRoot];
  mkdirSync(workspace, { recursive: true });
  const definitions = [
    { directory: 'alpha-design', name: 'alpha-design', description: 'Use alpha-design for frontend design workflows.' },
    { directory: 'beta-review', name: 'beta-review', description: 'Use beta-review for code review workflows.' },
    { directory: 'email-skill', name: emailName, description: duplicatePrivateDescription, script: true },
    { directory: 'cookie-skill', name: cookieName, description: duplicatePrivateDescription },
    { directory: 'windows-skill', name: windowsName, description: privateDescription }
  ];
  for (const definition of definitions) {
    const directory = path.join(skillRoot, definition.directory);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'SKILL.md'), [
      '---',
      `name: ${JSON.stringify(definition.name)}`,
      `description: ${JSON.stringify(definition.description)}`,
      '---',
      `# ${definition.name}`,
      ''
    ].join('\n'));
    if (definition.script) {
      mkdirSync(path.join(directory, 'scripts'), { recursive: true });
      writeFileSync(path.join(directory, 'scripts', 'index.js'), 'export default true;\n');
    }
  }
  setupWorkspace(workspace, skillRoot);
  const inventory = JSON.parse(readFileSync(path.join(workspace, '.skillmap', 'inventory.json'), 'utf8'));
  const skillId = inventory.skills.find(skill => skill.name === 'alpha-design')?.skillId;
  assert.match(skillId, /^sk_[A-Za-z0-9_-]{43}$/);
  const privateSkills = [emailName, cookieName, windowsName].map((name) => ({
    name,
    skillId: inventory.skills.find((skill) => skill.name === name)?.skillId
  }));
  for (const item of privateSkills) assert.match(item.skillId, /^sk_[A-Za-z0-9_-]{43}$/);

  const sessions = [];
  t.after(async () => {
    await Promise.all(sessions.map(session => session.close()));
    rmSync(scratch, { recursive: true, force: true });
  });
  const first = await openSpawnedSession(workspace, 'first');
  sessions.push(first);

  assert.deepEqual(first.client.getServerVersion(), { name: 'skillmap', version: SKILLMAP_PRODUCT_VERSION });
  assert.match(first.client.getInstructions() ?? '', /prompt-free route event/);
  const listed = await first.client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), [...SKILLMAP_MCP_TOOL_NAMES]);
  assert.ok(Buffer.byteLength(JSON.stringify(listed), 'utf8') <= 16 * 1024);

  const prompt = `Select alpha-design without echoing this runtime canary ${Date.now()}.`;
  const calls = [
    ['route_prompt', { prompt, skillId }],
    ['search_skills', { query: 'alpha-design' }],
    ['show_skill', { skillId }],
    ['show_skillgraph', {}],
    ['doctor_summary', {}],
    ['source_status', {}]
  ];
  const results = new Map();
  for (const [name, args] of calls) {
    const result = await first.client.callTool({ name, arguments: args });
    results.set(name, result);
    assert.equal(result.isError, false, `${name} must succeed over the spawned stdio process`);
    const text = result.content.find(item => item.type === 'text')?.text;
    assert.equal(typeof text, 'string');
    assert.deepEqual(JSON.parse(text), result.structuredContent);
    assert.equal(text.includes(prompt), false, `${name} must not echo the raw route prompt`);
    for (const canary of forbiddenOutputs) {
      assert.equal(text.includes(canary), false, `${name} must not expose private skill metadata`);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 512 * 1024);
  }

  const directSearch = JSON.parse(runCli([
    'mcp', 'call', 'search_skills', '--query', 'alpha-design', '--json'
  ], workspace));
  const sdkSearch = structuredResult(results.get('search_skills'));
  assert.deepEqual(directSearch.data, sdkSearch.data);
  assert.deepEqual(directSearch.servingRevision, sdkSearch.servingRevision);
  assert.deepEqual(directSearch.currentRevision, sdkSearch.currentRevision);
  assert.equal(directSearch.compatibility, sdkSearch.compatibility);

  const referenceSearch = JSON.parse(runCli([
    'mcp', 'call', 'search_skills', '--query', 'alpha-design', '--json'
  ], workspace, { SKILLMAP_DISCOVERY_STRATEGY: 'reference' }));
  const shadowSearch = JSON.parse(runCli([
    'mcp', 'call', 'search_skills', '--query', 'alpha-design', '--json'
  ], workspace, { SKILLMAP_DISCOVERY_STRATEGY: 'shadow' }));
  assert.deepEqual(referenceSearch.data, directSearch.data, 'reference kill switch must preserve exact search semantics');
  assert.deepEqual(shadowSearch.data, directSearch.data, 'shadow strategy must return the reference search result');

  const indexedRoute = JSON.parse(runCli([
    'mcp', 'call', 'route_prompt', '--prompt', prompt, '--skill-id', skillId, '--json'
  ], workspace));
  const referenceRoute = JSON.parse(runCli([
    'mcp', 'call', 'route_prompt', '--prompt', prompt, '--skill-id', skillId, '--json'
  ], workspace, { SKILLMAP_DISCOVERY_STRATEGY: 'reference' }));
  assert.deepEqual(referenceRoute.data.decision, indexedRoute.data.decision);
  assert.equal(referenceRoute.data.decisionDigest, indexedRoute.data.decisionDigest);

  for (const privateSkill of privateSkills) {
    const sensitiveCalls = [
      ['route_prompt', { prompt: `Use ${privateSkill.name}`, skillId: privateSkill.skillId }],
      ['search_skills', { query: privateSkill.name }],
      ['show_skill', { skillId: privateSkill.skillId }]
    ];
    for (const [name, args] of sensitiveCalls) {
      const result = await first.client.callTool({ name, arguments: args });
      assert.equal(result.isError, false);
      const text = result.content.find((item) => item.type === 'text')?.text ?? '';
      for (const canary of forbiddenOutputs) assert.equal(text.includes(canary), false);
    }
  }

  const unknownKey = privateMetadataCanaries.at(-1);
  const invalidArguments = await first.client.callTool({
    name: 'route_prompt',
    arguments: { prompt: 'valid prompt', [unknownKey]: true }
  });
  assert.equal(invalidArguments.isError, true);
  assert.equal(invalidArguments.content[0].text.includes(unknownKey), false);
  const invalidTool = await first.client.callTool({ name: unknownKey, arguments: {} });
  assert.equal(invalidTool.isError, true);
  assert.equal(invalidTool.content[0].text.includes(unknownKey), false);

  assert.throws(
    () => execFileSync(process.execPath, [cli, 'mcp', 'call', 'search_skills', '--json'], {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, SKILLMAP_DISCOVERY_STRATEGY: 'invalid' },
      stdio: ['ignore', 'pipe', 'pipe']
    }),
    (error) => Buffer.from(error.stderr ?? '').toString('utf8').includes(
      'SKILLMAP_DISCOVERY_STRATEGY must be reference, shadow, or indexed.'
    )
  );

  const firstPage = await first.client.callTool({ name: 'search_skills', arguments: { query: '', limit: 1 } });
  assert.equal(firstPage.isError, false);
  const cursor = firstPage.structuredContent.data.nextCursor;
  assert.equal(typeof cursor, 'string');

  const second = await openSpawnedSession(workspace, 'second');
  sessions.push(second);
  const [alpha, beta] = await Promise.all([
    first.client.callTool({ name: 'search_skills', arguments: { query: 'alpha-design' } }),
    second.client.callTool({ name: 'search_skills', arguments: { query: 'beta-review' } })
  ]);
  assert.deepEqual(alpha.structuredContent.data.items.map(item => item.displayName), ['alpha-design']);
  assert.deepEqual(beta.structuredContent.data.items.map(item => item.displayName), ['beta-review']);
  assert.notEqual(alpha.structuredContent.requestId, beta.structuredContent.requestId);
  const crossQueryCursor = await second.client.callTool({
    name: 'search_skills',
    arguments: { query: 'beta-review', cursor }
  });
  assert.equal(crossQueryCursor.isError, true);
  assert.equal(JSON.parse(crossQueryCursor.content[0].text).error.code, 'INVALID_CURSOR');
  for (const name of ['show_skillgraph', 'doctor_summary']) {
    const crossToolCursor = await second.client.callTool({ name, arguments: { cursor } });
    assert.equal(crossToolCursor.isError, true);
    assert.equal(JSON.parse(crossToolCursor.content[0].text).error.code, 'INVALID_CURSOR');
  }

  await first.close();
  const reconnect = await openSpawnedSession(workspace, 'reconnect');
  sessions.push(reconnect);
  assert.deepEqual((await reconnect.client.listTools()).tools.map(tool => tool.name), [...SKILLMAP_MCP_TOOL_NAMES]);

  const retained = await readRouteEvents(workspace, { limit: 10 });
  assert.equal(retained.events.length, 6);
  assert.equal(retained.events.every(event => event.surface === 'mcp'), true);
  assert.equal(retained.events.every(event => event.promptStored === false), true);
  assert.equal(JSON.stringify(retained).includes(prompt), false);
  for (const canary of forbiddenOutputs) assert.equal(JSON.stringify(retained).includes(canary), false);
  for (const session of sessions) {
    assert.equal(session.stderr.includes(prompt), false);
    for (const canary of forbiddenOutputs) assert.equal(session.stderr.includes(canary), false);
  }
});

test('spawned stdio fails closed above 64 KiB without echoing the rejected frame', { timeout: 10_000 }, async (t) => {
  const child = spawn(process.execPath, [cli, 'mcp', 'serve'], {
    cwd: repo,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  });

  const canary = `oversized-${randomUUID()}`;
  child.stdin.end(`${canary}${'x'.repeat(64 * 1024 + 1)}\n`);
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('oversized stdio child did not close')), 5_000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  assert.ok(exit.code !== null || exit.signal !== null);
  assert.equal(stdout, '');
  assert.match(stderr, /request exceeded the 65536-byte limit/);
  assert.equal(stderr.includes(canary), false);
});

function setupWorkspace(workspace, skillRoot) {
  runCli(['init', '--root', skillRoot, '--json'], workspace);
  runCli(['scan', '--json'], workspace);
  runCli(['doctor', '--json'], workspace);
  runCli(['sources', 'check', '--json'], workspace);
  runCli(['apply-policy', '--strict', '--json'], workspace);
}

function runCli(args, cwd, environment = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'inherit']
  });
}

async function openSpawnedSession(cwd, suffix) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp', 'serve'],
    cwd,
    stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr?.setEncoding('utf8');
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: `skillmap-stdio-${suffix}`, version: '1.0.0' }, { capabilities: {} });
  let closed = false;
  await client.connect(transport);
  return {
    client,
    get stderr() { return stderr; },
    async close() {
      if (closed) return;
      closed = true;
      await client.close().catch(() => transport.close());
    }
  };
}

function structuredResult(value) {
  assert.ok(value && typeof value === 'object' && value.structuredContent);
  return value.structuredContent;
}
