import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(repo, 'scripts', 'verify-package-candidate.mjs');
const rollbackGate = path.join(repo, 'scripts', 'test-package-upgrade-rollback.mjs');
const MAX_TARBALL_BYTES = 10 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_DIGEST_BYTES = 1024;
const DIST_TAG = /^[a-z][a-z0-9._-]{0,63}$/;
const VERSIONED_TARBALL = /^skillmap-[0-9A-Za-z.-]+\.tgz$/;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/;
const CI_RUN_ID = /^github:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_NPM_REGISTRY = 'https://registry.npmjs.org/';
const EVIDENCE_FILENAME = 'release-candidate.jsonl';
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const BLOCKED_NPM_CONFIG = new Set([
  'npm_config_access',
  'npm_config_dry_run',
  'npm_config_ignore_scripts',
  'npm_config_provenance',
  'npm_config_provenance_file',
  'npm_config_registry',
  'npm_config_tag'
]);

export function parseReleaseArguments(argv) {
  const options = {
    candidate: null,
    prior: null,
    distTag: null,
    evidenceDir: null,
    sourceCommit: null,
    ciRunId: null,
    publish: false,
    dryRun: false,
    approval: null
  };
  const valueOptions = new Map([
    ['--candidate', 'candidate'],
    ['--prior', 'prior'],
    ['--dist-tag', 'distTag'],
    ['--evidence-dir', 'evidenceDir'],
    ['--source-commit', 'sourceCommit'],
    ['--ci-run-id', 'ciRunId'],
    ['--approve-publish', 'approval']
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueOptions.has(argument)) {
      const key = valueOptions.get(argument);
      assert.equal(options[key], null, `${argument} may be supplied only once`);
      assert.ok(index + 1 < argv.length, `${argument} requires a value`);
      options[key] = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--publish') {
      assert.equal(options.publish, false, '--publish may be supplied only once');
      options.publish = true;
      continue;
    }
    if (argument === '--dry-run') {
      assert.equal(options.dryRun, false, '--dry-run may be supplied only once');
      options.dryRun = true;
      continue;
    }
    throw new Error(`Unknown release argument: ${argument}`);
  }
  for (const [key, flag] of [
    ['candidate', '--candidate'],
    ['prior', '--prior'],
    ['distTag', '--dist-tag'],
    ['sourceCommit', '--source-commit'],
    ['ciRunId', '--ci-run-id']
  ]) assert.ok(options[key], `${flag} is required`);
  assert.equal(options.publish && options.dryRun, false, '--publish and --dry-run are mutually exclusive');
  assert.equal(Boolean(options.approval) && !options.publish, false, '--approve-publish is valid only with --publish');
  assert.equal(options.publish && !options.evidenceDir, false, '--publish requires --evidence-dir so an outcome-unknown receipt is reserved before npm');
  return options;
}

export function validateDistTag(value) {
  assert.equal(typeof value, 'string', '--dist-tag must be a string');
  assert.match(value, DIST_TAG, '--dist-tag must be a lowercase npm tag containing only letters, digits, dot, underscore, or hyphen');
  assert.notEqual(value, 'latest', 'alpha/beta candidates must use an explicit non-latest dist-tag');
  return value;
}

export function expectedPublishApproval(version, distTag, sha256, sourceCommit, ciRunId) {
  return `publish:skillmap@${version}:tag=${distTag}:sha256=${sha256}:commit=${sourceCommit}:ci=${ciRunId}`;
}

