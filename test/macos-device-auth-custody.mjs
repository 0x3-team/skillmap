import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  assertHelperRequest,
  decodeHelperFrame,
  encodeHelperFrame,
  MACOS_HELPER_MAX_FRAME_BYTES
} from '../dist/platform/macos-keychain-protocol.js';
import { FakeMacOSHelperTransport, MacOSHelperError } from '../dist/platform/macos-keychain-helper-client.js';
import { MacOSCredentialStore } from '../dist/platform/macos-credential-store.js';
import { MacOSDeviceAuthMetadataStore } from '../dist/platform/macos-device-auth-metadata-store.js';
import { MacOSDeviceKeyStore } from '../dist/platform/macos-device-key-store.js';
import { createMacOSCustodyStores } from '../dist/platform/macos-custody-factory.js';
import { CLI_EXIT_CODES, mapDeviceAuthErrorToExitCode, resolveDeviceAuthUseCase } from '../dist/core/cli-exit.js';
import { dispatchCommand } from '../dist/cli.js';
import { derToP1363, p1363ToDer } from '../dist/contracts/device-auth.js';
import { DeviceAuthClient } from '../dist/network/device-auth-client.js';
import { DeviceAuthUseCase } from '../dist/services/device-auth-use-case.js';

function ok(result = {}) { return { version: 1, ok: true, result }; }
function fail(code) { return { version: 1, ok: false, error: { code } }; }

function createFakeKeychain(options = {}) {
  let pair = null;
  let record = null;
  let pending = null;
  let metadata = null;
  const transport = new FakeMacOSHelperTransport(async (request) => {
    switch (request.operation) {
      case 'exists_key': return options.keyQueryError ? fail(options.keyQueryError) : ok({ exists: Boolean(pair) });
      case 'create_key': {
        if (options.keyQueryError) return fail(options.keyQueryError);
        if (!pair) pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        return ok({ x963_base64url: pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(26).toString('base64url') });
      }
      case 'public_key':
        if (options.keyQueryError) return fail(options.keyQueryError);
        return pair ? ok({ x963_base64url: pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(26).toString('base64url') }) : fail('not_found');
      case 'sign': {
        if (options.keyQueryError) return fail(options.keyQueryError);
        if (!pair) return fail('not_found');
        const message = Buffer.from(String(request.payload.preimage_base64url), 'base64url');
        const der = sign('sha256', message, pair.privateKey);
        return ok({ signature_der_base64url: der.toString('base64url') });
      }
      case 'delete_key': pair = null; return ok({ deleted: true });
      case 'credential_load':
        if (options.credentialLoadError) return fail(options.credentialLoadError);
        if (options.credentialLoadResult !== undefined) return ok(options.credentialLoadResult);
        return ok({ ...(record ? { record } : {}), ...(pending ? { pending } : {}) });
      case 'credential_commit_exchange': record = structuredClone(request.payload.record); pending = null; return ok();
      case 'credential_mark_refresh_pending':
        if (!record) return fail('not_found');
        if (pending && JSON.stringify(pending) !== JSON.stringify(request.payload.pending)) return fail('credential_pending_conflict');
        pending = structuredClone(request.payload.pending);
        return ok({ pending });
      case 'credential_commit_refresh':
        if (!record || !pending) return fail('credential_commit_conflict');
        record = structuredClone(request.payload.record);
        pending = null;
        return ok();
      case 'credential_delete': record = null; pending = null; return ok({ deleted: true });
      case 'metadata_load':
        if (options.metadataLoadError) return fail(options.metadataLoadError);
        if (options.metadataLoadResult !== undefined) return ok(options.metadataLoadResult);
        return ok(metadata ? { metadata: structuredClone(metadata) } : {});
      case 'metadata_save': metadata = structuredClone(request.payload.metadata); return ok();
      case 'metadata_delete': metadata = null; return ok({ deleted: true });
      default: return fail('unknown_operation');
    }
  });
  return { transport, getPair: () => pair };
}

