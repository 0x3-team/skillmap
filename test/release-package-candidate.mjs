import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import {
  expectedPublishApproval,
  parseReleaseArguments,
  runReleaseCandidate,
  validateDistTag,
  writeEvidenceReceipt
} from '../scripts/release-package-candidate.mjs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const SOURCE_COMMIT = 'a'.repeat(40);
const CI_RUN_ID = 'github:123456789:1';
const CANONICAL_REGISTRY = 'https://registry.npmjs.org/';

test('release wrapper requires provenance identity, defaults to validation, and exposes one guarded package path', () => {
  const options = parseReleaseArguments([
    '--candidate', '/tmp/skillmap-0.2.0.tgz',
    '--prior', '/tmp/skillmap-0.1.0.tgz',
    '--dist-tag', 'alpha',
    '--source-commit', SOURCE_COMMIT,
    '--ci-run-id', CI_RUN_ID,
    '--dry-run'
  ]);
  assert.equal(options.publish, false);
  assert.equal(options.dryRun, true);
  assert.equal(options.sourceCommit, SOURCE_COMMIT);
  assert.equal(options.ciRunId, CI_RUN_ID);
  assert.equal(packageJson.scripts['release:candidate'], 'node scripts/release-package-candidate.mjs');
  assert.match(packageJson.scripts.prepublishOnly, /Direct npm publish is disabled/);
  assert.throws(() => parseReleaseArguments([
    '--candidate', '/tmp/skillmap-0.2.0.tgz',
    '--prior', '/tmp/skillmap-0.1.0.tgz',
    '--dist-tag', 'alpha',
    '--source-commit', SOURCE_COMMIT,
    '--ci-run-id', CI_RUN_ID,
    '--publish', '--dry-run'
  ]), /mutually exclusive/);
  assert.throws(() => parseReleaseArguments([
    '--candidate', '/tmp/skillmap-0.2.0.tgz',
    '--prior', '/tmp/skillmap-0.1.0.tgz',
    '--dist-tag', 'alpha',
    '--source-commit', SOURCE_COMMIT,
    '--ci-run-id', CI_RUN_ID,
    '--publish'
  ]), /requires --evidence-dir/);
  assert.throws(() => runReleaseCandidate({ publish: true, dryRun: true, approval: null }), /mutually exclusive/);
  assert.throws(() => validateDistTag('latest'), /non-latest/);
  assert.throws(() => validateDistTag('alpha; touch PWNED'), /lowercase npm tag/);
});

test('validation verifies one private immutable stage and binds rollback, receipt, commit, and CI identity to it', { skip: process.platform === 'win32' }, t => {
  const fixture = releaseFixture(t, 'release candidate; shell text is data');
  const calls = [];
  const evidenceDir = path.join(fixture.scratch, 'evidence');
  const verifierEnvTarget = path.join(fixture.scratch, 'github-env');
  const verifierOutputTarget = path.join(fixture.scratch, 'github-output');
  const receipt = runReleaseCandidate(releaseOptions(fixture, { evidenceDir }), dependencies(fixture, calls, {
    requirePrivateModes: true,
    env: { npm_execpath: process.execPath, GITHUB_ENV: verifierEnvTarget, GITHUB_OUTPUT: verifierOutputTarget }
  }));

  assert.equal(receipt.status, 'validated');
  assert.equal(receipt.publishInvoked, false);
  assert.equal(receipt.npmDryRunInvoked, false);
  assert.equal(calls.length, 2, 'validation must run only verifier and rollback gate');
  const stagedCandidate = calls[1].options.env.SKILLMAP_TEST_TARBALL;
  const stagedPrior = calls[1].options.env.SKILLMAP_PRIOR_TARBALL;
  assert.notEqual(stagedCandidate, fixture.candidate);
  assert.notEqual(stagedPrior, fixture.prior);
  assert.equal(calls[0].args[1], path.dirname(stagedCandidate));
  assert.equal(Object.hasOwn(calls[0].options.env, 'GITHUB_ENV'), false, 'nested verifier leaked its private stage through GITHUB_ENV');
  assert.equal(Object.hasOwn(calls[0].options.env, 'GITHUB_OUTPUT'), false, 'nested verifier leaked its private stage through GITHUB_OUTPUT');
  assert.equal(existsSync(verifierEnvTarget), false);
  assert.equal(existsSync(verifierOutputTarget), false);
  assert.equal(receipt.candidateTarball.sha256, fixture.candidateDigest);
  assert.equal(receipt.candidateTarball.filename, 'skillmap-0.2.0.tgz');
  assert.equal(receipt.priorTarball.filename, 'skillmap-0.1.0.tgz');
  assert.deepEqual(receipt.source, { commit: SOURCE_COMMIT, ciRunId: CI_RUN_ID });
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(fixture.scratch), false, 'portable evidence must not leak source paths');
  assert.equal(serialized.includes('skillmap-release-stage-'), false, 'portable evidence must not leak private stage paths');
  assert.deepEqual(readEvidenceRecords(evidenceDir).at(-1), receipt);
});

