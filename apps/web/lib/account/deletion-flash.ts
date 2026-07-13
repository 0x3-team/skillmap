export const ACCOUNT_DELETION_FLASH_COOKIE = "skillmap-account-deletion-flash";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface AccountDeletionFlash {
  status: "account-deleted";
  token: string;
}

export function createAccountDeletionFlash(token: string): AccountDeletionFlash | null {
  return TOKEN.test(token) ? { status: "account-deleted", token } : null;
}

export function serializeAccountDeletionFlash(value: AccountDeletionFlash): string {
  return JSON.stringify(value);
}

export function parseAccountDeletionFlash(
  value: string | undefined,
  token: unknown
): AccountDeletionFlash | null {
  if (!value || typeof token !== "string" || !TOKEN.test(token)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isExactRecord(parsed, ["status", "token"])
    || parsed.status !== "account-deleted"
    || parsed.token !== token
    || !TOKEN.test(String(parsed.token))) return null;
  return parsed as unknown as AccountDeletionFlash;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
