import { constants, type Stats } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { hashText, readJson, writeJson } from '../core/fs.js';
import { computeSourceCoverage, fileExists, skillmapDir } from '../core/status.js';
import { computeSnapshotContentRevision, fetchGithubSkillTree, GithubSourceFetchError, type GithubSourceFetcherOptions, type GithubSourceSnapshot } from '../network/github-source-fetcher.js';
import { assertQualifiedInventory, deriveSkillId, hashSkillTree, normalizeRelativeSkillPath } from '../core/identity.js';
import { DEFAULT_SKILL_FILESYSTEM_LIMITS } from '../core/skill-tree-limits.js';
import type { Inventory } from '../schemas/types.js';

interface SourceRegistry {
  version: 1 | 2;
  records: SourceRecord[];
}

interface SourceRecord {
  skill: string;
  skillId?: string;
  contentRevision?: string;
  localPath: string;
  installedHash: string;
  source: {
    type: 'github';
    repo: string;
    path: string;
    ref: string;
    resolvedCommit?: string;
    installedManifestDigest?: string;
    rootTreeDigest?: string;
    upstreamContentRevision?: string;
  } | { type: 'local'; path: string } | { type: 'unknown' };
  installedAt: string;
  patchPolicy: 'ask' | 'never-overwrite';
  classificationReason?: string;
}

interface SourceStatusRecord extends SourceRecord {
  state: 'external-clean' | 'external-modified' | 'external-stale' | 'external-risky-update' | 'local-authored' | 'local-modified' | 'unknown';
  currentHash?: string;
  upstreamHash?: string;
  upstreamManifestDigest?: string;
  upstreamCommit?: string;
  upstreamContentRevision?: string;
  risk?: 'low' | 'high';
  error?: string;
}

interface SourceDecisionRegistry {
  version: 1 | 2;
  records: SourceDecisionRecord[];
}

interface SourceDecisionRecord {
  skill: string;
  skillId?: string;
  localPath?: string;
  contentRevision?: string;
  appliesToState: SourceStatusRecord['state'];
  decision: 'hold' | 'accepted' | 'ignore';
  reason: string;
  currentHash?: string;
  upstreamHash?: string;
  upstreamManifestDigest?: string;
  upstreamCommit?: string;
  upstreamContentRevision?: string;
  reviewedAt: string;
}

interface SourceDiff {
  additions: number;
  deletions: number;
  changedLines: number;
  truncated: boolean;
  lines: Array<{ kind: 'local' | 'upstream'; line: number; text: string }>;
}

interface SourceComparison {
  localText: string;
  upstreamText: string;
  upstreamHash: string;
  snapshot: GithubSourceSnapshot;
  diff: SourceDiff;
}

export interface SourcesCommandRuntime {
  signal?: AbortSignal;
  fetcherOptions?: Omit<GithubSourceFetcherOptions, 'signal' | 'cacheDir' | 'token'>;
  localSnapshot?: CapturedSourceLocalSnapshot;
}

export interface CapturedSourceLocalSnapshot {
  skillId: string;
  contentRevision: string;
  text: string;
  verify(): Promise<void>;
}

export class SourceBindingError extends Error {
  readonly code = 'SOURCE_BINDING_INVALID';

  constructor() {
    super('The source record is not bound to the exact approved inventory skill and root. Run scan and adopt the source again.');
    this.name = 'SourceBindingError';
  }
}

export class SourceLocalChangedError extends Error {
  readonly code = 'SOURCE_LOCAL_CHANGED';

  constructor() {
    super('The approved local skill tree changed during source inspection. Run scan and retry against the new revision.');
    this.name = 'SourceLocalChangedError';
  }
}

export function classifyExternalSourceState(input: {
  localModified: boolean;
  adoptedContentRevision?: string;
  adoptedUpstreamContentRevision?: string;
  installedManifestDigest?: string;
  currentManifestDigest: string;
  risky: boolean;
}): SourceStatusRecord['state'] {
  const adoptionRevisionVerified = Boolean(input.adoptedContentRevision && input.adoptedUpstreamContentRevision);
  const divergedAtAdoption = adoptionRevisionVerified
    && input.adoptedContentRevision !== input.adoptedUpstreamContentRevision;
  if (input.localModified || divergedAtAdoption) return 'external-modified';
  if (!input.installedManifestDigest) return adoptionRevisionVerified ? 'external-clean' : 'unknown';
  if (input.currentManifestDigest === input.installedManifestDigest) return 'external-clean';
  return input.risky ? 'external-risky-update' : 'external-stale';
}

