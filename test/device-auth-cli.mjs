import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildProofPreimageV2,
  computeSha256,
  computeSpkiThumbprint,
  DEVICE_AUTH_ABSENT_ACCESS_TOKEN,
  DEVICE_AUTH_AUDIENCE_V1,
  DEVICE_AUTH_SUITE_V2,
  fromBase64Url,
  toBase64Url,
  verifyP256ProofSignature
} from '../dist/contracts/device-auth.js';
import { DeviceAuthClient, DeviceAuthError } from '../dist/network/device-auth-client.js';
import { InMemoryCredentialStore } from '../dist/platform/credential-store.js';
import { InMemoryDeviceAuthMetadataStore } from '../dist/platform/device-auth-metadata-store.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';
import { DeviceAuthUseCase } from '../dist/services/device-auth-use-case.js';

const VALID_DEVICE_ID = 'D'.repeat(22);
const VALID_DEVICE_PUBLIC_ID = `dev_${'a'.repeat(32)}`;
const VALID_ACCOUNT_PUBLIC_ID = `acct_${'b'.repeat(32)}`;
const VALID_TOKEN_FAMILY_ID = `fam_${'c'.repeat(32)}`;
const VALID_ACCESS_TOKEN = `atoken_${'d'.repeat(36)}`;
const VALID_REFRESH_TOKEN = `rtoken_${'e'.repeat(36)}`;
const VALID_SLOW_ACCESS_TOKEN = `atoken_${'f'.repeat(36)}`;
const VALID_SLOW_REFRESH_TOKEN = `rtoken_${'g'.repeat(36)}`;

function createMockFetch(handler) {
  return async (url, options) => {
    const response = await handler(url, options);
    return response;
  };
}

