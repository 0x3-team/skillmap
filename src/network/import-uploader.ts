import { computeSha256 } from '../contracts/device-auth.js';
import { isValidManagedManifestPath } from '../core/managed-manifest.js';
import {
  ImportClient,
  ImportClientError,
  ImportFileReceipt,
  ImportSession,
  ImportUploadMetadata,
  MAX_IMPORT_BYTE_TOTAL,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILE_COUNT
} from './import-client.js';

export interface ImportUploadFile {
  filePublicId: string;
  relativePath: string;
  mediaType: string;
  byteSize: number;
  digest: string;
  bytes: Uint8Array;
}

export interface StorageTransportRequest {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
  signal?: AbortSignal;
}

export interface StorageTransportResponse {
  status: number;
  headers?: Record<string, string | undefined>;
  body?: Uint8Array;
}

export type StorageTransport = (request: StorageTransportRequest) => Promise<StorageTransportResponse>;

export interface ImportUploadConflict {
  file: ImportUploadFile;
  receipt?: ImportFileReceipt;
  reason: 'digest_mismatch' | 'path_mismatch';
}

export interface ImportUploadFailure {
  file: ImportUploadFile;
  error: ImportUploadError;
}

export interface ImportUploadProgressEvent {
  acceptedFileCount: number;
  acceptedByteTotal: number;
  expectedFileCount: number;
  expectedByteTotal: number;
  percentComplete: number;
  currentFile?: string;
}

export interface ImportUploadResult {
  session: ImportSession;
  uploaded: ImportUploadFile[];
  skipped: ImportUploadFile[];
  conflicts: ImportUploadConflict[];
  failed: ImportUploadFailure[];
  progress: ImportUploadProgressEvent;
}

export interface ImportUploaderOptions {
  client: ImportClient;
  trustedUploadOrigins?: readonly string[];
  storageTransport?: StorageTransport;
  concurrency?: number;
  fileTimeoutMs?: number;
  fileMaxRetries?: number;
  retryBaseMs?: number;
  maxRetryAfterMs?: number;
  onProgress?: (event: ImportUploadProgressEvent) => void;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  random?: () => number;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_FILE_TIMEOUT_MS = 30_000;
const DEFAULT_FILE_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;
const STORAGE_MAX_RESPONSE_BYTES = 64 * 1024;

const FILE_PUBLIC_ID_PATTERN = /^msf_[0-9a-f]{32}$/i;

export class ImportUploadError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly filePublicId?: string;
  public readonly status?: number;

  constructor(
    code: string,
    message: string,
    filePublicId?: string,
    retryable = false,
    status?: number
  ) {
    super(message);
    this.name = 'ImportUploadError';
    this.code = code;
    this.retryable = retryable;
    this.filePublicId = filePublicId;
    this.status = status;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The operation was aborted.', 'AbortError');
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1;
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/i.test(value);
}

function defaultStorageTransport(fetchFn: typeof fetch = globalThis.fetch): StorageTransport {
  return async (request) => {
    const response = await fetchFn(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'error',
      signal: request.signal
    });
    const body = await consumeBoundedResponse(response, STORAGE_MAX_RESPONSE_BYTES, request.signal);
    const headers: Record<string, string | undefined> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: response.status, headers, body };
  };
}

