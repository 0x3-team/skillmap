import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ImportClientError } from '../dist/network/import-client.js';
import { encodeContentDigest } from '../dist/core/immutable-content-digest.js';
import { runManagedImport } from '../dist/services/managed-import-use-case.js';

const NOW = new Date('2026-08-20T12:00:00.000Z');
const ROOT_ID = '00000000-0000-4000-8000-000000000000';
const ACCOUNT_ID = `acct_${'a'.repeat(32)}`;
const DEVICE_ID = `dev_${'b'.repeat(32)}`;
const SOURCE_OBJECT_ID = `lso_${'c'.repeat(32)}`;
const SKILL_ID = `msk_${'d'.repeat(32)}`;
const VERSION_ID = `msv_${'e'.repeat(32)}`;
const RELEASE_ID = `msr_${'f'.repeat(32)}`;
const SESSION_ID = `imp_${'1'.repeat(32)}`;
const ACCESS_TOKEN = 'T'.repeat(43);

async function fixture(t, files = { 'SKILL.md': '---\nname: Alpha\ndescription: Alpha fixture.\n---\nBody\n', 'references/guide.txt': 'guide\n' }) {
  const root = await mkdtemp(path.join(tmpdir(), 'skillmap-m4-use-case-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillDir = path.join(root, 'alpha');
  for (const [relativePath, body] of Object.entries(files)) {
    const absolutePath = path.join(skillDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, body, 'utf8');
  }
  return {
    root,
    skillDir,
    request: {
      skillDir,
      sourceObjectId: SOURCE_OBJECT_ID,
      rootId: ROOT_ID,
      relativePath: 'alpha',
      manifestOptions: {
        rootRecord: { rootId: ROOT_ID, configuredPath: root, realPath: root, approvedAt: NOW.toISOString() },
        publicId: 'owner.alpha',
        logicalId: 'alpha',
        source: { authority: 'managed', kind: 'local', namespace: 'owner', source_id: 'alpha', revision: 'rev-1' },
        provenance: { publisher_id: 'local-owner', ingest_id: 'm4-16', created_at: NOW.toISOString() }
      }
    }
  };
}

function makeCloud({ consented = false } = {}) {
  const calls = [];
  let prepared;
  let session = {
    sessionPublicId: SESSION_ID,
    state: 'in_progress',
    expectedFileCount: 0,
    expectedByteTotal: 0,
    acceptedFileCount: 0,
    acceptedByteTotal: 0,
    revision: 1,
    expiresAt: '2026-08-20T18:00:00.000Z'
  };
  let receipts = [];
  const client = {
    async prepareImportTarget(input) {
      calls.push(['prepare', input]);
      prepared = {
        skillPublicId: SKILL_ID,
        versionPublicId: VERSION_ID,
        releasePublicId: RELEASE_ID,
        manifestDigest: input.manifestDigest,
        contentDigest: input.contentDigest,
        fileCount: input.files.length,
        byteTotal: input.files.reduce((sum, file) => sum + file.byteSize, 0),
        reused: false,
        files: input.files.map((file, ordinal) => ({
          filePublicId: `msf_${String(ordinal + 1).padStart(32, '0')}`,
          relativePath: file.relativePath,
          mediaType: file.mediaType,
          byteSize: file.byteSize,
          fileDigest: file.fileDigest,
          storageKey: `v1/${VERSION_ID}/msf_${String(ordinal + 1).padStart(32, '0')}`,
          executable: file.executable,
          ordinal
        }))
      };
      return prepared;
    },
    async beginImportSession(input) {
      calls.push(['begin', input]);
      session = {
        ...session,
        expectedFileCount: input.expectedFileCount,
        expectedByteTotal: input.expectedByteTotal,
        manifestDigest: input.manifestDigest,
        contentDigest: input.contentDigest
      };
      return { ...session };
    },
    async finalizeImportSession(input) {
      calls.push(['finalize', input]);
      if (!consented) throw new ImportClientError(409, 'owner_consent_required');
      session = { ...session, state: 'verified', revision: session.revision + 1 };
      return {
        sessionPublicId: SESSION_ID,
        state: 'verified',
        verificationDigest: `sha256:${'2'.repeat(64)}`,
        versionPublicId: VERSION_ID,
        finalizedRevision: session.revision,
        ownerConsentId: `icn_${'3'.repeat(32)}`,
        consentDigest: `sha256:${'4'.repeat(64)}`,
        explicitConsentAt: '2026-08-20T11:59:00.000Z',
        consentExpiresAt: '2026-08-20T12:10:00.000Z',
        cutoverAuthorityId: `cut_${'5'.repeat(32)}`
      };
    },
    async listReceipts() {
      calls.push(['receipts']);
      return { sessionPublicId: SESSION_ID, receipts: receipts.map((receipt) => ({ ...receipt })) };
    }
  };
  const uploader = {
    async uploadFiles({ session: inputSession, files }) {
      calls.push(['upload', files]);
      receipts = files.map((file, ordinal) => ({
        filePublicId: file.filePublicId,
        relativePath: file.relativePath,
        acceptedByteSize: file.byteSize,
        fileDigest: file.digest,
        ordinal
      }));
      session = {
        ...inputSession,
        acceptedFileCount: files.length,
        acceptedByteTotal: files.reduce((sum, file) => sum + file.byteSize, 0),
        revision: inputSession.revision + files.length
      };
      return {
        session: { ...session },
        uploaded: files,
        skipped: [],
        conflicts: [],
        failed: [],
        progress: {
          acceptedFileCount: session.acceptedFileCount,
          acceptedByteTotal: session.acceptedByteTotal,
          expectedFileCount: session.expectedFileCount,
          expectedByteTotal: session.expectedByteTotal,
          percentComplete: 100
        }
      };
    }
  };
  return { calls, client, uploader, setConsented(value) { consented = value; } };
}

function auth() {
  return {
    async getAuthStatus() {
      return { state: 'authenticated', authenticated: true, accountPublicId: ACCOUNT_ID, devicePublicId: DEVICE_ID, scopes: ['device.import'] };
    },
    async getAccessToken() { return ACCESS_TOKEN; }
  };
}

test('M4.16 managed import pauses for owner consent, then resumes to an exact parity receipt', async (t) => {
  const state = await fixture(t);
  const cloud = makeCloud();
  const deps = { auth: auth(), client: cloud.client, uploader: cloud.uploader, now: () => new Date(NOW) };

  const first = await runManagedImport(state.request, deps);
  assert.equal(first.state, 'awaiting_owner_consent');
  assert.equal(first.sessionPublicId, SESSION_ID);
  assert.equal(first.acceptedFileCount, 2);
  assert.equal(first.parityReceipt, undefined);
  assert.deepEqual(cloud.calls.map(([name]) => name), ['prepare', 'begin', 'receipts', 'upload', 'finalize']);
  const prepareInput = cloud.calls.find(([name]) => name === 'prepare')[1];
  const expectedContent = encodeContentDigest(
    Buffer.from(prepareInput.canonicalManifestBytes),
    prepareInput.manifestDigest,
    await Promise.all(prepareInput.files.map(async (file) => ({
      path: file.relativePath,
      bytes: await readFile(path.join(state.skillDir, file.relativePath)),
      size: file.byteSize,
      digest: file.fileDigest
    })))
  );
  assert.equal(prepareInput.contentDigest, expectedContent.contentDigest);
  assert.deepEqual(prepareInput.canonicalMetadata, {
    logical_id: 'alpha',
    display_name: 'Alpha',
    description: 'Alpha fixture.'
  });
  assert.match(prepareInput.idempotencyKey, /^[A-Za-z0-9_-]{22}$/);
  assert.match(cloud.calls.find(([name]) => name === 'begin')[1].idempotencyKey, /^[A-Za-z0-9_-]{22}$/);

  cloud.calls.length = 0;
  cloud.setConsented(true);
  const second = await runManagedImport(state.request, deps);
  assert.equal(second.state, 'verified');
  assert.equal(second.parityReceipt.parityState, 'PARITY_CONFIRMED');
  assert.equal(second.parityReceipt.cutoverState, 'CUTOVER_AUTHORIZED');
  assert.equal(second.parityReceipt.eligibleCandidates[0].sourceObjectId, SOURCE_OBJECT_ID);
  assert.equal(JSON.stringify(second).includes(state.root), false);
  assert.equal(JSON.stringify(second).includes(state.skillDir), false);
  assert.deepEqual(cloud.calls.map(([name]) => name), ['prepare', 'begin', 'receipts', 'upload', 'finalize', 'receipts']);
});

test('M4.16 blocked content stops before auth or network', async (t) => {
  const state = await fixture(t, {
    'SKILL.md': '---\nname: Blocked\ndescription: Blocked fixture.\n---\nBody\n',
    '.env': 'TOKEN=synthetic-only\n'
  });
  const cloud = makeCloud();
  let authCalls = 0;
  const result = await runManagedImport(state.request, {
    auth: {
      async getAuthStatus() { authCalls += 1; throw new Error('must not authenticate'); },
      async getAccessToken() { authCalls += 1; throw new Error('must not authenticate'); }
    },
    client: cloud.client,
    uploader: cloud.uploader,
    now: () => new Date(NOW)
  });
  assert.equal(result.state, 'blocked');
  assert.equal(result.blockedItems.some((item) => item.reason === 'IMPORT_SECRET_BLOCKED'), true);
  assert.equal(authCalls, 0);
  assert.equal(cloud.calls.length, 0);
  assert.equal(JSON.stringify(result).includes(state.root), false);
});

test('M4.16 post-upload local change blocks parity after consent', async (t) => {
  const state = await fixture(t);
  const cloud = makeCloud();
  const deps = { auth: auth(), client: cloud.client, uploader: cloud.uploader, now: () => new Date(NOW) };
  await runManagedImport(state.request, deps);
  await writeFile(path.join(state.skillDir, 'references', 'guide.txt'), 'changed\n', 'utf8');
  cloud.setConsented(true);
  await assert.rejects(
    runManagedImport(state.request, deps),
    (error) => error && (error.code === 'PARITY_MISMATCH' || error.code === 'IMPORT_SOURCE_CHANGED')
  );
});

test('M4.16 samples the live clock immediately before issuing the parity receipt', async (t) => {
  const state = await fixture(t);
  const cloud = makeCloud({ consented: true });
  const samples = [new Date(NOW), new Date(NOW.getTime() + 60_000)];
  const deps = {
    auth: auth(),
    client: cloud.client,
    uploader: cloud.uploader,
    now: () => samples.shift() ?? new Date(NOW.getTime() + 60_000)
  };
  const result = await runManagedImport(state.request, deps);
  assert.equal(result.parityReceipt.issuedAt, '2026-08-20T12:01:00.000Z');
});

test('M4.16 authentication failures are not mislabeled as owner consent', async (t) => {
  const state = await fixture(t);
  const cloud = makeCloud({ consented: true });
  cloud.client.finalizeImportSession = async () => {
    throw new ImportClientError(401, 'unauthorized');
  };
  await assert.rejects(
    runManagedImport(state.request, { auth: auth(), client: cloud.client, uploader: cloud.uploader, now: () => new Date(NOW) }),
    (error) => error instanceof ImportClientError && error.code === 'unauthorized'
  );
});

test('M4.16 incomplete upload fails closed before finalization', async (t) => {
  const state = await fixture(t);
  const cloud = makeCloud({ consented: true });
  const incompleteUploader = {
    async uploadFiles({ session, files }) {
      return {
        session,
        uploaded: [],
        skipped: [],
        conflicts: [],
        failed: [{ file: files[0] }],
        progress: {
          acceptedFileCount: 0,
          acceptedByteTotal: 0,
          expectedFileCount: files.length,
          expectedByteTotal: files.reduce((sum, file) => sum + file.byteSize, 0),
          percentComplete: 0
        }
      };
    }
  };
  await assert.rejects(
    runManagedImport(state.request, { auth: auth(), client: cloud.client, uploader: incompleteUploader, now: () => new Date(NOW) }),
    (error) => error?.code === 'IMPORT_UPLOAD_INCOMPLETE'
  );
  assert.equal(cloud.calls.some(([name]) => name === 'finalize'), false);
});

test('M4.16 retries a verified terminal session without uploading again', async (t) => {
  const state = await fixture(t);
  const cloud = makeCloud({ consented: true });
  const originalListReceipts = cloud.client.listReceipts;
  let failAfterFinalize = true;
  cloud.client.listReceipts = async (...args) => {
    const response = await originalListReceipts(...args);
    if (failAfterFinalize && cloud.calls.some(([name]) => name === 'finalize')) {
      failAfterFinalize = false;
      throw new ImportClientError(503, 'temporarily_unavailable');
    }
    return response;
  };
  const deps = { auth: auth(), client: cloud.client, uploader: cloud.uploader, now: () => new Date(NOW) };

  await assert.rejects(
    runManagedImport(state.request, deps),
    (error) => error instanceof ImportClientError && error.code === 'temporarily_unavailable'
  );
  const originalBegin = cloud.calls.find(([name]) => name === 'begin')[1];
  const finalizedRevision = 4;
  cloud.client.beginImportSession = async (input) => {
    cloud.calls.push(['begin', input]);
    return {
      sessionPublicId: SESSION_ID,
      state: 'verified',
      expectedFileCount: originalBegin.expectedFileCount,
      expectedByteTotal: originalBegin.expectedByteTotal,
      acceptedFileCount: originalBegin.expectedFileCount,
      acceptedByteTotal: originalBegin.expectedByteTotal,
      revision: finalizedRevision,
      expiresAt: '2026-08-20T18:00:00.000Z',
      manifestDigest: input.manifestDigest,
      contentDigest: input.contentDigest,
      verificationDigest: `sha256:${'2'.repeat(64)}`,
      finalizationExpectedRevision: finalizedRevision - 1
    };
  };
  const callsBeforeRetry = cloud.calls.length;
  const recovered = await runManagedImport(state.request, deps);
  const retryCalls = cloud.calls.slice(callsBeforeRetry);

  assert.equal(recovered.state, 'verified');
  assert.equal(recovered.parityReceipt.parityState, 'PARITY_CONFIRMED');
  assert.equal(retryCalls.some(([name]) => name === 'upload'), false);
  const replay = retryCalls.find(([name]) => name === 'finalize');
  assert.equal(replay[1].expectedRevision, finalizedRevision - 1);
});

test('M4.16 rejects verified-session recovery when a bound digest is missing', async (t) => {
  for (const missingField of ['manifestDigest', 'contentDigest']) {
    const state = await fixture(t);
    const cloud = makeCloud({ consented: true });
    const originalBegin = cloud.client.beginImportSession;
    cloud.client.beginImportSession = async (input) => {
      const started = await originalBegin(input);
      const verified = {
        ...started,
        state: 'verified',
        revision: 2,
        acceptedFileCount: started.expectedFileCount,
        acceptedByteTotal: started.expectedByteTotal,
        finalizationExpectedRevision: 1
      };
      delete verified[missingField];
      return verified;
    };

    await assert.rejects(
      runManagedImport(state.request, {
        auth: auth(),
        client: cloud.client,
        uploader: cloud.uploader,
        now: () => new Date(NOW)
      }),
      (error) => error instanceof ImportClientError && error.code === 'invalid_response',
      missingField
    );
    assert.equal(cloud.calls.some(([name]) => name === 'upload'), false);
  }
});
