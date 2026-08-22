import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

import { LOCAL_QUARANTINE_OUTCOMES, type LocalQuarantineOutcomeV1 } from '../contracts/local-quarantine-registry.js';
import { validateQuarantineMutationReceipt } from './quarantine-execution.js';
import { assertSameVolume } from './quarantine-preflight.js';
import { assertRestoreWindowOpen } from './quarantine-retention.js';
import { computeQuarantineTreeDigest } from './quarantine-tree-digest.js';
import type {
  AtomicNoReplaceMover,
  HostedRestoreAuthorityProvider,
  HostedRestoreAuthorityReceipt,
  QuarantineMutationReceipt,
  RestoreAuthorization,
  RestoreMutationReceipt,
  RootCapability
} from './quarantine-types.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_RECORD_BYTES = 128 * 1024;
const HOSTED_AUTHORITY_KEYS = [
  'kind',
  'schemaVersion',
  'state',
  'authorizationId',
  'operationId',
  'accountId',
  'deviceId',
  'immutableVersionId',
  'contentDigest',
  'previewDigest',
  'ownerConsentId',
  'consentDigest',
  'parityReceiptId',
  'cutoverAuthorityId',
  'quarantineReceiptId',
  'principalId',
  'replayNonce',
  'issuedAt',
  'expiresAt',
  'receiptDigest'
] as const;

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function errno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function assertTimestamp(value: string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(`${label} is invalid.`);
  return date;
}

export function validateHostedRestoreAuthorityReceipt(value: unknown): HostedRestoreAuthorityReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('HOSTED_RESTORE_AUTHORITY_INVALID');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== HOSTED_AUTHORITY_KEYS.length
    || !HOSTED_AUTHORITY_KEYS.every((key) => keys.includes(key))) {
    throw new Error('HOSTED_RESTORE_AUTHORITY_INVALID');
  }
  const digestFields = [
    record.contentDigest,
    record.previewDigest,
    record.consentDigest,
    record.receiptDigest
  ];
  const labelFields = [
    record.authorizationId,
    record.operationId,
    record.accountId,
    record.deviceId,
    record.immutableVersionId,
    record.ownerConsentId,
    record.parityReceiptId,
    record.cutoverAuthorityId,
    record.quarantineReceiptId,
    record.principalId,
    record.replayNonce
  ];
  if (record.kind !== 'skillmap.hosted-restore-authority'
    || record.schemaVersion !== 1
    || record.state !== 'RESTORE_AUTHORIZED'
    || labelFields.some((field) => typeof field !== 'string' || (!SAFE_ID.test(field) && !DIGEST.test(field)))
    || digestFields.some((field) => typeof field !== 'string' || !DIGEST.test(field))) {
    throw new Error('HOSTED_RESTORE_AUTHORITY_INVALID');
  }
  const issuedAt = assertTimestamp(String(record.issuedAt), 'issuedAt');
  const expiresAt = assertTimestamp(String(record.expiresAt), 'expiresAt');
  const { receiptDigest, ...base } = record;
  if (issuedAt.getTime() >= expiresAt.getTime()
    || receiptDigest !== digest(base)) {
    throw new Error('HOSTED_RESTORE_AUTHORITY_INVALID');
  }
  return record as unknown as HostedRestoreAuthorityReceipt;
}

