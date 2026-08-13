import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const receiptPath = join(root, 'docs/plans/evidence/M3-functional-cutover-implementation-receipt.json');
const runtimeReceiptPath = join(root, 'docs/plans/evidence/M3-device-auth-emitted-runtime-fix-receipt.json');
const cloudflareRuntimeReceiptPath = join(root, 'docs/plans/evidence/M3-device-auth-cloudflare-runtime-fix-receipt.json');
const liveAcceptanceReceiptPath = join(root, 'docs/plans/evidence/M3.14-live-device-auth-acceptance-receipt.json');
const historicalReceiptPath = join(root, 'docs/plans/evidence/M3.02-bounded-implementation-receipt.json');
const sha256 = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

test('historical M3.02 receipt is immutable and superseding receipt binds current artifacts', () => {
  const historical = JSON.parse(readFileSync(historicalReceiptPath, 'utf8'));
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const runtimeReceipt = JSON.parse(readFileSync(runtimeReceiptPath, 'utf8'));
  const cloudflareRuntimeReceipt = JSON.parse(readFileSync(cloudflareRuntimeReceiptPath, 'utf8'));
  const liveAcceptanceReceipt = JSON.parse(readFileSync(liveAcceptanceReceiptPath, 'utf8'));
  assert.equal(historical.status, 'AMENDMENT_CANDIDATE');
  assert.equal(receipt.status, 'IMPLEMENTATION_CANDIDATE');
  assert.equal(receipt.supersedes.receipt, 'docs/plans/evidence/M3.02-bounded-implementation-receipt.json');
  assert.equal(receipt.supersedes.old_receipt_sha256, '71a95fa54dc7dd805c4c16cb73d433a8ad9d67dc418a2e51cc4899600290a937');
  assert.equal(sha256('docs/plans/evidence/M3.02-bounded-implementation-receipt.json'), receipt.supersedes.old_receipt_sha256);
  assert.deepEqual(receipt.migration_sequence_reconciliation.actual_additive_names, [
    '20260810080000_skillmap_device_auth_legacy_admission_fence.sql',
    '20260810090000_skillmap_device_auth_cutover.sql'
  ]);
  assert.equal(receipt.claims.local_only, true);
  assert.equal(receipt.claims.live_verified, false);
  assert.equal(receipt.claims.deployed, false);
  assert.equal(receipt.claims.pushed, false);
  assert.equal(receipt.claims.production_secrets_created, false);
  for (const artifact of receipt.bounded_artifacts) {
    assert.match(artifact.path, /^(?:apps\/web\/lib\/contracts\/generated|apps\/web\/lib\/supabase|contracts\/test-vectors|src\/contracts\/generated|supabase\/migrations\/202608100[5-9]|supabase\/tests\/device_auth_cutover|test\/m3-(?:02-amendments|cutover-provenance)|package\.json)/);
    if (!['package.json', 'test/m3-cutover-provenance.mjs'].includes(artifact.path)) {
      assert.equal(sha256(artifact.path), artifact.sha256, `${artifact.path} hash drift`);
    }
  }
  assert.equal(runtimeReceipt.status, 'IMPLEMENTATION_CANDIDATE');
  assert.equal(runtimeReceipt.supersedes.receipt, 'docs/plans/evidence/M3-functional-cutover-implementation-receipt.json');
  assert.equal(runtimeReceipt.supersedes.old_receipt_sha256, '150f8cf5d4a226ae3b342a0f1f46c2c515cd4de2f1d0eca4efac6040184d242d');
  assert.equal(sha256('docs/plans/evidence/M3-functional-cutover-implementation-receipt.json'), runtimeReceipt.supersedes.old_receipt_sha256);
  assert.deepEqual(runtimeReceipt.artifacts.map(({ path }) => path), [
    '.gitignore',
    'package.json',
    'apps/web/package.json',
    'apps/web/lib/device-auth/response.server.ts',
    'apps/web/app/api/device-auth/v1/devices/[devicePublicId]/rotate/route.ts',
    'apps/web/tests/device-auth.test.mjs',
    'apps/web/scripts/device-auth-worker-smoke.mjs',
    'apps/web/tests/register-device-auth-loader.mjs',
    'scripts/m3-03-dp-keychain-no-profile-capability.mjs',
    'test/m3-03-dp-keychain-no-profile-capability.mjs',
    'test/m3-cutover-provenance.mjs'
  ]);
  const supersededRuntimePaths = new Set(cloudflareRuntimeReceipt.artifacts.map(({ path }) => path));
  supersededRuntimePaths.add('test/m3-cutover-provenance.mjs');
  for (const artifact of runtimeReceipt.artifacts) {
    if (supersededRuntimePaths.has(artifact.path)) continue;
    assert.equal(sha256(artifact.path), artifact.sha256, `${artifact.path} current hash drift`);
  }
  assert.equal(runtimeReceipt.claims.validated_locally, true);
  assert.equal(runtimeReceipt.claims.live_verified, false);
  assert.equal(runtimeReceipt.claims.committed, false);
  assert.equal(runtimeReceipt.claims.pushed, false);
  assert.equal(runtimeReceipt.claims.deployed, false);
  assert.equal(runtimeReceipt.claims.provider_mutated, false);
  assert.equal(runtimeReceipt.claims.ledger_mutated, false);
  assert.equal(cloudflareRuntimeReceipt.status, 'DEPLOYED_ALPHA');
  assert.equal(cloudflareRuntimeReceipt.supersedes.receipt, 'docs/plans/evidence/M3-device-auth-emitted-runtime-fix-receipt.json');
  assert.equal(cloudflareRuntimeReceipt.supersedes.old_receipt_sha256, '0001aedba21380147f6922845d7d4c1e58ac2a7126020ac0de78dc7efbc0b063');
  assert.equal(sha256('docs/plans/evidence/M3-device-auth-emitted-runtime-fix-receipt.json'), cloudflareRuntimeReceipt.supersedes.old_receipt_sha256);
  for (const artifact of cloudflareRuntimeReceipt.artifacts) {
    assert.equal(sha256(artifact.path), artifact.sha256, `${artifact.path} Cloudflare runtime hash drift`);
  }
  assert.equal(cloudflareRuntimeReceipt.cloudflare.worker, 'skillmap');
  assert.equal(cloudflareRuntimeReceipt.cloudflare.live_rate_limit.allowed_route_attempts, 5);
  assert.equal(cloudflareRuntimeReceipt.cloudflare.live_rate_limit.denied_attempt, 6);
  assert.equal(cloudflareRuntimeReceipt.cloudflare.live_rate_limit.denied_status, 429);
  assert.equal(cloudflareRuntimeReceipt.claims.validated_locally, true);
  assert.equal(cloudflareRuntimeReceipt.claims.verified_live, true);
  assert.equal(cloudflareRuntimeReceipt.claims.production_replay_keys_created, false);
  assert.equal(liveAcceptanceReceipt.status, 'VERIFIED_LIVE_PRIVATE_ALPHA');
  assert.deepEqual(liveAcceptanceReceipt.root_cause_and_fix.migration, {
    path: 'supabase/migrations/20260813035308_skillmap_device_auth_randomness_privileges.sql',
    sha256: 'dc7b7efe5b57794f0af20ef5d357690a9a40a25297879256fdb5155b6672d33a',
    hosted_project: 'nciathykwjlrkikzyirv',
    hosted_version: '20260813035308',
    applied: true
  });
  assert.equal(
    sha256(liveAcceptanceReceipt.root_cause_and_fix.migration.path),
    liveAcceptanceReceipt.root_cause_and_fix.migration.sha256
  );
  assert.deepEqual(liveAcceptanceReceipt.root_cause_and_fix.test, {
    path: 'supabase/tests/device_auth_randomness_privileges.test.sql',
    sha256: 'ace15a765642054d3ef7beff64fad52ed90a64ac0a0c6efb5b8fb2ca50f15228',
    focused_assertions: 6,
    passed: true
  });
  assert.equal(
    sha256(liveAcceptanceReceipt.root_cause_and_fix.test.path),
    liveAcceptanceReceipt.root_cause_and_fix.test.sha256
  );
  assert.deepEqual(liveAcceptanceReceipt.live_acceptance, {
    browser: {
      route: '/device',
      authenticated: true,
      review_fields_matched: true,
      approval_clicked_exactly_once: true,
      terminal_state: 'Device approved'
    },
    connector: {
      pairing_exchanged: true,
      status_authenticated: true,
      alpha_refresh_requests: 1,
      credential_rotated: true,
      status_after_refresh_authenticated: true,
      remote_revoke: true,
      local_credentials_deleted: true,
      terminal_signed_out: true,
      second_pairing_used_fresh_identity: true,
      second_pairing_cancelled: true,
      complete: true
    }
  });
  assert.deepEqual(liveAcceptanceReceipt.cleanup, {
    active_pairings: 0,
    active_token_families: 0,
    valid_access_tokens: 0,
    valid_refresh_tokens: 0,
    active_devices: 0,
    active_key_bindings: 0,
    residual_test_pairings: 0,
    residual_test_key_bindings: 0,
    exact_test_database_rows_removed: true,
    handoff_file_removed: true,
    temporary_harness_removed: true,
    temporary_wrangler_output_removed: true,
    ego_task_space_closed: true,
    local_supabase_stopped: true
  });
  assert.deepEqual(liveAcceptanceReceipt.claims, {
    validated_locally: true,
    verified_live: true,
    committed: false,
    pushed: false,
    deployed: true,
    production_replay_keys_created: false,
    signing_or_notarization_performed: false
  });
});

test('cutover source binds the frozen lock, forward-only flip, exact six legacy surfaces, and no secrets', () => {
  const fence = readFileSync(join(root, 'supabase/migrations/20260810080000_skillmap_device_auth_legacy_admission_fence.sql'), 'utf8');
  const cutover = readFileSync(join(root, 'supabase/migrations/20260810090000_skillmap_device_auth_cutover.sql'), 'utf8');
  assert.match(fence, /pg_advisory_xact_lock_shared\(1397442892, 1145132372\)/);
  assert.match(cutover, /pg_advisory_xact_lock\(1397442892, 1145132372\)/);
  assert.match(cutover, /legacy_device_authority_enabled = false/);
  assert.match(cutover, /notify pgrst, 'reload schema'/);
  for (const name of [
    'register_my_device', 'rotate_my_device', 'revoke_my_device',
    'adapter_issue_device_token', 'adapter_rotate_device_token', 'adapter_revoke_device_token'
  ]) assert.match(fence, new RegExp(name));
  assert.doesNotMatch(cutover, /insert into .*replay.*key|create .*replay.*key/i);
});
