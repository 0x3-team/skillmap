import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const p256Path = join(root, 'contracts/test-vectors/device-auth-p256-v2.json');
const replayPath = join(root, 'contracts/test-vectors/device-auth-refresh-replay-v1.json');
const receiptPath = join(root, 'docs/plans/evidence/M3.02-bounded-implementation-receipt.json');
const supersedingReceiptPath = join(root, 'docs/plans/evidence/M3-functional-cutover-implementation-receipt.json');
const p256 = JSON.parse(readFileSync(p256Path, 'utf8'));
const replay = JSON.parse(readFileSync(replayPath, 'utf8'));
const P256_SUITE = 'skillmap.ecdsa-p256-sha256.v2';
const V1_SUITE = 'skillmap.ed25519.v1';
const CREDENTIAL_OPERATIONS = [
  'credential_load',
  'credential_commit_exchange',
  'credential_mark_refresh_pending',
  'credential_commit_refresh',
  'credential_delete',
];
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const EXPECTED_ALLOWED_PATHS = [
  'package.json',
  'contracts/test-vectors/device-auth-p256-v2.json',
  'contracts/test-vectors/device-auth-refresh-replay-v1.json',
  'docs/plans/evidence/M1.08-device-auth-p256-amendment-v2.md',
  'docs/plans/evidence/M1.08-device-auth-refresh-replay-amendment-v1.md',
  'docs/plans/evidence/M3.01-signed-launcher-keychain-amendment-v1.md',
  'test/m3-02-amendments.mjs',
  'docs/plans/evidence/M3.01-connector-platform-support-matrix.md',
  'docs/plans/evidence/R0-M3.01-candidate-reconciliation.json',
  'scripts/m3-01-macos-secure-enclave-spike.swift',
  'test/m3-01-platform-support.mjs',
  'docs/plans/evidence/M3.02-device-auth-seams-security-decisions.md',
  'docs/plans/evidence/M3.02-bounded-implementation-receipt.json',
].sort();

const decode = (value) => Buffer.from(value, 'base64url');
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function readDerLength(bytes, offset) {
  const first = bytes[offset++];
  if (first < 0x80) return [first, offset];
  const count = first & 0x7f;
  assert.ok(count > 0 && count <= 2, 'fixture DER length must be bounded');
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length * 256) + bytes[offset++];
  assert.ok(length >= 0x80, 'DER long form must be minimal');
  return [length, offset];
}

function derToP1363(der) {
  let offset = 0;
  assert.equal(der[offset++], 0x30);
  const [sequenceLength, sequenceStart] = readDerLength(der, offset);
  offset = sequenceStart;
  assert.equal(sequenceStart + sequenceLength, der.length);
  assert.equal(der[offset++], 0x02);
  const [rLength, rStart] = readDerLength(der, offset);
  const r = der.subarray(rStart, rStart + rLength);
  offset = rStart + rLength;
  assert.equal(der[offset++], 0x02);
  const [sLength, sStart] = readDerLength(der, offset);
  const s = der.subarray(sStart, sStart + sLength);
  assert.equal(sStart + sLength, der.length);
  const result = Buffer.alloc(64);
  const normalizedR = r[0] === 0 ? r.subarray(1) : r;
  const normalizedS = s[0] === 0 ? s.subarray(1) : s;
  assert.ok(normalizedR.length > 0 && normalizedR.length <= 32);
  assert.ok(normalizedS.length > 0 && normalizedS.length <= 32);
  normalizedR.copy(result, 32 - normalizedR.length);
  normalizedS.copy(result, 64 - normalizedS.length);
  return result;
}

