import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { computeQuarantineTreeDigest } from './quarantine-tree-digest.js';

import { LOCAL_QUARANTINE_OUTCOMES, type LocalQuarantineOutcomeV1 } from '../contracts/local-quarantine-registry.js';
import { computeRestoreExpiryUtc } from './quarantine-retention.js';
import { validateImportParityReceipt, type ImportParityReceipt } from './import-parity.js';
import type {
  AtomicMoveBinding,
  AtomicNoReplaceMover,
  QuarantineAuthorization,
  QuarantineMutationReceipt,
  QuarantinePreflightSuccess
} from './quarantine-types.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_RECORD_BYTES = 128 * 1024;
const CONVERGENCE_ATTEMPTS = 10;

function convergenceDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(500, 5 * (2 ** attempt))));
}
const QUARANTINE_RECEIPT_V1_KEYS = [
  'kind',
  'schemaVersion',
  'status',
  'receiptId',
  'operationId',
  'authorizationDigest',
  'preflightDigest',
  'candidateSnapshotDigest',
  'contentDigest',
  'sourceObjectId',
  'quarantineObjectIdentityDigest',
  'destinationIdentityDigest',
  'quarantinedAt',
  'restoreExpiresAt',
  'receiptDigest'
] as const;
const QUARANTINE_RECEIPT_V2_KEYS = [
  ...QUARANTINE_RECEIPT_V1_KEYS,
  'treeDigest'
] as const;
const QUARANTINE_INTENT_KEYS = [
  'kind',
  'schemaVersion',
  'action',
  'operationId',
  'authorizationDigest',
  'preflightDigest',
  'candidateSnapshotDigest',
  'destinationIdentityDigest',
  'createdAt',
  'intentDigest'
] as const;

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

export function validateQuarantineMutationReceipt(value: unknown): QuarantineMutationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Quarantine receipt is malformed.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = record.schemaVersion === 1
    ? QUARANTINE_RECEIPT_V1_KEYS
    : record.schemaVersion === 2
      ? QUARANTINE_RECEIPT_V2_KEYS
      : undefined;
  if (!expectedKeys
    || keys.length !== expectedKeys.length
    || !expectedKeys.every((key) => keys.includes(key))) {
    throw new Error('Quarantine receipt is malformed.');
  }
  const digestFields = [
    record.authorizationDigest,
    record.preflightDigest,
    record.candidateSnapshotDigest,
    record.contentDigest,
    record.quarantineObjectIdentityDigest,
    record.destinationIdentityDigest,
    record.receiptDigest
  ];
  if (record.schemaVersion === 2) digestFields.push(record.treeDigest);
  if (record.kind !== 'skillmap.local-quarantine-receipt'
    || (record.schemaVersion !== 1 && record.schemaVersion !== 2)
    || record.status !== 'MOVE_OBSERVED'
    || typeof record.operationId !== 'string'
    || !SAFE_ID.test(record.operationId)
    || typeof record.sourceObjectId !== 'string'
    || !SAFE_ID.test(record.sourceObjectId)
    || digestFields.some((field) => typeof field !== 'string' || !DIGEST.test(field))) {
    throw new Error('Quarantine receipt is malformed.');
  }
  const quarantinedAt = assertTimestamp(String(record.quarantinedAt), 'quarantinedAt');
  const restoreExpiresAt = assertTimestamp(String(record.restoreExpiresAt), 'restoreExpiresAt');
  const expectedReceiptId = digest({
    kind: record.schemaVersion === 1
      ? 'skillmap.local-quarantine-receipt-id.v1'
      : 'skillmap.local-quarantine-receipt-id.v2',
    operationId: record.operationId
  });
  const { receiptDigest, ...base } = record;
  if (restoreExpiresAt.getTime() <= quarantinedAt.getTime()
    || record.receiptId !== expectedReceiptId
    || receiptDigest !== digest(base)) {
    throw new Error('Quarantine receipt digest is invalid.');
  }
  return record as unknown as QuarantineMutationReceipt;
}

