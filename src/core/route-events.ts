import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { assertContract } from '../contracts/validate.js';
import { withPayloadDigest, verifyPayloadDigest } from './canonical-payload.js';
import { hashText } from './fs.js';
import { assertQualifiedInventory } from './identity.js';
import { readRegularFile, workspaceStateArtifactReadLimit } from './workspace-state/durability.js';
import { revisionArtifactPath, workspaceStatePaths } from './workspace-state/paths.js';
import { validateRevision } from './workspace-state/revision.js';
import type { RevisionRef, RouteEventV1, RouteFeedbackV1, RouteOutcome, RouteResultV2, RouteSurface } from '../schemas/types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SKILL_ID = /^sk_[A-Za-z0-9_-]{43}$/;
const DATE_PARTITION = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_FILE = /^(?:([0-9]{13})-)?([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i;
const INDEX_ANCHOR_FILE = /^[0-9a-f]{64}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.repair)?\.json$/i;
export const ROUTE_EVENT_RETENTION_DAYS = 90;
export const ROUTE_EVENT_MAX_RECORDS = 10_000;
export const ROUTE_EVENT_MAX_PARTITIONS = 90;
export const ROUTE_EVENT_MAX_FILES_PER_PARTITION = 10_512;
const MAX_EVENT_FILE_BYTES = 64 * 1024;
const MAX_INDEX_FILE_BYTES = 96 * 1024;
const MAX_INDEX_DIRECTORY_ENTRIES = 8;
const MAX_MAINTENANCE_DELETES = 512;
const MAX_MAINTENANCE_ROOT_ENTRIES = 512;
const MAX_LEDGER_LOCK_ATTEMPTS = 200;
const LEDGER_LOCK_LEASE_MS = 30_000;
const MAX_LEDGER_QUEUE_DEPTH = 64;
const routeLedgerQueues = new Map<string, { tail: Promise<void>; pending: number }>();
const MAX_EVENT_CLOCK_SKEW_MS = 5 * 60_000;
const FEEDBACK_OUTCOMES = ['correct', 'wrong', 'missing', 'unsafe'] as const;
const EVENT_SCHEMA = 'https://skillmap.dev/contracts/event/v1.schema.json';
const FEEDBACK_SCHEMA = 'https://skillmap.dev/contracts/route-feedback/v1.schema.json';

export interface RouteEventLedgerOptions {
  now?: Date;
  retentionDays?: number;
  maxRecords?: number;
  maxPartitions?: number;
  maxFilesPerPartition?: number;
}

interface ResolvedRouteEventLedgerOptions {
  now: Date;
  retentionDays: number;
  maxRecords: number;
  maxPartitions: number;
  maxFilesPerPartition: number;
}

interface RouteEventFileRef {
  day: string;
  fileName: string;
  file: string;
  key: string;
}

interface RouteEventIndexRecord {
  kind: 'skillmap.route-event-index';
  schemaVersion: 1;
  routeIdHash: string;
  event: RouteEventV1;
  payloadDigest: string;
}

export interface RouteEventMaintenanceResult {
  retainedRecords: number;
  prunedRecords: number;
  prunedPartitions: number;
  truncated: boolean;
}

export interface RouteEventIndexRebuildResult extends RouteEventMaintenanceResult {
  scannedRecords: number;
  indexedRecords: number;
  invalidRecords: number;
}

export interface RouteEventPage {
  events: RouteEventV1[];
  nextCursor: string | null;
  total: number;
}

export interface RouteFeedbackBacklog {
  reviewedRoutes: number;
  pendingRoutes: number;
  recordedFeedback: number;
  outcomeCounts: Record<RouteFeedbackV1['outcome'], number>;
  pendingRouteIds: string[];
}

export class RouteFeedbackInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'RouteFeedbackInputError'; this.code = code; }
}

export class RouteEventLookupError extends Error {
  readonly code: 'ROUTE_EVENT_ID_INVALID' | 'ROUTE_EVENT_NOT_FOUND';
  constructor(code: 'ROUTE_EVENT_ID_INVALID' | 'ROUTE_EVENT_NOT_FOUND', message: string) {
    super(message);
    this.name = 'RouteEventLookupError';
    this.code = code;
  }
}

export function createRouteEvent(
  result: RouteResultV2,
  currentRevision: RevisionRef,
  surface: RouteSurface,
  outcome?: RouteOutcome
): RouteEventV1 {
  const decision = result.decision;
  const selectedSkillIds = decision.recommendations.map((item) => item.skillId).slice(0, 10);
  const event = withPayloadDigest({
    kind: 'skillmap.route-event' as const,
    schemaVersion: 1 as const,
    eventId: randomUUID(),
    routeId: result.routeId,
    createdAt: result.createdAt,
    revision: decision.revision,
    currentRevision,
    surface,
    outcome: outcome ?? (decision.warningState === 'blocked'
      ? 'blocked'
      : selectedSkillIds.length > 0 ? 'recommended' : 'abstained'),
    selectedSkillIds,
    reasonCodes: [...new Set(decision.recommendations.flatMap((item) => item.reasonCodes))].sort().slice(0, 32),
    warningCodes: [...new Set(decision.warningCodes)].sort().slice(0, 32),
    latencyBucket: latencyBucket(result.latencyMs),
    ...(decision.servingMode === 'last-known-good' ? { degradedCode: 'serving-last-known-good' } : {}),
    decisionDigest: result.decisionDigest,
    promptStored: false as const
  });
  assertRouteEvent(event);
  return event;
}

export async function recordRouteEvent(cwd: string, event: RouteEventV1, options: RouteEventLedgerOptions = {}): Promise<void> {
  await withRouteLedgerLock(cwd, () => recordRouteEventLocked(cwd, event, resolveLedgerOptions(options)));
}

async function recordRouteEventLocked(cwd: string, event: RouteEventV1, limits: ResolvedRouteEventLedgerOptions): Promise<void> {
  assertRouteEvent(event);
  assertEventWithinRetention(event, limits);
  const file = publicRouteEventFile(cwd, event);
  let existing = await readExistingRouteEvent(file);
  if (!existing) {
    const legacyFile = legacyPublicRouteEventFile(cwd, event);
    existing = await readExistingRouteEvent(legacyFile);
    if (existing) {
      if (existing.payloadDigest !== event.payloadDigest) throw new Error('Legacy route event public record conflicts with the submitted event.');
      await ensureSafeOperationalDirectory(path.dirname(file));
      await rename(legacyFile, file);
      await syncDirectory(path.dirname(file));
    }
  }
  if (!existing) {
    const maintenance = await maintainRouteEventLedgerInternal(cwd, limits);
    if (maintenance.result.truncated) throw new Error('Route event ledger requires bounded maintenance before another event can be admitted.');
    if (maintenance.files.length >= limits.maxRecords) {
      const oldest = maintenance.files.at(-1);
      if (!oldest || !(await pruneEventFile(cwd, oldest))) throw new Error('Route event ledger could not reserve bounded capacity for a new event.');
    }
  }
  try {
    await durableExclusiveJson(file, event);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readBoundedJson(file, MAX_EVENT_FILE_BYTES);
    assertRouteEvent(existing);
    if (existing.payloadDigest !== event.payloadDigest) throw new Error('Route event public record conflicts with its durable index anchor.');
  }
  // The canonical redacted event is written first. If the process stops before
  // indexing, bounded legacy lookup/rebuild can recover it; the inverse order
  // would leave index-only anchors that date-partition retention cannot find.
  await ensureRouteEventIndex(cwd, event);
}

