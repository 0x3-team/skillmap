import "server-only";

import { DeviceAuthError, DeviceAuthUnavailableError } from "./errors.ts";
import { buildIdempotencyDigest, computeKeyThumbprint, isValidP256Spki, sha256Digest, verifyDeviceProof } from "./crypto.server.ts";
import { DEVICE_AUTH_AUDIENCE, DEVICE_AUTH_PROOF_SUITE_P256 } from "./contracts.ts";
import { digestWithLookupCandidates, type DeviceAuthLookupKey, strictBearerToken } from "./lifecycle-crypto.server.ts";
import {
  AUTHENTICATE_PATH, AUTHENTICATE_PURPOSE, CANCEL_PATH, CANCEL_PURPOSE, REVOKE_PURPOSE, STATUS_PURPOSE,
  isAccessToken, isAuthenticateRequest, isCancelRequest, isDevicePublicId, isIdempotencyKey, isIssuedAt,
  isRevokeRequest, revokePath, statusPath, type AuthenticateRequestV1, type AuthenticateResponseV1,
  type CancelRequestV1, type LifecycleProofEnvelope, type RevokeRequestV1, type RevokeResponseV1, type StatusResponseV1
} from "./lifecycle-contracts.server.ts";
import type { LifecycleRepository } from "./lifecycle-repository.server.ts";

const NOW_SKEW_SECONDS = 60;

export interface LifecycleDependencies { repository: LifecycleRepository; lookupKeys?: readonly DeviceAuthLookupKey[]; now?: () => number; }
export interface LifecycleInput { body: unknown; rawBody: Uint8Array; proof: LifecycleProofEnvelope; }

function now(deps: LifecycleDependencies): number { return deps.now?.() ?? Math.floor(Date.now() / 1000); }

function validateProof(proof: LifecycleProofEnvelope, expected: { path: string; method: "POST" | "GET"; purpose: string; deviceId: string; accessToken?: string }, rawBody: Uint8Array, current: number): void {
  if (proof.path !== expected.path || proof.method !== expected.method || proof.purpose !== expected.purpose || proof.deviceIdHeader !== expected.deviceId) throw new DeviceAuthError("proof_invalid");
  if (proof.proofSuite !== DEVICE_AUTH_PROOF_SUITE_P256 || proof.audience !== DEVICE_AUTH_AUDIENCE) throw new DeviceAuthError("invalid_client");
  if (proof.bodySha256 !== sha256Digest(rawBody)) throw new DeviceAuthError("proof_invalid");
  if (!isIssuedAt(proof.issuedAt) || Math.abs(current - Number(proof.issuedAt)) > NOW_SKEW_SECONDS) throw new DeviceAuthError("invalid_request");
  if (!/^[A-Za-z0-9_-]{22}$/.test(proof.nonce) || !/^[A-Za-z0-9_-]{86}$/.test(proof.signature)) throw new DeviceAuthError("proof_invalid");
  if (proof.idempotencyKey !== "" && !isIdempotencyKey(proof.idempotencyKey)) throw new DeviceAuthError("invalid_request");
  if (expected.accessToken === undefined && proof.accessTokenSha256 !== "NONE") throw new DeviceAuthError("proof_invalid");
  if (expected.accessToken !== undefined && proof.accessTokenSha256 !== sha256Digest(expected.accessToken)) throw new DeviceAuthError("proof_invalid");
}

async function verifyStoredKey(repository: LifecycleRepository, proof: LifecycleProofEnvelope, expected: { path: string; method: "POST" | "GET"; purpose: string; deviceId: string; accessToken?: string }, rawBody: Uint8Array, current: number, suppliedKey?: { publicKey: string; keyThumbprint: string; proofSuite: string }): Promise<string> {
  const key = suppliedKey ?? await repository.getActiveProofKey(expected.deviceId);
  if (key.proofSuite !== DEVICE_AUTH_PROOF_SUITE_P256 || !isValidP256Spki(key.publicKey)) throw new DeviceAuthError("proof_invalid");
  const thumbprint = computeKeyThumbprint(key.publicKey);
  if (thumbprint === null || thumbprint !== key.keyThumbprint) throw new DeviceAuthError("proof_invalid");
  validateProof(proof, expected, rawBody, current);
  const preimage = buildLifecycleProofPreimage({
    method: expected.method, origin: proof.configuredOrigin, path: expected.path, purpose: expected.purpose,
    deviceId: expected.deviceId, thumbprint, bodySha256: proof.bodySha256, idempotencyKey: proof.idempotencyKey,
    nonce: proof.nonce, issuedAt: proof.issuedAt, accessTokenSha256: expected.accessToken === undefined ? "NONE" : sha256Digest(expected.accessToken)
  });
  await verifyDeviceProof({ suite: DEVICE_AUTH_PROOF_SUITE_P256, devicePublicKey: key.publicKey, signature: proof.signature, preimage });
  return thumbprint;
}

