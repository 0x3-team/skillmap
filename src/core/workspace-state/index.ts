import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import {
  assertDirectory,
  atomicReplaceSynced,
  ensurePrivateDirectory,
  jsonBytes,
  pathExists,
  readRegularFile,
  syncDirectory,
  writeExclusiveSynced,
  WORKSPACE_STATE_READ_LIMITS
} from './durability.js';
import { errorCode, RevisionValidationError, WorkspaceStateConflictError, WorkspaceStateError } from './errors.js';
import { classifyLegacyDivergence, repairLegacyProjections, writeProjectionIndex } from './legacy.js';
import { acquireWorkspaceLock, type HeldWorkspaceLock } from './lock.js';
import { revisionDirectory, routingApprovalHistoryPath, workspaceStatePaths, type WorkspaceStatePaths } from './paths.js';
import {
  assertRoutingApprovalEligible,
  buildRevision,
  collectLegacySnapshot,
  revisionArtifacts,
  verifyLegacySnapshotStillCurrent,
  validateRevision,
  type RevisionBuildOptions,
  type SnapshotArtifact
} from './revision.js';
import { attachPayloadDigest, makeRoutingApproval, manifestPointerMismatch, validateMarker, validatePointer } from './schema.js';
import type {
  MigrationOptions,
  PublicationResult,
  PublishOptions,
  RecoveryOptions,
  RevisionMutation,
  RollbackOptions,
  WorkspaceMutationLock,
  WorkspacePointer,
  WorkspaceRevisionManifest,
  WorkspaceStateMarker,
  WorkspaceStateRead,
  WorkspaceStateStoreOptions
} from './types.js';

export * from './errors.js';
export * from './types.js';

interface HeldPublicationContext {
  lock: HeldWorkspaceLock;
  published: boolean;
}

export class WorkspaceStateStore {
  readonly paths: WorkspaceStatePaths;
  private readonly producerVersion: string;
  private readonly lockLeaseMs: number;
  private readonly now: () => Date;
  private readonly failpoint?: WorkspaceStateStoreOptions['failpoint'];

  private constructor(cwd: string, options: WorkspaceStateStoreOptions = {}) {
    this.paths = workspaceStatePaths(cwd);
    this.producerVersion = options.producerVersion ?? '0.1.0';
    this.lockLeaseMs = options.lockLeaseMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    this.failpoint = options.failpoint;
  }

  static open(cwd: string, options: WorkspaceStateStoreOptions = {}): WorkspaceStateStore {
    return new WorkspaceStateStore(cwd, options);
  }

  /**
   * Holds one owner/fencing token across an existing legacy command and its
   * snapshot publication. The callback must call context.publishLegacySnapshot
   * after its legacy writes. Only one publication is allowed per lock token.
   */
  async withMutationLock<T>(operation: string, fn: (context: WorkspaceMutationLock) => Promise<T>): Promise<T> {
    const lock = await acquireWorkspaceLock(this.paths, operation, this.now, this.lockLeaseMs);
    const held: HeldPublicationContext = { lock, published: false };
    const context = {
      fencingToken: lock.owner.fencingToken,
      ownerId: lock.owner.ownerId,
      migrateLegacy: (options: MigrationOptions) => this.migrateLegacyHeld(held, options),
      publishLegacySnapshot: (options: PublishOptions = {}) => this.publishLegacySnapshotHeld(held, options),
      __heldLock: lock
    } as WorkspaceMutationLock & { __heldLock: HeldWorkspaceLock };
    try {
      await this.failpoint?.('after-lock-acquired');
      return await fn(context);
    } finally {
      await lock.release();
    }
  }

  /** Convenience integration path: mutate legacy state and publish it before releasing the same lock. */
  async withLegacyMutation<T>(
    operation: string,
    options: PublishOptions,
    mutate: () => Promise<T>
  ): Promise<{ value: T; publication: PublicationResult }> {
    return this.withMutationLock(operation, async (context) => {
      const value = await mutate();
      const publication = await context.publishLegacySnapshot(options);
      return { value, publication };
    });
  }

  /** Initial-command integration path: legacy writes and state activation share one lock. */
  async withInitialLegacyMutation<T>(
    operation: string,
    options: MigrationOptions,
    mutate: () => Promise<T>
  ): Promise<{ value: T; publication: PublicationResult }> {
    return this.withMutationLock(operation, async (context) => {
      const value = await mutate();
      const publication = await context.migrateLegacy(options);
      return { value, publication };
    });
  }

  async isMigrated(): Promise<boolean> {
    if (!(await pathExists(this.paths.marker))) return false;
    await this.readMarker();
    return true;
  }

  async migrateLegacy(options: MigrationOptions): Promise<PublicationResult> {
    return this.withMutationLock('legacy-migration', (context) => context.migrateLegacy(options));
  }