test('native helper framing is length-bounded and rejects malformed replies', () => {
  const frame = encodeHelperFrame({ version: 1, namespace: 'test', operation: 'exists_key' });
  assert.deepEqual(decodeHelperFrame(frame), { version: 1, namespace: 'test', operation: 'exists_key' });
  assert.throws(() => decodeHelperFrame(Buffer.from([0, 0, 0, 5, 1, 2])), /frame_(size_mismatch|length)/);
  assert.throws(() => decodeHelperFrame(Buffer.from([0, 1, 0, 0])), /frame_length/);
  assert.throws(() => encodeHelperFrame({ version: 1, namespace: 'test', operation: 'sign', payload: { preimage_base64url: Buffer.from('x'.repeat(MACOS_HELPER_MAX_FRAME_BYTES)).toString('base64url') } }), /frame_too_large/);
  assert.throws(() => assertHelperRequest({ version: 2, namespace: 'test', operation: 'exists_key' }), /request_header/);
  assert.throws(() => assertHelperRequest({ version: 1, namespace: 'unsafe namespace', operation: 'exists_key' }), /request_header/);
  assert.throws(() => assertHelperRequest({ version: 1, namespace: 'é', operation: 'exists_key' }), /request_header/);
  const secret = 'refresh-token-secret-not-for-errors';
  const error = new MacOSHelperError(secret);
  assert.equal(error.code, 'protocol_error');
  assert.equal(error.message, 'Secure credential storage is unavailable.');
  assert.doesNotMatch(error.message, /refresh-token-secret/);
  assert.deepEqual(mapDeviceAuthErrorToExitCode(error), {
    exitCode: CLI_EXIT_CODES.INTEGRITY_PROTOCOL_ERROR,
    code: 'secure_storage_unavailable',
    message: 'Secure credential storage is unavailable.'
  });
});

test('macOS key store performs create/public-key/thumbprint/sign/exists/delete via bounded transport', async () => {
  const { transport, getPair } = createFakeKeychain();
  const store = new MacOSDeviceKeyStore(transport, 'test-namespace-unique');
  assert.equal(await store.hasKey(), false);
  const info = await store.createKey();
  assert.equal(info.spkiBytes.length, 91);
  assert.equal(await store.hasKey(), true);
  assert.equal(await store.getThumbprint(), info.thumbprint);
  const spki = await store.getPublicKeySpki();
  assert.deepEqual(Buffer.from(spki), Buffer.from(info.spkiBytes));
  const wire = await store.signProof('deterministic proof preimage');
  assert.equal(Buffer.from(wire, 'base64url').length, 64);
  const publicKey = createPublicKey({ key: info.spkiBytes, format: 'der', type: 'spki' });
  assert.equal(verify('sha256', Buffer.from('deterministic proof preimage'), publicKey, p1363ToDer(Buffer.from(wire, 'base64url'))), true);
  assert.equal(getPair() !== null, true);
  await store.deleteKey();
  assert.equal(await store.hasKey(), false);
  assert.equal(await store.getPublicKeySpki(), null);
  assert.deepEqual(transport.requests.map((request) => request.operation), ['exists_key', 'create_key', 'exists_key', 'public_key', 'public_key', 'sign', 'delete_key', 'exists_key', 'public_key']);
});

test('macOS credential store commits, atomically replaces, recovers pending state, and deletes', async () => {
  const { transport } = createFakeKeychain();
  const keyStore = new MacOSDeviceKeyStore(transport, 'test-namespace-credentials');
  const store = new MacOSCredentialStore(transport, 'test-namespace-credentials');
  assert.equal(await store.load(), null);
  const initial = { deviceId: 'D'.repeat(22), tokenFamilyId: 'fam_' + '1'.repeat(32), refreshToken: 'R'.repeat(43), scopes: ['device.status'], updatedAt: 10, generation: 0, familyAbsoluteExpiresAt: 1000, devicePublicId: 'dev_' + '2'.repeat(32), accountPublicId: 'acct_' + '3'.repeat(32) };
  await keyStore.createKey();
  await store.commitExchange(initial);
  assert.deepEqual(await store.load(), initial);
  const pendingTuple = { idempotencyKey: 'I'.repeat(22), requestDigest: 'sha256:' + 'd'.repeat(64), wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 11 };
  await store.markRefreshPending(pendingTuple);
  assert.deepEqual((await store.loadState()).pending, pendingTuple);
  await store.commitRefresh({ pending: pendingTuple, record: { ...initial, tokenFamilyId: 'fam_' + '5'.repeat(32), refreshToken: 'S'.repeat(43), updatedAt: 12, generation: 1 } });
  assert.deepEqual(await store.load(), { ...initial, tokenFamilyId: 'fam_' + '5'.repeat(32), refreshToken: 'S'.repeat(43), updatedAt: 12, generation: 1 });
  assert.equal((await store.loadState()).pending, null);
  await keyStore.deleteKey();
  assert.deepEqual(await store.load(), { ...initial, tokenFamilyId: 'fam_' + '5'.repeat(32), refreshToken: 'S'.repeat(43), updatedAt: 12, generation: 1 });
  await store.delete();
  assert.equal(await store.load(), null);
  assert.equal(await store.getPendingOperation(), null);
});

