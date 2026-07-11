import { watch, type Dirent, type FSWatcher } from 'node:fs';
import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../core/canonical-payload.js';
import { hashText, readJson } from '../core/fs.js';
import { assertQualifiedInventory, deriveSkillId, hashSkillTree, isOpaqueUuid, normalizeRelativeSkillPath } from '../core/identity.js';
import { createSkillWorkspaceByteBudget, DEFAULT_SKILL_FILESYSTEM_LIMITS, SkillFilesystemLimitError } from '../core/skill-tree-limits.js';
import { WorkspaceStateError } from '../core/workspace-state/index.js';
import { approvedArtifactPath, openApprovedWorkspaceRead } from '../services/workspace-read-model.js';
import type { ApprovedRootRecord, Inventory, RevisionRef, WorkspaceIdentityRegistry } from '../schemas/types.js';

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_VERIFICATION_INTERVAL_MS = 30_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 15_000;

export type FilesystemFreshnessReason =
  | 'verification-pending'
  | 'workspace-uninitialized'
  | 'watch-event'
  | 'manifest-mismatch'
  | 'watcher-unavailable'
  | 'approved-state-unavailable'
  | 'baseline-invalid'
  | 'root-unavailable'
  | 'root-identity-changed'
  | 'unsafe-entry'
  | 'verification-limit'
  | 'verification-timeout'
  | 'verification-failed';

export interface FilesystemFreshnessSnapshot {
  state: 'inactive' | 'clean' | 'dirty' | 'unavailable';
  filesystemDirty: boolean;
  reasonCode: FilesystemFreshnessReason | null;
  observedAt: string | null;
  lastVerifiedAt: string | null;
  observedDigest: string | null;
  expectedDigest: string | null;
  rootIds: string[];
  suggestedJobType: 'scan' | null;
}

export interface ApprovedFilesystemBaseline {
  revision: RevisionRef;
  roots: ApprovedRootRecord[];
  skills: Array<Pick<Inventory['skills'][number], 'rootId' | 'relativePath' | 'skillId' | 'contentRevision'>>;
}

export interface FilesystemVerificationLimits {
  timeoutMs: number;
  maxRoots: number;
  maxDirectories: number;
  maxEntries: number;
  maxSkills: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxWatchers: number;
  maxTreeDepth: number;
  maxTreeDirectories: number;
  maxTreeEntries: number;
  maxTreeFiles: number;
  maxTreeBytes: number;
}

export interface ApprovedRootFreshnessMonitorOptions {
  debounceMs?: number;
  verificationIntervalMs?: number;
  limits?: Partial<FilesystemVerificationLimits>;
  loadBaseline?: () => Promise<ApprovedFilesystemBaseline | null>;
  now?: () => Date;
}

interface RootManifest {
  rootId: string;
  skills: Array<{ rootId: string; relativePath: string; skillId: string; contentRevision: string }>;
}

interface VerificationResult {
  expectedDigest: string;
  observedDigest: string;
  changedRootIds: string[];
  watchDirectories: Map<string, Set<string>>;
}

interface VerificationBudget {
  readonly deadline: number;
  readonly limits: FilesystemVerificationLimits;
  directories: number;
  entries: number;
  skills: number;
  totalBytes: number;
}

interface WatchedDirectory {
  watcher: FSWatcher;
  rootIds: Set<string>;
}

const DEFAULT_LIMITS: FilesystemVerificationLimits = {
  timeoutMs: DEFAULT_VERIFICATION_TIMEOUT_MS,
  maxRoots: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxRoots,
  maxDirectories: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxDiscoveryDirectories,
  maxEntries: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxDiscoveryEntries,
  maxSkills: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxSkills,
  maxFileBytes: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxFileBytes,
  maxTotalBytes: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxWorkspaceBytes,
  maxWatchers: 20_000,
  maxTreeDepth: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxTreeDepth,
  maxTreeDirectories: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxTreeDirectories,
  maxTreeEntries: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxTreeEntries,
  maxTreeFiles: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxTreeFiles,
  maxTreeBytes: DEFAULT_SKILL_FILESYSTEM_LIMITS.maxTreeBytes
};

