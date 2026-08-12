import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSha256 } from '../dist/contracts/device-auth.js';
import { DeviceAuthClient, DeviceAuthError } from '../dist/network/device-auth-client.js';
import { DeviceAuthUseCase } from '../dist/services/device-auth-use-case.js';
import { InMemoryCredentialStore } from '../dist/platform/credential-store.js';
import { InMemoryDeviceAuthMetadataStore } from '../dist/platform/device-auth-metadata-store.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';
import { authCommand } from '../dist/commands/auth.js';
import { whoamiCommand } from '../dist/commands/whoami.js';
import { CLI_EXIT_CODES, CliExitError } from '../dist/core/cli-exit.js';

const DEVICE_ID = 'D'.repeat(22);
const DEVICE_PUBLIC_ID = `dev_${'a'.repeat(32)}`;
const ACCOUNT_PUBLIC_ID = `acct_${'b'.repeat(32)}`;
const FAMILY_ID = `fam_${'c'.repeat(32)}`;
const ACCESS_TOKEN = 'T'.repeat(43);
const REFRESH_TOKEN = 'R'.repeat(43);

async function keyStore() {
  const store = new InMemoryDeviceKeyStore();
  await store.createKey();
  return store;
}

function statusResponse(state = 'active') {
  return new Response(JSON.stringify({
    device_public_id: DEVICE_PUBLIC_ID,
    account_public_id: ACCOUNT_PUBLIC_ID,
    state,
    scopes: ['device.status'],
    expires_at: Math.floor(Date.now() / 1000) + 600,
    key_thumbprint: `sha256:${'1'.repeat(64)}`
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('M3.09 protected client calls require a valid bearer and keep token out of URL/body', async () => {
  const ks = await keyStore();
  const calls = [];
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore: ks,
    deviceId: DEVICE_ID,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return statusResponse();
    }
  });

  await assert.rejects(
    client.getStatus({ devicePublicId: DEVICE_PUBLIC_ID }),
    (error) => error instanceof DeviceAuthError && error.code === 'invalid_token'
  );
  await assert.rejects(
    client.revokeDevice({ devicePublicId: DEVICE_PUBLIC_ID, reason: 'user_offboarded' }),
    (error) => error instanceof DeviceAuthError && error.code === 'invalid_token'
  );
  assert.equal(calls.length, 0);

  await client.getStatus({ devicePublicId: DEVICE_PUBLIC_ID, accessToken: ACCESS_TOKEN });
  assert.equal(calls.length, 1);
  const [{ url, options }] = calls;
  assert.equal(options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(options.body, undefined);
  assert.doesNotMatch(url, new RegExp(ACCESS_TOKEN));
  assert.doesNotMatch(JSON.stringify(options.body ?? ''), new RegExp(ACCESS_TOKEN));
  assert.equal(options.headers['X-SkillMap-Device-Body-SHA256'], computeSha256(''));
});

test('M3.09 revoke proof hashes the bearer while request body remains reason-only', async () => {
  const ks = await keyStore();
  let captured;
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore: ks,
    deviceId: DEVICE_ID,
    fetchFn: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ status: 'revoked', device_public_id: DEVICE_PUBLIC_ID }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  await client.revokeDevice({ devicePublicId: DEVICE_PUBLIC_ID, reason: 'user_offboarded', accessToken: ACCESS_TOKEN });
  assert.equal(JSON.parse(captured.options.body).reason, 'user_offboarded');
  assert.equal(captured.options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(captured.options.headers['X-SkillMap-Device-Body-SHA256'], computeSha256(captured.options.body));
  assert.equal(captured.options.headers['X-SkillMap-Device-Proof'].includes(ACCESS_TOKEN), false);
  assert.doesNotMatch(captured.url, new RegExp(ACCESS_TOKEN));
});

test('M3.09 rejects a lifecycle response for a different device', async () => {
  const ks = await keyStore();
  const otherDevice = `dev_${'f'.repeat(32)}`;
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore: ks,
    deviceId: DEVICE_ID,
    fetchFn: async () => new Response(JSON.stringify({ status: 'revoked', device_public_id: otherDevice }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });
  await assert.rejects(
    client.revokeDevice({ devicePublicId: DEVICE_PUBLIC_ID, reason: 'user_offboarded', accessToken: ACCESS_TOKEN }),
    (error) => error instanceof DeviceAuthError && error.status === 502
  );
});

test('M3.09 logout leaves credentials when no refreshable in-memory token can be obtained', async () => {
  const ks = await keyStore();
  const credentialStore = new InMemoryCredentialStore();
  await credentialStore.commitExchange({
    deviceId: DEVICE_ID,
    tokenFamilyId: FAMILY_ID,
    refreshToken: REFRESH_TOKEN,
    scopes: ['device.status'],
    devicePublicId: DEVICE_PUBLIC_ID,
    accountPublicId: ACCOUNT_PUBLIC_ID,
    updatedAt: Math.floor(Date.now() / 1000)
  });
  let calls = 0;
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore: ks,
    deviceId: DEVICE_ID,
    fetchFn: async () => {
      calls += 1;
      throw new TypeError('offline token-canary');
    }
  });
  const useCase = new DeviceAuthUseCase({
    client,
    keyStore: ks,
    credentialStore,
    metadataStore: new InMemoryDeviceAuthMetadataStore()
  });
  const result = await useCase.logout();
  assert.deepEqual(result, { remoteRevoked: false, localDeleted: false, unconfirmed: true });
  assert.ok(calls >= 1);
  assert.ok(await credentialStore.load());
  assert.doesNotMatch(JSON.stringify(result), /token-canary/);
});

