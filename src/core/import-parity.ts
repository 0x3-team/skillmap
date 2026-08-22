import { createHash } from 'node:crypto';

import {
  buildImportManifest,
  type BuildImportManifestOptions,
  type ImportManifestResult
} from './import-manifest-builder.js';
import type { ImportFileReceipt, ImportFinalizeResponse } from '../network/import-client.js';

const ACCOUNT_ID = /^acct_[0-9a-f]{32}$/;
const DEVICE_ID = /^dev_[0-9a-f]{32}$/;
const SESSION_ID = /^imp_[0-9a-f]{32}$/;
const VERSION_ID = /^msv_[0-9a-f]{32}$/;
const CONSENT_ID = /^icn_[0-9a-f]{32}$/;
const CUTOVER_ID = /^cut_[0-9a-f]{32}$/;
const SOURCE_OBJECT_ID = /^lso_[0-9a-f]{32}$/;
const ROOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_RECEIPT_TTL_MS = 10 * 60_000;
const DEFAULT_RECEIPT_TTL_MS = 5 * 60_000;

export type ImportParityErrorCode =
  | 'INVALID_PARITY_INPUT'
  | 'LOCAL_RESCAN_FAILED'
  | 'PARITY_MISMATCH'
  | 'CONSENT_REQUIRED'
  | 'CONSENT_EXPIRED';

export interface ImportParityMismatch {
  missingPaths: string[];
  extraPaths: string[];
  changedPaths: string[];
  manifestChanged: boolean;
}

export class ImportParityError extends Error {
  readonly code: ImportParityErrorCode;
  readonly mismatch?: ImportParityMismatch;

  constructor(code: ImportParityErrorCode, message: string, mismatch?: ImportParityMismatch) {
    super(message);
    this.name = 'ImportParityError';
    this.code = code;
    this.mismatch = mismatch;
  }
}

export interface ImportParitySource {
  sourceObjectId: string;
  rootId: string;
  relativePath: string;
  skillDir: string;
  manifestOptions: BuildImportManifestOptions;
}

export interface ImportParityCloudState {
  manifestDigest: string;
  contentDigest: string;
  receipts: readonly ImportFileReceipt[];
  finalized: ImportFinalizeResponse;
}

export interface ImportParityReceiptCandidate {
  sourceObjectId: string;
  rootId: string;
  relativePath: string;
  immutableVersionId: string;
  contentDigest: string;
}

export interface ImportParityReceipt {
  kind: 'skillmap.import-parity-cutover-receipt';
  schemaVersion: 1;
  receiptId: string;
  accountId: string;
  deviceId: string;
  sessionId: string;
  finalizedRevision: number;
  immutableVersionId: string;
  manifestDigest: string;
  contentDigest: string;
  verificationDigest: string;
  fileCount: number;
  byteTotal: number;
  parityState: 'PARITY_CONFIRMED';
  cutoverState: 'CUTOVER_AUTHORIZED';
  ownerConsentId: string;
  consentDigest: string;
  explicitConsentAt: string;
  consentExpiresAt: string;
  cutoverAuthorityId: string;
  eligibleCandidates: ImportParityReceiptCandidate[];
  issuedAt: string;
  expiresAt: string;
  receiptDigest: string;
}

export interface IssueImportParityReceiptInput {
  accountId: string;
  deviceId: string;
  source: ImportParitySource;
  cloud: ImportParityCloudState;
  now?: Date;
  ttlMs?: number;
  rescan?: (skillDir: string, options: BuildImportManifestOptions) => Promise<ImportManifestResult>;
}

