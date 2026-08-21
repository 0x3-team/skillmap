import "server-only";

import { DeviceAuthError, DeviceAuthUnavailableError } from "@/lib/device-auth/errors";
import { StrictDeviceAuthJsonError } from "@/lib/device-auth/raw-json.server";

export type ImportRouteErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "insufficient_scope"
  | "session_not_found"
  | "session_expired"
  | "session_conflict"
  | "owner_consent_required"
  | "already_accepted"
  | "rate_limited"
  | "temporarily_unavailable";

const DESCRIPTIONS: Record<ImportRouteErrorCode, string> = {
  invalid_request: "The import request is invalid.",
  unauthorized: "The import request is not authorized.",
  insufficient_scope: "The device token does not permit this import operation.",
  session_not_found: "The import session was not found.",
  session_expired: "The import session has expired.",
  session_conflict: "The import session conflicts with a concurrent operation.",
  owner_consent_required: "Owner consent is required before this import can be finalized.",
  already_accepted: "The file is already accepted in this session.",
  rate_limited: "Too many import requests.",
  temporarily_unavailable: "The import service is temporarily unavailable."
};

const STATUS: Record<ImportRouteErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  insufficient_scope: 403,
  session_not_found: 404,
  session_expired: 410,
  session_conflict: 409,
  owner_consent_required: 409,
  already_accepted: 409,
  rate_limited: 429,
  temporarily_unavailable: 503
};

export class ImportRouteError extends Error {
  readonly code: ImportRouteErrorCode;
  readonly status: number;
  readonly retryAfter: number;

  constructor(code: ImportRouteErrorCode, retryAfter = 0, cause?: unknown) {
    super(DESCRIPTIONS[code], cause === undefined ? undefined : { cause });
    this.name = "ImportRouteError";
    this.code = code;
    this.status = STATUS[code];
    this.retryAfter = code === "rate_limited" ? Math.max(0, Math.floor(retryAfter)) : 0;
  }

  toJSON(): { error: ImportRouteErrorCode; error_description: string; retry_after: number } {
    return { error: this.code, error_description: DESCRIPTIONS[this.code], retry_after: this.retryAfter };
  }
}

const RESPONSE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer"
} as const;

export function importJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

export function importErrorResponse(error: unknown): Response {
  const normalized = normalizeImportError(error);
  return importJsonResponse(normalized.toJSON(), normalized.status);
}

export function normalizeImportError(error: unknown): ImportRouteError {
  if (error instanceof ImportRouteError) return error;
  if (error instanceof StrictDeviceAuthJsonError) return new ImportRouteError("invalid_request");
  if (error instanceof DeviceAuthUnavailableError) return new ImportRouteError("temporarily_unavailable");
  if (error instanceof DeviceAuthError) {
    if (error.code === "insufficient_scope") return new ImportRouteError("insufficient_scope");
    if (error.code === "rate_limited") return new ImportRouteError("rate_limited", error.retryAfter);
    if (error.code === "invalid_request") return new ImportRouteError("invalid_request");
    return new ImportRouteError("unauthorized");
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("already accepted")) return new ImportRouteError("already_accepted");
    if (message.includes("import cutover consent required")) return new ImportRouteError("owner_consent_required");
    if (message.includes("expired") || message.includes("expiry")) return new ImportRouteError("session_expired");
    if (message.includes("conflict") || message.includes("revision")) return new ImportRouteError("session_conflict");
    if (message.includes("authority unavailable") || message.includes("permission denied")) return new ImportRouteError("unauthorized");
    if (message.includes("invalid import") || message.includes("does not match") || message.includes("outside")) {
      return new ImportRouteError("invalid_request");
    }
  }
  return new ImportRouteError("temporarily_unavailable");
}
