import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertRestoreWindowOpen,
  computeRestoreExpiryUtc,
  projectQuarantineRetention
} from '../dist/core/quarantine-retention.js';
import {
  LOCAL_QUARANTINE_OUTCOMES,
  validateLocalQuarantineOutcome
} from '../dist/contracts/local-quarantine-registry.js';

test('retention is exactly +30 UTC calendar days across month and year boundaries', () => {
  assert.equal(computeRestoreExpiryUtc('2026-01-31T23:45:00.000Z'), '2026-03-02T23:45:00.000Z');
  assert.equal(computeRestoreExpiryUtc('2026-12-15T08:30:00.000Z'), '2027-01-14T08:30:00.000Z');
});

test('restore is allowed strictly before expiry and denied at or after it', () => {
  const receipt = {
    quarantinedAt: '2026-08-20T12:00:00.000Z',
    restoreExpiresAt: '2026-09-19T12:00:00.000Z'
  };
  assert.doesNotThrow(() => assertRestoreWindowOpen(receipt, new Date('2026-09-19T11:59:59.999Z')));
  assert.deepEqual(
    assertRestoreWindowOpen(receipt, new Date('2026-09-19T12:00:00.000Z')),
    LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_RESTORE_WINDOW_EXPIRED
  );
  assert.deepEqual(
    assertRestoreWindowOpen(receipt, new Date('2026-09-20T12:00:00.000Z')),
    LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_RESTORE_WINDOW_EXPIRED
  );
});

test('retention projection exposes no extend or deletion operation', () => {
  const projection = projectQuarantineRetention({
    quarantinedAt: '2026-08-20T12:00:00.000Z',
    restoreExpiresAt: '2026-09-19T12:00:00.000Z'
  }, new Date('2026-08-21T12:00:00.000Z'));
  assert.deepEqual(Object.keys(projection).sort(), ['canRestore', 'quarantinedAt', 'restoreExpiresAt']);
  assert.equal(JSON.stringify(projection).includes('delete'), false);
  assert.equal(JSON.stringify(projection).includes('extend'), false);
});

test('closed public outcome registry accepts only the six exact tuples', () => {
  assert.equal(Object.keys(LOCAL_QUARANTINE_OUTCOMES).length, 6);
  for (const outcome of Object.values(LOCAL_QUARANTINE_OUTCOMES)) {
    assert.deepEqual(validateLocalQuarantineOutcome(outcome), outcome);
    for (const key of ['phase', 'mutation', 'local_retry', 'fresh_authorization_required', 'next_action']) {
      assert.throws(() => validateLocalQuarantineOutcome({ ...outcome, [key]: `changed-${key}` }));
    }
  }
  assert.throws(() => validateLocalQuarantineOutcome({
    ...LOCAL_QUARANTINE_OUTCOMES.CROSS_VOLUME_NOT_ATOMIC,
    extra: true
  }));
  assert.equal(JSON.stringify(LOCAL_QUARANTINE_OUTCOMES).includes('QUARANTINE_COLLISION'), false);
});
