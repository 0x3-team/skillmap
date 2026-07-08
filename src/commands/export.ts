import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { flagString, hasFlag } from '../core/args.js';
import { fileExists } from '../core/status.js';
import { readJson, writeJson } from '../core/fs.js';
import { outDir } from './common.js';

interface ExportArtifact {
  path: string;
  present: boolean;
  value?: unknown;
}

export async function exportCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const dir = outDir(cwd);
  const target = flagString(flags, 'output') ?? path.join(dir, 'exports', `skillmap-export-${timestamp()}.json`);
  const redactPaths = hasFlag(flags, 'redact-paths');
  const artifacts: Record<string, ExportArtifact> = {};
  for (const [name, rel, mode] of [
    ['inventory', 'inventory.json', 'json'],
    ['policy', 'policy.yml', 'text'],
    ['effective', 'effective.json', 'json'],
    ['skillgraph', 'skillgraph.json', 'json'],
    ['sources', 'sources.json', 'json'],
    ['sourceStatus', 'source-status.json', 'json'],
    ['sourceDecisions', 'source-decisions.json', 'json'],
    ['evalReport', 'eval-report.json', 'json'],
    ['curationReceipt', 'curation/receipt.json', 'json']
  ] as const) {
    const artifactPath = path.join(dir, rel);
    const present = await fileExists(artifactPath);
    artifacts[name] = {
      path: redactPaths ? redactPath(cwd, artifactPath) : artifactPath,
      present,
      value: present ? await readArtifact(artifactPath, mode) : undefined
    };
  }
  let snapshot: unknown = {
    version: 1,
    generatedAt: new Date().toISOString(),
    cwd: redactPaths ? '$PROJECT' : cwd,
    redacted: redactPaths,
    artifacts
  };
  if (redactPaths) snapshot = redactValue(cwd, snapshot);
  await writeJson(target, snapshot);
  return { file: target, redacted: redactPaths, artifacts: Object.keys(artifacts).length, summary: `SkillMap export written to ${target}.` };
}

async function readArtifact(file: string, mode: 'json' | 'text'): Promise<unknown> {
  return mode === 'json' ? readJson<unknown>(file) : readFile(file, 'utf8');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function redactPath(cwd: string, value: string): string {
  return value.replaceAll(cwd, '$PROJECT').replaceAll(os.homedir(), '$HOME');
}

function redactValue(cwd: string, value: unknown): unknown {
  if (typeof value === 'string') return redactPath(cwd, value);
  if (Array.isArray(value)) return value.map((item) => redactValue(cwd, item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) out[key] = redactValue(cwd, nested);
    return out;
  }
  return value;
}
