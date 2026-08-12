import "server-only";

import { canonicalizeScopes, DEVICE_AUTH_AUDIENCE, DEVICE_AUTH_PROOF_SUITE_P256 } from "./contracts.ts";

export const POLL_PATH = "/api/device-auth/v1/pairings/poll" as const;
export const EXCHANGE_PATH = "/api/device-auth/v1/pairings/exchange" as const;

export interface PollPairingRequestV1 {
  device_code: string;
  device_id: string;
  audience: string;
}

export interface PollPairingSuccessV1 {
  exchange_code: string;
  expires_in: number;
  scopes: string[];
}

export interface ExchangePairingRequestV1 {
  exchange_code: string;
  device_id: string;
  device_public_key_thumbprint: string;
  audience: string;
  requested_scopes: string[];
}

export interface ExchangePairingSuccessV1 {
  device_public_id: string;
  account_public_id: string;
  token_family_id: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_idle_expires_in: number;
  refresh_absolute_expires_in: number;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isPollRequest(value: unknown): value is PollPairingRequestV1 {
  return isPlainRecord(value)
    && hasExactKeys(value, ["device_code", "device_id", "audience"])
    && typeof value.device_code === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.device_code)
    && typeof value.device_id === "string" && /^[A-Za-z0-9_-]{22}$/.test(value.device_id)
    && value.audience === DEVICE_AUTH_AUDIENCE;
}

export function isExchangeRequest(value: unknown): value is ExchangePairingRequestV1 {
  return isPlainRecord(value)
    && hasExactKeys(value, ["exchange_code", "device_id", "device_public_key_thumbprint", "audience", "requested_scopes"])
    && typeof value.exchange_code === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.exchange_code)
    && typeof value.device_id === "string" && /^[A-Za-z0-9_-]{22}$/.test(value.device_id)
    && typeof value.device_public_key_thumbprint === "string" && /^sha256:[0-9a-f]{64}$/.test(value.device_public_key_thumbprint)
    && value.audience === DEVICE_AUTH_AUDIENCE
    && Array.isArray(value.requested_scopes)
    && canonicalizeScopes(value.requested_scopes) !== null;
}

export function isPollSuccess(value: unknown): value is PollPairingSuccessV1 {
  return isPlainRecord(value)
    && hasExactKeys(value, ["exchange_code", "expires_in", "scopes"])
    && typeof value.exchange_code === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.exchange_code)
    && typeof value.expires_in === "number" && Number.isSafeInteger(value.expires_in) && value.expires_in > 0
    && Array.isArray(value.scopes) && canonicalizeScopes(value.scopes) !== null;
}

export function isExchangeSuccess(value: unknown): value is ExchangePairingSuccessV1 {
  return isPlainRecord(value)
    && hasExactKeys(value, [
      "device_public_id", "account_public_id", "token_family_id", "access_token", "refresh_token",
      "expires_in", "refresh_idle_expires_in", "refresh_absolute_expires_in"
    ])
    && typeof value.device_public_id === "string" && /^dev_[0-9a-f]{32}$/.test(value.device_public_id)
    && typeof value.account_public_id === "string" && /^acct_[0-9a-f]{32}$/.test(value.account_public_id)
    && typeof value.token_family_id === "string" && /^fam_[0-9a-f]{32}$/.test(value.token_family_id)
    && typeof value.access_token === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.access_token)
    && typeof value.refresh_token === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.refresh_token)
    && [value.expires_in, value.refresh_idle_expires_in, value.refresh_absolute_expires_in]
      .every((n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0);
}

export const POLL_PROOF_SUITE = DEVICE_AUTH_PROOF_SUITE_P256;
export const POLL_AUDIENCE = DEVICE_AUTH_AUDIENCE;