function assertHostedRestoreAuthority(
  authority: unknown,
  authorization: RestoreAuthorization,
  now: Date
): HostedRestoreAuthorityReceipt {
  const receipt = validateHostedRestoreAuthorityReceipt(authority);
  const issuedAt = assertTimestamp(receipt.issuedAt, 'issuedAt');
  const expiresAt = assertTimestamp(receipt.expiresAt, 'expiresAt');
  if (now.getTime() < issuedAt.getTime() || now.getTime() >= expiresAt.getTime()
    || receipt.authorizationId !== authorization.currentHostedLifecycleAuthorizationId
    || receipt.operationId !== authorization.operationId
    || receipt.accountId !== authorization.accountId
    || receipt.deviceId !== authorization.deviceId
    || receipt.immutableVersionId !== authorization.immutableVersionId
    || receipt.contentDigest !== authorization.contentDigest
    || receipt.previewDigest !== authorization.previewDigest
    || receipt.ownerConsentId !== authorization.ownerConsentId
    || receipt.consentDigest !== authorization.consentDigest
    || receipt.parityReceiptId !== authorization.parityReceiptId
    || receipt.cutoverAuthorityId !== authorization.cutoverAuthorityId
    || receipt.quarantineReceiptId !== authorization.quarantineReceiptId
    || receipt.principalId !== authorization.principalId
    || receipt.replayNonce !== authorization.replayNonce) {
    throw new Error('HOSTED_RESTORE_AUTHORITY_INVALID');
  }
  return receipt;
}

function assertRelativePath(value: string): string[] {
  if (!value || value !== value.normalize('NFC') || path.isAbsolute(value) || value.includes('\\')) {
    throw new Error('Restore target must use one normalized relative path.');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f]/u.test(part))) {
    throw new Error('Restore target contains an unsafe relative component.');
  }
  return parts;
}

function escapeRelativePath(value: string): string {
  return assertRelativePath(value)
    .map((component) => `p-${Buffer.from(component, 'utf8').toString('base64url')}`)
    .join('/');
}

