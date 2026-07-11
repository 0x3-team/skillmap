import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath, rename, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { assertContract } from '../contracts/validate.js';
import { canonicalJson } from './canonical-payload.js';
import { hashText } from './fs.js';
import type { JobParameters, JobRequestV1, JobV1 } from '../schemas/types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^r[0-9]{20}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const JOB_SCHEMA = 'https://skillmap.dev/contracts/job/v1.schema.json';

/**
 * The operational ledger retains at most 128 anchored jobs. Admission evicts
 * the oldest terminal jobs first; queued and running jobs are never evicted.
 * This bound also caps idempotency and cancellation records.
 */
export const JOB_LEDGER_MAX_ENTRIES = 128;
const JOB_SIDE_DIRECTORY_MAX_ENTRIES = JOB_LEDGER_MAX_ENTRIES + 32;
const JOB_LEDGER_LOCK_LEASE_MS = 30_000;
const JOB_LEDGER_LOCK_RETRIES = 500;
const MAX_JOB_FILE_BYTES = 128 * 1024;

export interface StoredJob {
  job: JobV1;
  request: JobRequestV1;
}

interface JobIdempotencyEntry {
  jobId: string;
  requestDigest: string;
  stored?: StoredJob;
}

interface JobAnchor {
  fileName: string;
  entry: JobIdempotencyEntry;
}

interface JobLedgerLockOwner {
  ownerId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
}

interface HeldJobLedgerLock {
  release(): Promise<void>;
}

interface JobClaimOwner {
  jobId: string;
  ownerId: string;
  pid: number;
  hostname: string;
  claimedAt: string;
}

export interface JobExecutionClaim {
  jobId: string;
  ownerId: string;
  release(): Promise<void>;
}

export interface JobCancellationRecord {
  kind: 'skillmap.job-cancellation';
  schemaVersion: 1;
  jobId: string;
  idempotencyDigest: string;
  requestedAt: string;
  payloadDigest: string;
}

export class JobCancellationConflictError extends Error {
  readonly code = 'JOB_CANCELLATION_IDEMPOTENCY_CONFLICT';
  constructor() { super('Job cancellation idempotency key conflicts with the existing cancellation request.'); this.name = 'JobCancellationConflictError'; }
}

export class JobLedgerCapacityError extends Error {
  readonly code = 'JOB_LEDGER_CAPACITY';
  constructor() {
    super(`The job ledger already contains ${JOB_LEDGER_MAX_ENTRIES} nonterminal jobs. Finish or cancel a job before retrying.`);
    this.name = 'JobLedgerCapacityError';
  }
}

export class JobLedgerBusyError extends Error {
  readonly code = 'JOB_LEDGER_BUSY';
  constructor() {
    super('The job ledger is busy. Retry after the current local job operation completes.');
    this.name = 'JobLedgerBusyError';
  }
}

export async function createJob(cwd: string, request: JobRequestV1): Promise<{ stored: StoredJob; created: boolean }> {
  assertJobRequest(request);
  return withJobLedgerLock(cwd, () => createJobHeld(cwd, request));
}

