import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { flagString, hasFlag } from '../core/args.js';
import {
  assertPrivateExportEnvelope,
  assertSafeExportEnvelope,
  canonicalJson,
  computeTransportDigest,
  verifyPayloadDigest,
  type PrivateExportArtifact,
  type PrivateExportEnvelope,
  type SafeExportEnvelope
} from '../core/canonical-payload.js';
import { hashText, readJson, writeJson } from '../core/fs.js';
import { fileExists } from '../core/status.js';
import { outDir } from './common.js';

interface LegacyImportedSnapshot {
  version?: number;
  artifacts?: Record<string, { present?: boolean; value?: unknown }>;
}

interface ImportReport {
  conflicts: unknown[];
  importable: unknown[];
  missing: unknown[];
  format: 'safe-v2' | 'private-v2' | 'legacy-v1';
  verified: boolean;
  legacyUnverified: boolean;
  payloadDigest?: string;
  transportDigest: string;
  activation: 'none';
}

export async function importCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const file = positionals[0] ?? flagString(flags, 'file');
  if (!file) throw new Error('import requires a snapshot file path.');
  const resolved = path.resolve(cwd, file);
  const raw = await readFile(resolved, 'utf8');
  const transportDigest = computeTransportDigest(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`import file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const dryRun = hasFlag(flags, 'dry-run') || !hasFlag(flags, 'confirm');
  const record = recordValue(parsed);
  let report: ImportReport;

  if (record?.kind === 'skillmap.safe-export') {
    assertSafeExportEnvelope(parsed);
    const payloadDigest = verifyPayloadDigest(parsed);
    report = {
      conflicts: [],
      importable: [],
      missing: [],
      format: 'safe-v2',
      verified: true,
      legacyUnverified: false,
      payloadDigest,
      transportDigest,
      activation: 'none'
    };
  } else if (record?.kind === 'skillmap.local-private-export') {
    assertPrivateExportEnvelope(parsed);
    const payloadDigest = verifyPayloadDigest(parsed);
    if (!hasFlag(flags, 'acknowledge-sensitive-local')) {
      throw new Error('Local-private export import requires --acknowledge-sensitive-local. The file may contain raw prompts, paths, bodies, or receipts.');
    }
    const artifactReport = await buildImportReport(cwd, parsed.artifacts);
    report = {
      ...artifactReport,
      format: 'private-v2',
      verified: true,
      legacyUnverified: false,
      payloadDigest,
      transportDigest,
      activation: 'none'
    };
  } else if (isLegacySnapshot(parsed)) {
    const artifactReport = await buildImportReport(cwd, parsed.artifacts ?? {});
    report = {
      ...artifactReport,
      format: 'legacy-v1',
      verified: false,
      legacyUnverified: true,
      transportDigest,
      activation: 'none'
    };
  } else {
    throw new Error('import file must be a SkillMap safe/private export v2 or a legacy version 1 artifact snapshot.');
  }

  if (!dryRun) {
    const archivedSnapshot = await archiveExactImport(cwd, raw, report);
    return {
      dryRun,
      archivedSnapshot,
      verified: report.verified,
      legacyUnverified: report.legacyUnverified,
      payloadDigest: report.payloadDigest,
      transportDigest,
      report,
      summary: `SkillMap import archived the exact ${report.format} bytes and a conflict report. No active artifacts were overwritten or activated.`
    };
  }
  return {
    dryRun,
    verified: report.verified,
    legacyUnverified: report.legacyUnverified,
    payloadDigest: report.payloadDigest,
    transportDigest,
    report,
    summary: `SkillMap import dry-run (${report.format}): ${report.conflicts.length} conflict(s), ${report.importable.length} importable artifact(s). No files were modified or activated.`
  };
}

async function buildImportReport(
  cwd: string,
  artifacts: Record<string, { present?: boolean; value?: unknown } | PrivateExportArtifact>
): Promise<{ conflicts: unknown[]; importable: unknown[]; missing: unknown[] }> {
  const mapping: Record<string, string> = {
    config: 'config.yml',
    identity: 'identity.json',
    identityMigrations: 'identity-migrations.json',
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
  for (const [name, artifact] of Object.entries(artifacts)) {
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
      else importable.push({ name, target, action: 'identical; no activation performed' });
    } else {
      importable.push({ name, target, action: 'available for a future reviewed migration; no activation performed' });
    }
  }
  return { conflicts, importable, missing };
}

async function archiveExactImport(cwd: string, raw: string, report: ImportReport): Promise<string> {
  const importDir = path.join(outDir(cwd), 'imports');
  await mkdir(importDir, { recursive: true, mode: 0o700 });
  const suffix = report.transportDigest.replace('sha256:', '').slice(0, 12);
  const archivedSnapshot = path.join(importDir, `imported-${Date.now()}-${suffix}.json`);
  await writeFile(archivedSnapshot, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await writeJson(path.join(importDir, 'last-import-report.json'), report);
  return archivedSnapshot;
}

function stableString(value: unknown): string {
  return typeof value === 'string' ? value : canonicalJson(value ?? null);
}

function isLegacySnapshot(value: unknown): value is LegacyImportedSnapshot & { version: 1; artifacts: Record<string, { present?: boolean; value?: unknown }> } {
  const record = recordValue(value);
  return Boolean(record?.version === 1 && recordValue(record.artifacts));
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
