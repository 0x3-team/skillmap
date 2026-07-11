import assert from 'node:assert/strict';
import { appendFileSync, closeSync, constants, createReadStream, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';
import { gunzipSync } from 'node:zlib';
import {
  findPackagePrivacyCanary,
  packageManifestPolicyError,
  packagePathPolicyError
} from './package-candidate-policy.mjs';

const MAX_TARBALL_BYTES = 10 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_TAR_STREAM_BYTES = MAX_UNPACKED_BYTES + MAX_ARCHIVE_ENTRIES * 1024 + 1024;
const TAR_BLOCK_BYTES = 512;
const MAX_DIGEST_BYTES = 1024;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

const args = process.argv.slice(2);
const writeDigest = args.includes('--write');
const targetArg = args.find(argument => !argument.startsWith('--')) ?? 'artifacts/package';
const target = path.resolve(targetArg);
const targetStats = lstatSync(target);
const exactTarballMode = targetStats.isFile();
assert.equal(targetStats.isDirectory() || exactTarballMode, true, 'candidate target must be a directory or regular .tgz file');
assert.equal(targetStats.isSymbolicLink(), false, 'candidate target must not be a symbolic link');
const directory = exactTarballMode ? path.dirname(target) : target;
const tarballs = exactTarballMode
  ? [path.basename(target)]
  : readdirSync(directory).filter(name => /^skillmap-[0-9A-Za-z.-]+\.tgz$/.test(name)).sort();

assert.equal(tarballs.length, 1, `candidate target must select exactly one SkillMap tarball; found ${tarballs.length}`);
const filename = tarballs[0];
assert.match(filename, /^skillmap-[0-9A-Za-z.-]+\.tgz$/, 'candidate tarball filename must be a versioned SkillMap .tgz');
const tarball = exactTarballMode ? target : path.join(directory, filename);
const tarballStats = lstatSync(tarball);
assert.equal(tarballStats.isFile(), true, 'candidate tarball must be a regular file');
assert.equal(tarballStats.size > 0 && tarballStats.size <= MAX_TARBALL_BYTES, true, 'candidate tarball must be non-empty and at most 10 MiB');

const manifestPath = path.join(directory, 'pack-manifest.json');
assert.equal(existsSync(manifestPath), true, 'candidate pack-manifest.json is required');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(Array.isArray(manifest), true, 'pack manifest must be the JSON array emitted by npm pack --json');
assert.equal(manifest.length, 1, 'pack manifest must describe exactly one package');
assert.equal(manifest[0].name, 'skillmap', 'pack manifest must describe the SkillMap package');
assert.match(manifest[0].version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'pack manifest must include a supported semantic version');
assert.equal(filename, `skillmap-${manifest[0].version}.tgz`, 'candidate filename must match the pack manifest version');
assert.equal(manifest[0].filename, filename, 'pack manifest filename must match the retained tarball');
assert.equal(manifest[0].size, tarballStats.size, 'pack manifest size must match the retained tarball');
assert.ok(Array.isArray(manifest[0].files) && manifest[0].files.length > 0, 'pack manifest must include package entries');
assert.equal(Number.isSafeInteger(manifest[0].entryCount), true, 'pack manifest entryCount must be a safe integer');
assert.equal(manifest[0].entryCount, manifest[0].files.length, 'pack manifest entryCount must match its file list');
assert.equal(Number.isSafeInteger(manifest[0].unpackedSize) && manifest[0].unpackedSize >= 0 && manifest[0].unpackedSize <= MAX_UNPACKED_BYTES, true, 'pack manifest unpackedSize must be at most 64 MiB');
assert.equal(manifest[0].files.length <= MAX_ARCHIVE_ENTRIES, true, `pack manifest may contain at most ${MAX_ARCHIVE_ENTRIES} entries`);

const requiredEntries = [
  'package.json',
  'README.md',
  'LICENSE',
  'dist/cli.js',
  'contracts/manifest.json',
  'assets/local-app/v1/index.html'
];
const packedPaths = new Set(manifest[0].files.map(entry => entry.path));
assert.equal(packedPaths.size, manifest[0].files.length, 'pack manifest must not contain duplicate entry paths');
assert.equal(new Set([...packedPaths].map(entry => entry.toLowerCase())).size, packedPaths.size, 'pack manifest paths must not collide on case-insensitive filesystems');
for (const required of requiredEntries) assert.equal(packedPaths.has(required), true, `candidate package is missing ${required}`);

let declaredUnpackedBytes = 0;
for (const entry of manifest[0].files) {
  assert.equal(typeof entry.path, 'string', 'pack manifest entry path must be a string');
  assert.equal(entry.path.length > 0 && entry.path === entry.path.normalize('NFC') && !entry.path.includes('\\'), true, `pack entry must be a normalized POSIX path: ${entry.path}`);
  assert.equal(path.posix.isAbsolute(entry.path) || path.win32.isAbsolute(entry.path), false, `pack entry must be relative: ${entry.path}`);
  assert.equal(entry.path.split(/[\\/]/).includes('..'), false, `pack entry must not traverse: ${entry.path}`);
  assert.equal(packagePathPolicyError(entry.path), null, packagePathPolicyError(entry.path) ?? undefined);
  assert.equal(Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_UNPACKED_BYTES, true, `pack entry has an invalid size: ${entry.path}`);
  assert.equal(Number.isSafeInteger(entry.mode), true, `pack entry has an invalid mode: ${entry.path}`);
  const expectedMode = entry.path === 'dist/cli.js' ? 0o755 : 0o644;
  assert.equal(entry.mode & 0o777, expectedMode, `pack entry mode must be ${expectedMode.toString(8)}: ${entry.path}`);
  declaredUnpackedBytes += entry.size;
  assert.equal(Number.isSafeInteger(declaredUnpackedBytes) && declaredUnpackedBytes <= MAX_UNPACKED_BYTES, true, 'pack manifest file sizes exceed the unpacked byte limit');
}
assert.equal(manifest[0].unpackedSize, declaredUnpackedBytes, 'pack manifest unpackedSize must equal the sum of declared file sizes');

const [digest, npmShasum, npmIntegrityDigest] = await Promise.all([
  digestFile(tarball, 'sha256', 'hex'),
  digestFile(tarball, 'sha1', 'hex'),
  digestFile(tarball, 'sha512', 'base64')
]);
assert.equal(manifest[0].shasum, npmShasum, 'pack manifest shasum must bind to the retained tarball bytes');
assert.equal(manifest[0].integrity, `sha512-${npmIntegrityDigest}`, 'pack manifest integrity must bind to the retained tarball bytes');
const digestPath = path.join(directory, 'SHA256SUMS');
const canonicalDigestLine = `${digest}  ${filename}\n`;
if (writeDigest) writeDigestEvidence(digestPath, canonicalDigestLine);
assert.equal(readDigestEvidence(digestPath), canonicalDigestLine, 'candidate SHA256SUMS must exactly match the retained tarball');

const archive = inspectNpmArchive(tarball);
assert.equal(packageManifestPolicyError(archive.packageManifest), null, packageManifestPolicyError(archive.packageManifest) ?? undefined);
assert.equal(archive.entries.length, manifest[0].files.length, 'candidate archive entry count must match the pack manifest');
assert.equal(archive.totalBytes, manifest[0].unpackedSize, 'candidate archive unpacked bytes must match the pack manifest');
const archiveEntries = new Map(archive.entries.map(entry => [entry.path, entry]));
assert.equal(archiveEntries.size, archive.entries.length, 'candidate archive must not contain duplicate paths');
for (const entry of manifest[0].files) {
  const archived = archiveEntries.get(entry.path);
  assert.ok(archived, `candidate archive contains no file declared by the pack manifest: ${entry.path}`);
  assert.equal(archived.type, 'file', `candidate archive entry must be a regular file: ${entry.path}`);
  assert.equal(archived.size, entry.size, `candidate archive size differs from the pack manifest: ${entry.path}`);
  assert.equal(archived.mode, entry.mode & 0o777, `candidate archive mode differs from the pack manifest: ${entry.path}`);
}
for (const entry of archive.entries) {
  assert.equal(packedPaths.has(entry.path), true, `candidate archive contains an undeclared entry: ${entry.path}`);
}
assert.equal(archive.packageManifest.name, manifest[0].name, 'archived package.json name must match the pack manifest');
assert.equal(archive.packageManifest.version, manifest[0].version, 'archived package.json version must match the pack manifest');

if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `SKILLMAP_TEST_TARBALL=${tarball}\n`, 'utf8');
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `tarball=${tarball}\nsha256=${digest}\nfilename=${filename}\n`, 'utf8');
}