async function createJobHeld(cwd: string, request: JobRequestV1): Promise<{ stored: StoredJob; created: boolean }> {
  const root = await ensureSafeJobLedgerRoot(cwd);
  const idempotency = await ensureSafeJobOperationalDirectory(path.join(root, 'idempotency'));
  await ensureSafeJobOperationalDirectory(path.join(root, 'records'));
  const persistedRequest = persistenceSafeJobRequest(request);
  const requestDigest = hashText(canonicalJson(persistedRequest));
  const idempotencyDigest = hashText(`job-anchor:${persistedRequest.idempotencyKey}`).slice('sha256:'.length);
  const idempotencyFile = path.join(idempotency, `${idempotencyDigest}.json`);
  const existing = await readOptional<JobIdempotencyEntry>(idempotencyFile);
  if (existing) {
    if (existing.requestDigest !== requestDigest) throw new Error('Job idempotency key was already used for a different request.');
    return { stored: await ensureJobRecord(cwd, existing), created: false };
  }
  await admitJobLedgerEntry(cwd);
  const job: JobV1 = {
    kind: 'skillmap.job',
    schemaVersion: 1,
    jobId: randomUUID(),
    type: request.parameters.type,
    state: 'queued',
    expectedRevision: request.expectedRevision,
    idempotencyKey: persistedRequest.idempotencyKey,
    requestDigest,
    confirmation: request.confirmation,
    createdAt: new Date().toISOString()
  };
  assertJob(job);
  const stored: StoredJob = { job, request: persistedRequest };
  const entry: JobIdempotencyEntry = { jobId: job.jobId, requestDigest, stored };
  try {
    // The idempotency record is the durable transaction anchor. It contains
    // everything needed to recreate the public job record after a crash, and
    // it is written before a record can become visible to the job runner. A
    // losing process therefore never leaves an executable orphan job behind.
    await writeExclusive(idempotencyFile, entry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = await readOptional<JobIdempotencyEntry>(idempotencyFile);
    if (!raced || raced.requestDigest !== requestDigest) throw new Error('Job idempotency key conflicted with another request.');
    return { stored: await ensureJobRecord(cwd, raced), created: false };
  }
  return { stored: await ensureJobRecord(cwd, entry), created: true };
}

export async function findIdempotentJob(cwd: string, request: JobRequestV1): Promise<StoredJob | undefined> {
  assertJobRequest(request);
  return withJobLedgerLock(cwd, () => findIdempotentJobHeld(cwd, request));
}

async function findIdempotentJobHeld(cwd: string, request: JobRequestV1): Promise<StoredJob | undefined> {
  const persistedRequest = persistenceSafeJobRequest(request);
  const requestDigest = hashText(canonicalJson(persistedRequest));
  const idempotencyDigest = hashText(`job-anchor:${persistedRequest.idempotencyKey}`).slice('sha256:'.length);
  const idempotency = await safeJobOperationalDirectoryExists(path.join(jobsRoot(cwd), 'idempotency'));
  if (!idempotency) return undefined;
  const entry = await readOptional<JobIdempotencyEntry>(path.join(idempotency, `${idempotencyDigest}.json`));
  if (!entry) return undefined;
  if (entry.requestDigest !== requestDigest) throw new Error('Job idempotency key was already used for a different request.');
  return ensureJobRecord(cwd, entry);
}

export async function readJob(cwd: string, jobId: string): Promise<StoredJob> {
  if (!UUID.test(jobId)) throw new Error('Job id is invalid.');
  if (!(await safeJobLedgerRootExists(cwd))) throw new Error('Job was not found.');
  // Lifecycle updates replace records by atomic rename. Serialize every
  // product reader with those trusted replacements so readOptional can remain
  // fail-closed when it observes an uncoordinated path or inode change.
  return withJobLedgerLock(cwd, () => readJobHeld(cwd, jobId));
}

async function readJobHeld(cwd: string, jobId: string): Promise<StoredJob> {
  const records = await safeJobOperationalDirectoryExists(path.join(jobsRoot(cwd), 'records'));
  if (!records) throw new Error('Job was not found.');
  const parsed = await readOptional<unknown>(path.join(records, `${jobId}.json`));
  if (!parsed) throw new Error('Job was not found.');
  return validateStoredJob(parsed);
}

export async function transitionJob(
  cwd: string,
  jobId: string,
  nextState: JobV1['state'],
  options: { resultReceipt?: Record<string, unknown>; error?: JobV1['error']; claim?: JobExecutionClaim } = {}
): Promise<StoredJob> {
  const claim = options.claim ?? await claimJobExecution(cwd, jobId);
  if (!claim) throw new Error('Job is already claimed by another live executor.');
  try {
    await assertClaimOwned(cwd, claim);
    // The execution claim serializes lifecycle writers for one job; the ledger
    // lock additionally serializes the atomic rename with readers of all jobs.
    return await withJobLedgerLock(cwd, async () => {
      const stored = await readJobHeld(cwd, jobId);
      if (!legalTransition(stored.job.state, nextState)) throw new Error(`Illegal job transition: ${stored.job.state} -> ${nextState}.`);
      const now = new Date().toISOString();
      const job: JobV1 = {
        ...stored.job,
        state: nextState,
        ...(nextState === 'running' ? { startedAt: stored.job.startedAt ?? now } : {}),
        ...(['succeeded', 'failed', 'cancelled'].includes(nextState) ? { completedAt: now } : {}),
        ...((nextState === 'succeeded' || nextState === 'cancelled') && options.resultReceipt ? { resultReceipt: privacyCleanReceipt(options.resultReceipt) } : {}),
        ...(nextState === 'failed' && options.error ? { error: safeJobError(options.error) } : {})
      };
      assertJob(job);
      const next = { ...stored, job };
      await atomicReplace(path.join(jobsRoot(cwd), 'records', `${jobId}.json`), next);
      return next;
    });
  } finally {
    if (!options.claim) await claim.release();
  }
}

export async function requestJobCancellation(cwd: string, jobId: string, idempotencyKey: string): Promise<{ record: JobCancellationRecord; created: boolean }> {
  if (!UUID.test(jobId)) throw new Error('Job id is invalid.');
  boundedCode(idempotencyKey, 'Job cancellation idempotencyKey', 128);
  return withJobLedgerLock(cwd, () => requestJobCancellationHeld(cwd, jobId, idempotencyKey));
}

async function requestJobCancellationHeld(cwd: string, jobId: string, idempotencyKey: string): Promise<{ record: JobCancellationRecord; created: boolean }> {
  await readJobHeld(cwd, jobId);
  const anchors = await readIdempotencyAnchors(cwd);
  await cleanupJobSideDirectories(cwd, anchors);
  if (!anchors.has(jobId)) throw new Error('Job cancellation requires an anchored job.');
  const idempotencyDigest = hashText(canonicalJson({ kind: 'skillmap.job-cancellation-request', jobId, idempotencyKey }));
  const cancellations = await ensureSafeJobOperationalDirectory(path.join(jobsRoot(cwd), 'cancellations'));
  const file = path.join(cancellations, `${jobId}.json`);
  const existing = await readOptional<unknown>(file);
  if (existing) {
    const record = validateJobCancellation(existing);
    if (record.idempotencyDigest !== idempotencyDigest) throw new JobCancellationConflictError();
    return { record, created: false };
  }
  const base = {
    kind: 'skillmap.job-cancellation' as const,
    schemaVersion: 1 as const,
    jobId,
    idempotencyDigest,
    requestedAt: new Date().toISOString()
  };
  const record: JobCancellationRecord = { ...base, payloadDigest: hashText(canonicalJson(base)) };
  try {
    await writeExclusive(file, record);
    return { record, created: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = validateJobCancellation(await readOptional<unknown>(file));
    if (raced.idempotencyDigest !== idempotencyDigest) throw new JobCancellationConflictError();
    return { record: raced, created: false };
  }
}

export async function readJobCancellation(cwd: string, jobId: string): Promise<JobCancellationRecord | undefined> {
  if (!UUID.test(jobId)) throw new Error('Job id is invalid.');
  if (!(await safeJobLedgerRootExists(cwd))) return undefined;
  return withJobLedgerLock(cwd, async () => {
    const cancellations = await safeJobOperationalDirectoryExists(path.join(jobsRoot(cwd), 'cancellations'));
    if (!cancellations) return undefined;
    const value = await readOptional<unknown>(path.join(cancellations, `${jobId}.json`));
    return value === undefined ? undefined : validateJobCancellation(value);
  });
}

export async function listJobs(cwd: string, limit = 50): Promise<StoredJob[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Job limit must be between 1 and 100.');
  return (await listAllJobs(cwd)).slice(0, limit);
}

export async function listAllJobs(cwd: string, maximum = 10_000): Promise<StoredJob[]> {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100_000) throw new Error('Job recovery maximum must be between 1 and 100000.');
  if (!(await safeJobLedgerRootExists(cwd))) return [];
  return withJobLedgerLock(cwd, () => listAllJobsHeld(cwd, maximum));
}

export function assertJobRequest(value: unknown): asserts value is JobRequestV1 {
  const request = object(value, 'job request');
  exact(request, ['kind', 'schemaVersion', 'expectedRevision', 'idempotencyKey', 'requestedBy', 'confirmation', 'parameters'], 'job request');
  if (request.kind !== 'skillmap.job-request' || request.schemaVersion !== 1) throw new Error('Unsupported job request contract.');
  if (typeof request.expectedRevision !== 'string' || !REVISION.test(request.expectedRevision)) throw new Error('Job expectedRevision must be an exact canonical revision id.');
  boundedCode(request.idempotencyKey, 'Job idempotencyKey', 128);
  oneOf(request.requestedBy, ['local-operator', 'cli', 'api'], 'Job requestedBy');
  oneOf(request.confirmation, ['none'], 'Job confirmation');
  assertParameters(request.parameters, request.confirmation as JobRequestV1['confirmation']);
}

export function assertJob(value: unknown): asserts value is JobV1 {
  const job = object(value, 'job');
  const required = ['kind', 'schemaVersion', 'jobId', 'type', 'state', 'expectedRevision', 'idempotencyKey', 'requestDigest', 'confirmation', 'createdAt'];
  const optional = ['startedAt', 'completedAt', 'resultReceipt', 'error'];
  exact(job, required, 'job', optional);
  if (job.kind !== 'skillmap.job' || job.schemaVersion !== 1) throw new Error('Unsupported job contract.');
  if (typeof job.jobId !== 'string' || !UUID.test(job.jobId)) throw new Error('Job id is invalid.');
  oneOf(job.type, ['scan', 'doctor', 'doctor-pack', 'graph-build', 'eval-run', 'sources-check'], 'Job type');
  oneOf(job.state, ['queued', 'running', 'succeeded', 'failed', 'cancelled'], 'Job state');
  if (typeof job.expectedRevision !== 'string' || !REVISION.test(job.expectedRevision)) throw new Error('Job expectedRevision must be an exact canonical revision id.');
  boundedCode(job.idempotencyKey, 'Job idempotencyKey', 128);
  if (typeof job.requestDigest !== 'string' || !DIGEST.test(job.requestDigest)) throw new Error('Job requestDigest is invalid.');
  oneOf(job.confirmation, ['none'], 'Job confirmation');
  timestamp(job.createdAt, 'Job createdAt');
  if (job.startedAt !== undefined) timestamp(job.startedAt, 'Job startedAt');
  if (job.completedAt !== undefined) timestamp(job.completedAt, 'Job completedAt');
  if (job.state === 'running' && !job.startedAt) throw new Error('Running job is missing startedAt.');
  if (['succeeded', 'failed', 'cancelled'].includes(job.state as string) && !job.completedAt) throw new Error('Terminal job is missing completedAt.');
  if (job.state === 'failed' && !job.error) throw new Error('Failed job is missing safe error.');
  assertContract(JOB_SCHEMA, job);
}

function assertParameters(value: unknown, confirmation: JobRequestV1['confirmation']): asserts value is JobParameters {
  const parameters = object(value, 'job parameters');
  if (typeof parameters.type !== 'string') throw new Error('Job parameters type is required.');
  const allowed: Record<string, string[]> = {
    scan: ['type'], doctor: ['type'], 'doctor-pack': ['type', 'summary'],
    'graph-build': ['type', 'mode'], 'eval-run': ['type'], 'sources-check': ['type']
  };
  const keys = allowed[parameters.type];
  if (!keys) throw new Error('Job type is not allowlisted.');
  exact(parameters, ['type'], 'job parameters', keys.filter((key) => key !== 'type'));
  if (parameters.type === 'doctor-pack' && typeof parameters.summary !== 'boolean') throw new Error('doctor-pack summary must be boolean.');
  if (parameters.type === 'graph-build') oneOf(parameters.mode, ['raw', 'effective'], 'graph mode');
  if (confirmation !== 'none') throw new Error(`Generic job ${parameters.type} requires confirmation=none.`);
}

function legalTransition(from: JobV1['state'], to: JobV1['state']): boolean {
  return (from === 'queued' && (to === 'running' || to === 'cancelled'))
    || (from === 'running' && (to === 'succeeded' || to === 'failed' || to === 'cancelled'));
}

function privacyCleanReceipt(value: Record<string, unknown>): Record<string, unknown> {
  const forbidden = /prompt|body|path|secret|token|password|command|stdout|stderr|diff/i;
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key)) throw new Error(`Job result receipt contains forbidden field: ${key}.`);
    if (typeof item === 'string' && item.length > 256) throw new Error(`Job result receipt field ${key} is too large.`);
    clean[key] = item;
  }
  return clean;
}

