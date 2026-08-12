import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DeviceAuthClient,
  DeviceAuthError
} from '../dist/network/device-auth-client.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';

const VALID_DEVICE_ID = 'D'.repeat(22);
const VALID_DEVICE_PUBLIC_ID = `dev_${'a'.repeat(32)}`;
const VALID_ACCOUNT_PUBLIC_ID = `acct_${'b'.repeat(32)}`;
const VALID_ACCESS_TOKEN = 'T'.repeat(43);

async function makeClient(fetchFn, options = {}) {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  return new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn,
    ...options
  });
}

function statusBody() {
  return {
    device_public_id: VALID_DEVICE_PUBLIC_ID,
    account_public_id: VALID_ACCOUNT_PUBLIC_ID,
    state: 'active',
    scopes: ['device.status'],
    expires_at: 1_800_000_000,
    key_thumbprint: `sha256:${'1'.repeat(64)}`
  };
}

const VALID_EXCHANGE_CODE = 'E'.repeat(43);
const VALID_EXCHANGE_RESPONSE = {
  device_public_id: VALID_DEVICE_PUBLIC_ID,
  account_public_id: VALID_ACCOUNT_PUBLIC_ID,
  token_family_id: `fam_${'c'.repeat(32)}`,
  access_token: 'A'.repeat(43),
  refresh_token: 'B'.repeat(43),
  expires_in: 600,
  refresh_idle_expires_in: 2_592_000,
  refresh_absolute_expires_in: 7_776_000
};

test('M3.07 rejects production HTTP and path query/fragment/foreign-origin injection', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  assert.throws(
    () => new DeviceAuthClient({ origin: 'http://localhost:3000', keyStore, production: true }),
    /requires HTTPS/
  );

  const client = await makeClient(async () => new Response(JSON.stringify(statusBody()), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));
  for (const devicePublicId of ['device?token=canary', 'device#fragment', '../../foreign-origin']) {
    await assert.rejects(
    client.getStatus({ devicePublicId, accessToken: VALID_ACCESS_TOKEN }),
      (error) => error instanceof DeviceAuthError && error.code === 'invalid_request'
    );
  }
});

test('M3.07 accepts exact loopback HTTP verification binding while rejecting URI authority changes', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const valid = {
    device_code: 'A'.repeat(43),
    user_code: 'ABCDE-FGHIJ',
    verification_uri: 'http://localhost/device',
    expires_in: 600,
    interval: 5,
    display: { name: 'Loopback Device', platform: 'macos', connector_version: '1.2.3' }
  };
  const client = new DeviceAuthClient({
    origin: 'http://localhost',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: async () => new Response(JSON.stringify(valid), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });
  const accepted = await client.initiatePairing({ requested_scopes: ['device.status'], platform: 'macos', connector_version: '0.1.0' });
  assert.equal(accepted.verification_uri, 'http://localhost/device');

  for (const verification_uri of [
    'http://localhost:80/device',
    'http://127.0.0.1/device',
    'http://localhost/device?token=canary',
    'http://localhost/device#fragment',
    'http://localhost.evil/device',
    'http://user:pass@localhost/device',
    'http://localhost/other'
  ]) {
    const invalidClient = new DeviceAuthClient({
      origin: 'http://localhost',
      keyStore,
      deviceId: VALID_DEVICE_ID,
      fetchFn: async () => new Response(JSON.stringify({ ...valid, verification_uri }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    });
    await assert.rejects(
      invalidClient.initiatePairing({ requested_scopes: ['device.status'], platform: 'macos', connector_version: '0.1.0' }),
      (error) => error instanceof DeviceAuthError && error.status === 502
    );
  }
});

test('M3.07 injects auth and request identity headers without putting credentials in the URL', async () => {
  let captured;
  const client = await makeClient(async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify(statusBody()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });
  await client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: 'T'.repeat(43) });
  assert.equal(captured.url, `https://skillmap.example.test/api/device-auth/v1/devices/${VALID_DEVICE_PUBLIC_ID}`);
  assert.equal(captured.options.headers.Authorization, `Bearer ${'T'.repeat(43)}`);
  assert.match(captured.options.headers['X-Request-Id'], /^[A-Za-z0-9_-]{22}$/);
  assert.equal(captured.options.redirect, 'error');
  assert.doesNotMatch(captured.url, /T{43}/);
});

