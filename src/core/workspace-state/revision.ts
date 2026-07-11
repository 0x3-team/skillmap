import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, mkdir, opendir } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../canonical-payload.js';
import { computeEffectiveRevisionDigest } from '../effective-state.js';
import { parsePolicyYaml, validatePolicy } from '../policy.js';
import type { EffectiveRegistry } from '../../schemas/types.js';
import {
  assertDirectory,
  ensurePrivateDirectory,
  hashBytes,
  jsonBytes,
  listRegularFiles,
  pathExists,
  readRegularFile,
  syncDirectoriesBottomUp,
  syncDirectory,
  workspaceStateArtifactReadLimit,
  WORKSPACE_STATE_READ_LIMITS,
  writeExclusiveSynced
} from './durability.js';
import { RevisionValidationError, WorkspaceStateError } from './errors.js';
import {
  artifactRule,
  legacyArtifactPath,
  normalizeArtifactPath,
  revisionArtifactPath,
  revisionDirectory,
  revisionSkillmapDirectory,
  UUID_PATTERN,
  type WorkspaceStatePaths
} from './paths.js';
import { attachPayloadDigest, computeRevisionDigests, manifestPointerMismatch, validateManifest } from './schema.js';
import type {
  RevisionArtifact,
  RevisionMutation,
  ValidatedRevision,
  WorkspacePointer,
  WorkspaceRevisionManifest,
  WorkspaceStateFailpoint
} from './types.js';

export interface SnapshotArtifact extends RevisionArtifact {
  content: Buffer;
}

export interface RevisionBuildOptions {
  workspaceId: string;
  fencingToken: number;
  parentRevisionId: string | null;
  mutation: RevisionMutation;
  artifacts: SnapshotArtifact[];
  producerVersion: string;
  createdAt: string;
  failpoint?: (name: WorkspaceStateFailpoint) => void | Promise<void>;
}

export async function collectLegacySnapshot(paths: WorkspaceStatePaths): Promise<{ workspaceId: string; artifacts: SnapshotArtifact[] }> {
  await assertDirectory(paths.skillmap);
  const relativeFiles = await listLegacyArtifactPaths(paths);
  const artifacts: SnapshotArtifact[] = [];
  let totalBytes = 0;
  for (const relative of relativeFiles) {
    const rule = artifactRule(relative);
    if (!rule) continue;
    const remaining = WORKSPACE_STATE_READ_LIMITS.totalArtifactBytes - totalBytes;
    const content = await readRegularFile(legacyArtifactPath(paths, relative), {
      root: paths.skillmap,
      maxBytes: Math.min(workspaceStateArtifactReadLimit(rule.role), remaining),
      label: `${rule.role} legacy artifact`
    });
    totalBytes += content.length;
    artifacts.push({ path: relative, ...rule, bytes: content.length, digest: hashBytes(content), content });
  }
  validateLegacyContracts(artifacts);
  return { workspaceId: workspaceIdFromArtifacts(artifacts), artifacts };
}

export async function verifyLegacySnapshotStillCurrent(paths: WorkspaceStatePaths, artifacts: SnapshotArtifact[]): Promise<void> {
  const currentPaths = await listLegacyArtifactPaths(paths);
  const expectedPaths = artifacts.map((artifact) => artifact.path);
  if (canonicalJson(currentPaths) !== canonicalJson(expectedPaths)) {
    throw new WorkspaceStateError('STATE_LEGACY_SNAPSHOT_RACE', 'Legacy artifact set changed while the immutable revision was being staged.');
  }
  for (const artifact of artifacts) {
    const bytes = await readRegularFile(legacyArtifactPath(paths, artifact.path), {
      root: paths.skillmap,
      maxBytes: workspaceStateArtifactReadLimit(artifact.role),
      label: `${artifact.role} legacy artifact`
    });
    if (bytes.length !== artifact.bytes || hashBytes(bytes) !== artifact.digest) {
      throw new WorkspaceStateError('STATE_LEGACY_SNAPSHOT_RACE', `Legacy artifact changed while the immutable revision was being staged: ${artifact.path}`);
    }
  }
}