function safeJobError(value: NonNullable<JobV1['error']>): NonNullable<JobV1['error']> {
  boundedCode(value.code, 'Job error code');
  if (typeof value.message !== 'string' || value.message.length < 1 || value.message.length > 240 || containsFilesystemLocation(value.message)) throw new Error('Job error message is not safe.');
  if (typeof value.retryable !== 'boolean') throw new Error('Job error retryable must be boolean.');
  return value;
}

function containsFilesystemLocation(value: string): boolean {
  return /file:\/\//i.test(value)
    || /(?:^|[\s("'`])\/(?:[^\s"'`)]+\/)*[^\s"'`)]+/.test(value)
    || /(?:^|[\s("'`])[A-Za-z]:[\\/][^\s"'`)]+/.test(value)
    || /(?:^|[\s("'`])\\\\[^\s"'`)]+/.test(value);
}

/**
 * Atomically claims one job for execution across connector processes. The
 * fully materialized owner directory is renamed into place, so contenders
 * never observe a half-written claim. A claim owned by a live local process is
 * never stolen; dead local owners are quarantined before a retry.
 */
export async function claimJobExecution(cwd: string, jobId: string): Promise<JobExecutionClaim | undefined> {
  if (!UUID.test(jobId)) throw new Error('Job id is invalid.');
  const root = await ensureSafeJobLedgerRoot(cwd);
  const claims = await ensureSafeJobOperationalDirectory(path.join(root, 'claims'));
  const quarantine = path.join(root, 'claim-quarantine');
  const target = path.join(claims, jobId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const owner: JobClaimOwner = {
      jobId,
      ownerId: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      claimedAt: new Date().toISOString()
    };
    const pending = path.join(claims, `.pending-${jobId}-${owner.ownerId}`);
    await mkdir(pending, { mode: 0o700 });
    let renameAttempted = false;
    let renamePublished = false;
    try {
      await writeExclusive(path.join(pending, 'owner.json'), owner);
      renameAttempted = true;
      await rename(pending, target);
      renamePublished = true;
      await syncDir(claims);
      let released = false;
      return {
        jobId,
        ownerId: owner.ownerId,
        async release(): Promise<void> {
          if (released) return;
          const safeTarget = await safeJobOperationalDirectoryExists(target);
          const current = safeTarget ? await readOptional<JobClaimOwner>(path.join(safeTarget, 'owner.json')) : undefined;
          if (!current || current.ownerId !== owner.ownerId || current.jobId !== jobId) {
            throw new Error('Job execution claim ownership changed before release.');
          }
          await rm(target, {
            recursive: true,
            force: false,
            maxRetries: process.platform === 'win32' ? 3 : 0,
            retryDelay: 10
          });
          await syncDir(claims);
          released = true;
        }
      };
    } catch (error) {
      await rm(pending, { recursive: true, force: true }).catch(() => undefined);
      const code = (error as NodeJS.ErrnoException).code;
      const renameCollision = renameAttempted && !renamePublished
        && (code === 'EEXIST' || code === 'ENOTEMPTY' || (process.platform === 'win32' && code === 'EPERM'));
      if (!renameCollision) throw error;
      const windowsRenameCollision = process.platform === 'win32' && code === 'EPERM';
      let safeTarget: string | undefined;
      let current: JobClaimOwner | undefined;
      try {
        safeTarget = await safeJobOperationalDirectoryExists(target);
        current = safeTarget ? await readOptional<JobClaimOwner>(path.join(safeTarget, 'owner.json')) : undefined;
      } catch (inspectionError) {
        // A live owner can release the atomically-published claim between the
        // directory check and owner-file open. Retry only that disappearance;
        // every other inspection failure remains fail-closed.
        if ((inspectionError as NodeJS.ErrnoException).code === 'ENOENT') {
          if (windowsRenameCollision && attempt + 1 >= 3) throw error;
          continue;
        }
        throw inspectionError;
      }
      // Windows can report an existing non-empty rename target as EPERM. Only
      // classify that code as a claim collision after proving the target is a
      // safe, real directory. The winning owner can also release between the
      // failed rename and inspection, so retry that disappearance within the
      // existing attempt cap while preserving the final unexplained EPERM.
      if (!safeTarget) {
        if (windowsRenameCollision && attempt + 1 >= 3) throw error;
        continue;
      }
      if (!current) {
        if (attempt + 1 < 3) continue;
        throw new Error('Job execution claim is malformed and requires explicit local repair.');
      }
      if (current.jobId !== jobId || !UUID.test(current.ownerId)
        || !Number.isInteger(current.pid) || current.pid <= 0 || typeof current.hostname !== 'string') {
        throw new Error('Job execution claim is malformed and requires explicit local repair.');
      }
      if (current.hostname !== hostname() || pidIsAlive(current.pid)) return undefined;
      await ensureSafeJobOperationalDirectory(quarantine);
      try {
        await rename(target, path.join(quarantine, `${jobId}-${Date.now()}-${current.ownerId}`));
        await syncDir(claims);
        await syncDir(quarantine);
      } catch (reclaimError) {
        const reclaimCode = (reclaimError as NodeJS.ErrnoException).code;
        if (reclaimCode !== 'ENOENT' && reclaimCode !== 'EEXIST' && reclaimCode !== 'ENOTEMPTY') throw reclaimError;
      }
    }
  }
  return undefined;
}

async function assertClaimOwned(cwd: string, claim: JobExecutionClaim): Promise<void> {
  const claimDirectory = await safeJobOperationalDirectoryExists(path.join(jobsRoot(cwd), 'claims', claim.jobId));
  const owner = claimDirectory ? await readOptional<JobClaimOwner>(path.join(claimDirectory, 'owner.json')) : undefined;
  if (!owner || owner.jobId !== claim.jobId || owner.ownerId !== claim.ownerId) throw new Error('Job execution claim is not held by this lifecycle writer.');
}

async function readIdempotencyAnchors(cwd: string): Promise<Map<string, JobAnchor>> {
  const result = new Map<string, JobAnchor>();
  const dir = path.join(jobsRoot(cwd), 'idempotency');
  const names = await boundedDirectoryNames(dir, JOB_LEDGER_MAX_ENTRIES, 'Job idempotency ledger');
  for (const name of names.filter((value) => /^[0-9a-f]{64}\.json$/i.test(value))) {
    const entry = await readOptional<JobIdempotencyEntry>(path.join(dir, name));
    if (!entry || !UUID.test(entry.jobId) || !DIGEST.test(entry.requestDigest)) throw new Error('Job idempotency anchor is malformed.');
    const previous = result.get(entry.jobId);
    if (previous && previous.entry.requestDigest !== entry.requestDigest) throw new Error('Multiple idempotency anchors conflict for one job.');
    if (previous) throw new Error('Multiple idempotency anchors reference one job.');
    result.set(entry.jobId, { fileName: name, entry });
  }
  return result;
}

async function reconcileIdempotentJobRecords(cwd: string, anchors: Map<string, JobAnchor>): Promise<void> {
  for (const anchor of anchors.values()) {
    if (anchor.entry.stored) await ensureJobRecord(cwd, anchor.entry);
  }
}

async function listAllJobsHeld(cwd: string, maximum: number): Promise<StoredJob[]> {
  const anchors = await readIdempotencyAnchors(cwd);
  if (anchors.size > maximum) throw new Error(`Anchored job count exceeds the explicit recovery maximum of ${maximum}.`);
  await reconcileIdempotentJobRecords(cwd, anchors);
  const names = await boundedDirectoryNames(
    path.join(jobsRoot(cwd), 'records'),
    JOB_SIDE_DIRECTORY_MAX_ENTRIES,
    'Job record directory'
  );
  const anchoredNames = names.filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name) && anchors.has(name.slice(0, -5)));
  if (anchoredNames.length > maximum) throw new Error(`Anchored job count exceeds the explicit recovery maximum of ${maximum}.`);
  const jobs: StoredJob[] = [];
  for (const name of anchoredNames) {
    const stored = await readJobHeld(cwd, name.slice(0, -5));
    if (anchors.get(stored.job.jobId)?.entry.requestDigest !== stored.job.requestDigest) {
      throw new Error('Job record conflicts with its durable idempotency anchor.');
    }
    jobs.push(stored);
  }
  return jobs.sort((left, right) => right.job.createdAt.localeCompare(left.job.createdAt) || left.job.jobId.localeCompare(right.job.jobId));
}

async function admitJobLedgerEntry(cwd: string): Promise<void> {
  const anchors = await readIdempotencyAnchors(cwd);
  if (anchors.size < JOB_LEDGER_MAX_ENTRIES) return;
  await reconcileIdempotentJobRecords(cwd, anchors);
  await cleanupJobSideDirectories(cwd, anchors);

  const jobs = await readAnchoredJobs(cwd, anchors);
  const terminal = jobs
    .filter((stored) => ['succeeded', 'failed', 'cancelled'].includes(stored.job.state))
    .sort((left, right) => {
      const leftAt = left.job.completedAt ?? left.job.createdAt;
      const rightAt = right.job.completedAt ?? right.job.createdAt;
      return leftAt.localeCompare(rightAt) || left.job.jobId.localeCompare(right.job.jobId);
    });
  while (anchors.size >= JOB_LEDGER_MAX_ENTRIES) {
    const victim = terminal.shift();
    if (!victim) throw new JobLedgerCapacityError();
    const anchor = anchors.get(victim.job.jobId);
    if (!anchor) throw new Error('Terminal job lost its durable idempotency anchor during retention.');
    await pruneJobLedgerEntry(cwd, victim.job.jobId, anchor.fileName);
    anchors.delete(victim.job.jobId);
  }
}

async function readAnchoredJobs(cwd: string, anchors: Map<string, JobAnchor>): Promise<StoredJob[]> {
  const jobs: StoredJob[] = [];
  for (const [jobId, anchor] of anchors) {
    const stored = await readJobHeld(cwd, jobId);
    if (stored.job.requestDigest !== anchor.entry.requestDigest) throw new Error('Job record conflicts with its durable idempotency anchor.');
    jobs.push(stored);
  }
  return jobs;
}

async function cleanupJobSideDirectories(cwd: string, anchors: Map<string, JobAnchor>): Promise<void> {
  const root = jobsRoot(cwd);
  const recordNames = await boundedDirectoryNames(path.join(root, 'records'), JOB_SIDE_DIRECTORY_MAX_ENTRIES, 'Job record directory');
  for (const name of recordNames.filter((value) => /^[0-9a-f-]{36}\.json$/i.test(value))) {
    const jobId = name.slice(0, -5);
    if (!anchors.has(jobId)) await removeOptionalSynced(path.join(root, 'records', name));
  }

  const cancellationNames = await boundedDirectoryNames(path.join(root, 'cancellations'), JOB_LEDGER_MAX_ENTRIES, 'Job cancellation directory');
  for (const name of cancellationNames.filter((value) => /^[0-9a-f-]{36}\.json$/i.test(value))) {
    const jobId = name.slice(0, -5);
    if (!anchors.has(jobId)) {
      await removeOptionalSynced(path.join(root, 'cancellations', name));
      continue;
    }
    const record = validateJobCancellation(await readOptional<unknown>(path.join(root, 'cancellations', name)));
    if (record.jobId !== jobId) throw new Error('Job cancellation filename conflicts with its anchored job.');
  }
  const remainingCancellations = cancellationNames.filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name) && anchors.has(name.slice(0, -5))).length;
  if (remainingCancellations > anchors.size) throw new Error('Job cancellation directory exceeds the anchored job count.');
}

async function pruneJobLedgerEntry(cwd: string, jobId: string, anchorFileName: string): Promise<void> {
  const root = jobsRoot(cwd);
  // The anchor is removed last. A crash before that point remains repairable
  // from the embedded job record in the anchor; after it, no public job exists.
  await removeOptionalSynced(path.join(root, 'cancellations', `${jobId}.json`));
  await removeOptionalSynced(path.join(root, 'records', `${jobId}.json`));
  await removeOptionalSynced(path.join(root, 'idempotency', anchorFileName));
}

async function withJobLedgerLock<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
  const lock = await acquireJobLedgerLock(cwd);
  try { return await operation(); } finally { await lock.release(); }
}

