import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceAuthClient, DeviceAuthError } from '../dist/network/device-auth-client.js';
import { InMemoryCredentialStore } from '../dist/platform/credential-store.js';
import { InMemoryDeviceAuthMetadataStore } from '../dist/platform/device-auth-metadata-store.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';
import { DeviceAuthUseCase } from '../dist/services/device-auth-use-case.js';

const VALID_DEVICE_ID = 'D'.repeat(22);
const VALID_DEVICE_PUBLIC_ID = `dev_${'a'.repeat(32)}`;
const VALID_ACCOUNT_PUBLIC_ID = `acct_${'b'.repeat(32)}`;
const VALID_TOKEN_FAMILY_ID = `fam_${'c'.repeat(32)}`;
const REFRESH_TOKEN_ONE = 'R'.repeat(43);
const REFRESH_TOKEN_TWO = 'S'.repeat(43);
const ACCESS_TOKEN_TWO = 'A'.repeat(43);
const ACCESS_TOKEN_ONE = 'B'.repeat(43);

function createMockFetch(handler) {
  return async (url, options) => {
    return handler(url, options);
  };
}

test('Refresh token rotation updates credential store and returns new access token', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  await credentialStore.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: REFRESH_TOKEN_ONE,
    scopes: ['device.status'],
    devicePublicId: VALID_DEVICE_PUBLIC_ID,
    accountPublicId: VALID_ACCOUNT_PUBLIC_ID,
    updatedAt: 1735689600
  });

  let refreshCallCount = 0;
  const mockFetch = createMockFetch(async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.endsWith('/api/device-auth/v1/tokens/refresh')) {
      refreshCallCount += 1;
      assert.equal(body.refresh_token, REFRESH_TOKEN_ONE);
      assert.equal(body.token_family_id, VALID_TOKEN_FAMILY_ID);

      return new Response(
        JSON.stringify({
          device_public_id: VALID_DEVICE_PUBLIC_ID,
          account_public_id: VALID_ACCOUNT_PUBLIC_ID,
          token_family_id: VALID_TOKEN_FAMILY_ID,
          access_token: ACCESS_TOKEN_TWO,
          refresh_token: REFRESH_TOKEN_TWO,
          expires_in: 600,
          refresh_idle_expires_in: 2592000,
          refresh_absolute_expires_in: 7776000
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'X-SkillMap-Response-Issued-At': '1735689600' } }
      );
    }
    return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 });
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    clock: () => 1735689600,
    fetchFn: mockFetch
  });

  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore,
    clock: () => 1735689600
  });

  const accessToken = await useCase.getAccessToken({ forceRefresh: true });
  assert.equal(accessToken, ACCESS_TOKEN_TWO);
  assert.equal(refreshCallCount, 1);

  // Check that credential store was updated with generation 2 refresh token
  const updatedCreds = await credentialStore.load();
  assert.equal(updatedCreds.refreshToken, REFRESH_TOKEN_TWO);
});

