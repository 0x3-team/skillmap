import "server-only";

import { DeviceAuthError, DeviceAuthUnavailableError } from "./errors.ts";
import {
  buildIdempotencyDigest,
  computeKeyThumbprint,
  isValidRequestDigest,
  sha256Digest,
  verifyDeviceProof
} from "./crypto.server.ts";
import { DEVICE_AUTH_AUDIENCE, DEVICE_AUTH_PROOF_SUITE_P256 } from "./contracts.ts";
import { digestRotationIdempotencyKeyRing, type RotationIdempotencyDigest } from "./key-rotation-crypto.server.ts";
import {
  isDeviceKeyRotationRequest,
  isDeviceKeyRotationResponse,
  isDevicePublicId,
  isIssuedAt,
  isRotationProofEnvelope,
  ROTATE_NEW_PURPOSE,
  ROTATE_OLD_PURPOSE,
  ROTATE_OPERATION,
  rotationPath,
  type DeviceKeyRotationProofEnvelope,
  type DeviceKeyRotationRequestV1,
  type DeviceKeyRotationResponseV1
} from "./key-rotation-contracts.server.ts";
import type { DeviceAuthProofKey } from "./poll-exchange-repository.server.ts";

export interface DeviceKeyRotationRepositoryInput {
  devicePublicId: string;
  deviceId: string;
  oldKeyThumbprint: string;
  newPublicKey: string;
  newKeyThumbprint: string;
  audience: string;
  proofSuite: string;
  oldProofPurpose: string;
  newProofPurpose: string;
  oldProofNonce: string;
  newProofNonce: string;
  oldIssuedAt: string;
  newIssuedAt: string;
  requestDigest: string;
  idempotencyKeyDigest: string;
  idempotencyKeyVersion: number;
}

export interface DeviceKeyRotationRepository {
  getActiveProofKey(deviceId: string): Promise<DeviceAuthProofKey>;
  getRotationReceipt?(devicePublicId: string, idempotencyKeys: readonly RotationIdempotencyDigest[], requestDigest: string): Promise<DeviceKeyRotationResponseV1 | null>;
  rotateKey(input: DeviceKeyRotationRepositoryInput): Promise<DeviceKeyRotationResponseV1>;
}

export interface DeviceKeyRotationServiceInput {
  devicePublicId: string;
  body: DeviceKeyRotationRequestV1;
  proof: DeviceKeyRotationProofEnvelope;
  rawBody: Uint8Array;
}

export interface DeviceKeyRotationDependencies {
  repository: DeviceKeyRotationRepository;
  lookupKeys: readonly import("./lifecycle-crypto.server.ts").DeviceAuthLookupKey[];
  now?: () => number;
}

