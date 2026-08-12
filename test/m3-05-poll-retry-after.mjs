import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DeviceAuthUseCase } from '../dist/services/device-auth-use-case.js';

test('M3.05 use-case honors pending and slow_down retry_after guidance with a 60-second jitter cap', async () => {
  const sleeps = [];
  let polls = 0;
  const client = {
    setMetadataStore() {},
    async getDeviceId() { return 'dev_id_0000000000000001'; },
    async initiatePairing() {
      return { device_code: 'D'.repeat(43), user_code: 'ABCDE-FGHJK', verification_uri: 'https://example.test/device', expires_in: 600, interval: 5, display: { name: 'Test', platform: 'macos', connector_version: '1.0.0' } };
    },
    async pollPairing() {
      polls += 1;
      if (polls === 1) return { error: 'authorization_pending', error_description: 'Still waiting.', retry_after: 60 };
      if (polls === 2) return { error: 'slow_down', error_description: 'Polling must slow down.', retry_after: 60 };
      return { exchange_code: 'E'.repeat(43), expires_in: 600, scopes: ['device.route'] };
    },
    async exchangeCode() {
      return { device_public_id: `dev_${'a'.repeat(32)}`, account_public_id: `acct_${'b'.repeat(32)}`, token_family_id: `fam_${'c'.repeat(32)}`, access_token: 'A'.repeat(43), refresh_token: 'R'.repeat(43), expires_in: 600, refresh_idle_expires_in: 2592000, refresh_absolute_expires_in: 7776000 };
    },
    async cancelPairing() { return { status: 'cancelled' }; }
  };
  const keyStore = { async hasKey() { return true; }, async createKey() {}, async getThumbprint() { return 'sha256:' + 'a'.repeat(64); } };
  const credentialStore = { async commitExchange() {} };
  const metadataStore = { async save() {} };
  const useCase = new DeviceAuthUseCase({ client, keyStore, credentialStore, metadataStore, clock: () => 0, randomBytes: () => new Uint8Array([255]) });
  useCase.sleepWithSignal = async (ms) => { sleeps.push(ms); };
  await useCase.initiateAndPoll({ scopes: ['device.route'], platform: 'macos', connectorVersion: '1.0.0' });
  assert.equal(polls, 3);
  assert.deepEqual(sleeps, [6000, 60000, 60000]);
});

test('M3.05 polling continues past the old fixed cap before expiry', async () => {
  let now = 0;
  let polls = 0;
  let cancelReason;
  const sleeps = [];
  const client = {
    setMetadataStore() {},
    async getDeviceId() { return 'dev_id_0000000000000001'; },
    async initiatePairing() {
      return {
        device_code: 'D'.repeat(43),
        user_code: 'ABCDE-FGHJK',
        verification_uri: 'https://example.test/device',
        expires_in: 600,
        interval: 5,
        display: { name: 'Test', platform: 'macos', connector_version: '1.0.0' }
      };
    },
    async pollPairing() {
      polls += 1;
      if (polls < 100) return { error: 'authorization_pending', error_description: 'Still waiting.', retry_after: 0 };
      return { exchange_code: 'E'.repeat(43), expires_in: 600, scopes: ['device.route'] };
    },
    async exchangeCode() {
      return {
        device_public_id: `dev_${'a'.repeat(32)}`,
        account_public_id: `acct_${'b'.repeat(32)}`,
        token_family_id: `fam_${'c'.repeat(32)}`,
        access_token: 'A'.repeat(43),
        refresh_token: 'R'.repeat(43),
        expires_in: 600,
        refresh_idle_expires_in: 2592000,
        refresh_absolute_expires_in: 7776000
      };
    },
    async cancelPairing({ reason }) { cancelReason = reason; return { status: 'cancelled' }; }
  };
  const keyStore = {
    async hasKey() { return true; },
    async createKey() {},
    async getThumbprint() { return 'sha256:' + 'a'.repeat(64); }
  };
  const useCase = new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore: { async commitExchange() {} },
    metadataStore: { async save() {} },
    clock: () => now,
    // Zero selects the lower edge of the 1..20% jitter range. The 100th poll
    // occurs at 505 seconds, after the retired fixed 90-poll cap and before
    // the 600-second server deadline.
    randomBytes: () => new Uint8Array([0])
  });
  useCase.sleepWithSignal = async (ms) => {
    sleeps.push(ms);
    now += ms / 1000;
  };

  const result = await useCase.initiateAndPoll({ scopes: ['device.route'], platform: 'macos' });

  assert.equal(result.device_public_id, `dev_${'a'.repeat(32)}`);
  assert.equal(polls, 100);
  assert.equal(Math.round(now * 1000), 505_000);
  assert.equal(sleeps.at(-1), 5050);
  assert.equal(cancelReason, undefined);
});

