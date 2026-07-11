import { createHash } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ApprovedRootRecord, IdentityIssue, Inventory, SkillIdentityVersion } from '../schemas/types.js';
import { isSafeDisplayName } from './display-name.js';
import {
  createSkillWorkspaceByteBudget,
  resolveSkillFilesystemLimits,
  SkillFilesystemLimitError,
  type SkillFilesystemLimits,
  type SkillWorkspaceByteBudget
} from './skill-tree-limits.js';

export const SKILL_IDENTITY_VERSION: SkillIdentityVersion = 1;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SkillTreeEntry {
  path: string;
  bytes: number;
  mode: number;
  digest: string;
}

export interface SkillTreeRevision {
  version: 1;
  contentRevision: string;
  entries: SkillTreeEntry[];
}

interface CollectedTreeEntry {
  absolutePath: string;
  path: string;
  bytes: number;
  mode: number;
  snapshot: Stats;
}

interface TreeCollectionBudget {
  directories: number;
  entries: number;
  files: number;
  totalBytes: number;
  limits: SkillFilesystemLimits;
}

export interface SkillTreeHashOptions {
  limits?: Partial<SkillFilesystemLimits>;
  workspaceBudget?: SkillWorkspaceByteBudget;
  check?: () => void;
  onDirectory?: (directory: string) => void;
}

export interface QualifiedSkillIdentityOptions extends SkillTreeHashOptions {
}

export interface QualifiedSkillIdentity {
  identityVersion: SkillIdentityVersion;
  rootId: string;
  relativePath: string;
  skillId: string;
  contentRevision: string;
  treeEntries: SkillTreeEntry[];
  realPath: string;
}

export interface IdentityRecordLike {
  skillId: string;
  rootId: string;
  relativePath: string;
  path: string;
}

export function isOpaqueUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isQualifiedInventory(value: unknown): value is Inventory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const inventory = value as Partial<Inventory>;
  if (inventory.version !== 2 || inventory.identityVersion !== SKILL_IDENTITY_VERSION) return false;
  if (typeof inventory.workspaceId !== 'string' || !isOpaqueUuid(inventory.workspaceId)) return false;
  if (!Array.isArray(inventory.roots) || !Array.isArray(inventory.rootRecords) || !Array.isArray(inventory.skills)
    || !Array.isArray(inventory.identityIssues) || !Array.isArray(inventory.warnings)) return false;
  return inventory.rootRecords.every((root) => root
      && typeof root.rootId === 'string'
      && isOpaqueUuid(root.rootId)
      && typeof root.configuredPath === 'string'
      && typeof root.realPath === 'string')
    && inventory.skills.every((skill) => skill
      && typeof skill.skillId === 'string'
      && /^sk_[A-Za-z0-9_-]{43}$/.test(skill.skillId)
      && skill.id === skill.skillId
      && skill.identityVersion === SKILL_IDENTITY_VERSION
      && typeof skill.rootId === 'string'
      && isOpaqueUuid(skill.rootId)
      && typeof skill.relativePath === 'string'
      && typeof skill.contentRevision === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(skill.contentRevision)
      && isSafeDisplayName(skill.name));
}

export function assertQualifiedInventory(value: unknown, action = 'continue'): asserts value is Inventory {
  if (!isQualifiedInventory(value)) {
    throw new Error(`Qualified inventory v2 is required to ${action}. Run \`skillmap scan\` to migrate identity state first.`);
  }
}

