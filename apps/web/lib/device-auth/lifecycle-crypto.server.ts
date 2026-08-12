import "server-only";

import { createHmac } from "node:crypto";
import { base64UrlDecode } from "./crypto.server.ts";
import { DeviceAuthError } from "./errors.ts";

export interface DeviceAuthLookupKey { readonly version: number; readonly key: Uint8Array; }

/**
 * The online lookup ring is deliberately bounded to the current and one
 * previous version. Digests include the purpose line, so an access digest
 * cannot be replayed as a refresh or idempotency digest.
 */
export function deviceAuthLookupKeysFromEnvironment(environment: Record<string, string | undefined> = process.env): DeviceAuthLookupKey[] {
  const current = parseKey(environment.DEVICE_AUTH_LOOKUP_KEY, environment.DEVICE_AUTH_LOOKUP_KEY_VERSION);
  const previous = parseKey(environment.DEVICE_AUTH_LOOKUP_KEY_PREVIOUS, environment.DEVICE_AUTH_LOOKUP_KEY_PREVIOUS_VERSION);
  const keys = [current, previous].filter((value): value is DeviceAuthLookupKey => value !== null);
  if (keys.length === 0) throw new Error("DeviceAuth lookup key is unavailable.");
  if (new Set(keys.map((key) => key.version)).size !== keys.length) throw new Error("DeviceAuth lookup key versions are invalid.");
  return keys;
}

function parseKey(encoded: string | undefined, versionText: string | undefined): DeviceAuthLookupKey | null {
  const value = (encoded ?? "").trim();
  if (!value) return null;
  const version = Number((versionText ?? "").trim());
  if (!/^[A-Za-z0-9_-]{43}$/.test(value) || !Number.isSafeInteger(version) || version < 1) throw new Error("DeviceAuth lookup key is unavailable.");
  let key: Uint8Array;
  try { key = base64UrlDecode(value); } catch { throw new Error("DeviceAuth lookup key is unavailable."); }
  if (key.byteLength !== 32) throw new Error("DeviceAuth lookup key is unavailable.");
  return { key, version };
}

export function digestDeviceAuthToken(key: DeviceAuthLookupKey, purpose: "access-token" | "idempotency-key", value: string): string {
  const digest = createHmac("sha256", Buffer.from(key.key))
    .update(`SKILLMAP-DEVICE-AUTH-HMAC-V1\n${purpose}\n${value}\n`, "utf8")
    .digest("hex");
  return `hmac-sha256:${digest}`;
}

export function digestWithLookupCandidates(keys: readonly DeviceAuthLookupKey[], purpose: "access-token" | "idempotency-key", value: string): { digests: string[]; versions: number[] } {
  if (keys.length < 1 || keys.length > 2) throw new Error("DeviceAuth lookup ring is out of bounds.");
  return {
    digests: keys.map((key) => digestDeviceAuthToken(key, purpose, value)),
    versions: keys.map((key) => key.version)
  };
}

export function strictBearerToken(value: string | null): string {
  if (value === null || !/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) throw new DeviceAuthError("invalid_token");
  return value.slice("Bearer ".length);
}