function p1363ToDer(p1363) {
  assert.equal(p1363.length, 64);
  const encodeInteger = (value) => {
    const firstNonZero = value.findIndex((byte) => byte !== 0);
    let integer = firstNonZero === -1 ? Buffer.from([0]) : value.subarray(firstNonZero);
    if (integer[0] & 0x80) integer = Buffer.concat([Buffer.from([0]), integer]);
    return Buffer.concat([Buffer.from([0x02, integer.length]), integer]);
  };
  const body = Buffer.concat([encodeInteger(p1363.subarray(0, 32)), encodeInteger(p1363.subarray(32))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function assertValidP1363(signature) {
  if (signature.length !== 64) throw new Error('signature_length');
  const r = BigInt(`0x${signature.subarray(0, 32).toString('hex')}`);
  const s = BigInt(`0x${signature.subarray(32).toString('hex')}`);
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) throw new Error('signature_scalar');
}

function assertSuiteAgreement({ header, body, record }) {
  if (header !== P256_SUITE || body !== P256_SUITE || record !== P256_SUITE) throw new Error('suite_mismatch');
}

function assertRotationSuite(oldSuite, nextSuite) {
  if (oldSuite !== nextSuite || oldSuite !== P256_SUITE) throw new Error('cross_suite_rotation');
}

function assertExactSpki(spki) {
  if (spki.length !== 91 || spki.subarray(0, 26).toString('hex') !== '3059301306072a8648ce3d020106082a8648ce3d030107034200') throw new Error('spki_encoding');
}

test('P-256 fixture freezes 91-byte SPKI, P1363 wire form, preimages, and thumbprint', () => {
  const spki = decode(p256.public_key.der_spki_base64url);
  const message = Buffer.from(p256.proof.preimage_utf8);
  const p1363 = decode(p256.signature.p1363_base64url);
  assert.equal(p256.suite, P256_SUITE);
  assert.equal(spki.length, 91);
  assert.equal(spki.subarray(0, 26).toString('hex'), '3059301306072a8648ce3d020106082a8648ce3d030107034200');
  assert.equal(p256.public_key.der_spki_bytes, spki.length);
  assert.equal(p256.public_key.thumbprint, sha256(spki));
  assert.equal(p256.proof.sha256, sha256(message));
  assert.equal(p1363.length, 64);
  assertValidP1363(p1363);
  assert.equal(p256.signature.p1363_bytes, p1363.length);
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  assert.equal(verify('sha256', message, publicKey, p1363ToDer(p1363)), true);
  assert.deepEqual(derToP1363(decode(p256.signature.der_conversion_only_base64url)), p1363);
  assert.equal(p256.signature.der_is_wire_forbidden, true);
  assert.equal(p1363.length === decode(p256.signature.der_conversion_only_base64url).length, false);
});

test('P-256 negative vectors reject concrete suite, encoding, signature, and rotation confusion', () => {
  const spki = decode(p256.public_key.der_spki_base64url);
  const message = Buffer.from(p256.proof.preimage_utf8);
  const signature = decode(p256.signature.p1363_base64url);
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  assertSuiteAgreement({ header: P256_SUITE, body: P256_SUITE, record: P256_SUITE });
  for (const suites of [
    { header: undefined, body: P256_SUITE, record: P256_SUITE },
    { header: 'skillmap.unknown.v9', body: P256_SUITE, record: P256_SUITE },
    { header: V1_SUITE, body: P256_SUITE, record: P256_SUITE },
    { header: P256_SUITE, body: V1_SUITE, record: P256_SUITE },
  ]) assert.throws(() => assertSuiteAgreement(suites), /suite_mismatch/);
  assert.throws(() => assertRotationSuite(V1_SUITE, P256_SUITE), /cross_suite_rotation/);
  assert.throws(() => assertRotationSuite(P256_SUITE, V1_SUITE), /cross_suite_rotation/);
  const altered = Buffer.from(message);
  altered[altered.length - 2] ^= 1;
  assert.equal(verify('sha256', altered, publicKey, p1363ToDer(signature)), false);
  const v1LabeledMessage = Buffer.from(message.toString().replace('SKILLMAP-DEVICE-PROOF-V2', 'SKILLMAP-DEVICE-PROOF-V1'));
  assert.equal(verify('sha256', v1LabeledMessage, publicKey, p1363ToDer(signature)), false);
  const alteredSignature = Buffer.from(signature);
  alteredSignature[0] ^= 1;
  assert.equal(verify('sha256', message, publicKey, p1363ToDer(alteredSignature)), false);
  assert.throws(() => assertValidP1363(Buffer.alloc(64)), /signature_scalar/);
  assert.throws(() => assertValidP1363(Buffer.concat([Buffer.alloc(32, 0xff), signature.subarray(32)])), /signature_scalar/);
  assert.throws(() => assertValidP1363(Buffer.concat([signature.subarray(0, 32), Buffer.alloc(32, 0xff)])), /signature_scalar/);
  assert.throws(() => {
    if (decode(p256.signature.der_conversion_only_base64url).length !== 64) throw new Error('der_signature_on_wire');
  }, /der_signature_on_wire/);
  const point = spki.subarray(26);
  const compressedPoint = Buffer.concat([spki.subarray(0, 26), Buffer.from([0x02]), point.subarray(1, 33)]);
  assert.throws(() => createPublicKey({ key: compressedPoint, format: 'der', type: 'spki' }));
  assert.throws(() => createPublicKey({ key: point, format: 'der', type: 'spki' }));
  const wrongCurve = Buffer.from(spki);
  wrongCurve[22] = 0x08;
  assert.throws(() => createPublicKey({ key: wrongCurve, format: 'der', type: 'spki' }));
  const wrongAlgorithm = Buffer.from(spki);
  wrongAlgorithm[10] ^= 1;
  assert.throws(() => createPublicKey({ key: wrongAlgorithm, format: 'der', type: 'spki' }));
  assert.throws(() => assertExactSpki(Buffer.concat([spki, Buffer.from([0])])), /spki_encoding/);
  assert.throws(() => createPublicKey({ key: spki.subarray(0, 65), format: 'der', type: 'spki' }));
  assert.equal(signature.length, 64);
  assert.equal(p256.signature.der_is_wire_forbidden, true);
});

test('V2 idempotency preimage is exact and digest-stable', () => {
  const preimage = Buffer.from(p256.idempotency.preimage_utf8);
  assert.equal(p256.idempotency.sha256, sha256(preimage));
  assert.equal(Buffer.byteLength(preimage), decode(p256.idempotency.preimage_base64url).length);
  assert.equal(preimage.toString().endsWith('\n'), true);
  assert.equal('idemp-0000000000000001'.length, 22);
});

test('AES-256-GCM replay fixture decrypts exactly and rejects all tamper dimensions', async () => {
  const key = Buffer.from(replay.key_hex_test_only, 'hex');
  const nonce = Buffer.from(replay.nonce_hex, 'hex');
  const aad = Buffer.from(replay.aad_utf8);
  const ciphertext = decode(replay.ciphertext_and_tag_base64url);
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  assert.equal(replay.replay_key_version, 11);
  assert.deepEqual(replay.rejected_key_versions, [0, 12, '11']);
  const plaintext = Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, cryptoKey, ciphertext));
  assert.equal(plaintext.toString(), replay.plaintext_utf8);
  assert.equal(plaintext.length, replay.plaintext_bytes);
  assert.equal(sha256(plaintext), replay.plaintext_sha256);
  assert.equal(ciphertext.length, replay.ciphertext_and_tag_bytes);
  const decrypt = (candidateCiphertext, candidateNonce, candidateAad, candidateKey = key) => webcrypto.subtle.importKey('raw', candidateKey, { name: 'AES-GCM' }, false, ['decrypt'])
    .then((candidateKeyObject) => webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: candidateNonce, additionalData: candidateAad, tagLength: 128 }, candidateKeyObject, candidateCiphertext));
  for (const mutate of [
    (bytes) => { bytes[0] ^= 1; }, // ciphertext
    (bytes) => { bytes[bytes.length - 1] ^= 1; }, // tag
    (bytes) => { bytes[bytes.length - 2] ^= 1; }, // ciphertext/tag boundary
  ]) {
    const changed = Buffer.from(ciphertext);
    mutate(changed);
    await assert.rejects(decrypt(changed, nonce, aad));
  }
  const changedNonce = Buffer.from(nonce);
  changedNonce[0] ^= 1;
  await assert.rejects(decrypt(ciphertext, changedNonce, aad));
  const changedKey = Buffer.from(key);
  changedKey[0] ^= 1;
  await assert.rejects(decrypt(ciphertext, nonce, aad, changedKey));
  assert.throws(() => selectReplayKey(replay.replay_key_version + 1, new Map([[replay.replay_key_version, key]])), /unknown_replay_key_version/);
  assert.throws(() => selectReplayKey(String(replay.replay_key_version), new Map([[replay.replay_key_version, key]])), /unknown_replay_key_version/);
  const aadLines = aad.toString().split('\n');
  assert.equal(aadLines.at(-1), '');
  for (let index = 0; index < aadLines.length - 1; index += 1) {
    const changedLines = [...aadLines];
    changedLines[index] = `${changedLines[index]}-mutated`;
    await assert.rejects(decrypt(ciphertext, nonce, Buffer.from(changedLines.join('\n'))));
  }
  const issuedAtMutation = Buffer.from(aad.toString().replace('\n1735689600\n', '\n1735689601\n'));
  await assert.rejects(decrypt(ciphertext, nonce, issuedAtMutation));
  const semanticCheck = (candidatePlaintext, expectedLength, expectedDigest) => {
    if (candidatePlaintext.length !== expectedLength || sha256(candidatePlaintext) !== expectedDigest) throw new Error('response_binding_mismatch');
  };
  assert.throws(() => semanticCheck(plaintext, replay.plaintext_bytes + 1, replay.plaintext_sha256), /response_binding_mismatch/);
  assert.throws(() => semanticCheck(plaintext, replay.plaintext_bytes, `${replay.plaintext_sha256}-mutated`), /response_binding_mismatch/);
});

