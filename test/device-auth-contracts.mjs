import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  assertExactSpki,
  assertValidP1363,
  buildIdempotencyPreimageV2,
  buildProofPreimageV2,
  computeSha256,
  computeSpkiThumbprint,
  derToP1363,
  DEVICE_AUTH_ABSENT_ACCESS_TOKEN,
  DEVICE_AUTH_AUDIENCE_V1,
  DEVICE_AUTH_ERROR_DESCRIPTIONS,
  DEVICE_AUTH_IDEMPOTENCY_LABEL_V2,
  DEVICE_AUTH_PROOF_LABEL_V2,
  DEVICE_AUTH_SUITE_V2,
  fromBase64Url,
  p1363ToDer,
  toBase64Url,
  verifyP256ProofSignature
} from '../dist/contracts/device-auth.js';

const root = resolve(import.meta.dirname, '..');
const vectorPath = join(root, 'contracts/test-vectors/device-auth-p256-v2.json');
const vector = JSON.parse(readFileSync(vectorPath, 'utf8'));
const VALID_DEVICE_ID = 'D'.repeat(22);
const VALID_TOKEN_FAMILY_ID = `fam_${'c'.repeat(32)}`;
const VALID_REFRESH_TOKEN = 'R'.repeat(43);
const NEXT_REFRESH_TOKEN = 'S'.repeat(43);

test('Device auth contracts constants and labels match v2 specification', () => {
  assert.equal(DEVICE_AUTH_SUITE_V2, 'skillmap.ecdsa-p256-sha256.v2');
  assert.equal(DEVICE_AUTH_AUDIENCE_V1, 'skillmap.connector.v1');
  assert.equal(DEVICE_AUTH_PROOF_LABEL_V2, 'SKILLMAP-DEVICE-PROOF-V2');
  assert.equal(DEVICE_AUTH_IDEMPOTENCY_LABEL_V2, 'SKILLMAP-DEVICE-IDEMPOTENCY-V2');
});

test('buildProofPreimageV2 produces NONE absent-token sentinel and exact 14-line LF-terminated UTF-8 string matching P-256 v2 vector', () => {
  // Omit accessTokenSha256 entirely: the frozen default absent sentinel is the
  // uppercase literal NONE (never sha256:none) used before any access token exists.
  const preimage = buildProofPreimageV2({
    suite: vector.suite,
    method: 'POST',
    origin: 'https://connector.example.test',
    path: '/api/device-auth/v1/exchange',
    audience: 'skillmap.connector.v1',
    purpose: 'exchange',
    deviceId: 'device-000000000000001',
    thumbprint: 'sha256:fixture-key',
    bodySha256: 'sha256:fixture-body',
    idempotencyKey: 'idemp-0000000000000001',
    nonce: 'nonce-0000000000000001',
    issuedAt: 1735689600
  });

  assert.equal(preimage, vector.proof.preimage_utf8);
  assert.equal(computeSha256(preimage), vector.proof.sha256);
  assert.equal(toBase64Url(Buffer.from(preimage, 'utf8')), vector.proof.preimage_base64url);
  assert.equal(preimage.split('\n').length, 15); // 14 lines + 1 trailing empty string from split
  assert.equal(preimage.endsWith('\n'), true);
  // The absent access-token sentinel is exactly uppercase NONE, never sha256:none.
  assert.equal(vector.proof.preimage_utf8.includes('\nNONE\n'), true);
  assert.equal(DEVICE_AUTH_ABSENT_ACCESS_TOKEN, 'NONE');
  assert.equal(vector.proof.preimage_utf8.includes('sha256:none'), false);

  // A provided access token still signs as sha256:<64 hex>, not NONE.
  const withToken = buildProofPreimageV2({
    method: 'POST',
    origin: 'https://connector.example.test',
    path: '/api/device-auth/v1/exchange',
    audience: 'skillmap.connector.v1',
    purpose: 'exchange',
    deviceId: 'device-000000000000001',
    thumbprint: 'sha-256:fixture',
    bodySha256: 'sha256:fixture-body',
    idempotencyKey: 'idemp-0000000000000001',
    nonce: 'nonce-0000000000000001',
    issuedAt: 1735689600,
    accessTokenSha256: `sha256:${'0'.repeat(64)}`
  });
  assert.equal(withToken.includes('sha256:0000000000000000000000000000000000000000000000000000000000000000'), true);
});

test('InitiatePairingRequest is a closed schema with key_thumbprint and proof_suite bound to the frozen suite', async () => {
  const schema = JSON.parse(
    readFileSync(join(root, 'contracts/device-auth/v1/initiate-request.schema.json'), 'utf8')
  );
  const required = schema.required;
  assert.ok(required.includes('key_thumbprint'), 'initiate schema must require key_thumbprint');
  assert.ok(required.includes('proof_suite'), 'initiate schema must require proof_suite');
  assert.equal(schema.properties.proof_suite['$ref'].includes('ProofSuite'), true);
  assert.equal(schema.additionalProperties, false, 'initiate schema is closed');
  // The fixture's proof suite is the frozen P-256 v2 suite.
  assert.equal(DEVICE_AUTH_SUITE_V2, 'skillmap.ecdsa-p256-sha256.v2');
});

