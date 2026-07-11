import { randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { access, copyFile, cp, lstat, mkdir, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApprovedStatus } from '../services/status-use-case.js';
import { executeRouteUseCase } from '../services/route-use-case.js';
import { approvedArtifactPath, openApprovedRoutingState, openApprovedWorkspaceRead, type ApprovedWorkspaceRead } from '../services/workspace-read-model.js';
import { createAndRecordFeedback, createRouteEvent, readRouteEvent, readRouteEvents, readRouteFeedbackBacklog, recordRouteEvent } from '../core/route-events.js';
import { claimJobExecution, createJob, findIdempotentJob, listAllJobs, readJob, readJobCancellation, requestJobCancellation, transitionJob, JobCancellationConflictError, type JobCancellationRecord, type JobExecutionClaim } from '../core/jobs.js';
import { canonicalJson } from '../core/canonical-payload.js';
import { redactedMetadataDescription, redactedMetadataLabel } from '../core/redacted-metadata.js';
import { DEFAULT_PROFILE, ensureWorkspaceIdentity, readSkillMapConfig, readWorkspaceIdentity, writeSkillMapConfig } from '../core/config.js';
import { hashText, readJson, writeJson } from '../core/fs.js';
import { readActivePolicy } from '../core/policy.js';
import {
  buildPolicyReviewQueue,
  retireUnmatchedPolicyEntry,
  setReviewedSkillPolicy,
  type PolicyReviewAction,
  type PolicyReviewQueue,
  type PolicyReviewQueueItem
} from '../core/policy-reviews.js';
import { WorkspaceStateConflictError, WorkspaceStateError, WorkspaceStateStore, type WorkspaceRevisionManifest } from '../core/workspace-state/index.js';
import { collectLegacySnapshot, revisionArtifacts, type SnapshotArtifact } from '../core/workspace-state/revision.js';
import { initCommand } from '../commands/init.js';
import { scanCommand } from '../commands/scan.js';
import { doctorCommand } from '../commands/doctor.js';
import { doctorPackCommand } from '../commands/doctor-pack.js';
import { applyPolicyCommand } from '../commands/apply-policy.js';
import { graphCommand } from '../commands/graph.js';
import { evalCommand, type EvalCommandRuntime } from '../commands/eval.js';
import { captureSourceDiffLocalSnapshot, sourcesCommand, type SourcesCommandRuntime } from '../commands/sources.js';
import { policyCommand } from '../commands/policy.js';
import {
  createDuplicateDecision,
  persistPolicyReviewDecision,
  persistPolicyRevision,
  readActivePolicyPointer,
  type PolicyReviewDecisionV1
} from '../core/policy-state.js';
import { computeEvalDatasetDigest, parseEvalSuiteDocument } from '../services/eval-use-case.js';
import { prepareEvalRunV3ExecutionContextIfPresent, type EvalRunV3ExecutionContext } from '../services/eval-release-context.js';
import { mcpCommand } from '../commands/mcp.js';
import { hookCommand } from '../commands/hook.js';
import type { EffectiveRegistry, EffectiveSkill, Inventory, JobParameters, JobRequestV1, JobV1, Policy, PolicyV2, RevisionRef, RouteFeedbackV1, SkillTier } from '../schemas/types.js';
import { ApprovedRootFreshnessMonitor } from './filesystem-freshness.js';
import type { ConnectorRevisionContext, LocalConnectorBackend } from './local-connector.js';
import { SKILLMAP_PRODUCT_VERSION } from './compatibility.js';
import { validateGithubRef, validateGithubRepository, validateGithubSubtree } from '../network/github-source-fetcher.js';

interface RootValidation {
  id: string;
  candidate: string;
  realPath: string;
  name: string;
  createdAt: number;
}

interface PolicyReviewMaterial {
  inventory: Inventory;
  policy: Policy;
  policyDigest: string;
  pointer?: Awaited<ReturnType<typeof readActivePolicyPointer>>;
}

interface PolicyReviewMaterialV2 extends PolicyReviewMaterial {
  policy: PolicyV2;
  pointer: NonNullable<Awaited<ReturnType<typeof readActivePolicyPointer>>>;
}

type WorkspaceSelectionMode = 'select-existing' | 'create-new';
const MAX_ACTIVE_ROOT_VALIDATIONS = 32;
const MAX_ACTIVE_WORKSPACE_VALIDATIONS = 32;
const MAX_ACTIVE_POLICY_PROPOSALS = 64;
const POLICY_PROPOSAL_TTL_MS = 10 * 60 * 1000;
const SKILL_DETAIL_ROUTE_SCAN_LIMIT = 50;
const SKILL_DETAIL_ROUTE_LIMIT = 10;
const MAX_EVAL_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_EVAL_CASE_RESULTS = 10_000;
const MAX_RECENT_EVAL_RUNS = 12;

interface EvalReportProjectionContext {
  revision: RevisionRef;
  artifactDigest: string | null;
  effectiveRevisionDigest: string | null;
  bindingEligible: boolean;
}

interface WorkspaceValidation {
  id: string;
  mode: WorkspaceSelectionMode;
  candidatePath: string;
  targetRealPath: string;
  parentPath?: string;
  parentRealPath?: string;
  device: string;
  inode: string;
  createdAt: number;
  workspaceGeneration: number;
}

interface PolicyReviewProposal {
  proposalId: string;
  proposalDigest: string;
  reviewId: string;
  queue: PolicyReviewQueue;
  action: PolicyReviewAction;
  queueFingerprint: string;
  expectedRevision: string;
  activePolicyDigest: string;
  rawKey: string;
  skillId?: string;
  contentRevision?: string;
  tier?: SkillTier;
  actor: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  workspaceGeneration: number;
}

interface JobLifecycleHooks {
  beforeStagedExecution?(input: { jobId: string; type: JobParameters['type']; signal?: AbortSignal }): Promise<void>;
  beforePublication?(input: { jobId: string; type: JobParameters['type']; signal?: AbortSignal }): Promise<void>;
  afterPublication?(input: { jobId: string; revisionId: string }): Promise<void>;
}

interface SkillMapLocalBackendOptions {
  filesystemFreshness?: ApprovedRootFreshnessMonitor;
  filesystemFreshnessFactory?: (cwd: string) => ApprovedRootFreshnessMonitor;
  /** Deterministic integration-test failpoints; production callers omit this. */
  jobLifecycleHooks?: JobLifecycleHooks;
  /** Deterministic source transport controls; production callers omit this. */
  sourceFetcherOptions?: SourcesCommandRuntime['fetcherOptions'];
  /** Deterministic source command seam; production callers use sourcesCommand. */
  sourceCommandRunner?: typeof sourcesCommand;
  /** Deterministic eval command seam; production callers use evalCommand. */
  evalCommandRunner?: typeof evalCommand;
}

export class SkillMapLocalBackend implements LocalConnectorBackend {
  private readonly rootValidations = new Map<string, RootValidation>();
  private readonly workspaceValidations = new Map<string, WorkspaceValidation>();
  private readonly policyProposals = new Map<string, PolicyReviewProposal>();
  private filesystemFreshness: ApprovedRootFreshnessMonitor;
  private readonly filesystemFreshnessFactory: (cwd: string) => ApprovedRootFreshnessMonitor;
  private readonly jobLifecycleHooks?: JobLifecycleHooks;
  private readonly sourceFetcherOptions?: SourcesCommandRuntime['fetcherOptions'];
  private readonly sourceCommandRunner: typeof sourcesCommand;
  private readonly evalCommandRunner: typeof evalCommand;
  private readonly activeJobs = new Map<string, Promise<void>>();
  private readonly activeJobControllers = new Map<string, AbortController>();
  private jobTail: Promise<void> = Promise.resolve();
  private acceptingJobs = true;
  private started = false;
  private closed = false;
  private workspaceSwitching = false;
  private workspaceGeneration = 0;
  private cwd: string;

  constructor(cwd: string, options: SkillMapLocalBackendOptions = {}) {
    this.cwd = path.resolve(cwd);
    this.filesystemFreshnessFactory = options.filesystemFreshnessFactory ?? ((target) => new ApprovedRootFreshnessMonitor(target));
    this.filesystemFreshness = options.filesystemFreshness ?? this.filesystemFreshnessFactory(this.cwd);
    this.jobLifecycleHooks = options.jobLifecycleHooks;
    this.sourceFetcherOptions = options.sourceFetcherOptions;
    this.sourceCommandRunner = options.sourceCommandRunner ?? sourcesCommand;
    this.evalCommandRunner = options.evalCommandRunner ?? evalCommand;
  }

  async start(): Promise<void> {
    if (this.closed) throw new WorkspaceStateError('CONNECTOR_CLOSED', 'The local backend is closed.');
    await this.filesystemFreshness.start();
    this.started = true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.acceptingJobs = false;
    for (const controller of this.activeJobControllers.values()) controller.abort();
    const active = [...this.activeJobs.values()];
    if (active.length) await Promise.race([
      Promise.allSettled(active),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000))
    ]);
    await this.filesystemFreshness.close();
    this.started = false;
  }

  async revisionContext(): Promise<ConnectorRevisionContext> {
    try {
      const statusRead = await openApprovedWorkspaceRead(this.cwd, 'status');
      let routingRead: Awaited<ReturnType<typeof openApprovedWorkspaceRead>> | undefined;
      try { routingRead = await openApprovedWorkspaceRead(this.cwd, 'routing'); } catch { /* An unapproved current state has no routing-serving revision. */ }
      return {
        servingRevision: routingRead?.servingRevision ?? null,
        currentRevision: statusRead.currentRevision,
        compatibility: routingRead?.state.source === 'current' ? 'compatible' : 'degraded',
        etag: `"g${this.workspaceGeneration}:${statusRead.currentRevision.workspaceRevision}:${routingRead?.servingRevision.revisionId ?? 'routing-unavailable'}:${this.filesystemFreshness.etagToken()}"`
      };
    } catch (error) {
      if (error instanceof WorkspaceStateError && error.code === 'STATE_NOT_MIGRATED') {
        return { servingRevision: null, currentRevision: null, compatibility: 'degraded', etag: `"g${this.workspaceGeneration}:uninitialized:${this.filesystemFreshness.etagToken()}"` };
      }
      const code = safeStateCode(error);
      return {
        servingRevision: null,
        currentRevision: null,
        compatibility: 'incompatible',
        etag: `"g${this.workspaceGeneration}:diagnostic:${code.toLowerCase()}:${this.filesystemFreshness.etagToken()}"`
      };
    }
  }

  async health(): Promise<unknown> {
    const context = await this.revisionContext();
    return {
      status: context.compatibility === 'incompatible'
        ? 'state-unavailable'
        : !context.currentRevision
          ? 'needs-bootstrap'
          : !context.servingRevision || context.compatibility === 'degraded' ? 'attention-required' : 'ok',
      process: 'skillmap-dashboard',
      version: SKILLMAP_PRODUCT_VERSION,
      compatibility: context.compatibility
    };
  }

  async bootstrap(): Promise<unknown> {
    const store = WorkspaceStateStore.open(this.cwd);
    try {
      if (!await store.isMigrated()) {
        const legacyConfig = await readSkillMapConfig(this.cwd);
        if (!legacyConfig) return { state: 'uninitialized', initialized: false, routingReady: false, productReady: false, nextAction: 'approve-roots' };
        const hasIdentity = await fileExists(path.join(this.cwd, '.skillmap', 'identity.json'));
        const hasInventory = await fileExists(path.join(this.cwd, '.skillmap', 'inventory.json'));
        if (!hasIdentity && !hasInventory) {
          return {
            state: 'partial-legacy',
            initialized: false,
            routingReady: false,
            productReady: false,
            configuredRootCount: legacyConfig.roots.length,
            nextAction: legacyConfig.roots.length > 0 ? 'adopt-configured-roots' : 'approve-roots'
          };
        }
        return { state: 'needs-state-migration', initialized: true, routingReady: false, productReady: false, nextAction: 'state-migrate' };
      }
      const { status, approved, routing, routingReady } = await buildApprovedStatus(this.cwd);
      const recoverable = approved.state.source === 'last-known-good' && approved.state.currentFailure?.artifactRole === 'derived';
      return {
        state: recoverable ? 'recovery-required' : routingReady ? 'ready' : 'attention-required',
        initialized: true,
        servingMode: routing?.state.source ?? 'unavailable',
        revision: routing?.servingRevision ?? null,
        currentRevision: approved.currentRevision,
        routingReady,
        productReady: routingReady && status.verdict === 'ok' && status.readinessPhase === 'ready',
        readiness: { verdict: status.verdict, phase: status.readinessPhase },
        recoverable,
        ...(recoverable ? { errorCode: approved.state.currentFailure?.code } : {}),
        nextAction: recoverable
          ? 'state-recover'
          : !approved.effective
            ? 'continue-onboarding'
            : routingReady
              ? 'route'
              : status.readinessPhase === 'needs-routing-approval' ? 'approve-routing' : 'continue-onboarding'
      };
    } catch (error) {
      return manualRepairBootstrap(error);
    }
  }

  async validateWorkspace(input: { candidate: string; mode: WorkspaceSelectionMode }): Promise<unknown> {
    if (this.closed) throw new WorkspaceStateError('CONNECTOR_CLOSED', 'The local backend is closed.');
    if (this.workspaceSwitching) throw new WorkspaceStateConflictError('A foreground workspace switch is already in progress.');
    this.pruneWorkspaceValidations();
    if (this.workspaceValidations.size >= MAX_ACTIVE_WORKSPACE_VALIDATIONS) {
      throw new WorkspaceStateError('WORKSPACE_VALIDATION_LIMIT', 'Too many workspace validations are active. Confirm or wait for an existing validation to expire before retrying.');
    }
    const candidatePath = resolveOperatorPath(this.cwd, input.candidate);
    let validation: WorkspaceValidation;
    if (input.mode === 'select-existing') {
      const stats = await workspaceLstat(candidatePath, 'WORKSPACE_CANDIDATE_INVALID', 'The selected workspace must be an existing non-symlink directory.');
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new WorkspaceStateError('WORKSPACE_CANDIDATE_INVALID', 'The selected workspace must be an existing non-symlink directory.');
      const identity = workspaceFilesystemIdentity(stats, 'WORKSPACE_CANDIDATE_INVALID', 'The selected workspace filesystem identity is not safely representable.');
      validation = {
        id: randomUUID(), mode: input.mode, candidatePath, targetRealPath: await workspaceRealpath(candidatePath, 'WORKSPACE_CANDIDATE_INVALID', 'The selected workspace could not be resolved safely.'),
        device: identity.device, inode: identity.inode, createdAt: Date.now(), workspaceGeneration: this.workspaceGeneration
      };
    } else if (input.mode === 'create-new') {
      await assertWorkspacePathAbsent(candidatePath, 'WORKSPACE_CANDIDATE_EXISTS', 'New workspace creation requires a path that does not already exist.');
      const parentPath = path.dirname(candidatePath);
      const parentStats = await workspaceLstat(parentPath, 'WORKSPACE_PARENT_INVALID', 'The new workspace parent must be an existing non-symlink directory.');
      if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) throw new WorkspaceStateError('WORKSPACE_PARENT_INVALID', 'The new workspace parent must be an existing non-symlink directory.');
      const identity = workspaceFilesystemIdentity(parentStats, 'WORKSPACE_PARENT_INVALID', 'The new workspace parent filesystem identity is not safely representable.');
      const parentRealPath = await workspaceRealpath(parentPath, 'WORKSPACE_PARENT_INVALID', 'The new workspace parent could not be resolved safely.');
      validation = {
        id: randomUUID(), mode: input.mode, candidatePath,
        targetRealPath: path.join(parentRealPath, path.basename(candidatePath)),
        parentPath, parentRealPath, device: identity.device, inode: identity.inode,
        createdAt: Date.now(), workspaceGeneration: this.workspaceGeneration
      };
    } else {
      throw new WorkspaceStateError('WORKSPACE_MODE_INVALID', 'Workspace mode must be select-existing or create-new.');
    }
    this.workspaceValidations.set(validation.id, validation);
    return {
      state: 'validated',
      validationId: validation.id,
      mode: validation.mode,
      label: redactedMetadataLabel(path.basename(candidatePath), validation.mode === 'create-new' ? 'New workspace' : 'Existing workspace'),
      expiresInSeconds: 300,
      confirmationRequired: true
    };
  }

  async selectWorkspace(input: { validationId: string; confirm: true }): Promise<unknown> {
    if (input.confirm !== true) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Workspace selection requires explicit confirmation.');
    if (this.closed) throw new WorkspaceStateError('CONNECTOR_CLOSED', 'The local backend is closed.');
    if (this.workspaceSwitching) throw new WorkspaceStateConflictError('A foreground workspace switch is already in progress.');
    this.pruneWorkspaceValidations();
    const validation = this.workspaceValidations.get(input.validationId);
    if (!validation || validation.workspaceGeneration !== this.workspaceGeneration) {
      throw new WorkspaceStateError('WORKSPACE_VALIDATION_INVALID', 'Workspace validation is missing, expired, or belongs to a prior foreground workspace.');
    }
    this.workspaceSwitching = true;
    const previousAcceptingJobs = this.acceptingJobs;
    this.acceptingJobs = false;
    try {
      await this.assertNoNonterminalJobs(this.cwd, 'current');
      let target: string;
      try {
        target = await this.revalidateWorkspace(validation);
      } catch (error) {
        if (workspaceErrorCode(error) === 'WORKSPACE_VALIDATION_INVALID' || workspaceErrorCode(error) === 'WORKSPACE_VALIDATION_CHANGED') {
          this.workspaceValidations.delete(input.validationId);
        }
        throw error;
      }
      if (validation.mode === 'select-existing') await this.assertNoNonterminalJobs(target, 'selected');
      this.workspaceValidations.delete(input.validationId);
      if (target === this.cwd) {
        this.clearWorkspaceValidationTokens();
        return {
          state: 'selected', selectionId: validation.id, mode: validation.mode, created: false,
          alreadySelected: true, label: redactedMetadataLabel(path.basename(target), 'Current workspace'),
          workspaceId: await workspaceIdOrNull(target), bootstrapState: (await asBackendRecord(this.bootstrap())).state ?? 'unknown'
        };
      }

      const nextFreshness = this.filesystemFreshnessFactory(target);
      try {
        if (this.started) await nextFreshness.start();
      } catch (error) {
        await nextFreshness.close().catch(() => undefined);
        throw new WorkspaceStateError('WORKSPACE_FRESHNESS_START_FAILED', 'The selected workspace could not start safe filesystem observation.', { cause: error });
      }
      try {
        await this.filesystemFreshness.close();
      } catch (error) {
        await nextFreshness.close().catch(() => undefined);
        throw new WorkspaceStateError('WORKSPACE_FRESHNESS_STOP_FAILED', 'The previous workspace could not stop filesystem observation safely.', { cause: error });
      }
      this.cwd = target;
      this.filesystemFreshness = nextFreshness;
      this.workspaceGeneration += 1;
      this.clearWorkspaceValidationTokens();
      this.jobTail = Promise.resolve();
      const bootstrap = await asBackendRecord(this.bootstrap());
      return {
        state: 'selected',
        selectionId: validation.id,
        mode: validation.mode,
        created: validation.mode === 'create-new',
        alreadySelected: false,
        label: redactedMetadataLabel(path.basename(target), validation.mode === 'create-new' ? 'New workspace' : 'Existing workspace'),
        workspaceId: await workspaceIdOrNull(target),
        bootstrapState: typeof bootstrap.state === 'string' ? bootstrap.state : 'unknown'
      };
    } finally {
      this.workspaceSwitching = false;
      if (!this.closed) this.acceptingJobs = previousAcceptingJobs;
    }
  }

  async workspace(): Promise<unknown> {
    const { status, approved, routing, routingReady } = await buildApprovedStatus(this.cwd);
    const serving = routing ?? approved;
    const freshness = this.filesystemFreshness.snapshot();
    const inventory = await readOptionalJson<{ workspaceId: string; rootRecords: Array<{ rootId: string; configuredPath: string; realPath: string; approvedAt: string }> }>(approvedArtifactPath(serving, 'inventory.json'));
    const identity = await readOptionalJson<{ workspaceId: string; roots: Array<{ rootId: string; configuredPath: string; realPath: string; approvedAt: string }> }>(approvedArtifactPath(serving, 'identity.json'));
    const roots = inventory?.rootRecords ?? identity?.roots ?? [];
    return {
      workspaceId: inventory?.workspaceId ?? identity?.workspaceId ?? approved.currentRevision.workspaceId,
      name: redactedMetadataLabel(path.basename(this.cwd), 'Local workspace'),
      readiness: { verdict: status.verdict, phase: status.readinessPhase, warnings: status.warnings.map((item) => redactLocalText(this.cwd, item)).slice(0, 20), nextActions: status.nextActions.map((item) => redactLocalText(this.cwd, item)) },
      revision: routing?.servingRevision ?? null,
      currentRevision: approved.currentRevision,
      servingMode: routing?.state.source ?? 'unavailable',
      routingReady,
      filesystemDirty: freshness.filesystemDirty || approved.state.legacyDivergence.some((item) => item.role === 'raw-truth' || item.role === 'canonical-intent'),
      filesystemFreshness: freshness,
      roots: roots.map((root) => ({ rootId: root.rootId, label: redactedMetadataLabel(path.basename(root.configuredPath), root.rootId), approvedAt: root.approvedAt }))
    };
  }

  async dashboard(): Promise<unknown> {
    const { status, approved, routing, routingReady } = await buildApprovedStatus(this.cwd);
    const effective = routing?.effective;
    const freshness = this.filesystemFreshness.snapshot();
    return {
      workspace: { workspaceId: approved.servingRevision.workspaceId, name: redactedMetadataLabel(path.basename(this.cwd), 'Local workspace') },
      revision: routing?.servingRevision ?? null,
      currentRevision: approved.currentRevision,
      servingMode: routing?.state.source ?? 'unavailable',
      routingReady,
      filesystemDirty: freshness.filesystemDirty || approved.state.legacyDivergence.some((item) => item.role === 'raw-truth' || item.role === 'canonical-intent'),
      filesystemFreshness: freshness,
      readiness: { verdict: status.verdict, phase: status.readinessPhase, warnings: status.warnings.map((item) => redactLocalText(this.cwd, item)).slice(0, 12), nextActions: status.nextActions.map((item) => redactLocalText(this.cwd, item)) },
      counts: {
        skills: effective?.skills.length ?? 0,
        routeEligible: effective?.skills.filter((skill) => skill.routeEligible).length ?? 0,
        sourceTracked: status.sources?.trackedSkills ?? 0,
        evalCases: status.eval?.count ?? 0
      },
      evidence: {
        inventorySkills: status.inventory?.skills ?? 0,
        observedRoutes: (await readRouteEvents(this.cwd, { limit: 1 })).total,
        evalConfidence: status.eval?.confidence.level ?? 'none',
        releaseEvidenceEligible: status.eval?.releaseEvidenceEligible ?? false,
        tokenMetricsSource: 'not-measured',
        doctorPresent: status.artifacts.doctor?.present === true,
        doctorPackPresent: status.artifacts.doctorPack?.present === true || status.artifacts.doctorPackFull?.present === true,
        curationPresent: status.curation?.present === true,
        curationStale: status.curation?.stale === true
      }
    };
  }

  async listSkills(input: { query?: string; cursor?: string; limit: number }): Promise<unknown> {
    const read = await openApprovedWorkspaceRead(this.cwd, 'routing');
    const effective = read.effective;
    if (!effective) throw stateUnavailable('APPROVED_EFFECTIVE_MISSING');
    const query = input.query?.trim().toLowerCase() ?? '';
    const values = effective.skills
      .filter((skill) => !query || [skill.name, skill.skillId, skill.description].join(' ').toLowerCase().includes(query))
      .sort((left, right) => left.name.localeCompare(right.name) || left.skillId.localeCompare(right.skillId))
      .map((skill) => ({
        skillId: skill.skillId,
        displayName: redactedMetadataLabel(skill.name, skill.skillId),
        contentRevision: skill.contentRevision,
        tier: skill.tier,
        routeEligible: skill.routeEligible,
        qualifiedExplicitAllowed: skill.qualifiedExplicitAllowed,
        variantState: skill.variantState,
        hasScripts: skill.hasScripts,
        sourceScope: skill.scope,
        description: redactedMetadataDescription(skill.description, 500)
      }));
    return page(values, input, read.servingRevision, 'skills');
  }

  async showSkill(skillId: string): Promise<unknown> {
    const read = await openApprovedWorkspaceRead(this.cwd, 'routing');
    const skill = read.effective?.skills.find((item) => item.skillId === skillId);
    if (!skill) throw new Error('Skill was not found in the approved revision.');
    const [sourceContext, routeHistory] = await Promise.all([
      readSkillSourceContext(read, skill),
      readSkillRouteHistory(this.cwd, skill.skillId)
    ]);
    return {
      skillId: skill.skillId,
      displayName: redactedMetadataLabel(skill.name, skill.skillId),
      contentRevision: skill.contentRevision,
      description: redactedMetadataDescription(skill.description, 2_000),
      tier: skill.tier,
      ...(skill.family ? { family: redactedMetadataLabel(skill.family, 'Unclassified') } : {}),
      routeEligible: skill.routeEligible,
      qualifiedExplicitAllowed: skill.qualifiedExplicitAllowed,
      variantState: skill.variantState,
      hasScripts: skill.hasScripts,
      scriptCount: skill.scriptPaths.length,
      referenceCount: skill.referenceCount,
      assetCount: skill.assetCount,
      frontmatterValid: skill.frontmatterValid,
      sourceContext,
      policyContext: readSkillPolicyContext(read.effective!.policy, skill),
      routeHistory,
      revision: read.servingRevision
    };
  }

  async previewRoute(input: { prompt: string; max?: number; skillId?: string }) {
    const state = await openApprovedRoutingState(this.cwd);
    const execution = executeRouteUseCase(state, { prompt: input.prompt, ...(input.max !== undefined ? { max: input.max } : {}), ...(input.skillId ? { qualifiedSkillId: input.skillId } : {}) });
    await recordRouteEvent(this.cwd, createRouteEvent(execution.result, execution.currentRevision, 'api'));
    return execution;
  }

  async recordFeedback(routeId: string, input: {
    outcome: RouteFeedbackV1['outcome'];
    selectedSkillIds?: string[];
    expectedSkillIds?: string[];
    unsafeSkillIds?: string[];
    reasonCode: string;
    idempotencyKey: string;
  }): Promise<unknown> {
    return createAndRecordFeedback(this.cwd, { routeId, outcome: input.outcome, selectedSkillIds: input.selectedSkillIds, expectedSkillIds: input.expectedSkillIds, unsafeSkillIds: input.unsafeSkillIds, reasonCode: input.reasonCode, idempotencyKey: input.idempotencyKey });
  }

  async listRoutes(input: { cursor?: string; limit: number }): Promise<unknown> {
    const page = await readRouteEvents(this.cwd, input);
    return { ...page, feedbackBacklog: await readRouteFeedbackBacklog(this.cwd, page.events) };
  }

  async showRoute(routeId: string): Promise<unknown> {
    return readRouteEvent(this.cwd, routeId);
  }

  async policyReviews(): Promise<unknown> {
    const { approved } = await buildApprovedStatus(this.cwd);
    const material = await readPolicyReviewMaterial(approved.revisionRoot);
    const items = buildPolicyReviewQueue(material.inventory, material.policy).map(projectPolicyReviewItem);
    return {
      items,
      actionable: items.filter((item) => item.state === 'needs-review').length,
      blocking: items.filter((item) => item.blocking).length,
      policyVersion: material.policy.version,
      revision: approved.servingRevision
    };
  }

  async proposePolicy(input: {
    reviewId: string;
    action: PolicyReviewAction;
    skillId?: string;
    tier?: SkillTier;
    actor: string;
    reason: string;
    expectedRevision: string;
  }): Promise<unknown> {
    this.prunePolicyProposals();
    if (this.policyProposals.size >= MAX_ACTIVE_POLICY_PROPOSALS) {
      throw new WorkspaceStateError('POLICY_PROPOSAL_LIMIT', 'Too many policy proposals are awaiting a decision. Decide one or wait for expiry.');
    }
    const state = await WorkspaceStateStore.open(this.cwd).readCurrent({ purpose: 'status' });
    if (state.currentPointer.revisionId !== input.expectedRevision) throw new WorkspaceStateConflictError(`Expected revision ${input.expectedRevision}, found ${state.currentPointer.revisionId}.`);
    if (state.source !== 'current' || state.legacyDivergence.some((item) => item.severity === 'blocking')) {
      throw new WorkspaceStateError('STATE_REPAIR_REQUIRED', 'Policy proposals require an exact current revision with no blocking canonical divergence.');
    }
    if (!input.actor.trim() || input.actor.length > 80 || input.reason.trim().length < 12 || input.reason.length > 1000) {
      throw new WorkspaceStateError('POLICY_PROPOSAL_INVALID', 'Policy proposals require a bounded actor and substantive rationale.');
    }
    const material = await readPolicyReviewMaterial(this.cwd, true);
    const item = buildPolicyReviewQueue(material.inventory, material.policy).find((candidate) => candidate.reviewId === input.reviewId);
    if (!item || item.action !== input.action) throw new WorkspaceStateError('POLICY_REVIEW_STALE', 'The selected policy review item is no longer current. Refresh the review queue.');
    const selection = validatePolicyProposalSelection(item, input);
    const proposalId = randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + POLICY_PROPOSAL_TTL_MS).toISOString();
    const binding = {
      version: 1,
      proposalId,
      reviewId: item.reviewId,
      queue: item.queue,
      action: item.action,
      queueFingerprint: item.queueFingerprint,
      expectedRevision: input.expectedRevision,
      activePolicyDigest: material.policyDigest,
      rawKey: item.rawKey,
      ...(selection.skillId ? { skillId: selection.skillId } : {}),
      ...(selection.contentRevision ? { contentRevision: selection.contentRevision } : {}),
      ...(selection.tier ? { tier: selection.tier } : {}),
      actor: input.actor.trim(),
      reason: input.reason.trim(),
      createdAt,
      expiresAt,
      workspaceGeneration: this.workspaceGeneration
    };
    const proposal: PolicyReviewProposal = { ...binding, proposalDigest: hashText(canonicalJson(binding)) };
    this.policyProposals.set(proposalId, proposal);
    return {
      state: 'proposed', proposalId, proposalDigest: proposal.proposalDigest, reviewId: item.reviewId,
      queue: item.queue, action: item.action,
      ...(selection.skillId ? { skillId: selection.skillId } : {}),
      ...(selection.tier ? { tier: selection.tier } : {}),
      expectedRevision: input.expectedRevision, expiresAt,
      decisionOptions: ['accept', 'hold', 'reject'], wouldPublish: false
    };
  }

  async decidePolicyReview(input: {
    proposalId: string;
    proposalDigest: string;
    decision: 'accept' | 'hold' | 'reject';
    expectedRevision: string;
    confirmation: 'review';
  }): Promise<unknown> {
    if (input.confirmation !== 'review') throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Policy decisions require confirmation=review.');
    this.prunePolicyProposals();
    const proposal = this.policyProposals.get(input.proposalId);
    if (!proposal || proposal.workspaceGeneration !== this.workspaceGeneration || proposal.proposalDigest !== input.proposalDigest) {
      throw new WorkspaceStateError('POLICY_PROPOSAL_INVALID', 'The policy proposal is missing, expired, or does not match its digest. Create a fresh proposal.');
    }
    if (proposal.expectedRevision !== input.expectedRevision) throw new WorkspaceStateConflictError('The policy proposal is bound to a different revision.');
    const result = await this.publishExpectedMutation(input.expectedRevision, 'api:policy-review-decision', `Recorded a ${input.decision} policy review decision.`, async () => {
      const material = await readPolicyReviewMaterial(this.cwd, true);
      if (material.policyDigest !== proposal.activePolicyDigest) throw new WorkspaceStateError('POLICY_REVIEW_STALE', 'The active policy changed after this proposal. Create a fresh proposal.');
      const item = buildPolicyReviewQueue(material.inventory, material.policy).find((candidate) => candidate.reviewId === proposal.reviewId);
      if (!item || item.queueFingerprint !== proposal.queueFingerprint || item.action !== proposal.action) {
        throw new WorkspaceStateError('POLICY_REVIEW_STALE', 'The policy review queue changed after this proposal. Refresh and create a fresh proposal.');
      }
      let policyChanged = false;
      if (input.decision === 'accept') {
        let nextPolicy: PolicyV2;
        if (proposal.action === 'select-canonical') {
          if (!proposal.skillId) throw new WorkspaceStateError('POLICY_PROPOSAL_INVALID', 'Canonical proposal is missing a selected skill.');
          nextPolicy = createDuplicateDecision(material.policy, material.inventory, item.rawKey, proposal.skillId, proposal.actor, proposal.reason).policy;
        } else if (proposal.action === 'set-skill-policy') {
          if (!proposal.skillId || !proposal.tier) throw new WorkspaceStateError('POLICY_PROPOSAL_INVALID', 'Skill policy proposal is incomplete.');
          nextPolicy = setReviewedSkillPolicy(material.policy, material.inventory, proposal.skillId, proposal.tier);
        } else {
          nextPolicy = retireUnmatchedPolicyEntry(material.policy, material.inventory, item.rawKey);
        }
        await persistPolicyRevision(this.cwd, nextPolicy, material.pointer);
        policyChanged = true;
      }
      const decidedAt = new Date().toISOString();
      const base = {
        version: 1 as const,
        kind: 'skillmap.policy-review-decision' as const,
        reviewId: proposal.reviewId,
        queue: proposal.queue,
        action: proposal.action,
        decision: input.decision,
        expectedRevision: proposal.expectedRevision,
        activePolicyDigest: proposal.activePolicyDigest,
        queueFingerprint: proposal.queueFingerprint,
        proposalDigest: proposal.proposalDigest,
        ...(proposal.skillId ? { skillId: proposal.skillId } : {}),
        ...(proposal.contentRevision ? { contentRevision: proposal.contentRevision } : {}),
        ...(proposal.tier ? { tier: proposal.tier } : {}),
        actor: proposal.actor,
        reason: proposal.reason,
        decidedAt,
        policyChanged
      };
      const receipt: PolicyReviewDecisionV1 = { ...base, decisionDigest: hashText(canonicalJson(base)) };
      await persistPolicyReviewDecision(this.cwd, receipt);
      return receipt;
    });
    this.policyProposals.delete(input.proposalId);
    const receipt = result.value as PolicyReviewDecisionV1;
    return {
      state: 'recorded', reviewId: receipt.reviewId, queue: receipt.queue, action: receipt.action,
      decision: receipt.decision, decisionDigest: receipt.decisionDigest,
      ...(receipt.skillId ? { skillId: receipt.skillId } : {}),
      ...(receipt.tier ? { tier: receipt.tier } : {}),
      policyChanged: receipt.policyChanged,
      revision: pointerRef(result.publication.pointer), routingApprovalRequired: true
    };
  }

  async previewPolicy(input: { expectedRevision: string; confirmation: 'review' }): Promise<unknown> {
    if (input.confirmation !== 'review') throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Policy preview requires confirmation=review.');
    const store = WorkspaceStateStore.open(this.cwd);
    const current = await store.readCurrent({ purpose: 'status' });
    if (current.currentPointer.revisionId !== input.expectedRevision) {
      throw new WorkspaceStateConflictError(`Expected revision ${input.expectedRevision}, found ${current.currentPointer.revisionId}.`);
    }
    if (current.source !== 'current') throw new WorkspaceStateError('STATE_REPAIR_REQUIRED', 'Policy preview requires a valid current revision.');
    if (current.legacyDivergence.some((item) => item.severity === 'blocking')) {
      throw new WorkspaceStateError('STATE_LEGACY_CANONICAL_DIVERGENCE', 'Canonical projections diverge from the exact preview revision.');
    }
    const stage = await this.createIsolatedStage(`policy-preview-${randomUUID()}`, current, { outsideWorkspace: true });
    try {
      const currentEffective = await readOptionalJson<unknown>(path.join(stage, '.skillmap', 'effective.json'));
      const currentSummary = currentEffective === undefined
        ? { skills: 0, routeEligible: 0, edges: 0 }
        : effectiveRegistrySummary(currentEffective, 'POLICY_PREVIEW_CURRENT_INVALID');
      let strictEligible = true;
      let output: unknown;
      try {
        output = await applyPolicyCommand(stage, { strict: true, 'dry-run': true });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('Strict policy validation failed:')) throw error;
        strictEligible = false;
        output = await applyPolicyCommand(stage, { 'dry-run': true });
      }
      const outputRecord = objectRecord(output);
      const projectedSummary = numericSummary(outputRecord.effectiveSummary, 'POLICY_PREVIEW_RESULT_INVALID');
      const warnings = policyPreviewWarningCodes(outputRecord);
      const after = await store.readCurrent({ purpose: 'status' });
      if (after.currentPointer.revisionId !== input.expectedRevision
        || after.source !== 'current'
        || after.legacyDivergence.some((item) => item.severity === 'blocking')) {
        throw new WorkspaceStateConflictError(`Expected revision ${input.expectedRevision}, found ${after.currentPointer.revisionId}.`);
      }
      return {
        state: 'previewed',
        revision: pointerRef(current.currentPointer),
        currentPresent: currentEffective !== undefined,
        currentSummary,
        projectedSummary,
        delta: {
          skills: projectedSummary.skills - currentSummary.skills,
          routeEligible: projectedSummary.routeEligible - currentSummary.routeEligible,
          edges: projectedSummary.edges - currentSummary.edges
        },
        warnings,
        routingApprovalEligible: strictEligible && warnings.length === 0 && routingApprovalCandidate(output),
        wouldPublish: false
      };
    } finally {
      await rm(path.dirname(stage), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async decidePolicy(input: { displayName: string; skillId: string; actor: string; reason: string; expectedRevision: string }): Promise<unknown> {
    const result = await this.publishExpectedMutation(input.expectedRevision, 'api:policy-decision', 'Recorded a reviewed canonical policy decision.', async () =>
      policyCommand(this.cwd, ['select-canonical', input.displayName], {
        'skill-id': input.skillId,
        actor: input.actor,
        reason: input.reason,
        confirm: true
      }));
    return {
      state: 'recorded',
      skillId: input.skillId,
      decisionDigest: persistedPolicyDecisionDigest(result.value),
      revision: pointerRef(result.publication.pointer),
      routingApprovalRequired: true
    };
  }

  async applyReviewedPolicy(input: { expectedRevision: string; confirmation: 'review' }): Promise<unknown> {
    if (input.confirmation !== 'review') throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Reviewed policy application requires confirmation=review.');
    const store = WorkspaceStateStore.open(this.cwd);
    const current = await store.readCurrent({ purpose: 'status' });
    if (current.currentPointer.revisionId !== input.expectedRevision) throw new WorkspaceStateConflictError(`Expected revision ${input.expectedRevision}, found ${current.currentPointer.revisionId}.`);
    if (current.source !== 'current') throw new WorkspaceStateError('STATE_REPAIR_REQUIRED', 'Reviewed policy application requires a valid current revision.');
    if (current.legacyDivergence.some((item) => item.severity === 'blocking')) throw new WorkspaceStateError('STATE_LEGACY_CANONICAL_DIVERGENCE', 'Canonical projections diverge from the exact requested revision.');
    const stage = await this.createIsolatedStage(`policy-${randomUUID()}`, current);
    try {
      const output = await applyPolicyCommand(stage, { strict: true });
      await normalizeStagedPolicyBinding(stage, this.cwd);
      const snapshot = await collectLegacySnapshot(WorkspaceStateStore.open(stage).paths);
      assertNoStagingPath(snapshot.artifacts, stage);
      assertChangedArtifacts(
        current.revision.manifest.artifacts,
        snapshot.artifacts,
        new Set(['effective.json', 'graph.effective.json', 'graph.effective.mmd']),
        ['effective.json', 'graph.effective.json', 'graph.effective.mmd'],
        'reviewed policy application'
      );
      if (!routingApprovalCandidate(output)) throw new WorkspaceStateError('POLICY_REVIEW_INCOMPLETE', 'Reviewed policy output is not eligible for routing approval.');
      const publication = await store.publishPreparedSnapshot({
        expectedRevisionId: input.expectedRevision,
        workspaceId: snapshot.workspaceId,
        artifacts: snapshot.artifacts,
        approveForRouting: true,
        actor: 'local-api-reviewed-policy',
        reason: 'Applied the exact reviewed policy and advanced routing approval.'
      });
      const record = output as { warnings?: unknown[]; effectiveSummary?: unknown };
      this.filesystemFreshness.requestVerification();
      return {
        applied: true,
        warnings: Array.isArray(record.warnings) ? record.warnings.map((item) => String(item).slice(0, 240)).slice(0, 20) : [],
        effectiveSummary: record.effectiveSummary,
        revision: pointerRef(publication.pointer),
        routingApproved: publication.lastKnownGoodUpdated
      };
    } finally {
      await rm(path.dirname(stage), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async sources(): Promise<unknown> {
    const read = await openApprovedWorkspaceRead(this.cwd, 'status');
    const report = await readOptionalJson<{ coverage?: string; inventorySkills?: number; trackedSkills?: number; records?: Array<Record<string, unknown>> }>(approvedArtifactPath(read, 'source-status.json'));
    const registry = await readOptionalJson<{ records?: Array<Record<string, unknown>> }>(approvedArtifactPath(read, 'sources.json'));
    const inventory = await readOptionalJson<{ skills?: Array<{ skillId?: unknown; name?: unknown; contentRevision?: unknown }> }>(approvedArtifactPath(read, 'inventory.json'));
    const tracked = new Set<string>();
    for (const record of [...(registry?.records ?? []), ...(report?.records ?? [])]) {
      if (typeof record.skillId === 'string') tracked.add(record.skillId);
    }
    const approvedSkills = read.effective?.skills ?? (inventory?.skills ?? []).flatMap((skill) =>
      typeof skill.skillId === 'string' && /^sk_[A-Za-z0-9_-]{43}$/.test(skill.skillId)
        && typeof skill.name === 'string' && typeof skill.contentRevision === 'string' && /^sha256:[a-f0-9]{64}$/.test(skill.contentRevision)
        ? [{ skillId: skill.skillId, name: skill.name, contentRevision: skill.contentRevision }]
        : []);
    const untracked = approvedSkills
      .filter((skill) => !tracked.has(skill.skillId))
      .map((skill) => ({ skillId: skill.skillId, displayName: redactedMetadataLabel(skill.name, skill.skillId), contentRevision: skill.contentRevision }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.skillId.localeCompare(right.skillId));
    const untrackedItems = untracked.slice(0, 100);
    const reportTracked = typeof report?.trackedSkills === 'number' && Number.isSafeInteger(report.trackedSkills) && report.trackedSkills >= 0 ? report.trackedSkills : 0;
    const trackedSkills = Math.max(reportTracked, tracked.size);
    const reportRecords = report?.records ?? [];
    const registryRecords = registry?.records ?? [];
    const items = registryRecords.map((record) => {
      const statusRecord = reportRecords.find((candidate) => sourceStatusMatchesRegistry(candidate, record));
      const source = objectRecord(record.source);
      const sourceType = source.type === 'local' || source.type === 'github' ? source.type : 'unknown';
      const state = statusRecord ? safeSourceState(statusRecord.state) : sourceType === 'local' ? 'local-authored' : 'unknown';
      return {
        skillId: stringOrNull(record.skillId),
        displayName: redactedMetadataLabel(record.skill, stringOrNull(record.skillId) ?? 'unknown'),
        contentRevision: digestOrNull(record.contentRevision),
        sourceType,
        checked: Boolean(statusRecord),
        reviewable: Boolean(statusRecord) && !['external-clean', 'local-authored'].includes(state),
        state,
        risk: statusRecord ? stringOrNull(statusRecord.risk) : null,
        upstreamCommit: commitOrNull(statusRecord?.upstreamCommit ?? source.resolvedCommit)
      };
    });
    return {
      coverage: tracked.size > reportTracked ? 'partial' : report?.coverage ?? 'not-configured',
      inventorySkills: report?.inventorySkills ?? approvedSkills.length,
      trackedSkills,
      items,
      untrackedItems,
      untrackedTotal: untracked.length,
      untrackedTruncated: untracked.length > untrackedItems.length,
      revision: read.servingRevision
    };
  }

  async adoptSource(input: {
    skillId: string;
    sourceType: 'local' | 'github';
    expectedRevision: string;
    confirm: true;
    reason?: string;
    repository?: string;
    sourcePath?: string;
    ref?: string;
  }): Promise<unknown> {
    if (input.confirm !== true) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Source adoption requires explicit confirmation.');
    if (!/^sk_[A-Za-z0-9_-]{43}$/.test(input.skillId)) throw new WorkspaceStateError('SOURCE_ADOPTION_INPUT_INVALID', 'Source adoption skillId is invalid.');
    let flags: Record<string, string | boolean | string[]>;
    let digestBinding: Record<string, unknown>;
    if (input.sourceType === 'local') {
      if (input.repository !== undefined || input.sourcePath !== undefined || input.ref !== undefined
        || typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason, 'utf8') > 500 || input.reason.includes('\0')) {
        throw new WorkspaceStateError('SOURCE_ADOPTION_INPUT_INVALID', 'Local source adoption requires only a bounded reason.');
      }
      flags = { 'skill-id': input.skillId, local: true, reason: input.reason };
      digestBinding = { sourceType: 'local', reasonDigest: hashText(`source-adoption-reason:${input.reason}`) };
    } else if (input.sourceType === 'github') {
      if (input.reason !== undefined || typeof input.repository !== 'string' || typeof input.sourcePath !== 'string' || typeof input.ref !== 'string') {
        throw new WorkspaceStateError('SOURCE_ADOPTION_INPUT_INVALID', 'GitHub source adoption requires repository, sourcePath, and ref only.');
      }
      const repository = validateGithubRepository(input.repository);
      const sourcePath = validateGithubSubtree(input.sourcePath);
      const ref = validateGithubRef(input.ref);
      if (!sourcePath) throw new WorkspaceStateError('SOURCE_ADOPTION_INPUT_INVALID', 'GitHub sourcePath must identify a non-root relative directory.');
      flags = { 'skill-id': input.skillId, repo: repository, path: sourcePath, ref, 'defer-resolution': true };
      digestBinding = { sourceType: 'github', repository, sourcePath, ref, resolution: 'deferred' };
    } else {
      throw new WorkspaceStateError('SOURCE_ADOPTION_INPUT_INVALID', 'Source adoption type must be local or github.');
    }
    const result = await this.publishExpectedMutation(input.expectedRevision, 'api:source-adoption', 'Recorded a confirmed source adoption without changing skill roots.', async () =>
      this.sourceCommandRunner(this.cwd, ['adopt', input.skillId], flags));
    const record = objectRecord(objectRecord(result.value).record);
    if (record.skillId !== input.skillId) throw new WorkspaceStateError('SOURCE_ADOPTION_RESULT_INVALID', 'Persisted source adoption did not bind the requested skill.');
    this.filesystemFreshness.requestVerification();
    return {
      state: 'adopted',
      skillId: input.skillId,
      sourceType: input.sourceType,
      adoptionDigest: hashText(canonicalJson({
        kind: 'skillmap.source-adoption',
        skillId: input.skillId,
        contentRevision: digestOrNull(record.contentRevision),
        installedHash: digestOrNull(record.installedHash),
        ...digestBinding
      })),
      revision: pointerRef(result.publication.pointer),
      routingApprovalRequired: true,
      nextAction: 'sources-check'
    };
  }

  async sourceDiff(input: { skillId: string; expectedRevision: string }, runtime: { signal?: AbortSignal } = {}): Promise<unknown> {
    if (!/^sk_[A-Za-z0-9_-]{43}$/.test(input.skillId)) throw new WorkspaceStateError('SOURCE_DIFF_INPUT_INVALID', 'Source diff skillId is invalid.');
    const store = WorkspaceStateStore.open(this.cwd);
    const current = await store.readCurrent({ purpose: 'status' });
    if (current.currentPointer.revisionId !== input.expectedRevision) {
      throw new WorkspaceStateConflictError(`Expected revision ${input.expectedRevision}, found ${current.currentPointer.revisionId}.`);
    }
    if (current.source !== 'current') throw new WorkspaceStateError('STATE_REPAIR_REQUIRED', 'Source diff requires a valid current revision.');
    if (current.legacyDivergence.some((item) => item.severity === 'blocking')) {
      throw new WorkspaceStateError('STATE_LEGACY_CANONICAL_DIVERGENCE', 'Canonical projections diverge from the exact source-diff revision.');
    }
    const stage = await this.createIsolatedStage(`source-diff-${randomUUID()}`, current, { outsideWorkspace: true });
    try {
      const localSnapshot = await captureSourceDiffLocalSnapshot(stage, input.skillId, runtime.signal);
      const output = await this.sourceCommandRunner(stage, ['diff', input.skillId], {}, {
        ...(runtime.signal ? { signal: runtime.signal } : {}),
        ...(this.sourceFetcherOptions ? { fetcherOptions: this.sourceFetcherOptions } : {}),
        localSnapshot
      });
      await localSnapshot.verify();
      const after = await store.readCurrent({ purpose: 'status' });
      if (after.currentPointer.revisionId !== input.expectedRevision
        || after.source !== 'current'
        || after.legacyDivergence.some((item) => item.severity === 'blocking')) {
        throw new WorkspaceStateConflictError(`Expected revision ${input.expectedRevision}, found ${after.currentPointer.revisionId}.`);
      }
      return boundedSourceDiffReceipt(output, input.skillId, pointerRef(current.currentPointer));
    } finally {
      await rm(path.dirname(stage), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async reviewSource(input: { skillId: string; decision: 'hold' | 'accepted' | 'ignore'; reason: string; expectedRevision: string }): Promise<unknown> {
    const result = await this.publishExpectedMutation(input.expectedRevision, 'api:source-review', 'Recorded a hash-bound source review decision.', async () =>
      sourcesCommand(this.cwd, ['review', input.skillId], { decision: input.decision, reason: input.reason }));
    return {
      state: 'recorded',
      skillId: input.skillId,
      decision: input.decision,
      reviewDigest: persistedSourceReviewDigest(result.value),
      revision: pointerRef(result.publication.pointer),
      routingApprovalRequired: true
    };
  }

  async evals(input: { cursor?: string; limit: number } = { limit: 20 }): Promise<unknown> {
    const [{ status, approved: read }, storedJobs] = await Promise.all([
      buildApprovedStatus(this.cwd),
      listAllJobs(this.cwd, 256)
    ]);
    const report = status.eval;
    const evalJobs = storedJobs
      .map((stored) => stored.job)
      .filter((job) => job.type === 'eval-run')
      .slice(0, MAX_RECENT_EVAL_RUNS);
    const rawReport = report?.present ? await readApprovedEvalReport(read) : undefined;
    const caseTrace = projectEvalCaseTrace(rawReport, read.effective, {
      datasetDigest: digestOrNull(report?.datasetDigest),
      effectiveRevisionDigest: read.servingRevision.effectiveRevisionDigest
    });
    const reportArtifactDigest = digestOrNull(read.state.revision.manifest.artifacts.find((artifact) => artifact.path === 'eval-report.json')?.digest);
    const reportEffectiveRevisionDigest = evalReportEffectiveRevisionDigest(rawReport);
    const metrics = projectEvalMetrics(rawReport, report);
    const reportContext: EvalReportProjectionContext = {
      revision: read.servingRevision,
      artifactDigest: reportArtifactDigest,
      effectiveRevisionDigest: reportEffectiveRevisionDigest,
      bindingEligible: Boolean(rawReport)
        && Boolean(reportArtifactDigest)
        && Boolean(reportEffectiveRevisionDigest)
        && reportEffectiveRevisionDigest === read.servingRevision.effectiveRevisionDigest
        && (caseTrace.state === 'available' || caseTrace.state === 'empty')
    };
    let casePage: ReturnType<typeof page<EvalCaseResultReceipt>>;
    try {
      casePage = page(caseTrace.items, input, read.servingRevision, 'eval-case-results-v3');
    } catch (error) {
      if (error instanceof Error && /Pagination cursor/.test(error.message)) {
        throw new WorkspaceStateError('EVAL_CURSOR_INVALID', 'The eval case cursor is invalid or belongs to another immutable report.');
      }
      throw error;
    }
    const common = {
      evidenceIssues: evalEvidenceIssueCodes(report?.evidenceIssues),
      revision: read.servingRevision,
      currentRun: projectCurrentEvalRun(evalJobs[0], report, rawReport, reportContext),
      recentRuns: evalJobs.map((job) => projectEvalJobRun(job, report, rawReport, reportContext)),
      caseResultsSchemaVersion: 3,
      caseResults: casePage.items,
      caseResultsPagination: {
        total: caseTrace.items.length,
        limit: casePage.limit,
        hasMore: casePage.hasMore,
        nextCursor: casePage.nextCursor
      },
      caseTraceState: caseTrace.state,
      promptStored: false
    };
    if (!report?.present) return { present: false, ...common };
    return {
      present: true,
      evidenceLevel: stringOrNull(report.evidenceLevel),
      releaseEvidenceEligible: report.releaseEvidenceEligible === true,
      pass: report.pass === true,
      datasetDigest: digestOrNull(report.datasetDigest),
      effectiveRevisionDigest: digestOrNull(report.effectiveRevisionDigest),
      composition: safeAggregate(report.composition),
      holdout: safeAggregate(report.holdout),
      leakage: safeAggregate(report.leakage),
      baselineComparison: safeAggregate(report.baselineComparison),
      count: metrics.count,
      top1Rate: metrics.top1Rate,
      top3Rate: metrics.top3Rate,
      avoidHits: metrics.avoidHits,
      ...common
    };
  }

  async importEvalSuite(input: { suite: unknown; expectedRevision: string }): Promise<unknown> {
    const document = parseEvalSuiteDocument(input.suite);
    if (document.schemaVersion === 3) {
      const routing = await openApprovedWorkspaceRead(this.cwd, 'routing');
      if (routing.servingRevision.revisionId !== input.expectedRevision) {
        throw new WorkspaceStateConflictError(`The v3 suite catalog is approved at ${routing.servingRevision.revisionId}, not ${input.expectedRevision}. Approve the intended routing revision before importing release-authority labels.`);
      }
      const skills = new Map((routing.effective?.skills ?? []).map((skill) => [skill.skillId, skill]));
      if (!routing.effective) throw new WorkspaceStateError('EVAL_SKILL_CATALOG_INVALID', 'The approved routing skill catalog is unavailable.');
      for (const [index, item] of document.suite.cases.entries()) {
        const label = `Eval case ${index + 1}`;
        for (const skillId of new Set([...item.expectedSkillIds, ...item.avoidSkillIds, ...(item.qualifiedSkillId ? [item.qualifiedSkillId] : [])])) {
          if (!skills.has(skillId)) throw new WorkspaceStateError('EVAL_SKILL_CATALOG_INVALID', `${label} references a qualified skill ID that is absent from the approved routing catalog.`);
        }
        for (const skillId of item.expectedSkillIds) {
          const skill = skills.get(skillId)!;
          if (skillId === item.qualifiedSkillId) {
            if (skill.qualifiedExplicitAllowed !== true) throw new WorkspaceStateError('EVAL_SKILL_CATALOG_INVALID', `${label} explicitly qualifies a skill that policy blocks from qualified routing.`);
          } else if (skill.routeEligible !== true || skill.qualifiedExplicitAllowed !== true) {
            throw new WorkspaceStateError('EVAL_SKILL_CATALOG_INVALID', `${label} expects a skill that is not approved for deterministic routing.`);
          }
        }
      }
    }
    const cases = document.schemaVersion === 3 ? document.suite.cases : document.suite.evals;
    const composition = cases.reduce((counts, item) => {
      const key = item.primaryCaseType ?? 'untyped';
      counts[key] = (counts[key] ?? 0) + 1;
      if (item.membership === 'holdout') counts.holdout = (counts.holdout ?? 0) + 1;
      return counts;
    }, Object.create(null) as Record<string, number>);
    const result = await this.publishExpectedMutation(input.expectedRevision, 'api:eval-import', 'Imported a reviewed local eval suite.', async () => {
      await writeJson(path.join(this.cwd, '.skillmap', 'real-evals.json'), document.suite);
      return {
        imported: true,
        schemaVersion: document.schemaVersion,
        cases: cases.length,
        composition,
        datasetDigest: document.schemaVersion === 3 ? document.suite.datasetDigest : computeEvalDatasetDigest(document.suite),
        promptRetention: 'local-eval-suite'
      };
    });
    const value = result.value as { imported: true; schemaVersion: number; cases: number; composition: Record<string, number>; datasetDigest: string; promptRetention: string };
    return { ...value, revision: pointerRef(result.publication.pointer), routingApprovalRequired: true };
  }

  async mcpManifest(): Promise<unknown> {
    const manifest = await mcpCommand(this.cwd, ['manifest'], {});
    const value = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest as Record<string, unknown> : {};
    return { version: value.version, readOnly: value.readOnly, tools: value.tools, limits: value.limits, verifiedLocally: true };
  }

  async verifyHook(input: { prompt: string }): Promise<unknown> {
    const result = await hookCommand(this.cwd, ['dry-run', 'codex', input.prompt], {});
    const value = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {};
    const rawReadiness = value.readiness && typeof value.readiness === 'object' && !Array.isArray(value.readiness) ? value.readiness as Record<string, unknown> : {};
    return {
      host: 'codex',
      action: 'dry-run',
      readiness: {
        verdict: stringOrNull(rawReadiness.verdict),
        phase: stringOrNull(rawReadiness.phase),
        allowed: rawReadiness.allowed === true,
        routingReady: rawReadiness.routingReady === true
      },
      hookText: typeof value.hookText === 'string' ? value.hookText : '',
      promptStored: false,
      installPerformed: false
    };
  }

  async createJob(request: JobRequestV1): Promise<unknown> {
    if (this.workspaceSwitching) throw new WorkspaceStateError('WORKSPACE_SWITCH_IN_PROGRESS', 'The foreground workspace is switching and cannot accept a job.');
    const existing = await findIdempotentJob(this.cwd, request);
    if (existing) return { job: existing.job, created: false };
    if (!this.acceptingJobs) throw new WorkspaceStateError('JOB_CONNECTOR_CLOSING', 'The connector is closing and is not accepting new jobs.');
    const current = await WorkspaceStateStore.open(this.cwd).readCurrent({ purpose: 'status' });
    if (current.currentPointer.revisionId !== request.expectedRevision) {
      throw new WorkspaceStateConflictError(`Expected revision ${request.expectedRevision}, found ${current.currentPointer.revisionId}.`);
    }
    if (current.source !== 'current') throw new WorkspaceStateError('STATE_REPAIR_REQUIRED', 'Generic jobs require a valid current revision; recover derived state first.');
    if (current.legacyDivergence.some((item) => item.severity === 'blocking')) {
      throw new WorkspaceStateError('STATE_LEGACY_CANONICAL_DIVERGENCE', 'Canonical projections diverge from the exact requested revision; repair or review them before starting a job.');
    }
    const result = await createJob(this.cwd, request);
    if (result.created) this.scheduleJob(result.stored.job.jobId);
    return { job: result.stored.job, created: result.created };
  }

  async showJob(jobId: string): Promise<unknown> {
    return (await readJob(this.cwd, jobId)).job;
  }

  async listJobs(): Promise<unknown> {
    const jobs = await listAllJobs(this.cwd);
    return { items: jobs.slice(0, 100).map((item) => item.job), total: jobs.length };
  }

  async cancelJob(jobId: string, input: { idempotencyKey: string }): Promise<unknown> {
    const store = WorkspaceStateStore.open(this.cwd);
    let cancellation: { record: JobCancellationRecord; created: boolean };
    let stateBefore: 'queued' | 'running' | 'cancelled';
    try {
      const prepared = await this.withCancellationMutationLock(store, async () => {
        const stored = await readJob(this.cwd, jobId);
        if (stored.job.state === 'succeeded' || stored.job.state === 'failed') {
          throw new WorkspaceStateError('JOB_NOT_CANCELLABLE', 'Only queued or running jobs can be cancelled.');
        }
        if (stored.job.state === 'running') {
          const published = await store.findPublishedMutation({ actor: jobActor(jobId), parentRevisionId: stored.job.expectedRevision });
          if (published) throw new WorkspaceStateError('JOB_PUBLICATION_COMMITTED', 'The job already published its workspace revision and cannot be cancelled.');
        }
        const request = await requestJobCancellation(this.cwd, jobId, input.idempotencyKey);
        return { request, state: stored.job.state as 'queued' | 'running' | 'cancelled' };
      });
      cancellation = prepared.request;
      stateBefore = prepared.state;
    } catch (error) {
      if (error instanceof JobCancellationConflictError) {
        throw new WorkspaceStateError(error.code, 'This job already has a cancellation request with a different idempotency key.');
      }
      throw error;
    }

    this.activeJobControllers.get(jobId)?.abort();
    if (stateBefore !== 'cancelled') {
      const claim = await claimJobExecution(this.cwd, jobId);
      if (claim) {
        try {
          const refreshed = await readJob(this.cwd, jobId);
          if (refreshed.job.state === 'queued' || refreshed.job.state === 'running') {
            await transitionJob(this.cwd, jobId, 'cancelled', { claim, resultReceipt: cancellationReceipt(cancellation.record, refreshed.job.state) });
          }
        } finally {
          await claim.release().catch(() => undefined);
        }
      } else {
        await this.waitForJobTerminal(jobId, 2_000);
      }
    }
    const stored = await readJob(this.cwd, jobId);
    if (stored.job.state === 'succeeded') throw new WorkspaceStateError('JOB_PUBLICATION_COMMITTED', 'The job published before cancellation could take effect.');
    if (stored.job.state === 'failed') throw new WorkspaceStateError('JOB_NOT_CANCELLABLE', 'The job failed before cancellation could take effect.');
    return {
      state: stored.job.state === 'cancelled' ? 'cancelled' : 'cancellation-requested',
      jobId,
      jobState: stored.job.state,
      cancellationDigest: cancellation.record.idempotencyDigest,
      idempotent: !cancellation.created,
      publicationPrevented: true
    };
  }

  async resumeInterruptedJobs(): Promise<void> {
    for (const stored of await listAllJobs(this.cwd)) {
      if (stored.job.state === 'queued') {
        const cancellation = await readJobCancellation(this.cwd, stored.job.jobId);
        if (!cancellation) this.scheduleJob(stored.job.jobId);
        else {
          const claim = await claimJobExecution(this.cwd, stored.job.jobId);
          if (claim) {
            try { await transitionJob(this.cwd, stored.job.jobId, 'cancelled', { claim, resultReceipt: cancellationReceipt(cancellation, 'queued') }); }
            finally { await claim.release().catch(() => undefined); }
          }
        }
      }
      else if (stored.job.state === 'running') {
        const claim = await claimJobExecution(this.cwd, stored.job.jobId);
        if (!claim) continue;
        try {
          const refreshed = await readJob(this.cwd, stored.job.jobId);
          if (refreshed.job.state !== 'running') continue;
          const published = await WorkspaceStateStore.open(this.cwd).findPublishedMutation({
            actor: jobActor(refreshed.job.jobId),
            parentRevisionId: refreshed.job.expectedRevision
          }).catch(() => undefined);
          if (published) {
            await transitionJob(this.cwd, refreshed.job.jobId, 'succeeded', {
              claim,
              resultReceipt: successfulJobResultReceipt(refreshed.job.type, published, true)
            });
          } else {
            const cancellation = await readJobCancellation(this.cwd, refreshed.job.jobId);
            if (cancellation) {
              await transitionJob(this.cwd, refreshed.job.jobId, 'cancelled', { claim, resultReceipt: cancellationReceipt(cancellation, 'running') });
              continue;
            }
            await transitionJob(this.cwd, refreshed.job.jobId, 'failed', {
              claim,
              error: { code: 'CONNECTOR_RESTARTED', message: 'The connector restarted before this isolated job published a revision.', retryable: true }
            });
          }
        } finally {
          await claim.release();
        }
      }
    }
  }

  private scheduleJob(jobId: string): void {
    if (!this.acceptingJobs || this.activeJobs.has(jobId)) return;
    const running = this.jobTail.then(async () => {
      if (this.acceptingJobs) await this.runJob(jobId);
    }).finally(() => this.activeJobs.delete(jobId));
    this.activeJobs.set(jobId, running);
    this.jobTail = running.catch(() => undefined);
  }

  private async withCancellationMutationLock<T>(store: WorkspaceStateStore, operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try { return await store.withMutationLock('api:cancel-job', operation); } catch (error) {
        if (!(error instanceof WorkspaceStateConflictError) || attempt === 199) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new WorkspaceStateConflictError('The workspace remained busy while cancellation was being recorded.');
  }

  private async waitForJobTerminal(jobId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = (await readJob(this.cwd, jobId)).job.state;
      if (state === 'succeeded' || state === 'failed' || state === 'cancelled') return;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
  }

  async validateRoot(input: { candidate: string }): Promise<unknown> {
    this.pruneRootValidations();
    if (this.rootValidations.size >= MAX_ACTIVE_ROOT_VALIDATIONS) {
      throw new WorkspaceStateError('ROOT_VALIDATION_LIMIT', 'Too many root validations are active. Approve or wait for an existing validation to expire before retrying.');
    }
    const candidate = path.resolve(this.cwd, input.candidate.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Candidate root must be a non-symlink directory.');
    const resolved = await realpath(candidate);
    const id = randomUUID();
    const validation = { id, candidate, realPath: resolved, name: path.basename(resolved) || 'root', createdAt: Date.now() };
    this.rootValidations.set(id, validation);
    return { validationId: id, label: redactedMetadataLabel(validation.name, 'Validated root'), directory: true, symlink: false, expiresInSeconds: 300 };
  }

  async approveRoot(input: { validationId: string; expectedRevision: string | null }): Promise<unknown> {
    const validation = this.rootValidations.get(input.validationId);
    if (!validation || Date.now() - validation.createdAt > 300_000) throw new Error('Root validation is missing or expired.');
    const store = WorkspaceStateStore.open(this.cwd);
    const result = await store.withMutationLock('api:approve-root', async (context) => {
      const migrated = await store.isMigrated();
      if (migrated) {
        const current = await store.readCurrent({ purpose: 'status' });
        if (!input.expectedRevision || current.currentPointer.revisionId !== input.expectedRevision) throw new WorkspaceStateConflictError(`Expected revision ${input.expectedRevision ?? 'null'}, found ${current.currentPointer.revisionId}.`);
        if (current.legacyDivergence.some((item) => item.severity === 'blocking')) {
          throw new WorkspaceStateError('STATE_LEGACY_CANONICAL_DIVERGENCE', 'Canonical legacy projections diverged from the approved workspace revision; review or repair them before approving another root.');
        }
        const config = await readSkillMapConfig(this.cwd);
        if (!config) throw new WorkspaceStateError('STATE_CONFIG_MISSING', 'The migrated workspace has no readable config projection.');
        const existing = await ensureWorkspaceIdentity(this.cwd, config.roots);
        const alreadyApproved = existing.approvedRoots.find((root) => root.realPath === validation.realPath);
        if (alreadyApproved) return {
          value: { approved: true, alreadyApproved: true, rootId: alreadyApproved.rootId },
          publication: undefined,
          current: current.currentPointer
        };
        const roots = [...config.roots, validation.realPath];
        const identity = await ensureWorkspaceIdentity(this.cwd, roots);
        await writeSkillMapConfig(this.cwd, { version: 1, profile: config.profile || DEFAULT_PROFILE, roots, ...(config.dashboardSnapshotPath ? { dashboardSnapshotPath: config.dashboardSnapshotPath } : {}) });
        const publication = await context.publishLegacySnapshot({ expectedRevisionId: current.currentPointer.revisionId, actor: 'local-api', reason: 'Approved validated skill root.' });
        const approvedRoot = identity.approvedRoots.find((root) => root.realPath === validation.realPath);
        return { value: { approved: true, alreadyApproved: false, rootId: approvedRoot?.rootId }, publication, current: current.currentPointer };
      }
      if (input.expectedRevision !== null) throw new WorkspaceStateConflictError('A new workspace requires expectedRevision=null.');
      const legacyConfig = await readSkillMapConfig(this.cwd);
      if (legacyConfig) {
        const hasIdentity = await readWorkspaceIdentity(this.cwd);
        const hasInventory = await fileExists(path.join(this.cwd, '.skillmap', 'inventory.json'));
        if (hasIdentity || hasInventory || legacyConfig.roots.length > 0) {
          throw new WorkspaceStateError(
            legacyConfig.roots.length > 0 && !hasIdentity && !hasInventory ? 'STATE_PARTIAL_LEGACY_ADOPTION_REQUIRED' : 'STATE_MIGRATION_REQUIRED',
            legacyConfig.roots.length > 0 && !hasIdentity && !hasInventory
              ? 'The partial legacy config already names roots. Use the explicit configured-root adoption action after reviewing them.'
              : 'Legacy SkillMap files already exist. Run explicit state migration instead of reinitializing them.'
          );
        }
        const identity = await ensureWorkspaceIdentity(this.cwd, [validation.realPath]);
        await writeSkillMapConfig(this.cwd, { ...legacyConfig, roots: [validation.realPath] });
        const publication = await context.migrateLegacy({ confirm: true, approveForRouting: false, actor: 'local-api', reason: 'Operator adopted a validated root into a config-only partial legacy workspace.' });
        return {
          value: { approved: true, alreadyApproved: false, rootId: identity.approvedRoots[0]?.rootId },
          publication,
          current: undefined
        };
      }
      const value = await initCommand(this.cwd, { root: validation.realPath });
      const publication = await context.migrateLegacy({ confirm: true, actor: 'local-api', reason: 'Initialized workspace with approved validated root.' });
      return { value, publication, current: undefined };
    });
    this.rootValidations.delete(input.validationId);
    this.filesystemFreshness.requestVerification();
    const value = result.value && typeof result.value === 'object' && !Array.isArray(result.value)
      ? result.value as Record<string, unknown>
      : {};
    const revision = result.publication ? pointerRef(result.publication.pointer) : pointerRef(result.current!);
    return {
      state: 'approved',
      approved: true,
      alreadyApproved: value.alreadyApproved === true,
      ...(typeof value.rootId === 'string' ? { rootId: value.rootId } : {}),
      revision,
      routingApprovalRequired: true
    };
  }

  async adoptPartialLegacy(input: { confirm: true }): Promise<unknown> {
    if (input.confirm !== true) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Partial legacy adoption requires explicit confirmation.');
    const store = WorkspaceStateStore.open(this.cwd);
    if (await store.isMigrated()) throw new WorkspaceStateConflictError('Workspace state is already migrated.');
    const config = await readSkillMapConfig(this.cwd);
    const identity = await readWorkspaceIdentity(this.cwd);
    const hasInventory = await fileExists(path.join(this.cwd, '.skillmap', 'inventory.json'));
    if (!config || identity || hasInventory) {
      throw new WorkspaceStateError('STATE_PARTIAL_LEGACY_NOT_APPLICABLE', 'Configured-root adoption applies only to a config-only legacy workspace.');
    }
    if (config.roots.length === 0) {
      throw new WorkspaceStateError('STATE_PARTIAL_LEGACY_ROOT_REQUIRED', 'The partial legacy config has no roots. Validate and approve one root instead.');
    }
    const resolved = await ensureWorkspaceIdentity(this.cwd, config.roots);
    const publication = await store.migrateLegacy({
      confirm: true,
      approveForRouting: false,
      actor: 'local-api',
      reason: 'Operator explicitly validated and adopted every configured root from a config-only legacy workspace.'
    });
    return {
      state: 'adopted',
      adopted: true,
      rootCount: resolved.approvedRoots.length,
      revision: pointerRef(publication.pointer),
      routingApprovalRequired: true,
      nextAction: 'scan'
    };
  }

  async stateRevisions(input: { cursor?: string; limit: number }): Promise<unknown> {
    const cursor = input.cursor ? decodeRevisionCursor(input.cursor) : undefined;
    const store = WorkspaceStateStore.open(this.cwd);
    const page = await store.readRevisionAncestry({ limit: input.limit, ...(cursor ? { startRevisionId: cursor.nextRevisionId } : {}) });
    if (cursor && cursor.currentRevisionId !== page.currentPointer.revisionId) {
      throw new WorkspaceStateError('STATE_REVISION_CURSOR_STALE', 'Revision history changed after this cursor was issued. Restart from the first page.');
    }
    let routingRevisionId: string | null = null;
    try { routingRevisionId = (await openApprovedWorkspaceRead(this.cwd, 'routing')).servingRevision.revisionId; } catch { /* Routing approval may not exist yet. */ }
    const items = [];
    for (const verifiedRevision of page.revisions) {
      const { manifest } = verifiedRevision;
      const routingApprovalRecorded = await store.hasRoutingApprovalReceipt(verifiedRevision, { revalidateArtifacts: false });
      items.push({
        revision: pointerRef(manifest),
        sequence: manifest.sequence,
        parentRevisionId: manifest.parentRevisionId,
        createdAt: manifest.createdAt,
        mutation: {
          kind: manifest.mutation.kind,
          actor: machineCodeOrNull(manifest.mutation.actor, 64),
          reasonDigest: manifest.mutation.reason ? hashText(`revision-reason:${manifest.mutation.reason}`) : null,
          sourceRevisionId: canonicalRevisionOrNull(manifest.mutation.sourceRevisionId),
          targetRevisionId: canonicalRevisionOrNull(manifest.mutation.targetRevisionId)
        },
        isCurrent: manifest.revisionId === page.currentPointer.revisionId,
        isRoutingServing: manifest.revisionId === routingRevisionId,
        routingApprovalRecorded,
        artifactCount: manifest.artifacts.length
      });
    }
    return {
      items,
      limit: input.limit,
      hasMore: page.nextRevisionId !== null,
      nextCursor: page.nextRevisionId ? encodeRevisionCursor(page.currentPointer.revisionId, page.nextRevisionId) : null,
      currentRevision: pointerRef(page.currentPointer),
      routingRevisionId
    };
  }

  async rollbackState(input: { targetRevision: string; expectedRevision: string; actor: string; reason: string; confirm: true }): Promise<unknown> {
    if (input.confirm !== true) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'Rollback requires explicit confirmation.');
    if (!machineCodeOrNull(input.actor, 64) || !machineCodeOrNull(input.reason, 128)) {
      throw new WorkspaceStateError('STATE_ROLLBACK_RECEIPT_INVALID', 'Rollback actor and reason must be bounded machine-safe codes.');
    }
    const publication = await WorkspaceStateStore.open(this.cwd).rollback({
      targetRevisionId: input.targetRevision,
      expectedRevisionId: input.expectedRevision,
      actor: input.actor,
      reason: input.reason,
      approveForRouting: false
    });
    this.filesystemFreshness.requestVerification();
    return {
      state: 'rolled-back',
      revision: pointerRef(publication.pointer),
      targetRevisionId: input.targetRevision,
      routingApproved: false,
      routingApprovalRequired: true,
      warningCount: publication.warnings.length
    };
  }

  async migrateState(input: { confirm: true }): Promise<unknown> {
    if (input.confirm !== true) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'State migration requires explicit confirmation.');
    const store = WorkspaceStateStore.open(this.cwd);
    if (await store.isMigrated()) {
      const current = await store.readCurrent({ purpose: 'status' });
      return { migrated: true, alreadyMigrated: true, revision: pointerRef(current.currentPointer) };
    }
    const publication = await store.migrateLegacy({ confirm: true, approveForRouting: false, actor: 'local-api', reason: 'Operator confirmed legacy workspace migration in the local app.' });
    return { migrated: true, alreadyMigrated: false, revision: pointerRef(publication.pointer), warnings: publication.warnings };
  }

  async recoverState(input: { confirm: true }): Promise<unknown> {
    if (input.confirm !== true) throw new WorkspaceStateError('STATE_CONFIRM_REQUIRED', 'State recovery requires explicit confirmation.');
    const publication = await WorkspaceStateStore.open(this.cwd).recoverFromLastKnownGood({
      confirm: true,
      actor: 'local-api',
      reason: 'Operator confirmed derived-state recovery in the local app.'
    });
    return { recovered: true, revision: pointerRef(publication.pointer), warnings: publication.warnings };
  }

  private async runJob(jobId: string): Promise<void> {
    if (!this.acceptingJobs) return;
    const claim = await claimJobExecution(this.cwd, jobId);
    if (!claim) return;
    const controller = new AbortController();
    this.activeJobControllers.set(jobId, controller);
    if (!this.acceptingJobs) controller.abort();
    try {
      const before = await readJob(this.cwd, jobId);
      if (before.job.state !== 'queued') return;
      const queuedCancellation = await readJobCancellation(this.cwd, jobId);
      if (queuedCancellation) {
        await transitionJob(this.cwd, jobId, 'cancelled', { claim, resultReceipt: cancellationReceipt(queuedCancellation, 'queued') });
        return;
      }
      const stored = await transitionJob(this.cwd, jobId, 'running', { claim });
      const store = WorkspaceStateStore.open(this.cwd);
      const prepared = await this.prepareJobArtifacts(stored.job.jobId, stored.job.expectedRevision, stored.request.parameters, controller.signal);
      await this.jobLifecycleHooks?.beforePublication?.({ jobId, type: stored.job.type, signal: controller.signal });
      if (!this.acceptingJobs) throw new WorkspaceStateError('JOB_CONNECTOR_CLOSING', 'The connector closed before this isolated job could publish.');
      if (await readJobCancellation(this.cwd, jobId)) throw new WorkspaceStateError('JOB_CANCELLATION_REQUESTED', 'The job was cancelled before publication.');
      const publication = await store.publishPreparedSnapshot({
        expectedRevisionId: stored.job.expectedRevision,
        workspaceId: prepared.workspaceId,
        artifacts: prepared.artifacts,
        approveForRouting: false,
        carryForwardRoutingApproval: stored.job.type === 'eval-run',
        actor: jobActor(stored.job.jobId),
        reason: `Completed isolated allowlisted ${stored.job.type} job.`,
        prePublishCheck: async () => {
          if (await readJobCancellation(this.cwd, jobId)) throw new WorkspaceStateError('JOB_CANCELLATION_REQUESTED', 'The job was cancelled before publication.');
        }
      });
      await this.jobLifecycleHooks?.afterPublication?.({ jobId, revisionId: publication.pointer.revisionId });
      await transitionJob(this.cwd, jobId, 'succeeded', { claim, resultReceipt: successfulJobResultReceipt(stored.job.type, publication.manifest) });
      this.filesystemFreshness.requestVerification();
    } catch (error) {
      await this.reconcileJobFailure(jobId, claim, error).catch(() => undefined);
    } finally {
      this.activeJobControllers.delete(jobId);
      await claim.release().catch(() => undefined);
    }
  }

  private async reconcileJobFailure(jobId: string, claim: JobExecutionClaim, error: unknown): Promise<void> {
    const stored = await readJob(this.cwd, jobId);
    if (stored.job.state === 'succeeded' || stored.job.state === 'failed' || stored.job.state === 'cancelled') return;
    if (stored.job.state === 'running') {
      const published = await WorkspaceStateStore.open(this.cwd).findPublishedMutation({
        actor: jobActor(stored.job.jobId),
        parentRevisionId: stored.job.expectedRevision
      }).catch(() => undefined);
      if (published) {
        await transitionJob(this.cwd, jobId, 'succeeded', {
          claim,
          resultReceipt: successfulJobResultReceipt(stored.job.type, published, true)
        });
        this.filesystemFreshness.requestVerification();
        return;
      }
      const cancellation = await readJobCancellation(this.cwd, jobId);
      if (cancellation) {
        await transitionJob(this.cwd, jobId, 'cancelled', { claim, resultReceipt: cancellationReceipt(cancellation, 'running') });
        return;
      }
      await transitionJob(this.cwd, jobId, 'failed', {
        claim,
        error: {
          code: error instanceof WorkspaceStateError ? error.code : 'JOB_FAILED',
          message: safeJobMessage(error),
          retryable: error instanceof WorkspaceStateConflictError || !this.acceptingJobs
        }
      });
    }
  }

  private async publishExpectedMutation(expectedRevision: string, operation: string, reason: string, mutate: () => Promise<unknown>): Promise<{ value: unknown; publication: Awaited<ReturnType<WorkspaceStateStore['publishLegacySnapshot']>> }> {
    const store = WorkspaceStateStore.open(this.cwd);
    const result = await store.withMutationLock(operation, async (context) => {
      const current = await store.readCurrent({ purpose: 'status' });
      if (current.currentPointer.revisionId !== expectedRevision) throw new WorkspaceStateConflictError(`Expected revision ${expectedRevision}, found ${current.currentPointer.revisionId}.`);
      if (current.legacyDivergence.some((item) => item.severity === 'blocking')) throw new WorkspaceStateError('STATE_LEGACY_CANONICAL_DIVERGENCE', 'Canonical legacy projections diverged from the approved revision; review or repair them before applying another decision.');
      const value = await mutate();
      const publication = await context.publishLegacySnapshot({ expectedRevisionId: current.currentPointer.revisionId, approveForRouting: false, actor: 'local-api', reason });
      return { value, publication };
    });
    return result;
  }

  private async prepareJobArtifacts(jobId: string, expectedRevision: string, parameters: JobParameters, signal?: AbortSignal): Promise<{ workspaceId: string; artifacts: SnapshotArtifact[] }> {
    const store = WorkspaceStateStore.open(this.cwd);
    const current = await store.readCurrent({ purpose: 'status' });
    if (current.currentPointer.revisionId !== expectedRevision) throw new WorkspaceStateConflictError(`Expected revision ${expectedRevision}, found ${current.currentPointer.revisionId}.`);
    if (current.source !== 'current') throw new WorkspaceStateError('STATE_REPAIR_REQUIRED', 'Generic jobs require a valid current revision; recover derived state first.');
    if (current.legacyDivergence.some((item) => item.severity === 'blocking')) {
      throw new WorkspaceStateError('STATE_LEGACY_CANONICAL_DIVERGENCE', 'Canonical projections diverge from the exact requested revision; repair or review them before starting a job.');
    }
    let evalRuntime: EvalCommandRuntime = {};
    if (parameters.type === 'eval-run') {
      const routing = await openApprovedWorkspaceRead(this.cwd, 'routing');
      if (routing.servingRevision.revisionId !== current.currentPointer.revisionId) {
        throw new WorkspaceStateConflictError(`Expected routing revision ${current.currentPointer.revisionId}, found ${routing.servingRevision.revisionId}.`);
      }
      const releaseContext = await prepareEvalRunV3ExecutionContextIfPresent(this.cwd, routing);
      evalRuntime = releaseContext ? Object.freeze({ releaseContext: freezeEvalExecutionContext(releaseContext) }) : Object.freeze({});
    }
    const stage = await this.createIsolatedStage(jobId, current);
    try {
      await this.jobLifecycleHooks?.beforeStagedExecution?.({ jobId, type: parameters.type, ...(signal ? { signal } : {}) });
      await this.executeJob(stage, parameters, signal, evalRuntime);
      const snapshot = await collectLegacySnapshot(WorkspaceStateStore.open(stage).paths);
      assertNoStagingPath(snapshot.artifacts, stage);
      assertExpectedJobArtifacts(current.revision.manifest.artifacts, snapshot.artifacts, parameters);
      if (snapshot.workspaceId !== current.currentPointer.workspaceId) throw new WorkspaceStateError('STATE_WORKSPACE_ID_DIVERGED', 'Isolated job output changed the workspace identity.');
      return snapshot;
    } finally {
      await rm(path.dirname(stage), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async createIsolatedStage(
    jobId: string,
    current: Awaited<ReturnType<WorkspaceStateStore['readCurrent']>>,
    options: { outsideWorkspace?: boolean } = {}
  ): Promise<string> {
    let container: string;
    if (options.outsideWorkspace) {
      container = await mkdtemp(path.join(tmpdir(), `skillmap-${jobId}-`));
    } else {
      const stagingRoot = path.join(this.cwd, '.skillmap', 'operational', 'job-staging');
      await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
      container = await mkdtemp(path.join(stagingRoot, `${jobId}-`));
    }
    const stage = path.join(container, 'workspace');
    const stagedSkillmap = path.join(stage, '.skillmap');
    await mkdir(stagedSkillmap, { recursive: true, mode: 0o700 });
    await copyFile(WorkspaceStateStore.open(this.cwd).paths.marker, path.join(stagedSkillmap, 'state-version.json'));
    const originalState = WorkspaceStateStore.open(this.cwd).paths;
    const stagedState = WorkspaceStateStore.open(stage).paths;
    await mkdir(stagedState.pointers, { recursive: true, mode: 0o700 });
    await mkdir(stagedState.revisions, { recursive: true, mode: 0o700 });
    await copyFile(originalState.currentPointer, stagedState.currentPointer);
    const revisionIds = new Set<string>([current.currentPointer.revisionId]);
    try {
      await copyFile(originalState.lastKnownGoodPointer, stagedState.lastKnownGoodPointer);
      const lkg = JSON.parse(await readFile(originalState.lastKnownGoodPointer, 'utf8')) as { revisionId?: unknown };
      if (typeof lkg.revisionId === 'string') revisionIds.add(lkg.revisionId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const revisionId of revisionIds) {
      await cp(path.join(originalState.revisions, revisionId), path.join(stagedState.revisions, revisionId), { recursive: true, errorOnExist: true, force: false });
    }
    for (const artifact of await revisionArtifacts(originalState, current.revision)) {
      const target = path.join(stagedSkillmap, ...artifact.path.split('/'));
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(path.join(current.revision.directory, 'workspace', '.skillmap', ...artifact.path.split('/')), target);
    }
    await copyFile(path.join(this.cwd, 'package.json'), path.join(stage, 'package.json')).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    return stage;
  }

  private async executeJob(stage: string, parameters: JobParameters, signal?: AbortSignal, evalRuntime: EvalCommandRuntime = {}): Promise<unknown> {
    if (parameters.type === 'scan') {
      const identity = await readWorkspaceIdentity(stage);
      const roots = identity?.roots.map((root) => root.realPath) ?? [];
      return scanCommand(stage, { root: roots }, { logicalCwd: this.cwd });
    }
    if (parameters.type === 'doctor') return doctorCommand(stage, {});
    if (parameters.type === 'doctor-pack') return doctorPackCommand(stage, parameters.summary ? { summary: true } : {});
    if (parameters.type === 'graph-build') return graphCommand(stage, ['build'], parameters.mode === 'raw' ? { raw: true } : {});
    if (parameters.type === 'eval-run') return this.evalCommandRunner(stage, { 'save-report': true }, evalRuntime);
    if (parameters.type === 'sources-check') return sourcesCommand(stage, ['check'], {}, { ...(signal ? { signal } : {}) });
    throw new Error('Unsupported allowlisted job type.');
  }

  private async revalidateWorkspace(validation: WorkspaceValidation): Promise<string> {
    if (Date.now() - validation.createdAt > 300_000) throw new WorkspaceStateError('WORKSPACE_VALIDATION_INVALID', 'Workspace validation expired.');
    if (validation.mode === 'select-existing') {
      const stats = await workspaceLstat(validation.candidatePath, 'WORKSPACE_VALIDATION_CHANGED', 'The selected workspace changed after validation. Validate it again.');
      const identity = workspaceFilesystemIdentity(stats, 'WORKSPACE_VALIDATION_CHANGED', 'The selected workspace filesystem identity changed after validation. Validate it again.');
      if (stats.isSymbolicLink() || !stats.isDirectory() || identity.device !== validation.device || identity.inode !== validation.inode) {
        throw new WorkspaceStateError('WORKSPACE_VALIDATION_CHANGED', 'The selected workspace changed after validation. Validate it again.');
      }
      const resolved = await workspaceRealpath(validation.candidatePath, 'WORKSPACE_VALIDATION_CHANGED', 'The selected workspace identity changed after validation. Validate it again.');
      if (resolved !== validation.targetRealPath) throw new WorkspaceStateError('WORKSPACE_VALIDATION_CHANGED', 'The selected workspace identity changed after validation. Validate it again.');
      return resolved;
    }
    if (!validation.parentPath || !validation.parentRealPath) throw new WorkspaceStateError('WORKSPACE_VALIDATION_INVALID', 'New workspace validation is incomplete.');
    const parentStats = await workspaceLstat(validation.parentPath, 'WORKSPACE_VALIDATION_CHANGED', 'The new workspace parent changed after validation. Validate it again.');
    const parentIdentity = workspaceFilesystemIdentity(parentStats, 'WORKSPACE_VALIDATION_CHANGED', 'The new workspace parent filesystem identity changed after validation. Validate it again.');
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory() || parentIdentity.device !== validation.device || parentIdentity.inode !== validation.inode) {
      throw new WorkspaceStateError('WORKSPACE_VALIDATION_CHANGED', 'The new workspace parent changed after validation. Validate it again.');
    }
    if (await workspaceRealpath(validation.parentPath, 'WORKSPACE_VALIDATION_CHANGED', 'The new workspace parent identity changed after validation. Validate it again.') !== validation.parentRealPath) throw new WorkspaceStateError('WORKSPACE_VALIDATION_CHANGED', 'The new workspace parent identity changed after validation. Validate it again.');
    await assertWorkspacePathAbsent(validation.candidatePath, 'WORKSPACE_VALIDATION_CHANGED', 'The new workspace path appeared after validation. Validate a different path.');
    try {
      await mkdir(validation.candidatePath, { mode: 0o700 });
    } catch (error) {
      throw new WorkspaceStateError('WORKSPACE_CREATE_FAILED', 'The confirmed workspace directory could not be created safely.', { cause: error });
    }
    const created = await workspaceLstat(validation.candidatePath, 'WORKSPACE_CREATE_FAILED', 'The confirmed workspace directory could not be inspected safely.');
    const resolved = await workspaceRealpath(validation.candidatePath, 'WORKSPACE_CREATE_FAILED', 'The confirmed workspace directory could not be resolved safely.');
    if (created.isSymbolicLink() || !created.isDirectory() || resolved !== validation.targetRealPath) {
      throw new WorkspaceStateError('WORKSPACE_VALIDATION_CHANGED', 'The created workspace did not match its validated destination.');
    }
    return resolved;
  }

  private async assertNoNonterminalJobs(cwd: string, scope: 'current' | 'selected'): Promise<void> {
    const jobs = await listAllJobs(cwd);
    if (jobs.some((stored) => stored.job.state === 'queued' || stored.job.state === 'running')) {
      throw new WorkspaceStateError('WORKSPACE_SWITCH_JOBS_ACTIVE', `The ${scope} workspace has a nonterminal job. Finish or cancel it before switching.`);
    }
  }

  private clearWorkspaceValidationTokens(): void {
    this.rootValidations.clear();
    this.workspaceValidations.clear();
    this.policyProposals.clear();
  }

  private pruneWorkspaceValidations(): void {
    const cutoff = Date.now() - 300_000;
    for (const [id, validation] of this.workspaceValidations) if (validation.createdAt < cutoff) this.workspaceValidations.delete(id);
  }

  private pruneRootValidations(): void {
    const cutoff = Date.now() - 300_000;
    for (const [id, validation] of this.rootValidations) if (validation.createdAt < cutoff) this.rootValidations.delete(id);
  }

  private prunePolicyProposals(): void {
    const now = Date.now();
    for (const [id, proposal] of this.policyProposals) {
      if (proposal.workspaceGeneration !== this.workspaceGeneration || Date.parse(proposal.expiresAt) <= now) this.policyProposals.delete(id);
    }
  }
}

async function readPolicyReviewMaterial(cwd: string): Promise<PolicyReviewMaterial>;
async function readPolicyReviewMaterial(cwd: string, requireV2: true): Promise<PolicyReviewMaterialV2>;
async function readPolicyReviewMaterial(cwd: string, requireV2 = false): Promise<PolicyReviewMaterial | PolicyReviewMaterialV2> {
  const inventory = await readJson<Inventory>(path.join(cwd, '.skillmap', 'inventory.json'));
  const active = await readActivePolicy(cwd);
  if (requireV2 && !active.file) throw new WorkspaceStateError('POLICY_REQUIRED', 'A reviewed policy artifact is required before using the policy queue.');
  const policyDigest = active.file ? hashText(await readFile(active.file, 'utf8')) : hashText(canonicalJson(active.policy));
  const pointer = await readActivePolicyPointer(cwd);
  if (requireV2 && (active.policy.version !== 2 || !pointer || pointer.activePolicyVersion !== 2)) {
    throw new WorkspaceStateError('POLICY_V2_REQUIRED', 'Actionable policy review requires an active policy v2 migration. Run the policy migration workflow first.');
  }
  if (requireV2) return { inventory, policy: active.policy as PolicyV2, policyDigest, pointer: pointer! };
  return { inventory, policy: active.policy, policyDigest, ...(pointer ? { pointer } : {}) };
}

function projectPolicyReviewItem(item: PolicyReviewQueueItem): Omit<PolicyReviewQueueItem, 'rawKey' | 'displayName'> & { displayName: string } {
  return {
    reviewId: item.reviewId,
    queue: item.queue,
    action: item.action,
    state: item.state,
    blocking: item.blocking,
    displayName: redactedMetadataLabel(item.displayName, item.skillIds[0] ?? item.reviewId),
    skillIds: item.skillIds,
    contentRevisions: item.contentRevisions,
    ...(item.currentTier ? { currentTier: item.currentTier } : {}),
    queueFingerprint: item.queueFingerprint
  };
}

function validatePolicyProposalSelection(
  item: PolicyReviewQueueItem,
  input: { skillId?: string; tier?: SkillTier }
): { skillId?: string; contentRevision?: string; tier?: SkillTier } {
  if (item.action === 'select-canonical') {
    if (!input.skillId || !item.skillIds.includes(input.skillId) || input.tier !== undefined) {
      throw new WorkspaceStateError('POLICY_PROPOSAL_INVALID', 'Canonical proposals must select exactly one current variant and cannot set a tier.');
    }
    const index = item.skillIds.indexOf(input.skillId);
    return { skillId: input.skillId, contentRevision: item.contentRevisions[index] };
  }
  if (item.action === 'set-skill-policy') {
    const skillId = item.skillIds[0];
    if (!skillId || (input.skillId !== undefined && input.skillId !== skillId) || !input.tier) {
      throw new WorkspaceStateError('POLICY_PROPOSAL_INVALID', 'Skill policy proposals require the current queue skill and a reviewed tier.');
    }
    return { skillId, contentRevision: item.contentRevisions[0], tier: input.tier };
  }
  if (input.skillId !== undefined || input.tier !== undefined) {
    throw new WorkspaceStateError('POLICY_PROPOSAL_INVALID', 'Retirement proposals do not accept a skill selection or tier.');
  }
  return {};
}

type EvalCaseOutcome = 'top1-hit' | 'top3-hit' | 'correct-abstention' | 'miss' | 'unsafe' | 'invalid';

interface EvalCaseResultReceipt {
  caseId: string;
  primaryCaseType: 'explicit' | 'implicit-natural' | 'multi-skill' | 'negative-near-miss';
  membership: 'train' | 'holdout';
  releaseCounted: boolean;
  releaseScored: boolean;
  expectedSkillIds: string[];
  avoidSkillIds: string[];
  qualifiedSkillId?: string;
  recommendedSkillIds: string[];
  avoidedButRecommendedSkillIds: string[];
  top1Hit: boolean;
  top3Hit: boolean;
  abstained: boolean;
  advisoryBytes: number;
  outcome: EvalCaseOutcome;
  reasonCodes: string[];
  validationCodes: string[];
  leakageCodes: string[];
}

async function readApprovedEvalReport(read: ApprovedWorkspaceRead): Promise<Record<string, unknown> | undefined> {
  const artifact = read.state.revision.manifest.artifacts.find((item) => item.path === 'eval-report.json');
  if (!artifact) return undefined;
  if (artifact.bytes < 2 || artifact.bytes > MAX_EVAL_REPORT_BYTES) {
    throw new WorkspaceStateError('EVAL_REPORT_TOO_LARGE', 'The immutable eval report is outside the local application read limit.');
  }
  const file = approvedArtifactPath(read, 'eval-report.json');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== artifact.bytes || stats.size > MAX_EVAL_REPORT_BYTES) {
      throw new WorkspaceStateError('EVAL_REPORT_INVALID', 'The immutable eval report changed or is not a bounded regular file.');
    }
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text, 'utf8') !== artifact.bytes || hashText(text) !== artifact.digest) {
      throw new WorkspaceStateError('EVAL_REPORT_INVALID', 'The immutable eval report no longer matches its revision receipt.');
    }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new WorkspaceStateError('EVAL_REPORT_INVALID', 'The immutable eval report is not valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new WorkspaceStateError('EVAL_REPORT_INVALID', 'The immutable eval report has an invalid top-level shape.');
    }
    return parsed as Record<string, unknown>;
  } finally {
    await handle.close();
  }
}

function projectEvalCaseTrace(
  report: Record<string, unknown> | undefined,
  effective: EffectiveRegistry | undefined,
  binding: { datasetDigest: string | null; effectiveRevisionDigest: string | null }
): { state: 'available' | 'empty' | 'unavailable' | 'binding-mismatch' | 'invalid' | 'too-large'; items: EvalCaseResultReceipt[] } {
  if (!report) return { state: 'unavailable', items: [] };
  if (!effective) return { state: 'invalid', items: [] };
  if (report.kind === 'skillmap.eval-run' && report.schemaVersion === 3) {
    const revision = objectRecord(report.revision);
    if (report.datasetDigest !== binding.datasetDigest || revision.effectiveRevisionDigest !== binding.effectiveRevisionDigest) {
      return { state: 'binding-mismatch', items: [] };
    }
    if (!Array.isArray(report.caseResults)) return { state: 'invalid', items: [] };
    if (report.caseResults.length > MAX_EVAL_CASE_RESULTS) return { state: 'too-large', items: [] };
    const items: EvalCaseResultReceipt[] = [];
    const caseIds = new Set<string>();
    for (const value of report.caseResults) {
      const projected = projectEvalCaseResultV3(value, effective);
      if (!projected || caseIds.has(projected.caseId)) return { state: 'invalid', items: [] };
      caseIds.add(projected.caseId);
      items.push(projected);
    }
    if (!evalRunV3MetricsMatch(report.metrics, items)) return { state: 'invalid', items: [] };
    return { state: items.length ? 'available' : 'empty', items };
  }
  if (report.version !== 2 || !Array.isArray(report.rows)) return { state: 'invalid', items: [] };
  if (report.datasetDigest !== binding.datasetDigest || report.effectiveRevisionDigest !== binding.effectiveRevisionDigest) {
    return { state: 'binding-mismatch', items: [] };
  }
  if (report.rows.length > MAX_EVAL_CASE_RESULTS) return { state: 'too-large', items: [] };
  const items: EvalCaseResultReceipt[] = [];
  for (const [index, value] of report.rows.entries()) {
    const projected = projectEvalCaseResult(value, index, binding.datasetDigest, effective);
    if (!projected) return { state: 'invalid', items: [] };
    items.push(projected);
  }
  return { state: items.length ? 'available' : 'empty', items };
}

const EVAL_RUN_V3_CASE_KEYS = new Set([
  'caseId', 'primaryCaseType', 'membership', 'releaseCounted', 'releaseScored', 'expectedSkillIds', 'avoidSkillIds',
  'qualifiedSkillId', 'recommendedSkillIds', 'avoidedButRecommendedSkillIds', 'top1Hit', 'top3Hit', 'abstained',
  'advisoryBytes', 'outcome', 'reasonCodes', 'validationCodes', 'leakageCodes'
]);

function projectEvalCaseResultV3(value: unknown, effective: EffectiveRegistry): EvalCaseResultReceipt | undefined {
  const row = objectRecord(value);
  if (Object.keys(row).some((key) => !EVAL_RUN_V3_CASE_KEYS.has(key))) return undefined;
  const caseId = typeof row.caseId === 'string' && /^evalcase_[A-Za-z0-9_-]{8,100}$/.test(row.caseId) ? row.caseId : undefined;
  const primaryCaseType = oneOfString(row.primaryCaseType, ['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss'] as const);
  const membership = oneOfString(row.membership, ['train', 'holdout'] as const);
  const skillsById = new Map(effective.skills.map((skill) => [skill.skillId, skill]));
  const knownSkillIds = new Set(skillsById.keys());
  const expectedSkillIds = evalV3SkillIdList(row.expectedSkillIds, knownSkillIds, 100);
  const avoidSkillIds = evalV3SkillIdList(row.avoidSkillIds, knownSkillIds, 100);
  const recommendedSkillIds = evalV3SkillIdList(row.recommendedSkillIds, knownSkillIds, 3);
  const avoidedButRecommendedSkillIds = evalV3SkillIdList(row.avoidedButRecommendedSkillIds, knownSkillIds, 100);
  const qualifiedSkillId = row.qualifiedSkillId === undefined
    ? undefined
    : typeof row.qualifiedSkillId === 'string' && skillsById.get(row.qualifiedSkillId)?.qualifiedExplicitAllowed === true ? row.qualifiedSkillId : null;
  const reasonCodes = evalV3CodeList(row.reasonCodes, false);
  const validationCodes = evalV3CodeList(row.validationCodes, true);
  const leakageCodes = evalV3CodeList(row.leakageCodes, true);
  const advisoryBytes = Number.isSafeInteger(row.advisoryBytes) && (row.advisoryBytes as number) >= 0 && (row.advisoryBytes as number) <= 1_048_576
    ? row.advisoryBytes as number
    : undefined;
  const outcome = oneOfString(row.outcome, ['top1-hit', 'top3-hit', 'correct-abstention', 'miss', 'unsafe', 'invalid'] as const);
  if (!caseId || !primaryCaseType || !membership || !expectedSkillIds || !avoidSkillIds || !recommendedSkillIds
    || !avoidedButRecommendedSkillIds || qualifiedSkillId === null || !reasonCodes || !validationCodes || !leakageCodes
    || advisoryBytes === undefined || !outcome) return undefined;
  if (expectedSkillIds.some((skillId) => avoidSkillIds.includes(skillId))) return undefined;
  if ((primaryCaseType === 'explicit' || primaryCaseType === 'implicit-natural') && expectedSkillIds.length < 1) return undefined;
  if (primaryCaseType === 'multi-skill' && (expectedSkillIds.length < 2 || expectedSkillIds.length > 3)) return undefined;
  if (primaryCaseType === 'negative-near-miss' && avoidSkillIds.length < 1) return undefined;
  const recomputedAvoided = avoidSkillIds.filter((skillId) => recommendedSkillIds.includes(skillId));
  if (!sameStringList(avoidedButRecommendedSkillIds, recomputedAvoided)) return undefined;
  const top1Hit = expectedSkillIds.length > 0 && expectedSkillIds.includes(recommendedSkillIds[0]);
  const top3Hit = expectedSkillIds.length > 0 && (primaryCaseType === 'multi-skill'
    ? expectedSkillIds.every((skillId) => recommendedSkillIds.includes(skillId))
    : expectedSkillIds.some((skillId) => recommendedSkillIds.includes(skillId)));
  const abstained = recommendedSkillIds.length === 0;
  const bindingCodes = reasonCodes.filter((code) => /_(?:INVALID|UNRESOLVED|AMBIGUOUS)$/.test(code));
  const derivedValidationCodes = [...new Set([...validationCodes, ...bindingCodes])];
  const releaseCounted = primaryCaseType !== 'explicit' && derivedValidationCodes.length === 0;
  const releaseScored = releaseCounted && expectedSkillIds.length > 0;
  const recomputedOutcome = evalCaseOutcome({
    primaryCaseType,
    expectedSkillIds,
    avoidedButRecommendedSkillIds,
    top1Hit,
    top3Hit,
    abstained,
    invalid: derivedValidationCodes.length > 0 || leakageCodes.length > 0
  });
  const outcomeCode: Record<EvalCaseOutcome, string> = {
    'top1-hit': 'EXPECTED_TOP1',
    'top3-hit': 'EXPECTED_TOP3',
    'correct-abstention': 'CORRECT_ABSTENTION',
    miss: abstained ? 'EXPECTED_SKILL_ABSTAINED' : 'EXPECTED_SKILL_MISSED',
    unsafe: 'AVOID_TARGET_RECOMMENDED',
    invalid: 'CASE_INVALID'
  };
  if (row.top1Hit !== top1Hit || row.top3Hit !== top3Hit || row.abstained !== abstained
    || row.releaseCounted !== releaseCounted || row.releaseScored !== releaseScored || outcome !== recomputedOutcome
    || [outcomeCode[recomputedOutcome], ...derivedValidationCodes, ...leakageCodes].some((code) => !reasonCodes.includes(code))) return undefined;
  return {
    caseId,
    primaryCaseType,
    membership,
    releaseCounted,
    releaseScored,
    expectedSkillIds,
    avoidSkillIds,
    ...(qualifiedSkillId ? { qualifiedSkillId } : {}),
    recommendedSkillIds,
    avoidedButRecommendedSkillIds,
    top1Hit,
    top3Hit,
    abstained,
    advisoryBytes,
    outcome,
    reasonCodes,
    validationCodes,
    leakageCodes
  };
}

function evalV3SkillIdList(value: unknown, knownSkillIds: Set<string>, maximum: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !/^sk_[A-Za-z0-9_-]{43}$/.test(item) || !knownSkillIds.has(item) || result.includes(item)) return undefined;
    result.push(item);
  }
  return result;
}

function evalV3CodeList(value: unknown, emptyAllowed: boolean): string[] | undefined {
  if (!Array.isArray(value) || value.length > 100 || (!emptyAllowed && value.length === 0)) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !/^[A-Z][A-Z0-9_]{1,79}$/.test(item) || result.includes(item)) return undefined;
    result.push(item);
  }
  return result;
}

function evalRunV3MetricsMatch(value: unknown, items: EvalCaseResultReceipt[]): boolean {
  const metrics = objectRecord(value);
  const releaseScored = items.filter((item) => item.releaseScored);
  const releaseCounted = items.filter((item) => item.releaseCounted);
  const negativeCases = releaseCounted.filter((item) => item.primaryCaseType === 'negative-near-miss' && item.expectedSkillIds.length === 0);
  const top1 = releaseScored.filter((item) => item.top1Hit).length;
  const top3 = releaseScored.filter((item) => item.top3Hit).length;
  const expected = {
    count: items.length,
    top1,
    top3,
    avoidHits: releaseCounted.reduce((sum, item) => sum + item.avoidedButRecommendedSkillIds.length, 0),
    top1Rate: releaseScored.length === 0 ? 0 : top1 / releaseScored.length,
    top3Rate: releaseScored.length === 0 ? 0 : top3 / releaseScored.length,
    abstentionRate: negativeCases.length === 0 ? 0 : negativeCases.filter((item) => item.abstained).length / negativeCases.length,
    meanAdvisoryBytes: releaseCounted.length === 0 ? 0 : releaseCounted.reduce((sum, item) => sum + item.advisoryBytes, 0) / releaseCounted.length
  };
  return Object.entries(expected).every(([key, expectedValue]) => metrics[key] === expectedValue);
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function projectEvalCaseResult(
  value: unknown,
  index: number,
  datasetDigest: string | null,
  effective: EffectiveRegistry
): EvalCaseResultReceipt | undefined {
  const row = objectRecord(value);
  const primaryCaseType = oneOfString(row.primaryCaseType, ['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss'] as const);
  const membership = oneOfString(row.membership, ['train', 'holdout'] as const);
  if (!primaryCaseType || !membership) return undefined;
  const bindingCodes: string[] = [];
  const expectedSkillIds = resolveEvalSkillNames(row.expected, effective, 'EXPECTED', bindingCodes);
  const avoidSkillIds = resolveEvalSkillNames(row.avoid, effective, 'AVOID', bindingCodes);
  const recommendedSkillIds = resolveEvalSkillNames(row.recommended, effective, 'RECOMMENDED', bindingCodes);
  const avoidedButRecommendedSkillIds = avoidSkillIds.filter((skillId) => recommendedSkillIds.includes(skillId));
  const validationCodes = evalValidationCodes(row.validationErrors);
  const leakageCodes = evalLeakageCodes(row.leakage);
  const top1Hit = expectedSkillIds.length > 0 && expectedSkillIds.includes(recommendedSkillIds[0]);
  const top3Hit = expectedSkillIds.length > 0 && (primaryCaseType === 'multi-skill'
    ? expectedSkillIds.every((skillId) => recommendedSkillIds.includes(skillId))
    : expectedSkillIds.some((skillId) => recommendedSkillIds.includes(skillId)));
  const abstained = recommendedSkillIds.length === 0;
  const advisoryBytes = Number.isSafeInteger(row.advisoryBytes) && (row.advisoryBytes as number) >= 0 && (row.advisoryBytes as number) <= 1_048_576
    ? row.advisoryBytes as number
    : undefined;
  if (advisoryBytes === undefined) return undefined;
  const outcome = evalCaseOutcome({
    primaryCaseType,
    expectedSkillIds,
    avoidedButRecommendedSkillIds,
    top1Hit,
    top3Hit,
    abstained,
    invalid: validationCodes.length > 0 || leakageCodes.length > 0 || bindingCodes.some((code) => code.endsWith('_INVALID') || code.endsWith('_UNRESOLVED') || code.endsWith('_AMBIGUOUS'))
  });
  const outcomeCode: Record<EvalCaseOutcome, string> = {
    'top1-hit': 'EXPECTED_TOP1',
    'top3-hit': 'EXPECTED_TOP3',
    'correct-abstention': 'CORRECT_ABSTENTION',
    miss: abstained ? 'EXPECTED_SKILL_ABSTAINED' : 'EXPECTED_SKILL_MISSED',
    unsafe: 'AVOID_TARGET_RECOMMENDED',
    invalid: 'CASE_INVALID'
  };
  const reasonCodes = [...new Set([outcomeCode[outcome], ...bindingCodes, ...validationCodes, ...leakageCodes])].slice(0, 100);
  const digest = hashText(canonicalJson({ datasetDigest, index })).slice('sha256:'.length, 'sha256:'.length + 32);
  return {
    caseId: `evalcase_${digest}`,
    primaryCaseType,
    membership,
    releaseCounted: row.releaseCounted === true,
    releaseScored: row.releaseScored === true,
    expectedSkillIds,
    avoidSkillIds,
    recommendedSkillIds,
    avoidedButRecommendedSkillIds,
    top1Hit,
    top3Hit,
    abstained,
    advisoryBytes,
    outcome,
    reasonCodes,
    validationCodes,
    leakageCodes
  };
}

function resolveEvalSkillNames(value: unknown, effective: EffectiveRegistry, role: string, codes: string[]): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 500)) {
    codes.push(`${role}_SKILL_IDS_INVALID`);
    return [];
  }
  const result: string[] = [];
  for (const name of value as string[]) {
    const candidates = effective.skills.filter((skill) => skill.name === name);
    const canonicalId = effective.policy.version === 2 ? effective.policy.canonicalByName[name] : undefined;
    const canonical = canonicalId ? candidates.find((skill) => skill.skillId === canonicalId) : undefined;
    const routeEligible = candidates.filter((skill) => skill.routeEligible);
    const selected = canonical ?? (routeEligible.length === 1 ? routeEligible[0] : candidates.length === 1 ? candidates[0] : undefined);
    if (!selected) {
      codes.push(candidates.length > 1 ? `${role}_SKILL_ID_AMBIGUOUS` : `${role}_SKILL_ID_UNRESOLVED`);
      continue;
    }
    if (!result.includes(selected.skillId)) result.push(selected.skillId);
  }
  return result;
}

function evalValidationCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return ['VALIDATION_RESULT_INVALID'];
  const codes = value.slice(0, 100).map((item) => {
    const message = typeof item === 'string' ? item.toLowerCase() : '';
    if (message.includes('primarycasetype')) return 'PRIMARY_CASE_TYPE_INVALID';
    if (message.includes('membership')) return 'MEMBERSHIP_INVALID';
    if (message.includes('legacy') || message.includes('eval v2')) return 'LEGACY_CASE';
    if (message.includes('duplicates an earlier')) return 'DUPLICATE_PROMPT';
    if (message.includes('both expected and avoided')) return 'EXPECTED_AVOID_OVERLAP';
    if (message.includes('expected labels')) return 'EXPECTED_LABELS_DUPLICATE';
    if (message.includes('avoid labels')) return 'AVOID_LABELS_DUPLICATE';
    if (message.includes('expected skill is not')) return 'EXPECTED_SKILL_UNKNOWN';
    if (message.includes('avoid skill is not')) return 'AVOID_SKILL_UNKNOWN';
    if (message.includes('require at least')) return 'CASE_LABEL_COUNT_INVALID';
    if (message.includes('at most three')) return 'CASE_LABEL_COUNT_INVALID';
    if (message.includes('id must not be empty')) return 'CASE_ID_INVALID';
    return 'CASE_VALIDATION_ERROR';
  });
  return [...new Set(codes)];
}

