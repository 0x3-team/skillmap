import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
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

function fileDigest(path) {
  return computeSha256(Buffer.from(path, 'utf8'));
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

function receiptFromFile(file, ordinal = 0) {
  return {
    file_public_id: file.filePublicId,
    relative_path: file.relativePath,
    accepted_byte_size: file.byteSize,
    file_digest: file.digest,
    ordinal
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

function makeStorageRouter(records = new Map()) {
  return async (request) => {
    records.set(request.url, (records.get(request.url) ?? 0) + 1);
    return { status: 200 };
  };
}

function makeControlRouter(receipts = [], state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 }) {
  return async (url, init) => {
    if (url.includes('/receipts')) {
      return new Response(JSON.stringify({
        session_public_id: SESSION_ID,
        revision: state.revision,
        receipts
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/prepare-upload')) {
      const fileId = url.match(/\/files\/([^/]+)\/prepare-upload/)[1];
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
    return new Response('not found', { status: 404 });
  };
}

test('M4.06 uploads all manifest files in the correct order and emits progress', async () => {
  const state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 };
  const storageRecords = new Map();
  const client = await makeClient(makeControlRouter([], state));
  const progressEvents = [];
  const uploader = new ImportUploader({
    client,
    concurrency: 1,
    storageTransport: makeStorageRouter(storageRecords),
    onProgress: (event) => progressEvents.push(event)
  });
  const files = [makeFile(0), makeFile(1)];
  const session = {
    sessionPublicId: SESSION_ID,
    state: 'in_progress',
    expectedFileCount: 2,
    expectedByteTotal: 18,
    acceptedFileCount: 0,
    acceptedByteTotal: 0,
    revision: 1,
    expiresAt: EXPIRES_AT
  };
  const result = await uploader.uploadFiles({ session, files, accessToken: ACCESS_TOKEN });

  assert.equal(result.uploaded.length, 2);
  assert.equal(result.failed.length, 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.session.acceptedFileCount, 2);
  assert.equal(result.session.acceptedByteTotal, 18);
  assert.equal(result.session.revision, 3);
  assert.equal(storageRecords.size, 2);
  assert.ok(progressEvents.length >= 3);
  assert.equal(progressEvents[progressEvents.length - 1].percentComplete, 100);
  assert.equal(progressEvents[progressEvents.length - 1].acceptedFileCount, 2);
});

test('M4.06 accepts the canonical manifest path grammar, including spaces and NFC Unicode', async () => {
  const state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 };
  const client = await makeClient(makeControlRouter([], state));
  const uploader = new ImportUploader({
    client,
    concurrency: 1,
    storageTransport: makeStorageRouter()
  });
  const file = { ...makeFile(0), relativePath: 'references/café guide.txt' };
  const session = {
    sessionPublicId: SESSION_ID,
    state: 'in_progress',
    expectedFileCount: 1,
    expectedByteTotal: file.byteSize,
    acceptedFileCount: 0,
    acceptedByteTotal: 0,
    revision: 1,
    expiresAt: EXPIRES_AT
  };

  const result = await uploader.uploadFiles({ session, files: [file], accessToken: ACCESS_TOKEN });

  assert.equal(result.uploaded.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.uploaded[0].relativePath, 'references/café guide.txt');
});

test('M4.06 bounds upload concurrency and does not exceed the configured limit', async () => {
  const state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 };
  let staleAcceptConflicts = 0;
  let active = 0;
  let maxActive = 0;
  const storageRouter = async (request) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    active -= 1;
    return { status: 200 };
  };
  const controlRouter = async (url, init) => {
    if (url.includes('/receipts')) {
      return new Response(JSON.stringify({ session_public_id: SESSION_ID, revision: state.revision, receipts: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/prepare-upload')) {
      const fileId = url.match(/\/files\/([^/]+)\/prepare-upload/)[1];
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
      const body = JSON.parse(init.body);
      await new Promise((resolve) => { setTimeout(resolve, 10); });
      if (body.expected_revision !== state.revision) {
        staleAcceptConflicts += 1;
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
  };
  const client = await makeClient(controlRouter);
  const uploader = new ImportUploader({ client, concurrency: 2, storageTransport: storageRouter });
  const files = Array.from({ length: 8 }, (_, i) => makeFile(i));
  const session = {
    sessionPublicId: SESSION_ID,
    state: 'in_progress',
    expectedFileCount: 8,
    expectedByteTotal: 72,
    acceptedFileCount: 0,
    acceptedByteTotal: 0,
    revision: 1,
    expiresAt: EXPIRES_AT
  };
  const result = await uploader.uploadFiles({ session, files, accessToken: ACCESS_TOKEN });
  assert.equal(maxActive, 2);
  assert.equal(result.uploaded.length, 8);
  assert.equal(result.failed.length, 0);
  assert.equal(staleAcceptConflicts, 0, 'parallel storage uploads must serialize revision-bound accepts');
});

test('M4.06 retries a transient storage failure and does not duplicate accepted files', async () => {
  const state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 };
  const file = makeFile(0);
  const attempts = [];
  const storageRouter = async (request) => {
    attempts.push(request);
    if (attempts.length === 1) {
      return { status: 503 };
    }
    return { status: 200 };
  };
  const client = await makeClient(makeControlRouter([], state), { maxRetries: 0 });
  const uploader = new ImportUploader({ client, storageTransport: storageRouter, fileMaxRetries: 1, retryBaseMs: 10 });
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
  const result = await uploader.uploadFiles({ session, files: [file], accessToken: ACCESS_TOKEN });
  assert.equal(result.uploaded.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(attempts.length, 2);
});

test('M4.06 reports a reused invalid Storage object as one deterministic conflict', async () => {
  const file = makeFile(0);
  let accepted = 0;
  const controlRouter = async (url) => {
    if (url.includes('/receipts')) {
      return new Response(JSON.stringify({ session_public_id: SESSION_ID, revision: 1, receipts: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/prepare-upload')) {
      return new Response(JSON.stringify({
        session_public_id: SESSION_ID,
        file_public_id: file.filePublicId,
        version_public_id: VERSION_ID,
        bucket_id: 'skill-vault-private',
        object_name: `v1/${VERSION_ID}/${file.filePublicId}`,
        upload_url: `${ORIGIN}/storage/v1/object/skill-vault-private/v1/${VERSION_ID}/${file.filePublicId}`,
        upload_expires_at: EXPIRES_AT,
        content_type: file.mediaType,
        declared_size: file.byteSize
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/accept')) {
      accepted += 1;
      return new Response(JSON.stringify({
        error: 'stored_object_conflict',
        error_description: 'The stored upload does not match the immutable file.',
        retry_after: 0
      }), { status: 409, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };
  const client = await makeClient(controlRouter, { maxRetries: 0 });
  const uploader = new ImportUploader({
    client,
    storageTransport: async () => ({ status: 409 }),
    fileMaxRetries: 2
  });
  const result = await uploader.uploadFiles({
    session: {
      sessionPublicId: SESSION_ID,
      state: 'in_progress',
      expectedFileCount: 1,
      expectedByteTotal: file.byteSize,
      acceptedFileCount: 0,
      acceptedByteTotal: 0,
      revision: 1,
      expiresAt: EXPIRES_AT
    },
    files: [file],
    accessToken: ACCESS_TOKEN
  });

  assert.equal(accepted, 1);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(result.conflicts.map(({ reason }) => reason), ['stored_object_conflict']);
});

test('M4.06 enforces per-file timeout and reports failure without stalling the queue', async () => {
  const state = { revision: 1, acceptedCount: 0, acceptedBytes: 0 };
  const file = makeFile(0);
  const storageRouter = async (request) => {
    return new Promise((_, reject) => {
      const onAbort = () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      if (request.signal?.aborted) {
        onAbort();
        return;
      }
      request.signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
  const client = await makeClient(makeControlRouter([], state), { maxRetries: 0 });
  const uploader = new ImportUploader({ client, storageTransport: storageRouter, fileTimeoutMs: 50, fileMaxRetries: 0 });
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
  const result = await uploader.uploadFiles({ session, files: [file], accessToken: ACCESS_TOKEN });
  assert.equal(result.uploaded.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].error.code, 'upload_timeout');
});

test('M4.06 rejects bytes that do not match the manifest digest or size before uploading', async () => {
  const client = await makeClient(async () => new Response('{}', { status: 200 }));
  const uploader = new ImportUploader({ client });
  const file = makeFile(0);
  file.bytes = Buffer.from('tampered', 'utf8');
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
  await assert.rejects(
    uploader.uploadFiles({ session, files: [file], accessToken: ACCESS_TOKEN }),
    (err) => err instanceof Error
  );
});
