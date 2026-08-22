/**
 * M4.04 & M4.10: Privacy and Redaction Enforcement for Import Projections.
 * Strictly guarantees that browser client components never receive absolute paths,
 * raw script contents, environment variables, or private credential fragments.
 */

import "server-only";

import {
  isImportSessionId,
  isImportViewStateKind,
  type CutoverReceipt,
  type ImportInventorySummary,
  type ImportSessionProjection,
  type ImportSkillFileEntry,
  type ImportSkillPreviewItem,
  type ImportSkillStatus,
  type ImportUploadProgress
} from "./contracts.ts";

export const REDACTED_PATH_MARKER = "[REDACTED_PATH]";
export const REDACTED_SECRET_MARKER = "[REDACTED]";

/** Field names that carry secret credentials or raw code contents and must never reach the browser. */
const FORBIDDEN_SECRET_FIELD =
  /^(token|device_code|deviceCode|user_code|userCode|exchange_code|exchangeCode|idempotency_key|idempotencyKey|refresh_token|refreshToken|access_token|accessToken|device_public_key|devicePublicKey|device_proof|deviceProof|proof|nonce|secret|password|private_key|privateKey|api_key|apiKey|key|auth_header|authHeader|authorization)$/i;

const FORBIDDEN_CONTENT_FIELD =
  /^(content|body|rawText|raw_text|scriptBody|script_body|rawContent|raw_content|buffer|fileContent|file_content|sourceCode|source_code)$/i;

/** Tests if a string is an absolute or sensitive filesystem path. */
export function isPrivatePath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const str = value.trim();
  if (str.length === 0) return false;
  if (str.startsWith("file://")) return true;
  if (str.startsWith("/")) return true;
  if (str.startsWith("~")) return true;
  if (/^[A-Za-z]:[\\/]/.test(str)) return true;
  if (str.startsWith("\\\\")) return true;
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(str)) return true; // Path traversal
  return false;
}

/** Tests if a freeform text contains an absolute or sensitive path pattern anywhere. */
export function containsPathPattern(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return isPrivatePath(value) || /(?:\/Users\/|\/home\/|\/etc\/|\/var\/|\/tmp\/|[A-Za-z]:[\\/]|file:\/\/|~[\\/])/i.test(value);
}

/** Checks if a path is a safe relative root path (e.g. "SKILL.md", "scripts/run.py"). */
export function isSafeRelativePath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const str = value;
  if (str.length === 0 || str !== str.normalize("NFC")) return false;
  if (new TextEncoder().encode(str).byteLength > 512) return false;
  if (isPrivatePath(str)) return false;
  if (/^[A-Za-z]:/u.test(str) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(str)) return false;
  if (/%(?:2e|2f|5c)/iu.test(str) || /[\\\u0000-\u001f\u007f-\u009f]/u.test(str)) return false;
  if (str === "manifest_digest") return false;
  const segments = str.split("/");
  if (segments.length > 32) return false;
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.startsWith("."));
}

/** Normalizes and sanitizes a path, replacing absolute/unsafe paths with a fixed marker. */
export function sanitizePath(value: unknown): string {
  if (typeof value !== "string") return REDACTED_PATH_MARKER;
  if (isSafeRelativePath(value)) {
    return value;
  }
  return REDACTED_PATH_MARKER;
}

/** Checks if a string contains private key, token, or high-entropy credential patterns. */
export function containsSecretPattern(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const str = value.trim();
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(str)) return true;
  if (/(?:sk_live_|ghp_|gho_|xox[baprs]-|AKIA[0-9A-Z]{16})/i.test(str)) return true;
  if (/(?:bearer\s+[A-Za-z0-9._~+/-]+=*)/i.test(str)) return true;
  return false;
}

/** Recursively scrubs secrets and raw content from an arbitrary object. */
export function redactImportPayload<T>(value: T, depth = 0): T {
  if (depth > 10) return REDACTED_SECRET_MARKER as unknown as T;
  if (Array.isArray(value)) {
    return value.map((item) => redactImportPayload(item, depth + 1)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_SECRET_FIELD.test(key) || FORBIDDEN_CONTENT_FIELD.test(key)) {
        continue; // Strip entirely
      }
      if (typeof nested === "string") {
        if (isPrivatePath(nested)) {
          out[key] = REDACTED_PATH_MARKER;
        } else if (containsSecretPattern(nested)) {
          out[key] = REDACTED_SECRET_MARKER;
        } else {
          out[key] = nested;
        }
      } else {
        out[key] = redactImportPayload(nested, depth + 1);
      }
    }
    return out as T;
  }
  if (typeof value === "string") {
    if (isPrivatePath(value)) return REDACTED_PATH_MARKER as unknown as T;
    if (containsSecretPattern(value)) return REDACTED_SECRET_MARKER as unknown as T;
  }
  return value;
}

