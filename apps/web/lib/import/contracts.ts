/**
 * M4.04 & M4.10: Import Review & Cutover Contracts.
 * Pure deterministic schemas, types, and normalization functions.
 * Browser-safe projections only: strictly prohibits raw skill contents,
 * script bodies, environment variables, and absolute filesystem paths.
 */

export type ImportViewStateKind =
  | "idle"
  | "preview"
  | "uploading"
  | "partial"
  | "blocked"
  | "ready_for_consent"
  | "consented"
  | "cutover_ready"
  | "stale"
  | "error";

export type ImportSkillStatus = "ready" | "warning" | "blocked" | "duplicate";

export interface ImportSkillFileEntry {
  /** Relative POSIX path within the skill root, e.g. "SKILL.md", "scripts/run.py" */
  relativePath: string;
  byteSize: number;
  digest?: string;
}

export interface ImportSkillPreviewItem {
  skillName: string;
  sourceType?: string;
  status: ImportSkillStatus;
  fileCount: number;
  byteTotal: number;
  manifestDigest: string;
  contentDigest?: string;
  files: ImportSkillFileEntry[];
  warnings: string[];
  blockedReasons: string[];
  isDuplicate?: boolean;
  excluded?: boolean;
}

export interface ImportInventorySummary {
  totalSkills: number;
  totalFiles: number;
  totalBytes: number;
  duplicateCount: number;
  warningCount: number;
  blockedCount: number;
  excludedCount: number;
  manifestDigest: string;
}

export interface ImportUploadProgress {
  acceptedFileCount: number;
  acceptedByteTotal: number;
  expectedFileCount: number;
  expectedByteTotal: number;
  percentComplete: number;
}

export interface CutoverReceipt {
  receiptId: string;
  sessionId: string;
  deviceId: string;
  manifestDigest: string;
  verificationDigest: string;
  eligibleSkillCount: number;
  issuedAt: string;
  expiresAt: string;
}

export interface ImportDeviceProjection {
  id?: string;
  name: string;
  platform?: string;
}

export interface ImportSessionProjection {
  sessionId: string;
  state: ImportViewStateKind;
  device: ImportDeviceProjection;
  summary: ImportInventorySummary;
  skills: ImportSkillPreviewItem[];
  uploadProgress?: ImportUploadProgress;
  cutoverReceipt?: CutoverReceipt;
  errorMessage?: string;
  errorCode?: string;
  createdAt: string;
  expiresAt: string;
  revision: number;
}

/** Error codes used across the import review seam. */
export const IMPORT_ERROR_CODES = {
  UNAVAILABLE: "UNAVAILABLE",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  PARITY_MISMATCH: "PARITY_MISMATCH",
  INVALID_MANIFEST: "INVALID_MANIFEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  BLOCKED_SECRET_PATTERN: "BLOCKED_SECRET_PATTERN",
  FORBIDDEN_KEY_FILE: "FORBIDDEN_KEY_FILE",
  RATE_LIMITED: "RATE_LIMITED",
  DESTINATION_COLLISION: "DESTINATION_COLLISION",
  REVISION_CONFLICT: "REVISION_CONFLICT"
} as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[keyof typeof IMPORT_ERROR_CODES] | string;

/** Checks if a string is a valid import session public ID (e.g. imp_...). */
export function isImportSessionId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^imp_[0-9a-f]{32}$/i.test(value.trim());
}

/** Checks if a string is a valid cutover receipt ID (e.g. rcpt_...). */
export function isCutoverReceiptId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^rcpt_[0-9a-f]{24,64}$/i.test(value.trim());
}

/** Checks if a string is a valid SHA-256 digest string. */
export function isSha256Digest(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^sha256:[0-9a-f]{64}$/i.test(value.trim());
}

/** Checks if a view state string is one of the 10 valid states. */
export function isImportViewStateKind(value: unknown): value is ImportViewStateKind {
  if (typeof value !== "string") return false;
  const validStates: ImportViewStateKind[] = [
    "idle",
    "preview",
    "uploading",
    "partial",
    "blocked",
    "ready_for_consent",
    "consented",
    "cutover_ready",
    "stale",
    "error"
  ];
  return validStates.includes(value as ImportViewStateKind);
}

/** Formats byte counts into human-readable strings with bounded precision. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let u = -1;
  let val = bytes;
  do {
    val /= 1024;
    u++;
  } while (val >= 1024 && u < units.length - 1);
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[u]}`;
}

/** Calculates summary metrics from a list of skills. */
export function calculateInventorySummary(
  skills: ImportSkillPreviewItem[],
  manifestDigest = ""
): ImportInventorySummary {
  let totalFiles = 0;
  let totalBytes = 0;
  let duplicateCount = 0;
  let warningCount = 0;
  let blockedCount = 0;
  let excludedCount = 0;

  for (const skill of skills) {
    if (skill.excluded) {
      excludedCount++;
      continue;
    }
    totalFiles += skill.fileCount;
    totalBytes += skill.byteTotal;
    if (skill.status === "duplicate" || skill.isDuplicate) duplicateCount++;
    if (skill.status === "warning" || skill.warnings.length > 0) warningCount++;
    if (skill.status === "blocked" || skill.blockedReasons.length > 0) blockedCount++;
  }

  return {
    totalSkills: skills.filter((s) => !s.excluded).length,
    totalFiles,
    totalBytes,
    duplicateCount,
    warningCount,
    blockedCount,
    excludedCount,
    manifestDigest
  };
}

/** Normalizes a raw inventory summary object safely. */
export function normalizeInventorySummary(raw: unknown): ImportInventorySummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const totalSkills = typeof obj.totalSkills === "number" ? Math.max(0, Math.floor(obj.totalSkills)) : 0;
  const totalFiles = typeof obj.totalFiles === "number" ? Math.max(0, Math.floor(obj.totalFiles)) : 0;
  const totalBytes = typeof obj.totalBytes === "number" ? Math.max(0, Math.floor(obj.totalBytes)) : 0;
  const duplicateCount = typeof obj.duplicateCount === "number" ? Math.max(0, Math.floor(obj.duplicateCount)) : 0;
  const warningCount = typeof obj.warningCount === "number" ? Math.max(0, Math.floor(obj.warningCount)) : 0;
  const blockedCount = typeof obj.blockedCount === "number" ? Math.max(0, Math.floor(obj.blockedCount)) : 0;
  const excludedCount = typeof obj.excludedCount === "number" ? Math.max(0, Math.floor(obj.excludedCount)) : 0;
  const manifestDigest = typeof obj.manifestDigest === "string" ? obj.manifestDigest.trim() : "";

  return {
    totalSkills,
    totalFiles,
    totalBytes,
    duplicateCount,
    warningCount,
    blockedCount,
    excludedCount,
    manifestDigest
  };
}