test('explicit dry-run overrides inherited npm config and uses the same staged path for verifier, rollback, and npm', t => {
  const fixture = releaseFixture(t);
  const calls = [];
  const env = {
    npm_execpath: process.execPath,
    npm_config_dry_run: 'false',
    NPM_CONFIG_REGISTRY: 'https://attacker.invalid/',
    npm_config_tag: 'latest'
  };
  const receipt = runReleaseCandidate(releaseOptions(fixture, { dryRun: true }), dependencies(fixture, calls, { env }));

  assert.equal(receipt.status, 'npm-dry-run-passed');
  assert.equal(receipt.publishInvoked, false);
  assert.equal(receipt.npmDryRunInvoked, true);
  assert.equal(calls.length, 3);
  const candidate = calls[1].options.env.SKILLMAP_TEST_TARBALL;
  assert.equal(calls[2].args[2], candidate);
  assert.deepEqual(calls[2].args.slice(1), [
    'publish', candidate,
    '--registry', CANONICAL_REGISTRY,
    '--tag', 'alpha',
    '--access', 'public',
    '--provenance',
    '--ignore-scripts',
    '--dry-run=true'
  ]);
  assert.equal(calls[2].options.shell, false);
  assert.equal(calls[2].options.env.SKILLMAP_TEST_TARBALL, candidate);
  assert.equal(calls[2].options.env.npm_config_registry, CANONICAL_REGISTRY);
  assert.equal(calls[2].options.env.npm_config_dry_run, 'true');
  assert.equal(Object.hasOwn(calls[2].options.env, 'NPM_CONFIG_REGISTRY'), false);
});

test('approved publish reserves outcome-unknown evidence and forces canonical real-publish semantics', t => {
  const fixture = releaseFixture(t);
  const evidenceDir = path.join(fixture.scratch, 'publish-evidence');
  const calls = [];
  const env = githubEnvironment({
    npm_config_dry_run: 'true',
    NPM_CONFIG_REGISTRY: 'https://attacker.invalid/',
    npm_config_registry: 'https://also-attacker.invalid/'
  });
  const approval = expectedPublishApproval('0.2.0', 'beta', fixture.candidateDigest, SOURCE_COMMIT, CI_RUN_ID);
  const receipt = runReleaseCandidate(releaseOptions(fixture, {
    distTag: 'beta', evidenceDir, publish: true, approval
  }), dependencies(fixture, calls, { env, inspectPublishPreflight: evidenceDir }));

  assert.equal(receipt.status, 'published');
  assert.equal(receipt.publishOutcome, 'published');
  assert.equal(calls.length, 3);
  const publish = calls[2];
  const stagedCandidate = calls[1].options.env.SKILLMAP_TEST_TARBALL;
  assert.deepEqual(publish.args.slice(1), [
    'publish', stagedCandidate,
    '--registry', CANONICAL_REGISTRY,
    '--tag', 'beta',
    '--access', 'public',
    '--provenance',
    '--ignore-scripts',
    '--dry-run=false'
  ]);
  assert.equal(publish.options.env.SKILLMAP_TEST_TARBALL, stagedCandidate);
  assert.equal(publish.options.env.npm_config_registry, CANONICAL_REGISTRY);
  assert.equal(publish.options.env.npm_config_dry_run, 'false');
  assert.equal(Object.hasOwn(publish.options.env, 'NPM_CONFIG_REGISTRY'), false);
  const records = readEvidenceRecords(evidenceDir);
  assert.equal(records.length, 2);
  assert.equal(records[0].status, 'publish-outcome-unknown');
  const durable = records.at(-1);
  assert.equal(durable.status, 'published');
  assert.equal(durable.publishOutcome, 'published');
  assert.deepEqual(durable.source, { commit: SOURCE_COMMIT, ciRunId: CI_RUN_ID });
});

