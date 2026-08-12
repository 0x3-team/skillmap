import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  buildProofPreimageV2,
  computeSha256,
  computeSpkiThumbprint,
  DEVICE_AUTH_ABSENT_ACCESS_TOKEN,
  DEVICE_AUTH_AUDIENCE_V1,
  DEVICE_AUTH_ERROR_DESCRIPTIONS,
  DEVICE_AUTH_SUITE_V2,
  normalizeAndValidateOrigin,
  toBase64Url,
  type CancelPairingRequest,
  type CancelPairingResponse,
  type DeviceAuthErrorCode,
  type DeviceAuthProofPurpose,
  type ExchangeCodeRequest,
  type ExchangeCodeResponse,
  type InitiatePairingRequest,
  type InitiatePairingResponse,
  type PollPairingRequest,
  type PollPairingResponse,
  type RefreshTokenRequest,
  type RefreshTokenResponse,
  type RevokeDeviceRequest,
  type RevokeDeviceResponse,
  type StatusResponse
} from '../contracts/device-auth.js';
import type { DeviceAuthMetadataStore } from '../platform/device-auth-metadata-store.js';
import type { DeviceKeyStore } from '../platform/device-key-store.js';

export const DEVICE_AUTH_DEFAULT_TIMEOUT_MS = 10_000;
export const DEVICE_AUTH_MAX_TIMEOUT_MS = 120_000;
export const DEVICE_AUTH_DEFAULT_MAX_RETRIES = 2;
export const DEVICE_AUTH_MAX_RETRIES = 3;
export const DEVICE_AUTH_DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
export const DEVICE_AUTH_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const DEVICE_AUTH_DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
export const DEVICE_AUTH_MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const DEVICE_AUTH_DEFAULT_MAX_RETRY_AFTER_MS = 5_000;
export const DEVICE_AUTH_MAX_RETRY_AFTER_MS = 30_000;
/** Refresh response timestamps may differ from the local clock only by this bounded skew. */
export const DEVICE_AUTH_RESPONSE_CLOCK_SKEW_SECONDS = 30;

class DeviceAuthDeadlineExceeded extends Error {
  public constructor() {
    super('Device authentication request deadline exceeded');
    this.name = 'DeviceAuthDeadlineExceeded';
  }
}

export class DeviceAuthError extends Error {
  public readonly status: number;
  public readonly code: DeviceAuthErrorCode;
  public readonly description: string;
  public readonly retryAfter?: number;

  constructor(status: number, code: DeviceAuthErrorCode, descriptionOverride?: string, retryAfter?: number) {
    const fixedDescription = DEVICE_AUTH_ERROR_DESCRIPTIONS[code] ?? 'Device authentication error';
    super(`[${status}] ${code}: ${fixedDescription}`);
    this.name = 'DeviceAuthError';
    this.status = status;
    this.code = code;
    this.description = fixedDescription;
    this.retryAfter = retryAfter;
  }
}

export interface DeviceAuthClientOptions {
  origin: string;
  keyStore: DeviceKeyStore;
  deviceId?: string;
  metadataStore?: DeviceAuthMetadataStore;
  fetchFn?: typeof fetch;
  randomBytes?: (count: number) => Uint8Array;
  clock?: () => number;
  /** Overall deadline for one public operation, including retries and body reads. */
  timeoutMs?: number;
  /** Number of retries after the initial attempt. Bounded to a small finite value. */
  maxRetries?: number;
  /** Maximum response body size accepted by the client. */
  maxResponseBytes?: number;
  /** Maximum UTF-8 request body size accepted by the client. */
  maxRequestBytes?: number;
  /** Maximum server-directed retry delay. */
  maxRetryAfterMs?: number;
  /** Require HTTPS even for local development origins. */
  production?: boolean;
}

export interface DeviceAuthResponseMetadata {
  responseIssuedAt?: number;
  responseVersion?: 'v1';
}

