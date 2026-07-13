const CURSOR = /^[A-Za-z0-9_-]+$/;
const REPORT_PUBLIC_ID = /^rpt_[0-9a-f]{32}$/;
const UTC_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/;

export interface ReportCursor {
  kind: "skill-reports";
  v: 1;
  createdAt: string;
  reportId: string;
}

export class ReportCursorError extends Error {
  constructor() {
    super("The report cursor is malformed.");
    this.name = "ReportCursorError";
  }
}

export function encodeReportCursor(input: { createdAt: string; reportId: string }): string {
  const cursor = normalizeCursor({ kind: "skill-reports", v: 1, ...input });
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeReportCursor(value: string): ReportCursor {
  if (value.length > 512 || !CURSOR.test(value)) throw new ReportCursorError();
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("shape");
    const object = decoded as Partial<ReportCursor>;
    if (Object.keys(object).sort().join(",") !== "createdAt,kind,reportId,v") throw new Error("keys");
    const normalized = normalizeCursor(object);
    if (JSON.stringify(normalized) !== JSON.stringify(object)) throw new Error("canonical");
    return normalized;
  } catch (error) {
    if (error instanceof ReportCursorError) throw error;
    throw new ReportCursorError();
  }
}

function normalizeCursor(value: Partial<ReportCursor>): ReportCursor {
  if (value.kind !== "skill-reports" || value.v !== 1 || typeof value.createdAt !== "string"
    || typeof value.reportId !== "string" || !REPORT_PUBLIC_ID.test(value.reportId)) {
    throw new ReportCursorError();
  }
  let createdAt: string;
  try {
    createdAt = canonicalizeTimestamp(value.createdAt);
  } catch {
    throw new ReportCursorError();
  }
  return { kind: "skill-reports", v: 1, createdAt, reportId: value.reportId };
}

function canonicalizeTimestamp(value: string): string {
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) throw new ReportCursorError();
  const [, dateTime, rawFraction = ""] = match;
  const fraction = rawFraction.padEnd(6, "0");
  const canonical = `${dateTime}.${fraction}Z`;
  const parsed = new Date(canonical);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== `${dateTime}.${fraction.slice(0, 3)}Z`) {
    throw new ReportCursorError();
  }
  return canonical;
}
