#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
const TEST_ROOT = join(REPO, 'supabase', 'tests');
const LEGACY_FLOOR = '20260727061300';
const PRE_CUTOVER_FLOOR = '20260810070000';
const POST_CUTOVER_HEAD = '20260812175447';

// This suite asserts the exact M2.11 policy and error surface. M3's additive
// owner-device migration intentionally changes both before the cutover.
const LEGACY_ONLY = new Set([
  'skill_vault_devices.test.sql',
]);

// These suites exercise the additive M3 authority while legacy entrypoints are
// still admitted. They must run after all creation migrations and before the
// admission fence and atomic cutover.
const PRE_CUTOVER_ONLY = new Set([
  'device_auth_confirmation.test.sql',
  'device_auth_key_rotation.test.sql',
  'device_auth_lifecycle.test.sql',
  'device_auth_pairing.test.sql',
  'device_auth_poll_exchange.test.sql',
  'device_auth_refresh_replay.test.sql',
  'skill_vault_device_import_rls.test.sql',
]);

const FLOOR_ONLY = new Set([...LEGACY_ONLY, ...PRE_CUTOVER_ONLY]);

const HARNESS_PHASE_ORDER = Object.freeze([
  'legacy-reset',
  'legacy-state',
  'legacy-pgtap',
  'pre-cutover-reset',
  'pre-cutover-state',
  'pre-cutover-pgtap',
  'head-reset',
  'post-cutover-state',
  'post-cutover-lint',
  'post-cutover-pgtap',
]);

const tests = readdirSync(TEST_ROOT)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => join('supabase', 'tests', name));
const legacyTests = tests.filter((path) => LEGACY_ONLY.has(path.split('/').pop()));
const preCutoverTests = tests.filter((path) => PRE_CUTOVER_ONLY.has(path.split('/').pop()));
const postCutoverTests = tests.filter((path) => !FLOOR_ONLY.has(path.split('/').pop()));

function run(command, args) {
  process.stdout.write(`\n$ ${command} ${args.join(' ')}\n`);
  execFileSync(command, args, { cwd: REPO, stdio: 'inherit' });
}

function capture(command, args) {
  return execFileSync(command, args, { cwd: REPO, encoding: 'utf8' }).trim();
}

function parseDbUrlFromJson(status) {
  const parsed = JSON.parse(status);
  if (typeof parsed.DB_URL !== 'string' || parsed.DB_URL.length === 0) {
    throw new Error('Supabase JSON status did not expose a local DB_URL');
  }
  return parsed.DB_URL;
}

function parseDbUrlFromEnv(status) {
  const line = status.split(/\r?\n/).find((entry) => entry.startsWith('DB_URL='));
  if (!line) throw new Error('Supabase env status did not expose a local DB_URL');

  const rawValue = line.slice('DB_URL='.length).trim();
  if (rawValue.startsWith('"')) {
    if (!rawValue.endsWith('"')) throw new Error('Supabase env DB_URL has an unterminated quote');
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error('Supabase env DB_URL has invalid quoting');
    }
  }
  if (rawValue.length === 0 || /\s/.test(rawValue)) {
    throw new Error('Supabase env DB_URL has an invalid value');
  }
  return rawValue;
}

function dbUrl() {
  try {
    return parseDbUrlFromJson(capture('supabase', ['status', '-o', 'json']));
  } catch (jsonError) {
    try {
      return parseDbUrlFromEnv(capture('supabase', ['status', '-o', 'env']));
    } catch (envError) {
      throw new Error(`Supabase status did not expose a local DB_URL (${jsonError.message}; ${envError.message})`);
    }
  }
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

function assertDbUrlParserFixtures() {
  const expected = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  assertEqual(parseDbUrlFromJson(JSON.stringify({ DB_URL: expected })), expected, 'JSON DB_URL parser');
  assertEqual(parseDbUrlFromEnv(`API_URL="http://127.0.0.1:54321"\nDB_URL="${expected}"`), expected, 'quoted env DB_URL parser');
  assertEqual(parseDbUrlFromEnv(`DB_URL=${expected}`), expected, 'unquoted env DB_URL parser');
}

function createPhaseTracker() {
  let nextPhase = 0;
  return {
    run(name, action) {
      const expected = HARNESS_PHASE_ORDER[nextPhase];
      if (name !== expected) {
        throw new Error(`Hosted database phase order: expected ${expected}, got ${name}`);
      }
      action();
      nextPhase += 1;
    },
    assertComplete() {
      assertEqual(String(nextPhase), String(HARNESS_PHASE_ORDER.length), 'hosted database phase count');
    },
  };
}

function assertHarnessOrderingFixtures() {
  const valid = createPhaseTracker();
  for (const phase of HARNESS_PHASE_ORDER) valid.run(phase, () => {});
  valid.assertComplete();

  const invalid = createPhaseTracker();
  invalid.run('legacy-reset', () => {});
  invalid.run('legacy-state', () => {});
  invalid.run('legacy-pgtap', () => {});
  let rejected = false;
  try {
    invalid.run('post-cutover-lint', () => {});
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('hosted database ordering fixture accepted lint before full-head reset');
}

function assertFloorFixtures() {
  assertEqual(legacyTests.map((path) => path.split('/').pop()).join(','), [...LEGACY_ONLY].join(','), 'legacy-only test selection');
  assertEqual(preCutoverTests.map((path) => path.split('/').pop()).join(','), [...PRE_CUTOVER_ONLY].sort().join(','), 'pre-cutover test selection');
  assertEqual(String(postCutoverTests.length + FLOOR_ONLY.size), String(tests.length), 'floor-specific tests are excluded exactly once from head');
}

function assertMigrationHeadFixture() {
  const migrations = readdirSync(join(REPO, 'supabase', 'migrations'))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 14))
    .sort();
  const actual = migrations.at(-1);
  assertEqual(actual, POST_CUTOVER_HEAD, 'checked-in post-cutover migration head');
}