export function normalizeRelativeSkillPath(value: string): string {
  if (!value || value.includes('\0')) throw new Error('Skill relative path must be a non-empty path without NUL bytes.');
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) throw new Error(`Absolute skill paths are not valid identity inputs: ${value}`);
  const portable = value.replaceAll('\\', '/');
  const rawSegments = portable.split('/');
  if (rawSegments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Skill relative path contains empty, current, or traversal segments: ${value}`);
  }
  const segments = rawSegments.map((segment) => segment.normalize('NFC'));
  if (segments.some((segment) => /[\u0000-\u001f\u007f]/u.test(segment))) {
    throw new Error(`Skill relative path contains control characters: ${value}`);
  }
  return segments.join('/');
}

export function deriveSkillId(rootId: string, relativePath: string): string {
  if (!isOpaqueUuid(rootId)) throw new Error(`rootId must be an opaque UUID, received: ${rootId}`);
  const normalized = normalizeRelativeSkillPath(relativePath);
  const input = `skillmap-skill-id\0v${SKILL_IDENTITY_VERSION}\0${rootId.toLowerCase()}\0${normalized}`;
  return `sk_${createHash('sha256').update(input).digest('base64url')}`;
}

export async function hashSkillTree(skillDir: string, options: SkillTreeHashOptions = {}): Promise<SkillTreeRevision> {
  const limits = resolveSkillFilesystemLimits(options.limits);
  const workspaceBudget = options.workspaceBudget ?? createSkillWorkspaceByteBudget(limits.maxWorkspaceBytes, limits);
  const rootStat = await lstat(skillDir);
  if (rootStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in skill identity trees: ${skillDir}`);
  if (!rootStat.isDirectory()) throw new Error(`Skill identity tree is not a directory: ${skillDir}`);
  const resolvedRoot = await realpath(skillDir);

  const collectionBudget: TreeCollectionBudget = { directories: 0, entries: 0, files: 0, totalBytes: 0, limits };
  const collected: CollectedTreeEntry[] = [];
  await collectTreeEntries(resolvedRoot, resolvedRoot, 0, collected, collectionBudget, options, true);
  collected.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));

  const normalizedPaths = new Set<string>();
  for (const entry of collected) {
    if (normalizedPaths.has(entry.path)) throw new Error(`Normalized path collision in skill tree: ${entry.path}`);
    normalizedPaths.add(entry.path);
  }
  if (!normalizedPaths.has('SKILL.md')) throw new Error(`Skill identity tree is missing SKILL.md: ${skillDir}`);
  if (workspaceBudget.totalBytes + collectionBudget.totalBytes > workspaceBudget.maxBytes) {
    throw new SkillFilesystemLimitError('maxWorkspaceBytes');
  }
  if (workspaceBudget.totalDirectories + collectionBudget.directories > workspaceBudget.maxDirectories) {
    throw new SkillFilesystemLimitError('maxDiscoveryDirectories');
  }
  if (workspaceBudget.totalEntries + collectionBudget.entries > workspaceBudget.maxEntries) {
    throw new SkillFilesystemLimitError('maxDiscoveryEntries');
  }

  const revisionHash = createHash('sha256');
  revisionHash.update('skillmap-content-revision\0v1\0');
  const entries: SkillTreeEntry[] = [];
  for (const entry of collected) {
    options.check?.();
    updateLengthPrefixed(revisionHash, Buffer.from(entry.path));
    updateLengthPrefixed(revisionHash, Buffer.from(entry.mode.toString(8)));
    updateLengthPrefix(revisionHash, entry.bytes);
    const digest = await streamStableFile(entry, revisionHash, options);
    entries.push({ path: entry.path, bytes: entry.bytes, mode: entry.mode, digest });
  }

  const verified: CollectedTreeEntry[] = [];
  const verifyBudget: TreeCollectionBudget = { directories: 0, entries: 0, files: 0, totalBytes: 0, limits };
  await collectTreeEntries(resolvedRoot, resolvedRoot, 0, verified, verifyBudget, options, false);
  verified.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  if (!sameTreeSnapshot(collected, verified)) throw new Error(`Skill tree changed while contentRevision was being computed: ${skillDir}`);

  workspaceBudget.totalBytes += collectionBudget.totalBytes;
  workspaceBudget.totalDirectories += collectionBudget.directories;
  workspaceBudget.totalEntries += collectionBudget.entries;
  return {
    version: 1,
    contentRevision: `sha256:${revisionHash.digest('hex')}`,
    entries
  };
}

