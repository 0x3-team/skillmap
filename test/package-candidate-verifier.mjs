import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

const repo = path.resolve(import.meta.dirname, '..');
const verifier = path.join(repo, 'scripts', 'verify-package-candidate.mjs');
const consumerInstall = path.join(repo, 'scripts', 'test-consumer-install.mjs');

const FORBIDDEN_LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare'
];

const PRIVATE_PREFIX_FILES = [
  'dist/private-report.js',
  'contracts/internal-audit.json',
  'assets/local-app/v1/internal-report.json'
];

const ARCHIVE_PRIVACY_CANARIES = [
  {
    slug: 'pem-private-key',
    label: 'PEM private-key material',
    content: '-----BEGIN PRIVATE KEY-----\nSynthetic fixture bytes only.\n'
  },
  {
    slug: 'github-credential',
    label: 'GitHub credential',
    content: `github_pat_${'A'.repeat(40)}\n`
  },
  {
    slug: 'npm-credential',
    label: 'npm credential',
    content: `npm_${'A'.repeat(36)}\n`
  },
  {
    slug: 'aws-credential',
    label: 'AWS access-key credential',
    content: `AKIA${'A'.repeat(16)}\n`
  },
  {
    slug: 'api-secret',
    label: 'API secret-key credential',
    content: `sk-proj-${'A'.repeat(32)}\n`
  },
  {
    slug: 'stripe-live-credential',
    label: 'Stripe live credential',
    content: `sk_live_${'A'.repeat(24)}\n`
  },
  {
    slug: 'slack-credential',
    label: 'Slack credential',
    content: `xoxb-${'A'.repeat(24)}\n`
  },
  {
    slug: 'google-api-credential',
    label: 'Google API credential',
    content: `AIza${'A'.repeat(35)}\n`
  },
  {
    slug: 'posix-private-home',
    label: 'POSIX private home path',
    content: 'export const value = "/home/privateoperator/skillmap/report.json";\n'
  },
  {
    slug: 'windows-private-home',
    label: 'Windows private home path',
    content: 'export const value = "C:\\Users\\privateoperator\\skillmap\\report.json";\n'
  }
];