process.stdout.write(`${JSON.stringify({ tarball, filename, sha256: digest, bytes: tarballStats.size })}\n`);

function digestFile(file, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest(encoding)));
  });
}

function writeDigestEvidence(file, value) {
  const existing = lstatSync(file, { throwIfNoEntry: false });
  if (existing) assert.equal(existing.isFile() && !existing.isSymbolicLink(), true, 'candidate SHA256SUMS must be a regular file, not a symbolic link');
  const flags = constants.O_WRONLY | constants.O_TRUNC | O_NOFOLLOW
    | (existing ? 0 : constants.O_CREAT | constants.O_EXCL);
  const fd = openSync(file, flags, 0o644);
  try { writeFileSync(fd, value, { encoding: 'utf8' }); }
  finally { closeSync(fd); }
}

function readDigestEvidence(file) {
  const pathStats = lstatSync(file, { throwIfNoEntry: false });
  assert.equal(Boolean(pathStats?.isFile() && !pathStats.isSymbolicLink()), true, 'candidate SHA256SUMS must be a regular file, not a symbolic link');
  assert.equal(pathStats.size > 0 && pathStats.size <= MAX_DIGEST_BYTES, true, 'candidate SHA256SUMS must be non-empty and at most 1 KiB');
  const fd = openSync(file, constants.O_RDONLY | O_NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    assert.equal(stats.isFile() && stats.size === pathStats.size, true, 'candidate SHA256SUMS changed while it was read');
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}

function inspectNpmArchive(file) {
  const compressed = readFileSync(file);
  assert.equal(compressed.length >= 18, true, 'candidate tarball is too short to be a valid gzip archive');
  assert.deepEqual([...compressed.subarray(0, 3)], [0x1f, 0x8b, 0x08], 'candidate tarball must use gzip deflate framing');
  assert.equal(compressed[3], 0, 'candidate gzip container must not carry optional filename, comment, extra-field, or header-CRC metadata');
  let bytes;
  try {
    bytes = gunzipSync(compressed, { maxOutputLength: MAX_TAR_STREAM_BYTES });
  } catch (error) {
    throw new assert.AssertionError({ message: `candidate tarball is not a bounded valid gzip archive: ${error instanceof Error ? error.message : String(error)}` });
  }
  const entries = [];
  const seen = new Set();
  let totalBytes = 0;
  let packageManifestBytes;
  let offset = 0;
  let terminated = false;
  while (offset + TAR_BLOCK_BYTES <= bytes.length) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (isZeroBlock(header)) {
      assert.equal(offset + TAR_BLOCK_BYTES * 2 <= bytes.length, true, 'candidate tar archive is missing its second zero terminator block');
      assert.equal(isZeroBlock(bytes.subarray(offset + TAR_BLOCK_BYTES, offset + TAR_BLOCK_BYTES * 2)), true, 'candidate tar archive has an invalid terminator');
      assert.equal(bytes.subarray(offset + TAR_BLOCK_BYTES * 2).every(value => value === 0), true, 'candidate tar archive contains data after its terminator');
      terminated = true;
      break;
    }
    assert.equal(entries.length < MAX_ARCHIVE_ENTRIES, true, `candidate archive may contain at most ${MAX_ARCHIVE_ENTRIES} entries`);
    assertTarChecksum(header);
    assertNoPrivacyCanary(header, 'candidate tar header');
    const magic = decodeTarField(header.subarray(257, 263));
    assert.equal(magic, 'ustar', 'candidate archive entry must use the bounded ustar format');
    const typeFlag = header[156];
    assert.equal(typeFlag === 0 || typeFlag === 48, true, `candidate archive contains a non-regular entry type: ${String.fromCharCode(typeFlag || 0)}`);
    assert.equal(decodeTarField(header.subarray(157, 257)), '', 'candidate archive regular file must not contain a link target');
    const name = decodeTarField(header.subarray(0, 100));
    const prefix = decodeTarField(header.subarray(345, 500));
    const archivePath = prefix ? `${prefix}/${name}` : name;
    assert.equal(archivePath.startsWith('package/'), true, `candidate archive entry is outside its package root: ${archivePath}`);
    const relative = archivePath.slice('package/'.length);
    assertSafeArchivePath(relative);
    assert.equal(packagePathPolicyError(relative), null, packagePathPolicyError(relative) ?? undefined);
    assert.equal(seen.has(relative), false, `candidate archive contains a duplicate path: ${relative}`);
    seen.add(relative);
    const mode = parseTarOctal(header.subarray(100, 108), `mode for ${relative}`) & 0o777;
    const size = parseTarOctal(header.subarray(124, 136), `size for ${relative}`);
    assert.equal(Number.isSafeInteger(size) && size >= 0 && size <= MAX_UNPACKED_BYTES, true, `candidate archive entry has an invalid size: ${relative}`);
    const contentStart = offset + TAR_BLOCK_BYTES;
    const contentEnd = contentStart + size;
    assert.equal(contentEnd <= bytes.length, true, `candidate archive entry is truncated: ${relative}`);
    const content = bytes.subarray(contentStart, contentEnd);
    assertNoPrivacyCanary(content, `candidate archive entry ${relative}`);
    totalBytes += size;
    assert.equal(Number.isSafeInteger(totalBytes) && totalBytes <= MAX_UNPACKED_BYTES, true, 'candidate archive exceeds the unpacked byte limit');
    if (relative === 'package.json') packageManifestBytes = Buffer.from(content);
    entries.push({ path: relative, type: 'file', mode, size });
    const paddedEnd = contentStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    assert.equal(bytes.subarray(contentEnd, paddedEnd).every(value => value === 0), true, `candidate archive entry has non-zero hidden padding bytes: ${relative}`);
    offset = paddedEnd;
  }
  assert.equal(terminated, true, 'candidate tar archive has no canonical two-block terminator');
  assert.equal(new Set(entries.map(entry => entry.path.toLowerCase())).size, entries.length, 'candidate archive paths collide on case-insensitive filesystems');
  assert.ok(packageManifestBytes, 'candidate archive is missing package/package.json');
  let packageManifest;
  try {
    packageManifest = JSON.parse(UTF8.decode(packageManifestBytes));
  } catch (error) {
    throw new assert.AssertionError({ message: `archived package.json is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}` });
  }
  assert.equal(Boolean(packageManifest && typeof packageManifest === 'object' && !Array.isArray(packageManifest)), true, 'archived package.json must be an object');
  return { entries, totalBytes, packageManifest };
}