export async function buildQualifiedSkillIdentity(root: ApprovedRootRecord, skillDir: string, options: QualifiedSkillIdentityOptions = {}): Promise<QualifiedSkillIdentity> {
  if (!isOpaqueUuid(root.rootId)) throw new Error(`Approved root has an invalid rootId: ${root.rootId}`);
  const dirStat = await lstat(skillDir);
  if (dirStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed for skill directories: ${skillDir}`);
  if (!dirStat.isDirectory()) throw new Error(`Skill path is not a directory: ${skillDir}`);

  const resolvedSkillDir = await realpath(skillDir);
  const relative = path.relative(root.realPath, resolvedSkillDir);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Skill path escapes or equals its approved root: ${skillDir}`);
  }
  const relativePath = normalizeRelativeSkillPath(relative);
  const tree = await hashSkillTree(resolvedSkillDir, options);
  return {
    identityVersion: SKILL_IDENTITY_VERSION,
    rootId: root.rootId,
    relativePath,
    skillId: deriveSkillId(root.rootId, relativePath),
    contentRevision: tree.contentRevision,
    treeEntries: tree.entries,
    realPath: resolvedSkillDir
  };
}

export function detectIdentityCollisions(records: IdentityRecordLike[]): IdentityIssue[] {
  const issues: IdentityIssue[] = [];
  collectGroupIssues(records, (record) => record.skillId, 'skill-id-collision', 'One skillId resolves to multiple identity tuples.', (group) => {
    return new Set(group.map((record) => `${record.rootId}\0${record.relativePath}`)).size > 1;
  }, issues);
  collectGroupIssues(records, (record) => `${record.rootId}\0${record.relativePath}`, 'normalized-path-collision', 'One root and normalized relative path resolve to multiple skill records.', () => true, issues);
  collectGroupIssues(records, (record) => path.resolve(record.path), 'physical-path-collision', 'One physical skill path is registered under multiple qualified identities.', (group) => {
    return new Set(group.map((record) => record.skillId)).size > 1;
  }, issues);
  return issues;
}

async function collectTreeEntries(
  root: string,
  current: string,
  depth: number,
  entries: CollectedTreeEntry[],
  budget: TreeCollectionBudget,
  options: SkillTreeHashOptions,
  notify: boolean
): Promise<void> {
  options.check?.();
  if (depth > budget.limits.maxTreeDepth) throw new SkillFilesystemLimitError('maxTreeDepth');
  budget.directories += 1;
  if (budget.directories > budget.limits.maxTreeDirectories) throw new SkillFilesystemLimitError('maxTreeDirectories');
  const currentStat = await lstat(current);
  if (currentStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in skill identity trees: ${current}`);
  if (!currentStat.isDirectory()) throw new Error(`Expected a directory while hashing a skill tree: ${current}`);
  const currentRealPath = await realpath(current);
  assertContainedPath(root, currentRealPath);
  if (notify) options.onDirectory?.(currentRealPath);
  const children: Dirent[] = [];
  const directory = await opendir(currentRealPath);
  try {
    for await (const child of directory) {
      budget.entries += 1;
      if (budget.entries > budget.limits.maxTreeEntries) throw new SkillFilesystemLimitError('maxTreeEntries');
      children.push(child);
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  children.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  for (const child of children) {
    options.check?.();
    const absolute = path.join(currentRealPath, child.name);
    const before = await lstat(absolute);
    if (before.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in skill identity trees: ${absolute}`);
    if (before.isDirectory()) {
      await collectTreeEntries(root, absolute, depth + 1, entries, budget, options, notify);
      continue;
    }
    if (!before.isFile()) throw new Error(`Unsupported filesystem entry in skill identity tree: ${absolute}`);
    budget.files += 1;
    if (budget.files > budget.limits.maxTreeFiles) throw new SkillFilesystemLimitError('maxTreeFiles');
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > budget.limits.maxFileBytes) {
      throw new SkillFilesystemLimitError('maxFileBytes');
    }
    budget.totalBytes += before.size;
    if (budget.totalBytes > budget.limits.maxTreeBytes) throw new SkillFilesystemLimitError('maxTreeBytes');
    assertContainedPath(root, await realpath(absolute));
    const relativePath = normalizeRelativeSkillPath(path.relative(root, absolute));
    entries.push({
      absolutePath: absolute,
      path: relativePath,
      bytes: before.size,
      mode: before.mode & 0o777,
      snapshot: before
    });
  }
}

