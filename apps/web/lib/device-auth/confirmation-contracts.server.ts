/**
 * Browser confirmation is deliberately a separate contract from connector
 * pairing. The only secret that crosses the review boundary is an opaque,
 * short-lived handle; the user code is never retained in a review result.
 *
 * This module contains only shared constants and pure validation, so the
 * client form may import its types without importing a server authority.
 */

export const CONFIRMATION_HANDLE_GRAMMAR = /^[A-Za-z0-9_-]{22}$/;
export const CONFIRMATION_REVISION_GRAMMAR = /^[1-9][0-9]{0,18}$/;

const USER_CODE_GRAMMAR = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

export type DeviceAuthScope =
  | "device.route"
  | "device.feedback"
  | "device.import"
  | "device.bundle"
  | "device.status";

export type DevicePlatform = "macos" | "windows" | "linux";

export interface ConfirmedDeviceDisplay {
  name: string;
  platform: DevicePlatform;
  connector_version: string;
  scopes: DeviceAuthScope[];
}

export interface DeviceConfirmationReview {
  status: "reviewed";
  handle: string;
  revision: number;
  device: ConfirmedDeviceDisplay;
}

export interface DeviceConfirmationTerminal {
  status: "idle" | "approved" | "denied" | "expired" | "unavailable";
}

export type DeviceConfirmationResult = DeviceConfirmationReview | DeviceConfirmationTerminal;

/**
 * Accept exactly the code emitted by the pairing RPC. Hyphen placement and
 * Crockford's unambiguous alphabet are intentional; we do not silently strip
 * arbitrary punctuation or map look-alike characters.
 */
export function normalizeConfirmationUserCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toUpperCase();
  return USER_CODE_GRAMMAR.test(candidate) ? candidate : null;
}

export function isConfirmationHandle(value: unknown): value is string {
  return typeof value === "string" && CONFIRMATION_HANDLE_GRAMMAR.test(value);
}

export function isConfirmationRevision(value: unknown): value is number {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return typeof value === "string"
    && CONFIRMATION_REVISION_GRAMMAR.test(value)
    && Number.isSafeInteger(Number(value));
}

export function normalizeConfirmationRevision(value: unknown): number | null {
  return isConfirmationRevision(value) ? Number(value) : null;
}

export function isConfirmationDecision(value: unknown): value is "approve" | "deny" {
  return value === "approve" || value === "deny";
}

export const SCOPE_LABELS: Record<DeviceAuthScope, string> = {
  "device.route": "Route decisions",
  "device.feedback": "Feedback and corrections",
  "device.import": "Bounded imports",
  "device.bundle": "Runtime bundle access",
  "device.status": "Device status"
};

export function scopeLabel(scope: DeviceAuthScope): string {
  return SCOPE_LABELS[scope] ?? "Approved device access";
}

/** Never expose the server's error text or a database state to the browser. */
export function genericConfirmationError(): DeviceConfirmationTerminal {
  return { status: "unavailable" };
}
