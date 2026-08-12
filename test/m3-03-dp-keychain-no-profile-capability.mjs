import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { runCapabilityProbe } from '../scripts/m3-03-dp-keychain-no-profile-capability.mjs';
import {
  DP_KEYCHAIN_SCHEMA,
  DP_KEYCHAIN_STATUS,
  assertNoSensitiveCapabilityOutput,
  parseCapabilityRowV1,
  parseCleanupV1,
} from './support/m3-03-dp-keychain-no-profile-capability.mjs';

const root = resolve(import.meta.dirname, '..');

test('M3.03 DP Keychain capability probe emits a truthful redacted receipt', async () => {
  const receipt = await runCapabilityProbe();
  assert.equal(receipt.schema, `${DP_KEYCHAIN_SCHEMA}.receipt.v1`);
  assert.ok([DP_KEYCHAIN_STATUS.PASS, DP_KEYCHAIN_STATUS.FAIL].includes(receipt.status));
  assert.equal(receipt.route.requested, 'gpt-5.6-luna/high');
  assert.equal(receipt.route.confirmed, false);
  assert.equal(receipt.external_mutation, false);
  assert.equal(receipt.ledger_mutation, false);
  assert.equal(receipt.product_source_or_contract_touched, false);
  assertNoSensitiveCapabilityOutput(JSON.stringify(receipt));
  assert.equal(Array.isArray(receipt.rows), true);
  assert.equal(receipt.rows.length <= 2, true);
  for (const row of receipt.rows) {
    assert.ok(['unsigned', 'adhoc'].includes(row.mode));
    assert.equal(row.execution.timed_out, false);
    assert.equal(row.execution.oversized, false);
    if (row.native.status === 'PASS') parseCapabilityRowV1(row.native);
  }
  for (const cleanup of receipt.cleanup.rows ?? []) {
    if (cleanup.native.status === 'PASS') parseCleanupV1(cleanup.native);
  }
  assert.equal(receipt.cleanup.temp_removed, true);
  const persisted = JSON.parse(readFileSync(join(root, 'docs/plans/evidence/M3.03-dp-keychain-no-profile-capability-receipt.json'), 'utf8'));
  assert.deepEqual(persisted, receipt);
});

test('M3.03 strict redaction and malformed-input probes fail closed', () => {
  assert.throws(() => parseCapabilityRowV1(null), /invalid dp-keychain receipt/);
  assert.throws(() => parseCapabilityRowV1({ schema: `${DP_KEYCHAIN_SCHEMA}.row.v1`, mode: 'unsigned' }), /invalid dp-keychain receipt/);
  assert.throws(() => parseCleanupV1({ schema: `${DP_KEYCHAIN_SCHEMA}.cleanup.v1`, mode: 'unsigned', delete: { code: -34018, name: 'errSecMissingEntitlement', ok: false } }), /invalid dp-keychain receipt/);
  assert.throws(() => assertNoSensitiveCapabilityOutput('synthetic private_key bytes'), /sensitive dp-keychain marker/);
});
