import "server-only";

import type {
  ConfirmedDeviceDisplay,
  DeviceAuthScope,
  DeviceConfirmationResult
} from "./confirmation-contracts.server.ts";
import {
  isConfirmationHandle,
  isConfirmationRevision
} from "./confirmation-contracts.server.ts";

const CLOSED_SCOPES = new Set<DeviceAuthScope>([
  "device.route",
  "device.feedback",
  "device.import",
  "device.bundle",
  "device.status"
]);

export interface DeviceAuthConfirmationRpcClient {
  rpc(name: string, params: Record<string, unknown>): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

export interface DeviceAuthConfirmationRepository {
  review(userCode: string): Promise<DeviceConfirmationResult>;
  decide(handle: string, revision: number, decision: "approve" | "deny"): Promise<DeviceConfirmationResult>;
}

interface ReviewRpcRow {
  status: "reviewed";
  confirmation_handle: string;
  confirmation_revision: number;
  device: ConfirmedDeviceDisplay;
}

interface DecisionRpcRow {
  status: "approved" | "denied" | "expired" | "unavailable";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isSafeDisplayName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && new TextEncoder().encode(value.normalize("NFC")).length <= 64
    && !/[\u0000-\u001f\u007f]/.test(value)
    && value === value.trim();
}

function isSafeVersion(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 32
    && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function isReviewRow(value: unknown): value is ReviewRpcRow {
  if (!isObject(value) || !hasExactKeys(value, ["status", "confirmation_handle", "confirmation_revision", "device"])
    || value.status !== "reviewed"
    || !isConfirmationHandle(value.confirmation_handle)
    || !isConfirmationRevision(value.confirmation_revision)
    || !isObject(value.device)) return false;
  const device = value.device;
  if (!hasExactKeys(device, ["name", "platform", "connector_version", "scopes"])) return false;
  if (!isSafeDisplayName(device.name)
    || !(device.platform === "macos" || device.platform === "windows" || device.platform === "linux")
    || !isSafeVersion(device.connector_version)
    || !Array.isArray(device.scopes)
    || device.scopes.length < 1
    || device.scopes.length > 5) return false;
  const scopes = device.scopes as unknown[];
  return new Set(scopes).size === scopes.length
    && scopes.every((scope) => typeof scope === "string" && CLOSED_SCOPES.has(scope as DeviceAuthScope));
}

function safeDisplayName(value: string): string {
  const normalized = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.length > 0 && new TextEncoder().encode(normalized).length <= 64 ? normalized : "Connector";
}

function safeVersion(value: string): string {
  return /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : "unknown";
}

function isDecisionRow(value: unknown): value is DecisionRpcRow {
  return isObject(value) && hasExactKeys(value, ["status"])
    && (value.status === "approved" || value.status === "denied" || value.status === "expired" || value.status === "unavailable");
}

/**
 * The session-bearing Supabase client is passed in by the server action. No
 * generic RPC dispatch is exposed to feature code; names and parameters stay
 * closed at this boundary.
 */
export class SupabaseDeviceAuthConfirmationRepository implements DeviceAuthConfirmationRepository {
  private readonly client: DeviceAuthConfirmationRpcClient;

  constructor(client: DeviceAuthConfirmationRpcClient) {
    this.client = client;
  }

  async review(userCode: string): Promise<DeviceConfirmationResult> {
    const result = await this.client.rpc("device_auth_review_my_pairing_v1", { p_user_code: userCode });
    if (result.error || !isReviewRow(result.data)) return { status: "unavailable" };
    return {
      status: "reviewed",
      handle: result.data.confirmation_handle,
      revision: result.data.confirmation_revision,
      device: {
        name: safeDisplayName(result.data.device.name),
        platform: result.data.device.platform,
        connector_version: safeVersion(result.data.device.connector_version),
        scopes: result.data.device.scopes as ConfirmedDeviceDisplay["scopes"]
      }
    };
  }

  async decide(handle: string, revision: number, decision: "approve" | "deny"): Promise<DeviceConfirmationResult> {
    const result = await this.client.rpc("device_auth_confirm_my_pairing_v1", {
      p_confirmation_handle: handle,
      p_confirmation_revision: revision,
      p_decision: decision
    });
    if (result.error || !isDecisionRow(result.data)) return { status: "unavailable" };
    return { status: result.data.status };
  }
}