async function acquireJobLedgerLock(cwd: string): Promise<HeldJobLedgerLock> {
  const root = await ensureSafeJobLedgerRoot(cwd);
  const file = path.join(root, 'admission.lock');
  for (let attempt = 0; attempt < JOB_LEDGER_LOCK_RETRIES; attempt += 1) {
    const owner: JobLedgerLockOwner = {
      ownerId: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: new Date().toISOString()
    };
    let handle: Awaited<ReturnType<typeof open>>;
    try { handle = await open(file, 'wx', 0o600); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await tryReclaimJobLedgerLock(file, root);
      if (attempt + 1 >= JOB_LEDGER_LOCK_RETRIES) throw new JobLedgerBusyError();
      await delay(10);
      continue;
    }
    try {
      await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      await syncDir(root);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(file, { force: true }).catch(() => undefined);
      await syncDir(root).catch(() => undefined);
      throw error;
    }
    let released = false;
    return {
      async release(): Promise<void> {
        if (released) return;
        const current = validJobLedgerLockOwner(await readOptional<unknown>(file));
        if (!current || current.ownerId !== owner.ownerId) throw new Error('Job ledger lock ownership changed before release.');
        await rm(file, { force: false });
        await syncDir(root);
        released = true;
      }
    };
  }
  throw new JobLedgerBusyError();
}

