import "server-only";

import { DeviceAuthError, DeviceAuthUnavailableError, type DeviceAuthErrorCode } from "@/lib/device-auth/errors";
import {
  buildLifecycleProofPreimage
} from "@/lib/device-auth/lifecycle-service.server";
import {
  computeKeyThumbprint,
  isValidP256Spki,
  sha256Digest,
  verifyDeviceProof
} from "@/lib/device-auth/crypto.server";
import { DEVICE_AUTH_AUDIENCE, DEVICE_AUTH_PROOF_SUITE_P256 } from "@/lib/device-auth/contracts";
import {
  deviceAuthLookupKeysFromEnvironment,
  digestWithLookupCandidates,
  strictBearerToken,
  type DeviceAuthLookupKey
} from "@/lib/device-auth/lifecycle-crypto.server";
import type { DeviceAuthProofKey } from "@/lib/device-auth/poll-exchange-repository.server";

export const IMPORT_PROOF_PURPOSE = "protected.import" as const;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const ACCOUNT_PUBLIC_ID_PATTERN = /^acct_[0-9a-f]{32}$/;
const DEVICE_PUBLIC_ID_PATTERN = /^dev_[0-9a-f]{32}$/;
const MAX_CLOCK_SKEW_SECONDS = 60;

export interface ImportAuthContext {
  accountPublicId: string;
  devicePublicId: string;
  scopes: string[];
}

export interface ImportAuthRpcResult {
  active?: unknown;
  device_public_id?: unknown;
  account_public_id?: unknown;
  scopes?: unknown;
  audience?: unknown;
  expires_at?: unknown;
  error?: unknown;
  retry_after?: unknown;
}

export interface ImportAuthRepository {
  getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey>;
  authenticateImport(input: Record<string, unknown>): Promise<ImportAuthRpcResult>;
}

export interface AuthenticateImportRequestInput {
  request: Request;
  rawBody: Uint8Array;
  configuredOrigin: string;
  repository: ImportAuthRepository;
  lookupKeys?: readonly DeviceAuthLookupKey[];
  now?: () => number;
}

function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name) ?? "";
  if (!value) throw new DeviceAuthError("invalid_request");
  return value;
}

function throwRpcError(result: ImportAuthRpcResult): never {
  const allowed: DeviceAuthErrorCode[] = [
    "invalid_request", "invalid_token", "invalid_client", "proof_required", "proof_invalid",
    "insufficient_scope", "rate_limited", "temporarily_unavailable"
  ];
  const code = typeof result.error === "string" && allowed.includes(result.error as DeviceAuthErrorCode)
    ? result.error as DeviceAuthErrorCode
    : "temporarily_unavailable";
  const retryAfter = typeof result.retry_after === "number" && Number.isSafeInteger(result.retry_after)
    ? result.retry_after
    : undefined;
  throw new DeviceAuthError(code, { retryAfter });
}