/**
 * Process-local, read-only freshness observation for approved skill roots.
 * Watch events are hints; only a bounded full manifest verification can return
 * the monitor to clean. No method in this module writes to a skill root.
 */
export class ApprovedRootFreshnessMonitor {
  private readonly options: Required<Pick<ApprovedRootFreshnessMonitorOptions, 'debounceMs' | 'verificationIntervalMs' | 'now'>> & {
    limits: FilesystemVerificationLimits;
    loadBaseline: () => Promise<ApprovedFilesystemBaseline | null>;
  };
  private readonly watchers = new Map<string, WatchedDirectory>();
  private snapshotValue: FilesystemFreshnessSnapshot = {
    state: 'inactive',
    filesystemDirty: false,
    reasonCode: null,
    observedAt: null,
    lastVerifiedAt: null,
    observedDigest: null,
    expectedDigest: null,
    rootIds: [],
    suggestedJobType: null
  };
  private started = false;
  private closed = false;
  private debounceTimer: NodeJS.Timeout | undefined;
  private periodicTimer: NodeJS.Timeout | undefined;
  private verification: Promise<void> | undefined;
  private verificationRequested = false;

  constructor(cwd: string, options: ApprovedRootFreshnessMonitorOptions = {}) {
    this.options = {
      debounceMs: boundedInteger(options.debounceMs, DEFAULT_DEBOUNCE_MS, 5, 60_000, 'debounceMs'),
      verificationIntervalMs: boundedInteger(options.verificationIntervalMs, DEFAULT_VERIFICATION_INTERVAL_MS, 25, 24 * 60 * 60_000, 'verificationIntervalMs'),
      limits: validateLimits({ ...DEFAULT_LIMITS, ...(options.limits ?? {}) }),
      loadBaseline: options.loadBaseline ?? (() => loadApprovedFilesystemBaseline(cwd)),
      now: options.now ?? (() => new Date())
    };
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error('The filesystem freshness monitor is closed.');
    if (this.started) return this.verification;
    this.started = true;
    this.setSnapshot({
      state: 'dirty',
      filesystemDirty: true,
      reasonCode: 'verification-pending',
      observedAt: this.timestamp(),
      lastVerifiedAt: null,
      observedDigest: null,
      expectedDigest: null,
      rootIds: [],
      suggestedJobType: 'scan'
    });
    await this.verifyNow();
    this.schedulePeriodicVerification();
  }

  async verifyNow(): Promise<void> {
    if (this.closed || !this.started) return;
    if (this.verification) {
      this.verificationRequested = true;
      return this.verification;
    }
    this.verification = (async () => {
      do {
        this.verificationRequested = false;
        await this.runVerification();
      } while (this.verificationRequested && !this.closed);
    })().finally(() => {
      this.verification = undefined;
    });
    return this.verification;
  }