function assertSafeArchivePath(value) {
  assert.equal(value.length > 0 && value === value.normalize('NFC') && !value.includes('\\') && !value.includes('\0'), true, `candidate archive path is invalid: ${value}`);
  assert.equal(path.posix.isAbsolute(value) || path.win32.isAbsolute(value), false, `candidate archive path must be relative: ${value}`);
  const segments = value.split('/');
  assert.equal(segments.every(segment => segment && segment !== '.' && segment !== '..'), true, `candidate archive path traverses its package root: ${value}`);
  assert.equal(path.posix.normalize(value), value, `candidate archive path is not normalized: ${value}`);
}

function assertTarChecksum(header) {
  const expected = parseTarOctal(header.subarray(148, 156), 'header checksum');
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) actual += index >= 148 && index < 156 ? 32 : header[index];
  assert.equal(actual, expected, 'candidate tar archive header checksum does not validate');
}

function parseTarOctal(field, label) {
  assert.equal((field[0] & 0x80) === 0, true, `candidate tar archive uses an unsupported base-256 ${label}`);
  const value = field.toString('ascii').replace(/\0.*$/s, '').trim();
  assert.match(value, /^[0-7]+$/, `candidate tar archive has an invalid ${label}`);
  const parsed = Number.parseInt(value, 8);
  assert.equal(Number.isSafeInteger(parsed), true, `candidate tar archive has an unsafe ${label}`);
  return parsed;
}

function decodeTarField(field) {
  const nul = field.indexOf(0);
  const bytes = nul >= 0 ? field.subarray(0, nul) : field;
  return UTF8.decode(bytes);
}

function isZeroBlock(block) {
  return block.length === TAR_BLOCK_BYTES && block.every(value => value === 0);
}

function assertNoPrivacyCanary(bytes, location) {
  const canary = findPackagePrivacyCanary(bytes);
  assert.equal(canary, null, `${location} contains a high-confidence ${canary ?? 'privacy'} canary`);
}