export async function authenticateImportRequest(
  input: AuthenticateImportRequestInput
): Promise<ImportAuthContext> {
  const token = strictBearerToken(input.request.headers.get("authorization"));
  const path = new URL(input.request.url).pathname;
  const deviceId = requiredHeader(input.request.headers, "x-skillmap-device-id");
  const proofSuite = requiredHeader(input.request.headers, "x-skillmap-device-proof-suite");
  const audience = requiredHeader(input.request.headers, "x-skillmap-device-audience");
  const purpose = requiredHeader(input.request.headers, "x-skillmap-device-purpose");
  const nonce = requiredHeader(input.request.headers, "x-skillmap-device-nonce");
  const issuedAt = requiredHeader(input.request.headers, "x-skillmap-device-issued-at");
  const signature = requiredHeader(input.request.headers, "x-skillmap-device-proof");
  const bodySha256 = requiredHeader(input.request.headers, "x-skillmap-device-body-sha256");
  const idempotencyKey = requiredHeader(input.request.headers, "idempotency-key");
  const current = input.now?.() ?? Math.floor(Date.now() / 1000);

  if (!ID_PATTERN.test(deviceId)
    || !ID_PATTERN.test(nonce)
    || !ID_PATTERN.test(idempotencyKey)
    || !SIGNATURE_PATTERN.test(signature)
    || !/^\d{1,20}$/.test(issuedAt)
    || !Number.isSafeInteger(Number(issuedAt))
    || Math.abs(current - Number(issuedAt)) > MAX_CLOCK_SKEW_SECONDS) {
    throw new DeviceAuthError("invalid_request");
  }
  if (proofSuite !== DEVICE_AUTH_PROOF_SUITE_P256 || audience !== DEVICE_AUTH_AUDIENCE) {
    throw new DeviceAuthError("invalid_client");
  }
  if (purpose !== IMPORT_PROOF_PURPOSE || bodySha256 !== sha256Digest(input.rawBody)) {
    throw new DeviceAuthError("proof_invalid");
  }

  const proofKey = await input.repository.getActiveProofKey(deviceId);
  if (proofKey.proofSuite !== DEVICE_AUTH_PROOF_SUITE_P256 || !isValidP256Spki(proofKey.publicKey)) {
    throw new DeviceAuthError("proof_invalid");
  }
  const thumbprint = computeKeyThumbprint(proofKey.publicKey);
  if (thumbprint === null || thumbprint !== proofKey.keyThumbprint) {
    throw new DeviceAuthError("proof_invalid");
  }

  const accessTokenSha256 = sha256Digest(token);
  const preimage = buildLifecycleProofPreimage({
    method: "POST",
    origin: input.configuredOrigin,
    path,
    purpose: IMPORT_PROOF_PURPOSE,
    deviceId,
    thumbprint,
    bodySha256,
    idempotencyKey,
    nonce,
    issuedAt,
    accessTokenSha256
  });
  await verifyDeviceProof({
    suite: DEVICE_AUTH_PROOF_SUITE_P256,
    devicePublicKey: proofKey.publicKey,
    signature,
    preimage
  });

  const lookupKeys = input.lookupKeys ?? deviceAuthLookupKeysFromEnvironment();
  if (lookupKeys.length < 1 || lookupKeys.length > 2) {
    throw new DeviceAuthUnavailableError("DeviceAuth lookup key ring unavailable.");
  }
  const candidates = digestWithLookupCandidates(lookupKeys, "access-token", token);
  const result = await input.repository.authenticateImport({
    p_access_token_digests: candidates.digests,
    p_access_token_key_versions: candidates.versions,
    p_device_id: deviceId,
    p_key_thumbprint: thumbprint,
    p_audience: DEVICE_AUTH_AUDIENCE,
    p_proof_suite: DEVICE_AUTH_PROOF_SUITE_P256,
    p_proof_purpose: IMPORT_PROOF_PURPOSE,
    p_proof_nonce: nonce,
    p_issued_at: issuedAt,
    p_request_digest: sha256Digest(preimage)
  });
  if (typeof result.error === "string") throwRpcError(result);
  if (result.active !== true
    || typeof result.device_public_id !== "string"
    || !DEVICE_PUBLIC_ID_PATTERN.test(result.device_public_id)
    || typeof result.account_public_id !== "string"
    || !ACCOUNT_PUBLIC_ID_PATTERN.test(result.account_public_id)
    || !Array.isArray(result.scopes)
    || !result.scopes.every((scope) => typeof scope === "string")
    || result.audience !== DEVICE_AUTH_AUDIENCE
    || typeof result.expires_at !== "number"
    || !Number.isSafeInteger(result.expires_at)
    || result.expires_at <= current) {
    throw new DeviceAuthUnavailableError("Invalid import authentication response.");
  }
  if (!result.scopes.includes("device.import")) throw new DeviceAuthError("insufficient_scope");
  return {
    accountPublicId: result.account_public_id,
    devicePublicId: result.device_public_id,
    scopes: [...result.scopes]
  };
}
