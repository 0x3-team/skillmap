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
const pinnedDownloadArtifact = 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093';
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
    const downloadIndex = steps.findIndex(step => step.uses === pinnedDownloadArtifact
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
  assert.match(source, /node scripts\/test-hosted-database[.]mjs/, 'hosted browser CI does not invoke the database authority harness');
  const databaseHarness = readFileSync(path.join(repo, 'scripts', 'test-hosted-database.mjs'), 'utf8');
  assert.match(databaseHarness, /run\('supabase', \['db', 'reset', '--local'/, 'hosted database harness does not rebuild from migrations and seed');
  assert.match(databaseHarness, /run\('supabase', \['test', 'db', '--local'/, 'hosted database harness omits database authority tests');
  for (const floor of ['20260727061300', '20260810070000', '20260812115813']) {
    assert.match(databaseHarness, new RegExp(floor), `hosted database harness omits required migration floor ${floor}`);
  }
  assert.match(source, /command -v psql/, 'hosted browser CI does not install its PostgreSQL client dependency when absent');
  assert.match(source, /psql --version/, 'hosted browser CI does not verify the PostgreSQL client before running fixtures');
  assert.match(source, /npm --prefix apps\/web run build/, 'hosted browser CI does not build the exact web source');
  assert.match(source, /npm run test:hosted-gates/, 'hosted browser CI does not execute the composed hosted gate');
  const browserInstall = steps.find(step => /playwright install/.test(step.run ?? ''))?.run ?? '';
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    assert.match(browserInstall, new RegExp(`\\b${browser}\\b`), `hosted browser CI does not install ${browser}`);
  }
  assert.ok(steps.some(step => step.if === 'always()' && /supabase stop --no-backup/.test(step.run ?? '')),
    'hosted browser CI does not guarantee disposable-stack cleanup');

  const orchestrator = readFileSync(path.join(repo, 'apps', 'web', 'scripts', 'run-hosted-gates.mjs'), 'utf8');
  for (const script of ['hosted-api-smoke.mjs', 'hosted-auth-browser-smoke.mjs', 'launch-report-evidence-smoke.mjs', 'hosted-frontend-qa.mjs']) {
    assert.match(orchestrator, new RegExp(script.replaceAll('.', '[.]')), `composed hosted gate omits ${script}`);
  }
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    assert.match(orchestrator, new RegExp(`"${browser}"`), `composed hosted gate omits ${browser}`);
  }
  const authSmoke = readFileSync(path.join(repo, 'apps', 'web', 'scripts', 'hosted-auth-browser-smoke.mjs'), 'utf8');
  const hydrationStage = authSmoke.indexOf('smokeStage = "logout-landing-hydration"');
  const signedOutStage = authSmoke.indexOf('smokeStage = "signed-out-account"', hydrationStage);
  assert.ok(hydrationStage >= 0 && signedOutStage > hydrationStage,
    'authenticated smoke does not settle the post-logout client route before its signed-out redirect probe');
  const postLogoutHydration = authSmoke.slice(hydrationStage, signedOutStage);
  assert.match(postLogoutHydration, /openLandingCommandPalette\(page\)/,
    'post-logout barrier does not prove the landing client bundle is interactive');
  assert.match(authSmoke, /getByRole\("button", \{ name: "Open command palette" \}\)/,
    'landing hydration probe does not exercise a client-only control');
  assert.match(authSmoke, /getByRole\("dialog", \{ name: "Command palette" \}\)/,
    'post-logout barrier does not observe the client-only interaction result');
  assert.match(authSmoke, /for \(let attempt = 0; attempt < 5; attempt \+= 1\)/,
    'landing hydration probe does not retry a pre-hydration click within a fixed bound');
  assert.match(postLogoutHydration, /waitFor\(\{ state: "hidden" \}\)/,
    'post-logout barrier leaves its client interaction unsettled before the next navigation');
  assert.doesNotMatch(orchestrator, /env:\s*\{\s*\.\.\.process\.env/s,
    'hosted web server inherits the operator/test process environment instead of an explicit public allowlist');
  assert.match(orchestrator, /startWebServer\("public-alpha", "public"\)/,
    'composed hosted gate does not exercise the exact public release-stage pair');
  assert.match(orchestrator, /robots[.]txt/,
    'composed hosted gate does not verify request-time public robots output');
});