async function tryReclaimJobLedgerLock(file: string, root: string): Promise<void> {
  const info = await lstat(file).catch(() => undefined);
  if (!info) return;
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Job ledger lock must be a non-symlink regular file.');
  if (Date.now() - info.mtimeMs <= JOB_LEDGER_LOCK_LEASE_MS) return;
  const owner = validJobLedgerLockOwner(await readOptional<unknown>(file).catch(() => undefined));
  if (owner && (owner.hostname !== hostname() || pidIsAlive(owner.pid))) return;
  const stale = path.join(root, `.admission-stale-${randomUUID()}`);
  try {
    await rename(file, stale);
    await rm(stale, { force: true });
    await syncDir(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'EEXIST') throw error;
  }
}

async function removeOptionalSynced(file: string): Promise<void> {
  const parent = await safeJobOperationalDirectoryExists(path.dirname(file));
  if (!parent) return;
  const info = await lstat(file).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (!info) return;
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Job ledger records must be non-symlink regular files.');
  await rm(file, { force: true });
  await syncDir(parent);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function boundedDirectoryNames(dir: string, maximum: number, label: string): Promise<string[]> {
  const names: string[] = [];
  const safeDirectory = await safeJobOperationalDirectoryExists(dir);
  if (!safeDirectory) return names;
  let handle;
  try { handle = await opendir(safeDirectory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return names;
    throw error;
  }
  try {
    for await (const entry of handle) {
      if (names.length >= maximum) throw new Error(`${label} exceeds its explicit ${maximum}-entry scan cap and requires local repair.`);
      names.push(entry.name);
    }
  } finally {
    await handle.close().catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error;
    });
  }
  return names;
}

