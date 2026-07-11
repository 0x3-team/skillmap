import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const required = process.argv.includes('--required');
const artifactDir = process.env.SKILLMAP_UPGRADE_ARTIFACTS ? path.resolve(process.env.SKILLMAP_UPGRADE_ARTIFACTS) : null;
const report = {
  schemaVersion: 1,
  kind: 'skillmap.package-upgrade-rollback',
  status: 'not-run',
  priorTarball: null,
  candidateTarball: null
};
assertSemverComparator();

const priorInput = process.env.SKILLMAP_PRIOR_TARBALL;
const candidateInput = process.env.SKILLMAP_TEST_TARBALL;
if (!priorInput || !candidateInput) {
  report.reason = 'Two reviewed tarballs are required: SKILLMAP_PRIOR_TARBALL and SKILLMAP_TEST_TARBALL.';
  await finishReport();
  if (required) throw new Error(report.reason);
  process.stdout.write('Package upgrade/rollback proof not run: two reviewed versioned tarballs were not supplied.\n');
  process.exit(0);
}

const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-upgrade-rollback-'));
try {
  const priorTarball = validateTarball(priorInput, 'prior');
  const candidateTarball = validateTarball(candidateInput, 'candidate');
  const priorDigest = digestFile(priorTarball);
  const candidateDigest = digestFile(candidateTarball);
  assert.notEqual(priorDigest, candidateDigest, 'prior and candidate tarballs must have distinct SHA-256 digests');

  const priorManifest = inspectInstalledManifest(priorTarball, 'prior');
  const candidateManifest = inspectInstalledManifest(candidateTarball, 'candidate');
  assert.equal(priorManifest.name, 'skillmap');
  assert.equal(candidateManifest.name, 'skillmap');
  assert.match(priorManifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.match(candidateManifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.notEqual(priorManifest.version, candidateManifest.version, 'real rollback proof requires two distinct package versions');
  assert.equal(compareSemver(candidateManifest.version, priorManifest.version) > 0, true, 'candidate version must be newer than the reviewed prior version');

  const prefix = path.join(scratch, 'global-prefix');
  const workspace = path.join(scratch, 'workspace');
  const skillRoot = path.join(scratch, 'skills');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.join(skillRoot, 'alpha'), { recursive: true });
  writeFileSync(path.join(skillRoot, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for reviewed two-version package lifecycle verification.\n---\n# Alpha\n');
  const originalRoot = snapshotTree(skillRoot);

  installGlobal(prefix, workspace, priorTarball);
  const globalBin = globalExecutable(prefix);
  const globalCli = globalCliEntrypoint(prefix);
  assert.equal(existsSync(globalBin), true, 'global install did not expose the platform executable shim');
  assert.equal(cliVersion(globalCli, workspace), priorManifest.version, 'prior package did not install as the active global CLI');
  runCli(globalCli, ['init', '--root', skillRoot, '--json'], workspace);
  const stateRoot = path.join(workspace, '.skillmap');
  const priorState = snapshotTree(stateRoot);
  assert.equal(snapshotTree(skillRoot), originalRoot, 'prior initialization mutated the approved skill root');

  installGlobal(prefix, workspace, candidateTarball);
  assert.equal(cliVersion(globalCli, workspace), candidateManifest.version, 'candidate did not replace the prior global CLI');
  runCli(globalCli, ['status', '--json'], workspace);
  assert.equal(snapshotTree(stateRoot), priorState, 'candidate read changed prior workspace state during upgrade verification');
  assert.equal(snapshotTree(skillRoot), originalRoot, 'candidate upgrade mutated the approved skill root');

  installGlobal(prefix, workspace, priorTarball);
  assert.equal(cliVersion(globalCli, workspace), priorManifest.version, 'prior package rollback did not restore the prior CLI version');
  runCli(globalCli, ['status', '--json'], workspace);
  assert.equal(snapshotTree(stateRoot), priorState, 'prior rollback changed preserved workspace state');
  assert.equal(snapshotTree(skillRoot), originalRoot, 'prior rollback mutated the approved skill root');

  installGlobal(prefix, workspace, candidateTarball);
  assert.equal(cliVersion(globalCli, workspace), candidateManifest.version, 'candidate reinstall after rollback did not restore the candidate CLI');
  assert.equal(snapshotTree(stateRoot), priorState, 'candidate reinstall changed preserved workspace state');
  assert.equal(snapshotTree(skillRoot), originalRoot, 'candidate reinstall mutated the approved skill root');

  report.status = 'passed';
  report.priorTarball = { version: priorManifest.version, sha256: priorDigest };
  report.candidateTarball = { version: candidateManifest.version, sha256: candidateDigest };
  report.workspaceStatePreserved = true;
  report.approvedRootPreserved = true;
  report.completedAt = new Date().toISOString();
  await finishReport();
  process.stdout.write(`Package upgrade/rollback passed: ${priorManifest.version} -> ${candidateManifest.version} -> ${priorManifest.version} -> ${candidateManifest.version}.\n`);
} catch (error) {
  report.status = 'failed';
  report.error = { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) };
  report.completedAt = new Date().toISOString();
  await finishReport();
  throw error;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function validateTarball(input, label) {
  const resolved = path.resolve(input);
  assert.equal(path.extname(resolved), '.tgz', `${label} package must be an npm .tgz tarball`);
  assert.equal(existsSync(resolved), true, `${label} package tarball does not exist`);
  const stats = lstatSync(resolved);
  assert.equal(stats.isFile() && !stats.isSymbolicLink(), true, `${label} package must be a regular file`);
  assert.equal(stats.size > 0 && stats.size <= 10 * 1024 * 1024, true, `${label} package must be non-empty and at most 10 MiB`);
  return resolved;
}

function inspectInstalledManifest(tarball, label) {
  const directory = path.join(scratch, `inspect-${label}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`);
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: directory, stdio: 'inherit' });
  return JSON.parse(readFileSync(path.join(directory, 'node_modules', 'skillmap', 'package.json'), 'utf8'));
}

function installGlobal(prefix, cwd, tarball) {
  runNpm(['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd, stdio: 'inherit' });
}

function globalExecutable(prefix) {
  return process.platform === 'win32' ? path.join(prefix, 'skillmap.cmd') : path.join(prefix, 'bin', 'skillmap');
}

function globalCliEntrypoint(prefix) {
  return process.platform === 'win32'
    ? path.join(prefix, 'node_modules', 'skillmap', 'dist', 'cli.js')
    : path.join(prefix, 'lib', 'node_modules', 'skillmap', 'dist', 'cli.js');
}

function cliVersion(cli, cwd) {
  assert.equal(existsSync(cli), true, 'global SkillMap Node entrypoint is missing');
  return runCli(cli, ['--version'], cwd).trim();
}

function runNpm(args, options) {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  if (process.platform === 'win32') {
    throw new Error('Run this verifier through npm so npm_execpath identifies npm-cli.js without a command shell.');
  }
  return execFileSync('npm', args, { ...options, shell: false });
}

function runCli(cli, args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: false
  });
}

function digestFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function compareSemver(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
    assert.ok(match, `unsupported semantic version: ${value}`);
    const prerelease = match[4] ? match[4].split('.') : [];
    for (const identifier of prerelease) {
      assert.equal(/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'), false, `numeric prerelease identifiers must not contain leading zeroes: ${value}`);
    }
    return {
      core: match.slice(1, 4).map(value => BigInt(value)),
      prerelease
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = BigInt(leftPart);
      const rightNumber = BigInt(rightPart);
      return leftNumber < rightNumber ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function assertSemverComparator() {
  for (const [candidate, prior] of [
    ['1.0.0', '0.9.9'],
    ['1.0.0', '1.0.0-rc.9'],
    ['1.0.0-rc.10', '1.0.0-rc.2'],
    ['1.0.0-a', '1.0.0-A'],
    ['1.0.0-alpha', '1.0.0-Beta']
  ]) assert.equal(compareSemver(candidate, prior) > 0, true, `semantic-version ordering self-check failed: ${candidate} > ${prior}`);
  assert.throws(() => compareSemver('1.0.0-01', '1.0.0-1'), /leading zeroes/);
}

function snapshotTree(root) {
  const hash = createHash('sha256');
  visit(root, '.');
  return hash.digest('hex');

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

async function finishReport() {
  if (!artifactDir) return;
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(path.join(artifactDir, 'upgrade-rollback.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
