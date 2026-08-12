import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeviceAuthClient } from '../dist/network/device-auth-client.js';
import { computeSha256 } from '../dist/contracts/device-auth.js';
import { InMemoryCredentialStore } from '../dist/platform/credential-store.js';
import { InMemoryDeviceAuthMetadataStore } from '../dist/platform/device-auth-metadata-store.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';
import { DeviceAuthUseCase } from '../dist/services/device-auth-use-case.js';

const DEVICE_ID = 'D'.repeat(22);
const FAMILY = 'fam_' + 'c'.repeat(32);
const NEXT_FAMILY = 'fam_' + 'd'.repeat(32);
const TOKEN = 'R'.repeat(43);
const NEXT_TOKEN = 'S'.repeat(43);
const ACCESS = 'A'.repeat(43);

function response(accessToken = ACCESS, refreshToken = NEXT_TOKEN, family = NEXT_FAMILY, expiresIn = 600) {
  return {
    device_public_id: 'dev_' + 'a'.repeat(32),
    account_public_id: 'acct_' + 'b'.repeat(32),
    token_family_id: family,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    refresh_idle_expires_in: 2_592_000,
    refresh_absolute_expires_in: 7_776_000
  };
}

async function deps({ fetchFn, clock = () => 1_000 } = {}) {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  const credentialStore = new InMemoryCredentialStore(clock);
  await credentialStore.commitExchange({
    deviceId: DEVICE_ID,
    tokenFamilyId: FAMILY,
    refreshToken: TOKEN,
    scopes: ['device.status'],
    updatedAt: 900,
    generation: 7,
    familyAbsoluteExpiresAt: 1_000 + 7_776_000
  });
  const client = new DeviceAuthClient({ origin: 'https://skillmap.example.test', keyStore, deviceId: DEVICE_ID, fetchFn, clock });
  const useCase = new DeviceAuthUseCase({ client, keyStore, credentialStore, metadataStore: new InMemoryDeviceAuthMetadataStore(), clock });
  return { client, useCase, credentialStore, keyStore };
}

class FaultyCredentialStore {
  constructor(base, fault) { this.base = base; this.fault = fault; }
  load() { return this.base.load(); }
  loadState() { return this.base.loadState(); }
  commitExchange(record) { return this.base.commitExchange(record); }
  async markRefreshPending(pending) {
    if (this.fault === 'before-pending') throw new Error('injected_before_pending');
    return this.base.markRefreshPending(pending);
  }
  async commitRefresh(params) {
    if (this.fault === 'before-commit') throw new Error('injected_before_commit');
    const result = await this.base.commitRefresh(params);
    if (this.fault === 'after-commit') throw new Error('injected_after_commit');
    return result;
  }
  delete() { return this.base.delete(); }
}

function makeUseCase(client, keyStore, credentialStore, clock = () => 1000) {
  return new DeviceAuthUseCase({
    client,
    keyStore,
    credentialStore,
    metadataStore: new InMemoryDeviceAuthMetadataStore(),
    clock
  });
}

function makeResponseBody() {
  return new Response(JSON.stringify(response()), {
    status: 200,
    headers: { 'content-type': 'application/json', 'X-SkillMap-Response-Issued-At': '1000' }
  });
}

test('M3.08 explicit refresh idempotency and response-issued metadata remain outside strict body shape', async () => {
  const keyStore = new InMemoryDeviceKeyStore();
  await keyStore.createKey();
  let captured;
  const client = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore,
    deviceId: DEVICE_ID,
    clock: () => 1000,
    fetchFn: async (_url, options) => {
      captured = options;
      return new Response(JSON.stringify(response()), { status: 200, headers: { 'content-type': 'application/json', 'X-SkillMap-Response-Issued-At': '1000' } });
    }
  });
  const result = await client.refreshToken({ refreshToken: TOKEN, tokenFamilyId: FAMILY, idempotencyKey: 'I'.repeat(22) });
  assert.equal(captured.headers['Idempotency-Key'], 'I'.repeat(22));
  assert.equal(result.responseIssuedAt, 1000);
  assert.equal(result.responseVersion, 'v1');
  assert.equal(Object.keys(result).includes('responseIssuedAt'), false);
});

