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
