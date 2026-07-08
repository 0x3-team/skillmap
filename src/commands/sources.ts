import { get } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { hashText, readJson, writeJson } from '../core/fs.js';
import { fileExists, skillmapDir } from '../core/status.js';
import type { Inventory } from '../schemas/types.js';

interface SourceRegistry {
  version: 1;
  records: SourceRecord[];
}

interface SourceRecord {
  skill: string;
  localPath: string;
  installedHash: string;
  source: { type: 'github'; repo: string; path: string; ref: string } | { type: 'local'; path: string } | { type: 'unknown' };
  installedAt: string;
  patchPolicy: 'ask' | 'never-overwrite';
}

interface SourceStatusRecord extends SourceRecord {
  state: 'external-clean' | 'external-modified' | 'external-stale' | 'external-risky-update' | 'local-authored' | 'unknown';
  currentHash?: string;
  upstreamHash?: string;
  risk?: 'low' | 'high';
  error?: string;
}

interface SourceDecisionRegistry {
  version: 1;
  records: SourceDecisionRecord[];
}

interface SourceDecisionRecord {
  skill: string;
  appliesToState: SourceStatusRecord['state'];
  decision: 'hold' | 'accepted' | 'ignore';
  reason: string;
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
  diff: SourceDiff;
}

export async function sourcesCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const action = positionals[0] ?? 'list';
  if (action === 'list') return listSources(cwd);
  if (action === 'adopt') return adoptSource(cwd, positionals[1], flags);
  if (action === 'check') return checkSources(cwd);
  if (action === 'diff') return diffSource(cwd, positionals[1]);
  if (action === 'update') return updateSource(cwd, positionals[1], flags);
  if (action === 'review') return reviewSource(cwd, positionals[1], flags);
  throw new Error('Supported sources commands: sources list, adopt, check, diff, update, review.');
}

async function listSources(cwd: string): Promise<unknown> {
  const registry = await readRegistry(cwd);
  return { records: registry.records, summary: `SkillMap sources: ${registry.records.length} tracked source record(s).` };
}

async function adoptSource(cwd: string, skillName: string | undefined, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (!skillName) throw new Error('sources adopt requires a skill name.');
  const repo = flagString(flags, 'repo');
  const sourcePath = flagString(flags, 'path');
  const ref = flagString(flags, 'ref') ?? 'main';
  if (!repo || !sourcePath) throw new Error('sources adopt requires --repo OWNER/REPO and --path PATH.');
  const inventory = await readJson<Inventory>(path.join(skillmapDir(cwd), 'inventory.json'));
  const skill = inventory.skills.find((item) => item.name === skillName);
  if (!skill) throw new Error(`Skill not found in inventory: ${skillName}`);
  const registry = await readRegistry(cwd);
  const record: SourceRecord = { skill: skill.name, localPath: skill.path, installedHash: `sha256:${skill.hash}`, source: { type: 'github', repo, path: sourcePath, ref }, installedAt: new Date().toISOString(), patchPolicy: 'ask' };
  registry.records = [...registry.records.filter((item) => item.skill !== skill.name), record].sort((a, b) => a.skill.localeCompare(b.skill));
  await writeRegistry(cwd, registry);
  return { record, summary: `Adopted ${skill.name} as external GitHub skill from ${repo}:${sourcePath}@${ref}.` };
}

async function checkSources(cwd: string): Promise<unknown> {
  const registry = await readRegistry(cwd);
  const records: SourceStatusRecord[] = [];
  for (const record of registry.records) records.push(await checkRecord(record));
  const report = { version: 1, generatedAt: new Date().toISOString(), records };
  await writeJson(path.join(skillmapDir(cwd), 'source-status.json'), report);
  return { report, summary: renderSourceSummary(records) };
}

async function diffSource(cwd: string, skillName: string | undefined): Promise<unknown> {
  if (!skillName) throw new Error('sources diff requires a skill name.');
  const registry = await readRegistry(cwd);
  const record = registry.records.find((item) => item.skill === skillName);
  if (!record) throw new Error(`No source record for ${skillName}.`);
  const checked = await checkRecord(record);
  const comparison = await compareWithUpstream(record);
  const diff = comparison?.diff;
  const diffSummary = diff ? ` +${diff.additions}/-${diff.deletions}, changed lines=${diff.changedLines}${diff.truncated ? ', truncated' : ''}` : '';
  return {
    record: checked,
    diff,
    summary: `${skillName}: ${checked.state}${checked.error ? ` (${checked.error})` : ''}.${diffSummary}`
  };
}