function validateQuarantineIntent(
  value: Record<string, unknown>,
  expected: {
    operationId: string;
    authorizationDigest: string;
    preflightDigest: string;
    candidateSnapshotDigest: string;
    destinationIdentityDigest: string;
  }
): string {
  const keys = Object.keys(value).sort();
  const { intentDigest, ...base } = value;
  if (keys.length !== QUARANTINE_INTENT_KEYS.length
    || !QUARANTINE_INTENT_KEYS.every((key) => keys.includes(key))
    || value.kind !== 'skillmap.local-quarantine-intent'
    || value.schemaVersion !== 1
    || value.action !== 'quarantine'
    || value.operationId !== expected.operationId
    || value.authorizationDigest !== expected.authorizationDigest
    || value.preflightDigest !== expected.preflightDigest
    || value.candidateSnapshotDigest !== expected.candidateSnapshotDigest
    || value.destinationIdentityDigest !== expected.destinationIdentityDigest
    || typeof value.createdAt !== 'string'
    || typeof intentDigest !== 'string'
    || intentDigest !== digest(base)) {
    throw new Error('IDEMPOTENCY_CONFLICT');
  }
  assertTimestamp(value.createdAt, 'createdAt');
  return value.createdAt;
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

async function readRecordAfterExclusiveConflict(file: string): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < CONVERGENCE_ATTEMPTS; attempt += 1) {
    try {
      const record = await safeReadRecord(file);
      if (record) return record;
    } catch (error) {
      lastError = error;
    }
    if (attempt < CONVERGENCE_ATTEMPTS - 1) await convergenceDelay(attempt);
  }
  throw new Error('Exclusive record winner could not be read safely.', { cause: lastError });
}

async function persistQuarantineIntent(
  file: string,
  intent: Record<string, unknown>,
  binding: {
    operationId: string;
    authorizationDigest: string;
    preflightDigest: string;
    candidateSnapshotDigest: string;
    destinationIdentityDigest: string;
  }
): Promise<string> {
  try {
    await writeExclusiveRecord(file, intent);
    return validateQuarantineIntent(intent, binding);
  } catch (error) {
    if (!errno(error, 'EEXIST')) throw error;
    return validateQuarantineIntent(await readRecordAfterExclusiveConflict(file), binding);
  }
}

async function commitQuarantineReceipt(
  file: string,
  candidate: QuarantineMutationReceipt
): Promise<QuarantineMutationReceipt> {
  try {
    await writeExclusiveRecord(file, candidate);
    return candidate;
  } catch (error) {
    if (!errno(error, 'EEXIST')) {
      throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION', { cause: error });
    }
    const winner = validateQuarantineMutationReceipt(await readRecordAfterExclusiveConflict(file));
    if (winner.receiptDigest !== candidate.receiptDigest) throw new Error('IDEMPOTENCY_CONFLICT');
    return winner;
  }
}

function buildQuarantineReceipt(
  input: {
    preflight: QuarantinePreflightSuccess;
    authorization: QuarantineAuthorization;
  },
  authorizationDigest: string,
  quarantinedAt: string,
  destination: Awaited<ReturnType<typeof lstat>>
): QuarantineMutationReceipt {
  const base = {
    kind: 'skillmap.local-quarantine-receipt' as const,
    schemaVersion: 2 as const,
    status: 'MOVE_OBSERVED' as const,
    receiptId: digest({ kind: 'skillmap.local-quarantine-receipt-id.v2', operationId: input.authorization.operationId }),
    operationId: input.authorization.operationId,
    authorizationDigest,
    preflightDigest: input.preflight.preflightDigest,
    candidateSnapshotDigest: input.preflight.snapshot.snapshotDigest,
    treeDigest: input.preflight.snapshot.treeDigest,
    contentDigest: input.authorization.contentDigest,
    sourceObjectId: input.authorization.sourceObjectId,
    quarantineObjectIdentityDigest: digest({
      kind: 'skillmap.quarantine-object-identity.v1',
      sourceObjectId: input.authorization.sourceObjectId,
      device: destination.dev,
      inode: destination.ino,
      destinationIdentityDigest: input.preflight.reservation.destinationIdentityDigest
    }),
    destinationIdentityDigest: input.preflight.reservation.destinationIdentityDigest,
    quarantinedAt,
    restoreExpiresAt: computeRestoreExpiryUtc(quarantinedAt)
  };
  return { ...base, receiptDigest: digest(base) };
}