test('M3.07 rejects non-JSON, primitive, and malformed success bodies without retrying', async () => {
  for (const response of [
    new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    new Response(JSON.stringify(['not', 'an', 'object']), { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ state: 'missing required fields' }), { status: 200, headers: { 'content-type': 'application/json' } })
  ]) {
    let calls = 0;
    const client = await makeClient(async () => {
      calls += 1;
      return response;
    }, { maxRetries: 3 });
    await assert.rejects(client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
      assert.ok(error instanceof DeviceAuthError);
      assert.equal(error.code, 'temporarily_unavailable');
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('M3.07 enforces a hard streamed response cap', async () => {
  let calls = 0;
  const client = await makeClient(async () => {
    calls += 1;
    return new Response(JSON.stringify({ ...statusBody(), extra: 'x'.repeat(4_000) }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }, { maxResponseBytes: 256, maxRetries: 3 });
  await assert.rejects(client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.code, 'temporarily_unavailable');
    assert.doesNotMatch(error.message, /x{20}/);
    return true;
  });
  assert.equal(calls, 1, 'malformed/oversized success must not be retried');
});

test('M3.07 validates revoke success fields instead of accepting a status-only body', async () => {
  const client = await makeClient(async () => new Response(JSON.stringify({ status: 'revoked' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));
  await assert.rejects(
    client.revokeDevice({ devicePublicId: VALID_DEVICE_PUBLIC_ID, reason: 'owner_requested', accessToken: VALID_ACCESS_TOKEN }),
    (error) => error instanceof DeviceAuthError && error.status === 502 && error.code === 'temporarily_unavailable'
  );
});

test('M3.07 retries transient failures only within the bound and keeps request identity stable', async () => {
  const attempts = [];
  const client = await makeClient(async (_url, options) => {
    attempts.push({
      requestId: options.headers['X-Request-Id'],
      idempotencyKey: options.headers['Idempotency-Key'],
      nonce: options.headers['X-SkillMap-Device-Nonce']
    });
    return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '0' }
    });
  }, { maxRetries: 2 });
  await assert.rejects(client.initiatePairing({
    requested_scopes: ['device.status'],
    platform: 'macos',
    connector_version: '0.1.0'
  }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'temporarily_unavailable');
    return true;
  });
  assert.equal(attempts.length, 3);
  assert.equal(new Set(attempts.map((attempt) => attempt.requestId)).size, 1);
  assert.equal(new Set(attempts.map((attempt) => attempt.idempotencyKey)).size, 1);
  assert.equal(new Set(attempts.map((attempt) => attempt.nonce)).size, 3);

  let conflictCalls = 0;
  const conflictClient = await makeClient(async () => {
    conflictCalls += 1;
    return new Response(JSON.stringify({ error: 'idempotency_conflict' }), { status: 409 });
  }, { maxRetries: 3 });
  await assert.rejects(conflictClient.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.code, 'idempotency_conflict');
    return true;
  });
  assert.equal(conflictCalls, 1);
});

test('M3.07 retry cancellation removes listeners immediately and does not wake a stale timer', async () => {
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener)
  };
  let calls = 0;
  const client = await makeClient(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '1' }
    });
  }, { maxRetries: 2, maxRetryAfterMs: 1_000 });
  const pending = client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }, { signal });
  setTimeout(() => {
    signal.aborted = true;
    for (const listener of [...listeners]) listener();
  }, 10);
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
  assert.equal(listeners.size, 0);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 1);
});

