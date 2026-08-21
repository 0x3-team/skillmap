import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildImportManifest } from '../dist/core/import-manifest-builder.js';
import { ImportParityError, issueImportParityReceipt } from '../dist/core/import-parity.js';

const ACCOUNT_ID = `acct_${'a'.repeat(32)}`;
const DEVICE_ID = `dev_${'b'.repeat(32)}`;
const SESSION_ID = `imp_${'c'.repeat(32)}`;
const VERSION_ID = `msv_${'d'.repeat(32)}`;
const SOURCE_OBJECT_ID = `lso_${'e'.repeat(32)}`;
const ROOT_UUID = '00000000-0000-4000-8000-000000000000';
const CONTENT_DIGEST = `sha256:${'7'.repeat(64)}`;
const VERIFICATION_DIGEST = `sha256:${'8'.repeat(64)}`;
const NOW = new Date('2026-08-20T12:00:00.000Z');

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'skillmap-m4-parity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillDir = path.join(root, 'alpha');
  await mkdir(path.join(skillDir, 'references'), { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: Alpha\ndescription: Alpha fixture.\n---\nBody\n', 'utf8');
  await writeFile(path.join(skillDir, 'references', 'guide.txt'), 'guide\n', 'utf8');
  const manifestOptions = {
    rootRecord: { rootId: ROOT_UUID, configuredPath: root, realPath: root, approvedAt: NOW.toISOString() },
    publicId: 'pub_alpha_01',
    logicalId: 'alpha',
    source: { authority: 'managed', kind: 'local', namespace: 'owner', source_id: 'alpha', revision: 'rev-1' },
    provenance: { publisher_id: 'local-owner', ingest_id: 'ingest-1', created_at: NOW.toISOString() }
  };
  const initial = await buildImportManifest(skillDir, manifestOptions);
  assert.equal(initial.importable, true);
  const receipts = initial.files.map((file, ordinal) => ({
    filePublicId: `msf_${String(ordinal + 1).padStart(32, '0')}`,
    relativePath: file.path,
    acceptedByteSize: file.utf8_bytes,
    fileDigest: file.digest,
    ordinal
  }));
  const finalized = {
    sessionPublicId: SESSION_ID,
    state: 'verified',
    verificationDigest: VERIFICATION_DIGEST,
    versionPublicId: VERSION_ID,
    finalizedRevision: 4,
    ownerConsentId: `icn_${'1'.repeat(32)}`,
    consentDigest: `sha256:${'2'.repeat(64)}`,
    explicitConsentAt: '2026-08-20T11:55:00.000Z',
    consentExpiresAt: '2026-08-20T12:10:00.000Z',
    cutoverAuthorityId: `cut_${'3'.repeat(32)}`
  };
  const input = {
    accountId: ACCOUNT_ID,
    deviceId: DEVICE_ID,
    source: { sourceObjectId: SOURCE_OBJECT_ID, rootId: 'approved-root-alpha', relativePath: 'alpha', skillDir, manifestOptions },
    cloud: { manifestDigest: initial.manifestDigest, contentDigest: CONTENT_DIGEST, receipts, finalized },
    now: NOW
  };
  return { root, skillDir, input };
}

test('M4.11 issues one deterministic short-lived receipt only at exact parity', async (t) => {
  const state = await fixture(t);
  const first = await issueImportParityReceipt(state.input);
  const second = await issueImportParityReceipt(state.input);
  assert.deepEqual(second, first);
  assert.equal(first.parityState, 'PARITY_CONFIRMED');
  assert.equal(first.cutoverState, 'CUTOVER_AUTHORIZED');
  assert.equal(first.fileCount, 2);
  assert.equal(first.eligibleCandidates.length, 1);
  assert.equal(first.eligibleCandidates[0].sourceObjectId, SOURCE_OBJECT_ID);
  assert.equal(first.eligibleCandidates[0].relativePath, 'alpha');
  assert.match(first.receiptId, /^par_[0-9a-f]{32}$/);
  assert.match(first.receiptDigest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Date.parse(first.expiresAt) - Date.parse(first.issuedAt) <= 5 * 60_000);
  assert.equal(JSON.stringify(first).includes(state.root), false);
  assert.equal(JSON.stringify(first).includes(state.skillDir), false);
});

test('M4.11 changed-after-upload content blocks cutover', async (t) => {
  const state = await fixture(t);
  await writeFile(path.join(state.skillDir, 'references', 'guide.txt'), 'changed\n', 'utf8');
  await assert.rejects(
    issueImportParityReceipt(state.input),
    (error) => error instanceof ImportParityError
      && error.code === 'PARITY_MISMATCH'
      && error.mismatch.changedPaths.includes('references/guide.txt')
  );
});

test('M4.11 missing and extra files are reported by safe relative path', async (t) => {
  const missing = await fixture(t);
  await unlink(path.join(missing.skillDir, 'references', 'guide.txt'));
  await assert.rejects(
    issueImportParityReceipt(missing.input),
    (error) => error instanceof ImportParityError
      && error.code === 'PARITY_MISMATCH'
      && error.mismatch.missingPaths.includes('references/guide.txt')
  );

  const extra = await fixture(t);
  await writeFile(path.join(extra.skillDir, 'references', 'extra.txt'), 'extra\n', 'utf8');
  await assert.rejects(
    issueImportParityReceipt(extra.input),
    (error) => error instanceof ImportParityError
      && error.code === 'PARITY_MISMATCH'
      && error.mismatch.extraPaths.includes('references/extra.txt')
  );
});

test('M4.11 requires a complete unexpired consent and cutover binding', async (t) => {
  const state = await fixture(t);
  await assert.rejects(
    issueImportParityReceipt({
      ...state.input,
      cloud: { ...state.input.cloud, finalized: { ...state.input.cloud.finalized, ownerConsentId: undefined } }
    }),
    (error) => error instanceof ImportParityError && error.code === 'CONSENT_REQUIRED'
  );
  await assert.rejects(
    issueImportParityReceipt({
      ...state.input,
      cloud: { ...state.input.cloud, finalized: { ...state.input.cloud.finalized, consentExpiresAt: NOW.toISOString() } }
    }),
    (error) => error instanceof ImportParityError && error.code === 'CONSENT_EXPIRED'
  );
});

test('M4.11 rejects non-contiguous or duplicate cloud receipt authority', async (t) => {
  const state = await fixture(t);
  const bad = state.input.cloud.receipts.map((receipt) => ({ ...receipt }));
  bad[1].ordinal = 7;
  await assert.rejects(
    issueImportParityReceipt({ ...state.input, cloud: { ...state.input.cloud, receipts: bad } }),
    (error) => error instanceof ImportParityError && error.code === 'INVALID_PARITY_INPUT'
  );
});
