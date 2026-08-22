import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import {
  buildImportManifest,
  type BuildImportManifestOptions,
  type ImportManifestResult
} from '../core/import-manifest-builder.js';
import { encodeContentDigest } from '../core/immutable-content-digest.js';
import { ImportParityError, issueImportParityReceipt, type ImportParityReceipt } from '../core/import-parity.js';
import {
  ImportClientError,
  type ImportFileReceipt,
  type ImportFinalizeResponse,
  type ImportPreparedTarget,
  type ImportSession,
  type PrepareImportTargetInput
} from '../network/import-client.js';
import { type ImportUploadFile } from '../network/import-uploader.js';

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export interface ManagedImportRequest {
  skillDir: string;
  sourceObjectId: string;
  rootId: string;
  relativePath: string;
  manifestOptions: BuildImportManifestOptions;
  /** Stable across retries of one import attempt. Defaults to the current time. */
  sessionStartedAt?: string;
}

export interface ManagedImportAuthLike {
  getAuthStatus(): Promise<{
    state: string;
    authenticated: boolean;
    accountPublicId?: string;
    devicePublicId?: string;
    scopes?: string[];
  }>;
  getAccessToken(): Promise<string>;
}

export interface ManagedImportClientLike {
  prepareImportTarget(
    input: PrepareImportTargetInput,
    options?: { accessToken?: string }
  ): Promise<ImportPreparedTarget>;
  beginImportSession(
    params: {
      skillPublicId: string;
      versionPublicId: string;
      manifestSchemaVersion: string;
      manifestDigest: string;
      contentDigest: string;
      expectedFileCount: number;
      expectedByteTotal: number;
      expiresAt: string;
      idempotencyKey?: string;
    },
    options?: { accessToken?: string }
  ): Promise<ImportSession>;
  finalizeImportSession(
    params: { sessionPublicId: string; expectedRevision: number; idempotencyKey?: string },
    options?: { accessToken?: string }
  ): Promise<ImportFinalizeResponse>;
  listReceipts(
    params: { sessionPublicId: string; expectedRevision?: number },
    options?: { accessToken?: string }
  ): Promise<{ sessionPublicId: string; receipts: ImportFileReceipt[] }>;
}

export interface ManagedImportUploaderLike {
  uploadFiles(params: {
    session: ImportSession;
    files: ImportUploadFile[];
    accessToken?: string;
  }): Promise<{
    session: ImportSession;
    uploaded: ImportUploadFile[];
    skipped: ImportUploadFile[];
    conflicts: unknown[];
    failed: unknown[];
    progress: {
      acceptedFileCount: number;
      acceptedByteTotal: number;
      expectedFileCount: number;
      expectedByteTotal: number;
      percentComplete: number;
    };
  }>;
}

export interface ManagedImportDependencies {
  auth: ManagedImportAuthLike;
  client: ManagedImportClientLike;
  uploader: ManagedImportUploaderLike;
  now?: () => Date;
}

export interface ManagedImportResult {
  state: 'blocked' | 'awaiting_owner_consent' | 'verified';
  skillPublicId?: string;
  versionPublicId?: string;
  releasePublicId?: string;
  sessionPublicId?: string;
  acceptedFileCount?: number;
  acceptedByteTotal?: number;
  blockedItems?: Array<{ path?: string; reason: string; detail?: string; retryable: boolean }>;
  parityReceipt?: ImportParityReceipt;
}

interface CompleteManagedImportInput {
  request: ManagedImportRequest;
  client: ManagedImportClientLike;
  target: ImportPreparedTarget;
  manifestResult: ImportManifestResult;
  accountPublicId: string;
  devicePublicId: string;
  contentDigest: string;
  sessionPublicId: string;
  expectedRevision: number;
  acceptedFileCount: number;
  acceptedByteTotal: number;
  accessToken: string;
  now: () => Date;
  operationBinding: string[];
}

export class ManagedImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ManagedImportError';
    this.code = code;
  }
}