test('M3.07 composes caller cancellation with an internal deadline and redacts network errors', async () => {
  const timeoutClient = await makeClient(async () => new Promise((resolve) => {
    setTimeout(() => resolve(new Response('{}', { status: 200 })), 200);
  }), { timeoutMs: 20 });
  await assert.rejects(timeoutClient.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.status, 408);
    assert.equal(error.code, 'temporarily_unavailable');
    return true;
  });

  const redactedClient = await makeClient(async () => {
    throw new Error('network https://secret.invalid/?token=token-canary');
  }, { maxRetries: 0 });
  await assert.rejects(redactedClient.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /secret\.invalid|token-canary/);
    return true;
  });

  const controller = new AbortController();
  const callerClient = await makeClient(async (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), { timeoutMs: 1_000 });
  const pending = callerClient.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
});

test('M3.07 pre-aborted callers are rejected before key access, signing, or fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  let thumbprintCalls = 0;
  let signCalls = 0;
  let fetchCalls = 0;
  const keyStore = {
    hasKey: async () => true,
    createKey: async () => { throw new Error('not used'); },
    getPublicKeySpki: async () => new Uint8Array(),
    getThumbprint: async () => { thumbprintCalls += 1; return 'sha256:unused'; },
    signProof: async () => { signCalls += 1; return 'unused'; },
    deleteKey: async () => {}
  };
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: async () => { fetchCalls += 1; return new Response('{}', { status: 200 }); }
  });
  await assert.rejects(
    client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }, { signal: controller.signal }),
    (error) => error?.name === 'AbortError'
  );
  assert.equal(thumbprintCalls, 0);
  assert.equal(signCalls, 0);
  assert.equal(fetchCalls, 0);
});

function hangingStreamResponse(probes) {
  return {
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: {
      getReader() {
        return {
          read: () => new Promise(() => {}),
          cancel: async () => { probes.cancel += 1; },
          releaseLock: () => { probes.release += 1; }
        };
      }
    }
  };
}

test('M3.07 deadline actively cancels a pending response read and releases its lock', async () => {
  const probes = { cancel: 0, release: 0 };
  const client = await makeClient(async () => hangingStreamResponse(probes), { timeoutMs: 20 });
  await assert.rejects(client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.status, 408);
    return true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probes.cancel, 1);
  assert.equal(probes.release, 1);
});

test('M3.07 caller abort actively cancels a pending response read and releases its lock', async () => {
  const probes = { cancel: 0, release: 0 };
  const controller = new AbortController();
  const client = await makeClient(async () => hangingStreamResponse(probes), { timeoutMs: 1_000 });
  const pending = client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probes.cancel, 1);
  assert.equal(probes.release, 1);
});

test('M3.07 null-body adapters never call unbounded response.text()', async () => {
  let textCalls = 0;
  const client = await makeClient(async () => ({
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    text: async () => { textCalls += 1; throw new Error('must not be called'); }
  }));
  await assert.rejects(client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.code, 'temporarily_unavailable');
    return true;
  });
  assert.equal(textCalls, 0);
});

test('M3.07 request cap counts UTF-8 bytes, not JavaScript string length', async () => {
  let fetchCalls = 0;
  const client = await makeClient(async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 400 });
  }, { maxRequestBytes: 512 });
  await assert.rejects(client.initiatePairing({
    requested_scopes: ['device.status'],
    platform: 'macos',
    connector_version: '0.1.0',
    display_name: '😀'.repeat(200)
  }), (error) => error instanceof DeviceAuthError && error.code === 'invalid_request');
  assert.equal(fetchCalls, 0);
});

