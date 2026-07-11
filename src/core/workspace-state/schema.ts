import { canonicalJson, computePayloadDigest, verifyPayloadDigest, withPayloadDigest } from '../canonical-payload.js';
import { assertContract } from '../../contracts/validate.js';
import { hashBytes, workspaceStateArtifactReadLimit, WORKSPACE_STATE_READ_LIMITS } from './durability.js';
import { RevisionValidationError, WorkspaceStateError } from './errors.js';
import { artifactRule, DIGEST_PATTERN, normalizeArtifactPath, REVISION_ID_PATTERN, revisionSequence, UUID_PATTERN } from './paths.js';
import type {
  FenceState,
  LegacyProjectionIndex,
  LockOwner,
  RevisionArtifact,
  RoutingApprovalReceipt,
  WorkspacePointer,
  WorkspaceRevisionManifest,
  WorkspaceStateMarker
} from './types.js';

export interface RevisionDigests {
  canonicalIntentDigest: string;
  rawTruthDigest: string;
  routingSafetyDigest: string;
  readModelDigest: string;
  workspaceRevision: string;
}

const WORKSPACE_REVISION_SCHEMA = 'https://skillmap.dev/contracts/workspace-revision/v1.schema.json';

export function computeRevisionDigests(artifacts: RevisionArtifact[], effectiveRevisionDigest: string | null): RevisionDigests {
  const projection = (selected: RevisionArtifact[]) => selected
    .map((artifact) => ({
      path: artifact.path,
      role: artifact.role,
      routingCritical: artifact.routingCritical,
      bytes: artifact.bytes,
      digest: artifact.digest
    }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const canonicalIntentDigest = hashBytes(canonicalJson(projection(artifacts.filter((artifact) => artifact.role === 'canonical-intent'))));
  const rawTruthDigest = hashBytes(canonicalJson(projection(artifacts.filter((artifact) => artifact.role === 'raw-truth'))));
  const effectiveDigest = artifacts.find((artifact) => artifact.path === 'effective.json')?.digest ?? null;
  const routingSafetyDigest = hashBytes(canonicalJson({
    schemaVersion: 1,
    canonical: projection(artifacts.filter((artifact) => artifact.role === 'canonical-intent' && artifact.routingCritical)),
    rawTruth: projection(artifacts.filter((artifact) => artifact.role === 'raw-truth' && artifact.routingCritical)),
    effectiveDigest,
    effectiveRevisionDigest
  }));
  const readModelDigest = hashBytes(canonicalJson(projection(artifacts)));
  const workspaceRevision = hashBytes(canonicalJson({
    schemaVersion: 1,
    canonicalIntentDigest,
    rawTruthDigest,
    routingSafetyDigest,
    readModelDigest,
    effectiveDigest,
    effectiveRevisionDigest
  }));
  return { canonicalIntentDigest, rawTruthDigest, routingSafetyDigest, readModelDigest, workspaceRevision };
}

export function attachPayloadDigest<T extends Record<string, unknown>>(value: T): T & { payloadDigest: string } {
  return withPayloadDigest(value);
}

export function validateManifest(value: unknown): WorkspaceRevisionManifest {
  const record = strictRecord(value, 'workspace revision manifest');
  exactKeys(record, [
    'kind', 'schemaVersion', 'workspaceId', 'revisionId', 'sequence', 'parentRevisionId', 'createdAt', 'fencingToken',
    'mutation', 'canonicalIntentDigest', 'rawTruthDigest', 'routingSafetyDigest', 'readModelDigest', 'workspaceRevision',
    'effectiveDigest', 'effectiveRevisionDigest', 'artifacts', 'producer', 'compatibility', 'redaction', 'payloadDigest'
  ], 'workspace revision manifest');
  equals(record.kind, 'skillmap.workspace-revision', 'manifest kind');
  equals(record.schemaVersion, 1, 'manifest schemaVersion');
  uuid(record.workspaceId, 'manifest workspaceId');
  revisionId(record.revisionId, 'manifest revisionId');
  positiveInteger(record.sequence, 'manifest sequence');
  if (record.sequence !== revisionSequence(record.revisionId as string)) throw new Error('Manifest sequence does not match revisionId.');
  if (record.parentRevisionId !== null) revisionId(record.parentRevisionId, 'manifest parentRevisionId');
  timestamp(record.createdAt, 'manifest createdAt');
  positiveInteger(record.fencingToken, 'manifest fencingToken');
  if (record.fencingToken !== record.sequence) throw new Error('Manifest fencing token must equal its sequence.');
  validateMutation(record.mutation);
  for (const field of ['canonicalIntentDigest', 'rawTruthDigest', 'routingSafetyDigest', 'readModelDigest', 'workspaceRevision', 'payloadDigest'] as const) {
    digest(record[field], `manifest ${field}`);
  }
  if (record.effectiveDigest !== null) digest(record.effectiveDigest, 'manifest effectiveDigest');
  if (record.effectiveRevisionDigest !== null) digest(record.effectiveRevisionDigest, 'manifest effectiveRevisionDigest');
  if (!Array.isArray(record.artifacts)) throw new Error('Manifest artifacts must be an array.');
  const artifacts = record.artifacts.map((artifact, index) => validateArtifact(artifact, index));
  validateArtifactLimits(artifacts, 'Manifest');
  const sorted = [...artifacts].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  if (canonicalJson(artifacts) !== canonicalJson(sorted)) throw new Error('Manifest artifacts must be sorted by path.');
  if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) throw new Error('Manifest contains duplicate artifact paths.');
  if (new Set(artifacts.map((artifact) => artifact.path.toLowerCase())).size !== artifacts.length) {
    throw new Error('Manifest contains artifact paths that collide on case-insensitive filesystems.');
  }
  const producer = strictRecord(record.producer, 'manifest producer');
  exactKeys(producer, ['name', 'version'], 'manifest producer');
  equals(producer.name, 'skillmap', 'manifest producer.name');
  nonEmptyString(producer.version, 'manifest producer.version');
  const compatibility = strictRecord(record.compatibility, 'manifest compatibility');
  exactKeys(compatibility, ['minReaderSchemaVersion', 'maxReaderSchemaVersion'], 'manifest compatibility');
  equals(compatibility.minReaderSchemaVersion, 1, 'manifest minReaderSchemaVersion');
  equals(compatibility.maxReaderSchemaVersion, 1, 'manifest maxReaderSchemaVersion');
  const redaction = strictRecord(record.redaction, 'manifest redaction');
  exactKeys(redaction, ['classification'], 'manifest redaction');
  equals(redaction.classification, 'local-sensitive', 'manifest redaction.classification');
  verifyPayloadDigest(record);
  const computed = computeRevisionDigests(artifacts, record.effectiveRevisionDigest as string | null);
  for (const [field, expected] of Object.entries(computed)) {
    if (record[field] !== expected) throw new Error(`Manifest ${field} does not match its artifact projection.`);
  }
  const effectiveArtifactDigest = artifacts.find((artifact) => artifact.path === 'effective.json')?.digest ?? null;
  if (record.effectiveDigest !== effectiveArtifactDigest) throw new Error('Manifest effectiveDigest does not match the immutable effective.json artifact digest.');
  assertContract(WORKSPACE_REVISION_SCHEMA, record);
  return { ...(record as unknown as WorkspaceRevisionManifest), artifacts };
}

export function validatePointer(value: unknown, expectedKind?: WorkspacePointer['kind']): WorkspacePointer {
  const record = strictRecord(value, 'workspace pointer');
  const kind = record.kind;
  if (kind !== 'skillmap.workspace-current' && kind !== 'skillmap.workspace-last-known-good') throw new Error('Unsupported workspace pointer kind.');
  const required = [
    'kind', 'schemaVersion', 'workspaceId', 'revisionId', 'sequence', 'workspaceRevision', 'manifestDigest',
    'canonicalIntentDigest', 'rawTruthDigest', 'routingSafetyDigest', 'readModelDigest', 'effectiveDigest', 'effectiveRevisionDigest', 'fencingToken', 'publishedAt', 'payloadDigest'
  ];
  if (kind === 'skillmap.workspace-last-known-good') required.push('routingApproval');
  exactKeys(record, required, 'workspace pointer');
  if (expectedKind) equals(kind, expectedKind, 'workspace pointer kind');
  equals(record.schemaVersion, 1, 'workspace pointer schemaVersion');
  uuid(record.workspaceId, 'workspace pointer workspaceId');
  revisionId(record.revisionId, 'workspace pointer revisionId');
  positiveInteger(record.sequence, 'workspace pointer sequence');
  if (record.sequence !== revisionSequence(record.revisionId as string)) throw new Error('Pointer sequence does not match revisionId.');
  positiveInteger(record.fencingToken, 'workspace pointer fencingToken');
  if (record.fencingToken !== record.sequence) throw new Error('Pointer fencing token must equal its sequence.');
  timestamp(record.publishedAt, 'workspace pointer publishedAt');
  for (const field of ['workspaceRevision', 'manifestDigest', 'canonicalIntentDigest', 'rawTruthDigest', 'routingSafetyDigest', 'readModelDigest', 'payloadDigest'] as const) {
    digest(record[field], `workspace pointer ${field}`);
  }
  if (record.effectiveDigest !== null) digest(record.effectiveDigest, 'workspace pointer effectiveDigest');
  if (record.effectiveRevisionDigest !== null) digest(record.effectiveRevisionDigest, 'workspace pointer effectiveRevisionDigest');
  if (kind === 'skillmap.workspace-last-known-good' && (record.effectiveDigest === null || record.effectiveRevisionDigest === null)) {
    throw new Error('Last-known-good pointer requires non-null effectiveDigest and effectiveRevisionDigest.');
  }
  if (kind === 'skillmap.workspace-last-known-good') validateRoutingApproval(record.routingApproval, record.revisionId as string, record.routingSafetyDigest as string);
  verifyPayloadDigest(record);
  assertContract(WORKSPACE_REVISION_SCHEMA, record);
  return record as unknown as WorkspacePointer;
}

export function validateMarker(value: unknown): WorkspaceStateMarker {
  const record = strictRecord(value, 'workspace state marker');
  exactKeys(record, ['kind', 'schemaVersion', 'layoutVersion', 'workspaceId', 'migrationRevisionId', 'activatedAt', 'legacyMode', 'payloadDigest'], 'workspace state marker');
  equals(record.kind, 'skillmap.workspace-state', 'state marker kind');
  equals(record.schemaVersion, 1, 'state marker schemaVersion');
  equals(record.layoutVersion, 1, 'state marker layoutVersion');
  uuid(record.workspaceId, 'state marker workspaceId');
  revisionId(record.migrationRevisionId, 'state marker migrationRevisionId');
  timestamp(record.activatedAt, 'state marker activatedAt');
  equals(record.legacyMode, 'read-only-projection', 'state marker legacyMode');
  digest(record.payloadDigest, 'state marker payloadDigest');
  verifyPayloadDigest(record);
  assertContract(WORKSPACE_REVISION_SCHEMA, record);
  return record as unknown as WorkspaceStateMarker;
}

export function validateFence(value: unknown): FenceState {
  const record = strictRecord(value, 'workspace fence');
  exactKeys(record, ['kind', 'schemaVersion', 'token', 'updatedAt', 'payloadDigest'], 'workspace fence');
  equals(record.kind, 'skillmap.workspace-fence', 'fence kind');
  equals(record.schemaVersion, 1, 'fence schemaVersion');
  nonNegativeInteger(record.token, 'fence token');
  timestamp(record.updatedAt, 'fence updatedAt');
  digest(record.payloadDigest, 'fence payloadDigest');
  verifyPayloadDigest(record);
  return record as unknown as FenceState;
}

export function validateLockOwner(value: unknown): LockOwner {
  const record = strictRecord(value, 'workspace writer lock');
  exactKeys(record, ['kind', 'schemaVersion', 'ownerId', 'pid', 'hostname', 'operation', 'acquiredAt', 'expiresAt', 'fencingToken', 'payloadDigest'], 'workspace writer lock');
  equals(record.kind, 'skillmap.workspace-writer-lock', 'lock kind');
  equals(record.schemaVersion, 1, 'lock schemaVersion');
  uuid(record.ownerId, 'lock ownerId');
  positiveInteger(record.pid, 'lock pid');
  nonEmptyString(record.hostname, 'lock hostname');
  nonEmptyString(record.operation, 'lock operation');
  timestamp(record.acquiredAt, 'lock acquiredAt');
  timestamp(record.expiresAt, 'lock expiresAt');
  positiveInteger(record.fencingToken, 'lock fencingToken');
  digest(record.payloadDigest, 'lock payloadDigest');
  verifyPayloadDigest(record);
  return record as unknown as LockOwner;
}

export function validateProjectionIndex(value: unknown): LegacyProjectionIndex {
  const record = strictRecord(value, 'legacy projection index');
  exactKeys(record, ['kind', 'schemaVersion', 'workspaceId', 'revisionId', 'generatedAt', 'artifacts', 'payloadDigest'], 'legacy projection index');
  equals(record.kind, 'skillmap.legacy-projection-index', 'projection index kind');
  equals(record.schemaVersion, 1, 'projection index schemaVersion');
  uuid(record.workspaceId, 'projection index workspaceId');
  revisionId(record.revisionId, 'projection index revisionId');
  timestamp(record.generatedAt, 'projection index generatedAt');
  if (!Array.isArray(record.artifacts)) throw new Error('Projection index artifacts must be an array.');
  const artifacts = record.artifacts.map((artifact, index) => validateArtifact(artifact, index));
  validateArtifactLimits(artifacts, 'Projection index');
  digest(record.payloadDigest, 'projection index payloadDigest');
  verifyPayloadDigest(record);
  return { ...(record as unknown as LegacyProjectionIndex), artifacts };
}

export function makeRoutingApproval(revisionIdValue: string, safetyDigest: string, approvedAt: string): RoutingApprovalReceipt {
  revisionId(revisionIdValue, 'routing approval revisionId');
  digest(safetyDigest, 'routing approval safety digest');
  timestamp(approvedAt, 'routing approval approvedAt');
  const base = {
    kind: 'skillmap.routing-approval' as const,
    schemaVersion: 1 as const,
    revisionId: revisionIdValue,
    routingSafetyDigest: safetyDigest,
    approvedAt
  };
  return { ...base, receiptDigest: hashBytes(canonicalJson(base)) };
}

export function manifestPointerMismatch(pointer: WorkspacePointer, manifest: WorkspaceRevisionManifest): string | undefined {
  const fields: Array<keyof Pick<WorkspacePointer, 'workspaceId' | 'revisionId' | 'sequence' | 'workspaceRevision' | 'canonicalIntentDigest' | 'rawTruthDigest' | 'routingSafetyDigest' | 'readModelDigest' | 'effectiveDigest' | 'effectiveRevisionDigest' | 'fencingToken'>> = [
    'workspaceId', 'revisionId', 'sequence', 'workspaceRevision', 'canonicalIntentDigest', 'rawTruthDigest', 'routingSafetyDigest', 'readModelDigest', 'effectiveDigest', 'effectiveRevisionDigest', 'fencingToken'
  ];
  for (const field of fields) if (pointer[field] !== manifest[field]) return field;
  return undefined;
}

function validateArtifact(value: unknown, index: number): RevisionArtifact {
  const record = strictRecord(value, `manifest artifact ${index}`);
  exactKeys(record, ['path', 'role', 'routingCritical', 'bytes', 'digest'], `manifest artifact ${index}`);
  nonEmptyString(record.path, `manifest artifact ${index}.path`);
  const normalized = normalizeArtifactPath(record.path as string);
  const rule = artifactRule(normalized);
  if (!rule) throw new RevisionValidationError('STATE_ARTIFACT_NOT_ALLOWED', `Manifest artifact is outside the strict allowlist: ${normalized}`, normalized);
  if (record.role !== rule.role || record.routingCritical !== rule.routingCritical) {
    throw new RevisionValidationError('STATE_ARTIFACT_ROLE_MISMATCH', `Manifest artifact role does not match its allowlist rule: ${normalized}`, normalized, rule.role);
  }
  nonNegativeInteger(record.bytes, `manifest artifact ${index}.bytes`);
  if ((record.bytes as number) > workspaceStateArtifactReadLimit(rule.role)) {
    throw new RevisionValidationError(
      'STATE_ARTIFACT_TOO_LARGE',
      `Manifest artifact exceeds its ${rule.role} byte limit: ${normalized}`,
      normalized,
      rule.role
    );
  }
  digest(record.digest, `manifest artifact ${index}.digest`);
  return { path: normalized, role: rule.role, routingCritical: rule.routingCritical, bytes: record.bytes as number, digest: record.digest as string };
}

function validateArtifactLimits(artifacts: RevisionArtifact[], label: string): void {
  const total = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  if (!Number.isSafeInteger(total) || total > WORKSPACE_STATE_READ_LIMITS.totalArtifactBytes) {
    throw new RevisionValidationError('STATE_ARTIFACT_TOTAL_TOO_LARGE', `${label} artifacts exceed the aggregate state byte limit.`);
  }
}

function validateMutation(value: unknown): void {
  const record = strictRecord(value, 'revision mutation');
  const allowed = new Set(['kind', 'actor', 'reason', 'sourceRevisionId', 'targetRevisionId']);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`Unknown revision mutation field: ${key}`);
  if (!['legacy-migration', 'legacy-snapshot', 'rollback', 'recovery'].includes(String(record.kind))) throw new Error('Unsupported revision mutation kind.');
  for (const field of ['actor', 'reason'] as const) if (record[field] !== undefined) nonEmptyString(record[field], `revision mutation ${field}`);
  for (const field of ['sourceRevisionId', 'targetRevisionId'] as const) if (record[field] !== undefined) revisionId(record[field], `revision mutation ${field}`);
}

