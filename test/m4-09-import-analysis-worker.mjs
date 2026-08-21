import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processImportAnalysisOnce } from '../apps/worker/src/import-analysis-once.mjs';
import { createSupabaseRpcClient } from '../apps/worker/src/supabase-rpc.mjs';

const JOB_ID = `iaj_${'a'.repeat(32)}`;
const SKILL_ID = `msk_${'b'.repeat(32)}`;
const VERSION_ID = `msv_${'c'.repeat(32)}`;
const LEASE = '12345678-1234-4234-8234-123456789abc';

test('M4.09 processes one bounded analysis claim and completes its exact lease', async () => {
  const calls = [];
  const rpc = {
    async call(name, params) {
      calls.push({ name, params });
      if (name === 'claim_import_analysis_jobs') return [{
        job_public_id: JOB_ID,
        skill_public_id: SKILL_ID,
        version_public_id: VERSION_ID,
        reason: 'import_finalized',
        priority: 50,
        attempt_count: 1,
        max_attempts: 5,
        lease_token: LEASE,
        lease_expires_at: '2026-08-20T12:00:00Z'
      }];
      if (name === 'complete_import_analysis_job') return {
        job_public_id: JOB_ID,
        state: 'completed',
        result_digest: params.p_result_digest,
        completed_at: '2026-08-20T11:59:00Z'
      };
      throw new Error(`unexpected ${name}`);
    }
  };
  const result = await processImportAnalysisOnce({ rpc, workerId: 'm4-test-worker', leaseSeconds: 60 });
  assert.equal(result.result, 'completed');
  assert.match(result.resultDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(calls.map((call) => call.name), ['claim_import_analysis_jobs', 'complete_import_analysis_job']);
  assert.equal(calls[1].params.p_lease_token, LEASE);
});

test('M4.09 returns idle without a mutation when no job is available', async () => {
  const result = await processImportAnalysisOnce({
    rpc: { call: async () => [] },
    workerId: 'm4-test-worker'
  });
  assert.deepEqual(result, { result: 'idle', mutation: false });
});

test('M4.09 analysis RPC calls use the exact PostgREST schema profile', async () => {
  let request;
  const client = createSupabaseRpcClient({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'service-role-test-only-do-not-use-live',
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await client.call('claim_import_analysis_jobs', { p_worker_id: 'test', p_limit: 1, p_lease_seconds: 60 });
  assert.equal(request.init.headers['accept-profile'], 'analysis_worker_adapter');
  assert.equal(request.init.headers['content-profile'], 'analysis_worker_adapter');
  assert.match(request.url, /\/rest\/v1\/rpc\/claim_import_analysis_jobs$/);
});
