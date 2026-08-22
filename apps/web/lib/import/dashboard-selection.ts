import type { ImportSessionProjection } from "./contracts.ts";

const IMPORT_STATE_PRIORITY: readonly ImportSessionProjection["state"][] = [
  "ready_for_consent",
  "consented",
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
