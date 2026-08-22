#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createSupabaseRpcClientFromEnvironment } from './supabase-rpc.mjs';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OBJECT_NAME = /^v1\/msv_[0-9a-f]{32}\/msf_[0-9a-f]{32}$/;
const REASON = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAX_RESPONSE_BYTES = 64 * 1024;

function validateOrigin(raw) {
  if (typeof raw !== 'string' || raw !== raw.trim()) throw new Error('SKILLMAP_SUPABASE_URL is required.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('SKILLMAP_SUPABASE_URL must be a valid origin.');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('SKILLMAP_SUPABASE_URL must use HTTPS, except for loopback acceptance.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SKILLMAP_SUPABASE_URL must be an origin without credentials, path, query, or fragment.');
  }
  return url.origin;
}

function validateSecret(raw) {
  if (typeof raw !== 'string' || raw.length < 32 || raw.length > 8192 || raw !== raw.trim()
    || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('SKILLMAP_SUPABASE_SERVICE_ROLE_KEY is required and must be bounded.');
  }
  return raw;
}

function readStreamChunk(reader, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Storage cleanup timed out.'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(reader.read()).then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

async function consumeBounded(response, signal) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error('Storage cleanup response exceeds the bounded size limit.');
  }
  if (response.body === null) return;
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('Storage cleanup returned an invalid response.');
  }
  const reader = response.body.getReader();
  let completed = false;
  let total = 0;
  try {
    while (true) {
      const result = await readStreamChunk(reader, signal);
      if (!result || typeof result.done !== 'boolean') {
        throw new Error('Storage cleanup returned an invalid response.');
      }
      if (result.done) {
        completed = true;
        return;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw new Error('Storage cleanup returned an invalid response.');
      }
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new Error('Storage cleanup response exceeds the bounded size limit.');
      }
    }
  } finally {
    if (!completed) {
      try { await reader.cancel(); } catch { /* Preserve the bounded primary failure. */ }
    }
    reader.releaseLock();
  }
}

export function createStorageObjectDeleter(options) {
  const origin = validateOrigin(options?.url);
  const serviceRoleKey = validateSecret(options?.serviceRoleKey);
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 15_000;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error('Storage cleanup timeout must be from 100 through 120000 milliseconds.');
  }

  return async (bucket, objectName) => {
    if (bucket !== 'skill-vault-private' || !OBJECT_NAME.test(objectName ?? '')) {
      throw new Error('Storage cleanup target is invalid.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(new URL(`/storage/v1/object/${bucket}`, origin), {
          method: 'DELETE',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': 'skillmap-import-upload-cleanup/1'
          },
          body: JSON.stringify({ prefixes: [objectName] })
        });
      } catch {
        if (controller.signal.aborted) throw new Error('Storage cleanup timed out.');
        throw new Error('Storage cleanup failed before a response.');
      }
      if (!response || !Number.isInteger(response.status)) throw new Error('Storage cleanup returned an invalid response.');
      await consumeBounded(response, controller.signal);
      if (!response.ok) throw new Error(`Storage cleanup failed with HTTP ${response.status}.`);
    } finally {
      clearTimeout(timer);
    }
  };
}

function validateClaim(value) {
  if (!value || typeof value !== 'object'
    || !JOB_ID.test(value.job_id ?? '')
    || value.bucket_id !== 'skill-vault-private'
    || !OBJECT_NAME.test(value.object_name ?? '')
    || !REASON.test(value.cleanup_reason ?? '')
    || !Number.isSafeInteger(value.attempt_count)
    || value.attempt_count < 1
    || typeof value.claimed_at !== 'string'
    || Number.isNaN(Date.parse(value.claimed_at))) {
    throw new Error('Import upload cleanup claim is invalid.');
  }
  return value;
}

export async function processImportUploadCleanupOnce({ rpc, deleteObject }) {
  if (!rpc || typeof rpc.call !== 'function') throw new Error('An RPC client is required.');
  if (typeof deleteObject !== 'function') throw new Error('An exact object deleter is required.');
  const claimed = await rpc.call('claim_import_upload_cleanup', { p_limit: 1 });
  if (!Array.isArray(claimed) || claimed.length > 1) throw new Error('Import upload cleanup claim RPC returned an invalid bounded result.');
  if (claimed.length === 0) return { result: 'idle', mutation: false };
  const claim = validateClaim(claimed[0]);
  try {
    await deleteObject(claim.bucket_id, claim.object_name);
    const completion = await rpc.call('complete_import_upload_cleanup', { p_job_id: claim.job_id });
    if (!completion || completion.job_id !== claim.job_id || completion.state !== 'completed') {
      throw new Error('Import upload cleanup completion RPC returned an invalid result.');
    }
    return { result: 'completed', mutation: true, jobId: claim.job_id };
  } catch {
    try {
      await rpc.call('fail_import_upload_cleanup', {
        p_job_id: claim.job_id,
        p_retry_delay_seconds: 30
      });
    } catch {
      // Preserve the first bounded failure; an operator can recover the claim.
    }
    throw new Error('Storage cleanup failed.');
  }
}

function parseArguments(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  if (args.length !== 1 || args[0] !== '--execute') throw new Error('Refusing database mutation without the explicit --execute flag.');
  return { execute: true };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node apps/worker/src/import-upload-cleanup-once.mjs --execute\n');
    return;
  }
  const rpc = createSupabaseRpcClientFromEnvironment();
  const deleteObject = createStorageObjectDeleter({
    url: process.env.SKILLMAP_SUPABASE_URL,
    serviceRoleKey: process.env.SKILLMAP_SUPABASE_SERVICE_ROLE_KEY
  });
  process.stdout.write(`${JSON.stringify(await processImportUploadCleanupOnce({ rpc, deleteObject }))}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`SkillMap import upload cleanup worker failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
