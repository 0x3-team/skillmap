import "server-only";

export const OWNER_DEVICE_PLATFORMS = ["macos", "windows", "linux"] as const;
export const OWNER_DEVICE_STATES = [
  "active",
  "expiring",
  "disabled",
  "revoked",
  "compromised",
  "expired",
] as const;

export type OwnerDevicePlatform = (typeof OWNER_DEVICE_PLATFORMS)[number];
export type OwnerDeviceState = (typeof OWNER_DEVICE_STATES)[number];

export type OwnerDevice = {
  publicIdSuffix: string;
  displayName: string;
  platform: OwnerDevicePlatform;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string | null;
  state: OwnerDeviceState;
  scopes: string[];
  revision: number;
};

export type OwnerDevicesResult =
  | { status: "ok"; devices: OwnerDevice[] }
  | { status: "conflict"; device: OwnerDevice }
  | { status: "unavailable" };

export type OwnerDeviceMutationResult =
  | { status: "ok"; device: OwnerDevice }
  | { status: "conflict"; device: OwnerDevice }
  | { status: "unavailable" };

const PUBLIC_ID_SUFFIX = /^[0-9a-f]{8}$/;
const SAFE_SCOPE = /^[a-z][a-z0-9._:-]{0,47}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export const DEVICE_EXPIRING_WITHIN_SECONDS = 7 * 24 * 60 * 60;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    Number.isNaN(Date.parse(value))
  )
    return undefined;
  return value;
}

function parseDevice(value: unknown): OwnerDevice | null {
  const row = record(value);
  if (
    !row ||
    Object.keys(row).some(
      (key) =>
        ![
          "public_id_suffix",
          "display_name",
          "platform",
          "created_at",
          "last_seen_at",
          "expires_at",
          "state",
          "scopes",
          "revision",
        ].includes(key),
    )
  )
    return null;
  if (
    !row ||
    typeof row.public_id_suffix !== "string" ||
    !PUBLIC_ID_SUFFIX.test(row.public_id_suffix)
  )
    return null;
  if (
    typeof row.display_name !== "string" ||
    row.display_name.length === 0 ||
    utf8Bytes(row.display_name) > 64 ||
    CONTROL.test(row.display_name) ||
    row.display_name !== row.display_name.normalize("NFC")
  )
    return null;
  if (
    typeof row.platform !== "string" ||
    !OWNER_DEVICE_PLATFORMS.includes(row.platform as OwnerDevicePlatform)
  )
    return null;
  if (
    typeof row.state !== "string" ||
    !OWNER_DEVICE_STATES.includes(row.state as OwnerDeviceState)
  )
    return null;
  const createdAt = safeDate(row.created_at);
  const lastSeenAt = safeDate(row.last_seen_at);
  const expiresAt = safeDate(row.expires_at);
  if (!createdAt || lastSeenAt === undefined || expiresAt === undefined)
    return null;
  if (
    !Array.isArray(row.scopes) ||
    row.scopes.length > 16 ||
    row.scopes.some(
      (scope) => typeof scope !== "string" || !SAFE_SCOPE.test(scope),
    )
  )
    return null;
  if (
    typeof row.revision !== "number" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  )
    return null;
  return {
    publicIdSuffix: row.public_id_suffix,
    displayName: row.display_name,
    platform: row.platform as OwnerDevicePlatform,
    createdAt,
    lastSeenAt,
    expiresAt,
    state: row.state as OwnerDeviceState,
    scopes: [...row.scopes] as string[],
    revision: row.revision,
  };
}

export function parseOwnerDevicesResult(value: unknown): OwnerDevicesResult {
  const body = record(value);
  if (
    !body ||
    (body.status !== "ok" &&
      body.status !== "conflict" &&
      body.status !== "unavailable")
  )
    return { status: "unavailable" };
  if (body.status === "unavailable") return { status: "unavailable" };
  if (body.status === "conflict") {
    const device = parseDevice(body.device);
    return device ? { status: "conflict", device } : { status: "unavailable" };
  }
  if (!Array.isArray(body.devices)) return { status: "unavailable" };
  const devices = body.devices.map(parseDevice);
  return devices.every((device): device is OwnerDevice => device !== null)
    ? { status: "ok", devices }
    : { status: "unavailable" };
}

export function parseOwnerDeviceMutationResult(
  value: unknown,
): OwnerDeviceMutationResult {
  const body = record(value);
  if (
    !body ||
    (body.status !== "ok" &&
      body.status !== "conflict" &&
      body.status !== "unavailable")
  )
    return { status: "unavailable" };
  if (body.status === "unavailable") return { status: "unavailable" };
  const device = parseDevice(body.device);
  return device ? { status: body.status, device } : { status: "unavailable" };
}

export function ownerDeviceActionInput(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL.test(value)) return null;
  const normalized = value.trim().normalize("NFC");
  return normalized.length > 0 && utf8Bytes(normalized) <= 64
    ? normalized
    : null;
}

export function ownerDeviceSuffix(value: unknown): string | null {
  return typeof value === "string" && PUBLIC_ID_SUFFIX.test(value)
    ? value
    : null;
}

export function ownerDeviceRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}