test('M3.08 refresh rejects missing, duplicate, malformed, unsafe, and clock-inconsistent issued-at headers', async () => {
  for (const issuedAt of [undefined, '1000, 1000', 'not-a-timestamp', '9007199254740992', '1100']) {
    const keyStore = new InMemoryDeviceKeyStore();
    await keyStore.createKey();
    const client = new DeviceAuthClient({
      origin: 'https://skillmap.example.test', keyStore, deviceId: DEVICE_ID, clock: () => 1000,
      fetchFn: async () => new Response(JSON.stringify(response()), {
        status: 200,
        headers: { 'content-type': 'application/json', ...(issuedAt === undefined ? {} : { 'X-SkillMap-Response-Issued-At': issuedAt }) }
      })
    });
    await assert.rejects(client.refreshToken({ refreshToken: TOKEN, tokenFamilyId: FAMILY, idempotencyKey: 'H'.repeat(22) }), (error) => error.status === 502 && error.code === 'temporarily_unavailable');
  }
});

test('M3.08 crash recovery reuses one pending tuple and commits one successor under concurrency', async () => {
  const calls = [];
  const fetchFn = async (_url, options) => {
    calls.push({ body: options.body, key: options.headers['Idempotency-Key'], nonce: options.headers['X-SkillMap-Device-Nonce'] });
    return new Response(JSON.stringify(response()), { status: 200, headers: { 'content-type': 'application/json', 'X-SkillMap-Response-Issued-At': '1000' } });
  };
  const first = await deps({ fetchFn });
  const body = JSON.stringify({ refresh_token: TOKEN, device_id: DEVICE_ID, audience: 'skillmap.connector.v1', token_family_id: FAMILY });
  const pending = { idempotencyKey: 'P'.repeat(22), requestDigest: computeSha256(Buffer.from(body, 'utf8')), wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 7, requestStartedAt: 999 };
  await first.credentialStore.markRefreshPending(pending);
  const second = new DeviceAuthUseCase({ client: first.client, keyStore: first.keyStore, credentialStore: first.credentialStore, metadataStore: new InMemoryDeviceAuthMetadataStore() });
  const [tokenA, tokenB] = await Promise.all([first.useCase.getAccessToken({ forceRefresh: true }), second.getAccessToken({ forceRefresh: true })]);
  assert.equal(tokenA, ACCESS);
  assert.equal(tokenB, ACCESS);
  assert.equal(new Set(calls.map((call) => call.key)).size, 1);
  assert.equal(new Set(calls.map((call) => call.body)).size, 1);
  assert.equal(new Set(calls.map((call) => call.nonce)).size, 1);
  const state = await first.credentialStore.loadState();
  assert.equal(state.pending, null);
  assert.equal(state.record.generation, 8);
  assert.equal(state.record.refreshToken, NEXT_TOKEN);
});

test('M3.08 changed local request digest fails closed without network and transient failures retain pending', async () => {
  let calls = 0;
  const first = await deps({ fetchFn: async () => { calls += 1; throw new TypeError('offline'); } });
  await first.credentialStore.markRefreshPending({ idempotencyKey: 'Q'.repeat(22), requestDigest: 'sha256:' + '0'.repeat(64), wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 7, requestStartedAt: 999 });
  await assert.rejects(first.useCase.getAccessToken({ forceRefresh: true }), (error) => error.code === 'idempotency_conflict');
  assert.equal(calls, 0);
  const state = await first.credentialStore.loadState();
  assert.ok(state.pending);
});