async function consumeBoundedResponse(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array | undefined> {
  const contentLength = response.headers.get('content-length');
  if (!response.body && (contentLength === null || contentLength === '0')) {
    return undefined;
  }
  if (contentLength !== null) {
    const size = Number(contentLength);
    if (!Number.isSafeInteger(size) || size < 0) return undefined;
    if (size === 0) return undefined;
    if (size > maxBytes) return undefined;
  }
  if (!response.body) return undefined;
  const abort = signal ?? new AbortController().signal;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (abort.aborted) throw createAbortError();
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (chunks.length === 0) return undefined;
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export class ImportUploader {
  private readonly client: ImportClient;
  private readonly trustedUploadOrigins: readonly string[];
  private readonly storageTransport: StorageTransport;
  private readonly concurrency: number;
  private readonly fileTimeoutMs: number;
  private readonly fileMaxRetries: number;
  private readonly retryBaseMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly onProgress?: (event: ImportUploadProgressEvent) => void;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly clockFn: () => number;
  private readonly randomFn: () => number;
  private acceptanceTail: Promise<void> = Promise.resolve();

  constructor(options: ImportUploaderOptions) {
    if (!options.client) {
      throw new ImportUploadError('invalid_request', 'ImportUploader requires an ImportClient', undefined, false);
    }
    this.client = options.client;
    this.trustedUploadOrigins = options.trustedUploadOrigins
      ?? (Array.isArray((options.client as ImportClient & { trustedUploadOrigins?: readonly string[] }).trustedUploadOrigins)
        ? (options.client as ImportClient & { trustedUploadOrigins: readonly string[] }).trustedUploadOrigins
        : []);
    this.storageTransport = options.storageTransport ?? defaultStorageTransport();
    this.concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY)));
    this.fileTimeoutMs = Math.max(1, Math.min(120_000, Math.floor(options.fileTimeoutMs ?? DEFAULT_FILE_TIMEOUT_MS)));
    this.fileMaxRetries = Math.max(0, Math.min(5, Math.floor(options.fileMaxRetries ?? DEFAULT_FILE_MAX_RETRIES)));
    this.retryBaseMs = Math.max(10, Math.min(60_000, Math.floor(options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS)));
    this.maxRetryAfterMs = Math.max(0, Math.min(300_000, Math.floor(options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS)));
    this.onProgress = options.onProgress;
    this.sleepFn = options.sleep ?? ((ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); }));
    this.clockFn = options.clock ?? (() => Math.floor(Date.now() / 1000));
    this.randomFn = options.random ?? Math.random;
  }

  public async uploadFiles(params: {
    session: ImportSession;
    files: ImportUploadFile[];
    accessToken?: string;
    signal?: AbortSignal;
  }): Promise<ImportUploadResult> {
    throwIfAborted(params.signal);
    const session = this.validateSession(params.session);
    const files = this.validateFiles(params.files, session);

    const receiptResponse = await this.client.listReceipts(
      { sessionPublicId: session.sessionPublicId, expectedRevision: session.revision },
      { accessToken: params.accessToken, signal: params.signal }
    );
    const receipts = receiptResponse.receipts;

    const { ready, skipped, conflicts } = this.reconcileFiles(files, receipts);

    let acceptedCount = skipped.length;
    let acceptedBytes = skipped.reduce((sum, file) => sum + file.byteSize, 0);
    const expectedCount = files.length;
    const expectedBytes = files.reduce((sum, file) => sum + file.byteSize, 0);

    const emitProgress = (currentFile?: string) => {
      const percent = expectedBytes > 0
        ? Math.min(100, Math.round((acceptedBytes / expectedBytes) * 100))
        : 0;
      const event: ImportUploadProgressEvent = {
        acceptedFileCount: acceptedCount,
        acceptedByteTotal: acceptedBytes,
        expectedFileCount: expectedCount,
        expectedByteTotal: expectedBytes,
        percentComplete: percent,
        currentFile
      };
      this.onProgress?.(event);
    };
    emitProgress();

    const uploaded: ImportUploadFile[] = [];
    const failed: ImportUploadFailure[] = [];
    const queue = [...ready];

    const workerCount = Math.min(queue.length, this.concurrency);
    if (workerCount > 0) {
      const workers: Promise<void>[] = [];
      for (let i = 0; i < workerCount; i += 1) {
        workers.push((async () => {
          while (true) {
            throwIfAborted(params.signal);
            const next = queue.shift();
            if (!next) break;
            try {
              const idempotencyKey = this.generateIdempotencyKey();
              const nextSession = await this.uploadOneFileWithRetry(
                next,
                session,
                idempotencyKey,
                params.accessToken,
                params.signal
              );
              this.syncSession(session, nextSession);
              acceptedCount += 1;
              acceptedBytes += next.byteSize;
              uploaded.push(next);
              emitProgress(next.relativePath);
            } catch (error) {
              const uploadError = error instanceof ImportUploadError
                ? error
                : this.toUploadError(error, next);
              if (uploadError.code === 'already_accepted') {
                acceptedCount += 1;
                acceptedBytes += next.byteSize;
                skipped.push(next);
                emitProgress(next.relativePath);
              } else if (uploadError.code === 'digest_conflict') {
                conflicts.push({ file: next, reason: 'digest_mismatch' });
              } else {
                failed.push({ file: next, error: uploadError });
              }
            }
          }
        })());
      }
      await Promise.all(workers);
    }

    const finalProgress: ImportUploadProgressEvent = {
      acceptedFileCount: acceptedCount,
      acceptedByteTotal: acceptedBytes,
      expectedFileCount: expectedCount,
      expectedByteTotal: expectedBytes,
      percentComplete: expectedBytes > 0 ? Math.min(100, Math.round((acceptedBytes / expectedBytes) * 100)) : 0
    };

    return {
      session,
      uploaded,
      skipped,
      conflicts,
      failed,
      progress: finalProgress
    };
  }

  private validateSession(session: unknown): ImportSession {
    if (typeof session !== 'object' || session === null) {
      throw new ImportUploadError('invalid_request', 'Session must be an object', undefined, false);
    }
    const s = session as ImportSession;
    if (s.state !== 'in_progress') {
      throw new ImportUploadError('session_expired', `Session is not in progress: ${s.state}`, s.sessionPublicId, false);
    }
    if (!isPositiveSafeInteger(s.revision)) {
      throw new ImportUploadError('invalid_request', 'Session revision must be a positive integer', s.sessionPublicId, false);
    }
    return s;
  }

  private validateFiles(files: ImportUploadFile[], session: ImportSession): ImportUploadFile[] {
    if (!Array.isArray(files) || files.length === 0) {
      throw new ImportUploadError('invalid_request', 'Files must be a non-empty array', undefined, false);
    }
    if (files.length > MAX_IMPORT_FILE_COUNT) {
      throw new ImportUploadError('invalid_request', `File count exceeds ${MAX_IMPORT_FILE_COUNT}`, undefined, false);
    }
    if (files.length !== session.expectedFileCount) {
      throw new ImportUploadError('invalid_request', 'File count does not match session expected count', session.sessionPublicId, false);
    }
    const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
    if (totalBytes !== session.expectedByteTotal) {
      throw new ImportUploadError('invalid_request', 'Total bytes do not match session expected bytes', session.sessionPublicId, false);
    }
    if (totalBytes > MAX_IMPORT_BYTE_TOTAL) {
      throw new ImportUploadError('invalid_request', 'Total bytes exceed limit', session.sessionPublicId, false);
    }

    const seenIds = new Set<string>();
    const seenPathCaseFolds = new Set<string>();
    for (const file of files) {
      if (!FILE_PUBLIC_ID_PATTERN.test(file.filePublicId)) {
        throw new ImportUploadError('invalid_request', `Invalid file public id: ${file.filePublicId}`, file.filePublicId, false);
      }
      if (seenIds.has(file.filePublicId)) {
        throw new ImportUploadError('invalid_request', `Duplicate file public id: ${file.filePublicId}`, file.filePublicId, false);
      }
      seenIds.add(file.filePublicId);

      const pathValidation = typeof file.relativePath === 'string'
        ? isValidManagedManifestPath(file.relativePath, seenPathCaseFolds)
        : { ok: false as const };
      if (!pathValidation.ok) {
        throw new ImportUploadError('invalid_request', `Invalid relative path: ${file.relativePath}`, file.filePublicId, false);
      }

      if (typeof file.mediaType !== 'string' || file.mediaType.length === 0 || file.mediaType.length > 128) {
        throw new ImportUploadError('invalid_request', `Invalid media type: ${file.mediaType}`, file.filePublicId, false);
      }
      if (!isNonNegativeSafeInteger(file.byteSize) || file.byteSize > MAX_IMPORT_FILE_BYTES) {
        throw new ImportUploadError('invalid_request', `Invalid byte size: ${file.byteSize}`, file.filePublicId, false);
      }
      if (!isSha256Digest(file.digest)) {
        throw new ImportUploadError('invalid_request', `Invalid digest: ${file.digest}`, file.filePublicId, false);
      }
      if (!(file.bytes instanceof Uint8Array) || file.bytes.length !== file.byteSize) {
        throw new ImportUploadError('invalid_request', 'File bytes do not match declared size', file.filePublicId, false);
      }
    }
    return files;
  }

  private reconcileFiles(files: ImportUploadFile[], receipts: ImportFileReceipt[]): {
    ready: ImportUploadFile[];
    skipped: ImportUploadFile[];
    conflicts: ImportUploadConflict[];
  } {
    const byId = new Map<string, ImportFileReceipt>();
    for (const receipt of receipts) {
      byId.set(receipt.filePublicId, receipt);
    }
    const ready: ImportUploadFile[] = [];
    const skipped: ImportUploadFile[] = [];
    const conflicts: ImportUploadConflict[] = [];

    for (const file of files) {
      const receipt = byId.get(file.filePublicId);
      if (!receipt) {
        ready.push(file);
        continue;
      }
      if (receipt.fileDigest === file.digest && receipt.acceptedByteSize === file.byteSize) {
        if (receipt.relativePath === file.relativePath) {
          skipped.push(file);
        } else {
          conflicts.push({ file, receipt, reason: 'path_mismatch' });
        }
        continue;
      }
      conflicts.push({ file, receipt, reason: 'digest_mismatch' });
    }
    return { ready, skipped, conflicts };
  }

  private async uploadOneFileWithRetry(
    file: ImportUploadFile,
    session: ImportSession,
    idempotencyKey: string,
    accessToken: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<ImportSession> {
    let currentSession = session;
    let lastError: ImportUploadError | undefined;
    for (let attempt = 0; attempt <= this.fileMaxRetries; attempt += 1) {
      try {
        const nextSession = await this.uploadOneFile(file, currentSession, idempotencyKey, accessToken, signal);
        return nextSession;
      } catch (error) {
        lastError = error instanceof ImportUploadError ? error : this.toUploadError(error, file);
        if (lastError.code === 'already_accepted') {
          // A lost accept response means the server revision is expected to be
          // newer. Fetch the current read-only projection without asserting the
          // stale local revision, then bind every later mutation to that result.
          return this.withAcceptanceLock(async () => this.syncSession(
            currentSession,
            await this.client.resumeImportSession(
              { sessionPublicId: currentSession.sessionPublicId },
              { accessToken, signal }
            )
          ));
        }
        if (lastError.code === 'digest_conflict') {
          throw lastError;
        }
        if (lastError.code === 'session_conflict') {
          try {
            // This is an authoritative read used to recover the revision that
            // the failed mutation proved was stale.
            const resumed = await this.client.resumeImportSession(
              { sessionPublicId: currentSession.sessionPublicId },
              { accessToken, signal }
            );
            currentSession = resumed;
          } catch (resumeError) {
            lastError = this.toUploadError(resumeError, file);
          }
          if (attempt < this.fileMaxRetries) continue;
        }
        if (!lastError.retryable || attempt >= this.fileMaxRetries) {
          throw lastError;
        }
        await this.sleepWithAbort(this.backoff(attempt), signal);
      }
    }
    throw lastError ?? new ImportUploadError('temporarily_unavailable', 'Upload retries exhausted', file.filePublicId, true);
  }

  private async uploadOneFile(
    file: ImportUploadFile,
    session: ImportSession,
    idempotencyKey: string,
    accessToken: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<ImportSession> {
    const actualDigest = computeSha256(file.bytes);
    if (actualDigest !== file.digest) {
      throw new ImportUploadError('digest_mismatch', 'File bytes do not match manifest digest', file.filePublicId, false);
    }

    const fileAbort = new AbortController();
    const timeout = setTimeout(() => {
      fileAbort.abort();
    }, this.fileTimeoutMs);
    const onParentAbort = () => fileAbort.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const metadata = await this.client.prepareUpload(
        {
          sessionPublicId: session.sessionPublicId,
          filePublicId: file.filePublicId,
          expectedRevision: session.revision
        },
        { accessToken, signal: fileAbort.signal, idempotencyKey }
      );

      if (metadata.declaredSize !== file.byteSize) {
        throw new ImportUploadError('prepare_rejected', 'Declared size does not match file byte size', file.filePublicId, false);
      }
      if (metadata.contentType !== file.mediaType) {
        throw new ImportUploadError('prepare_rejected', 'Content type does not match file media type', file.filePublicId, false);
      }
      if (!this.isTrustedUploadUrl(metadata.uploadUrl)) {
        throw new ImportUploadError('invalid_response', 'Signed upload origin is not trusted', file.filePublicId, false);
      }

      const headers: Record<string, string> = {
        'Content-Type': file.mediaType,
        'Content-Length': String(file.byteSize),
        'Cache-Control': 'no-store'
      };
      if (metadata.uploadAuthorization) {
        headers['Authorization'] = metadata.uploadAuthorization;
      }

      const storageResponse = await this.storageTransport({
        method: 'PUT',
        url: metadata.uploadUrl,
        headers,
        body: file.bytes,
        signal: fileAbort.signal
      });

      if (storageResponse.status === 409) {
        return this.acceptPreparedFile(file, session, idempotencyKey, accessToken, fileAbort.signal);
      }
      if (storageResponse.status < 200 || storageResponse.status >= 300) {
        const retryable = storageResponse.status >= 500 || storageResponse.status === 408 || storageResponse.status === 429;
        throw new ImportUploadError('upload_rejected', `Storage upload failed: ${storageResponse.status}`, file.filePublicId, retryable, storageResponse.status);
      }

      return this.acceptPreparedFile(file, session, idempotencyKey, accessToken, fileAbort.signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  private isTrustedUploadUrl(value: string): boolean {
    try {
      return this.trustedUploadOrigins.includes(new URL(value).origin);
    } catch {
      return false;
    }
  }

  private async acceptPreparedFile(
    file: ImportUploadFile,
    session: ImportSession,
    idempotencyKey: string,
    accessToken: string | undefined,
    signal: AbortSignal
  ): Promise<ImportSession> {
    return this.withAcceptanceLock(async () => {
      try {
        const result = await this.client.acceptFile(
          {
            sessionPublicId: session.sessionPublicId,
            filePublicId: file.filePublicId,
            expectedRevision: session.revision,
            fileDigest: file.digest,
            byteSize: file.byteSize
          },
          { accessToken, signal, idempotencyKey }
        );
        return this.syncSession(session, result);
      } catch (error) {
        if (!(error instanceof ImportClientError) || error.code !== 'already_accepted') throw error;
        // The accepted mutation may have committed even though its response was
        // lost. Refresh without a stale revision precondition, then continue
        // with the returned authoritative revision.
        const resumed = await this.client.resumeImportSession(
          { sessionPublicId: session.sessionPublicId },
          { accessToken, signal }
        );
        return this.syncSession(session, resumed);
      }
    });
  }

  private syncSession(target: ImportSession, source: ImportSession): ImportSession {
    target.sessionPublicId = source.sessionPublicId;
    target.state = source.state;
    target.expectedFileCount = source.expectedFileCount;
    target.expectedByteTotal = source.expectedByteTotal;
    target.acceptedFileCount = source.acceptedFileCount;
    target.acceptedByteTotal = source.acceptedByteTotal;
    target.revision = source.revision;
    target.expiresAt = source.expiresAt;
    if (source.manifestDigest !== undefined) target.manifestDigest = source.manifestDigest;
    if (source.contentDigest !== undefined) target.contentDigest = source.contentDigest;
    if (source.verificationDigest !== undefined) target.verificationDigest = source.verificationDigest;
    if (source.finalizationExpectedRevision !== undefined) {
      target.finalizationExpectedRevision = source.finalizationExpectedRevision;
    }
    return target;
  }

  private async withAcceptanceLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.acceptanceTail;
    let release: () => void = () => {};
    this.acceptanceTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private toUploadError(error: unknown, file: ImportUploadFile): ImportUploadError {
    if (error instanceof ImportUploadError) {
      return error;
    }
    if (error instanceof ImportClientError) {
      switch (error.code) {
        case 'temporarily_unavailable':
        case 'rate_limited':
          return new ImportUploadError('temporarily_unavailable', error.description, file.filePublicId, true, error.status);
        case 'session_conflict':
          return new ImportUploadError('session_conflict', error.description, file.filePublicId, true, error.status);
        case 'already_accepted':
          return new ImportUploadError('already_accepted', error.description, file.filePublicId, false, error.status);
        case 'session_not_found':
        case 'session_expired':
        case 'unauthorized':
        case 'insufficient_scope':
          return new ImportUploadError(error.code, error.description, file.filePublicId, false, error.status);
        case 'invalid_request':
        case 'invalid_response':
          return new ImportUploadError(error.code, error.description, file.filePublicId, false, error.status);
        default:
          return new ImportUploadError('temporarily_unavailable', error.description, file.filePublicId, true, error.status);
      }
    }
    if (isAbortError(error)) {
      return new ImportUploadError('upload_timeout', 'Upload aborted or timed out', file.filePublicId, false);
    }
    if (error instanceof Error) {
      return new ImportUploadError('temporarily_unavailable', error.message, file.filePublicId, true);
    }
    return new ImportUploadError('temporarily_unavailable', 'Unknown upload error', file.filePublicId, true);
  }

  private generateIdempotencyKey(): string {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(this.randomFn() * 256);
    }
    const key = Buffer.from(bytes).toString('base64url');
    return key.length === 22 ? key : key.slice(0, 22);
  }

  private backoff(attempt: number): number {
    const base = this.retryBaseMs * (2 ** attempt);
    const jitter = Math.floor(this.randomFn() * this.retryBaseMs);
    return Math.min(this.maxRetryAfterMs, base + jitter);
  }

  private async sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        cleanup();
        resolve();
      }, ms);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(createAbortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      function cleanup(): void {
        signal?.removeEventListener('abort', onAbort);
      }
    });
  }
}
