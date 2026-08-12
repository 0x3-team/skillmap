import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  EXECUTION_SIGNATURE_STATE, RECEIPT_SCHEMA, RENDEZVOUS_PATH, ROWS,
  EXPECTED_ACTIVE_PREDECESSORS, EXPECTED_HISTORICAL_CAPABILITY, EXPECTED_OLD_RECEIPT_SHA256,
  EXPECTED_STATUS_BASELINE_SHA256, WRITE_ALLOWLIST, assertAllowlistDelta, assertExpectedHashMap,
  auditSessionDecision, authorityManifestBytes, bootAuditSessionDigest,
  candidateManifestDigest, dryRunDecision, makeDeletionSpy, pairFingerprint,
  classifyPath5Bytes, EXPECTED_PRE_RUN_MEMBERS, sha256, signatureEvidenceAccepted, userContextDigest,
  validateBoundedMetadata, validateCandidate, validateInventory, validateReceiptRedaction,
  validateRendezvousContent, validateRunDirectoryMembers, validateTmpParentMetadata,
} from './support/m3-03-dp-keychain-failure-recovery.mjs';
import { assertFrozenInputs, runDryRun } from '../scripts/m3-03-dp-keychain-failure-recovery.mjs';
import { verifyPreBundleBlocked } from '../scripts/m3-03-dp-keychain-failure-recovery.mjs';

