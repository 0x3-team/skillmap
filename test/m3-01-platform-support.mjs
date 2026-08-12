import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { generateKeyPairSync, sign, verify, webcrypto } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const matrixPath = join(root, 'docs/plans/evidence/M3.01-connector-platform-support-matrix.md');
const receiptPath = join(root, 'docs/plans/evidence/R0-M3.01-candidate-reconciliation.json');
const spikePath = join(root, 'scripts/m3-01-macos-secure-enclave-spike.swift');

test('M3.01 matrix freezes the blocked platform decision and safety non-claims', () => {
  const matrix = readFileSync(matrixPath, 'utf8');
  assert.match(matrix, /\*\*Status:\*\* `BLOCKED_CANDIDATE`/);
  assert.match(matrix, /M1\.08.*non-exportable Ed25519/);
  assert.match(matrix, /P-256/);
  assert.match(matrix, /Node 22\/24/);
  assert.match(matrix, /NOT_SUPPORTED_M3/);
  assert.match(matrix, /Linux/);
  assert.match(matrix, /Windows/);
  assert.match(matrix, /SSH/);
  assert.match(matrix, /Cloudflare/);
  assert.match(matrix, /macOS supports multiple keychains/);
  assert.match(matrix, /explicit .*lock-state.*probe/i);
  assert.doesNotMatch(matrix, /macOS keychains are managed by the user and the default keychain is automatically locked/);
  assert.match(matrix, /No M3\.02 or product\/API\/database behavior was implemented/);
  assert.match(matrix, /No software-generated Ed25519 fallback/);
  assert.doesNotMatch(matrix, /plaintext file|secret into shell arguments/);
});

test('R0 receipt binds the accepted candidate and records every later migration disposition', () => {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'BLOCKED_CANDIDATE');
  assert.equal(receipt.candidate.head, '0bc3c7e2e7b6523c018980714eef4d26ae8dc80e');
  assert.equal(receipt.candidate.tree, 'eabadbeb69513607e382a92dd4107358005ea6e0');
  assert.equal(receipt.accepted_migrations.count, 27);
  assert.equal(receipt.accepted_migrations.rows.length, 27);
  assert.equal(receipt.accepted_migrations.remote_baseline_last, '20260727061300');
  assert.equal(receipt.later_main_migrations.length, 7);
  assert.deepEqual(
    receipt.later_main_migrations.map((row) => row.path.match(/\d{14}/)?.[0]),
    ['20260727061400', '20260727061500', '20260727061600', '20260727061700', '20260727061800', '20260727061900', '20260806084911']
  );
  assert.equal(receipt.dirty_main.unchanged, true);
  assert.equal(receipt.dirty_main.status_sha256_before, receipt.dirty_main.status_sha256_after);
  assert.equal(receipt.protected_duplicates.length, 4);
  assert.deepEqual(receipt.protected_duplicates_before, receipt.protected_duplicates_after);
  for (const [, digest, disposition] of receipt.protected_duplicates) {
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(disposition, 'candidate_absent_unchanged');
  }
  assert.match(receipt.non_claims.join('\n'), /No migration was applied/);
});

test('Node Ed25519 works for verification but its private key is exportable', () => {
  const message = Buffer.from('skillmap-m3-01-node-ed25519-vector');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signature = sign(null, message, privateKey);
  assert.equal(verify(null, message, publicKey, signature), true);
  assert.ok(privateKey.export({ format: 'der', type: 'pkcs8' }).length > 0);
});

test('Node Web Crypto supports the candidate verification algorithms', async () => {
  const message = new TextEncoder().encode('skillmap-m3-01-webcrypto-vector');
  const ed = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const edSignature = await webcrypto.subtle.sign('Ed25519', ed.privateKey, message);
  assert.equal(await webcrypto.subtle.verify('Ed25519', ed.publicKey, edSignature, message), true);

  const p256 = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const p256Signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, p256.privateKey, message);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, p256.publicKey, p256Signature, message), true);
});

test('Secure Enclave key generation requires private-key usage access control', () => {
  const spike = readFileSync(spikePath, 'utf8');
  const accessControlCall = spike.match(/SecAccessControlCreateWithFlags\(([\s\S]*?)\n\)/)?.[1] ?? '';
  assert.match(accessControlCall, /SecAccessControlCreateFlags\.privateKeyUsage/);
});

test('macOS native spike is bounded and reports custody proof or an explicit entitlement blocker', { skip: process.platform !== 'darwin' }, () => {
  const compiler = spawnSync('swiftc', ['-version'], { encoding: 'utf8' });
  if (compiler.status !== 0) return;
  const temp = mkdtempSync(join(tmpdir(), 'skillmap-m3-01-test-'));
  const binary = join(temp, 'm3-01-spike');
  try {
    execFileSync('swiftc', ['-framework', 'Security', spikePath, '-o', binary], { cwd: root, encoding: 'utf8' });
    const run = spawnSync(binary, [], { encoding: 'utf8' });
    const output = `${run.stdout ?? ''}`.trim().split('\n').filter(Boolean).at(-1);
    assert.ok(output, 'spike must emit one JSON receipt');
    const receipt = JSON.parse(output);
    assert.ok(receipt.status === 'pass' || receipt.status === 'blocked');
    assert.equal(Object.hasOwn(receipt, 'private_key'), false);
    assert.equal(Object.hasOwn(receipt, 'privateKey'), false);
    if (receipt.status === 'pass') {
      assert.equal(receipt.algorithm, 'ECDSA-P256');
      assert.equal(receipt.secure_enclave, true);
      assert.equal(receipt.private_exported, false);
    } else {
      assert.match(`${receipt.error ?? ''} ${receipt.stage ?? ''}`, /entitlement|keychain|secure_enclave/i);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
