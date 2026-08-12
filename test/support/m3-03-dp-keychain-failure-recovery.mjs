import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const RECOVERY_SCHEMA = 'skillmap.m3-03.dp-keychain-failure-recovery';
export const RECEIPT_SCHEMA = `${RECOVERY_SCHEMA}.adhoc-dry-run.v2`;
export const EXECUTION_SIGNATURE_STATE = 'adhoc';
export const RENDEZVOUS_PATH = '/tmp/skillmap-m303-dp-keychain-adhoc-gate-v1.locator';
export const ROWS = Object.freeze(['unsigned', 'adhoc']);
export const RESIDUE_NAMESPACES = Object.freeze({
  unsigned: Object.freeze({ servicePrefix: 'skillmap-m303-dp-unsigned-', serviceLength: 50 }),
  adhoc: Object.freeze({ servicePrefix: 'skillmap-m303-dp-adhoc-', serviceLength: 47 }),
});
export const EXPECTED_ACTIVE_PREDECESSORS = Object.freeze({
  '/Users/stevmq/Documents/skillmap/docs/plans/2026-08-10-skillmap-m3-device-connector-implementation-plan.md': '752f6d33ca2438b903ecac017eba82111a24d661ad1ad290ab283bd3942d6060',
  'docs/plans/evidence/M3.03-ad-hoc-no-profile-keychain-gate-amendment.md': 'e6b5c4fd92e7dadec3eb622da67ebdcb5d30f6bed1c80a8cecfac3a3f1676cd2',
  'docs/plans/evidence/M3.03-1password-cloudflare-architecture-amendment.md': '3a87a9040fd29825c37ef9ab47deeeffd08b3f850c5532fcd278d7308fbd6df1',
  'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-plan.md': '95a48a555aa585122a9a30c823a88bc085ec7ef2e66a64b92c11dbdb03364796',
});
export const EXPECTED_HISTORICAL_CAPABILITY = Object.freeze({
  'test/fixtures/m3-03-dp-keychain-no-profile-capability/CapabilityProbe.swift': 'd90330d5b7a23336b4c14d934f3a6ae9fbc4360713db38dd12757c1de43ffea9',
  'test/support/m3-03-dp-keychain-no-profile-capability.mjs': 'e91d7eac31f689a097f17d833d563618ee7534d43bcfe659a0e2d699de9b917d',
  'scripts/m3-03-dp-keychain-no-profile-capability.mjs': 'c411e9fc65a9482ad7b7ef157cda7500f00f07c36251e77126fda6996a5a5e95',
  'test/m3-03-dp-keychain-no-profile-capability.mjs': '906b5e003b5a6b9d2dbb54804ea0d9e4279ab96121bd643b6fb9adde46d54b5a',
  'docs/plans/evidence/M3.03-dp-keychain-no-profile-capability-receipt.json': '1983c294447699d58feb790090a7868e98edd5c9c652788faaacb7e0f502180e',
});
export const EXPECTED_HISTORICAL_GATE_ANCHORS = Object.freeze({
  'docs/plans/evidence/M3.01-signed-launcher-keychain-amendment-v1.md': '8fbd9a0279f122d91e3acf0febd225addc441dc543688e758810cfc953d86a98',
  'docs/plans/evidence/M3.02-device-auth-seams-security-decisions.md': '21d84b00460d38fea48a8ac568cfb7771188e7d5c16c0c90f90d7349534e016c',
});
export const EXPECTED_OLD_RECEIPT_SHA256 = 'b1d4ecb63f833d216a61c563e697d9ba38186b104333ba144f5ee077fb9b7310';
export const EXPECTED_STATUS_BASELINE_SHA256 = 'f2d4d95107079a4aff7be84cff42a2c1e665668b8026354f137ce4796479cb69';
export const WRITE_ALLOWLIST = Object.freeze([
  'test/fixtures/m3-03-dp-keychain-failure-recovery/ResidueRecovery.swift',
  'test/support/m3-03-dp-keychain-failure-recovery.mjs',
  'scripts/m3-03-dp-keychain-failure-recovery.mjs',
  'test/m3-03-dp-keychain-failure-recovery.mjs',
  'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-adhoc-dry-run-receipt.json',
]);
export const EXPECTED_PRE_RUN_MEMBERS = Object.freeze(['run-record.json', 'recovery-adhoc', 'authority-manifest.v1', 'blocked-review-manifest.v1', 'unsigned.candidate', 'adhoc.candidate']);
// Frozen candidate baseline captured before Slice 1A edits. Only the four repaired
// paths may differ from these bytes during this rework; path 5 must remain absent.
export const EXPECTED_BASELINE_FILE_SHA256 = Object.freeze({
  'package.json': 'f8d490175183dca05dac0fde84c05dadee36cc712955d8742298b7458aa30166',
  'contracts/test-vectors/device-auth-p256-v2.json': '7b6f53c50384f538646d0ad40f4cf01a827694df531c00f097be964aecbe6325',
  'contracts/test-vectors/device-auth-refresh-replay-v1.json': '23df6d5d3ce9ea491d9ca13eb24857f000fe3e21bdc7e502259e2bbd40727f83',
  'docs/plans/evidence/M1.08-device-auth-p256-amendment-v2.md': '72e209e86213ac9caee6c0220f19aa76091892f379ed38c21f6d1128a1b4ecd5',
  'docs/plans/evidence/M1.08-device-auth-refresh-replay-amendment-v1.md': '7fc012a6af18ff16806b442c547ef2adc5da3444678c2ebb95eebaebef9d01d2',
  'docs/plans/evidence/M3.01-connector-platform-support-matrix.md': '26691a86816b5b59ff2cb77087b7ccbb3f6d3632436d732cd1c73a8ae2aaae61',
  'docs/plans/evidence/M3.01-signed-launcher-keychain-amendment-v1.md': '8fbd9a0279f122d91e3acf0febd225addc441dc543688e758810cfc953d86a98',
  'docs/plans/evidence/M3.02-bounded-implementation-receipt.json': '71a95fa54dc7dd805c4c16cb73d433a8ad9d67dc418a2e51cc4899600290a937',
  'docs/plans/evidence/M3.02-device-auth-seams-security-decisions.md': '21d84b00460d38fea48a8ac568cfb7771188e7d5c16c0c90f90d7349534e016c',
  'docs/plans/evidence/M3.03-1password-cloudflare-architecture-amendment.md': '3a87a9040fd29825c37ef9ab47deeeffd08b3f850c5532fcd278d7308fbd6df1',
  'docs/plans/evidence/M3.03-ad-hoc-no-profile-keychain-gate-amendment.md': 'e6b5c4fd92e7dadec3eb622da67ebdcb5d30f6bed1c80a8cecfac3a3f1676cd2',
  'docs/plans/evidence/M3.03-apple-signing-readiness-preimplementation-plan.md': '5e5f34ccbe743d5ac774d2f6cf27f2e0da9f12e0703a2e04a378bc1692b2f53c',
  'docs/plans/evidence/M3.03-apple-signing-readiness-receipt.json': '2a300284ff907d871885b2b9ea351d7bfe4e975b672f778688af4d28b8f1f143',
  'docs/plans/evidence/M3.03-authorized-apple-replay-common-preflight-receipt.json': '2e0fa69a6e01c96988937169a8c9bb7c55a0461f474d7f4d13531ce11ab6032e',
  'docs/plans/evidence/M3.03-authorized-apple-replay-proof-execution-handoff.md': 'd4f8b7d6a7511534980d024e22389d99abc80abf19979fa04bd398ef04058b4d',
  'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-dry-run-receipt.json': 'b1d4ecb63f833d216a61c563e697d9ba38186b104333ba144f5ee077fb9b7310',
  'docs/plans/evidence/M3.03-dp-keychain-failure-recovery-plan.md': '95a48a555aa585122a9a30c823a88bc085ec7ef2e66a64b92c11dbdb03364796',
  'docs/plans/evidence/M3.03-dp-keychain-no-profile-capability-receipt.json': '1983c294447699d58feb790090a7868e98edd5c9c652788faaacb7e0f502180e',
  'docs/plans/evidence/M3.03-preimplementation-replay-provider-proof-receipt.json': 'acc3f6652fda5dd34a15dfc9119fd091db636620203d7acd4aa21943f891fb3c',
  'docs/plans/evidence/R0-M3.01-candidate-reconciliation.json': 'b5a55ed8e3ad2d350f115736e5be8a0a2eeb5ef1ce8295b7a8f316ac8b2dfde3',
  'scripts/m3-01-macos-secure-enclave-spike.swift': 'd2063c10fcb4530bdfa3c9a7675616581bf6279c754f0008ae0ba1c84fa3d454',
  'scripts/m3-03-apple-signing-readiness.mjs': '5eb691370a2c93deb4f8144b691a33ac0fe560f017a2a15979265c9b24465a7b',
  'scripts/m3-03-dp-keychain-failure-recovery.mjs': '83e507220f94365d2519d846b646807a1a380ee95f658deb4364f445fa984ea1',
  'scripts/m3-03-dp-keychain-no-profile-capability.mjs': 'c411e9fc65a9482ad7b7ef157cda7500f00f07c36251e77126fda6996a5a5e95',
  'test/fixtures/m3-03-apple-signing-readiness/cases.json': 'd80b1c235ed27de969a712220dbb8bb9fd09f390cdd624e5eb38b539d47485c6',
  'test/fixtures/m3-03-dp-keychain-failure-recovery/ResidueRecovery.swift': '70db195cc07e9d1470463d196ec808fa133ae7f27bc2a7880fdf1c71761a48cc',
  'test/fixtures/m3-03-dp-keychain-no-profile-capability/CapabilityProbe.swift': 'd90330d5b7a23336b4c14d934f3a6ae9fbc4360713db38dd12757c1de43ffea9',
  'test/fixtures/m3-03-replay-provider-proof/worker.mjs': 'a04bd64c3097de69b6a08af7bd019f57eea767c34b9a1dad45f56f3dd9f7ab8b',
  'test/fixtures/m3-03-replay-provider-proof/wrangler.jsonc': '03b9795cc76e7a7e49157a2146bfedd287970f12c1bbe874fce233b6e00f1e33',
  'test/m3-01-platform-support.mjs': 'bc97709945e595cd0988c973448dec04dcf15af8dd53e52623531484ca3c8b66',
  'test/m3-02-amendments.mjs': '73034d4553a1579ca57c28bf8d312ee2054fae45a438f3bcb0a0fee743d24a3d',
  'test/m3-03-apple-signing-readiness.mjs': '955ae9b4e3775b9b2cc4a76ce659e68d2ba0ae945a9c4f0dc47b3a3f54fab3d2',
  'test/m3-03-dp-keychain-failure-recovery.mjs': '85bf864a29ae62a2226cfc76be1f19612ea8714368807005130f81343b4d1134',
  'test/m3-03-dp-keychain-no-profile-capability.mjs': '906b5e003b5a6b9d2dbb54804ea0d9e4279ab96121bd643b6fb9adde46d54b5a',
  'test/m3-03-replay-provider-proof.mjs': '1edc851b75062b283495ac709d328248a2f8aa062c893a0c762f255f9ea5bb00',
  'test/support/m3-03-apple-signing-readiness.mjs': '37ac342a68d4a8da6289f61377d9e4da473f65aee089f27ae7f9a2151f96533b',
  'test/support/m3-03-dp-keychain-failure-recovery.mjs': '142d2a41fd6c70f307c1e96ba4abd4200529a9acb347a0d8dbd6b82ba110f9fc',
  'test/support/m3-03-dp-keychain-no-profile-capability.mjs': 'e91d7eac31f689a097f17d833d563618ee7534d43bcfe659a0e2d699de9b917d',
  'test/support/m3-03-replay-provider-proof.mjs': 'df24ba0c6c42f969a1aee62713342882e331f334355f2df188f976ff3fc7d3e2',
});
export const RECEIPT_OUTCOMES = Object.freeze([
  'ADHOC_DRY_RUN_ZERO_CANDIDATES_PENDING_REVIEW',
  'ADHOC_DRY_RUN_CANDIDATES_REQUIRE_AUTHORIZATION_PENDING_REVIEW',
  'ADHOC_DRY_RUN_PRE_BUNDLE_BLOCKED',
  'ADHOC_DRY_RUN_POST_BUNDLE_BLOCKED',
]);
export const SENSITIVE_MARKERS = Object.freeze([
  'kSecReturnData', 'kSecReturnRef', 'password', 'private_key', 'access_token',
  'BEGIN PRIVATE KEY', 'keychain-access-groups', 'embedded.mobileprovision',
]);