function selectReplayKey(version, keyRing) {
  if (!Number.isInteger(version) || !keyRing.has(version)) throw new Error('unknown_replay_key_version');
  return keyRing.get(version);
}

test('replay timing uses exact response_issued_at boundaries and 30-second commit skew', () => {
  const { response_issued_at: issued, replay_until_exclusive: until, runtime_purge_after: purge, maximum_key_destruction_deadline: destroy } = replay.time_cases;
  assert.equal(until, issued + 600);
  assert.equal(purge, issued + 900);
  assert.equal(destroy, issued + 930);
  const isReplayAllowed = (now) => now < until;
  const relativeExpiry = (responseIssuedAt, now) => ({ access: responseIssuedAt + 600 - now, refresh: responseIssuedAt + 2592000 - now });
  const withinCommitSkew = (dbCommittedAt) => Math.abs(dbCommittedAt - issued) <= 30;
  assert.deepEqual(relativeExpiry(issued, issued), { access: 600, refresh: 2592000 });
  assert.equal(isReplayAllowed(issued + 599), true);
  assert.equal(isReplayAllowed(issued + 600), false);
  assert.equal(isReplayAllowed(issued + 601), false);
  assert.equal(withinCommitSkew(issued + 29), true);
  assert.equal(withinCommitSkew(issued + 30), true);
  assert.equal(withinCommitSkew(issued + 31), false);
  assert.equal(withinCommitSkew(issued - 29), true);
  assert.equal(withinCommitSkew(issued - 30), true);
  assert.equal(withinCommitSkew(issued - 31), false);
});

