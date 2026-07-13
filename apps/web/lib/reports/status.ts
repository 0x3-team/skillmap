export const REPORT_PUBLIC_ID = /^rpt_[0-9a-f]{32}$/;
const DETAIL_PATH = /^\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ReportSubmitStatus =
  | "active-limit"
  | "auth-unavailable"
  | "cooldown"
  | "daily-limit"
  | "duplicate"
  | "invalid"
  | "queued"
  | "service-unavailable"
  | "target-unavailable";

const REPORT_SUBMIT_STATUSES = new Set<ReportSubmitStatus>([
  "active-limit",
  "auth-unavailable",
  "cooldown",
  "daily-limit",
  "duplicate",
  "invalid",
  "queued",
  "service-unavailable",
  "target-unavailable"
]);

export function reportStatusPath(
  returnPath: string,
  status: ReportSubmitStatus,
  options: { field?: string; reportId?: string } = {}
): string {
  if (!isCanonicalSkillDetailPath(returnPath)) return "/skills";
  const query = new URLSearchParams({ reportStatus: status });
  if (options.field && /^[a-z][A-Za-z]{0,39}$/.test(options.field)) query.set("reportField", options.field);
  if (options.reportId && REPORT_PUBLIC_ID.test(options.reportId)) query.set("report", options.reportId);
  return `${returnPath}?${query}#report-listing`;
}

export function parseReportSubmitStatus(value: string | string[] | undefined): ReportSubmitStatus | null {
  return typeof value === "string" && REPORT_SUBMIT_STATUSES.has(value as ReportSubmitStatus)
    ? value as ReportSubmitStatus
    : null;
}

export function parseReportPublicId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && REPORT_PUBLIC_ID.test(value) ? value : null;
}

function isCanonicalSkillDetailPath(value: string): boolean {
  if (!DETAIL_PATH.test(value) || value.length > 160) return false;
  const parts = value.split("/");
  return (parts[2]?.length ?? 0) >= 2 && (parts[2]?.length ?? 0) <= 40
    && (parts[3]?.length ?? 0) >= 2 && (parts[3]?.length ?? 0) <= 100;
}