  requestVerification(): void {
    if (!this.started || this.closed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.verifyNow();
    }, this.options.debounceMs);
    this.debounceTimer.unref?.();
  }

  snapshot(): FilesystemFreshnessSnapshot {
    return { ...this.snapshotValue, rootIds: [...this.snapshotValue.rootIds] };
  }

  etagToken(): string {
    return hashText(canonicalJson(this.snapshotValue)).slice('sha256:'.length, 'sha256:'.length + 16);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.periodicTimer) clearTimeout(this.periodicTimer);
    this.debounceTimer = undefined;
    this.periodicTimer = undefined;
    this.closeWatchers();
    await this.verification;
  }

  private async runVerification(): Promise<void> {
    let baseline: ApprovedFilesystemBaseline | null;
    try {
      baseline = await this.options.loadBaseline();
    } catch (error) {
      this.markVerificationFailure(reasonForError(error), []);
      return;
    }
    if (this.closed) return;
    if (!baseline) {
      this.closeWatchers();
      this.setSnapshot({
        state: 'unavailable',
        filesystemDirty: false,
        reasonCode: 'workspace-uninitialized',
        observedAt: null,
        lastVerifiedAt: this.timestamp(),
        observedDigest: null,
        expectedDigest: null,
        rootIds: [],
        suggestedJobType: null
      });
      return;
    }

    try {
      const result = await verifyApprovedRootManifest(baseline, this.options.limits);
      if (this.closed) return;
      const watcherFailure = this.reconcileWatchers(result.watchDirectories);
      const now = this.timestamp();
      if (watcherFailure.length > 0) {
        this.setSnapshot({
          state: 'dirty',
          filesystemDirty: true,
          reasonCode: 'watcher-unavailable',
          observedAt: now,
          lastVerifiedAt: now,
          observedDigest: result.observedDigest,
          expectedDigest: result.expectedDigest,
          rootIds: watcherFailure,
          suggestedJobType: 'scan'
        });
      } else if (result.changedRootIds.length > 0) {
        this.setSnapshot({
          state: 'dirty',
          filesystemDirty: true,
          reasonCode: 'manifest-mismatch',
          observedAt: now,
          lastVerifiedAt: now,
          observedDigest: result.observedDigest,
          expectedDigest: result.expectedDigest,
          rootIds: result.changedRootIds,
          suggestedJobType: 'scan'
        });
      } else {
        this.setSnapshot({
          state: 'clean',
          filesystemDirty: false,
          reasonCode: null,
          observedAt: null,
          lastVerifiedAt: now,
          observedDigest: result.observedDigest,
          expectedDigest: result.expectedDigest,
          rootIds: [],
          suggestedJobType: null
        });
      }
    } catch (error) {
      const rootIds = error instanceof FreshnessVerificationError && error.rootId ? [error.rootId] : baseline.roots.map((root) => root.rootId);
      this.markVerificationFailure(reasonForError(error), rootIds);
    }
  }

  private reconcileWatchers(directories: Map<string, Set<string>>): string[] {
    if (directories.size > this.options.limits.maxWatchers) return sortedRootIds(directories.values());
    const failedRootIds = new Set<string>();
    for (const [directory, watched] of this.watchers) {
      const nextRootIds = directories.get(directory);
      if (nextRootIds && equalSets(watched.rootIds, nextRootIds)) continue;
      watched.watcher.close();
      this.watchers.delete(directory);
    }
    for (const [directory, rootIds] of directories) {
      if (this.watchers.has(directory)) continue;
      try {
        const watcher = watch(directory, { persistent: false }, () => this.observeWatchEvent(rootIds));
        watcher.on('error', () => this.observeWatcherError(directory, watcher, rootIds));
        this.watchers.set(directory, { watcher, rootIds: new Set(rootIds) });
      } catch {
        for (const rootId of rootIds) failedRootIds.add(rootId);
      }
    }
    return [...failedRootIds].sort();
  }

  private observeWatchEvent(rootIds: Set<string>): void {
    if (this.closed || !this.started) return;
    this.setSnapshot({
      ...this.snapshotValue,
      state: 'dirty',
      filesystemDirty: true,
      reasonCode: 'watch-event',
      observedAt: this.timestamp(),
      rootIds: [...rootIds].sort(),
      suggestedJobType: 'scan'
    });
    this.requestVerification();
  }

  private observeWatcherError(directory: string, failedWatcher: FSWatcher, rootIds: Set<string>): void {
    if (this.closed || !this.started) return;
    // A watcher that has emitted an error is no longer evidence that this
    // directory is being observed. Remove that exact instance so the next
    // bounded verification must recreate it. Keeping it in the map would let
    // reconcileWatchers treat a dead watcher as healthy and incorrectly return
    // the UI to a clean state until the periodic full scan.
    const watched = this.watchers.get(directory);
    if (watched?.watcher === failedWatcher) {
      failedWatcher.close();
      this.watchers.delete(directory);
    }
    this.setSnapshot({
      ...this.snapshotValue,
      state: 'dirty',
      filesystemDirty: true,
      reasonCode: 'watcher-unavailable',
      observedAt: this.timestamp(),
      rootIds: [...rootIds].sort(),
      suggestedJobType: 'scan'
    });
    this.requestVerification();
  }

  private markVerificationFailure(reasonCode: FilesystemFreshnessReason, rootIds: string[]): void {
    this.setSnapshot({
      ...this.snapshotValue,
      state: 'dirty',
      filesystemDirty: true,
      reasonCode,
      observedAt: this.timestamp(),
      lastVerifiedAt: this.timestamp(),
      rootIds: [...new Set(rootIds)].sort(),
      suggestedJobType: 'scan'
    });
  }

  private schedulePeriodicVerification(): void {
    if (this.closed || !this.started) return;
    if (this.periodicTimer) clearTimeout(this.periodicTimer);
    this.periodicTimer = setTimeout(() => {
      this.periodicTimer = undefined;
      void this.verifyNow().finally(() => this.schedulePeriodicVerification());
    }, this.options.verificationIntervalMs);
    this.periodicTimer.unref?.();
  }

  private closeWatchers(): void {
    for (const watched of this.watchers.values()) watched.watcher.close();
    this.watchers.clear();
  }

  private timestamp(): string {
    return this.options.now().toISOString();
  }

  private setSnapshot(snapshot: FilesystemFreshnessSnapshot): void {
    this.snapshotValue = { ...snapshot, rootIds: [...new Set(snapshot.rootIds)].sort() };
  }
}