function assertLegacyState() {
  const version = query("select version from supabase_migrations.schema_migrations order by version desc limit 1");
  assertEqual(version, LEGACY_FLOOR, 'legacy migration floor');
  assertEqual(query("select coalesce(to_regclass('private.device_auth_pairings')::text, 'absent')"), 'absent', 'legacy device-auth pairing table');
  assertEqual(query("select coalesce(to_regclass('private.device_auth_authority_control')::text, 'absent')"), 'absent', 'legacy authority control');
}

function assertPreCutoverState() {
  const version = query("select version from supabase_migrations.schema_migrations order by version desc limit 1");
  assertEqual(version, PRE_CUTOVER_FLOOR, 'pre-cutover migration floor');
  assertEqual(query("select coalesce(to_regclass('private.device_auth_pairings')::text, 'absent')"), 'private.device_auth_pairings', 'pre-cutover device-auth pairing table');
  assertEqual(query("select coalesce(to_regclass('private.device_auth_authority_control')::text, 'absent')"), 'absent', 'pre-cutover authority control');
}

function assertPostCutoverState() {
  const version = query("select version from supabase_migrations.schema_migrations order by version desc limit 1");
  assertEqual(version, POST_CUTOVER_HEAD, 'post-cutover migration head');
  assertEqual(query("select legacy_device_authority_enabled::text || ':' || revision::text from private.device_auth_authority_control where control_key = 'legacy_device_authority'"), 'false:2', 'post-cutover authority state');
  assertEqual(query("select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.prosecdef"), '43', 'post-cutover API definer allowlist count');
}

function runTests(label, paths) {
  process.stdout.write(`\n=== ${label}: ${paths.length} pgTAP files ===\n`);
  run('supabase', ['test', 'db', '--local', ...paths]);
}

assertDbUrlParserFixtures();
assertHarnessOrderingFixtures();
assertFloorFixtures();
assertMigrationHeadFixture();
if (process.argv.includes('--parser-self-test')) {
  process.stdout.write('Hosted database parser, floor selection, and ordering fixtures passed.\n');
} else {
  const phase = createPhaseTracker();
  phase.run('legacy-reset', () => run('supabase', ['db', 'reset', '--local', '--version', LEGACY_FLOOR]));
  phase.run('legacy-state', assertLegacyState);
  phase.run('legacy-pgtap', () => runTests(`legacy M2.11 floor ${LEGACY_FLOOR}`, legacyTests));
  phase.run('pre-cutover-reset', () => run('supabase', ['db', 'reset', '--local', '--version', PRE_CUTOVER_FLOOR]));
  phase.run('pre-cutover-state', assertPreCutoverState);
  phase.run('pre-cutover-pgtap', () => runTests(`M3 pre-cutover floor ${PRE_CUTOVER_FLOOR}`, preCutoverTests));
  phase.run('head-reset', () => run('supabase', ['db', 'reset', '--local']));
  phase.run('post-cutover-state', assertPostCutoverState);
  phase.run('post-cutover-lint', () => run('supabase', ['db', 'lint', '--local', '--schema', 'api,private,public', '--level', 'warning', '--fail-on', 'warning']));
  phase.run('post-cutover-pgtap', () => runTests(`post-cutover head ${POST_CUTOVER_HEAD} (after 20260810090000 atomic cutover)`, postCutoverTests));
  phase.assertComplete();

  process.stdout.write('\nHosted database two-floor harness passed.\n');
}