test('M3.09 logout with no stored device public ID is unconfirmed until explicit local confirmation', async () => {
  const ks = await keyStore();
  const credentialStore = new InMemoryCredentialStore();
  await credentialStore.commitExchange({
    deviceId: DEVICE_ID,
    tokenFamilyId: FAMILY_ID,
    refreshToken: REFRESH_TOKEN,
    scopes: ['device.status'],
    accountPublicId: ACCOUNT_PUBLIC_ID,
    updatedAt: Math.floor(Date.now() / 1000)
  });
  const client = new DeviceAuthClient({ origin: 'https://skillmap.example.test', keyStore: ks, deviceId: DEVICE_ID, fetchFn: async () => {
    throw new Error('must not reach remote revoke');
  } });
  const useCase = new DeviceAuthUseCase({
    client,
    keyStore: ks,
    credentialStore,
    metadataStore: new InMemoryDeviceAuthMetadataStore()
  });
  const result = await useCase.logout();
  assert.deepEqual(result, { remoteRevoked: false, localDeleted: false, unconfirmed: true });
  assert.ok(await credentialStore.load());
  const localResult = await useCase.logout({ localOnly: true, confirm: true });
  assert.deepEqual(localResult, { remoteRevoked: false, localDeleted: true });
  assert.equal(await credentialStore.load(), null);
});

test('M3.09 revoke errors never authorize local cleanup', async () => {
  const ks = await keyStore();
  const credentialStore = new InMemoryCredentialStore();
  await credentialStore.commitExchange({
    deviceId: DEVICE_ID,
    tokenFamilyId: FAMILY_ID,
    refreshToken: REFRESH_TOKEN,
    scopes: ['device.status'],
    devicePublicId: DEVICE_PUBLIC_ID,
    accountPublicId: ACCOUNT_PUBLIC_ID,
    updatedAt: Math.floor(Date.now() / 1000)
  });
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore: ks,
    deviceId: DEVICE_ID,
    fetchFn: async (url) => {
      if (url.endsWith('/tokens/refresh')) {
        const issuedAt = Math.floor(Date.now() / 1000);
        return new Response(JSON.stringify({
          device_public_id: DEVICE_PUBLIC_ID,
          account_public_id: ACCOUNT_PUBLIC_ID,
          token_family_id: FAMILY_ID,
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          expires_in: 600,
          refresh_idle_expires_in: 2_592_000,
          refresh_absolute_expires_in: 7_776_000
        }), { status: 200, headers: { 'content-type': 'application/json', 'X-SkillMap-Response-Issued-At': String(issuedAt) } });
      }
      return new Response(JSON.stringify({ error: 'already_consumed' }), {
        status: 409,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const useCase = new DeviceAuthUseCase({
    client,
    keyStore: ks,
    credentialStore,
    metadataStore: new InMemoryDeviceAuthMetadataStore()
  });
  const result = await useCase.logout();
  assert.deepEqual(result, { remoteRevoked: false, localDeleted: false, unconfirmed: true });
  assert.ok(await credentialStore.load());
});

test('M3.11 status only reports live server state and never infers authenticated from stored credentials', async () => {
  const ks = await keyStore();
  const credentialStore = new InMemoryCredentialStore();
  await credentialStore.commitExchange({
    deviceId: DEVICE_ID,
    tokenFamilyId: FAMILY_ID,
    refreshToken: REFRESH_TOKEN,
    scopes: ['device.status'],
    devicePublicId: DEVICE_PUBLIC_ID,
    accountPublicId: ACCOUNT_PUBLIC_ID,
    updatedAt: Math.floor(Date.now() / 1000)
  });
  let statusCalls = 0;
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore: ks,
    deviceId: DEVICE_ID,
    fetchFn: async (url, options) => {
      if (url.endsWith('/tokens/refresh')) throw new TypeError('offline');
      statusCalls += 1;
      assert.ok(options.headers.Authorization);
      return statusResponse();
    }
  });
  const useCase = new DeviceAuthUseCase({
    client,
    keyStore: ks,
    credentialStore,
    metadataStore: new InMemoryDeviceAuthMetadataStore()
  });
  const status = await useCase.getAuthStatus();
  assert.equal(status.state, 'unreachable');
  assert.equal(status.authenticated, false);
  assert.equal(statusCalls, 0);
});

test('M3.11 auth and whoami outputs keep observational and live identity contracts', async () => {
  const publicStatus = {
    state: 'authenticated',
    authenticated: true,
    devicePublicId: DEVICE_PUBLIC_ID,
    accountPublicId: ACCOUNT_PUBLIC_ID,
    scopes: ['device.status'],
    expiresAt: 1_800_000_000
  };
  const useCase = { getAuthStatus: async () => publicStatus };
  const authResult = await authCommand('/tmp/test', ['status'], {}, { useCase });
  const whoamiResult = await whoamiCommand('/tmp/test', {}, { useCase });
  for (const output of [authResult, whoamiResult]) {
    const serialized = JSON.stringify(output);
    assert.doesNotMatch(serialized, /access_token|refresh_token|token_family|digest|proof|keychain|hostname|username|private/i);
  }
  assert.equal(authResult.state, 'authenticated');
  assert.equal(whoamiResult.authenticated, true);

  for (const state of ['signed_out', 'expired', 'revoked']) {
    await assert.rejects(
      authCommand('/tmp/test', ['status'], { check: true }, { useCase: { getAuthStatus: async () => ({ state, authenticated: false }) } }),
      (error) => error instanceof CliExitError && error.exitCode === CLI_EXIT_CODES.UNAUTHENTICATED
    );
  }
  await assert.rejects(
    whoamiCommand('/tmp/test', {}, { useCase: { getAuthStatus: async () => ({ state: 'unreachable', authenticated: false }) } }),
    (error) => error instanceof CliExitError && error.exitCode === CLI_EXIT_CODES.UNREACHABLE
  );
});