export type DeviceAuthResponse<T> = T & DeviceAuthResponseMetadata;

export class DeviceAuthClient {
  public readonly origin: string;
  private readonly keyStore: DeviceKeyStore;
  private metadataStore?: DeviceAuthMetadataStore;
  private cachedDeviceId?: string;
  private readonly fetchFn: typeof fetch;
  private readonly randomBytesFn: (count: number) => Uint8Array;
  private readonly clockFn: () => number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;
  private readonly maxRetryAfterMs: number;

  constructor(options: DeviceAuthClientOptions) {
    try {
      this.origin = normalizeAndValidateOrigin(options.origin);
    } catch (error: unknown) {
      // Do not echo an attacker-controlled origin (which may contain a token,
      // password, or query value) in a client-facing error.
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
        throw new Error('Production device authentication requires HTTPS');
      }
    }
    this.keyStore = options.keyStore;
    this.metadataStore = options.metadataStore;
    this.cachedDeviceId = options.deviceId === undefined ? undefined : validateDeviceId(options.deviceId);
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.randomBytesFn = options.randomBytes ?? ((count: number) => new Uint8Array(nodeRandomBytes(count)));
    this.clockFn = options.clock ?? (() => Math.floor(Date.now() / 1000));
    this.timeoutMs = boundedOption(options.timeoutMs, DEVICE_AUTH_DEFAULT_TIMEOUT_MS, 1, DEVICE_AUTH_MAX_TIMEOUT_MS);
    this.maxRetries = boundedOption(options.maxRetries, DEVICE_AUTH_DEFAULT_MAX_RETRIES, 0, DEVICE_AUTH_MAX_RETRIES);
    this.maxResponseBytes = boundedOption(
      options.maxResponseBytes,
      DEVICE_AUTH_DEFAULT_MAX_RESPONSE_BYTES,
      1,
      DEVICE_AUTH_MAX_RESPONSE_BYTES
    );
    this.maxRequestBytes = boundedOption(
      options.maxRequestBytes,
      DEVICE_AUTH_DEFAULT_MAX_REQUEST_BYTES,
      1,
      DEVICE_AUTH_MAX_REQUEST_BYTES
    );
    this.maxRetryAfterMs = boundedOption(
      options.maxRetryAfterMs,
      DEVICE_AUTH_DEFAULT_MAX_RETRY_AFTER_MS,
      0,
      DEVICE_AUTH_MAX_RETRY_AFTER_MS
    );
  }

  public setMetadataStore(metadataStore: DeviceAuthMetadataStore): void {
    if (!this.metadataStore) {
      this.metadataStore = metadataStore;
    }
  }

  public async getDeviceId(): Promise<string> {
    try {
      if (this.cachedDeviceId !== undefined) {
        return validateDeviceId(this.cachedDeviceId);
      }
      if (this.metadataStore) {
        const meta = await this.metadataStore.load();
        if (meta !== null) {
          this.cachedDeviceId = validateDeviceId(meta.deviceId);
          return this.cachedDeviceId;
        }
      }
      const bytes = this.randomBytesFn(16);
      const newDeviceId = validateDeviceId(toBase64Url(bytes));
      if (this.metadataStore) {
        await this.metadataStore.save({ deviceId: newDeviceId, verificationUri: '' });
      }
      this.cachedDeviceId = newDeviceId;
      return newDeviceId;
    } catch (error: unknown) {
      if (error instanceof DeviceAuthError) throw error;
      throw new DeviceAuthError(503, 'secure_storage_unavailable');
    }
  }

  private generate22CharBase64Url(): string {
    try {
      const bytes = this.randomBytesFn(16);
      return toBase64Url(bytes);
    } catch (error: unknown) {
      if (error instanceof DeviceAuthError) throw error;
      throw new DeviceAuthError(503, 'secure_storage_unavailable');
    }
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
      throw new DeviceAuthError(503, 'secure_storage_unavailable');
    }

    const deviceId = await this.getDeviceId();
    const nonce = this.generate22CharBase64Url();
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
    requireResponseIssuedAt?: boolean;
    validate?: (value: unknown) => value is T;
  }): Promise<T> {
    throwIfAborted(params.signal);
    const path = this.validatePath(params.path);
    let bodyUtf8 = '';
    try {
      bodyUtf8 = params.body !== undefined ? JSON.stringify(params.body) : '';
    } catch {
      throw new DeviceAuthError(400, 'invalid_request');
    }
    if (new TextEncoder().encode(bodyUtf8).byteLength > this.maxRequestBytes) {
      throw new DeviceAuthError(400, 'invalid_request');
    }

    const requestId = params.idempotencyKey ?? this.generate22CharBase64Url();

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
      rejectDeadline?.(new DeviceAuthDeadlineExceeded());
    }, this.timeoutMs);

    try {
      const retryableMethod = isRetryableMethod(params.method, Boolean(params.idempotencyKey));
      let attempt = 0;
      while (true) {
        // Proof nonces and issued-at values are fresh per transport attempt.
        // The request ID and idempotency key remain stable so the server can
        // safely correlate retries and deduplicate side effects.
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
          if (error instanceof DeviceAuthDeadlineExceeded || abortController.signal.aborted) {
            throw new DeviceAuthError(408, 'temporarily_unavailable');
          }
          if (error instanceof DeviceAuthError) throw error;
          // Key-store failures may contain provider paths, account names, or
          // other sensitive implementation details. Collapse them to a fixed
          // typed outcome before they can cross the client boundary.
          throw new DeviceAuthError(503, 'secure_storage_unavailable');
        }
        let response: Response;
        try {
          response = await Promise.race([
            this.fetchFn(requestUrl, {
              method: params.method,
              headers,
              body: bodyUtf8 || undefined,
              // Fetch implementations must fail on redirects; following one
              // could cross the authenticated origin boundary.
              redirect: 'error',
              signal: abortController.signal
            }),
            deadlinePromise,
            callerAbortPromise
          ]) as Response;
        } catch (error: unknown) {
          if (callerAborted) throw createAbortError();
          if (error instanceof DeviceAuthDeadlineExceeded) {
            throw new DeviceAuthError(408, 'temporarily_unavailable');
          }
          if (abortController.signal.aborted) {
            throw new DeviceAuthError(408, 'temporarily_unavailable');
          }
          if (retryableMethod && attempt < this.maxRetries) {
            attempt += 1;
            await this.sleepBeforeRetry(0, abortController.signal, params.signal);
            continue;
          }
          // Network errors are deliberately collapsed to a fixed safe error;
          // the underlying Error can contain a URL, token, or local path.
          throw new DeviceAuthError(503, 'temporarily_unavailable');
        }

        if (response.status >= 300 && response.status < 400) {
          throw new DeviceAuthError(400, 'invalid_request');
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
          if (error instanceof DeviceAuthDeadlineExceeded) {
            throw new DeviceAuthError(408, 'temporarily_unavailable');
          }
          if (abortController.signal.aborted) {
            throw new DeviceAuthError(408, 'temporarily_unavailable');
          }
          bodyReadFailed = true;
        }

        if (isSuccess) {
          // A malformed success is a protocol failure, never a retry trigger:
          // retrying it can duplicate a successful side effect.
          if (bodyReadFailed || !isPlainObject(payload) || !isJsonContentType(response)) {
            throw new DeviceAuthError(502, 'temporarily_unavailable');
          }
          if (params.validate && !params.validate(payload)) {
            throw new DeviceAuthError(502, 'temporarily_unavailable');
          }
          // Response metadata is transport metadata, not part of the strict
          // JSON body contract. Keep it non-enumerable so callers cannot
          // accidentally serialize it as a response body or request replay.
          const responseIssuedAt = parseResponseIssuedAt(
            response.headers.get('X-SkillMap-Response-Issued-At'),
            Boolean(params.requireResponseIssuedAt),
            this.clockFn()
          );
          if (responseIssuedAt !== undefined && isPlainObject(payload)) {
            Object.defineProperty(payload, 'responseIssuedAt', { value: responseIssuedAt, enumerable: false, configurable: false });
          }
          if (isPlainObject(payload)) {
            Object.defineProperty(payload, 'responseVersion', { value: 'v1', enumerable: false, configurable: false });
          }
          return payload as T;
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

        throw new DeviceAuthError(statusCode, errorCode, undefined, retryAfterSeconds);
      }
    } finally {
      clearTimeout(deadlineTimer);
      params.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private async withSetupDeadline<T>(operation: () => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
    throwIfAborted(callerSignal);
    let callerAborted = false;
    let rejectCaller: ((reason?: unknown) => void) | undefined;
    const callerAbort = new Promise<never>((_, reject) => {
      rejectCaller = reject;
    });
    const onCallerAbort = () => {
      callerAborted = true;
      rejectCaller?.(createAbortError());
    };
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => rejectDeadline?.(new DeviceAuthDeadlineExceeded()), this.timeoutMs);
    try {
      return await Promise.race([operation(), callerAbort, deadline]) as T;
    } catch (error: unknown) {
      if (callerAborted) throw createAbortError();
      if (error instanceof DeviceAuthDeadlineExceeded) {
        throw new DeviceAuthError(408, 'temporarily_unavailable');
      }
      if (error instanceof DeviceAuthError) throw error;
      if (isAbortError(error)) throw error;
      throw new DeviceAuthError(503, 'secure_storage_unavailable');
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private validatePath(pathInput: string): string {
    if (typeof pathInput !== 'string' || !pathInput.startsWith('/') || pathInput.startsWith('//')) {
      throw new DeviceAuthError(400, 'invalid_request');
    }
    try {
      const url = new URL(pathInput, this.origin);
      if (url.origin !== this.origin || url.search || url.hash || url.pathname !== pathInput) {
        throw new DeviceAuthError(400, 'invalid_request');
      }
      return url.pathname;
    } catch (error: unknown) {
      if (error instanceof DeviceAuthError) throw error;
      throw new DeviceAuthError(400, 'invalid_request');
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
      throw callerSignal?.aborted ? createAbortError() : new DeviceAuthError(408, 'temporarily_unavailable');
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
        reject(callerSignal?.aborted ? createAbortError() : new DeviceAuthError(408, 'temporarily_unavailable'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      callerSignal?.addEventListener('abort', onAbort, { once: true });
      function cleanup(): void {
        signal.removeEventListener('abort', onAbort);
        callerSignal?.removeEventListener('abort', onAbort);
      }
    });
  }

  public async initiatePairing(
    req: Omit<InitiatePairingRequest, 'device_id' | 'device_public_key' | 'key_thumbprint' | 'audience' | 'proof_suite'>,
    options?: { signal?: AbortSignal }
  ): Promise<InitiatePairingResponse> {
    throwIfAborted(options?.signal);
    const spkiBytes = await this.withSetupDeadline(() => this.keyStore.getPublicKeySpki(), options?.signal);
    if (!spkiBytes) {
      throw new DeviceAuthError(503, 'secure_storage_unavailable');
    }
    const deviceId = await this.withSetupDeadline(() => this.getDeviceId(), options?.signal);
    const spkiBase64Url = toBase64Url(spkiBytes);
    // The thumbprint is derived from the key store's own SPKI bytes, never from
    // caller input, and the proof suite is the frozen P-256 v2 suite.
    const keyThumbprint = computeSpkiThumbprint(spkiBytes);
    const body: InitiatePairingRequest = {
      ...req,
      device_id: deviceId,
      device_public_key: spkiBase64Url,
      key_thumbprint: keyThumbprint,
      audience: DEVICE_AUTH_AUDIENCE_V1,
      proof_suite: DEVICE_AUTH_SUITE_V2
    };
    const idempotencyKey = this.generate22CharBase64Url();

    return this.request<InitiatePairingResponse>({
      method: 'POST',
      path: '/api/device-auth/v1/pairings',
      purpose: 'initiate',
      body,
      idempotencyKey,
      signal: options?.signal,
      validate: (value): value is InitiatePairingResponse => isInitiatePairingResponse(value, this.origin)
    });
  }


  public async pollPairing(
    deviceCode: string,
    options?: { signal?: AbortSignal }
  ): Promise<PollPairingResponse> {
    throwIfAborted(options?.signal);
    const deviceId = await this.withSetupDeadline(() => this.getDeviceId(), options?.signal);
    const body: PollPairingRequest = {
      device_code: deviceCode,
      device_id: deviceId,
      audience: DEVICE_AUTH_AUDIENCE_V1
    };
    const idempotencyKey = this.generate22CharBase64Url();

    try {
      return await this.request<PollPairingResponse>({
        method: 'POST',
        path: '/api/device-auth/v1/pairings/poll',
        purpose: 'poll',
        body,
        idempotencyKey,
        signal: options?.signal,
        validate: isPollPairingResponse
      });
    } catch (err) {
      if (err instanceof DeviceAuthError && (err.code === 'authorization_pending' || err.code === 'slow_down')) {
        return {
          error: err.code,
          error_description: err.description,
          retry_after: err.retryAfter ?? (err.code === 'slow_down' ? 5 : 0)
        };
      }
      throw err;
    }
  }

  public async exchangeCode(
    params: { exchangeCode: string; scopes: string[] },
    options?: { signal?: AbortSignal }
  ): Promise<DeviceAuthResponse<ExchangeCodeResponse>> {
    throwIfAborted(options?.signal);
    const thumbprint = await this.withSetupDeadline(() => this.keyStore.getThumbprint(), options?.signal);
    if (!thumbprint) {
      throw new DeviceAuthError(503, 'secure_storage_unavailable');
    }
    const deviceId = await this.withSetupDeadline(() => this.getDeviceId(), options?.signal);
    const body: ExchangeCodeRequest = {
      exchange_code: params.exchangeCode,
      device_id: deviceId,
      device_public_key_thumbprint: thumbprint,
      audience: DEVICE_AUTH_AUDIENCE_V1,
      requested_scopes: params.scopes
    };
    const idempotencyKey = this.generate22CharBase64Url();

    return this.request<DeviceAuthResponse<ExchangeCodeResponse>>({
      method: 'POST',
      path: '/api/device-auth/v1/pairings/exchange',
      purpose: 'exchange',
      body,
      idempotencyKey,
      signal: options?.signal,
      validate: isExchangeCodeResponse
    });
  }

  public async refreshToken(
    params: { refreshToken: string; tokenFamilyId: string; idempotencyKey?: string },
    options?: { signal?: AbortSignal }
  ): Promise<DeviceAuthResponse<RefreshTokenResponse>> {
    throwIfAborted(options?.signal);
    const idempotencyKey = params.idempotencyKey ?? this.generate22CharBase64Url();
    if (!/^[A-Za-z0-9_-]{22}$/.test(idempotencyKey)) {
      throw new DeviceAuthError(400, 'invalid_request');
    }
    const deviceId = await this.withSetupDeadline(() => this.getDeviceId(), options?.signal);
    const body: RefreshTokenRequest = {
      refresh_token: params.refreshToken,
      device_id: deviceId,
      audience: DEVICE_AUTH_AUDIENCE_V1,
      token_family_id: params.tokenFamilyId
    };
    return this.request<DeviceAuthResponse<RefreshTokenResponse>>({
      method: 'POST',
      path: '/api/device-auth/v1/tokens/refresh',
      purpose: 'refresh',
      body,
      idempotencyKey,
      signal: options?.signal,
      requireResponseIssuedAt: true,
      validate: isRefreshTokenResponse
    });
  }

  public async cancelPairing(
    params: { deviceCode: string; reason: 'user_cancelled' | 'timeout' | 'local_shutdown' },
    options?: { signal?: AbortSignal }
  ): Promise<CancelPairingResponse> {
    throwIfAborted(options?.signal);
    const deviceId = await this.withSetupDeadline(() => this.getDeviceId(), options?.signal);
    const body: CancelPairingRequest = {
      device_code: params.deviceCode,
      device_id: deviceId,
      audience: DEVICE_AUTH_AUDIENCE_V1,
      reason: params.reason
    };
    const idempotencyKey = this.generate22CharBase64Url();

    return this.request<CancelPairingResponse>({
      method: 'POST',
      path: '/api/device-auth/v1/pairings/cancel',
      purpose: 'cancel',
      body,
      idempotencyKey,
      signal: options?.signal,
      validate: isCancelPairingResponse
    });
  }


  public async revokeDevice(
    params: { devicePublicId: string; reason: RevokeDeviceRequest['reason']; accessToken?: string },
    options?: { signal?: AbortSignal }
  ): Promise<RevokeDeviceResponse> {
    throwIfAborted(options?.signal);
    validateAccessToken(params.accessToken);
    const body: RevokeDeviceRequest = {
      reason: params.reason
    };
    const idempotencyKey = this.generate22CharBase64Url();

    return this.request<RevokeDeviceResponse>({
      method: 'POST',
      path: `/api/device-auth/v1/devices/${params.devicePublicId}/revoke`,
      purpose: 'revoke',
      body,
      idempotencyKey,
      accessToken: params.accessToken,
      signal: options?.signal,
      validate: (value): value is RevokeDeviceResponse => isRevokeDeviceResponse(value)
        && value.device_public_id === params.devicePublicId
    });
  }

  public async getStatus(
    params: { devicePublicId: string; accessToken?: string },
    options?: { signal?: AbortSignal }
  ): Promise<StatusResponse> {
    throwIfAborted(options?.signal);
    validateAccessToken(params.accessToken);
    return this.request<StatusResponse>({
      method: 'GET',
      path: `/api/device-auth/v1/devices/${params.devicePublicId}`,
      purpose: 'protected.status',
      accessToken: params.accessToken,
      signal: options?.signal,
      validate: (value): value is StatusResponse => isStatusResponse(value)
        && value.device_public_id === params.devicePublicId
    });
  }
}

function boundedOption(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function validateAccessToken(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw new DeviceAuthError(401, 'invalid_token');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return isFiniteNonNegativeNumber(value) && Number.isInteger(value);
}

function parseResponseIssuedAt(value: string | null, required: boolean, now: number): number | undefined {
  if (value === null) {
    if (required) throw new DeviceAuthError(502, 'temporarily_unavailable');
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]{0,19})$/.test(value)) throw new DeviceAuthError(502, 'temporarily_unavailable');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new DeviceAuthError(502, 'temporarily_unavailable');
  if (required && (!Number.isSafeInteger(now) || now < 0 || Math.abs(now - parsed) > DEVICE_AUTH_RESPONSE_CLOCK_SKEW_SECONDS)) {
    throw new DeviceAuthError(502, 'temporarily_unavailable');
  }
  return parsed;
}

function isPositiveBoundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= maximum;
}

