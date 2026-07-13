import type { ReportCategory, ReportField } from "@/lib/reports/input";
import type { ReportSubmitStatus } from "@/lib/reports/status";

export const REPORT_FLASH_COOKIE = "skillmap-report-flash";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPORT_PUBLIC_ID = /^rpt_[0-9a-f]{32}$/;
const REPORT_CATEGORIES: readonly ReportCategory[] = ["security", "malware", "misleading", "license", "privacy", "broken", "spam", "other"];
const DETAIL_PATH = /^\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const FLASH_STATUSES = new Set<Exclude<ReportSubmitStatus, "queued">>([
  "active-limit",
  "auth-unavailable",
  "cooldown",
  "daily-limit",
  "duplicate",
  "invalid",
  "service-unavailable",
  "target-unavailable"
]);
const FLASH_FIELDS = new Set<ReportField>([
  "skillId",
  "versionId",
  "category",
  "message",
  "idempotencyKey",
  "returnPath",
  "form"
]);

export interface ReportFlash {
  token: string;
  status: Exclude<ReportSubmitStatus, "queued">;
  field: ReportField | null;
  reportId: string | null;
  category: ReportCategory | "";
  message: string;
  requestId: string;
  returnPath: string;
}

export function createReportFlash(
  formData: FormData,
  result: { status: Exclude<ReportSubmitStatus, "queued">; field?: ReportField; reportId?: string },
  token: string
): ReportFlash | null {
  const returnPath = safeSingleValue(formData, "returnPath", 160);
  if (!TOKEN.test(token) || !returnPath || !isCanonicalDetailPath(returnPath)) return null;
  const rawCategory = safeSingleValue(formData, "category", 20);
  const rawMessage = safeSingleValue(formData, "message", 2_000);
  const rawRequestId = safeSingleValue(formData, "idempotencyKey", 36);
  return {
    token,
    status: result.status,
    field: result.field ?? null,
    reportId: result.reportId && REPORT_PUBLIC_ID.test(result.reportId) ? result.reportId : null,
    category: rawCategory && REPORT_CATEGORIES.includes(rawCategory as ReportCategory) ? rawCategory as ReportCategory : "",
    message: rawMessage ?? "",
    requestId: rawRequestId && REQUEST_ID.test(rawRequestId) ? rawRequestId : token,
    returnPath
  };
}

export function serializeReportFlash(value: ReportFlash): string {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > 3_500) throw new Error("Report flash exceeds its cookie boundary.");
  return serialized;
}

export function parseReportFlash(value: string | undefined, token: unknown, returnPath: string): ReportFlash | null {
  if (!value || typeof token !== "string" || !TOKEN.test(token) || !isCanonicalDetailPath(returnPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isExactRecord(parsed, ["category", "field", "message", "reportId", "requestId", "returnPath", "status", "token"])
    || parsed.token !== token || parsed.returnPath !== returnPath || !TOKEN.test(String(parsed.token))
    || typeof parsed.status !== "string" || !FLASH_STATUSES.has(parsed.status as Exclude<ReportSubmitStatus, "queued">)
    || (parsed.field !== null && (typeof parsed.field !== "string" || !FLASH_FIELDS.has(parsed.field as ReportField)))
    || (parsed.reportId !== null && (typeof parsed.reportId !== "string" || !REPORT_PUBLIC_ID.test(parsed.reportId)))
    || typeof parsed.category !== "string" || (parsed.category !== "" && !REPORT_CATEGORIES.includes(parsed.category as ReportCategory))
    || typeof parsed.message !== "string" || parsed.message.length > 2_000 || CONTROL_CHARACTERS.test(parsed.message)
    || typeof parsed.requestId !== "string" || !REQUEST_ID.test(parsed.requestId)) return null;
  return parsed as unknown as ReportFlash;
}

function safeSingleValue(formData: FormData, name: string, maximumLength: number): string | null {
  const values = formData.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const value = values[0];
  return value.length <= maximumLength && value === value.normalize("NFC") && !CONTROL_CHARACTERS.test(value) ? value : null;
}

function isCanonicalDetailPath(value: string): boolean {
  if (!DETAIL_PATH.test(value) || value.length > 160) return false;
  const parts = value.split("/");
  return (parts[2]?.length ?? 0) >= 2 && (parts[2]?.length ?? 0) <= 40
    && (parts[3]?.length ?? 0) >= 2 && (parts[3]?.length ?? 0) <= 100;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