async function recoverConcurrentQuarantineMove(
  input: {
    preflight: QuarantinePreflightSuccess;
    authorization: QuarantineAuthorization;
  },
  authorizationDigest: string,
  intentCreatedAt: string,
  receiptFile: string
): Promise<QuarantineMutationReceipt | undefined> {
  for (let attempt = 0; attempt < CONVERGENCE_ATTEMPTS; attempt += 1) {
    const [source, destination] = await Promise.all([
      lstat(input.preflight.sourcePath).catch((error: unknown) => {
        if (errno(error, 'ENOENT')) return undefined;
        throw error;
      }),
      lstat(input.preflight.destinationPath).catch((error: unknown) => {
        if (errno(error, 'ENOENT')) return undefined;
        throw error;
      })
    ]);
    if (!source && destination) {
      if (destination.dev !== input.preflight.snapshot.sourceVolumeId
        || destination.ino !== input.preflight.snapshot.sourceFileId) {
        throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION');
      }
      const treeDigest = await computeQuarantineTreeDigest(input.preflight.destinationPath)
        .catch((error: unknown) => { throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION', { cause: error }); });
      if (treeDigest !== input.preflight.snapshot.treeDigest) throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION');
      const afterDigest = await lstat(input.preflight.destinationPath)
        .catch((error: unknown) => { throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION', { cause: error }); });
      if (afterDigest.dev !== destination.dev || afterDigest.ino !== destination.ino) {
        throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION');
      }
      return commitQuarantineReceipt(
        receiptFile,
        buildQuarantineReceipt(input, authorizationDigest, intentCreatedAt, destination)
      );
    }
    if (attempt < CONVERGENCE_ATTEMPTS - 1) await convergenceDelay(attempt);
  }
  return undefined;
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

function moveRelativeParts(value: string): string[] {
  if (!value || value !== value.normalize('NFC') || path.isAbsolute(value) || value.includes('\\')) {
    throw new Error('Atomic move requires one normalized relative path.');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f]/u.test(part))) {
    throw new Error('Atomic move relative path contains an unsafe component.');
  }
  return parts;
}

function encodeMoveRequest(sourcePath: string, destinationPath: string, binding: AtomicMoveBinding): Buffer {
  const sourceParts = moveRelativeParts(binding.sourceRelativePath);
  const destinationParts = moveRelativeParts(binding.destinationRelativePath);
  if (!path.isAbsolute(binding.sourceRootPath) || !path.isAbsolute(binding.destinationRootPath)
    || path.resolve(sourcePath) !== path.join(binding.sourceRootPath, ...sourceParts)
    || path.resolve(destinationPath) !== path.join(binding.destinationRootPath, ...destinationParts)) {
    throw new Error('Atomic move path does not match its root capability binding.');
  }
  const identities = [
    binding.sourceRootVolumeId,
    binding.sourceRootFileId,
    binding.sourceObjectVolumeId,
    binding.sourceObjectFileId,
    binding.destinationRootVolumeId,
    binding.destinationRootFileId
  ];
  if (identities.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Atomic move identity is invalid.');
  }
  const fields = [
    '2',
    binding.sourceRootPath,
    binding.sourceRelativePath,
    String(binding.sourceRootVolumeId),
    String(binding.sourceRootFileId),
    String(binding.sourceObjectVolumeId),
    String(binding.sourceObjectFileId),
    binding.destinationRootPath,
    binding.destinationRelativePath,
    String(binding.destinationRootVolumeId),
    String(binding.destinationRootFileId)
  ];
  const values = fields.map((value) => Buffer.from(value, 'utf8'));
  if (values.some((value) => value.length === 0 || value.length > 32_768 || value.includes(0))) {
    throw new Error('Atomic move request exceeds its private helper boundary.');
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
    async move(sourcePath: string, destinationPath: string, binding: AtomicMoveBinding): Promise<void> {
      const request = encodeMoveRequest(sourcePath, destinationPath, binding);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
        const stdout: Buffer[] = [];
        let stdoutBytes = 0;
        child.stdout.on('data', (chunk: Buffer) => {
          stdoutBytes += chunk.length;
          if (stdoutBytes <= 64) stdout.push(chunk);
        });
        child.on('error', reject);
        child.stdin.on('error', reject);
        child.on('close', (code) => {
          const result = Buffer.concat(stdout).toString('utf8');
          if (code === 0 && result === 'OK\n') return resolve();
          const error = new Error('Atomic no-replace move failed.') as NodeJS.ErrnoException;
          if (code === 17 && result === 'DESTINATION_OCCUPIED\n') error.code = 'EEXIST';
          else if (code === 18 && result === 'CROSS_VOLUME\n') error.code = 'EXDEV';
          else if (code === 65 && result === 'ROOT_CAPABILITY_STALE\n') {
            error.code = 'ESTALE';
            error.message = 'ROOT_CAPABILITY_STALE';
          } else if (code === 66 && result === 'SOURCE_IDENTITY_STALE\n') {
            error.code = 'ESTALE';
            error.message = 'CANDIDATE_STALE';
          } else if (code === 67 && result === 'UNSAFE_PATH\n') {
            error.code = 'EINVAL';
            error.message = 'UNSAFE_PATH';
          } else if (code === 19 && result === 'SYNC_FAILED\n') {
            error.code = 'EIO';
            error.message = 'ATOMIC_MOVE_DURABILITY_FAILED';
          }
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
    const receipt = validateQuarantineMutationReceipt(existing);
    if (receipt.authorizationDigest !== authorizationDigest) throw new Error('IDEMPOTENCY_CONFLICT');
    return receipt;
  }

  const intentFile = path.join(input.receiptDirectory, `${input.authorization.operationId}.quarantine-intent.json`);
  const existingIntent = await safeReadRecord(intentFile);
  const intentBinding = {
    operationId: input.authorization.operationId,
    authorizationDigest,
    preflightDigest: input.preflight.preflightDigest,
    candidateSnapshotDigest: input.preflight.snapshot.snapshotDigest,
    destinationIdentityDigest: input.preflight.reservation.destinationIdentityDigest
  };
  let intentCreatedAt = now.toISOString();
  if (existingIntent) intentCreatedAt = validateQuarantineIntent(existingIntent, intentBinding);

  await assertRootCapabilitiesCurrent(input.preflight);
  await ensureDestinationParent(input.preflight);
  const sourceBefore = await lstat(input.preflight.sourcePath).catch((error: unknown) => {
    if (errno(error, 'ENOENT')) return undefined;
    throw error;
  });
  const destinationBefore = await lstat(input.preflight.destinationPath).catch((error: unknown) => {
    if (errno(error, 'ENOENT')) return undefined;
    throw error;
  });

  if (!sourceBefore) {
    if (!existingIntent || !destinationBefore) throw new Error('REPLAY_STATE_INCONSISTENT');
    const recovered = await recoverConcurrentQuarantineMove(input, authorizationDigest, intentCreatedAt, receiptFile);
    if (!recovered) throw new Error('REPLAY_STATE_INCONSISTENT');
    return recovered;
  }

  if (!sameSnapshot(input.preflight, sourceBefore)) throw new Error('CANDIDATE_STALE');
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
    createdAt: intentCreatedAt
  } as const;
  if (!existingIntent) {
    intentCreatedAt = await persistQuarantineIntent(
      intentFile,
      { ...intent, intentDigest: digest(intent) },
      intentBinding
    );
  }

  try {
    await assertRootCapabilitiesCurrent(input.preflight);
    const sourceImmediatelyBeforeMove = await lstat(input.preflight.sourcePath);
    if (!sameSnapshot(input.preflight, sourceImmediatelyBeforeMove)) throw new Error('CANDIDATE_STALE');
    const currentTreeDigest = await computeQuarantineTreeDigest(input.preflight.sourcePath);
    if (currentTreeDigest !== input.preflight.snapshot.treeDigest) throw new Error('CANDIDATE_STALE');
    const destinationImmediatelyBeforeMove = await lstat(input.preflight.destinationPath).catch((error: unknown) => {
      if (errno(error, 'ENOENT')) return undefined;
      throw error;
    });
    if (destinationImmediatelyBeforeMove) {
      const recovered = await recoverConcurrentQuarantineMove(input, authorizationDigest, intentCreatedAt, receiptFile);
      if (recovered) return recovered;
      return LOCAL_QUARANTINE_OUTCOMES.OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED;
    }
    // The parity authority can expire while the filesystem checks and intent
    // write are in progress. Take a fresh sample at the final move boundary.
    const moveNow = input.now?.() ?? new Date();
    assertAuthorization(input.authorization, input.preflight, input.parityReceipt, moveNow);
    await input.mover.move(input.preflight.sourcePath, input.preflight.destinationPath, {
      sourceRootPath: input.preflight.sourceRootRealPath,
      sourceRootVolumeId: input.preflight.sourceRootVolumeId,
      sourceRootFileId: input.preflight.sourceRootFileId,
      sourceRelativePath: input.preflight.snapshot.relativePath,
      sourceObjectVolumeId: input.preflight.snapshot.sourceVolumeId,
      sourceObjectFileId: input.preflight.snapshot.sourceFileId,
      destinationRootPath: input.preflight.quarantineRootRealPath,
      destinationRootVolumeId: input.preflight.quarantineRootVolumeId,
      destinationRootFileId: input.preflight.quarantineRootFileId,
      destinationRelativePath: input.preflight.reservation.escapedDestinationRelativePath
    });
  } catch (error) {
    const concurrentRace = errno(error, 'EEXIST')
      || errno(error, 'ENOENT')
      || (error instanceof Error
        && (error.message === 'CANDIDATE_STALE'
          || (error as NodeJS.ErrnoException).code === 'ATOMIC_MOVE_FAILED'));
    if (concurrentRace) {
      const recovered = await recoverConcurrentQuarantineMove(input, authorizationDigest, intentCreatedAt, receiptFile);
      if (recovered) return recovered;
    }
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

  // This post-move digest detects a child mutation before the receipt; it does
  // not make the filesystem move itself atomic.
  let destinationTreeDigest: string;
  try {
    destinationTreeDigest = await computeQuarantineTreeDigest(input.preflight.destinationPath);
  } catch (error) {
    throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION', { cause: error });
  }
  if (destinationTreeDigest !== input.preflight.snapshot.treeDigest) {
    throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION');
  }
  const destinationAfterDigest = await lstat(input.preflight.destinationPath).catch((error: unknown) => {
    throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION', { cause: error });
  });
  if (destinationAfterDigest.dev !== destinationAfter.dev
    || destinationAfterDigest.ino !== destinationAfter.ino) {
    throw new Error('MOVE_OUTCOME_NEEDS_RECONCILIATION');
  }

  return commitQuarantineReceipt(
    receiptFile,
    buildQuarantineReceipt(input, authorizationDigest, intentCreatedAt, destinationAfter)
  );
}