/** Sanitizes a single skill file entry. */
export function sanitizeSkillFileEntry(raw: unknown): ImportSkillFileEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;

  const pathVal = entry.relativePath ?? entry.path ?? entry.filename;
  const relativePath = sanitizePath(pathVal);

  const byteSize = typeof entry.byteSize === "number"
    ? Math.max(0, Math.floor(entry.byteSize))
    : typeof entry.size === "number"
      ? Math.max(0, Math.floor(entry.size))
      : 0;

  const digestVal = typeof entry.digest === "string" && /^sha256:[0-9a-f]{64}$/i.test(entry.digest.trim())
    ? entry.digest.trim()
    : undefined;

  return {
    relativePath,
    byteSize,
    digest: digestVal
  };
}

/** Sanitizes a single skill preview item, stripping any raw contents and scrubbing paths. */
export function sanitizeSkillPreviewItem(raw: unknown): ImportSkillPreviewItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const skillName = typeof obj.skillName === "string"
    ? obj.skillName.trim()
    : typeof obj.name === "string"
      ? obj.name.trim()
      : "unnamed-skill";

  if (!skillName || isPrivatePath(skillName)) {
    return null;
  }

  const rawStatus = String(obj.status ?? "ready").toLowerCase();
  const status: ImportSkillStatus =
    rawStatus === "blocked" || rawStatus === "warning" || rawStatus === "duplicate"
      ? (rawStatus as ImportSkillStatus)
      : "ready";

  const fileCount = typeof obj.fileCount === "number" ? Math.max(0, Math.floor(obj.fileCount)) : 0;
  const byteTotal = typeof obj.byteTotal === "number" ? Math.max(0, Math.floor(obj.byteTotal)) : 0;
  const manifestDigest = typeof obj.manifestDigest === "string" ? obj.manifestDigest.trim() : "";
  const contentDigest = typeof obj.contentDigest === "string" ? obj.contentDigest.trim() : undefined;

  const rawFiles = Array.isArray(obj.files) ? obj.files : [];
  const files: ImportSkillFileEntry[] = [];
  for (const f of rawFiles) {
    const sanitizedFile = sanitizeSkillFileEntry(f);
    if (sanitizedFile) files.push(sanitizedFile);
  }

  const rawWarnings = Array.isArray(obj.warnings) ? obj.warnings : [];
  const warnings: string[] = rawWarnings
    .filter((w): w is string => typeof w === "string")
    .map((w) => (containsSecretPattern(w) ? REDACTED_SECRET_MARKER : w.trim()))
    .filter(Boolean);

  const rawBlocked = Array.isArray(obj.blockedReasons) ? obj.blockedReasons : [];
  const blockedReasons: string[] = rawBlocked
    .filter((b): b is string => typeof b === "string")
    .map((b) => (containsSecretPattern(b) ? REDACTED_SECRET_MARKER : b.trim()))
    .filter(Boolean);

  const isDuplicate = Boolean(obj.isDuplicate);
  const excluded = Boolean(obj.excluded);
  const sourceType = typeof obj.sourceType === "string" ? obj.sourceType.trim() : undefined;

  return {
    skillName,
    sourceType,
    status,
    fileCount: files.length > 0 ? files.length : fileCount,
    byteTotal: files.length > 0 ? files.reduce((sum, f) => sum + f.byteSize, 0) : byteTotal,
    manifestDigest,
    contentDigest,
    files,
    warnings,
    blockedReasons,
    isDuplicate,
    excluded
  };
}

/** Sanitizes a CutoverReceipt object. */
export function sanitizeCutoverReceipt(raw: unknown): CutoverReceipt | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const receiptId = typeof obj.receiptId === "string" ? obj.receiptId.trim() : "";
  const sessionId = typeof obj.sessionId === "string" ? obj.sessionId.trim() : "";
  const deviceId = typeof obj.deviceId === "string" ? obj.deviceId.trim() : "";
  const manifestDigest = typeof obj.manifestDigest === "string" ? obj.manifestDigest.trim() : "";
  const verificationDigest = typeof obj.verificationDigest === "string" ? obj.verificationDigest.trim() : "";
  const eligibleSkillCount =
    typeof obj.eligibleSkillCount === "number"
      ? Math.max(0, obj.eligibleSkillCount)
      : typeof obj.quarantinedSkillCount === "number"
        ? Math.max(0, obj.quarantinedSkillCount)
        : 0;
  const issuedAt = typeof obj.issuedAt === "string" ? obj.issuedAt.trim() : new Date().toISOString();
  const expiresAt = typeof obj.expiresAt === "string" ? obj.expiresAt.trim() : new Date().toISOString();

  if (!receiptId || !sessionId) return null;

  return {
    receiptId,
    sessionId,
    deviceId,
    manifestDigest,
    verificationDigest,
    eligibleSkillCount,
    issuedAt,
    expiresAt
  };
}

