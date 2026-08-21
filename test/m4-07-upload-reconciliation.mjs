import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSha256 } from '../dist/contracts/device-auth.js';
import { ImportClient } from '../dist/network/import-client.js';
import { ImportUploader } from '../dist/network/import-uploader.js';
import { InMemoryDeviceKeyStore } from '../dist/platform/device-key-store.js';

const ORIGIN = 'https://skillmap.example.test';
const DEVICE_ID = 'D'.repeat(22);
const ACCESS_TOKEN = 'T'.repeat(43);
const SESSION_ID = `imp_${'a'.repeat(32)}`;
const VERSION_ID = `msv_${'a'.repeat(32)}`;
const EXPIRES_AT = '2026-08-20T12:00:00.000Z';

function makeFile(index) {
  const filePublicId = `msf_${'0'.repeat(31)}${index.toString(16).padStart(1, '0')}`;
  const relativePath = `files/file-${index}.txt`;
  const mediaType = 'text/plain';
  const bytes = Buffer.from(`content ${index}`, 'utf8');
  const byteSize = bytes.length;
  const digest = computeSha256(bytes);
  return { filePublicId, relativePath, mediaType, byteSize, digest, bytes };
}

function sessionResponse(overrides = {}) {
  return {
    session_public_id: SESSION_ID,
    state: 'in_progress',
    expected_file_count: 2,
    expected_byte_total: 18,
    accepted_file_count: 0,
    accepted_byte_total: 0,
    revision: 1,
    expires_at: EXPIRES_AT,
    ...overrides
  };
}

function baseSession() {
  return {
    sessionPublicId: SESSION_ID,
    state: 'in_progress',
    expectedFileCount: 2,
    expectedByteTotal: 18,
    acceptedFileCount: 0,
    acceptedByteTotal: 0,
    revision: 1,
    expiresAt: EXPIRES_AT
  };
}

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

