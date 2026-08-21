import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { establishRootCapability, preflightQuarantine } from '../dist/core/quarantine-preflight.js';
import {
  createMacOSAtomicNoReplaceMover,
  executeQuarantine
} from '../dist/core/quarantine-execution.js';
import { buildImportManifest } from '../dist/core/import-manifest-builder.js';
import { issueImportParityReceipt } from '../dist/core/import-parity.js';
import { bindQuarantineAuthorization } from '../dist/core/quarantine-authorization.js';

const SOURCE_ROOT_ID = '00000000-0000-4000-8000-000000000010';
const QUARANTINE_ROOT_ID = '00000000-0000-4000-8000-000000000020';
const SKILL_CONTENT = '---\nname: Skill A\ndescription: Quarantine fixture.\n---\n# Skill A\n';

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
  const root = await mkdtemp(path.join(tmpdir(), 'skillmap-m4-quarantine-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const quarantine = path.join(root, 'quarantine');
  const receipts = path.join(root, 'receipts');
  await mkdir(path.join(source, 'skill-a'), { recursive: true });
  await mkdir(quarantine);
  await mkdir(receipts);
  await writeFile(path.join(source, 'skill-a', 'SKILL.md'), SKILL_CONTENT, 'utf8');
  const sourceRoot = await establishRootCapability({
    rootId: SOURCE_ROOT_ID, configuredPath: source, fixtureClass: 'synthetic_fixture', policyVersion: 'm4-test-v1'
  });
  const quarantineRoot = await establishRootCapability({
    rootId: QUARANTINE_ROOT_ID, configuredPath: quarantine, fixtureClass: 'synthetic_fixture', policyVersion: 'm4-test-v1'
  });
  const preflight = await preflightQuarantine({
    sourceRoot,
    quarantineRoot,
    candidates: ['skill-a'],
    operationId: 'op-0123456789abcdef',
    reservationNonce: 'nonce-0123456789abcdef',
    dateUtc: '2026-08-20',
    atomicMoveAvailable: true,
    now: new Date('2026-08-20T12:00:00.000Z')
  });
  assert.equal(preflight.ok, true);
  const helper = path.join(root, 'atomic-rename');
  await run('xcrun', ['swiftc', path.resolve('scripts/m4-13-atomic-rename.swift'), '-o', helper]);
  const manifestOptions = {
    rootRecord: { rootId: SOURCE_ROOT_ID, configuredPath: source, realPath: source, approvedAt: '2026-08-20T11:50:00.000Z' },
    publicId: 'pub_skill_a', logicalId: 'skill-a',
    provenance: { publisher_id: 'local-owner', ingest_id: 'fixture', created_at: '2026-08-20T11:50:00.000Z' }
  };
  const manifest = await buildImportManifest(path.join(source, 'skill-a'), manifestOptions);
  assert.equal(manifest.importable, true);
  const parityReceipt = await issueImportParityReceipt({
    accountId: `acct_${'a'.repeat(32)}`,
    deviceId: `dev_${'b'.repeat(32)}`,
    source: {
      sourceObjectId: `lso_${'c'.repeat(32)}`, rootId: SOURCE_ROOT_ID,
      relativePath: 'skill-a', skillDir: path.join(source, 'skill-a'), manifestOptions
    },
    cloud: {
      manifestDigest: manifest.manifestDigest,
      contentDigest: `sha256:${'1'.repeat(64)}`,
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
  const authorization = bindQuarantineAuthorization({
    parityReceipt,
    preflight,
    idempotencyKey: 'idem-0123456789abcdef',
    principalId: 'principal-1',
    replayNonce: 'replay-1',
    now: new Date('2026-08-20T12:00:00.000Z')
  });
  return { root, source, quarantine, receipts, preflight, parityReceipt, authorization, helper };
}

test('quarantine uses native no-replace rename and writes path-free durable receipts', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  const receipt = await executeQuarantine({
    preflight: state.preflight,
    parityReceipt: state.parityReceipt,
    authorization: state.authorization,
    receiptDirectory: state.receipts,
    mover: createMacOSAtomicNoReplaceMover(state.helper),
    now: () => new Date('2026-08-20T12:00:00.000Z')
  });
  assert.equal(receipt.status, 'MOVE_OBSERVED');
  assert.equal(receipt.restoreExpiresAt, '2026-09-19T12:00:00.000Z');
  await assert.rejects(access(path.join(state.source, 'skill-a')));
  assert.equal(await readFile(path.join(state.preflight.destinationPath, 'SKILL.md'), 'utf8'), SKILL_CONTENT);
  const persisted = await readFile(path.join(state.receipts, `${state.authorization.operationId}.quarantine-receipt.json`), 'utf8');
  assert.equal(persisted.includes(state.root), false);
  assert.equal(persisted.includes('/private/'), false);

  const replay = await executeQuarantine({
    preflight: state.preflight,
    parityReceipt: state.parityReceipt,
    authorization: state.authorization,
    receiptDirectory: state.receipts,
    mover: createMacOSAtomicNoReplaceMover(state.helper),
    now: () => new Date('2026-08-20T12:01:00.000Z')
  });
  assert.deepEqual(replay, receipt);
});

test('destination race never overwrites the occupying entry', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  await mkdir(path.dirname(state.preflight.destinationPath), { recursive: true });
  await writeFile(state.preflight.destinationPath, 'occupant', 'utf8');
  const outcome = await executeQuarantine({
    preflight: state.preflight,
    parityReceipt: state.parityReceipt,
    authorization: state.authorization,
    receiptDirectory: state.receipts,
    mover: createMacOSAtomicNoReplaceMover(state.helper),
    now: () => new Date('2026-08-20T12:00:00.000Z')
  });
  assert.equal(outcome.code, 'OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED');
  assert.equal(await readFile(state.preflight.destinationPath, 'utf8'), 'occupant');
  assert.equal(await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8'), SKILL_CONTENT);
});

test('tampered or expired parity authority is rejected before mutation', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  await assert.rejects(executeQuarantine({
    preflight: state.preflight,
    parityReceipt: { ...state.parityReceipt, contentDigest: `sha256:${'9'.repeat(64)}` },
    authorization: state.authorization,
    receiptDirectory: state.receipts,
    mover: createMacOSAtomicNoReplaceMover(state.helper),
    now: () => new Date('2026-08-20T12:00:00.000Z')
  }), /Parity receipt/i);
  assert.equal(await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8'), SKILL_CONTENT);

  await assert.rejects(executeQuarantine({
    preflight: state.preflight,
    parityReceipt: state.parityReceipt,
    authorization: state.authorization,
    receiptDirectory: state.receipts,
    mover: createMacOSAtomicNoReplaceMover(state.helper),
    now: () => new Date(state.parityReceipt.expiresAt)
  }), /expired/i);
  assert.equal(await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8'), SKILL_CONTENT);
});

test('a replaced quarantine root is rejected before destination creation or move', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  await rename(state.quarantine, `${state.quarantine}-original`);
  await mkdir(state.quarantine);
  let moveCalls = 0;

  await assert.rejects(executeQuarantine({
    preflight: state.preflight,
    parityReceipt: state.parityReceipt,
    authorization: state.authorization,
    receiptDirectory: state.receipts,
    mover: { async move() { moveCalls += 1; } },
    now: () => new Date('2026-08-20T12:00:00.000Z')
  }), /ROOT_CAPABILITY_STALE/);

  assert.equal(moveCalls, 0);
  assert.deepEqual(await readdir(state.quarantine), []);
  assert.equal(await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8'), SKILL_CONTENT);
});

test('native mover rejects a source-root replacement after caller revalidation', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  const realMover = createMacOSAtomicNoReplaceMover(state.helper);
  const originalSource = `${state.source}-original`;

  await assert.rejects(executeQuarantine({
    preflight: state.preflight,
    parityReceipt: state.parityReceipt,
    authorization: state.authorization,
    receiptDirectory: state.receipts,
    mover: {
      async move(sourcePath, destinationPath, binding) {
        await rename(state.source, originalSource);
        await mkdir(path.join(state.source, 'skill-a'), { recursive: true });
        await writeFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'replacement', 'utf8');
        await realMover.move(sourcePath, destinationPath, binding);
      }
    },
    now: () => new Date('2026-08-20T12:00:00.000Z')
  }), /ROOT_CAPABILITY_STALE/);

  assert.equal(await readFile(path.join(originalSource, 'skill-a', 'SKILL.md'), 'utf8'), SKILL_CONTENT);
  assert.equal(await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8'), 'replacement');
});

test('native mover rejects a quarantine-root replacement after caller revalidation', { skip: process.platform !== 'darwin' }, async (t) => {
  const state = await setup(t);
  const realMover = createMacOSAtomicNoReplaceMover(state.helper);
  const originalQuarantine = `${state.quarantine}-original`;

  await assert.rejects(executeQuarantine({
    preflight: state.preflight,
    parityReceipt: state.parityReceipt,
    authorization: state.authorization,
    receiptDirectory: state.receipts,
    mover: {
      async move(sourcePath, destinationPath, binding) {
        await rename(state.quarantine, originalQuarantine);
        await mkdir(state.quarantine);
        await realMover.move(sourcePath, destinationPath, binding);
      }
    },
    now: () => new Date('2026-08-20T12:00:00.000Z')
  }), /ROOT_CAPABILITY_STALE/);

  assert.equal(await readFile(path.join(state.source, 'skill-a', 'SKILL.md'), 'utf8'), SKILL_CONTENT);
  assert.deepEqual(await readdir(state.quarantine), []);
});
