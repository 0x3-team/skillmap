import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fixturePath = join(root, 'test/fixtures/m3-12-device-auth/cases.json');
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString('utf8'));
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
const matrixSourcePath = join(root, 'test/m3-12-device-auth-adversarial.mjs');
const matrixSourceSha256 = createHash('sha256').update(readFileSync(matrixSourcePath)).digest('hex');
const outputDir = join(root, '.tmp/m3-12-device-auth');
const receiptPath = join(outputDir, 'receipt.json');

function expectedBlockedRows() {
  return fixture.blocked_rows.map((row) => ({ ...row, status: 'blocked' }));
}

export function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('receipt must be an object');
  if (receipt.schema !== fixture.schema || receipt.status !== 'passed' || receipt.fixture_sha256 !== fixtureSha256 || receipt.matrix_source_sha256 !== matrixSourceSha256) throw new Error('receipt schema or source/fixture digest mismatch');
  if (!Array.isArray(receipt.cases) || receipt.cases.length !== fixture.cases.length) throw new Error('receipt case count mismatch');
  const expectedIds = fixture.cases.map((row) => row.id);
  const actualIds = receipt.cases.map((row) => row?.id);
  if (new Set(expectedIds).size !== expectedIds.length || new Set(actualIds).size !== actualIds.length || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) throw new Error('receipt case IDs/order mismatch');
  for (let index = 0; index < fixture.cases.length; index += 1) {
    const expected = fixture.cases[index];
    const actual = receipt.cases[index];
    if (actual.category !== expected.category || actual.expected !== expected.expected || !['allow', 'deny'].includes(actual.actual) || typeof actual.passed !== 'boolean' || actual.passed !== (actual.actual === actual.expected) || !actual.passed) throw new Error(`receipt case mismatch: ${expected.id}`);
  }
  const blocked = receipt.blocked_rows;
  const expectedBlocked = expectedBlockedRows();
  if (!Array.isArray(blocked) || blocked.length === 0 || JSON.stringify(blocked) !== JSON.stringify(expectedBlocked)) throw new Error('receipt blocked rows mismatch');
  const allIds = [...actualIds, ...blocked.map((row) => row.id)];
  if (new Set(allIds).size !== allIds.length || blocked.some((row) => row.status !== 'blocked' || typeof row.reason !== 'string' || row.reason.length === 0)) throw new Error('receipt blocked row integrity mismatch');
  const counts = { expected: receipt.cases.length, passed: receipt.cases.filter((row) => row.passed).length, failed: receipt.cases.filter((row) => !row.passed).length, skipped: 0 };
  if (receipt.expected_cases !== counts.expected || receipt.passed_cases !== counts.passed || receipt.failed_cases !== counts.failed || receipt.skipped_cases !== counts.skipped || receipt.failed_cases !== 0 || receipt.skipped_cases !== 0) throw new Error('receipt derived counts mismatch');
  return true;
}

function scanCapturedOutput(text) {
  const canaries = [['M312', 'ACCESS', 'CANARY'].join('_'), ['M312', 'PROOF', 'CANARY'].join('_'), ['M312', 'PRIVATE', 'PATH', 'CANARY'].join('_')];
  if (canaries.some((canary) => text.includes(canary))) throw new Error(`captured output contains canary: ${canaries.find((canary) => text.includes(canary))}`);
}

function receiptForgeSelfTest(receipt) {
  assert.throws(() => validateReceipt({ ...receipt, schema: 'forged' }), /receipt/);
  assert.throws(() => validateReceipt({ ...receipt, matrix_source_sha256: 'forged' }), /receipt/);
  assert.throws(() => validateReceipt({ ...receipt, cases: [{ ...receipt.cases[0], id: 'unknown-case' }, ...receipt.cases.slice(1)] }), /receipt/);
  assert.throws(() => validateReceipt({ ...receipt, cases: [{ ...receipt.cases[0], category: 'forged' }, ...receipt.cases.slice(1)] }), /receipt/);
  assert.throws(() => validateReceipt({ ...receipt, blocked_rows: [] }), /receipt/);
}

export function main() {
  mkdirSync(outputDir, { recursive: true });
  try { rmSync(receiptPath, { force: true }); } catch { /* stale receipt is never accepted */ }
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=1', 'test/m3-12-device-auth-adversarial.mjs'], {
    cwd: root,
    env: { ...process.env, M312_RECEIPT_PATH: receiptPath },
    encoding: 'utf8'
  });
  writeFileSync(join(outputDir, 'stdout.log'), result.stdout ?? '', { mode: 0o600 });
  writeFileSync(join(outputDir, 'stderr.log'), result.stderr ?? '', { mode: 0o600 });
  scanCapturedOutput(result.stdout ?? '');
  scanCapturedOutput(result.stderr ?? '');
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) return result.status ?? 1;
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch (error) { throw new Error(`M3.12 receipt missing or malformed: ${error instanceof Error ? error.message : 'unknown error'}`); }
  validateReceipt(receipt);
  receiptForgeSelfTest(receipt);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main();
