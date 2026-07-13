import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  compareRecoverySnapshots,
  parseRecoveryArguments,
  parseSequenceSnapshot,
  parseTableSnapshot,
  recoverySnapshotDifferences
} from '../scripts/hosted-database-recovery.mjs';

const repo = path.resolve(import.meta.dirname, '..');

test('database recovery rehearsal requires explicit mutation and retained receipt paths', () => {
  assert.deepEqual(parseRecoveryArguments(['--execute', '--output', '/tmp/recovery.json']), {
    execute: true,
    output: '/tmp/recovery.json',
    allowDirty: false
  });
  assert.deepEqual(parseRecoveryArguments(['--execute', '--allow-dirty', '--output', '/tmp/recovery.json']), {
    execute: true,
    output: '/tmp/recovery.json',
    allowDirty: true
  });
  assert.throws(() => parseRecoveryArguments([]), /requires --execute/);
  assert.throws(() => parseRecoveryArguments(['--execute']), /--output is required/);
  assert.throws(() => parseRecoveryArguments(['--execute', '--output', 'one', '--output', 'two']), /only once/);
});

test('database recovery also binds sequence state', () => {
  const sequences = parseSequenceSnapshot('private.audit_events_id_seq|7|1|1|false|1\napi.queue_id_seq|NULL|10|5|true|20\n');
  assert.deepEqual(sequences['private.audit_events_id_seq'], {
    lastValue: '7', startValue: '1', incrementBy: '1', cycle: false, cacheSize: '1'
  });
  assert.equal(compareRecoverySnapshots(sequences, structuredClone(sequences)).equal, true);
  const changed = structuredClone(sequences);
  changed['private.audit_events_id_seq'].lastValue = '8';
  assert.equal(compareRecoverySnapshots(sequences, changed).equal, false);
  assert.throws(() => parseSequenceSnapshot('public.bad|1|1|1|false|1'), /api\|auth\|private/);
});

test('database recovery snapshots are bounded and compare every table digest', () => {
  const before = parseTableSnapshot('api.profiles|2|d41d8cd98f00b204e9800998ecf8427e\nprivate.skills|3|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
  const reordered = parseTableSnapshot('private.skills|3|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\napi.profiles|2|d41d8cd98f00b204e9800998ecf8427e\n');
  assert.equal(compareRecoverySnapshots(before, reordered).equal, true);
  const changed = structuredClone(reordered);
  changed['private.skills'].rows = 2;
  assert.equal(compareRecoverySnapshots(before, changed).equal, false);
  assert.deepEqual(recoverySnapshotDifferences(before, changed).map(row => row.name), ['private.skills']);
  assert.throws(() => parseTableSnapshot('public.unbounded|1|d41d8cd98f00b204e9800998ecf8427e'), /api\|auth\|private/);
  assert.throws(() => parseTableSnapshot('api.profiles|-1|d41d8cd98f00b204e9800998ecf8427e'), /AssertionError/);
});

test('recovery implementation remains local, data-only, destructive-explicit, and cleanup-bound', () => {
  const source = readFileSync(path.join(repo, 'scripts/hosted-database-recovery.mjs'), 'utf8');
  assert.match(source, /'--local', '--data-only'/);
  assert.match(source, /schema_migrations/);
  assert.match(source, /not \(schemaname = 'auth' and tablename = 'schema_migrations'\)/i);
  assert.match(source, /'db', 'reset', '--local'/);
  assert.match(source, /--single-transaction/);
  assert.match(source, /options\.input === undefined \? 'ignore' : 'pipe'/);
  assert.doesNotMatch(source, /restart identity/i);
  assert.match(source, /rmSync\(scratch, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(source, /--linked|db push|vercel|service.role|SERVICE_ROLE/);
});
