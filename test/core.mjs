import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist/cli.js');

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function tempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), 'skillmap-test-'));
  cpSync(path.join(repo, 'test/fixtures'), path.join(dir, 'test/fixtures'), { recursive: true });
  return dir;
}

test('scan inventories fixture skills', () => {
  const cwd = tempProject();
  const output = JSON.parse(run(['scan', '--fixtures', 'test/fixtures/basic', '--json'], cwd));
  assert.equal(output.inventory.skills.length, 10);
  assert.match(output.summary, /10 skills/);
});

test('doctor finds duplicates, scripts, and broad descriptions', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  const output = JSON.parse(run(['doctor', '--json'], cwd));
  const titles = output.report.findings.map((finding) => finding.title).join('\n');
  assert.match(titles, /Duplicate skill name: frontend-design/);
  assert.match(titles, /Skill has executable scripts: security-review/);
  assert.match(titles, /Broad trigger language: broad-helper/);
});

test('policy changes effective routing and excludes archived skills', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const output = JSON.parse(run(['route', 'make this dashboard less generic and verify mobile', '--json'], cwd));
  assert.equal(output.recommendations[0].name, 'frontend-design');
  assert.equal(output.recommendations.some((rec) => rec.name === 'broad-helper'), false);
});

test('eval reports expected hits', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const output = JSON.parse(run(['eval', '--file', 'test/fixtures/evals.json', '--json'], cwd));
  assert.equal(output.count, 10);
  assert.ok(output.top3 >= 8);
  assert.equal(output.avoidHits, 0);
});