test('package candidate verifier binds the real archive entry set, types, modes, and internal package identity', async t => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-candidate-verifier-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const valid = createCandidate(scratch);
  assertVerifierPasses(valid);

  await t.test('rejects symlink-backed SHA256SUMS in verification and write modes', { skip: process.platform === 'win32' }, () => {
    const verifyCandidate = copyCandidate(valid, path.join(scratch, 'digest-symlink-verify'));
    const verifyDigest = path.join(verifyCandidate, 'SHA256SUMS');
    const verifyTarget = path.join(scratch, 'digest-symlink-verify-target');
    writeFileSync(verifyTarget, readFileSync(verifyDigest));
    unlinkSync(verifyDigest);
    symlinkSync(verifyTarget, verifyDigest);
    assertVerifierRejects(verifyCandidate, /SHA256SUMS must be a regular file, not a symbolic link/i);

    const writeCandidate = copyCandidate(valid, path.join(scratch, 'digest-symlink-write'));
    const writeDigest = path.join(writeCandidate, 'SHA256SUMS');
    const writeTarget = path.join(scratch, 'digest-symlink-write-target');
    const sentinel = 'do-not-overwrite\n';
    writeFileSync(writeTarget, sentinel);
    unlinkSync(writeDigest);
    symlinkSync(writeTarget, writeDigest);
    const result = runVerifier(writeCandidate, ['--write']);
    assert.notEqual(result.status, 0, 'write mode unexpectedly followed SHA256SUMS symlink');
    assert.match(verifierOutput(result), /SHA256SUMS must be a regular file, not a symbolic link/i);
    assert.equal(readFileSync(writeTarget, 'utf8'), sentinel);
  });

  await t.test('rejects an internal implementation report even when npm includes it', () => {
    const candidate = createCandidate(scratch, {
      label: 'implementation-report',
      extraFiles: [{ path: '.implementation/private-report.md', content: '# Synthetic private report\n' }]
    });
    assertVerifierRejects(candidate, /outside the exact public package allowlist.*\.implementation/i);
  });

  await t.test('rejects a documentation path outside the exact public-doc allowlist', () => {
    const candidate = createCandidate(scratch, {
      label: 'internal-plan',
      extraFiles: [{ path: 'docs/plans/internal.md', content: '# Synthetic internal plan\n' }]
    });
    assertVerifierRejects(candidate, /exact public-doc allowlist.*docs\/plans\/internal\.md/i);
  });

  for (const privatePath of PRIVATE_PREFIX_FILES) {
    await t.test(`rejects an ordinary private file hidden at ${privatePath}`, () => {
      const candidate = createCandidate(scratch, {
        label: `private-prefix-${privatePath.replaceAll('/', '-')}`,
        extraFiles: [{ path: privatePath, content: '{"classification":"internal"}\n' }]
      });
      assertVerifierRejects(candidate, new RegExp(`exact public package allowlist.*${escapeRegExp(privatePath)}`, 'i'));
    });
  }

  const lifecycleMarker = path.join(scratch, 'lifecycle-execution-canary');
  const lifecycleCommand = 'node -e "require(\'node:fs\').writeFileSync(process.env.SKILLMAP_LIFECYCLE_CANARY, \'executed\')"';
  for (const lifecycle of FORBIDDEN_LIFECYCLE_SCRIPTS) {
    await t.test(`rejects archived package.json lifecycle script ${lifecycle} without executing it`, () => {
      const candidate = createCandidate(scratch, {
        label: `lifecycle-${lifecycle}`,
        packageScripts: { [lifecycle]: lifecycleCommand }
      });
      assert.equal(existsSync(lifecycleMarker), false, `${lifecycle} executed while creating the fixture candidate`);
      assertVerifierRejects(candidate, new RegExp(`automatic install lifecycle script "${lifecycle}"`, 'i'));
      assert.equal(existsSync(lifecycleMarker), false, `${lifecycle} executed while verifying the candidate`);
    });
  }

  await t.test('consumer pre-install gate rejects a lifecycle execution canary before npm install', () => {
    const candidate = createCandidate(scratch, {
      label: 'consumer-lifecycle-execution-canary',
      packageScripts: { preinstall: lifecycleCommand }
    });
    assertConsumerRejects(
      candidate,
      /automatic install lifecycle script "preinstall"/i,
      { SKILLMAP_LIFECYCLE_CANARY: lifecycleMarker }
    );
    assert.equal(existsSync(lifecycleMarker), false, 'consumer lifecycle canary executed before the candidate was rejected');
  });

  await t.test('accepts pack and publish-only hooks without executing them during fixture packaging', () => {
    const candidate = createCandidate(scratch, {
      label: 'pack-publish-only-lifecycle',
      packageScripts: {
        prepack: lifecycleCommand,
        postpack: lifecycleCommand,
        prepublishOnly: lifecycleCommand
      }
    });
    assert.equal(existsSync(lifecycleMarker), false, 'a pack or publish-only lifecycle canary executed while packaging');
    assertVerifierPasses(candidate);
    assert.equal(existsSync(lifecycleMarker), false, 'a pack or publish-only lifecycle canary executed while verifying');
  });

  for (const canary of ARCHIVE_PRIVACY_CANARIES) {
    await t.test(`rejects a ${canary.label} canary in real archive content`, () => {
      const candidate = createCandidate(scratch, {
        label: canary.slug,
        extraFiles: [{ path: 'docs/architecture.md', content: `# Public architecture\n${canary.content}` }]
      });
      assertVerifierRejects(
        candidate,
        new RegExp(`docs/architecture\\.md contains a high-confidence ${escapeRegExp(canary.label)} canary`, 'i')
      );
    });
  }

  await t.test('accepts explicit private-home placeholders in an allowlisted public document', () => {
    const candidate = createCandidate(scratch, {
      label: 'public-path-placeholders',
      extraFiles: [{
        path: 'docs/architecture.md',
        content: '# Public setup examples\n/home/you/.skillmap\n/Users/example/.skillmap\nC:\\Users\\username\\.skillmap\n'
      }]
    });
    assertVerifierPasses(candidate);
  });

  await t.test('consumer-install defense rejects a forbidden installed path', () => {
    const candidate = createCandidate(scratch, {
      label: 'consumer-implementation-report',
      extraFiles: [{ path: '.implementation/private-report.md', content: '# Synthetic private report\n' }]
    });
    assertConsumerRejects(candidate, /outside the exact public package allowlist.*\.implementation/i);
  });

  await t.test('consumer-install defense rejects a credential in installed package bytes', () => {
    const candidate = createCandidate(scratch, {
      label: 'consumer-secret-canary',
      extraFiles: [{ path: 'docs/architecture.md', content: `github_pat_${'A'.repeat(40)}\n` }]
    });
    assertConsumerRejects(candidate, /docs[/\\]architecture\.md contains a high-confidence GitHub credential canary/i);
  });

  await t.test('rejects a manifest that omits a real archive entry', () => {
    const candidate = copyCandidate(valid, path.join(scratch, 'omitted-entry'));
    const manifest = readManifest(candidate);
    const omitted = manifest[0].files.find(entry => entry.path === 'docs/architecture.md');
    assert.ok(omitted);
    manifest[0].files = manifest[0].files.filter(entry => entry.path !== omitted.path);
    manifest[0].entryCount = manifest[0].files.length;
    manifest[0].unpackedSize -= omitted.size;
    writeManifest(candidate, manifest);
    assertVerifierRejects(candidate, /archive entry count|undeclared entry/i);
  });

  await t.test('rejects an external manifest version that differs from archived package.json', () => {
    const candidate = copyCandidate(valid, path.join(scratch, 'version-mismatch'));
    const manifest = readManifest(candidate);
    const previous = path.join(candidate, manifest[0].filename);
    manifest[0].version = '0.1.1';
    manifest[0].id = 'skillmap@0.1.1';
    manifest[0].filename = 'skillmap-0.1.1.tgz';
    const renamed = path.join(candidate, manifest[0].filename);
    renameSync(previous, renamed);
    writeManifest(candidate, manifest);
    writeSha256(candidate, manifest[0].filename, readFileSync(renamed));
    assertVerifierRejects(candidate, /archived package\.json version/i);
  });

  await t.test('rejects a non-regular archive entry hidden behind a regular manifest row', () => {
    const candidate = copyCandidate(valid, path.join(scratch, 'entry-type'));
    mutateArchive(candidate, 'docs/architecture.md', header => { header[156] = '2'.charCodeAt(0); });
    assertVerifierRejects(candidate, /non-regular entry type/i);
  });

  await t.test('rejects an archive mode that differs from the reviewed manifest', { skip: process.platform === 'win32' }, () => {
    const candidate = copyCandidate(valid, path.join(scratch, 'entry-mode'));
    mutateArchive(candidate, 'docs/architecture.md', header => writeTarOctal(header, 100, 8, 0o755));
    assertVerifierRejects(candidate, /archive mode differs/i);
  });
});

