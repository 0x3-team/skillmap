import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { lstat, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  assertDirectory,
  atomicReplaceSynced,
  ensurePrivateDirectory,
  jsonBytes,
  pathExists,
  readRegularFile,
  syncDirectory,
  WORKSPACE_STATE_READ_LIMITS,
  writeExclusiveSynced
} from './durability.js';
import { errorCode, WorkspaceStateConflictError, WorkspaceStateError } from './errors.js';
import type { WorkspaceStatePaths } from './paths.js';
import { attachPayloadDigest, validateFence, validateLockOwner } from './schema.js';
import type { FenceState, LockOwner } from './types.js';

export interface HeldWorkspaceLock {
  owner: LockOwner;
  assertHeld(): Promise<void>;
  release(): Promise<void>;
}

export async function acquireWorkspaceLock(
  paths: WorkspaceStatePaths,
  operation: string,
  now: () => Date,
  leaseMs: number
): Promise<HeldWorkspaceLock> {
  await prepareStateDirectories(paths);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(paths.writerLock, { mode: 0o700 });
      await syncDirectory(paths.state);
      return initializeLock(paths, operation, now, leaseMs);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const reclaimed = await tryReclaimExpiredLock(paths, now, leaseMs);
      if (!reclaimed) throw new WorkspaceStateConflictError(await lockConflictMessage(paths));
    }
  }
  throw new WorkspaceStateConflictError('Workspace writer lock changed repeatedly while it was being acquired.');
}

async function initializeLock(
  paths: WorkspaceStatePaths,
  operation: string,
  now: () => Date,
  leaseMs: number
): Promise<HeldWorkspaceLock> {
  try {
    const token = await allocateFence(paths, now);
    const acquiredAt = now();
    const base = {
      kind: 'skillmap.workspace-writer-lock' as const,
      schemaVersion: 1 as const,
      ownerId: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      operation,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: new Date(acquiredAt.getTime() + leaseMs).toISOString(),
      fencingToken: token
    };
    const owner = attachPayloadDigest(base) as LockOwner;
    await writeExclusiveSynced(path.join(paths.writerLock, 'owner.json'), jsonBytes(owner));
    await syncDirectory(paths.writerLock);
    let released = false;
    const assertHeld = async () => {
      if (released) throw new WorkspaceStateError('STATE_LOCK_LOST', 'Workspace writer lock was already released.');
      const current = await readLockOwner(paths);
      if (current.ownerId !== owner.ownerId || current.fencingToken !== owner.fencingToken) {
        throw new WorkspaceStateError('STATE_LOCK_LOST', 'Workspace writer lock ownership or fencing token changed.');
      }
      const fence = await readFence(paths);
      if (fence.token !== owner.fencingToken) throw new WorkspaceStateError('STATE_LOCK_FENCED', 'A newer workspace writer fencing token exists.');
    };
    return {
      owner,
      assertHeld,
      async release() {
        if (released) return;
        await assertHeld();
        await rm(paths.writerLock, {
          recursive: true,
          force: false,
          maxRetries: process.platform === 'win32' ? 3 : 0,
          retryDelay: 10
        });
        await syncDirectory(paths.state);
        released = true;
      }
    };
  } catch (error) {
    await rm(paths.writerLock, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 3 : 0,
      retryDelay: 10
    }).catch(() => undefined);
    await syncDirectory(paths.state).catch(() => undefined);
    throw error;
  }
}

