import "server-only";

import { DEVICE_AUTH_AUDIENCE, DEVICE_AUTH_PROOF_SUITE_P256 } from "./contracts.ts";
import { isValidKeyThumbprint, isValidP256Spki, isValidRequestDigest } from "./crypto.server.ts";

export const ROTATE_PATH_PREFIX = "/api/device-auth/v1/devices/" as const;
export const ROTATE_PATH_SUFFIX = "/rotate" as const;
export const ROTATE_OPERATION = "rotate" as const;
export const ROTATE_OLD_PURPOSE = "rotate-old" as const;
export const ROTATE_NEW_PURPOSE = "rotate-new" as const;

const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;
const DEVICE_PUBLIC_ID = /^dev_[0-9a-f]{32}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{22}$/;
const ISSUED_AT = /^(?:0|[1-9][0-9]{0,19})$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

export interface DeviceKeyRotationRequestV1 {
  device_id: string;
  new_device_public_key: string;
  new_device_public_key_thumbprint: string;
  audience: typeof DEVICE_AUTH_AUDIENCE;
}

export interface DeviceKeyRotationResponseV1 {
  device_public_id: string;
  new_device_public_key_thumbprint: string;
  rotation_receipt_digest: string;
  effective_at: number;
}

export interface DeviceKeyRotationProofEnvelope {
  configuredOrigin: string;
  path: string;
  proofSuite: string;
  audience: string;
  proofSuiteHeader: string;
  audienceHeader: string;
  deviceIdHeader: string;
  bodySha256: string;
  idempotencyKey: string;
  oldPurpose: string;
  newPurpose: string;
  oldNonce: string;
  newNonce: string;
  oldIssuedAt: string;
  newIssuedAt: string;
  oldSignature: string;
  newSignature: string;
}

export function rotationPath(devicePublicId: string): string {
  return `${ROTATE_PATH_PREFIX}${devicePublicId}${ROTATE_PATH_SUFFIX}`;
}

export function isDevicePublicId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_PUBLIC_ID.test(value);
}

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID.test(value);
}

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY.test(value);
}

export function isIssuedAt(value: unknown): value is string {
  return typeof value === "string" && ISSUED_AT.test(value) && Number.isSafeInteger(Number(value));
}

export function isDeviceKeyRotationRequest(value: unknown): value is DeviceKeyRotationRequestV1 {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys.join("\u0000") !== ["audience", "device_id", "new_device_public_key", "new_device_public_key_thumbprint"].join("\u0000")) return false;
  return isDeviceId(value.device_id)
    && typeof value.new_device_public_key === "string"
    && isValidP256Spki(value.new_device_public_key)
    && typeof value.new_device_public_key_thumbprint === "string"
    && isValidKeyThumbprint(value.new_device_public_key_thumbprint)
    && value.audience === DEVICE_AUTH_AUDIENCE;
}

export function isDeviceKeyRotationResponse(value: unknown): value is DeviceKeyRotationResponseV1 {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys.join("\u0000") !== ["device_public_id", "effective_at", "new_device_public_key_thumbprint", "rotation_receipt_digest"].join("\u0000")) return false;
  return isDevicePublicId(value.device_public_id)
    && typeof value.new_device_public_key_thumbprint === "string"
    && isValidKeyThumbprint(value.new_device_public_key_thumbprint)
    && typeof value.rotation_receipt_digest === "string"
    && isValidRequestDigest(value.rotation_receipt_digest)
    && typeof value.effective_at === "number"
    && Number.isSafeInteger(value.effective_at)
    && value.effective_at >= 0;
}

export function isRotationProofEnvelope(value: DeviceKeyRotationProofEnvelope): boolean {
  return value.path.startsWith(ROTATE_PATH_PREFIX)
    && value.path.endsWith(ROTATE_PATH_SUFFIX)
    && value.proofSuite === DEVICE_AUTH_PROOF_SUITE_P256
    && value.proofSuiteHeader === value.proofSuite
    && value.audience === DEVICE_AUTH_AUDIENCE
    && value.audienceHeader === value.audience
    && isDeviceId(value.deviceIdHeader)
    && isValidRequestDigest(value.bodySha256)
    && isIdempotencyKey(value.idempotencyKey)
    && value.oldPurpose === ROTATE_OLD_PURPOSE
    && value.newPurpose === ROTATE_NEW_PURPOSE
    && isIdempotencyKey(value.oldNonce)
    && isIdempotencyKey(value.newNonce)
    && value.oldNonce !== value.newNonce
    && isIssuedAt(value.oldIssuedAt)
    && isIssuedAt(value.newIssuedAt)
    && SIGNATURE.test(value.oldSignature)
    && SIGNATURE.test(value.newSignature);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
