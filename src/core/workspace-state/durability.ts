import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, open, opendir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { errorCode, WorkspaceStateError } from './errors.js';
import type { ArtifactRole } from './types.js';

export const WORKSPACE_STATE_READ_LIMITS = Object.freeze({
  markerBytes: 64 * 1024,
  pointerBytes: 64 * 1024,
  fenceBytes: 16 * 1024,
  lockOwnerBytes: 64 * 1024,
  manifestBytes: 8 * 1024 * 1024,
  projectionIndexBytes: 8 * 1024 * 1024,
  canonicalIntentArtifactBytes: 16 * 1024 * 1024,
  rawTruthArtifactBytes: 64 * 1024 * 1024,
  derivedArtifactBytes: 64 * 1024 * 1024,
  totalArtifactBytes: 128 * 1024 * 1024,
  artifactEntries: 10_000,
  traversalEntries: 50_000,
  traversalDepth: 32
});

export interface RegularFileReadOptions {
  root: string;
  maxBytes: number;
  label: string;
}

export interface RegularFileTraversalOptions {
  boundaryRoot: string;
  maxEntries: number;
  maxDepth: number;
}

interface PathSnapshot {
  path: string;
  stats: Stats;
}

interface ContainedFileSnapshot {
  rootRealPath: string;
  targetRealPath: string;
  chain: PathSnapshot[];
  file: Stats;
}

export function hashBytes(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

export async function ensurePrivateDirectory(target: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 });
  const stats = await lstat(target);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Workspace-state directory must be a real directory: ${target}`);
  }
  await chmod(target, 0o700);
}

export async function assertDirectory(target: string): Promise<void> {
  const stats = await lstat(target);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Expected a non-symlink directory: ${target}`);
  }
}

