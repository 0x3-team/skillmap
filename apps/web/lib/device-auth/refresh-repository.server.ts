import "server-only";

import { DeviceAuthError, DeviceAuthUnavailableError } from "./errors.ts";
import type { SealedRefreshResponse } from "./refresh-crypto.server.ts";
import type { DeviceAuthProofKey } from "./poll-exchange-repository.server.ts";

export interface RefreshRepositoryInput {
  refreshTokenDigest: string;
  successorRefreshTokenDigest: string;
  refreshTokenKeyVersion: number;
  deviceId: string;
  tokenFamilyId: string;
  audience: string;
  proofSuite: string;
  proofPurpose: string;
  proofNonce: string;
  issuedAt: string;
  requestDigest: string;
  idempotencyKeyDigest: string;
  idempotencyKeyVersion: number;
  responseIssuedAt: number;
  replayKeyVersion: number;
  replayNonce: string;
  replayCiphertext: string;
  replayBodyDigest: string;
  replayBodyLength: number;
  replayUntil: number;
  runtimePurgeAfter: number;
  responseFormatVersion: string;
  accessTokenDigest: string;
  accessTokenKeyVersion: number;
}

export interface RefreshRepositoryResult {
  outcome: "committed" | "exact_replay" | "replay_corrupt" | "response_unavailable" | "already_consumed" | "idempotency_conflict" | "family_revoked" | "invalid_grant" | "unavailable";
  devicePublicId?: string;
  accountPublicId?: string;
  tokenFamilyId?: string;
  priorGeneration?: number;
  successorGeneration?: number;
  responseIssuedAt?: number;
  replay?: SealedRefreshResponse;
}

/** Inputs for the alpha-only transition. It has no replay-key or ciphertext fields. */
export interface RefreshSingleShotRepositoryInput {
  refreshTokenDigest: string;
  successorRefreshTokenDigest: string;
  refreshTokenKeyVersion: number;
  deviceId: string;
  tokenFamilyId: string;
  audience: string;
  proofSuite: string;
  proofPurpose: string;
  proofNonce: string;
  issuedAt: string;
  requestDigest: string;
  idempotencyKeyDigest: string;
  idempotencyKeyVersion: number;
  responseIssuedAt: number;
  responseFormatVersion: string;
  accessTokenDigest: string;
  accessTokenKeyVersion: number;
}
export interface RefreshFamilyContext {
  devicePublicId: string;
  accountPublicId: string;
  tokenFamilyId: string;
  currentGeneration: number;
  absoluteExpiresAt: number;
}

export interface DeviceAuthRefreshRepository {
  getActiveProofKey?(deviceId: string): Promise<DeviceAuthProofKey>;
  getRefreshContext?(deviceId: string, tokenFamilyId: string): Promise<RefreshFamilyContext>;
  refreshToken(input: RefreshRepositoryInput): Promise<RefreshRepositoryResult>;
  refreshTokenSingleShot?(input: RefreshSingleShotRepositoryInput): Promise<RefreshRepositoryResult>;
  failClosed?(idempotencyKeyDigest: string, tokenFamilyId: string): Promise<void>;
  purgeExpiredReplay?(now: number, limit?: number): Promise<number>;
}

interface RpcClient {
  rpc(name: string, params: Record<string, unknown>): { single<T = unknown>(): Promise<{ data: T | null; error: Error | null }> };
}
export type RefreshRpcFactory = () => RpcClient;

export class SupabaseDeviceAuthRefreshRepository implements DeviceAuthRefreshRepository {
  private readonly factory: RefreshRpcFactory;
  constructor(factory: RefreshRpcFactory) { this.factory = factory; }

  async getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey> {
    let result: unknown;
    try {
      const response = await this.factory().rpc("device_auth_get_active_key_v1", { p_device_id: deviceId }).single<unknown>();
      if (response.error || response.data === null) throw new Error("proof key unavailable");
      result = response.data;
    } catch (error) {
      throw new DeviceAuthUnavailableError("DeviceAuth proof key unavailable.", error);
    }
    if (!isPlainObject(result) || typeof result.public_key !== "string" || typeof result.key_thumbprint !== "string" || result.proof_suite !== "skillmap.ecdsa-p256-sha256.v2") throw new DeviceAuthError("invalid_grant");
    return { publicKey: result.public_key, keyThumbprint: result.key_thumbprint, proofSuite: result.proof_suite };
  }

