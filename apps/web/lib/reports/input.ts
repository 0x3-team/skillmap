export const REPORT_CATEGORIES = [
  "security",
  "malware",
  "misleading",
  "license",
  "privacy",
  "broken",
  "spam",
  "other"
] as const;

export type ReportCategory = typeof REPORT_CATEGORIES[number];

export const REPORT_CATEGORY_COPY: Readonly<Record<ReportCategory, { label: string; description: string }>> = {
  security: { label: "Security risk", description: "Unsafe permissions, vulnerable behavior, or another security concern." },
  malware: { label: "Suspected malware", description: "Malicious payloads, credential theft, persistence, or destructive behavior." },
  misleading: { label: "Misleading listing", description: "Claims, provenance, compatibility, or behavior do not match the source." },
  license: { label: "License concern", description: "License, attribution, or redistribution evidence may be incorrect." },
  privacy: { label: "Privacy concern", description: "Unexpected collection, disclosure, or handling of personal information." },
  broken: { label: "Broken source", description: "The current source coordinate or documented workflow no longer works." },
  spam: { label: "Spam or abuse", description: "The listing appears duplicated, promotional, deceptive, or abusive." },
  other: { label: "Other", description: "A bounded listing concern that does not fit the categories above." }
};

const REPORT_CATEGORY_SET = new Set<string>(REPORT_CATEGORIES);
const SKILL_ID = /^skl_[0-9a-f]{32}$/;
const VERSION_ID = /^skv_[0-9a-f]{32}$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DETAIL_PATH = /^\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type ReportField = "skillId" | "versionId" | "category" | "message" | "idempotencyKey" | "returnPath" | "form";

export interface SkillReportIntent {
  skill_id: string;
  version_id: string;
  category: ReportCategory;
  message: string;
  idempotency_key: string;
  returnPath: string;
}

export class ReportValidationError extends Error {
  readonly field: ReportField;

  constructor(field: ReportField, message: string) {
    super(message);
    this.name = "ReportValidationError";
    this.field = field;
  }
}

export function parseSkillReportForm(formData: FormData): SkillReportIntent {
  const skillId = readSingleText(formData, "skillId", 36);
  const versionId = readSingleText(formData, "versionId", 36);
  const category = readSingleText(formData, "category", 20);
  const message = readSingleText(formData, "message", 2_000);
  const idempotencyKey = readSingleText(formData, "idempotencyKey", 36);
  const returnPath = readSingleText(formData, "returnPath", 160);

  if (!SKILL_ID.test(skillId)) throw new ReportValidationError("skillId", "The skill ID is not canonical.");
  if (!VERSION_ID.test(versionId)) throw new ReportValidationError("versionId", "The version ID is not canonical.");
  if (!REPORT_CATEGORY_SET.has(category)) throw new ReportValidationError("category", "Choose one supported report category.");
  if (message.length < 10) throw new ReportValidationError("message", "Describe the listing concern in at least 10 characters.");
  if (!CANONICAL_UUID.test(idempotencyKey)) throw new ReportValidationError("idempotencyKey", "The request ID is not canonical.");
  if (!isCanonicalSkillDetailPath(returnPath)) throw new ReportValidationError("returnPath", "The report return path is not canonical.");

  return {
    skill_id: skillId,
    version_id: versionId,
    category: category as ReportCategory,
    message,
    idempotency_key: idempotencyKey,
    returnPath
  };
}

export function isCanonicalSkillDetailPath(value: string): boolean {
  if (!DETAIL_PATH.test(value) || value.length > 160) return false;
  const parts = value.split("/");
  const publisher = parts[2] ?? "";
  const slug = parts[3] ?? "";
  return publisher.length >= 2 && publisher.length <= 40 && slug.length >= 2 && slug.length <= 100;
}

function readSingleText(formData: FormData, field: Exclude<ReportField, "form">, maximumLength: number): string {
  const values = formData.getAll(field);
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new ReportValidationError(field, `Submit exactly one ${field} value.`);
  }
  const value = values[0];
  if (value.length === 0 || value.length > maximumLength || CONTROL_CHARACTERS.test(value)) {
    throw new ReportValidationError(field, `${field} exceeds its safe input boundary.`);
  }
  if (value !== value.trim() || value !== value.normalize("NFC")) {
    throw new ReportValidationError(field, `${field} must use its canonical normalized form.`);
  }
  return value;
}
