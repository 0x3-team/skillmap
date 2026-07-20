import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-mcp-consumer-'));

try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }));
  assert.equal(packed.length, 1, 'npm pack must create exactly one candidate');
  const tarball = path.join(scratch, packed[0].filename);
  const tarballDigest = `sha256:${createHash('sha256').update(readFileSync(tarball)).digest('hex')}`;

  const consumer = path.join(scratch, 'consumer');
  const workspace = path.join(scratch, 'workspace');
  const skillRoot = path.join(scratch, 'skills');
  mkdirSync(consumer, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.join(skillRoot, 'consumer-alpha'), { recursive: true });
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'skillmap-mcp-consumer', version: '1.0.0', private: true }, null, 2)}\n`);
  writeFileSync(path.join(skillRoot, 'consumer-alpha', 'SKILL.md'), [
    '---',
    'name: consumer-alpha',
    'description: Use for exact packed MCP consumer verification.',
    '---',
    '# Consumer Alpha',
    ''
  ].join('\n'));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
    cwd: consumer,
    stdio: 'inherit'
  });

  const packageRoot = path.join(consumer, 'node_modules', 'skillmap');
  const cli = path.join(packageRoot, 'dist', 'cli.js');
  runCli(cli, ['init', '--root', skillRoot, '--json'], workspace);
  runCli(cli, ['scan', '--json'], workspace);
  runCli(cli, ['doctor', '--json'], workspace);
  runCli(cli, ['sources', 'check', '--json'], workspace);
  runCli(cli, ['apply-policy', '--strict', '--json'], workspace);

  const inventory = JSON.parse(readFileSync(path.join(workspace, '.skillmap', 'inventory.json'), 'utf8'));
  const skillId = inventory.skills[0]?.skillId;
  assert.match(skillId, /^sk_[A-Za-z0-9_-]{43}$/);

  const requireFromConsumer = createRequire(path.join(consumer, 'package.json'));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(requireFromConsumer.resolve('@modelcontextprotocol/sdk/client/index.js')).href),
    import(pathToFileURL(requireFromConsumer.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href)
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'mcp', 'serve'],
    cwd: workspace,
    stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr?.setEncoding('utf8');
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'skillmap-packed-consumer', version: '1.0.0' });

  try {
    const connectStarted = performance.now();
    await client.connect(transport);
    const connectMs = Math.round((performance.now() - connectStarted) * 1000) / 1000;
    const serverVersion = client.getServerVersion();
    assert.equal(typeof serverVersion?.version, 'string');
    assert.equal(serverVersion.version, '0.1.0');
    assert.match(client.getInstructions() ?? '', /route_prompt/);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), [
      'route_prompt',
      'search_skills',
      'show_skill',
      'show_skillgraph',
      'doctor_summary',
      'source_status'
    ]);
    assert.ok(Buffer.byteLength(JSON.stringify(listed), 'utf8') <= 16 * 1024, 'tools/list must remain at or below 16 KiB');

    const calls = [
      ['route_prompt', { prompt: 'Use consumer alpha for the packed client check.', skillId }],
      ['search_skills', { query: 'consumer-alpha' }],
      ['show_skill', { skillId }],
      ['show_skillgraph', {}],
      ['doctor_summary', {}],
      ['source_status', {}]
    ];
    const responseDigests = {};
    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, false, `${name} must succeed through the packed process`);
      assert.ok(result.structuredContent && typeof result.structuredContent === 'object', `${name} must return structured content`);
      const text = result.content.find(item => item.type === 'text')?.text;
      assert.equal(typeof text, 'string', `${name} must return a text fallback`);
      assert.deepEqual(JSON.parse(text), result.structuredContent, `${name} structured and text payloads must match`);
      assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') < 512 * 1024, `${name} response must remain below 512 KiB`);
      if (name === 'route_prompt' || name === 'search_skills') {
        assert.ok(Buffer.byteLength(text, 'utf8') <= 32 * 1024, `${name} default result must remain at or below 32 KiB`);
      }
      responseDigests[name] = `sha256:${createHash('sha256').update(text).digest('hex')}`;
    }

    assert.equal(stderr.includes(workspace), false, 'server stderr must not expose the workspace path');
    process.stdout.write(`${JSON.stringify({
      kind: 'skillmap.mcp-packed-consumer',
      schemaVersion: 1,
      status: 'passed',
      packageVersion: serverVersion.version,
      tarballDigest,
      tarballBytes: packed[0].size,
      unpackedBytes: packed[0].unpackedSize,
      packageEntries: packed[0].entryCount,
      connectMs,
      toolNames: listed.tools.map(tool => tool.name),
      responseDigests
    })}\n`);
  } finally {
    await client.close().catch(() => transport.close());
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function runCli(cli, args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
}
