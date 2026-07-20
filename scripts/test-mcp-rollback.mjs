import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const rollbackBase = process.env.SKILLMAP_MCP_ROLLBACK_BASE ?? '0eb57ac7c3aeda0c907435210a748a5ffb3a259e';
const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-mcp-rollback-'));
const legacyWorktree = path.join(scratch, 'legacy');
const workspace = path.join(scratch, 'workspace');
const skillRoot = path.join(scratch, 'skills');
let worktreeAdded = false;

try {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.join(skillRoot, 'rollback-alpha'), { recursive: true });
  writeFileSync(path.join(skillRoot, 'rollback-alpha', 'SKILL.md'), [
    '---',
    'name: rollback-alpha',
    'description: Use for disposable MCP transport rollback verification.',
    '---',
    '# Rollback Alpha',
    ''
  ].join('\n'));

  const candidateCli = path.join(repo, 'dist', 'cli.js');
  setupWorkspace(candidateCli);
  const beforeDigest = snapshotTree(path.join(workspace, '.skillmap'));
  const candidateSearch = JSON.parse(runCli(candidateCli, ['mcp', 'call', 'search_skills', '--query', 'rollback-alpha', '--json']));
  assert.equal(candidateSearch.ok, true);

  execFileSync('git', ['worktree', 'add', '--detach', legacyWorktree, rollbackBase], {
    cwd: repo,
    stdio: 'inherit'
  });
  worktreeAdded = true;
  execFileSync('npm', ['ci'], { cwd: legacyWorktree, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: legacyWorktree, stdio: 'inherit' });

  const legacyCli = path.join(legacyWorktree, 'dist', 'cli.js');
  const legacySearch = JSON.parse(runCli(legacyCli, ['mcp', 'call', 'search_skills', '--query', 'rollback-alpha', '--json']));
  assert.equal(legacySearch.ok, true);
  assert.deepEqual(
    legacySearch.data.items.map(item => item.skillId),
    candidateSearch.data.items.map(item => item.skillId),
    'legacy and candidate direct calls must select the same approved skill IDs'
  );

  const transcript = execFileSync(process.execPath, [legacyCli, 'mcp', 'serve'], {
    cwd: workspace,
    input: [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      ''
    ].join('\n'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit']
  }).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(transcript[0].result.serverInfo.version, 2, 'rollback target must be the pinned legacy dispatcher');
  assert.deepEqual(transcript[1].result.tools.map(tool => tool.name), [
    'route_prompt',
    'search_skills',
    'show_skill',
    'show_skillgraph',
    'doctor_summary',
    'source_status'
  ]);

  const afterDigest = snapshotTree(path.join(workspace, '.skillmap'));
  assert.equal(afterDigest, beforeDigest, 'candidate and rollback MCP reads must not mutate workspace artifacts');
  process.stdout.write(`${JSON.stringify({
    kind: 'skillmap.mcp-rollback',
    schemaVersion: 1,
    status: 'passed',
    rollbackBase,
    workspaceDigest: beforeDigest,
    selectedSkillIds: candidateSearch.data.items.map(item => item.skillId)
  })}\n`);
} finally {
  if (worktreeAdded) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', legacyWorktree], { cwd: repo, stdio: 'inherit' });
    } catch {
      // The final cleanup assertion below surfaces a retained worktree.
    }
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: repo, stdio: 'ignore' });
    } catch {
      // Best-effort metadata cleanup; the directory assertion remains authoritative.
    }
  }
  rmSync(scratch, { recursive: true, force: true });
}

function setupWorkspace(cli) {
  runCli(cli, ['init', '--root', skillRoot, '--json']);
  runCli(cli, ['scan', '--json']);
  runCli(cli, ['doctor', '--json']);
  runCli(cli, ['sources', 'check', '--json']);
  runCli(cli, ['apply-policy', '--strict', '--json']);
}

function runCli(cli, args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
}

function snapshotTree(root) {
  const hash = createHash('sha256');
  visit(root, '.');
  return `sha256:${hash.digest('hex')}`;

  function visit(target, relative) {
    const stats = lstatSync(target);
    const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : stats.isSymbolicLink() ? 'symlink' : 'other';
    hash.update(`${type}\0${relative}\0${stats.mode & 0o777}\0`);
    if (stats.isDirectory()) {
      for (const name of readdirSync(target).sort()) visit(path.join(target, name), path.posix.join(relative, name));
    } else if (stats.isFile()) {
      hash.update(readFileSync(target));
    } else if (stats.isSymbolicLink()) {
      hash.update(readlinkSync(target));
    }
    hash.update('\0');
  }
}
