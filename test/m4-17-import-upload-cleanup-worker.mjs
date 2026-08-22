import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  createStorageObjectDeleter,
  processImportUploadCleanupOnce
} from '../apps/worker/src/import-upload-cleanup-once.mjs';
import { createSupabaseRpcClient } from '../apps/worker/src/supabase-rpc.mjs';

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';
const VERSION_ID = `msv_${'a'.repeat(32)}`;
const FILE_ID = `msf_${'b'.repeat(32)}`;
const OBJECT_NAME = `v1/${VERSION_ID}/${FILE_ID}`;
const SECRET = `service-role-${'x'.repeat(48)}`;

test('M4.17 deletes one exact claimed object and completes its job', async () => {
  const calls = [];
  const rpc = {
    async call(name, params) {
      calls.push({ name, params });
      if (name === 'claim_import_upload_cleanup') return [{
        job_id: JOB_ID,
        bucket_id: 'skill-vault-private',
        object_name: OBJECT_NAME,
        cleanup_reason: 'stored_object_digest_conflict',
        attempt_count: 1,
        claimed_at: '2026-08-21T12:00:00Z'
      }];
      if (name === 'complete_import_upload_cleanup') return {
        job_id: JOB_ID,
        state: 'completed',
        completed_at: '2026-08-21T12:00:01Z'
      };
      throw new Error(`unexpected ${name}`);
    }
  };
  const deleted = [];

  const result = await processImportUploadCleanupOnce({
    rpc,
    deleteObject: async (bucket, objectName) => deleted.push({ bucket, objectName })
  });

  assert.deepEqual(deleted, [{ bucket: 'skill-vault-private', objectName: OBJECT_NAME }]);
  assert.deepEqual(calls.map((call) => call.name), [
    'claim_import_upload_cleanup',
    'complete_import_upload_cleanup'
  ]);
  assert.deepEqual(calls[1].params, { p_job_id: JOB_ID });
  assert.deepEqual(result, { result: 'completed', mutation: true, jobId: JOB_ID });
});

test('M4.17 requeues the exact claim when object deletion fails', async () => {
  const calls = [];
  const rpc = {
    async call(name, params) {
      calls.push({ name, params });
      if (name === 'claim_import_upload_cleanup') return [{
        job_id: JOB_ID,
        bucket_id: 'skill-vault-private',
        object_name: OBJECT_NAME,
        cleanup_reason: 'stored_object_digest_conflict',
        attempt_count: 2,
        claimed_at: '2026-08-21T12:00:00Z'
      }];
      if (name === 'fail_import_upload_cleanup') return {
        job_id: JOB_ID,
        state: 'queued',
        attempt_count: 2
      };
      throw new Error(`unexpected ${name}`);
    }
  };

  await assert.rejects(
    processImportUploadCleanupOnce({
      rpc,
      deleteObject: async () => { throw new Error('provider body with sensitive data'); }
    }),
    /Storage cleanup failed/
  );
  assert.deepEqual(calls.map((call) => call.name), [
    'claim_import_upload_cleanup',
    'fail_import_upload_cleanup'
  ]);
  assert.deepEqual(calls[1].params, { p_job_id: JOB_ID, p_retry_delay_seconds: 30 });
});

test('M4.17 Storage deletion is exact, bounded, and does not reflect provider data', async () => {
  let request;
  const deleteObject = createStorageObjectDeleter({
    url: 'https://example.supabase.co',
    serviceRoleKey: SECRET,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify([{ name: OBJECT_NAME }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  await deleteObject('skill-vault-private', OBJECT_NAME);
  assert.equal(request.url, 'https://example.supabase.co/storage/v1/object/skill-vault-private');
  assert.equal(request.init.method, 'DELETE');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.headers.apikey, SECRET);
  assert.equal(request.init.headers.authorization, `Bearer ${SECRET}`);
  assert.deepEqual(JSON.parse(request.init.body), { prefixes: [OBJECT_NAME] });

  const rejected = createStorageObjectDeleter({
    url: 'https://example.supabase.co',
    serviceRoleKey: SECRET,
    fetchImpl: async () => new Response(JSON.stringify({ message: `leak ${SECRET}` }), { status: 500 })
  });
  await assert.rejects(rejected('skill-vault-private', OBJECT_NAME), (error) => {
    assert.match(error.message, /HTTP 500/);
    assert.doesNotMatch(error.message, new RegExp(SECRET));
    assert.doesNotMatch(error.message, /leak/);
    return true;
  });
});

test('M4.17 Storage deletion cancels an oversized streamed response before whole-body buffering', async () => {
  let arrayBufferCalled = false;
  let cancelled = false;
  let delivered = false;
  const deleteObject = createStorageObjectDeleter({
    url: 'https://example.supabase.co',
    serviceRoleKey: SECRET,
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => {
        arrayBufferCalled = true;
        throw new Error('whole-body buffering was used');
      },
      body: {
        getReader: () => ({
          async read() {
            if (delivered) return { done: true, value: undefined };
            delivered = true;
            return { done: false, value: new Uint8Array((64 * 1024) + 1) };
          },
          async cancel() { cancelled = true; },
          releaseLock() {}
        })
      }
    })
  });

  await assert.rejects(
    deleteObject('skill-vault-private', OBJECT_NAME),
    /Storage cleanup response exceeds the bounded size limit/
  );
  assert.equal(arrayBufferCalled, false);
  assert.equal(cancelled, true);
});

test('M4.17 Storage deletion timeout covers a stalled response stream', async () => {
  let cancelled = false;
  let requestSignal;
  const deleteObject = createStorageObjectDeleter({
    url: 'https://example.supabase.co',
    serviceRoleKey: SECRET,
    timeoutMs: 100,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => new Promise(() => {}),
            async cancel() { cancelled = true; },
            releaseLock() {}
          })
        }
      };
    }
  });

  await assert.rejects(
    deleteObject('skill-vault-private', OBJECT_NAME),
    /Storage cleanup timed out/
  );
  assert.equal(requestSignal.aborted, true);
  assert.equal(cancelled, true);
});

test('M4.17 cleanup RPC calls use the storage worker schema profile', async () => {
  let request;
  const client = createSupabaseRpcClient({
    url: 'https://example.supabase.co',
    serviceRoleKey: SECRET,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await client.call('claim_import_upload_cleanup', { p_limit: 1 });
  assert.equal(request.init.headers['accept-profile'], 'storage_worker_adapter');
  assert.equal(request.init.headers['content-profile'], 'storage_worker_adapter');
});

test('M4.17 worker package exposes the explicit cleanup execution command', async () => {
  const packageJson = JSON.parse(await readFile(
    new URL('../apps/worker/package.json', import.meta.url),
    'utf8'
  ));
  assert.equal(packageJson.scripts['import:cleanup-once'], 'node src/import-upload-cleanup-once.mjs');
});

test('M4.17 invalid Storage origins fail with a fixed message', () => {
  assert.throws(
    () => createStorageObjectDeleter({
      url: 'not a valid secret-bearing origin',
      serviceRoleKey: SECRET,
      fetchImpl: async () => new Response('{}')
    }),
    (error) => error.message === 'SKILLMAP_SUPABASE_URL must be a valid origin.'
  );
});