function assertPreUploadParity(manifestResult: ImportManifestResult, receipts: ImportFileReceipt[]): void {
  if (receipts.length === 0) return;
  const localByPath = new Map(manifestResult.files.map((file) => [file.path, file]));
  const missingPaths: string[] = [];
  const changedPaths: string[] = [];
  for (const receipt of receipts) {
    const local = localByPath.get(receipt.relativePath);
    if (!local) {
      missingPaths.push(receipt.relativePath);
    } else if (local.utf8_bytes !== receipt.acceptedByteSize || local.digest !== receipt.fileDigest) {
      changedPaths.push(receipt.relativePath);
    }
  }
  if (missingPaths.length > 0 || changedPaths.length > 0) {
    throw new ImportParityError(
      'PARITY_MISMATCH',
      'Local source has changed since the previous upload.',
      { missingPaths: missingPaths.sort(), extraPaths: [], changedPaths: changedPaths.sort(), manifestChanged: false }
    );
  }
}

function sameSnapshot(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

async function readVerifiedFile(skillDir: string, file: ImportManifestResult['files'][number]): Promise<Buffer> {
  const segments = file.path.split('/');
  const root = path.resolve(skillDir);
  const absolutePath = path.resolve(root, ...segments);
  const relative = path.relative(root, absolutePath);
  if (relative.split(path.sep).join('/') !== file.path || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'The local import source is no longer safe.');
  }

  try {
    const before = await lstat(absolutePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== file.utf8_bytes) {
      throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'The local import source changed after scanning.');
    }
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!sameSnapshot(opened, before)) {
        throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'The local import source changed while opening.');
      }
      const bytes = Buffer.alloc(file.utf8_bytes);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
        if (result.bytesRead <= 0) {
          throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'The local import source produced a short read.');
        }
        offset += result.bytesRead;
      }
      const overflow = Buffer.allocUnsafe(1);
      if ((await handle.read(overflow, 0, 1, bytes.length)).bytesRead !== 0) {
        throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'The local import source grew while reading.');
      }
      const after = await handle.stat();
      if (!sameSnapshot(after, opened)) {
        throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'The local import source changed while reading.');
      }
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (digest !== file.digest) {
        throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'The local import source digest changed after scanning.');
      }
      return bytes;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof ManagedImportError) throw error;
    throw new ManagedImportError('IMPORT_SOURCE_CHANGED', 'The local import source could not be read safely.');
  }
}

async function readUploadSnapshot(
  skillDir: string,
  manifestResult: ImportManifestResult
): Promise<Array<Omit<ImportUploadFile, 'filePublicId'>>> {
  const files: Array<Omit<ImportUploadFile, 'filePublicId'>> = [];
  for (const file of manifestResult.files) {
    files.push({
      relativePath: file.path,
      mediaType: file.media_type,
      byteSize: file.utf8_bytes,
      digest: file.digest,
      bytes: await readVerifiedFile(skillDir, file)
    });
  }
  return files;
}

function idempotencyKey(domain: string, parts: string[]): string {
  const hash = createHash('sha256');
  hash.update(`skillmap.m4.${domain}\0v1\0`, 'utf8');
  for (const part of parts) {
    hash.update(part, 'utf8');
    hash.update('\0', 'utf8');
  }
  return hash.digest().subarray(0, 16).toString('base64url');
}

function bindTargetFiles(
  snapshot: Array<Omit<ImportUploadFile, 'filePublicId'>>,
  targetFiles: ImportPreparedTarget['files']
): ImportUploadFile[] {
  const targetByPath = new Map(targetFiles.map((file) => [file.relativePath, file]));
  if (targetByPath.size !== targetFiles.length || snapshot.length !== targetFiles.length) {
    throw new ImportClientError(502, 'invalid_response');
  }
  return snapshot.map((file) => {
    const target = targetByPath.get(file.relativePath);
    if (!target
      || target.byteSize !== file.byteSize
      || target.fileDigest !== file.digest
      || target.mediaType !== file.mediaType) {
      throw new ImportClientError(502, 'invalid_response');
    }
    return { ...file, filePublicId: target.filePublicId };
  });
}

