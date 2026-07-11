import path from 'node:path';
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { flagString, hasFlag } from '../core/args.js';
import {
  assertPrivateExportEnvelope,
  assertSafeExportEnvelope,
  canonicalJson,
  computeTransportDigest,
  serializeEnvelope,
  withPayloadDigest,
  type PrivateExportEnvelope,
  type SafeExportEnvelope
} from '../core/canonical-payload.js';
import { buildDashboardSnapshot } from '../core/dashboard-snapshot.js';
import { resolveCurrentEffective } from '../core/effective-state.js';
import { isQualifiedInventory } from '../core/identity.js';
import { hashFile, readJson, writeJson, writeText } from '../core/fs.js';
import { readActivePolicy } from '../core/policy.js';
import { buildSkillMapStatus, fileExists } from '../core/status.js';
import { outDir } from './common.js';
import type { EffectiveRegistry, Inventory } from '../schemas/types.js';

interface ExportArtifact {
  path: string;
  present: boolean;
  value?: unknown;
}

const ARTIFACTS = [
  ['config', 'config.yml', 'text'],
  ['identity', 'identity.json', 'json'],
  ['identityMigrations', 'identity-migrations.json', 'json'],
  ['inventory', 'inventory.json', 'json'],
  ['policy', 'policy.yml', 'text'],
  ['effective', 'effective.json', 'json'],
  ['skillgraph', 'skillgraph.json', 'json'],
  ['sources', 'sources.json', 'json'],
  ['sourceStatus', 'source-status.json', 'json'],
  ['sourceDecisions', 'source-decisions.json', 'json'],
  ['evalReport', 'eval-report.json', 'json'],
  ['curationReceipt', 'curation/receipt.json', 'json']
] as const;

const INPUT_DIGESTS = [
  ['config', 'config.yml'],
  ['identity', 'identity.json'],
  ['identityMigrations', 'identity-migrations.json'],
  ['inventory', 'inventory.json'],
  ['doctor', 'doctor.json'],
  ['doctorPack', 'doctor-pack.summary.md'],
  ['doctorPackFull', 'doctor-pack.md'],
  ['policy', 'policy.yml'],
  ['policyActivePointer', 'policies/active.json'],
  ['policyRationale', 'policy-rationale.md'],
  ['effective', 'effective.json'],
  ['skillgraph', 'skillgraph.json'],
  ['sources', 'sources.json'],
  ['sourceStatus', 'source-status.json'],
  ['sourceDecisions', 'source-decisions.json'],
  ['curationReceipt', 'curation/receipt.json']
] as const;

const TIERS = new Set(['active-default', 'specialist', 'explicit-only', 'archived', 'blocked']);
const MODEL_VERIFICATION = new Set(['provider-verified', 'user-reported', 'unverified-user-reported']);

export async function exportCommand(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (hasFlag(flags, 'dashboard-snapshot')) {
    if (hasFlag(flags, 'include-sensitive-local')) throw new Error('--include-sensitive-local cannot be combined with --dashboard-snapshot.');
    return exportDashboardSnapshot(cwd, flags);
  }
  if (hasFlag(flags, 'include-sensitive-local')) return exportPrivateSnapshot(cwd, flags);
  return exportSafeSnapshot(cwd, flags);
}

