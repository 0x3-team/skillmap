import type { ImportFileEntry, ImportManifestResult } from './import-manifest-builder.js';

export interface ImportPreviewRecord {
  skillPublicId?: string;
  skillDisplayName?: string;
  path?: string;
  reason: string;
  detail?: string;
}

export interface ImportPreviewSkillSummary {
  public_id: string;
  logical_id?: string;
  display_name?: string;
  importable: boolean;
  manifest_digest?: string;
  files: number;
  bytes: number;
  non_importable: number;
  warnings: number;
  blocked: number;
  excluded: number;
}

export interface ImportPreviewActions {
  import: number;
  block: number;
  review: number;
}

export interface ImportPreview {
  total_skills: number;
  importable_skills: number;
  non_importable_skills: number;
  total_files: number;
  total_bytes: number;
  total_duplicates: number;
  total_warnings: number;
  total_blocked: number;
  total_excluded: number;
  proposed_actions: ImportPreviewActions;
  skills: ImportPreviewSkillSummary[];
  blocked: ImportPreviewRecord[];
  excluded: ImportPreviewRecord[];
  truncated: boolean;
}

export interface ImportPreviewOptions {
  maxSkills?: number;
  maxItems?: number;
  blockedRecords?: ImportPreviewRecord[];
  excludedRecords?: ImportPreviewRecord[];
}

const DEFAULT_MAX_SKILLS = 256;
const DEFAULT_MAX_ITEMS = 1_024;

function skillDisplayName(result: ImportManifestResult): string | undefined {
  return result.manifest?.display?.name ?? result.sourceReceipt?.relativePath;
}

function isUnsafePreviewPath(value: string): boolean {
  if (value === '' || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return true;
  if (value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:/u.test(value)) return true;
  if (value.startsWith('\\') || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return true;
  if (/%(?:2e|2f|5c)/iu.test(value)) return true;
  const segments = value.split('/');
  return segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

function redactPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (isUnsafePreviewPath(value)) return undefined;
  return value;
}

function redactDetail(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 160) return undefined;
  if (/[\u0000-\u001f\u007f-\u009f\\/~]/u.test(value)) return undefined;
  if (/(?:^|\s)[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) || /%(?:2e|2f|5c)/iu.test(value)) return undefined;
  return value;
}

function redactRecord(record: ImportPreviewRecord): ImportPreviewRecord {
  return {
    ...record,
    path: redactPath(record.path),
    detail: redactDetail(record.detail)
  };
}

function sumFilesBytes(files: ImportFileEntry[]): number {
  return files.reduce((sum, file) => sum + (file.utf8_bytes ?? 0), 0);
}

function countDuplicates(results: ImportManifestResult[]): number {
  const digests = new Map<string, number>();
  for (const result of results) {
    if (!result.manifestDigest) continue;
    digests.set(result.manifestDigest, (digests.get(result.manifestDigest) ?? 0) + 1);
  }
  let duplicates = 0;
  for (const count of digests.values()) {
    if (count > 1) duplicates += count;
  }
  return duplicates;
}

export function buildImportPreview(
  results: ImportManifestResult[],
  options: ImportPreviewOptions = {}
): ImportPreview {
  const maxSkills = options.maxSkills ?? DEFAULT_MAX_SKILLS;
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const blockedRecords = (options.blockedRecords ?? []).map(redactRecord);
  const excludedRecords = (options.excludedRecords ?? []).map(redactRecord);

  const byPublicId = new Map<string, ImportPreviewRecord[]>();
  const byDisplayName = new Map<string, ImportPreviewRecord[]>();
  for (const record of blockedRecords) {
    const key = record.skillPublicId ?? record.skillDisplayName ?? '';
    byPublicId.set(key, [...(byPublicId.get(key) ?? []), record]);
    if (record.skillDisplayName) {
      byDisplayName.set(record.skillDisplayName, [...(byDisplayName.get(record.skillDisplayName) ?? []), record]);
    }
  }
  for (const record of excludedRecords) {
    const key = record.skillPublicId ?? record.skillDisplayName ?? '';
    byPublicId.set(key, [...(byPublicId.get(key) ?? []), record]);
    if (record.skillDisplayName) {
      byDisplayName.set(record.skillDisplayName, [...(byDisplayName.get(record.skillDisplayName) ?? []), record]);
    }
  }

  const total_skills = results.length;
  const proposedActions: ImportPreviewActions = { import: 0, block: 0, review: 0 };
  let rawImportable = 0;
  let nonImportableSkills = 0;
  let total_files = 0;
  let total_bytes = 0;
  let total_warnings = 0;

  const skillSummaries: ImportPreviewSkillSummary[] = results.map((result) => {
    const displayName = skillDisplayName(result);
    const publicId = result.manifest?.identity?.public_id ?? result.sourceReceipt?.provenance?.publisher_id ?? 'unknown';
    const logicalId = result.manifest?.identity?.logical_id ?? result.sourceReceipt?.relativePath;
    const skillBlocked = byPublicId.get(publicId) ?? (displayName ? byDisplayName.get(displayName) : []) ?? [];
    const skillExcluded = excludedRecords.filter((record) =>
      record.skillPublicId === publicId || (displayName && record.skillDisplayName === displayName)
    );
    const files = result.files.length;
    const bytes = sumFilesBytes(result.files);
    const non_importable = result.nonImportable.length;

    if (result.importable) rawImportable += 1;
    else nonImportableSkills += 1;
    total_files += files;
    total_bytes += bytes;
    total_warnings += result.warnings.length;

    const summary: ImportPreviewSkillSummary = {
      public_id: publicId,
      logical_id: logicalId,
      display_name: displayName,
      importable: result.importable,
      manifest_digest: result.manifestDigest,
      files,
      bytes,
      non_importable,
      warnings: result.warnings.length,
      blocked: skillBlocked.length,
      excluded: skillExcluded.length
    };

    if (!result.importable || skillBlocked.length > 0) {
      proposedActions.block += 1;
    } else if (skillExcluded.length > 0) {
      proposedActions.review += 1;
    } else {
      proposedActions.import += 1;
    }

    return summary;
  });

  const total_duplicates = countDuplicates(results);
  const total_blocked = blockedRecords.length;
  const total_excluded = excludedRecords.length;

  let truncated = false;
  const skills = skillSummaries.slice(0, maxSkills);
  if (skills.length < skillSummaries.length) {
    truncated = true;
  }

  let itemsRemaining = Math.max(0, maxItems - skills.length);
  const blocked = blockedRecords.slice(0, itemsRemaining);
  if (blocked.length < blockedRecords.length) truncated = true;

  itemsRemaining = Math.max(0, itemsRemaining - blocked.length);
  const excluded = excludedRecords.slice(0, itemsRemaining);
  if (excluded.length < excludedRecords.length) truncated = true;

  return {
    total_skills,
    importable_skills: rawImportable,
    non_importable_skills: nonImportableSkills,
    total_files,
    total_bytes,
    total_duplicates,
    total_warnings,
    total_blocked,
    total_excluded,
    proposed_actions: proposedActions,
    skills,
    blocked,
    excluded,
    truncated
  };
}

export function nonImportableToPreviewRecords(result: ImportManifestResult): ImportPreviewRecord[] {
  const displayName = result.manifest?.display?.name;
  const publicId = result.manifest?.identity?.public_id;
  return result.nonImportable.map((entry) => ({
    skillPublicId: publicId,
    skillDisplayName: displayName,
    path: redactPath(entry.path),
    reason: entry.reason,
    detail: redactDetail(entry.detail)
  }));
}