async function ensureJobRecord(cwd: string, entry: JobIdempotencyEntry): Promise<StoredJob> {
  if (!UUID.test(entry.jobId) || !DIGEST.test(entry.requestDigest)) throw new Error('Job idempotency record is malformed.');
  const records = await ensureSafeJobOperationalDirectory(path.join(jobsRoot(cwd), 'records'));
  const file = path.join(records, `${entry.jobId}.json`);
  const existing = await readOptional<unknown>(file);
  if (existing) {
    const record = validateStoredJob(existing);
    if (record.job.requestDigest !== entry.requestDigest) throw new Error('Job record conflicts with its idempotency transaction.');
    if (entry.stored && !sameJobIdentity(record, entry.stored)) throw new Error('Job record does not match its idempotency transaction.');
    return record;
  }
  if (!entry.stored) throw new Error('Legacy job idempotency record points to a missing job record.');
  const stored = validateStoredJob(entry.stored);
  if (stored.job.jobId !== entry.jobId || stored.job.requestDigest !== entry.requestDigest) throw new Error('Job idempotency transaction is inconsistent.');
  try {
    await writeExclusive(file, stored);
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = await readOptional<unknown>(file);
    if (!raced) throw error;
    const record = validateStoredJob(raced);
    if (!sameJobIdentity(record, stored)) throw new Error('Concurrent job record repair produced conflicting bytes.');
    return record;
  }
}

