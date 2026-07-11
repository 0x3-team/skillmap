import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'dist', 'cli.js');

test('v2 eval evidence stays candidate-only while exact routing approval remains an independent hook boundary', { timeout: 60_000 }, async (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-routing-readiness-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, 'roots', 'skills');
  cpSync(path.join(repo, 'test', 'fixtures', 'basic'), root, { recursive: true });
  run(['init', '--root', root], cwd);
  cpSync(path.join(repo, 'test', 'fixtures', 'policy.yml'), path.join(cwd, '.skillmap', 'policy.yml'));
  run(['state', 'import-legacy', '--confirm'], cwd);
  run(['scan'], cwd);
  run(['doctor'], cwd);
  run(['doctor-pack', '--summary'], cwd);

  const proposals = path.join(cwd, '.skillmap', 'proposals');
  mkdirSync(proposals, { recursive: true });
  const proposal = path.join(proposals, 'policy.yml');
  const rationale = path.join(proposals, 'policy-rationale.md');
  cpSync(path.join(repo, 'test', 'fixtures', 'policy.yml'), proposal);
  writeFileSync(rationale, '# Rationale\n\nReviewed every current non-fixture skill variant.\n');
  run(['curate', 'codex', '--prepare'], cwd);
  run(['curate', 'codex', '--ingest', proposal, '--rationale', rationale, '--model', 'reviewed-test-model', '--confirm'], cwd);
  run(['policy', 'migrate', '--confirm'], cwd);
  const inventory = JSON.parse(readFileSync(path.join(cwd, '.skillmap', 'inventory.json'), 'utf8'));
  const canonical = inventory.skills.find((skill) => skill.name === 'frontend-design' && skill.relativePath === 'frontend-design');
  run(['policy', 'select-canonical', 'frontend-design', '--skill-id', canonical.skillId, '--actor', 'fixture-reviewer', '--reason', 'Compared both full current variants and selected the maintained implementation.', '--confirm'], cwd);
  run(['apply-policy'], cwd);
  run(['graph', 'build'], cwd);
  for (const skill of inventory.skills) run(['sources', 'adopt', '--skill-id', skill.skillId, '--local', '--reason', 'Reviewed as locally authored and maintained in this workspace.'], cwd);
  run(['sources', 'check'], cwd);

  const suite = credibleSuite();
  writeFileSync(path.join(cwd, '.skillmap', 'real-evals.json'), `${JSON.stringify(suite, null, 2)}\n`);
  run(['state', 'import-legacy', '--confirm'], cwd);
  run(['apply-policy'], cwd);
  run(['eval', '--save-report'], cwd);

  const unapproved = JSON.parse(run(['status', '--json'], cwd)).status;
  // The stronger product-evidence blocker owns the phase. The separately
  // unapproved current revision is still exposed through routingReady below.
  assert.equal(unapproved.readinessPhase, 'eval-failing');
  assert.equal(unapproved.eval.evidenceLevel, 'candidate');
  assert.equal(unapproved.eval.releaseEvidenceEligible, false);
  assert.equal(unapproved.eval.pass, false);
  assert.match(unapproved.eval.evidenceIssues.join('\n'), /legacy eval v2 is candidate-only/i);
  assert.notEqual(unapproved.verdict, 'ok');
  const bootstrap = await new SkillMapLocalBackend(cwd).bootstrap();
  assert.equal(bootstrap.routingReady, false);
  assert.equal(bootstrap.productReady, false);
  assert.equal(bootstrap.readiness.phase, 'eval-failing');
  assert.equal(bootstrap.nextAction, 'continue-onboarding');
  const hook = JSON.parse(run(['hook', 'install', 'codex', '--passive', '--dry-run', '--force', '--config', path.join(cwd, 'hooks.json'), '--json'], cwd));
  assert.equal(hook.readiness.phase, 'eval-failing');
  assert.equal(hook.readiness.routingReady, false);
  assert.equal(hook.wouldInstall, false);
  assert.equal(hook.blocked, true);

  run(['apply-policy'], cwd);
  const approved = JSON.parse(run(['status', '--json'], cwd)).status;
  // Applying the reviewed policy makes the exact current revision safe for
  // routing, but it must not upgrade legacy v2 evidence into v3 authority.
  assert.equal(approved.readinessPhase, 'eval-failing');
  assert.equal(approved.eval.evidenceLevel, 'candidate');
  assert.equal(approved.eval.releaseEvidenceEligible, false);
  assert.equal(approved.eval.pass, false);
  assert.notEqual(approved.verdict, 'ok');
  const approvedBootstrap = await new SkillMapLocalBackend(cwd).bootstrap();
  assert.equal(approvedBootstrap.routingReady, true);
  assert.equal(approvedBootstrap.productReady, false);
  assert.equal(approvedBootstrap.readiness.phase, 'eval-failing');
  assert.equal(approvedBootstrap.nextAction, 'route');
});

function credibleSuite() {
  return {
    version: 2,
    provenance: {
      labelAuthor: 'fixture-author', sourceClass: 'hand-authored-natural',
      createdAt: '2026-07-01T00:00:00.000Z', reviewedAt: '2026-07-02T00:00:00.000Z',
      deduplicationResult: 'passed', holdoutFrozen: true
    },
    baseline: { top1Rate: 0.5, top3Rate: 0.5, avoidHits: 0, abstentionRate: 0, meanAdvisoryBytes: 10000 },
    evals: [
      ...Array.from({ length: 100 }, (_, index) => ({ id: `implicit-${index}`, prompt: `Perform data quality analysis and prepare chart reports for executives in scenario ${index}`, expected: ['data-analytics'], avoid: [], primaryCaseType: 'implicit-natural', membership: index < 30 ? 'holdout' : 'train' })),
      ...Array.from({ length: 25 }, (_, index) => ({ id: `multi-${index}`, prompt: `Perform data quality analysis with chart reports while adding an implementation with unit tests after failing bug reproduction in scenario ${index}`, expected: ['data-analytics', 'tdd'], avoid: [], primaryCaseType: 'multi-skill', membership: 'train' })),
      ...Array.from({ length: 25 }, (_, index) => ({ id: `negative-${index}`, prompt: `Schedule a friendly meeting and summarize the agenda in scenario ${index}`, expected: [], avoid: ['reverse-engineering'], primaryCaseType: 'negative-near-miss', membership: 'train' })),
      ...Array.from({ length: 5 }, (_, index) => ({ id: `explicit-${index}`, prompt: `Use tdd for explicit regression case ${index}`, expected: ['tdd'], avoid: [], primaryCaseType: 'explicit', membership: 'train' }))
    ]
  };
}

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