const PAIR_DOMAIN = 'skillmap.m3-03.recovery-pair.v1';
const MANIFEST_DOMAIN = 'skillmap.m3-03.recovery-manifest.v1';
const AUTHORITY_DOMAIN = 'skillmap.m3-03.recovery-authority-manifest.v1';
const USER_DOMAIN = 'skillmap.m3-03.recovery-user.v1';
const BOOT_AUDIT_DOMAIN = 'skillmap.m3-03.recovery-boot-audit-session.v1';
const LOCATOR_DOMAIN = 'skillmap.m3-03.recovery-run-record-locator.v1';
const HEX64 = /^[0-9a-f]{64}$/u;
const ROW_RANK = new Map(ROWS.map((row, index) => [row, index]));
const RESERVED_RECEIPT_FIELDS = new Set(['service', 'account', 'access_group', 'authority_manifest_path', 'boot_uuid', 'audit_session_id', 'unrelated_item_count']);

export const OS_STATUS = Object.freeze({
  success: Object.freeze({ code: 0, name: 'errSecSuccess', ok: true }),
  notFound: Object.freeze({ code: -25300, name: 'errSecItemNotFound', ok: false }),
  param: Object.freeze({ code: -50, name: 'errSecParam', ok: false }),
  interaction: Object.freeze({ code: -25308, name: 'errSecInteractionNotAllowed', ok: false }),
  missingEntitlement: Object.freeze({ code: -34018, name: 'errSecMissingEntitlement', ok: false }),
});