export function runReleaseCandidate(options, dependencies = {}) {
  assert.equal(Boolean(options && typeof options === 'object' && !Array.isArray(options)), true, 'release options must be an object');
  assert.equal(typeof options.publish, 'boolean', 'release publish mode must be boolean');
  assert.equal(typeof options.dryRun, 'boolean', 'release dry-run mode must be boolean');
  assert.equal(options.publish && options.dryRun, false, 'publish and dry-run modes are mutually exclusive');
  assert.equal(Boolean(options.approval) && !options.publish, false, 'publish approval is valid only in publish mode');
  assert.equal(options.publish && !options.evidenceDir, false, 'publish mode requires a reserved evidence receipt');
  const execute = dependencies.execFileSync ?? execFileSync;
  const gitExecute = dependencies.gitExecFileSync ?? execFileSync;
  const environment = dependencies.env ?? process.env;
  const writeEvidence = dependencies.writeEvidenceReceipt ?? writeEvidenceReceipt;
  const repositoryRoot = resolveRepositoryRoot(dependencies.repositoryRoot);
  const repositoryCommit = dependencies.repositoryCommit ?? currentRepositoryCommit(repositoryRoot, gitExecute);
  const source = validateSourceIdentity(
    options.sourceCommit,
    options.ciRunId,
    repositoryCommit,
    repositoryRoot,
    gitExecute,
    environment,
    options.publish
  );
  const sourceCandidate = validateTarballPath(options.candidate, 'candidate');
  const sourcePrior = validateTarballPath(options.prior, 'prior');
  assert.notEqual(sourceCandidate, sourcePrior, 'prior and candidate tarball paths must be distinct');
  const distTag = validateDistTag(options.distTag);
  const stage = stageReleaseInputs(sourceCandidate, sourcePrior);
  let evidenceHandle = null;
  let publishSucceeded = false;

  try {
    const candidate = stage.candidate;
    const prior = stage.prior;
    const candidateManifest = readCandidateManifest(candidate);
    const priorDigest = digestFile(prior);
    const verifierEnvironment = Object.fromEntries(Object.entries(environment)
      .filter(([key]) => !['github_env', 'github_output'].includes(key.toLowerCase())));
    const verifierOutput = execute(process.execPath, [verifier, stage.candidateDirectory], {
      cwd: repo,
      env: verifierEnvironment,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: false
    });
    const verified = parseVerifierReceipt(verifierOutput);
    assert.equal(path.resolve(verified.tarball), candidate, 'candidate verifier selected a different staged tarball path');
    assert.equal(verified.filename, path.basename(candidate), 'candidate verifier selected a different tarball filename');
    assert.equal(verified.sha256, stage.candidateDigest, 'candidate verifier selected different staged bytes');
    assertStageUnchanged(stage, 'after candidate verification');

    const approval = expectedPublishApproval(
      candidateManifest.version,
      distTag,
      verified.sha256,
      source.commit,
      source.ciRunId
    );
    if (options.publish) {
      assert.equal(options.approval, approval,
        `--publish requires --approve-publish ${JSON.stringify(approval)} from an explicit release approval`);
    }

    const rollbackArtifacts = mkdtempSync(path.join(tmpdir(), 'skillmap-release-rollback-'));
    try {
      const gateEnvironment = {
        ...environment,
        SKILLMAP_PRIOR_TARBALL: prior,
        SKILLMAP_TEST_TARBALL: candidate,
        SKILLMAP_UPGRADE_ARTIFACTS: rollbackArtifacts
      };
      const gateOutput = execute(process.execPath, [rollbackGate, '--required'], {
        cwd: repo,
        env: gateEnvironment,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        shell: false
      });
      if (typeof gateOutput === 'string' && gateOutput) process.stdout.write(gateOutput);
      const gateReceipt = JSON.parse(readFileSync(path.join(rollbackArtifacts, 'upgrade-rollback.json'), 'utf8'));
      assert.equal(gateReceipt.status, 'passed', 'two-version rollback gate did not pass');
      assert.equal(gateReceipt.candidateTarball?.version, candidateManifest.version, 'rollback gate exercised a different candidate version');
      assert.equal(gateReceipt.candidateTarball?.sha256, verified.sha256, 'rollback gate exercised different candidate bytes');
      assert.equal(gateReceipt.priorTarball?.sha256, priorDigest, 'rollback gate exercised different prior package bytes');
    } finally {
      rmSync(rollbackArtifacts, { recursive: true, force: true });
    }
    assertStageUnchanged(stage, 'after the rollback gate');

    const receipt = {
      schemaVersion: 2,
      kind: 'skillmap.release-candidate',
      status: 'validated',
      publishInvoked: false,
      publishOutcome: 'not-invoked',
      npmDryRunInvoked: false,
      package: { name: 'skillmap', version: candidateManifest.version, distTag },
      candidateTarball: { filename: path.basename(candidate), sha256: verified.sha256, bytes: verified.bytes },
      priorTarball: { filename: path.basename(prior), sha256: priorDigest },
      source: { commit: source.commit, ciRunId: source.ciRunId },
      registry: CANONICAL_NPM_REGISTRY,
      rollbackGate: {
        status: 'passed',
        candidateBound: true
      },
      expectedPublishApproval: approval,
      validatedAt: new Date().toISOString()
    };

    if (options.evidenceDir) {
      const initialReceipt = options.publish ? {
        ...receipt,
        status: 'publish-outcome-unknown',
        publishOutcome: 'unknown',
        publishAuthorizationRecorded: true,
        publishPreflightAt: new Date().toISOString()
      } : receipt;
      evidenceHandle = reserveEvidenceReceipt(options.evidenceDir, initialReceipt, writeEvidence);
    }

    if (options.publish || options.dryRun) {
      assertStageUnchanged(stage, 'immediately before npm publish');
      if (options.publish) assertEvidenceIdentity(evidenceHandle);
      const npmDryRun = options.dryRun;
      const publishArguments = [
        'publish', candidate,
        '--registry', CANONICAL_NPM_REGISTRY,
        '--tag', distTag,
        '--access', 'public',
        '--provenance',
        '--ignore-scripts',
        `--dry-run=${npmDryRun ? 'true' : 'false'}`
      ];
      const invocation = npmInvocation(publishArguments, environment);
      const npmEnvironment = sanitizedNpmEnvironment(environment, npmDryRun);
      npmEnvironment.SKILLMAP_PRIOR_TARBALL = prior;
      npmEnvironment.SKILLMAP_TEST_TARBALL = candidate;
      npmEnvironment.SKILLMAP_RELEASE_CANDIDATE_SHA256 = verified.sha256;
      try {
        execute(invocation.file, invocation.args, {
          cwd: repo,
          env: npmEnvironment,
          stdio: 'inherit',
          shell: false
        });
      } catch (error) {
        receipt.status = options.publish ? 'publish-command-failed' : 'npm-dry-run-failed';
        receipt.publishInvoked = options.publish;
        receipt.publishOutcome = options.publish ? 'unknown' : 'not-published';
        receipt.npmDryRunInvoked = options.dryRun;
        receipt.commandFailure = safeCommandFailure(error);
        receipt.failedAt = new Date().toISOString();
        if (evidenceHandle) {
          try {
            writeEvidence(evidenceHandle, receipt);
          } catch (evidenceError) {
            warnEvidenceUpdate(evidenceError, 'after npm command failure');
          }
        }
        throw error;
      }

      if (options.publish) {
        publishSucceeded = true;
        receipt.status = 'published';
        receipt.publishInvoked = true;
        receipt.publishOutcome = 'published';
        receipt.publishedAt = new Date().toISOString();
        try {
          writeEvidence(evidenceHandle, receipt);
        } catch (error) {
          receipt.evidenceUpdate = 'failed-after-publish';
          warnEvidenceUpdate(error, 'after npm reported publication success');
        }
      } else {
        receipt.status = 'npm-dry-run-passed';
        receipt.npmDryRunInvoked = true;
        receipt.publishOutcome = 'not-published';
        receipt.dryRunAt = new Date().toISOString();
        if (evidenceHandle) writeEvidence(evidenceHandle, receipt);
      }
    }

    return receipt;
  } finally {
    if (evidenceHandle) {
      try {
        closeSync(evidenceHandle.fd);
      } catch (error) {
        if (publishSucceeded) warnEvidenceUpdate(error, 'while closing the post-publish receipt');
        else throw error;
      }
    }
    cleanupStage(stage);
  }
}

