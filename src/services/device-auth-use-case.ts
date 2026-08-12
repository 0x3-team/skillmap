import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  computeSha256,
  toBase64Url,
  type DeviceAuthErrorCode,
  type ExchangeCodeResponse,
  type PollPairingResponse
} from '../contracts/device-auth.js';
import { DeviceAuthClient, DeviceAuthError } from '../network/device-auth-client.js';
import type { CredentialStore } from '../platform/credential-store.js';
import type { DeviceAuthMetadataStore } from '../platform/device-auth-metadata-store.js';
import type { DeviceKeyStore } from '../platform/device-key-store.js';

export interface DisplayCodeInfo {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export interface DeviceAuthUseCaseOptions {
  client: DeviceAuthClient;
  keyStore: DeviceKeyStore;
  credentialStore: CredentialStore;
  metadataStore: DeviceAuthMetadataStore;
  clock?: () => number;
  randomBytes?: (count: number) => Uint8Array;
  onDisplayCode?: (info: DisplayCodeInfo) => void;
  openBrowser?: (url: string) => Promise<boolean>;
}

export interface InitiateAndPollOptions {
  scopes: string[];
  displayName?: string;
  platform?: 'macos' | 'windows' | 'linux';
  connectorVersion?: string;
  locale?: string;
  openBrowser?: boolean;
  signal?: AbortSignal;
}

export interface AuthStatusResult {
  state: 'authenticated' | 'expiring' | 'expired' | 'signed_out' | 'revoked' | 'unreachable';
  authenticated: boolean;
  devicePublicId?: string;
  accountPublicId?: string;
  scopes?: string[];
  expiresAt?: number;
}

export interface LogoutResult {
  remoteRevoked: boolean;
  localDeleted: boolean;
  /** The client could not prove remote revocation, so local credentials remain. */
  unconfirmed?: boolean;
}

const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DEVICE_PUBLIC_ID_PATTERN = /^dev_[0-9a-f]{32}$/;
const ACCOUNT_PUBLIC_ID_PATTERN = /^acct_[0-9a-f]{32}$/;
const TOKEN_FAMILY_ID_PATTERN = /^fam_[0-9a-f]{32}$/;

export class DeviceAuthUseCase {
  private readonly client: DeviceAuthClient;
  private readonly keyStore: DeviceKeyStore;
  private readonly credentialStore: CredentialStore;
  private readonly metadataStore: DeviceAuthMetadataStore;
  private readonly clockFn: () => number;
  private readonly randomBytesFn: (count: number) => Uint8Array;
  private readonly onDisplayCodeFn?: (info: DisplayCodeInfo) => void;
  private readonly openBrowserFn?: (url: string) => Promise<boolean>;

  private inMemoryAccessToken: string | null = null;
  private inMemoryAccessTokenExpiresAt: number | null = null;
  private inMemoryDeviceCode: string | null = null;
  private activePollAbortController: AbortController | null = null;
  private static readonly refreshLocks = new WeakMap<object, Promise<string>>();

  private readonly refreshWireVersion = 'v1';
  private readonly refreshResponseVersion = 'v1';

  constructor(options: DeviceAuthUseCaseOptions) {
    this.client = options.client;
    this.keyStore = options.keyStore;
    this.credentialStore = options.credentialStore;
    this.metadataStore = options.metadataStore;
    this.clockFn = options.clock ?? (() => Math.floor(Date.now() / 1000));
    this.randomBytesFn = options.randomBytes ?? ((count: number) => new Uint8Array(nodeRandomBytes(count)));
    this.onDisplayCodeFn = options.onDisplayCode;
    this.openBrowserFn = options.openBrowser;

    this.client.setMetadataStore(this.metadataStore);
  }

  private generate22CharBase64Url(): string {
    const bytes = this.randomBytesFn(16);
    return toBase64Url(bytes);
  }