const DEVICE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const USER_CODE_PATTERN = /^[0-9A-Z]{5}-[0-9A-Z]{5}$/;
const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const DEVICE_PUBLIC_ID_PATTERN = /^dev_[0-9a-f]{32}$/;
const ACCOUNT_PUBLIC_ID_PATTERN = /^acct_[0-9a-f]{32}$/;
const TOKEN_FAMILY_ID_PATTERN = /^fam_[0-9a-f]{32}$/;
const DEVICE_AUTH_SCOPES = ['device.bundle', 'device.feedback', 'device.import', 'device.route', 'device.status'] as const;

function isCanonicalScopes(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DEVICE_AUTH_SCOPES.length) return false;
  let previous = '';
  for (const scope of value) {
    if (typeof scope !== 'string' || !DEVICE_AUTH_SCOPES.includes(scope as typeof DEVICE_AUTH_SCOPES[number])) return false;
    if (scope <= previous) return false;
    previous = scope;
  }
  return true;
}

function hasObjectFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  return fields.every((field) => field in value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isInitiatePairingResponse(value: unknown, expectedOrigin: string): value is InitiatePairingResponse {
  if (!hasObjectFields(value, ['device_code', 'user_code', 'verification_uri', 'expires_in', 'interval', 'display'])) return false;
  const display = value.display;
  if (!isPlainObject(display) || !hasOnlyKeys(display, ['name', 'platform', 'connector_version', 'locale'])) return false;
  const platformValid = display.platform === 'macos' || display.platform === 'windows' || display.platform === 'linux';
  const displayValid = typeof display.name === 'string'
    && display.name.length <= 64
    && platformValid
    && typeof display.connector_version === 'string'
    && display.connector_version.length <= 32
    && SEMVER_PATTERN.test(display.connector_version)
    && (display.locale === undefined
      || (typeof display.locale === 'string'
        && display.locale.length >= 2
        && display.locale.length <= 35
        && LOCALE_PATTERN.test(display.locale)));
  return hasOnlyKeys(value, ['device_code', 'user_code', 'verification_uri', 'expires_in', 'interval', 'display'])
    && isString(value.device_code)
    && isString(value.user_code)
    && isString(value.verification_uri)
    && DEVICE_CODE_PATTERN.test(value.device_code)
    && USER_CODE_PATTERN.test(value.user_code)
    && value.verification_uri.length >= 16
    && value.verification_uri.length <= 2096
    && isTrustedVerificationUri(value.verification_uri, expectedOrigin)
    && value.expires_in === 600
    && value.interval === 5
    && displayValid;
}

function validateDeviceId(value: unknown): string {
  if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) {
    throw new DeviceAuthError(400, 'invalid_request');
  }
  return value;
}

