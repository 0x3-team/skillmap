import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildReleaseReceipt,
  determineLocalVerdict,
  parsePreflightArguments,
  writeExclusiveReceipt
} from '../scripts/free-public-alpha-preflight.mjs';
import { scanRepositorySecretCanaries } from '../scripts/repository-secret-canary.mjs';

test('free public alpha preflight arguments are bounded and explicit', () => {
  assert.deepEqual(parsePreflightArguments([]), { profile: 'static', requireClean: false, output: null });
  assert.deepEqual(parsePreflightArguments(['--profile', 'candidate', '--require-clean', '--output', '/tmp/receipt.json']), {
    profile: 'candidate', requireClean: true, output: '/tmp/receipt.json'
  });
  assert.throws(() => parsePreflightArguments(['--profile', 'full']), /static or candidate/);
  assert.throws(() => parsePreflightArguments(['--profile', 'static', '--profile', 'static']), /only once/);
  assert.throws(() => parsePreflightArguments(['--unknown']), /Unknown preflight argument/);
  assert.throws(() => parsePreflightArguments(['--require-clean', '--require-clean']), /only once/);
});

test('local and public launch verdicts cannot be collapsed', () => {
  assert.equal(determineLocalVerdict([{ status: 'passed' }]), 'passed');
  assert.equal(determineLocalVerdict([{ status: 'passed' }, { status: 'blocked' }]), 'blocked');
  assert.equal(determineLocalVerdict([{ status: 'blocked' }, { status: 'failed' }]), 'failed');
  const receipt = buildReleaseReceipt({
    candidate: { commit: 'a'.repeat(40) },
    gates: [{ id: 'static', status: 'passed' }],
    profile: 'static',
    generatedAt: '2026-07-12T00:00:00.000Z'
  });
  assert.equal(receipt.localVerdict, 'passed');
  assert.equal(receipt.launchVerdict, 'NO_GO');
  assert.match(receipt.launchBoundary, /not push, deployment, live OAuth/i);
});

test('static preflight binds worker lease renewal to its required migration', () => {
  const source = readFileSync(new URL('../scripts/free-public-alpha-preflight.mjs', import.meta.url), 'utf8');
  assert.match(source, /20260713003000_launch_safety_reports_lifecycle\.sql/);
  assert.match(source, /renew_skill_submission_claim/);
  assert.match(source, /worker-migration-compatibility/);
});

test('preflight receipts are exclusive and private by default', { skip: process.platform === 'win32' }, t => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'skillmap-public-alpha-preflight-test-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const output = path.join(scratch, 'nested', 'receipt.json');
  const receipt = { schemaVersion: 'fixture/v1', localVerdict: 'passed' };
  assert.equal(writeExclusiveReceipt(output, receipt), output);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), receipt);
  assert.equal(readFileSync(output).length > 0, true);
  assert.throws(() => writeExclusiveReceipt(output, receipt), /EEXIST/);
});

test('repository secret canary scan catches credentials and limits the fixture exception', () => {
  const credential = `github_pat_${'A'.repeat(40)}`;
  assert.deepEqual(scanRepositorySecretCanaries([{ path: 'src/runtime.ts', bytes: Buffer.from(credential) }]), [
    { path: 'src/runtime.ts', label: 'GitHub credential' }
  ]);
  assert.deepEqual(scanRepositorySecretCanaries([{
    path: 'test/package-candidate-verifier.mjs',
    bytes: Buffer.from(['-----BEGIN', 'PRIVATE KEY-----'].join(' '))
  }]), []);
  assert.deepEqual(scanRepositorySecretCanaries([{
    path: 'test/another-test.mjs',
    bytes: Buffer.from(['-----BEGIN', 'PRIVATE KEY-----'].join(' '))
  }]), [{ path: 'test/another-test.mjs', label: 'PEM private key' }]);
});
