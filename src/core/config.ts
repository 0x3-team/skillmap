import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import { parse, stringify } from 'yaml';
import { writeJson, writeText } from './fs.js';
import { isOpaqueUuid, SKILL_IDENTITY_VERSION } from './identity.js';
import type { ApprovedRootRecord, WorkspaceIdentityRegistry } from '../schemas/types.js';

export interface SkillMapConfig {
  version: 1;
  profile: string;
  roots: string[];
  dashboardSnapshotPath?: string;
}

export const DEFAULT_PROFILE = 'personal-v1';

export function configPath(cwd: string): string {
  return path.join(skillmapDir(cwd), 'config.yml');
}

export function workspaceIdentityPath(cwd: string): string {
  return path.join(skillmapDir(cwd), 'identity.json');
}

export async function readSkillMapConfig(cwd: string): Promise<SkillMapConfig | undefined> {
  const file = configPath(cwd);
  if (!(await fileExists(file))) return undefined;
  return parseConfigYaml(await readFile(file, 'utf8'));
}

export async function writeSkillMapConfig(cwd: string, config: SkillMapConfig): Promise<void> {
  await writeText(configPath(cwd), renderConfigYaml(config));
}

export async function readWorkspaceIdentity(cwd: string): Promise<WorkspaceIdentityRegistry | undefined> {
  const file = workspaceIdentityPath(cwd);
  if (!(await fileExists(file))) return undefined;
  const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
  return validateWorkspaceIdentity(parsed);
}

export async function ensureWorkspaceIdentity(
  cwd: string,
  rootPaths: string[]
): Promise<{ registry: WorkspaceIdentityRegistry; approvedRoots: ApprovedRootRecord[] }> {
  return resolveWorkspaceIdentity(cwd, rootPaths, true);
}

export async function resolveWorkspaceIdentity(
  cwd: string,
  rootPaths: string[],
  persistNewRoots: boolean
): Promise<{ registry: WorkspaceIdentityRegistry; approvedRoots: ApprovedRootRecord[] }> {
  const existing = await readWorkspaceIdentity(cwd);
  const now = new Date().toISOString();
  const registry: WorkspaceIdentityRegistry = existing ? JSON.parse(JSON.stringify(existing)) as WorkspaceIdentityRegistry : {
    version: 1,
    identityVersion: SKILL_IDENTITY_VERSION,
    workspaceId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    roots: []
  };
  let changed = !existing;
  const approvedRoots: ApprovedRootRecord[] = [];
  const requestedRealPaths = new Set<string>();

  for (const candidate of rootPaths) {
    const configuredPath = path.resolve(cwd, candidate.replace(/^~(?=$|\/)/, os.homedir()));
    const configuredStat = await lstat(configuredPath);
    if (configuredStat.isSymbolicLink()) throw new Error(`Approved skill roots may not be symbolic links: ${configuredPath}`);
    if (!configuredStat.isDirectory()) throw new Error(`Approved skill root is not a directory: ${configuredPath}`);
    const resolved = await realpath(configuredPath);
    if (requestedRealPaths.has(resolved)) continue;
    requestedRealPaths.add(resolved);

    let record = registry.roots.find((item) => item.realPath === resolved);
    if (!record) {
      record = { rootId: randomUUID(), configuredPath, realPath: resolved, approvedAt: now };
      registry.roots.push(record);
      changed = true;
    }
    approvedRoots.push(record);
  }

  validateWorkspaceIdentity(registry);
  if (changed && persistNewRoots) {
    registry.updatedAt = now;
    registry.roots.sort((left, right) => left.rootId.localeCompare(right.rootId));
    await writeJson(workspaceIdentityPath(cwd), registry);
  }
  return { registry, approvedRoots };
}

export function renderConfigYaml(config: SkillMapConfig): string {
  return stringify({
    version: 1,
    profile: config.profile || DEFAULT_PROFILE,
    roots: config.roots,
    ...(config.dashboardSnapshotPath ? { dashboardSnapshotPath: config.dashboardSnapshotPath } : {})
  }, { lineWidth: 0 });
}

function parseConfigYaml(text: string): SkillMapConfig {
  const parsed = parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { version: 1, profile: DEFAULT_PROFILE, roots: [] };
  }
  const record = parsed as Record<string, unknown>;
  const roots = Array.isArray(record.roots)
    ? record.roots.filter((root): root is string => typeof root === 'string')
    : [];
  return {
    version: 1,
    profile: typeof record.profile === 'string' && record.profile.trim() ? record.profile : DEFAULT_PROFILE,
    roots,
    dashboardSnapshotPath: typeof record.dashboardSnapshotPath === 'string' ? record.dashboardSnapshotPath : undefined
  };
}

function validateWorkspaceIdentity(value: unknown): WorkspaceIdentityRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace identity registry must be an object.');
  const registry = value as WorkspaceIdentityRegistry;
  if (registry.version !== 1 || registry.identityVersion !== SKILL_IDENTITY_VERSION) throw new Error('Unsupported workspace identity registry version.');
  if (!isOpaqueUuid(registry.workspaceId)) throw new Error('Workspace identity registry has an invalid workspaceId.');
  if (!Array.isArray(registry.roots)) throw new Error('Workspace identity registry roots must be an array.');
  const rootIds = new Map<string, string>();
  const realPaths = new Map<string, string>();
  for (const root of registry.roots) {
    if (!root || typeof root !== 'object') throw new Error('Workspace identity registry contains an invalid root record.');
    if (!isOpaqueUuid(root.rootId)) throw new Error(`Workspace identity registry has an invalid rootId: ${root.rootId}`);
    if (!path.isAbsolute(root.configuredPath) || !path.isAbsolute(root.realPath)) throw new Error(`Workspace identity root paths must be absolute for ${root.rootId}.`);
    const knownPath = rootIds.get(root.rootId);
    if (knownPath && knownPath !== root.realPath) throw new Error(`rootId collision: ${root.rootId} maps to multiple real paths.`);
    const knownId = realPaths.get(root.realPath);
    if (knownId && knownId !== root.rootId) throw new Error(`Approved root collision: ${root.realPath} maps to multiple rootIds.`);
    rootIds.set(root.rootId, root.realPath);
    realPaths.set(root.realPath, root.rootId);
  }
  return registry;
}

function skillmapDir(cwd: string): string {
  return path.join(cwd, '.skillmap');
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