test('credential read-modify-write operations serialize across helper-process boundaries', async () => {
  let state = { record: { deviceId: 'L'.repeat(22), tokenFamilyId: 'fam_' + '4'.repeat(32), refreshToken: 'T'.repeat(43), scopes: ['device.status'], updatedAt: 1, generation: 0, familyAbsoluteExpiresAt: 1000 }, pending: null };
  let tail = Promise.resolve();
  const transport = {
    async request(request) {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        if (request.operation === 'credential_commit_refresh') {
          const next = structuredClone(state);
          await new Promise((resolve) => setTimeout(resolve, 2));
          next.record = request.payload.record;
          next.pending = null;
          state = next;
        } else if (request.operation === 'credential_mark_refresh_pending') {
          const next = structuredClone(state);
          await new Promise((resolve) => setTimeout(resolve, 2));
          next.pending = request.payload.pending;
          state = next;
        } else if (request.operation === 'credential_load') {
          return ok(structuredClone(state));
        }
        return ok();
      } finally {
        release();
      }
    }
  };
  const store = new MacOSCredentialStore(transport, 'test-concurrent-lock');
  const concurrentPending = { idempotencyKey: 'C'.repeat(22), requestDigest: 'sha256:' + 'e'.repeat(64), wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 2 };
  await store.markRefreshPending(concurrentPending);
  await Promise.all([
    store.commitRefresh({ pending: concurrentPending, record: { ...state.record, refreshToken: 'S'.repeat(43), generation: 1 } }),
    store.markRefreshPending(concurrentPending)
  ]);
  assert.deepEqual(state.record, { deviceId: 'L'.repeat(22), tokenFamilyId: 'fam_' + '4'.repeat(32), refreshToken: 'S'.repeat(43), scopes: ['device.status'], updatedAt: 1, generation: 1, familyAbsoluteExpiresAt: 1000 });
  assert.deepEqual(state.pending, concurrentPending);
});

test('macOS metadata persists across reconstructed stores, clients, and use cases', async () => {
  const { transport } = createFakeKeychain();
  const namespace = 'test-metadata-persistence';
  const metadata1 = new MacOSDeviceAuthMetadataStore(transport, namespace);
  const keyStore1 = new MacOSDeviceKeyStore(transport, namespace);
  const credentialStore1 = new MacOSCredentialStore(transport, namespace);
  const client1 = new DeviceAuthClient({
    origin: 'https://skillmap.example.test', keyStore: keyStore1, metadataStore: metadata1,
    randomBytes: () => new Uint8Array(16).fill(1)
  });
  const useCase1 = new DeviceAuthUseCase({ client: client1, keyStore: keyStore1, credentialStore: credentialStore1, metadataStore: metadata1 });
  void useCase1;
  await metadata1.save({ deviceId: 'ABCDEFGHIJKLMNOPQRSTUV', verificationUri: 'https://skillmap.example.test/device', platform: 'macos', connectorVersion: '0.1.0' });
  assert.equal(await client1.getDeviceId(), 'ABCDEFGHIJKLMNOPQRSTUV');

  const metadata2 = new MacOSDeviceAuthMetadataStore(transport, namespace);
  const keyStore2 = new MacOSDeviceKeyStore(transport, namespace);
  const credentialStore2 = new MacOSCredentialStore(transport, namespace);
  const client2 = new DeviceAuthClient({
    origin: 'https://skillmap.example.test', keyStore: keyStore2, metadataStore: metadata2,
    randomBytes: () => new Uint8Array(16).fill(2)
  });
  const useCase2 = new DeviceAuthUseCase({ client: client2, keyStore: keyStore2, credentialStore: credentialStore2, metadataStore: metadata2 });
  void useCase2;
  assert.equal(await client2.getDeviceId(), 'ABCDEFGHIJKLMNOPQRSTUV');
  await assert.rejects(() => metadata2.save({ deviceId: 'bad', verificationUri: '' }), /metadata_device_id/);
  await credentialStore2.commitExchange({ deviceId: 'ABCDEFGHIJKLMNOPQRSTUV', tokenFamilyId: 'family-meta', refreshToken: 'refresh-meta', scopes: ['device.status'], updatedAt: 1 });
  await metadata2.delete();
  assert.equal(await metadata1.load(), null);
  assert.deepEqual(await credentialStore2.load(), { deviceId: 'ABCDEFGHIJKLMNOPQRSTUV', tokenFamilyId: 'family-meta', refreshToken: 'refresh-meta', scopes: ['device.status'], updatedAt: 1 });
});