export async function readRouteEvents(cwd: string, options: { limit?: number; cursor?: string } & RouteEventLedgerOptions = {}): Promise<RouteEventPage> {
  return withRouteLedgerLock(cwd, () => readRouteEventsLocked(cwd, options));
}

export async function readRouteEvent(cwd: string, routeId: string, options: RouteEventLedgerOptions = {}): Promise<RouteEventV1> {
  if (typeof routeId !== 'string' || !UUID.test(routeId)) {
    throw new RouteEventLookupError('ROUTE_EVENT_ID_INVALID', 'Route event routeId must be a UUID.');
  }
  return withRouteLedgerLock(cwd, async () => {
    const event = await findRouteEvent(cwd, routeId, resolveLedgerOptions(options));
    if (!event) throw new RouteEventLookupError('ROUTE_EVENT_NOT_FOUND', 'Route event was not found in the retained ledger.');
    return event;
  });
}

export async function readRouteFeedbackBacklog(cwd: string, events: RouteEventV1[]): Promise<RouteFeedbackBacklog> {
  if (!Array.isArray(events) || events.length > 100) throw new Error('Feedback backlog accepts at most 100 retained route events.');
  for (const event of events) assertRouteEvent(event);
  return withRouteLedgerLock(cwd, async () => {
    const outcomeCounts: RouteFeedbackBacklog['outcomeCounts'] = { correct: 0, wrong: 0, missing: 0, unsafe: 0 };
    const pendingRouteIds: string[] = [];
    let reviewedRoutes = 0;
    let recordedFeedback = 0;
    for (const event of events) {
      let routeFeedback = 0;
      const directory = feedbackSlotDirectory(cwd, event);
      if (await safeOperationalDirectoryExists(directory)) {
        for (const outcome of FEEDBACK_OUTCOMES) {
          try {
            const transaction = await readFeedbackTransaction(path.join(directory, `${outcome}.json`));
            if (transaction.feedback.routeId !== event.routeId || transaction.feedback.outcome !== outcome) {
              throw new Error('Feedback backlog receipt does not match its retained route slot.');
            }
            outcomeCounts[outcome] += 1;
            routeFeedback += 1;
            recordedFeedback += 1;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
          }
        }
      }
      if (routeFeedback > 0) reviewedRoutes += 1;
      else if (pendingRouteIds.length < 20) pendingRouteIds.push(event.routeId);
    }
    return {
      reviewedRoutes,
      pendingRoutes: events.length - reviewedRoutes,
      recordedFeedback,
      outcomeCounts,
      pendingRouteIds
    };
  });
}

async function readRouteEventsLocked(cwd: string, options: { limit?: number; cursor?: string } & RouteEventLedgerOptions): Promise<RouteEventPage> {
  const limit = normalizeLimit(options.limit ?? 50);
  const limits = resolveLedgerOptions(options);
  const maintenance = await maintainRouteEventLedgerInternal(cwd, limits);
  const files = maintenance.files;
  const keys = files.map((item) => item.key);
  const cursorIndex = options.cursor ? decodeCursor(options.cursor, keys) : 0;
  const pageFiles = files.slice(cursorIndex, cursorIndex + limit);
  const events: RouteEventV1[] = [];
  for (const item of pageFiles) {
    const parsed = await readBoundedJson(item.file, MAX_EVENT_FILE_BYTES);
    assertRouteEvent(parsed);
    events.push(parsed);
  }
  const nextIndex = cursorIndex + pageFiles.length;
  return { events, nextCursor: nextIndex < files.length ? encodeCursor(nextIndex, keys) : null, total: files.length };
}

export async function maintainRouteEventLedger(cwd: string, options: RouteEventLedgerOptions = {}): Promise<RouteEventMaintenanceResult> {
  return withRouteLedgerLock(cwd, async () => {
    const result = await maintainRouteEventLedgerInternal(cwd, resolveLedgerOptions(options));
    return result.result;
  });
}

export async function rebuildRouteEventIndex(cwd: string, options: RouteEventLedgerOptions = {}): Promise<RouteEventIndexRebuildResult> {
  return withRouteLedgerLock(cwd, () => rebuildRouteEventIndexLocked(cwd, options));
}

async function rebuildRouteEventIndexLocked(cwd: string, options: RouteEventLedgerOptions): Promise<RouteEventIndexRebuildResult> {
  const limits = resolveLedgerOptions(options);
  const maintenance = await maintainRouteEventLedgerInternal(cwd, limits);
  let scannedRecords = 0;
  let indexedRecords = 0;
  let invalidRecords = 0;
  for (const item of maintenance.files) {
    scannedRecords += 1;
    try {
      const event = await readBoundedJson(item.file, MAX_EVENT_FILE_BYTES);
      assertRouteEvent(event);
      if (event.eventId !== eventIdFromFileName(item.fileName) || eventDay(event) !== item.day) throw new Error('Route event locator does not match its payload.');
      await ensureRouteEventIndex(cwd, event);
      indexedRecords += 1;
    } catch {
      invalidRecords += 1;
    }
  }
  return { ...maintenance.result, scannedRecords, indexedRecords, invalidRecords };
}

export async function createAndRecordFeedback(
  cwd: string,
  request: {
    routeId: string;
    outcome: RouteFeedbackV1['outcome'];
    selectedSkillIds?: string[];
    expectedSkillIds?: string[];
    unsafeSkillIds?: string[];
    reasonCode: string;
    idempotencyKey: string;
  },
  options: RouteEventLedgerOptions = {}
): Promise<RouteFeedbackV1> {
  return withRouteLedgerLock(cwd, () => createAndRecordFeedbackLocked(cwd, request, resolveLedgerOptions(options)));
}

