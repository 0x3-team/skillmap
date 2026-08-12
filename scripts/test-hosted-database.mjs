#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const TEST_ROOT = join(REPO, 'supabase', 'tests');
const PREDECESSOR_FLOOR = '20260810070000';

// These suites intentionally describe the feature-off/M2.11 state that exists
// immediately before the M3 admission fence and atomic cutover. They must not
// be run after 20260810090000, where the retired wrapper grants and old policy
// shape are no longer true.
const PREDECESSOR_ONLY = new Set([
  'device_auth_confirmation.test.sql',
  'device_auth_key_rotation.test.sql',
  'device_auth_lifecycle.test.sql',
  'device_auth_pairing.test.sql',
  'device_auth_poll_exchange.test.sql',
  'device_auth_refresh_replay.test.sql',
  'skill_vault_device_import_rls.test.sql',
  'skill_vault_devices.test.sql',
]);

const tests = readdirSync(TEST_ROOT)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => join('supabase', 'tests', name));
const postCutoverTests = tests.filter((path) => !PREDECESSOR_ONLY.has(path.split('/').pop()));
const predecessorTests = tests.filter((path) => path !== 'supabase/tests/device_auth_cutover.test.sql'
  && path !== 'supabase/tests/device_auth_owner_devices.test.sql');

function run(command, args) {
  process.stdout.write(`\n$ ${command} ${args.join(' ')}\n`);
  execFileSync(command, args, { cwd: REPO, stdio: 'inherit' });
}

function capture(command, args) {
  return execFileSync(command, args, { cwd: REPO, encoding: 'utf8' }).trim();
}

function dbUrl() {
  const status = capture('supabase', ['status', '-o', 'env']);
  const match = status.match(/^DB_URL=(.+)$/m);
  if (!match) throw new Error('Supabase status did not expose a local DB_URL');
  return match[1].trim();
}

function query(sql) {
  return capture('psql', [
    '--no-psqlrc', '--tuples-only', '--no-align', '--quiet',
    '--dbname', dbUrl(), '--command', sql,
  ]);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual || '<empty>'}`);
}

function assertPredecessorState() {
  const version = query("select version from supabase_migrations.schema_migrations order by version desc limit 1");
  assertEqual(version, PREDECESSOR_FLOOR, 'predecessor migration floor');
  assertEqual(query("select coalesce(to_regclass('private.device_auth_authority_control')::text, 'absent')"), 'absent', 'predecessor authority control');
}

function assertPostCutoverState() {
  const version = query("select version from supabase_migrations.schema_migrations order by version desc limit 1");
  assertEqual(version, '20260812010000', 'post-cutover migration head');
  assertEqual(query("select legacy_device_authority_enabled::text || ':' || revision::text from private.device_auth_authority_control where control_key = 'legacy_device_authority'"), 'false:2', 'post-cutover authority state');
  assertEqual(query("select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.prosecdef"), '42', 'post-cutover API definer allowlist count');
}

function runTests(label, paths) {
  process.stdout.write(`\n=== ${label}: ${paths.length} pgTAP files ===\n`);
  run('supabase', ['test', 'db', '--local', ...paths]);
}

run('supabase', ['db', 'reset', '--local', '--version', PREDECESSOR_FLOOR]);
assertPredecessorState();
run('supabase', ['db', 'lint', '--local', '--schema', 'api,private,public', '--level', 'warning', '--fail-on', 'warning']);
runTests(`predecessor floor ${PREDECESSOR_FLOOR}`, predecessorTests);

run('supabase', ['db', 'reset', '--local']);
assertPostCutoverState();
run('supabase', ['db', 'lint', '--local', '--schema', 'api,private,public', '--level', 'warning', '--fail-on', 'warning']);
runTests('post-cutover head 20260812010000 (after 20260810090000 atomic cutover)', postCutoverTests);

process.stdout.write('\nHosted database two-floor harness passed.\n');
