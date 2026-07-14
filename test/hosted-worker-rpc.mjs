import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSupabaseRpcClient,
  createSupabaseRpcClientFromEnvironment
} from '../apps/worker/src/supabase-rpc.mjs';
import { renewClaimLease } from '../apps/worker/src/claim-lease.mjs';

const SECRET = `service-role-${'x'.repeat(48)}`;

test('operator RPC client sends the service credential only to an allowlisted same-origin function', async () => {
  let observed;
  const client = createSupabaseRpcClient({
    url: 'http://127.0.0.1:54321',
    serviceRoleKey: SECRET,
    fetchImpl: async (url, options) => {
      observed = { url: url.toString(), options };
      return new Response(JSON.stringify([{ submission_id: 'sub_' + 'a'.repeat(32) }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const result = await client.call('claim_skill_submission', { p_worker_version: 'skillmap-worker/0.1.0' });
  assert.equal(result.length, 1);
  assert.equal(observed.url, 'http://127.0.0.1:54321/rest/v1/rpc/claim_skill_submission');
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.headers.apikey, SECRET);
  assert.equal(observed.options.headers.authorization, `Bearer ${SECRET}`);
  await assert.rejects(client.call('not_reviewed', {}), /not allowlisted/);
});

test('operator RPC failures never reflect service credentials or provider bodies', async () => {
  const client = createSupabaseRpcClient({
    url: 'https://example.supabase.co',
    serviceRoleKey: SECRET,
    fetchImpl: async () => new Response(JSON.stringify({ code: '42501', message: `leak ${SECRET}` }), { status: 403 })
  });
  await assert.rejects(client.call('publish_skill_submission', {}), error => {
    assert.doesNotMatch(error.message, new RegExp(SECRET));
    assert.doesNotMatch(error.message, /leak/);
    assert.match(error.message, /HTTP 403 \(42501\)/);
    return true;
  });
});

test('operator RPC response bound admits the maximum valid Unicode report page and rejects expansion', async () => {
  const rows = Array.from({ length: 50 }, (_, index) => {
    const suffix = index.toString(16).padStart(32, '0');
    return {
      report_id: `rpt_${suffix}`,
      skill_id: `skl_${suffix}`,
      version_id: `skv_${suffix}`,
      category: 'security',
      message: '🚀'.repeat(2000),
      created_at: '2026-07-14T00:00:00.000000Z'
    };
  });
  const maximumPage = JSON.stringify(rows);
  assert.ok(Buffer.byteLength(maximumPage) > 256 * 1024);
  assert.ok(Buffer.byteLength(maximumPage) < 512 * 1024);

  const client = createSupabaseRpcClient({
    url: 'http://127.0.0.1:54321',
    serviceRoleKey: SECRET,
    fetchImpl: async () => new Response(maximumPage, { status: 200 })
  });
  assert.equal((await client.call('list_skill_report_queue', { p_limit: 50 })).length, 50);

  const expanded = createSupabaseRpcClient({
    url: 'http://127.0.0.1:54321',
    serviceRoleKey: SECRET,
    fetchImpl: async () => new Response('x'.repeat((512 * 1024) + 1), { status: 200 })
  });
  await assert.rejects(
    expanded.call('list_skill_report_queue', { p_limit: 50 }),
    /response exceeds the bounded size limit/
  );
});

test('operator RPC environment rejects unsafe origins and missing secrets', () => {
  for (const environment of [
    { SKILLMAP_SUPABASE_URL: 'http://example.com', SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: SECRET },
    { SKILLMAP_SUPABASE_URL: 'https://user@example.com', SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: SECRET },
    { SKILLMAP_SUPABASE_URL: 'https://example.com/path', SKILLMAP_SUPABASE_SERVICE_ROLE_KEY: SECRET },
    { SKILLMAP_SUPABASE_URL: 'https://example.com' }
  ]) assert.throws(() => createSupabaseRpcClientFromEnvironment(environment), /HTTPS|origin|SERVICE_ROLE_KEY/);
});

test('claim renewal is exact-identity bounded and fail-closed', async () => {
  const claim = {
    submission_id: `sub_${'a'.repeat(32)}`,
    claim_id: '123e4567-e89b-42d3-a456-426614174000'
  };
  let observed;
  const renewed = await renewClaimLease({
    call: async (name, parameters) => {
      observed = { name, parameters };
      return [{
        submission_id: claim.submission_id,
        claim_id: claim.claim_id,
        claim_expires_at: '2026-07-13T00:10:00.000Z'
      }];
    }
  }, claim, { workerVersion: 'skillmap-worker/0.1.0' });
  assert.equal(observed.name, 'renew_skill_submission_claim');
  assert.deepEqual(observed.parameters, {
    p_submission_id: claim.submission_id,
    p_claim_id: claim.claim_id,
    p_worker_version: 'skillmap-worker/0.1.0',
    p_lease_seconds: 300
  });
  assert.equal(renewed.claim_id, claim.claim_id);

  const options = { workerVersion: 'skillmap-worker/0.1.0' };
  await assert.rejects(renewClaimLease({ call: async () => [] }, claim, options), /invalid bounded result/);
  await assert.rejects(renewClaimLease({ call: async () => [{ ...renewed, claim_id: '123e4567-e89b-42d3-a456-426614174001' }] }, claim, options), /invalid claim identity/);
  await assert.rejects(renewClaimLease({ call: async () => [renewed] }, claim, { ...options, leaseSeconds: 901 }), /30 through 900/);
});
