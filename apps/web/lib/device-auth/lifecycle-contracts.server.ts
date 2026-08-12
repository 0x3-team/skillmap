import "server-only";

import { canonicalizeScopes, DEVICE_AUTH_AUDIENCE } from "./contracts.ts";

export const CANCEL_PATH = "/api/device-auth/v1/pairings/cancel" as const;
export const AUTHENTICATE_PATH = "/api/device-auth/v1/tokens/authenticate" as const;
export const STATUS_PATH = "/api/device-auth/v1/devices" as const;
export const REVOKE_PATH = "/api/device-auth/v1/devices" as const;

export const CANCEL_PURPOSE = "cancel" as const;
export const AUTHENTICATE_PURPOSE = "authenticate" as const;
export const STATUS_PURPOSE = "protected.status" as const;
export const REVOKE_PURPOSE = "revoke" as const;

const ID = /^[A-Za-z0-9_-]{22}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_ID = /^dev_[0-9a-f]{32}$/;
const ISSUED_AT = /^[0-9]{1,20}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const THUMBPRINT = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const FAMILY = /^fam_[0-9a-f]{32}$/;

export type CancelReason = "user_cancelled" | "timeout" | "local_shutdown";
export type RevokeReason = "user_offboarded" | "suspected_compromise" | "account_disabled" | "owner_requested" | "operator_incident";

export interface CancelRequestV1 { device_code: string; device_id: string; audience: string; reason: CancelReason; }
export interface AuthenticateRequestV1 { device_id: string; audience: string; }
export interface RevokeRequestV1 { reason: RevokeReason; }

export interface AuthenticateResponseV1 {
  active: true;
  device_public_id: string;
  account_public_id: string;
  scopes: string[];
  audience: typeof DEVICE_AUTH_AUDIENCE;
  expires_at: number;
}
export interface StatusResponseV1 {
  device_public_id: string;
  account_public_id: string;
  state: string;
  scopes: string[];
  expires_at: number;
  key_thumbprint: string;
}
export interface RevokeResponseV1 { status: "revoked"; device_public_id: string; }

export interface LifecycleProofEnvelope {
  configuredOrigin: string;
  path: string;
  method: "POST" | "GET";
  proofSuite: string;
  audience: string;
  purpose: string;
  deviceIdHeader: string;
  keyThumbprint: string;
  nonce: string;
  issuedAt: string;
  bodySha256: string;
  signature: string;
  idempotencyKey: string;
  accessTokenSha256: string;
}

export function cancelPath(): string { return CANCEL_PATH; }
export function authenticatePath(): string { return AUTHENTICATE_PATH; }
export function statusPath(devicePublicId: string): string { return `${STATUS_PATH}/${devicePublicId}`; }
export function revokePath(devicePublicId: string): string { return `${REVOKE_PATH}/${devicePublicId}/revoke`; }

export function isDeviceId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
export function isDeviceCode(value: unknown): value is string { return typeof value === "string" && CODE.test(value); }
export function isDevicePublicId(value: unknown): value is string { return typeof value === "string" && PUBLIC_ID.test(value); }
export function isAccessToken(value: unknown): value is string { return typeof value === "string" && TOKEN.test(value); }
export function isIdempotencyKey(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
export function isIssuedAt(value: unknown): value is string { return typeof value === "string" && ISSUED_AT.test(value) && Number.isSafeInteger(Number(value)); }
export function isSignature(value: unknown): value is string { return typeof value === "string" && SIGNATURE.test(value); }
export function isThumbprint(value: unknown): value is string { return typeof value === "string" && THUMBPRINT.test(value); }
export function isTokenFamilyId(value: unknown): value is string { return typeof value === "string" && FAMILY.test(value); }

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

export function isCancelRequest(value: unknown): value is CancelRequestV1 {
  return object(value) && exact(value, ["device_code", "device_id", "audience", "reason"])
    && isDeviceCode(value.device_code) && isDeviceId(value.device_id)
    && value.audience === DEVICE_AUTH_AUDIENCE
    && (value.reason === "user_cancelled" || value.reason === "timeout" || value.reason === "local_shutdown");
}
export function isAuthenticateRequest(value: unknown): value is AuthenticateRequestV1 {
  return object(value) && exact(value, ["device_id", "audience"])
    && isDeviceId(value.device_id) && value.audience === DEVICE_AUTH_AUDIENCE;
}
export function isRevokeRequest(value: unknown): value is RevokeRequestV1 {
  return object(value) && exact(value, ["reason"])
    && (value.reason === "user_offboarded" || value.reason === "suspected_compromise" || value.reason === "account_disabled" || value.reason === "owner_requested" || value.reason === "operator_incident");
}
export function isCanonicalLifecycleScopes(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const canonical = canonicalizeScopes(value as string[]);
  return canonical !== null && canonical.length === value.length && canonical.every((scope, index) => scope === value[index]);
}
export function isAuthenticateResponse(value: unknown): value is AuthenticateResponseV1 {
  return object(value) && exact(value, ["active", "device_public_id", "account_public_id", "scopes", "audience", "expires_at"])
    && value.active === true && isDevicePublicId(value.device_public_id)
    && typeof value.account_public_id === "string" && /^acct_[0-9a-f]{32}$/.test(value.account_public_id)
    && isCanonicalLifecycleScopes(value.scopes) && value.audience === DEVICE_AUTH_AUDIENCE
    && typeof value.expires_at === "number" && Number.isSafeInteger(value.expires_at) && value.expires_at > 0;
}
export function isStatusResponse(value: unknown): value is StatusResponseV1 {
  return object(value) && exact(value, ["device_public_id", "account_public_id", "state", "scopes", "expires_at", "key_thumbprint"])
    && isDevicePublicId(value.device_public_id) && typeof value.account_public_id === "string" && /^acct_[0-9a-f]{32}$/.test(value.account_public_id)
    && (value.state === "active" || value.state === "disabled" || value.state === "revoked" || value.state === "compromised" || value.state === "expired")
    && isCanonicalLifecycleScopes(value.scopes) && typeof value.expires_at === "number" && Number.isSafeInteger(value.expires_at) && value.expires_at >= 0
    && isThumbprint(value.key_thumbprint);
}
export function isRevokeResponse(value: unknown): value is RevokeResponseV1 {
  return object(value) && exact(value, ["status", "device_public_id"]) && value.status === "revoked" && isDevicePublicId(value.device_public_id);
}
