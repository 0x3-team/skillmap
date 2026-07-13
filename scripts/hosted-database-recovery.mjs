import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const SNAPSHOT_SCHEMAS = Object.freeze(['api', 'auth', 'private']);
let cachedDatabaseContainer = null;

export function parseRecoveryArguments(argv) {
  const options = { execute: false, output: null, allowDirty: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--execute') {
      assert.equal(options.execute, false, '--execute may be supplied only once');
      options.execute = true;
      continue;
    }
    if (argument === '--allow-dirty') {
      assert.equal(options.allowDirty, false, '--allow-dirty may be supplied only once');
      options.allowDirty = true;
      continue;
    }
    if (argument === '--output') {
      assert.equal(options.output, null, '--output may be supplied only once');
      assert.ok(index + 1 < argv.length, '--output requires a value');
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown recovery argument: ${argument}`);
  }
  assert.equal(options.execute, true, 'Recovery rehearsal is destructive to local data and requires --execute');
  assert.ok(options.output, '--output is required so the restore verdict is retained');
  return options;
}

export function parseTableSnapshot(value) {
  const tables = {};
  for (const line of value.trim().split('\n').filter(Boolean)) {
    const [table, rows, digest, ...extra] = line.split('|');
    assert.equal(extra.length, 0, `unexpected recovery snapshot fields for ${table ?? 'unknown table'}`);
    assert.match(table ?? '', /^(?:api|auth|private)\.[a-z0-9_]+$/);
    assert.match(rows ?? '', /^(?:0|[1-9][0-9]*)$/);
    assert.match(digest ?? '', /^[a-f0-9]{32}$/);
    assert.equal(Object.hasOwn(tables, table), false, `duplicate recovery snapshot table: ${table}`);
    tables[table] = { rows: Number(rows), digest };
  }
  return tables;
}

export function compareRecoverySnapshots(before, after) {
  const beforeJson = JSON.stringify(sortObject(before));
  const afterJson = JSON.stringify(sortObject(after));
  return { equal: beforeJson === afterJson, before: sortObject(before), after: sortObject(after) };
}

export function recoverySnapshotDifferences(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names.filter(name => JSON.stringify(before[name] ?? null) !== JSON.stringify(after[name] ?? null)).map(name => ({
    name,
    before: before[name] ?? null,
    after: after[name] ?? null
  }));
}

export function parseSequenceSnapshot(value) {
  const sequences = {};
  for (const line of value.trim().split('\n').filter(Boolean)) {
    const [sequence, lastValue, startValue, incrementBy, cycle, cacheSize, ...extra] = line.split('|');
    assert.equal(extra.length, 0, `unexpected recovery sequence fields for ${sequence ?? 'unknown sequence'}`);
    assert.match(sequence ?? '', /^(?:api|auth|private)\.[a-z0-9_]+$/);
    for (const value of [lastValue, startValue, incrementBy, cacheSize]) assert.match(value ?? '', /^(?:NULL|-?[0-9]+)$/);
    assert.match(cycle ?? '', /^(?:true|false)$/);
    assert.equal(Object.hasOwn(sequences, sequence), false, `duplicate recovery sequence: ${sequence}`);
    sequences[sequence] = { lastValue, startValue, incrementBy, cycle: cycle === 'true', cacheSize };
  }
  return sequences;
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    env: { ...process.env, PGPASSWORD: 'postgres' },
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio ?? [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new Error(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return result;
}

function psql(args, input) {
  return run('docker', [
    'exec', '-i', databaseContainer(), 'psql',
    '--username', 'postgres',
    '--dbname', 'postgres',
    '--no-password',
    '--set', 'ON_ERROR_STOP=1',
    ...args
  ], input === undefined ? {} : { input }).stdout;
}

function databaseContainer() {
  if (cachedDatabaseContainer) return cachedDatabaseContainer;
  const config = readFileSync(path.join(repo, 'supabase/config.toml'), 'utf8');
  const project = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"\s*$/m.exec(config)?.[1];
  assert.ok(project, 'supabase/config.toml must declare a bounded project_id');
  const names = run('docker', [
    'ps', '--filter', `label=com.supabase.cli.project=${project}`,
    '--filter', 'name=supabase_db_', '--format', '{{.Names}}'
  ]).stdout.trim().split('\n').filter(Boolean);
  assert.equal(names.length, 1, `expected exactly one running local Supabase database container for ${project}`);
  cachedDatabaseContainer = names[0];
  return cachedDatabaseContainer;
}

function readTableSnapshot() {
  const rows = applicationTableNames().map(table => {
    const [schema, name] = table.split('.');
    const sql = `select '${table}', count(*)::text, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by md5(to_jsonb(t)::text)), '')) from "${schema}"."${name}" t;`;
    return psql(['--tuples-only', '--no-align', '--field-separator', '|', '--command', sql]).trim();
  });
  return parseTableSnapshot(rows.join('\n'));
}

function applicationTableNames() {
  const sql = "select schemaname || '.' || tablename from pg_tables where schemaname in ('api', 'auth', 'private') and not (schemaname = 'auth' and tablename = 'schema_migrations') order by schemaname, tablename;";
  const tables = psql(['--tuples-only', '--no-align', '--command', sql]).trim().split('\n').filter(Boolean);
  for (const table of tables) assert.match(table, /^(?:api|auth|private)\.[a-z0-9_]+$/);
  return tables;
}

function migrationVersions() {
  return psql(['--tuples-only', '--no-align', '--command', 'select version from supabase_migrations.schema_migrations order by version;'])
    .trim().split('\n').filter(Boolean);
}

function readSequenceSnapshot() {
  const sql = String.raw`
