import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  buildProofPreimageV2,
  computeSha256,
  DEVICE_AUTH_ABSENT_ACCESS_TOKEN,
  DEVICE_AUTH_AUDIENCE_V1,
  DEVICE_AUTH_SUITE_V2,
  normalizeAndValidateOrigin,
  toBase64Url,
  type DeviceAuthProofPurpose
} from '../contracts/device-auth.js';
import type { DeviceKeyStore } from '../platform/device-key-store.js';

export const IMPORT_CLIENT_DEFAULT_TIMEOUT_MS = 30_000;
export const IMPORT_CLIENT_MAX_TIMEOUT_MS = 120_000;
export const IMPORT_CLIENT_DEFAULT_MAX_RETRIES = 2;
export const IMPORT_CLIENT_MAX_RETRIES = 3;
export const IMPORT_CLIENT_DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const IMPORT_CLIENT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const IMPORT_CLIENT_DEFAULT_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const IMPORT_CLIENT_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const IMPORT_CLIENT_DEFAULT_MAX_RETRY_AFTER_MS = 5_000;
export const IMPORT_CLIENT_MAX_RETRY_AFTER_MS = 30_000;
export const IMPORT_CLIENT_RESPONSE_CLOCK_SKEW_SECONDS = 30;

export const MAX_IMPORT_FILE_COUNT = 2_048;
export const MAX_IMPORT_BYTE_TOTAL = 64 * 1024 * 1024;
export const MAX_IMPORT_FILE_BYTES = 16 * 1024 * 1024;

export type ImportClientErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'insufficient_scope'
  | 'session_not_found'
  | 'session_expired'
  | 'session_conflict'
  | 'owner_consent_required'
  | 'already_accepted'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'invalid_response';

const IMPORT_ERROR_DESCRIPTIONS: Record<ImportClientErrorCode, string> = {
  invalid_request: 'The import request is invalid.',
  unauthorized: 'The import request is not authorized.',
  insufficient_scope: 'The device token does not permit this import operation.',
  session_not_found: 'The import session was not found.',
  session_expired: 'The import session has expired.',
  session_conflict: 'The import session conflicts with a concurrent operation.',
  owner_consent_required: 'Owner consent is required before this import can be finalized.',
  already_accepted: 'The file is already accepted in this session.',
  rate_limited: 'Too many import requests.',
  temporarily_unavailable: 'The import service is temporarily unavailable.',
  invalid_response: 'The import service returned an invalid response.'
};

export class ImportClientError extends Error {
  public readonly status: number;
  public readonly code: ImportClientErrorCode;
  public readonly description: string;
  public readonly retryAfter?: number;

  constructor(status: number, code: ImportClientErrorCode, descriptionOverride?: string, retryAfter?: number) {
    const fixedDescription = IMPORT_ERROR_DESCRIPTIONS[code] ?? 'Import client error';
    super(`[${status}] ${code}: ${descriptionOverride ?? fixedDescription}`);
    this.name = 'ImportClientError';
    this.status = status;
    this.code = code;
    this.description = descriptionOverride ?? fixedDescription;
    this.retryAfter = retryAfter;
  }
}

class ImportDeadlineExceeded extends Error {
  public constructor() {
    super('Import request deadline exceeded');
    this.name = 'ImportDeadlineExceeded';
  }
}

export interface ImportClientOptions {
  origin: string;
  keyStore: DeviceKeyStore;
  deviceId: string;
  /** Origins that may receive signed-upload requests and upload credentials. */
  trustedUploadOrigins?: readonly string[];
  fetchFn?: typeof fetch;
  randomBytes?: (count: number) => Uint8Array;
  clock?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
  maxRetryAfterMs?: number;
  production?: boolean;
}

export interface ImportClientResponseMetadata {
  responseIssuedAt?: number;
  responseVersion?: 'v1';
}

export type ImportClientResponse<T> = T & ImportClientResponseMetadata;

export interface ImportSession {
  sessionPublicId: string;
  state: 'in_progress' | 'verified' | 'cancelled' | 'expired';
  expectedFileCount: number;
  expectedByteTotal: number;
  acceptedFileCount: number;
  acceptedByteTotal: number;
  revision: number;
  expiresAt: string;
  manifestDigest?: string;
  contentDigest?: string;
  verificationDigest?: string;
  finalizationExpectedRevision?: number;
}

export interface ImportTargetFile {
  filePublicId: string;
  relativePath: string;
  mediaType: string;
  byteSize: number;
  fileDigest: string;
  storageKey: string;
  executable: boolean;
  ordinal: number;
}

export interface ImportPreparedTarget {
  skillPublicId: string;
  versionPublicId: string;
  releasePublicId: string;
  manifestDigest: string;
  contentDigest: string;
  fileCount: number;
  byteTotal: number;
  reused: boolean;
  files: ImportTargetFile[];
}

export interface PrepareImportTargetInput {
  displayName: string;
  description: string;
  manifestSchemaVersion: string;
  canonicalManifestBytes: Uint8Array;
  manifestDigest: string;
  contentDigest: string;
  canonicalMetadata: Record<string, unknown>;
  source: Record<string, unknown>;
  provenanceState: string;
  files: Array<{
    relativePath: string;
    mediaType: string;
    byteSize: number;
    fileDigest: string;
    executable: boolean;
    ordinal: number;
  }>;
  idempotencyKey?: string;
}

export interface ImportUploadMetadata {
  sessionPublicId: string;
  filePublicId: string;
  versionPublicId: string;
  bucketId: string;
  objectName: string;
  uploadUrl: string;
  uploadExpiresAt: string;
  contentType: string;
  declaredSize: number;
  uploadAuthorization?: string;
}

export interface ImportFileReceipt {
  filePublicId: string;
  relativePath: string;
  acceptedByteSize: number;
  fileDigest: string;
  ordinal: number;
}

export interface ImportReceiptsResponse {
  sessionPublicId: string;
  revision: number;
  receipts: ImportFileReceipt[];
}

export interface ImportFinalizeResponse {
  sessionPublicId: string;
  state: 'verified';
  verificationDigest: string;
  versionPublicId?: string;
  finalizedRevision?: number;
  ownerConsentId?: string;
  consentDigest?: string;
  explicitConsentAt?: string;
  consentExpiresAt?: string;
  cutoverAuthorityId?: string;
}

