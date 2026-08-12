import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { constants as FS, chmodSync, closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RECEIPT_SCHEMA, RECEIPT_OUTCOMES, RENDEZVOUS_PATH, ROWS, assertNoSensitiveOutput,
  authorityManifestBytes, bootAuditSessionDigest, canonicalJson, candidateManifestDigest,
  dryRunDecision, locatorDigest, orderCandidates, pairFingerprint, rendezvousBytes,
  sha256, userContextDigest, validateCandidate, validateInventory, validateReceiptRedaction,
  validateRendezvousContent, assertAllowlistDelta, assertExpectedHashMap,
  EXPECTED_ACTIVE_PREDECESSORS, EXPECTED_HISTORICAL_CAPABILITY,
  EXPECTED_HISTORICAL_GATE_ANCHORS, EXPECTED_OLD_RECEIPT_SHA256,
  EXPECTED_STATUS_BASELINE_SHA256, EXPECTED_BASELINE_FILE_SHA256, WRITE_ALLOWLIST,
} from '../test/support/m3-03-dp-keychain-failure-recovery.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'test/fixtures/m3-03-dp-keychain-failure-recovery/ResidueRecovery.swift');
const RECEIPT = join(ROOT, 'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-adhoc-dry-run-receipt.json');
const TIMEOUT_MS = 45_000;
const MAX_OUTPUT = 64 * 1024;
const SAFE_ENV = Object.freeze({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' });
const PLAN = join(ROOT, 'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-plan.md');
const AMENDMENT = join(ROOT, 'docs/plans/evidence/M3.03-ad-hoc-no-profile-keychain-gate-amendment.md');
const ARCHITECTURE = join(ROOT, 'docs/plans/evidence/M3.03-1password-cloudflare-architecture-amendment.md');
const MASTER_PLAN = '/Users/stevmq/Documents/skillmap/docs/plans/2026-08-10-skillmap-m3-device-connector-implementation-plan.md';
const HISTORICAL = Object.freeze([
  'test/fixtures/m3-03-dp-keychain-no-profile-capability/CapabilityProbe.swift',
  'test/support/m3-03-dp-keychain-no-profile-capability.mjs',
  'scripts/m3-03-dp-keychain-no-profile-capability.mjs',
  'test/m3-03-dp-keychain-no-profile-capability.mjs',
  'docs/plans/evidence/M3.03-dp-keychain-no-profile-capability-receipt.json',
]);
const IMPLEMENTATION = Object.freeze([
  'test/fixtures/m3-03-dp-keychain-failure-recovery/ResidueRecovery.swift',
  'test/support/m3-03-dp-keychain-failure-recovery.mjs',
  'scripts/m3-03-dp-keychain-failure-recovery.mjs',
  'test/m3-03-dp-keychain-failure-recovery.mjs',
]);

function shaFile(path) { return sha256(readFileSync(path)); }
function safeCommand(file, args, timeout = 10_000) {
  const result = spawnSync(file, args, { cwd: ROOT, env: SAFE_ENV, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  return result.status === 0 ? String(result.stdout ?? '').trim() : '';
}
function fileSha(path) { return shaFile(path); }
function gitStatusBytes() {
  const result = spawnSync('/usr/bin/git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: ROOT, env: SAFE_ENV, encoding: 'buffer', timeout: 10_000 });
  if (result.status !== 0) throw new Error('git_status_failed');
  return result.stdout;
}
function gitStatusDigest() {
  return sha256(gitStatusBytes());
}
function targetFacts() {
  const uid = Number(safeCommand('/usr/bin/id', ['-u']));
  const realUid = Number(safeCommand('/usr/bin/id', ['-ru']));
  return { platform: process.platform, architecture: safeCommand('/usr/bin/uname', ['-m']), os_product_version: safeCommand('/usr/bin/sw_vers', ['-productVersion']), os_build: safeCommand('/usr/bin/sw_vers', ['-buildVersion']), real_uid: realUid, effective_uid: uid, non_root: realUid > 0 && uid > 0, uid_equal: realUid === uid };
}
export function assertFrozenInputs({ statusBytes = null, currentContentOverride = null } = {}) {
  const active = {
    [MASTER_PLAN]: fileSha(MASTER_PLAN),
    'docs/plans/evidence/M3.03-ad-hoc-no-profile-keychain-gate-amendment.md': fileSha(AMENDMENT),
    'docs/plans/evidence/M3.03-1password-cloudflare-architecture-amendment.md': fileSha(ARCHITECTURE),
    'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-plan.md': fileSha(PLAN),
  };
  assertExpectedHashMap(active, EXPECTED_ACTIVE_PREDECESSORS, 'active predecessor');
  const historical = Object.fromEntries(HISTORICAL.map((path) => [path, fileSha(join(ROOT, path))]));
  assertExpectedHashMap(historical, EXPECTED_HISTORICAL_CAPABILITY, 'historical capability');
  const anchors = Object.fromEntries(Object.keys(EXPECTED_HISTORICAL_GATE_ANCHORS).map((path) => [path, fileSha(join(ROOT, path))]));
  assertExpectedHashMap(anchors, EXPECTED_HISTORICAL_GATE_ANCHORS, 'historical gate anchor');
  if (fileSha(join(ROOT, 'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-dry-run-receipt.json')) !== EXPECTED_OLD_RECEIPT_SHA256) throw new Error('historical blocked receipt mismatch');
  const status = statusBytes ?? gitStatusBytes();
  if (sha256(status) !== EXPECTED_STATUS_BASELINE_SHA256) throw new Error('frozen NUL-safe baseline mismatch');
  const currentContent = currentContentOverride ?? Object.fromEntries(status.toString('utf8').split('\0').filter(Boolean).map((entry) => entry.slice(3)).map((path) => [path, fileSha(join(ROOT, path))]));
  assertAllowlistDelta(EXPECTED_BASELINE_FILE_SHA256, currentContent, WRITE_ALLOWLIST.slice(0, 4));
  if (Object.prototype.hasOwnProperty.call(currentContent, WRITE_ALLOWLIST[4])) throw new Error('path5 is outside this four-path rework');
  return { active, historical, anchors, status, baseline: EXPECTED_BASELINE_FILE_SHA256, current: currentContent };
}
function metadata(path, expectedMode, expectedType = 'file') {
  const stat = statSync(path, { bigint: false });
  const mode = stat.mode & 0o777;
  if (expectedType === 'file' && !stat.isFile()) throw new Error('artifact_type');
  if (expectedType === 'directory' && !stat.isDirectory()) throw new Error('artifact_type');
  if (stat.uid !== process.getuid() || mode !== expectedMode || (expectedType === 'file' ? stat.nlink !== 1 : stat.nlink < 2)) throw new Error('artifact_metadata');
  return { device: stat.dev, inode: stat.ino, owner_uid: stat.uid, mode: `0${mode.toString(8)}`, type: expectedType, link_count: stat.nlink };
}
function fsyncDirectory(path) {
  const fd = openSync(path, FS.O_RDONLY | FS.O_DIRECTORY | FS.O_NOFOLLOW);
  try {
    try { fsyncSync(fd); return 'fsynced'; } catch (error) {
      if (error?.code === 'EINVAL' || error?.code === 'ENOTSUP') return 'parent_fsync_unsupported';
      throw error;
    }
  } finally { closeSync(fd); }
}
function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (!written) throw new Error('short_write');
    offset += written;
  }
}
function protectedFile(path, bytes, mode = 0o600) {
  const fd = openSync(path, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, mode);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.uid !== process.getuid() || (before.mode & 0o777) !== mode || before.nlink !== 1) throw new Error('protected_file_metadata');
    writeAll(fd, bytes);
    fsyncSync(fd);
    const after = fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || !after.isFile() || after.uid !== process.getuid() || (after.mode & 0o777) !== mode || after.nlink !== 1) throw new Error('protected_file_drift');
    return { device: after.dev, inode: after.ino, owner_uid: after.uid, mode: `0${(after.mode & 0o777).toString(8)}`, type: 'file', link_count: after.nlink, fsync: 'fsynced' };
  } finally { closeSync(fd); }
}
function createRendezvous(runRecordPath) {
  const parent = inspectTmpParent();
  const bytes = rendezvousBytes(runRecordPath);
  const fd = openSync(RENDEZVOUS_PATH, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, 0o600);
  let before;
  try {
    before = fstatSync(fd);
    if (!before.isFile() || before.uid !== process.getuid() || (before.mode & 0o777) !== 0o600 || before.nlink !== 1) throw new Error('rendezvous_metadata');
    writeAll(fd, bytes);
    fsyncSync(fd);
    const after = fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || !after.isFile() || after.uid !== process.getuid() || (after.mode & 0o777) !== 0o600 || after.nlink !== 1) throw new Error('rendezvous_drift');
    // Node's positional read is the same-fd equivalent of lseek(fd, 0, SEEK_SET) followed by read.
    const readBack = Buffer.alloc(bytes.length);
    if (readSync(fd, readBack, 0, bytes.length, 0) !== bytes.length || !readBack.equals(bytes) || validateRendezvousContent(readBack) !== runRecordPath) throw new Error('rendezvous_readback');
    const extra = Buffer.alloc(1);
    if (readSync(fd, extra, 0, 1, bytes.length) !== 0) throw new Error('rendezvous_extra_bytes');
    const parentFsync = fsyncDirectory('/private/tmp');
    return { path: RENDEZVOUS_PATH, created: true, verified: true, parent, metadata: { device: after.dev, inode: after.ino, owner_uid: after.uid, mode: '0600', type: 'file', link_count: after.nlink }, byte_sha256: sha256(bytes), run_record_locator_sha256: locatorDigest(runRecordPath), fsync: 'fsynced', parent_fsync: parentFsync, retained: true };
  } finally { closeSync(fd); }
}
function createReceipt(path, value) {
  const bytes = Buffer.from(canonicalJson(value), 'utf8');
  const fd = openSync(path, FS.O_RDWR | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW, 0o600);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.uid !== process.getuid() || (before.mode & 0o777) !== 0o600 || before.nlink !== 1) throw new Error('receipt_metadata');
    writeAll(fd, bytes);
    fsyncSync(fd);
    // Node's positional read is the same-fd equivalent of lseek(fd, 0, SEEK_SET) followed by read.
    const readBack = Buffer.alloc(bytes.length);
    const exact = readSync(fd, readBack, 0, bytes.length, 0);
    if (exact !== bytes.length || !readBack.equals(bytes)) throw new Error('receipt_readback');
    const extra = Buffer.alloc(1);
    if (readSync(fd, extra, 0, 1, bytes.length) !== 0) throw new Error('receipt_extra_bytes');
    const after = fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || !after.isFile() || after.uid !== process.getuid() || (after.mode & 0o777) !== 0o600 || after.nlink !== 1) throw new Error('receipt_drift');
    return { bytes, metadata: { device: after.dev, inode: after.ino, owner_uid: after.uid, mode: '0600', type: 'file', link_count: after.nlink }, fsync: 'fsynced', readback: true };
  } finally { closeSync(fd); }
}
function runChild(file, args, env) {
  return new Promise((resolveResult) => {
    const child = spawn(file, args, { cwd: ROOT, env: { ...SAFE_ENV, ...env }, shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let oversized = false; let timedOut = false; let closed = false;
    const append = (target, chunk) => {
      if (stdout.length + stderr.length + chunk.length > MAX_OUTPUT) oversized = true;
      const remaining = Math.max(0, MAX_OUTPUT - stdout.length - stderr.length);
      const kept = chunk.subarray(0, remaining);
      if (target === 'stdout') stdout = Buffer.concat([stdout, kept]); else stderr = Buffer.concat([stderr, kept]);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    const timer = setTimeout(() => { if (!closed) { timedOut = true; child.kill('SIGTERM'); setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 250); } }, TIMEOUT_MS);
    child.once('error', (error) => { clearTimeout(timer); closed = true; resolveResult({ ok: false, missing: error.code === 'ENOENT', exit: null, signal: null, timed_out: timedOut, oversized, stdout: '', stderr: '', stdout_digest: sha256(stdout), stderr_digest: sha256(stderr) }); });
    child.once('close', (exit, signal) => { clearTimeout(timer); closed = true; resolveResult({ ok: !timedOut && !oversized && exit === 0 && signal === null, missing: false, exit, signal, timed_out: timedOut, oversized, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), stdout_digest: sha256(stdout), stderr_digest: sha256(stderr) }); });
  });
}
function parseNative(result) {
  if (!result.ok || result.timed_out || result.oversized || result.stderr !== '' || result.stdout.trim() === '') return null;
  try { const parsed = JSON.parse(result.stdout); assertNoSensitiveOutput(result.stdout); return parsed; } catch { return null; }
}
function signatureEvidence(path) {
  const display = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', path], { env: SAFE_ENV, encoding: 'utf8', timeout: 10_000 });
  const entitlements = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', path], { env: SAFE_ENV, encoding: 'utf8', timeout: 10_000 });
  const displayText = `${display.stdout ?? ''}${display.stderr ?? ''}`;
  const entitlementText = `${entitlements.stdout ?? ''}${entitlements.stderr ?? ''}`;
  const bytes = readFileSync(path);
  const profile = ['embedded.mobileprovision', 'ProvisionedDevice', 'application-identifier', 'keychain-access-groups'].find((marker) => bytes.includes(Buffer.from(marker))) ?? null;
  const mode = statSync(path).mode & 0o777;
  const team = displayText.match(/^TeamIdentifier=([^\r\n]+)/mu)?.[1]?.trim() ?? null;
  const displayParses = display.status === 0 && !display.error && /Signature=adhoc/u.test(displayText) && /CodeDirectory/u.test(displayText);
  const entitlementsParse = entitlements.status === 0 && !entitlements.error && !/<plist|<dict|application-identifier|keychain-access-groups/u.test(entitlementText);
  const evidenceCommandsOk = displayParses && entitlementsParse;
  const noTeamIdentifier = evidenceCommandsOk && (team === null || team === 'not set');
  return { state: displayParses ? 'adhoc' : 'unexpected', identity: displayParses ? 'adhoc' : 'unexpected', no_team_identifier: noTeamIdentifier, entitlements_present: !entitlementsParse, provisioning_profile_marker: profile, mode: `0${mode.toString(8)}`, display_digest: sha256(displayText.replace(/Executable=[^\r\n]+/u, 'Executable=<retained-binary>')), evidence_commands_ok: evidenceCommandsOk, signature_display_parses: displayParses, entitlement_evidence_parses: entitlementsParse };
}
function compileAdhoc(runDirectory) {
  const binary = join(runDirectory, 'recovery-adhoc');
  const result = spawnSync('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'Foundation', '-framework', 'Security', '-framework', 'LocalAuthentication', '-framework', 'CryptoKit', '-lbsm', SOURCE, '-o', binary], { cwd: ROOT, env: SAFE_ENV, encoding: 'utf8', timeout: TIMEOUT_MS });
  if (result.status !== 0 || result.error || result.stderr !== '') throw new Error('compile_failed');
  chmodSync(binary, 0o755);
  const sign = spawnSync('/usr/bin/codesign', ['--force', '-s', '-', '--timestamp=none', binary], { cwd: ROOT, env: SAFE_ENV, encoding: 'utf8', timeout: 10_000 });
  if (sign.status !== 0 || sign.error) throw new Error('adhoc_sign_failed');
  chmodSync(binary, 0o755);
  const signature = signatureEvidence(binary);
  if (signature.state !== 'adhoc' || !signature.evidence_commands_ok || !signature.no_team_identifier || signature.entitlements_present || signature.provisioning_profile_marker || signature.mode !== '0755') throw new Error('signature_preflight_failed');
  const binaryFd = openSync(binary, FS.O_RDONLY | FS.O_NOFOLLOW);
  try { fsyncSync(binaryFd); } finally { closeSync(binaryFd); }
  const final = metadata(binary, 0o755);
  return { leaf: 'recovery-adhoc', sha256: fileSha(binary), mode: final.mode, signature, explicit_ad_hoc_signing: true, unsigned_execution_attempted: false, source_sha256: fileSha(SOURCE) };
}
export function readBoundedNoFollow(path, maxBytes = 4096, expectedMode = 0o600) {
  const fd = openSync(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.uid !== process.getuid() || (before.mode & 0o777) !== expectedMode || before.nlink !== 1 || before.size > maxBytes) throw new Error('bounded_file_metadata');
    // Node's positional read is the same-fd equivalent of lseek(fd, 0, SEEK_SET) followed by read.
    const bytes = Buffer.alloc(before.size);
    if (readSync(fd, bytes, 0, before.size, 0) !== before.size) throw new Error('bounded_file_short_read');
    const extra = Buffer.alloc(1);
    if (readSync(fd, extra, 0, 1, before.size) !== 0) throw new Error('bounded_file_extra_bytes');
    const after = fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || !after.isFile() || after.uid !== process.getuid() || (after.mode & 0o777) !== expectedMode || after.nlink !== 1 || after.size !== before.size) throw new Error('bounded_file_drift');
    return { bytes, metadata: { device: after.dev, inode: after.ino, owner_uid: after.uid, mode: `0${(after.mode & 0o777).toString(8)}`, type: 'file', link_count: after.nlink, size: after.size }, sha256: sha256(bytes) };
  } finally { closeSync(fd); }
}
function parseCandidateBytes(bytes, row) {
  if (bytes.length === 0) return [];
  const fields = bytes.toString('utf8').split('\0');
  if (fields.at(-1) !== '') throw new Error('candidate_manifest_trailing_bytes');
  fields.pop();
  if (fields.length !== 5 || fields[0] !== row) throw new Error('candidate_manifest_shape');
  const candidate = { row: fields[0], service: fields[1], account: fields[2], access_group_kind: fields[3], access_group_value: fields[4], accessible: 'kSecAttrAccessibleWhenUnlockedThisDeviceOnly', synchronizable: false };
  validateCandidate(candidate);
  return [candidate];
}
export function readCandidate(path, row) {
  return parseCandidateBytes(readBoundedNoFollow(path).bytes, row);
}
function clocks() {
  const wall = BigInt(Date.now()) * 1_000_000n;
  const monotonic = process.hrtime.bigint();
  return { observed_at_wall_ns: wall.toString(), expires_at_wall_ns: (wall + 900_000_000_000n).toString(), observed_at_monotonic_ns: monotonic.toString(), expires_at_monotonic_ns: (monotonic + 900_000_000_000n).toString() };
}
function processEvidence(result, row, phase) {
  return { row, phase, process: { ok: result.ok, exit: result.exit, signal: result.signal, timed_out: result.timed_out, oversized: result.oversized, stdout_digest: result.stdout_digest, stderr_digest: result.stderr_digest } };
}
function predecessorHashes() {
  const map = { [MASTER_PLAN]: shaFile(MASTER_PLAN), [AMENDMENT]: shaFile(AMENDMENT), [ARCHITECTURE]: shaFile(ARCHITECTURE), [PLAN]: shaFile(PLAN) };
  return map;
}
function historicalHashes() { return Object.fromEntries(HISTORICAL.map((path) => [path, fileSha(join(ROOT, path))])); }
function implementationHashes() { return Object.fromEntries(IMPLEMENTATION.map((path) => [path, fileSha(join(ROOT, path))])); }