function validateSourceIdentity(sourceCommit, ciRunId, repositoryCommit, repositoryRoot, gitExecute, environment, requireGithub) {
  assert.equal(typeof sourceCommit, 'string', '--source-commit must be a string');
  assert.match(sourceCommit, SOURCE_COMMIT, '--source-commit must be the full lowercase 40-character Git commit');
  assert.equal(typeof repositoryCommit, 'string', 'repository commit resolver returned no commit');
  const checkedOutCommit = repositoryCommit.trim().toLowerCase();
  assert.match(checkedOutCommit, SOURCE_COMMIT, 'repository commit resolver returned an invalid Git commit');
  if (!gitCommitExists(sourceCommit, repositoryRoot, gitExecute)) {
    throwMissingSourceCommit(sourceCommit, repositoryRoot, gitExecute);
  }
  assert.equal(gitCommitExists(checkedOutCommit, repositoryRoot, gitExecute), true,
    'checked-out repository commit must resolve to a commit object');
  const ancestryStatus = gitCommandStatus(
    gitExecute,
    ['merge-base', '--is-ancestor', sourceCommit, checkedOutCommit],
    repositoryRoot
  );
  if (ancestryStatus !== 0) {
    if (isShallowRepository(repositoryRoot, gitExecute)) {
      throw new Error('cannot verify source commit ancestry because required history is unavailable in a shallow repository');
    }
    if (ancestryStatus === 1) throw new Error('source commit is not an ancestor of the checked-out repository commit');
    throw new Error('source commit ancestry verification failed');
  }
  assert.equal(typeof ciRunId, 'string', '--ci-run-id must be a string');
  assert.match(ciRunId, CI_RUN_ID, '--ci-run-id must use github:<run-id>:<attempt>');
  if (requireGithub) assert.equal(environment.GITHUB_ACTIONS, 'true', 'publish mode must run in the approved GitHub Actions environment');
  if (environment.GITHUB_ACTIONS === 'true') {
    assert.equal(String(environment.GITHUB_SHA ?? '').toLowerCase(), sourceCommit, 'GITHUB_SHA does not match the approved source commit');
    const expectedRun = `github:${environment.GITHUB_RUN_ID ?? ''}:${environment.GITHUB_RUN_ATTEMPT ?? '1'}`;
    assert.equal(ciRunId, expectedRun, 'CI run identity does not match the active GitHub Actions run and attempt');
  }
  return { commit: sourceCommit, ciRunId };
}