async function createAndRecordFeedbackLocked(
  cwd: string,
  request: {
    routeId: string;
    outcome: RouteFeedbackV1['outcome'];
    selectedSkillIds?: string[];
    expectedSkillIds?: string[];
    unsafeSkillIds?: string[];
    reasonCode: string;
    idempotencyKey: string;
  },
  limits: ResolvedRouteEventLedgerOptions
): Promise<RouteFeedbackV1> {
  if (!UUID.test(request.routeId)) throw new RouteFeedbackInputError('FEEDBACK_ROUTE_INVALID', 'Feedback routeId must be a UUID.');
  const event = await findRouteEvent(cwd, request.routeId, limits);
  if (!event) throw new RouteFeedbackInputError('FEEDBACK_ROUTE_NOT_FOUND', 'Route event was not found in the retained ledger.');
  const selectedSkillIds = uniqueSkillIds(event.selectedSkillIds);
  if (request.selectedSkillIds !== undefined) {
    const submitted = feedbackSkillIds(request.selectedSkillIds, 'selectedSkillIds');
    if (JSON.stringify(submitted) !== JSON.stringify(selectedSkillIds)) {
      throw new RouteFeedbackInputError('FEEDBACK_SELECTION_CONFLICT', 'Feedback selectedSkillIds must exactly match the recorded route event.');
    }
  }
  const expectedSkillIds = feedbackSkillIds(request.expectedSkillIds ?? [], 'expectedSkillIds');
  const unsafeSkillIds = feedbackSkillIds(request.unsafeSkillIds ?? [], 'unsafeSkillIds');
  if (expectedSkillIds.length > 0 || unsafeSkillIds.length > 0) {
    await assertFeedbackSkillBindings(cwd, event, [...expectedSkillIds, ...unsafeSkillIds]);
  }
  const expectedReasonCode = `operator-${request.outcome}`;
  if (request.reasonCode !== expectedReasonCode) throw new RouteFeedbackInputError('FEEDBACK_REASON_INVALID', `Feedback reasonCode must be ${expectedReasonCode}.`);
  let idempotencyKey: string;
  try { idempotencyKey = boundedCode(request.idempotencyKey, 'idempotencyKey', 128); }
  catch { throw new RouteFeedbackInputError('FEEDBACK_IDEMPOTENCY_INVALID', 'Feedback idempotencyKey is invalid.'); }
  const idempotencyKeyHash = hashText(`route-feedback-idempotency:${idempotencyKey}`);
  const normalized = {
    routeId: request.routeId,
    outcome: request.outcome,
    selectedSkillIds,
    expectedSkillIds,
    unsafeSkillIds,
    reasonCode: expectedReasonCode,
    idempotencyKeyHash
  };
  const requestDigest = hashText(`route-feedback-request:${JSON.stringify(normalized)}`);
  const proposed = withPayloadDigest({
    kind: 'skillmap.route-feedback' as const,
    schemaVersion: 1 as const,
    feedbackId: randomUUID(),
    routeId: request.routeId,
    createdAt: new Date().toISOString(),
    revision: event.revision,
    outcome: normalized.outcome,
    selectedSkillIds: normalized.selectedSkillIds,
    expectedSkillIds: normalized.expectedSkillIds,
    unsafeSkillIds: normalized.unsafeSkillIds,
    reasonCode: normalized.reasonCode,
    idempotencyKeyHash: normalized.idempotencyKeyHash,
    promptStored: false as const,
    commentStored: false as const
  });
  assertRouteFeedback(proposed);
  const existingIdempotency = await findFeedbackByIdempotencyKey(cwd, event, proposed.idempotencyKeyHash);
  if (existingIdempotency) {
    const transaction = await readFeedbackTransaction(existingIdempotency);
    if (transaction.requestDigest !== requestDigest) throw new RouteFeedbackInputError('FEEDBACK_IDEMPOTENCY_CONFLICT', 'Feedback idempotency key has already been used for a different request.');
    return transaction.feedback;
  }
  const feedbackFile = feedbackSlotFile(cwd, event, proposed.outcome);
  try {
    // One immutable, deterministic route/outcome slot is both the public
    // receipt and the idempotency transaction. At most four slots can exist
    // per retained route, so arbitrary idempotency keys cannot grow storage.
    await durableExclusiveJson(feedbackFile, proposed);
    return proposed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const transaction = await readFeedbackTransaction(feedbackFile);
    if (transaction.requestDigest !== requestDigest) {
      throw new RouteFeedbackInputError('FEEDBACK_OUTCOME_CONFLICT', 'Feedback for this route outcome has already been recorded with a different idempotency request.');
    }
    return transaction.feedback;
  }
}

