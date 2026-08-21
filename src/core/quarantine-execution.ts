import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { LOCAL_QUARANTINE_OUTCOMES, type LocalQuarantineOutcomeV1 } from '../contracts/local-quarantine-registry.js';
import { computeRestoreExpiryUtc } from './quarantine-retention.js';
import { validateImportParityReceipt, type ImportParityReceipt } from './import-parity.js';
import type {
  AtomicNoReplaceMover,
  QuarantineAuthorization,
  QuarantineMutationReceipt,
  QuarantinePreflightSuccess
} from './quarantine-types.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_RECORD_BYTES = 128 * 1024;

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function errno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function inside(root: string, candidate: string, allowRoot = false): boolean {
  const relative = path.relative(root, candidate);
  return (allowRoot || Boolean(relative))
    && !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`);
}

function assertTimestamp(value: string, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(`${label} is invalid.`);
  return date;
}

function assertAuthorization(
  authorization: QuarantineAuthorization,
  preflight: QuarantinePreflightSuccess,
  parityReceipt: ImportParityReceipt,
  now: Date
): string {
  validateImportParityReceipt(parityReceipt, now);
  const parityCandidate = parityReceipt.eligibleCandidates[0]!;
  const values = Object.values(authorization);
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('AUTHORIZATION_BINDING_INCOMPLETE');
  }
  if (authorization.action !== 'quarantine'
    || authorization.parityState !== 'PARITY_CONFIRMED'
    || authorization.cutoverState !== 'CUTOVER_AUTHORIZED'
    || authorization.operationId !== preflight.reservation.operationId
    || authorization.candidateSnapshotDigest !== preflight.snapshot.snapshotDigest
    || authorization.preflightDigest !== preflight.preflightDigest
    || authorization.sourceRootId !== preflight.snapshot.rootId
    || authorization.escapedSourceRelativePath !== preflight.snapshot.escapedRelativePath
    || authorization.quarantineRootId !== preflight.reservation.quarantineRootId
    || authorization.destinationIdentityDigest !== preflight.reservation.destinationIdentityDigest
    || authorization.policyVersion !== preflight.policyVersion
    || authorization.accountId !== parityReceipt.accountId
    || authorization.deviceId !== parityReceipt.deviceId
    || authorization.sourceObjectId !== parityCandidate.sourceObjectId
    || authorization.immutableVersionId !== parityReceipt.immutableVersionId
    || authorization.contentDigest !== parityReceipt.contentDigest
    || authorization.parityReceiptId !== parityReceipt.receiptId
    || authorization.cutoverAuthorityId !== parityReceipt.cutoverAuthorityId
    || authorization.ownerConsentId !== parityReceipt.ownerConsentId
    || authorization.consentDigest !== parityReceipt.consentDigest
    || authorization.explicitConsentAt !== parityReceipt.explicitConsentAt
    || authorization.consentExpiresAt !== parityReceipt.consentExpiresAt
    || parityCandidate.rootId !== preflight.snapshot.rootId
    || parityCandidate.relativePath !== preflight.snapshot.relativePath
    || !DIGEST.test(authorization.contentDigest)
    || !DIGEST.test(authorization.consentDigest)) {
    throw new Error('AUTHORIZATION_BINDING_INCOMPLETE');
  }
  const consentAt = assertTimestamp(authorization.explicitConsentAt, 'explicitConsentAt');
  const expiresAt = assertTimestamp(authorization.consentExpiresAt, 'consentExpiresAt');
  if (consentAt.getTime() >= expiresAt.getTime() || now.getTime() >= expiresAt.getTime()) {
    throw new Error('AUTHORIZATION_EXPIRED');
  }
  return digest({ kind: 'skillmap.quarantine-authorization.v1', ...authorization });
}

async function safeReadRecord(file: string): Promise<Record<string, unknown> | undefined> {
  const before = await lstat(file).catch((error: unknown) => {
    if (errno(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (!before) return undefined;
  if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_RECORD_BYTES) throw new Error('Receipt record is unsafe.');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()) throw new Error('Receipt record changed before read.');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length > MAX_RECORD_BYTES || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) {
      throw new Error('Receipt record changed during read.');
    }
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Receipt record is malformed.');
    return parsed as Record<string, unknown>;
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeExclusiveRecord(file: string, value: unknown): Promise<void> {
  const payload = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(payload) > MAX_RECORD_BYTES) throw new Error('Receipt record exceeds its bounded size.');
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

async function ensureDestinationParent(preflight: QuarantinePreflightSuccess): Promise<void> {
  const relative = path.relative(preflight.quarantineRootRealPath, preflight.destinationParentPath);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Destination parent escaped the quarantine root.');
  }
  let current = preflight.quarantineRootRealPath;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
      if (!errno(error, 'EEXIST')) throw error;
    });
    const stats = await lstat(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Destination parent contains an unsafe entry.');
  }
  const resolved = await realpath(preflight.destinationParentPath);
  if (!inside(preflight.quarantineRootRealPath, resolved)) throw new Error('Destination parent escaped after creation.');
  await syncDirectory(preflight.destinationParentPath);
}

function sameSnapshot(preflight: QuarantinePreflightSuccess, stats: Awaited<ReturnType<typeof lstat>>): boolean {
  const expected = preflight.snapshot;
  return stats.dev === expected.sourceVolumeId
    && stats.ino === expected.sourceFileId
    && stats.size === expected.size
    && stats.mode === expected.mode
    && stats.mtimeMs === expected.modifiedAtMs
    && stats.ctimeMs === expected.changedAtMs;
}

async function assertRootCapabilitiesCurrent(preflight: QuarantinePreflightSuccess): Promise<void> {
  const roots = [
    { path: preflight.sourceRootRealPath, volumeId: preflight.sourceRootVolumeId, fileId: preflight.sourceRootFileId },
    { path: preflight.quarantineRootRealPath, volumeId: preflight.quarantineRootVolumeId, fileId: preflight.quarantineRootFileId }
  ];
  for (const root of roots) {
    const stats = await lstat(root.path).catch(() => undefined);
    if (!stats || stats.isSymbolicLink() || !stats.isDirectory()
      || stats.dev !== root.volumeId || stats.ino !== root.fileId) {
      throw new Error('ROOT_CAPABILITY_STALE');
    }
    const currentRealPath = await realpath(root.path).catch(() => undefined);
    if (currentRealPath !== root.path) throw new Error('ROOT_CAPABILITY_STALE');
  }
}

function encodeMoveRequest(sourcePath: string, destinationPath: string): Buffer {
  const values = [Buffer.from(sourcePath, 'utf8'), Buffer.from(destinationPath, 'utf8')];
  if (values.some((value) => value.length === 0 || value.length > 32_768 || value.includes(0))) {
    throw new Error('Atomic move path exceeds its private helper boundary.');
  }
  return Buffer.concat(values.flatMap((value) => {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(value.length);
    return [length, value];
  }));
}

export function createMacOSAtomicNoReplaceMover(helperPath: string): AtomicNoReplaceMover {
  if (!path.isAbsolute(helperPath)) throw new Error('Atomic move helper path must be absolute.');
  return {
    async move(sourcePath: string, destinationPath: string): Promise<void> {
      const request = encodeMoveRequest(sourcePath, destinationPath);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
        const stdout: Buffer[] = [];
        let stdoutBytes = 0;
        child.stdout.on('data', (chunk: Buffer) => {
          stdoutBytes += chunk.length;
          if (stdoutBytes <= 64) stdout.push(chunk);
        });
        child.on('error', reject);
        child.on('close', (code) => {
          const result = Buffer.concat(stdout).toString('utf8');
          if (code === 0 && result === 'OK\n') return resolve();
          const error = new Error('Atomic no-replace move failed.') as NodeJS.ErrnoException;
          if (code === 17 && result === 'DESTINATION_OCCUPIED\n') error.code = 'EEXIST';
          else if (code === 18 && result === 'CROSS_VOLUME\n') error.code = 'EXDEV';
          else error.code = 'ATOMIC_MOVE_FAILED';
          reject(error);
        });
        child.stdin.end(request);
      });
    }
  };
}

export async function executeQuarantine(input: {
  preflight: QuarantinePreflightSuccess;
  parityReceipt: ImportParityReceipt;
  authorization: QuarantineAuthorization;
  receiptDirectory: string;
  mover: AtomicNoReplaceMover;
  now?: () => Date;
}): Promise<QuarantineMutationReceipt | LocalQuarantineOutcomeV1> {
  if (!SAFE_ID.test(input.authorization.operationId)) throw new Error('operationId is invalid.');
  const now = input.now?.() ?? new Date();
  const authorizationDigest = assertAuthorization(input.authorization, input.preflight, input.parityReceipt, now);
  await mkdir(input.receiptDirectory, { recursive: true, mode: 0o700 });
  const receiptFile = path.join(input.receiptDirectory, `${input.authorization.operationId}.quarantine-receipt.json`);
  const existing = await safeReadRecord(receiptFile);
  if (existing) {
    if (existing.authorizationDigest !== authorizationDigest) throw new Error('IDEMPOTENCY_CONFLICT');
    return existing as unknown as QuarantineMutationReceipt;
  }

  await assertRootCapabilitiesCurrent(input.preflight);
  const sourceBefore = await lstat(input.preflight.sourcePath);
  if (!sameSnapshot(input.preflight, sourceBefore)) throw new Error('CANDIDATE_STALE');
  await ensureDestinationParent(input.preflight);
  const destinationBefore = await lstat(input.preflight.destinationPath).catch((error: unknown) => {
    if (errno(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (destinationBefore) return LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED;

  const intent = {
    kind: 'skillmap.local-quarantine-intent',
    schemaVersion: 1,
    action: 'quarantine',
    operationId: input.authorization.operationId,
    authorizationDigest,
    preflightDigest: input.preflight.preflightDigest,
    candidateSnapshotDigest: input.preflight.snapshot.snapshotDigest,
    destinationIdentityDigest: input.preflight.reservation.destinationIdentityDigest,
    createdAt: now.toISOString()
  } as const;
  const intentFile = path.join(input.receiptDirectory, `${input.authorization.operationId}.quarantine-intent.json`);
  const existingIntent = await safeReadRecord(intentFile);
  if (existingIntent && existingIntent.authorizationDigest !== authorizationDigest) throw new Error('IDEMPOTENCY_CONFLICT');
  if (!existingIntent) await writeExclusiveRecord(intentFile, { ...intent, intentDigest: digest(intent) });

  try {
    await assertRootCapabilitiesCurrent(input.preflight);
    const sourceImmediatelyBeforeMove = await lstat(input.preflight.sourcePath);
    if (!sameSnapshot(input.preflight, sourceImmediatelyBeforeMove)) throw new Error('CANDIDATE_STALE');
    const destinationImmediatelyBeforeMove = await lstat(input.preflight.destinationPath).catch((error: unknown) => {
      if (errno(error, 'ENOENT')) return undefined;
      throw error;
    });
    if (destinationImmediatelyBeforeMove) {
      return LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED;
    }
    await input.mover.move(input.preflight.sourcePath, input.preflight.destinationPath);
  } catch (error) {
    if (errno(error, 'EEXIST')) return LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED;
    if (errno(error, 'EXDEV')) return LOCAL_QUARANTINE_OUTCOMES.CROSS_VOLUME_NOT_ATOMIC;
    throw error;
  }

  const destinationAfter = await lstat(input.preflight.destinationPath);
  if (destinationAfter.dev !== sourceBefore.dev || destinationAfter.ino !== sourceBefore.ino) {
    throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION');
  }
  const sourceAfter = await lstat(input.preflight.sourcePath).catch((error: unknown) => {
    if (errno(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (sourceAfter) throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION');

  const quarantinedAt = now.toISOString();
  const base = {
    kind: 'skillmap.local-quarantine-receipt' as const,
    schemaVersion: 1 as const,
    status: 'MOVE_OBSERVED' as const,
    receiptId: digest({ kind: 'skillmap.local-quarantine-receipt-id.v1', operationId: input.authorization.operationId }),
    operationId: input.authorization.operationId,
    authorizationDigest,
    preflightDigest: input.preflight.preflightDigest,
    candidateSnapshotDigest: input.preflight.snapshot.snapshotDigest,
    contentDigest: input.authorization.contentDigest,
    sourceObjectId: input.authorization.sourceObjectId,
    quarantineObjectIdentityDigest: digest({
      kind: 'skillmap.quarantine-object-identity.v1',
      sourceObjectId: input.authorization.sourceObjectId,
      device: destinationAfter.dev,
      inode: destinationAfter.ino,
      destinationIdentityDigest: input.preflight.reservation.destinationIdentityDigest
    }),
    destinationIdentityDigest: input.preflight.reservation.destinationIdentityDigest,
    quarantinedAt,
    restoreExpiresAt: computeRestoreExpiryUtc(quarantinedAt)
  };
  const receipt: QuarantineMutationReceipt = { ...base, receiptDigest: digest(base) };
  await writeExclusiveRecord(receiptFile, receipt).catch((error: unknown) => {
    throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION', { cause: error });
  });
  return receipt;
}