function resolveRepositoryRoot(input) {
  if (input === undefined) return repo;
  assert.equal(typeof input, 'string', 'repository root must be a string');
  assert.equal(/[\u0000-\u001f\u007f]/.test(input), false, 'repository root must not contain control characters');
  return path.resolve(input);
}

function currentRepositoryCommit(repositoryRoot, gitExecute) {
  return gitExecute('git', ['rev-parse', '--verify', 'HEAD^{commit}'], gitCommandOptions(repositoryRoot))
    .trim()
    .toLowerCase();
}

function gitCommitExists(commit, repositoryRoot, gitExecute) {
  return gitCommandStatus(gitExecute, ['cat-file', '-e', `${commit}^{commit}`], repositoryRoot) === 0;
}

function isShallowRepository(repositoryRoot, gitExecute) {
  const output = gitExecute('git', ['rev-parse', '--is-shallow-repository'], gitCommandOptions(repositoryRoot));
  return String(output).trim() === 'true';
}

function throwMissingSourceCommit(sourceCommit, repositoryRoot, gitExecute) {
  if (isShallowRepository(repositoryRoot, gitExecute)) {
    throw new Error('cannot verify source commit ancestry because required history is unavailable in a shallow repository');
  }
  throw new Error(`--source-commit must reference an existing commit object: ${sourceCommit}`);
}

function gitCommandStatus(gitExecute, args, repositoryRoot) {
  try {
    gitExecute('git', args, gitCommandOptions(repositoryRoot));
    return 0;
  } catch (error) {
    if (Number.isInteger(error?.status)) return error.status;
    throw error;
  }
}

function gitCommandOptions(repositoryRoot) {
  return {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  };
}

function validateTarballPath(input, label) {
  assert.equal(typeof input, 'string', `${label} tarball path must be a string`);
  assert.equal(/[\u0000-\u001f\u007f]/.test(input), false, `${label} tarball path must not contain control characters`);
  const resolved = path.resolve(input);
  assert.equal(existsSync(resolved), true, `${label} tarball does not exist`);
  const stats = lstatSync(resolved);
  assert.equal(stats.isFile() && !stats.isSymbolicLink(), true, `${label} tarball must be a regular file, not a symbolic link`);
  const canonical = realpathSync(resolved);
  assert.match(path.basename(canonical), VERSIONED_TARBALL, `${label} tarball must use a versioned skillmap-*.tgz filename`);
  assert.equal(stats.size > 0 && stats.size <= MAX_TARBALL_BYTES, true, `${label} tarball must be non-empty and at most 10 MiB`);
  return canonical;
}