  async getRefreshContext(deviceId: string, tokenFamilyId: string): Promise<RefreshFamilyContext> {
    try {
      const result = await this.factory().rpc("device_auth_refresh_context_v1", { p_device_id: deviceId, p_token_family_id: tokenFamilyId }).single<unknown>();
      if (result.error || result.data === null || !isPlainObject(result.data)) throw new Error("refresh context unavailable");
      const raw = result.data;
      if (typeof raw.error === "string") throw new DeviceAuthError("invalid_grant");
      if (typeof raw.device_public_id !== "string" || typeof raw.account_public_id !== "string" || typeof raw.token_family_id !== "string" || !Number.isSafeInteger(raw.current_generation) || !Number.isSafeInteger(raw.absolute_expires_at)) throw new Error("invalid refresh context");
      return { devicePublicId: raw.device_public_id, accountPublicId: raw.account_public_id, tokenFamilyId: raw.token_family_id, currentGeneration: raw.current_generation as number, absoluteExpiresAt: raw.absolute_expires_at as number };
    } catch (error) {
      if (error instanceof DeviceAuthError) throw error;
      throw new DeviceAuthUnavailableError("DeviceAuth refresh context unavailable.", error);
    }
  }

  async failClosed(idempotencyKeyDigest: string, tokenFamilyId: string): Promise<void> {
    try {
      const response = await this.factory().rpc("device_auth_refresh_fail_closed_v1", {
        p_idempotency_key_digest: idempotencyKeyDigest, p_token_family_id: tokenFamilyId
      }).single<unknown>();
      if (response.error || !isPlainObject(response.data) || response.data.status !== "revoked") throw new Error("fail-closed RPC unavailable");
    } catch (error) {
      throw new DeviceAuthUnavailableError("DeviceAuth fail-closed transition unavailable.", error);
    }
  }

  async purgeExpiredReplay(now: number, limit = 100): Promise<number> {
    try {
      const response = await this.factory().rpc("device_auth_expire_v1", { p_runtime_purge_after: now, p_limit: limit }).single<unknown>();
      if (response.error || !isPlainObject(response.data) || !Number.isSafeInteger(response.data.deleted)) throw new Error("replay purge RPC unavailable");
      return response.data.deleted as number;
    } catch (error) {
      throw new DeviceAuthUnavailableError("DeviceAuth replay purge unavailable.", error);
    }
  }

  async refreshToken(input: RefreshRepositoryInput): Promise<RefreshRepositoryResult> {
    const params = {
      p_refresh_token_digest: input.refreshTokenDigest, p_refresh_token_key_version: input.refreshTokenKeyVersion,
      p_successor_refresh_token_digest: input.successorRefreshTokenDigest,
      p_device_id: input.deviceId, p_token_family_id: input.tokenFamilyId, p_audience: input.audience,
      p_proof_suite: input.proofSuite, p_proof_purpose: input.proofPurpose, p_proof_nonce: input.proofNonce,
      p_issued_at: input.issuedAt, p_request_digest: input.requestDigest,
      p_idempotency_key_digest: input.idempotencyKeyDigest, p_idempotency_key_version: input.idempotencyKeyVersion,
      p_response_issued_at: input.responseIssuedAt, p_replay_key_version: input.replayKeyVersion,
      p_replay_nonce: input.replayNonce, p_replay_ciphertext: input.replayCiphertext,
      p_replay_body_digest: input.replayBodyDigest, p_replay_body_length: input.replayBodyLength,
      p_replay_until: input.replayUntil, p_runtime_purge_after: input.runtimePurgeAfter,
      p_response_format_version: input.responseFormatVersion, p_access_token_digest: input.accessTokenDigest,
      p_access_token_key_version: input.accessTokenKeyVersion
    };
    let raw: unknown;
    try {
      const result = await this.factory().rpc("device_auth_refresh_v1", params).single<unknown>();
      if (result.error || result.data === null) throw new Error("refresh RPC unavailable");
      raw = result.data;
    } catch (error) {
      throw new DeviceAuthUnavailableError("DeviceAuth refresh RPC unavailable.", error);
    }
    if (!isPlainObject(raw)) throw new DeviceAuthUnavailableError("Invalid refresh RPC result.");
    if (typeof raw.error === "string") {
      const code = raw.error;
      if (code === "idempotency_conflict") throw new DeviceAuthError("idempotency_conflict");
      if (code === "invalid_grant" || code === "expired_token") throw new DeviceAuthError("invalid_grant");
      if (code === "family_revoked") throw new DeviceAuthError("invalid_grant");
      if (code === "replay_corrupt") return { outcome: "replay_corrupt" };
      throw new DeviceAuthUnavailableError("Refresh RPC rejected the request.");
    }
    const outcome = raw.outcome;
    if (outcome !== "committed" && outcome !== "exact_replay") throw new DeviceAuthUnavailableError("Invalid refresh RPC outcome.");
    let replay: SealedRefreshResponse | undefined;
    if (outcome === "exact_replay") {
      try { replay = parseReplay(raw.replay); } catch { return { outcome: "replay_corrupt" }; }
    }
    return {
      outcome, devicePublicId: stringOrUndefined(raw.device_public_id), accountPublicId: stringOrUndefined(raw.account_public_id),
      tokenFamilyId: stringOrUndefined(raw.token_family_id), priorGeneration: integerOrUndefined(raw.prior_generation),
      successorGeneration: integerOrUndefined(raw.successor_generation), responseIssuedAt: integerOrUndefined(raw.response_issued_at), replay
    };
  }