export async function loadApprovedFilesystemBaseline(cwd: string): Promise<ApprovedFilesystemBaseline | null> {
  let approved;
  try {
    approved = await openApprovedWorkspaceRead(cwd, 'status');
  } catch (error) {
    if (error instanceof WorkspaceStateError && error.code === 'STATE_NOT_MIGRATED') return null;
    throw new FreshnessVerificationError('approved-state-unavailable');
  }

  const artifacts = new Set(approved.state.revision.manifest.artifacts.map((artifact) => artifact.path));
  if (artifacts.has('inventory.json')) {
    let inventory: Inventory;
    try {
      inventory = await readJson<Inventory>(approvedArtifactPath(approved, 'inventory.json'));
      assertQualifiedInventory(inventory, 'verify approved filesystem freshness');
    } catch {
      throw new FreshnessVerificationError('baseline-invalid');
    }
    if (inventory.workspaceId !== approved.servingRevision.workspaceId) throw new FreshnessVerificationError('baseline-invalid');
    return validatedBaseline({
      revision: approved.servingRevision,
      roots: inventory.rootRecords,
      skills: inventory.skills.map((skill) => ({
        rootId: skill.rootId,
        relativePath: skill.relativePath,
        skillId: skill.skillId,
        contentRevision: skill.contentRevision
      }))
    });
  }

  if (artifacts.has('identity.json')) {
    let identity: WorkspaceIdentityRegistry;
    try {
      identity = await readJson<WorkspaceIdentityRegistry>(approvedArtifactPath(approved, 'identity.json'));
    } catch {
      throw new FreshnessVerificationError('baseline-invalid');
    }
    if (identity.workspaceId !== approved.servingRevision.workspaceId) throw new FreshnessVerificationError('baseline-invalid');
    return validatedBaseline({ revision: approved.servingRevision, roots: identity.roots, skills: [] });
  }

  return validatedBaseline({ revision: approved.servingRevision, roots: [], skills: [] });
}

export async function verifyApprovedRootManifest(
  baselineInput: ApprovedFilesystemBaseline,
  limitsInput: Partial<FilesystemVerificationLimits> = {}
): Promise<VerificationResult> {
  const baseline = validatedBaseline(baselineInput);
  const limits = validateLimits({ ...DEFAULT_LIMITS, ...limitsInput });
  if (baseline.roots.length > limits.maxRoots) throw new FreshnessVerificationError('verification-limit');
  const budget: VerificationBudget = {
    deadline: Date.now() + limits.timeoutMs,
    limits,
    directories: 0,
    entries: 0,
    skills: 0,
    totalBytes: 0
  };
  const expectedRoots = manifestRootsFromBaseline(baseline);
  const observedRoots: RootManifest[] = [];
  const watchDirectories = new Map<string, Set<string>>();

  for (const root of [...baseline.roots].sort((left, right) => left.rootId.localeCompare(right.rootId))) {
    checkBudget(budget);
    try {
      observedRoots.push(await observeRoot(root, budget, watchDirectories));
    } catch (error) {
      if (error instanceof FreshnessVerificationError) {
        if (!error.rootId) error.rootId = root.rootId;
        throw error;
      }
      throw new FreshnessVerificationError('verification-failed', root.rootId);
    }
  }
  const expectedByRoot = new Map(expectedRoots.map((root) => [root.rootId, hashText(canonicalJson(root))]));
  const observedByRoot = new Map(observedRoots.map((root) => [root.rootId, hashText(canonicalJson(root))]));
  const changedRootIds = baseline.roots
    .map((root) => root.rootId)
    .filter((rootId) => expectedByRoot.get(rootId) !== observedByRoot.get(rootId))
    .sort();
  return {
    expectedDigest: hashText(canonicalJson({ version: 1, roots: expectedRoots })),
    observedDigest: hashText(canonicalJson({ version: 1, roots: observedRoots })),
    changedRootIds,
    watchDirectories
  };
}

