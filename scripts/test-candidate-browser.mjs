import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { packageManifestPolicyError } from './package-candidate-policy.mjs';

assert.deepEqual(process.argv.slice(2), [], 'the candidate Chromium gate has no mode overrides; it always runs the full critical workflow');

const repo = path.resolve(import.meta.dirname, '..');
const artifactEnv = process.env.SKILLMAP_BROWSER_ARTIFACTS;
assert.equal(typeof artifactEnv, 'string', 'SKILLMAP_BROWSER_ARTIFACTS is required so candidate evidence is retained');
assert.notEqual(artifactEnv.trim(), '', 'SKILLMAP_BROWSER_ARTIFACTS must not be empty');
const artifactDir = path.resolve(artifactEnv);
mkdirSync(artifactDir, { recursive: true });
const receiptPath = path.join(artifactDir, 'candidate-chromium.json');
const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-candidate-browser-'));
const startedAt = new Date().toISOString();
let candidate = null;
let failure = null;

try {
  const suppliedTarball = process.env.SKILLMAP_TEST_TARBALL;
  assert.equal(typeof suppliedTarball, 'string', 'SKILLMAP_TEST_TARBALL is required; this gate never rebuilds a source checkout');
  assert.notEqual(suppliedTarball.trim(), '', 'SKILLMAP_TEST_TARBALL must not be empty');
  const tarball = path.resolve(suppliedTarball);
  assert.equal(path.extname(tarball), '.tgz', 'the retained candidate must be an npm .tgz tarball');
  assert.equal(existsSync(tarball), true, 'the retained candidate tarball does not exist');
  const tarballStats = lstatSync(tarball);
  assert.equal(tarballStats.isFile() && tarballStats.size > 0 && tarballStats.size <= 10 * 1024 * 1024, true, 'the retained candidate must be a bounded regular file');

  const verifyEnvironment = { ...process.env, GITHUB_ENV: '', GITHUB_OUTPUT: '' };
  const verification = JSON.parse(execFileSync(process.execPath, [path.join(repo, 'scripts', 'verify-package-candidate.mjs'), tarball], {
    cwd: repo,
    encoding: 'utf8',
    env: verifyEnvironment,
    stdio: ['ignore', 'pipe', 'inherit']
  }));
  assert.equal(realpathSync(verification.tarball), realpathSync(tarball), 'candidate verification selected a different tarball');

  const packManifest = JSON.parse(readFileSync(path.join(path.dirname(tarball), 'pack-manifest.json'), 'utf8'));
  assert.equal(packManifest.length, 1, 'candidate pack manifest must describe exactly one package');
  const expectedVersion = packManifest[0].version;

  const consumer = path.join(scratch, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'skillmap-candidate-browser-consumer', version: '1.0.0', private: true }, null, 2)}\n`, 'utf8');
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: consumer, stdio: 'inherit' });

  const packageRoot = realpathSync(path.join(consumer, 'node_modules', 'skillmap'));
  const installedManifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(installedManifest.name, 'skillmap', 'temporary consumer installed the wrong package');
  assert.equal(installedManifest.version, expectedVersion, 'installed package version does not match the retained pack manifest');
  assert.equal(packageManifestPolicyError(installedManifest), null, packageManifestPolicyError(installedManifest) ?? undefined);
  for (const required of [
    'dist/cli.js',
    'dist/core/workspace-state/index.js',
    'contracts/manifest.json',
    'assets/local-app/v1/index.html',
    'assets/local-app/v1/app.js',
    'assets/local-app/v1/app.css'
  ]) assert.equal(existsSync(path.join(packageRoot, required)), true, `installed candidate is missing ${required}`);

  const cli = path.join(packageRoot, 'dist', 'cli.js');
  const cliVersion = execFileSync(process.execPath, [cli, '--version'], {
    cwd: consumer,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
  assert.equal(cliVersion, expectedVersion, 'candidate CLI version does not match the retained pack manifest');

  candidate = {
    filename: verification.filename,
    sha256: verification.sha256,
    bytes: verification.bytes,
    package: installedManifest.name,
    version: installedManifest.version
  };
  writeReceipt('running');

  const result = await runChild(process.execPath, [
    path.join(repo, 'apps', 'web', 'scripts', 'local-app-browser.mjs'),
    '--browser=chromium',
    '--critical'
  ], {
    cwd: repo,
    env: {
      ...process.env,
      SKILLMAP_BROWSER_PACKAGE_ROOT: packageRoot,
      SKILLMAP_BROWSER_CANDIDATE_SHA256: candidate.sha256
    },
    stdio: 'inherit'
  });
  assert.equal(result.signal, null, `candidate Chromium workflow terminated by ${result.signal}`);
  assert.equal(result.code, 0, `candidate Chromium workflow exited ${result.code}`);

  const qaReport = JSON.parse(readFileSync(path.join(artifactDir, 'qa-chromium.json'), 'utf8'));
  assert.equal(qaReport.status, 'passed', 'candidate Chromium QA report did not pass');
  assert.equal(qaReport.browser?.name, 'chromium', 'candidate QA report was produced by the wrong browser');
  assert.deepEqual(qaReport.modes, ['critical'], 'candidate QA report did not run the full critical mode');
  assert.equal(qaReport.runtimePackage?.source, 'temporary-consumer-candidate', 'browser runner did not acknowledge candidate runtime execution');
  assert.equal(qaReport.runtimePackage?.version, expectedVersion, 'browser runner runtime version does not match the candidate');
  assert.equal(qaReport.runtimePackage?.sha256, candidate.sha256, 'browser runner runtime digest does not match the retained candidate');
} catch (error) {
  failure = error;
} finally {
  try {
    writeReceipt(failure ? 'failed' : 'passed', failure);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (failure) throw failure;
process.stdout.write(`Exact candidate Chromium workflow passed for ${candidate.package}@${candidate.version} (${candidate.sha256}).\n`);

function writeReceipt(status, error) {
  const receipt = {
    schemaVersion: 1,
    status,
    startedAt,
    updatedAt: new Date().toISOString(),
    candidate,
    installation: {
      kind: 'temporary-consumer',
      runtimePackageRoot: 'node_modules/skillmap',
      sourceRebuildAllowed: false
    },
    browserWorkflow: {
      browser: 'chromium',
      mode: 'critical',
      runner: 'apps/web/scripts/local-app-browser.mjs',
      assertions: ['recommended-route', 'stable-route-trace', 'feedback-receipt', 'doctor-job']
    },
    ...(error ? { error: { name: error.name || 'Error', message: String(error.message || error) } } : {})
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
}

function runNpm(args, options) {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return execFileSync('npm', args, { ...options, shell: process.platform === 'win32' });
}

function runChild(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}
