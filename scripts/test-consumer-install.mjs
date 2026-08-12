import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as nodeRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  findPackagePrivacyCanary,
  packageManifestPolicyError,
  packagePathPolicyError
} from './package-candidate-policy.mjs';

const MAX_INSTALLED_PACKAGE_FILES = 10_000;
const MAX_INSTALLED_PACKAGE_BYTES = 64 * 1024 * 1024;

const repo = path.resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-consumer-install-'));
let dashboard;

try {
  const suppliedTarball = process.env.SKILLMAP_TEST_TARBALL;
  let tarball;
  if (suppliedTarball) {
    tarball = path.resolve(suppliedTarball);
    assert.equal(path.extname(tarball), '.tgz', 'supplied candidate must be an npm .tgz tarball');
    assert.equal(existsSync(tarball), true, 'supplied candidate tarball does not exist');
    const stats = lstatSync(tarball);
    assert.equal(stats.isFile() && stats.size > 0 && stats.size <= 10 * 1024 * 1024, true, 'supplied candidate tarball must be a bounded regular file');
  } else {
    const packed = JSON.parse(runNpm(['pack', '--json', '--pack-destination', scratch], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit']
    }));
    assert.equal(Array.isArray(packed), true);
    assert.equal(packed.length, 1);
    tarball = path.join(scratch, packed[0].filename);
    assertPackageFileList(packed[0].files);
    writeFileSync(path.join(scratch, 'pack-manifest.json'), `${JSON.stringify(packed, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
  }
  assert.equal(existsSync(tarball), true, 'candidate tarball must exist');
  const verifyEnvironment = { ...process.env, GITHUB_ENV: '', GITHUB_OUTPUT: '' };
  const verification = JSON.parse(execFileSync(process.execPath, [
    path.join(repo, 'scripts', 'verify-package-candidate.mjs'),
    tarball,
    ...(suppliedTarball ? [] : ['--write'])
  ], {
    cwd: repo,
    encoding: 'utf8',
    env: verifyEnvironment,
    stdio: ['ignore', 'pipe', 'inherit']
  }));
  assert.equal(realpathSync(verification.tarball), realpathSync(tarball), 'pre-install verification selected a different candidate tarball');

  const consumer = path.join(scratch, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ name: 'skillmap-clean-consumer', version: '1.0.0', private: true }, null, 2)}\n`);
  runNpm(['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', tarball], { cwd: consumer, stdio: 'inherit' });

  const packageRoot = path.join(consumer, 'node_modules', 'skillmap');
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'skillmap');
  assert.equal(packageManifestPolicyError(manifest), null, packageManifestPolicyError(manifest) ?? undefined);
  assertInstalledPackagePolicy(packageRoot);
  for (const required of [
    'dist/cli.js',
    'contracts/manifest.json',
    'assets/local-app/v1/index.html',
    'assets/local-app/v1/app.js',
    'assets/local-app/v1/app.css',
    'assets/local-app/v1/modules/app-shell.js',
    'assets/local-app/v1/modules/views/overview.js'
  ]) assert.equal(existsSync(path.join(packageRoot, required)), true, `packed consumer is missing ${required}`);
  assert.equal(existsSync(path.join(packageRoot, 'docs/plans')), false, 'internal plans must not ship in the consumer package');
  for (const forbidden of ['.github', '.implementation', '.skillmap', 'apps', 'artifacts', 'scripts', 'test']) {
    assert.equal(existsSync(path.join(packageRoot, forbidden)), false, `development-only ${forbidden} must not ship in the consumer package`);
  }

  const cli = path.join(packageRoot, 'dist', 'cli.js');
  const installedBin = process.platform === 'win32'
    ? path.join(consumer, 'node_modules', '.bin', 'skillmap.cmd')
    : path.join(consumer, 'node_modules', '.bin', 'skillmap');
  const help = execFileSync(installedBin, ['--help'], {
    cwd: consumer,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  assert.match(help, /SkillMap CLI/);
  assert.match(help, /dashboard/);
  const version = runExecutable(installedBin, ['--version'], consumer).trim();
  assert.equal(version, manifest.version, 'installed CLI --version must match the package manifest');

  const skillRoot = path.join(consumer, 'skills');
  mkdirSync(path.join(skillRoot, 'alpha'), { recursive: true });
  writeFileSync(path.join(skillRoot, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Use for isolated consumer-install verification.\n---\n# Alpha\n');
  execFileSync(process.execPath, [cli, 'init', '--root', skillRoot, '--json'], {
    cwd: consumer,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });

  dashboard = await startDashboard(cli, consumer);
  const health = await request(dashboard.startup.origin, '/api/v1/health');
  assert.equal(health.status, 200);
  const healthEnvelope = JSON.parse(health.body);
  assert.equal(healthEnvelope.ok, true);
  assert.equal(healthEnvelope.data.version, manifest.version);

  const bootstrapUrl = new URL(dashboard.startup.bootstrapUrl);
  const exchange = await request(dashboard.startup.origin, `${bootstrapUrl.pathname}${bootstrapUrl.search}`);
  assert.equal(exchange.status, 303);
  const redirect = new URL(exchange.headers.location, dashboard.startup.origin);
  assert.equal(redirect.pathname, '/app');
  assert.equal(redirect.search, '');
  const fragment = new URLSearchParams(redirect.hash.slice(1));
  const capability = fragment.get('skillmap-capability');
  const csrf = fragment.get('skillmap-csrf');
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
  assert.match(csrf, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual([...fragment.keys()].sort(), ['skillmap-capability', 'skillmap-csrf']);
  const setCookies = Array.isArray(exchange.headers['set-cookie'])
    ? exchange.headers['set-cookie']
    : [exchange.headers['set-cookie']].filter(Boolean);
  assert.equal(setCookies.length, 0, 'one-time exchange must not emit host-scoped authorization cookies');
  assert.equal(exchange.body.includes(capability), false, 'capability must not appear in the bootstrap response body');
  assert.equal(exchange.body.includes(csrf), false, 'CSRF proof must not appear in the bootstrap response body');

  const shell = await request(dashboard.startup.origin, '/app');
  assert.equal(shell.status, 200);
  assert.match(shell.body, /<script src="\/app\.js" type="module"><\/script>/);
  assert.match(shell.body, /href="\/app\.css"/);
  const appModule = await request(dashboard.startup.origin, '/modules/app-shell.js');
  assert.equal(appModule.status, 200);
  assert.match(appModule.body, /export function createLocalApp/);

  const bootstrap = await request(dashboard.startup.origin, '/api/v1/bootstrap', { 'x-skillmap-capability': capability });
  assert.equal(bootstrap.status, 200);
  const bootstrapEnvelope = JSON.parse(bootstrap.body);
  assert.equal(bootstrapEnvelope.ok, true);
  assert.equal(bootstrap.body.includes(consumer), false, 'bootstrap response must not expose the consumer workspace path');
  assert.equal(bootstrap.body.includes(skillRoot), false, 'bootstrap response must not expose an approved-root candidate path');
  assert.equal(bootstrapEnvelope.data.connectorCompatibility.apiVersion, 'v1');
  assert.equal(bootstrapEnvelope.data.connectorCompatibility.localAppAssetVersion, 'v1');
  assert.equal(bootstrapEnvelope.data.connectorCompatibility.productVersion, manifest.version);
  assert.equal(bootstrap.body.includes(capability), false, 'bootstrap API response must not echo the capability');
  assert.equal(bootstrap.body.includes(csrf), false, 'bootstrap API response must not echo the CSRF proof');

  await dashboard.stop();
  dashboard = undefined;
  exerciseGlobalLifecycle(tarball, manifest.version);
  const canaries = consumerCanaryState();
  assert.equal(canaries.lifecycleMarkerExists, false, 'consumer install executed an automatic lifecycle canary');
  assert.equal(canaries.networkMarkerExists, false, 'consumer install triggered the network canary');
  assert.equal(canaries.compileMarkerExists, false, 'consumer install triggered the consumer compilation canary');
  writeConsumerReceipt({
    tarball: realpathSync(tarball),
    version: manifest.version,
    packageScripts: Object.keys(manifest.scripts ?? {}).sort(),
    canaries,
    install: { ignoreScripts: true, offline: true, audit: false, fund: false },
    installedPackage: { files: countInstalledPackageFiles(packageRoot), symlinks: false }
  });
  process.stdout.write(`Clean consumer install and packaged dashboard smoke passed for ${manifest.name}@${manifest.version} on ${process.platform} ${process.version}${suppliedTarball ? ' using the supplied candidate tarball' : ''}.\n`);
} finally {
  await dashboard?.stop().catch(() => undefined);
  rmSync(scratch, { recursive: true, force: true });
}

function consumerCanaryState() {
  return {
    lifecycleMarkerExists: markerExists(process.env.SKILLMAP_LIFECYCLE_CANARY),
    networkMarkerExists: markerExists(process.env.SKILLMAP_NETWORK_CANARY),
    compileMarkerExists: markerExists(process.env.SKILLMAP_CONSUMER_COMPILE_CANARY)
  };
}

function markerExists(file) {
  return Boolean(file && existsSync(file));
}

function writeConsumerReceipt(receipt) {
  const target = process.env.SKILLMAP_CONSUMER_RECEIPT;
  if (!target) return;
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function countInstalledPackageFiles(root) {
  let files = 0;
  visit(root);
  return files;
  function visit(target) {
    const stats = lstatSync(target);
    if (stats.isDirectory()) {
      for (const name of readdirSync(target)) visit(path.join(target, name));
    } else if (stats.isFile()) files += 1;
  }
}

function assertPackageFileList(files) {
  assert.ok(Array.isArray(files) && files.length > 0, 'npm pack must report the package file list');
  const paths = files.map(file => file.path);
  for (const name of paths) {
    assert.equal(path.isAbsolute(name), false, `package entry must be relative: ${name}`);
    assert.equal(name.includes('..'), false, `package entry must not traverse: ${name}`);
    assert.equal(packagePathPolicyError(name), null, packagePathPolicyError(name) ?? undefined);
  }
  if (process.platform !== 'win32') {
    const cli = files.find(file => file.path === 'dist/cli.js');
    assert.ok(cli, 'package manifest must contain dist/cli.js');
    for (const file of files) {
      const expectedMode = file.path === 'dist/cli.js' ? 0o755 : 0o644;
      assert.equal(file.mode & 0o777, expectedMode, `packed entry mode must be ${expectedMode.toString(8)}: ${file.path}`);
    }
  }
}

function assertInstalledPackagePolicy(packageRoot) {
  let files = 0;
  let bytes = 0;
  visit(packageRoot, '');

  function visit(target, relative) {
    const stats = lstatSync(target);
    assert.equal(stats.isSymbolicLink(), false, `installed package contains a symbolic link: ${relative || '.'}`);
    if (stats.isDirectory()) {
      for (const name of readdirSync(target).sort()) {
        visit(path.join(target, name), relative ? path.posix.join(relative, name) : name);
      }
      return;
    }
    assert.equal(stats.isFile(), true, `installed package contains an unsupported filesystem entry: ${relative}`);
    files += 1;
    bytes += stats.size;
    assert.equal(files <= MAX_INSTALLED_PACKAGE_FILES, true, 'installed package exceeds the file-count safety limit');
    assert.equal(Number.isSafeInteger(bytes) && bytes <= MAX_INSTALLED_PACKAGE_BYTES, true, 'installed package exceeds the byte safety limit');
    assert.equal(packagePathPolicyError(relative), null, packagePathPolicyError(relative) ?? undefined);
    const canary = findPackagePrivacyCanary(readFileSync(target));
    assert.equal(canary, null, `installed package entry ${relative} contains a high-confidence ${canary ?? 'privacy'} canary`);
  }
}

function exerciseGlobalLifecycle(tarball, expectedVersion) {
  const prefix = path.join(scratch, 'global-prefix');
  const workspace = path.join(scratch, 'global-workspace');
  const skillRoot = path.join(scratch, 'global-skills');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.join(skillRoot, 'global-alpha'), { recursive: true });
  writeFileSync(path.join(skillRoot, 'global-alpha', 'SKILL.md'), '---\nname: global-alpha\ndescription: Use for temporary-prefix global lifecycle verification.\n---\n# Global Alpha\n');
  const originalSkillRoot = snapshotTree(skillRoot);

  runNpm(['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: workspace, stdio: 'inherit' });
  const globalBin = process.platform === 'win32'
    ? path.join(prefix, 'skillmap.cmd')
    : path.join(prefix, 'bin', 'skillmap');
  assert.equal(existsSync(globalBin), true, 'temporary-prefix global install must expose the SkillMap executable');
  assert.equal(runExecutable(globalBin, ['--version'], workspace).trim(), expectedVersion, 'temporary-prefix global CLI version must match the candidate');
  assert.match(runExecutable(globalBin, ['--help'], workspace), /SkillMap CLI/);
  runExecutable(globalBin, ['init', '--root', skillRoot, '--json'], workspace);

  const stateRoot = path.join(workspace, '.skillmap');
  assert.equal(existsSync(stateRoot), true, 'global CLI init must create isolated consumer workspace state');
  const installedWorkspaceState = snapshotTree(stateRoot);
  assert.equal(snapshotTree(skillRoot), originalSkillRoot, 'global install and init must not mutate the approved skill root');

  runNpm(['uninstall', '--global', '--prefix', prefix, '--ignore-scripts', 'skillmap'], { cwd: workspace, stdio: 'inherit' });
  assert.equal(existsSync(globalBin), false, 'temporary-prefix global uninstall must remove the SkillMap executable');
  assert.equal(snapshotTree(stateRoot), installedWorkspaceState, 'global uninstall must preserve consumer workspace state byte-for-byte');
  assert.equal(snapshotTree(skillRoot), originalSkillRoot, 'global uninstall must preserve the approved skill root byte-for-byte');

  runNpm(['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: workspace, stdio: 'inherit' });
  assert.equal(existsSync(globalBin), true, 'temporary-prefix global reinstall must restore the SkillMap executable');
  assert.equal(runExecutable(globalBin, ['--version'], workspace).trim(), expectedVersion, 'reinstalled global CLI version must match the candidate');
  assert.equal(snapshotTree(stateRoot), installedWorkspaceState, 'global reinstall must preserve consumer workspace state byte-for-byte');
  assert.equal(snapshotTree(skillRoot), originalSkillRoot, 'global reinstall must preserve the approved skill root byte-for-byte');
}

function runNpm(args, options) {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return execFileSync('npm', args, { ...options, shell: process.platform === 'win32' });
}

function runExecutable(executable, args, cwd) {
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32'
  });
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

async function startDashboard(cli, cwd) {
  const child = spawn(process.execPath, [cli, 'dashboard', '--json'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const startup = await waitFor(async () => {
    const newline = stdout.search(/\r?\n/);
    if (newline < 0) return undefined;
    const line = stdout.slice(0, newline).trim();
    if (!line) return undefined;
    return JSON.parse(line);
  }, 15_000, () => `packaged dashboard did not start; stdout=${stdout.trim()} stderr=${stderr.trim()}`, child);
  assert.equal(startup.kind, 'skillmap.dashboard-started');
  assert.equal(startup.mode, 'foreground');
  assert.equal(startup.promptRetention, false);
  assert.equal(new URL(startup.bootstrapUrl).origin, startup.origin);

  let stopped = false;
  return {
    child,
    startup,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await waitForExit(child, 10_000, () => `packaged dashboard did not stop; stdout=${stdout.trim()} stderr=${stderr.trim()}`);
      assert.equal(child.exitCode === 0 || child.signalCode === 'SIGTERM', true, `packaged dashboard exited unexpectedly; stdout=${stdout.trim()} stderr=${stderr.trim()}`);
    }
  };
}

function request(origin, pathname, headers = {}) {
  const url = new URL(pathname, origin);
  return new Promise((resolve, reject) => {
    const req = nodeRequest(url, { method: 'GET', headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.setTimeout(5_000, () => req.destroy(new Error(`request timed out: ${url}`)));
    req.on('error', reject);
    req.end();
  });
}

async function waitFor(probe, timeoutMs, message, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(message());
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message());
}

function waitForExit(child, timeoutMs, message) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(message()));
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
