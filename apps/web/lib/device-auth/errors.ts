/* DeviceAuth v1 error registry (M1.08 canonical errors).
 * These map a frozen operation failure to an HTTP status, an exact closed
 * error code, and a fixed safe error_description. Descriptions carry no
 * identifiers and are safe for local diagnostics. */

export type DeviceAuthErrorCode =
  | "invalid_request"
  | "invalid_scope"
  | "invalid_grant"
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_client"
  | "invalid_token"
  | "proof_required"
  | "proof_invalid"
  | "insufficient_scope"
  | "already_consumed"
  | "idempotency_conflict"
  | "rate_limited"
  | "secure_storage_unavailable"
  | "temporarily_unavailable";

export const DEVICE_AUTH_ERROR_DESCRIPTIONS: Record<DeviceAuthErrorCode, string> = {
  invalid_request: "The request is invalid.",
  invalid_scope: "The requested scope is invalid.",
  invalid_grant: "The authorization grant is invalid.",
  authorization_pending: "Authorization is pending.",
  slow_down: "Polling must slow down.",
  access_denied: "Authorization was not granted.",
  expired_token: "The authorization grant has expired.",
  invalid_client: "Client authentication failed.",
  invalid_token: "The access token is invalid.",
  proof_required: "Device proof is required.",
  proof_invalid: "Device proof is invalid.",
  insufficient_scope: "The token does not permit this operation.",
  already_consumed: "The authorization grant is no longer available.",
  idempotency_conflict: "The request conflicts with a prior operation.",
  rate_limited: "Too many requests.",
  secure_storage_unavailable: "Secure credential storage is unavailable.",
  temporarily_unavailable: "The service is temporarily unavailable."
};

/** Exact M1.08 HTTP status per error code. */
export const DEVICE_AUTH_ERROR_STATUS: Record<DeviceAuthErrorCode, number> = {
  invalid_request: 400,
  invalid_scope: 400,
  invalid_grant: 400,
  authorization_pending: 400,
  slow_down: 400,
  access_denied: 400,
  expired_token: 400,
  invalid_client: 401,
  invalid_token: 401,
  proof_required: 401,
  proof_invalid: 401,
  insufficient_scope: 403,
  already_consumed: 409,
  idempotency_conflict: 409,
  rate_limited: 429,
  secure_storage_unavailable: 503,
  temporarily_unavailable: 503
};

export interface DeviceAuthErrorOptions {
  /** Present and positive only for rate_limited and slow_down; otherwise 0. */
  retryAfter?: number;
}

export class DeviceAuthError extends Error {
  readonly code: DeviceAuthErrorCode;
  readonly errorDescription: string;
  readonly httpStatus: number;
  readonly retryAfter: number;

  constructor(code: DeviceAuthErrorCode, options: DeviceAuthErrorOptions = {}) {
    super(DEVICE_AUTH_ERROR_DESCRIPTIONS[code]);
    this.name = "DeviceAuthError";
    this.code = code;
    this.errorDescription = DEVICE_AUTH_ERROR_DESCRIPTIONS[code];
    this.httpStatus = DEVICE_AUTH_ERROR_STATUS[code];
    this.retryAfter = code === "rate_limited" || code === "slow_down" ? options.retryAfter ?? 0 : 0;
  }

  /** Frozen M1.3 error body; never contains identifiers or input. */
  toJSON(): { error: DeviceAuthErrorCode; error_description: string; retry_after: number } {
    return { error: this.code, error_description: this.errorDescription, retry_after: this.retryAfter };
  }
}

/** Thrown only for internal server faults; maps to temporarily_unavailable. */
export class DeviceAuthUnavailableError extends Error {
  readonly status = 503;
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DeviceAuthUnavailableError";
  }
}