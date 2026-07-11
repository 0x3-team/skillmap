import path from 'node:path';
import { readJson } from '../core/fs.js';
import { computeEffectiveRevisionDigest } from '../core/effective-state.js';
import { assertQualifiedInventory } from '../core/identity.js';
import { WorkspaceStateStore, type WorkspaceStateRead } from '../core/workspace-state/index.js';
import type { EffectiveRegistry, RevisionRef } from '../schemas/types.js';
import type { ApprovedRoutingState } from './route-use-case.js';

export interface ApprovedWorkspaceRead {
  state: WorkspaceStateRead;
  revisionRoot: string;
  skillmapRoot: string;
  servingRevision: RevisionRef;
  currentRevision: RevisionRef;
  effective?: EffectiveRegistry;
  warningCodes: string[];
}

export async function openApprovedWorkspaceRead(cwd: string, purpose: 'status' | 'routing'): Promise<ApprovedWorkspaceRead> {
  const state = await WorkspaceStateStore.open(cwd).readCurrent({ purpose });
  const revisionRoot = path.join(state.revision.directory, 'workspace');
  const skillmapRoot = path.join(revisionRoot, '.skillmap');
  const effectiveArtifact = state.revision.manifest.artifacts.find((artifact) => artifact.path === 'effective.json');
  const warningCodes = [
    ...(state.source === 'last-known-good' ? ['serving-last-known-good'] : []),
    ...(state.currentFailure ? [state.currentFailure.code.toLowerCase().replace(/_/g, '-')] : []),
    ...state.legacyDivergence.filter((item) => item.severity === 'warning').map((item) => `legacy-${item.code}`)
  ];
  let effective: EffectiveRegistry | undefined;
  if (effectiveArtifact) {
    effective = await readJson<EffectiveRegistry>(path.join(skillmapRoot, 'effective.json'));
    assertEffectiveRegistry(effective);
    const inventoryArtifact = state.revision.manifest.artifacts.find((artifact) => artifact.path === 'inventory.json');
    if (!effective.inputs || !inventoryArtifact || effective.inputs.inventoryDigest !== inventoryArtifact.digest) {
      if (purpose === 'routing') throw approvedStateError('APPROVED_EFFECTIVE_STALE', 'The approved effective registry is not bound to the revision inventory.');
      warningCodes.push('approved-effective-inventory-stale');
    }
    const policyBound = state.revision.manifest.artifacts.some((artifact) =>
      artifact.role === 'canonical-intent'
      && (artifact.path === 'policy.yml' || artifact.path.startsWith('policies/'))
      && artifact.digest === effective!.inputs!.policyDigest);
    if (!policyBound) {
      if (purpose === 'routing') throw approvedStateError('APPROVED_EFFECTIVE_STALE', 'The approved effective registry is not bound to a canonical policy artifact.');
      warningCodes.push('approved-effective-policy-stale');
    }
  }
  const semanticEffectiveDigest = effective ? computeEffectiveRevisionDigest(effective) : null;
  const servingRevision = revisionRef(
    state.selectedPointer.workspaceId,
    state.selectedPointer.revisionId,
    state.selectedPointer.workspaceRevision,
    state.selectedPointer.effectiveDigest,
    state.selectedPointer.effectiveRevisionDigest
  );
  const currentRevision = revisionRef(
    state.currentPointer.workspaceId,
    state.currentPointer.revisionId,
    state.currentPointer.workspaceRevision,
    state.currentPointer.effectiveDigest,
    state.currentPointer.effectiveRevisionDigest
  );
  if (servingRevision.effectiveDigest !== (effectiveArtifact?.digest ?? null) || servingRevision.effectiveRevisionDigest !== semanticEffectiveDigest) {
    if (purpose === 'routing') throw approvedStateError('APPROVED_EFFECTIVE_DIGEST_MISMATCH', 'The approved effective routing receipt does not match its immutable artifact.');
    warningCodes.push('approved-effective-digest-stale');
  }
  return { state, revisionRoot, skillmapRoot, servingRevision, currentRevision, ...(effective ? { effective } : {}), warningCodes };
}

export async function openApprovedRoutingState(cwd: string): Promise<ApprovedRoutingState & { currentRevision: RevisionRef }> {
  const read = await openApprovedWorkspaceRead(cwd, 'routing');
  return approvedRoutingStateFromRead(read);
}

export function approvedRoutingStateFromRead(read: ApprovedWorkspaceRead): ApprovedRoutingState & { currentRevision: RevisionRef } {
  if (!read.effective) throw approvedStateError('APPROVED_EFFECTIVE_MISSING', 'The approved workspace revision has no effective routing registry.');
  return {
    servingRevision: read.servingRevision,
    currentRevision: read.currentRevision,
    servingMode: read.state.source,
    effective: read.effective,
    warningCodes: read.warningCodes
  };
}

export function approvedArtifactPath(read: ApprovedWorkspaceRead, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes('\0')) throw new Error('Approved artifact path must be relative.');
  const normalized = path.posix.normalize(relative.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('Approved artifact path escapes the revision.');
  const target = path.resolve(read.skillmapRoot, normalized);
  if (!target.startsWith(`${path.resolve(read.skillmapRoot)}${path.sep}`)) throw new Error('Approved artifact path escapes the revision.');
  return target;
}

function assertEffectiveRegistry(value: EffectiveRegistry): void {
  if (!value || typeof value !== 'object' || !Array.isArray(value.skills) || !value.inventory || !value.graph) throw approvedStateError('APPROVED_EFFECTIVE_INVALID', 'The approved effective registry is malformed.');
  assertQualifiedInventory(value.inventory, 'route approved workspace state');
  if (value.inventory.identityIssues.length > 0) throw approvedStateError('APPROVED_IDENTITY_BLOCKED', 'The approved effective registry has unresolved identity issues.');
  if (value.skills.some((skill) => !/^sk_[A-Za-z0-9_-]{43}$/.test(skill.skillId) || !/^sha256:[a-f0-9]{64}$/.test(skill.contentRevision))) {
    throw approvedStateError('APPROVED_EFFECTIVE_INVALID', 'The approved effective registry contains invalid qualified identities.');
  }
}

function revisionRef(workspaceId: string, revisionId: string, workspaceRevision: string, effectiveDigest: string | null, effectiveRevisionDigest: string | null): RevisionRef {
  return { workspaceId, revisionId, workspaceRevision, effectiveDigest, effectiveRevisionDigest };
}

function approvedStateError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = 'ApprovedStateUnavailableError';
  Object.assign(error, { code });
  return error;
}