  async publishLegacySnapshot(options: PublishOptions = {}): Promise<PublicationResult> {
    return this.withMutationLock('legacy-snapshot', (context) => context.publishLegacySnapshot(options));
  }

  /**
   * Publishes a fully prepared artifact set with an exact CAS binding. Slow
   * discovery, network access, and report generation must happen before this
   * method is called. The writer lock is held only while immutable bytes are
   * validated, durably published, and projected back to legacy read paths.
   */
  async publishPreparedSnapshot(options: {
    expectedRevisionId: string;
    workspaceId: string;
    artifacts: SnapshotArtifact[];
    approveForRouting?: boolean;
    carryForwardRoutingApproval?: boolean;
    actor: string;
    reason: string;
    prePublishCheck?: () => Promise<void>;
  }): Promise<PublicationResult> {
    if (!options.expectedRevisionId || !options.workspaceId || !options.actor.trim() || !options.reason.trim()) {
      throw new WorkspaceStateError('STATE_PREPARED_SNAPSHOT_INVALID', 'Prepared publication requires an exact revision, workspace, actor, and reason receipt.');
    }
    if (options.approveForRouting && options.carryForwardRoutingApproval) {
      throw new WorkspaceStateError('STATE_PREPARED_SNAPSHOT_INVALID', 'Prepared publication must choose either explicit routing approval or exact approval carry-forward.');
    }
    return this.withMutationLock('prepared-snapshot-publication', async (context) => {
      const lock = this.contextLock(context);
      const marker = await this.readMarker();
      const current = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
      this.assertFenceAdvances(lock, current);
      if (current.workspaceId !== marker.workspaceId || options.workspaceId !== marker.workspaceId) {
        throw new WorkspaceStateError('STATE_WORKSPACE_ID_MISMATCH', 'Prepared artifacts do not belong to the active workspace.');
      }
      if (current.revisionId !== options.expectedRevisionId) {
        throw new WorkspaceStateConflictError(`Expected revision ${options.expectedRevisionId}, found ${current.revisionId}.`);
      }
      await validateRevision(this.paths, current.revisionId, current);
      await options.prePublishCheck?.();
      if (options.approveForRouting) assertRoutingApprovalEligible(options.artifacts);
      if (options.carryForwardRoutingApproval) {
        const approved = await this.readPointerOnce(this.paths.lastKnownGoodPointer, 'skillmap.workspace-last-known-good');
        if (approved.workspaceId !== current.workspaceId || approved.revisionId !== current.revisionId) {
          throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_REQUIRED', 'Routing approval can be carried forward only from the exact approved current revision.');
        }
        await validateRevision(this.paths, approved.revisionId, approved);
      }
      const revision = await buildRevision(this.paths, this.revisionOptions(lock, marker.workspaceId, current.revisionId, {
        kind: 'legacy-snapshot',
        actor: options.actor,
        reason: options.reason,
        sourceRevisionId: current.revisionId
      }, options.artifacts));
      if (options.carryForwardRoutingApproval && revision.manifest.routingSafetyDigest !== current.routingSafetyDigest) {
        throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_CHANGED', 'Prepared output changed routing safety and cannot inherit approval.');
      }
      const approveForRouting = options.approveForRouting === true || options.carryForwardRoutingApproval === true;
      if (approveForRouting) assertRoutingApprovalEligible(options.artifacts);
      const result = await this.publishBuiltRevision(lock, revision, approveForRouting);
      await this.bestEffortRepair(revision, result);
      return result;
    });
  }