function safeRelativePath(value: string): boolean {
  if (!value || value !== value.normalize('NFC') || value.startsWith('/') || value.includes('\\')) return false;
  if (/^[A-Za-z]:/u.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'
    && !/[\u0000-\u001f\u007f]/u.test(part));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`;
}

function invalid(message: string): never {
  throw new ImportParityError('INVALID_PARITY_INPUT', message);
}

function validateCloud(input: IssueImportParityReceiptInput, nowMs: number): {
  finalizedRevision: number;
  immutableVersionId: string;
  ownerConsentId: string;
  consentDigest: string;
  explicitConsentAt: string;
  consentExpiresAt: string;
  consentExpiresAtMs: number;
  cutoverAuthorityId: string;
} {
  const { cloud } = input;
  if (!DIGEST.test(cloud.manifestDigest) || !DIGEST.test(cloud.contentDigest)
    || cloud.finalized.state !== 'verified' || !SESSION_ID.test(cloud.finalized.sessionPublicId)
    || !DIGEST.test(cloud.finalized.verificationDigest)) invalid('Cloud finalization binding is invalid.');
  const revision = cloud.finalized.finalizedRevision;
  const version = cloud.finalized.versionPublicId;
  const consentId = cloud.finalized.ownerConsentId;
  const consentDigest = cloud.finalized.consentDigest;
  const explicitConsentAt = cloud.finalized.explicitConsentAt;
  const consentExpiresAt = cloud.finalized.consentExpiresAt;
  const cutoverAuthorityId = cloud.finalized.cutoverAuthorityId;
  if (!Number.isSafeInteger(revision) || (revision ?? 0) < 1 || !version || !VERSION_ID.test(version)
    || !consentId || !CONSENT_ID.test(consentId) || !consentDigest || !DIGEST.test(consentDigest)
    || !explicitConsentAt || !consentExpiresAt || !cutoverAuthorityId || !CUTOVER_ID.test(cutoverAuthorityId)) {
    throw new ImportParityError('CONSENT_REQUIRED', 'Exact owner consent and cutover authority are required.');
  }
  const expiresMs = Date.parse(consentExpiresAt);
  const explicitMs = Date.parse(explicitConsentAt);
  if (!Number.isFinite(expiresMs) || !Number.isFinite(explicitMs) || explicitMs >= expiresMs) invalid('Consent time binding is invalid.');
  if (expiresMs <= nowMs) throw new ImportParityError('CONSENT_EXPIRED', 'Owner consent has expired.');
  return {
    finalizedRevision: revision!, immutableVersionId: version, ownerConsentId: consentId,
    consentDigest, explicitConsentAt, consentExpiresAt, consentExpiresAtMs: expiresMs, cutoverAuthorityId
  };
}

function normalizeReceipts(receipts: readonly ImportFileReceipt[]): ImportFileReceipt[] {
  if (receipts.length < 1 || receipts.length > 2_048) invalid('Cloud file receipts are out of bounds.');
  const sorted = [...receipts].sort((left, right) => left.ordinal - right.ordinal);
  const paths = new Set<string>();
  for (let index = 0; index < sorted.length; index += 1) {
    const receipt = sorted[index]!;
    if (receipt.ordinal !== index || !safeRelativePath(receipt.relativePath)
      || !Number.isSafeInteger(receipt.acceptedByteSize) || receipt.acceptedByteSize < 0
      || !DIGEST.test(receipt.fileDigest) || paths.has(receipt.relativePath)) {
      invalid('Cloud file receipts are not an exact ordered set.');
    }
    paths.add(receipt.relativePath);
  }
  return sorted;
}

function compareFiles(local: ImportManifestResult, cloud: readonly ImportFileReceipt[], manifestDigest: string): ImportParityMismatch {
  const localByPath = new Map(local.files.map((file) => [file.path, file]));
  const cloudByPath = new Map(cloud.map((file) => [file.relativePath, file]));
  const missingPaths = [...cloudByPath.keys()].filter((filePath) => !localByPath.has(filePath)).sort();
  const extraPaths = [...localByPath.keys()].filter((filePath) => !cloudByPath.has(filePath)).sort();
  const changedPaths = [...cloudByPath.entries()]
    .filter(([filePath, receipt]) => {
      const current = localByPath.get(filePath);
      return current !== undefined
        && (current.utf8_bytes !== receipt.acceptedByteSize || current.digest !== receipt.fileDigest);
    })
    .map(([filePath]) => filePath)
    .sort();
  return {
    missingPaths,
    extraPaths,
    changedPaths,
    manifestChanged: local.manifestDigest !== manifestDigest
  };
}

export async function issueImportParityReceipt(input: IssueImportParityReceiptInput): Promise<ImportParityReceipt> {
  if (!ACCOUNT_ID.test(input.accountId) || !DEVICE_ID.test(input.deviceId)
    || !SOURCE_OBJECT_ID.test(input.source.sourceObjectId) || !ROOT_ID.test(input.source.rootId)
    || !safeRelativePath(input.source.relativePath)) invalid('Local authority binding is invalid.');
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) invalid('Current time is invalid.');
  const ttlMs = input.ttlMs ?? DEFAULT_RECEIPT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_RECEIPT_TTL_MS) {
    invalid('Cutover receipt lifetime is out of bounds.');
  }
  const authority = validateCloud(input, nowMs);
  const cloudFiles = normalizeReceipts(input.cloud.receipts);
  let local: ImportManifestResult;
  try {
    local = await (input.rescan ?? buildImportManifest)(input.source.skillDir, input.source.manifestOptions);
  } catch {
    throw new ImportParityError('LOCAL_RESCAN_FAILED', 'The local source could not be rescanned safely.');
  }
  if (!local.importable || !local.manifestDigest || local.nonImportable.length > 0) {
    throw new ImportParityError('LOCAL_RESCAN_FAILED', 'The local source is no longer importable.');
  }
  const mismatch = compareFiles(local, cloudFiles, input.cloud.manifestDigest);
  const localBytes = local.files.reduce((total, file) => total + file.utf8_bytes, 0);
  const cloudBytes = cloudFiles.reduce((total, file) => total + file.acceptedByteSize, 0);
  if (mismatch.missingPaths.length > 0 || mismatch.extraPaths.length > 0
    || mismatch.changedPaths.length > 0 || mismatch.manifestChanged
    || local.files.length !== cloudFiles.length || localBytes !== cloudBytes) {
    throw new ImportParityError('PARITY_MISMATCH', 'Local and cloud content are not identical.', mismatch);
  }
  const issuedAt = now.toISOString();
  const expiresAt = new Date(Math.min(nowMs + ttlMs, authority.consentExpiresAtMs)).toISOString();
  const eligibleCandidates: ImportParityReceiptCandidate[] = [{
    sourceObjectId: input.source.sourceObjectId,
    rootId: input.source.rootId,
    relativePath: input.source.relativePath,
    immutableVersionId: authority.immutableVersionId,
    contentDigest: input.cloud.contentDigest
  }];
  const core = {
    kind: 'skillmap.import-parity-cutover-receipt' as const,
    schemaVersion: 1 as const,
    accountId: input.accountId,
    deviceId: input.deviceId,
    sessionId: input.cloud.finalized.sessionPublicId,
    finalizedRevision: authority.finalizedRevision,
    immutableVersionId: authority.immutableVersionId,
    manifestDigest: input.cloud.manifestDigest,
    contentDigest: input.cloud.contentDigest,
    verificationDigest: input.cloud.finalized.verificationDigest,
    fileCount: cloudFiles.length,
    byteTotal: cloudBytes,
    parityState: 'PARITY_CONFIRMED' as const,
    cutoverState: 'CUTOVER_AUTHORIZED' as const,
    ownerConsentId: authority.ownerConsentId,
    consentDigest: authority.consentDigest,
    explicitConsentAt: authority.explicitConsentAt,
    consentExpiresAt: authority.consentExpiresAt,
    cutoverAuthorityId: authority.cutoverAuthorityId,
    eligibleCandidates,
    issuedAt,
    expiresAt
  };
  const receiptId = `par_${digest(core).slice('sha256:'.length, 'sha256:'.length + 32)}`;
  const receiptWithoutDigest = { ...core, receiptId };
  return { ...receiptWithoutDigest, receiptDigest: digest(receiptWithoutDigest) };
}

export function validateImportParityReceipt(receipt: ImportParityReceipt, now: Date = new Date()): void {
  const keys = [
    'kind', 'schemaVersion', 'receiptId', 'accountId', 'deviceId', 'sessionId', 'finalizedRevision',
    'immutableVersionId', 'manifestDigest', 'contentDigest', 'verificationDigest', 'fileCount', 'byteTotal',
    'parityState', 'cutoverState', 'ownerConsentId', 'consentDigest', 'explicitConsentAt',
    'consentExpiresAt', 'cutoverAuthorityId', 'eligibleCandidates', 'issuedAt', 'expiresAt', 'receiptDigest'
  ].sort();
  if (!receipt || typeof receipt !== 'object' || Object.keys(receipt).sort().join('\n') !== keys.join('\n')) {
    invalid('Parity receipt shape is invalid.');
  }
  const { receiptDigest, receiptId, ...core } = receipt;
  const expectedId = `par_${digest(core).slice('sha256:'.length, 'sha256:'.length + 32)}`;
  if (receipt.kind !== 'skillmap.import-parity-cutover-receipt' || receipt.schemaVersion !== 1
    || receiptId !== expectedId || receiptDigest !== digest({ ...core, receiptId })
    || !ACCOUNT_ID.test(receipt.accountId) || !DEVICE_ID.test(receipt.deviceId)
    || !SESSION_ID.test(receipt.sessionId) || !VERSION_ID.test(receipt.immutableVersionId)
    || !Number.isSafeInteger(receipt.finalizedRevision) || receipt.finalizedRevision < 1
    || !DIGEST.test(receipt.manifestDigest) || !DIGEST.test(receipt.contentDigest)
    || !DIGEST.test(receipt.verificationDigest) || !DIGEST.test(receipt.consentDigest)
    || receipt.parityState !== 'PARITY_CONFIRMED' || receipt.cutoverState !== 'CUTOVER_AUTHORIZED'
    || !CONSENT_ID.test(receipt.ownerConsentId) || !CUTOVER_ID.test(receipt.cutoverAuthorityId)
    || !Number.isSafeInteger(receipt.fileCount) || receipt.fileCount < 1 || receipt.fileCount > 2_048
    || !Number.isSafeInteger(receipt.byteTotal) || receipt.byteTotal < 0
    || !Array.isArray(receipt.eligibleCandidates) || receipt.eligibleCandidates.length !== 1) {
    invalid('Parity receipt binding is invalid.');
  }
  const candidate = receipt.eligibleCandidates[0]!;
  if (!SOURCE_OBJECT_ID.test(candidate.sourceObjectId) || !ROOT_ID.test(candidate.rootId)
    || !safeRelativePath(candidate.relativePath) || candidate.immutableVersionId !== receipt.immutableVersionId
    || candidate.contentDigest !== receipt.contentDigest) invalid('Parity receipt candidate is invalid.');
  const issuedMs = Date.parse(receipt.issuedAt);
  const expiresMs = Date.parse(receipt.expiresAt);
  const consentAtMs = Date.parse(receipt.explicitConsentAt);
  const consentExpiresMs = Date.parse(receipt.consentExpiresAt);
  if (![issuedMs, expiresMs, consentAtMs, consentExpiresMs, now.getTime()].every(Number.isFinite)
    || consentAtMs >= consentExpiresMs || issuedMs >= expiresMs
    || expiresMs - issuedMs > MAX_RECEIPT_TTL_MS || expiresMs > consentExpiresMs) {
    invalid('Parity receipt time binding is invalid.');
  }
  if (now.getTime() >= expiresMs || now.getTime() >= consentExpiresMs) {
    throw new ImportParityError('CONSENT_EXPIRED', 'Parity or owner consent authority has expired.');
  }
}