function sameJobIdentity(left: StoredJob, right: StoredJob): boolean {
  return canonicalJson(left.request) === canonicalJson(right.request)
    && left.job.jobId === right.job.jobId
    && left.job.type === right.job.type
    && left.job.expectedRevision === right.job.expectedRevision
    && left.job.idempotencyKey === right.job.idempotencyKey
    && left.job.requestDigest === right.job.requestDigest
    && left.job.confirmation === right.job.confirmation
    && left.job.createdAt === right.job.createdAt;
}

function validateStoredJob(value: unknown): StoredJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stored job is malformed.');
  const record = value as StoredJob;
  assertJob(record.job);
  assertJobRequest(record.request);
  if (!DIGEST.test(record.job.idempotencyKey) || record.request.idempotencyKey !== record.job.idempotencyKey) {
    throw new Error('Stored job idempotency key must be a matching persistence-safe digest.');
  }
  if (record.job.requestDigest !== hashText(canonicalJson(record.request))) throw new Error('Stored job request digest does not match its request.');
  return record;
}

function persistenceSafeJobRequest(request: JobRequestV1): JobRequestV1 {
  return {
    ...request,
    idempotencyKey: hashText(canonicalJson({ kind: 'skillmap.job-idempotency-key', value: request.idempotencyKey }))
  };
}

function validateJobCancellation(value: unknown): JobCancellationRecord {
  const record = object(value, 'job cancellation');
  exact(record, ['kind', 'schemaVersion', 'jobId', 'idempotencyDigest', 'requestedAt', 'payloadDigest'], 'job cancellation');
  if (record.kind !== 'skillmap.job-cancellation' || record.schemaVersion !== 1) throw new Error('Unsupported job cancellation record.');
  if (typeof record.jobId !== 'string' || !UUID.test(record.jobId)) throw new Error('Job cancellation jobId is invalid.');
  if (typeof record.idempotencyDigest !== 'string' || !DIGEST.test(record.idempotencyDigest)) throw new Error('Job cancellation idempotency digest is invalid.');
  timestamp(record.requestedAt, 'Job cancellation requestedAt');
  if (typeof record.payloadDigest !== 'string' || !DIGEST.test(record.payloadDigest)) throw new Error('Job cancellation payload digest is invalid.');
  const { payloadDigest, ...base } = record;
  if (payloadDigest !== hashText(canonicalJson(base))) throw new Error('Job cancellation payload digest does not match its record.');
  return record as unknown as JobCancellationRecord;
}

function pidIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

async function writeExclusive(file: string, value: unknown): Promise<void> {
  await ensureSafeJobOperationalDirectory(path.dirname(file));
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await syncDir(path.dirname(file));
}

async function atomicReplace(file: string, value: unknown): Promise<void> {
  await ensureSafeJobOperationalDirectory(path.dirname(file));
  const existing = await lstat(file).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new Error('Job records must be non-symlink regular files.');
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeExclusive(temp, value);
  await rename(temp, file);
  await syncDir(path.dirname(file));
}