export async function sourcesCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>, runtime: SourcesCommandRuntime = {}): Promise<unknown> {
  const action = positionals[0] ?? 'list';
  if (action === 'list') return listSources(cwd);
  if (action === 'adopt') return adoptSource(cwd, positionals[1], flags);
  if (action === 'check') return checkSources(cwd, runtime.signal, runtime.fetcherOptions);
  if (action === 'diff') return diffSource(cwd, positionals[1], runtime);
  if (action === 'update') return updateSource(cwd, positionals[1], flags, runtime);
  if (action === 'review') return reviewSource(cwd, positionals[1], flags);
  throw new Error('Supported sources commands: sources list, adopt, check, diff, update, review.');
}

async function listSources(cwd: string): Promise<unknown> {
  const registry = await readRegistry(cwd);
  return { records: registry.records, summary: `SkillMap sources: ${registry.records.length} tracked source record(s).` };
}

async function adoptSource(cwd: string, skillName: string | undefined, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const selector = flagString(flags, 'skill-id') ?? skillName;
  if (!selector) throw new Error('sources adopt requires a skill name or --skill-id.');
  const repo = flagString(flags, 'repo');
  const sourcePath = flagString(flags, 'path');
  const ref = flagString(flags, 'ref') ?? 'main';
  const local = hasFlag(flags, 'local');
  const reason = flagString(flags, 'reason');
  if (local && (repo || sourcePath)) throw new Error('sources adopt --local cannot be combined with --repo or --path.');
  if (local && !reason) throw new Error('sources adopt --local requires --reason TEXT for the classification receipt.');
  if (!local && (!repo || !sourcePath)) throw new Error('sources adopt requires --repo OWNER/REPO and --path PATH, or --local --reason TEXT.');
  const inventory = await readJson<Inventory>(path.join(skillmapDir(cwd), 'inventory.json'));
  const skill = resolveInventorySkill(inventory, selector);
  const registry = await readRegistry(cwd);
  let record: SourceRecord = local
    ? { skill: skill.name, skillId: skill.skillId, contentRevision: skill.contentRevision, localPath: skill.path, installedHash: `sha256:${skill.hash}`, source: { type: 'local', path: skill.path }, installedAt: new Date().toISOString(), patchPolicy: 'never-overwrite', classificationReason: reason }
    : { skill: skill.name, skillId: skill.skillId, contentRevision: skill.contentRevision, localPath: skill.path, installedHash: `sha256:${skill.hash}`, source: { type: 'github', repo: repo!, path: sourcePath!, ref }, installedAt: new Date().toISOString(), patchPolicy: 'ask' };
  if (!local && !hasFlag(flags, 'defer-resolution')) {
    const snapshot = await fetchSourceSnapshot(cwd, record.source as Extract<SourceRecord['source'], { type: 'github' }>, flags);
    const upstreamContentRevision = computeSnapshotContentRevision(snapshot);
    record = {
      ...record,
      source: {
        ...(record.source as Extract<SourceRecord['source'], { type: 'github' }>),
        resolvedCommit: snapshot.resolvedCommit,
        installedManifestDigest: snapshot.manifestDigest,
        rootTreeDigest: snapshot.rootTreeDigest,
        upstreamContentRevision
      }
    };
  }
  registry.version = 2;
  registry.records = [...registry.records.filter((item) => !sameSkillIdentity(item, skill.skillId, skill.path)), record]
    .sort((a, b) => a.skill.localeCompare(b.skill) || (a.skillId ?? a.localPath).localeCompare(b.skillId ?? b.localPath));
  await writeRegistry(cwd, registry);
  return { record, summary: local
    ? `Classified ${skill.name} as local-authored: ${reason}.`
    : `Adopted ${skill.name} as external GitHub skill from ${repo}:${sourcePath}@${ref}${record.source.type === 'github' && record.source.resolvedCommit ? ` (resolved ${record.source.resolvedCommit})` : ' (immutable resolution deferred; source remains unverified)'}.` };
}