select schemaname || '.' || sequencename,
  coalesce(last_value::text, 'NULL'),
  start_value::text,
  increment_by::text,
  cycle::text,
  cache_size::text
from pg_sequences
where schemaname in ('api', 'auth', 'private')
order by schemaname, sequencename;
`;
  return parseSequenceSnapshot(psql(['--tuples-only', '--no-align', '--field-separator', '|', '--command', sql]));
}

function truncateApplicationData() {
  const tables = applicationTableNames();
  if (!tables.length) return;
  const qualified = tables.map(table => table.split('.').map(component => `"${component}"`).join('.'));
  // Supabase Auth owns some sequences with platform roles. The data-only dump
  // carries sequence setval state, so resetting identities here is both
  // unnecessary and would require broadening the migration role's authority.
  psql(['--quiet', '--command', `truncate table ${qualified.join(', ')} cascade;`]);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function writeReceipt(target, receipt) {
  const absolute = path.resolve(target);
  mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const fd = openSync(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
    assert.equal(fstatSync(fd).isFile(), true, 'recovery receipt target must remain a regular file');
  } finally {
    closeSync(fd);
  }
  return absolute;
}

function main(argv) {
  const options = parseRecoveryArguments(argv);
  const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-public-alpha-recovery-'));
  const dump = path.join(scratch, 'application-data.sql');
  let receipt;
  try {
    run('supabase', ['status']);
    const worktreeState = run('git', ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
    assert.equal(options.allowDirty || !worktreeState, true, 'Recovery evidence requires a clean exact-candidate worktree; --allow-dirty is development-only.');
    const before = readTableSnapshot();
    const beforeSequences = readSequenceSnapshot();
    const beforeMigrations = migrationVersions();
    run('supabase', ['db', 'dump', '--local', '--data-only', '--schema', SNAPSHOT_SCHEMAS.join(','), '--use-copy', '--file', dump]);
    const dumpDigest = sha256(dump);

    run('supabase', ['db', 'reset', '--local']);
    assert.deepEqual(migrationVersions(), beforeMigrations, 'migration versions changed while rebuilding the local database');
    truncateApplicationData();
    psql(['--single-transaction'], readFileSync(dump));

    const after = readTableSnapshot();
    const comparison = compareRecoverySnapshots(before, after);
    assert.equal(comparison.equal, true, `restored application table counts or canonical row digests differ: ${JSON.stringify(recoverySnapshotDifferences(before, after))}`);
    const sequenceComparison = compareRecoverySnapshots(beforeSequences, readSequenceSnapshot());
    assert.equal(sequenceComparison.equal, true, `restored application sequence state differs: ${JSON.stringify(recoverySnapshotDifferences(beforeSequences, sequenceComparison.after))}`);
    run('supabase', ['db', 'lint', '--local', '--level', 'warning']);
    receipt = {
      schemaVersion: 'skillmap-hosted-database-recovery/v1',
      generatedAt: new Date().toISOString(),
      sourceCommit: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
      sourceTree: run('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim(),
      exactCandidate: !worktreeState,
      schemas: SNAPSHOT_SCHEMAS,
      migrationVersions: beforeMigrations,
      dumpSha256: dumpDigest,
      dumpRetained: false,
      tables: comparison.after,
      sequences: sequenceComparison.after,
      verdict: 'passed',
      boundary: worktreeState
        ? 'Development-only dirty-worktree rehearsal; not exact-candidate, encrypted off-host retention, or hosted-provider restore proof.'
        : 'Local exact-candidate data-only backup/reset/replay evidence; not encrypted off-host retention or hosted-provider restore proof.'
    };
    const output = writeReceipt(options.output, receipt);
    process.stdout.write(`${JSON.stringify({ verdict: receipt.verdict, receipt: output, tables: Object.keys(receipt.tables).length })}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