function evalLeakageCodes(value: unknown): string[] {
  const leakage = objectRecord(value);
  const result: string[] = [];
  if (Array.isArray(leakage.matchedDisplayNames) && leakage.matchedDisplayNames.length > 0) result.push('DISPLAY_NAME_LEAKAGE');
  if (Array.isArray(leakage.matchedAliases) && leakage.matchedAliases.length > 0) result.push('ALIAS_LEAKAGE');
  if (Array.isArray(leakage.copiedDescriptions) && leakage.copiedDescriptions.length > 0) result.push('DESCRIPTION_LEAKAGE');
  if (leakage.hasLeakage === true && result.length === 0) result.push('TARGET_LEAKAGE');
  return result;
}

function evalCaseOutcome(input: {
  primaryCaseType: EvalCaseResultReceipt['primaryCaseType'];
  expectedSkillIds: string[];
  avoidedButRecommendedSkillIds: string[];
  top1Hit: boolean;
  top3Hit: boolean;
  abstained: boolean;
  invalid: boolean;
}): EvalCaseOutcome {
  if (input.invalid) return 'invalid';
  if (input.avoidedButRecommendedSkillIds.length > 0) return 'unsafe';
  if (input.primaryCaseType === 'negative-near-miss' && input.expectedSkillIds.length === 0 && input.abstained) return 'correct-abstention';
  if (input.top1Hit) return 'top1-hit';
  if (input.top3Hit) return 'top3-hit';
  return 'miss';
}

