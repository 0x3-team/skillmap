/* DeviceAuth v1 shared wire-level constants and normalization helpers
 * (M1.08). Values here are frozen by the contract, not deployment config. */

export const DEVICE_AUTH_SCHEMA_IDS = {
  common: "https://skillmap.dev/contracts/device-auth/common/v1.schema.json",
  initiateRequest: "https://skillmap.dev/contracts/device-auth/v1/initiate-request.schema.json",
  initiateResponse: "https://skillmap.dev/contracts/device-auth/v1/initiate-response.schema.json",
  error: "https://skillmap.dev/contracts/device-auth/v1/error.schema.json"
} as const;

export const DEVICE_AUTH_AUDIENCE = "skillmap.connector.v1" as const;
export const DEVICE_AUTH_PROOF_SUITE_P256 = "skillmap.ecdsa-p256-sha256.v2" as const;
export type DeviceAuthProofSuiteV1 = "skillmap.ecdsa-p256-sha256.v2" | "skillmap.ed25519.v1";
export const DEVICE_AUTH_SCOPES = ["device.route", "device.feedback", "device.import", "device.bundle", "device.status"] as const;
export type DeviceAuthScope = (typeof DEVICE_AUTH_SCOPES)[number];

/** Wire shape of POST /pairings body (closed, M1.08). */
export interface DeviceAuthInitiateRequestV1 {
  device_id: string;
  device_public_key: string;
  key_thumbprint: string;
  audience: string;
  proof_suite: string;
  requested_scopes: string[];
  platform: "macos" | "windows" | "linux";
  connector_version: string;
  display_name?: string;
  locale?: string;
}

const ALLOWED_SCOPE_RE = /^device\.[a-z.-]+$/;

/**
 * Canonicalize requested scopes to the closed, de-duplicated, ordered set.
 * Returns null on any invalid scope, empty list, or array with extraneous
 * properties — never a partial set (fail closed, M3.02 Decision 13).
 */
export function canonicalizeScopes(requested: readonly string[]): string[] | null {
  if (!Array.isArray(requested) || requested.length === 0) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const scope of requested) {
    if (typeof scope !== "string") return null;
    const declared = (DEVICE_AUTH_SCOPES as readonly string[]).includes(scope);
    if (!declared || !ALLOWED_SCOPE_RE.test(scope)) return null;
    if (seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out.sort();
}

/** Normalize display name (1-64, control chars stripped). Null if out of bounds. */
export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let stripped = "";
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) continue; // strip C0 + DEL controls
    stripped += ch;
  }
  stripped = stripped.trim();
  if (stripped.length < 1 || stripped.length > 64) return null;
  return stripped;
}

/** Normalize locale to a lowercase BCP-47 tag; null if invalid. */
export function normalizeLocale(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 35) return null;
  if (!/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** Loose semver check for connector_version (M1.08). */
export function isValidSemVer(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(value);
}

/** Build the verification URL (origin + fixed /device path) for responses. */
export function verificationUriFromOrigin(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/device`;
}