export async function assertRegularFile(target: string): Promise<void> {
  const stats = await lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Expected a non-symlink regular file: ${target}`);
  }
}

export async function readRegularFile(target: string, options: RegularFileReadOptions): Promise<Buffer> {
  assertReadLimit(options.maxBytes, options.label);
  const before = await captureContainedFile(options.root, target);
  if (!Number.isSafeInteger(before.file.size) || before.file.size < 0 || before.file.size > options.maxBytes) {
    throw new WorkspaceStateError(
      'STATE_READ_LIMIT_EXCEEDED',
      `${options.label} exceeds its ${options.maxBytes}-byte workspace-state read limit: ${target}`
    );
  }

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(target, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (errorCode(error) === 'ELOOP') {
      throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Refusing to follow a symbolic link while opening workspace state: ${target}`, { cause: error });
    }
    throw error;
  }

  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameSnapshot(before.file, opened)) {
      throw new WorkspaceStateError('STATE_READ_RACE', `Workspace state changed before its verified file handle was opened: ${target}`);
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (result.bytesRead <= 0) throw new WorkspaceStateError('STATE_READ_RACE', `Workspace state changed while it was being read: ${target}`);
      offset += result.bytesRead;
    }
    const overflow = Buffer.allocUnsafe(1);
    if ((await handle.read(overflow, 0, 1, bytes.length)).bytesRead !== 0) {
      throw new WorkspaceStateError('STATE_READ_RACE', `Workspace state grew while it was being read: ${target}`);
    }
    const afterHandle = await handle.stat();
    if (!sameSnapshot(opened, afterHandle)) {
      throw new WorkspaceStateError('STATE_READ_RACE', `Workspace-state file metadata changed while it was being read: ${target}`);
    }
    let after: ContainedFileSnapshot;
    try {
      after = await captureContainedFile(options.root, target);
    } catch (error) {
      throw new WorkspaceStateError('STATE_READ_RACE', `Workspace-state path changed while it was being read: ${target}`, { cause: error });
    }
    if (before.rootRealPath !== after.rootRealPath
      || before.targetRealPath !== after.targetRealPath
      || !samePathChain(before.chain, after.chain)
      || !sameSnapshot(opened, after.file)) {
      throw new WorkspaceStateError('STATE_READ_RACE', `Workspace-state path changed while it was being read: ${target}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export function workspaceStateArtifactReadLimit(role: ArtifactRole): number {
  if (role === 'canonical-intent') return WORKSPACE_STATE_READ_LIMITS.canonicalIntentArtifactBytes;
  if (role === 'raw-truth') return WORKSPACE_STATE_READ_LIMITS.rawTruthArtifactBytes;
  return WORKSPACE_STATE_READ_LIMITS.derivedArtifactBytes;
}

export async function writeExclusiveSynced(target: string, bytes: Uint8Array, mode = 0o600): Promise<void> {
  await ensurePrivateDirectory(path.dirname(target));
  const handle = await open(target, 'wx', mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(target, mode);
}

export async function atomicReplaceSynced(
  target: string,
  bytes: Uint8Array,
  mode = 0o600,
  beforeRename?: () => void | Promise<void>
): Promise<void> {
  await ensurePrivateDirectory(path.dirname(target));
  if (await pathExists(target)) await assertRegularFile(target);
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeExclusiveSynced(temp, bytes, mode);
    await beforeRename?.();
    await rename(temp, target);
    await syncDirectory(path.dirname(target));
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function syncDirectory(target: string): Promise<void> {
  await assertDirectory(target);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(target, 'r');
    await handle.sync();
  } catch (error) {
    throw new WorkspaceStateError(
      'STATE_DIRECTORY_FSYNC_UNAVAILABLE',
      `The filesystem cannot durably sync workspace-state directory ${target}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function syncDirectoriesBottomUp(directories: Iterable<string>): Promise<void> {
  const ordered = [...new Set(directories)].sort((left, right) => depth(right) - depth(left));
  for (const directory of ordered) await syncDirectory(directory);
}

export async function listRegularFiles(root: string, options: RegularFileTraversalOptions): Promise<string[]> {
  if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1
    || !Number.isSafeInteger(options.maxDepth) || options.maxDepth < 0) {
    throw new WorkspaceStateError('STATE_TRAVERSAL_LIMIT_INVALID', 'Workspace-state traversal limits must be safe positive integers.');
  }
  const boundaryBefore = await captureContainedDirectory(options.boundaryRoot, root);
  const rootRealPath = boundaryBefore.targetRealPath;
  const files: string[] = [];
  const budget = { entries: 0 };
  await walk(root, rootRealPath, root, 0, files, budget, options);
  const boundaryAfter = await captureContainedDirectory(options.boundaryRoot, root);
  if (boundaryBefore.rootRealPath !== boundaryAfter.rootRealPath
    || boundaryBefore.targetRealPath !== boundaryAfter.targetRealPath
    || !samePathChain(boundaryBefore.chain, boundaryAfter.chain)) {
    throw new WorkspaceStateError('STATE_READ_RACE', `Workspace-state traversal root changed while it was read: ${root}`);
  }
  return files.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

async function walk(
  root: string,
  rootRealPath: string,
  current: string,
  currentDepth: number,
  files: string[],
  budget: { entries: number },
  options: RegularFileTraversalOptions
): Promise<void> {
  if (currentDepth > options.maxDepth) {
    throw new WorkspaceStateError('STATE_TRAVERSAL_LIMIT_EXCEEDED', `Workspace-state traversal exceeds ${options.maxDepth} directory levels: ${current}`);
  }
  const before = await lstat(current);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Workspace-state traversal requires a non-symlink directory: ${current}`);
  }
  const currentRealPath = await realpath(current);
  assertRealpathContained(rootRealPath, currentRealPath, true);
  const entries = [];
  const directory = await opendir(current);
  try {
    for await (const entry of directory) {
      budget.entries += 1;
      if (budget.entries > options.maxEntries) {
        throw new WorkspaceStateError('STATE_TRAVERSAL_LIMIT_EXCEEDED', `Workspace-state traversal exceeds ${options.maxEntries} entries under ${root}.`);
      }
      entries.push(entry);
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Symbolic links are forbidden in workspace state: ${absolute}`);
    if (stats.isDirectory()) {
      await walk(root, rootRealPath, absolute, currentDepth + 1, files, budget, options);
      continue;
    }
    if (!stats.isFile()) throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Non-regular workspace-state entry is forbidden: ${absolute}`);
    const relative = path.relative(root, absolute);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      throw new WorkspaceStateError('STATE_PATH_TRAVERSAL', `Workspace-state entry escaped its root: ${absolute}`);
    }
    files.push(relative.split(path.sep).join('/'));
  }
  const after = await lstat(current);
  const afterRealPath = await realpath(current);
  if (!sameSnapshot(before, after) || currentRealPath !== afterRealPath) {
    throw new WorkspaceStateError('STATE_READ_RACE', `Workspace-state directory changed while it was traversed: ${current}`);
  }
}

async function captureContainedFile(root: string, target: string): Promise<ContainedFileSnapshot> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new WorkspaceStateError('STATE_PATH_TRAVERSAL', `Workspace-state file escapes its approved read root: ${target}`);
  }
  const chain: PathSnapshot[] = [];
  let current = resolvedRoot;
  const segments = relative.split(path.sep);
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) current = path.join(current, segments[index]);
    const stats = await lstat(current);
    const final = index === segments.length - 1;
    if (stats.isSymbolicLink() || (final ? !stats.isFile() : !stats.isDirectory())) {
      throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Workspace-state read path contains an unsafe ${final ? 'file' : 'directory'}: ${current}`);
    }
    chain.push({ path: current, stats });
  }
  const rootRealPath = await realpath(resolvedRoot);
  const targetRealPath = await realpath(resolvedTarget);
  assertRealpathContained(rootRealPath, targetRealPath, false);
  return { rootRealPath, targetRealPath, chain, file: chain.at(-1)!.stats };
}

async function captureContainedDirectory(root: string, target: string): Promise<Omit<ContainedFileSnapshot, 'file'>> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new WorkspaceStateError('STATE_PATH_TRAVERSAL', `Workspace-state directory escapes its approved traversal root: ${target}`);
  }
  const chain: PathSnapshot[] = [];
  let current = resolvedRoot;
  const segments = relative ? relative.split(path.sep) : [];
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) current = path.join(current, segments[index]);
    const stats = await lstat(current);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new WorkspaceStateError('STATE_UNSAFE_PATH', `Workspace-state traversal path contains an unsafe directory: ${current}`);
    }
    chain.push({ path: current, stats });
  }
  const rootRealPath = await realpath(resolvedRoot);
  const targetRealPath = await realpath(resolvedTarget);
  assertRealpathContained(rootRealPath, targetRealPath, true);
  return { rootRealPath, targetRealPath, chain };
}

function assertRealpathContained(root: string, candidate: string, allowRoot: boolean): void {
  const relative = path.relative(root, candidate);
  if ((!allowRoot && !relative) || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new WorkspaceStateError('STATE_PATH_TRAVERSAL', `Workspace-state path escapes its verified real root: ${candidate}`);
  }
}

function samePathChain(left: PathSnapshot[], right: PathSnapshot[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry.path === right[index]?.path && sameNodeIdentity(entry.stats, right[index]!.stats));
}

function sameNodeIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode;
}

function sameSnapshot(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function assertReadLimit(maxBytes: number, label: string): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new WorkspaceStateError('STATE_READ_LIMIT_INVALID', `${label} has an invalid workspace-state read limit.`);
  }
}

function depth(target: string): number {
  return path.resolve(target).split(path.sep).length;
}