test('M3.08 deterministic crash points preserve or clear exactly one durable tuple', async () => {
  let calls = 0;
  const base = await deps({ fetchFn: async () => { calls += 1; throw new TypeError('offline'); } });
  const beforePending = new FaultyCredentialStore(base.credentialStore, 'before-pending');
  const blocked = makeUseCase(base.client, base.keyStore, beforePending);
  await assert.rejects(blocked.getAccessToken({ forceRefresh: true }), /secure_storage_unavailable|injected_before_pending/);
  assert.deepEqual(await base.credentialStore.loadState(), { record: await base.credentialStore.load(), pending: null });
  assert.equal(calls, 0);

  const responseLossStore = new FaultyCredentialStore(base.credentialStore, 'before-commit');
  let responses = 0;
  const responseClient = new DeviceAuthClient({
    origin: 'https://skillmap.example.test',
    keyStore: base.keyStore,
    deviceId: DEVICE_ID,
    clock: () => 1000,
    fetchFn: async () => { responses += 1; return makeResponseBody(); }
  });
  const responseLoss = makeUseCase(responseClient, base.keyStore, responseLossStore);
  await assert.rejects(responseLoss.getAccessToken({ forceRefresh: true }));
  const pendingAfterResponseLoss = (await base.credentialStore.loadState()).pending;
  assert.ok(pendingAfterResponseLoss);
  const restart = makeUseCase(responseClient, base.keyStore, base.credentialStore);
  assert.equal(await restart.getAccessToken({ forceRefresh: true }), ACCESS);
  assert.equal(responses, 2);
  assert.equal((await base.credentialStore.loadState()).pending, null);

  const clean = await deps({ fetchFn: async () => makeResponseBody() });
  const token = await clean.useCase.getAccessToken({ forceRefresh: true });
  assert.equal(token, ACCESS);
  const persisted = JSON.stringify(await clean.credentialStore.loadState());
  assert.equal(persisted.includes(ACCESS), false);

  let committedResponses = 0;
  const committed = await deps({ fetchFn: async () => { committedResponses += 1; return makeResponseBody(); } });
  const afterCommit = makeUseCase(committed.client, committed.keyStore, new FaultyCredentialStore(committed.credentialStore, 'after-commit'));
  await assert.rejects(afterCommit.getAccessToken({ forceRefresh: true }), /injected_after_commit/);
  const afterRestart = makeUseCase(committed.client, committed.keyStore, committed.credentialStore);
  assert.equal(await afterRestart.getAccessToken({ forceRefresh: true }), ACCESS);
  assert.equal((await committed.credentialStore.loadState()).pending, null);
  assert.equal((await committed.credentialStore.load()).generation, 9);
  assert.equal(committedResponses, 2);
});

test('M3.08 terminal errors delete credentials while transient errors retain exact pending', async () => {
  for (const code of ['invalid_grant', 'access_denied', 'invalid_token']) {
    const descriptions = {
      invalid_grant: 'The authorization grant is invalid.',
      access_denied: 'Authorization was not granted.',
      invalid_token: 'The access token is invalid.'
    };
    const { useCase, credentialStore } = await deps({
      fetchFn: async () => new Response(JSON.stringify({
        error: code,
        error_description: descriptions[code],
        retry_after: 0
      }), { status: code === 'invalid_token' ? 401 : 400, headers: { 'content-type': 'application/json; charset=utf-8' } })
    });
    await assert.rejects(useCase.getAccessToken({ forceRefresh: true }));
    assert.equal(await credentialStore.load(), null);
  }
  let calls = 0;
  const transient = await deps({ fetchFn: async () => { calls += 1; throw new TypeError('offline'); } });
  await assert.rejects(transient.useCase.getAccessToken({ forceRefresh: true }));
  const pending = (await transient.credentialStore.loadState()).pending;
  assert.ok(pending);
  assert.equal(pending.wireVersion, 'v1');
  assert.equal(pending.responseVersion, 'v1');
  assert.equal(calls, 3);
});

test('M3.08 proof and client-auth failures retain credentials while invalid_token deletes them', async () => {
  for (const code of ['proof_invalid', 'proof_required', 'invalid_client']) {
    const { useCase, credentialStore } = await deps({
      fetchFn: async () => new Response(JSON.stringify({
        error: code,
        error_description: {
          proof_invalid: 'Device proof is invalid.',
          proof_required: 'Device proof is required.',
          invalid_client: 'Client authentication failed.'
        }[code],
        retry_after: 0
      }), { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } })
    });
    await assert.rejects(useCase.getAccessToken({ forceRefresh: true }), (error) => error.code === code);
    assert.ok(await credentialStore.load(), `${code} must not purge credentials`);
    assert.ok((await credentialStore.loadState()).pending, `${code} must retain pending refresh state`);
  }
});

