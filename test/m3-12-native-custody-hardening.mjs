import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  MACOS_CREDENTIAL_RECORD_MAX_BYTES,
  MACOS_HELPER_MAX_FRAME_BYTES,
  decodeCredentialRecord,
  decodePendingCredential,
  decodeMetadataRecord,
  decodeHelperFrame,
  encodeCredentialRecord,
  encodeMetadataRecord,
  encodePendingCredential,
  encodeHelperFrame
} from '../dist/platform/macos-keychain-protocol.js';

const record = {
  deviceId: 'D'.repeat(22), tokenFamilyId: `fam_${'1'.repeat(32)}`, refreshToken: 'R'.repeat(43),
  scopes: ['device.status'], updatedAt: 11, generation: 2, familyAbsoluteExpiresAt: 999,
  devicePublicId: `dev_${'2'.repeat(32)}`, accountPublicId: `acct_${'3'.repeat(32)}`
};
const publicFixtureHex = '534b4352010c014d01002050149b0c25f617868110cf86c1f59d27b7aa79b0233ae5671bf92bb5135b44b902000b703235362d73686132353603002037b4181a2a627e9a155e6e49603d8fd73c371a1bba563bcefd4f6506e82e82e5040016444444444444444444444444444444444444444444440500246465765f3232323232323232323232323232323232323232323232323232323232323232060025616363745f333333333333333333333333333333333333333333333333333333333333333307002466616d5f3131313131313131313131313131313131313131313131313131313131313131080008000000000000000209000800000000000003e70a002b525252525252525252525252525252525252525252525252525252525252525252525252525252525252520c001001000d6465766963652e7374617475730d0008000000000000000b';

test('M3.12 canonical public credential fixture is stable and binary', () => {
  const bytes = encodeCredentialRecord(record);
  assert.equal(bytes.toString('hex'), publicFixtureHex);
  const decoded = decodeCredentialRecord(Buffer.from(publicFixtureHex, 'hex'));
  assert.equal(decoded.deviceId, record.deviceId);
  assert.equal(decoded.generation, 2);
  assert.deepEqual(decoded.scopes, record.scopes);
  assert.equal(bytes.length <= MACOS_CREDENTIAL_RECORD_MAX_BYTES, true);
});

test('M3.12 metadata and pending fixtures are canonical and adversarial bindings fail', () => {
  const metadata = { deviceId: 'D'.repeat(22), verificationUri: 'https://skillmap.example.test/device', platform: 'macos', connectorVersion: '0.1.0' };
  const metadataBytes = encodeMetadataRecord(metadata);
  assert.deepEqual(decodeMetadataRecord(metadataBytes), metadata);
  const pending = { idempotencyKey: 'I'.repeat(22), requestDigest: `sha256:${'a'.repeat(64)}`, wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 2, requestStartedAt: 33 };
  const pendingBytes = encodePendingCredential(pending);
  assert.equal(pendingBytes.readUInt16BE(6), pendingBytes.length);
  assert.deepEqual(decodePendingCredential(pendingBytes), pending);
  assert.throws(() => decodeCredentialRecord(encodeCredentialRecord(record, 'other.namespace'), 'fixture.namespace'), /record_corrupt/);
  assert.throws(() => decodeMetadataRecord(Buffer.concat([metadataBytes, Buffer.from([9, 0, 0])])), /field_unknown/);
});

test('M3.12 custom namespace response round-trip binds credential bytes to the caller namespace', () => {
  const namespace = 'custom.connector.v9';
  const frame = encodeHelperFrame({ version: 1, ok: true, operation: 'credential_load', namespace, result: { record } });
  const decoded = decodeHelperFrame(frame, namespace);
  assert.equal(decoded.namespace, namespace);
  assert.deepEqual(decoded.result.record, record);
  assert.throws(() => decodeHelperFrame(frame, 'other.connector.v9'), /record_corrupt/);
});

test('M3.12 helper framing rejects tamper, unknown, duplicate, order, and truncation', () => {
  const frame = encodeHelperFrame({ version: 1, namespace: 'fixture', operation: 'sign', payload: { preimage_base64url: 'AQ' } });
  const unknown = Buffer.from(frame); unknown[23] = 9;
  assert.throws(() => decodeHelperFrame(unknown), /field_unknown/);
  const duplicate = Buffer.from(frame); duplicate[23] = 1;
  assert.throws(() => decodeHelperFrame(duplicate), /frame_fields|field_order/);
  assert.throws(() => decodeHelperFrame(frame.subarray(0, -1)), /frame_size_mismatch/);
  const oversized = Buffer.alloc(4); oversized.writeUInt32BE(MACOS_HELPER_MAX_FRAME_BYTES + 1);
  assert.throws(() => decodeHelperFrame(oversized), /frame_length/);
  assert.throws(() => encodeCredentialRecord({ ...record, refreshToken: 'secret' }), /record_invalid/);
  const secret = Buffer.from('refresh-token-secret-canary');
  const safeError = encodeHelperFrame({ version: 1, ok: false, operation: 'exists_key', error: { code: secret.toString() } });
  assert.equal(safeError.includes(secret), false);
  assert.throws(() => encodeHelperFrame({ version: 1, ok: true, operation: 'exists_key', result: { exists: false, secret: secret.toString() } }), /response_shape/);
});

test('M3.12 native source has bounded binary boundary and safe local lock/query contract', () => {
  const swift = readFileSync(new URL('../native/macos-keychain-helper/main.swift', import.meta.url), 'utf8');
  assert.match(swift, /SKMP/);
  assert.match(swift, /SKCR/);
  assert.match(swift, /maxFrame = 8 \* 1024/);
  assert.match(swift, /maxCredentialRecord = 4 \* 1024/);
  assert.match(swift, /O_NOFOLLOW/);
  assert.match(swift, /SKEN/);
  assert.match(swift, /encodeEnvelope/);
  assert.match(swift, /decodeEnvelope/);
  assert.match(swift, /validCredentialRecord\(record, namespace: namespace\)/);
  assert.match(swift, /st\.st_nlink/);
  assert.match(swift, /kSecClassGenericPassword/);
  assert.match(swift, /kSecAttrSynchronizable: false/);
  assert.doesNotMatch(swift, /\/tmp\/skillmap-device-auth/);
  assert.doesNotMatch(swift, /print\(/);
  assert.doesNotMatch(swift, /kSecUseDataProtectionKeychain/);
  assert.doesNotMatch(swift, /kSecAttrAccessGroup/);
  assert.doesNotMatch(swift, /JSONSerialization\.jsonObject\(with: data\)/);
  assert.doesNotMatch(swift, /JSONSerialization\.isValidJSONObject\(envelope\)/);
});

test('M3.12 package does not infer an unusable bundled helper executable', () => {
  const factory = readFileSync(new URL('../src/platform/macos-custody-factory.ts', import.meta.url), 'utf8');
  assert.match(factory, /helperPath = options\?\.helperPath \?\? process\.env\.SKILLMAP_MACOS_HELPER_PATH/u);
  assert.match(factory, /if \(!helperPath\) \{[\s\S]*helper_path_required/u);
  assert.doesNotMatch(factory, /skillmap-keychain-helper['"`]/u);
});