export function buildLifecycleProofPreimage(args: {
  method: "POST" | "GET"; origin: string; path: string; purpose: string; deviceId: string;
  thumbprint: string; bodySha256: string; idempotencyKey: string; nonce: string; issuedAt: string; accessTokenSha256: string;
}): string {
  return [
    "SKILLMAP-DEVICE-PROOF-V2", DEVICE_AUTH_PROOF_SUITE_P256, args.method,
    args.origin, args.path, DEVICE_AUTH_AUDIENCE, args.purpose,
    args.deviceId, args.thumbprint, args.bodySha256,
    args.idempotencyKey === "" ? "NONE" : args.idempotencyKey, args.nonce, args.issuedAt,
    args.accessTokenSha256, ""
  ].join("\n");
}

function requestDigest(proof: LifecycleProofEnvelope, operation: string): string {
  return buildIdempotencyDigest({ suite: DEVICE_AUTH_PROOF_SUITE_P256, method: proof.method, origin: proof.configuredOrigin, path: proof.path, audience: DEVICE_AUTH_AUDIENCE, operation, bodySha256: proof.bodySha256, idempotencyKey: proof.idempotencyKey || "NONE" });
}

export async function cancelPairing(deps: LifecycleDependencies, input: LifecycleInput): Promise<{ status: "cancelled" }> {
  if (!isCancelRequest(input.body)) throw new DeviceAuthError("invalid_request");
  const body = input.body as CancelRequestV1;
  if (!isIdempotencyKey(input.proof.idempotencyKey)) throw new DeviceAuthError("invalid_request");
  const current = now(deps);
  const thumbprint = await verifyStoredKey(deps.repository, input.proof, { path: CANCEL_PATH, method: "POST", purpose: CANCEL_PURPOSE, deviceId: body.device_id }, input.rawBody, current);
  return deps.repository.cancelPairing({
    p_device_code_digest: sha256Digest(body.device_code).slice(7), p_device_id: body.device_id, p_key_thumbprint: thumbprint,
    p_audience: DEVICE_AUTH_AUDIENCE, p_proof_suite: DEVICE_AUTH_PROOF_SUITE_P256, p_proof_purpose: CANCEL_PURPOSE,
    p_proof_nonce: input.proof.nonce, p_issued_at: input.proof.issuedAt, p_request_digest: requestDigest(input.proof, "cancel"),
    p_idempotency_key: input.proof.idempotencyKey, p_reason: body.reason
  });
}

export async function authenticateAccessToken(deps: LifecycleDependencies, input: AuthenticatedLifecycleInput): Promise<AuthenticateResponseV1> {
  const presentedToken = input.proofAccessToken ?? input.accessToken ?? "";
  if (!isAuthenticateRequest(input.body) || !isAccessToken(presentedToken)) throw new DeviceAuthError("invalid_request");
  const body = input.body as AuthenticateRequestV1;
  const token = presentedToken;
  const current = now(deps);
  const thumbprint = await verifyStoredKey(deps.repository, input.proof, { path: AUTHENTICATE_PATH, method: "POST", purpose: AUTHENTICATE_PURPOSE, deviceId: body.device_id, accessToken: token }, input.rawBody, current);
  const keys = deps.lookupKeys ?? [];
  if (keys.length < 1 || keys.length > 2) throw new DeviceAuthUnavailableError("DeviceAuth lookup key ring unavailable.");
  const candidates = digestWithLookupCandidates(keys, "access-token", token);
  const result = await deps.repository.authenticate({
    p_access_token_digests: candidates.digests, p_access_token_key_versions: candidates.versions, p_device_id: body.device_id,
    p_key_thumbprint: thumbprint, p_audience: DEVICE_AUTH_AUDIENCE, p_proof_suite: DEVICE_AUTH_PROOF_SUITE_P256,
    p_proof_purpose: AUTHENTICATE_PURPOSE, p_proof_nonce: input.proof.nonce, p_issued_at: input.proof.issuedAt,
    p_request_digest: requestDigest(input.proof, "authenticate")
  });
  return result;
}

