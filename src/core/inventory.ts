import { createHash } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { inferClientHints, inferScope } from './roots.js';
import { ensureWorkspaceIdentity, resolveWorkspaceIdentity } from './config.js';
import { buildQualifiedSkillIdentity, detectIdentityCollisions, SKILL_IDENTITY_VERSION } from './identity.js';
import { isSafeDisplayName, safeFallbackDisplayName } from './display-name.js';
import { isFixturePath } from '../contracts/fixture-path.js';
import {
  createSkillWorkspaceByteBudget,
  resolveSkillFilesystemLimits,
  SkillFilesystemLimitError,
  type SkillFilesystemLimits
} from './skill-tree-limits.js';
import type { Inventory, SkillRecord } from '../schemas/types.js';

interface DiscoveryBudget {
  directories: number;
  entries: number;
  skills: number;
  limits: SkillFilesystemLimits;
}

async function collectSkillFiles(root: string, budget: DiscoveryBudget): Promise<string[]> {
  const result: string[] = [];
  const children = await readDiscoveryDirectory(root, budget);
  for (const child of children) {
    const childPath = path.join(root, child.name);
    const childStat = await lstat(childPath);
    if (childStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed while scanning approved roots: ${childPath}`);
    if (!childStat.isDirectory()) continue;
    const candidate = await skillFileInDirectory(childPath);
    if (candidate) {
      budget.skills += 1;
      if (budget.skills > budget.limits.maxSkills) throw new SkillFilesystemLimitError('maxSkills');
      result.push(candidate);
      continue;
    }
    if (child.name.includes(':')) {
      for (const grand of await readDiscoveryDirectory(childPath, budget)) {
        const grandPath = path.join(childPath, grand.name);
        const grandStat = await lstat(grandPath);
        if (grandStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed while scanning approved roots: ${grandPath}`);
        if (!grandStat.isDirectory()) continue;
        const nestedSkill = await skillFileInDirectory(grandPath);
        if (nestedSkill) {
          budget.skills += 1;
          if (budget.skills > budget.limits.maxSkills) throw new SkillFilesystemLimitError('maxSkills');
          result.push(nestedSkill);
        }
      }
    }
  }
  return result.sort();
}

async function readDiscoveryDirectory(directoryPath: string, budget: DiscoveryBudget): Promise<Dirent[]> {
  budget.directories += 1;
  if (budget.directories > budget.limits.maxDiscoveryDirectories) throw new SkillFilesystemLimitError('maxDiscoveryDirectories');
  const values: Dirent[] = [];
  const directory = await opendir(directoryPath);
  try {
    for await (const entry of directory) {
      budget.entries += 1;
      if (budget.entries > budget.limits.maxDiscoveryEntries) throw new SkillFilesystemLimitError('maxDiscoveryEntries');
      values.push(entry);
    }
  } finally {
    await directory.close().catch(() => undefined);
  }
  return values.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
}