  private async sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }
    return new Promise<void>((res, rej) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        res();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        rej(new Error('Operation aborted'));
      };
      signal?.addEventListener('abort', onAbort);
    });
  }

  public async initiateAndPoll(options: InitiateAndPollOptions): Promise<ExchangeCodeResponse> {
    const platform = options.platform ?? 'macos';
    if (!(await this.keyStore.hasKey())) {
      await this.keyStore.createKey();
    }

    const deviceId = await this.client.getDeviceId();

    const initRes = await this.client.initiatePairing(
      {
        requested_scopes: options.scopes,
        platform,
        connector_version: options.connectorVersion ?? '0.1.0',
        display_name: options.displayName,
        locale: options.locale
      },
      { signal: options.signal }
    );

    await this.metadataStore.save({
      deviceId,
      verificationUri: initRes.verification_uri,
      displayName: options.displayName,
      platform,
      connectorVersion: options.connectorVersion ?? '0.1.0'
    });

    this.inMemoryDeviceCode = initRes.device_code;

    if (this.onDisplayCodeFn) {
      this.onDisplayCodeFn({
        userCode: initRes.user_code,
        verificationUri: initRes.verification_uri,
        expiresIn: initRes.expires_in
      });
    }

    if (options.openBrowser && this.openBrowserFn) {
      await this.openBrowserFn(initRes.verification_uri);
    }

    let baseInterval = Math.max(1, initRes.interval || 5);
    let currentInterval = baseInterval;
    const expiresInSeconds = initRes.expires_in || 600;
    const deadlineTime = this.clockFn() + expiresInSeconds;
    // Keep a finite guard for a stalled/injected clock, but derive it from the
    // advertised deadline and the smallest possible jittered delay. A fixed
    // poll count can expire a valid 600-second pairing early (90 polls take
    // about 7.6-9 minutes with the 5-second interval and 1-20% jitter).
    const minimumJitteredPollDelayMs = Math.min(
      60_000,
      Math.floor((baseInterval * 1000 * 101) / 100)
    );
    const maxPolls = Math.max(
      1,
      Math.ceil((expiresInSeconds * 1000) / minimumJitteredPollDelayMs)
    );
    let pollCount = 0;
    let exchangeCode: string | null = null;

    this.activePollAbortController = new AbortController();
    const combinedSignal = options.signal
      ? this.createCombinedSignal(options.signal, this.activePollAbortController.signal)
      : this.activePollAbortController.signal;

    try {
      while (pollCount < maxPolls && this.clockFn() < deadlineTime) {
        if (combinedSignal.aborted) {
          await this.cancel('user_cancelled');
          throw new DeviceAuthError(400, 'access_denied', 'Polling aborted by user');
        }

        // Calculate jitter integer 1..20
        const jitterPct = 1 + Math.floor((this.randomBytesFn(1)[0] / 256) * 20);
        const sleepMs = Math.min(
          60_000,
          Math.floor((currentInterval * 1000 * (100 + jitterPct)) / 100)
        );

        try {
          await this.sleepWithSignal(sleepMs, combinedSignal);
        } catch {
          await this.cancel('user_cancelled');
          throw new DeviceAuthError(400, 'access_denied', 'Polling aborted');
        }

        // The authorization code is no longer valid at the advertised
        // deadline. Do not issue one final request after a long sleep crosses
        // that boundary.
        if (this.clockFn() >= deadlineTime) break;

        if (!this.inMemoryDeviceCode) {
          throw new DeviceAuthError(400, 'access_denied', 'Device code cleared');
        }

        pollCount += 1;
        let pollRes: PollPairingResponse;
        try {
          pollRes = await this.client.pollPairing(this.inMemoryDeviceCode, { signal: combinedSignal });
        } catch (err) {
          if (err instanceof DeviceAuthError) {
            this.inMemoryDeviceCode = null;
            throw err;
          }
          throw err;
        }

        if ('exchange_code' in pollRes && pollRes.exchange_code) {
          exchangeCode = pollRes.exchange_code;
          break;
        }

        if ('error' in pollRes) {
          const retryAfter = typeof pollRes.retry_after === 'number' && Number.isFinite(pollRes.retry_after)
            ? Math.max(0, Math.floor(pollRes.retry_after))
            : 0;
          if (pollRes.error === 'authorization_pending') {
            // A server-provided retry_after is authoritative guidance. Keep a
            // client-side lower bound, but never exceed the frozen 60-second
            // poll interval cap.
            if (retryAfter > 0) {
              currentInterval = Math.min(60, Math.max(currentInterval, retryAfter));
            }
          } else if (pollRes.error === 'slow_down') {
            const serverRetryAfter = retryAfter > 0 ? retryAfter : currentInterval + 5;
            currentInterval = Math.min(60, Math.max(currentInterval + 5, serverRetryAfter));
          } else {
            this.inMemoryDeviceCode = null;
            throw new DeviceAuthError(400, pollRes.error as DeviceAuthErrorCode, pollRes.error_description);
          }
        }
      }

      if (!exchangeCode) {
        await this.cancel('timeout');
        throw new DeviceAuthError(400, 'expired_token', 'Authorization deadline or max poll count exceeded');
      }

      const thumbprint = await this.keyStore.getThumbprint();
      if (!thumbprint) {
        throw new DeviceAuthError(503, 'secure_storage_unavailable', 'Device key thumbprint unavailable');
      }

      const exchangeRes = await this.client.exchangeCode(
        {
          exchangeCode,
          scopes: options.scopes
        },
        { signal: options.signal }
      );

      await this.credentialStore.commitExchange({
        deviceId,
        tokenFamilyId: exchangeRes.token_family_id,
        refreshToken: exchangeRes.refresh_token,
        scopes: options.scopes,
        devicePublicId: exchangeRes.device_public_id,
        accountPublicId: exchangeRes.account_public_id,
        updatedAt: this.clockFn(),
        generation: 0,
        familyAbsoluteExpiresAt: (exchangeRes.responseIssuedAt ?? this.clockFn()) + exchangeRes.refresh_absolute_expires_in
      });

      this.inMemoryAccessToken = exchangeRes.access_token;
      this.inMemoryAccessTokenExpiresAt = this.clockFn() + exchangeRes.expires_in;
      this.inMemoryDeviceCode = null;

      return exchangeRes;
    } finally {
      this.activePollAbortController = null;
    }
  }

  private createCombinedSignal(s1: AbortSignal, s2: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (s1.aborted || s2.aborted) {
      controller.abort();
    } else {
      s1.addEventListener('abort', onAbort, { once: true });
      s2.addEventListener('abort', onAbort, { once: true });
    }
    return controller.signal;
  }

  public async getAccessToken(options?: { forceRefresh?: boolean; preserveOnAuthFailure?: boolean }): Promise<string> {
    const existing = DeviceAuthUseCase.refreshLocks.get(this.credentialStore as object);
    if (existing) return existing;
    const operation = this.refreshAccessToken(options, 1);
    DeviceAuthUseCase.refreshLocks.set(this.credentialStore as object, operation);
    try {
      return await operation;
    } finally {
      if (DeviceAuthUseCase.refreshLocks.get(this.credentialStore as object) === operation) DeviceAuthUseCase.refreshLocks.delete(this.credentialStore as object);
    }
  }

  private async refreshAccessToken(options: { forceRefresh?: boolean; preserveOnAuthFailure?: boolean } | undefined, nearExpiryRefreshesRemaining: number): Promise<string> {
    const inMemoryToken = this.getValidInMemoryAccessToken();
    if (!options?.forceRefresh && inMemoryToken) return inMemoryToken;

    // A pending tuple is the durable refresh lock. Every contender either
    // adopts that exact tuple or fails closed; it never invents a second key.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await this.credentialStore.loadState();
      const creds = state.record;
      if (!creds || !creds.refreshToken || !creds.tokenFamilyId) throw new DeviceAuthError(401, 'invalid_token', 'Unauthenticated: no stored credentials');
      const generation = creds.generation ?? 0;
      let pending = state.pending;
      if (pending && pending.expectedGeneration !== generation) {
        throw new DeviceAuthError(409, 'idempotency_conflict');
      }
      if (!pending) {
        const body = this.buildRefreshBody(creds);
        const candidate = {
          idempotencyKey: this.generate22CharBase64Url(),
          requestDigest: computeSha256(Buffer.from(JSON.stringify(body), 'utf8')),
          wireVersion: this.refreshWireVersion,
          responseVersion: this.refreshResponseVersion,
          expectedGeneration: generation,
          requestStartedAt: this.clockFn()
        };
        try {
          pending = await this.credentialStore.markRefreshPending(candidate);
        } catch (error: unknown) {
          // Another local actor won the atomic mark. Reload and reuse it.
          if (error instanceof Error && /pending_conflict|generation_conflict/.test(error.message)) continue;
          throw new DeviceAuthError(503, 'secure_storage_unavailable');
        }
      }
      const body = this.buildRefreshBody(creds);
      const digest = computeSha256(Buffer.from(JSON.stringify(body), 'utf8'));
      if (digest !== pending.requestDigest || pending.expectedGeneration !== generation || pending.wireVersion !== this.refreshWireVersion || pending.responseVersion !== this.refreshResponseVersion) {
        throw new DeviceAuthError(409, 'idempotency_conflict');
      }

      try {
        const res = await this.client.refreshToken({ refreshToken: creds.refreshToken, tokenFamilyId: creds.tokenFamilyId, idempotencyKey: pending.idempotencyKey });
        const responseIssuedAt = res.responseIssuedAt;
        if (typeof responseIssuedAt !== 'number' || !Number.isSafeInteger(responseIssuedAt) || responseIssuedAt < 0) throw new DeviceAuthError(502, 'temporarily_unavailable');
        const responseFamilyAbsoluteExpiresAt = responseIssuedAt + res.refresh_absolute_expires_in;
        if (!Number.isSafeInteger(responseFamilyAbsoluteExpiresAt) || (creds.familyAbsoluteExpiresAt !== undefined && responseFamilyAbsoluteExpiresAt > creds.familyAbsoluteExpiresAt)) throw new DeviceAuthError(502, 'temporarily_unavailable');
        const familyAbsoluteExpiresAt = creds.familyAbsoluteExpiresAt ?? responseFamilyAbsoluteExpiresAt;
        if (!Number.isSafeInteger(familyAbsoluteExpiresAt) || familyAbsoluteExpiresAt < responseIssuedAt) throw new DeviceAuthError(502, 'temporarily_unavailable');
        const nextRecord = {
          ...creds,
          tokenFamilyId: res.token_family_id,
          refreshToken: res.refresh_token,
          generation: generation + 1,
          familyAbsoluteExpiresAt,
          updatedAt: this.clockFn()
        };
        await this.credentialStore.commitRefresh({ pending, record: nextRecord });
        this.inMemoryAccessToken = res.access_token;
        this.inMemoryAccessTokenExpiresAt = responseIssuedAt + res.expires_in;
        // A recovered response may already be inside the 60-second access
        // window. The durable N->N+1 commit happens first, then one fresh
        // serialized refresh obtains a useful token.
        const remainingAccessSeconds = this.inMemoryAccessTokenExpiresAt - this.clockFn();
        if (remainingAccessSeconds < 60) {
          if (nearExpiryRefreshesRemaining > 0) return await this.refreshAccessToken({ forceRefresh: true }, nearExpiryRefreshesRemaining - 1);
          if (remainingAccessSeconds <= 0) throw new DeviceAuthError(401, 'expired_token');
        }
        return this.inMemoryAccessToken;
      } catch (err) {
        if (err instanceof DeviceAuthError && (err.code === 'invalid_grant' || err.code === 'invalid_token' || err.code === 'access_denied')) {
          if (!options?.preserveOnAuthFailure) {
            await this.credentialStore.delete();
            this.inMemoryAccessToken = null;
            this.inMemoryAccessTokenExpiresAt = null;
          }
        }
        throw err;
      }
    }
    throw new DeviceAuthError(409, 'idempotency_conflict');
  }

  private buildRefreshBody(creds: { refreshToken: string; tokenFamilyId: string; deviceId: string }) {
    return {
      refresh_token: creds.refreshToken,
      device_id: creds.deviceId,
      audience: 'skillmap.connector.v1' as const,
      token_family_id: creds.tokenFamilyId
    };
  }

  public async cancel(reason: 'user_cancelled' | 'timeout' | 'local_shutdown' = 'user_cancelled'): Promise<void> {
    if (this.activePollAbortController) {
      this.activePollAbortController.abort();
      this.activePollAbortController = null;
    }

    if (this.inMemoryDeviceCode) {
      const code = this.inMemoryDeviceCode;
      this.inMemoryDeviceCode = null;
      try {
        await this.client.cancelPairing({ deviceCode: code, reason });
      } catch {
        // Best effort cancel notification
      }
    }

    this.inMemoryAccessToken = null;
    this.inMemoryAccessTokenExpiresAt = null;
  }

  public async logout(options?: { localOnly?: boolean; confirm?: boolean }): Promise<LogoutResult> {
    const creds = await this.credentialStore.load();
    if (!creds) {
      return { remoteRevoked: false, localDeleted: false };
    }

    if (options?.localOnly) {
      if (options?.confirm) {
        await this.deleteLocalCredentials();
        return { remoteRevoked: false, localDeleted: true };
      }
      return { remoteRevoked: false, localDeleted: false };
    }

    let remoteRevoked = false;
    let localDeleted = false;

    if (creds.devicePublicId) {
      if (!this.isSafeCredentialRecord(creds)) {
        return { remoteRevoked: false, localDeleted: false, unconfirmed: true };
      }

      let accessToken = this.getValidInMemoryAccessToken();
      if (!accessToken) {
        try {
          accessToken = await this.getAccessToken({ preserveOnAuthFailure: true });
        } catch {
          return { remoteRevoked: false, localDeleted: false, unconfirmed: true };
        }
      }
      if (!accessToken) {
        return { remoteRevoked: false, localDeleted: false, unconfirmed: true };
      }
      try {
        await this.client.revokeDevice({
          devicePublicId: creds.devicePublicId,
          reason: 'user_offboarded',
          accessToken
        });
        remoteRevoked = true;
      } catch {
        // Errors never prove remote revocation. The backend's exact validated
        // success body is the sole cleanup authority, including idempotent
        // retired-key replay returned as success.
      }
    } else {
      // Without the server's exact public device identity there is no safe
      // revoke target. Keep durable credentials for explicit local cleanup.
      return { remoteRevoked: false, localDeleted: false, unconfirmed: true };
    }

    if (remoteRevoked) {
      // A successful revoke retires the server-side key binding. Remove the
      // matching local key and device ID as part of the same logout outcome so
      // the next login creates a fresh identity instead of reusing a retired
      // binding. Unconfirmed logout paths never reach this cleanup.
      await this.retireLocalAuthState();
      localDeleted = true;
    }

    return { remoteRevoked, localDeleted, unconfirmed: !remoteRevoked && !localDeleted };
  }

  private async deleteLocalCredentials(): Promise<void> {
    await this.credentialStore.delete();
    this.inMemoryAccessToken = null;
    this.inMemoryAccessTokenExpiresAt = null;
    this.inMemoryDeviceCode = null;
  }

  private async retireLocalAuthState(): Promise<void> {
    const errors: unknown[] = [];
    // Remove identity material before credentials, and keep trying after each
    // failure. A credential-delete failure therefore cannot skip either
    // identity deletion, and every failure is reported to the caller.
    for (const operation of [
      () => this.metadataStore.delete(),
      () => this.keyStore.deleteKey(),
      () => this.credentialStore.delete()
    ]) {
      try {
        await operation();
      } catch (error: unknown) {
        errors.push(error);
      }
    }

    this.inMemoryAccessToken = null;
    this.inMemoryAccessTokenExpiresAt = null;
    this.inMemoryDeviceCode = null;

    if (errors.length > 0) {
      throw new DeviceAuthError(503, 'secure_storage_unavailable');
    }
  }


  public async getAuthStatus(): Promise<AuthStatusResult> {
    const creds = await this.credentialStore.load();
    if (!creds) {
      return {
        state: 'signed_out',
        authenticated: false
      };
    }

    if (!this.isSafeCredentialRecord(creds)) {
      return {
        state: 'unreachable',
        authenticated: false,
        devicePublicId: creds.devicePublicId,
        accountPublicId: creds.accountPublicId,
        scopes: creds.scopes
      };
    }

    let accessToken = this.getValidInMemoryAccessToken();

    if (!accessToken) {
      try {
        accessToken = await this.getAccessToken();
      } catch (error: unknown) {
        if (error instanceof DeviceAuthError && isTerminalAuthFailure(error.code)) {
          return {
            state: 'expired',
            authenticated: false,
            devicePublicId: creds.devicePublicId,
            accountPublicId: creds.accountPublicId,
            scopes: creds.scopes
          };
        }
        return {
          state: 'unreachable',
          authenticated: false,
          devicePublicId: creds.devicePublicId,
          accountPublicId: creds.accountPublicId,
          scopes: creds.scopes
        };
      }
    }

    if (!accessToken || !creds.devicePublicId) {
      return {
        state: 'unreachable',
        authenticated: false,
        devicePublicId: creds.devicePublicId,
        accountPublicId: creds.accountPublicId,
        scopes: creds.scopes
      };
    }

    try {
      if (creds.devicePublicId) {
        const res = await this.client.getStatus({
          devicePublicId: creds.devicePublicId,
          accessToken
        });

        const isRevoked = res.state === 'revoked' || res.state === 'disabled' || res.state === 'compromised';
        if (isRevoked) {
          await this.credentialStore.delete();
          this.inMemoryAccessToken = null;
          this.inMemoryAccessTokenExpiresAt = null;
          return {
            state: 'revoked',
            authenticated: false,
            devicePublicId: creds.devicePublicId,
            accountPublicId: creds.accountPublicId,
            scopes: creds.scopes
          };
        }

        if (res.state === 'expired') {
          return {
            state: 'expired',
            authenticated: false,
            devicePublicId: res.device_public_id,
            accountPublicId: res.account_public_id,
            scopes: res.scopes,
            expiresAt: res.expires_at
          };
        }

        return {
          state: 'authenticated',
          authenticated: true,
          devicePublicId: res.device_public_id,
          accountPublicId: res.account_public_id,
          scopes: res.scopes,
          expiresAt: res.expires_at
        };
      }
    } catch (error: unknown) {
      if (error instanceof DeviceAuthError && isTerminalAuthFailure(error.code)) {
        return {
          state: 'expired',
          authenticated: false,
          devicePublicId: creds.devicePublicId,
          accountPublicId: creds.accountPublicId,
          scopes: creds.scopes
        };
      }
      // Unreachable server
      return {
        state: 'unreachable',
        authenticated: false,
        devicePublicId: creds.devicePublicId,
        accountPublicId: creds.accountPublicId,
        scopes: creds.scopes
      };
    }

    return {
      state: 'authenticated',
      authenticated: true,
      devicePublicId: creds.devicePublicId,
      accountPublicId: creds.accountPublicId,
      scopes: creds.scopes
    };
  }

  private getValidInMemoryAccessToken(): string | null {
    const token = this.inMemoryAccessToken;
    const expiresAt = this.inMemoryAccessTokenExpiresAt;
    if (token && ACCESS_TOKEN_PATTERN.test(token) && expiresAt !== null && expiresAt > this.clockFn() + 10) {
      return token;
    }
    if (token || expiresAt !== null) {
      this.inMemoryAccessToken = null;
      this.inMemoryAccessTokenExpiresAt = null;
    }
    return null;
  }

  private isSafeCredentialRecord(creds: {
    deviceId: string;
    tokenFamilyId: string;
    refreshToken: string;
    devicePublicId?: string;
    accountPublicId?: string;
  }): boolean {
    return DEVICE_ID_PATTERN.test(creds.deviceId)
      && TOKEN_FAMILY_ID_PATTERN.test(creds.tokenFamilyId)
      && ACCESS_TOKEN_PATTERN.test(creds.refreshToken)
      && typeof creds.devicePublicId === 'string'
      && DEVICE_PUBLIC_ID_PATTERN.test(creds.devicePublicId)
      && (creds.accountPublicId === undefined || ACCOUNT_PUBLIC_ID_PATTERN.test(creds.accountPublicId));
  }
}

function isTerminalAuthFailure(code: DeviceAuthErrorCode): boolean {
  return code === 'invalid_grant' || code === 'expired_token' || code === 'invalid_token' || code === 'access_denied';
}