// The access token is intentionally carried outside the generic input object;
// it is never copied into repository inputs or response objects.
export interface AuthenticatedLifecycleInput extends LifecycleInput { proofAccessToken?: string; accessToken?: string; }

export async function getDeviceStatus(deps: LifecycleDependencies, input: AuthenticatedLifecycleInput, devicePublicId: string): Promise<StatusResponseV1> {
  const presentedToken = input.proofAccessToken ?? input.accessToken ?? "";
  if (!isDevicePublicId(devicePublicId) || !isAccessToken(presentedToken)) throw new DeviceAuthError("invalid_request");
  const token = presentedToken;
  const current = now(deps);
  const thumbprint = await verifyStoredKey(deps.repository, input.proof, { path: statusPath(devicePublicId), method: "GET", purpose: STATUS_PURPOSE, deviceId: input.proof.deviceIdHeader, accessToken: token }, input.rawBody, current);
  const keys = deps.lookupKeys ?? [];
  if (keys.length < 1 || keys.length > 2) throw new DeviceAuthUnavailableError("DeviceAuth lookup key ring unavailable.");
  const candidates = digestWithLookupCandidates(keys, "access-token", token);
  const result = await deps.repository.getStatus({
    p_access_token_digests: candidates.digests, p_access_token_key_versions: candidates.versions, p_device_id: input.proof.deviceIdHeader,
    p_device_public_id: devicePublicId, p_key_thumbprint: thumbprint, p_audience: DEVICE_AUTH_AUDIENCE,
    p_proof_suite: DEVICE_AUTH_PROOF_SUITE_P256, p_proof_purpose: STATUS_PURPOSE, p_proof_nonce: input.proof.nonce,
    p_issued_at: input.proof.issuedAt
  });
  if (result.device_public_id !== devicePublicId) throw new DeviceAuthError("invalid_token");
  return result;
}

export async function revokeDevice(deps: LifecycleDependencies, input: AuthenticatedLifecycleInput, devicePublicId: string): Promise<RevokeResponseV1> {
  const presentedToken = input.proofAccessToken ?? input.accessToken ?? "";
  if (!isDevicePublicId(devicePublicId) || !isRevokeRequest(input.body) || !isAccessToken(presentedToken)) throw new DeviceAuthError("invalid_request");
  const token = presentedToken;
  if (!isIdempotencyKey(input.proof.idempotencyKey)) throw new DeviceAuthError("invalid_request");
  const current = now(deps);
  const exactRequestDigest = requestDigest(input.proof, "revoke");
  const proofKey = deps.repository.getRevokeProofKey
    ? await deps.repository.getRevokeProofKey(input.proof.deviceIdHeader, devicePublicId, input.proof.idempotencyKey, exactRequestDigest)
    : undefined;
  const thumbprint = await verifyStoredKey(deps.repository, input.proof, { path: revokePath(devicePublicId), method: "POST", purpose: REVOKE_PURPOSE, deviceId: input.proof.deviceIdHeader, accessToken: token }, input.rawBody, current, proofKey);
  const keys = deps.lookupKeys ?? [];
  if (keys.length < 1 || keys.length > 2) throw new DeviceAuthUnavailableError("DeviceAuth lookup key ring unavailable.");
  const candidates = digestWithLookupCandidates(keys, "access-token", token);
  const result = await deps.repository.revoke({
    p_access_token_digests: candidates.digests, p_access_token_key_versions: candidates.versions, p_device_id: input.proof.deviceIdHeader,
    p_device_public_id: devicePublicId, p_key_thumbprint: thumbprint, p_audience: DEVICE_AUTH_AUDIENCE,
    p_proof_suite: DEVICE_AUTH_PROOF_SUITE_P256, p_proof_purpose: REVOKE_PURPOSE, p_proof_nonce: input.proof.nonce,
    p_issued_at: input.proof.issuedAt, p_request_digest: exactRequestDigest, p_idempotency_key: input.proof.idempotencyKey,
    p_reason: (input.body as RevokeRequestV1).reason
  });
  if (result.device_public_id !== devicePublicId) throw new DeviceAuthError("invalid_token");
  return result;
}

/** Parse the only accepted Authorization form at the route boundary. */
export { strictBearerToken };

export const authenticateDeviceToken = authenticateAccessToken;
export const statusDevice = getDeviceStatus;
export const revokeConnectorDevice = revokeDevice;
export const cancelDevicePairing = cancelPairing;