function projectCurrentEvalRun(job: JobV1 | undefined, report: unknown, rawReport: Record<string, unknown> | undefined, context: EvalReportProjectionContext): Record<string, unknown> {
  if (job) return projectEvalJobRun(job, report, rawReport, context);
  const reportRecord = objectRecord(report);
  if (!rawReport || reportRecord.present !== true) {
    return {
      runId: null,
      suiteId: null,
      jobId: null,
      state: 'not-run',
      expectedRevision: null,
      resultRevisionId: null,
      resultWorkspaceRevision: null,
      reportRevision: null,
      reportBinding: 'unavailable',
      reportArtifactDigest: null,
      reportEffectiveRevisionDigest: null,
      createdAt: null,
      startedAt: null,
      completedAt: null,
      errorCode: null,
      progress: { mode: 'unavailable', completedCases: null, totalCases: null, ratio: null },
      reportAvailable: false
    };
  }
  const count = boundedEvalReportCount(rawReport, reportRecord);
  const generatedAt = isoTimestampOrNull(rawReport.finishedAt ?? rawReport.generatedAt);
  const startedAt = isoTimestampOrNull(rawReport.startedAt ?? rawReport.generatedAt);
  const reportAvailable = context.bindingEligible;
  return {
    runId: evalRunIdentifier(rawReport, context.revision),
    suiteId: evalSuiteIdentifier(rawReport, reportRecord.datasetDigest),
    jobId: null,
    state: 'succeeded',
    expectedRevision: context.revision.revisionId,
    resultRevisionId: context.revision.revisionId,
    resultWorkspaceRevision: context.revision.workspaceRevision,
    reportRevision: reportAvailable ? context.revision : null,
    reportBinding: reportAvailable ? 'report-only' : 'unavailable',
    reportArtifactDigest: reportAvailable ? context.artifactDigest : null,
    reportEffectiveRevisionDigest: reportAvailable ? context.effectiveRevisionDigest : null,
    createdAt: generatedAt,
    startedAt,
    completedAt: generatedAt,
    errorCode: null,
    progress: reportAvailable
      ? { mode: 'determinate', completedCases: count, totalCases: count, ratio: count === null ? null : 1 }
      : { mode: 'unavailable', completedCases: null, totalCases: null, ratio: null },
    reportAvailable
  };
}