test('every candidate, consumer, browser, and global npm install disables lifecycle scripts', () => {
  const harnesses = [
    'scripts/test-consumer-install.mjs',
    'scripts/test-candidate-browser.mjs',
    'scripts/test-package-upgrade-rollback.mjs'
  ];
  for (const relative of harnesses) {
    const source = readFileSync(path.join(repo, relative), 'utf8');
    const installCalls = source.match(/runNpm\(\['install',[^\]]+\]/g) ?? [];
    assert.ok(installCalls.length > 0, `${relative} must contain a reviewed npm install call`);
    for (const call of installCalls) {
      assert.match(call, /'--ignore-scripts'/, `${relative} contains an npm install without --ignore-scripts: ${call}`);
    }
  }
});

test('clean consumer install prefers cache while the dedicated lifecycle gate owns strict offline proof', () => {
  const source = readFileSync(path.join(repo, 'scripts/test-consumer-install.mjs'), 'utf8');
  assert.match(source, /'--prefer-offline'/u);
  assert.doesNotMatch(
    source,
    /runNpm\(\['install',\s*'--ignore-scripts',\s*'--offline'/u,
    'the normal clean-consumer lane must not require a pre-warmed registry metadata cache'
  );

  const lifecycle = readFileSync(path.join(repo, 'test/support/m3-13-package-lifecycle.mjs'), 'utf8');
  assert.match(lifecycle, /npm_config_offline:\s*'true'/u);
  assert.match(lifecycle, /'install',\s*'--global',[\s\S]*?'--offline'/u);
});

function createCandidate(scratch, options = {}) {
  const label = options.label ?? 'valid';
  const source = path.join(scratch, `source-${label}`);
  const candidate = path.join(scratch, `candidate-${label}`);
  const packageScripts = options.packageScripts ? { ...options.packageScripts } : undefined;
  const archivedPrepare = packageScripts?.prepare;
  if (packageScripts) delete packageScripts.prepare;
  mkdirSync(path.join(source, 'dist'), { recursive: true });
  mkdirSync(path.join(source, 'contracts'), { recursive: true });
  mkdirSync(path.join(source, 'assets', 'local-app', 'v1'), { recursive: true });
  mkdirSync(path.join(source, 'docs'), { recursive: true });
  const packageFiles = ['dist', 'contracts', 'assets', 'docs', 'README.md', 'LICENSE'];
  for (const extra of options.extraFiles ?? []) {
    const root = extra.path.split('/')[0];
    if (!packageFiles.includes(root)) packageFiles.push(root);
  }
  write(path.join(source, 'package.json'), `${JSON.stringify({
    name: 'skillmap',
    version: '0.1.0',
    private: false,
    files: packageFiles,
    bin: { skillmap: 'dist/cli.js' },
    ...(packageScripts && Object.keys(packageScripts).length > 0 ? { scripts: packageScripts } : {})
  }, null, 2)}\n`);
  write(path.join(source, 'dist', 'cli.js'), '#!/usr/bin/env node\nprocess.stdout.write("fixture\\n");\n', 0o755);
  write(path.join(source, 'contracts', 'manifest.json'), '{"version":1}\n');
  write(path.join(source, 'assets', 'local-app', 'v1', 'index.html'), '<!doctype html><title>Fixture</title>\n');
  write(path.join(source, 'docs', 'architecture.md'), '# Public architecture\n');
  write(path.join(source, 'README.md'), '# SkillMap fixture\n');
  write(path.join(source, 'LICENSE'), 'Fixture license\n');
  for (const extra of options.extraFiles ?? []) {
    const target = path.join(source, extra.path);
    mkdirSync(path.dirname(target), { recursive: true });
    write(target, extra.content, extra.mode);
  }
  mkdirSync(candidate, { recursive: true });
  const manifest = JSON.parse(runNpm(['pack', '--json', '--silent', '--ignore-scripts', '--pack-destination', candidate], source));
  normalizeSyntheticCliMode(candidate, manifest);
  writeManifest(candidate, manifest);
  if (archivedPrepare !== undefined) injectArchivedPackageScripts(candidate, { prepare: archivedPrepare });
  const result = runVerifier(candidate, ['--write']);
  if (options.label === undefined) assert.equal(result.status, 0, verifierOutput(result));
  return candidate;
}

function normalizeSyntheticCliMode(candidate, manifest) {
  const cli = manifest[0].files.find((entry) => entry.path === 'dist/cli.js');
  assert.ok(cli, 'fixture pack manifest has no dist/cli.js entry');
  if ((cli.mode & 0o777) === 0o755) return;
  const tarball = path.join(candidate, manifest[0].filename);
  const tar = gunzipSync(readFileSync(tarball));
  let offset = 0;
  let found = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const name = tarField(header.subarray(0, 100));
    const prefix = tarField(header.subarray(345, 500));
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarField(header.subarray(124, 136)).trim(), 8);
    if (archivePath === 'package/dist/cli.js') {
      writeTarOctal(header, 100, 8, 0o755);
      writeTarChecksum(header);
      found = true;
      break;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(found, true, 'fixture archive has no package/dist/cli.js');
  cli.mode = (cli.mode & ~0o777) | 0o755;
  const compressed = gzipSync(tar, { level: 9 });
  writeFileSync(tarball, compressed);
  manifest[0].size = compressed.length;
  manifest[0].shasum = digest(compressed, 'sha1', 'hex');
  manifest[0].integrity = `sha512-${digest(compressed, 'sha512', 'base64')}`;
}

function injectArchivedPackageScripts(candidate, scripts) {
  const manifest = readManifest(candidate);
  const tarball = path.join(candidate, manifest[0].filename);
  const tar = gunzipSync(readFileSync(tarball));
  let offset = 0;
  let updatedTar;
  let previousSize;
  let nextSize;
  while (offset + 512 <= tar.length) {
    const sourceHeader = tar.subarray(offset, offset + 512);
    if (sourceHeader.every(value => value === 0)) break;
    const name = tarField(sourceHeader.subarray(0, 100));
    const prefix = tarField(sourceHeader.subarray(345, 500));
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarField(sourceHeader.subarray(124, 136)).trim(), 8);
    const dataStart = offset + 512;
    const nextOffset = dataStart + Math.ceil(size / 512) * 512;
    if (archivePath === 'package/package.json') {
      const packageJson = JSON.parse(tar.subarray(dataStart, dataStart + size).toString('utf8'));
      const replacement = Buffer.from(`${JSON.stringify({
        ...packageJson,
        scripts: { ...(packageJson.scripts ?? {}), ...scripts }
      }, null, 2)}\n`);
      const header = Buffer.from(sourceHeader);
      writeTarOctal(header, 124, 12, replacement.length);
      writeTarChecksum(header);
      const padding = Buffer.alloc(Math.ceil(replacement.length / 512) * 512 - replacement.length);
      updatedTar = Buffer.concat([tar.subarray(0, offset), header, replacement, padding, tar.subarray(nextOffset)]);
      previousSize = size;
      nextSize = replacement.length;
      break;
    }
    offset = nextOffset;
  }
  assert.ok(updatedTar, 'fixture archive has no package/package.json');
  const packageEntry = manifest[0].files.find((entry) => entry.path === 'package.json');
  assert.ok(packageEntry, 'fixture pack manifest has no package.json entry');
  packageEntry.size = nextSize;
  manifest[0].unpackedSize += nextSize - previousSize;
  const compressed = gzipSync(updatedTar, { level: 9 });
  writeFileSync(tarball, compressed);
  manifest[0].size = compressed.length;
  manifest[0].shasum = digest(compressed, 'sha1', 'hex');
  manifest[0].integrity = `sha512-${digest(compressed, 'sha512', 'base64')}`;
  writeManifest(candidate, manifest);
  writeSha256(candidate, manifest[0].filename, compressed);
}

function copyCandidate(source, destination) {
  cpSync(source, destination, { recursive: true, errorOnExist: true });
  return destination;
}

function mutateArchive(candidate, relativePath, mutateHeader) {
  const manifest = readManifest(candidate);
  const tarball = path.join(candidate, manifest[0].filename);
  const tar = gunzipSync(readFileSync(tarball));
  let offset = 0;
  let found = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const name = tarField(header.subarray(0, 100));
    const prefix = tarField(header.subarray(345, 500));
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarField(header.subarray(124, 136)).trim(), 8);
    if (archivePath === `package/${relativePath}`) {
      mutateHeader(header);
      writeTarChecksum(header);
      found = true;
      break;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(found, true, `fixture archive has no ${relativePath}`);
  const compressed = gzipSync(tar, { level: 9 });
  writeFileSync(tarball, compressed);
  manifest[0].size = compressed.length;
  manifest[0].shasum = digest(compressed, 'sha1', 'hex');
  manifest[0].integrity = `sha512-${digest(compressed, 'sha512', 'base64')}`;
  writeManifest(candidate, manifest);
  writeSha256(candidate, manifest[0].filename, compressed);
}

function writeTarChecksum(header) {
  header.fill(32, 148, 156);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const encoded = `${checksum.toString(8).padStart(6, '0')}\0 `;
  header.write(encoded, 148, 8, 'ascii');
}

function writeTarOctal(header, offset, length, value) {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`;
  header.write(encoded, offset, length, 'ascii');
}

function tarField(field) {
  const nul = field.indexOf(0);
  return field.subarray(0, nul >= 0 ? nul : field.length).toString('utf8');
}

function assertVerifierPasses(candidate) {
  const result = runVerifier(candidate);
  assert.equal(result.status, 0, verifierOutput(result));
}

function assertVerifierRejects(candidate, pattern) {
  const result = runVerifier(candidate);
  assert.notEqual(result.status, 0, 'tampered candidate unexpectedly passed verification');
  assert.match(verifierOutput(result), pattern);
}

function assertConsumerRejects(candidate, pattern, extraEnvironment = {}) {
  const manifest = readManifest(candidate);
  const result = spawnSync(process.execPath, [consumerInstall], {
    cwd: repo,
    env: {
      ...process.env,
      ...extraEnvironment,
      SKILLMAP_TEST_TARBALL: path.join(candidate, manifest[0].filename)
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.notEqual(result.status, 0, 'consumer-install defense unexpectedly accepted a private candidate');
  assert.match(verifierOutput(result), pattern);
}

function runVerifier(candidate, extra = []) {
  return spawnSync(process.execPath, [verifier, candidate, ...extra], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function runNpm(args, cwd) {
  const env = { ...process.env, npm_config_dry_run: 'false' };
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'] });
  }
  return execFileSync('npm', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
}

function verifierOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

function readManifest(candidate) {
  return JSON.parse(readFileSync(path.join(candidate, 'pack-manifest.json'), 'utf8'));
}

function writeManifest(candidate, manifest) {
  writeFileSync(path.join(candidate, 'pack-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}

function writeSha256(candidate, filename, bytes) {
  writeFileSync(path.join(candidate, 'SHA256SUMS'), `${digest(bytes, 'sha256', 'hex')}  ${filename}\n`, { mode: 0o644 });
}

function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function write(file, content, mode = 0o644) {
  writeFileSync(file, content, { mode });
  if (process.platform !== 'win32') chmodSync(file, mode);
}