test('M3.05 does not poll at or after the advertised expiry boundary', async () => {
  let now = 0;
  let polls = 0;
  let cancelReason;
  const client = {
    setMetadataStore() {},
    async getDeviceId() { return 'dev_id_0000000000000001'; },
    async initiatePairing() {
      return {
        device_code: 'D'.repeat(43),
        user_code: 'ABCDE-FGHJK',
        verification_uri: 'https://example.test/device',
        expires_in: 600,
        interval: 5,
        display: { name: 'Test', platform: 'macos', connector_version: '1.0.0' }
      };
    },
    async pollPairing() {
      polls += 1;
      return { error: 'authorization_pending', error_description: 'Still waiting.', retry_after: 0 };
    },
    async cancelPairing({ reason }) { cancelReason = reason; return { status: 'cancelled' }; }
  };
  const useCase = new DeviceAuthUseCase({
    client,
    keyStore: { async hasKey() { return true; }, async createKey() {}, async getThumbprint() { return 'sha256:' + 'a'.repeat(64); } },
    credentialStore: { async commitExchange() {} },
    metadataStore: { async save() {} },
    clock: () => now,
    randomBytes: () => new Uint8Array([255])
  });
  useCase.sleepWithSignal = async (ms) => { now += ms / 1000; };

  await assert.rejects(
    useCase.initiateAndPoll({ scopes: ['device.route'], platform: 'macos' }),
    (error) => error?.code === 'expired_token'
  );

  assert.equal(now, 600);
  assert.equal(polls, 99);
  assert.equal(cancelReason, 'timeout');
});

test('M3.05 polling has a deadline-derived bound when the injected clock stalls', async () => {
  let polls = 0;
  let cancelReason;
  const client = {
    setMetadataStore() {},
    async getDeviceId() { return 'dev_id_0000000000000001'; },
    async initiatePairing() {
      return {
        device_code: 'D'.repeat(43),
        user_code: 'ABCDE-FGHJK',
        verification_uri: 'https://example.test/device',
        expires_in: 600,
        interval: 5,
        display: { name: 'Test', platform: 'macos', connector_version: '1.0.0' }
      };
    },
    async pollPairing() {
      polls += 1;
      return { error: 'authorization_pending', error_description: 'Still waiting.', retry_after: 0 };
    },
    async cancelPairing({ reason }) { cancelReason = reason; return { status: 'cancelled' }; }
  };
  const useCase = new DeviceAuthUseCase({
    client,
    keyStore: { async hasKey() { return true; }, async createKey() {}, async getThumbprint() { return 'sha256:' + 'a'.repeat(64); } },
    credentialStore: { async commitExchange() {} },
    metadataStore: { async save() {} },
    clock: () => 0,
    randomBytes: () => new Uint8Array([0])
  });
  useCase.sleepWithSignal = async () => {};

  await assert.rejects(
    useCase.initiateAndPoll({ scopes: ['device.route'], platform: 'macos' }),
    (error) => error?.code === 'expired_token'
  );

  // 600 seconds / (5 seconds * 1.01 minimum jitter), rounded up. This is a
  // safety bound for a stalled test clock, not an expiry shortcut.
  assert.equal(polls, 119);
  assert.equal(cancelReason, 'timeout');
});