async function completeManagedImport(input: CompleteManagedImportInput): Promise<ManagedImportResult> {
  try {
    const finalized = await input.client.finalizeImportSession(
      {
        sessionPublicId: input.sessionPublicId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: idempotencyKey('finalize-session', input.operationBinding)
      },
      { accessToken: input.accessToken }
    );
    const receiptResponse = await input.client.listReceipts(
      { sessionPublicId: finalized.sessionPublicId, expectedRevision: finalized.finalizedRevision },
      { accessToken: input.accessToken }
    );
    const parityReceipt = await issueImportParityReceipt({
      accountId: input.accountPublicId,
      deviceId: input.devicePublicId,
      source: {
        sourceObjectId: input.request.sourceObjectId,
        rootId: input.request.rootId,
        relativePath: input.request.relativePath,
        skillDir: input.request.skillDir,
        manifestOptions: input.request.manifestOptions
      },
      cloud: {
        manifestDigest: input.manifestResult.manifestDigest!,
        contentDigest: input.contentDigest,
        receipts: receiptResponse.receipts,
        finalized
      },
      now: input.now()
    });
    return {
      state: 'verified',
      skillPublicId: input.target.skillPublicId,
      versionPublicId: input.target.versionPublicId,
      releasePublicId: input.target.releasePublicId,
      sessionPublicId: finalized.sessionPublicId,
      acceptedFileCount: input.acceptedFileCount,
      acceptedByteTotal: input.acceptedByteTotal,
      parityReceipt
    };
  } catch (error) {
    if (error instanceof ImportClientError && error.code === 'owner_consent_required') {
      return {
        state: 'awaiting_owner_consent',
        skillPublicId: input.target.skillPublicId,
        versionPublicId: input.target.versionPublicId,
        releasePublicId: input.target.releasePublicId,
        sessionPublicId: input.sessionPublicId,
        acceptedFileCount: input.acceptedFileCount,
        acceptedByteTotal: input.acceptedByteTotal
      };
    }
    throw error;
  }
}

