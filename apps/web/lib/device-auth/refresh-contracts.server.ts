import "server-only";

import { DEVICE_AUTH_AUDIENCE, DEVICE_AUTH_PROOF_SUITE_P256, canonicalizeScopes } from "./contracts.ts";

export const REFRESH_PATH = "/api/device-auth/v1/tokens/refresh" as const;
export const REFRESH_RESPONSE_VERSION = "v1" as const;
export const REFRESH_REPLAY_SECONDS = 600;
export const REFRESH_PURGE_SECONDS = 900;
export const REFRESH_ACCESS_SECONDS = 600;
export const REFRESH_IDLE_SECONDS = 2_592_000;

const ID = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const FAMILY = /^fam_[0-9a-f]{32}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const HMAC = /^hmac-sha256:[0-9a-f]{64}$/;
const ISSUED_AT = /^[0-9]{1,20}$/;

export interface RefreshTokenRequestV1 {
  refresh_token: string;
  device_id: string;
  audience: typeof DEVICE_AUTH_AUDIENCE;
  token_family_id: string;
}

/** The eight-member success object is the client RefreshTokenResponse wire shape. */
export interface RefreshTokenResponseV1 {
  device_public_id: string;
  account_public_id: string;
  token_family_id: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_idle_expires_in: number;
  refresh_absolute_expires_in: number;
}

export interface RefreshProofEnvelope {
  configuredOrigin: string;
  path: string;
  proofSuite: string;
  audience: string;
  purpose: string;
  proofNonce: string;
  issuedAt: string;
  bodySha256: string;
  signature: string;
  proofSuiteHeader: string;
  audienceHeader: string;
  purposeHeader: string;
  deviceIdHeader: string;
  idempotencyKey: string;
}

export function isRefreshRequest(value: unknown): value is RefreshTokenRequestV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["refresh_token", "device_id", "audience", "token_family_id"])) return false;
  return typeof value.refresh_token === "string" && TOKEN.test(value.refresh_token)
    && typeof value.device_id === "string" && ID.test(value.device_id)
    && value.audience === DEVICE_AUTH_AUDIENCE
    && typeof value.token_family_id === "string" && FAMILY.test(value.token_family_id);
}

export function isRefreshResponse(value: unknown): value is RefreshTokenResponseV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, [
    "device_public_id", "account_public_id", "token_family_id", "access_token", "refresh_token",
    "expires_in", "refresh_idle_expires_in", "refresh_absolute_expires_in"
  ])) return false;
  return typeof value.device_public_id === "string" && /^dev_[0-9a-f]{32}$/.test(value.device_public_id)
    && typeof value.account_public_id === "string" && /^acct_[0-9a-f]{32}$/.test(value.account_public_id)
    && typeof value.token_family_id === "string" && FAMILY.test(value.token_family_id)
    && typeof value.access_token === "string" && TOKEN.test(value.access_token)
    && typeof value.refresh_token === "string" && TOKEN.test(value.refresh_token)
    && isPositiveInt(value.expires_in, REFRESH_ACCESS_SECONDS)
    && isPositiveInt(value.refresh_idle_expires_in, REFRESH_IDLE_SECONDS)
    && isPositiveInt(value.refresh_absolute_expires_in, 7_776_000)
    && value.expires_in <= value.refresh_idle_expires_in
    && value.refresh_idle_expires_in <= value.refresh_absolute_expires_in;
}

export function isRefreshProofEnvelope(value: RefreshProofEnvelope): boolean {
  return value.path === REFRESH_PATH
    && value.proofSuite === DEVICE_AUTH_PROOF_SUITE_P256
    && value.proofSuiteHeader === value.proofSuite
    && value.audience === DEVICE_AUTH_AUDIENCE
    && value.audienceHeader === value.audience
    && value.purpose === "refresh"
    && value.purposeHeader === value.purpose
    && ID.test(value.deviceIdHeader)
    && ID.test(value.proofNonce)
    && ISSUED_AT.test(value.issuedAt)
    && Number.isSafeInteger(Number(value.issuedAt))
    && DIGEST.test(value.bodySha256)
    && /^[A-Za-z0-9_-]{86}$/.test(value.signature)
    && ID.test(value.idempotencyKey);
}

export function isHmacDigest(value: unknown): value is string { return typeof value === "string" && HMAC.test(value); }
export function isSha256Digest(value: unknown): value is string { return typeof value === "string" && DIGEST.test(value); }
export function canonicalRefreshScopes(value: unknown): string[] | null { return Array.isArray(value) ? canonicalizeScopes(value as string[]) : null; }

function isPositiveInt(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => allowed.has(key));
}
