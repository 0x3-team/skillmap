import "server-only";

import { createHmac } from "node:crypto";
import type { DeviceAuthLookupKey } from "./lifecycle-crypto.server.ts";

const ROTATION_IDEMPOTENCY_PURPOSE = "idempotency.rotation" as const;
const IDENTITY = /^[A-Za-z0-9_-]{22}$/;
const HMAC_DIGEST = /^hmac-sha256:[0-9a-f]{64}$/;

export interface RotationIdempotencyDigest {
  digest: string;
  version: number;
}

/**
 * Derive the SQL lookup handle from the validated server-side lookup ring.
 * The raw Idempotency-Key never crosses this boundary; purpose separation and
 * the explicit version keep rotation receipts isolated from token digests.
 */
export function digestRotationIdempotencyKey(key: DeviceAuthLookupKey, rawKey: string): RotationIdempotencyDigest {
  if (!IDENTITY.test(rawKey)) throw new Error("invalid rotation idempotency key");
  if (!Number.isSafeInteger(key.version) || key.version < 1 || key.key.byteLength !== 32) throw new Error("invalid device-auth lookup key");
  const digest = createHmac("sha256", Buffer.from(key.key))
    .update(`SKILLMAP-DEVICE-AUTH-HMAC-V1\n${ROTATION_IDEMPOTENCY_PURPOSE}\n${rawKey}\n`, "utf8")
    .digest("hex");
  return { digest: `hmac-sha256:${digest}`, version: key.version };
}

export function digestRotationIdempotencyKeyRing(keys: readonly DeviceAuthLookupKey[], rawKey: string): RotationIdempotencyDigest[] {
  if (keys.length < 1 || keys.length > 2) throw new Error("DeviceAuth lookup ring is out of bounds.");
  const candidates = keys.map((key) => digestRotationIdempotencyKey(key, rawKey));
  if (new Set(candidates.map((candidate) => candidate.version)).size !== candidates.length) throw new Error("DeviceAuth lookup key versions are invalid.");
  return candidates;
}

export function isRotationIdempotencyDigest(value: unknown): value is string {
  return typeof value === "string" && HMAC_DIGEST.test(value);
}