export async function listLegacyArtifactPaths(paths: WorkspaceStatePaths): Promise<string[]> {
  await assertDirectory(paths.skillmap);
  const relativeFiles: string[] = [];
  const entries: Dirent[] = [];
  const directory = await opendir(paths.skillmap);
  try {
    for await (const entry of directory) {
      if (entries.length >= WORKSPACE_STATE_READ_LIMITS.traversalEntries) {
        throw new WorkspaceStateError('STATE_TRAVERSAL_LIMIT_EXCEEDED', `Legacy workspace state exceeds ${WORKSPACE_STATE_READ_LIMITS.traversalEntries} top-level entries.`);
      }
      entries.push(entry);
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  for (const entry of entries) {
    if (entry.name === 'state' || entry.name === 'state-version.json') continue;
    const absolute = path.join(paths.skillmap, entry.name);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      if (artifactRuleIfSafe(entry.name) || ['policies', 'curation', 'reports'].includes(entry.name)) {
        throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Allowlisted legacy artifact may not be a symbolic link: ${absolute}`);
      }
      continue;
    }
    if (stats.isFile()) {
      if (artifactRuleIfSafe(entry.name)) pushLegacyArtifact(relativeFiles, entry.name);
      continue;
    }
    if (!stats.isDirectory()) {
      if (artifactRuleIfSafe(entry.name)) throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Allowlisted legacy artifact must be a regular file: ${absolute}`);
      continue;
    }
    if (!['policies', 'curation', 'reports'].includes(entry.name)) continue;
    for (const nested of await listRegularFiles(absolute, {
      boundaryRoot: paths.skillmap,
      maxEntries: WORKSPACE_STATE_READ_LIMITS.traversalEntries,
      maxDepth: WORKSPACE_STATE_READ_LIMITS.traversalDepth
    })) {
      const relative = `${entry.name}/${nested}`;
      if (artifactRuleIfSafe(relative)) pushLegacyArtifact(relativeFiles, relative);
    }
  }
  relativeFiles.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (new Set(relativeFiles.map((relative) => relative.toLowerCase())).size !== relativeFiles.length) {
    throw new WorkspaceStateError('STATE_PORTABLE_PATH_COLLISION', 'Legacy artifacts collide on case-insensitive filesystems.');
  }
  return relativeFiles;
}

function pushLegacyArtifact(relativeFiles: string[], relative: string): void {
  if (relativeFiles.length >= WORKSPACE_STATE_READ_LIMITS.artifactEntries) {
    throw new WorkspaceStateError('STATE_ARTIFACT_ENTRY_LIMIT', `Legacy workspace state exceeds ${WORKSPACE_STATE_READ_LIMITS.artifactEntries} allowlisted artifacts.`);
  }
  relativeFiles.push(relative);
}

export async function buildRevision(paths: WorkspaceStatePaths, options: RevisionBuildOptions): Promise<ValidatedRevision> {
  if (!UUID_PATTERN.test(options.workspaceId)) throw new WorkspaceStateError('STATE_WORKSPACE_ID_INVALID', 'Workspace revision requires an opaque UUID workspaceId.');
  assertSnapshotArtifactLimits(options.artifacts);
  const sequenceText = String(options.fencingToken).padStart(20, '0');
  if (sequenceText.length !== 20) throw new WorkspaceStateError('STATE_REVISION_EXHAUSTED', 'Workspace revision sequence exceeded 20 digits.');
  const revisionId = `r${sequenceText}-${randomUUID()}`;
  const directory = revisionDirectory(paths, revisionId);
  await mkdir(directory, { mode: 0o700 });
  await syncDirectory(paths.revisions);
  await options.failpoint?.('after-revision-created');
  const skillmap = revisionSkillmapDirectory(paths, revisionId);
  await ensurePrivateDirectory(skillmap);
  const touched = new Set<string>([directory, path.join(directory, 'workspace'), skillmap, paths.revisions]);
  const artifacts = [...options.artifacts]
    .map(({ content: _content, ...artifact }) => artifact)
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) throw new WorkspaceStateError('STATE_DUPLICATE_ARTIFACT', 'Revision contains duplicate artifact paths.');
  if (new Set(artifacts.map((artifact) => artifact.path.toLowerCase())).size !== artifacts.length) {
    throw new WorkspaceStateError('STATE_PORTABLE_PATH_COLLISION', 'Revision artifacts collide on case-insensitive filesystems.');
  }
  for (const source of [...options.artifacts].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))) {
    const normalized = normalizeArtifactPath(source.path);
    const rule = artifactRule(normalized);
    if (!rule || rule.role !== source.role || rule.routingCritical !== source.routingCritical) {
      throw new WorkspaceStateError('STATE_ARTIFACT_NOT_ALLOWED', `Artifact is outside the workspace revision allowlist: ${source.path}`);
    }
    if (source.bytes !== source.content.length || source.digest !== hashBytes(source.content)) {
      throw new WorkspaceStateError('STATE_ARTIFACT_CHANGED', `Artifact bytes do not match the proposed receipt: ${source.path}`);
    }
    const target = revisionArtifactPath(paths, revisionId, normalized);
    await ensurePrivateDirectory(path.dirname(target));
    addDirectoryChain(touched, skillmap, path.dirname(target));
    await writeExclusiveSynced(target, source.content);
    await options.failpoint?.('after-artifact-written');
  }
  const effectiveRevisionDigest = validatedEffectiveRevisionDigest(options.artifacts);
  const digests = computeRevisionDigests(artifacts, effectiveRevisionDigest);
  const manifestWithoutDigest = {
    kind: 'skillmap.workspace-revision' as const,
    schemaVersion: 1 as const,
    workspaceId: options.workspaceId,
    revisionId,
    sequence: options.fencingToken,
    parentRevisionId: options.parentRevisionId,
    createdAt: options.createdAt,
    fencingToken: options.fencingToken,
    mutation: options.mutation,
    ...digests,
    effectiveDigest: artifacts.find((artifact) => artifact.path === 'effective.json')?.digest ?? null,
    effectiveRevisionDigest,
    artifacts,
    producer: { name: 'skillmap' as const, version: options.producerVersion },
    compatibility: { minReaderSchemaVersion: 1 as const, maxReaderSchemaVersion: 1 as const },
    redaction: { classification: 'local-sensitive' as const }
  };
  const manifest = validateManifest(attachPayloadDigest(manifestWithoutDigest));
  const manifestBytes = jsonBytes(manifest);
  await writeExclusiveSynced(path.join(directory, 'manifest.json'), manifestBytes);
  await options.failpoint?.('after-manifest-synced');
  await syncDirectoriesBottomUp(touched);
  return { directory, manifest, manifestDigest: hashBytes(manifestBytes) };
}