function stageReleaseInputs(candidateSource, priorSource) {
  const root = mkdtempSync(path.join(tmpdir(), 'skillmap-release-stage-'));
  const candidateDirectory = path.join(root, 'candidate');
  const priorDirectory = path.join(root, 'prior');
  try {
    chmodSync(root, 0o700);
    mkdirSync(candidateDirectory, { mode: 0o700 });
    mkdirSync(priorDirectory, { mode: 0o700 });
    const candidateBytes = readNoFollow(candidateSource, 'candidate tarball', MAX_TARBALL_BYTES);
    const priorBytes = readNoFollow(priorSource, 'prior tarball', MAX_TARBALL_BYTES);
    const manifestBytes = readNoFollow(path.join(path.dirname(candidateSource), 'pack-manifest.json'), 'candidate pack manifest', MAX_MANIFEST_BYTES);
    const digestBytes = readNoFollow(path.join(path.dirname(candidateSource), 'SHA256SUMS'), 'candidate SHA256SUMS', MAX_DIGEST_BYTES);
    const candidate = path.join(candidateDirectory, path.basename(candidateSource));
    const prior = path.join(priorDirectory, path.basename(priorSource));
    writeStagedFile(candidate, candidateBytes);
    writeStagedFile(prior, priorBytes);
    writeStagedFile(path.join(candidateDirectory, 'pack-manifest.json'), manifestBytes);
    writeStagedFile(path.join(candidateDirectory, 'SHA256SUMS'), digestBytes);
    const candidateDigest = digestBytesOf(candidateBytes);
    const priorDigest = digestBytesOf(priorBytes);
    assert.equal(digestFile(candidate), candidateDigest, 'private candidate stage differs from the selected source bytes');
    assert.equal(digestFile(prior), priorDigest, 'private prior stage differs from the selected source bytes');
    chmodSync(candidateDirectory, 0o500);
    chmodSync(priorDirectory, 0o500);
    chmodSync(root, 0o500);
    return { root, candidateDirectory, priorDirectory, candidate, prior, candidateDigest, priorDigest };
  } catch (error) {
    cleanupStage({ root, candidateDirectory, priorDirectory });
    throw error;
  }
}

function readNoFollow(file, label, maximum) {
  assert.equal(existsSync(file), true, `${label} is required`);
  const pathStats = lstatSync(file);
  assert.equal(pathStats.isFile() && !pathStats.isSymbolicLink(), true, `${label} must be a regular file, not a symbolic link`);
  const fd = openSync(file, constants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    assert.equal(stats.isFile() && stats.size > 0 && stats.size <= maximum, true, `${label} has an invalid size`);
    const bytes = readFileSync(fd);
    assert.equal(bytes.length, stats.size, `${label} changed while it was staged`);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function writeStagedFile(file, bytes) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o400);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(file, 0o400);
}

function assertStageUnchanged(stage, label) {
  assert.equal(digestFile(stage.candidate), stage.candidateDigest, `staged candidate bytes changed ${label}`);
  assert.equal(digestFile(stage.prior), stage.priorDigest, `staged prior bytes changed ${label}`);
}

function cleanupStage(stage) {
  if (!stage?.root) return;
  for (const directory of [stage.root, stage.candidateDirectory, stage.priorDirectory]) {
    if (!directory || !existsSync(directory)) continue;
    try { chmodSync(directory, 0o700); } catch {}
  }
  try {
    rmSync(stage.root, { recursive: true, force: true });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    process.stderr.write(`Release staging cleanup warning: ${name}. Remove the private temporary directory during runner cleanup.\n`);
  }
}

function parseVerifierReceipt(output) {
  assert.equal(typeof output, 'string', 'candidate verifier did not return a text receipt');
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, 'candidate verifier returned no receipt');
  const receipt = JSON.parse(lines.at(-1));
  assert.equal(Boolean(receipt && typeof receipt === 'object' && !Array.isArray(receipt)), true, 'candidate verifier receipt must be an object');
  assert.match(receipt.sha256, SHA256, 'candidate verifier receipt has no valid SHA-256');
  assert.equal(Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0 && receipt.bytes <= MAX_TARBALL_BYTES, true,
    'candidate verifier receipt has an invalid byte count');
  return receipt;
}

function readCandidateManifest(candidate) {
  const manifest = JSON.parse(readFileSync(path.join(path.dirname(candidate), 'pack-manifest.json'), 'utf8'));
  assert.equal(Array.isArray(manifest) && manifest.length === 1, true, 'candidate pack manifest must describe exactly one package');
  assert.equal(manifest[0]?.name, 'skillmap', 'candidate pack manifest must describe SkillMap');
  assert.match(manifest[0]?.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'candidate pack manifest has an unsupported version');
  assert.equal(manifest[0]?.filename, path.basename(candidate), 'candidate pack manifest filename must match the exact tarball');
  return manifest[0];
}