async function observeRoot(root: ApprovedRootRecord, budget: VerificationBudget, watchDirectories: Map<string, Set<string>>): Promise<RootManifest> {
  const rootStat = await safeLstat(root.realPath, 'root-unavailable');
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new FreshnessVerificationError('unsafe-entry', root.rootId);
  const resolved = await safeRealpath(root.realPath, 'root-unavailable');
  if (!samePlatformPath(resolved, root.realPath)) throw new FreshnessVerificationError('root-identity-changed', root.rootId);
  addWatchDirectory(watchDirectories, resolved, root.rootId);

  const skillDirectories: string[] = [];
  for (const child of await readBoundedDirectory(resolved, budget)) {
    const childPath = path.join(resolved, child.name);
    if (child.isSymbolicLink()) throw new FreshnessVerificationError('unsafe-entry', root.rootId);
    if (!child.isDirectory()) continue;
    addWatchDirectory(watchDirectories, childPath, root.rootId);
    if (await hasRegularSkillFile(childPath, root.rootId)) {
      skillDirectories.push(childPath);
      continue;
    }
    if (!child.name.includes(':')) continue;
    for (const grandchild of await readBoundedDirectory(childPath, budget)) {
      const grandchildPath = path.join(childPath, grandchild.name);
      if (grandchild.isSymbolicLink()) throw new FreshnessVerificationError('unsafe-entry', root.rootId);
      if (!grandchild.isDirectory()) continue;
      addWatchDirectory(watchDirectories, grandchildPath, root.rootId);
      if (await hasRegularSkillFile(grandchildPath, root.rootId)) skillDirectories.push(grandchildPath);
    }
  }

  const skills: RootManifest['skills'] = [];
  skillDirectories.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  for (const skillDirectory of skillDirectories) {
    budget.skills += 1;
    checkBudget(budget);
    if (budget.skills > budget.limits.maxSkills) throw new FreshnessVerificationError('verification-limit', root.rootId);
    const relativePath = normalizeRelativeSkillPath(path.relative(root.realPath, skillDirectory));
    skills.push({
      rootId: root.rootId,
      relativePath,
      skillId: deriveSkillId(root.rootId, relativePath),
      contentRevision: await hashSkillTreeForFreshness(skillDirectory, root.rootId, budget, watchDirectories)
    });
  }
  skills.sort(compareManifestSkills);
  return { rootId: root.rootId, skills };
}

async function hashSkillTreeForFreshness(
  skillRoot: string,
  rootId: string,
  budget: VerificationBudget,
  watchDirectories: Map<string, Set<string>>
): Promise<string> {
  const workspaceBudget = createSkillWorkspaceByteBudget(budget.limits.maxTotalBytes, {
    maxDiscoveryDirectories: budget.limits.maxDirectories,
    maxDiscoveryEntries: budget.limits.maxEntries
  });
  workspaceBudget.totalBytes = budget.totalBytes;
  workspaceBudget.totalDirectories = budget.directories;
  workspaceBudget.totalEntries = budget.entries;
  try {
    const tree = await hashSkillTree(skillRoot, {
      limits: {
        maxTreeDepth: budget.limits.maxTreeDepth,
        maxTreeDirectories: budget.limits.maxTreeDirectories,
        maxTreeEntries: budget.limits.maxTreeEntries,
        maxTreeFiles: budget.limits.maxTreeFiles,
        maxFileBytes: budget.limits.maxFileBytes,
        maxTreeBytes: budget.limits.maxTreeBytes,
        maxWorkspaceBytes: budget.limits.maxTotalBytes,
        maxSkillMarkdownBytes: Math.min(DEFAULT_SKILL_FILESYSTEM_LIMITS.maxSkillMarkdownBytes, budget.limits.maxFileBytes)
      },
      workspaceBudget,
      check: () => checkBudget(budget),
      onDirectory: (directory) => addWatchDirectory(watchDirectories, directory, rootId)
    });
    budget.totalBytes = workspaceBudget.totalBytes;
    budget.directories = workspaceBudget.totalDirectories;
    budget.entries = workspaceBudget.totalEntries;
    return tree.contentRevision;
  } catch (error) {
    if (error instanceof SkillFilesystemLimitError) throw new FreshnessVerificationError('verification-limit', rootId);
    throw error;
  }
}

