import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(import.meta.dirname, '..');

function workflow(relativePath) {
  return YAML.parse(readFileSync(path.join(repo, relativePath), 'utf8'));
}

test('both CI authorities run the clean exact-candidate secret preflight', () => {
  for (const relativePath of ['.gitea/workflows/ci.yml', '.github/workflows/ci.yml']) {
    const jobs = workflow(relativePath).jobs;
    const commands = Object.values(jobs).flatMap(job => (job.steps ?? []).map(step => step.run).filter(run => typeof run === 'string'));
    const preflight = commands.find(command => command.includes('preflight:public-alpha:static'));
    assert.ok(preflight, `${relativePath} does not run the public-alpha static preflight`);
    assert.match(preflight, /--require-clean/, `${relativePath} can issue exact-candidate evidence from a dirty worktree`);
    assert.match(preflight, /--output/, `${relativePath} does not retain a preflight receipt`);
  }
});

test('Gitea database authority runs pgTAP and type parity against the restored candidate', () => {
  const job = workflow('.gitea/workflows/ci.yml').jobs['hosted-database'];
  const steps = job.steps ?? [];
  const recovery = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('preflight:public-alpha:recovery'));
  const pgTap = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('pg_prove'));
  const types = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('supabase gen types'));
  assert.ok(recovery >= 0 && pgTap === recovery && types > pgTap, 'pgTAP and generated-type parity must validate the restored candidate');
  assert.ok(steps[recovery].run.indexOf('preflight:public-alpha:recovery') < steps[recovery].run.indexOf('pg_prove'), 'recovery replay must finish before pgTAP starts');
  assert.match(steps[recovery].run, /--execute/);
  assert.match(steps[recovery].run, /--output/);
});

test('GitHub retained package candidate carries the exact-commit preflight receipt', () => {
  const job = workflow('.github/workflows/ci.yml').jobs['package-candidate'];
  const steps = job.steps ?? [];
  const preflight = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('free-public-alpha-preflight.json'));
  const pack = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('npm pack --json'));
  const upload = steps.findIndex(step => step.uses === 'actions/upload-artifact@v4' && step.with?.name === 'skillmap-package-candidate');
  assert.ok(preflight >= 0 && pack > preflight && upload > pack, 'preflight receipt must be created before and retained with the exact package candidate');
  assert.equal(steps[upload].with.path, 'artifacts/package');
});
