import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { LOCAL_QUARANTINE_OUTCOMES, type LocalQuarantineOutcomeV1 } from '../contracts/local-quarantine-registry.js';
import type {
  CandidateSnapshot,
  DestinationReservation,
  QuarantineFixtureClass,
  QuarantinePreflightResult,
  RootCapability
} from './quarantine-types.js';

const ROOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DATE_UTC = /^\d{4}-\d{2}-\d{2}$/;

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function fail(code: keyof typeof LOCAL_QUARANTINE_OUTCOMES): QuarantinePreflightResult {
  return { ok: false, outcome: LOCAL_QUARANTINE_OUTCOMES[code] };
}

function errno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function assertIdentifier(value: string, label: string): void {
  if (!ROOT_ID.test(value)) throw new Error(`${label} is invalid.`);
}

function assertRelativePath(value: string): string[] {
  if (!value || value !== value.normalize('NFC') || path.isAbsolute(value) || value.includes('\\')) {
    throw new Error('Candidate must use one normalized relative path.');
  }
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f]/u.test(part))) {
    throw new Error('Candidate relative path contains an unsafe component.');
  }
  return parts;
}

function contained(root: string, candidate: string, allowRoot = false): boolean {
  const relative = path.relative(root, candidate);
  return (allowRoot || Boolean(relative))
    && !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`);
}

function escapeComponent(value: string): string {
  return `p-${Buffer.from(value.normalize('NFC'), 'utf8').toString('base64url')}`;
}

function escapeRelativePath(value: string): string {
  return assertRelativePath(value).map(escapeComponent).join('/');
}

async function assertCapabilityCurrent(capability: RootCapability): Promise<void> {
  const stats = await lstat(capability.configuredPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Root capability must name a non-symlink directory.');
  const currentRealPath = await realpath(capability.configuredPath);
  if (currentRealPath !== capability.canonicalRootPath
    || stats.dev !== capability.volumeId
    || stats.ino !== capability.rootFileId) {
    throw new Error('Root capability is stale.');
  }
}

async function snapshotCandidate(root: RootCapability, relativePath: string, observedAt: string): Promise<CandidateSnapshot> {
  const parts = assertRelativePath(relativePath);
  let current = root.canonicalRootPath;
  let stats = await lstat(current);
  for (const part of parts) {
    current = path.join(current, part);
    stats = await lstat(current);
    if (stats.isSymbolicLink()) throw new Error('Candidate path contains a symbolic link.');
  }
  if (!stats.isFile() && !stats.isDirectory()) throw new Error('Candidate must be one regular file or directory.');
  const canonicalSourcePath = await realpath(current);
  if (!contained(root.canonicalRootPath, canonicalSourcePath)) throw new Error('Candidate escaped its approved root.');
  const escapedRelativePath = escapeRelativePath(relativePath);
  const sourceKind = stats.isFile() ? 'file' : 'directory';
  const snapshotBase = {
    rootId: root.rootId,
    escapedRelativePath,
    sourceFileId: stats.ino,
    sourceVolumeId: stats.dev,
    sourceKind,
    size: stats.size,
    mode: stats.mode,
    modifiedAtMs: stats.mtimeMs,
    changedAtMs: stats.ctimeMs
  } as const;
  return {
    candidateId: digest({ kind: 'skillmap.quarantine-candidate.v1', ...snapshotBase }),
    ...snapshotBase,
    relativePath,
    canonicalSourcePath,
    snapshotDigest: digest({ kind: 'skillmap.quarantine-snapshot.v1', ...snapshotBase }),
    observedAt
  };
}

export async function establishRootCapability(input: {
  rootId: string;
  configuredPath: string;
  fixtureClass: QuarantineFixtureClass;
  policyVersion: string;
  now?: Date;
}): Promise<RootCapability> {
  assertIdentifier(input.rootId, 'rootId');
  assertIdentifier(input.policyVersion, 'policyVersion');
  if (input.fixtureClass !== 'copied_fixture' && input.fixtureClass !== 'synthetic_fixture') {
    throw new Error('Only copied or synthetic fixture roots are eligible.');
  }
  const stats = await lstat(input.configuredPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Root capability must name a non-symlink directory.');
  const canonicalRootPath = await realpath(input.configuredPath);
  return {
    rootId: input.rootId,
    configuredPath: path.resolve(input.configuredPath),
    canonicalRootPath,
    volumeId: stats.dev,
    rootFileId: stats.ino,
    fixtureClass: input.fixtureClass,
    policyVersion: input.policyVersion,
    establishedAt: (input.now ?? new Date()).toISOString()
  };
}

export function assertSameVolume(sourceVolume: number, destinationVolume: number): LocalQuarantineOutcomeV1 | undefined {
  return sourceVolume === destinationVolume ? undefined : LOCAL_QUARANTINE_OUTCOMES.CROSS_VOLUME_NOT_ATOMIC;
}

export async function preflightQuarantine(input: {
  sourceRoot: RootCapability;
  quarantineRoot: RootCapability;
  candidates: readonly string[];
  operationId: string;
  reservationNonce: string;
  dateUtc: string;
  atomicMoveAvailable: boolean;
  now?: Date;
}): Promise<QuarantinePreflightResult> {
  if (input.candidates.length !== 1) return fail('OWNER_PILOT_CARDINALITY_DENIED');
  if (!input.atomicMoveAvailable) return fail('ATOMIC_MOVE_UNSUPPORTED');
  assertIdentifier(input.operationId, 'operationId');
  assertIdentifier(input.reservationNonce, 'reservationNonce');
  if (!DATE_UTC.test(input.dateUtc) || Number.isNaN(Date.parse(`${input.dateUtc}T00:00:00.000Z`))) {
    throw new Error('dateUtc is invalid.');
  }
  await Promise.all([assertCapabilityCurrent(input.sourceRoot), assertCapabilityCurrent(input.quarantineRoot)]);
  if (input.sourceRoot.rootId === input.quarantineRoot.rootId) throw new Error('Source and quarantine roots must be distinct.');
  if (contained(input.sourceRoot.canonicalRootPath, input.quarantineRoot.canonicalRootPath, true)
    || contained(input.quarantineRoot.canonicalRootPath, input.sourceRoot.canonicalRootPath, true)) {
    throw new Error('Source and quarantine roots must not contain each other.');
  }
  const volumeFailure = assertSameVolume(input.sourceRoot.volumeId, input.quarantineRoot.volumeId);
  if (volumeFailure) return { ok: false, outcome: volumeFailure };

  const observedAt = (input.now ?? new Date()).toISOString();
  const snapshot = await snapshotCandidate(input.sourceRoot, input.candidates[0]!, observedAt);
  const escapedParts = snapshot.escapedRelativePath.split('/');
  const leaf = escapedParts.pop()!;
  const destinationParentPath = path.join(
    input.quarantineRoot.canonicalRootPath,
    input.sourceRoot.rootId,
    input.dateUtc,
    ...escapedParts
  );
  if (!contained(input.quarantineRoot.canonicalRootPath, destinationParentPath)) {
    throw new Error('Destination escaped its approved quarantine root.');
  }

  for (let index = 0; index < 100; index += 1) {
    const destinationLeaf = index === 0 ? leaf : `${leaf}.${index}`;
    const destinationPath = path.join(destinationParentPath, destinationLeaf);
    const occupied = await lstat(destinationPath).then(() => true).catch((error: unknown) => {
      if (errno(error, 'ENOENT')) return false;
      throw error;
    });
    if (occupied) continue;
    const escapedDestinationRelativePath = [
      input.sourceRoot.rootId,
      input.dateUtc,
      ...escapedParts,
      destinationLeaf
    ].join('/');
    const reservationBase = {
      quarantineRootId: input.quarantineRoot.rootId,
      escapedDestinationRelativePath,
      collisionCandidateIndex: index,
      collisionCandidateCount: 100 as const,
      collisionAlgorithm: 'unsuffixed-then-dot-decimal' as const,
      collisionAlgorithmVersion: 1 as const,
      operationId: input.operationId,
      reservationNonce: input.reservationNonce
    };
    const reservation: DestinationReservation = {
      ...reservationBase,
      destinationIdentityDigest: digest({ kind: 'skillmap.quarantine-destination.v1', ...reservationBase })
    };
    const preflightDigest = digest({
      kind: 'skillmap.quarantine-preflight.v1',
      sourceRootId: input.sourceRoot.rootId,
      sourceRootVolumeId: input.sourceRoot.volumeId,
      sourceRootFileId: input.sourceRoot.rootFileId,
      quarantineRootId: input.quarantineRoot.rootId,
      quarantineRootVolumeId: input.quarantineRoot.volumeId,
      quarantineRootFileId: input.quarantineRoot.rootFileId,
      policyVersion: input.sourceRoot.policyVersion,
      snapshotDigest: snapshot.snapshotDigest,
      destinationIdentityDigest: reservation.destinationIdentityDigest,
      operationId: input.operationId,
      reservationNonce: input.reservationNonce
    });
    return {
      ok: true,
      policyVersion: input.sourceRoot.policyVersion,
      sourcePath: snapshot.canonicalSourcePath,
      destinationPath,
      destinationParentPath,
      sourceRootRealPath: input.sourceRoot.canonicalRootPath,
      quarantineRootRealPath: input.quarantineRoot.canonicalRootPath,
      sourceRootVolumeId: input.sourceRoot.volumeId,
      sourceRootFileId: input.sourceRoot.rootFileId,
      quarantineRootVolumeId: input.quarantineRoot.volumeId,
      quarantineRootFileId: input.quarantineRoot.rootFileId,
      snapshot,
      reservation,
      preflightDigest
    };
  }
  return fail('OWNER_PILOT_DESTINATION_COLLISION_EXHAUSTED');
}