test('Revoked or reuse-invalidated refresh token purges local credential store', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  await credentialStore.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: REFRESH_TOKEN_ONE,
    scopes: ['device.status'],
    devicePublicId: VALID_DEVICE_PUBLIC_ID,
    accountPublicId: VALID_ACCOUNT_PUBLIC_ID,
    updatedAt: 1735689600
  });

  const mockFetch = createMockFetch(async (url) => {
    if (url.endsWith('/api/device-auth/v1/tokens/refresh')) {
      return new Response(
        JSON.stringify({
          error: 'invalid_grant',
          error_description: 'The authorization grant is invalid.',
          retry_after: 0
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

  await assert.rejects(
    useCase.getAccessToken({ forceRefresh: true }),
    (err) => err instanceof DeviceAuthError && err.code === 'invalid_grant'
  );

  // Verify local credentials were purged after invalid_grant response
  const purgedCreds = await credentialStore.load();
  assert.equal(purgedCreds, null);
});

test('Normal logout retains local credentials when remote revoke is unreachable', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  await credentialStore.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: REFRESH_TOKEN_ONE,
    scopes: ['device.status'],
    devicePublicId: VALID_DEVICE_PUBLIC_ID,
    accountPublicId: VALID_ACCOUNT_PUBLIC_ID,
    updatedAt: 1735689600
  });

  const failingFetch = createMockFetch(async () => {
    throw new TypeError('Failed to fetch');
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: failingFetch
  });

  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore
  });

  // Normal logout with network error -> RETAINS local credentials!
  const normalLogoutResult = await useCase.logout();
  assert.equal(normalLogoutResult.localDeleted, false);
  assert.equal(normalLogoutResult.remoteRevoked, false);

  const credsRetained = await credentialStore.load();
  assert.ok(credsRetained !== null);

  // localOnly without confirm -> RETAINS local credentials!
  const localOnlyNoConfirmResult = await useCase.logout({ localOnly: true });
  assert.equal(localOnlyNoConfirmResult.localDeleted, false);
  assert.equal(localOnlyNoConfirmResult.remoteRevoked, false);

  // localOnly WITH confirm -> PURGES local credentials!
  const confirmedResult = await useCase.logout({ localOnly: true, confirm: true });
  assert.equal(confirmedResult.localDeleted, true);
  assert.equal(confirmedResult.remoteRevoked, false);

  const credsAfter = await credentialStore.load();
  assert.equal(credsAfter, null);
});

test('Normal logout when remote revoke succeeds or returns terminal error purges local credentials', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  await credentialStore.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: REFRESH_TOKEN_ONE,
    scopes: ['device.status'],
    devicePublicId: VALID_DEVICE_PUBLIC_ID,
    accountPublicId: VALID_ACCOUNT_PUBLIC_ID,
    updatedAt: 1735689600
  });

  const successFetch = createMockFetch(async (url) => {
    if (url.endsWith('/api/device-auth/v1/tokens/refresh')) {
      const issuedAt = Math.floor(Date.now() / 1000);
      return new Response(JSON.stringify({
        device_public_id: VALID_DEVICE_PUBLIC_ID,
        account_public_id: VALID_ACCOUNT_PUBLIC_ID,
        token_family_id: VALID_TOKEN_FAMILY_ID,
        access_token: ACCESS_TOKEN_ONE,
        refresh_token: REFRESH_TOKEN_TWO,
        expires_in: 600,
        refresh_idle_expires_in: 2_592_000,
        refresh_absolute_expires_in: 7_776_000
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-SkillMap-Response-Issued-At': String(issuedAt) }
      });
    }
    return new Response(
      JSON.stringify({ status: 'revoked', device_public_id: VALID_DEVICE_PUBLIC_ID }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: successFetch
  });

  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore
  });

  const logoutResult = await useCase.logout();
  assert.equal(logoutResult.localDeleted, true);
  assert.equal(logoutResult.remoteRevoked, true);

  const credsAfter = await credentialStore.load();
  assert.equal(credsAfter, null);
});


test('Unreachable server during status check returns unreachable state cleanly', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore();
  const metadataStore = new InMemoryDeviceAuthMetadataStore();

  await credentialStore.commitExchange({
    deviceId: VALID_DEVICE_ID,
    tokenFamilyId: VALID_TOKEN_FAMILY_ID,
    refreshToken: REFRESH_TOKEN_ONE,
    scopes: ['device.status'],
    devicePublicId: VALID_DEVICE_PUBLIC_ID,
    accountPublicId: VALID_ACCOUNT_PUBLIC_ID,
    updatedAt: 1735689600
  });

  const failingFetch = createMockFetch(async () => {
    throw new TypeError('Network error');
  });

  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: VALID_DEVICE_ID,
    fetchFn: failingFetch
  });

  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore
  });

  const status = await useCase.getAuthStatus();
  assert.equal(status.state, 'unreachable');
  assert.equal(status.authenticated, false);
  assert.equal(status.devicePublicId, VALID_DEVICE_PUBLIC_ID);
});