async function checkSources(cwd: string, signal?: AbortSignal, fetcherOptions?: SourcesCommandRuntime['fetcherOptions']): Promise<unknown> {
  const registry = await readRegistry(cwd);
  const inventory = await readJson<Inventory>(path.join(skillmapDir(cwd), 'inventory.json'));
  const records: SourceStatusRecord[] = [];
  for (const record of registry.records) {
    if (signal?.aborted) throw new GithubSourceFetchError('REQUEST_ABORTED', 'GitHub source check was cancelled.', { retryable: true });
    const currentSkill = findInventorySkillForSource(inventory, record);
    if (!currentSkill) {
      records.push({ ...record, state: 'unknown', error: 'Qualified source identity is not present in the current inventory.' });
      continue;
    }
    let captured: CapturedSourceLocalSnapshot;
    try {
      captured = await captureBoundSourceLocalSnapshot(inventory, record, signal, { requireInventoryRevision: false });
    } catch (error) {
      if (isRequestAborted(error)) throw error;
      records.push({ ...record, state: 'unknown', error: 'Source binding no longer matches the approved inventory revision.' });
      continue;
    }
    const checked = await checkRecord(cwd, record, signal, undefined, fetcherOptions, captured.text);
    try {
      await captured.verify();
    } catch (error) {
      if (isRequestAborted(error)) throw error;
      records.push({ ...record, state: 'unknown', error: 'The approved local skill changed during source inspection.' });
      continue;
    }
    const revisionChanged = Boolean(record.contentRevision && record.contentRevision !== captured.contentRevision);
    records.push({
      ...checked,
      contentRevision: captured.contentRevision,
      state: revisionChanged
        ? record.source.type === 'local' ? 'local-modified' : 'external-modified'
        : checked.state
    });
  }
  const coverage = computeSourceCoverage(inventory, records);
  const report = {
    version: 2,
    generatedAt: new Date().toISOString(),
    ...coverage,
    records
  };
  await writeJson(path.join(skillmapDir(cwd), 'source-status.json'), report);
  const refreshedRecords = records.map(({ state: _state, currentHash: _currentHash, upstreamHash: _upstreamHash, upstreamManifestDigest: _upstreamManifestDigest, upstreamCommit: _upstreamCommit, upstreamContentRevision: _upstreamContentRevision, risk: _risk, error: _error, ...record }, index) => ({
    ...record,
    // Source checks may enrich immutable upstream coordinates, but the adopted
    // local content revision remains the comparison baseline until the operator
    // explicitly adopts a new source record.
    contentRevision: registry.records[index]?.contentRevision ?? record.contentRevision
  }));
  registry.version = 2;
  registry.records = refreshedRecords;
  await writeRegistry(cwd, registry);
  return { report, summary: `${renderSourceSummary(records)} Coverage: ${coverage.coverage} (${coverage.trackedSkills}/${coverage.inventorySkills} classified variants).` };
}

async function diffSource(cwd: string, skillName: string | undefined, runtime: SourcesCommandRuntime): Promise<unknown> {
  if (!skillName) throw new Error('sources diff requires a skill name or skillId.');
  const registry = await readRegistry(cwd);
  const record = resolveSourceRecord(registry.records, skillName);
  const captured = runtime.localSnapshot ?? await captureSourceDiffLocalSnapshot(cwd, record.skillId ?? skillName, runtime.signal);
  if (captured.skillId !== record.skillId) throw new SourceBindingError();
  const snapshot = record.source.type === 'github' ? await fetchSourceSnapshot(cwd, record.source, {}, runtime.signal, runtime.fetcherOptions) : undefined;
  const checked = await checkRecord(cwd, record, runtime.signal, snapshot, runtime.fetcherOptions, captured.text);
  if (record.contentRevision !== captured.contentRevision) {
    checked.contentRevision = captured.contentRevision;
    checked.state = record.source.type === 'local' ? 'local-modified' : 'external-modified';
  }
  const comparison = await compareWithUpstream(cwd, record, runtime.signal, snapshot, runtime.fetcherOptions, captured.text);
  await captured.verify();
  const diff = comparison?.diff;
  const diffSummary = diff ? ` +${diff.additions}/-${diff.deletions}, changed lines=${diff.changedLines}${diff.truncated ? ', truncated' : ''}` : '';
  return {
    record: checked,
    diff,
    summary: `${record.skill} (${record.skillId ?? 'legacy-unqualified'}): ${checked.state}${checked.error ? ` (${checked.error})` : ''}.${diffSummary}`
  };
}