function inspectPath5() {
  try {
    const inspected = readBoundedNoFollow(RECEIPT, 512 * 1024, 0o600);
    let canonical = false;
    try {
      const parsed = JSON.parse(inspected.bytes.toString('utf8'));
      canonical = canonicalJson(parsed) === inspected.bytes.toString('utf8') && parsed.schema === RECEIPT_SCHEMA && parsed.outcome === 'ADHOC_DRY_RUN_PRE_BUNDLE_BLOCKED';
      if (canonical) validateReceiptRedaction(parsed);
    } catch { canonical = false; }
    return { present: true, valid_canonical: canonical, sha256: inspected.sha256, metadata: inspected.metadata, fsync_evidence: false, execution_review_allowed: false };
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, valid_canonical: false, execution_review_allowed: false };
    return { present: true, valid_canonical: false, execution_review_allowed: false, blocked_reason: error?.code === 'ELOOP' ? 'path5_symlink_or_no_follow_failure' : 'path5_static_validation_failed' };
  }
}

function inspectReachablePartials(runRecordPath) {
  const directoryPath = runRecordPath.slice(0, runRecordPath.lastIndexOf('/'));
  const directoryFd = openSync(directoryPath, FS.O_RDONLY | FS.O_DIRECTORY | FS.O_NOFOLLOW);
  let directoryMetadata;
  try {
    const stat = fstatSync(directoryFd);
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || stat.nlink < 2) throw new Error('run_directory_metadata');
    directoryMetadata = { device: stat.dev, inode: stat.ino, owner_uid: stat.uid, mode: '0700', type: 'directory', link_count: stat.nlink };
  } finally { closeSync(directoryFd); }
  const allowedLeaves = new Set(['run-record.json', 'recovery-adhoc', 'authority-manifest.v1', 'blocked-review-manifest.v1', 'unsigned.candidate', 'adhoc.candidate']);
  const members = readdirSync(directoryPath, { withFileTypes: true });
  if (members.some((member) => !allowedLeaves.has(member.name) || member.isSymbolicLink())) throw new Error('unexpected_run_directory_member');
  const leaves = [...allowedLeaves];
  const artifacts = {};
  for (const leaf of leaves) {
    try {
      const inspected = readBoundedNoFollow(`${directoryPath}/${leaf}`, leaf === 'recovery-adhoc' ? 64 * 1024 * 1024 : 512 * 1024, leaf === 'recovery-adhoc' ? 0o755 : 0o600);
      artifacts[leaf] = { present: true, sha256: inspected.sha256, metadata: inspected.metadata };
    } catch (error) {
      if (error?.code === 'ENOENT') artifacts[leaf] = { present: false };
      else artifacts[leaf] = { present: true, valid: false, blocked_reason: error?.code === 'ELOOP' ? 'symlink_or_no_follow_failure' : 'partial_metadata_failure' };
    }
  }
  return { directory_metadata: directoryMetadata, artifacts };
}