test('M3.07 initiation success validation enforces the frozen closed contract', async () => {
  const valid = {
    device_code: 'A'.repeat(43),
    user_code: 'ABCDE-FGHIJ',
    verification_uri: 'https://skillmap.example.test/device',
    expires_in: 600,
    interval: 5,
    display: { name: 'Test Device', platform: 'macos', connector_version: '1.2.3' }
  };
  const accepted = await makeClient(async () => new Response(JSON.stringify(valid), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));
  const result = await accepted.initiatePairing({
    requested_scopes: ['device.status'],
    platform: 'macos',
    connector_version: '0.1.0'
  });
  assert.equal(result.user_code, 'ABCDE-FGHIJ');

  const invalidBodies = [
    { ...valid, display: { ...valid.display } },
    { ...valid, extra: 'closed-contract-canary' },
    { ...valid, device_code: 'short' },
    { ...valid, user_code: 'bad-code' },
    { ...valid, verification_uri: 'http://skillmap.example.test/device' },
    { ...valid, verification_uri: 'https://evil.example.test/device' },
    { ...valid, verification_uri: 'https://skillmap.example.test:444/device' },
    { ...valid, verification_uri: 'https://skillmap.example.test/device?token=canary' },
    { ...valid, verification_uri: 'https://skillmap.example.test/device#fragment' },
    { ...valid, expires_in: 599 },
    { ...valid, interval: 1 },
    { ...valid, display: { ...valid.display, platform: 'android' } },
    { ...valid, display: { ...valid.display, connector_version: 'not-semver' } }
  ];
  invalidBodies[0].display = { platform: 'macos', connector_version: '1.2.3' };
  for (const body of invalidBodies) {
    const client = await makeClient(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    await assert.rejects(client.initiatePairing({
      requested_scopes: ['device.status'],
      platform: 'macos',
      connector_version: '0.1.0'
    }), (error) => error instanceof DeviceAuthError && error.status === 502);
  }
});

test('M3.07 poll success enforces exact exchange code, positive expiry, and canonical scopes', async () => {
  const valid = {
    exchange_code: VALID_EXCHANGE_CODE,
    expires_in: 600,
    scopes: ['device.bundle', 'device.feedback', 'device.import', 'device.route', 'device.status']
  };
  const accepted = await makeClient(async () => new Response(JSON.stringify(valid), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));
  assert.deepEqual(await accepted.pollPairing('D'.repeat(43)), valid);

  const invalidBodies = [
    { ...valid, exchange_code: 'short' },
    { ...valid, exchange_code: `${'E'.repeat(42)}!` },
    { ...valid, expires_in: 0 },
    { ...valid, expires_in: 601 },
    { ...valid, expires_in: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, scopes: ['device.status', 'device.route'] },
    { ...valid, scopes: ['device.status', 'device.status'] },
    { ...valid, scopes: ['device.unknown'] },
    { ...valid, scopes: ['DEVICE.STATUS'] }
  ];
  for (const body of invalidBodies) {
    const client = await makeClient(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    await assert.rejects(client.pollPairing('D'.repeat(43)), (error) => {
      assert.ok(error instanceof DeviceAuthError);
      assert.equal(error.status, 502);
      return true;
    });
  }
});

test('M3.07 exchange success enforces public-id/token grammars and expiry relationships', async () => {
  const accepted = await makeClient(async () => new Response(JSON.stringify(VALID_EXCHANGE_RESPONSE), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));
  assert.deepEqual(await accepted.exchangeCode({ exchangeCode: VALID_EXCHANGE_CODE, scopes: ['device.status'] }), VALID_EXCHANGE_RESPONSE);

  const invalidBodies = [
    { ...VALID_EXCHANGE_RESPONSE, device_public_id: `dev_${'a'.repeat(31)}!` },
    { ...VALID_EXCHANGE_RESPONSE, account_public_id: `acct_${'b'.repeat(31)}Z` },
    { ...VALID_EXCHANGE_RESPONSE, token_family_id: `fam_${'c'.repeat(31)}-` },
    { ...VALID_EXCHANGE_RESPONSE, access_token: 'A'.repeat(42) },
    { ...VALID_EXCHANGE_RESPONSE, refresh_token: 'B'.repeat(44) },
    { ...VALID_EXCHANGE_RESPONSE, expires_in: 0 },
    { ...VALID_EXCHANGE_RESPONSE, expires_in: 601 },
    { ...VALID_EXCHANGE_RESPONSE, refresh_idle_expires_in: 0 },
    { ...VALID_EXCHANGE_RESPONSE, refresh_idle_expires_in: 2_592_001 },
    { ...VALID_EXCHANGE_RESPONSE, refresh_idle_expires_in: 7_776_000 },
    { ...VALID_EXCHANGE_RESPONSE, refresh_absolute_expires_in: 599 }
  ];
  for (const body of invalidBodies) {
    const client = await makeClient(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    await assert.rejects(client.exchangeCode({ exchangeCode: VALID_EXCHANGE_CODE, scopes: ['device.status'] }), (error) => {
      assert.ok(error instanceof DeviceAuthError);
      assert.equal(error.status, 502);
      return true;
    });
  }
});

test('M3.07 setup and metadata failures are fixed typed outcomes without underlying text', async () => {
  const keyStore = {
    getThumbprint: async () => { throw new Error('private-key-path token-canary'); },
    getPublicKeySpki: async () => new Uint8Array([1]),
    signProof: async () => 'unused',
    hasKey: async () => true,
    createKey: async () => {},
    deleteKey: async () => {}
  };
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: async () => { throw new Error('fetch token-canary'); }
  });
  await assert.rejects(client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.code, 'secure_storage_unavailable');
    assert.doesNotMatch(error.message, /private-key-path|token-canary/);
    return true;
  });

  const metadataClient = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore: {
      getThumbprint: async () => 'sha256:' + '1'.repeat(64),
      getPublicKeySpki: async () => new Uint8Array([1]),
      signProof: async () => 'unused',
      hasKey: async () => true,
      createKey: async () => {},
      deleteKey: async () => {}
    },
    metadataStore: { load: async () => { throw new Error('metadata-secret-canary'); }, save: async () => {} },
    randomBytes: () => { throw new Error('random-secret-canary'); }
  });
  await assert.rejects(metadataClient.getDeviceId(), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.code, 'secure_storage_unavailable');
    assert.doesNotMatch(error.message, /metadata-secret-canary|random-secret-canary/);
    return true;
  });
});