function manifestRootsFromBaseline(baseline: ApprovedFilesystemBaseline): RootManifest[] {
  const byRoot = new Map(baseline.roots.map((root) => [root.rootId, [] as RootManifest['skills']]));
  for (const skill of baseline.skills) {
    const values = byRoot.get(skill.rootId);
    if (!values) throw new FreshnessVerificationError('baseline-invalid', skill.rootId);
    const relativePath = normalizeRelativeSkillPath(skill.relativePath);
    if (skill.skillId !== deriveSkillId(skill.rootId, relativePath) || !/^sha256:[a-f0-9]{64}$/.test(skill.contentRevision)) {
      throw new FreshnessVerificationError('baseline-invalid', skill.rootId);
    }
    values.push({ rootId: skill.rootId, relativePath, skillId: skill.skillId, contentRevision: skill.contentRevision });
  }
  return baseline.roots
    .map((root) => ({ rootId: root.rootId, skills: byRoot.get(root.rootId)!.sort(compareManifestSkills) }))
    .sort((left, right) => left.rootId.localeCompare(right.rootId));
}

function validatedBaseline(input: ApprovedFilesystemBaseline): ApprovedFilesystemBaseline {
  if (!input || !input.revision || !Array.isArray(input.roots) || !Array.isArray(input.skills)) throw new FreshnessVerificationError('baseline-invalid');
  const rootIds = new Set<string>();
  const realPaths = new Set<string>();
  for (const root of input.roots) {
    if (!root || !isOpaqueUuid(root.rootId) || !path.isAbsolute(root.realPath) || !path.isAbsolute(root.configuredPath)) throw new FreshnessVerificationError('baseline-invalid');
    const platformPath = platformPathKey(root.realPath);
    if (rootIds.has(root.rootId) || realPaths.has(platformPath)) throw new FreshnessVerificationError('baseline-invalid', root.rootId);
    rootIds.add(root.rootId);
    realPaths.add(platformPath);
  }
  return {
    revision: input.revision,
    roots: input.roots.map((root) => ({ ...root })),
    skills: input.skills.map((skill) => ({ ...skill }))
  };
}

