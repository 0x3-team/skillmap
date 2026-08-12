import "server-only";

import { DeviceAuthError, type DeviceAuthErrorCode } from "./errors.ts";
import {
  isExchangeSuccess,
  isPollSuccess,
  type ExchangePairingSuccessV1,
  type PollPairingSuccessV1
} from "./poll-exchange-contracts.server.ts";

export interface DeviceAuthPollRepositoryInput {
  deviceCodeDigest: string;
  deviceId: string;
  audience: string;
  proofSuite: string;
  proofPurpose: string;
  proofNonce: string;
  issuedAt: string;
  requestDigest: string;
  idempotencyKey: string;
}

export interface DeviceAuthExchangeRepositoryInput {
  exchangeCodeDigest: string;
  deviceId: string;
  keyThumbprint: string;
  audience: string;
  requestedScopes: string[];
  proofSuite: string;
  proofPurpose: string;
  proofNonce: string;
  issuedAt: string;
  requestDigest: string;
  idempotencyKey: string;
  accessTokenDigest: string;
  accessTokenKeyVersion: number;
  refreshTokenDigest: string;
  refreshTokenKeyVersion: number;
}

export interface DeviceAuthPollRepository {
  pollPairing(input: DeviceAuthPollRepositoryInput): Promise<PollPairingSuccessV1>;
}

export interface DeviceAuthProofKey {
  publicKey: string;
  keyThumbprint: string;
  proofSuite: string;
}

export interface DeviceAuthProofKeyRepository {
  /** Read only active binding lookup used to verify proof before poll/exchange RPCs. */
  getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey>;
}

export interface DeviceAuthExchangeRepository {
  exchangePairing(input: DeviceAuthExchangeRepositoryInput): Promise<ExchangePairingSuccessV1>;
}

interface RpcClient {
  rpc(name: string, params: Record<string, unknown>): {
    single<T = unknown>(): Promise<{ data: T | null; error: Error | null }>;
  };
}

export type PollExchangeFactory = () => RpcClient;

interface PollRpcResult {
  exchange_code?: unknown;
  expires_in?: unknown;
  scopes?: unknown;
  error?: unknown;
  error_description?: unknown;
  retry_after?: unknown;
}

interface ExchangeRpcResult {
  device_public_id?: unknown;
  account_public_id?: unknown;
  token_family_id?: unknown;
  error?: unknown;
  error_description?: unknown;
  retry_after?: unknown;
}

interface KeyRpcResult {
  public_key?: unknown;
  key_thumbprint?: unknown;
  proof_suite?: unknown;
  error?: unknown;
}

export class SupabaseDeviceAuthPollExchangeRepository implements DeviceAuthPollRepository, DeviceAuthExchangeRepository, DeviceAuthProofKeyRepository {
  private readonly factory: PollExchangeFactory;

  constructor(factory: PollExchangeFactory) {
    this.factory = factory;
  }

  async getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey> {
    const result = await this.call<KeyRpcResult>("device_auth_get_active_key_v1", {
      p_device_id: deviceId
    });
    if (result.error || typeof result.public_key !== "string" || typeof result.key_thumbprint !== "string" || result.proof_suite !== "skillmap.ecdsa-p256-sha256.v2") {
      throw new DeviceAuthError("invalid_grant");
    }
    return { publicKey: result.public_key, keyThumbprint: result.key_thumbprint, proofSuite: result.proof_suite };
  }

  async pollPairing(input: DeviceAuthPollRepositoryInput): Promise<PollPairingSuccessV1> {
    const result = await this.call< PollRpcResult >("device_auth_poll_v1", {
      p_device_code_digest: input.deviceCodeDigest,
      p_device_id: input.deviceId,
      p_audience: input.audience,
      p_proof_suite: input.proofSuite,
      p_proof_purpose: input.proofPurpose,
      p_proof_nonce: input.proofNonce,
      p_issued_at: input.issuedAt,
      p_request_digest: input.requestDigest,
      p_idempotency_key: input.idempotencyKey
    });
    if (result.error) throwRpcError(result);
    const candidate = { exchange_code: result.exchange_code, expires_in: result.expires_in, scopes: result.scopes };
    if (!isPollSuccess(candidate)) throw new Error("invalid poll RPC response");
    return candidate;
  }

  async exchangePairing(input: DeviceAuthExchangeRepositoryInput): Promise<ExchangePairingSuccessV1> {
    const result = await this.call<ExchangeRpcResult>("device_auth_exchange_v1", {
      p_exchange_code_digest: input.exchangeCodeDigest,
      p_device_id: input.deviceId,
      p_key_thumbprint: input.keyThumbprint,
      p_audience: input.audience,
      p_requested_scopes: input.requestedScopes,
      p_proof_suite: input.proofSuite,
      p_proof_purpose: input.proofPurpose,
      p_proof_nonce: input.proofNonce,
      p_issued_at: input.issuedAt,
      p_request_digest: input.requestDigest,
      p_idempotency_key: input.idempotencyKey,
      p_access_token_digest: input.accessTokenDigest,
      p_access_token_key_version: input.accessTokenKeyVersion,
      p_refresh_token_digest: input.refreshTokenDigest,
      p_refresh_token_key_version: input.refreshTokenKeyVersion
    });
    if (result.error) throwRpcError(result);
    const candidate = {
      device_public_id: result.device_public_id,
      account_public_id: result.account_public_id,
      token_family_id: result.token_family_id,
      access_token: "A".repeat(43),
      refresh_token: "B".repeat(43),
      expires_in: 600,
      refresh_idle_expires_in: 2_592_000,
      refresh_absolute_expires_in: 7_776_000
    };
    if (!isExchangeSuccess(candidate)) throw new Error("invalid exchange RPC response");
    return {
      device_public_id: result.device_public_id as string,
      account_public_id: result.account_public_id as string,
      token_family_id: result.token_family_id as string,
      access_token: "",
      refresh_token: "",
      expires_in: 600,
      refresh_idle_expires_in: 2_592_000,
      refresh_absolute_expires_in: 7_776_000
    };
  }

  private async call<T extends PollRpcResult | ExchangeRpcResult | KeyRpcResult>(name: string, params: Record<string, unknown>): Promise<T> {
    try {
      const { data, error } = await this.factory().rpc(name, params).single<T>();
      if (error || data === null) throw new Error("DeviceAuth RPC unavailable");
      return data;
    } catch (error) {
      if (error instanceof DeviceAuthError) throw error;
      throw new Error("DeviceAuth RPC unavailable", { cause: error });
    }
  }
}

function throwRpcError(result: { error?: unknown; retry_after?: unknown }): never {
  const code = typeof result.error === "string" ? result.error : "temporarily_unavailable";
  const retry = typeof result.retry_after === "number" && Number.isSafeInteger(result.retry_after) ? result.retry_after : 0;
  const known: DeviceAuthErrorCode[] = [
    "invalid_request", "invalid_scope", "invalid_grant", "authorization_pending", "slow_down", "access_denied",
    "expired_token", "invalid_client", "invalid_token", "proof_required", "proof_invalid", "insufficient_scope",
    "already_consumed", "idempotency_conflict", "rate_limited", "secure_storage_unavailable", "temporarily_unavailable"
  ];
  throw new DeviceAuthError(known.includes(code as DeviceAuthErrorCode) ? code as DeviceAuthErrorCode : "temporarily_unavailable", { retryAfter: retry });
}