export async function runManagedImport(
  request: ManagedImportRequest,
  deps: ManagedImportDependencies
): Promise<ManagedImportResult> {
  const manifestResult = await buildImportManifest(request.skillDir, request.manifestOptions);

  if (!manifestResult.importable || !manifestResult.manifest || !manifestResult.manifestDigest || !manifestResult.canonicalBytes) {
    return {
      state: 'blocked',
      blockedItems: manifestResult.nonImportable
    };
  }

  const uploadSnapshot = await readUploadSnapshot(request.skillDir, manifestResult);
  const digestResult = encodeContentDigest(
    Buffer.from(manifestResult.canonicalBytes),
    manifestResult.manifestDigest,
    uploadSnapshot.map((file) => ({
      path: file.relativePath,
      bytes: Buffer.from(file.bytes),
      size: file.byteSize,
      digest: file.digest
    }))
  );
  const contentDigest = digestResult.contentDigest;

  const authStatus = await deps.auth.getAuthStatus();
  const deviceImportScope = (authStatus.scopes ?? []).includes('device.import');
  if (!authStatus.authenticated || !authStatus.accountPublicId || !authStatus.devicePublicId || !deviceImportScope) {
    throw new ImportClientError(401, 'unauthorized');
  }
  const accessToken = await deps.auth.getAccessToken();

  const { manifest } = manifestResult;
  const now = deps.now ?? (() => new Date());
  const currentNow = now();
  const sessionStartedAt = request.sessionStartedAt === undefined ? currentNow : new Date(request.sessionStartedAt);
  if (!Number.isFinite(sessionStartedAt.getTime())) {
    throw new ManagedImportError('IMPORT_CHECKPOINT_INVALID', 'The import checkpoint is invalid.');
  }
  const sessionExpiresAtDate = new Date(sessionStartedAt.getTime() + SESSION_TTL_MS);
  if (sessionExpiresAtDate.getTime() <= currentNow.getTime()) {
    throw new ManagedImportError('IMPORT_CHECKPOINT_EXPIRED', 'The import checkpoint has expired. Start a fresh import.');
  }
  const sessionExpiresAt = sessionExpiresAtDate.toISOString();
  const operationBinding = [
    authStatus.accountPublicId,
    authStatus.devicePublicId,
    request.sourceObjectId,
    manifestResult.manifestDigest,
    contentDigest,
    sessionStartedAt.toISOString()
  ];

  const prepareFiles = manifestResult.files.map((file, ordinal) => ({
    relativePath: file.path,
    mediaType: file.media_type,
    byteSize: file.utf8_bytes,
    fileDigest: file.digest,
    executable: file.executable,
    ordinal
  }));
  const canonicalDescription = manifest.display.description.trim();

  const target = await deps.client.prepareImportTarget(
    {
      displayName: manifest.display.name,
      description: manifest.display.description,
      manifestSchemaVersion: manifest.schema_version,
      canonicalManifestBytes: manifestResult.canonicalBytes,
      manifestDigest: manifestResult.manifestDigest,
      contentDigest,
      canonicalMetadata: {
        logical_id: manifest.identity.logical_id.trim(),
        display_name: manifest.display.name.trim(),
        ...(canonicalDescription === '' ? {} : { description: canonicalDescription })
      },
      source: { ...manifest.source },
      provenanceState: 'provisional',
      files: prepareFiles,
      idempotencyKey: idempotencyKey('prepare-target', operationBinding)
    },
    { accessToken }
  );

  const expectedFileCount = manifestResult.files.length;
  const expectedByteTotal = manifestResult.files.reduce((sum, file) => sum + file.utf8_bytes, 0);
  const session = await deps.client.beginImportSession(
    {
      skillPublicId: target.skillPublicId,
      versionPublicId: target.versionPublicId,
      manifestSchemaVersion: manifest.schema_version,
      manifestDigest: manifestResult.manifestDigest,
      contentDigest,
      expectedFileCount,
      expectedByteTotal,
      expiresAt: sessionExpiresAt,
      idempotencyKey: idempotencyKey('begin-session', operationBinding)
    },
    { accessToken }
  );

  if (session.state === 'verified') {
    if (session.revision < 2
      || !Number.isSafeInteger(session.finalizationExpectedRevision)
      || (session.finalizationExpectedRevision ?? 0) < 1
      || session.acceptedFileCount !== expectedFileCount
      || session.acceptedByteTotal !== expectedByteTotal
      || session.manifestDigest !== manifestResult.manifestDigest
      || session.contentDigest !== contentDigest) {
      throw new ImportClientError(502, 'invalid_response');
    }
    return completeManagedImport({
      request,
      client: deps.client,
      target,
      manifestResult,
      accountPublicId: authStatus.accountPublicId,
      devicePublicId: authStatus.devicePublicId,
      contentDigest,
      sessionPublicId: session.sessionPublicId,
      expectedRevision: session.finalizationExpectedRevision!,
      acceptedFileCount: session.acceptedFileCount,
      acceptedByteTotal: session.acceptedByteTotal,
      accessToken,
      now,
      operationBinding
    });
  }
  if (session.state !== 'in_progress') {
    throw new ImportClientError(session.state === 'expired' ? 410 : 409, session.state === 'expired' ? 'session_expired' : 'session_conflict');
  }

  const preUploadReceipts = await deps.client.listReceipts(
    { sessionPublicId: session.sessionPublicId, expectedRevision: session.revision },
    { accessToken }
  );
  assertPreUploadParity(manifestResult, preUploadReceipts.receipts);

  const uploadFiles = bindTargetFiles(uploadSnapshot, target.files);
  const uploadResult = await deps.uploader.uploadFiles({ session, files: uploadFiles, accessToken });
  if (uploadResult.conflicts.length !== 0
    || uploadResult.failed.length !== 0
    || uploadResult.progress.percentComplete !== 100
    || uploadResult.progress.acceptedFileCount !== expectedFileCount
    || uploadResult.progress.acceptedByteTotal !== expectedByteTotal
    || uploadResult.session.acceptedFileCount !== expectedFileCount
    || uploadResult.session.acceptedByteTotal !== expectedByteTotal) {
    throw new ManagedImportError('IMPORT_UPLOAD_INCOMPLETE', 'The import upload did not reach exact parity.');
  }

  return completeManagedImport({
    request,
    client: deps.client,
    target,
    manifestResult,
    accountPublicId: authStatus.accountPublicId,
    devicePublicId: authStatus.devicePublicId,
    contentDigest,
    sessionPublicId: uploadResult.session.sessionPublicId,
    expectedRevision: uploadResult.session.revision,
    acceptedFileCount: uploadResult.session.acceptedFileCount,
    acceptedByteTotal: uploadResult.session.acceptedByteTotal,
    accessToken,
    now,
    operationBinding
  });
}
