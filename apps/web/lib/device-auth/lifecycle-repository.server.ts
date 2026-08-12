import "server-only";

import { DeviceAuthError, DeviceAuthUnavailableError, type DeviceAuthErrorCode } from "./errors.ts";
import { isAuthenticateResponse, isRevokeResponse, isStatusResponse, type AuthenticateResponseV1, type StatusResponseV1, type RevokeResponseV1 } from "./lifecycle-contracts.server.ts";
import type { DeviceAuthProofKey } from "./poll-exchange-repository.server.ts";

interface RpcClient { rpc(name: string, params: Record<string, unknown>): { single<T = unknown>(): Promise<{ data: T | null; error: Error | null }> }; }
export type LifecycleRpcFactory = () => RpcClient;

export interface LifecycleRepository {
  getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey>;
  getRevokeProofKey?(deviceId: string, devicePublicId: string, idempotencyKey: string, requestDigest: string): Promise<DeviceAuthProofKey>;
  cancelPairing(input: Record<string, unknown>): Promise<{ status: "cancelled" }>;
  authenticate(input: Record<string, unknown>): Promise<AuthenticateResponseV1>;
  getStatus(input: Record<string, unknown>): Promise<StatusResponseV1>;
  revoke(input: Record<string, unknown>): Promise<RevokeResponseV1>;
}

type RpcResult = Record<string, unknown>;

export class SupabaseDeviceAuthLifecycleRepository implements LifecycleRepository {
  private readonly factory: LifecycleRpcFactory;
  constructor(factory: LifecycleRpcFactory) { this.factory = factory; }

  async getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey> {
    const result = await this.call("device_auth_get_active_key_v1", { p_device_id: deviceId });
    if (typeof result.public_key !== "string" || typeof result.key_thumbprint !== "string" || result.proof_suite !== "skillmap.ecdsa-p256-sha256.v2") throw new DeviceAuthError("invalid_grant");
    return { publicKey: result.public_key, keyThumbprint: result.key_thumbprint, proofSuite: result.proof_suite };
  }

  async getRevokeProofKey(deviceId: string, devicePublicId: string, idempotencyKey: string, requestDigest: string): Promise<DeviceAuthProofKey> {
    const result = await this.call("device_auth_get_revoke_key_v1", {
      p_device_id: deviceId, p_device_public_id: devicePublicId, p_idempotency_key: idempotencyKey, p_request_digest: requestDigest
    });
    if (typeof result.public_key !== "string" || typeof result.key_thumbprint !== "string" || result.proof_suite !== "skillmap.ecdsa-p256-sha256.v2") throw new DeviceAuthError("invalid_grant");
    return { publicKey: result.public_key, keyThumbprint: result.key_thumbprint, proofSuite: result.proof_suite };
  }

  async cancelPairing(input: Record<string, unknown>): Promise<{ status: "cancelled" }> {
    const result = await this.call("device_auth_cancel_v1", input);
    if (typeof result.error === "string") throwRpcError(result);
    if (result.status !== "cancelled") throw new DeviceAuthUnavailableError("Invalid cancellation response.");
    return { status: "cancelled" };
  }

  async authenticate(input: Record<string, unknown>): Promise<AuthenticateResponseV1> {
    const result = await this.call("device_auth_authenticate_v1", input);
    if (typeof result.error === "string") throwRpcError(result);
    if (!isAuthenticateResponse(result)) throw new DeviceAuthUnavailableError("Invalid authentication response.");
    return result;
  }

  async getStatus(input: Record<string, unknown>): Promise<StatusResponseV1> {
    const result = await this.call("device_auth_get_status_v1", input);
    if (typeof result.error === "string") throwRpcError(result);
    if (!isStatusResponse(result)) throw new DeviceAuthUnavailableError("Invalid status response.");
    return result;
  }

  async revoke(input: Record<string, unknown>): Promise<RevokeResponseV1> {
    const result = await this.call("device_auth_revoke_v1", input);
    if (typeof result.error === "string") throwRpcError(result);
    if (!isRevokeResponse(result)) throw new DeviceAuthUnavailableError("Invalid revoke response.");
    return result;
  }

  private async call(name: string, params: Record<string, unknown>): Promise<RpcResult> {
    try {
      const { data, error } = await this.factory().rpc(name, params).single<RpcResult>();
      if (error || data === null) throw new Error("DeviceAuth RPC unavailable");
      return data;
    } catch (error) {
      if (error instanceof DeviceAuthError || error instanceof DeviceAuthUnavailableError) throw error;
      throw new DeviceAuthUnavailableError("DeviceAuth RPC unavailable.", error);
    }
  }
}

function throwRpcError(result: { error?: unknown; retry_after?: unknown }): never {
  const known: DeviceAuthErrorCode[] = ["invalid_request", "invalid_scope", "invalid_grant", "expired_token", "invalid_client", "invalid_token", "proof_required", "proof_invalid", "insufficient_scope", "idempotency_conflict", "already_consumed", "temporarily_unavailable"];
  const code = typeof result.error === "string" && known.includes(result.error as DeviceAuthErrorCode) ? result.error as DeviceAuthErrorCode : "temporarily_unavailable";
  const retryAfter = typeof result.retry_after === "number" && Number.isSafeInteger(result.retry_after) ? result.retry_after : undefined;
  throw new DeviceAuthError(code, { retryAfter });
}