test('invalid approval or missing evidence stops before rollback or npm', t => {
  const fixture = releaseFixture(t);
  const noEvidenceCalls = [];
  assert.throws(() => runReleaseCandidate(releaseOptions(fixture, {
    publish: true,
    evidenceDir: null,
    approval: 'invalid'
  }), dependencies(fixture, noEvidenceCalls, { env: githubEnvironment() })), /requires a reserved evidence receipt/);
  assert.equal(noEvidenceCalls.length, 0);

  const invalidCalls = [];
  assert.throws(() => runReleaseCandidate(releaseOptions(fixture, {
    publish: true,
    evidenceDir: path.join(fixture.scratch, 'invalid-approval-evidence'),
    approval: 'not-the-candidate-bound-approval'
  }), dependencies(fixture, invalidCalls, { env: githubEnvironment() })), /requires --approve-publish/);
  assert.equal(invalidCalls.length, 1, 'invalid approval must stop before rollback, evidence reservation, or npm');
});

test('existing regular or symbolic-link evidence receipts are never overwritten', { skip: process.platform === 'win32' }, t => {
  const fixture = releaseFixture(t);
  const approval = expectedPublishApproval('0.2.0', 'alpha', fixture.candidateDigest, SOURCE_COMMIT, CI_RUN_ID);
  for (const kind of ['file', 'symlink']) {
    const evidenceDir = path.join(fixture.scratch, `evidence-${kind}`);
    mkdirSync(evidenceDir);
    const receiptPath = path.join(evidenceDir, 'release-candidate.jsonl');
    if (kind === 'file') writeFileSync(receiptPath, 'existing evidence');
    else {
      const target = path.join(fixture.scratch, 'symlink-target');
      writeFileSync(target, 'do not clobber');
      symlinkSync(target, receiptPath);
    }
    const calls = [];
    assert.throws(() => runReleaseCandidate(releaseOptions(fixture, {
      publish: true, evidenceDir, approval
    }), dependencies(fixture, calls, { env: githubEnvironment() })), /already exists/);
    assert.equal(calls.length, 2, 'receipt reservation must fail before npm');
    assert.equal(readFileSync(receiptPath, 'utf8'), kind === 'file' ? 'existing evidence' : 'do not clobber');
  }
});

test('a reserved evidence-path replacement is detected before npm starts', { skip: process.platform === 'win32' }, t => {
  const fixture = releaseFixture(t);
  const evidenceDir = path.join(fixture.scratch, 'replaced-evidence');
  const target = path.join(fixture.scratch, 'replacement-target');
  writeFileSync(target, 'do not clobber');
  const approval = expectedPublishApproval('0.2.0', 'alpha', fixture.candidateDigest, SOURCE_COMMIT, CI_RUN_ID);
  const calls = [];
  const replacingWriter = (handle, receipt) => {
    writeEvidenceReceipt(handle, receipt);
    if (receipt.status === 'publish-outcome-unknown') {
      rmSync(handle.path);
      symlinkSync(target, handle.path);
    }
  };
  assert.throws(() => runReleaseCandidate(releaseOptions(fixture, {
    publish: true, evidenceDir, approval
  }), {
    ...dependencies(fixture, calls, { env: githubEnvironment() }),
    writeEvidenceReceipt: replacingWriter
  }), /reserved evidence receipt path was removed or replaced/);
  assert.equal(calls.length, 2, 'replaced receipt path must stop before npm');
  assert.equal(readFileSync(target, 'utf8'), 'do not clobber');
});

test('npm failure durably records a path-private failure without claiming non-publication', t => {
  const fixture = releaseFixture(t);
  const evidenceDir = path.join(fixture.scratch, 'failed-publish-evidence');
  const approval = expectedPublishApproval('0.2.0', 'alpha', fixture.candidateDigest, SOURCE_COMMIT, CI_RUN_ID);
  const calls = [];
  assert.throws(() => runReleaseCandidate(releaseOptions(fixture, {
    publish: true, evidenceDir, approval
  }), dependencies(fixture, calls, { env: githubEnvironment(), publishError: Object.assign(new Error('private /home/operator path'), { code: 'EFAIL' }) })), /private/);
  const receipt = readEvidenceRecords(evidenceDir).at(-1);
  assert.equal(receipt.status, 'publish-command-failed');
  assert.equal(receipt.publishOutcome, 'unknown');
  assert.deepEqual(receipt.commandFailure, { name: 'Error', code: 'EFAIL' });
  assert.equal(JSON.stringify(receipt).includes('/home/operator'), false);
});