export function sha256(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(value)).digest('hex');
}

export function canonicalDecimal(value, label = 'integer') {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be an unsigned safe integer`);
  return String(value);
}

export function assertPlainRecord(value, label = 'record') {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  return value;
}

export function assertLowerHexDigest(value, label = 'digest') {
  if (typeof value !== 'string' || !HEX64.test(value)) throw new TypeError(`${label} must be lowercase SHA-256 hex`);
  return value;
}

export function assertExpectedHashMap(actual, expected, label = 'hash map') {
  assertPlainRecord(actual, label);
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) throw new Error(`${label} paths mismatch`);
  for (const key of expectedKeys) if (actual[key] !== expected[key]) throw new Error(`${label} mismatch: ${key}`);
  return true;
}

export function statusPathsFromNul(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('status bytes');
  return bytes.toString('utf8').split('\0').filter(Boolean).map((entry) => entry.slice(3));
}

export function assertAllowlistDelta(beforeBytes, afterBytes, allowlist = WRITE_ALLOWLIST) {
  assertPlainRecord(beforeBytes, 'baseline content hashes');
  assertPlainRecord(afterBytes, 'current content hashes');
  const allowed = new Set(allowlist);
  const beforeAllowed = Object.keys(beforeBytes).filter((path) => allowed.has(path)).sort();
  const afterAllowed = Object.keys(afterBytes).filter((path) => allowed.has(path)).sort();
  if (beforeAllowed.length !== afterAllowed.length || beforeAllowed.some((path, index) => path !== afterAllowed[index])) throw new Error('allowlist paths mismatch');
  const before = Object.keys(beforeBytes).filter((path) => !allowed.has(path)).sort();
  const after = Object.keys(afterBytes).filter((path) => !allowed.has(path)).sort();
  if (before.length !== after.length || before.some((path, index) => path !== after[index] || beforeBytes[path] !== afterBytes[path])) throw new Error('dirty worktree outside exact allowlist changed');
  return true;
}

function utf8Field(value, label, { allowEmpty = false, maxBytes = 1024 } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.includes('\u0000')) throw new TypeError(`${label} must be a NUL-free string`);
  const bytes = Buffer.from(value, 'utf8');
  if ((!allowEmpty && bytes.length === 0) || bytes.length > maxBytes) throw new TypeError(`${label} has invalid UTF-8 length`);
  return bytes;
}

export function rowServicePattern(row) {
  if (!ROWS.includes(row)) throw new TypeError('invalid row');
  return new RegExp(`^${RESIDUE_NAMESPACES[row].servicePrefix}[0-9a-f]{24}$`, 'u');
}

export function validateCandidate(candidate, label = 'candidate', { accessGroupRequired = false } = {}) {
  const value = assertPlainRecord(candidate, label);
  if (!ROWS.includes(value.row)) throw new TypeError(`${label}.row`);
  const namespace = RESIDUE_NAMESPACES[value.row];
  if (typeof value.service !== 'string' || !rowServicePattern(value.row).test(value.service) || value.service.length !== namespace.serviceLength) throw new TypeError(`${label}.service`);
  if (typeof value.account !== 'string' || !/^synthetic-[0-9a-f]{24}$/u.test(value.account) || value.account.length !== 34) throw new TypeError(`${label}.account`);
  if (value.accessible !== 'kSecAttrAccessibleWhenUnlockedThisDeviceOnly') throw new TypeError(`${label}.accessible`);
  if (value.synchronizable !== false) throw new TypeError(`${label}.synchronizable`);
  if (value.access_group_kind !== 'none' && value.access_group_kind !== 'present') throw new TypeError(`${label}.access_group_kind`);
  if (value.access_group_kind === 'none') {
    if (value.access_group_value !== '') throw new TypeError(`${label}.access_group_value`);
    if (accessGroupRequired) throw new TypeError(`${label}.access_group_missing`);
  } else {
    utf8Field(value.access_group_value, `${label}.access_group_value`);
  }
  return value;
}

export function pairFingerprint(candidate) {
  const value = validateCandidate(candidate);
  return sha256(Buffer.from(`${PAIR_DOMAIN}\0${value.row}\0${value.service}\0${value.account}`, 'utf8'));
}

export function orderCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    const rowDelta = ROW_RANK.get(a.row) - ROW_RANK.get(b.row);
    if (rowDelta) return rowDelta;
    const serviceDelta = Buffer.from(a.service).compare(Buffer.from(b.service));
    if (serviceDelta) return serviceDelta;
    const accountDelta = Buffer.from(a.account).compare(Buffer.from(b.account));
    if (accountDelta) return accountDelta;
    const groupDelta = (a.access_group_kind === 'none' ? 0 : 1) - (b.access_group_kind === 'none' ? 0 : 1);
    if (groupDelta) return groupDelta;
    return Buffer.from(a.access_group_value ?? '').compare(Buffer.from(b.access_group_value ?? ''));
  });
}

export function candidateManifestDigest(candidates) {
  const ordered = orderCandidates(candidates).map(pairFingerprint);
  return sha256(Buffer.from(`${MANIFEST_DOMAIN}\0${canonicalDecimal(ordered.length)}\0${ordered.join('\n')}`, 'utf8'));
}

export function authorityManifestBytes(candidates) {
  const ordered = orderCandidates(candidates).map((candidate) => validateCandidate(candidate));
  const chunks = [Buffer.from(`${AUTHORITY_DOMAIN}\0${canonicalDecimal(ordered.length)}\0`, 'utf8')];
  for (const candidate of ordered) chunks.push(Buffer.from(candidate.row), Buffer.from([0]), Buffer.from(candidate.service), Buffer.from([0]), Buffer.from(candidate.account), Buffer.from([0]), Buffer.from(candidate.access_group_kind), Buffer.from([0]), Buffer.from(candidate.access_group_value ?? ''), Buffer.from([0]));
  return Buffer.concat(chunks);
}

export function userContextDigest(realUid, effectiveUid) {
  return sha256(Buffer.from(`${USER_DOMAIN}\0${canonicalDecimal(realUid)}\0${canonicalDecimal(effectiveUid)}`, 'utf8'));
}

export function bootAuditSessionDigest(bootUuid, asid) {
  if (typeof bootUuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(bootUuid)) throw new TypeError('invalid boot UUID');
  return sha256(Buffer.from(`${BOOT_AUDIT_DOMAIN}\0${bootUuid}\0${canonicalDecimal(asid)}`, 'utf8'));
}

export function locatorDigest(runRecordPath) {
  if (typeof runRecordPath !== 'string' || !runRecordPath.startsWith('/private/tmp/')) throw new TypeError('invalid locator path');
  return sha256(Buffer.from(`${LOCATOR_DOMAIN}\0${runRecordPath}`, 'utf8'));
}

export function rendezvousBytes(runRecordPath) {
  if (typeof runRecordPath !== 'string' || !runRecordPath.startsWith('/private/tmp/')) throw new TypeError('invalid locator path');
  return Buffer.from(`${runRecordPath}\n`, 'utf8');
}

export function assertNoSensitiveOutput(value, extraMarkers = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const marker of [...SENSITIVE_MARKERS, ...extraMarkers]) if (text.includes(marker)) throw new Error(`sensitive recovery marker: ${marker}`);
  if (/skillmap-m303-recovery-[0-9a-f]{32}/u.test(text) || /\/private\/tmp\/skillmap-m303-recovery-/u.test(text)) throw new Error('raw run path leaked');
  return true;
}

export function validateInventory(inventory) {
  const value = assertPlainRecord(inventory, 'inventory');
  if (!ROWS.includes(value.row)) throw new TypeError('inventory.row');
  if (value.execution_signature_state !== undefined && value.execution_signature_state !== EXECUTION_SIGNATURE_STATE) throw new TypeError('inventory.execution_signature_state');
  if (!['errSecSuccess', 'errSecItemNotFound'].includes(value.status)) throw new TypeError('inventory.status');
  if (!Number.isSafeInteger(value.candidate_count) || value.candidate_count < 0 || value.candidate_count > 1) throw new TypeError('inventory.candidate_count');
  if (value.status === 'errSecItemNotFound' && value.candidate_count !== 0) throw new TypeError('inventory.not_found_count');
  if (value.status === 'errSecSuccess' && value.candidate_count > 0) {
    if (!Array.isArray(value.candidates) || value.candidates.length !== value.candidate_count) throw new TypeError('inventory.candidates');
    value.candidates.forEach((candidate) => validateCandidate(candidate));
  } else if (value.candidates !== undefined && (!Array.isArray(value.candidates) || value.candidates.length !== 0)) throw new TypeError('inventory.empty_candidates');
  return value;
}

export function makeDeletionSpy() {
  let calls = 0;
  return { call() { calls += 1; throw new Error('deletion spy called during non-mutating dry run'); }, calls: () => calls };
}

export function dryRunDecision(candidates) {
  const ordered = orderCandidates(candidates);
  if (ordered.length === 0) return 'ADHOC_DRY_RUN_ZERO_CANDIDATES_PENDING_REVIEW';
  if (ordered.length <= 2 && ordered.every((candidate) => candidate.access_group_kind === 'present')) return 'ADHOC_DRY_RUN_CANDIDATES_REQUIRE_AUTHORIZATION_PENDING_REVIEW';
  return 'ADHOC_DRY_RUN_POST_BUNDLE_BLOCKED';
}

export function auditSessionDecision({ taskInfoOk = true, returnedCount, expectedCount, asid, expectedAsid = null } = {}) {
  if (!taskInfoOk || returnedCount !== expectedCount) return 'BLOCKED_AUDIT_SESSION_UNAVAILABLE';
  if (!Number.isSafeInteger(asid) || asid <= 0 || asid === -1) return 'BLOCKED_AUDIT_SESSION_INVALID';
  if (expectedAsid !== null && asid !== expectedAsid) return 'BLOCKED_AUDIT_SESSION_CHANGED';
  return 'AUDIT_SESSION_ACCEPTED';
}

export function validateReceiptRedaction(receipt) {
  assertPlainRecord(receipt, 'receipt');
  if (receipt.schema !== RECEIPT_SCHEMA || !RECEIPT_OUTCOMES.includes(receipt.outcome)) throw new TypeError('receipt schema/outcome');
  assertNoSensitiveOutput(receipt);
  for (const forbidden of RESERVED_RECEIPT_FIELDS) if (Object.prototype.hasOwnProperty.call(receipt, forbidden)) throw new TypeError(`receipt.${forbidden}`);
  const text = JSON.stringify(receipt);
  if (/skillmap-m303-dp-(?:unsigned|adhoc)-[0-9a-f]{24}/u.test(text) || /synthetic-[0-9a-f]{24}/u.test(text) || /com\.skillmap\.recovery/u.test(text)) throw new TypeError('receipt candidate metadata');
  return receipt;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

export function validateRendezvousContent(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > 1025 || bytes.at(-1) !== 0x0a || bytes.subarray(0, -1).includes(0x0a) || bytes.subarray(0, -1).includes(0x0d)) throw new TypeError('rendezvous grammar');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1));
  if (!/^\/private\/tmp\/skillmap-m303-recovery-[0-9a-f]{32}\/run-record\.json$/u.test(text) || /[\u0000-\u001f\u007f]/u.test(text) || text.includes('/./') || text.includes('/../')) throw new TypeError('rendezvous path');
  return text;
}

export function classifyPath5Bytes(bytes) {
  if (bytes === null || bytes === undefined) return 'absent';
  if (!Buffer.isBuffer(bytes) || bytes.length > 512 * 1024 || bytes.at(-1) !== 0x0a) return 'present-invalid';
  try {
    const text = bytes.toString('utf8');
    const value = JSON.parse(text);
    if (canonicalJson(value) !== text || value.schema !== RECEIPT_SCHEMA || value.outcome !== 'ADHOC_DRY_RUN_PRE_BUNDLE_BLOCKED') return 'present-invalid';
    validateReceiptRedaction(value);
    return 'present-canonical-unverified';
  } catch { return 'present-invalid'; }
}

export function validateBoundedMetadata(metadata, { ownerUid, mode, type = 'file', linkCount = 1, device, inode } = {}) {
  assertPlainRecord(metadata, 'metadata');
  if (metadata.owner_uid !== ownerUid || metadata.mode !== mode || metadata.type !== type || metadata.link_count !== linkCount || (device !== undefined && metadata.device !== device) || (inode !== undefined && metadata.inode !== inode)) throw new TypeError('bounded metadata mismatch');
  return true;
}

export function signatureEvidenceAccepted(evidence) {
  assertPlainRecord(evidence, 'signature evidence');
  return evidence.state === 'adhoc' && evidence.evidence_commands_ok === true && evidence.signature_display_parses === true && evidence.entitlement_evidence_parses === true && evidence.no_team_identifier === true && evidence.entitlements_present === false && evidence.provisioning_profile_marker === null && evidence.mode === '0755';
}

export function validateTmpParentMetadata(metadata) {
  assertPlainRecord(metadata, 'tmp parent metadata');
  if (metadata.owner_uid !== 0 || metadata.mode !== '01777' || metadata.type !== 'directory' || metadata.no_follow !== true) throw new TypeError('tmp parent metadata mismatch');
  return true;
}

export function validateRunDirectoryMembers(members) {
  if (!Array.isArray(members) || members.some((member) => typeof member !== 'string' || !EXPECTED_PRE_RUN_MEMBERS.includes(member))) throw new TypeError('unexpected run directory member');
  return true;
}
