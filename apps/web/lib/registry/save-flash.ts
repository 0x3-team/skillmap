export const SAVE_FLASH_COOKIE = "skillmap-save-flash";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SKILL_ID = /^skl_[0-9a-f]{32}$/;
const DETAIL_PATH = /^\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = new Set<SaveFlashStatus>(["removed", "saved", "unavailable"]);

export type SaveFlashStatus = "removed" | "saved" | "unavailable";

export interface SaveFlash {
  returnPath: string;
  skillId: string;
  status: SaveFlashStatus;
  token: string;
}

export function createSaveFlash(
  status: SaveFlashStatus,
  skillId: string,
  returnPath: string,
  token: string
): SaveFlash | null {
  if (!STATUSES.has(status) || !SKILL_ID.test(skillId) || !TOKEN.test(token) || !isSafeReturnPath(returnPath)) return null;
  return { returnPath, skillId, status, token };
}

export function serializeSaveFlash(value: SaveFlash): string {
  return JSON.stringify(value);
}

export function parseSaveFlash(
  value: string | undefined,
  token: unknown,
  returnPath: string
): SaveFlash | null {
  if (!value || typeof token !== "string" || !TOKEN.test(token) || !isSafeReturnPath(returnPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isExactRecord(parsed, ["returnPath", "skillId", "status", "token"])
    || parsed.token !== token
    || parsed.returnPath !== returnPath
    || typeof parsed.skillId !== "string" || !SKILL_ID.test(parsed.skillId)
    || typeof parsed.status !== "string" || !STATUSES.has(parsed.status as SaveFlashStatus)) return null;
  return parsed as unknown as SaveFlash;
}

function isSafeReturnPath(value: string): boolean {
  return value === "/account" || (value.length <= 160 && DETAIL_PATH.test(value));
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