async function findFeedbackByIdempotencyKey(cwd: string, event: RouteEventV1, idempotencyKeyHash: string): Promise<string | undefined> {
  const directory = feedbackSlotDirectory(cwd, event);
  if (!(await safeOperationalDirectoryExists(directory))) return undefined;
  for (const outcome of FEEDBACK_OUTCOMES) {
    const file = path.join(directory, `${outcome}.json`);
    try {
      const transaction = await readFeedbackTransaction(file);
      if (transaction.feedback.idempotencyKeyHash === idempotencyKeyHash) return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return undefined;
}

async function readFeedbackTransaction(file: string): Promise<{ requestDigest: string; feedback: RouteFeedbackV1 }> {
  const value = await readBoundedJson(file, MAX_INDEX_FILE_BYTES);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Feedback idempotency transaction is malformed.');
  const record = value as Record<string, unknown>;
  if ((record.version === 1 || record.version === 2) && typeof record.requestDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(record.requestDigest)) {
    assertRouteFeedback(record.feedback);
    return { requestDigest: record.requestDigest, feedback: record.feedback };
  }
  // Compatibility with pre-transaction markers: validate and derive the
  // semantic request receipt so matching retries can reconcile safely.
  assertRouteFeedback(value);
  const feedback = value;
  const requestDigest = hashText(`route-feedback-request:${JSON.stringify({
    routeId: feedback.routeId,
    outcome: feedback.outcome,
    selectedSkillIds: feedback.selectedSkillIds,
    expectedSkillIds: feedback.expectedSkillIds,
    unsafeSkillIds: feedback.unsafeSkillIds,
    reasonCode: feedback.reasonCode,
    idempotencyKeyHash: feedback.idempotencyKeyHash
  })}`);
  return { requestDigest, feedback };
}

async function assertFeedbackSkillBindings(cwd: string, event: RouteEventV1, skillIdsToValidate: string[]): Promise<void> {
  const paths = workspaceStatePaths(cwd);
  const revision = await validateRevision(paths, event.revision.revisionId);
  const manifest = revision.manifest;
  if (manifest.workspaceId !== event.revision.workspaceId
    || manifest.workspaceRevision !== event.revision.workspaceRevision
    || manifest.effectiveDigest !== event.revision.effectiveDigest
    || manifest.effectiveRevisionDigest !== event.revision.effectiveRevisionDigest) {
    throw new RouteFeedbackInputError('FEEDBACK_REVISION_CONFLICT', 'Feedback labels do not bind to the recorded immutable revision.');
  }
  const inventoryArtifact = manifest.artifacts.find((artifact) => artifact.path === 'inventory.json');
  if (!inventoryArtifact) {
    throw new RouteFeedbackInputError('FEEDBACK_REVISION_CONFLICT', 'Feedback labels require an immutable qualified inventory for the recorded revision.');
  }
  const inventory = JSON.parse((await readRegularFile(revisionArtifactPath(paths, manifest.revisionId, 'inventory.json'), {
    root: paths.skillmap,
    maxBytes: Math.min(workspaceStateArtifactReadLimit(inventoryArtifact.role), inventoryArtifact.bytes),
    label: 'Immutable feedback inventory'
  })).toString('utf8')) as unknown;
  assertQualifiedInventory(inventory, 'record expected or unsafe feedback labels');
  const known = new Set(inventory.skills.map((skill) => skill.skillId));
  if (skillIdsToValidate.some((skillId) => !known.has(skillId))) {
    throw new RouteFeedbackInputError('FEEDBACK_SKILL_BINDING_INVALID', 'Feedback expectedSkillIds and unsafeSkillIds must belong to the recorded immutable revision.');
  }
}

export function assertRouteEvent(value: unknown): asserts value is RouteEventV1 {
  const event = object(value, 'route event');
  exactKeys(event, ['kind', 'schemaVersion', 'eventId', 'routeId', 'createdAt', 'revision', 'currentRevision', 'surface', 'outcome', 'selectedSkillIds', 'reasonCodes', 'warningCodes', 'latencyBucket', 'promptStored', 'payloadDigest'], ['degradedCode', 'decisionDigest'], 'route event');
  if (event.kind !== 'skillmap.route-event' || event.schemaVersion !== 1) throw new Error('Unsupported route event contract.');
  if (typeof event.eventId !== 'string' || !UUID.test(event.eventId)) throw new Error('Route event eventId must be a UUID.');
  if (typeof event.routeId !== 'string' || !UUID.test(event.routeId)) throw new Error('Route event routeId must be a UUID.');
  timestamp(event.createdAt, 'route event createdAt');
  assertRevisionRef(event.revision, 'route event revision');
  assertRevisionRef(event.currentRevision, 'route event currentRevision');
  oneOf(event.surface, ['cli', 'hook', 'mcp', 'api'], 'route event surface');
  oneOf(event.outcome, ['recommended', 'abstained', 'blocked', 'error'], 'route event outcome');
  skillIds(event.selectedSkillIds, 'route event selectedSkillIds', 10);
  codes(event.reasonCodes, 'route event reasonCodes', 32);
  codes(event.warningCodes, 'route event warningCodes', 32);
  oneOf(event.latencyBucket, ['lt-10ms', 'lt-50ms', 'lt-250ms', 'gte-250ms'], 'route event latencyBucket');
  if (event.degradedCode !== undefined) boundedCode(event.degradedCode, 'route event degradedCode');
  if (event.decisionDigest !== undefined && (typeof event.decisionDigest !== 'string' || !DIGEST.test(event.decisionDigest))) throw new Error('Route event decisionDigest is invalid.');
  if (event.promptStored !== false) throw new Error('Route event must set promptStored=false.');
  verifyPayloadDigest(event);
  assertContract(EVENT_SCHEMA, event);
}

export function assertRouteFeedback(value: unknown): asserts value is RouteFeedbackV1 {
  const feedback = object(value, 'route feedback');
  exactKeys(feedback, ['kind', 'schemaVersion', 'feedbackId', 'routeId', 'createdAt', 'revision', 'outcome', 'selectedSkillIds', 'expectedSkillIds', 'unsafeSkillIds', 'reasonCode', 'idempotencyKeyHash', 'promptStored', 'commentStored', 'payloadDigest'], [], 'route feedback');
  if (feedback.kind !== 'skillmap.route-feedback' || feedback.schemaVersion !== 1) throw new Error('Unsupported route feedback contract.');
  for (const key of ['feedbackId', 'routeId']) if (typeof feedback[key] !== 'string' || !UUID.test(feedback[key] as string)) throw new Error(`Route feedback ${key} must be a UUID.`);
  timestamp(feedback.createdAt, 'route feedback createdAt');
  assertRevisionRef(feedback.revision, 'route feedback revision');
  oneOf(feedback.outcome, ['correct', 'wrong', 'missing', 'unsafe'], 'route feedback outcome');
  skillIds(feedback.selectedSkillIds, 'route feedback selectedSkillIds', 10);
  skillIds(feedback.expectedSkillIds, 'route feedback expectedSkillIds', 10);
  skillIds(feedback.unsafeSkillIds, 'route feedback unsafeSkillIds', 10);
  if (feedback.reasonCode !== `operator-${feedback.outcome}`) throw new Error('Route feedback reasonCode does not match its outcome.');
  if (typeof feedback.idempotencyKeyHash !== 'string' || !DIGEST.test(feedback.idempotencyKeyHash)) throw new Error('Route feedback idempotencyKeyHash is invalid.');
  if (feedback.promptStored !== false || feedback.commentStored !== false) throw new Error('Route feedback must not store prompts or comments.');
  verifyPayloadDigest(feedback);
  assertContract(FEEDBACK_SCHEMA, feedback);
}

function assertRevisionRef(value: unknown, label: string): asserts value is RevisionRef {
  const revision = object(value, label);
  exactKeys(revision, ['workspaceId', 'revisionId', 'workspaceRevision', 'effectiveDigest', 'effectiveRevisionDigest'], [], label);
  if (typeof revision.workspaceId !== 'string' || !UUID.test(revision.workspaceId)) throw new Error(`${label}.workspaceId is invalid.`);
  if (typeof revision.revisionId !== 'string' || !/^r[0-9]{20}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revision.revisionId)) throw new Error(`${label}.revisionId is invalid.`);
  if (typeof revision.workspaceRevision !== 'string' || !DIGEST.test(revision.workspaceRevision)) throw new Error(`${label}.workspaceRevision is invalid.`);
  if (revision.effectiveDigest !== null && (typeof revision.effectiveDigest !== 'string' || !DIGEST.test(revision.effectiveDigest))) throw new Error(`${label}.effectiveDigest is invalid.`);
  if (revision.effectiveRevisionDigest !== null && (typeof revision.effectiveRevisionDigest !== 'string' || !DIGEST.test(revision.effectiveRevisionDigest))) throw new Error(`${label}.effectiveRevisionDigest is invalid.`);
}

async function findRouteEvent(cwd: string, routeId: string, limits: ResolvedRouteEventLedgerOptions): Promise<RouteEventV1 | undefined> {
  const indexed = await readIndexedRouteEvent(cwd, routeId);
  if (indexed && retainedDaySet(limits).has(eventDay(indexed))) return indexed;
  const maintenance = await maintainRouteEventLedgerInternal(cwd, limits);
  for (const item of maintenance.files) {
    try {
      const parsed = await readBoundedJson(item.file, MAX_EVENT_FILE_BYTES);
      assertRouteEvent(parsed);
      if (parsed.eventId !== eventIdFromFileName(item.fileName) || eventDay(parsed) !== item.day) continue;
      if (parsed.routeId === routeId) {
        await ensureRouteEventIndex(cwd, parsed);
        return parsed;
      }
    } catch {
      // A corrupt unrelated historical record must not turn a bounded legacy
      // lookup into an unbounded or path-revealing failure.
    }
  }
  return undefined;
}

async function ensureRouteEventIndex(cwd: string, event: RouteEventV1): Promise<void> {
  const existing = await readIndexedRouteEvent(cwd, event.routeId);
  if (existing) {
    if (existing.payloadDigest !== event.payloadDigest) throw new Error('Route event routeId conflicts with another durable event.');
    return;
  }
  const record = createRouteEventIndexRecord(event);
  const dir = routeIndexDirectory(cwd, event.routeId);
  const digest = event.payloadDigest.slice('sha256:'.length);
  const primary = path.join(dir, `${digest}-${event.eventId}.json`);
  try {
    await durableExclusiveJson(primary, record);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let validPrimary = false;
    try {
      const value = await readBoundedJson(primary, MAX_INDEX_FILE_BYTES);
      assertRouteEventIndexRecord(value);
      validPrimary = value.event.payloadDigest === event.payloadDigest && value.event.routeId === event.routeId;
    } catch {
      // A deterministic recovery slot lets concurrent rebuilds converge on the
      // same immutable event without overwriting a different routeId payload.
    }
    if (!validPrimary) await atomicReplaceJson(path.join(dir, `${digest}-${event.eventId}.repair.json`), record);
  }
  const confirmed = await readIndexedRouteEvent(cwd, event.routeId);
  if (!confirmed || confirmed.payloadDigest !== event.payloadDigest) throw new Error('Route event index could not be reconciled safely.');
}

async function readIndexedRouteEvent(cwd: string, routeId: string): Promise<RouteEventV1 | undefined> {
  const dir = routeIndexDirectory(cwd, routeId);
  if (!(await safeOperationalDirectoryExists(dir))) return undefined;
  let handle;
  try { handle = await opendir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const routeIdHash = routeIdDigest(routeId);
  const valid = new Map<string, RouteEventV1>();
  const corrupt: string[] = [];
  let entries = 0;
  for await (const entry of handle) {
    entries += 1;
    if (entries > MAX_INDEX_DIRECTORY_ENTRIES) throw new Error('Route event index exceeds its bounded entry limit.');
    if (!entry.isFile() || !INDEX_ANCHOR_FILE.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    try {
      const parsed = await readBoundedJson(file, MAX_INDEX_FILE_BYTES);
      assertRouteEventIndexRecord(parsed);
      if (parsed.routeIdHash !== routeIdHash || parsed.event.routeId !== routeId) throw new Error('Route event index binding mismatch.');
      valid.set(parsed.event.payloadDigest, parsed.event);
    } catch {
      corrupt.push(file);
    }
  }
  if (valid.size > 1) throw new Error('Route event index contains conflicting events for one routeId.');
  const event = valid.values().next().value as RouteEventV1 | undefined;
  if (event) {
    let publicEvent: RouteEventV1 | undefined;
    try {
      const parsed = await readBoundedJson(publicRouteEventFile(cwd, event), MAX_EVENT_FILE_BYTES);
      assertRouteEvent(parsed);
      if (parsed.eventId !== event.eventId || parsed.routeId !== routeId || parsed.payloadDigest !== event.payloadDigest) {
        throw new Error('Route event public/index binding mismatch.');
      }
      publicEvent = parsed;
    } catch {
      // Index records are derived lookup aids, never standalone routing or
      // feedback authority. Remove every bounded anchor when its canonical
      // date-partitioned public event is absent or invalid.
      for (const file of [...corrupt, ...await listRouteIndexAnchorFiles(dir)]) {
        await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      }
      return undefined;
    }
    for (const file of corrupt) await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    return publicEvent;
  }
  return undefined;
}

async function listRouteIndexAnchorFiles(dir: string): Promise<string[]> {
  if (!(await safeOperationalDirectoryExists(dir))) return [];
  let handle;
  try { handle = await opendir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  let entries = 0;
  for await (const entry of handle) {
    entries += 1;
    if (entries > MAX_INDEX_DIRECTORY_ENTRIES) throw new Error('Route event index exceeds its bounded cleanup limit.');
    if (entry.isFile() && INDEX_ANCHOR_FILE.test(entry.name)) files.push(path.join(dir, entry.name));
  }
  return files;
}

function createRouteEventIndexRecord(event: RouteEventV1): RouteEventIndexRecord {
  const record = withPayloadDigest({
    kind: 'skillmap.route-event-index' as const,
    schemaVersion: 1 as const,
    routeIdHash: routeIdDigest(event.routeId),
    event
  });
  assertRouteEventIndexRecord(record);
  return record;
}

function assertRouteEventIndexRecord(value: unknown): asserts value is RouteEventIndexRecord {
  const record = object(value, 'route event index');
  exactKeys(record, ['kind', 'schemaVersion', 'routeIdHash', 'event', 'payloadDigest'], [], 'route event index');
  if (record.kind !== 'skillmap.route-event-index' || record.schemaVersion !== 1) throw new Error('Unsupported route event index.');
  if (typeof record.routeIdHash !== 'string' || !DIGEST.test(record.routeIdHash)) throw new Error('Route event index hash is invalid.');
  assertRouteEvent(record.event);
  if (record.routeIdHash !== routeIdDigest(record.event.routeId)) throw new Error('Route event index hash does not match its event.');
  verifyPayloadDigest(record);
}

async function maintainRouteEventLedgerInternal(
  cwd: string,
  limits: ResolvedRouteEventLedgerOptions
): Promise<{ result: RouteEventMaintenanceResult; files: RouteEventFileRef[] }> {
  const state = { prunedRecords: 0, prunedPartitions: 0, truncated: false, remainingDeletes: MAX_MAINTENANCE_DELETES };
  await pruneExpiredPartitions(cwd, limits, state);
  const collected = await collectRetainedEventFiles(cwd, limits, limits.maxRecords + MAX_MAINTENANCE_DELETES + 1);
  const retained = collected.files.slice(0, limits.maxRecords);
  const excess = collected.files.slice(limits.maxRecords);
  for (const item of excess) {
    if (state.remainingDeletes === 0) { state.truncated = true; break; }
    if (await pruneEventFile(cwd, item)) {
      state.prunedRecords += 1;
      state.remainingDeletes -= 1;
    }
  }
  if (collected.truncated || excess.length > MAX_MAINTENANCE_DELETES) state.truncated = true;
  return {
    result: {
      retainedRecords: retained.length,
      prunedRecords: state.prunedRecords,
      prunedPartitions: state.prunedPartitions,
      truncated: state.truncated
    },
    files: retained
  };
}

async function collectRetainedEventFiles(
  cwd: string,
  limits: ResolvedRouteEventLedgerOptions,
  stopAfter: number
): Promise<{ files: RouteEventFileRef[]; truncated: boolean }> {
  const files: RouteEventFileRef[] = [];
  let truncated = false;
  for (const day of retainedDays(limits)) {
    const partition = await listPartitionEventFiles(cwd, day, limits.maxFilesPerPartition);
    for (const item of partition) {
      files.push(item);
      if (files.length >= stopAfter) { truncated = true; break; }
    }
    if (truncated) break;
  }
  return { files, truncated };
}

async function listPartitionEventFiles(cwd: string, day: string, maximum: number): Promise<RouteEventFileRef[]> {
  const dir = path.join(routeEventsRoot(cwd), day);
  if (!(await safeOperationalDirectoryExists(dir))) return [];
  let handle;
  try { handle = await opendir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names: string[] = [];
  let scanned = 0;
  for await (const entry of handle) {
    scanned += 1;
    if (scanned > maximum + 256) throw new Error('Route event partition exceeds its bounded directory scan limit.');
    if (entry.isSymbolicLink()) throw new Error('Route event partitions may not contain symbolic links.');
    if (!entry.isFile() || !EVENT_FILE.test(entry.name)) continue;
    names.push(entry.name);
    if (names.length > maximum) throw new Error('Route event partition exceeds its bounded record limit.');
  }
  const migratedNames: string[] = [];
  for (const fileName of names) {
    if (EVENT_FILE.exec(fileName)?.[1]) {
      migratedNames.push(fileName);
      continue;
    }
    const source = path.join(dir, fileName);
    let event: RouteEventV1;
    try {
      const parsed = await readBoundedJson(source, MAX_EVENT_FILE_BYTES);
      assertRouteEvent(parsed);
      if (parsed.eventId !== eventIdFromFileName(fileName) || eventDay(parsed) !== day) throw new Error('Legacy route event locator does not match its payload.');
      event = parsed;
    } catch {
      migratedNames.push(fileName);
      continue;
    }
    const canonical = path.basename(publicRouteEventFile(cwd, event));
    const destination = path.join(dir, canonical);
    const existing = await readExistingRouteEvent(destination);
    if (existing) {
      if (existing.payloadDigest !== event.payloadDigest) throw new Error('Legacy route event conflicts with its chronological destination.');
      await unlink(source);
    } else {
      await rename(source, destination);
    }
    await syncDirectory(dir);
    migratedNames.push(canonical);
  }
  const orderedNames = [...new Set(migratedNames)].sort(compareRouteEventFileNames);
  return orderedNames.map((fileName) => ({ day, fileName, file: path.join(dir, fileName), key: `${day}/${fileName}` }));
}

async function pruneExpiredPartitions(
  cwd: string,
  limits: ResolvedRouteEventLedgerOptions,
  state: { prunedRecords: number; prunedPartitions: number; truncated: boolean; remainingDeletes: number }
): Promise<void> {
  const root = routeEventsRoot(cwd);
  if (!(await safeOperationalDirectoryExists(root))) return;
  let handle;
  try { handle = await opendir(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const cutoff = retainedDays(limits).at(-1)!;
  let scanned = 0;
  for await (const entry of handle) {
    scanned += 1;
    if (scanned > MAX_MAINTENANCE_ROOT_ENTRIES) { state.truncated = true; break; }
    if (!entry.isDirectory() || !DATE_PARTITION.test(entry.name) || entry.name >= cutoff) continue;
    let partition: RouteEventFileRef[];
    try { partition = await listPartitionEventFiles(cwd, entry.name, limits.maxFilesPerPartition); } catch { state.truncated = true; continue; }
    for (const item of partition) {
      if (state.remainingDeletes === 0) { state.truncated = true; break; }
      if (await pruneEventFile(cwd, item)) {
        state.prunedRecords += 1;
        state.remainingDeletes -= 1;
      }
    }
    try { await rmdir(path.join(root, entry.name)); state.prunedPartitions += 1; } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
}

async function pruneEventFile(cwd: string, item: RouteEventFileRef): Promise<boolean> {
  let event: RouteEventV1 | undefined;
  try {
    const parsed = await readBoundedJson(item.file, MAX_EVENT_FILE_BYTES);
    assertRouteEvent(parsed);
    if (parsed.eventId === eventIdFromFileName(item.fileName) && eventDay(parsed) === item.day) event = parsed;
  } catch {
    // Invalid operational records are safe to discard but cannot identify an
    // index bucket; bounded index readers will independently reject them.
  }
  // Remove bounded feedback receipts and the route index before the public
  // event. If interruption occurs, the retained public event remains the
  // canonical anchor and both derived surfaces can be recreated safely.
  if (event) {
    await removeRouteFeedback(cwd, event);
    await removeRouteEventIndex(cwd, event.routeId);
  }
  try { await unlink(item.file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  return true;
}

async function removeRouteFeedback(cwd: string, event: RouteEventV1): Promise<void> {
  const directory = feedbackSlotDirectory(cwd, event);
  if (!(await safeOperationalDirectoryExists(directory))) return;
  for (const outcome of FEEDBACK_OUTCOMES) {
    await unlink(path.join(directory, `${outcome}.json`)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  try { await rmdir(directory); } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
  try { await rmdir(path.dirname(directory)); } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

async function removeRouteEventIndex(cwd: string, routeId: string): Promise<void> {
  const dir = routeIndexDirectory(cwd, routeId);
  if (!(await safeOperationalDirectoryExists(dir))) return;
  let handle;
  try { handle = await opendir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  let entries = 0;
  for await (const entry of handle) {
    entries += 1;
    if (entries > MAX_INDEX_DIRECTORY_ENTRIES) throw new Error('Route event index exceeds its bounded entry limit during retention.');
    if (entry.isFile() && INDEX_ANCHOR_FILE.test(entry.name)) {
      await unlink(path.join(dir, entry.name)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  try { await rmdir(dir); } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

function resolveLedgerOptions(options: RouteEventLedgerOptions): ResolvedRouteEventLedgerOptions {
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Route event ledger clock is invalid.');
  const retentionDays = boundedLedgerInteger(options.retentionDays ?? ROUTE_EVENT_RETENTION_DAYS, 1, ROUTE_EVENT_RETENTION_DAYS, 'retentionDays');
  const maxRecords = boundedLedgerInteger(options.maxRecords ?? ROUTE_EVENT_MAX_RECORDS, 1, ROUTE_EVENT_MAX_RECORDS, 'maxRecords');
  const maxPartitions = boundedLedgerInteger(options.maxPartitions ?? Math.min(retentionDays, ROUTE_EVENT_MAX_PARTITIONS), 1, Math.min(retentionDays, ROUTE_EVENT_MAX_PARTITIONS), 'maxPartitions');
  const maxFilesPerPartition = boundedLedgerInteger(options.maxFilesPerPartition ?? ROUTE_EVENT_MAX_FILES_PER_PARTITION, 1, ROUTE_EVENT_MAX_FILES_PER_PARTITION, 'maxFilesPerPartition');
  return { now, retentionDays, maxRecords, maxPartitions, maxFilesPerPartition };
}

function boundedLedgerInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Route event ledger ${label} must be between ${minimum} and ${maximum}.`);
  return value;
}

function retainedDays(limits: ResolvedRouteEventLedgerOptions): string[] {
  const anchor = Date.UTC(limits.now.getUTCFullYear(), limits.now.getUTCMonth(), limits.now.getUTCDate());
  return Array.from({ length: limits.maxPartitions }, (_, index) => new Date(anchor - index * 86_400_000).toISOString().slice(0, 10));
}

function retainedDaySet(limits: ResolvedRouteEventLedgerOptions): Set<string> {
  return new Set(retainedDays(limits));
}

function eventDay(event: RouteEventV1): string {
  return new Date(event.createdAt).toISOString().slice(0, 10);
}

function eventIdFromFileName(fileName: string): string {
  const match = EVENT_FILE.exec(fileName);
  if (!match) throw new Error('Route event filename is invalid.');
  return match[2]!;
}

function routeEventsRoot(cwd: string): string {
  return path.join(cwd, '.skillmap', 'events', 'routes');
}

function publicRouteEventFile(cwd: string, event: RouteEventV1): string {
  return path.join(routeEventsRoot(cwd), eventDay(event), `${String(Date.parse(event.createdAt)).padStart(13, '0')}-${event.eventId}.json`);
}

function legacyPublicRouteEventFile(cwd: string, event: RouteEventV1): string {
  return path.join(routeEventsRoot(cwd), eventDay(event), `${event.eventId}.json`);
}

function compareRouteEventFileNames(left: string, right: string): number {
  const leftTimestamp = EVENT_FILE.exec(left)?.[1];
  const rightTimestamp = EVENT_FILE.exec(right)?.[1];
  if (leftTimestamp && rightTimestamp && leftTimestamp !== rightTimestamp) return rightTimestamp.localeCompare(leftTimestamp);
  if (leftTimestamp && !rightTimestamp) return -1;
  if (!leftTimestamp && rightTimestamp) return 1;
  return right.localeCompare(left);
}

function routeIdDigest(routeId: string): string {
  return hashText(`route-id:${routeId}`);
}

function routeIndexDirectory(cwd: string, routeId: string): string {
  const digest = routeIdDigest(routeId).slice('sha256:'.length);
  return path.join(cwd, '.skillmap', 'events', 'route-index', 'v1', digest.slice(0, 2), digest);
}

function feedbackSlotDirectory(cwd: string, event: RouteEventV1): string {
  const digest = routeIdDigest(event.routeId).slice('sha256:'.length);
  return path.join(cwd, '.skillmap', 'events', 'feedback', 'v2', eventDay(event), digest.slice(0, 2), digest);
}

function feedbackSlotFile(cwd: string, event: RouteEventV1, outcome: RouteFeedbackV1['outcome']): string {
  return path.join(feedbackSlotDirectory(cwd, event), `${outcome}.json`);
}

async function readExistingRouteEvent(file: string): Promise<RouteEventV1 | undefined> {
  if (!(await safeOperationalDirectoryExists(path.dirname(file)))) return undefined;
  try {
    const value = await readBoundedJson(file, MAX_EVENT_FILE_BYTES);
    assertRouteEvent(value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertEventWithinRetention(event: RouteEventV1, limits: ResolvedRouteEventLedgerOptions): void {
  const timestampMs = Date.parse(event.createdAt);
  if (timestampMs > limits.now.getTime() + MAX_EVENT_CLOCK_SKEW_MS) throw new Error('Route event timestamp is too far in the future.');
  if (!retainedDaySet(limits).has(eventDay(event))) throw new Error('Route event timestamp falls outside the bounded retention window.');
}

async function withRouteLedgerLock<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
  const eventsRoot = await ensureSafeEventsRoot(cwd);
  const queue = routeLedgerQueues.get(eventsRoot) ?? { tail: Promise.resolve(), pending: 0 };
  if (queue.pending >= MAX_LEDGER_QUEUE_DEPTH) throw new Error('Route event ledger is busy. Retry the bounded operation.');
  queue.pending += 1;
  const queued = queue.tail.then(async () => {
    const held = await acquireRouteLedgerLock(eventsRoot);
    try {
      return await operation();
    } finally {
      await held.release();
    }
  });
  queue.tail = queued.then(() => undefined, () => undefined);
  routeLedgerQueues.set(eventsRoot, queue);
  try {
    return await queued;
  } finally {
    queue.pending -= 1;
    if (queue.pending === 0 && routeLedgerQueues.get(eventsRoot) === queue) routeLedgerQueues.delete(eventsRoot);
  }
}

async function acquireRouteLedgerLock(eventsRoot: string): Promise<{ release(): Promise<void> }> {
  const lockDir = path.join(eventsRoot, '.ledger-lock');
  const ownerFile = path.join(lockDir, 'owner.json');
  const token = randomUUID();
  for (let attempt = 0; attempt < MAX_LEDGER_LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockDir, { mode: 0o700 });
      try {
        await durableExclusiveJson(ownerFile, {
          version: 1,
          token,
          pid: process.pid,
          hostname: hostname(),
          acquiredAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + LEDGER_LOCK_LEASE_MS).toISOString()
        });
      } catch (error) {
        await rm(lockDir, {
          recursive: true,
          force: true,
          maxRetries: process.platform === 'win32' ? 3 : 0,
          retryDelay: 10
        }).catch(() => undefined);
        throw error;
      }
      return {
        async release() {
          const owner = object(await readBoundedJson(ownerFile, 8 * 1024), 'route ledger lock owner');
          if (owner.token !== token) throw new Error('Route event ledger lock ownership changed before release.');
          await rm(lockDir, {
            recursive: true,
            force: false,
            maxRetries: process.platform === 'win32' ? 3 : 0,
            retryDelay: 10
          });
          await syncDirectory(eventsRoot);
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await reclaimStaleRouteLedgerLock(eventsRoot, lockDir, ownerFile)) continue;
      await delay(25);
    }
  }
  throw new Error('Route event ledger is busy. Retry the bounded operation.');
}

async function reclaimStaleRouteLedgerLock(eventsRoot: string, lockDir: string, ownerFile: string): Promise<boolean> {
  let reclaimable = false;
  try {
    const owner = object(await readBoundedJson(ownerFile, 8 * 1024), 'route ledger lock owner');
    const expiresAt = typeof owner.expiresAt === 'string' ? Date.parse(owner.expiresAt) : Number.NaN;
    const pid = typeof owner.pid === 'number' && Number.isSafeInteger(owner.pid) ? owner.pid : -1;
    const ownerHost = typeof owner.hostname === 'string' ? owner.hostname : '';
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now() && ownerHost === hostname() && !pidIsAlive(pid)) reclaimable = true;
  } catch {
    const stats = await lstat(lockDir).catch(() => undefined);
    reclaimable = Boolean(stats && Date.now() - stats.mtimeMs > LEDGER_LOCK_LEASE_MS);
  }
  if (!reclaimable) return false;
  const quarantine = path.join(eventsRoot, `.ledger-lock-stale-${randomUUID()}`);
  try {
    await rename(lockDir, quarantine);
    await rm(quarantine, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 3 : 0,
      retryDelay: 10
    });
    await syncDirectory(eventsRoot);
    return true;
  } catch (error) {
    return ['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '');
  }
}

async function ensureSafeEventsRoot(cwd: string): Promise<string> {
  const cwdReal = await realpath(cwd);
  const cwdStats = await lstat(cwdReal);
  if (!cwdStats.isDirectory() || cwdStats.isSymbolicLink()) throw new Error('Route event workspace must be a regular directory.');
  const skillmap = path.join(cwdReal, '.skillmap');
  const events = path.join(skillmap, 'events');
  await ensurePlainDirectory(skillmap);
  await ensurePlainDirectory(events);
  return events;
}

async function ensurePlainDirectory(directory: string): Promise<void> {
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Route event state directories must not be symbolic links.');
}

function pidIsAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function readBoundedJson(file: string, maximumBytes: number): Promise<unknown> {
  const before = await lstat(file);
  if (before.isSymbolicLink() || !before.isFile() || before.size > maximumBytes) throw new Error('Operational event record exceeds its safe file boundary.');
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > maximumBytes) throw new Error('Operational event record changed before it could be read safely.');
    const buffer = Buffer.alloc(maximumBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    const after = await handle.stat();
    if (bytesRead > maximumBytes || bytesRead !== after.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error('Operational event record changed while it was being read.');
    }
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

async function durableExclusiveJson(file: string, value: unknown): Promise<void> {
  await ensureSafeOperationalDirectory(path.dirname(file));
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

async function atomicReplaceJson(file: string, value: unknown): Promise<void> {
  await ensureSafeOperationalDirectory(path.dirname(file));
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await durableExclusiveJson(temp, value);
    await rename(temp, file);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function syncDirectory(dir: string): Promise<void> {
  const stats = await lstat(dir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Operational event directory must be a non-symlink directory.');
  // Windows does not expose POSIX directory fsync. Event files are synced
  // before publication; keep directory validation while avoiding EPERM.
  if (process.platform === 'win32') return;
  const handle = await open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function ensureSafeOperationalDirectory(directory: string): Promise<void> {
  const boundary = operationalDirectoryBoundary(directory);
  const eventsReal = await assertPlainDirectory(boundary.eventsRoot);
  let current = boundary.eventsRoot;
  for (const segment of boundary.relativeSegments) {
    current = path.join(current, segment);
    try { await mkdir(current, { mode: 0o700 }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const currentReal = await assertPlainDirectory(current);
    assertPathContained(eventsReal, currentReal);
  }
}

async function assertSafeOperationalDirectory(directory: string): Promise<void> {
  const boundary = operationalDirectoryBoundary(directory);
  const eventsReal = await assertPlainDirectory(boundary.eventsRoot);
  let current = boundary.eventsRoot;
  for (const segment of boundary.relativeSegments) {
    current = path.join(current, segment);
    const currentReal = await assertPlainDirectory(current);
    assertPathContained(eventsReal, currentReal);
  }
}

async function safeOperationalDirectoryExists(directory: string): Promise<boolean> {
  try {
    await assertSafeOperationalDirectory(directory);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function operationalDirectoryBoundary(directory: string): { eventsRoot: string; relativeSegments: string[] } {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let marker = -1;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === '.skillmap' && segments[index + 1] === 'events') marker = index;
  }
  if (marker < 0) throw new Error('Operational event path is outside the workspace event boundary.');
  const eventsRoot = path.join(parsed.root, ...segments.slice(0, marker + 2));
  const relativeSegments = segments.slice(marker + 2);
  if (relativeSegments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('Operational event path contains an unsafe segment.');
  }
  return { eventsRoot, relativeSegments };
}

async function assertPlainDirectory(directory: string): Promise<string> {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Operational event directories must not be symbolic links.');
  return realpath(directory);
}

function assertPathContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Operational event directory escapes its workspace boundary.');
  }
}

function encodeCursor(index: number, files: string[]): string {
  const payload = JSON.stringify({ index, corpus: hashText(files.join('\n')) });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, files: string[]): number {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new Error('Route event cursor is invalid.'); }
  const record = object(parsed, 'route event cursor');
  exactKeys(record, ['index', 'corpus'], [], 'route event cursor');
  if (!Number.isInteger(record.index) || (record.index as number) < 0) throw new Error('Route event cursor index is invalid.');
  if (record.corpus !== hashText(files.join('\n'))) throw new Error('Route event cursor is stale.');
  return record.index as number;
}

function latencyBucket(latencyMs: number): RouteEventV1['latencyBucket'] {
  if (latencyMs < 10) return 'lt-10ms';
  if (latencyMs < 50) return 'lt-50ms';
  if (latencyMs < 250) return 'lt-250ms';
  return 'gte-250ms';
}

function normalizeLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('Route event limit must be an integer between 1 and 100.');
  return value;
}

function uniqueSkillIds(values: string[]): string[] {
  skillIds(values, 'skill ids', 10);
  return [...new Set(values)].sort();
}

function feedbackSkillIds(values: string[], label: string): string[] {
  try { return uniqueSkillIds(values); }
  catch { throw new RouteFeedbackInputError('FEEDBACK_SKILL_IDS_INVALID', `Feedback ${label} must contain at most 10 qualified skill IDs.`); }
}

function skillIds(value: unknown, label: string, max: number): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || !SKILL_ID.test(item))) throw new Error(`${label} must contain at most ${max} qualified skill IDs.`);
}

function codes(value: unknown, label: string, max: number): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must contain at most ${max} codes.`);
  for (const item of value) boundedCode(item, label);
}

function boundedCode(value: unknown, label: string, max = 64): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function timestamp(value: unknown, label: string): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
}

function oneOf(value: unknown, values: readonly string[], label: string): void {
  if (typeof value !== 'string' || !values.includes(value)) throw new Error(`${label} is invalid.`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, required: string[], optional: string[], label: string): void {
  for (const key of required) if (!Object.hasOwn(record, key)) throw new Error(`${label} is missing ${key}.`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}.`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
