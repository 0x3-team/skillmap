import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SKILL_FILESYSTEM_LIMITS } from './skill-tree-limits.js';

const LIMITS = DEFAULT_SKILL_FILESYSTEM_LIMITS;

interface TreeRecord {
  path: string;
  kind: 'directory' | 'file';
  mode: number;
  size?: number;
  digest?: string;
}

function sameIdentity(
  before: Awaited<ReturnType<typeof lstat>>,
  after: Awaited<ReturnType<typeof lstat>>
): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.mode === after.mode
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * Computes a bounded, no-symlink digest of one candidate tree. The digest is
 * sampled during preflight and again at the final move boundary.
 */
export async function computeQuarantineTreeDigest(candidatePath: string): Promise<string> {
  const records: TreeRecord[] = [];
  let fileCount = 0;
  let directoryCount = 0;
  let entryCount = 0;
  let totalBytes = 0;

  const walk = async (absolutePath: string, relativePath: string, depth: number, isRoot = false): Promise<void> => {
    if (depth > LIMITS.maxTreeDepth) throw new Error('CANDIDATE_TREE_LIMIT_EXCEEDED');
    if (!isRoot) {
      entryCount += 1;
      if (entryCount > LIMITS.maxTreeEntries) throw new Error('CANDIDATE_TREE_LIMIT_EXCEEDED');
    }
    const before = await lstat(absolutePath);
    if (before.isSymbolicLink()) throw new Error('CANDIDATE_TREE_UNSAFE');

    if (before.isFile()) {
      fileCount += 1;
      totalBytes += before.size;
      if (fileCount > LIMITS.maxTreeFiles
        || before.size > LIMITS.maxFileBytes
        || totalBytes > LIMITS.maxTreeBytes) {
        throw new Error('CANDIDATE_TREE_LIMIT_EXCEEDED');
      }
      const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || !sameIdentity(before, opened)) throw new Error('CANDIDATE_STALE');
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (bytes.byteLength !== opened.size || !sameIdentity(opened, after)) throw new Error('CANDIDATE_STALE');
        records.push({
          path: relativePath,
          kind: 'file',
          mode: opened.mode,
          size: bytes.byteLength,
          digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`
        });
      } finally {
        await handle.close();
      }
      return;
    }

    if (!before.isDirectory()) throw new Error('CANDIDATE_TREE_UNSAFE');
    if (!isRoot) {
      directoryCount += 1;
      if (directoryCount > LIMITS.maxTreeDirectories) throw new Error('CANDIDATE_TREE_LIMIT_EXCEEDED');
    }
    records.push({ path: relativePath, kind: 'directory', mode: before.mode });
    const entries = await readdir(absolutePath, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      if (entry.name !== entry.name.normalize('NFC') || entry.name === '.' || entry.name === '..'
        || /[\/\\\u0000-\u001f\u007f]/u.test(entry.name)) {
        throw new Error('CANDIDATE_TREE_UNSAFE');
      }
      await walk(
        path.join(absolutePath, entry.name),
        relativePath ? `${relativePath}/${entry.name}` : entry.name,
        depth + 1
      );
    }
    const after = await lstat(absolutePath);
    if (!sameIdentity(before, after)) throw new Error('CANDIDATE_STALE');
  };

  await walk(candidatePath, '', 0, true);
  return `sha256:${createHash('sha256')
    .update(JSON.stringify({ kind: 'skillmap.quarantine-tree.v1', records }), 'utf8')
    .digest('hex')}`;
}
