import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
  assert.match(output.markdown, /skillmap curate codex --prepare/);
  assert.match(output.markdown, /Policy Proposal Skeleton/);
  assert.doesNotMatch(output.markdown, /\| Skill \| Description \|/);
});

test('status flags fixture inventories and unmatched policy entries', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  writeFileSync(path.join(cwd, '.skillmap/policy.yml'), 'version: 1\nskills:\n  frontend-design:\n    tier: active-default\n  missing-skill:\n    tier: specialist\n');
  const output = JSON.parse(run(['status', '--json'], cwd));
  assert.equal(output.status.verdict, 'attention required');
  assert.equal(output.status.policy.unmatchedEntries.length, 1);
  assert.match(output.summary, /Current inventory includes test fixture roots/);
  assert.match(output.summary, /No curation receipt found/);
});

test('apply-policy warns by default and strict blocks mismatched fixture state', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  writeFileSync(path.join(cwd, '.skillmap/policy.yml'), 'version: 1\nskills:\n  frontend-design:\n    tier: active-default\n  missing-skill:\n    tier: specialist\n');
  const output = JSON.parse(run(['apply-policy', '--dry-run', '--json'], cwd));
  assert.equal(output.warnings.length, 3);
  assert.throws(() => run(['apply-policy', '--dry-run', '--strict'], cwd), /Strict policy validation failed/);
});

test('curate prepare and ingest record user-reported Codex provenance', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['doctor'], cwd);
  run(['doctor-pack', '--summary'], cwd);
  const prepared = JSON.parse(run(['curate', 'codex', '--prepare', '--json'], cwd));
  assert.ok(existsSync(prepared.promptFile));
  const proposals = path.join(cwd, '.skillmap/proposals');
  mkdirSync(proposals, { recursive: true });
  const policy = path.join(proposals, 'policy.yml');
  const rationale = path.join(proposals, 'policy-rationale.md');
  cpSync(path.join(cwd, 'test/fixtures/policy.yml'), policy);
  writeFileSync(rationale, '# Rationale\n\nFixture policy for curation receipt test.\n');
  const ingested = JSON.parse(run(['curate', 'codex', '--ingest', policy, '--rationale', rationale, '--model', 'codex-gpt-5', '--confirm', '--json'], cwd));
  assert.equal(ingested.receipt.model, 'codex-gpt-5');
  assert.equal(ingested.receipt.modelVerification, 'user-reported');
  assert.ok(existsSync(path.join(cwd, '.skillmap/curation/receipt.json')));
});

test('policy changes effective routing and excludes archived skills', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const output = JSON.parse(run(['route', 'make this dashboard less generic and verify mobile', '--json'], cwd));
  assert.equal(output.recommendations[0].name, 'frontend-design');
  assert.equal(output.recommendations.some((rec) => rec.name === 'broad-helper'), false);
});

test('graph build query and explain expose skill relationships', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const built = JSON.parse(run(['graph', 'build', '--json'], cwd));
  assert.ok(built.graph.nodes.length > 0);
  const query = JSON.parse(run(['graph', 'query', 'frontend', '--json'], cwd));
  assert.ok(query.nodes.length > 0);
  const explain = run(['graph', 'explain', 'frontend'], cwd);
  assert.match(explain, /SkillMap graph explanation/);
});

test('sources adopt records provenance without applying updates', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  const adopted = JSON.parse(run(['sources', 'adopt', 'frontend-design', '--repo', 'mattpocock/skills', '--path', 'skills/frontend-design', '--json'], cwd));
  assert.equal(adopted.record.skill, 'frontend-design');
  const listed = JSON.parse(run(['sources', 'list', '--json'], cwd));
  assert.equal(listed.records.length, 1);
});

test('sources review records state-specific review decisions', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  const adopted = JSON.parse(run(['sources', 'adopt', 'frontend-design', '--repo', 'mattpocock/skills', '--path', 'skills/frontend-design', '--json'], cwd));
  writeFileSync(path.join(cwd, '.skillmap/source-status.json'), JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), records: [{ ...adopted.record, state: 'external-stale' }] }, null, 2));
  const reviewed = JSON.parse(run(['sources', 'review', 'frontend-design', '--decision', 'hold', '--reason', 'Fixture stale state reviewed.', '--json'], cwd));
  assert.equal(reviewed.record.skill, 'frontend-design');
  assert.equal(reviewed.record.appliesToState, 'external-stale');
  const decisions = JSON.parse(readFileSync(path.join(cwd, '.skillmap/source-decisions.json'), 'utf8'));
  assert.equal(decisions.records.length, 1);
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

test('eval reports expected hits and confidence metrics', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const output = JSON.parse(run(['eval', '--file', 'test/fixtures/evals.json', '--save-report', '--json'], cwd));
  assert.equal(output.count, 10);
  assert.ok(output.top3 >= 8);
  assert.equal(output.avoidHits, 0);
  assert.equal(typeof output.pass, 'boolean');
  assert.equal(output.confidence.level, 'weak');
  assert.ok(existsSync(path.join(cwd, '.skillmap/eval-report.json')));
  assert.match(output.summary, /SkillMap eval:/);
});

test('doctor fix-plan writes a review-only repair plan', () => {
  const cwd = tempProject();
  const output = JSON.parse(run(['doctor', '--fixtures', 'test/fixtures/basic', '--fix-plan', '--json'], cwd));
  assert.match(output.summary, /fix-plan/);
  assert.ok(existsSync(output.fixPlanPath));
  const text = readFileSync(output.fixPlanPath, 'utf8');
  assert.match(text, /SkillMap Doctor Fix Plan/);
  assert.match(text, /Review this fix plan/);
});

test('export and import dry-run produce shareable registry artifacts without overwriting active state', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  run(['graph', 'build'], cwd);
  run(['eval', '--file', 'test/fixtures/evals.json', '--save-report'], cwd);
  const exportFile = path.join(cwd, 'skillmap-export.json');
  const exported = JSON.parse(run(['export', '--output', exportFile, '--redact-paths', '--json'], cwd));
  assert.equal(exported.file, exportFile);
  assert.ok(existsSync(exportFile));
  const snapshot = JSON.parse(readFileSync(exportFile, 'utf8'));
  assert.equal(snapshot.redacted, true);
  assert.equal(snapshot.cwd, '$PROJECT');
  const imported = JSON.parse(run(['import', exportFile, '--dry-run', '--json'], cwd));
  assert.equal(imported.dryRun, true);
  assert.ok(Array.isArray(imported.report.conflicts));
});

test('mcp manifest and read-only route tool expose existing registry state', () => {
  const cwd = tempProject();
  run(['scan', '--fixtures', 'test/fixtures/basic'], cwd);
  run(['apply-policy', '--policy', 'test/fixtures/policy.yml'], cwd);
  const manifest = JSON.parse(run(['mcp', 'manifest', '--json'], cwd));
  assert.equal(manifest.readOnly, true);
  assert.ok(manifest.tools.some((tool) => tool.name === 'route_prompt'));
  const routed = JSON.parse(run(['mcp', 'call', 'route_prompt', '--prompt', 'make this dashboard less generic and verify mobile', '--json'], cwd));
  assert.equal(routed.recommendations[0].name, 'frontend-design');
});