async function streamStableFile(
  entry: CollectedTreeEntry,
  revisionHash: ReturnType<typeof createHash>,
  options: SkillTreeHashOptions
): Promise<string> {
  const fileHash = createHash('sha256');
  const handle = await open(entry.absolutePath, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileSnapshot(entry.snapshot, opened)) throw new Error(`Skill tree changed while contentRevision was being computed: ${entry.absolutePath}`);
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, entry.bytes)));
    let offset = 0;
    while (offset < entry.bytes) {
      options.check?.();
      const length = Math.min(buffer.length, entry.bytes - offset);
      const result = await handle.read(buffer, 0, length, offset);
      if (result.bytesRead <= 0) throw new Error(`Skill tree changed while contentRevision was being computed: ${entry.absolutePath}`);
      const chunk = buffer.subarray(0, result.bytesRead);
      revisionHash.update(chunk);
      fileHash.update(chunk);
      offset += result.bytesRead;
    }
    const overflow = Buffer.allocUnsafe(1);
    if ((await handle.read(overflow, 0, 1, entry.bytes)).bytesRead !== 0) throw new Error(`Skill tree changed while contentRevision was being computed: ${entry.absolutePath}`);
    const afterHandle = await handle.stat();
    const afterPath = await lstat(entry.absolutePath);
    if (!sameFileSnapshot(entry.snapshot, afterHandle) || !sameFileSnapshot(entry.snapshot, afterPath)) {
      throw new Error(`Skill tree changed while contentRevision was being computed: ${entry.absolutePath}`);
    }
    return `sha256:${fileHash.digest('hex')}`;
  } finally {
    await handle.close();
  }
}

function sameTreeSnapshot(left: CollectedTreeEntry[], right: CollectedTreeEntry[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const candidate = right[index];
    return candidate?.path === entry.path && candidate.bytes === entry.bytes && candidate.mode === entry.mode
      && sameFileSnapshot(entry.snapshot, candidate.snapshot);
  });
}

function sameFileSnapshot(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function updateLengthPrefixed(hash: ReturnType<typeof createHash>, value: Buffer): void {
  updateLengthPrefix(hash, value.length);
  hash.update(value);
}

function updateLengthPrefix(hash: ReturnType<typeof createHash>, value: number): void {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(value));
  hash.update(length);
}

function assertContainedPath(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Skill identity tree entry escapes its root: ${candidate}`);
  }
}

function collectGroupIssues(
  records: IdentityRecordLike[],
  keyFor: (record: IdentityRecordLike) => string,
  code: IdentityIssue['code'],
  message: string,
  isCollision: (group: IdentityRecordLike[]) => boolean,
  issues: IdentityIssue[]
): void {
  const groups = new Map<string, IdentityRecordLike[]>();
  for (const record of records) groups.set(keyFor(record), [...(groups.get(keyFor(record)) ?? []), record]);
  for (const group of groups.values()) {
    if (group.length < 2 || !isCollision(group)) continue;
    issues.push({
      code,
      message,
      skillIds: uniqueSorted(group.map((record) => record.skillId)),
      rootIds: uniqueSorted(group.map((record) => record.rootId)),
      relativePaths: uniqueSorted(group.map((record) => record.relativePath))
    });
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}