async function exportSafeSnapshot(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const dir = outDir(cwd);
  const target = path.resolve(cwd, flagString(flags, 'output') ?? path.join(dir, 'exports', `skillmap-safe-export-${timestamp()}.json`));
  const inventory = await readOptionalJson(path.join(dir, 'inventory.json'));
  if (!isQualifiedInventory(inventory)) throw new Error('Safe export requires a qualified inventory v2. Run `skillmap scan` first.');
  const savedEffective = await readOptionalJson(path.join(dir, 'effective.json')) as unknown as EffectiveRegistry | undefined;
  const effective = await resolveCurrentEffective(cwd, inventory as Inventory, savedEffective);
  const sourceStatus = await readOptionalJson(path.join(dir, 'source-status.json'));
  const sourceDecisions = await readOptionalJson(path.join(dir, 'source-decisions.json'));
  const curationReceipt = await readOptionalJson(path.join(dir, 'curation/receipt.json'));
  const packageJson = await readOptionalJson(path.join(cwd, 'package.json'));
  const activePolicy = await readActivePolicy(cwd);
  const policy = recordValue(activePolicy.policy);
  const status = await buildSkillMapStatus(cwd);
  const inputDigests = await collectInputDigests(dir);
  if (activePolicy.file) inputDigests.policy = await hashFile(activePolicy.file);
  const inventorySkills = arrayValue(inventory?.skills);
  const effectiveSkills = arrayValue(effective.skills as unknown);
  const skills = effectiveSkills.length ? effectiveSkills : inventorySkills;
  const sourceRecords = arrayValue(sourceStatus?.records);
  const decisions = arrayValue(sourceDecisions?.records);
  const generatedAt = new Date().toISOString();
  const policyVersion = integerValue(policy?.version, 0);
  const policyDigest = inputDigests.policy ?? null;
  const workspaceId = firstString(inventory.workspaceId);
  if (!workspaceId) throw new Error('Safe export requires a qualified workspace identity. Run `skillmap init --root PATH` and `skillmap scan` first.');
  const declaredWorkspaceRevision = firstString((inventory as unknown as Record<string, unknown>).workspaceRevision);
  const workspaceRevision = declaredWorkspaceRevision && /^sha256:[0-9a-f]{64}$/.test(declaredWorkspaceRevision)
    ? declaredWorkspaceRevision
    : computeTransportDigest(canonicalJson({ workspaceId, inputDigests }));

  const tierCounts: SafeExportEnvelope['payload']['policySummary']['tierCounts'] = {};
  for (const skill of skills) {
    const tier = safeTier(skill.tier);
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }

  const base = {
    kind: 'skillmap.safe-export',
    schemaVersion: 2,
    generatedAt,
    workspaceId,
    workspaceRevision,
    inputDigests,
    producer: { name: 'skillmap', version: safeProducerVersion(packageJson?.version) },
    compatibility: { minReaderSchemaVersion: 2, maxReaderSchemaVersion: 2 },
    redaction: {
      classification: 'shareable-redacted',
      rawPrompts: false,
      rawSkillBodies: false,
      absolutePaths: false,
      secrets: false,
      sensitiveReceipts: false
    },
    redacted: true,
    cwd: '$PROJECT',
    payload: {
      status: {
        verdict: status.verdict,
        readinessPhase: status.readinessPhase,
        blockerCodes: status.readinessPhase === 'ready' ? [] : [status.readinessPhase]
      },
      inventorySummary: {
        skillCount: inventorySkills.length,
        rootCount: stringArrayValue(inventory?.roots).length,
        duplicateGroupCount: duplicateNameCount(inventorySkills),
        scriptBearingCount: inventorySkills.filter((skill) => skill.hasScripts === true).length
      },
      skills: skills.map((skill) => {
        const displayName = safeDisplayName(firstString(skill.displayName, skill.name), skill);
        const stableId = firstString(skill.skillId, skill.id) ?? 'unassigned';
        const source = findQualifiedRecord(skill, sourceRecords);
        const decision = findQualifiedRecord(skill, decisions);
        return {
          skillId: stableId === 'unassigned' ? `skill-${computeTransportDigest(canonicalJson({ displayName, contentRevision: firstString(skill.contentRevision, skill.hash) ?? null })).slice(-16)}` : stableId,
          displayName,
          contentRevision: safeDigest(skill.contentRevision, skill.hash, { displayName, id: stableId }),
          tier: safeTier(skill.tier),
          routeEligible: status.readinessPhase === 'identity-invalid'
            ? false
            : skill.routeEligible === undefined ? skill.implicitAllowed !== false : skill.routeEligible === true,
          hasScripts: skill.hasScripts === true,
          sourceState: safeSourceState(source),
          reviewStatus: safeReviewStatus(source, decision)
        };
      }),
      policySummary: {
        version: policyVersion,
        policyDigest,
        tierCounts,
        canonicalDecisionCount: objectSize(policy?.canonicalByName),
        duplicateDecisionCount: objectSize(policy?.duplicateDecisions)
      },
      evalSummary: buildEvalSummary(recordValue(status.eval)),
      sourceSummary: {
        present: Boolean(status.sources),
        coverage: status.sources?.coverage ?? null,
        inventorySkills: numberValue(status.sources?.inventorySkills),
        trackedSkills: numberValue(status.sources?.trackedSkills),
        external: numberValue(status.sources?.external),
        localAuthored: numberValue(status.sources?.localAuthored),
        unknown: numberValue(status.sources?.unknown),
        modified: numberValue(status.sources?.modified),
        stale: numberValue(status.sources?.stale),
        riskyUpdates: numberValue(status.sources?.riskyUpdates),
        errors: numberValue(status.sources?.errors),
        unreviewedNonClean: numberValue(status.sources?.unreviewedNonClean)
      },
      curationSummary: {
        present: Boolean(curationReceipt || status.curation?.present),
        stale: status.curation?.stale === true,
        modelVerification: safeModelVerification(status.curation?.modelVerification ?? curationReceipt?.modelVerification)
      }
    }
  } as const;
  const snapshot = withPayloadDigest(base as unknown as Record<string, unknown>) as unknown as SafeExportEnvelope;
  assertSafeExportEnvelope(snapshot);
  const serialized = serializeEnvelope(snapshot);
  await writeText(target, serialized);
  const transportDigest = computeTransportDigest(serialized);
  return {
    file: target,
    redacted: true,
    shareable: true,
    deprecatedRedactPathsFlagUsed: hasFlag(flags, 'redact-paths'),
    kind: snapshot.kind,
    schemaVersion: snapshot.schemaVersion,
    payloadDigest: snapshot.payloadDigest,
    transportDigest,
    artifacts: Object.keys(inputDigests).length,
    summary: `SkillMap safe export written to ${target} (${snapshot.payloadDigest}; transport ${transportDigest}).`
  };
}