async function updateSource(cwd: string, skillName: string | undefined, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (!skillName) throw new Error('sources update requires a skill name.');
  const registry = await readRegistry(cwd);
  const record = registry.records.find((item) => item.skill === skillName);
  if (!record) throw new Error(`No source record for ${skillName}.`);
  const checked = await checkRecord(record);
  const dryRun = hasFlag(flags, 'dry-run') || !hasFlag(flags, 'confirm');
  const comparison = await compareWithUpstream(record);
  if (!comparison) {
    return {
      dryRun,
      record: checked,
      willWrite: false,
      summary: `SkillMap source update unavailable for ${skillName}: source is not a GitHub raw source or could not be compared.`
    };
  }
  if (!dryRun) {
    if (checked.state === 'external-risky-update' && !hasFlag(flags, 'allow-risky')) {
      throw new Error(`${skillName} has a risky upstream update. Re-run with --allow-risky only after reviewing sources diff.`);
    }
    if (checked.state === 'external-modified') {
      throw new Error(`${skillName} has local modifications relative to its installed hash. Refusing to overwrite.`);
    }
    await writeFile(record.localPath, comparison.upstreamText);
    const nextRecord: SourceRecord = {
      ...record,
      installedHash: comparison.upstreamHash,
      installedAt: new Date().toISOString()
    };
    registry.records = registry.records.map((item) => item.skill === record.skill ? nextRecord : item);
    await writeRegistry(cwd, registry);
    return {
      dryRun,
      record: { ...checked, installedHash: nextRecord.installedHash, currentHash: nextRecord.installedHash, upstreamHash: nextRecord.installedHash, state: 'external-clean' },
      diff: comparison.diff,
      willWrite: true,
      summary: `SkillMap source update wrote upstream content for ${skillName}.`
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
  if (!skillName) throw new Error('sources review requires a skill name.');
  const decision = flagString(flags, 'decision') ?? 'hold';
  if (!['hold', 'accepted', 'ignore'].includes(decision)) throw new Error('sources review --decision must be hold, accepted, or ignore.');
  const reason = flagString(flags, 'reason');
  if (!reason) throw new Error('sources review requires --reason TEXT.');
  const statusPath = path.join(skillmapDir(cwd), 'source-status.json');
  const status = await readJson<{ records: SourceStatusRecord[] }>(statusPath);
  const record = status.records.find((item) => item.skill === skillName);
  if (!record) throw new Error(`No source-status record for ${skillName}. Run sources check first.`);
  const registry = await readDecisionRegistry(cwd);
  const next: SourceDecisionRecord = {
    skill: skillName,
    appliesToState: record.state,
    decision: decision as SourceDecisionRecord['decision'],
    reason,
    reviewedAt: new Date().toISOString()
  };
  registry.records = [...registry.records.filter((item) => item.skill !== skillName), next].sort((a, b) => a.skill.localeCompare(b.skill));
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

async function checkRecord(record: SourceRecord): Promise<SourceStatusRecord> {
  try {
    if (record.source.type === 'unknown') return { ...record, state: 'unknown' };
    const localText = await readFile(record.localPath, 'utf8');
    const currentHash = hashText(localText);
    const localModified = currentHash !== record.installedHash;
    if (record.source.type === 'local') return { ...record, state: localModified ? 'external-modified' : 'local-authored', currentHash };
    const upstreamText = await fetchGithubRaw(record.source.repo, record.source.path, record.source.ref);
    const upstreamHash = hashText(upstreamText);
    const risky = hasRiskySourceChange(localText, upstreamText);
    let state: SourceStatusRecord['state'] = 'external-clean';
    if (localModified) state = 'external-modified';
    else if (upstreamHash !== record.installedHash) state = risky ? 'external-risky-update' : 'external-stale';
    return { ...record, state, currentHash, upstreamHash, risk: risky ? 'high' : 'low' };
  } catch (error) {
    return { ...record, state: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }
}

function fetchGithubRaw(repo: string, filePath: string, ref: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${filePath}`;
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`GitHub raw fetch failed with status ${response.statusCode}`));
        response.resume();
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function hasRiskySourceChange(localText: string, upstreamText: string): boolean {
  const riskTerms = ['scripts/', 'tool', 'mcp', 'network', 'curl', 'rm ', 'sudo', 'chmod', 'write', 'delete'];
  const local = localText.toLowerCase();
  const upstream = upstreamText.toLowerCase();
  return riskTerms.some((term) => upstream.includes(term) && !local.includes(term));
}

async function compareWithUpstream(record: SourceRecord): Promise<SourceComparison | undefined> {
  if (record.source.type !== 'github') return undefined;
  const localText = await readFile(record.localPath, 'utf8');
  const upstreamText = await fetchGithubRaw(record.source.repo, record.source.path, record.source.ref);
  return {
    localText,
    upstreamText,
    upstreamHash: hashText(upstreamText),
    diff: buildLineDiff(localText, upstreamText)
  };
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