async function updateSource(cwd: string, skillName: string | undefined, flags: Record<string, string | boolean | string[]>, runtime: SourcesCommandRuntime): Promise<unknown> {
  if (!skillName) throw new Error('sources update requires a skill name or skillId.');
  const registry = await readRegistry(cwd);
  const record = resolveSourceRecord(registry.records, skillName);
  const captured = runtime.localSnapshot ?? await captureSourceDiffLocalSnapshot(cwd, record.skillId ?? skillName, runtime.signal);
  if (captured.skillId !== record.skillId) throw new SourceBindingError();
  const requestedWrite = hasFlag(flags, 'confirm') && !hasFlag(flags, 'dry-run');
  if (requestedWrite) {
    throw new Error('sources update is preview-only in personal V1. Use sources diff and sources review; no source skill files were modified.');
  }
  const checked = await checkRecord(cwd, record, runtime.signal, undefined, runtime.fetcherOptions, captured.text);
  const dryRun = true;
  const comparison = await compareWithUpstream(cwd, record, runtime.signal, undefined, runtime.fetcherOptions, captured.text);
  await captured.verify();
  if (!comparison) {
    return {
      dryRun,
      record: checked,
      willWrite: false,
      summary: `SkillMap source update unavailable for ${skillName}: source is not a GitHub raw source or could not be compared.`
    };
  }
  return {
    dryRun,
    record: checked,
    diff: comparison.diff,
    willWrite: false,
    summary: `SkillMap source update dry-run for ${skillName}: ${checked.state}. No source skill files were modified.`
  };
}

async function reviewSource(cwd: string, skillName: string | undefined, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (!skillName) throw new Error('sources review requires a skill name or skillId.');
  const decision = flagString(flags, 'decision') ?? 'hold';
  if (!['hold', 'accepted', 'ignore'].includes(decision)) throw new Error('sources review --decision must be hold, accepted, or ignore.');
  const reason = flagString(flags, 'reason');
  if (!reason) throw new Error('sources review requires --reason TEXT.');
  const statusPath = path.join(skillmapDir(cwd), 'source-status.json');
  const status = await readJson<{ records: SourceStatusRecord[] }>(statusPath);
  const record = resolveSourceRecord(status.records, skillName);
  const registry = await readDecisionRegistry(cwd);
  const next: SourceDecisionRecord = {
    skill: record.skill,
    skillId: record.skillId,
    localPath: record.localPath,
    contentRevision: record.contentRevision,
    appliesToState: record.state,
    decision: decision as SourceDecisionRecord['decision'],
    reason,
    currentHash: record.currentHash,
    upstreamHash: record.upstreamHash,
    upstreamManifestDigest: record.upstreamManifestDigest,
    upstreamCommit: record.upstreamCommit,
    upstreamContentRevision: record.upstreamContentRevision,
    reviewedAt: new Date().toISOString()
  };
  registry.version = 2;
  registry.records = [...registry.records.filter((item) => !sameSkillIdentity(item, record.skillId, record.localPath)), next]
    .sort((a, b) => a.skill.localeCompare(b.skill) || (a.skillId ?? a.localPath ?? '').localeCompare(b.skillId ?? b.localPath ?? ''));
  await writeJson(path.join(skillmapDir(cwd), 'source-decisions.json'), registry);
  return { record: next, summary: `Reviewed ${skillName} source state ${record.state}: ${decision}.` };
}

async function readRegistry(cwd: string): Promise<SourceRegistry> {
  const file = path.join(skillmapDir(cwd), 'sources.json');
  if (!(await fileExists(file))) return { version: 1, records: [] };
  return readJson<SourceRegistry>(file);
}

async function writeRegistry(cwd: string, registry: SourceRegistry): Promise<void> {
  await writeJson(path.join(skillmapDir(cwd), 'sources.json'), registry);
}

async function readDecisionRegistry(cwd: string): Promise<SourceDecisionRegistry> {
  const file = path.join(skillmapDir(cwd), 'source-decisions.json');
  if (!(await fileExists(file))) return { version: 1, records: [] };
  return readJson<SourceDecisionRegistry>(file);
}