const source = readFileSync(new URL('./fixtures/m3-03-dp-keychain-failure-recovery/ResidueRecovery.swift', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/m3-03-dp-keychain-failure-recovery.mjs', import.meta.url), 'utf8');
const historical = JSON.parse(readFileSync(new URL('../docs/plans/evidence/M3.03-dp-keychain-failure-recovery-dry-run-receipt.json', import.meta.url), 'utf8'));

function candidate(row = 'unsigned', group = 'present') {
  const suffix = row === 'unsigned' ? 'a'.repeat(24) : 'b'.repeat(24);
  return { row, service: `skillmap-m303-dp-${row}-${suffix}`, account: `synthetic-${'c'.repeat(24)}`, accessible: 'kSecAttrAccessibleWhenUnlockedThisDeviceOnly', synchronizable: false, access_group_kind: group, access_group_value: group === 'present' ? 'com.skillmap.recovery' : '' };
}
function emptyInventories() { return ROWS.map((row) => ({ row, status: 'errSecItemNotFound', candidate_count: 0, candidates: [] })); }

test('M3.03 v2 formulas, ordering, access-group distinction, and zero representation are deterministic', () => {
  const item = candidate();
  const pair = sha256(Buffer.from(`skillmap.m3-03.recovery-pair.v1\0unsigned\0${item.service}\0${item.account}`, 'utf8'));
  assert.equal(pairFingerprint(item), pair);
  assert.equal(candidateManifestDigest([item]), sha256(Buffer.from(`skillmap.m3-03.recovery-manifest.v1\0${1}\0${pair}`, 'utf8')));
  assert.equal(authorityManifestBytes([item]).toString('utf8'), `skillmap.m3-03.recovery-authority-manifest.v1\0${1}\0unsigned\0${item.service}\0${item.account}\0present\0com.skillmap.recovery\0`);
  assert.equal(candidateManifestDigest([]), sha256(Buffer.from(`skillmap.m3-03.recovery-manifest.v1\0${0}\0`, 'utf8')));
  assert.equal(bootAuditSessionDigest('12345678-1234-1234-1234-123456789abc', 42).length, 64);
  assert.equal(userContextDigest(501, 501).length, 64);
});

test('M3.03 shape, cardinality, namespace, and malformed access groups fail closed', () => {
  assert.deepEqual(validateInventory(emptyInventories()[0]).candidates, []);
  assert.throws(() => validateCandidate({ ...candidate(), service: 'skillmap-m303-dp-unsigned-AAAAAAAAAAAAAAAAAAAAAAAA' }), /candidate\.service/);
  assert.throws(() => validateCandidate({ ...candidate(), access_group_kind: 'none', access_group_value: 'unexpected' }), /access_group_value/);
  assert.throws(() => validateInventory({ row: 'unsigned', status: 'errSecSuccess', candidate_count: 2, candidates: [candidate(), candidate()] }), /candidate_count/);
  assert.equal(dryRunDecision([]), 'ADHOC_DRY_RUN_ZERO_CANDIDATES_PENDING_REVIEW');
  assert.equal(dryRunDecision([candidate()]), 'ADHOC_DRY_RUN_CANDIDATES_REQUIRE_AUTHORIZATION_PENDING_REVIEW');
  assert.equal(dryRunDecision([{ ...candidate(), access_group_kind: 'none', access_group_value: '' }]), 'ADHOC_DRY_RUN_POST_BUNDLE_BLOCKED');
});

test('M3.03 injected non-mutating classification keeps deletion unreachable', async () => {
  const spy = makeDeletionSpy();
  const result = await runDryRun({ injectedInventories: emptyInventories(), deletionSpy: spy });
  assert.equal(result.outcome, 'ADHOC_DRY_RUN_ZERO_CANDIDATES_PENDING_REVIEW');
  assert.equal(result.deletion_reachable, false);
  assert.equal(result.deletion_spy_calls, 0);
  assert.equal(spy.calls(), 0);
  assert.throws(() => spy.call(), /deletion spy called/);
  assert.equal(spy.calls(), 1);
});

test('M3.03 audit-token boundary rejects unavailable, short, sentinel, and changed sessions', () => {
  assert.equal(auditSessionDecision({ taskInfoOk: false, returnedCount: 8, expectedCount: 8, asid: 42 }), 'BLOCKED_AUDIT_SESSION_UNAVAILABLE');
  assert.equal(auditSessionDecision({ taskInfoOk: true, returnedCount: 7, expectedCount: 8, asid: 42 }), 'BLOCKED_AUDIT_SESSION_UNAVAILABLE');
  for (const asid of [0, -1, -2, Number.NaN]) assert.equal(auditSessionDecision({ returnedCount: 8, expectedCount: 8, asid }), 'BLOCKED_AUDIT_SESSION_INVALID');
  assert.equal(auditSessionDecision({ returnedCount: 8, expectedCount: 8, asid: 43, expectedAsid: 42 }), 'BLOCKED_AUDIT_SESSION_CHANGED');
  assert.equal(auditSessionDecision({ returnedCount: 8, expectedCount: 8, asid: 42, expectedAsid: 42 }), 'AUDIT_SESSION_ACCEPTED');
});

test('M3.03 native source and runner enforce one ad-hoc binary, attribute-only query, and no mutation', () => {
  assert.equal(EXECUTION_SIGNATURE_STATE, 'adhoc');
  assert.equal(RENDEZVOUS_PATH, '/tmp/skillmap-m303-dp-keychain-adhoc-gate-v1.locator');
  assert.match(source, /kSecReturnAttributes/);
  assert.match(source, /kSecUseAuthenticationContext/);
  assert.match(source, /execution_signature_state/);
  assert.doesNotMatch(source, /kSecReturnData|kSecReturnRef|SecItemAdd|SecItemUpdate|SecItemDelete/);
  assert.doesNotMatch(source, /audit_token\.val|audit_session_self|audit_session_join/);
  assert.doesNotMatch(runner, /codesign.{0,100}remove-signature/u);
  assert.match(runner, /--force/);
  assert.match(runner, /-s', '-'/);
  assert.match(runner, /--timestamp=none/);
  assert.doesNotMatch(runner, /rmSync|unlinkSync|mkdtempSync/u);
  assert.match(runner, /O_RDWR[\s\S]{0,80}O_CREAT[\s\S]{0,80}O_EXCL[\s\S]{0,80}O_NOFOLLOW/u);
  assert.match(runner, /--verify-pre-bundle-blocked/);
  assert.match(runner, /--no-v2-receipt-present/);
  assert.match(runner, /--v2-receipt-present-static/);
  assert.match(runner, /readBoundedNoFollow/);
  assert.match(runner, /evidence_commands_ok/);
});

test('M3.03 frozen hashes, baseline, and exact four-path delta reject drift', () => {
  assert.equal(Object.keys(EXPECTED_ACTIVE_PREDECESSORS).length, 4);
  assert.equal(Object.keys(EXPECTED_HISTORICAL_CAPABILITY).length, 5);
  assert.equal(EXPECTED_OLD_RECEIPT_SHA256.length, 64);
  assert.equal(EXPECTED_STATUS_BASELINE_SHA256.length, 64);
  assert.equal(WRITE_ALLOWLIST.length, 5);
  const status = Buffer.from('?? unrelated.txt\0?? another.txt\0');
  assert.throws(() => assertAllowlistDelta(status, status), /plain object/);
  assert.doesNotThrow(() => assertAllowlistDelta({ 'unrelated.txt': 'a' }, { 'unrelated.txt': 'a' }));
  assert.throws(() => assertAllowlistDelta({ 'unrelated.txt': 'a' }, { 'unrelated.txt': 'b' }), /allowlist/);
  assert.throws(() => assertAllowlistDelta({ ...Object.fromEntries(WRITE_ALLOWLIST.slice(0, 1).map((path) => [path, 'a'])), 'unrelated.txt': 'a' }, { 'unrelated.txt': 'a' }), /allowlist paths/);
  assert.doesNotThrow(() => assertExpectedHashMap({ a: '1', b: '2' }, { a: '1', b: '2' }));
  assert.throws(() => assertExpectedHashMap({ a: '1' }, { a: '1', b: '2' }), /paths mismatch/);
  assert.throws(() => assertExpectedHashMap({ a: '1' }, { a: '2' }), /mismatch/);
  assert.throws(() => assertFrozenInputs({ currentContentOverride: { ...Object.fromEntries(Object.keys(EXPECTED_ACTIVE_PREDECESSORS).map((key) => [key, 'x'])), 'unexpected-extra.txt': 'x' } }), /allowlist|frozen NUL-safe baseline/);
  const runStart = runner.indexOf('export async function runDryRun');
  const frozenPosition = runner.indexOf('const frozen = assertFrozenInputs();', runStart);
  const rendezvousPosition = runner.indexOf('createRendezvous(runRecordPath)', runStart);
  assert.ok(runStart >= 0 && frozenPosition >= runStart && rendezvousPosition > frozenPosition);
});

test('M3.03 absent PRE reviewer is static-only and present mode never substitutes absence', () => {
  const result = verifyPreBundleBlocked({ receiptPresentStatic: false });
  assert.equal(result.outcome, 'REVIEW_PRE_BUNDLE_BLOCKED_PARTIALS_RETAINED');
  assert.equal(result.verification_mode, 'no-v2-receipt-present');
  assert.equal(result.path5.present, false);
  assert.equal(result.native_execution_attempted, false);
  assert.equal(result.compiler_invoked, false);
  assert.equal(result.codesign_invoked, false);
  assert.equal(result.deletion_spy_calls, 0);
  assert.throws(() => verifyPreBundleBlocked({ receiptPresentStatic: true }), /path5_absent/);
});

test('M3.03 path-5 partial/invalid forms and no-follow metadata tamper probes fail closed', () => {
  assert.equal(classifyPath5Bytes(null), 'absent');
  assert.equal(classifyPath5Bytes(Buffer.from('{"partial":true}\n')), 'present-invalid');
  assert.equal(classifyPath5Bytes(Buffer.from('{"schema":"wrong"}\n')), 'present-invalid');
  assert.doesNotThrow(() => validateBoundedMetadata({ owner_uid: 501, mode: '0600', type: 'file', link_count: 1, device: 1, inode: 2 }, { ownerUid: 501, mode: '0600', type: 'file', linkCount: 1, device: 1, inode: 2 }));
  for (const tampered of [
    { owner_uid: 502, mode: '0600', type: 'file', link_count: 1 },
    { owner_uid: 501, mode: '0644', type: 'file', link_count: 1 },
    { owner_uid: 501, mode: '0600', type: 'symlink', link_count: 1 },
    { owner_uid: 501, mode: '0600', type: 'file', link_count: 2 },
  ]) assert.throws(() => validateBoundedMetadata(tampered, { ownerUid: 501, mode: '0600', type: 'file', linkCount: 1 }), /metadata/);
  assert.throws(() => validateBoundedMetadata({ owner_uid: 501, mode: '0600', type: 'file', link_count: 1, device: 9, inode: 2 }, { ownerUid: 501, mode: '0600', type: 'file', linkCount: 1, device: 1, inode: 2 }), /metadata/);
  const accepted = { state: 'adhoc', evidence_commands_ok: true, signature_display_parses: true, entitlement_evidence_parses: true, no_team_identifier: true, entitlements_present: false, provisioning_profile_marker: null, mode: '0755' };
  assert.equal(signatureEvidenceAccepted(accepted), true);
  assert.equal(signatureEvidenceAccepted({ ...accepted, evidence_commands_ok: false }), false);
  assert.equal(signatureEvidenceAccepted({ ...accepted, signature_display_parses: false }), false);
  assert.equal(signatureEvidenceAccepted({ state: 'adhoc' }), false);
  assert.equal(signatureEvidenceAccepted({ ...accepted, no_team_identifier: false }), false);
  assert.doesNotThrow(() => validateTmpParentMetadata({ owner_uid: 0, mode: '01777', type: 'directory', no_follow: true }));
  assert.throws(() => validateTmpParentMetadata({ owner_uid: 501, mode: '01777', type: 'directory', no_follow: true }), /tmp parent/);
  assert.doesNotThrow(() => validateRunDirectoryMembers(EXPECTED_PRE_RUN_MEMBERS));
  assert.throws(() => validateRunDirectoryMembers([...EXPECTED_PRE_RUN_MEMBERS, 'unexpected.tmp']), /unexpected/);
  assert.match(runner, /realpathSync\('\/tmp'\)/);
  assert.match(runner, /0o1777/);
  assert.match(runner, /unexpected_run_directory_member/);
});

test('M3.03 receipt redaction rejects old v1 and candidate-bearing metadata', () => {
  assert.equal(historical.schema, 'skillmap.m3-03.dp-keychain-failure-recovery.dry-run.v1');
  const receipt = { schema: RECEIPT_SCHEMA, outcome: 'ADHOC_DRY_RUN_ZERO_CANDIDATES_PENDING_REVIEW', inventory: { candidate_count: 0, pair_fingerprints: [], candidate_manifest_sha256: '0'.repeat(64), authority_manifest_sha256: '1'.repeat(64) } };
  assert.equal(validateReceiptRedaction(receipt), receipt);
  assert.throws(() => validateReceiptRedaction({ ...receipt, service: 'leak' }), /receipt\.service/);
  assert.throws(() => validateReceiptRedaction({ ...receipt, inventory: { service: 'skillmap-m303-dp-unsigned-aaaaaaaaaaaaaaaaaaaaaaaa' } }), /candidate metadata/);
});

test('M3.03 rendezvous grammar is exact and rejects disclosure-shaped inputs', () => {
  const valid = Buffer.from('/private/tmp/skillmap-m303-recovery-0123456789abcdef0123456789abcdef/run-record.json\n');
  assert.equal(validateRendezvousContent(valid), '/private/tmp/skillmap-m303-recovery-0123456789abcdef0123456789abcdef/run-record.json');
  for (const invalid of [Buffer.from('relative\n'), Buffer.from('/private/tmp/skillmap-m303-recovery-0123456789abcdef0123456789abcdef/run-record.json'), Buffer.from('/private/tmp/skillmap-m303-recovery-0123456789abcdef0123456789abcdef/run-record.json\r\n'), Buffer.from('/private/tmp/skillmap-m303-recovery-0123456789abcdef0123456789abcdef/../run-record.json\n')]) assert.throws(() => validateRendezvousContent(invalid));
});