export async function rotateDeviceKey(
  deps: DeviceKeyRotationDependencies,
  input: DeviceKeyRotationServiceInput
): Promise<DeviceKeyRotationResponseV1> {
  if (!isDevicePublicId(input.devicePublicId) || !isDeviceKeyRotationRequest(input.body)) throw new DeviceAuthError("invalid_request");
  if (!isRotationProofEnvelope(input.proof) || input.proof.path !== rotationPath(input.devicePublicId)) throw new DeviceAuthError("proof_invalid");
  if (input.proof.deviceIdHeader !== input.body.device_id || input.proof.audience !== input.body.audience) throw new DeviceAuthError("proof_invalid");
  if (input.proof.bodySha256 !== sha256Digest(input.rawBody)) throw new DeviceAuthError("proof_invalid");
  if (!isValidRequestDigest(input.proof.bodySha256)) throw new DeviceAuthError("proof_invalid");
  const newThumbprint = computeKeyThumbprint(input.body.new_device_public_key);
  if (newThumbprint === null || newThumbprint !== input.body.new_device_public_key_thumbprint) throw new DeviceAuthError("proof_invalid");

  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const oldIssuedAt = Number(input.proof.oldIssuedAt);
  const newIssuedAt = Number(input.proof.newIssuedAt);
  if (!isIssuedAt(input.proof.oldIssuedAt) || !isIssuedAt(input.proof.newIssuedAt)
      || Math.abs(now - oldIssuedAt) > 60 || Math.abs(now - newIssuedAt) > 60) throw new DeviceAuthError("invalid_request");

  const requestDigest = buildIdempotencyDigest({
    suite: DEVICE_AUTH_PROOF_SUITE_P256,
    method: "POST",
    origin: input.proof.configuredOrigin,
    path: input.proof.path,
    audience: DEVICE_AUTH_AUDIENCE,
    operation: ROTATE_OPERATION,
    bodySha256: input.proof.bodySha256,
    idempotencyKey: input.proof.idempotencyKey
  });
  if (!isValidRequestDigest(requestDigest)) throw new DeviceAuthError("invalid_request");

  let idempotencyKeys: RotationIdempotencyDigest[];
  try {
    idempotencyKeys = digestRotationIdempotencyKeyRing(deps.lookupKeys, input.proof.idempotencyKey);
  } catch {
    throw new DeviceAuthUnavailableError("DeviceAuth lookup key is unavailable.");
  }

  // An exact retry is a safe, bounded non-secret receipt replay. It is checked
  // before active-key verification because the old key is intentionally
  // rejected immediately after the committed replacement.
  if (deps.repository.getRotationReceipt) {
    const replay = await deps.repository.getRotationReceipt(input.devicePublicId, idempotencyKeys, requestDigest);
    if (replay !== null) {
      if (!isDeviceKeyRotationResponse(replay) || replay.device_public_id !== input.devicePublicId) throw new DeviceAuthUnavailableError("Invalid rotation receipt.");
      return replay;
    }
  }

  // The active binding is fetched before the transition RPC. The old proof is
  // therefore authorized against the stored key, never a caller-supplied key.
  const oldKey = await deps.repository.getActiveProofKey(input.body.device_id);
  if (oldKey.proofSuite !== DEVICE_AUTH_PROOF_SUITE_P256) throw new DeviceAuthError("proof_invalid");
  const oldThumbprint = computeKeyThumbprint(oldKey.publicKey);
  if (oldThumbprint === null || oldThumbprint !== oldKey.keyThumbprint) throw new DeviceAuthError("proof_invalid");
  if (oldThumbprint === newThumbprint) throw new DeviceAuthError("invalid_request");

  await verifyDeviceProof({
    suite: DEVICE_AUTH_PROOF_SUITE_P256,
    devicePublicKey: oldKey.publicKey,
    signature: input.proof.oldSignature,
    preimage: rotationProofPreimage(input.proof, input.proof.path, ROTATE_OLD_PURPOSE, input.body.device_id, oldThumbprint, input.proof.oldNonce, oldIssuedAt)
  });
  await verifyDeviceProof({
    suite: DEVICE_AUTH_PROOF_SUITE_P256,
    devicePublicKey: input.body.new_device_public_key,
    signature: input.proof.newSignature,
    preimage: rotationProofPreimage(input.proof, input.proof.path, ROTATE_NEW_PURPOSE, input.body.device_id, newThumbprint, input.proof.newNonce, newIssuedAt, oldThumbprint, input.body.new_device_public_key)
  });

  const result = await deps.repository.rotateKey({
    devicePublicId: input.devicePublicId,
    deviceId: input.body.device_id,
    oldKeyThumbprint: oldThumbprint,
    newPublicKey: input.body.new_device_public_key,
    newKeyThumbprint: newThumbprint,
    audience: DEVICE_AUTH_AUDIENCE,
    proofSuite: DEVICE_AUTH_PROOF_SUITE_P256,
    oldProofPurpose: ROTATE_OLD_PURPOSE,
    newProofPurpose: ROTATE_NEW_PURPOSE,
    oldProofNonce: input.proof.oldNonce,
    newProofNonce: input.proof.newNonce,
    oldIssuedAt: input.proof.oldIssuedAt,
    newIssuedAt: input.proof.newIssuedAt,
    requestDigest,
    idempotencyKeyDigest: idempotencyKeys[0].digest,
    idempotencyKeyVersion: idempotencyKeys[0].version
  });
  if (!isDeviceKeyRotationResponse(result) || result.device_public_id !== input.devicePublicId || result.new_device_public_key_thumbprint !== newThumbprint) {
    throw new DeviceAuthUnavailableError("Device key rotation response was invalid.");
  }
  return result;
}

export function rotationProofPreimage(
  proof: DeviceKeyRotationProofEnvelope,
  path: string,
  purpose: typeof ROTATE_OLD_PURPOSE | typeof ROTATE_NEW_PURPOSE,
  deviceId: string,
  thumbprint: string,
  nonce: string,
  issuedAt: number,
  oldThumbprint?: string,
  newPublicKey?: string
): string {
  if (purpose === ROTATE_NEW_PURPOSE) {
    // The possession transcript is intentionally separate from the generic
    // V2 proof transcript. It binds the exact prior active thumbprint and the
    // exact successor SPKI as well as the request/body/path/idempotency data.
    return [
      "SKILLMAP-DEVICE-ROTATION-NEW-PROOF-V2",
      DEVICE_AUTH_PROOF_SUITE_P256,
      "POST",
      proof.configuredOrigin,
      path,
      DEVICE_AUTH_AUDIENCE,
      purpose,
      deviceId,
      oldThumbprint ?? "",
      thumbprint,
      newPublicKey ?? "",
      proof.bodySha256,
      proof.idempotencyKey,
      nonce,
      String(issuedAt),
      "NONE",
      ""
    ].join("\n");
  }
  return [
    "SKILLMAP-DEVICE-PROOF-V2",
    DEVICE_AUTH_PROOF_SUITE_P256,
    "POST",
    proof.configuredOrigin,
    path,
    DEVICE_AUTH_AUDIENCE,
    purpose,
    deviceId,
    thumbprint,
    proof.bodySha256,
    proof.idempotencyKey,
    nonce,
    String(issuedAt),
    "NONE",
    ""
  ].join("\n");
}