function projectEvalJobRun(job: JobV1, report: unknown, rawReport: Record<string, unknown> | undefined, context: EvalReportProjectionContext): Record<string, unknown> {
  const reportRecord = objectRecord(report);
  const resultReceipt = objectRecord(job.resultReceipt);
  const resultRevisionId = canonicalRevisionOrNull(resultReceipt.revisionId);
  const resultWorkspaceRevision = digestOrNull(resultReceipt.workspaceRevision);
  const resultReportDigest = digestOrNull(resultReceipt.evalReportDigest);
  const resultEffectiveRevisionDigest = digestOrNull(resultReceipt.evalEffectiveRevisionDigest);
  const resultRevisionBound = resultRevisionId === context.revision.revisionId
    && resultWorkspaceRevision === context.revision.workspaceRevision;
  const carriedForwardBound = resultRevisionId !== null
    && resultRevisionId !== context.revision.revisionId
    && resultReportDigest !== null
    && resultReportDigest === context.artifactDigest
    && resultEffectiveRevisionDigest !== null
    && resultEffectiveRevisionDigest === context.effectiveRevisionDigest;
  const reportBound = job.state === 'succeeded'
    && reportRecord.present === true
    && context.bindingEligible
    && (resultRevisionBound || carriedForwardBound);
  const reportBinding = reportBound
    ? (resultRevisionBound ? 'result-revision' : 'carried-forward')
    : 'unavailable';
  const totalCases = reportBound ? boundedEvalReportCount(rawReport, reportRecord) : null;
  return {
    runId: reportBound && rawReport ? evalRunIdentifier(rawReport, context.revision) : `evalrun_${job.jobId.replaceAll('-', '')}`,
    suiteId: reportBound && rawReport ? evalSuiteIdentifier(rawReport, reportRecord.datasetDigest) : evalSuiteId(reportRecord.datasetDigest),
    jobId: job.jobId,
    state: job.state,
    expectedRevision: job.expectedRevision,
    resultRevisionId,
    resultWorkspaceRevision,
    reportRevision: reportBound ? context.revision : null,
    reportBinding,
    reportArtifactDigest: reportBound ? context.artifactDigest : null,
    reportEffectiveRevisionDigest: reportBound ? context.effectiveRevisionDigest : null,
    createdAt: isoTimestampOrNull(job.createdAt),
    startedAt: isoTimestampOrNull(job.startedAt),
    completedAt: isoTimestampOrNull(job.completedAt),
    errorCode: machineCodeOrNull(job.error?.code, 80),
    progress: reportBound
      ? { mode: 'determinate', completedCases: totalCases, totalCases, ratio: totalCases === null ? null : 1 }
      : { mode: job.state === 'queued' || job.state === 'running' ? 'indeterminate' : 'unavailable', completedCases: null, totalCases: null, ratio: null },
    reportAvailable: reportBound
  };
}