export async function validateRevision(
  paths: WorkspaceStatePaths,
  revisionId: string,
  expectedPointer?: WorkspacePointer
): Promise<ValidatedRevision> {
  const directory = revisionDirectory(paths, revisionId);
  try {
    await assertDirectory(directory);
    await assertDirectory(path.join(directory, 'workspace'));
    await assertDirectory(revisionSkillmapDirectory(paths, revisionId));
  } catch (error) {
    throw new RevisionValidationError('STATE_REVISION_DIRECTORY_INVALID', `Revision directory is missing or unsafe: ${revisionId}`, undefined, undefined, { cause: error });
  }
  let manifestBytes: Buffer;
  let manifest: WorkspaceRevisionManifest;
  try {
    manifestBytes = await readRegularFile(path.join(directory, 'manifest.json'), {
      root: paths.skillmap,
      maxBytes: WORKSPACE_STATE_READ_LIMITS.manifestBytes,
      label: 'Workspace revision manifest'
    });
    manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')));
  } catch (error) {
    throw new RevisionValidationError('STATE_MANIFEST_INVALID', `Revision manifest is invalid for ${revisionId}: ${error instanceof Error ? error.message : String(error)}`, undefined, undefined, { cause: error });
  }
  const manifestDigest = hashBytes(manifestBytes);
  if (manifest.revisionId !== revisionId) throw new RevisionValidationError('STATE_MANIFEST_REVISION_MISMATCH', 'Revision directory and manifest revision IDs differ.');
  if (expectedPointer) {
    if (expectedPointer.manifestDigest !== manifestDigest) throw new RevisionValidationError('STATE_MANIFEST_DIGEST_MISMATCH', 'Current pointer manifest digest does not validate.');
    const mismatch = manifestPointerMismatch(expectedPointer, manifest);
    if (mismatch) throw new RevisionValidationError('STATE_POINTER_MANIFEST_MISMATCH', `Current pointer and manifest differ at ${mismatch}.`);
  }
  const validatedArtifacts: SnapshotArtifact[] = [];
  for (const artifact of manifest.artifacts) {
    try {
      const bytes = await readRegularFile(revisionArtifactPath(paths, revisionId, artifact.path), {
        root: paths.skillmap,
        maxBytes: Math.min(workspaceStateArtifactReadLimit(artifact.role), artifact.bytes),
        label: `${artifact.role} revision artifact`
      });
      if (bytes.length !== artifact.bytes) {
        throw new RevisionValidationError('STATE_ARTIFACT_SIZE_MISMATCH', `Revision artifact size changed: ${artifact.path}`, artifact.path, artifact.role);
      }
      if (hashBytes(bytes) !== artifact.digest) {
        throw new RevisionValidationError('STATE_ARTIFACT_DIGEST_MISMATCH', `Revision artifact digest changed: ${artifact.path}`, artifact.path, artifact.role);
      }
      validatedArtifacts.push({ ...artifact, content: bytes });
    } catch (error) {
      if (error instanceof RevisionValidationError) throw error;
      throw new RevisionValidationError('STATE_ARTIFACT_UNREADABLE', `Revision artifact is missing or unsafe: ${artifact.path}`, artifact.path, artifact.role, { cause: error });
    }
  }
  const effectiveArtifact = manifest.artifacts.find((artifact) => artifact.path === 'effective.json');
  if (validatedEffectiveRevisionDigest(validatedArtifacts) !== manifest.effectiveRevisionDigest) {
    throw new RevisionValidationError(
      'STATE_EFFECTIVE_REVISION_DIGEST_MISMATCH',
      'Semantic effectiveRevisionDigest does not match the validated inventory/policy/effective read model.',
      effectiveArtifact?.path,
      'derived'
    );
  }
  let actualFiles: string[];
  try {
    actualFiles = await listRegularFiles(directory, {
      boundaryRoot: paths.skillmap,
      maxEntries: WORKSPACE_STATE_READ_LIMITS.traversalEntries,
      maxDepth: WORKSPACE_STATE_READ_LIMITS.traversalDepth
    });
  } catch (error) {
    throw new RevisionValidationError('STATE_REVISION_FILE_SET_INVALID', `Revision file set contains an unsafe entry: ${error instanceof Error ? error.message : String(error)}`, undefined, undefined, { cause: error });
  }
  const expectedFiles = [
    'manifest.json',
    ...manifest.artifacts.map((artifact) => `workspace/.skillmap/${artifact.path}`)
  ].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
    throw new RevisionValidationError('STATE_REVISION_FILE_SET_MISMATCH', 'Revision contains an unmanifested or duplicate file.');
  }
  return { directory, manifest, manifestDigest };
}