/** Sanitizes an entire ImportSessionProjection before it is sent to or rendered by client UI. */
export function sanitizeImportSessionProjection(raw: unknown): ImportSessionProjection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const sessionId = typeof obj.sessionId === "string" ? obj.sessionId.trim() : "";
  if (!isImportSessionId(sessionId)) {
    return null;
  }

  const rawState = typeof obj.state === "string" ? obj.state.trim() : "preview";
  const state = isImportViewStateKind(rawState) ? rawState : "error";

  const rawDevice = typeof obj.device === "object" && obj.device !== null ? (obj.device as Record<string, unknown>) : {};
  const deviceName = typeof rawDevice.name === "string" && !isPrivatePath(rawDevice.name)
    ? rawDevice.name.trim()
    : "Unknown Device";
  const device = {
    id: typeof rawDevice.id === "string" ? rawDevice.id.trim() : undefined,
    name: deviceName,
    platform: typeof rawDevice.platform === "string" ? rawDevice.platform.trim() : undefined
  };

  const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
  const skills: ImportSkillPreviewItem[] = [];
  for (const s of rawSkills) {
    const sanitized = sanitizeSkillPreviewItem(s);
    if (sanitized) skills.push(sanitized);
  }

  const rawSummary = typeof obj.summary === "object" && obj.summary !== null ? (obj.summary as Record<string, unknown>) : {};
  const summary: ImportInventorySummary = {
    totalSkills: typeof rawSummary.totalSkills === "number" ? Math.max(0, rawSummary.totalSkills) : skills.length,
    totalFiles: typeof rawSummary.totalFiles === "number" ? Math.max(0, rawSummary.totalFiles) : skills.reduce((sum, s) => sum + s.fileCount, 0),
    totalBytes: typeof rawSummary.totalBytes === "number" ? Math.max(0, rawSummary.totalBytes) : skills.reduce((sum, s) => sum + s.byteTotal, 0),
    duplicateCount: typeof rawSummary.duplicateCount === "number" ? Math.max(0, rawSummary.duplicateCount) : skills.filter((s) => s.isDuplicate).length,
    warningCount: typeof rawSummary.warningCount === "number" ? Math.max(0, rawSummary.warningCount) : skills.filter((s) => s.warnings.length > 0).length,
    blockedCount: typeof rawSummary.blockedCount === "number" ? Math.max(0, rawSummary.blockedCount) : skills.filter((s) => s.blockedReasons.length > 0).length,
    excludedCount: typeof rawSummary.excludedCount === "number" ? Math.max(0, rawSummary.excludedCount) : skills.filter((s) => s.excluded).length,
    manifestDigest: typeof rawSummary.manifestDigest === "string" ? rawSummary.manifestDigest.trim() : ""
  };

  let uploadProgress: ImportUploadProgress | undefined;
  if (typeof obj.uploadProgress === "object" && obj.uploadProgress !== null) {
    const up = obj.uploadProgress as Record<string, unknown>;
    const acceptedFileCount = typeof up.acceptedFileCount === "number" ? Math.max(0, up.acceptedFileCount) : 0;
    const acceptedByteTotal = typeof up.acceptedByteTotal === "number" ? Math.max(0, up.acceptedByteTotal) : 0;
    const expectedFileCount = typeof up.expectedFileCount === "number" ? Math.max(0, up.expectedFileCount) : 0;
    const expectedByteTotal = typeof up.expectedByteTotal === "number" ? Math.max(0, up.expectedByteTotal) : 0;
    const percentComplete = expectedByteTotal > 0 ? Math.min(100, Math.round((acceptedByteTotal / expectedByteTotal) * 100)) : 0;

    uploadProgress = {
      acceptedFileCount,
      acceptedByteTotal,
      expectedFileCount,
      expectedByteTotal,
      percentComplete
    };
  }

  const cutoverReceipt = obj.cutoverReceipt ? sanitizeCutoverReceipt(obj.cutoverReceipt) ?? undefined : undefined;

  const errorMessage = typeof obj.errorMessage === "string"
    ? containsSecretPattern(obj.errorMessage) || containsPathPattern(obj.errorMessage)
      ? "An unexpected error occurred during import."
      : obj.errorMessage.trim()
    : undefined;

  const errorCode = typeof obj.errorCode === "string" ? obj.errorCode.trim() : undefined;
  const createdAt = typeof obj.createdAt === "string" ? obj.createdAt.trim() : new Date().toISOString();
  const expiresAt = typeof obj.expiresAt === "string" ? obj.expiresAt.trim() : new Date().toISOString();
  const revision = typeof obj.revision === "number" ? Math.max(1, Math.floor(obj.revision)) : 1;

  return {
    sessionId,
    state,
    device,
    summary,
    skills,
    uploadProgress,
    cutoverReceipt,
    errorMessage,
    errorCode,
    createdAt,
    expiresAt,
    revision
  };
}
