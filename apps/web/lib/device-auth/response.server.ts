/* DeviceAuth v1 response helpers (server-only).
 *
 * Builds closed JSON responses with the exact M1.08 cache/privacy headers on
 * secret-bearing bodies: Cache-Control: no-store and Referrer-Policy:
 * no-referrer. Error bodies use the frozen {error, error_description,
 * retry_after} shape with Content-Type application/json; charset=utf-8.
 */

import "server-only";
import { DeviceAuthError } from "./errors.ts";
import { StrictDeviceAuthJsonError } from "./raw-json.server.ts";

const SECRET_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer"
} as const;

const PLAIN_HEADERS = {
  "content-type": "application/json; charset=utf-8"
} as const;

/** Build a DeviceAuth JSON response. secretBearing controls cache privacy. */
export function deviceAuthJsonResponse(body: unknown, status: number, secretBearing: boolean): Response {
  const headers = secretBearing ? SECRET_HEADERS : PLAIN_HEADERS;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Build the frozen no-store error response from any thrown value. */
export function deviceAuthErrorResponse(error: unknown): Response {
  const err = error instanceof DeviceAuthError
    ? error
    : error instanceof StrictDeviceAuthJsonError
      ? new DeviceAuthError("invalid_request")
    : new DeviceAuthError("temporarily_unavailable");
  return new Response(JSON.stringify(err.toJSON()), {
    status: err.httpStatus,
    headers: SECRET_HEADERS
  });
}

/** Build the 200 initiation success response (secret-bearing). */
export function deviceAuthSuccessResponse(body: unknown): Response {
  return deviceAuthJsonResponse(body, 200, true);
}