async function syncDir(dir: string): Promise<void> {
  const stats = await lstat(dir);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Job ledger directory must be a non-symlink directory.');
  // Windows does not expose POSIX directory fsync. File handles are synced
  // before publication; keep directory validation while avoiding EPERM.
  if (process.platform === 'win32') return;
  const handle = await open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function readOptional<T>(file: string): Promise<T | undefined> {
  const before = await lstat(file).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (!before) return undefined;
  if (before.isSymbolicLink() || !before.isFile() || before.size > MAX_JOB_FILE_BYTES) {
    throw new Error('Job ledger record exceeds its safe regular-file boundary.');
  }
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_JOB_FILE_BYTES) {
      throw new Error('Job ledger record changed before it could be read safely.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length > MAX_JOB_FILE_BYTES || bytes.length !== after.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error('Job ledger record changed while it was being read.');
    }
    return JSON.parse(bytes.toString('utf8')) as T;
  } finally {
    await handle.close();
  }
}

async function ensureSafeJobLedgerRoot(cwd: string): Promise<string> {
  const workspace = path.resolve(cwd);
  const workspaceStats = await lstat(workspace);
  if (workspaceStats.isSymbolicLink() || !workspaceStats.isDirectory()) {
    throw new Error('Job ledger workspace must be a non-symlink directory.');
  }
  const workspaceReal = await realpath(workspace);
  let current = workspace;
  for (const segment of ['.skillmap', 'operational', 'jobs']) {
    current = path.join(current, segment);
    await ensurePlainJobDirectory(current);
    assertJobPathContained(workspaceReal, await realpath(current));
  }
  return current;
}

async function safeJobLedgerRootExists(cwd: string): Promise<string | undefined> {
  const workspace = path.resolve(cwd);
  const workspaceStats = await lstat(workspace);
  if (workspaceStats.isSymbolicLink() || !workspaceStats.isDirectory()) {
    throw new Error('Job ledger workspace must be a non-symlink directory.');
  }
  const workspaceReal = await realpath(workspace);
  let current = workspace;
  for (const segment of ['.skillmap', 'operational', 'jobs']) {
    current = path.join(current, segment);
    const exists = await plainJobDirectoryExists(current);
    if (!exists) return undefined;
    assertJobPathContained(workspaceReal, await realpath(current));
  }
  return current;
}

async function ensureSafeJobOperationalDirectory(directory: string): Promise<string> {
  const boundary = jobOperationalDirectoryBoundary(directory);
  const root = await ensureSafeJobLedgerRoot(boundary.workspace);
  const rootReal = await realpath(root);
  let current = root;
  for (const segment of boundary.relativeSegments) {
    current = path.join(current, segment);
    await ensurePlainJobDirectory(current);
    assertJobPathContained(rootReal, await realpath(current));
  }
  return current;
}

async function safeJobOperationalDirectoryExists(directory: string): Promise<string | undefined> {
  const boundary = jobOperationalDirectoryBoundary(directory);
  const root = await safeJobLedgerRootExists(boundary.workspace);
  if (!root) return undefined;
  const rootReal = await realpath(root);
  let current = root;
  for (const segment of boundary.relativeSegments) {
    current = path.join(current, segment);
    if (!(await plainJobDirectoryExists(current))) return undefined;
    assertJobPathContained(rootReal, await realpath(current));
  }
  return current;
}

function jobOperationalDirectoryBoundary(directory: string): { workspace: string; relativeSegments: string[] } {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let marker = -1;
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index] === '.skillmap' && segments[index + 1] === 'operational' && segments[index + 2] === 'jobs') marker = index;
  }
  if (marker < 0) throw new Error('Job operational path is outside the workspace job-ledger boundary.');
  const workspace = path.join(parsed.root, ...segments.slice(0, marker));
  const relativeSegments = segments.slice(marker + 3);
  if (relativeSegments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('Job operational path contains an unsafe segment.');
  }
  return { workspace, relativeSegments };
}

async function ensurePlainJobDirectory(directory: string): Promise<void> {
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Job ledger directories must not be symbolic links.');
}

async function plainJobDirectoryExists(directory: string): Promise<boolean> {
  const stats = await lstat(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (!stats) return false;
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Job ledger directories must not be symbolic links.');
  return true;
}

function assertJobPathContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Job ledger directory escapes its workspace boundary.');
  }
}

function validJobLedgerLockOwner(value: unknown): JobLedgerLockOwner | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.ownerId !== 'string' || !UUID.test(record.ownerId)
    || typeof record.pid !== 'number' || !Number.isSafeInteger(record.pid) || record.pid <= 0
    || typeof record.hostname !== 'string' || !record.hostname
    || typeof record.acquiredAt !== 'string' || !Number.isFinite(Date.parse(record.acquiredAt))) return undefined;
  return record as unknown as JobLedgerLockOwner;
}

function jobsRoot(cwd: string): string { return path.join(cwd, '.skillmap', 'operational', 'jobs'); }
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, required: string[], label: string, optional: string[] = []): void { for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing ${key}.`); const allowed = new Set([...required, ...optional]); for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}.`); }
function oneOf(value: unknown, allowed: readonly string[], label: string): void { if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`${label} is invalid.`); }
function boundedCode(value: unknown, label: string, max = 64): void { if (typeof value !== 'string' || value.length < 1 || value.length > max || !CODE.test(value)) throw new Error(`${label} is invalid.`); }
function timestamp(value: unknown, label: string): void { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`); }
