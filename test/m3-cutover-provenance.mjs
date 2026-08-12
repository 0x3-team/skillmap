import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const receiptPath = join(root, 'docs/plans/evidence/M3-functional-cutover-implementation-receipt.json');
const runtimeReceiptPath = join(root, 'docs/plans/evidence/M3-device-auth-emitted-runtime-fix-receipt.json');
const historicalReceiptPath = join(root, 'docs/plans/evidence/M3.02-bounded-implementation-receipt.json');
const sha256 = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

test('historical M3.02 receipt is immutable and superseding receipt binds current artifacts', () => {
  const historical = JSON.parse(readFileSync(historicalReceiptPath, 'utf8'));
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const runtimeReceipt = JSON.parse(readFileSync(runtimeReceiptPath, 'utf8'));
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
  for (const artifact of runtimeReceipt.artifacts) {
    assert.equal(sha256(artifact.path), artifact.sha256, `${artifact.path} current hash drift`);
  }
  assert.equal(runtimeReceipt.claims.validated_locally, true);
  assert.equal(runtimeReceipt.claims.live_verified, false);
  assert.equal(runtimeReceipt.claims.committed, false);
  assert.equal(runtimeReceipt.claims.pushed, false);
  assert.equal(runtimeReceipt.claims.deployed, false);
  assert.equal(runtimeReceipt.claims.provider_mutated, false);
  assert.equal(runtimeReceipt.claims.ledger_mutated, false);
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