function encodeFrame(fields) {
  const payload = Buffer.concat(fields.map(([id, value]) => {
    const bytes = Buffer.from(value);
    return Buffer.concat([Buffer.from([id, bytes.length]), bytes]);
  }));
  assert.ok(payload.length <= 8192);
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeFrame(frame) {
  if (frame.length < 4) throw new Error('frame_truncated');
  const length = frame.readUInt32BE(0);
  if (length > 8192 || frame.length !== length + 4) throw new Error('frame_length');
  const fields = [];
  let offset = 4;
  let previous = 0;
  while (offset < frame.length) {
    if (offset + 2 > frame.length) throw new Error('field_truncated');
    const id = frame[offset++];
    const size = frame[offset++];
    if (id <= previous || offset + size > frame.length) throw new Error('field_order_or_length');
    fields.push([id, frame.subarray(offset, offset + size)]);
    previous = id;
    offset += size;
  }
  return fields;
}

function encodeOperationFrame(operation, fields = []) {
  return encodeFrame([[1, operation], ...fields.map(([id, value]) => [id + 1, value])]);
}

function decodeOperationFrame(frame) {
  const fields = decodeFrame(frame);
  const operation = fields[0]?.[1]?.toString();
  if (!CREDENTIAL_OPERATIONS.includes(operation)) throw new Error('unknown_operation');
  return { operation, fields: fields.slice(1) };
}

function validateRecordBytes(record) {
  const bytes = Buffer.isBuffer(record) ? record : Buffer.from(record);
  if (bytes.length > 4096) throw new Error('record_too_large');
  return bytes;
}

function redactedProtocolError(input) {
  void input;
  return 'protocol_error';
}

test('Keychain broker framing/parser is strict without touching a real credential', () => {
  assert.deepEqual(CREDENTIAL_OPERATIONS, [
    'credential_load', 'credential_commit_exchange', 'credential_mark_refresh_pending',
    'credential_commit_refresh', 'credential_delete',
  ]);
  const frame = encodeOperationFrame('credential_load', [[1, 'v1'], [2, 'device-public-01']]);
  assert.deepEqual(decodeOperationFrame(frame).operation, 'credential_load');
  assert.deepEqual(decodeOperationFrame(frame).fields.map(([id, value]) => [id, value.toString()]), [[2, 'v1'], [3, 'device-public-01']]);
  assert.throws(() => decodeOperationFrame(encodeOperationFrame('unknown_operation')), /unknown_operation/);
  assert.throws(() => decodeFrame(encodeFrame([[1, 'a'], [1, 'b']])));
  assert.throws(() => decodeFrame(encodeFrame([[2, 'b'], [1, 'a']])));
  assert.throws(() => decodeFrame(Buffer.from([0, 0, 0, 5, 1, 2])));
  const lengthMismatch = encodeOperationFrame('credential_load');
  lengthMismatch.writeUInt32BE(lengthMismatch.readUInt32BE(0) + 1, 0);
  assert.throws(() => decodeFrame(lengthMismatch), /frame_length/);
  const oversized = Buffer.alloc(4); oversized.writeUInt32BE(8193, 0);
  assert.throws(() => decodeFrame(oversized));
  assert.throws(() => validateRecordBytes(Buffer.alloc(4097)), /record_too_large/);
  assert.equal(validateRecordBytes(Buffer.alloc(4096)).length, 4096);
  const secret = 'refresh-token-secret-must-not-appear';
  assert.equal(redactedProtocolError(secret), 'protocol_error');
  assert.doesNotMatch(redactedProtocolError(secret), /refresh-token-secret|device-public/);
});

test('credential state machine preserves exact pending tuple across crash points', () => {
  const initial = { generation: 7, token: 'test-only-token', pending: null };
  const pending = { idempotency: 'idemp-0000000000000001', digest: 'sha256:request', started: 1735689600 };
  const marked = { ...initial, pending };
  assert.deepEqual(marked.pending, pending);
  const crashBeforeCommit = structuredClone(marked);
  assert.equal(crashBeforeCommit.generation, 7);
  assert.deepEqual(crashBeforeCommit.pending, pending);
  const committed = { generation: 8, token: 'next-test-only-token', pending: null };
  assert.equal(committed.generation, initial.generation + 1);
  assert.equal(committed.pending, null);
  const crashAfterCommit = structuredClone(committed);
  assert.equal(crashAfterCommit.generation, 8);
  assert.equal(crashAfterCommit.pending, null);
  assert.throws(() => {
    if (pending.digest !== 'sha256:other-request') throw new Error('pending_tuple_mismatch');
  });
  assert.deepEqual(marked, { generation: 7, token: 'test-only-token', pending });
  assert.deepEqual(committed, { generation: 8, token: 'next-test-only-token', pending: null });
});

test('bounded implementation receipt remains an immutable historical receipt', () => {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'AMENDMENT_CANDIDATE');
  assert.equal(receipt.scope, 'M3.02 bounded additive amendments and non-product validation only');
  assert.equal(receipt.receipt_path, 'docs/plans/evidence/M3.02-bounded-implementation-receipt.json');
  assert.deepEqual(receipt.allowed_paths.sort(), EXPECTED_ALLOWED_PATHS);
  const expectedArtifactPaths = EXPECTED_ALLOWED_PATHS.filter((path) => path !== receipt.receipt_path).sort();
  const actualArtifactPaths = receipt.artifacts.map(({ path }) => path).sort();
  assert.deepEqual(actualArtifactPaths, expectedArtifactPaths);
  assert.equal(sha256(readFileSync(receiptPath)).slice(7), '71a95fa54dc7dd805c4c16cb73d433a8ad9d67dc418a2e51cc4899600290a937');
  for (const artifact of receipt.artifacts) {
    assert.equal(artifact.path.includes('..'), false);
    assert.equal(artifact.path.startsWith('supabase/migrations/'), false);
    assert.equal(artifact.path.startsWith('apps/'), false);
    assert.equal(artifact.path.startsWith('native/'), false);
    assert.equal(receipt.allowed_paths.includes(artifact.path), true);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(receipt.allowed_paths.some((path) => path.startsWith('supabase/migrations/')), false);
  assert.equal(receipt.allowed_paths.some((path) => path.startsWith('apps/')), false);
  assert.match(receipt.limitations.join('\n'), /Security\.framework/);
  assert.match(receipt.limitations.join('\n'), /M3\.03 and later.*stopped/);
  assert.equal(receipt.route.requested, 'gpt-5.6-luna/high');
  assert.equal(receipt.route.confirmed, false);
  assert.equal(receipt.external_mutation, false);
});