export async function revisionArtifacts(paths: WorkspaceStatePaths, revision: ValidatedRevision): Promise<SnapshotArtifact[]> {
  const artifacts: SnapshotArtifact[] = [];
  for (const artifact of revision.manifest.artifacts) {
    const content = await readRegularFile(revisionArtifactPath(paths, revision.manifest.revisionId, artifact.path), {
      root: paths.skillmap,
      maxBytes: Math.min(workspaceStateArtifactReadLimit(artifact.role), artifact.bytes),
      label: `${artifact.role} revision artifact`
    });
    artifacts.push({ ...artifact, content });
  }
  return artifacts;
}

function assertSnapshotArtifactLimits(artifacts: SnapshotArtifact[]): void {
  let totalBytes = 0;
  for (const artifact of artifacts) {
    const roleLimit = workspaceStateArtifactReadLimit(artifact.role);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0
      || artifact.bytes > roleLimit || artifact.content.length > roleLimit) {
      throw new WorkspaceStateError('STATE_ARTIFACT_TOO_LARGE', `Workspace artifact exceeds its ${artifact.role} byte limit: ${artifact.path}`);
    }
    totalBytes += artifact.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > WORKSPACE_STATE_READ_LIMITS.totalArtifactBytes) {
      throw new WorkspaceStateError('STATE_ARTIFACT_TOTAL_TOO_LARGE', 'Workspace revision artifacts exceed the aggregate state byte limit.');
    }
  }
}