async function hasRegularSkillFile(directory: string, rootId: string): Promise<boolean> {
  const candidate = path.join(directory, 'SKILL.md');
  try {
    const candidateStat = await lstat(candidate);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) throw new FreshnessVerificationError('unsafe-entry', rootId);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function readBoundedDirectory(directory: string, budget: VerificationBudget) {
  budget.directories += 1;
  checkBudget(budget);
  if (budget.directories > budget.limits.maxDirectories) throw new FreshnessVerificationError('verification-limit');
  const children: Dirent[] = [];
  try {
    const handle = await opendir(directory);
    try {
      for await (const child of handle) {
        budget.entries += 1;
        checkBudget(budget);
        if (budget.entries > budget.limits.maxEntries) throw new FreshnessVerificationError('verification-limit');
        children.push(child);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof FreshnessVerificationError) throw error;
    throw new FreshnessVerificationError('root-unavailable');
  }
  return children.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
}

function validateLimits(limits: FilesystemVerificationLimits): FilesystemVerificationLimits {
  const validated = {
    timeoutMs: boundedInteger(limits.timeoutMs, DEFAULT_VERIFICATION_TIMEOUT_MS, 10, 5 * 60_000, 'timeoutMs'),
    maxRoots: boundedInteger(limits.maxRoots, DEFAULT_LIMITS.maxRoots, 1, 10_000, 'maxRoots'),
    maxDirectories: boundedInteger(limits.maxDirectories, DEFAULT_LIMITS.maxDirectories, 1, 1_000_000, 'maxDirectories'),
    maxEntries: boundedInteger(limits.maxEntries, DEFAULT_LIMITS.maxEntries, 1, 2_000_000, 'maxEntries'),
    maxSkills: boundedInteger(limits.maxSkills, DEFAULT_LIMITS.maxSkills, 1, 100_000, 'maxSkills'),
    maxFileBytes: boundedInteger(limits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes, 1, 512 * 1024 * 1024, 'maxFileBytes'),
    maxTotalBytes: boundedInteger(limits.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes, 1, 4 * 1024 * 1024 * 1024, 'maxTotalBytes'),
    maxWatchers: boundedInteger(limits.maxWatchers, DEFAULT_LIMITS.maxWatchers, 1, 100_000, 'maxWatchers'),
    maxTreeDepth: boundedInteger(limits.maxTreeDepth, DEFAULT_LIMITS.maxTreeDepth, 1, 1_024, 'maxTreeDepth'),
    maxTreeDirectories: boundedInteger(limits.maxTreeDirectories, DEFAULT_LIMITS.maxTreeDirectories, 1, 1_000_000, 'maxTreeDirectories'),
    maxTreeEntries: boundedInteger(limits.maxTreeEntries, DEFAULT_LIMITS.maxTreeEntries, 1, 2_000_000, 'maxTreeEntries'),
    maxTreeFiles: boundedInteger(limits.maxTreeFiles, DEFAULT_LIMITS.maxTreeFiles, 1, 1_000_000, 'maxTreeFiles'),
    maxTreeBytes: boundedInteger(limits.maxTreeBytes, DEFAULT_LIMITS.maxTreeBytes, 1, 4 * 1024 * 1024 * 1024, 'maxTreeBytes')
  };
  if (validated.maxFileBytes > validated.maxTreeBytes || validated.maxTreeBytes > validated.maxTotalBytes) {
    throw new Error('Filesystem byte limits must satisfy maxFileBytes <= maxTreeBytes <= maxTotalBytes.');
  }
  return validated;
}

function checkBudget(budget: VerificationBudget): void {
  if (Date.now() > budget.deadline) throw new FreshnessVerificationError('verification-timeout');
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return resolved;
}

function addWatchDirectory(directories: Map<string, Set<string>>, directory: string, rootId: string): void {
  const key = path.resolve(directory);
  const rootIds = directories.get(key) ?? new Set<string>();
  rootIds.add(rootId);
  directories.set(key, rootIds);
}

function sortedRootIds(groups: Iterable<Set<string>>): string[] {
  const values = new Set<string>();
  for (const group of groups) for (const rootId of group) values.add(rootId);
  return [...values].sort();
}

function equalSets(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function compareManifestSkills(
  left: RootManifest['skills'][number],
  right: RootManifest['skills'][number]
): number {
  return left.relativePath.localeCompare(right.relativePath) || left.skillId.localeCompare(right.skillId);
}

function samePlatformPath(left: string, right: string): boolean {
  return platformPathKey(left) === platformPathKey(right);
}

function platformPathKey(value: string): string {
  const resolved = path.resolve(value).normalize('NFC');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function safeLstat(candidate: string, reason: FilesystemFreshnessReason) {
  try {
    return await lstat(candidate);
  } catch {
    throw new FreshnessVerificationError(reason);
  }
}

async function safeRealpath(candidate: string, reason: FilesystemFreshnessReason): Promise<string> {
  try {
    return await realpath(candidate);
  } catch {
    throw new FreshnessVerificationError(reason);
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR'));
}

function reasonForError(error: unknown): FilesystemFreshnessReason {
  if (error instanceof FreshnessVerificationError) return error.reasonCode;
  return 'verification-failed';
}

class FreshnessVerificationError extends Error {
  constructor(readonly reasonCode: FilesystemFreshnessReason, public rootId?: string) {
    super(reasonCode);
    this.name = 'FreshnessVerificationError';
  }
}