function contained(root: string, candidate: string, allowRoot = false): boolean {
  const relative = path.relative(root, candidate);
  return (allowRoot || Boolean(relative))
    && !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`);
}

async function safeReadRecord(file: string): Promise<Record<string, unknown> | undefined> {
  const before = await lstat(file).catch((error: unknown) => {
    if (errno(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (!before) return undefined;
  if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_RECORD_BYTES) {
    throw new Error('Restore record is unsafe.');
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()) {
      throw new Error('Restore record changed before read.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length > MAX_RECORD_BYTES || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) {
      throw new Error('Restore record changed during read.');
    }
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Restore record is malformed.');
    return parsed as Record<string, unknown>;
  } finally {
    await handle.close();
  }
}

async function assertCapabilityCurrent(capability: RootCapability): Promise<void> {
  const stats = await lstat(capability.configuredPath);
  const resolved = await realpath(capability.configuredPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()
    || stats.dev !== capability.volumeId
    || stats.ino !== capability.rootFileId
    || resolved !== capability.canonicalRootPath) {
    throw new Error('Restore root capability is stale.');
  }
}

async function assertSafeExistingParent(root: RootCapability, relativePath: string): Promise<string> {
  const parts = assertRelativePath(relativePath);
  const leaf = parts.pop()!;
  let current = root.canonicalRootPath;
  for (const component of parts) {
    current = path.join(current, component);
    const stats = await lstat(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Restore parent contains an unsafe entry.');
  }
  const resolvedParent = await realpath(current);
  if (!contained(root.canonicalRootPath, resolvedParent, true)) throw new Error('Restore parent escaped its approved root.');
  return path.join(resolvedParent, leaf);
}

function assertAuthorization(input: {
  authorization: RestoreAuthorization;
  receipt: QuarantineMutationReceipt;
  originalRoot: RootCapability;
  originalRelativePath: string;
  quarantineRoot: RootCapability;
  quarantineRelativePath: string;
}): string {
  const { authorization, receipt } = input;
  if (Object.values(authorization).some((value) => typeof value !== 'string' || value.length === 0)
    || authorization.action !== 'restore'
    || authorization.quarantineReceiptId !== receipt.receiptId
    || authorization.quarantineObjectIdentityDigest !== receipt.quarantineObjectIdentityDigest
    || authorization.quarantineDestinationIdentityDigest !== receipt.destinationIdentityDigest
    || authorization.quarantineRootId !== input.quarantineRoot.rootId
    || authorization.escapedQuarantineRelativePath !== input.quarantineRelativePath
    || authorization.originalRootId !== input.originalRoot.rootId
    || authorization.escapedOriginalRelativePath !== escapeRelativePath(input.originalRelativePath)
    || authorization.contentDigest !== receipt.contentDigest
    || authorization.quarantinedAt !== receipt.quarantinedAt
    || authorization.restoreExpiresAt !== receipt.restoreExpiresAt
    || authorization.policyRevision !== input.originalRoot.policyVersion
    || authorization.policyRevision !== input.quarantineRoot.policyVersion
    || !DIGEST.test(authorization.consentDigest)
    || !DIGEST.test(authorization.previewDigest)
    || !DIGEST.test(authorization.originalDestinationIdentityDigest)) {
    throw new Error('AUTHORIZATION_BINDING_INCOMPLETE');
  }
  return digest({ kind: 'skillmap.restore-authorization.v1', ...authorization });
}

async function observeSafeEntry(root: RootCapability, relativePath: string): Promise<{
  absolutePath: string;
  stats: Awaited<ReturnType<typeof lstat>>;
} | undefined> {
  const parts = assertRelativePath(relativePath);
  let current = root.canonicalRootPath;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]!);
    const stats = await lstat(current).catch((error: unknown) => {
      if (errno(error, 'ENOENT')) return undefined;
      throw error;
    });
    if (!stats) return undefined;
    if (stats.isSymbolicLink()) throw new Error('Restore path contains an unsafe entry.');
    if (index < parts.length - 1 && !stats.isDirectory()) throw new Error('Restore path parent is unsafe.');
    if (index === parts.length - 1) {
      if (!stats.isFile() && !stats.isDirectory()) throw new Error('Restore object is unsafe.');
      const resolved = await realpath(current);
      if (resolved !== current || !contained(root.canonicalRootPath, resolved)) {
        throw new Error('Restore object escaped its approved root.');
      }
      return { absolutePath: current, stats };
    }
  }
  return undefined;
}

function assertQuarantineObjectIdentity(
  stats: Awaited<ReturnType<typeof lstat>>,
  receipt: QuarantineMutationReceipt
): void {
  const observed = digest({
    kind: 'skillmap.quarantine-object-identity.v1',
    sourceObjectId: receipt.sourceObjectId,
    device: stats.dev,
    inode: stats.ino,
    destinationIdentityDigest: receipt.destinationIdentityDigest
  });
  if (observed !== receipt.quarantineObjectIdentityDigest) throw new Error('QUARANTINE_IDENTITY_MISMATCH');
}

async function assertQuarantineTreeIntegrity(
  candidatePath: string,
  receipt: QuarantineMutationReceipt,
  failureCode: 'QUARANTINE_TREE_MISMATCH' | 'RESTORE_OUTCOME_NEEDS_RECONCILIATION'
): Promise<void> {
  // V1 receipts predate descendant-tree binding. Preserve their established
  // restore behavior; only V2 receipts may claim tree-integrity enforcement.
  if (receipt.schemaVersion === 1) return;
  let observed: string;
  try {
    observed = await computeQuarantineTreeDigest(candidatePath);
  } catch (error) {
    throw new Error(failureCode, { cause: error });
  }
  if (observed !== receipt.treeDigest) throw new Error(failureCode);
}

const RESTORE_RECEIPT_KEYS = [
  'kind',
  'schemaVersion',
  'status',
  'receiptId',
  'operationId',
  'authorizationDigest',
  'quarantineReceiptId',
  'quarantineObjectIdentityDigest',
  'originalDestinationIdentityDigest',
  'contentDigest',
  'restoredAt',
  'receiptDigest'
] as const;

function validateRestoreReceipt(
  record: Record<string, unknown>,
  authorization: RestoreAuthorization,
  authorizationDigest: string,
  quarantineReceipt: QuarantineMutationReceipt
): RestoreMutationReceipt {
  const keys = Object.keys(record).sort();
  if (keys.length !== RESTORE_RECEIPT_KEYS.length
    || !RESTORE_RECEIPT_KEYS.every((key) => keys.includes(key))) {
    throw new Error('Restore receipt is malformed.');
  }
  if (record.kind !== 'skillmap.local-restore-receipt'
    || record.schemaVersion !== 1
    || record.status !== 'RESTORE_OBSERVED'
    || record.operationId !== authorization.operationId
    || record.authorizationDigest !== authorizationDigest
    || record.quarantineReceiptId !== quarantineReceipt.receiptId
    || record.quarantineObjectIdentityDigest !== quarantineReceipt.quarantineObjectIdentityDigest
    || record.originalDestinationIdentityDigest !== authorization.originalDestinationIdentityDigest
    || record.contentDigest !== quarantineReceipt.contentDigest
    || typeof record.restoredAt !== 'string'
    || Number.isNaN(Date.parse(record.restoredAt))) {
    throw new Error('IDEMPOTENCY_CONFLICT');
  }
  const { receiptDigest, ...base } = record;
  if (typeof receiptDigest !== 'string' || receiptDigest !== digest(base)) throw new Error('Restore receipt digest is invalid.');
  return record as unknown as RestoreMutationReceipt;
}

async function createRestoreReceipt(input: {
  authorization: RestoreAuthorization;
  authorizationDigest: string;
  quarantineReceipt: QuarantineMutationReceipt;
  restoredAt: string;
  receiptFile: string;
}): Promise<RestoreMutationReceipt> {
  const base = {
    kind: 'skillmap.local-restore-receipt' as const,
    schemaVersion: 1 as const,
    status: 'RESTORE_OBSERVED' as const,
    receiptId: digest({ kind: 'skillmap.local-restore-receipt-id.v1', operationId: input.authorization.operationId }),
    operationId: input.authorization.operationId,
    authorizationDigest: input.authorizationDigest,
    quarantineReceiptId: input.quarantineReceipt.receiptId,
    quarantineObjectIdentityDigest: input.quarantineReceipt.quarantineObjectIdentityDigest,
    originalDestinationIdentityDigest: input.authorization.originalDestinationIdentityDigest,
    contentDigest: input.quarantineReceipt.contentDigest,
    restoredAt: input.restoredAt
  };
  const receipt: RestoreMutationReceipt = { ...base, receiptDigest: digest(base) };
  await writeExclusiveRecord(input.receiptFile, receipt)
    .catch((error: unknown) => { throw new Error('RESTORE_OUTCOME_NEEDS_RECONCILIATION', { cause: error }); });
  return receipt;
}

async function writeExclusiveRecord(file: string, value: unknown): Promise<void> {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(path.dirname(file), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function executeRestore(input: {
  quarantineReceipt: QuarantineMutationReceipt;
  authorization: RestoreAuthorization;
  quarantineRoot: RootCapability;
  quarantinePath: string;
  originalRoot: RootCapability;
  originalCandidates: readonly string[];
  receiptDirectory: string;
  mover: AtomicNoReplaceMover;
  authorityProvider: HostedRestoreAuthorityProvider;
  now?: () => Date;
}): Promise<RestoreMutationReceipt | LocalQuarantineOutcomeV1> {
  if (input.originalCandidates.length !== 1) return LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_CARDINALITY_DENIED;
  if (!SAFE_ID.test(input.authorization.operationId) || !SAFE_ID.test(input.authorization.idempotencyKey)) {
    throw new Error('Restore operation identity is invalid.');
  }
  validateQuarantineMutationReceipt(input.quarantineReceipt);
  const now = input.now?.() ?? new Date();
  await Promise.all([assertCapabilityCurrent(input.originalRoot), assertCapabilityCurrent(input.quarantineRoot)]);
  const volumeFailure = assertSameVolume(input.originalRoot.volumeId, input.quarantineRoot.volumeId);
  if (volumeFailure) return volumeFailure;
  const originalRelativePath = input.originalCandidates[0]!;
  const originalPath = await assertSafeExistingParent(input.originalRoot, originalRelativePath);
  const quarantineRelativePath = input.authorization.escapedQuarantineRelativePath;
  const expectedQuarantinePath = path.join(input.quarantineRoot.canonicalRootPath, ...assertRelativePath(quarantineRelativePath));
  if (path.resolve(input.quarantinePath) !== expectedQuarantinePath) throw new Error('AUTHORIZATION_BINDING_INCOMPLETE');
  const authorizationDigest = assertAuthorization({
    authorization: input.authorization,
    receipt: input.quarantineReceipt,
    originalRoot: input.originalRoot,
    originalRelativePath,
    quarantineRoot: input.quarantineRoot,
    quarantineRelativePath
  });

  const receiptFile = path.join(input.receiptDirectory, `${input.authorization.idempotencyKey}.restore-receipt.json`);
  const existingReceipt = await safeReadRecord(receiptFile);
  if (existingReceipt) {
    const receipt = validateRestoreReceipt(existingReceipt, input.authorization, authorizationDigest, input.quarantineReceipt);
    const [originalEntry, quarantineEntry] = await Promise.all([
      observeSafeEntry(input.originalRoot, originalRelativePath),
      observeSafeEntry(input.quarantineRoot, quarantineRelativePath)
    ]);
    if (!originalEntry || quarantineEntry) throw new Error('REPLAY_STATE_INCONSISTENT');
    assertQuarantineObjectIdentity(originalEntry.stats, input.quarantineReceipt);
    await assertQuarantineTreeIntegrity(originalEntry.absolutePath, input.quarantineReceipt, 'QUARANTINE_TREE_MISMATCH');
    return receipt;
  }

  const expiryFailure = assertRestoreWindowOpen(input.quarantineReceipt, now);
  if (expiryFailure) return expiryFailure;

  let [quarantineEntry, originalEntry] = await Promise.all([
    observeSafeEntry(input.quarantineRoot, quarantineRelativePath),
    observeSafeEntry(input.originalRoot, originalRelativePath)
  ]);
  const intentFile = path.join(input.receiptDirectory, `${input.authorization.idempotencyKey}.restore-intent.json`);
  const existingIntent = await safeReadRecord(intentFile);
  if (existingIntent && existingIntent.authorizationDigest !== authorizationDigest) throw new Error('IDEMPOTENCY_CONFLICT');

  if (originalEntry) {
    if (!existingIntent || quarantineEntry) return LOCAL_QUARANTINE_OUTCOMES.RESTORE_DESTINATION_OCCUPIED;
    assertQuarantineObjectIdentity(originalEntry.stats, input.quarantineReceipt);
    await assertQuarantineTreeIntegrity(originalEntry.absolutePath, input.quarantineReceipt, 'QUARANTINE_TREE_MISMATCH');
    return createRestoreReceipt({
      authorization: input.authorization,
      authorizationDigest,
      quarantineReceipt: input.quarantineReceipt,
      restoredAt: now.toISOString(),
      receiptFile
    });
  }
  if (!quarantineEntry) throw new Error('REPLAY_STATE_INCONSISTENT');
  assertQuarantineObjectIdentity(quarantineEntry.stats, input.quarantineReceipt);
  await assertQuarantineTreeIntegrity(quarantineEntry.absolutePath, input.quarantineReceipt, 'QUARANTINE_TREE_MISMATCH');

  const destinationBefore = await lstat(originalPath).catch((error: unknown) => {
    if (errno(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (destinationBefore) return LOCAL_QUARANTINE_OUTCOMES.RESTORE_DESTINATION_OCCUPIED;

  const intent = {
    kind: 'skillmap.local-restore-intent',
    schemaVersion: 1,
    action: 'restore',
    operationId: input.authorization.operationId,
    authorizationDigest,
    quarantineReceiptId: input.quarantineReceipt.receiptId,
    quarantineObjectIdentityDigest: input.quarantineReceipt.quarantineObjectIdentityDigest,
    originalDestinationIdentityDigest: input.authorization.originalDestinationIdentityDigest,
    createdAt: now.toISOString()
  } as const;
  if (!existingIntent) await writeExclusiveRecord(intentFile, { ...intent, intentDigest: digest(intent) });
  // Fetch and validate the hosted authority at the final move boundary. The
  // caller-supplied labels are not sufficient because lifecycle authority may
  // be revoked or replaced after local preparation.
  const hostedAuthority = await input.authorityProvider.loadCurrentRestoreAuthority({
    authorizationId: input.authorization.currentHostedLifecycleAuthorizationId,
    operationId: input.authorization.operationId,
    quarantineReceiptId: input.authorization.quarantineReceiptId
  });
  const moveNow = input.now?.() ?? new Date();
  const moveExpiryFailure = assertRestoreWindowOpen(input.quarantineReceipt, moveNow);
  if (moveExpiryFailure) return moveExpiryFailure;
  assertHostedRestoreAuthority(hostedAuthority, input.authorization, moveNow);
  await assertQuarantineTreeIntegrity(quarantineEntry.absolutePath, input.quarantineReceipt, 'QUARANTINE_TREE_MISMATCH');
  try {
    await input.mover.move(quarantineEntry.absolutePath, originalPath, {
      sourceRootPath: input.quarantineRoot.canonicalRootPath,
      sourceRootVolumeId: input.quarantineRoot.volumeId,
      sourceRootFileId: input.quarantineRoot.rootFileId,
      sourceRelativePath: quarantineRelativePath,
      sourceObjectVolumeId: Number(quarantineEntry.stats.dev),
      sourceObjectFileId: Number(quarantineEntry.stats.ino),
      destinationRootPath: input.originalRoot.canonicalRootPath,
      destinationRootVolumeId: input.originalRoot.volumeId,
      destinationRootFileId: input.originalRoot.rootFileId,
      destinationRelativePath: originalRelativePath
    });
  } catch (error) {
    if (errno(error, 'EEXIST')) return LOCAL_QUARANTINE_OUTCOMES.RESTORE_DESTINATION_OCCUPIED;
    if (errno(error, 'EXDEV')) return LOCAL_QUARANTINE_OUTCOMES.CROSS_VOLUME_NOT_ATOMIC;
    throw error;
  }
  const restoredStats = await lstat(originalPath);
  if (restoredStats.dev !== quarantineEntry.stats.dev || restoredStats.ino !== quarantineEntry.stats.ino) {
    throw new Error('RESTORE_OUTCOME_NEEDS_RECONCILIATION');
  }
  const quarantineAfter = await lstat(quarantineEntry.absolutePath).catch((error: unknown) => {
    if (errno(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (quarantineAfter) throw new Error('RESTORE_OUTCOME_NEEDS_RECONCILIATION');
  await assertQuarantineTreeIntegrity(originalPath, input.quarantineReceipt, 'RESTORE_OUTCOME_NEEDS_RECONCILIATION');
  const originalAfterDigest = await lstat(originalPath).catch((error: unknown) => {
    throw new Error('RESTORE_OUTCOME_NEEDS_RECONCILIATION', { cause: error });
  });
  assertQuarantineObjectIdentity(originalAfterDigest, input.quarantineReceipt);
  return createRestoreReceipt({
    authorization: input.authorization,
    authorizationDigest,
    quarantineReceipt: input.quarantineReceipt,
    restoredAt: now.toISOString(),
    receiptFile
  });
}