function makeRouter({ receipts = [], state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 }, failFileIds = new Set(), transientOnce = new Set() }) {
  const prepareCalls = [];
  const acceptCalls = [];
  return {
    calls: { prepare: prepareCalls, accept: acceptCalls },
    async fetchFn(url, init) {
      if (url.includes('/receipts')) {
        return new Response(JSON.stringify({
          session_public_id: SESSION_ID,
          receipts
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/prepare-upload')) {
        const match = url.match(/\/files\/([^/]+)\/prepare-upload/);
        const fileId = match ? match[1] : 'unknown';
        prepareCalls.push(fileId);
        if (transientOnce.has(fileId)) {
          transientOnce.delete(fileId);
          return new Response(JSON.stringify({
            error: 'temporarily_unavailable',
            error_description: 'The import service is temporarily unavailable.',
            retry_after: 0
          }), { status: 503, headers: { 'content-type': 'application/json' } });
        }
        if (failFileIds.has(fileId)) {
          return new Response(JSON.stringify({
            error: 'session_conflict',
            error_description: 'The import session conflicts with a concurrent operation.',
            retry_after: 0
          }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          session_public_id: SESSION_ID,
          file_public_id: fileId,
          version_public_id: VERSION_ID,
          bucket_id: 'skill-vault-private',
          object_name: `v1/${VERSION_ID}/${fileId}`,
          upload_url: `${ORIGIN}/storage/v1/object/skill-vault-private/v1/${VERSION_ID}/${fileId}`,
          upload_expires_at: EXPIRES_AT,
          content_type: 'text/plain',
          declared_size: 9
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/accept')) {
        const match = url.match(/\/files\/([^/]+)\/accept/);
        const fileId = match ? match[1] : 'unknown';
        acceptCalls.push(fileId);
        if (failFileIds.has(fileId)) {
          return new Response(JSON.stringify({
            error: 'session_conflict',
            error_description: 'The import session conflicts with a concurrent operation.',
            retry_after: 0
          }), { status: 409, headers: { 'content-type': 'application/json' } });
        }
        state.revision += 1;
        state.acceptedCount += 1;
        state.acceptedBytes += 9;
        return new Response(JSON.stringify({
          ...sessionResponse(),
          accepted_file_count: state.acceptedCount,
          accepted_byte_total: state.acceptedBytes,
          revision: state.revision
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/resume')) {
        return new Response(JSON.stringify({
          ...sessionResponse(),
          accepted_file_count: state.acceptedCount,
          accepted_byte_total: state.acceptedBytes,
          revision: state.revision
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }
  };
}

function makeStorageRouter(records = new Map()) {
  return async (request) => {
    records.set(request.url, (records.get(request.url) ?? 0) + 1);
    return { status: 200 };
  };
}

test('M4.07 skips exact-match receipts and does not re-upload them', async () => {
  const file0 = makeFile(0);
  const file1 = makeFile(1);
  const receipts = [{
    file_public_id: file0.filePublicId,
    relative_path: file0.relativePath,
    accepted_byte_size: file0.byteSize,
    file_digest: file0.digest,
    ordinal: 0
  }];
  const state = { revision: 2, acceptedCount: 1, acceptedBytes: 9 };
  const router = makeRouter({ receipts, state });
  const client = await makeClient(router.fetchFn, { maxRetries: 0 });
  const uploader = new ImportUploader({ client, concurrency: 1, storageTransport: makeStorageRouter() });
  const session = { ...baseSession(), acceptedFileCount: 1, acceptedByteTotal: 9, revision: 2 };
  const result = await uploader.uploadFiles({ session, files: [file0, file1], accessToken: ACCESS_TOKEN });
  assert.equal(result.skipped.length, 1);
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(router.calls.prepare.length, 1);
  assert.equal(router.calls.accept.length, 1);
});

test('M4.07 retries missing files after a simulated interruption to reach the identical terminal manifest', async () => {
  const file0 = makeFile(0);
  const file1 = makeFile(1);
  const state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 };
  const failStorage = new Map();
  const storageRouter = async (request) => {
    if (request.url.includes(file0.filePublicId)) {
      return { status: 200 };
    }
    failStorage.set(request.url, true);
    return { status: 503 };
  };
  const router = makeRouter({ state });
  const client = await makeClient(router.fetchFn, { maxRetries: 0 });
  const uploader1 = new ImportUploader({ client, concurrency: 1, storageTransport: storageRouter });
  const session = baseSession();
  const result1 = await uploader1.uploadFiles({ session, files: [file0, file1], accessToken: ACCESS_TOKEN });
  assert.equal(result1.uploaded.length, 1);
  assert.equal(result1.failed.length, 1);

  const receipts = [{
    file_public_id: file0.filePublicId,
    relative_path: file0.relativePath,
    accepted_byte_size: file0.byteSize,
    file_digest: file0.digest,
    ordinal: 0
  }];
  const router2 = makeRouter({ receipts, state });
  const client2 = await makeClient(router2.fetchFn, { maxRetries: 0 });
  const uploader2 = new ImportUploader({ client: client2, concurrency: 1, storageTransport: makeStorageRouter() });
  const session2 = { ...baseSession(), acceptedFileCount: 1, acceptedByteTotal: 9, revision: 2 };
  const result2 = await uploader2.uploadFiles({ session: session2, files: [file0, file1], accessToken: ACCESS_TOKEN });
  assert.equal(result2.skipped.length, 1);
  assert.equal(result2.uploaded.length, 1);
  assert.equal(result2.conflicts.length, 0);
  assert.equal(result2.failed.length, 0);
  assert.equal(result2.session.acceptedFileCount, 2);
  assert.equal(result2.session.acceptedByteTotal, 18);
});

test('M4.07 rejects digest conflicts and does not overwrite accepted content', async () => {
  const file0 = makeFile(0);
  const file1 = makeFile(1);
  const receipts = [{
    file_public_id: file0.filePublicId,
    relative_path: file0.relativePath,
    accepted_byte_size: file0.byteSize,
    file_digest: `sha256:${'0'.repeat(64)}`,
    ordinal: 0
  }];
  const state = { revision: 2, acceptedCount: 1, acceptedBytes: 9 };
  const router = makeRouter({ receipts, state });
  const client = await makeClient(router.fetchFn, { maxRetries: 0 });
  const storageRecords = new Map();
  const uploader = new ImportUploader({ client, concurrency: 1, storageTransport: makeStorageRouter(storageRecords) });
  const session = { ...baseSession(), acceptedFileCount: 1, acceptedByteTotal: 9, revision: 2 };
  const result = await uploader.uploadFiles({ session, files: [file0, file1], accessToken: ACCESS_TOKEN });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(storageRecords.size, 1);
  const conflict = result.conflicts.find((c) => c.file.filePublicId === file0.filePublicId);
  assert.ok(conflict);
  assert.equal(conflict.reason, 'digest_mismatch');
});

test('M4.07 handles transient prepare failure with retry and idempotency', async () => {
  const file0 = makeFile(0);
  const state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 };
  const router = makeRouter({ state, transientOnce: new Set([file0.filePublicId]) });
  const client = await makeClient(router.fetchFn, { maxRetries: 0 });
  const uploader = new ImportUploader({ client, concurrency: 1, storageTransport: makeStorageRouter(), fileMaxRetries: 1, retryBaseMs: 10 });
  const session = {
    sessionPublicId: SESSION_ID,
    state: 'in_progress',
    expectedFileCount: 1,
    expectedByteTotal: 9,
    acceptedFileCount: 0,
    acceptedByteTotal: 0,
    revision: 1,
    expiresAt: EXPIRES_AT
  };
  const result = await uploader.uploadFiles({ session, files: [file0], accessToken: ACCESS_TOKEN });
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(router.calls.prepare.length, 2);
});

test('M4.07 accepts a matching immutable object after a no-overwrite storage conflict', async () => {
  const file = makeFile(0);
  const state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 };
  const router = makeRouter({ state });
  const client = await makeClient(router.fetchFn, { maxRetries: 0 });
  let storageCalls = 0;
  const uploader = new ImportUploader({
    client,
    concurrency: 1,
    fileMaxRetries: 0,
    storageTransport: async () => {
      storageCalls += 1;
      return { status: 409 };
    }
  });
  const session = {
    ...baseSession(),
    expectedFileCount: 1,
    expectedByteTotal: file.byteSize
  };

  const result = await uploader.uploadFiles({ session, files: [file], accessToken: ACCESS_TOKEN });

  assert.equal(storageCalls, 1);
  assert.deepEqual(router.calls.accept, [file.filePublicId]);
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.session.acceptedFileCount, 1);
});
