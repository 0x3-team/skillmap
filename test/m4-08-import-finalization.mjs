import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImportClient, ImportClientError } from '../dist/network/import-client.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';

const ORIGIN = 'https://skillmap.example.test';
const DEVICE_ID = 'D'.repeat(22);
const OTHER_DEVICE_ID = 'O'.repeat(22);
const ACCESS_TOKEN = 'T'.repeat(43);
const SESSION_ID = `imp_${'a'.repeat(32)}`;
const MANIFEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const EXPIRES_AT = '2026-08-20T12:00:00.000Z';
const VERSION_ID = `msv_${'2'.repeat(32)}`;

async function makeClient(fetchFn, options = {}) {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  return new ImportClient({
    origin: ORIGIN,
    keyStore,
    deviceId: DEVICE_ID,
    fetchFn,
    ...options
  });
}

function validFinalizeResponse() {
  return new Response(JSON.stringify({
    session_public_id: SESSION_ID,
    state: 'verified',
    verification_digest: MANIFEST_DIGEST,
    version_public_id: VERSION_ID,
    finalized_revision: 4,
    owner_consent_id: `icn_${'3'.repeat(32)}`,
    consent_digest: `sha256:${'4'.repeat(64)}`,
    explicit_consent_at: '2026-08-20T11:55:00Z',
    consent_expires_at: '2026-08-20T12:05:00Z',
    cutover_authority_id: `cut_${'5'.repeat(32)}`
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function sessionResponse(overrides = {}) {
  return {
    session_public_id: SESSION_ID,
    state: 'in_progress',
    expected_file_count: 2,
    expected_byte_total: 18,
    accepted_file_count: 2,
    accepted_byte_total: 18,
    revision: 3,
    expires_at: EXPIRES_AT,
    ...overrides
  };
}

test('M4.08 finalizeImportSession calls the correct route and returns a verified response', async () => {
  let captured;
  const client = await makeClient(async (url, init) => {
    captured = { url, method: init.method, body: JSON.parse(init.body), headers: init.headers };
    return validFinalizeResponse();
  });
  const providedKey = 'F'.repeat(22);
  const result = await client.finalizeImportSession({
    sessionPublicId: SESSION_ID,
    expectedRevision: 3,
    idempotencyKey: providedKey
  }, { accessToken: ACCESS_TOKEN });

  assert.equal(captured.url, `${ORIGIN}/api/import/v1/sessions/${SESSION_ID}/finalize`);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.body.expected_revision, 3);
  assert.equal(captured.body.idempotency_key, providedKey);
  assert.equal(captured.headers['Idempotency-Key'], providedKey);
  assert.equal(result.sessionPublicId, SESSION_ID);
  assert.equal(result.state, 'verified');
  assert.equal(result.verificationDigest, MANIFEST_DIGEST);
  assert.equal(result.versionPublicId, VERSION_ID);
  assert.equal(result.finalizedRevision, 4);
  assert.equal(result.ownerConsentId, `icn_${'3'.repeat(32)}`);
});

test('M4.08 finalization is idempotent and retries return the same verification digest', async () => {
  const attempts = [];
  const client = await makeClient(async (url, init) => {
    attempts.push({ headers: init.headers });
    if (attempts.length === 1) {
      return new Response(JSON.stringify({
        error: 'temporarily_unavailable',
        error_description: 'The import service is temporarily unavailable.',
        retry_after: 0
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return validFinalizeResponse();
  }, { maxRetries: 2 });
  const providedKey = 'G'.repeat(22);
  const result = await client.finalizeImportSession({
    sessionPublicId: SESSION_ID,
    expectedRevision: 3,
    idempotencyKey: providedKey
  }, { accessToken: ACCESS_TOKEN });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].headers['Idempotency-Key'], providedKey);
  assert.equal(attempts[1].headers['Idempotency-Key'], providedKey);
  assert.equal(result.verificationDigest, MANIFEST_DIGEST);
});

test('M4.08 rejects finalization for incomplete or tampered sessions', async () => {
  const cases = [
    { status: 409, code: 'owner_consent_required', body: { error: 'owner_consent_required', error_description: 'Owner consent is required before this import can be finalized.', retry_after: 0 } },
    { status: 409, code: 'session_conflict', body: { error: 'session_conflict', error_description: 'The import session conflicts with a concurrent operation.', retry_after: 0 } },
    { status: 410, code: 'session_expired', body: { error: 'session_expired', error_description: 'The import session has expired.', retry_after: 0 } },
    { status: 400, code: 'invalid_request', body: { error: 'invalid_request', error_description: 'The import request is invalid.', retry_after: 0 } }
  ];
  for (const { status, code, body } of cases) {
    const client = await makeClient(async () => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    }), { maxRetries: 0 });
    await assert.rejects(
      client.finalizeImportSession({ sessionPublicId: SESSION_ID, expectedRevision: 3 }, { accessToken: ACCESS_TOKEN }),
      (err) => {
        assert.ok(err instanceof ImportClientError);
        assert.equal(err.code, code);
        return true;
      }
    );
  }
});

test('M4.08 rejects malformed finalize responses', async () => {
  const badResponses = [
    new Response(JSON.stringify({ session_public_id: SESSION_ID, state: 'verified' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ session_public_id: SESSION_ID, state: 'in_progress', verification_digest: MANIFEST_DIGEST }), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ session_public_id: SESSION_ID, state: 'verified', verification_digest: 'sha256:short' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ session_public_id: SESSION_ID, state: 'verified', verification_digest: MANIFEST_DIGEST, account_id: 'leak' }), { status: 200, headers: { 'content-type': 'application/json' } })
  ];
  for (const response of badResponses) {
    const client = await makeClient(async () => response, { maxRetries: 0 });
    await assert.rejects(
      client.finalizeImportSession({ sessionPublicId: SESSION_ID, expectedRevision: 3 }, { accessToken: ACCESS_TOKEN }),
      (err) => err instanceof ImportClientError && err.code === 'invalid_response'
    );
  }
});

test('M4.08 enforces cross-device isolation through proof headers', async () => {
  const captured = [];
  const goodClient = await makeClient(async (url, init) => {
    captured.push({ deviceId: init.headers['X-SkillMap-Device-Id'] });
    return validFinalizeResponse();
  });
  await goodClient.finalizeImportSession({ sessionPublicId: SESSION_ID, expectedRevision: 3 }, { accessToken: ACCESS_TOKEN });
  assert.equal(captured[0].deviceId, DEVICE_ID);

  const otherKeyStore = new InMemoryDeviceKeyStore();
  await otherKeyStore.createKey();
  const otherClient = new ImportClient({
    origin: ORIGIN,
    keyStore: otherKeyStore,
    deviceId: OTHER_DEVICE_ID,
    fetchFn: async (url, init) => {
      captured.push({ deviceId: init.headers['X-SkillMap-Device-Id'] });
      if (init.headers['X-SkillMap-Device-Id'] !== DEVICE_ID) {
        return new Response(JSON.stringify({
          error: 'unauthorized',
          error_description: 'The import request is not authorized.',
          retry_after: 0
        }), { status: 401, headers: { 'content-type': 'application/json' } });
      }
      return validFinalizeResponse();
    }
  });
  await assert.rejects(
    otherClient.finalizeImportSession({ sessionPublicId: SESSION_ID, expectedRevision: 3 }, { accessToken: ACCESS_TOKEN }),
    (err) => err instanceof ImportClientError && err.code === 'unauthorized'
  );
});
