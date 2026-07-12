const SAVED_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const HOSTED_SKILL_ID = /^skl_[0-9a-f]{32}$/;
const UTC_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/;

export interface SavedSkillsCursor {
  kind: "saved-skills";
  v: 1;
  savedAt: string;
  skillId: `skl_${string}`;
}

export class SavedSkillsCursorError extends Error {
  constructor() {
    super("The saved-skills cursor is malformed.");
    this.name = "SavedSkillsCursorError";
  }
}

/**
 * Canonicalizes PostgreSQL/PostgREST UTC timestamps without discarding the
 * microseconds used by keyset pagination. The single cursor representation is
 * an ISO UTC timestamp with exactly six fractional digits.
 */
export function canonicalizeUtcTimestamp(value: string): string {
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) throw new TypeError("The timestamp must be a UTC ISO value with microsecond precision.");

  const [, dateTime, rawFraction = ""] = match;
  const fraction = rawFraction.padEnd(6, "0");
  const parsed = new Date(`${dateTime}.${fraction}Z`);
  if (
    Number.isNaN(parsed.valueOf())
    || parsed.toISOString() !== `${dateTime}.${fraction.slice(0, 3)}Z`
  ) {
    throw new TypeError("The timestamp is not a valid UTC calendar value.");
  }
  return `${dateTime}.${fraction}Z`;
}

export function encodeSavedSkillsCursor(cursor: Pick<SavedSkillsCursor, "savedAt" | "skillId">): string {
  assertCanonicalTimestamp(cursor.savedAt);
  if (!HOSTED_SKILL_ID.test(cursor.skillId)) throw new SavedSkillsCursorError();
  return Buffer.from(JSON.stringify({
    kind: "saved-skills",
    v: 1,
    savedAt: cursor.savedAt,
    skillId: cursor.skillId
  }), "utf8").toString("base64url");
}

export function decodeSavedSkillsCursor(value: string): SavedSkillsCursor {
  if (value.length > 512 || !SAVED_CURSOR_PATTERN.test(value)) throw new SavedSkillsCursorError();
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new SavedSkillsCursorError();
    const cursor = decoded as Partial<SavedSkillsCursor>;
    if (Object.keys(cursor).sort().join(",") !== "kind,savedAt,skillId,v") throw new SavedSkillsCursorError();
    if (cursor.kind !== "saved-skills" || cursor.v !== 1 || typeof cursor.savedAt !== "string" || typeof cursor.skillId !== "string") {
      throw new SavedSkillsCursorError();
    }
    assertCanonicalTimestamp(cursor.savedAt);
    if (!HOSTED_SKILL_ID.test(cursor.skillId)) throw new SavedSkillsCursorError();
    return cursor as SavedSkillsCursor;
  } catch (error) {
    if (error instanceof SavedSkillsCursorError) throw error;
    throw new SavedSkillsCursorError();
  }
}

function assertCanonicalTimestamp(value: string): void {
  try {
    if (canonicalizeUtcTimestamp(value) !== value) throw new SavedSkillsCursorError();
  } catch {
    throw new SavedSkillsCursorError();
  }
}
