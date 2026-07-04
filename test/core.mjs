import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
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

test('doctor-pack summary includes curation prompt and omits full catalog', () => {
  const cwd = tempProject();
  const output = JSON.parse(run(['doctor-pack', '--fixtures', 'test/fixtures/basic', '--summary', '--json'], cwd));
  assert.equal(output.summaryOnly, true);
  assert.ok(output.bytes > 1000);
  assert.match(output.markdown, /Recommended Native-Agent Prompt/);
  assert.match(output.markdown, /Policy Proposal Skeleton/);
  assert.doesNotMatch(output.markdown, /\| Skill \| Description \|/);
});



test('status flags fixture inventories and unmatched policy entries', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  mkdirSync(path.join(cwd, '.skillmap'), { recursive: true });
  writeFileSync(path.join(cwd, '.skillmap/policy.yml'), 'version: 1\nskills:\n  frontend-design:\n    tier: active-default\n  ghost-skill:\n    tier: specialist\n');
  const output = JSON.parse(run(['status', '--json'], cwd));
  assert.equal(output.status.verdict, 'attention required');
  assert.equal(output.status.inventory.hasFixtureRoots, true);
  assert.equal(output.status.policy.unmatchedEntries, 1);
  assert.match(output.summary, /Current inventory includes test fixture roots/);
});

test('apply-policy warns by default and strict blocks mismatched fixture state', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  mkdirSync(path.join(cwd, '.skillmap'), { recursive: true });
  writeFileSync(path.join(cwd, '.skillmap/policy.yml'), 'version: 1\nskills:\n  frontend-design:\n    tier: active-default\n  ghost-skill:\n    tier: specialist\n');
  const dryRun = JSON.parse(run(['apply-policy', '--policy', '.skillmap/policy.yml', '--dry-run', '--json'], cwd));
  assert.equal(dryRun.policyValidation.unmatchedEntries.length, 1);
  assert.match(dryRun.warnings.join('\n'), /fixture/);
  assert.throws(() => run(['apply-policy', '--policy', '.skillmap/policy.yml', '--dry-run', '--strict'], cwd), /Strict policy validation failed/);
});

test('curate prepare and ingest record user-reported Codex provenance', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['doctor'], cwd);
  run(['doctor-pack', '--summary'], cwd);
  const prepared = JSON.parse(run(['curate', 'codex', '--prepare', '--json'], cwd));
  assert.equal(existsSync(prepared.promptFile), true);
  mkdirSync(path.join(cwd, '.skillmap/proposals'), { recursive: true });
  cpSync(path.join(cwd, 'test/fixtures/policy.yml'), path.join(cwd, '.skillmap/proposals/policy.yml'));
  writeFileSync(path.join(cwd, '.skillmap/proposals/policy-rationale.md'), '# Rationale\n\nCodex reviewed the fixture library.\n');
  const preview = JSON.parse(run(['curate', 'codex', '--ingest', '.skillmap/proposals/policy.yml', '--rationale', '.skillmap/proposals/policy-rationale.md', '--model', 'codex-sota', '--dry-run', '--json'], cwd));
  assert.equal(preview.dryRun, true);
  const ingested = JSON.parse(run(['curate', 'codex', '--ingest', '.skillmap/proposals/policy.yml', '--rationale', '.skillmap/proposals/policy-rationale.md', '--model', 'codex-sota', '--confirm', '--json'], cwd));
  assert.equal(ingested.receipt.agent.model, 'codex-sota');
  assert.equal(ingested.receipt.agent.modelVerification, 'user-reported');
  assert.equal(existsSync(path.join(cwd, '.skillmap/curation/receipt.json')), true);
});

test('policy changes effective routing and excludes archived skills', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const output = JSON.parse(run(['route', 'make this dashboard less generic and verify mobile', '--json'], cwd));
  assert.equal(output.recommendations[0].name, 'frontend-design');
  assert.equal(output.recommendations.some((rec) => rec.name === 'broad-helper'), false);
});

test('route hook mode emits compact context', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const output = run(['route', '--hook', '--prompt', 'make this dashboard less generic and verify mobile'], cwd);
  assert.match(output, /^SkillMap: prefer frontend-design/);
  assert.ok(output.trim().length < 500);
});

test('hook install dry-run and uninstall merge Codex hooks safely', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const config = path.join(cwd, 'hooks.json');
  writeFileSync(config, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }, null, 2));

  const dryRun = JSON.parse(run(['hook', 'install', 'codex', '--passive', '--dry-run', '--config', config, '--json'], cwd));
  assert.equal(dryRun.dryRun, true);
  assert.equal(existsSync(`${config}.skillmap-backup`), false);
  assert.match(dryRun.command, / route --hook/);

  const installed = JSON.parse(run(['hook', 'install', 'codex', '--passive', '--config', config, '--json'], cwd));
  assert.equal(installed.changed, true);
  const hookFile = JSON.parse(readFileSync(config, 'utf8'));
  assert.equal(hookFile.hooks.Stop.length, 1);
  assert.equal(hookFile.hooks.UserPromptSubmit.length, 1);

  const uninstalled = JSON.parse(run(['hook', 'uninstall', 'codex', '--config', config, '--json'], cwd));
  assert.equal(uninstalled.changed, true);
  const cleaned = JSON.parse(readFileSync(config, 'utf8'));
  assert.equal(cleaned.hooks.UserPromptSubmit, undefined);
  assert.equal(cleaned.hooks.Stop.length, 1);
});

test('eval reports expected hits and pass metrics', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const output = JSON.parse(run(['eval', '--file', 'test/fixtures/evals.json', '--json'], cwd));
  assert.equal(output.count, 10);
  assert.ok(output.top3 >= 8);
  assert.equal(output.avoidHits, 0);
  assert.equal(typeof output.pass, 'boolean');
  assert.equal(output.confidence.level, 'weak');
  assert.match(output.summary, /SkillMap eval:/);
});