function inspectTmpParent() {
  // macOS exposes /tmp as the documented symlink to /private/tmp. Resolve that
  // public spelling first, then bind the canonical target with O_NOFOLLOW.
  if (realpathSync('/tmp') !== '/private/tmp') throw new Error('tmp_resolution');
  const privateTmpFd = openSync('/private/tmp', FS.O_RDONLY | FS.O_DIRECTORY | FS.O_NOFOLLOW);
  try {
    const privateTmpStat = fstatSync(privateTmpFd);
    if (!privateTmpStat.isDirectory() || privateTmpStat.uid !== 0 || (privateTmpStat.mode & 0o1777) !== 0o1777) throw new Error('private_tmp_parent_metadata');
    const metadata = { owner_uid: privateTmpStat.uid, mode: '01777', type: 'directory', no_follow: true };
    return { verified: true, tmp: metadata, private_tmp: { ...metadata, same_object: true } };
  } finally { closeSync(privateTmpFd); }
}

function inspectFixedRendezvous() {
  try {
    const tmpParent = inspectTmpParent();
    const inspected = readBoundedNoFollow(RENDEZVOUS_PATH, 1025, 0o600);
    const runRecordPath = validateRendezvousContent(inspected.bytes);
    return { present: true, verified: true, path: RENDEZVOUS_PATH, parent: tmpParent, metadata: inspected.metadata, byte_sha256: inspected.sha256, run_record_locator_sha256: locatorDigest(runRecordPath), retained: true, partials: inspectReachablePartials(runRecordPath) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, verified: false, path: RENDEZVOUS_PATH, retained: false };
    return { present: true, verified: false, path: RENDEZVOUS_PATH, retained: true, blocked_reason: error?.code === 'ELOOP' ? 'rendezvous_symlink_or_no_follow_failure' : 'rendezvous_static_validation_failed' };
  }
}