async function skillFileInDirectory(dir: string): Promise<string | undefined> {
  const candidate = path.join(dir, 'SKILL.md');
  try {
    const candidateStat = await lstat(candidate);
    if (candidateStat.isSymbolicLink()) throw new Error(`SKILL.md may not be a symbolic link: ${candidate}`);
    if (!candidateStat.isFile()) throw new Error(`SKILL.md is not a regular file: ${candidate}`);
    return candidate;
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function listDirectoryNamesBounded(dir: string, maxEntries: number): Promise<string[]> {
  try {
    const values: string[] = [];
    const directory = await opendir(dir);
    try {
      for await (const entry of directory) {
        if (values.length >= maxEntries) throw new SkillFilesystemLimitError('maxTreeEntries');
        const candidate = path.join(dir, entry.name);
        const stats = await lstat(candidate);
        if (stats.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in skill identity trees: ${candidate}`);
        values.push(entry.name);
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
    return values.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

async function countDirectory(dir: string, maxEntries: number): Promise<number> {
  return (await listDirectoryNamesBounded(dir, maxEntries)).length;
}

async function collectScripts(skillDir: string, maxEntries: number): Promise<string[]> {
  const scriptsDir = path.join(skillDir, 'scripts');
  return (await listDirectoryNamesBounded(scriptsDir, maxEntries)).map((item) => path.join(scriptsDir, item));
}

export async function buildInventory(
  cwd: string,
  roots: string[],
  warnings: string[],
  options: { persistIdentity?: boolean; logicalCwd?: string; limits?: Partial<SkillFilesystemLimits> } = {}
): Promise<Inventory> {
  const logicalCwd = path.resolve(options.logicalCwd ?? cwd);
  const limits = resolveSkillFilesystemLimits(options.limits);
  if (roots.length > limits.maxRoots) throw new SkillFilesystemLimitError('maxRoots');
  const skills: SkillRecord[] = [];
  const workspaceIdentity = options.persistIdentity === false
    ? await resolveWorkspaceIdentity(cwd, roots, false)
    : await ensureWorkspaceIdentity(cwd, roots);
  if (workspaceIdentity.approvedRoots.length > limits.maxRoots) throw new SkillFilesystemLimitError('maxRoots');
  const discoveryBudget: DiscoveryBudget = { directories: 0, entries: 0, skills: 0, limits };
  const workspaceBudget = createSkillWorkspaceByteBudget(limits.maxWorkspaceBytes, limits);
  for (const rootRecord of workspaceIdentity.approvedRoots) {
    for (const discoveredSkillPath of await collectSkillFiles(rootRecord.realPath, discoveryBudget)) {
      const skillDir = path.dirname(discoveredSkillPath);
      const identity = await buildQualifiedSkillIdentity(rootRecord, skillDir, { limits, workspaceBudget });
      const skillPath = path.join(identity.realPath, 'SKILL.md');
      const content = await readStableTextFile(skillPath, limits.maxSkillMarkdownBytes);
      const parsed = parseFrontmatter(content);
      const fallbackName = path.basename(identity.realPath);
      const requestedName = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : '';
      const name = isSafeDisplayName(requestedName) ? requestedName : safeFallbackDisplayName(fallbackName);
      const description = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';
      const st = await lstat(skillPath);
      const scripts = await collectScripts(identity.realPath, limits.maxTreeEntries);
      const hash = createHash('sha256').update(content).digest('hex');
      const skillMarkdownEntry = identity.treeEntries.find((entry) => entry.path === 'SKILL.md');
      if (skillMarkdownEntry?.digest !== `sha256:${hash}`) throw new Error(`SKILL.md changed during inventory scan: ${skillPath}`);
      const skillIsFixture = isFixturePath(identity.realPath);
      skills.push({
        id: identity.skillId,
        skillId: identity.skillId,
        identityVersion: identity.identityVersion,
        rootId: identity.rootId,
        relativePath: identity.relativePath,
        contentRevision: identity.contentRevision,
        name,
        description,
        path: skillPath,
        root: rootRecord.realPath,
        scope: skillIsFixture ? 'fixture' : inferScope(rootRecord.realPath, logicalCwd),
        clientHints: skillIsFixture
          ? [...new Set([...inferClientHints(rootRecord.realPath), 'fixture'])]
          : inferClientHints(rootRecord.realPath),
        source: 'filesystem',
        frontmatterValid: parsed.valid,
        frontmatterErrors: parsed.errors,
        implicitAllowed: parsed.data['disable-model-invocation'] !== true,
        hasScripts: scripts.length > 0,
        scriptPaths: scripts,
        referenceCount: await countDirectory(path.join(identity.realPath, 'references'), limits.maxTreeEntries),
        assetCount: await countDirectory(path.join(identity.realPath, 'assets'), limits.maxTreeEntries),
        bodyBytes: Buffer.byteLength(parsed.body, 'utf8'),
        descriptionBytes: Buffer.byteLength(description, 'utf8'),
        mtime: st.mtime.toISOString(),
        hash
      });
    }
  }
  const identityIssues = detectIdentityCollisions(skills);
  return {
    version: 2,
    identityVersion: SKILL_IDENTITY_VERSION,
    workspaceId: workspaceIdentity.registry.workspaceId,
    generatedAt: new Date().toISOString(),
    cwd: logicalCwd,
    roots: workspaceIdentity.approvedRoots.map((root) => root.realPath),
    rootRecords: workspaceIdentity.approvedRoots,
    skills: skills.sort((left, right) => left.name.localeCompare(right.name) || left.skillId.localeCompare(right.skillId)),
    identityIssues,
    warnings: [...warnings, ...identityIssues.map((issue) => issue.message)]
  };
}

async function readStableTextFile(file: string, maxBytes: number): Promise<string> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`SKILL.md is not a regular file: ${file}`);
  if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxBytes) throw new SkillFilesystemLimitError('maxSkillMarkdownBytes');
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!sameFileSnapshot(before, opened)) throw new Error(`SKILL.md changed during inventory scan: ${file}`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (result.bytesRead <= 0) throw new Error(`SKILL.md changed during inventory scan: ${file}`);
      offset += result.bytesRead;
    }
    const overflow = Buffer.allocUnsafe(1);
    if ((await handle.read(overflow, 0, 1, bytes.length)).bytesRead !== 0) throw new Error(`SKILL.md changed during inventory scan: ${file}`);
    const afterHandle = await handle.stat();
    const afterPath = await lstat(file);
    if (!sameFileSnapshot(before, afterHandle) || !sameFileSnapshot(before, afterPath)) throw new Error(`SKILL.md changed during inventory scan: ${file}`);
    return bytes.toString('utf8');
  } finally {
    await handle.close();
  }
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs;
}

export function summarizeInventory(inventory: Inventory): string {
  const scripts = inventory.skills.filter((skill) => skill.hasScripts).length;
  const invalid = inventory.skills.filter((skill) => !skill.frontmatterValid).length;
  const roots = inventory.roots.length;
  return `SkillMap inventory: ${inventory.skills.length} skills across ${roots} roots; ${scripts} with scripts; ${invalid} invalid frontmatter.`;
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && ((error as { code?: unknown }).code === 'ENOENT' || (error as { code?: unknown }).code === 'ENOTDIR'));
}