function validateRoutingApproval(value: unknown, expectedRevisionId: string, expectedSafetyDigest: string): void {
  const record = strictRecord(value, 'routing approval');
  exactKeys(record, ['kind', 'schemaVersion', 'revisionId', 'routingSafetyDigest', 'approvedAt', 'receiptDigest'], 'routing approval');
  equals(record.kind, 'skillmap.routing-approval', 'routing approval kind');
  equals(record.schemaVersion, 1, 'routing approval schemaVersion');
  equals(record.revisionId, expectedRevisionId, 'routing approval revisionId');
  equals(record.routingSafetyDigest, expectedSafetyDigest, 'routing approval safety digest');
  timestamp(record.approvedAt, 'routing approval approvedAt');
  digest(record.receiptDigest, 'routing approval receiptDigest');
  const { receiptDigest, ...base } = record;
  if (record.receiptDigest !== hashBytes(canonicalJson(base))) throw new Error('Routing approval receipt digest does not validate.');
}

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: string[], label: string): void {
  const expected = new Set(keys);
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(record, key));
  const extra = Object.keys(record).filter((key) => !expected.has(key));
  if (missing.length || extra.length) throw new Error(`${label} has invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}).`);
}

function equals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label} must equal ${String(expected)}.`);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function timestamp(value: unknown, label: string): void {
  nonEmptyString(value, label);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp.`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw new Error(`${label} must be a lowercase sha256 digest.`);
}

function uuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`${label} must be an opaque UUID.`);
}

function revisionId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !REVISION_ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
}

export function wrapSchemaError(code: string, message: string, error: unknown): WorkspaceStateError {
  return new WorkspaceStateError(code, `${message}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}