export function verifyPreBundleBlocked({ receiptPresentStatic = false } = {}) {
  const frozen = assertFrozenInputs();
  assertAllowlistDelta(frozen.baseline, frozen.current, WRITE_ALLOWLIST.slice(0, 4));
  const path5 = inspectPath5();
  if (!receiptPresentStatic && path5.present) throw new Error('path5_present_in_absent_mode');
  if (receiptPresentStatic && !path5.present) throw new Error('path5_absent_in_present_mode');
  const rendezvous = inspectFixedRendezvous();
  const result = { outcome: 'REVIEW_PRE_BUNDLE_BLOCKED_PARTIALS_RETAINED', verification_mode: receiptPresentStatic ? 'v2-receipt-present-static' : 'no-v2-receipt-present', path5, rendezvous, native_execution_attempted: false, compiler_invoked: false, codesign_invoked: false, deletion_reachable: false, deletion_spy_calls: 0, baseline_status_sha256: sha256(frozen.status), exact_four_path_repair_allowlist: true, frozen_hashes_verified: true, retained_partials: true };
  assertNoSensitiveOutput(result);
  return result;
}

export async function runDryRun({ receiptWrite = true, injectedInventories = null, deletionSpy = null } = {}) {
  const frozen = assertFrozenInputs();
  if (injectedInventories) {
    const inventories = injectedInventories.map(validateInventory);
    const candidates = orderCandidates(inventories.flatMap((inventory) => inventory.candidates ?? []));
    if (candidates.length > 2 || ROWS.some((row) => candidates.filter((candidate) => candidate.row === row).length > 1)) throw new Error('candidate_cap');
    if (deletionSpy?.calls?.() !== 0) throw new Error('deletion_reachable');
    return { outcome: dryRunDecision(candidates), candidate_count: candidates.length, unsigned_count: candidates.filter((candidate) => candidate.row === 'unsigned').length, adhoc_count: candidates.filter((candidate) => candidate.row === 'adhoc').length, candidate_manifest_sha256: candidateManifestDigest(candidates), authority_manifest_sha256: sha256(authorityManifestBytes(candidates)), deletion_reachable: false, deletion_spy_calls: 0 };
  }
  if (!receiptWrite) throw new Error('only_inventory_dry_run_receipt_write_is_authorized');
  const beforeStatus = sha256(frozen.status);
  const facts = targetFacts();
  if (facts.platform !== 'darwin' || facts.architecture !== 'arm64' || !facts.non_root || !facts.uid_equal) throw new Error('unsupported_or_identity_context');
  const runId = randomBytes(16).toString('hex');
  const runDirectory = `/private/tmp/skillmap-m303-recovery-${runId}`;
  const runRecordPath = `${runDirectory}/run-record.json`;
  const rendezvous = createRendezvous(runRecordPath);
  mkdirSync(runDirectory, 0o700);
  chmodSync(runDirectory, 0o700);
  const runMetadata = metadata(runDirectory, 0o700, 'directory');
  const binaryPath = join(runDirectory, 'recovery-adhoc');
  const candidatePaths = Object.fromEntries(ROWS.map((row) => [row, join(runDirectory, `${row}.candidate`)]));
  const evidence = [];
  let binary;
  try {
    binary = compileAdhoc(runDirectory);
    const contextValues = [];
    for (let index = 0; index < 3; index += 1) {
      const result = await runChild(binaryPath, ['--context-only'], { SKILLMAP_M303_DP_EXECUTION_SIGNATURE: 'adhoc', SKILLMAP_M303_DP_ROW: 'adhoc' });
      evidence.push(processEvidence(result, 'adhoc', 'context'));
      const native = parseNative(result);
      if (!native || native.status !== 'CONTEXT' || native.execution_signature_state !== 'adhoc' || typeof native.context_sha256 !== 'string') throw new Error('audit_context_unavailable');
      contextValues.push(native.context_sha256);
    }
    if (new Set(contextValues).size !== 1) throw new Error('audit_session_changed');
    const context = contextValues[0];
    const inventories = [];
    const candidates = [];
    for (const row of ROWS) {
      const result = await runChild(binaryPath, ['--inventory-only'], { SKILLMAP_M303_DP_EXECUTION_SIGNATURE: 'adhoc', SKILLMAP_M303_DP_ROW: row, SKILLMAP_M303_CANDIDATE_PATH: candidatePaths[row] });
      evidence.push(processEvidence(result, row, 'inventory'));
      const native = parseNative(result);
      if (!native || native.execution_signature_state !== 'adhoc' || native.inventory_namespace !== row) throw new Error('native_inventory_unavailable');
      const inventory = { row, status: native.status, candidate_count: native.candidate_count, candidates: readCandidate(candidatePaths[row], row) };
      validateInventory(inventory);
      inventories.push(inventory);
      candidates.push(...inventory.candidates);
    }
    const ordered = orderCandidates(candidates);
    if (ordered.length > 2 || ROWS.some((row) => ordered.filter((candidate) => candidate.row === row).length > 1)) throw new Error('candidate_cap');
    const authority = authorityManifestBytes(ordered);
    const manifestKind = ordered.every((candidate) => candidate.access_group_kind === 'present') ? 'authority-manifest.v1' : 'blocked-review-manifest.v1';
    const manifestBytes = manifestKind === 'authority-manifest.v1' ? authority : Buffer.from(`skillmap.m3-03.recovery-blocked-review-manifest.v1\0${runId}\0inventory_access_group\0deletion_authority:false\0`, 'utf8');
    const manifestPath = join(runDirectory, manifestKind);
    const manifestMetadata = protectedFile(manifestPath, manifestBytes);
    const timing = clocks();
    const outcome = dryRunDecision(ordered);
    const runRecord = { run_id: runId, binary_leaf: binary.leaf, binary_sha256: binary.sha256, manifest_leaf: manifestKind, manifest_sha256: sha256(manifestBytes), manifest_kind: manifestKind, context_sha256: context, clocks: timing, target: { platform: facts.platform, architecture: facts.architecture, os_product_version: facts.os_product_version, os_build: facts.os_build }, absolute_paths_omitted: true };
    const recordMetadata = protectedFile(runRecordPath, Buffer.from(canonicalJson(runRecord), 'utf8'));
    const runDirFsync = fsyncDirectory(runDirectory);
    const allCandidates = ordered.map(validateCandidate);
    const receiptBody = {
      schema: RECEIPT_SCHEMA,
      outcome,
      active_predecessors: predecessorHashes(),
      historical_gate_anchors: Object.fromEntries(Object.entries(EXPECTED_HISTORICAL_GATE_ANCHORS).map(([path, expected]) => [path, { disposition: 'historical_gate_anchor', sha256: expected, observed_sha256: shaFile(join(ROOT, path)) }])),
      historical_capability_sha256: historicalHashes(),
      implementation_sha256: implementationHashes(),
      old_dry_run_receipt: { path: 'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-dry-run-receipt.json', sha256: fileSha(join(ROOT, 'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-dry-run-receipt.json')), disposition: 'HISTORICAL_INVALID_UNSIGNED_EXECUTION' },
      source_sha256: fileSha(SOURCE),
      target: { platform: facts.platform, architecture: facts.architecture, os_product_version: facts.os_product_version, os_build: facts.os_build, non_root: facts.non_root, uid_equal: facts.uid_equal, user_context_sha256: userContextDigest(facts.real_uid, facts.effective_uid) },
      toolchain: { swiftc: safeCommand('/usr/bin/xcrun', ['swiftc', '--version']), compiler_sha256: sha256(Buffer.from(safeCommand('/usr/bin/xcrun', ['swiftc', '--version']), 'utf8')) },
      binary,
      bundle: { run_directory_mode: runMetadata.mode, binary_leaf: binary.leaf, run_record_sha256: shaFile(runRecordPath), run_record_metadata: recordMetadata, outcome_manifest_kind: manifestKind, outcome_manifest_sha256: sha256(manifestBytes), outcome_manifest_metadata: manifestMetadata, bundle_complete: false, bundle_retained_for_review: true, run_directory_fsync: runDirFsync, local_deletion_attempts: 0 },
      rendezvous,
      inventory: { results: inventories.map((inventory) => ({ row: inventory.row, status: inventory.status, candidate_count: inventory.candidate_count, pair_fingerprints: (inventory.candidates ?? []).map(pairFingerprint) })), unsigned_count: allCandidates.filter((candidate) => candidate.row === 'unsigned').length, adhoc_count: allCandidates.filter((candidate) => candidate.row === 'adhoc').length, candidate_count: allCandidates.length, pair_fingerprints: allCandidates.map(pairFingerprint), candidate_manifest_sha256: candidateManifestDigest(allCandidates), authority_manifest_sha256: sha256(authority) },
      status_codes: { success: { code: 0, name: 'errSecSuccess' }, not_found: { code: -25300, name: 'errSecItemNotFound' } },
      clocks: timing,
      boot_audit_session_context_sha256: context,
      process_evidence: evidence,
      adversarial: { dirty_worktree: { checked: true, before_status_sha256: beforeStatus, after_status_sha256: gitStatusDigest() }, malformed_input: { checked: true, exact_cli: true, native_environment_shape_closed: true }, stale_state: { checked: true, exclusive_run_directory: true, immutable_manifest: true }, misleading_success_output: { checked: true, strict_json: true, stderr_empty_required: true, status_recomputed: true }, hung_or_long_command: { checked: true, timeout_ms: TIMEOUT_MS, bounded_child: true }, repeated_interruptions: { checked: true, no_retry: true, no_mutation_finally: true } },
      keychain_query_read_only: true, keychain_add_update_delete: false, deletion_reachable: false, deletion_spy_calls: deletionSpy?.calls?.() ?? 0, external_mutation: false, product_provider_browser_database_git_ledger_action: false,
    };
    receiptBody.bundle.bundle_complete = true;
    validateReceiptRedaction(receiptBody);
    const receiptResult = createReceipt(RECEIPT, receiptBody);
    receiptBody.bundle.receipt_sha256 = sha256(receiptResult.bytes);
    receiptBody.bundle.receipt_metadata = receiptResult.metadata;
    receiptBody.bundle.receipt_fsync = receiptResult.fsync;
    receiptBody.bundle.receipt_readback = receiptResult.readback;
    return { outcome, receipt_sha256: sha256(receiptResult.bytes), candidate_count: ordered.length, unsigned_count: receiptBody.inventory.unsigned_count, adhoc_count: receiptBody.inventory.adhoc_count, rendezvous: { path: RENDEZVOUS_PATH, byte_sha256: rendezvous.byte_sha256, run_record_locator_sha256: rendezvous.run_record_locator_sha256, metadata: rendezvous.metadata, retained: true }, deletion_spy_calls: 0 };
  } catch (error) {
    return { outcome: 'ADHOC_DRY_RUN_PRE_BUNDLE_BLOCKED', blocked_reason: error instanceof Error ? error.message : 'pre_bundle_blocked', rendezvous_created: true, rendezvous_verified: true, path5_present: existsSync(RECEIPT), path5_partial_sha256: existsSync(RECEIPT) ? fileSha(RECEIPT) : undefined, binary_created: Boolean(binary), retained_partials: true, deletion_spy_calls: 0 };
  }
}

function parseArgs(args) {
  if (args.length === 2 && args[0] === '--verify-pre-bundle-blocked' && args[1] === '--no-v2-receipt-present') return { mode: 'verify-pre', receiptPresentStatic: false };
  if (args.length === 2 && args[0] === '--verify-pre-bundle-blocked' && args[1] === '--v2-receipt-present-static') return { mode: 'verify-pre', receiptPresentStatic: true };
  const accepted = ['--inventory-only', '--dry-run', '--receipt-write'];
  if (args.length !== accepted.length || args.some((arg, index) => arg !== accepted[index])) throw new Error('only_inventory_dry_run_receipt_write_is_authorized');
  return { mode: 'run' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    const result = parsed.mode === 'verify-pre' ? verifyPreBundleBlocked({ receiptPresentStatic: parsed.receiptPresentStatic }) : await runDryRun();
    assertNoSensitiveOutput(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.outcome === 'ADHOC_DRY_RUN_PRE_BUNDLE_BLOCKED' ? 1 : 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ outcome: 'ADHOC_DRY_RUN_PRE_BUNDLE_BLOCKED', blocked_reason: error instanceof Error ? error.message : 'pre_bundle_blocked', retained_partials: true })}\n`);
    process.exitCode = 1;
  }
}