export function assertRoutingApprovalEligible(artifacts: SnapshotArtifact[]): void {
  const present = new Set(artifacts.map((artifact) => artifact.path));
  const required = ['identity.json', 'inventory.json', 'effective.json'];
  const missing = required.filter((artifact) => !present.has(artifact));
  if (!present.has('policy.yml') && !present.has('policies/active.json')) missing.push('policy.yml or policies/active.json');
  if (missing.length) throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_INCOMPLETE', `Routing approval requires: ${missing.join(', ')}.`);
  const inventory = parseJsonArtifact(artifacts, 'inventory.json');
  if (inventory.version !== 2 || inventory.identityVersion !== 1 || !Array.isArray(inventory.skills)) {
    throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_BLOCKED', 'Routing approval requires a qualified inventory v2.');
  }
  const issues = inventory.identityIssues;
  if (!Array.isArray(issues) || issues.length > 0) throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_BLOCKED', 'Routing approval requires an inventory with zero identity issues.');
  const effective = parseJsonArtifact(artifacts, 'effective.json');
  const effectiveInventory = effective.inventory;
  if (!effectiveInventory || typeof effectiveInventory !== 'object' || Array.isArray(effectiveInventory)
    || (effectiveInventory as Record<string, unknown>).workspaceId !== inventory.workspaceId
    || canonicalJson(effectiveInventory) !== canonicalJson(inventory)
    || !Array.isArray(effective.skills)) {
    throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_BLOCKED', 'Routing approval requires an effective registry bound to the same workspace inventory.');
  }
  if (validatedEffectiveRevisionDigest(artifacts) === null) {
    throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_BLOCKED', 'Routing approval requires a valid semantic effectiveRevisionDigest.');
  }
}

function validateLegacyContracts(artifacts: SnapshotArtifact[]): void {
  workspaceIdFromArtifacts(artifacts);
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  const pointerArtifact = byPath.get('policies/active.json');
  if (pointerArtifact) {
    let pointer: Record<string, unknown>;
    try {
      pointer = JSON.parse(pointerArtifact.content.toString('utf8')) as Record<string, unknown>;
    } catch (error) {
      throw new WorkspaceStateError('STATE_LEGACY_POLICY_POINTER_INVALID', 'Legacy active policy pointer is not valid JSON.', { cause: error });
    }
    if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer) || pointer.version !== 1 || (pointer.activePolicyVersion !== 1 && pointer.activePolicyVersion !== 2)) {
      throw new WorkspaceStateError('STATE_LEGACY_POLICY_POINTER_INVALID', 'Legacy active policy pointer is malformed.');
    }
    for (const field of ['policyPath', 'rollbackPolicyPath'] as const) {
      if (typeof pointer[field] !== 'string') throw new WorkspaceStateError('STATE_LEGACY_POLICY_POINTER_INVALID', `Legacy active policy pointer is missing ${field}.`);
      const referenced = normalizeArtifactPath(pointer[field] as string);
      if (!artifactRule(referenced) || !byPath.has(referenced)) {
        throw new WorkspaceStateError('STATE_LEGACY_POLICY_POINTER_DANGLING', `Legacy active policy pointer references a missing or disallowed artifact: ${referenced}`);
      }
    }
    if (typeof pointer.sourcePolicyDigest === 'string') {
      const rollback = byPath.get(normalizeArtifactPath(pointer.rollbackPolicyPath as string));
      if (!rollback || rollback.digest !== pointer.sourcePolicyDigest) {
        throw new WorkspaceStateError('STATE_LEGACY_POLICY_ROLLBACK_MISMATCH', 'Legacy policy rollback artifact does not match its source digest.');
      }
    }
  }
}