  async refreshTokenSingleShot(input: RefreshSingleShotRepositoryInput): Promise<RefreshRepositoryResult> {
    const params = {
      p_refresh_token_digest: input.refreshTokenDigest,
      p_refresh_token_key_version: input.refreshTokenKeyVersion,
      p_successor_refresh_token_digest: input.successorRefreshTokenDigest,
      p_device_id: input.deviceId,
      p_token_family_id: input.tokenFamilyId,
      p_audience: input.audience,
      p_proof_suite: input.proofSuite,
      p_proof_purpose: input.proofPurpose,
      p_proof_nonce: input.proofNonce,
      p_issued_at: input.issuedAt,
      p_request_digest: input.requestDigest,
      p_idempotency_key_digest: input.idempotencyKeyDigest,
      p_idempotency_key_version: input.idempotencyKeyVersion,
      p_response_issued_at: input.responseIssuedAt,
      p_response_format_version: input.responseFormatVersion,
      p_access_token_digest: input.accessTokenDigest,
      p_access_token_key_version: input.accessTokenKeyVersion
    };
    let raw: unknown;
    try {
      const result = await this.factory().rpc("device_auth_refresh_single_shot_v1", params).single<unknown>();
      if (result.error || result.data === null) throw new Error("single-shot refresh RPC unavailable");
      raw = result.data;
    } catch (error) {
      throw new DeviceAuthUnavailableError("DeviceAuth single-shot refresh RPC unavailable.", error);
    }
    if (!isPlainObject(raw)) throw new DeviceAuthUnavailableError("Invalid single-shot refresh RPC result.");
    if (typeof raw.error === "string") {
      if (raw.error === "idempotency_conflict") throw new DeviceAuthError("idempotency_conflict");
      if (raw.error === "invalid_grant" || raw.error === "expired_token" || raw.error === "family_revoked") throw new DeviceAuthError("invalid_grant");
      if (raw.error === "already_consumed") return { outcome: "already_consumed" };
      if (raw.error === "temporarily_unavailable") return { outcome: "response_unavailable" };
      throw new DeviceAuthUnavailableError("Single-shot refresh RPC rejected the request.");
    }
    if (raw.outcome !== "committed") throw new DeviceAuthUnavailableError("Invalid single-shot refresh RPC outcome.");
    return {
      outcome: "committed",
      devicePublicId: stringOrUndefined(raw.device_public_id), accountPublicId: stringOrUndefined(raw.account_public_id),
      tokenFamilyId: stringOrUndefined(raw.token_family_id), priorGeneration: integerOrUndefined(raw.prior_generation),
      successorGeneration: integerOrUndefined(raw.successor_generation), responseIssuedAt: integerOrUndefined(raw.response_issued_at)
    };
  }
}

function parseReplay(value: unknown): SealedRefreshResponse {
  if (!isPlainObject(value) || !Number.isSafeInteger(value.replay_key_version) || (value.replay_key_version as number) < 1
      || typeof value.nonce !== "string" || typeof value.ciphertext !== "string" || typeof value.body_digest !== "string"
      || !Number.isSafeInteger(value.body_length) || !Number.isSafeInteger(value.response_issued_at)
      || !Number.isSafeInteger(value.replay_until) || !Number.isSafeInteger(value.runtime_purge_after)
      || typeof value.response_format_version !== "string") throw new DeviceAuthUnavailableError("Invalid refresh replay payload.");
  return {
    replayKeyVersion: value.replay_key_version as number, nonce: value.nonce, ciphertext: value.ciphertext, bodyDigest: value.body_digest,
    bodyLength: value.body_length as number, responseIssuedAt: value.response_issued_at as number, replayUntil: value.replay_until as number,
    runtimePurgeAfter: value.runtime_purge_after as number, responseFormatVersion: value.response_format_version
  };
}
function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringOrUndefined(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function integerOrUndefined(value: unknown): number | undefined { return Number.isSafeInteger(value) ? value as number : undefined; }