async function exportPrivateSnapshot(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (process.platform === 'win32') {
    throw new Error(
      '--include-sensitive-local is unavailable on Windows because POSIX mode 0600 does not enforce a private Windows ACL. '
      + 'Use the default redacted export, or create the local-sensitive archive from a protected Linux/macOS workspace.'
    );
  }
  const requestedTarget = flagString(flags, 'output');
  if (!requestedTarget) throw new Error('--include-sensitive-local requires --output inside .skillmap/private-exports/.');
  const target = await preparePrivateTarget(cwd, requestedTarget);
  const dir = outDir(cwd);
  const artifacts: Record<string, ExportArtifact> = {};
  for (const [name, rel, mode] of ARTIFACTS) {
    const artifactPath = path.join(dir, rel);
    const value = await readPrivateArtifact(dir, artifactPath, mode);
    artifacts[name] = value.present
      ? { path: artifactPath, present: true, value: value.value }
      : { path: artifactPath, present: false };
  }
  const policyState = await collectPrivatePolicyState(dir);
  artifacts.policyState = policyState
    ? { path: path.join(dir, 'policies'), present: true, value: policyState }
    : { path: path.join(dir, 'policies'), present: false };
  const base = {
    kind: 'skillmap.local-private-export',
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    workspacePath: cwd,
    redaction: { classification: 'local-sensitive', shareable: false },
    artifacts
  } as const;
  const snapshot = withPayloadDigest(base as unknown as Record<string, unknown>) as unknown as PrivateExportEnvelope;
  assertPrivateExportEnvelope(snapshot);
  const serialized = serializeEnvelope(snapshot);
  await writeFile(target, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await chmod(target, 0o600);
  const transportDigest = computeTransportDigest(serialized);
  return {
    file: target,
    redacted: false,
    shareable: false,
    localSensitive: true,
    kind: snapshot.kind,
    schemaVersion: snapshot.schemaVersion,
    payloadDigest: snapshot.payloadDigest,
    transportDigest,
    artifacts: Object.keys(artifacts).length,
    summary: `SkillMap local-sensitive export written with mode 0600 inside .skillmap/private-exports. Do not share this file.`
  };
}

async function exportDashboardSnapshot(cwd: string, flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  if (!hasFlag(flags, 'redact-paths')) {
    throw new Error('dashboard snapshot export requires --redact-paths to avoid exposing local paths or private artifacts.');
  }
  const target = flagString(flags, 'output') ?? path.join(outDir(cwd), 'dashboard-snapshot.json');
  const snapshot = await buildDashboardSnapshot(cwd);
  await writeJson(target, snapshot);
  const integrity = snapshot as unknown as { payloadDigest?: string; snapshotHash?: string };
  const snapshotDigest = integrity.payloadDigest ?? integrity.snapshotHash ?? 'unavailable';
  return {
    file: target,
    redacted: true,
    dashboardSnapshot: true,
    snapshotHash: integrity.snapshotHash,
    payloadDigest: integrity.payloadDigest,
    mode: snapshot.mode,
    connectorState: snapshot.connector.state,
    summary: `SkillMap dashboard snapshot written to ${target} (${snapshot.mode}, ${snapshot.connector.state}, ${snapshotDigest}).`
  };
}

async function collectInputDigests(dir: string): Promise<SafeExportEnvelope['inputDigests']> {
  const digests: SafeExportEnvelope['inputDigests'] = {};
  for (const [name, rel] of INPUT_DIGESTS) {
    const file = path.join(dir, rel);
    if (await fileExists(file)) digests[name] = await hashFile(file);
  }
  return digests;
}

async function readOptionalJson(file: string): Promise<Record<string, unknown> | undefined> {
  if (!(await fileExists(file))) return undefined;
  const value = await readJson<unknown>(file);
  return recordValue(value);
}

async function readPrivateArtifact(base: string, file: string, mode: 'json' | 'text'): Promise<{ present: boolean; value?: unknown }> {
  try {
    await assertPrivateSourcePath(base, file, 'file');
  } catch (error) {
    if (isMissingFile(error)) return { present: false };
    throw error;
  }
  return { present: true, value: mode === 'json' ? await readJson<unknown>(file) : await readFile(file, 'utf8') };
}

async function preparePrivateTarget(cwd: string, requested: string): Promise<string> {
  const privateRoot = path.resolve(outDir(cwd), 'private-exports');
  const requestedTarget = path.resolve(cwd, requested);
  const workspaceReal = await realpath(cwd);
  const skillmapPath = outDir(cwd);
  const skillmapInfo = await lstat(skillmapPath);
  if (skillmapInfo.isSymbolicLink()) throw new Error('.skillmap must not be a symbolic link for local-sensitive export.');
  const skillmapReal = await realpath(skillmapPath);
  if (!inside(workspaceReal, skillmapReal)) throw new Error('.skillmap realpath must remain inside the workspace for local-sensitive export.');
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(privateRoot);
  if (rootInfo.isSymbolicLink()) throw new Error('.skillmap/private-exports must not be a symbolic link.');
  await chmod(privateRoot, 0o700);
  const privateRootReal = await realpath(privateRoot);
  const target = await canonicalPrivateTarget(privateRootReal, requestedTarget);
  const relative = path.relative(privateRootReal, target);
  let current = privateRootReal;
  const parentParts = path.dirname(relative).split(path.sep).filter((part) => part && part !== '.');
  for (const part of parentParts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Private export parent must not contain symbolic links: ${current}`);
      if (!info.isDirectory()) throw new Error(`Private export parent is not a directory: ${current}`);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      await mkdir(current, { mode: 0o700 });
    }
    const currentReal = await realpath(current);
    if (!inside(privateRootReal, currentReal)) throw new Error('Private export target escaped .skillmap/private-exports after realpath resolution.');
  }
  try {
    await lstat(target);
    throw new Error('Private export target already exists; choose a new file to avoid overwriting sensitive data.');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  return target;
}

async function canonicalPrivateTarget(privateRootReal: string, requestedTarget: string): Promise<string> {
  const filename = path.basename(requestedTarget);
  if (!filename || filename === '.' || filename === '..') {
    throw new Error('--include-sensitive-local output must be a file inside .skillmap/private-exports/.');
  }

  const missing: string[] = [];
  let cursor = path.dirname(requestedTarget);
  while (true) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new Error(`Private export parent must not contain symbolic links: ${cursor}`);
      if (!info.isDirectory()) throw new Error(`Private export parent is not a directory: ${cursor}`);
      const cursorReal = await realpath(cursor);
      if (!inside(privateRootReal, cursorReal)) {
        throw new Error('--include-sensitive-local output must be a file inside .skillmap/private-exports/.');
      }
      cursor = cursorReal;
      break;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      missing.unshift(path.basename(cursor));
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error('--include-sensitive-local output must be a file inside .skillmap/private-exports/.');
    }
    cursor = parent;
  }

  const target = path.join(cursor, ...missing, filename);
  if (!inside(privateRootReal, target) || path.relative(privateRootReal, target) === '') {
    throw new Error('--include-sensitive-local output must be a file inside .skillmap/private-exports/.');
  }
  return target;
}

async function collectPrivatePolicyState(dir: string): Promise<{ files: Record<string, string> } | undefined> {
  const root = path.join(dir, 'policies');
  try {
    await assertPrivateSourcePath(dir, root, 'directory');
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
  const files: Record<string, string> = {};
  await collectPrivateTextFiles(root, root, files);
  return { files };
}

async function collectPrivateTextFiles(root: string, current: string, files: Record<string, string>): Promise<void> {
  const children = await readdir(current, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, child.name);
    if (child.isSymbolicLink()) throw new Error(`Local-sensitive policy state contains a symbolic link: ${absolute}`);
    if (child.isDirectory()) {
      await collectPrivateTextFiles(root, absolute, files);
    } else if (child.isFile()) {
      files[path.relative(root, absolute).split(path.sep).join('/')] = await readFile(absolute, 'utf8');
    } else {
      throw new Error(`Unsupported local-sensitive policy state entry: ${absolute}`);
    }
  }
}

async function assertPrivateSourcePath(base: string, target: string, kind: 'file' | 'directory'): Promise<void> {
  const basePath = path.resolve(base);
  const targetPath = path.resolve(target);
  const relative = path.relative(basePath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Local-sensitive source escaped .skillmap: ${targetPath}`);
  const baseInfo = await lstat(basePath);
  if (baseInfo.isSymbolicLink() || !baseInfo.isDirectory()) throw new Error(`Local-sensitive source base must be a real directory: ${basePath}`);
  const baseReal = await realpath(basePath);
  let current = basePath;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Local-sensitive export refuses symbolic-link sources: ${current}`);
  }
  const targetInfo = await lstat(targetPath);
  if (kind === 'file' ? !targetInfo.isFile() : !targetInfo.isDirectory()) {
    throw new Error(`Local-sensitive export expected a regular ${kind}: ${targetPath}`);
  }
  const targetReal = await realpath(targetPath);
  if (!inside(baseReal, targetReal)) throw new Error(`Local-sensitive source escaped .skillmap after realpath resolution: ${targetPath}`);
}

function buildEvalSummary(evalReport: Record<string, unknown> | undefined): SafeExportEnvelope['payload']['evalSummary'] {
  const composition = recordValue(evalReport?.composition);
  const holdout = recordValue(evalReport?.holdout);
  const leakage = recordValue(evalReport?.leakage);
  const baseline = recordValue(evalReport?.baselineComparison);
  return {
    present: evalReport?.present === true,
    evidenceLevel: safeEvidenceLevel(evalReport?.evidenceLevel),
    releaseEvidenceEligible: evalReport?.releaseEvidenceEligible === true,
    count: numberValue(evalReport?.count),
    top1Rate: nullableNumberValue(evalReport?.top1Rate),
    top3Rate: nullableNumberValue(evalReport?.top3Rate),
    avoidHits: numberValue(evalReport?.avoidHits),
    effectiveRevisionDigest: nullableSafeDigest(evalReport?.effectiveRevisionDigest),
    composition: {
      total: numberValue(composition?.total),
      explicit: numberValue(composition?.explicit),
      implicitNatural: numberValue(composition?.implicitNatural),
      multiSkill: numberValue(composition?.multiSkill),
      negativeNearMiss: numberValue(composition?.negativeNearMiss),
      untyped: numberValue(composition?.untyped),
      releaseCounted: numberValue(composition?.releaseCounted),
      releaseScored: numberValue(composition?.releaseScored)
    },
    holdout: {
      count: numberValue(holdout?.count),
      requiredCount: numberValue(holdout?.requiredCount),
      ratio: numberValue(holdout?.ratio),
      pass: holdout?.pass === true
    },
    leakage: { count: numberValue(leakage?.count), pass: leakage?.pass === true },
    baselinePass: baseline?.pass === true
  };
}

function duplicateNameCount(skills: Array<Record<string, unknown>>): number {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const name = firstString(skill.displayName, skill.name);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function safeTier(value: unknown): SafeExportEnvelope['payload']['skills'][number]['tier'] {
  return typeof value === 'string' && TIERS.has(value) ? value as SafeExportEnvelope['payload']['skills'][number]['tier'] : 'specialist';
}

function safeDigest(primary: unknown, legacy: unknown, fallback: unknown): string {
  const declared = firstString(primary, legacy);
  if (declared && /^sha256:[0-9a-f]{64}$/.test(declared)) return declared;
  if (declared && /^[0-9a-f]{64}$/.test(declared)) return `sha256:${declared}`;
  return computeTransportDigest(canonicalJson(fallback));
}

function nullableSafeDigest(value: unknown): string | null {
  const declared = firstString(value);
  return declared && /^sha256:[0-9a-f]{64}$/.test(declared) ? declared : null;
}

function safeSourceState(record: Record<string, unknown> | undefined): SafeExportEnvelope['payload']['skills'][number]['sourceState'] {
  if (!record) return 'unclassified';
  if (record.error) return 'error';
  switch (record.state) {
    case 'external-clean': return 'clean';
    case 'external-modified': return 'modified';
    case 'local-modified': return 'modified';
    case 'external-stale': return 'stale';
    case 'external-risky-update': return 'risky';
    case 'local-authored': return 'local';
    default: return record.risk === 'high' ? 'risky' : 'unknown';
  }
}

function safeReviewStatus(record: Record<string, unknown> | undefined, decision: Record<string, unknown> | undefined): SafeExportEnvelope['payload']['skills'][number]['reviewStatus'] {
  const requiresImmutableTree = Boolean(record && (
    ['external-modified', 'external-stale', 'external-risky-update'].includes(String(record.state ?? ''))
    || record.risk === 'high'
    || record.upstreamManifestDigest
    || record.upstreamCommit
    || record.upstreamContentRevision
  ));
  const receiptMatches = Boolean(record && decision
    && decision.appliesToState === record.state
    && (!requiresImmutableTree || Boolean(record.upstreamManifestDigest && record.upstreamCommit))
    && (!record.currentHash || decision.currentHash === record.currentHash)
    && (!record.upstreamHash || decision.upstreamHash === record.upstreamHash)
    && (!record.upstreamManifestDigest || decision.upstreamManifestDigest === record.upstreamManifestDigest)
    && (!record.upstreamCommit || decision.upstreamCommit === record.upstreamCommit)
    && (!record.upstreamContentRevision || decision.upstreamContentRevision === record.upstreamContentRevision)
    && (!record.contentRevision || decision.contentRevision === record.contentRevision));
  if (receiptMatches && decision?.decision === 'hold') return 'held';
  if (receiptMatches && (decision?.decision === 'accepted' || decision?.decision === 'ignore')) return 'reviewed';
  const sourceState = safeSourceState(record);
  if (sourceState === 'clean' || sourceState === 'local') return 'reviewed';
  return record ? 'needs-review' : 'none';
}

function safeModelVerification(value: unknown): SafeExportEnvelope['payload']['curationSummary']['modelVerification'] {
  return typeof value === 'string' && MODEL_VERIFICATION.has(value)
    ? value as SafeExportEnvelope['payload']['curationSummary']['modelVerification']
    : null;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function findQualifiedRecord(skill: Record<string, unknown>, records: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  const skillId = firstString(skill.skillId, skill.id);
  const localPath = firstString(skill.path);
  const displayName = firstString(skill.displayName, skill.name);
  if (skillId) {
    const exact = records.find((record) => record.skillId === skillId);
    if (exact) return exact;
  }
  if (localPath) {
    const exact = records.find((record) => !record.skillId && record.localPath === localPath && (!displayName || record.skill === displayName));
    if (exact) return exact;
  }
  const legacy = records.filter((record) => !record.skillId && !record.localPath && displayName && record.skill === displayName);
  return legacy.length === 1 ? legacy[0] : undefined;
}

function safeDisplayName(value: string | undefined, skill: Record<string, unknown>): string {
  if (value && /^[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,159}$/.test(value) && !containsSecret(value) && !containsPathLike(value)) return value;
  return `redacted-skill-${computeTransportDigest(canonicalJson({ skillId: firstString(skill.skillId, skill.id), contentRevision: firstString(skill.contentRevision, skill.hash) })).replace('sha256:', '').slice(0, 16)}`;
}

function safeProducerVersion(value: unknown): string {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,79}$/.test(value) ? value : '0.0.0-unknown';
}

function safeEvidenceLevel(value: unknown): string | null {
  return typeof value === 'string' && ['demo', 'smoke', 'candidate', 'release'].includes(value) ? value : null;
}

function containsSecret(value: string): boolean {
  return /CANARY_/i.test(value)
    || /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b/.test(value)
    || /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/.test(value)
    || /\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(value)
    || /\bAKIA[0-9A-Z]{16}\b/.test(value);
}

function containsPathLike(value: string): boolean {
  return /\bfile:\/\//i.test(value)
    || /(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])[A-Za-z]:[\\/][^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])\\\\[^\s"'<>),;]+/.test(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nullableNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function objectSize(value: unknown): number {
  return recordValue(value) ? Object.keys(value as Record<string, unknown>).length : 0;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