test('M3.07 rejects invalid configured, cached, metadata, and generated device IDs before fetch', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  assert.throws(
    () => new DeviceAuthClient({ origin: 'https://skillmap.example.test', keyStore, deviceId: 'configured-id-canary' }),
    (error) => error instanceof DeviceAuthError && error.code === 'invalid_request' && !error.message.includes('configured-id-canary')
  );

  let fetchCalls = 0;
  const fetchFn = async () => {
    fetchCalls += 1;
    return new Response('{}', { status: 400 });
  };
  const cachedClient = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn
  });
  cachedClient.cachedDeviceId = 'cached-id-canary';
  await assert.rejects(cachedClient.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.code, 'invalid_request');
    assert.doesNotMatch(error.message, /cached-id-canary/);
    return true;
  });

  const metadataClient = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    metadataStore: { load: async () => ({ deviceId: 'metadata-id-canary' }), save: async () => {} },
    fetchFn
  });
  await assert.rejects(metadataClient.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.code, 'invalid_request');
    assert.doesNotMatch(error.message, /metadata-id-canary/);
    return true;
  });

  const generatedClient = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    randomBytes: () => new Uint8Array([1]),
    fetchFn
  });
  await assert.rejects(generatedClient.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.code, 'invalid_request');
    return true;
  });
  assert.equal(fetchCalls, 0);
});

test('M3.07 deadline covers hanging key-store header construction before fetch', async () => {
  let fetchCalls = 0;
  const keyStore = {
    getThumbprint: async () => new Promise(() => {}),
    getPublicKeySpki: async () => null,
    signProof: async () => 'unused',
    hasKey: async () => true,
    createKey: async () => { throw new Error('not used'); },
    deleteKey: async () => {}
  };
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    timeoutMs: 20,
    fetchFn: async () => { fetchCalls += 1; return new Response('{}', { status: 200 }); }
  });
  await assert.rejects(client.getStatus({ devicePublicId: VALID_DEVICE_PUBLIC_ID, accessToken: VALID_ACCESS_TOKEN }), (error) => {
    assert.ok(error instanceof DeviceAuthError);
    assert.equal(error.status, 408);
    return true;
  });
  assert.equal(fetchCalls, 0);
});
