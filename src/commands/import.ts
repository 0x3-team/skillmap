import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { flagString, hasFlag } from '../core/args.js';
import { hashText, readJson, writeJson } from '../core/fs.js';
import { fileExists } from '../core/status.js';
import { outDir } from './common.js';

interface ImportedSnapshot {
  version?: number;
  artifacts?: Record<string, { present?: boolean; value?: unknown }>;
}

export async function importCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const file = positionals[0] ?? flagString(flags, 'file');
  if (!file) throw new Error('import requires a snapshot file path.');
  const snapshot = await readJson<ImportedSnapshot>(path.resolve(cwd, file));
  if (snapshot.version !== 1 || !snapshot.artifacts || typeof snapshot.artifacts !== 'object') {
    throw new Error('import file must be a SkillMap export snapshot with version 1 artifacts.');
  }
  const dryRun = hasFlag(flags, 'dry-run') || !hasFlag(flags, 'confirm');
  const report = await buildImportReport(cwd, snapshot);
  if (!dryRun) {
    const importDir = path.join(outDir(cwd), 'imports');
    const archivedSnapshot = path.join(importDir, `imported-${Date.now()}.json`);
    await writeJson(archivedSnapshot, snapshot);
    await writeJson(path.join(importDir, 'last-import-report.json'), report);
    return {
      dryRun,
      archivedSnapshot,
      report,
      summary: `SkillMap import archived snapshot and conflict report. No active artifacts were overwritten.`
    };
  }
  return { dryRun, report, summary: `SkillMap import dry-run: ${report.conflicts.length} conflict(s), ${report.importable.length} importable artifact(s). No files were modified.` };
}

async function buildImportReport(cwd: string, snapshot: ImportedSnapshot): Promise<{ conflicts: unknown[]; importable: unknown[]; missing: unknown[] }> {
  const mapping: Record<string, string> = {
    inventory: 'inventory.json',
    policy: 'policy.yml',
    effective: 'effective.json',
    skillgraph: 'skillgraph.json',
    sources: 'sources.json',
    sourceStatus: 'source-status.json',
    sourceDecisions: 'source-decisions.json',
    evalReport: 'eval-report.json',
    curationReceipt: 'curation/receipt.json'
  };
  const conflicts: unknown[] = [];
  const importable: unknown[] = [];
  const missing: unknown[] = [];
  for (const [name, artifact] of Object.entries(snapshot.artifacts ?? {})) {
    if (!artifact.present) {
      missing.push({ name, reason: 'not present in imported snapshot' });
      continue;
    }
    const rel = mapping[name];
    if (!rel) {
      missing.push({ name, reason: 'unknown artifact type' });
      continue;
    }
    const target = path.join(outDir(cwd), rel);
    const incomingHash = hashText(stableString(artifact.value));
    if (await fileExists(target)) {
      const current = target.endsWith('.yml') ? await readFile(target, 'utf8') : await readJson<unknown>(target);
      const currentHash = hashText(stableString(current));
      if (currentHash !== incomingHash) conflicts.push({ name, target, currentHash, incomingHash, action: 'review required; active artifact not overwritten' });
      else importable.push({ name, target, action: 'identical' });
    } else {
      importable.push({ name, target, action: 'can be imported after review' });
    }
  }
  return { conflicts, importable, missing };
}

function stableString(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, Object.keys(flattenKeys(value)).sort(), 2);
}

function flattenKeys(value: unknown, acc: Record<string, true> = {}): Record<string, true> {
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      acc[key] = true;
      flattenKeys(nested, acc);
    }
  }
  return acc;
}