export interface ImportCallOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
  accessToken?: string;
}

const IMPORT_SESSION_ID_PATTERN = /^imp_[0-9a-f]{32}$/i;
const SKILL_PUBLIC_ID_PATTERN = /^msk_[0-9a-f]{32}$/i;
const VERSION_PUBLIC_ID_PATTERN = /^msv_[0-9a-f]{32}$/i;
const FILE_PUBLIC_ID_PATTERN = /^msf_[0-9a-f]{32}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const ISO8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const STORAGE_OBJECT_NAME_PATTERN = /^v1\/msv_[0-9a-f]{32}\/msf_[0-9a-f]{32}$/i;
const PUBLIC_ID_FIELD_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function boundedOption(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasObjectFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  return fields.every((field) => field in value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
  return typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value);
}

function isIso8601Utc(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO8601_UTC_PATTERN.test(value)) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const match = value.match(/\.(\d{1,9})Z$/);
  if (!match) {
    return d.toISOString().replace(/\.000Z$/, 'Z') === value;
  }
  const ms = match[1].padEnd(3, '0').slice(0, 3);
  const canonical = `${value.slice(0, match.index)}.${ms}Z`;
  return d.toISOString() === canonical;
}

function isImportSessionId(value: unknown): value is string {
  return typeof value === 'string' && IMPORT_SESSION_ID_PATTERN.test(value);
}

function isSkillPublicId(value: unknown): value is string {
  return typeof value === 'string' && SKILL_PUBLIC_ID_PATTERN.test(value);
}

function isVersionPublicId(value: unknown): value is string {
  return typeof value === 'string' && VERSION_PUBLIC_ID_PATTERN.test(value);
}

function isFilePublicId(value: unknown): value is string {
  return typeof value === 'string' && FILE_PUBLIC_ID_PATTERN.test(value);
}

function isValidSessionState(value: unknown): value is ImportSession['state'] {
  return value === 'in_progress' || value === 'verified' || value === 'cancelled' || value === 'expired';
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

function generate22CharBase64Url(randomBytes: (count: number) => Uint8Array): string {
  return toBase64Url(randomBytes(16));
}

function parseResponseIssuedAt(value: string | null, required: boolean, now: number): number | undefined {
  if (value === null) {
    if (required) throw new ImportClientError(502, 'invalid_response');
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]{0,19})$/.test(value)) throw new ImportClientError(502, 'invalid_response');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ImportClientError(502, 'invalid_response');
  if (required && (!Number.isSafeInteger(now) || now < 0 || Math.abs(now - parsed) > IMPORT_CLIENT_RESPONSE_CLOCK_SKEW_SECONDS)) {
    throw new ImportClientError(502, 'invalid_response');
  }
  return parsed;
}

function isRetryableMethod(method: string, hasIdempotencyKey: boolean): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET'
    || normalized === 'HEAD'
    || normalized === 'OPTIONS'
    || normalized === 'PUT'
    || normalized === 'DELETE'
    || (normalized === 'POST' && hasIdempotencyKey);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isJsonContentType(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return !contentType || /(?:^|\s|;)application\/json(?:\s|;|$)|\+json(?:\s|;|$)/i.test(contentType);
}

function errorCodeForStatus(status: number, payload: unknown): ImportClientErrorCode {
  if (status === 401) return validatedTypedErrorCode(status, payload) ?? 'unauthorized';
  if (status === 403) return 'insufficient_scope';
  if (status === 404) return 'session_not_found';
  if (status === 410) return 'session_expired';
  if (status === 409) return validatedTypedErrorCode(status, payload) ?? 'session_conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status <= 599) return 'temporarily_unavailable';
  if (isPlainObject(payload)
    && typeof payload.error === 'string'
    && payload.error in IMPORT_ERROR_DESCRIPTIONS) {
    const code = payload.error as ImportClientErrorCode;
    if (IMPORT_ERROR_STATUS[code] === status) return code;
  }
  return status >= 500 ? 'temporarily_unavailable' : 'invalid_request';
}

const IMPORT_ERROR_STATUS: Readonly<Record<ImportClientErrorCode, number>> = {
  invalid_request: 400,
  unauthorized: 401,
  insufficient_scope: 403,
  session_not_found: 404,
  session_expired: 410,
  session_conflict: 409,
  owner_consent_required: 409,
  already_accepted: 409,
  rate_limited: 429,
  temporarily_unavailable: 503,
  invalid_response: 502
};

function validatedTypedErrorCode(status: number, payload: unknown): ImportClientErrorCode | undefined {
  if (!isPlainObject(payload)
    || !hasOnlyKeys(payload, ['error', 'error_description', 'retry_after'])
    || typeof payload.error !== 'string'
    || !(payload.error in IMPORT_ERROR_DESCRIPTIONS)
    || payload.error_description !== IMPORT_ERROR_DESCRIPTIONS[payload.error as ImportClientErrorCode]
    || !Number.isSafeInteger(payload.retry_after)
    || (payload.retry_after as number) < 0) {
    return undefined;
  }
  const code = payload.error as ImportClientErrorCode;
  if (IMPORT_ERROR_STATUS[code] !== status) return undefined;
  const mayCarryRetryGuidance = code === 'rate_limited';
  if (!mayCarryRetryGuidance && payload.retry_after !== 0) return undefined;
  return code;
}

function retryAfterSecondsFor(response: Response, payload: unknown, maxRetryAfterMs: number): number | undefined {
  const header = response.headers.get('retry-after');
  let milliseconds: number | undefined;
  if (header) {
    const seconds = Number(header.trim());
    if (Number.isFinite(seconds) && seconds >= 0) {
      milliseconds = seconds * 1000;
    } else {
      const date = Date.parse(header);
      if (Number.isFinite(date)) milliseconds = Math.max(0, date - Date.now());
    }
  }
  if (milliseconds === undefined && isPlainObject(payload) && isNonNegativeSafeInteger(payload.retry_after)) {
    milliseconds = (payload.retry_after as number) * 1000;
  }
  if (milliseconds === undefined) return undefined;
  const bounded = Math.min(milliseconds, maxRetryAfterMs);
  return Math.floor(bounded / 1000);
}