test('non-notFound Keychain errors and corrupt credential state fail closed', async () => {
  const keyFailure = new MacOSDeviceKeyStore(createFakeKeychain({ keyQueryError: 'interaction_not_allowed' }).transport, 'test-key-errors');
  await assert.rejects(() => keyFailure.hasKey(), (error) => error instanceof MacOSHelperError && error.code === 'interaction_not_allowed');
  await assert.rejects(() => keyFailure.createKey(), (error) => error instanceof MacOSHelperError && error.code === 'interaction_not_allowed');
  await assert.rejects(() => keyFailure.getPublicKeySpki(), (error) => error instanceof MacOSHelperError && error.code === 'interaction_not_allowed');
  const credentialFailure = new MacOSCredentialStore(createFakeKeychain({ credentialLoadError: 'interaction_not_allowed' }).transport, 'test-credential-errors');
  await assert.rejects(() => credentialFailure.load(), (error) => error instanceof MacOSHelperError && error.code === 'interaction_not_allowed');
  const corruptCredential = new MacOSCredentialStore(createFakeKeychain({ credentialLoadError: 'credential_corrupt' }).transport, 'test-corrupt-credentials');
  await assert.rejects(() => corruptCredential.load(), (error) => error instanceof MacOSHelperError && error.code === 'credential_corrupt');
  const corruptMetadata = new MacOSDeviceAuthMetadataStore(createFakeKeychain({ metadataLoadError: 'metadata_corrupt' }).transport, 'test-corrupt-metadata');
  await assert.rejects(() => corruptMetadata.load(), (error) => error instanceof MacOSHelperError && error.code === 'metadata_corrupt');
});

test('present primitive, array, and malformed success payloads never become signed-out state', async () => {
  for (const record of ['credential-secret', 7, [], ['record'], { deviceId: 'missing-fields' }]) {
    const store = new MacOSCredentialStore(createFakeKeychain({ credentialLoadResult: { record } }).transport, 'test-record-corrupt');
    await assert.rejects(() => store.load(), (error) => error instanceof MacOSHelperError && error.code === 'credential_corrupt');
  }
  for (const metadata of ['metadata-secret', 7, [], ['metadata'], { deviceId: 'short', verificationUri: '' }]) {
    const store = new MacOSDeviceAuthMetadataStore(createFakeKeychain({ metadataLoadResult: { metadata } }).transport, 'test-metadata-corrupt');
    await assert.rejects(() => store.load(), (error) => error instanceof MacOSHelperError && error.code === 'metadata_corrupt');
  }
  const absentRecord = new MacOSCredentialStore(createFakeKeychain({ credentialLoadResult: { record: null } }).transport, 'test-record-absent');
  const absentMetadata = new MacOSDeviceAuthMetadataStore(createFakeKeychain({ metadataLoadResult: { metadata: null } }).transport, 'test-metadata-absent');
  assert.equal(await absentRecord.load(), null);
  assert.equal(await absentMetadata.load(), null);

  const validRecord = { deviceId: 'D'.repeat(22), tokenFamilyId: 'fam_' + '1'.repeat(32), refreshToken: 'R'.repeat(43), scopes: ['device.status'], updatedAt: 1, generation: 0, familyAbsoluteExpiresAt: 1000 };
  const validPending = { idempotencyKey: 'P'.repeat(22), requestDigest: 'sha256:' + 'a'.repeat(64), wireVersion: 'v1', responseVersion: 'v1', expectedGeneration: 0, requestStartedAt: 1 };
  for (const result of [
    { record: { ...validRecord, unknown: true } },
    { record: { ...validRecord, devicePublicId: 7 } },
    { record: validRecord, pending: { ...validPending, unknown: true } },
    { record: validRecord, pending: { ...validPending, requestStartedAt: '1' } }
  ]) {
    const corrupt = new MacOSCredentialStore(createFakeKeychain({ credentialLoadResult: result }).transport, 'test-envelope-corrupt');
    await assert.rejects(() => corrupt.loadState(), (error) => error instanceof MacOSHelperError && error.code === 'credential_corrupt');
  }
});