function resolveInventorySkill(inventory: Inventory, selector: string): Inventory['skills'][number] {
  const exact = inventory.skills.find((item) => item.skillId === selector);
  if (exact) return exact;
  const matches = inventory.skills.filter((item) => item.name === selector);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Skill name is ambiguous: ${selector}. Use --skill-id with one of: ${matches.map((item) => item.skillId).join(', ')}`);
  throw new Error(`Skill not found in inventory: ${selector}`);
}

function resolveSourceRecord<T extends SourceRecord>(records: T[], selector: string): T {
  const exact = records.find((item) => item.skillId === selector);
  if (exact) return exact;
  const matches = records.filter((item) => item.skill === selector);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Source record name is ambiguous: ${selector}. Use one of: ${matches.map((item) => item.skillId ?? item.localPath).join(', ')}`);
  throw new Error(`No source record for ${selector}.`);
}

function sameSkillIdentity(record: { skillId?: string; localPath?: string }, skillId: string | undefined, localPath: string): boolean {
  return skillId ? record.skillId === skillId || (!record.skillId && record.localPath === localPath) : record.localPath === localPath;
}

function findInventorySkillForSource(inventory: Inventory, record: SourceRecord): Inventory['skills'][number] | undefined {
  if (record.skillId) {
    const match = inventory.skills.find((skill) => skill.skillId === record.skillId);
    return match && match.name === record.skill && match.path === record.localPath ? match : undefined;
  }
  const pathMatch = inventory.skills.find((skill) => skill.path === record.localPath && skill.name === record.skill);
  if (pathMatch) return pathMatch;
  const nameMatches = inventory.skills.filter((skill) => skill.name === record.skill);
  return nameMatches.length === 1 ? nameMatches[0] : undefined;
}

