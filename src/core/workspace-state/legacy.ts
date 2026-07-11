import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  atomicReplaceSynced,
  hashBytes,
  jsonBytes,
  pathExists,
  readRegularFile,
  syncDirectory,
  workspaceStateArtifactReadLimit,
  WORKSPACE_STATE_READ_LIMITS
} from './durability.js';
import { errorCode, WorkspaceStateError } from './errors.js';
import { artifactRule, legacyArtifactPath, type WorkspaceStatePaths } from './paths.js';
import { attachPayloadDigest, validateProjectionIndex } from './schema.js';
import { listLegacyArtifactPaths } from './revision.js';
import type { LegacyDivergence, LegacyProjectionIndex, ValidatedRevision } from './types.js';

export async function classifyLegacyDivergence(paths: WorkspaceStatePaths, revision: ValidatedRevision): Promise<LegacyDivergence[]> {
  const divergences: LegacyDivergence[] = [];
  const expected = new Map(revision.manifest.artifacts.map((artifact) => [artifact.path, artifact]));
  const preflight = await preflightLegacyProjectionBudget(paths, revision);
  let totalBytes = 0;
  for (const artifact of revision.manifest.artifacts) {
    const target = legacyArtifactPath(paths, artifact.path);
    const state = preflight.get(artifact.path);
    if (state === 'missing') {
      divergences.push(divergence(artifact.path, artifact.role, 'missing', artifact.digest));
      continue;
    }
    if (state === 'type-mismatch') {
      divergences.push(divergence(artifact.path, artifact.role, 'type-mismatch', artifact.digest));
      continue;
    }
    try {
      const remaining = WORKSPACE_STATE_READ_LIMITS.totalArtifactBytes - totalBytes;
      const bytes = await readRegularFile(target, {
        root: paths.skillmap,
        maxBytes: Math.min(workspaceStateArtifactReadLimit(artifact.role), remaining),
        label: `${artifact.role} legacy projection`
      });
      totalBytes += bytes.length;
      const actualDigest = hashBytes(bytes);
      if (actualDigest !== artifact.digest) divergences.push(divergence(artifact.path, artifact.role, 'digest-mismatch', artifact.digest, actualDigest));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') divergences.push(divergence(artifact.path, artifact.role, 'missing', artifact.digest));
      else throw error;
    }
  }
  for (const relative of await listLegacyArtifactPaths(paths)) {
    if (expected.has(relative)) continue;
    const rule = artifactRule(relative);
    if (rule) divergences.push(divergence(relative, rule.role, 'unexpected'));
  }
  try {
    const index = validateProjectionIndex(JSON.parse((await readRegularFile(paths.projectionIndex, {
      root: paths.skillmap,
      maxBytes: WORKSPACE_STATE_READ_LIMITS.projectionIndexBytes,
      label: 'Legacy projection index'
    })).toString('utf8')));
    if (index.workspaceId !== revision.manifest.workspaceId || index.revisionId !== revision.manifest.revisionId) {
      divergences.push({
        path: 'state/legacy-projection.json',
        role: 'derived',
        severity: 'warning',
        code: 'projection-index-mismatch'
      });
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      divergences.push({ path: 'state/legacy-projection.json', role: 'derived', severity: 'warning', code: 'projection-index-mismatch' });
    } else {
      divergences.push({ path: 'state/legacy-projection.json', role: 'derived', severity: 'warning', code: 'missing' });
    }
  }
  return divergences.sort((left, right) => left.path.localeCompare(right.path));
}

async function preflightLegacyProjectionBudget(
  paths: WorkspaceStatePaths,
  revision: ValidatedRevision
): Promise<Map<string, 'regular' | 'missing' | 'type-mismatch'>> {
  const states = new Map<string, 'regular' | 'missing' | 'type-mismatch'>();
  let totalBytes = 0;
  for (const artifact of revision.manifest.artifacts) {
    try {
      const stats = await lstat(legacyArtifactPath(paths, artifact.path));
      if (stats.isSymbolicLink() || !stats.isFile()) {
        states.set(artifact.path, 'type-mismatch');
        continue;
      }
      const roleLimit = workspaceStateArtifactReadLimit(artifact.role);
      if (!Number.isSafeInteger(stats.size) || stats.size < 0 || stats.size > roleLimit) {
        throw new WorkspaceStateError('STATE_READ_LIMIT_EXCEEDED', `${artifact.role} legacy projection exceeds its ${roleLimit}-byte workspace-state read limit.`);
      }
      if (stats.size > WORKSPACE_STATE_READ_LIMITS.totalArtifactBytes - totalBytes) {
        throw new WorkspaceStateError('STATE_READ_LIMIT_EXCEEDED', `Legacy projections exceed the ${WORKSPACE_STATE_READ_LIMITS.totalArtifactBytes}-byte aggregate workspace-state read limit.`);
      }
      totalBytes += stats.size;
      states.set(artifact.path, 'regular');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      states.set(artifact.path, 'missing');
    }
  }
  return states;
}

export async function writeProjectionIndex(paths: WorkspaceStatePaths, revision: ValidatedRevision, generatedAt: string): Promise<void> {
  const index = attachPayloadDigest({
    kind: 'skillmap.legacy-projection-index' as const,
    schemaVersion: 1 as const,
    workspaceId: revision.manifest.workspaceId,
    revisionId: revision.manifest.revisionId,
    generatedAt,
    artifacts: revision.manifest.artifacts
  }) as LegacyProjectionIndex;
  await atomicReplaceSynced(paths.projectionIndex, jsonBytes(index));
}

export async function repairLegacyProjections(paths: WorkspaceStatePaths, revision: ValidatedRevision, generatedAt: string): Promise<void> {
  const expected = new Set(revision.manifest.artifacts.map((artifact) => artifact.path));
  for (const relative of await listLegacyArtifactPaths(paths)) {
    if (expected.has(relative)) continue;
    const target = legacyArtifactPath(paths, relative);
    const stats = await lstat(target);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Refusing to remove unsafe legacy projection: ${target}`);
    await rm(target, { force: false });
    await syncDirectory(path.dirname(target));
  }
  for (const artifact of revision.manifest.artifacts) {
    const source = path.join(revision.directory, 'workspace', '.skillmap', ...artifact.path.split('/'));
    const bytes = await readRegularFile(source, {
      root: paths.skillmap,
      maxBytes: Math.min(workspaceStateArtifactReadLimit(artifact.role), artifact.bytes),
      label: `${artifact.role} revision artifact`
    });
    if (bytes.length !== artifact.bytes || hashBytes(bytes) !== artifact.digest) {
      throw new WorkspaceStateError('STATE_REVISION_CHANGED', `Validated revision artifact changed before projection repair: ${artifact.path}`);
    }
    await atomicReplaceSynced(legacyArtifactPath(paths, artifact.path), bytes);
  }
  await writeProjectionIndex(paths, revision, generatedAt);
}

function divergence(
  artifactPath: string,
  role: LegacyDivergence['role'],
  code: LegacyDivergence['code'],
  expectedDigest?: string,
  actualDigest?: string
): LegacyDivergence {
  return {
    path: artifactPath,
    role,
    severity: role === 'derived' ? 'warning' : 'blocking',
    code,
    ...(expectedDigest ? { expectedDigest } : {}),
    ...(actualDigest ? { actualDigest } : {})
  };
}
