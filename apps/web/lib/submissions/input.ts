export const APPROVED_ALPHA_SPDX_IDENTIFIERS = [
  "0BSD",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0",
  "Unlicense"
] as const;

const APPROVED_ALPHA_SPDX = new Set<string>(APPROVED_ALPHA_SPDX_IDENTIFIERS);
const EXACT_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CANONICAL_GITHUB_REPOSITORY = /^https:\/\/github[.]com\/[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9][a-z0-9_.-]{0,99}$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type SubmissionField =
  | "repositoryUrl"
  | "sourceCommit"
  | "sourcePath"
  | "versionLabel"
  | "licenseClaim"
  | "idempotencyKey"
  | "authorizationAcknowledgement"
  | "untrustedContentAcknowledgement"
  | "form";

export interface SkillSubmissionInsert {
  repository_url: string;
  source_commit: string;
  source_path: string;
  version_label: string;
  license_claim: string | null;
  idempotency_key: string;
}

export class SubmissionValidationError extends Error {
  readonly field: SubmissionField;

  constructor(field: SubmissionField, message: string) {
    super(message);
    this.name = "SubmissionValidationError";
    this.field = field;
  }
}

export function parseSkillSubmissionForm(formData: FormData): SkillSubmissionInsert {
  const repositoryUrl = readSingleText(formData, "repositoryUrl", 226);
  const sourceCommit = readSingleText(formData, "sourceCommit", 64);
  const sourcePath = readSingleText(formData, "sourcePath", 500);
  const versionLabel = readSingleText(formData, "versionLabel", 100);
  const licenseClaim = readSingleText(formData, "licenseClaim", 200, true);
  const idempotencyKey = readSingleText(formData, "idempotencyKey", 36);

  requireAcknowledgement(formData, "authorizationAcknowledgement");
  requireAcknowledgement(formData, "untrustedContentAcknowledgement");

  const repositoryOwner = repositoryUrl.split("/")[3] ?? "";
  if (!CANONICAL_GITHUB_REPOSITORY.test(repositoryUrl)
    || repositoryUrl !== repositoryUrl.toLowerCase()
    || repositoryOwner.includes("--")
    || repositoryUrl.endsWith(".git")) {
    throw new SubmissionValidationError(
      "repositoryUrl",
      "Use one canonical lowercase https://github.com/owner/repository URL without a trailing slash, query, or fragment."
    );
  }
  if (!EXACT_COMMIT.test(sourceCommit)) {
    throw new SubmissionValidationError("sourceCommit", "Use the full lowercase 40- or 64-character commit digest, not a branch or tag.");
  }
  if (!isCanonicalSkillPath(sourcePath)) {
    throw new SubmissionValidationError("sourcePath", "Use a normalized relative path ending in SKILL.md without dot segments or repeated separators.");
  }
  if (!isCanonicalText(versionLabel, 1, 100)) {
    throw new SubmissionValidationError("versionLabel", "Use a version label from 1 through 100 printable characters.");
  }
  if (licenseClaim && !APPROVED_ALPHA_SPDX.has(licenseClaim)) {
    throw new SubmissionValidationError("licenseClaim", "Choose one approved public-alpha SPDX identifier or leave the claim empty.");
  }
  if (!CANONICAL_UUID.test(idempotencyKey)) {
    throw new SubmissionValidationError("idempotencyKey", "The request ID must be one canonical lowercase UUID.");
  }

  return {
    repository_url: repositoryUrl,
    source_commit: sourceCommit,
    source_path: sourcePath,
    version_label: versionLabel,
    license_claim: licenseClaim || null,
    idempotency_key: idempotencyKey
  };
}

function readSingleText(
  formData: FormData,
  field: Exclude<SubmissionField, "form">,
  maximumLength: number,
  optional = false
): string {
  const values = formData.getAll(field);
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new SubmissionValidationError(field, `Submit exactly one ${field} value.`);
  }
  const value = values[0];
  if (value.length > maximumLength || CONTROL_CHARACTERS.test(value)) {
    throw new SubmissionValidationError(field, `${field} exceeds its safe input boundary.`);
  }
  if (value !== value.trim() || value !== value.normalize("NFC") || (!optional && value.length === 0)) {
    throw new SubmissionValidationError(field, `${field} must use its canonical normalized form.`);
  }
  return value;
}

function requireAcknowledgement(
  formData: FormData,
  field: "authorizationAcknowledgement" | "untrustedContentAcknowledgement"
) {
  const values = formData.getAll(field);
  if (values.length !== 1 || values[0] !== "acknowledged") {
    throw new SubmissionValidationError(field, "Both submission acknowledgements are required.");
  }
}

function isCanonicalSkillPath(value: string): boolean {
  if (value.length < 8 || value.length > 500 || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("\\") || CONTROL_CHARACTERS.test(value)) return false;
  const components = value.split("/");
  return components.every((component) => component.length > 0 && component !== "." && component !== "..")
    && components.at(-1) === "SKILL.md";
}

function isCanonicalText(value: string, minimumLength: number, maximumLength: number): boolean {
  return value.length >= minimumLength
    && value.length <= maximumLength
    && value === value.trim()
    && value === value.normalize("NFC")
    && !CONTROL_CHARACTERS.test(value);
}