test('successful publication is not converted to command failure by a post-success evidence update error', t => {
  const fixture = releaseFixture(t);
  const evidenceDir = path.join(fixture.scratch, 'evidence-update-failure');
  const approval = expectedPublishApproval('0.2.0', 'alpha', fixture.candidateDigest, SOURCE_COMMIT, CI_RUN_ID);
  const calls = [];
  const writer = (handle, receipt) => {
    if (receipt.status === 'published') throw new Error('simulated post-publish evidence failure');
    writeEvidenceReceipt(handle, receipt);
  };
  const receipt = runReleaseCandidate(releaseOptions(fixture, {
    publish: true, evidenceDir, approval
  }), {
    ...dependencies(fixture, calls, { env: githubEnvironment() }),
    writeEvidenceReceipt: writer
  });
  assert.equal(receipt.status, 'published');
  assert.equal(receipt.evidenceUpdate, 'failed-after-publish');
  const durable = readEvidenceRecords(evidenceDir).at(-1);
  assert.equal(durable.status, 'publish-outcome-unknown');
});

test('source path swaps cannot change the private candidate, while staged-byte drift aborts before npm', t => {
  const sourceFixture = releaseFixture(t, 'source-swap');
  const sourceCalls = [];
  const sourceReceipt = runReleaseCandidate(releaseOptions(sourceFixture, { dryRun: true }), dependencies(sourceFixture, sourceCalls, {
    mutateSourceAfterGate: true
  }));
  assert.equal(sourceReceipt.status, 'npm-dry-run-passed');
  assert.equal(sourceReceipt.candidateTarball.sha256, sourceFixture.candidateDigest);
  assert.notEqual(sourceCalls[2].args[2], sourceFixture.candidate);

  const stagedFixture = releaseFixture(t, 'stage-drift');
  const stagedCalls = [];
  assert.throws(() => runReleaseCandidate(releaseOptions(stagedFixture, { dryRun: true }), dependencies(stagedFixture, stagedCalls, {
    mutateStagedAfterGate: true
  })), /staged candidate bytes changed after the rollback gate/);
  assert.equal(stagedCalls.length, 2, 'staged drift must stop before npm');
});

test('path, command-injection, source-commit, and CI identity mismatches fail closed', { skip: process.platform === 'win32' }, t => {
  const fixture = releaseFixture(t);
  const marker = path.join(fixture.scratch, 'PWNED');
  const calls = [];
  const base = releaseOptions(fixture, { distTag: `alpha;touch${marker}`, dryRun: true });
  assert.throws(() => runReleaseCandidate(base, dependencies(fixture, calls)), /lowercase npm tag/);
  assert.equal(calls.length, 0);
  assert.equal(existsSync(marker), false);

  assert.throws(() => runReleaseCandidate({ ...base, candidate: `${fixture.candidate}\ntouch ${marker}`, distTag: 'alpha' }, dependencies(fixture, calls)), /control characters/);
  assert.equal(calls.length, 0);
  const candidateLink = path.join(fixture.scratch, 'skillmap-0.2.1.tgz');
  symlinkSync(fixture.candidate, candidateLink);
  assert.throws(() => runReleaseCandidate({ ...base, candidate: candidateLink, distTag: 'alpha' }, dependencies(fixture, calls)), /not a symbolic link/);
  assert.equal(calls.length, 0);

  assert.throws(() => runReleaseCandidate({ ...base, distTag: 'alpha', sourceCommit: 'b'.repeat(40) }, dependencies(fixture, calls)), /must equal.*HEAD/);
  assert.equal(calls.length, 0);
  assert.throws(() => runReleaseCandidate(releaseOptions(fixture, {
    publish: true,
    evidenceDir: path.join(fixture.scratch, 'ci-mismatch'),
    approval: 'irrelevant'
  }), dependencies(fixture, calls, { env: githubEnvironment({ GITHUB_RUN_ID: '999' }) })), /CI run identity/);
  assert.equal(calls.length, 0);
});

function releaseOptions(fixture, overrides = {}) {
  return {
    candidate: fixture.candidate,
    prior: fixture.prior,
    distTag: 'alpha',
    evidenceDir: null,
    sourceCommit: SOURCE_COMMIT,
    ciRunId: CI_RUN_ID,
    publish: false,
    dryRun: false,
    approval: null,
    ...overrides
  };
}

function dependencies(fixture, calls, options = {}) {
  return {
    execFileSync: releaseExecutor(fixture, calls, options),
    env: options.env ?? { npm_execpath: process.execPath },
    repositoryCommit: SOURCE_COMMIT
  };
}

