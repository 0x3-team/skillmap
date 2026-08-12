import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const FORBIDDEN_INSTALL_SCRIPTS = [
  'preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'
];

export function createReviewedTarballs(repo, root, outputRoot = root) {
  const versions = [
    { label: 'prior', version: '0.1.0-m3.13.0' },
    { label: 'candidate', version: '0.1.1-m3.13.0' }
  ];
  return versions.map(({ label, version }) => {
    const source = path.join(root, `source-${label}`);
    const output = path.join(outputRoot, `review-${label}`);
    copyRepository(repo, source);
    mkdirSync(output, { recursive: true });

    const packagePath = path.join(source, 'package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
    manifest.version = version;
    writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    patchProductVersion(path.join(source, 'dist', 'server', 'compatibility.js'), version);

    const packed = JSON.parse(runNpm([
      'pack', '--json', '--ignore-scripts', '--offline', '--no-audit', '--no-fund',
      '--pack-destination', output
    ], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
    assert.equal(packed.length, 1, `${label} pack must emit exactly one tarball`);
    const tarball = path.join(output, packed[0].filename);
    writeFileSync(path.join(output, 'pack-manifest.json'), `${JSON.stringify(packed, null, 2)}\n`, 'utf8');

    const verifier = path.join(repo, 'scripts', 'verify-package-candidate.mjs');
    const receipt = JSON.parse(execFileSync(process.execPath, [verifier, output, '--write'], {
      cwd: repo,
      env: verifierEnvironment(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit']
    }));
    assert.equal(receipt.filename, packed[0].filename);
    assert.equal(receipt.sha256, digestFile(tarball));
    assert.equal(packed[0].version, version);
    assert.equal(packed[0].filename, `skillmap-${version}.tgz`);
    assert.ok(packed[0].files.some(entry => entry.path === 'dist/cli.js'));
    assert.equal(Object.keys(manifest.scripts ?? {}).some(name => FORBIDDEN_INSTALL_SCRIPTS.includes(name)), false,
      `${label} package declares an automatic install lifecycle script`);
    const archiveEntries = inspectArchive(tarball);
    assert.deepEqual(archiveEntries.map(entry => entry.path).sort(), packed[0].files.map(entry => entry.path).sort(), `${label} archive paths differ from pack manifest`);
    for (const entry of archiveEntries) {
      const declared = packed[0].files.find(candidate => candidate.path === entry.path);
      assert.ok(declared, `${label} archive entry was not declared by npm pack`);
      assert.equal(entry.type, 'file');
      assert.equal(entry.mode, declared.mode & 0o777);
      assert.equal(entry.size, declared.size);
    }
    const packManifestPath = path.join(output, 'pack-manifest.json');
    const digestEvidencePath = path.join(output, 'SHA256SUMS');
    return {
      label,
      version,
      tarball,
      sha256: receipt.sha256,
      bytes: lstatSync(tarball).size,
      manifest: packed[0],
      packManifestPath,
      packManifestSha256: digestFile(packManifestPath),
      digestEvidencePath,
      archiveEntries
    };
  });
}

export function createLifecycleWorkspace(root) {
  const workspace = path.join(root, 'workspace');
  const skills = path.join(workspace, 'skills');
  const skillmap = path.join(workspace, '.skillmap');
  const cache = path.join(skillmap, 'cache');
  const runtime = path.join(skillmap, 'runtime');
  const credentials = path.join(skillmap, 'credentials');
  const quarantine = path.join(skillmap, 'quarantine');
  const hooks = path.join(workspace, '.codex', 'hooks.json');
  mkdirSync(path.join(skills, 'alpha'), { recursive: true });
  mkdirSync(cache, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  mkdirSync(credentials, { recursive: true });
  mkdirSync(quarantine, { recursive: true });
  mkdirSync(path.dirname(hooks), { recursive: true });

  writeFileSync(path.join(skills, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: M3.13 preservation fixture.\n---\n# Alpha\n', 'utf8');
  writeFileSync(path.join(workspace, 'unrelated-workspace.txt'), 'workspace-owned bytes\n', 'utf8');
  writeFileSync(path.join(skillmap, 'config.yml'), 'version: 1\nprofile: personal-v1\nroots: [skills]\n', 'utf8');
  writeFileSync(path.join(quarantine, 'unrelated.bin'), Buffer.from([0, 1, 2, 3, 255]));
  writeFileSync(path.join(cache, 'unrelated-cache.json'), '{"owner":"other-tool","keep":true}\n', 'utf8');
  writeFileSync(path.join(runtime, 'skillmap-owned-runtime.json'), '{"owner":"skillmap","fixture":true}\n', 'utf8');
  writeFileSync(path.join(cache, 'skillmap-owned-cache.json'), '{"owner":"skillmap","fixture":true}\n', 'utf8');

  const credential = path.join(credentials, 'credential-v2.json');
  writeFileSync(credential, `${JSON.stringify({
    schemaVersion: 2,
    deviceId: 'fixture-device',
    tokenFamilyId: 'fixture-family',
    refreshToken: 'fixture-refresh-token',
    generation: 7,
    format: 'newer-than-reviewed-prior',
    note: 'synthetic local credential; never a real Keychain record'
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  writeFileSync(hooks, `${JSON.stringify({
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'other-tool prompt-hook', timeout: 5 }] },
        { hooks: [{ type: 'command', command: 'node /tmp/skillmap route --hook --max 3', timeout: 5 }] }
      ],
      Notification: [{ hooks: [{ type: 'command', command: 'other-tool notification', timeout: 5 }] }]
    }
  }, null, 2)}\n`, 'utf8', { mode: 0o600 });

  const preserved = [
    path.join(workspace, 'unrelated-workspace.txt'),
    path.join(skills, 'alpha', 'SKILL.md'),
    path.join(skillmap, 'config.yml'),
    path.join(quarantine, 'unrelated.bin'),
    path.join(cache, 'unrelated-cache.json')
  ];
  return { workspace, skills, skillmap, cache, runtime, credentials, credential, quarantine, hooks, preserved };
}

export function snapshotFiles(files) {
  return new Map(files.map(file => [file, digestTree(file)]));
}

export function describeFiles(files) {
  return new Map(files.map(file => [file, { ...snapshotPath(file), treeDigest: digestTree(file) }]));
}

export function snapshotPath(file) {
  const stats = lstatSync(file);
  assert.equal(stats.isFile(), true, `fixture must be a regular file: ${file}`);
  return {
    sha256: digestFile(file),
    bytes: stats.size,
    mode: stats.mode & 0o777,
    inode: Number.isSafeInteger(stats.ino) ? stats.ino : null
  };
}

export function assertPathPreserved(before, after, label) {
  assert.deepEqual(
    { sha256: after.sha256, bytes: after.bytes, mode: after.mode },
    { sha256: before.sha256, bytes: before.bytes, mode: before.mode },
    `${label} bytes/size/mode changed`
  );
  // An update may replace a file atomically. If it does, the replacement must
  // still be byte- and mode-identical; an unchanged inode is stronger evidence.
  return { ...after, inodePreserved: before.inode === null || after.inode === before.inode };
}

export function assertFilesPreserved(snapshot) {
  for (const [file, digest] of snapshot) assert.equal(digestTree(file), digest, `preserved fixture changed: ${file}`);
}

export function mockLocalLogout(credential) {
  assert.equal(existsSync(credential), true, 'mock logout requires the synthetic local credential');
  return {
    async getAuthStatus() {
      return { state: 'authenticated' };
    },
    async logout() {
      rmSync(credential);
      return { remoteRevoked: false, localDeleted: true, storage: 'mocked-local-fixture' };
    }
  };
}

export function removeOwnedFixtures({ runtime, cache }) {
  rmSync(path.join(runtime, 'skillmap-owned-runtime.json'), { force: true });
  rmSync(path.join(cache, 'skillmap-owned-cache.json'), { force: true });
  assert.equal(existsSync(path.join(runtime, 'skillmap-owned-runtime.json')), false);
  assert.equal(existsSync(path.join(cache, 'skillmap-owned-cache.json')), false);
}

export function installGlobal(prefix, cwd, tarball) {
  runNpm([
    'install', '--global', '--prefix', prefix, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', tarball
  ], { cwd, stdio: 'inherit' });
}

export function uninstallGlobal(prefix, cwd) {
  runNpm(['uninstall', '--global', '--prefix', prefix, '--ignore-scripts', '--offline', 'skillmap'], {
    cwd, stdio: 'inherit'
  });
}

export function globalCli(prefix) {
  return process.platform === 'win32'
    ? path.join(prefix, 'node_modules', 'skillmap', 'dist', 'cli.js')
    : path.join(prefix, 'lib', 'node_modules', 'skillmap', 'dist', 'cli.js');
}

export function runCli(cli, args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SKILLMAP_ENABLE_MACOS_CUSTODY: '0' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
}

export function runConsumerInstall(repo, packageInfo, artifactRoot) {
  const { tarball, label, version } = packageInfo;
  const canaryRoot = path.join(artifactRoot, `consumer-${label}`);
  mkdirSync(canaryRoot, { recursive: true });
  const receiptPath = path.join(canaryRoot, 'consumer-install.json');
  const lifecycleMarker = path.join(canaryRoot, 'lifecycle-marker');
  const networkMarker = path.join(canaryRoot, 'network-marker');
  const compileMarker = path.join(canaryRoot, 'compile-marker');
  execFileSync(process.execPath, [path.join(repo, 'scripts', 'test-consumer-install.mjs')], {
    cwd: repo,
    env: {
      ...process.env,
      SKILLMAP_TEST_TARBALL: tarball,
      SKILLMAP_CONSUMER_RECEIPT: receiptPath,
      SKILLMAP_LIFECYCLE_CANARY: lifecycleMarker,
      SKILLMAP_NETWORK_CANARY: networkMarker,
      SKILLMAP_CONSUMER_COMPILE_CANARY: compileMarker,
      npm_config_ignore_scripts: 'true',
      npm_config_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      SKILLMAP_ENABLE_MACOS_CUSTODY: '0'
    },
    stdio: 'inherit'
  });
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.version, version);
  assert.equal(receipt.packageScripts.some(script => FORBIDDEN_INSTALL_SCRIPTS.includes(script)), false,
    `${label} consumer manifest declares an automatic install lifecycle script`);
  assert.equal(receipt.canaries.lifecycleMarkerExists, false);
  assert.equal(receipt.canaries.networkMarkerExists, false);
  assert.equal(receipt.canaries.compileMarkerExists, false);
  return receipt;
}

function copyRepository(repo, target) {
  cpSync(repo, target, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repo, source);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts[0] === 'contracts' && parts[1] === 'test-vectors' && parts[2]?.startsWith('device-auth-')) return false;
      return !parts.some(part => ['.git', 'node_modules', 'artifacts', '.next', '.turbo', 'coverage'].includes(part));
    }
  });
}

function patchProductVersion(file, version) {
  const source = readFileSync(file, 'utf8');
  const patched = source.replace(/SKILLMAP_PRODUCT_VERSION = '[^']+'/u, `SKILLMAP_PRODUCT_VERSION = '${version}'`);
  assert.notEqual(patched, source, 'packed CLI compatibility module did not contain the product version');
  writeFileSync(file, patched, 'utf8');
}

function runNpm(args, options) {
  const env = {
    ...process.env,
    npm_config_ignore_scripts: 'true',
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false'
  };
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], { ...options, env });
  }
  return execFileSync('npm', args, { ...options, env, shell: process.platform === 'win32' });
}

function verifierEnvironment() {
  const env = { ...process.env, SKILLMAP_ENABLE_MACOS_CUSTODY: '0' };
  for (const key of Object.keys(env)) if (/^github_(env|output)$/i.test(key)) delete env[key];
  return env;
}

function digestFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function inspectArchive(file) {
  const bytes = gunzipSync(readFileSync(file));
  const entries = [];
  let offset = 0;
  while (offset + 1024 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const typeFlag = header[156];
    const name = decodeTarField(header.subarray(0, 100));
    const prefix = decodeTarField(header.subarray(345, 500));
    const archivePath = prefix ? `${prefix}/${name}` : name;
    assert.equal(archivePath.startsWith('package/'), true, `archive entry escaped package root: ${archivePath}`);
    const relative = archivePath.slice('package/'.length);
    assert.equal(relative.split('/').includes('..'), false, `archive entry traverses package root: ${relative}`);
    const size = parseTarOctal(header.subarray(124, 136));
    const mode = parseTarOctal(header.subarray(100, 108)) & 0o777;
    const contentStart = offset + 512;
    const content = bytes.subarray(contentStart, contentStart + size);
    entries.push({
      path: relative,
      type: typeFlag === 0 || typeFlag === 48 ? 'file' : `type-${String.fromCharCode(typeFlag)}`,
      mode,
      size,
      sha256: createHash('sha256').update(content).digest('hex')
    });
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function decodeTarField(field) {
  const end = field.indexOf(0);
  return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}

function parseTarOctal(field) {
  const value = field.toString('ascii').replace(/\0.*$/u, '').trim();
  assert.match(value, /^[0-7]+$/u);
  return Number.parseInt(value, 8);
}

function digestTree(target) {
  const hash = createHash('sha256');
  visit(target, '.');
  return hash.digest('hex');

  function visit(file, relative) {
    const stats = lstatSync(file);
    const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : stats.isSymbolicLink() ? 'symlink' : 'other';
    hash.update(`${type}\0${relative}\0${stats.mode & 0o777}\0`);
    if (stats.isDirectory()) {
      for (const name of readdirSync(file).sort()) visit(path.join(file, name), path.posix.join(relative, name));
    } else if (stats.isFile()) hash.update(readFileSync(file));
    else if (stats.isSymbolicLink()) hash.update(readlinkSync(file));
    hash.update('\0');
  }
}
