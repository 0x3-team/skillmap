import path from 'node:path';
import type { ArtifactRule } from './types.js';

export const REVISION_ID_PATTERN = /^r([0-9]{20})-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXACT_ARTIFACT_RULES = new Map<string, ArtifactRule>([
  ['config.yml', { role: 'canonical-intent', routingCritical: true }],
  ['identity.json', { role: 'canonical-intent', routingCritical: true }],
  ['identity-migrations.json', { role: 'canonical-intent', routingCritical: true }],
  ['policy.yml', { role: 'canonical-intent', routingCritical: true }],
  ['policy-rationale.md', { role: 'canonical-intent', routingCritical: false }],
  ['sources.json', { role: 'canonical-intent', routingCritical: true }],
  ['source-decisions.json', { role: 'canonical-intent', routingCritical: true }],
  ['privacy.json', { role: 'canonical-intent', routingCritical: true }],
  ['real-evals.json', { role: 'canonical-intent', routingCritical: false }],
  ['curation/receipt.json', { role: 'canonical-intent', routingCritical: false }],
  ['inventory.json', { role: 'raw-truth', routingCritical: true }],
  ['effective.json', { role: 'derived', routingCritical: true }],
  ['doctor.json', { role: 'derived', routingCritical: false }],
  ['doctor-pack.md', { role: 'derived', routingCritical: false }],
  ['doctor-pack.summary.md', { role: 'derived', routingCritical: false }],
  ['graph.raw.json', { role: 'derived', routingCritical: false }],
  ['graph.raw.mmd', { role: 'derived', routingCritical: false }],
  ['graph.effective.json', { role: 'derived', routingCritical: false }],
  ['graph.effective.mmd', { role: 'derived', routingCritical: false }],
  ['skillgraph.json', { role: 'derived', routingCritical: false }],
  ['skillgraph.mmd', { role: 'derived', routingCritical: false }],
  ['source-status.json', { role: 'derived', routingCritical: false }],
  ['eval-report.json', { role: 'derived', routingCritical: false }],
  ['dashboard-snapshot.json', { role: 'derived', routingCritical: false }],
  ['reports/doctor.md', { role: 'derived', routingCritical: false }],
  ['reports/fix-plan.md', { role: 'derived', routingCritical: false }]
]);

export interface WorkspaceStatePaths {
  cwd: string;
  skillmap: string;
  marker: string;
  state: string;
  fence: string;
  writerLock: string;
  pointers: string;
  currentPointer: string;
  lastKnownGoodPointer: string;
  routingApprovals: string;
  revisions: string;
  quarantine: string;
  projectionIndex: string;
}

export function workspaceStatePaths(cwd: string): WorkspaceStatePaths {
  const resolvedCwd = path.resolve(cwd);
  const skillmap = path.join(resolvedCwd, '.skillmap');
  const state = path.join(skillmap, 'state');
  const pointers = path.join(state, 'pointers');
  return {
    cwd: resolvedCwd,
    skillmap,
    marker: path.join(skillmap, 'state-version.json'),
    state,
    fence: path.join(state, 'fence.json'),
    writerLock: path.join(state, 'writer.lock'),
    pointers,
    currentPointer: path.join(pointers, 'current.json'),
    lastKnownGoodPointer: path.join(pointers, 'last-known-good.json'),
    routingApprovals: path.join(state, 'routing-approvals'),
    revisions: path.join(state, 'revisions'),
    quarantine: path.join(state, 'quarantine'),
    projectionIndex: path.join(state, 'legacy-projection.json')
  };
}

export function normalizeArtifactPath(value: string): string {
  if (!value || value.includes('\0') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`Workspace artifact path must be a non-empty relative path: ${value}`);
  }
  const portable = value.replaceAll('\\', '/');
  const segments = portable.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/u.test(segment))) {
    throw new Error(`Workspace artifact path contains an invalid segment: ${value}`);
  }
  const normalized = segments.map((segment) => segment.normalize('NFC')).join('/');
  if (normalized !== portable) throw new Error(`Workspace artifact path is not NFC-normalized: ${value}`);
  return normalized;
}

export function artifactRule(value: string): ArtifactRule | undefined {
  const normalized = normalizeArtifactPath(value);
  const exact = EXACT_ARTIFACT_RULES.get(normalized);
  if (exact) return { ...exact };
  if (isPolicyArtifact(normalized)) return { role: 'canonical-intent', routingCritical: true };
  return undefined;
}

export function isAllowedArtifact(value: string): boolean {
  try {
    return Boolean(artifactRule(value));
  } catch {
    return false;
  }
}

export function revisionSequence(revisionId: string): number {
  const match = REVISION_ID_PATTERN.exec(revisionId);
  if (!match) throw new Error(`Invalid workspace revision ID: ${revisionId}`);
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error(`Invalid workspace revision sequence: ${revisionId}`);
  return sequence;
}

export function revisionDirectory(paths: WorkspaceStatePaths, revisionId: string): string {
  revisionSequence(revisionId);
  return containedPath(paths.revisions, revisionId);
}

export function revisionSkillmapDirectory(paths: WorkspaceStatePaths, revisionId: string): string {
  return path.join(revisionDirectory(paths, revisionId), 'workspace', '.skillmap');
}

export function revisionArtifactPath(paths: WorkspaceStatePaths, revisionId: string, artifactPath: string): string {
  return containedPath(revisionSkillmapDirectory(paths, revisionId), normalizeArtifactPath(artifactPath));
}

/** Immutable historical copy of the exact last-known-good approval pointer. */
export function routingApprovalHistoryPath(paths: WorkspaceStatePaths, revisionId: string): string {
  revisionSequence(revisionId);
  return containedPath(paths.routingApprovals, `${revisionId}.json`);
}

export function legacyArtifactPath(paths: WorkspaceStatePaths, artifactPath: string): string {
  return containedPath(paths.skillmap, normalizeArtifactPath(artifactPath));
}

export function containedPath(base: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error(`Contained path must be relative: ${relative}`);
  const resolvedBase = path.resolve(base);
  const target = path.resolve(resolvedBase, relative);
  if (target === resolvedBase || !target.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`Path escapes its approved workspace-state root: ${relative}`);
  }
  return target;
}

function isPolicyArtifact(relative: string): boolean {
  if (!relative.startsWith('policies/')) return false;
  const segments = relative.split('/');
  if (segments.length < 2 || segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))) return false;
  return /\.(?:json|ya?ml)$/i.test(segments.at(-1) ?? '');
}