function githubEnvironment(overrides = {}) {
  return {
    npm_execpath: process.execPath,
    GITHUB_ACTIONS: 'true',
    GITHUB_SHA: SOURCE_COMMIT,
    GITHUB_RUN_ID: '123456789',
    GITHUB_RUN_ATTEMPT: '1',
    ...overrides
  };
}

function releaseFixture(t, label = 'release-fixture') {
  const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-release-wrapper-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const candidateDirectory = path.join(scratch, label, 'candidate');
  const priorDirectory = path.join(scratch, label, 'prior');
  mkdirSync(candidateDirectory, { recursive: true });
  mkdirSync(priorDirectory, { recursive: true });
  const candidateInput = path.join(candidateDirectory, 'skillmap-0.2.0.tgz');
  const priorInput = path.join(priorDirectory, 'skillmap-0.1.0.tgz');
  writeFileSync(candidateInput, 'reviewed-candidate-package-bytes');
  writeFileSync(priorInput, 'reviewed-prior-package-bytes');
  const candidate = realpathSync(candidateInput);
  const prior = realpathSync(priorInput);
  const candidateDigest = digestFile(candidate);
  writeFileSync(path.join(candidateDirectory, 'pack-manifest.json'), `${JSON.stringify([{
    name: 'skillmap', version: '0.2.0', filename: path.basename(candidate)
  }])}\n`);
  writeFileSync(path.join(candidateDirectory, 'SHA256SUMS'), `${candidateDigest}  ${path.basename(candidate)}\n`);
  return { scratch, candidate, prior, candidateDigest, priorDigest: digestFile(prior) };
}

function releaseExecutor(fixture, calls, options = {}) {
  return (file, args, commandOptions) => {
    calls.push({ file, args: [...args], options: commandOptions });
    if (args[0]?.endsWith('verify-package-candidate.mjs')) {
      const stagedCandidate = path.join(args[1], path.basename(fixture.candidate));
      assert.notEqual(stagedCandidate, fixture.candidate);
      assert.equal(digestFile(stagedCandidate), fixture.candidateDigest);
      if (options.requirePrivateModes) {
        assert.equal(lstatSync(stagedCandidate).mode & 0o777, 0o400);
        assert.equal(lstatSync(path.dirname(stagedCandidate)).mode & 0o777, 0o500);
      }
      return `${JSON.stringify({
        tarball: stagedCandidate,
        filename: path.basename(stagedCandidate),
        sha256: fixture.candidateDigest,
        bytes: readFileSync(stagedCandidate).length
      })}\n`;
    }
    if (args[0]?.endsWith('test-package-upgrade-rollback.mjs')) {
      assert.deepEqual(args.slice(1), ['--required']);
      const candidate = commandOptions.env.SKILLMAP_TEST_TARBALL;
      const prior = commandOptions.env.SKILLMAP_PRIOR_TARBALL;
      assert.notEqual(candidate, fixture.candidate);
      assert.notEqual(prior, fixture.prior);
      mkdirSync(commandOptions.env.SKILLMAP_UPGRADE_ARTIFACTS, { recursive: true });
      writeFileSync(path.join(commandOptions.env.SKILLMAP_UPGRADE_ARTIFACTS, 'upgrade-rollback.json'), `${JSON.stringify({
        schemaVersion: 1,
        kind: 'skillmap.package-upgrade-rollback',
        status: 'passed',
        priorTarball: { version: '0.1.0', sha256: digestFile(prior) },
        candidateTarball: { version: '0.2.0', sha256: digestFile(candidate) },
        workspaceStatePreserved: true,
        approvedRootPreserved: true
      })}\n`);
      if (options.mutateSourceAfterGate) writeFileSync(fixture.candidate, 'swapped-source-candidate-bytes');
      if (options.mutateStagedAfterGate) {
        chmodSync(candidate, 0o600);
        writeFileSync(candidate, 'different-staged-candidate-bytes');
      }
      return '';
    }
    assert.equal(args.includes('publish'), true, 'unexpected subprocess in release wrapper test');
    if (options.inspectPublishPreflight) {
      const preflight = readEvidenceRecords(options.inspectPublishPreflight).at(-1);
      assert.equal(preflight.status, 'publish-outcome-unknown');
      assert.equal(preflight.publishOutcome, 'unknown');
      assert.equal(preflight.publishInvoked, false);
    }
    if (options.publishError) throw options.publishError;
    return '';
  };
}

function digestFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readEvidenceRecords(directory) {
  return readFileSync(path.join(directory, 'release-candidate.jsonl'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}