function reserveEvidenceReceipt(input, initialReceipt, writeEvidence) {
  assert.equal(typeof input, 'string', 'evidence directory must be a string');
  assert.equal(/[\u0000-\u001f\u007f]/.test(input), false, 'evidence directory must not contain control characters');
  const directory = path.resolve(input);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStats = lstatSync(directory);
  assert.equal(directoryStats.isDirectory() && !directoryStats.isSymbolicLink(), true, 'evidence path must be a regular directory, not a symbolic link');
  const canonicalDirectory = realpathSync(directory);
  const receiptPath = path.join(canonicalDirectory, EVIDENCE_FILENAME);
  const existing = lstatSync(receiptPath, { throwIfNoEntry: false });
  assert.equal(existing, undefined, 'evidence receipt already exists; refusing to overwrite or follow it');
  const fd = openSync(receiptPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
  const identity = fstatSync(fd);
  const handle = { fd, path: receiptPath, dev: identity.dev, ino: identity.ino };
  try {
    writeEvidence(handle, initialReceipt);
    fsyncDirectory(canonicalDirectory);
    return handle;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function writeEvidenceReceipt(handle, receipt) {
  assertEvidenceIdentity(handle);
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(handle.fd, bytes, offset, bytes.length - offset, null);
  fsyncSync(handle.fd);
  assertEvidenceIdentity(handle);
}

function assertEvidenceIdentity(handle) {
  const openIdentity = fstatSync(handle.fd);
  const pathIdentity = lstatSync(handle.path, { throwIfNoEntry: false });
  assert.equal(Boolean(pathIdentity?.isFile() && !pathIdentity.isSymbolicLink()), true, 'reserved evidence receipt path was removed or replaced');
  assert.equal(openIdentity.dev, handle.dev, 'reserved evidence receipt device changed');
  assert.equal(openIdentity.ino, handle.ino, 'reserved evidence receipt inode changed');
  assert.equal(pathIdentity.dev, handle.dev, 'evidence receipt path points to a different device');
  assert.equal(pathIdentity.ino, handle.ino, 'evidence receipt path points to a different inode');
}

function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  const fd = openSync(directory, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function npmInvocation(args, environment) {
  if (environment.npm_execpath && existsSync(environment.npm_execpath)) {
    return { file: process.execPath, args: [environment.npm_execpath, ...args] };
  }
  if (process.platform === 'win32') throw new Error('Run the release wrapper through npm on Windows so npm_execpath identifies npm-cli.js without a command shell.');
  return { file: 'npm', args };
}

function sanitizedNpmEnvironment(environment, dryRun) {
  const sanitized = {};
  for (const [key, value] of Object.entries(environment)) {
    const normalized = key.toLowerCase().replaceAll('-', '_');
    if (!BLOCKED_NPM_CONFIG.has(normalized)) sanitized[key] = value;
  }
  sanitized.npm_config_registry = CANONICAL_NPM_REGISTRY;
  sanitized.npm_config_dry_run = dryRun ? 'true' : 'false';
  sanitized.npm_config_access = 'public';
  sanitized.npm_config_ignore_scripts = 'true';
  return sanitized;
}

function safeCommandFailure(error) {
  const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : 'Error';
  const candidateCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
  const code = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(candidateCode) ? candidateCode : 'UNKNOWN';
  return { name, code };
}

function warnEvidenceUpdate(error, context) {
  const name = error instanceof Error ? error.name : 'Error';
  process.stderr.write(`Release evidence update warning ${context}: ${name}. Registry outcome must be verified independently.\n`);
}

function digestFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function digestBytesOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function usage() {
  return [
    'Usage:',
    '  npm run release:candidate -- --candidate /absolute/skillmap-VERSION.tgz --prior /absolute/skillmap-PRIOR.tgz --dist-tag alpha --source-commit FULL_GIT_SHA --ci-run-id github:RUN_ID:ATTEMPT [--evidence-dir /absolute/path]',
    '  npm run release:candidate -- --candidate /absolute/skillmap-VERSION.tgz --prior /absolute/skillmap-PRIOR.tgz --dist-tag alpha --source-commit FULL_GIT_SHA --ci-run-id github:RUN_ID:ATTEMPT --dry-run [--evidence-dir /absolute/path]',
    '  npm run release:candidate -- --candidate /absolute/skillmap-VERSION.tgz --prior /absolute/skillmap-PRIOR.tgz --dist-tag alpha --source-commit FULL_GIT_SHA --ci-run-id github:RUN_ID:ATTEMPT --evidence-dir /absolute/path --publish --approve-publish "CANDIDATE_BOUND_APPROVAL"',
    '',
    'With neither --publish nor --dry-run, the command validates the privately staged candidate and rollback gate without invoking npm.',
    '--dry-run invokes npm publish only with the canonical registry and npm\'s non-publishing --dry-run=true flag after all gates.'
  ].join('\n');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const options = parseReleaseArguments(process.argv.slice(2));
    const receipt = runReleaseCandidate(options);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}
