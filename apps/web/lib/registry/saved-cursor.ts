const SAVED_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const HOSTED_SKILL_ID = /^skl_[0-9a-f]{32}$/;

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
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw new SavedSkillsCursorError();
}
