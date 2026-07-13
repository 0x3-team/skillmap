import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const repo = path.resolve(import.meta.dirname, '..');
const workflowFile = path.join(repo, '.github', 'workflows', 'ci.yml');
const source = readFileSync(workflowFile, 'utf8');
const workflow = YAML.parse(source);
const jobs = workflow.jobs;
const verifierId = 'verify_candidate';
const tarballBinding = `\${{ steps.${verifierId}.outputs.tarball }}`;
const candidateCommands = [
  'npm run test:consumer-install',
  'npm run test:browser:candidate:chromium',
  'npm run test:upgrade-rollback'
];

test('every release-CI candidate consumer is explicitly bound to its verified retained tarball', () => {
  assert.ok(jobs && typeof jobs === 'object', 'CI workflow has no jobs');
  const observedConsumers = [];
  const downloadedCandidateJobs = [];

  for (const [jobName, job] of Object.entries(jobs)) {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const downloadIndex = steps.findIndex(step => step.uses === 'actions/download-artifact@v4'
      && step.with?.name === 'skillmap-package-candidate');
    if (downloadIndex >= 0) downloadedCandidateJobs.push(jobName);

    const consumers = steps.flatMap((step, index) => {
      if (typeof step.run !== 'string') return [];
      return candidateCommands
        .filter(command => step.run.includes(command))
        .map(command => ({ command, index, step }));
    });
    if (!consumers.length) continue;

    const verifierIndex = steps.findIndex(step => step.id === verifierId);
    assert.notEqual(verifierIndex, -1, `${jobName} consumes a candidate without an id=${verifierId} verifier step`);
    const verifier = steps[verifierIndex];
    assert.match(verifier.run ?? '', /node scripts\/verify-package-candidate\.mjs artifacts\/package(?:\s|$)/,
      `${jobName} verifier does not select the downloaded candidate directory`);

    if (downloadIndex >= 0) {
      assert.ok(verifierIndex > downloadIndex, `${jobName} verifies the candidate before downloading it`);
      assert.doesNotMatch(verifier.run, /(?:^|\s)--write(?:\s|$)/,
        `${jobName} must verify retained SHA evidence without rewriting it`);
    }

    for (const consumer of consumers) {
      assert.ok(consumer.index > verifierIndex, `${jobName} consumes the candidate before verification`);
      assert.equal(consumer.step.env?.SKILLMAP_TEST_TARBALL, tarballBinding,
        `${jobName} ${consumer.command} can fall back to repacking source instead of consuming the verified tarball output`);
      observedConsumers.push(`${jobName}:${consumer.command}`);
    }
  }

  assert.deepEqual(observedConsumers.sort(), [
    'cli-supported-platforms:npm run test:consumer-install',
    'local-app-critical-candidate:npm run test:browser:candidate:chromium',
    'package-candidate:npm run test:consumer-install',
    'package-candidate:npm run test:upgrade-rollback'
  ]);
  assert.deepEqual(downloadedCandidateJobs.sort(), ['cli-supported-platforms', 'local-app-critical-candidate']);
  assert.equal((source.match(/(?:^|\s)--write(?:\s|$)/g) ?? []).length, 1,
    'only the producer may create SHA256SUMS; candidate consumers must not rewrite retained evidence');
});

test('hosted browser CI runs the composed API, auth, submission, report, and evidence gate', () => {
  const job = jobs['hosted-web-browser'];
  assert.ok(job, 'CI workflow has no hosted-web-browser job');
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const source = steps.map(step => step.run ?? '').join('\n');
  assert.match(source, /supabase start(?:\s|$)/, 'hosted browser CI does not start the complete disposable stack');
  assert.match(source, /supabase db reset --local/, 'hosted browser CI does not rebuild from migrations and seed');
  assert.match(source, /supabase test db --local/, 'hosted browser CI omits database authority tests');
  assert.match(source, /npm --prefix apps\/web run build/, 'hosted browser CI does not build the exact web source');
  assert.match(source, /npm run test:hosted-gates/, 'hosted browser CI does not execute the composed hosted gate');
  assert.ok(steps.some(step => step.if === 'always()' && /supabase stop --no-backup/.test(step.run ?? '')),
    'hosted browser CI does not guarantee disposable-stack cleanup');

  const orchestrator = readFileSync(path.join(repo, 'apps', 'web', 'scripts', 'run-hosted-gates.mjs'), 'utf8');
  for (const script of ['hosted-api-smoke.mjs', 'hosted-auth-browser-smoke.mjs', 'launch-report-evidence-smoke.mjs']) {
    assert.match(orchestrator, new RegExp(script.replaceAll('.', '[.]')), `composed hosted gate omits ${script}`);
  }
  assert.match(orchestrator, /startWebServer\("public-alpha", "public"\)/,
    'composed hosted gate does not exercise the exact public release-stage pair');
  assert.match(orchestrator, /robots[.]txt/,
    'composed hosted gate does not verify request-time public robots output');
});