function workspaceIdFromArtifacts(artifacts: SnapshotArtifact[]): string {
  const ids = new Set<string>();
  for (const artifactPath of ['identity.json', 'inventory.json']) {
    const artifact = artifacts.find((candidate) => candidate.path === artifactPath);
    if (!artifact) continue;
    const value = parseJsonArtifact(artifacts, artifactPath);
    if (typeof value.workspaceId !== 'string' || !UUID_PATTERN.test(value.workspaceId)) {
      throw new WorkspaceStateError('STATE_WORKSPACE_ID_INVALID', `${artifactPath} has no valid opaque workspaceId.`);
    }
    ids.add(value.workspaceId);
  }
  if (ids.size === 0) throw new WorkspaceStateError('STATE_WORKSPACE_ID_MISSING', 'Legacy migration requires identity.json or inventory.json with a workspaceId.');
  if (ids.size !== 1) throw new WorkspaceStateError('STATE_WORKSPACE_ID_DIVERGED', 'Legacy identity and inventory artifacts disagree on workspaceId.');
  return [...ids][0];
}

function parseJsonArtifact(artifacts: SnapshotArtifact[], artifactPath: string): Record<string, unknown> {
  const artifact = artifacts.find((candidate) => candidate.path === artifactPath);
  if (!artifact) throw new WorkspaceStateError('STATE_ARTIFACT_MISSING', `Required artifact is missing: ${artifactPath}`);
  try {
    const parsed = JSON.parse(artifact.content.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root is not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new WorkspaceStateError('STATE_ARTIFACT_INVALID_JSON', `${artifactPath} is not a JSON object.`, { cause: error });
  }
}

function artifactRuleIfSafe(value: string): boolean {
  try {
    return Boolean(artifactRule(value));
  } catch {
    return false;
  }
}

function addDirectoryChain(targets: Set<string>, root: string, leaf: string): void {
  let current = path.resolve(leaf);
  const resolvedRoot = path.resolve(root);
  while (current === resolvedRoot || current.startsWith(`${resolvedRoot}${path.sep}`)) {
    targets.add(current);
    if (current === resolvedRoot) break;
    current = path.dirname(current);
  }
}

function validatedEffectiveRevisionDigest(artifacts: SnapshotArtifact[]): string | null {
  try {
    const inventory = parseJsonArtifact(artifacts, 'inventory.json');
    if (inventory.version !== 2 || inventory.identityVersion !== 1 || !Array.isArray(inventory.identityIssues) || inventory.identityIssues.length > 0) return null;
    const effectiveArtifact = artifacts.find((artifact) => artifact.path === 'effective.json');
    if (!effectiveArtifact) return null;
    const effective = JSON.parse(effectiveArtifact.content.toString('utf8')) as EffectiveRegistry;
    if (!effective || typeof effective !== 'object' || !effective.inventory
      || !Array.isArray(effective.skills) || !effective.graph || !Array.isArray(effective.graph.nodes) || !Array.isArray(effective.graph.edges)
      || canonicalJson(effective.inventory) !== canonicalJson(inventory)) return null;
    const activePolicy = activePolicyFromArtifacts(artifacts, effective);
    if (!activePolicy || canonicalJson(effective.policy) !== canonicalJson(activePolicy)) return null;
    return computeEffectiveRevisionDigest(effective);
  } catch {
    return null;
  }
}

function activePolicyFromArtifacts(artifacts: SnapshotArtifact[], effective?: EffectiveRegistry): ReturnType<typeof validatePolicy> | undefined {
  if (effective?.inputs?.policyDigest) {
    const bound = artifacts.find((artifact) => artifact.role === 'canonical-intent' && artifact.digest === effective.inputs!.policyDigest);
    if (bound) {
      const text = bound.content.toString('utf8');
      const parsed = bound.path.endsWith('.json') ? JSON.parse(text) as unknown : parsePolicyYaml(text);
      return validatePolicy(parsed);
    }
  }
  let policyPath = 'policy.yml';
  const activePointer = artifacts.find((artifact) => artifact.path === 'policies/active.json');
  if (activePointer) {
    const pointer = JSON.parse(activePointer.content.toString('utf8')) as { policyPath?: unknown };
    if (typeof pointer.policyPath !== 'string') return undefined;
    policyPath = normalizeArtifactPath(pointer.policyPath);
  }
  const policyArtifact = artifacts.find((artifact) => artifact.path === policyPath);
  if (!policyArtifact) return undefined;
  const text = policyArtifact.content.toString('utf8');
  const parsed = policyPath.endsWith('.json') ? JSON.parse(text) as unknown : parsePolicyYaml(text);
  return validatePolicy(parsed);
}