async function readResponseBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) {
    if (response.headers.get('content-length') === '0') return new Uint8Array();
    throw new Error('response body stream unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw createAbortError();
      const result = await readStreamChunk(reader, signal);
      if (result.done) break;
      if (!result.value) throw new Error('response stream chunk unavailable');
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('response too large');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<{ done: boolean; value?: Uint8Array }> {
  if (signal.aborted) {
    void reader.cancel();
    throw createAbortError();
  }
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    void reader.cancel();
    rejectAbort?.(createAbortError());
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([reader.read(), abortPromise]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function toSnakeCaseBody(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[snake] = value;
  }
  return out;
}

export class ImportClient {
  public readonly origin: string;
  public readonly trustedUploadOrigins: readonly string[];
  private readonly keyStore: DeviceKeyStore;
  private readonly deviceId: string;
  private readonly fetchFn: typeof fetch;
  private readonly randomBytesFn: (count: number) => Uint8Array;
  private readonly clockFn: () => number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;
  private readonly maxRetryAfterMs: number;

  constructor(options: ImportClientOptions) {
    try {
      this.origin = normalizeAndValidateOrigin(options.origin);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('HTTP origin')) {
        throw new Error('HTTP origin rejected: HTTPS required for non-local origins');
      }
      if (message.includes('credentials')) throw new Error('Origin must not contain credentials');
      if (message.includes('path')) throw new Error('Origin must not contain path');
      if (message.includes('query')) throw new Error('Origin must not contain query parameters');
      if (message.includes('fragment')) throw new Error('Origin must not contain fragment identifier');
      if (message.includes('protocol')) throw new Error('Invalid origin protocol');
      throw new Error('Invalid origin URL');
    }
    if (options.production === true || process.env.NODE_ENV === 'production') {
      if (!this.origin.startsWith('https://')) {
        throw new Error('Production import client requires HTTPS');
      }
    }
    const configuredUploadOrigins = options.trustedUploadOrigins ?? [this.origin];
    if (!Array.isArray(configuredUploadOrigins) || configuredUploadOrigins.length > 16) {
      throw new Error('Invalid trusted upload origins');
    }
    const normalizedUploadOrigins = configuredUploadOrigins.map((uploadOrigin) => {
      try {
        return normalizeAndValidateOrigin(uploadOrigin);
      } catch {
        throw new Error('Invalid trusted upload origin');
      }
    });
    this.trustedUploadOrigins = Object.freeze([...new Set(normalizedUploadOrigins)]);
    if (typeof options.deviceId !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(options.deviceId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    this.keyStore = options.keyStore;
    this.deviceId = options.deviceId;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.randomBytesFn = options.randomBytes ?? ((count: number) => new Uint8Array(nodeRandomBytes(count)));
    this.clockFn = options.clock ?? (() => Math.floor(Date.now() / 1000));
    this.timeoutMs = boundedOption(options.timeoutMs, IMPORT_CLIENT_DEFAULT_TIMEOUT_MS, 1, IMPORT_CLIENT_MAX_TIMEOUT_MS);
    this.maxRetries = boundedOption(options.maxRetries, IMPORT_CLIENT_DEFAULT_MAX_RETRIES, 0, IMPORT_CLIENT_MAX_RETRIES);
    this.maxResponseBytes = boundedOption(
      options.maxResponseBytes,
      IMPORT_CLIENT_DEFAULT_MAX_RESPONSE_BYTES,
      1,
      IMPORT_CLIENT_MAX_RESPONSE_BYTES
    );
    this.maxRequestBytes = boundedOption(
      options.maxRequestBytes,
      IMPORT_CLIENT_DEFAULT_MAX_REQUEST_BYTES,
      1,
      IMPORT_CLIENT_MAX_REQUEST_BYTES
    );
    this.maxRetryAfterMs = boundedOption(
      options.maxRetryAfterMs,
      IMPORT_CLIENT_DEFAULT_MAX_RETRY_AFTER_MS,
      0,
      IMPORT_CLIENT_MAX_RETRY_AFTER_MS
    );
  }

  public async prepareImportTarget(
    params: PrepareImportTargetInput,
    options?: ImportCallOptions
  ): Promise<ImportClientResponse<ImportPreparedTarget>> {
    throwIfAborted(options?.signal);
    if (typeof params.displayName !== 'string'
      || params.displayName.trim().length < 1
      || Array.from(params.displayName).length > 200
      || new TextEncoder().encode(params.displayName).byteLength > 800) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (typeof params.description !== 'string'
      || Array.from(params.description.normalize('NFC')).length > 2_048
      || new TextEncoder().encode(params.description.normalize('NFC')).byteLength > 8_192) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!/^\d+\.\d+$/.test(params.manifestSchemaVersion)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!(params.canonicalManifestBytes instanceof Uint8Array)
      || params.canonicalManifestBytes.byteLength < 1
      || params.canonicalManifestBytes.byteLength > 262_144
      || !isSha256Digest(params.manifestDigest)
      || !isSha256Digest(params.contentDigest)
      || !isPlainObject(params.canonicalMetadata)
      || !isPlainObject(params.source)
      || typeof params.provenanceState !== 'string'
      || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(params.provenanceState)
      || !Array.isArray(params.files)
      || params.files.length < 1
      || params.files.length > MAX_IMPORT_FILE_COUNT) {
      throw new ImportClientError(400, 'invalid_request');
    }
    let byteTotal = 0;
    const seenPaths = new Set<string>();
    const seenOrdinals = new Set<number>();
    for (const file of params.files) {
      if (!file || typeof file !== 'object'
        || typeof file.relativePath !== 'string'
        || file.relativePath.length < 1
        || file.relativePath.length > 512
        || file.relativePath.startsWith('/')
        || file.relativePath.includes('\\')
        || file.relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
        || typeof file.mediaType !== 'string'
        || file.mediaType.length < 1
        || file.mediaType.length > 128
        || !Number.isSafeInteger(file.byteSize)
        || file.byteSize < 0
        || file.byteSize > MAX_IMPORT_FILE_BYTES
        || !isSha256Digest(file.fileDigest)
        || typeof file.executable !== 'boolean'
        || !Number.isSafeInteger(file.ordinal)
        || file.ordinal < 0
        || seenPaths.has(file.relativePath)
        || seenOrdinals.has(file.ordinal)) {
        throw new ImportClientError(400, 'invalid_request');
      }
      seenPaths.add(file.relativePath);
      seenOrdinals.add(file.ordinal);
      byteTotal += file.byteSize;
    }
    if (byteTotal > MAX_IMPORT_BYTE_TOTAL
      || params.files.some((_, ordinal) => !seenOrdinals.has(ordinal))) {
      throw new ImportClientError(400, 'invalid_request');
    }
    const idempotencyKey = this.resolveIdempotencyKey(params.idempotencyKey);
    const body = toSnakeCaseBody({
      displayName: params.displayName.trim(),
      description: params.description,
      manifestSchemaVersion: params.manifestSchemaVersion,
      manifestProjectionBase64: Buffer.from(params.canonicalManifestBytes).toString('base64'),
      manifestDigest: params.manifestDigest,
      contentDigest: params.contentDigest,
      canonicalMetadata: params.canonicalMetadata,
      source: params.source,
      provenanceState: params.provenanceState,
      files: params.files.map((file) => toSnakeCaseBody(file)),
      idempotencyKey
    });
    return this.request<ImportPreparedTarget>({
      method: 'POST',
      path: '/api/import/v1/targets',
      purpose: 'protected.import',
      body,
      idempotencyKey,
      accessToken: options?.accessToken,
      signal: options?.signal,
      validate: (value) => isImportPreparedTarget(value)
    });
  }

  public async beginImportSession(
    params: {
      skillPublicId: string;
      versionPublicId: string;
      manifestSchemaVersion: string;
      manifestDigest: string;
      contentDigest: string;
      expectedFileCount: number;
      expectedByteTotal: number;
      idempotencyKey?: string;
      expiresAt: string;
    },
    options?: ImportCallOptions
  ): Promise<ImportClientResponse<ImportSession>> {
    throwIfAborted(options?.signal);
    if (!isSkillPublicId(params.skillPublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!isVersionPublicId(params.versionPublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (typeof params.manifestSchemaVersion !== 'string' || params.manifestSchemaVersion.length === 0 || params.manifestSchemaVersion.length > 32) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!isSha256Digest(params.manifestDigest) || !isSha256Digest(params.contentDigest)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!Number.isSafeInteger(params.expectedFileCount) || params.expectedFileCount < 1 || params.expectedFileCount > MAX_IMPORT_FILE_COUNT) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!Number.isSafeInteger(params.expectedByteTotal) || params.expectedByteTotal < 0 || params.expectedByteTotal > MAX_IMPORT_BYTE_TOTAL) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!isIso8601Utc(params.expiresAt)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    const idempotencyKey = this.resolveIdempotencyKey(params.idempotencyKey);
    const body = toSnakeCaseBody({
      skillPublicId: params.skillPublicId,
      versionPublicId: params.versionPublicId,
      manifestSchemaVersion: params.manifestSchemaVersion,
      manifestDigest: params.manifestDigest,
      contentDigest: params.contentDigest,
      expectedFileCount: params.expectedFileCount,
      expectedByteTotal: params.expectedByteTotal,
      idempotencyKey,
      expiresAt: params.expiresAt
    });
    return this.request<ImportSession>({
      method: 'POST',
      path: '/api/import/v1/sessions',
      purpose: 'protected.import',
      body,
      idempotencyKey,
      accessToken: options?.accessToken,
      signal: options?.signal,
      validate: (value) => isImportSessionResponse(value)
    });
  }

  public async resumeImportSession(
    params: { sessionPublicId: string; expectedRevision?: number },
    options?: ImportCallOptions
  ): Promise<ImportClientResponse<ImportSession>> {
    throwIfAborted(options?.signal);
    if (!isImportSessionId(params.sessionPublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (params.expectedRevision !== undefined && !isPositiveSafeInteger(params.expectedRevision)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    const body = toSnakeCaseBody({ expectedRevision: params.expectedRevision });
    return this.request<ImportSession>({
      method: 'POST',
      path: `/api/import/v1/sessions/${params.sessionPublicId}/resume`,
      purpose: 'protected.import',
      body,
      idempotencyKey: this.resolveIdempotencyKey(options?.idempotencyKey),
      accessToken: options?.accessToken,
      signal: options?.signal,
      validate: (value) => {
        const parsed = isImportSessionResponse(value);
        if (parsed === false) return false;
        if (parsed.sessionPublicId !== params.sessionPublicId) return false;
        if (params.expectedRevision !== undefined && parsed.revision !== params.expectedRevision) {
          throw new ImportClientError(409, 'session_conflict');
        }
        return parsed;
      }
    });
  }

  public async finalizeImportSession(
    params: { sessionPublicId: string; expectedRevision: number; idempotencyKey?: string },
    options?: ImportCallOptions
  ): Promise<ImportClientResponse<ImportFinalizeResponse>> {
    throwIfAborted(options?.signal);
    if (!isImportSessionId(params.sessionPublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!isPositiveSafeInteger(params.expectedRevision)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    const idempotencyKey = this.resolveIdempotencyKey(params.idempotencyKey);
    const body = toSnakeCaseBody({ expectedRevision: params.expectedRevision, idempotencyKey });
    return this.request<ImportFinalizeResponse>({
      method: 'POST',
      path: `/api/import/v1/sessions/${params.sessionPublicId}/finalize`,
      purpose: 'protected.import',
      body,
      idempotencyKey,
      accessToken: options?.accessToken,
      signal: options?.signal,
      validate: (value) => {
        const parsed = isImportFinalizeResponse(value);
        if (parsed === false) return false;
        if (parsed.sessionPublicId !== params.sessionPublicId) return false;
        return parsed;
      }
    });
  }

  public async expireImportSession(
    params: { sessionPublicId: string; expectedRevision?: number },
    options?: ImportCallOptions
  ): Promise<ImportClientResponse<ImportSession>> {
    throwIfAborted(options?.signal);
    if (!isImportSessionId(params.sessionPublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (params.expectedRevision !== undefined && !isPositiveSafeInteger(params.expectedRevision)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    const body = toSnakeCaseBody({ expectedRevision: params.expectedRevision });
    return this.request<ImportSession>({
      method: 'POST',
      path: `/api/import/v1/sessions/${params.sessionPublicId}/expire`,
      purpose: 'protected.import',
      body,
      idempotencyKey: this.resolveIdempotencyKey(options?.idempotencyKey),
      accessToken: options?.accessToken,
      signal: options?.signal,
      validate: (value) => {
        const parsed = isImportSessionResponse(value);
        if (parsed === false) return false;
        if (parsed.sessionPublicId !== params.sessionPublicId) return false;
        return parsed;
      }
    });
  }

  public async prepareUpload(
    params: { sessionPublicId: string; filePublicId: string; expectedRevision?: number },
    options?: ImportCallOptions
  ): Promise<ImportClientResponse<ImportUploadMetadata>> {
    throwIfAborted(options?.signal);
    if (!isImportSessionId(params.sessionPublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!isFilePublicId(params.filePublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (params.expectedRevision !== undefined && !isPositiveSafeInteger(params.expectedRevision)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    const body = toSnakeCaseBody({ expectedRevision: params.expectedRevision });
    return this.request<ImportUploadMetadata>({
      method: 'POST',
      path: `/api/import/v1/sessions/${params.sessionPublicId}/files/${params.filePublicId}/prepare-upload`,
      purpose: 'protected.import',
      body,
      idempotencyKey: this.resolveIdempotencyKey(options?.idempotencyKey),
      accessToken: options?.accessToken,
      signal: options?.signal,
      validate: (value) => {
        const parsed = isImportUploadMetadata(value, this.trustedUploadOrigins);
        if (parsed === false) return false;
        if (parsed.sessionPublicId !== params.sessionPublicId) return false;
        if (parsed.filePublicId !== params.filePublicId) return false;
        return parsed;
      }
    });
  }

  public async acceptFile(
    params: { sessionPublicId: string; filePublicId: string; expectedRevision: number; fileDigest: string; byteSize: number },
    options?: ImportCallOptions
  ): Promise<ImportClientResponse<ImportSession>> {
    throwIfAborted(options?.signal);
    if (!isImportSessionId(params.sessionPublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!isFilePublicId(params.filePublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!isPositiveSafeInteger(params.expectedRevision)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!isSha256Digest(params.fileDigest)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (!Number.isSafeInteger(params.byteSize) || params.byteSize < 0 || params.byteSize > MAX_IMPORT_FILE_BYTES) {
      throw new ImportClientError(400, 'invalid_request');
    }
    const idempotencyKey = this.resolveIdempotencyKey(options?.idempotencyKey);
    const body = toSnakeCaseBody({
      expectedRevision: params.expectedRevision,
      fileDigest: params.fileDigest,
      byteSize: params.byteSize
    });
    return this.request<ImportSession>({
      method: 'POST',
      path: `/api/import/v1/sessions/${params.sessionPublicId}/files/${params.filePublicId}/accept`,
      purpose: 'protected.import',
      body,
      idempotencyKey,
      accessToken: options?.accessToken,
      signal: options?.signal,
      validate: (value) => {
        const parsed = isImportSessionResponse(value);
        if (parsed === false) return false;
        if (parsed.sessionPublicId !== params.sessionPublicId) return false;
        return parsed;
      }
    });
  }

  public async listReceipts(
    params: { sessionPublicId: string; expectedRevision?: number },
    options?: ImportCallOptions
  ): Promise<ImportClientResponse<ImportReceiptsResponse>> {
    throwIfAborted(options?.signal);
    if (!isImportSessionId(params.sessionPublicId)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (params.expectedRevision !== undefined && !isPositiveSafeInteger(params.expectedRevision)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    const body = toSnakeCaseBody({ expectedRevision: params.expectedRevision });
    return this.request<ImportReceiptsResponse>({
      method: 'POST',
      path: `/api/import/v1/sessions/${params.sessionPublicId}/receipts`,
      purpose: 'protected.import',
      body,
      idempotencyKey: this.resolveIdempotencyKey(options?.idempotencyKey),
      accessToken: options?.accessToken,
      signal: options?.signal,
      validate: (value) => {
        const parsed = isImportReceiptsResponse(value);
        if (parsed === false) return false;
        if (parsed.sessionPublicId !== params.sessionPublicId) return false;
        if (params.expectedRevision !== undefined && parsed.revision !== params.expectedRevision) {
          throw new ImportClientError(409, 'session_conflict');
        }
        return parsed;
      }
    });
  }

  private resolveIdempotencyKey(provided?: string): string {
    if (provided === undefined) return generate22CharBase64Url(this.randomBytesFn);
    if (!IDEMPOTENCY_KEY_PATTERN.test(provided)) {
      throw new ImportClientError(400, 'invalid_request');
    }
    return provided;
  }

  private async buildHeaders(params: {
    method: string;
    path: string;
    purpose: DeviceAuthProofPurpose;
    bodyUtf8: string;
    idempotencyKey?: string;
    requestId: string;
    accessToken?: string;
  }): Promise<Record<string, string>> {
    const thumbprint = await this.keyStore.getThumbprint();
    if (!thumbprint) {
      throw new ImportClientError(503, 'temporarily_unavailable');
    }
    const deviceId = this.deviceId;
    const nonce = generate22CharBase64Url(this.randomBytesFn);
    const issuedAt = this.clockFn();
    const bodySha256 = computeSha256(params.bodyUtf8);
    const accessTokenSha256 = params.accessToken
      ? computeSha256(params.accessToken)
      : DEVICE_AUTH_ABSENT_ACCESS_TOKEN;

    const preimage = buildProofPreimageV2({
      method: params.method,
      origin: this.origin,
      path: params.path,
      purpose: params.purpose,
      deviceId,
      thumbprint,
      bodySha256,
      idempotencyKey: params.idempotencyKey,
      nonce,
      issuedAt,
      accessTokenSha256
    });

    const proofSignature = await this.keyStore.signProof(preimage);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-SkillMap-Device-Id': deviceId,
      'X-SkillMap-Device-Audience': DEVICE_AUTH_AUDIENCE_V1,
      'X-SkillMap-Device-Proof-Suite': DEVICE_AUTH_SUITE_V2,
      'X-SkillMap-Device-Purpose': params.purpose,
      'X-SkillMap-Device-Nonce': nonce,
      'X-SkillMap-Device-Issued-At': String(issuedAt),
      'X-SkillMap-Device-Body-SHA256': bodySha256,
      'X-SkillMap-Device-Proof': proofSignature,
      'X-Request-Id': params.requestId
    };

    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey;
    }

    if (params.accessToken) {
      headers['Authorization'] = `Bearer ${params.accessToken}`;
    }

    return headers;
  }

  private async request<T>(params: {
    method: string;
    path: string;
    purpose: DeviceAuthProofPurpose;
    body?: unknown;
    idempotencyKey?: string;
    accessToken?: string;
    signal?: AbortSignal;
    validate: (value: unknown) => T | false;
  }): Promise<ImportClientResponse<T>> {
    throwIfAborted(params.signal);
    const path = this.validatePath(params.path);
    let bodyUtf8 = '';
    try {
      bodyUtf8 = params.body !== undefined ? JSON.stringify(params.body) : '';
    } catch {
      throw new ImportClientError(400, 'invalid_request');
    }
    if (new TextEncoder().encode(bodyUtf8).byteLength > this.maxRequestBytes) {
      throw new ImportClientError(400, 'invalid_request');
    }

    const requestId = params.idempotencyKey ?? generate22CharBase64Url(this.randomBytesFn);
    const requestUrl = `${this.origin}${path}`;
    const abortController = new AbortController();
    let callerAborted = Boolean(params.signal?.aborted);
    let rejectCallerAbort: ((reason?: unknown) => void) | undefined;
    const callerAbortPromise = new Promise<never>((_, reject) => {
      rejectCallerAbort = reject;
    });
    const onCallerAbort = () => {
      callerAborted = true;
      abortController.abort();
      rejectCallerAbort?.(createAbortError());
    };
    params.signal?.addEventListener('abort', onCallerAbort, { once: true });
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadlinePromise = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const deadlineTimer = setTimeout(() => {
      abortController.abort();
      rejectDeadline?.(new ImportDeadlineExceeded());
    }, this.timeoutMs);

    try {
      const retryableMethod = isRetryableMethod(params.method, Boolean(params.idempotencyKey));
      let attempt = 0;
      while (true) {
        let headers: Record<string, string>;
        try {
          headers = await Promise.race([
            this.buildHeaders({
              method: params.method,
              path,
              purpose: params.purpose,
              bodyUtf8,
              idempotencyKey: params.idempotencyKey,
              requestId,
              accessToken: params.accessToken
            }),
            deadlinePromise,
            callerAbortPromise
          ]);
        } catch (error: unknown) {
          if (callerAborted) throw createAbortError();
          if (error instanceof ImportDeadlineExceeded || abortController.signal.aborted) {
            throw new ImportClientError(408, 'temporarily_unavailable');
          }
          if (error instanceof ImportClientError) throw error;
          throw new ImportClientError(503, 'temporarily_unavailable');
        }

        let response: Response;
        try {
          response = await Promise.race([
            this.fetchFn(requestUrl, {
              method: params.method,
              headers,
              body: bodyUtf8 || undefined,
              redirect: 'error',
              signal: abortController.signal
            }),
            deadlinePromise,
            callerAbortPromise
          ]) as Response;
        } catch (error: unknown) {
          if (callerAborted) throw createAbortError();
          if (error instanceof ImportDeadlineExceeded) {
            throw new ImportClientError(408, 'temporarily_unavailable');
          }
          if (abortController.signal.aborted) {
            throw new ImportClientError(408, 'temporarily_unavailable');
          }
          if (retryableMethod && attempt < this.maxRetries) {
            attempt += 1;
            await this.sleepBeforeRetry(0, abortController.signal, params.signal);
            continue;
          }
          throw new ImportClientError(503, 'temporarily_unavailable');
        }

        if (response.status >= 300 && response.status < 400) {
          throw new ImportClientError(400, 'invalid_request');
        }

        const isSuccess = response.status >= 200 && response.status < 300;
        let payload: unknown = null;
        let bodyReadFailed = false;
        try {
          payload = await Promise.race([
            this.readJsonResponse(response, abortController.signal),
            deadlinePromise,
            callerAbortPromise
          ]);
        } catch (error: unknown) {
          if (callerAborted) throw createAbortError();
          if (error instanceof ImportDeadlineExceeded) {
            throw new ImportClientError(408, 'temporarily_unavailable');
          }
          if (abortController.signal.aborted) {
            throw new ImportClientError(408, 'temporarily_unavailable');
          }
          bodyReadFailed = true;
        }

        if (isSuccess) {
          if (bodyReadFailed || !isPlainObject(payload) || !isJsonContentType(response)) {
            throw new ImportClientError(502, 'invalid_response');
          }
          const parsed = params.validate(payload);
          if (parsed === false) {
            throw new ImportClientError(502, 'invalid_response');
          }
          const responseIssuedAt = parseResponseIssuedAt(
            response.headers.get('X-SkillMap-Response-Issued-At'),
            false,
            this.clockFn()
          );
          if (responseIssuedAt !== undefined && isPlainObject(parsed)) {
            Object.defineProperty(parsed, 'responseIssuedAt', { value: responseIssuedAt, enumerable: false, configurable: false });
          }
          if (isPlainObject(parsed)) {
            Object.defineProperty(parsed, 'responseVersion', { value: 'v1', enumerable: false, configurable: false });
          }
          return parsed as ImportClientResponse<T>;
        }

        const statusCode = response.status;
        const errorCode = errorCodeForStatus(statusCode, payload);
        const retryAfterSeconds = retryAfterSecondsFor(response, payload, this.maxRetryAfterMs);
        const shouldRetry = retryableMethod && isRetryableStatus(statusCode) && attempt < this.maxRetries;
        if (shouldRetry) {
          attempt += 1;
          await this.sleepBeforeRetry((retryAfterSeconds ?? 0) * 1000, abortController.signal, params.signal);
          continue;
        }

        throw new ImportClientError(statusCode, errorCode, undefined, retryAfterSeconds);
      }
    } finally {
      clearTimeout(deadlineTimer);
      params.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private validatePath(pathInput: string): string {
    if (typeof pathInput !== 'string' || !pathInput.startsWith('/') || pathInput.startsWith('//')) {
      throw new ImportClientError(400, 'invalid_request');
    }
    try {
      const url = new URL(pathInput, this.origin);
      if (url.origin !== this.origin || url.search || url.hash || url.pathname !== pathInput) {
        throw new ImportClientError(400, 'invalid_request');
      }
      return url.pathname;
    } catch (error: unknown) {
      if (error instanceof ImportClientError) throw error;
      throw new ImportClientError(400, 'invalid_request');
    }
  }

  private async readJsonResponse(response: Response, signal: AbortSignal): Promise<unknown> {
    if (!isJsonContentType(response) && response.headers.get('content-type')) {
      throw new Error('non-json response');
    }
    const bytes = await readResponseBytes(response, this.maxResponseBytes, signal);
    if (bytes.length === 0) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new Error('malformed json response');
    }
  }

  private async sleepBeforeRetry(delayMs: number, signal: AbortSignal, callerSignal?: AbortSignal): Promise<void> {
    if (callerSignal?.aborted || signal.aborted) {
      throw callerSignal?.aborted ? createAbortError() : new ImportClientError(408, 'temporarily_unavailable');
    }
    const boundedDelay = Math.min(Math.max(0, delayMs), this.maxRetryAfterMs);
    if (boundedDelay === 0) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        cleanup();
        resolve();
      }, boundedDelay);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(callerSignal?.aborted ? createAbortError() : new ImportClientError(408, 'temporarily_unavailable'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      callerSignal?.addEventListener('abort', onAbort, { once: true });
      function cleanup(): void {
        signal.removeEventListener('abort', onAbort);
        callerSignal?.removeEventListener('abort', onAbort);
      }
    });
  }
}

function isImportSessionResponse(value: unknown): ImportSession | false {
  if (!hasObjectFields(value, [
    'session_public_id',
    'state',
    'expected_file_count',
    'expected_byte_total',
    'accepted_file_count',
    'accepted_byte_total',
    'revision',
    'expires_at'
  ])) {
    return false;
  }
  const allowed = new Set([
    'session_public_id',
    'state',
    'expected_file_count',
    'expected_byte_total',
    'accepted_file_count',
    'accepted_byte_total',
    'revision',
    'expires_at',
    'manifest_digest',
    'content_digest',
    'verification_digest',
    'finalization_expected_revision'
  ]);
  if (!hasOnlyKeys(value, [...allowed])) return false;
  if (!(isImportSessionId(value.session_public_id)
    && isValidSessionState(value.state)
    && isNonNegativeSafeInteger(value.expected_file_count)
    && isNonNegativeSafeInteger(value.expected_byte_total)
    && isNonNegativeSafeInteger(value.accepted_file_count)
    && isNonNegativeSafeInteger(value.accepted_byte_total)
    && isPositiveSafeInteger(value.revision)
    && isIso8601Utc(value.expires_at)
    && (value.manifest_digest === undefined || isSha256Digest(value.manifest_digest))
    && (value.content_digest === undefined || isSha256Digest(value.content_digest))
    && (value.verification_digest === undefined || isSha256Digest(value.verification_digest))
    && (value.finalization_expected_revision === undefined
      || isPositiveSafeInteger(value.finalization_expected_revision)))) {
    return false;
  }
  return {
    sessionPublicId: value.session_public_id as string,
    state: value.state as ImportSession['state'],
    expectedFileCount: value.expected_file_count as number,
    expectedByteTotal: value.expected_byte_total as number,
    acceptedFileCount: value.accepted_file_count as number,
    acceptedByteTotal: value.accepted_byte_total as number,
    revision: value.revision as number,
    expiresAt: value.expires_at as string,
    manifestDigest: value.manifest_digest as string | undefined,
    contentDigest: value.content_digest as string | undefined,
    verificationDigest: value.verification_digest as string | undefined,
    finalizationExpectedRevision: value.finalization_expected_revision as number | undefined
  };
}

function isImportPreparedTarget(value: unknown): ImportPreparedTarget | false {
  if (!hasObjectFields(value, [
    'skill_public_id', 'version_public_id', 'release_public_id', 'manifest_digest', 'content_digest',
    'file_count', 'byte_total', 'reused', 'files'
  ])) return false;
  if (!hasOnlyKeys(value, [
    'skill_public_id', 'version_public_id', 'release_public_id', 'manifest_digest', 'content_digest',
    'file_count', 'byte_total', 'reused', 'files'
  ])) return false;
  if (!isSkillPublicId(value.skill_public_id)
    || !isVersionPublicId(value.version_public_id)
    || typeof value.release_public_id !== 'string'
    || !/^msr_[0-9a-f]{32}$/i.test(value.release_public_id)
    || !isSha256Digest(value.manifest_digest)
    || !isSha256Digest(value.content_digest)
    || !isPositiveSafeInteger(value.file_count)
    || !isNonNegativeSafeInteger(value.byte_total)
    || typeof value.reused !== 'boolean'
    || !Array.isArray(value.files)
    || value.files.length !== value.file_count) return false;
  const files: ImportTargetFile[] = [];
  for (const item of value.files) {
    if (!isPlainObject(item)
      || !hasOnlyKeys(item, ['file_public_id', 'relative_path', 'media_type', 'byte_size', 'file_digest', 'storage_key', 'executable', 'ordinal'])
      || !isFilePublicId(item.file_public_id)
      || typeof item.relative_path !== 'string'
      || typeof item.media_type !== 'string'
      || !isNonNegativeSafeInteger(item.byte_size)
      || !isSha256Digest(item.file_digest)
      || typeof item.storage_key !== 'string'
      || !STORAGE_OBJECT_NAME_PATTERN.test(item.storage_key)
      || typeof item.executable !== 'boolean'
      || !isNonNegativeSafeInteger(item.ordinal)) return false;
    files.push({
      filePublicId: item.file_public_id,
      relativePath: item.relative_path,
      mediaType: item.media_type,
      byteSize: item.byte_size,
      fileDigest: item.file_digest,
      storageKey: item.storage_key,
      executable: item.executable,
      ordinal: item.ordinal
    });
  }
  return {
    skillPublicId: value.skill_public_id,
    versionPublicId: value.version_public_id,
    releasePublicId: value.release_public_id,
    manifestDigest: value.manifest_digest,
    contentDigest: value.content_digest,
    fileCount: value.file_count,
    byteTotal: value.byte_total,
    reused: value.reused,
    files
  };
}

function isImportUploadMetadata(value: unknown, trustedUploadOrigins: readonly string[]): ImportUploadMetadata | false {
  if (!hasObjectFields(value, [
    'session_public_id',
    'file_public_id',
    'version_public_id',
    'bucket_id',
    'object_name',
    'upload_url',
    'upload_expires_at',
    'content_type',
    'declared_size'
  ])) {
    return false;
  }
  const allowed = new Set([
    'session_public_id',
    'file_public_id',
    'version_public_id',
    'bucket_id',
    'object_name',
    'upload_url',
    'upload_expires_at',
    'content_type',
    'declared_size',
    'upload_authorization'
  ]);
  if (!hasOnlyKeys(value, [...allowed])) return false;
  if (!(isImportSessionId(value.session_public_id)
    && isFilePublicId(value.file_public_id)
    && isVersionPublicId(value.version_public_id)
    && isString(value.bucket_id)
    && value.bucket_id.length <= 128
    && typeof value.object_name === 'string'
    && STORAGE_OBJECT_NAME_PATTERN.test(value.object_name)
    && isString(value.upload_url)
    && isTrustedUploadUrl(value.upload_url, trustedUploadOrigins)
    && isString(value.upload_expires_at)
    && isIso8601Utc(value.upload_expires_at)
    && isString(value.content_type)
    && value.content_type.length <= 128
    && isNonNegativeSafeInteger(value.declared_size)
    && value.declared_size <= MAX_IMPORT_FILE_BYTES
    && (value.upload_authorization === undefined || (typeof value.upload_authorization === 'string' && value.upload_authorization.length <= 4096)))) {
    return false;
  }
  return {
    sessionPublicId: value.session_public_id as string,
    filePublicId: value.file_public_id as string,
    versionPublicId: value.version_public_id as string,
    bucketId: value.bucket_id as string,
    objectName: value.object_name as string,
    uploadUrl: value.upload_url as string,
    uploadExpiresAt: value.upload_expires_at as string,
    contentType: value.content_type as string,
    declaredSize: value.declared_size as number,
    uploadAuthorization: value.upload_authorization as string | undefined
  };
}

function isTrustedUploadUrl(value: string, trustedOrigins: readonly string[]): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return trustedOrigins.includes(url.origin);
  } catch {
    return false;
  }
}

function isImportFileReceipt(value: unknown): ImportFileReceipt | false {
  if (!hasObjectFields(value, [
    'file_public_id',
    'relative_path',
    'accepted_byte_size',
    'file_digest',
    'ordinal'
  ])) {
    return false;
  }
  const allowed = new Set(['file_public_id', 'relative_path', 'accepted_byte_size', 'file_digest', 'ordinal']);
  if (!hasOnlyKeys(value, [...allowed])) return false;
  if (!(isFilePublicId(value.file_public_id)
    && typeof value.relative_path === 'string'
    && value.relative_path.length > 0
    && value.relative_path.length <= 512
    && !value.relative_path.includes('\0')
    && !value.relative_path.includes('/../')
    && !value.relative_path.startsWith('/')
    && !value.relative_path.startsWith('\\')
    && !/^[A-Za-z]:/u.test(value.relative_path)
    && isNonNegativeSafeInteger(value.accepted_byte_size)
    && value.accepted_byte_size <= MAX_IMPORT_FILE_BYTES
    && isSha256Digest(value.file_digest)
    && isNonNegativeSafeInteger(value.ordinal))) {
    return false;
  }
  return {
    filePublicId: value.file_public_id as string,
    relativePath: value.relative_path as string,
    acceptedByteSize: value.accepted_byte_size as number,
    fileDigest: value.file_digest as string,
    ordinal: value.ordinal as number
  };
}

function isImportReceiptsResponse(value: unknown): ImportReceiptsResponse | false {
  if (!hasObjectFields(value, ['session_public_id', 'revision', 'receipts'])) return false;
  const allowed = new Set(['session_public_id', 'revision', 'receipts']);
  if (!hasOnlyKeys(value, [...allowed])) return false;
  if (!isImportSessionId(value.session_public_id)
    || !isPositiveSafeInteger(value.revision)
    || !Array.isArray(value.receipts)) return false;
  const receipts: ImportFileReceipt[] = [];
  for (const item of value.receipts) {
    const receipt = isImportFileReceipt(item);
    if (receipt === false) return false;
    receipts.push(receipt);
  }
  return {
    sessionPublicId: value.session_public_id as string,
    revision: value.revision as number,
    receipts
  };
}

function isImportFinalizeResponse(value: unknown): ImportFinalizeResponse | false {
  if (!hasObjectFields(value, ['session_public_id', 'state', 'verification_digest'])) return false;
  const allowed = new Set([
    'session_public_id', 'state', 'verification_digest', 'version_public_id', 'finalized_revision', 'owner_consent_id',
    'consent_digest', 'explicit_consent_at', 'consent_expires_at', 'cutover_authority_id'
  ]);
  if (!hasOnlyKeys(value, [...allowed])) return false;
  if (!(isImportSessionId(value.session_public_id)
    && value.state === 'verified'
    && isSha256Digest(value.verification_digest)
    && (value.version_public_id === undefined || isVersionPublicId(value.version_public_id))
    && (value.finalized_revision === undefined || isPositiveSafeInteger(value.finalized_revision))
    && (value.owner_consent_id === undefined || (typeof value.owner_consent_id === 'string' && /^icn_[0-9a-f]{32}$/.test(value.owner_consent_id)))
    && (value.consent_digest === undefined || isSha256Digest(value.consent_digest))
    && (value.explicit_consent_at === undefined || isIso8601Utc(value.explicit_consent_at))
    && (value.consent_expires_at === undefined || isIso8601Utc(value.consent_expires_at))
    && (value.cutover_authority_id === undefined || (typeof value.cutover_authority_id === 'string' && /^cut_[0-9a-f]{32}$/.test(value.cutover_authority_id))))) {
    return false;
  }
  return {
    sessionPublicId: value.session_public_id as string,
    state: value.state as 'verified',
    verificationDigest: value.verification_digest as string,
    versionPublicId: value.version_public_id as string | undefined,
    finalizedRevision: value.finalized_revision as number | undefined,
    ownerConsentId: value.owner_consent_id as string | undefined,
    consentDigest: value.consent_digest as string | undefined,
    explicitConsentAt: value.explicit_consent_at as string | undefined,
    consentExpiresAt: value.consent_expires_at as string | undefined,
    cutoverAuthorityId: value.cutover_authority_id as string | undefined
  };
}