test('M3.08 changed family and generation are blocked before network', async () => {
  const base = await deps({ fetchFn: async () => { throw new Error('must_not_send'); } });
  const state = await base.credentialStore.loadState();
  const body = JSON.stringify({ refresh_token: TOKEN, device_id: DEVICE_ID, audience: 'skillmap.connector.v1', token_family_id: FAMILY });
  const pending = { idempotencyKey: 'Z'.repeat(22), requestDigest: computeSha256(Buffer.from(body, 'utf8')), wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 7, requestStartedAt: 999 };
  await base.credentialStore.markRefreshPending(pending);
  const tampered = {
    load: () => base.credentialStore.load(),
    loadState: async () => ({ record: { ...state.record, tokenFamilyId: 'fam_' + 'e'.repeat(32), generation: 8 }, pending }),
    commitExchange: (...args) => base.credentialStore.commitExchange(...args),
    markRefreshPending: (...args) => base.credentialStore.markRefreshPending(...args),
    commitRefresh: (...args) => base.credentialStore.commitRefresh(...args),
    delete: () => base.credentialStore.delete()
  };
  const useCase = makeUseCase(base.client, base.keyStore, tampered);
  await assert.rejects(useCase.getAccessToken({ forceRefresh: true }), (error) => error.code === 'idempotency_conflict');
});

test('M3.08 in-memory custody rejects runtime extra keys and malformed credential fields', async () => {
  const store = new InMemoryCredentialStore();
  const validRecord = {
    deviceId: DEVICE_ID, tokenFamilyId: FAMILY, refreshToken: TOKEN, scopes: ['device.status'], updatedAt: 1,
    generation: 0, familyAbsoluteExpiresAt: 10_000
  };
  await assert.rejects(store.commitExchange({ ...validRecord, extra: true }), /credential_record_invalid/);
  await store.commitExchange(validRecord);
  await assert.rejects(store.markRefreshPending({ idempotencyKey: 'P'.repeat(22), requestDigest: 'sha256:' + 'a'.repeat(64), wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 1, extra: true }), /credential_pending_invalid/);
  await assert.rejects(store.commitRefresh({ pending: { idempotencyKey: 'P'.repeat(22), requestDigest: 'sha256:' + 'a'.repeat(64), wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 1 }, record: { ...validRecord, generation: 1, refreshToken: 'bad-token' } }), /credential_record_invalid/);
});

test('M3.08 bounds near-expiry recovery to one extra refresh and two committed generations', async () => {
  let calls = 0;
  const base = await deps({
    fetchFn: async () => {
      calls += 1;
      return new Response(JSON.stringify(response(calls === 1 ? ACCESS : 'B'.repeat(43), calls === 1 ? NEXT_TOKEN : 'T'.repeat(43), NEXT_FAMILY, 30)), {
        status: 200,
        headers: { 'content-type': 'application/json', 'X-SkillMap-Response-Issued-At': '1000' }
      });
    }
  });

  const token = await base.useCase.getAccessToken({ forceRefresh: true });
  assert.equal(token, 'B'.repeat(43));
  assert.equal(calls, 2);
  const state = await base.credentialStore.loadState();
  assert.equal(state.record.generation, 9);
  assert.equal(state.pending, null);
});

test('M3.08 bounded second near-expiry response fails closed once already unusable', async () => {
  let now = 1000;
  let calls = 0;
  const base = await deps({
    clock: () => now,
    fetchFn: async () => {
      calls += 1;
      if (calls === 2) now = 1030;
      return new Response(JSON.stringify(response(calls === 1 ? ACCESS : 'C'.repeat(43), calls === 1 ? NEXT_TOKEN : 'U'.repeat(43), NEXT_FAMILY, calls === 1 ? 30 : 1)), {
        status: 200,
        headers: { 'content-type': 'application/json', 'X-SkillMap-Response-Issued-At': '1000' }
      });
    }
  });

  await assert.rejects(base.useCase.getAccessToken({ forceRefresh: true }), (error) => error.status === 401 && error.code === 'expired_token');
  assert.equal(calls, 2);
  const state = await base.credentialStore.loadState();
  assert.equal(state.record.generation, 9);
  assert.equal(state.pending, null);
});
