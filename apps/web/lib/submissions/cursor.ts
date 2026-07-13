const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUBMISSION_PUBLIC_ID = /^sub_[0-9a-f]{32}$/;
const UTC_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/;

export interface SubmissionCursor {
  kind: "skill-submissions";
  v: 1;
  createdAt: string;
  submissionId: string;
}

export class SubmissionCursorError extends Error {
  constructor() {
    super("The submission cursor is malformed.");
    this.name = "SubmissionCursorError";
  }
}

export function encodeSubmissionCursor(value: Pick<SubmissionCursor, "createdAt" | "submissionId">): string {
  const createdAt = canonicalizeTimestamp(value.createdAt);
  if (!SUBMISSION_PUBLIC_ID.test(value.submissionId)) throw new SubmissionCursorError();
  return Buffer.from(JSON.stringify({
    kind: "skill-submissions",
    v: 1,
    createdAt,
    submissionId: value.submissionId
  }), "utf8").toString("base64url");
}

export function decodeSubmissionCursor(value: string): SubmissionCursor {
  if (value.length > 512 || !CURSOR_PATTERN.test(value)) throw new SubmissionCursorError();
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new SubmissionCursorError();
    const cursor = decoded as Partial<SubmissionCursor>;
    if (Object.keys(cursor).sort().join(",") !== "createdAt,kind,submissionId,v") throw new SubmissionCursorError();
    if (cursor.kind !== "skill-submissions" || cursor.v !== 1 || typeof cursor.createdAt !== "string"
      || typeof cursor.submissionId !== "string" || !SUBMISSION_PUBLIC_ID.test(cursor.submissionId)) {
      throw new SubmissionCursorError();
    }
    return {
      kind: cursor.kind,
      v: cursor.v,
      createdAt: assertCanonicalTimestamp(cursor.createdAt),
      submissionId: cursor.submissionId
    };
  } catch (error) {
    if (error instanceof SubmissionCursorError) throw error;
    throw new SubmissionCursorError();
  }
}

function canonicalizeTimestamp(value: string): string {
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) throw new SubmissionCursorError();
  const [, dateTime, rawFraction = ""] = match;
  const fraction = rawFraction.padEnd(6, "0");
  const canonical = `${dateTime}.${fraction}Z`;
  const parsed = new Date(canonical);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== `${dateTime}.${fraction.slice(0, 3)}Z`) {
    throw new SubmissionCursorError();
  }
  return canonical;
}

function assertCanonicalTimestamp(value: string): string {
  const canonical = canonicalizeTimestamp(value);
  if (canonical !== value) throw new SubmissionCursorError();
  return canonical;
}