async function prepareStateDirectories(paths: WorkspaceStatePaths): Promise<void> {
  await assertDirectory(paths.cwd);
  if (!(await pathExists(paths.skillmap))) {
    try {
      await mkdir(paths.skillmap, { mode: 0o700 });
      await syncDirectory(paths.cwd);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
  }
  const skillmapStats = await lstat(paths.skillmap);
  if (skillmapStats.isSymbolicLink() || !skillmapStats.isDirectory()) {
    throw new WorkspaceStateError('STATE_UNSAFE_PATH', `.skillmap must be a non-symlink directory: ${paths.skillmap}`);
  }
  await ensurePrivateDirectory(paths.state);
  await ensurePrivateDirectory(paths.pointers);
  await ensurePrivateDirectory(paths.revisions);
  await ensurePrivateDirectory(paths.quarantine);
  await syncDirectory(paths.skillmap);
  await syncDirectory(paths.state);
}

async function allocateFence(paths: WorkspaceStatePaths, now: () => Date): Promise<number> {
  const previous = await pathExists(paths.fence) ? await readFence(paths) : undefined;
  const token = (previous?.token ?? 0) + 1;
  if (!Number.isSafeInteger(token) || token <= 0) throw new WorkspaceStateError('STATE_FENCE_EXHAUSTED', 'Workspace fencing token is not a safe positive integer.');
  const fence = attachPayloadDigest({
    kind: 'skillmap.workspace-fence' as const,
    schemaVersion: 1 as const,
    token,
    updatedAt: now().toISOString()
  }) as FenceState;
  await atomicReplaceSynced(paths.fence, jsonBytes(fence));
  return token;
}

async function readFence(paths: WorkspaceStatePaths): Promise<FenceState> {
  try {
    return validateFence(JSON.parse((await readRegularFile(paths.fence, {
      root: paths.skillmap,
      maxBytes: WORKSPACE_STATE_READ_LIMITS.fenceBytes,
      label: 'Workspace fence'
    })).toString('utf8')));
  } catch (error) {
    throw new WorkspaceStateError('STATE_FENCE_INVALID', `Workspace fence is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function readLockOwner(paths: WorkspaceStatePaths): Promise<LockOwner> {
  try {
    await assertDirectory(paths.writerLock);
    return validateLockOwner(JSON.parse((await readRegularFile(path.join(paths.writerLock, 'owner.json'), {
      root: paths.skillmap,
      maxBytes: WORKSPACE_STATE_READ_LIMITS.lockOwnerBytes,
      label: 'Workspace lock owner'
    })).toString('utf8')));
  } catch (error) {
    throw new WorkspaceStateError('STATE_LOCK_INVALID', `Workspace writer lock is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

async function tryReclaimExpiredLock(paths: WorkspaceStatePaths, now: () => Date, leaseMs: number): Promise<boolean> {
  let owner: LockOwner | undefined;
  try {
    owner = await readLockOwner(paths);
  } catch {
    const stats = await lstat(paths.writerLock).catch(() => undefined);
    if (!stats || now().getTime() - stats.mtimeMs <= leaseMs) return false;
  }
  if (owner) {
    if (Date.parse(owner.expiresAt) > now().getTime()) return false;
    if (owner.hostname !== hostname()) return false;
    if (pidIsAlive(owner.pid)) return false;
  }
  const locksQuarantine = path.join(paths.quarantine, 'locks');
  await ensurePrivateDirectory(locksQuarantine);
  const suffix = owner ? `${owner.fencingToken}-${owner.ownerId}` : `incomplete-${randomUUID()}`;
  const target = path.join(locksQuarantine, `${now().toISOString().replace(/[:.]/g, '-')}-${suffix}`);
  try {
    await rename(paths.writerLock, target);
    await syncDirectory(locksQuarantine);
    await syncDirectory(paths.state);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EEXIST') return true;
    throw error;
  }
}

async function lockConflictMessage(paths: WorkspaceStatePaths): Promise<string> {
  try {
    const owner = await readLockOwner(paths);
    return `Workspace is already being mutated by PID ${owner.pid} on ${owner.hostname} (${owner.operation}, fence ${owner.fencingToken}, expires ${owner.expiresAt}).`;
  } catch {
    return 'Workspace writer lock exists but has no valid owner record; wait for its lease or run explicit recovery.';
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== 'ESRCH';
  }
}