test('production custody factory is opt-in and never selects memory or non-macOS storage', async () => {
  const prior = process.env.SKILLMAP_ENABLE_MACOS_CUSTODY;
  const priorOrigin = process.env.SKILLMAP_DEVICE_AUTH_ORIGIN;
  const priorPath = process.env.SKILLMAP_MACOS_HELPER_PATH;
  delete process.env.SKILLMAP_ENABLE_MACOS_CUSTODY;
  assert.throws(() => createMacOSCustodyStores(), /Secure credential storage is unavailable/);
  process.env.SKILLMAP_ENABLE_MACOS_CUSTODY = '1';
  assert.throws(() => createMacOSCustodyStores({ helperPath: '/definitely-not-installed/skillmap-keychain-helper', namespace: 'disposable-test' }), /Secure credential storage is unavailable/);
  const root = mkdtempSync(join(tmpdir(), 'skillmap-m306-'));
  const helperPath = join(root, 'helper');
  writeFileSync(helperPath, `#!/usr/bin/env node
import(${JSON.stringify(join(process.cwd(), 'dist/platform/macos-keychain-protocol.js'))}).then(({ decodeHelperFrame, encodeHelperFrame }) => {
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  const request = decodeHelperFrame(Buffer.concat(chunks));
  const result = request.operation === 'exists_key' ? { exists: false } : {};
  process.stdout.write(encodeHelperFrame({ version: 1, ok: true, operation: request.operation, result }));
});
});
`, { mode: 0o700 });
  chmodSync(helperPath, 0o700);
  process.env.SKILLMAP_MACOS_HELPER_PATH = helperPath;
  const stores = createMacOSCustodyStores({ namespace: 'disposable-test' });
  assert.equal(stores.keyStore.constructor.name, 'MacOSDeviceKeyStore');
  assert.equal(stores.credentialStore.constructor.name, 'MacOSCredentialStore');
  process.env.SKILLMAP_DEVICE_AUTH_ORIGIN = 'https://skillmap.example.test';
  const resolved = resolveDeviceAuthUseCase();
  assert.equal(resolved.constructor.name, 'DeviceAuthUseCase');
  assert.equal(resolved.metadataStore.constructor.name, 'MacOSDeviceAuthMetadataStore');
  assert.equal(typeof resolved.onDisplayCodeFn, 'function');
  assert.equal(typeof resolved.openBrowserFn, 'function');
  const previousError = console.error;
  const displayOutput = [];
  console.error = (...args) => displayOutput.push(args.join(' '));
  try {
    resolved.onDisplayCodeFn({
      userCode: 'TEST0-1234A',
      verificationUri: 'https://skillmap.example.test/device',
      expiresIn: 600
    });
  } finally {
    console.error = previousError;
  }
  assert.match(displayOutput.join('\n'), /TEST0-1234A/);
  assert.match(displayOutput.join('\n'), /https:\/\/skillmap\.example\.test\/device/);
  const dispatched = await dispatchCommand('/test/cwd', 'auth', ['status'], {});
  assert.equal(dispatched.state, 'signed_out');
  rmSync(root, { recursive: true, force: true });
  if (prior === undefined) delete process.env.SKILLMAP_ENABLE_MACOS_CUSTODY;
  else process.env.SKILLMAP_ENABLE_MACOS_CUSTODY = prior;
  if (priorOrigin === undefined) delete process.env.SKILLMAP_DEVICE_AUTH_ORIGIN;
  else process.env.SKILLMAP_DEVICE_AUTH_ORIGIN = priorOrigin;
  if (priorPath === undefined) delete process.env.SKILLMAP_MACOS_HELPER_PATH;
  else process.env.SKILLMAP_MACOS_HELPER_PATH = priorPath;
});