test('buildIdempotencyPreimageV2 produces exact 9-line LF-terminated UTF-8 string matching P-256 v2 vector', () => {
  const preimage = buildIdempotencyPreimageV2({
    suite: vector.suite,
    method: 'POST',
    origin: 'https://connector.example.test',
    path: '/api/device-auth/v1/exchange',
    audience: 'skillmap.connector.v1',
    operation: 'exchange',
    bodySha256: 'sha256:fixture-body',
    idempotencyKey: 'idemp-0000000000000001'
  });

  assert.equal(preimage, vector.idempotency.preimage_utf8);
  assert.equal(computeSha256(preimage), vector.idempotency.sha256);
  assert.equal(toBase64Url(Buffer.from(preimage, 'utf8')), vector.idempotency.preimage_base64url);
  assert.equal(preimage.split('\n').length, 10); // 9 lines + 1 trailing empty string
  assert.equal(preimage.endsWith('\n'), true);
});

test('SPKI parsing and thumbprint calculation match fixture vector', () => {
  const spkiBytes = fromBase64Url(vector.public_key.der_spki_base64url);
  assert.equal(spkiBytes.length, vector.public_key.der_spki_bytes);
  assertExactSpki(spkiBytes);

  const thumbprint = computeSpkiThumbprint(spkiBytes);
  assert.equal(thumbprint, vector.public_key.thumbprint);
});

test('IEEE P1363 signature encoding and DER conversion round-trip accurately', () => {
  const p1363Signature = fromBase64Url(vector.signature.p1363_base64url);
  assert.equal(p1363Signature.length, 64);
  assertValidP1363(p1363Signature);

  const derSignature = p1363ToDer(p1363Signature);
  const derBase64Url = toBase64Url(derSignature);
  assert.equal(derBase64Url, vector.signature.der_conversion_only_base64url);

  const recoveredP1363 = derToP1363(derSignature);
  assert.deepEqual(recoveredP1363, p1363Signature);
});

test('verifyP256ProofSignature validates vector preimage and signature successfully', () => {
  const preimageUtf8 = vector.proof.preimage_utf8;
  const spkiBytes = fromBase64Url(vector.public_key.der_spki_base64url);
  const p1363Signature = fromBase64Url(vector.signature.p1363_base64url);

  const valid = verifyP256ProofSignature(preimageUtf8, spkiBytes, p1363Signature);
  assert.equal(valid, true);

  // Mutated preimage should fail
  const mutatedPreimage = preimageUtf8.replace('POST', 'GET');
  assert.equal(verifyP256ProofSignature(mutatedPreimage, spkiBytes, p1363Signature), false);
});

test('All canonical error codes map to non-empty fixed error descriptions', () => {
  const expectedCodes = [
    'invalid_request',
    'invalid_scope',
    'invalid_grant',
    'authorization_pending',
    'slow_down',
    'access_denied',
    'expired_token',
    'invalid_client',
    'invalid_token',
    'proof_required',
    'proof_invalid',
    'insufficient_scope',
    'already_consumed',
    'idempotency_conflict',
    'rate_limited',
    'secure_storage_unavailable',
    'temporarily_unavailable'
  ];

  for (const code of expectedCodes) {
    const desc = DEVICE_AUTH_ERROR_DESCRIPTIONS[code];
    assert.ok(desc && desc.length > 0, `Description for ${code} must exist`);
    assert.doesNotMatch(desc, /undefined|null/);
  }
});

test('normalizeAndValidateOrigin enforces strict HTTP(S) rules, local HTTP restrictions, and rejects path/query/fragment/credentials', async () => {
  const { normalizeAndValidateOrigin } = await import('../dist/contracts/device-auth.js');

  // Valid origins
  assert.equal(normalizeAndValidateOrigin('https://api.skillmap.dev'), 'https://api.skillmap.dev');
  assert.equal(normalizeAndValidateOrigin('https://api.skillmap.dev/'), 'https://api.skillmap.dev');
  assert.equal(normalizeAndValidateOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeAndValidateOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');

  // Invalid non-local HTTP origin
  assert.throws(() => normalizeAndValidateOrigin('http://api.skillmap.dev'), /HTTP origin.*rejected/);

  // Invalid path, query, fragment, credentials
  assert.throws(() => normalizeAndValidateOrigin('https://api.skillmap.dev/api/v1'), /path/);
  assert.throws(() => normalizeAndValidateOrigin('https://api.skillmap.dev?key=value'), /query/);
  assert.throws(() => normalizeAndValidateOrigin('https://api.skillmap.dev#section'), /fragment/);
  assert.throws(() => normalizeAndValidateOrigin('https://user:pass@api.skillmap.dev'), /credentials/);
  assert.throws(() => normalizeAndValidateOrigin('ftp://api.skillmap.dev'), /protocol/);
  assert.throws(() => normalizeAndValidateOrigin('not-a-url'), /Invalid origin URL/);
});

test('InMemoryCredentialStore uses seconds-based timestamp and supports injectable clock', async () => {
  const { InMemoryCredentialStore } = await import('../dist/platform/credential-store.js');

  const fixedSecondsClock = () => 1735689600;
  const store = new InMemoryCredentialStore(fixedSecondsClock);

  await store.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: VALID_REFRESH_TOKEN,
    scopes: ['device.status'],
    updatedAt: 0
  });

  const record = await store.load();
  assert.equal(record.updatedAt, 1735689600); // Must be in seconds, not milliseconds!
  assert.ok(record.updatedAt < 2000000000);

  await store.replaceRefreshGeneration(NEXT_REFRESH_TOKEN);
  const updatedRecord = await store.load();
  assert.equal(updatedRecord.updatedAt, 1735689600);
});
