import type { ImportSessionProjection } from "./contracts.ts";
import { sanitizeImportSessionProjection } from "./redaction.ts";

const IMPORT_STATE_PRIORITY: readonly ImportSessionProjection["state"][] = [
  "ready_for_consent",
  "consented",
  "cutover_ready",
  "partial",
  "preview"
];

function orderNewestFirst(
  projections: readonly ImportSessionProjection[]
): ImportSessionProjection[] {
  return [...projections].sort((a, b) => {
    const aCreatedAt = Date.parse(a.createdAt);
    const bCreatedAt = Date.parse(b.createdAt);
    if (Number.isFinite(aCreatedAt) && Number.isFinite(bCreatedAt) && aCreatedAt !== bCreatedAt) {
      return bCreatedAt - aCreatedAt;
    }
    if (Number.isFinite(aCreatedAt) !== Number.isFinite(bCreatedAt)) {
      return Number.isFinite(bCreatedAt) ? 1 : -1;
    }
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  });
}

/** Sanitizes every bounded dashboard row and drops malformed projections. */
export function sanitizeImportDashboardRows(
  rows: readonly Record<string, unknown>[]
): ImportSessionProjection[] {
  return rows.flatMap((row) => {
    if (!("projection" in row)) return [];
    const projection = sanitizeImportSessionProjection(row.projection);
    return projection ? [projection] : [];
  });
}

/** Selects the newest session in the highest-priority owner workflow state. */
export function selectImportDashboardProjection(
  projections: readonly ImportSessionProjection[]
): ImportSessionProjection | null {
  const ordered = orderNewestFirst(projections);
  for (const state of IMPORT_STATE_PRIORITY) {
    const candidate = ordered.find((projection) => projection.state === state);
    if (candidate) return candidate;
  }
  return ordered[0] ?? null;
}
