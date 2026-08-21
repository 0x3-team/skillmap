import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { createMacOSAtomicNoReplaceMover, executeQuarantine } from '../dist/core/quarantine-execution.js';
import { establishRootCapability, preflightQuarantine } from '../dist/core/quarantine-preflight.js';
import { executeRestore } from '../dist/core/quarantine-restore.js';
import { buildImportManifest } from '../dist/core/import-manifest-builder.js';
import { issueImportParityReceipt } from '../dist/core/import-parity.js';
import { bindQuarantineAuthorization } from '../dist/core/quarantine-authorization.js';

const SOURCE_ROOT_ID = '00000000-0000-4000-8000-000000000030';
const QUARANTINE_ROOT_ID = '00000000-0000-4000-8000-000000000040';
const SKILL_CONTENT = '---\nname: Skill A\ndescription: Restore fixture.\n---\n# Skill A\n';

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr}`)));
  });
}

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'skillmap-m4-restore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const quarantine = path.join(root, 'quarantine');
  const receipts = path.join(root, 'receipts');
  await mkdir(path.join(source, 'skill-a'), { recursive: true });
  await mkdir(quarantine);
  await mkdir(receipts);
  await writeFile(path.join(source, 'skill-a', 'SKILL.md'), SKILL_CONTENT, 'utf8');
  const sourceRoot = await establishRootCapability({ rootId: SOURCE_ROOT_ID, configuredPath: source, fixtureClass: 'synthetic_fixture', policyVersion: 'm4-test-v1' });
  const quarantineRoot = await establishRootCapability({ rootId: QUARANTINE_ROOT_ID, configuredPath: quarantine, fixtureClass: 'synthetic_fixture', policyVersion: 'm4-test-v1' });
  const preflight = await preflightQuarantine({
    sourceRoot, quarantineRoot, candidates: ['skill-a'], operationId: 'quarantine-op-1', reservationNonce: 'nonce-1',
    dateUtc: '2026-08-20', atomicMoveAvailable: true, now: new Date('2026-08-20T12:00:00.000Z')
  });
  assert.equal(preflight.ok, true);
  const helper = path.join(root, 'atomic-rename');
  await run('xcrun', ['swiftc', path.resolve('scripts/m4-13-atomic-rename.swift'), '-o', helper]);
  const mover = createMacOSAtomicNoReplaceMover(helper);
  const manifestOptions = {
    rootRecord: { rootId: SOURCE_ROOT_ID, configuredPath: source, realPath: source, approvedAt: '2026-08-20T11:50:00.000Z' },
    publicId: 'pub_skill_a', logicalId: 'skill-a',
    provenance: { publisher_id: 'local-owner', ingest_id: 'fixture', created_at: '2026-08-20T11:50:00.000Z' }
  };
  const manifest = await buildImportManifest(path.join(source, 'skill-a'), manifestOptions);
  assert.equal(manifest.importable, true);
  const parityReceipt = await issueImportParityReceipt({
    accountId: `acct_${'a'.repeat(32)}`, deviceId: `dev_${'b'.repeat(32)}`,
    source: { sourceObjectId: `lso_${'c'.repeat(32)}`, rootId: SOURCE_ROOT_ID, relativePath: 'skill-a', skillDir: path.join(source, 'skill-a'), manifestOptions },
    cloud: {
      manifestDigest: manifest.manifestDigest, contentDigest: `sha256:${'1'.repeat(64)}`,
      receipts: manifest.files.map((file, ordinal) => ({
        filePublicId: `msf_${String(ordinal + 1).padStart(32, '0')}`,
        relativePath: file.path, acceptedByteSize: file.utf8_bytes, fileDigest: file.digest, ordinal
      })),
      finalized: {
        sessionPublicId: `imp_${'d'.repeat(32)}`, state: 'verified', verificationDigest: `sha256:${'4'.repeat(64)}`,
        versionPublicId: `msv_${'e'.repeat(32)}`, finalizedRevision: 3,
        ownerConsentId: `icn_${'f'.repeat(32)}`, consentDigest: `sha256:${'2'.repeat(64)}`,
        explicitConsentAt: '2026-08-20T11:55:00.000Z', consentExpiresAt: '2026-08-20T12:05:00.000Z',
        cutoverAuthorityId: `cut_${'3'.repeat(32)}`
      }
    },
    now: new Date('2026-08-20T12:00:00.000Z')
  });
  const quarantineAuthorization = bindQuarantineAuthorization({
    parityReceipt, preflight, idempotencyKey: 'idem-q-1', principalId: 'principal-1', replayNonce: 'replay-1',
    now: new Date('2026-08-20T12:00:00.000Z')
  });
  const quarantineReceipt = await executeQuarantine({
    preflight, parityReceipt, authorization: quarantineAuthorization, receiptDirectory: receipts, mover,
    now: () => new Date('2026-08-20T12:00:00.000Z')
  });
  assert.equal(quarantineReceipt.status, 'MOVE_OBSERVED');
  const originalDestinationIdentityDigest = `sha256:${'3'.repeat(64)}`;
  const restoreAuthorization = {
    action: 'restore', operationId: 'restore-op-1', idempotencyKey: 'idem-r-1', accountId: parityReceipt.accountId, deviceId: parityReceipt.deviceId,
    quarantineReceiptId: quarantineReceipt.receiptId, quarantineObjectIdentityDigest: quarantineReceipt.quarantineObjectIdentityDigest,
    quarantineDestinationIdentityDigest: quarantineReceipt.destinationIdentityDigest, quarantineRootId: quarantineRoot.rootId,
    escapedQuarantineRelativePath: preflight.reservation.escapedDestinationRelativePath, originalRootId: sourceRoot.rootId,
    escapedOriginalRelativePath: preflight.snapshot.escapedRelativePath, originalDestinationIdentityDigest,
    immutableVersionId: parityReceipt.immutableVersionId, contentDigest: quarantineReceipt.contentDigest, previewDigest: `sha256:${'4'.repeat(64)}`,
    ownerConsentId: parityReceipt.ownerConsentId, consentDigest: parityReceipt.consentDigest, parityReceiptId: parityReceipt.receiptId,
    cutoverAuthorityId: parityReceipt.cutoverAuthorityId, currentHostedLifecycleAuthorizationId: 'lifecycle-1',
    quarantinedAt: quarantineReceipt.quarantinedAt, restoreExpiresAt: quarantineReceipt.restoreExpiresAt,
    principalId: 'principal-1', policyRevision: 'm4-test-v1', replayNonce: 'restore-replay-1'
  };
  return { source, receipts, sourceRoot, quarantineRoot, preflight, mover, quarantineReceipt, restoreAuthorization };
}

test('restore returns the exact quarantined object to its original destination', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  const receipt = await executeRestore({
    quarantineReceipt: state.quarantineReceipt,
    authorization: state.restoreAuthorization,
    quarantineRoot: state.quarantineRoot,
    quarantinePath: state.preflight.destinationPath,
    originalRoot: state.sourceRoot,
    originalCandidates: ['skill-a'],
    receiptDirectory: state.receipts,
    mover: state.mover,
    now: () => new Date('2026-08-21T12:00:00.000Z')
  });
  assert.equal(receipt.status, 'RESTORE_OBSERVED');
  assert.equal(await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8'), SKILL_CONTENT);
});

test('occupied exact original destination preserves both objects', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  await mkdir(path.join(state.source, 'skill-a'));
  await writeFile(path.join(state.source, 'skill-a', 'occupant.txt'), 'occupant', 'utf8');
  const outcome = await executeRestore({
    quarantineReceipt: state.quarantineReceipt, authorization: state.restoreAuthorization,
    quarantineRoot: state.quarantineRoot, quarantinePath: state.preflight.destinationPath,
    originalRoot: state.sourceRoot, originalCandidates: ['skill-a'], receiptDirectory: state.receipts,
    mover: state.mover, now: () => new Date('2026-08-21T12:00:00.000Z')
  });
  assert.equal(outcome.code, 'RESTORE_DESTINATION_OCCUPIED');
  assert.equal(await readFile(path.join(state.source, 'skill-a', 'occupant.txt'), 'utf8'), 'occupant');
  assert.equal(await readFile(path.join(state.preflight.destinationPath, 'SKILL.md'), 'utf8'), SKILL_CONTENT);
});

test('restore at expiry is denied without mutation or deletion', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  const outcome = await executeRestore({
    quarantineReceipt: state.quarantineReceipt, authorization: state.restoreAuthorization,
    quarantineRoot: state.quarantineRoot, quarantinePath: state.preflight.destinationPath,
    originalRoot: state.sourceRoot, originalCandidates: ['skill-a'], receiptDirectory: state.receipts,
    mover: state.mover, now: () => new Date(state.quarantineReceipt.restoreExpiresAt)
  });
  assert.equal(outcome.code, 'OWNER_PILOT_RESTORE_WINDOW_EXPIRED');
  assert.equal(await readFile(path.join(state.preflight.destinationPath, 'SKILL.md'), 'utf8'), SKILL_CONTENT);
});

test('completed restore replay returns the prior receipt without a second move', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  const input = {
    quarantineReceipt: state.quarantineReceipt,
    authorization: state.restoreAuthorization,
    quarantineRoot: state.quarantineRoot,
    quarantinePath: state.preflight.destinationPath,
    originalRoot: state.sourceRoot,
    originalCandidates: ['skill-a'],
    receiptDirectory: state.receipts,
    mover: state.mover,
    now: () => new Date('2026-08-21T12:00:00.000Z')
  };
  const receipt = await executeRestore(input);
  let replayMoveCalls = 0;
  const replay = await executeRestore({
    ...input,
    mover: { move: async () => { replayMoveCalls += 1; throw new Error('must not move on replay'); } },
    now: () => new Date('2026-10-01T12:00:00.000Z')
  });
  assert.deepEqual(replay, receipt);
  assert.equal(replayMoveCalls, 0);
});

test('same idempotency key with changed restore authorization is rejected', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  const input = {
    quarantineReceipt: state.quarantineReceipt,
    authorization: state.restoreAuthorization,
    quarantineRoot: state.quarantineRoot,
    quarantinePath: state.preflight.destinationPath,
    originalRoot: state.sourceRoot,
    originalCandidates: ['skill-a'],
    receiptDirectory: state.receipts,
    mover: state.mover,
    now: () => new Date('2026-08-21T12:00:00.000Z')
  };
  await executeRestore(input);
  await assert.rejects(
    executeRestore({
      ...input,
      authorization: { ...state.restoreAuthorization, replayNonce: 'changed-replay' }
    }),
    /IDEMPOTENCY_CONFLICT/
  );
});

test('restore rejects a replacement at the quarantine path before mutation', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  await rm(state.preflight.destinationPath, { recursive: true, force: true });
  await mkdir(state.preflight.destinationPath);
  await writeFile(path.join(state.preflight.destinationPath, 'SKILL.md'), 'replacement', 'utf8');

  await assert.rejects(
    executeRestore({
      quarantineReceipt: state.quarantineReceipt,
      authorization: state.restoreAuthorization,
      quarantineRoot: state.quarantineRoot,
      quarantinePath: state.preflight.destinationPath,
      originalRoot: state.sourceRoot,
      originalCandidates: ['skill-a'],
      receiptDirectory: state.receipts,
      mover: state.mover,
      now: () => new Date('2026-08-21T12:00:00.000Z')
    }),
    (error) => error instanceof Error
      && error.message === 'QUARANTINE_IDENTITY_MISMATCH'
      && !error.message.includes(state.preflight.destinationPath)
  );
});

test('restore binds the escaped quarantine path and exact one-candidate cardinality', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  const base = {
    quarantineReceipt: state.quarantineReceipt,
    authorization: state.restoreAuthorization,
    quarantineRoot: state.quarantineRoot,
    quarantinePath: state.preflight.destinationPath,
    originalRoot: state.sourceRoot,
    receiptDirectory: state.receipts,
    mover: state.mover,
    now: () => new Date('2026-08-21T12:00:00.000Z')
  };
  const cardinality = await executeRestore({ ...base, originalCandidates: [] });
  assert.equal(cardinality.code, 'OWNER_PILOT_CARDINALITY_DENIED');

  await assert.rejects(
    executeRestore({
      ...base,
      originalCandidates: ['skill-a'],
      authorization: { ...state.restoreAuthorization, escapedQuarantineRelativePath: 'wrong/path' }
    }),
    /AUTHORIZATION_BINDING_INCOMPLETE/
  );
});
