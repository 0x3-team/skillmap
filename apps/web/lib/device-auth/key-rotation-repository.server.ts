import "server-only";

import { DeviceAuthError, DeviceAuthUnavailableError } from "./errors.ts";
import { isDeviceKeyRotationResponse, type DeviceKeyRotationResponseV1 } from "./key-rotation-contracts.server.ts";
import type { DeviceKeyRotationRepository, DeviceKeyRotationRepositoryInput } from "./key-rotation-service.server.ts";
import { isRotationIdempotencyDigest, type RotationIdempotencyDigest } from "./key-rotation-crypto.server.ts";
import type { DeviceAuthProofKey } from "./poll-exchange-repository.server.ts";
import { isValidP256Spki } from "./crypto.server.ts";

interface RpcClient {
  rpc(name: string, params: Record<string, unknown>): { single<T = unknown>(): Promise<{ data: T | null; error: Error | null }> };
}
export type DeviceKeyRotationRpcFactory = () => RpcClient;

export class SupabaseDeviceKeyRotationRepository implements DeviceKeyRotationRepository {
  private readonly factory: DeviceKeyRotationRpcFactory;

  constructor(factory: DeviceKeyRotationRpcFactory) {
    this.factory = factory;
  }

  async getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey> {
    try {
      const response = await this.factory().rpc("device_auth_get_active_key_v1", { p_device_id: deviceId }).single<unknown>();
      if (response.error) throw response.error;
      if (isPlainObject(response.data) && typeof response.data.error === "string") {
        throw mapRpcError(response.data.error);
      }
      if (!isPlainObject(response.data)
          || typeof response.data.public_key !== "string"
          || typeof response.data.key_thumbprint !== "string"
          || response.data.proof_suite !== "skillmap.ecdsa-p256-sha256.v2"
          || !isValidP256Spki(response.data.public_key)) throw new DeviceAuthError("invalid_grant");
      return { publicKey: response.data.public_key, keyThumbprint: response.data.key_thumbprint, proofSuite: response.data.proof_suite };
    } catch (error) {
      if (error instanceof DeviceAuthError) throw error;
      throw new DeviceAuthUnavailableError("DeviceAuth active proof key unavailable.", error);
    }
  }

  async getRotationReceipt(devicePublicId: string, idempotencyKeys: readonly RotationIdempotencyDigest[], requestDigest: string): Promise<DeviceKeyRotationResponseV1 | null> {
    for (const idempotencyKey of idempotencyKeys) {
      if (!isRotationIdempotencyDigest(idempotencyKey.digest) || !Number.isSafeInteger(idempotencyKey.version) || idempotencyKey.version < 1) {
        throw new DeviceAuthUnavailableError("Invalid DeviceAuth rotation lookup handle.");
      }
      let raw: unknown;
      try {
        const result = await this.factory().rpc("device_auth_get_rotation_receipt_v1", {
          p_device_public_id: devicePublicId,
          p_idempotency_key_digest: idempotencyKey.digest,
          p_idempotency_key_version: idempotencyKey.version,
          p_request_digest: requestDigest
        }).single<unknown>();
        if (result.error || result.data === null) throw new Error("rotation receipt lookup unavailable");
        raw = result.data;
      } catch (error) {
        throw new DeviceAuthUnavailableError("DeviceAuth rotation receipt lookup unavailable.", error);
      }
      if (isPlainObject(raw) && raw.status === "absent") continue;
      if (isPlainObject(raw) && typeof raw.error === "string") throw mapRpcError(raw.error);
      if (!isDeviceKeyRotationResponse(raw)) throw new DeviceAuthUnavailableError("Invalid DeviceAuth rotation receipt.");
      return raw;
    }
    return null;
  }

  async rotateKey(input: DeviceKeyRotationRepositoryInput): Promise<DeviceKeyRotationResponseV1> {
    if (!isRotationIdempotencyDigest(input.idempotencyKeyDigest)
        || !Number.isSafeInteger(input.idempotencyKeyVersion)
        || input.idempotencyKeyVersion < 1) {
      throw new DeviceAuthUnavailableError("Invalid DeviceAuth rotation lookup handle.");
    }
    let raw: unknown;
    try {
      const result = await this.factory().rpc("device_auth_rotate_key_v1", {
        p_device_public_id: input.devicePublicId,
        p_device_id: input.deviceId,
        p_old_key_thumbprint: input.oldKeyThumbprint,
        p_new_public_key: input.newPublicKey,
        p_new_key_thumbprint: input.newKeyThumbprint,
        p_audience: input.audience,
        p_proof_suite: input.proofSuite,
        p_old_proof_purpose: input.oldProofPurpose,
        p_new_proof_purpose: input.newProofPurpose,
        p_old_proof_nonce: input.oldProofNonce,
        p_new_proof_nonce: input.newProofNonce,
        p_old_issued_at: input.oldIssuedAt,
        p_new_issued_at: input.newIssuedAt,
        p_request_digest: input.requestDigest,
        p_idempotency_key_digest: input.idempotencyKeyDigest,
        p_idempotency_key_version: input.idempotencyKeyVersion
      }).single<unknown>();
      if (result.error || result.data === null) throw new Error("DeviceAuth rotation RPC unavailable");
      raw = result.data;
    } catch (error) {
      if (error instanceof DeviceAuthError) throw error;
      throw new DeviceAuthUnavailableError("DeviceAuth rotation RPC unavailable.", error);
    }
    if (!isPlainObject(raw)) throw new DeviceAuthUnavailableError("Invalid DeviceAuth rotation RPC result.");
    if (typeof raw.error === "string") throw mapRpcError(raw.error);
    if (!isDeviceKeyRotationResponse(raw)) throw new DeviceAuthUnavailableError("Invalid DeviceAuth rotation response.");
    return raw;
  }
}

function mapRpcError(code: string): DeviceAuthError {
  if (code === "retired") return new DeviceAuthError("invalid_grant");
  if (code === "invalid_request" || code === "invalid_grant" || code === "proof_invalid" || code === "idempotency_conflict" || code === "temporarily_unavailable") {
    return new DeviceAuthError(code);
  }
  return new DeviceAuthError("temporarily_unavailable");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