function successfulJobResultReceipt(jobType: JobV1['type'], manifest: WorkspaceRevisionManifest, recoveredReceipt = false): Record<string, unknown> {
  const receipt: Record<string, unknown> = {
    revisionId: manifest.revisionId,
    workspaceRevision: manifest.workspaceRevision,
    jobType,
    ...(recoveredReceipt ? { recoveredReceipt: true } : {})
  };
  if (jobType === 'eval-run') {
    const report = manifest.artifacts.find((artifact) => artifact.path === 'eval-report.json');
    if (report) receipt.evalReportDigest = report.digest;
    if (manifest.effectiveRevisionDigest) receipt.evalEffectiveRevisionDigest = manifest.effectiveRevisionDigest;
  }
  return receipt;
}

function evalRunId(report: Record<string, unknown>, revision: RevisionRef): string {
  const digest = hashText(canonicalJson({ generatedAt: report.generatedAt, datasetDigest: report.datasetDigest, revisionId: revision.revisionId }));
  return `evalrun_${digest.slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function evalRunIdentifier(report: Record<string, unknown>, revision: RevisionRef): string {
  return report.kind === 'skillmap.eval-run' && report.schemaVersion === 3
    && typeof report.runId === 'string' && /^evalrun_[A-Za-z0-9_-]{8,80}$/.test(report.runId)
    ? report.runId
    : evalRunId(report, revision);
}

function evalSuiteIdentifier(report: Record<string, unknown>, datasetDigest: unknown): string | null {
  return report.kind === 'skillmap.eval-run' && report.schemaVersion === 3
    && typeof report.suiteId === 'string' && /^evalsuite_[A-Za-z0-9_-]{8,80}$/.test(report.suiteId)
    ? report.suiteId
    : evalSuiteId(datasetDigest);
}

function evalSuiteId(value: unknown): string | null {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
    ? `evalsuite_${value.slice('sha256:'.length, 'sha256:'.length + 32)}`
    : null;
}

function boundedEvalCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_EVAL_CASE_RESULTS ? value as number : null;
}

function boundedEvalReportCount(report: Record<string, unknown> | undefined, projection: Record<string, unknown>): number | null {
  const metrics = report?.kind === 'skillmap.eval-run' && report.schemaVersion === 3 ? objectRecord(report.metrics) : {};
  return boundedEvalCount(metrics.count ?? projection.count);
}

function evalReportEffectiveRevisionDigest(report: Record<string, unknown> | undefined): string | null {
  if (!report) return null;
  const revision = objectRecord(report.revision);
  return digestOrNull(report.kind === 'skillmap.eval-run' && report.schemaVersion === 3
    ? revision.effectiveRevisionDigest
    : report.effectiveRevisionDigest);
}

function projectEvalMetrics(rawReport: Record<string, unknown> | undefined, projection: unknown): { count: number; top1Rate: number; top3Rate: number; avoidHits: number } {
  const projected = objectRecord(projection);
  const metrics = rawReport?.kind === 'skillmap.eval-run' && rawReport.schemaVersion === 3
    ? objectRecord(rawReport.metrics)
    : projected;
  return {
    count: boundedEvalCount(metrics.count) ?? 0,
    top1Rate: evalRateOrZero(metrics.top1Rate),
    top3Rate: evalRateOrZero(metrics.top3Rate),
    avoidHits: Number.isSafeInteger(metrics.avoidHits) && (metrics.avoidHits as number) >= 0 && (metrics.avoidHits as number) <= 1_000_000
      ? metrics.avoidHits as number
      : 0
  };
}

function evalRateOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

function isoTimestampOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null;
}

function oneOfString<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  return typeof value === 'string' && values.includes(value) ? value as T[number] : undefined;
}

function evalEvidenceIssueCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 100).map((item) => {
    const issue = typeof item === 'string' ? item.toLowerCase() : '';
    if (issue.includes('file path') || issue.includes('external or uncontained')) return 'EVAL_DATASET_LOCATION_INVALID';
    if (issue.includes('recomputed') && issue.includes('digest')) return 'EVAL_RECOMPUTED_DIGEST_MISMATCH';
    if (issue.includes('dataset digest')) return 'EVAL_DATASET_DIGEST_INVALID';
    if (issue.includes('effective revision')) return 'EVAL_EFFECTIVE_REVISION_STALE';
    if (issue.includes('composition') || issue.includes('release-counted') || issue.includes('quota')) return 'EVAL_COMPOSITION_INCOMPLETE';
    if (issue.includes('holdout')) return 'EVAL_HOLDOUT_INCOMPLETE';
    if (issue.includes('leakage')) return 'EVAL_TARGET_LEAKAGE';
    if (issue.includes('provenance')) return 'EVAL_PROVENANCE_INCOMPLETE';
    if (issue.includes('baseline')) return 'EVAL_BASELINE_INCOMPLETE';
    if (issue.includes('fixture')) return 'EVAL_FIXTURE_ONLY';
    if (issue.includes('threshold') || issue.includes('metrics')) return 'EVAL_THRESHOLD_NOT_MET';
    if (issue.includes('invalid cases') || issue.includes('validation')) return 'EVAL_CASES_INVALID';
    if (issue.includes('report version') || issue.includes('evidence level') || issue.includes('release eligibility')) return 'EVAL_EVIDENCE_NOT_RELEASE';
    if (issue.includes('could not be recomputed') || issue.includes('unavailable')) return 'EVAL_RECOMPUTE_UNAVAILABLE';
    return 'EVAL_EVIDENCE_INVALID';
  }))];
}

function page<T>(values: T[], input: { cursor?: string; limit: number }, revision: RevisionRef, kind: string): { items: T[]; nextCursor: string | null; hasMore: boolean; limit: number } {
  const binding = hashText(canonicalJson({ kind, revisionId: revision.revisionId, values }));
  let offset = 0;
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded.binding !== binding || decoded.kind !== kind) throw new Error('Pagination cursor is stale or invalid.');
    offset = decoded.offset;
  }
  const items = values.slice(offset, offset + input.limit);
  const next = offset + items.length;
  return { items, nextCursor: next < values.length ? encodeCursor({ kind, binding, offset: next }) : null, hasMore: next < values.length, limit: input.limit };
}

function encodeCursor(body: { kind: string; binding: string; offset: number }): string { return Buffer.from(JSON.stringify({ ...body, digest: hashText(canonicalJson(body)) }), 'utf8').toString('base64url'); }
function decodeCursor(cursor: string): { kind: string; binding: string; offset: number } { let value: unknown; try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new Error('Pagination cursor is invalid.'); } if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pagination cursor is invalid.'); const record = value as Record<string, unknown>; const { digest, ...body } = record; if (typeof record.kind !== 'string' || typeof record.binding !== 'string' || !Number.isInteger(record.offset) || (record.offset as number) < 0 || digest !== hashText(canonicalJson(body))) throw new Error('Pagination cursor is invalid.'); return { kind: record.kind, binding: record.binding, offset: record.offset as number }; }
async function readOptionalJson<T>(file: string): Promise<T | undefined> { try { return await readJson<T>(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; return access(file).then(() => { throw error; }, () => undefined); } }
async function readSkillSourceContext(read: ApprovedWorkspaceRead, skill: EffectiveSkill): Promise<Record<string, unknown>> {
  const report = await readOptionalJson<{ records?: Array<Record<string, unknown>> }>(approvedArtifactPath(read, 'source-status.json'));
  const registry = await readOptionalJson<{ records?: Array<Record<string, unknown>> }>(approvedArtifactPath(read, 'sources.json'));
  const record = (registry?.records ?? []).find((candidate) => candidate.skillId === skill.skillId
    || candidate.skillId === undefined && candidate.skill === skill.name && candidate.localPath === skill.path);
  if (!record) {
    return {
      tracked: false,
      sourceType: null,
      state: 'not-tracked',
      checked: false,
      reviewable: false,
      risk: null,
      upstreamCommit: null,
      revisionBound: false
    };
  }
  const statusRecord = (report?.records ?? []).find((candidate) => sourceStatusMatchesRegistry(candidate, record));
  const source = objectRecord(record.source);
  const sourceType = source.type === 'local' || source.type === 'github' ? source.type : 'unknown';
  const state = statusRecord ? safeSourceState(statusRecord.state) : sourceType === 'local' ? 'local-authored' : 'unknown';
  const risk = statusRecord?.risk === 'low' || statusRecord?.risk === 'high' ? statusRecord.risk : null;
  return {
    tracked: true,
    sourceType,
    state,
    checked: Boolean(statusRecord),
    reviewable: Boolean(statusRecord) && !['external-clean', 'local-authored'].includes(state),
    risk,
    upstreamCommit: commitOrNull(statusRecord?.upstreamCommit ?? source.resolvedCommit),
    revisionBound: record.contentRevision === skill.contentRevision
  };
}

function readSkillPolicyContext(policy: Policy, skill: EffectiveSkill): Record<string, unknown> {
  const canonicalSkillId = policy.version === 2 && /^sk_[A-Za-z0-9_-]{43}$/.test(policy.canonicalByName[skill.name] ?? '')
    ? policy.canonicalByName[skill.name]
    : null;
  const configured = policy.version === 2
    ? Object.hasOwn(policy.skillsById, skill.skillId)
    : Object.hasOwn(policy.skills, skill.name);
  return {
    version: policy.version,
    configured,
    canonical: canonicalSkillId === skill.skillId,
    canonicalSkillId,
    tier: skill.tier,
    variantState: skill.variantState,
    routeMode: skill.routeEligible ? 'implicit-and-explicit' : skill.qualifiedExplicitAllowed ? 'qualified-explicit-only' : 'blocked'
  };
}

async function readSkillRouteHistory(cwd: string, skillId: string): Promise<Record<string, unknown>> {
  const page = await readRouteEvents(cwd, { limit: SKILL_DETAIL_ROUTE_SCAN_LIMIT });
  const matches = page.events.filter((event) => event.selectedSkillIds.includes(skillId));
  return {
    items: matches.slice(0, SKILL_DETAIL_ROUTE_LIMIT).map((event) => ({
      routeId: event.routeId,
      createdAt: event.createdAt,
      surface: event.surface,
      outcome: event.outcome,
      latencyBucket: event.latencyBucket,
      reasonCodes: event.reasonCodes.slice(0, 10),
      warningCodes: event.warningCodes.slice(0, 10),
      revisionId: event.revision.revisionId,
      promptStored: false
    })),
    limit: SKILL_DETAIL_ROUTE_LIMIT,
    scanLimit: SKILL_DETAIL_ROUTE_SCAN_LIMIT,
    scannedEvents: page.events.length,
    scanTruncated: page.nextCursor !== null,
    matchesTruncated: matches.length > SKILL_DETAIL_ROUTE_LIMIT
  };
}

function pointerRef(pointer: { workspaceId: string; revisionId: string; workspaceRevision: string; effectiveDigest: string | null; effectiveRevisionDigest: string | null }): RevisionRef { return { workspaceId: pointer.workspaceId, revisionId: pointer.revisionId, workspaceRevision: pointer.workspaceRevision, effectiveDigest: pointer.effectiveDigest, effectiveRevisionDigest: pointer.effectiveRevisionDigest }; }
function stateUnavailable(code: string): Error { const error = new Error('Approved workspace state is unavailable.'); error.name = 'ApprovedStateUnavailableError'; Object.assign(error, { code }); return error; }
function safeJobMessage(error: unknown): string {
  if (error instanceof WorkspaceStateConflictError) return 'The workspace revision changed before this isolated job could publish. Retry against the current revision.';
  if (error instanceof WorkspaceStateError) {
    if (error.code === 'STATE_LEGACY_CANONICAL_DIVERGENCE') return 'Canonical workspace projections diverged; review or repair local state before retrying.';
    if (error.code === 'STATE_REPAIR_REQUIRED') return 'The current workspace revision requires explicit recovery before this job can run.';
    if (error.code === 'JOB_OUTPUT_UNEXPECTED' || error.code === 'JOB_OUTPUT_MISSING') return 'The isolated command produced an unexpected artifact set and nothing was published.';
  }
  return 'The isolated job failed before publication. Review local diagnostics and retry against the current revision.';
}
function stringOrNull(value: unknown): string | null { return typeof value === 'string' ? value.slice(0, 256) : null; }
function digestOrNull(value: unknown): string | null { return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value) ? value : null; }
function commitOrNull(value: unknown): string | null { return typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value) ? value : null; }
function finiteOrZero(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function safeAggregate(value: unknown): Record<string, number | boolean | string | null> | null { if (!value || typeof value !== 'object' || Array.isArray(value)) return null; const result: Record<string, number | boolean | string | null> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean' || typeof item === 'string' && item.length <= 128 || item === null) result[key] = item as number | boolean | string | null; return result; }
function routingApprovalCandidate(value: unknown): boolean { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const validation = (value as { policyValidation?: { duplicateInventoryNameGroups?: unknown[]; invalidCanonicalDecisions?: unknown[] } }).policyValidation; return Boolean(validation && (validation.duplicateInventoryNameGroups?.length ?? 0) === 0 && (validation.invalidCanonicalDecisions?.length ?? 0) === 0); }
function objectRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const SOURCE_STATES = ['external-clean', 'external-modified', 'external-stale', 'external-risky-update', 'local-authored', 'local-modified', 'unknown'] as const;
function safeSourceState(value: unknown): typeof SOURCE_STATES[number] {
  return typeof value === 'string' && (SOURCE_STATES as readonly string[]).includes(value) ? value as typeof SOURCE_STATES[number] : 'unknown';
}
function freezeEvalExecutionContext(context: EvalRunV3ExecutionContext): EvalRunV3ExecutionContext {
  const approvedRevision = objectRecord(context.approvedRevision);
  const approvedBaselineRevision = context.approvedBaselineRevision === null
    ? null
    : Object.freeze({ ...objectRecord(context.approvedBaselineRevision) });
  return Object.freeze({
    approvedRevision: Object.freeze({ ...approvedRevision }),
    effectiveArtifact: context.effectiveArtifact,
    baselineEffectiveArtifact: context.baselineEffectiveArtifact,
    approvedBaselineRevision
  });
}
function sourceStatusMatchesRegistry(status: Record<string, unknown>, registry: Record<string, unknown>): boolean {
  if (status.skillId !== registry.skillId || status.localPath !== registry.localPath
    || status.contentRevision !== registry.contentRevision || status.installedHash !== registry.installedHash) return false;
  const left = objectRecord(status.source);
  const right = objectRecord(registry.source);
  if (left.type !== right.type) return false;
  if (left.type === 'local') return left.path === right.path;
  if (left.type === 'github') {
    return left.repo === right.repo && left.path === right.path && left.ref === right.ref
      && left.resolvedCommit === right.resolvedCommit
      && left.installedManifestDigest === right.installedManifestDigest
      && left.rootTreeDigest === right.rootTreeDigest
      && left.upstreamContentRevision === right.upstreamContentRevision;
  }
  return left.type === 'unknown';
}
function boundedSummaryCount(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) throw new WorkspaceStateError(code, 'Policy preview returned an invalid bounded summary.');
  return value as number;
}
function numericSummary(value: unknown, code: string): { skills: number; routeEligible: number; edges: number } {
  const record = objectRecord(value);
  return {
    skills: boundedSummaryCount(record.skills, code),
    routeEligible: boundedSummaryCount(record.routeEligible, code),
    edges: boundedSummaryCount(record.edges, code)
  };
}
function effectiveRegistrySummary(value: unknown, code: string): { skills: number; routeEligible: number; edges: number } {
  const record = objectRecord(value);
  const skills = Array.isArray(record.skills) ? record.skills : undefined;
  const graph = objectRecord(record.graph);
  const edges = Array.isArray(graph.edges) ? graph.edges : undefined;
  if (!skills || !edges || skills.length > 1_000_000 || edges.length > 1_000_000) throw new WorkspaceStateError(code, 'Current effective registry cannot be summarized safely.');
  return { skills: skills.length, routeEligible: skills.filter((item) => objectRecord(item).routeEligible === true).length, edges: edges.length };
}
function policyPreviewWarningCodes(output: Record<string, unknown>): string[] {
  const validation = objectRecord(output.policyValidation);
  const codes = new Set<string>();
  if (Array.isArray(validation.unmatchedEntries) && validation.unmatchedEntries.length) codes.add('POLICY_UNMATCHED_ENTRIES');
  if (Array.isArray(validation.duplicateInventoryNameGroups) && validation.duplicateInventoryNameGroups.length) codes.add('POLICY_DUPLICATE_NAMES');
  if (Array.isArray(validation.invalidCanonicalDecisions) && validation.invalidCanonicalDecisions.length) codes.add('POLICY_CANONICAL_DECISION_INVALID');
  if (Array.isArray(output.warnings) && output.warnings.some((item) => typeof item === 'string' && /fixture/i.test(item))) codes.add('POLICY_FIXTURE_ROOTS');
  return [...codes].slice(0, 20);
}
function boundedSourceDiffReceipt(output: unknown, skillId: string, revision: RevisionRef): Record<string, unknown> {
  const record = objectRecord(output);
  const source = objectRecord(record.record);
  const rawDiff = objectRecord(record.diff);
  const state = safeSourceState(source.state);
  const rawLines = Array.isArray(rawDiff.lines) ? rawDiff.lines : [];
  const lines = rawLines.slice(0, 120).flatMap((value) => {
    const line = objectRecord(value);
    if ((line.kind !== 'local' && line.kind !== 'upstream') || !Number.isSafeInteger(line.line) || (line.line as number) < 1 || typeof line.text !== 'string') return [];
    return [{ kind: line.kind, line: line.line as number, text: line.text.slice(0, 500) }];
  });
  const count = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000 ? value as number : 0;
  return {
    skillId,
    state,
    risk: source.risk === 'low' || source.risk === 'high' ? source.risk : null,
    upstreamCommit: commitOrNull(source.upstreamCommit),
    diff: {
      additions: count(rawDiff.additions),
      deletions: count(rawDiff.deletions),
      changedLines: count(rawDiff.changedLines),
      truncated: rawDiff.truncated === true || rawLines.length > lines.length,
      lines
    },
    promptStored: false,
    persisted: false,
    revision
  };
}
function jobActor(jobId: string): string { return `local-job:${jobId}`; }
function cancellationReceipt(record: JobCancellationRecord, cancelledFrom: 'queued' | 'running'): Record<string, unknown> {
  return { cancellationDigest: record.idempotencyDigest, cancelledFrom, publicationPrevented: true };
}
function machineCodeOrNull(value: unknown, maximum: number): string | null { return typeof value === 'string' && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null; }
function canonicalRevisionOrNull(value: unknown): string | null { return typeof value === 'string' && /^r[0-9]{20}-[0-9a-f-]{36}$/i.test(value) ? value : null; }
function encodeRevisionCursor(currentRevisionId: string, nextRevisionId: string): string {
  const payload = { version: 1, currentRevisionId, nextRevisionId };
  return Buffer.from(JSON.stringify({ ...payload, digest: hashText(canonicalJson(payload)) }), 'utf8').toString('base64url');
}
function decodeRevisionCursor(cursor: string): { currentRevisionId: string; nextRevisionId: string } {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new WorkspaceStateError('STATE_REVISION_CURSOR_INVALID', 'Revision history cursor is invalid.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkspaceStateError('STATE_REVISION_CURSOR_INVALID', 'Revision history cursor is invalid.');
  const record = value as Record<string, unknown>;
  const { digest, ...payload } = record;
  if (Object.keys(record).sort().join(',') !== 'currentRevisionId,digest,nextRevisionId,version'
    || record.version !== 1
    || !canonicalRevisionOrNull(record.currentRevisionId)
    || !canonicalRevisionOrNull(record.nextRevisionId)
    || typeof digest !== 'string'
    || digest !== hashText(canonicalJson(payload))) {
    throw new WorkspaceStateError('STATE_REVISION_CURSOR_INVALID', 'Revision history cursor is invalid or stale.');
  }
  return { currentRevisionId: record.currentRevisionId as string, nextRevisionId: record.nextRevisionId as string };
}

function assertExpectedJobArtifacts(before: Array<{ path: string; digest: string }>, after: SnapshotArtifact[], parameters: JobParameters): void {
  const policy = jobArtifactPolicy(parameters);
  assertChangedArtifacts(before, after, policy.allowed, policy.required, `job ${parameters.type}`);
}

function assertChangedArtifacts(
  before: Array<{ path: string; digest: string }>,
  after: SnapshotArtifact[],
  allowed: Set<string>,
  required: string[],
  label: string
): void {
  const previous = new Map(before.map((artifact) => [artifact.path, artifact.digest]));
  const next = new Map(after.map((artifact) => [artifact.path, artifact.digest]));
  const changed = new Set<string>();
  for (const artifactPath of new Set([...previous.keys(), ...next.keys()])) {
    if (previous.get(artifactPath) !== next.get(artifactPath)) changed.add(artifactPath);
  }
  const unexpected = [...changed].filter((artifactPath) => !allowed.has(artifactPath)).sort();
  if (unexpected.length) throw new WorkspaceStateError('JOB_OUTPUT_UNEXPECTED', `${label} changed non-allowlisted artifact(s): ${unexpected.join(', ')}.`);
  const missing = required.filter((artifactPath) => !next.has(artifactPath));
  if (missing.length) throw new WorkspaceStateError('JOB_OUTPUT_MISSING', `${label} did not produce required artifact(s): ${missing.join(', ')}.`);
  const unchanged = required.filter((artifactPath) => !changed.has(artifactPath));
  if (unchanged.length) throw new WorkspaceStateError('JOB_OUTPUT_UNCHANGED', `${label} did not freshly produce required artifact(s): ${unchanged.join(', ')}.`);
}

function jobArtifactPolicy(parameters: JobParameters): { allowed: Set<string>; required: string[] } {
  if (parameters.type === 'scan') return artifactPolicy(['identity.json', 'identity-migrations.json', 'inventory.json'], ['inventory.json']);
  if (parameters.type === 'doctor') return artifactPolicy(['doctor.json', 'reports/doctor.md'], ['doctor.json', 'reports/doctor.md']);
  if (parameters.type === 'doctor-pack') {
    const pack = parameters.summary ? 'doctor-pack.summary.md' : 'doctor-pack.md';
    return artifactPolicy(['doctor.json', 'reports/doctor.md', pack], ['doctor.json', 'reports/doctor.md', pack]);
  }
  if (parameters.type === 'graph-build') {
    const files = parameters.mode === 'raw' ? ['graph.raw.json', 'graph.raw.mmd'] : ['skillgraph.json', 'skillgraph.mmd'];
    return artifactPolicy(files, files);
  }
  if (parameters.type === 'eval-run') return artifactPolicy(['eval-report.json'], ['eval-report.json']);
  if (parameters.type === 'sources-check') return artifactPolicy(['sources.json', 'source-status.json'], ['source-status.json']);
  throw new WorkspaceStateError('JOB_TYPE_UNSUPPORTED', 'Generic job type is not allowlisted.');
}

function assertNoStagingPath(artifacts: SnapshotArtifact[], stage: string): void {
  const canaries = [stage, path.dirname(stage), `${path.sep}job-staging${path.sep}`];
  for (const artifact of artifacts) {
    const text = artifact.content.toString('utf8');
    if (canaries.some((canary) => text.includes(canary))) {
      throw new WorkspaceStateError('JOB_OUTPUT_STAGING_PATH', 'Isolated job output retained a staging path and nothing was published.');
    }
  }
}

function artifactPolicy(allowed: string[], required: string[]): { allowed: Set<string>; required: string[] } {
  return { allowed: new Set(allowed), required };
}

async function normalizeStagedPolicyBinding(stage: string, realWorkspace: string): Promise<void> {
  const effectivePath = path.join(stage, '.skillmap', 'effective.json');
  const effective = await readJson<Record<string, unknown>>(effectivePath);
  const inputs = effective.inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new WorkspaceStateError('POLICY_BINDING_INVALID', 'Applied policy output has no exact input binding.');
  const record = inputs as Record<string, unknown>;
  if (typeof record.policySource !== 'string') throw new WorkspaceStateError('POLICY_BINDING_INVALID', 'Applied policy output has no exact policy source.');
  const stagedRoot = path.resolve(stage, '.skillmap');
  const source = path.resolve(record.policySource);
  const relative = path.relative(stagedRoot, source);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new WorkspaceStateError('POLICY_BINDING_INVALID', 'Reviewed policy source escaped the isolated workspace.');
  record.policySource = path.join(realWorkspace, '.skillmap', relative);
  await writeJson(effectivePath, effective);
}
async function fileExists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }
async function workspaceLstat(file: string, code: string, message: string): Promise<BigIntStats> {
  try { return await lstat(file, { bigint: true }); } catch (error) { throw new WorkspaceStateError(code, message, { cause: error }); }
}
async function workspaceRealpath(file: string, code: string, message: string): Promise<string> {
  try { return await realpath(file); } catch (error) { throw new WorkspaceStateError(code, message, { cause: error }); }
}
export function workspaceFilesystemIdentity(
  stats: Pick<BigIntStats, 'dev' | 'ino'>,
  code: string,
  message: string
): { device: string; inode: string } {
  if (stats.dev < 0n || stats.ino < 0n) {
    throw new WorkspaceStateError(code, message);
  }
  return { device: stats.dev.toString(10), inode: stats.ino.toString(10) };
}
async function assertWorkspacePathAbsent(file: string, code: string, message: string): Promise<void> {
  try {
    await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new WorkspaceStateError(code, message, { cause: error });
  }
  throw new WorkspaceStateError(code, message);
}
function workspaceErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
}
function safeStateCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^STATE_[A-Z0-9_]+$/.test(code)) return code;
  }
  return 'STATE_UNAVAILABLE';
}
function manualRepairBootstrap(error: unknown): Record<string, unknown> {
  return {
    state: 'manual-repair-required',
    initialized: true,
    routingReady: false,
    productReady: false,
    recoverable: false,
    errorCode: safeStateCode(error),
    nextAction: 'state-status',
    guidance: 'Run skillmap state status --json. Automatic recovery is available only for derived-only corruption with an eligible last-known-good revision; marker, pointer, manifest, canonical, and raw-state faults require manual repair or restore.'
  };
}
function resolveOperatorPath(cwd: string, candidate: string): string {
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.includes('\0') || Buffer.byteLength(candidate, 'utf8') > 4096) {
    throw new WorkspaceStateError('WORKSPACE_CANDIDATE_INVALID', 'Workspace candidate must be a bounded local path.');
  }
  return path.resolve(cwd, candidate.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
}
async function workspaceIdOrNull(cwd: string): Promise<string | null> {
  try { return (await openApprovedWorkspaceRead(cwd, 'status')).currentRevision.workspaceId; } catch { /* Uninitialized/partial workspaces may not have a revision. */ }
  try { return (await readWorkspaceIdentity(cwd))?.workspaceId ?? null; } catch { return null; }
}
async function asBackendRecord(value: Promise<unknown>): Promise<Record<string, unknown>> {
  const resolved = await value;
  return resolved && typeof resolved === 'object' && !Array.isArray(resolved) ? resolved as Record<string, unknown> : {};
}
function redactLocalText(cwd: string, value: string): string {
  return value
    .replaceAll(path.resolve(cwd), '$PROJECT')
    .replace(/(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]+/g, '$1$ABS_PATH')
    .replace(/(^|[\s("'=:])[A-Za-z]:\\[^\s"'<>),;]+/g, '$1$ABS_PATH')
    .replace(/(^|[\s("'=:])\\\\[^\s"'<>),;]+/g, '$1$ABS_PATH');
}
function persistedPolicyDecisionDigest(value: unknown): string {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const decision = record.decision && typeof record.decision === 'object' && !Array.isArray(record.decision) ? record.decision as Record<string, unknown> : {};
  if (typeof decision.decisionDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(decision.decisionDigest)) {
    throw new WorkspaceStateError('POLICY_RECEIPT_INVALID', 'Persisted policy decision did not produce a hash-bound receipt.');
  }
  return decision.decisionDigest;
}
function persistedSourceReviewDigest(value: unknown): string {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const record = result.record && typeof result.record === 'object' && !Array.isArray(result.record) ? result.record as Record<string, unknown> : {};
  const binding = {
    skillId: typeof record.skillId === 'string' ? record.skillId : null,
    contentRevision: digestOrNull(record.contentRevision),
    appliesToState: typeof record.appliesToState === 'string' ? record.appliesToState : null,
    decision: typeof record.decision === 'string' ? record.decision : null,
    currentHash: digestOrNull(record.currentHash),
    upstreamHash: digestOrNull(record.upstreamHash),
    upstreamManifestDigest: digestOrNull(record.upstreamManifestDigest),
    upstreamCommit: commitOrNull(record.upstreamCommit),
    upstreamContentRevision: digestOrNull(record.upstreamContentRevision),
    reasonDigest: typeof record.reason === 'string' && record.reason.trim() ? hashText(record.reason) : null,
    reviewedAt: typeof record.reviewedAt === 'string' && Number.isFinite(Date.parse(record.reviewedAt)) ? record.reviewedAt : null
  };
  if (!binding.skillId || !binding.contentRevision || !binding.appliesToState || !binding.decision || !binding.reasonDigest || !binding.reviewedAt) {
    throw new WorkspaceStateError('SOURCE_REVIEW_RECEIPT_INVALID', 'Persisted source review did not bind the reviewed content and source state.');
  }
  return hashText(canonicalJson(binding));
}