function isTrustedVerificationUri(value: unknown, expectedOrigin: string): value is string {
  if (typeof value !== 'string' || value !== `${expectedOrigin}/device`) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

function isPollPairingResponse(value: unknown): value is PollPairingResponse {
  if (!isPlainObject(value)) return false;
  if ('exchange_code' in value) {
    return hasOnlyKeys(value, ['exchange_code', 'expires_in', 'scopes'])
      && typeof value.exchange_code === 'string'
      && TOKEN_PATTERN.test(value.exchange_code)
      && isPositiveBoundedInteger(value.expires_in, 600)
      && isCanonicalScopes(value.scopes);
  }
  return false;
}

function isExchangeCodeResponse(value: unknown): value is ExchangeCodeResponse {
  return hasObjectFields(value, [
    'device_public_id',
    'account_public_id',
    'token_family_id',
    'access_token',
    'refresh_token',
    'expires_in',
    'refresh_idle_expires_in',
    'refresh_absolute_expires_in'
  ])
    && hasOnlyKeys(value, [
      'device_public_id',
      'account_public_id',
      'token_family_id',
      'access_token',
      'refresh_token',
      'expires_in',
      'refresh_idle_expires_in',
      'refresh_absolute_expires_in'
    ])
    && typeof value.device_public_id === 'string'
    && DEVICE_PUBLIC_ID_PATTERN.test(value.device_public_id)
    && typeof value.account_public_id === 'string'
    && ACCOUNT_PUBLIC_ID_PATTERN.test(value.account_public_id)
    && typeof value.token_family_id === 'string'
    && TOKEN_FAMILY_ID_PATTERN.test(value.token_family_id)
    && typeof value.access_token === 'string'
    && TOKEN_PATTERN.test(value.access_token)
    && typeof value.refresh_token === 'string'
    && TOKEN_PATTERN.test(value.refresh_token)
    && isPositiveBoundedInteger(value.expires_in, 600)
    && isPositiveBoundedInteger(value.refresh_idle_expires_in, 2_592_000)
    && isPositiveBoundedInteger(value.refresh_absolute_expires_in, 7_776_000)
    && value.expires_in <= value.refresh_idle_expires_in
    && value.refresh_idle_expires_in <= value.refresh_absolute_expires_in;
}

function isRefreshTokenResponse(value: unknown): value is RefreshTokenResponse {
  return isExchangeCodeResponse(value);
}

function isCancelPairingResponse(value: unknown): value is CancelPairingResponse {
  return hasObjectFields(value, ['status']) && hasOnlyKeys(value, ['status']) && value.status === 'cancelled';
}

function isRevokeDeviceResponse(value: unknown): value is RevokeDeviceResponse {
  return hasObjectFields(value, ['status', 'device_public_id'])
    && hasOnlyKeys(value, ['status', 'device_public_id'])
    && value.status === 'revoked'
    && typeof value.device_public_id === 'string'
    && DEVICE_PUBLIC_ID_PATTERN.test(value.device_public_id);
}

function isStatusResponse(value: unknown): value is StatusResponse {
  return hasObjectFields(value, [
    'device_public_id',
    'account_public_id',
    'state',
    'scopes',
    'expires_at',
    'key_thumbprint'
  ])
    && hasOnlyKeys(value, [
      'device_public_id',
      'account_public_id',
      'state',
      'scopes',
      'expires_at',
      'key_thumbprint',
      'rotation_lineage_digest',
      'revocation_receipt_digest'
    ])
    && typeof value.device_public_id === 'string'
    && DEVICE_PUBLIC_ID_PATTERN.test(value.device_public_id)
    && typeof value.account_public_id === 'string'
    && ACCOUNT_PUBLIC_ID_PATTERN.test(value.account_public_id)
    && (value.state === 'active' || value.state === 'disabled' || value.state === 'revoked' || value.state === 'compromised' || value.state === 'expired')
    && isCanonicalScopes(value.scopes)
    && isFiniteNonNegativeInteger(value.expires_at)
    && typeof value.key_thumbprint === 'string'
    && /^sha256:[0-9a-f]{64}$/.test(value.key_thumbprint)
    && (value.rotation_lineage_digest === undefined || (typeof value.rotation_lineage_digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(value.rotation_lineage_digest)))
    && (value.revocation_receipt_digest === undefined || (typeof value.revocation_receipt_digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(value.revocation_receipt_digest)));
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

function errorCodeForStatus(status: number, payload: unknown): DeviceAuthErrorCode {
  if (status === 401) return 'invalid_token';
  if (status === 403) return 'insufficient_scope';
  if (status === 409) return 'idempotency_conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status <= 599) return 'temporarily_unavailable';
  if (isPlainObject(payload) && typeof payload.error === 'string' && payload.error in DEVICE_AUTH_ERROR_DESCRIPTIONS) {
    return payload.error as DeviceAuthErrorCode;
  }
  return status >= 500 ? 'temporarily_unavailable' : 'invalid_request';
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
  if (milliseconds === undefined && isPlainObject(payload) && isFiniteNonNegativeNumber(payload.retry_after)) {
    milliseconds = payload.retry_after * 1000;
  }
  if (milliseconds === undefined) return undefined;
  const bounded = Math.min(milliseconds, maxRetryAfterMs);
  return Math.floor(bounded / 1000);
}

async function readResponseBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) {
    // Do not fall back to response.text()/arrayBuffer(): both may buffer an
    // attacker-controlled body before the cap can be enforced. A null body
    // is only unambiguously empty when the server states Content-Length: 0.
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
    // Cancel immediately even if the underlying read never resolves. The
    // caller then releases the lock in readResponseBytes' finally block.
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

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The operation was aborted.', 'AbortError');
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}
