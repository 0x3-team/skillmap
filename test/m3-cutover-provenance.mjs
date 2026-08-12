import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const receiptPath = join(root, 'docs/plans/evidence/M3-functional-cutover-implementation-receipt.json');
const historicalReceiptPath = join(root, 'docs/plans/evidence/M3.02-bounded-implementation-receipt.json');
const sha256 = (path) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');

test('historical M3.02 receipt is immutable and superseding receipt binds current artifacts', () => {
  const historical = JSON.parse(readFileSync(historicalReceiptPath, 'utf8'));
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
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
    assert.equal(sha256(artifact.path), artifact.sha256, `${artifact.path} hash drift`);
  }
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