  /** Returns one bounded page from the fully verified current ancestry. */
  async readRevisionAncestry(options: { limit?: number; startRevisionId?: string } = {}): Promise<import('./types.js').VerifiedRevisionAncestryPage> {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new WorkspaceStateError('STATE_REVISION_HISTORY_LIMIT_INVALID', 'Revision history limit must be between 1 and 100.');
    }
    const marker = await this.readMarker();
    const currentPointer = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
    if (currentPointer.workspaceId !== marker.workspaceId) throw new WorkspaceStateError('STATE_WORKSPACE_ID_MISMATCH', 'State marker and current pointer workspace IDs differ.');
    let revision = await validateRevision(this.paths, currentPointer.revisionId, currentPointer);
    const visited = new Set<string>();
    const revisions: Awaited<ReturnType<typeof validateRevision>>[] = [];
    let collecting = options.startRevisionId === undefined;
    for (let depth = 0; depth < 10_000; depth += 1) {
      if (visited.has(revision.manifest.revisionId)) throw new WorkspaceStateError('STATE_REVISION_HISTORY_CYCLE', 'Workspace revision history contains a cycle.');
      visited.add(revision.manifest.revisionId);
      if (options.startRevisionId === revision.manifest.revisionId) collecting = true;
      if (collecting) {
        if (revisions.length === limit) return { currentPointer, revisions, nextRevisionId: revision.manifest.revisionId };
        revisions.push(revision);
      }
      const parentId = revision.manifest.parentRevisionId;
      if (!parentId) {
        if (options.startRevisionId && !collecting) throw new WorkspaceStateError('STATE_REVISION_CURSOR_INVALID', 'Revision history cursor is not in the verified current ancestry.');
        return { currentPointer, revisions, nextRevisionId: null };
      }
      const parent = await validateRevision(this.paths, parentId);
      if (parent.manifest.workspaceId !== currentPointer.workspaceId || parent.manifest.sequence >= revision.manifest.sequence) {
        throw new WorkspaceStateError('STATE_REVISION_HISTORY_INVALID', 'Workspace revision history is non-monotonic or crosses workspaces.');
      }
      revision = parent;
    }
    throw new WorkspaceStateError('STATE_REVISION_HISTORY_TOO_DEEP', 'Workspace revision history exceeds the verified traversal limit.');
  }

  /**
   * Resolves a revision from its immutable historical copy of an exact
   * last-known-good approval. Approval records are written only after the
   * revision became the validated routing pointer, so an abandoned rollback
   * branch remains a legitimate historical baseline without requiring an
   * O(history) traversal on every status poll.
   */
  async findRoutingApprovedRevision(revisionId: string): Promise<import('./types.js').ValidatedRevision> {
    const marker = await this.readMarker();
    const current = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
    const approval = await this.readRoutingApprovalHistory(revisionId);
    if (!approval
      || approval.workspaceId !== marker.workspaceId
      || approval.workspaceId !== current.workspaceId
      || approval.sequence > current.sequence) {
      throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_UNTRUSTED', `Revision ${revisionId} has no durable routing-approval receipt.`);
    }
    return validateRevision(this.paths, revisionId, approval);
  }

  /** Checks an already verified revision without retraversing its ancestry. */
  async hasRoutingApprovalReceipt(
    revision: import('./types.js').ValidatedRevision,
    options: { revalidateArtifacts?: boolean } = {}
  ): Promise<boolean> {
    const revisionId = revision.manifest.revisionId;
    const approval = await this.readRoutingApprovalHistory(revisionId);
    if (!approval) return false;
    if (approval.revisionId !== revisionId || approval.workspaceId !== revision.manifest.workspaceId) return false;
    if (approval.manifestDigest !== revision.manifestDigest || manifestPointerMismatch(approval, revision.manifest)) {
      throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_HISTORY_INVALID', `Historical routing approval for ${revisionId} does not match verified ancestry.`);
    }
    if (options.revalidateArtifacts !== false) {
      const approvedRevision = await validateRevision(this.paths, revisionId, approval);
      if (approvedRevision.manifestDigest !== revision.manifestDigest) {
        throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_HISTORY_INVALID', `Historical routing approval for ${revisionId} changed after its ancestry proof.`);
      }
    }
    return true;
  }

  private async readRoutingApprovalHistory(revisionId: string): Promise<WorkspacePointer | undefined> {
    const historyPath = routingApprovalHistoryPath(this.paths, revisionId);
    try {
      const bytes = await readRegularFile(historyPath, {
        root: this.paths.skillmap,
        maxBytes: WORKSPACE_STATE_READ_LIMITS.pointerBytes,
        label: 'Historical routing approval pointer'
      });
      return validatePointer(JSON.parse(bytes.toString('utf8')), 'skillmap.workspace-last-known-good');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_HISTORY_INVALID', `Historical routing approval for ${revisionId} is invalid.`, { cause: error });
      }
    }
    const currentApproval = await this.readPointerOnce(this.paths.lastKnownGoodPointer, 'skillmap.workspace-last-known-good').catch(() => undefined);
    return currentApproval?.revisionId === revisionId ? currentApproval : undefined;
  }

  /** Finds a verified publication receipt in the current revision ancestry. */
  async findPublishedMutation(input: { actor: string; parentRevisionId: string }): Promise<WorkspaceRevisionManifest | undefined> {
    const current = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
    let revision = await validateRevision(this.paths, current.revisionId, current);
    const visited = new Set<string>();
    for (let depth = 0; depth < 10_000; depth += 1) {
      if (visited.has(revision.manifest.revisionId)) throw new WorkspaceStateError('STATE_REVISION_HISTORY_CYCLE', 'Workspace revision history contains a cycle.');
      visited.add(revision.manifest.revisionId);
      if (revision.manifest.mutation.actor === input.actor && revision.manifest.parentRevisionId === input.parentRevisionId) return revision.manifest;
      const parentId = revision.manifest.parentRevisionId;
      if (!parentId) return undefined;
      const parent = await validateRevision(this.paths, parentId);
      if (parent.manifest.workspaceId !== current.workspaceId || parent.manifest.sequence >= revision.manifest.sequence) {
        throw new WorkspaceStateError('STATE_REVISION_HISTORY_INVALID', 'Workspace revision history is non-monotonic or crosses workspaces.');
      }
      revision = parent;
    }
    throw new WorkspaceStateError('STATE_REVISION_HISTORY_TOO_DEEP', 'Workspace revision history exceeds the verified traversal limit.');
  }

  async readCurrent(options: { purpose?: 'status' | 'routing' } = {}): Promise<WorkspaceStateRead> {
    const purpose = options.purpose ?? 'status';
    const marker = await this.readMarker();
    const currentPointer = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
    if (currentPointer.workspaceId !== marker.workspaceId) throw new WorkspaceStateError('STATE_WORKSPACE_ID_MISMATCH', 'State marker and current pointer workspace IDs differ.');
    let revision;
    let selectedPointer = currentPointer;
    let source: WorkspaceStateRead['source'] = 'current';
    let currentFailure: WorkspaceStateRead['currentFailure'];
    try {
      revision = await validateRevision(this.paths, currentPointer.revisionId, currentPointer);
    } catch (error) {
      if (!(error instanceof RevisionValidationError) || error.artifactRole !== 'derived') throw error;
      currentFailure = { code: error.code, message: error.message, ...(error.artifactPath ? { artifactPath: error.artifactPath } : {}), artifactRole: 'derived' };
      const lkg = await this.readPointerOnce(this.paths.lastKnownGoodPointer, 'skillmap.workspace-last-known-good');
      if (lkg.workspaceId !== currentPointer.workspaceId
        || lkg.routingSafetyDigest !== currentPointer.routingSafetyDigest
        || lkg.canonicalIntentDigest !== currentPointer.canonicalIntentDigest
        || lkg.rawTruthDigest !== currentPointer.rawTruthDigest) {
        throw new WorkspaceStateError('STATE_LKG_SAFETY_MISMATCH', 'Last-known-good is ineligible because canonical or raw routing safety changed.', { cause: error });
      }
      revision = await validateRevision(this.paths, lkg.revisionId, lkg);
      selectedPointer = lkg;
      source = 'last-known-good';
    }
    if (purpose === 'routing' && source === 'current') {
      let approved: WorkspacePointer;
      try {
        approved = await this.readPointerOnce(this.paths.lastKnownGoodPointer, 'skillmap.workspace-last-known-good');
      } catch (error) {
        throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_REQUIRED', 'Current workspace state has not been explicitly approved for routing.', { cause: error });
      }
      if (approved.workspaceId !== currentPointer.workspaceId) {
        throw new WorkspaceStateError('STATE_WORKSPACE_ID_MISMATCH', 'Routing approval and current pointer workspace IDs differ.');
      }
      if (approved.revisionId === currentPointer.revisionId) {
        // Revalidate through the approval pointer so a malformed or forged LKG
        // receipt cannot implicitly bless the current revision.
        await validateRevision(this.paths, approved.revisionId, approved);
      } else {
        if (approved.routingSafetyDigest !== currentPointer.routingSafetyDigest
          || approved.canonicalIntentDigest !== currentPointer.canonicalIntentDigest
          || approved.rawTruthDigest !== currentPointer.rawTruthDigest) {
          throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_REQUIRED', 'Current canonical or raw routing state differs from the last explicitly approved revision.');
        }
        revision = await validateRevision(this.paths, approved.revisionId, approved);
        selectedPointer = approved;
        source = 'last-known-good';
      }
    }
    const legacyDivergence = await classifyLegacyDivergence(this.paths, revision);
    if (purpose === 'routing') {
      if (selectedPointer.effectiveDigest === null || selectedPointer.effectiveRevisionDigest === null) {
        throw new WorkspaceStateError('STATE_ROUTING_EFFECTIVE_MISSING', 'Selected workspace revision has no validated immutable/semantic effective registry; routing must abstain.');
      }
      if (legacyDivergence.some((item) => item.severity === 'blocking')) {
        throw new WorkspaceStateError('STATE_LEGACY_CANONICAL_DIVERGENCE', 'Canonical legacy projections diverged from the approved workspace revision; routing must abstain.');
      }
    }
    return { source, currentPointer, selectedPointer, revision, ...(currentFailure ? { currentFailure } : {}), legacyDivergence };
  }

  async rollback(options: RollbackOptions): Promise<PublicationResult> {
    if (!options.actor?.trim() || !options.reason?.trim()) throw new WorkspaceStateError('STATE_ROLLBACK_RECEIPT_REQUIRED', 'Rollback requires actor and reason.');
    return this.withMutationLock('rollback', async (context) => {
      const lock = this.contextLock(context);
      const marker = await this.readMarker();
      const current = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
      this.assertFenceAdvances(lock, current);
      if (current.revisionId !== options.expectedRevisionId) throw new WorkspaceStateConflictError(`Expected revision ${options.expectedRevisionId}, found ${current.revisionId}.`);
      const currentRevision = await validateRevision(this.paths, current.revisionId, current);
      const target = await this.findAncestorRevision(currentRevision, options.targetRevisionId);
      if (target.manifest.workspaceId !== marker.workspaceId) throw new WorkspaceStateError('STATE_ROLLBACK_WORKSPACE_MISMATCH', 'Rollback target belongs to another workspace.');
      const artifacts = await revisionArtifacts(this.paths, target);
      if (options.approveForRouting) assertRoutingApprovalEligible(artifacts);
      const next = await buildRevision(this.paths, this.revisionOptions(lock, marker.workspaceId, current.revisionId, {
        kind: 'rollback', actor: options.actor, reason: options.reason,
        sourceRevisionId: current.revisionId, targetRevisionId: target.manifest.revisionId
      }, artifacts));
      const result = await this.publishBuiltRevision(lock, next, options.approveForRouting ?? false);
      await this.bestEffortRepair(next, result);
      return result;
    });
  }

  async recoverFromLastKnownGood(options: RecoveryOptions): Promise<PublicationResult> {
    if (!options.confirm) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Recovery requires confirm: true.');
    return this.withMutationLock('recovery', async (context) => {
      const lock = this.contextLock(context);
      const marker = await this.readMarker();
      const current = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
      this.assertFenceAdvances(lock, current);
      let currentError: RevisionValidationError;
      try {
        await validateRevision(this.paths, current.revisionId, current);
        throw new WorkspaceStateError('STATE_RECOVERY_NOT_REQUIRED', 'Current revision validates; recovery is not required.');
      } catch (error) {
        if (!(error instanceof RevisionValidationError) || error.artifactRole !== 'derived') throw error;
        currentError = error;
      }
      const lkg = await this.readPointerOnce(this.paths.lastKnownGoodPointer, 'skillmap.workspace-last-known-good');
      if (lkg.workspaceId !== marker.workspaceId
        || lkg.routingSafetyDigest !== current.routingSafetyDigest
        || lkg.canonicalIntentDigest !== current.canonicalIntentDigest
        || lkg.rawTruthDigest !== current.rawTruthDigest) {
        throw new WorkspaceStateError('STATE_LKG_SAFETY_MISMATCH', 'Recovery cannot use last-known-good after canonical or raw routing safety changed.', { cause: currentError });
      }
      const lkgRevision = await validateRevision(this.paths, lkg.revisionId, lkg);
      const artifacts = await revisionArtifacts(this.paths, lkgRevision);
      assertRoutingApprovalEligible(artifacts);
      const recovered = await buildRevision(this.paths, this.revisionOptions(lock, marker.workspaceId, lkg.revisionId, {
        kind: 'recovery',
        ...(options.actor ? { actor: options.actor } : {}),
        reason: options.reason ?? `Recovered derived corruption ${currentError.code}`,
        sourceRevisionId: current.revisionId,
        targetRevisionId: lkg.revisionId
      }, artifacts));
      const result = await this.publishBuiltRevision(lock, recovered, true);
      await this.bestEffortRepair(recovered, result);
      await this.bestEffortQuarantine(current.revisionId, result);
      return result;
    });
  }

  async repairLegacyProjections(options: { confirm: boolean }): Promise<void> {
    if (!options.confirm) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Projection repair requires confirm: true.');
    await this.withMutationLock('repair-legacy-projections', async (context) => {
      const lock = this.contextLock(context);
      const marker = await this.readMarker();
      const current = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
      if (current.workspaceId !== marker.workspaceId) throw new WorkspaceStateError('STATE_WORKSPACE_ID_MISMATCH', 'State marker and current pointer workspace IDs differ.');
      const revision = await validateRevision(this.paths, current.revisionId, current);
      await lock.assertHeld();
      await repairLegacyProjections(this.paths, revision, this.now().toISOString());
    });
  }

  private async publishLegacySnapshotHeld(held: HeldPublicationContext, options: PublishOptions): Promise<PublicationResult> {
    if (held.published) throw new WorkspaceStateConflictError('One writer lock/fencing token may publish only one revision.');
    const marker = await this.readMarker();
    const current = await this.readPointerOnce(this.paths.currentPointer, 'skillmap.workspace-current');
    this.assertFenceAdvances(held.lock, current);
    if (current.workspaceId !== marker.workspaceId) throw new WorkspaceStateError('STATE_WORKSPACE_ID_MISMATCH', 'State marker and current pointer workspace IDs differ.');
    if (options.expectedRevisionId && current.revisionId !== options.expectedRevisionId) {
      throw new WorkspaceStateConflictError(`Expected revision ${options.expectedRevisionId}, found ${current.revisionId}.`);
    }
    await validateRevision(this.paths, current.revisionId, current);
    const snapshot = await collectLegacySnapshot(this.paths);
    if (snapshot.workspaceId !== marker.workspaceId) throw new WorkspaceStateError('STATE_WORKSPACE_ID_DIVERGED', 'Legacy snapshot workspaceId differs from the state marker.');
    if (options.approveForRouting) assertRoutingApprovalEligible(snapshot.artifacts);
    const revision = await buildRevision(this.paths, this.revisionOptions(held.lock, marker.workspaceId, current.revisionId, {
      kind: 'legacy-snapshot',
      ...(options.actor ? { actor: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      sourceRevisionId: current.revisionId
    }, snapshot.artifacts));
    await verifyLegacySnapshotStillCurrent(this.paths, snapshot.artifacts);
    held.published = true;
    const result = await this.publishBuiltRevision(held.lock, revision, options.approveForRouting ?? false);
    await this.bestEffortProjectionIndex(revision, result);
    return result;
  }

  private async migrateLegacyHeld(held: HeldPublicationContext, options: MigrationOptions): Promise<PublicationResult> {
    if (!options.confirm) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Legacy migration requires confirm: true.');
    if (held.published) throw new WorkspaceStateConflictError('One writer lock/fencing token may publish only one revision.');
    if (await pathExists(this.paths.marker)) {
      if (await pathExists(this.paths.currentPointer)) throw new WorkspaceStateConflictError('Workspace state is already migrated.');
      held.published = true;
      return this.resumeInterruptedMigration(held.lock, options.approveForRouting ?? false);
    }
    if (await pathExists(this.paths.currentPointer)) throw new WorkspaceStateError('STATE_POINTER_WITHOUT_MARKER', 'Current pointer exists without a state-version marker.');
    const snapshot = await collectLegacySnapshot(this.paths);
    if (options.approveForRouting) assertRoutingApprovalEligible(snapshot.artifacts);
    const revision = await buildRevision(this.paths, this.revisionOptions(held.lock, snapshot.workspaceId, null, {
      kind: 'legacy-migration',
      ...(options.actor ? { actor: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {})
    }, snapshot.artifacts));
    await verifyLegacySnapshotStillCurrent(this.paths, snapshot.artifacts);
    const marker = validateMarker(attachPayloadDigest({
      kind: 'skillmap.workspace-state' as const,
      schemaVersion: 1 as const,
      layoutVersion: 1 as const,
      workspaceId: snapshot.workspaceId,
      migrationRevisionId: revision.manifest.revisionId,
      activatedAt: this.now().toISOString(),
      legacyMode: 'read-only-projection' as const
    }));
    await atomicReplaceSynced(this.paths.marker, jsonBytes(marker), 0o600, () => held.lock.assertHeld());
    held.published = true;
    const result = await this.publishBuiltRevision(held.lock, revision, options.approveForRouting ?? false);
    await this.bestEffortProjectionIndex(revision, result);
    return result;
  }

  private async publishBuiltRevision(lock: HeldWorkspaceLock, revision: Awaited<ReturnType<typeof buildRevision>>, approveForRouting: boolean): Promise<PublicationResult> {
    const publishedAt = this.now().toISOString();
    const current = this.pointerForRevision('skillmap.workspace-current', revision, publishedAt);
    const warnings: string[] = [];
    await this.failpoint?.('before-current-pointer-swap');
    await atomicReplaceSynced(this.paths.currentPointer, jsonBytes(current), 0o600, () => lock.assertHeld());
    await this.failpoint?.('after-current-pointer-swap');
    let lkgUpdated = false;
    if (approveForRouting) {
      try {
        const reloaded = await validateRevision(this.paths, current.revisionId, current);
        assertRoutingApprovalEligible(await revisionArtifacts(this.paths, reloaded));
        await this.persistCurrentRoutingApprovalHistory();
        const lkg = this.pointerForRevision('skillmap.workspace-last-known-good', revision, publishedAt);
        await atomicReplaceSynced(this.paths.lastKnownGoodPointer, jsonBytes(lkg), 0o600, () => lock.assertHeld());
        lkgUpdated = true;
        try {
          await this.persistRoutingApprovalHistory(lkg);
        } catch (error) {
          warnings.push(`Last-known-good advanced, but its historical approval receipt could not be persisted: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        warnings.push(`Current revision was published, but last-known-good was not advanced: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (lkgUpdated) await this.failpoint?.('after-last-known-good-swap');
    }
    return { pointer: current, manifest: revision.manifest, lastKnownGoodUpdated: lkgUpdated, projectionIndexUpdated: false, warnings };
  }

  private async persistCurrentRoutingApprovalHistory(): Promise<void> {
    let currentApproval: WorkspacePointer;
    try {
      currentApproval = await this.readPointerOnce(this.paths.lastKnownGoodPointer, 'skillmap.workspace-last-known-good');
    } catch (error) {
      if (error instanceof WorkspaceStateError && error.code === 'STATE_LKG_POINTER_INVALID'
        && errorCode(error.cause) === 'ENOENT') return;
      throw error;
    }
    await validateRevision(this.paths, currentApproval.revisionId, currentApproval);
    await this.persistRoutingApprovalHistory(currentApproval);
  }

  private async persistRoutingApprovalHistory(pointer: WorkspacePointer): Promise<void> {
    const target = routingApprovalHistoryPath(this.paths, pointer.revisionId);
    const expected = jsonBytes(pointer);
    try {
      await writeExclusiveSynced(target, expected, 0o600);
      await syncDirectory(this.paths.routingApprovals);
      return;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    const existing = await readRegularFile(target, {
      root: this.paths.skillmap,
      maxBytes: WORKSPACE_STATE_READ_LIMITS.pointerBytes,
      label: 'Historical routing approval pointer'
    });
    const validated = validatePointer(JSON.parse(existing.toString('utf8')), 'skillmap.workspace-last-known-good');
    if (validated.revisionId !== pointer.revisionId || existing.compare(expected) !== 0) {
      throw new WorkspaceStateError('STATE_ROUTING_APPROVAL_HISTORY_CONFLICT', `Historical routing approval for ${pointer.revisionId} conflicts with the exact approval receipt.`);
    }
  }

  private pointerForRevision(kind: WorkspacePointer['kind'], revision: Awaited<ReturnType<typeof buildRevision>>, publishedAt: string): WorkspacePointer {
    const base = {
      kind,
      schemaVersion: 1 as const,
      workspaceId: revision.manifest.workspaceId,
      revisionId: revision.manifest.revisionId,
      sequence: revision.manifest.sequence,
      workspaceRevision: revision.manifest.workspaceRevision,
      manifestDigest: revision.manifestDigest,
      canonicalIntentDigest: revision.manifest.canonicalIntentDigest,
      rawTruthDigest: revision.manifest.rawTruthDigest,
      routingSafetyDigest: revision.manifest.routingSafetyDigest,
      readModelDigest: revision.manifest.readModelDigest,
      effectiveDigest: revision.manifest.effectiveDigest,
      effectiveRevisionDigest: revision.manifest.effectiveRevisionDigest,
      fencingToken: revision.manifest.fencingToken,
      publishedAt,
      ...(kind === 'skillmap.workspace-last-known-good'
        ? { routingApproval: makeRoutingApproval(revision.manifest.revisionId, revision.manifest.routingSafetyDigest, publishedAt) }
        : {})
    };
    return validatePointer(attachPayloadDigest(base), kind);
  }

  private revisionOptions(
    lock: HeldWorkspaceLock,
    workspaceId: string,
    parentRevisionId: string | null,
    mutation: RevisionMutation,
    artifacts: SnapshotArtifact[]
  ): RevisionBuildOptions {
    return {
      workspaceId,
      fencingToken: lock.owner.fencingToken,
      parentRevisionId,
      mutation,
      artifacts,
      producerVersion: this.producerVersion,
      createdAt: this.now().toISOString(),
      failpoint: this.failpoint
    };
  }

  private async resumeInterruptedMigration(lock: HeldWorkspaceLock, approveForRouting: boolean): Promise<PublicationResult> {
    const marker = await this.readMarker();
    const revision = await validateRevision(this.paths, marker.migrationRevisionId);
    if (revision.manifest.workspaceId !== marker.workspaceId) throw new WorkspaceStateError('STATE_WORKSPACE_ID_MISMATCH', 'Interrupted migration marker and revision workspace IDs differ.');
    if (approveForRouting) assertRoutingApprovalEligible(await revisionArtifacts(this.paths, revision));
    const result = await this.publishBuiltRevision(lock, revision, approveForRouting);
    await this.bestEffortProjectionIndex(revision, result);
    return result;
  }

  private async readMarker(): Promise<WorkspaceStateMarker> {
    if (!(await pathExists(this.paths.marker))) throw new WorkspaceStateError('STATE_NOT_MIGRATED', 'Workspace has no state-version marker; explicit migration is required.');
    try {
      await assertDirectory(this.paths.skillmap);
      await assertDirectory(this.paths.state);
      await assertDirectory(this.paths.pointers);
      await assertDirectory(this.paths.revisions);
      return validateMarker(JSON.parse((await readRegularFile(this.paths.marker, {
        root: this.paths.skillmap,
        maxBytes: WORKSPACE_STATE_READ_LIMITS.markerBytes,
        label: 'Workspace state marker'
      })).toString('utf8')));
    } catch (error) {
      throw new WorkspaceStateError('STATE_MARKER_INVALID', `Workspace state marker is invalid: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  private async readPointerOnce(file: string, kind: WorkspacePointer['kind']): Promise<WorkspacePointer> {
    try {
      const bytes = await readRegularFile(file, {
        root: this.paths.skillmap,
        maxBytes: WORKSPACE_STATE_READ_LIMITS.pointerBytes,
        label: kind === 'skillmap.workspace-current' ? 'Current workspace pointer' : 'Last-known-good workspace pointer'
      });
      return validatePointer(JSON.parse(bytes.toString('utf8')), kind);
    } catch (error) {
      throw new WorkspaceStateError(
        kind === 'skillmap.workspace-current' ? 'STATE_CURRENT_POINTER_INVALID' : 'STATE_LKG_POINTER_INVALID',
        `${kind === 'skillmap.workspace-current' ? 'Current' : 'Last-known-good'} workspace pointer is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  private contextLock(context: WorkspaceMutationLock): HeldWorkspaceLock {
    // Context instances are constructed only by this store. Resolve the active
    // lock through the currently materialized owner identity without exposing
    // filesystem mutation primitives to callers.
    const hidden = (context as WorkspaceMutationLock & { __heldLock?: HeldWorkspaceLock }).__heldLock;
    if (!hidden) throw new WorkspaceStateError('STATE_LOCK_CONTEXT_INVALID', 'Mutation context is not backed by an active workspace lock.');
    return hidden;
  }

  private async bestEffortProjectionIndex(revision: Awaited<ReturnType<typeof buildRevision>>, result: PublicationResult): Promise<void> {
    try {
      const divergence = (await classifyLegacyDivergence(this.paths, revision))
        .filter((item) => item.path !== 'state/legacy-projection.json');
      if (divergence.length) {
        result.warnings.push(`Current revision was published, but ${divergence.length} legacy projection(s) already diverge; the projection index was not advanced.`);
        return;
      }
      await writeProjectionIndex(this.paths, revision, this.now().toISOString());
      result.projectionIndexUpdated = true;
    } catch (error) {
      result.warnings.push(`Current revision was published, but the legacy projection index was not updated: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async bestEffortRepair(revision: Awaited<ReturnType<typeof buildRevision>>, result: PublicationResult): Promise<void> {
    try {
      await repairLegacyProjections(this.paths, revision, this.now().toISOString());
      result.projectionIndexUpdated = true;
    } catch (error) {
      result.warnings.push(`Current revision was published, but legacy projections were not repaired: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async bestEffortQuarantine(revisionId: string, result: PublicationResult): Promise<void> {
    const source = revisionDirectory(this.paths, revisionId);
    const destinationRoot = path.join(this.paths.quarantine, 'revisions');
    try {
      await ensurePrivateDirectory(destinationRoot);
      const destination = path.join(destinationRoot, `${this.now().toISOString().replace(/[:.]/g, '-')}-${revisionId}-${randomUUID()}`);
      await rename(source, destination);
      await syncDirectory(this.paths.revisions);
      await syncDirectory(destinationRoot);
    } catch (error) {
      result.warnings.push(`Recovery published successfully, but the corrupt revision was not quarantined: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private assertFenceAdvances(lock: HeldWorkspaceLock, current: WorkspacePointer): void {
    if (lock.owner.fencingToken <= current.sequence) {
      throw new WorkspaceStateError(
        'STATE_FENCE_REGRESSION',
        `Writer fence ${lock.owner.fencingToken} does not advance current revision sequence ${current.sequence}.`
      );
    }
  }

  private async findAncestorRevision(
    current: Awaited<ReturnType<typeof validateRevision>>,
    targetRevisionId: string
  ): Promise<Awaited<ReturnType<typeof validateRevision>>> {
    if (targetRevisionId === current.manifest.revisionId) throw new WorkspaceStateError('STATE_ROLLBACK_TARGET_CURRENT', 'Rollback target must precede the current revision.');
    let child = current;
    const visited = new Set<string>([child.manifest.revisionId]);
    for (let depth = 0; depth < 10_000; depth += 1) {
      const parentId = child.manifest.parentRevisionId;
      if (!parentId) break;
      if (visited.has(parentId)) throw new WorkspaceStateError('STATE_REVISION_HISTORY_CYCLE', 'Workspace revision history contains a cycle.');
      visited.add(parentId);
      const parent = await validateRevision(this.paths, parentId);
      if (parent.manifest.workspaceId !== current.manifest.workspaceId || parent.manifest.sequence >= child.manifest.sequence) {
        throw new WorkspaceStateError('STATE_REVISION_HISTORY_INVALID', 'Workspace revision history is non-monotonic or crosses workspaces.');
      }
      if (parentId === targetRevisionId) return parent;
      child = parent;
    }
    throw new WorkspaceStateError('STATE_ROLLBACK_TARGET_NOT_ANCESTOR', `Rollback target is not a verified ancestor of current state: ${targetRevisionId}`);
  }
}