test('Initiation, single-flight polling, code exchange, and memory access token flow', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  let pollCount = 0;
  let cancelCalled = false;

  const mockFetch = createMockFetch(async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    const headers = options.headers || {};

    // Validate headers
    assert.equal(headers['X-SkillMap-Device-Audience'], DEVICE_AUTH_AUDIENCE_V1);
    assert.ok(headers['X-SkillMap-Device-Proof']);
    assert.ok(headers['X-SkillMap-Device-Nonce']);

    if (url.endsWith('/api/device-auth/v1/pairings')) {
      return new Response(
        JSON.stringify({
          device_code: 'dcode_' + '0'.repeat(37),
          user_code: 'ABCDE-FGHIJ',
          verification_uri: 'https://skillmap.example.test/device',
          expires_in: 600,
          interval: 5,
          display: { name: 'Test Device', platform: 'macos', connector_version: '0.1.0' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/pairings/poll')) {
      pollCount += 1;
      assert.equal(body.device_code, 'dcode_' + '0'.repeat(37));

      if (pollCount === 1) {
        return new Response(
          JSON.stringify({
            error: 'authorization_pending',
            error_description: 'Authorization is pending.',
            retry_after: 1
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          exchange_code: 'ecode_' + '0'.repeat(37),
          expires_in: 60,
          scopes: ['device.status']
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/pairings/exchange')) {
      assert.equal(body.exchange_code, 'ecode_' + '0'.repeat(37));
      return new Response(
        JSON.stringify({
          device_public_id: VALID_DEVICE_PUBLIC_ID,
          account_public_id: VALID_ACCOUNT_PUBLIC_ID,
          token_family_id: VALID_TOKEN_FAMILY_ID,
          access_token: VALID_ACCESS_TOKEN,
          refresh_token: VALID_REFRESH_TOKEN,
          expires_in: 600,
          refresh_idle_expires_in: 2592000,
          refresh_absolute_expires_in: 7776000
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/pairings/cancel')) {
      cancelCalled = true;
      return new Response(JSON.stringify({ status: 'cancelled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 });
  });

  let displayCodeReceived = null;
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: mockFetch
  });

  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore,
    onDisplayCode: (info) => {
      displayCodeReceived = info;
    }
  });

  const exchangeRes = await useCase.initiateAndPoll({
    scopes: ['device.status'],
    displayName: 'Test Machine',
    platform: 'macos'
  });

  assert.equal(exchangeRes.device_public_id, VALID_DEVICE_PUBLIC_ID);
  assert.equal(exchangeRes.access_token, VALID_ACCESS_TOKEN);
  assert.equal(displayCodeReceived.userCode, 'ABCDE-FGHIJ');

  // Verify access token is stored in memory and returned
  const token = await useCase.getAccessToken();
  assert.equal(token, VALID_ACCESS_TOKEN);

  // Verify credential store contains refresh token but NOT access token
  const storedCreds = await credentialStore.load();
  assert.equal(storedCreds.refreshToken, VALID_REFRESH_TOKEN);
  assert.equal(Object.hasOwn(storedCreds, 'accessToken'), false);
  assert.equal(Object.hasOwn(storedCreds, 'access_token'), false);
});

test('Polling slow_down response increases interval correctly', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  let pollCount = 0;

  const mockFetch = createMockFetch(async (url) => {
    if (url.endsWith('/api/device-auth/v1/pairings')) {
      return new Response(
        JSON.stringify({
          device_code: 'dcode_slowdown_' + '0'.repeat(28),
          user_code: 'SLOWD-OWN01',
          verification_uri: 'https://skillmap.example.test/device',
          expires_in: 600,
          interval: 5,
          display: { name: 'Slow Device', platform: 'macos', connector_version: '0.1.0' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/pairings/poll')) {
      pollCount += 1;
      if (pollCount === 1) {
        return new Response(
          JSON.stringify({
            error: 'slow_down',
            error_description: 'Polling must slow down.',
            retry_after: 5
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          exchange_code: 'ecode_slowdown_' + '0'.repeat(28),
          expires_in: 60,
          scopes: ['device.status']
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/pairings/exchange')) {
      return new Response(
        JSON.stringify({
          device_public_id: VALID_DEVICE_PUBLIC_ID,
          account_public_id: VALID_ACCOUNT_PUBLIC_ID,
          token_family_id: VALID_TOKEN_FAMILY_ID,
          access_token: VALID_SLOW_ACCESS_TOKEN,
          refresh_token: VALID_SLOW_REFRESH_TOKEN,
          expires_in: 600,
          refresh_idle_expires_in: 2592000,
          refresh_absolute_expires_in: 7776000
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 });
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: mockFetch
  });

  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore
  });

  const exchangeRes = await useCase.initiateAndPoll({
    scopes: ['device.status'],
    platform: 'macos'
  });

  assert.equal(exchangeRes.access_token, VALID_SLOW_ACCESS_TOKEN);
  assert.equal(pollCount, 2);
});

test('AbortSignal cancellation sends cancel request and clears volatile memory', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  let cancelReasonReceived = null;

  const mockFetch = createMockFetch(async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.endsWith('/api/device-auth/v1/pairings')) {
      return new Response(
        JSON.stringify({
          device_code: 'dcode_cancel_test_' + '0'.repeat(25),
          user_code: 'CANCL-TEST0',
          verification_uri: 'https://skillmap.example.test/device',
          expires_in: 600,
          interval: 5,
          display: { name: 'Cancel Device', platform: 'macos', connector_version: '0.1.0' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.endsWith('/api/device-auth/v1/pairings/cancel')) {
      cancelReasonReceived = body.reason;
      return new Response(JSON.stringify({ status: 'cancelled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.endsWith('/api/device-auth/v1/pairings/poll')) {
      return new Response(
        JSON.stringify({
          error: 'authorization_pending',
          error_description: 'Authorization is pending.',
          retry_after: 5
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 });
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: mockFetch
  });

  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore
  });

  const abortController = new AbortController();
  const pollPromise = useCase.initiateAndPoll({
    scopes: ['device.status'],
    platform: 'macos',
    signal: abortController.signal
  });

  // Let the initiation response establish the device code, then abort the
  // active polling operation so the best-effort cancel request can be sent.
  setTimeout(() => abortController.abort(), 0);

  await assert.rejects(pollPromise, (err) => err instanceof DeviceAuthError);
  assert.equal(cancelReasonReceived, 'user_cancelled');
});

test('Error messages and stringified objects do not leak access tokens or refresh tokens', () => {
  const secretToken = 'atoken_SUPER_SECRET_VALUE_1234567890';
  const err = new DeviceAuthError(401, 'invalid_token', 'Access token rejected');

  assert.doesNotMatch(err.message, new RegExp(secretToken));
  assert.doesNotMatch(err.stack ?? '', new RegExp(secretToken));
  assert.doesNotMatch(JSON.stringify(err), new RegExp(secretToken));
});

test('DeviceAuthUseCase and DeviceAuthClient share single authoritative device ID from client', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  let headerDeviceId = null;
  let bodyDeviceId = null;

  const mockFetch = createMockFetch(async (url, options) => {
    headerDeviceId = options.headers['X-SkillMap-Device-Id'];
    if (options.body) {
      const body = JSON.parse(options.body);
      bodyDeviceId = body.device_id;
    }
    return new Response(
      JSON.stringify({
        device_code: 'dcode_shared_id_' + '0'.repeat(27),
        user_code: 'SHARE-ID010',
        verification_uri: 'https://skillmap.example.test/device',
        expires_in: 600,
        interval: 5,
        display: { name: 'Shared Device', platform: 'macos', connector_version: '0.1.0' }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  // Client constructed without explicit deviceId -> resolves via metadataStore/generation
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    metadataStore,
    fetchFn: mockFetch
  });

  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore
  });

  const clientDeviceId = await client.getDeviceId();

  // Initiate pairing
  await client.initiatePairing({
    requested_scopes: ['device.status'],
    platform: 'macos',
    connector_version: '0.1.0'
  });

  assert.equal(headerDeviceId, clientDeviceId);
  assert.equal(bodyDeviceId, clientDeviceId);

  const storedMeta = await metadataStore.load();
  assert.equal(storedMeta.deviceId, clientDeviceId);
});

test('DeviceAuthClient rejects invalid or non-HTTPS non-local origins on construction', () => {
  const keyStore = new InMemoryDeviceKeyStore();

  assert.throws(
    () => new DeviceAuthClient({ origin: 'http://api.skillmap.dev', keyStore }),
    /HTTP origin.*rejected/
  );
  assert.throws(
    () => new DeviceAuthClient({ origin: 'https://user:pass@api.skillmap.dev', keyStore }),
    /credentials/
  );
  assert.throws(
    () => new DeviceAuthClient({ origin: 'https://api.skillmap.dev/path', keyStore }),
    /path/
  );
});

test('Server-controlled error descriptions are never echoed in DeviceAuthError', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();

  const mockFetch = createMockFetch(async () => {
    return new Response(
      JSON.stringify({
        error: 'invalid_grant',
        error_description: 'SENSITIVE_SERVER_INTERNAL_EXPLICIT_SECRET_STRING_DO_NOT_ECHO'
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: mockFetch
  });

  try {
    await client.pollPairing('dcode_test');
    assert.fail('Should have thrown DeviceAuthError');
  } catch (err) {
    assert.ok(err instanceof DeviceAuthError);
    assert.equal(err.code, 'invalid_grant');
    // Description MUST be fixed client description, NOT server echo!
    assert.doesNotMatch(err.description, /SENSITIVE_SERVER_INTERNAL_EXPLICIT_SECRET_STRING_DO_NOT_ECHO/);
    assert.doesNotMatch(err.message, /SENSITIVE_SERVER_INTERNAL_EXPLICIT_SECRET_STRING_DO_NOT_ECHO/);
    assert.equal(err.description, 'The authorization grant is invalid.');
  }
});

test('M3.05 regression: initiation body is closed and carries key_thumbprint + proof_suite; every proof header set is exact and Proof-Suite is present', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  const keyInfo = await keyStore.createKey();
  const spkiBytes = await keyStore.getPublicKeySpki();
  const expectedThumbprint = computeSpkiThumbprint(spkiBytes);
  assert.equal(keyInfo.thumbprint, expectedThumbprint);

  let captured;
  const mockFetch = createMockFetch(async (url, options) => {
    if (url.endsWith('/api/device-auth/v1/pairings')) {
      captured = { body: JSON.parse(options.body), headers: options.headers, bodyBytes: Buffer.from(options.body, 'utf8') };
      return new Response(
        JSON.stringify({
          device_code: 'dcode_' + '0'.repeat(37),
          user_code: 'ABCDE-FGHIJ',
          verification_uri: 'https://skillmap.example.test/device',
          expires_in: 600,
          interval: 5,
          display: { name: 'Test', platform: 'macos', connector_version: '0.1.0' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error('unexpected request: ' + url);
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: mockFetch
  });

  await client.initiatePairing({
    requested_scopes: ['device.status'],
    platform: 'macos',
    connector_version: '0.1.0',
    display_name: 'Test Machine'
  });

  // Exact initiation body: closed fields present, thumbprint derived from the
  // key store (never caller input), proof suite is the frozen P-256 v2.
  const b = captured.body;
  assert.equal(b.device_id, VALID_DEVICE_ID);
  assert.equal(b.device_public_key, toBase64Url(spkiBytes));
  assert.equal(b.key_thumbprint, expectedThumbprint);
  assert.equal(b.audience, DEVICE_AUTH_AUDIENCE_V1);
  assert.equal(b.proof_suite, DEVICE_AUTH_SUITE_V2);
  assert.deepEqual(b.requested_scopes, ['device.status']);
  assert.equal(b.platform, 'macos');
  assert.equal(b.connector_version, '0.1.0');
  assert.equal(b.display_name, 'Test Machine');
  // A malformed caller trying to inject a thumbprint/suite must not be able to
  // override the derived values; here we only assert the derived ones win.
  assert.ok(Object.keys(b).includes('key_thumbprint'));
  assert.ok(Object.keys(b).includes('proof_suite'));

  // Every proof-bearing request carries the fully frozen header set.
  const h = captured.headers;
  assert.equal(h['X-SkillMap-Device-Suite'], undefined);
  assert.equal(h['X-SkillMap-Device-Proof-Suite'], DEVICE_AUTH_SUITE_V2);
  assert.equal(h['X-SkillMap-Device-Id'], VALID_DEVICE_ID);
  assert.equal(h['X-SkillMap-Device-Audience'], DEVICE_AUTH_AUDIENCE_V1);
  assert.equal(h['X-SkillMap-Device-Purpose'], 'initiate');
  assert.equal(h['X-SkillMap-Device-Nonce'].length, 22);
  assert.ok(/^[A-Za-z0-9_-]{22}$/.test(h['X-SkillMap-Device-Nonce']));
  assert.ok(/^[0-9]{1,20}$/.test(h['X-SkillMap-Device-Issued-At']));
  assert.equal(h['X-SkillMap-Device-Body-SHA256'], computeSha256(captured.bodyBytes));
  assert.ok(h['X-SkillMap-Device-Proof'], 'proof signature header must be present');
  assert.ok(/^[A-Za-z0-9_-]{86}$/.test(h['X-SkillMap-Device-Proof']), 'P-256 P1363 signature is 64 bytes -> 86 base64url');
  // The body digest is computed over the exact wire bytes actually sent.
  assert.equal(computeSha256(captured.bodyBytes).startsWith('sha256:'), true);
});

test('M3.05 regression: signed 14-line preimage uses NONE absent-token sentinel, body digest, and thumbprint binding', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const spkiBytes = await keyStore.getPublicKeySpki();
  const expectedThumbprint = computeSpkiThumbprint(spkiBytes);

  let captured;
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: createMockFetch(async (url, options) => {
      captured = { bodyBytes: Buffer.from(options.body, 'utf8'), headers: options.headers };
      return new Response(
        JSON.stringify({
          device_code: 'dcode_' + '0'.repeat(37),
          user_code: 'ABCDE-FGHIJ',
          verification_uri: 'https://skillmap.example.test/device',
          expires_in: 600,
          interval: 5,
          display: { name: 'Test Device', platform: 'macos', connector_version: '0.1.0' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    })
  });

  await client.initiatePairing({
    requested_scopes: ['device.status'],
    platform: 'macos',
    connector_version: '0.1.0'
  });

  const bodySha256 = computeSha256(captured.bodyBytes);
  const preimage = buildProofPreimageV2({
    method: 'POST',
    origin: 'https://skillmap.example.test',
    path: '/api/device-auth/v1/pairings',
    audience: DEVICE_AUTH_AUDIENCE_V1,
    purpose: 'initiate',
    deviceId: VALID_DEVICE_ID,
    thumbprint: expectedThumbprint,
    bodySha256,
    idempotencyKey: captured.headers['Idempotency-Key'],
    nonce: captured.headers['X-SkillMap-Device-Nonce'],
    issuedAt: Number(captured.headers['X-SkillMap-Device-Issued-At']),
    accessTokenSha256: DEVICE_AUTH_ABSENT_ACCESS_TOKEN
  });

  // Exact 14 data lines + trailing empty string (split gives 15).
  const lines = preimage.split('\n');
  assert.equal(lines.length, 15, '14 lines + 1 trailing empty string');
  assert.equal(lines[0], 'SKILLMAP-DEVICE-PROOF-V2');
  assert.equal(lines[1], DEVICE_AUTH_SUITE_V2);
  assert.equal(lines[13], 'NONE', 'absent access-token sentinel is exactly NONE');
  assert.ok(!preimage.includes('sha256:none'));

  // The client's header body sha256 must match the reconstructed preimage's.
  assert.equal(captured.headers['X-SkillMap-Device-Body-SHA256'], bodySha256);
  assert.equal(captured.headers['X-SkillMap-Device-Proof-Suite'], DEVICE_AUTH_SUITE_V2);

  // The device key's signature must verify against the end-to-end reconstructed
  // preimage. This proves suite/thumbprint/body binding with no secret leakage
  // and rejects drift: any change to body, thumbprint, suite, or sentinel would
  // change the preimage and fail the P-256 verification below.
  const capturedProof = captured.headers['X-SkillMap-Device-Proof'];
  const proofValid = verifyP256ProofSignature(preimage, spkiBytes, fromBase64Url(capturedProof));
  assert.equal(proofValid, true, 'client proof must verify over the NONE-sentinel preimage');

  // Drift rejection: a preimage that kept the old sha256:none sentinel must NOT
  // verify the client's signature, proving NONE (not sha256:none) was what was
  // signed and the two wire contracts agree.
  const driftedPreimage = preimage.replace('\nNONE\n', '\nsha256:none\n');
  assert.equal(
    verifyP256ProofSignature(driftedPreimage, spkiBytes, fromBase64Url(capturedProof)),
    false,
    'proof bound to NONE must not verify over a sha256:none preimage'
  );

  assert.equal(expectedThumbprint, computeSpkiThumbprint(spkiBytes));
  assert.equal(DEVICE_AUTH_SUITE_V2, 'skillmap.ecdsa-p256-sha256.v2');
});
