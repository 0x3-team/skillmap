import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { bindQuarantineAuthorization } from '../dist/core/quarantine-authorization.js';
import {
  createMacOSAtomicNoReplaceMover,
  executeQuarantine
} from '../dist/core/quarantine-execution.js';
import { establishRootCapability, preflightQuarantine } from '../dist/core/quarantine-preflight.js';
import { executeRestore } from '../dist/core/quarantine-restore.js';
import { ImportClientError } from '../dist/network/import-client.js';
import { runManagedImport } from '../dist/services/managed-import-use-case.js';

const NOW = new Date('2026-08-20T12:00:00.000Z');
const SOURCE_ROOT_ID = '00000000-0000-4000-8000-000000000050';
const QUARANTINE_ROOT_ID = '00000000-0000-4000-8000-000000000060';
const ACCOUNT_ID = `acct_${'a'.repeat(32)}`;
const DEVICE_ID = `dev_${'b'.repeat(32)}`;
const SOURCE_OBJECT_ID = `lso_${'c'.repeat(32)}`;
const VERSION_ID = `msv_${'e'.repeat(32)}`;
const SESSION_ID = `imp_${'1'.repeat(32)}`;
const SKILL_A = '---\nname: Alpha\ndescription: Disposable recovery fixture.\n---\n# Alpha\n';

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} failed (${code}): ${stderr}`)));
  });
}

async function snapshotTree(root) {
  const entries = [];
  async function visit(directory, prefix = '') {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        entries.push(`d:${relativePath}`);
        await visit(absolutePath, relativePath);
      } else {
        const digest = createHash('sha256').update(await readFile(absolutePath)).digest('hex');
        entries.push(`f:${relativePath}:${digest}`);
      }
    }
  }
  await visit(root);
  return entries;
}

function createDisposableCloud() {
  let consented = false;
  let preparedFiles = [];
  let receipts = [];
  let revision = 1;
  const operations = [];
  const client = {
    async prepareImportTarget(input) {
      operations.push('prepare');
      preparedFiles = input.files.map((file, ordinal) => ({
        filePublicId: `msf_${String(ordinal + 1).padStart(32, '0')}`,
        relativePath: file.relativePath,
        mediaType: file.mediaType,
        byteSize: file.byteSize,
        fileDigest: file.fileDigest,
        storageKey: `v1/${VERSION_ID}/${ordinal + 1}`,
        executable: file.executable,
        ordinal
      }));
      return {
        skillPublicId: `msk_${'d'.repeat(32)}`,
        versionPublicId: VERSION_ID,
        releasePublicId: `msr_${'f'.repeat(32)}`,
        manifestDigest: input.manifestDigest,
        contentDigest: input.contentDigest,
        fileCount: preparedFiles.length,
        byteTotal: preparedFiles.reduce((sum, file) => sum + file.byteSize, 0),
        reused: receipts.length > 0,
        files: preparedFiles
      };
    },
    async beginImportSession(input) {
      operations.push('begin');
      return {
        sessionPublicId: SESSION_ID,
        state: 'in_progress',
        expectedFileCount: input.expectedFileCount,
        expectedByteTotal: input.expectedByteTotal,
        acceptedFileCount: receipts.length,
        acceptedByteTotal: receipts.reduce((sum, receipt) => sum + receipt.acceptedByteSize, 0),
        manifestDigest: input.manifestDigest,
        contentDigest: input.contentDigest,
        revision,
        expiresAt: input.expiresAt
      };
    },
    async listReceipts() {
      operations.push('receipts');
      return { sessionPublicId: SESSION_ID, receipts: structuredClone(receipts) };
    },
    async finalizeImportSession() {
      operations.push('finalize');
      if (!consented) throw new ImportClientError(409, 'owner_consent_required');
      revision += 1;
      return {
        sessionPublicId: SESSION_ID,
        state: 'verified',
        verificationDigest: `sha256:${'2'.repeat(64)}`,
        versionPublicId: VERSION_ID,
        finalizedRevision: revision,
        ownerConsentId: `icn_${'3'.repeat(32)}`,
        consentDigest: `sha256:${'4'.repeat(64)}`,
        explicitConsentAt: '2026-08-20T11:59:00.000Z',
        consentExpiresAt: '2026-08-20T12:10:00.000Z',
        cutoverAuthorityId: `cut_${'5'.repeat(32)}`
      };
    }
  };
  const uploader = {
    async uploadFiles({ session, files }) {
      operations.push('upload');
      receipts = files.map((file, ordinal) => ({
        filePublicId: file.filePublicId,
        relativePath: file.relativePath,
        acceptedByteSize: file.byteSize,
        fileDigest: file.digest,
        ordinal
      }));
      revision += 1;
      const acceptedByteTotal = receipts.reduce((sum, receipt) => sum + receipt.acceptedByteSize, 0);
      return {
        session: {
          ...session,
          acceptedFileCount: receipts.length,
          acceptedByteTotal,
          revision
        },
        uploaded: files,
        skipped: [],
        conflicts: [],
        failed: [],
        progress: {
          acceptedFileCount: receipts.length,
          acceptedByteTotal,
          expectedFileCount: files.length,
          expectedByteTotal: acceptedByteTotal,
          percentComplete: 100
        }
      };
    }
  };
  return {
    client,
    uploader,
    operations,
    consent() { consented = true; },
    reset() { preparedFiles = []; receipts = []; operations.length = 0; revision = 1; },
    get retainedObjectCount() { return preparedFiles.length + receipts.length; }
  };
}

function hostedRestoreAuthority(authorization, overrides = {}) {
  const base = {
    kind: 'skillmap.hosted-restore-authority',
    schemaVersion: 1,
    state: 'RESTORE_AUTHORIZED',
    authorizationId: authorization.currentHostedLifecycleAuthorizationId,
    operationId: authorization.operationId,
    accountId: authorization.accountId,
    deviceId: authorization.deviceId,
    immutableVersionId: authorization.immutableVersionId,
    contentDigest: authorization.contentDigest,
    previewDigest: authorization.previewDigest,
    ownerConsentId: authorization.ownerConsentId,
    consentDigest: authorization.consentDigest,
    parityReceiptId: authorization.parityReceiptId,
    cutoverAuthorityId: authorization.cutoverAuthorityId,
    quarantineReceiptId: authorization.quarantineReceiptId,
    principalId: authorization.principalId,
    replayNonce: authorization.replayNonce,
    issuedAt: '2026-08-20T12:01:00.000Z',
    expiresAt: '2026-08-20T12:10:00.000Z',
    ...overrides
  };
  return { ...base, receiptDigest: digest(base) };
}

test('M4.16 disposable flow imports, quarantines, restores, and cleans exact state', { skip: process.platform !== 'darwin' }, async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'skillmap-m4-disposable-'));
  const source = path.join(fixtureRoot, 'source');
  const quarantine = path.join(fixtureRoot, 'quarantine');
  const receiptDirectory = path.join(fixtureRoot, 'receipts');
  const cloud = createDisposableCloud();
  try {
    await mkdir(path.join(source, 'alpha'), { recursive: true });
    await mkdir(path.join(source, 'untouched'), { recursive: true });
    await mkdir(quarantine);
    await mkdir(receiptDirectory);
    await writeFile(path.join(source, 'alpha', 'SKILL.md'), SKILL_A, 'utf8');
    await writeFile(path.join(source, 'alpha', 'references.txt'), 'alpha reference\n', 'utf8');
    await writeFile(path.join(source, 'untouched', 'SKILL.md'), '---\nname: Untouched\ndescription: Must not change.\n---\n', 'utf8');
    await writeFile(path.join(source, 'root-sentinel.txt'), 'must not change\n', 'utf8');
    const initialSource = await snapshotTree(source);

    const request = {
      skillDir: path.join(source, 'alpha'),
      sourceObjectId: SOURCE_OBJECT_ID,
      rootId: SOURCE_ROOT_ID,
      relativePath: 'alpha',
      sessionStartedAt: NOW.toISOString(),
      manifestOptions: {
        rootRecord: {
          rootId: SOURCE_ROOT_ID,
          configuredPath: source,
          realPath: source,
          approvedAt: '2026-08-20T11:50:00.000Z'
        },
        publicId: 'owner.alpha',
        logicalId: 'alpha',
        source: { authority: 'managed', kind: 'local', namespace: 'owner', source_id: 'alpha', revision: 'rev-1' },
        provenance: { publisher_id: 'local-owner', ingest_id: 'm4-16-disposable', created_at: NOW.toISOString() }
      }
    };
    const auth = {
      async getAuthStatus() {
        return {
          state: 'authenticated', authenticated: true, accountPublicId: ACCOUNT_ID,
          devicePublicId: DEVICE_ID, scopes: ['device.import']
        };
      },
      async getAccessToken() { return 'T'.repeat(43); }
    };
    const deps = { auth, client: cloud.client, uploader: cloud.uploader, now: () => new Date(NOW) };
    const first = await runManagedImport(request, deps);
    assert.equal(first.state, 'awaiting_owner_consent');
    assert.equal(first.parityReceipt, undefined);

    cloud.consent();
    const verified = await runManagedImport(request, deps);
    assert.equal(verified.state, 'verified');
    assert.equal(verified.parityReceipt.parityState, 'PARITY_CONFIRMED');

    const sourceRoot = await establishRootCapability({
      rootId: SOURCE_ROOT_ID, configuredPath: source, fixtureClass: 'copied_fixture', policyVersion: 'm4-test-v1'
    });
    const quarantineRoot = await establishRootCapability({
      rootId: QUARANTINE_ROOT_ID, configuredPath: quarantine, fixtureClass: 'copied_fixture', policyVersion: 'm4-test-v1'
    });
    const preflight = await preflightQuarantine({
      sourceRoot,
      quarantineRoot,
      candidates: ['alpha'],
      operationId: 'm4-16-disposable-quarantine',
      reservationNonce: 'm4-16-disposable-nonce',
      dateUtc: '2026-08-20',
      atomicMoveAvailable: true,
      now: new Date('2026-08-20T12:01:00.000Z')
    });
    assert.equal(preflight.ok, true);
    const helper = path.join(fixtureRoot, 'atomic-rename');
    await run('xcrun', ['swiftc', path.resolve('scripts/m4-13-atomic-rename.swift'), '-o', helper]);
    const mover = createMacOSAtomicNoReplaceMover(helper);
    const authorization = bindQuarantineAuthorization({
      parityReceipt: verified.parityReceipt,
      preflight,
      idempotencyKey: 'm4-16-disposable-quarantine-idem',
      principalId: 'm4-16-disposable-principal',
      replayNonce: 'm4-16-disposable-quarantine-replay',
      now: new Date('2026-08-20T12:01:00.000Z')
    });
    const quarantineReceipt = await executeQuarantine({
      preflight,
      parityReceipt: verified.parityReceipt,
      authorization,
      receiptDirectory,
      mover,
      now: () => new Date('2026-08-20T12:01:00.000Z')
    });
    assert.equal(quarantineReceipt.status, 'MOVE_OBSERVED');
    await assert.rejects(access(path.join(source, 'alpha')));
    assert.equal(await readFile(path.join(source, 'untouched', 'SKILL.md'), 'utf8'), '---\nname: Untouched\ndescription: Must not change.\n---\n');

    const restoreAuthorization = {
      action: 'restore',
      operationId: 'm4-16-disposable-restore',
      idempotencyKey: 'm4-16-disposable-restore-idem',
      accountId: verified.parityReceipt.accountId,
      deviceId: verified.parityReceipt.deviceId,
      quarantineReceiptId: quarantineReceipt.receiptId,
      quarantineObjectIdentityDigest: quarantineReceipt.quarantineObjectIdentityDigest,
      quarantineDestinationIdentityDigest: quarantineReceipt.destinationIdentityDigest,
      quarantineRootId: quarantineRoot.rootId,
      escapedQuarantineRelativePath: preflight.reservation.escapedDestinationRelativePath,
      originalRootId: sourceRoot.rootId,
      escapedOriginalRelativePath: preflight.snapshot.escapedRelativePath,
      originalDestinationIdentityDigest: `sha256:${'6'.repeat(64)}`,
      immutableVersionId: verified.parityReceipt.immutableVersionId,
      contentDigest: quarantineReceipt.contentDigest,
      previewDigest: `sha256:${'7'.repeat(64)}`,
      ownerConsentId: verified.parityReceipt.ownerConsentId,
      consentDigest: verified.parityReceipt.consentDigest,
      parityReceiptId: verified.parityReceipt.receiptId,
      cutoverAuthorityId: verified.parityReceipt.cutoverAuthorityId,
      currentHostedLifecycleAuthorizationId: 'm4-16-disposable-lifecycle',
      quarantinedAt: quarantineReceipt.quarantinedAt,
      restoreExpiresAt: quarantineReceipt.restoreExpiresAt,
      principalId: 'm4-16-disposable-principal',
      policyRevision: 'm4-test-v1',
      replayNonce: 'm4-16-disposable-restore-replay'
    };
    const restoreReceipt = await executeRestore({
      quarantineReceipt,
      authorization: restoreAuthorization,
      quarantineRoot,
      quarantinePath: preflight.destinationPath,
      originalRoot: sourceRoot,
      originalCandidates: ['alpha'],
      receiptDirectory,
      mover,
      authorityProvider: {
        async loadCurrentRestoreAuthority() {
          return hostedRestoreAuthority(restoreAuthorization);
        }
      },
      now: () => new Date('2026-08-20T12:02:00.000Z')
    });
    assert.equal(restoreReceipt.status, 'RESTORE_OBSERVED');
    assert.deepEqual(await snapshotTree(source), initialSource);
    assert.ok(cloud.retainedObjectCount > 0);
  } finally {
    cloud.reset();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
  assert.equal(cloud.retainedObjectCount, 0);
  await assert.rejects(access(fixtureRoot));
});