async function checkRecord(
  cwd: string,
  record: SourceRecord,
  signal?: AbortSignal,
  resolvedSnapshot?: GithubSourceSnapshot,
  fetcherOptions?: SourcesCommandRuntime['fetcherOptions'],
  capturedLocalText?: string
): Promise<SourceStatusRecord> {
  try {
    if (record.source.type === 'unknown') return { ...record, state: 'unknown' };
    const localText = capturedLocalText ?? await readFile(record.localPath, 'utf8');
    const currentHash = hashText(localText);
    const localModified = currentHash !== record.installedHash;
    if (record.source.type === 'local') return { ...record, state: localModified ? 'local-modified' : 'local-authored', currentHash };
    const snapshot = resolvedSnapshot ?? await fetchSourceSnapshot(cwd, record.source, {}, signal, fetcherOptions);
    const skillFile = snapshot.files.find((file) => file.path === 'SKILL.md');
    if (!skillFile) throw new Error('Immutable GitHub source snapshot has no SKILL.md file.');
    const upstreamText = Buffer.from(skillFile.bytes).toString('utf8');
    const upstreamHash = hashText(upstreamText);
    const upstreamContentRevision = computeSnapshotContentRevision(snapshot);
    const risky = hasRiskySourceChange(localText, upstreamText)
      || Boolean(record.source.installedManifestDigest
        && snapshot.manifestDigest !== record.source.installedManifestDigest
        && snapshot.files.some((file) => /(^|\/)scripts\//.test(file.path)));
    const state = classifyExternalSourceState({
      localModified,
      adoptedContentRevision: record.contentRevision,
      // A deferred adoption has no immutable upstream baseline yet. Its first
      // resolved snapshot must match the adopted local tree before it can be
      // classified as clean.
      adoptedUpstreamContentRevision: record.source.upstreamContentRevision
        ?? (record.source.installedManifestDigest ? undefined : upstreamContentRevision),
      installedManifestDigest: record.source.installedManifestDigest,
      currentManifestDigest: snapshot.manifestDigest,
      risky
    });
    const source = {
      ...record.source,
      resolvedCommit: record.source.resolvedCommit ?? snapshot.resolvedCommit,
      installedManifestDigest: record.source.installedManifestDigest ?? (record.contentRevision === upstreamContentRevision ? snapshot.manifestDigest : undefined),
      rootTreeDigest: record.source.rootTreeDigest ?? snapshot.rootTreeDigest,
      upstreamContentRevision: record.source.upstreamContentRevision ?? upstreamContentRevision
    };
    return {
      ...record,
      source,
      state,
      currentHash,
      upstreamHash,
      upstreamManifestDigest: snapshot.manifestDigest,
      upstreamCommit: snapshot.resolvedCommit,
      upstreamContentRevision,
      risk: risky ? 'high' : 'low',
    };
  } catch (error) {
    if (error instanceof GithubSourceFetchError && error.code === 'REQUEST_ABORTED') throw error;
    return { ...record, state: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }
}

function hasRiskySourceChange(localText: string, upstreamText: string): boolean {
  const riskTerms = ['scripts/', 'tool', 'mcp', 'network', 'curl', 'rm ', 'sudo', 'chmod', 'write', 'delete'];
  const local = localText.toLowerCase();
  const upstream = upstreamText.toLowerCase();
  return riskTerms.some((term) => upstream.includes(term) && !local.includes(term));
}

async function compareWithUpstream(
  cwd: string,
  record: SourceRecord,
  signal?: AbortSignal,
  resolvedSnapshot?: GithubSourceSnapshot,
  fetcherOptions?: SourcesCommandRuntime['fetcherOptions'],
  capturedLocalText?: string
): Promise<SourceComparison | undefined> {
  if (record.source.type !== 'github') return undefined;
  const localText = capturedLocalText ?? await readFile(record.localPath, 'utf8');
  const snapshot = resolvedSnapshot ?? await fetchSourceSnapshot(cwd, record.source, {}, signal, fetcherOptions);
  const skillFile = snapshot.files.find((file) => file.path === 'SKILL.md');
  if (!skillFile) throw new Error('Immutable GitHub source snapshot has no SKILL.md file.');
  const upstreamText = Buffer.from(skillFile.bytes).toString('utf8');
  return {
    localText,
    upstreamText,
    upstreamHash: hashText(upstreamText),
    snapshot,
    diff: buildLineDiff(localText, upstreamText)
  };
}

export async function captureSourceDiffLocalSnapshot(cwd: string, skillId: string, signal?: AbortSignal): Promise<CapturedSourceLocalSnapshot> {
  const registry = await readRegistry(cwd);
  const record = resolveSourceRecord(registry.records, skillId);
  const inventory = await readJson<Inventory>(path.join(skillmapDir(cwd), 'inventory.json'));
  return captureBoundSourceLocalSnapshot(inventory, record, signal);
}

async function captureBoundSourceLocalSnapshot(
  inventory: Inventory,
  record: SourceRecord,
  signal?: AbortSignal,
  options: { requireInventoryRevision?: boolean } = {}
): Promise<CapturedSourceLocalSnapshot> {
  try {
    checkSourceAbort(signal);
    assertQualifiedInventory(inventory, 'inspect a source diff');
    const skill = findInventorySkillForSource(inventory, record);
    if (!skill || !record.skillId || skill.skillId !== record.skillId) throw new SourceBindingError();
    const relativePath = normalizeRelativeSkillPath(skill.relativePath);
    if (deriveSkillId(skill.rootId, relativePath) !== skill.skillId) throw new SourceBindingError();
    const root = inventory.rootRecords.find((item) => item.rootId === skill.rootId);
    if (!root) throw new SourceBindingError();
    const expectedDirectory = path.resolve(root.realPath, ...relativePath.split('/'));
    const expectedFile = path.join(expectedDirectory, 'SKILL.md');
    if (path.resolve(skill.path) !== expectedFile || path.resolve(record.localPath) !== expectedFile) throw new SourceBindingError();

    const rootRealPath = await realpath(root.realPath);
    const skillRealPath = await realpath(expectedDirectory);
    const skillFileRealPath = await realpath(expectedFile);
    const actualRelative = path.relative(rootRealPath, skillRealPath).split(path.sep).join('/');
    if (actualRelative !== relativePath || skillFileRealPath !== path.join(skillRealPath, 'SKILL.md')) throw new SourceBindingError();

    const tree = await hashSkillTree(skillRealPath, { check: () => checkSourceAbort(signal) });
    if (options.requireInventoryRevision !== false && tree.contentRevision !== skill.contentRevision) throw new SourceLocalChangedError();
    const text = await readStableSourceSkill(expectedFile, rootRealPath, signal);
    const verify = async () => {
      checkSourceAbort(signal);
      const nextRoot = await realpath(root.realPath);
      const nextDirectory = await realpath(expectedDirectory);
      const nextFile = await realpath(expectedFile);
      if (nextRoot !== rootRealPath || nextDirectory !== skillRealPath || nextFile !== skillFileRealPath) throw new SourceLocalChangedError();
      const nextTree = await hashSkillTree(skillRealPath, { check: () => checkSourceAbort(signal) });
      if (nextTree.contentRevision !== tree.contentRevision) throw new SourceLocalChangedError();
    };
    return { skillId: skill.skillId, contentRevision: tree.contentRevision, text, verify };
  } catch (error) {
    if (isRequestAborted(error) || error instanceof SourceBindingError || error instanceof SourceLocalChangedError) throw error;
    throw new SourceBindingError();
  }
}

async function readStableSourceSkill(file: string, rootRealPath: string, signal?: AbortSignal): Promise<string> {
  checkSourceAbort(signal);
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || !Number.isSafeInteger(before.size) || before.size < 0
    || before.size > DEFAULT_SKILL_FILESYSTEM_LIMITS.maxSkillMarkdownBytes) throw new SourceBindingError();
  const resolvedBefore = await realpath(file);
  if (!pathContainedBy(rootRealPath, resolvedBefore)) throw new SourceBindingError();
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(file, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!sameFileSnapshot(before, opened)) throw new SourceLocalChangedError();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      checkSourceAbort(signal);
      const result = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (result.bytesRead <= 0) throw new SourceLocalChangedError();
      offset += result.bytesRead;
    }
    const overflow = Buffer.allocUnsafe(1);
    if ((await handle.read(overflow, 0, 1, bytes.length)).bytesRead !== 0) throw new SourceLocalChangedError();
    const afterHandle = await handle.stat();
    const afterPath = await lstat(file);
    const resolvedAfter = await realpath(file);
    if (!sameFileSnapshot(before, afterHandle) || !sameFileSnapshot(before, afterPath)
      || resolvedAfter !== resolvedBefore || !pathContainedBy(rootRealPath, resolvedAfter)) throw new SourceLocalChangedError();
    return bytes.toString('utf8');
  } finally {
    await handle.close();
  }
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mode === right.mode && left.mtimeMs === right.mtimeMs;
}

function pathContainedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function checkSourceAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new GithubSourceFetchError('REQUEST_ABORTED', 'Source inspection was cancelled.', { retryable: true });
}

function isRequestAborted(error: unknown): boolean {
  return error instanceof GithubSourceFetchError && error.code === 'REQUEST_ABORTED';
}

async function fetchSourceSnapshot(
  cwd: string,
  source: Extract<SourceRecord['source'], { type: 'github' }>,
  flags: Record<string, string | boolean | string[]> = {},
  signal?: AbortSignal,
  fetcherOptions?: SourcesCommandRuntime['fetcherOptions']
): Promise<GithubSourceSnapshot> {
  const tokenEnv = flagString(flags, 'token-env') ?? 'GITHUB_TOKEN';
  if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(tokenEnv)) throw new Error('sources --token-env must name a safe environment variable.');
  const token = process.env[tokenEnv];
  const requestedRef = source.ref;
  const snapshot = await fetchGithubSkillTree(source.repo, requestedRef, source.path, {
    ...fetcherOptions,
    ...(token ? { token } : {}),
    cacheDir: path.join(skillmapDir(cwd), 'cache', 'github'),
    ...(signal ? { signal } : {})
  });
  return snapshot;
}

function buildLineDiff(localText: string, upstreamText: string, maxLines = 120): SourceDiff {
  const localLines = localText.split(/\r?\n/);
  const upstreamLines = upstreamText.split(/\r?\n/);
  const lineCount = Math.max(localLines.length, upstreamLines.length);
  const lines: SourceDiff['lines'] = [];
  let additions = 0;
  let deletions = 0;
  let changedLines = 0;
  for (let index = 0; index < lineCount; index += 1) {
    const localLine = localLines[index];
    const upstreamLine = upstreamLines[index];
    if (localLine === upstreamLine) continue;
    changedLines += 1;
    if (localLine !== undefined) {
      deletions += 1;
      if (lines.length < maxLines) lines.push({ kind: 'local', line: index + 1, text: localLine.slice(0, 500) });
    }
    if (upstreamLine !== undefined) {
      additions += 1;
      if (lines.length < maxLines) lines.push({ kind: 'upstream', line: index + 1, text: upstreamLine.slice(0, 500) });
    }
  }
  return { additions, deletions, changedLines, truncated: lines.length >= maxLines, lines };
}

function renderSourceSummary(records: SourceStatusRecord[]): string {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.state, (counts.get(record.state) ?? 0) + 1);
  const rendered = [...counts.entries()].map(([state, count]) => `${state}=${count}`).join(', ') || 'none';
  return `SkillMap sources check: ${records.length} tracked record(s); ${rendered}.`;
}
