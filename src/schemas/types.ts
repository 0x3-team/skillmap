export type SkillTier = 'active-default' | 'specialist' | 'explicit-only' | 'archived' | 'blocked';

export type SkillIdentityVersion = 1;

export interface ApprovedRootRecord {
  rootId: string;
  configuredPath: string;
  realPath: string;
  approvedAt: string;
}

export interface WorkspaceIdentityRegistry {
  version: 1;
  identityVersion: SkillIdentityVersion;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  roots: ApprovedRootRecord[];
}

export type IdentityIssueCode = 'skill-id-collision' | 'normalized-path-collision' | 'physical-path-collision' | 'pending-skill-move' | 'ambiguous-skill-move' | 'incomplete-root-set';

export interface IdentityIssue {
  code: IdentityIssueCode;
  message: string;
  skillIds: string[];
  rootIds: string[];
  relativePaths: string[];
  fromSkillId?: string;
  toSkillId?: string;
  displayName?: string;
  contentRevision?: string;
}

export interface SkillRecord {
  /** Compatibility alias for consumers that have not moved to skillId yet. */
  id: string;
  skillId: string;
  identityVersion: SkillIdentityVersion;
  rootId: string;
  relativePath: string;
  contentRevision: string;
  name: string;
  description: string;
  path: string;
  root: string;
  scope: 'user' | 'project' | 'plugin' | 'fixture' | 'unknown';
  clientHints: string[];
  source: 'filesystem';
  frontmatterValid: boolean;
  frontmatterErrors: string[];
  implicitAllowed: boolean;
  hasScripts: boolean;
  scriptPaths: string[];
  referenceCount: number;
  assetCount: number;
  bodyBytes: number;
  descriptionBytes: number;
  mtime: string;
  hash: string;
}

export interface Inventory {
  version: 1 | 2;
  identityVersion: SkillIdentityVersion;
  workspaceId: string;
  generatedAt: string;
  cwd: string;
  roots: string[];
  rootRecords: ApprovedRootRecord[];
  skills: SkillRecord[];
  identityIssues: IdentityIssue[];
  warnings: string[];
}

export interface DoctorFinding {
  id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  skills: string[];
  evidence: string;
  recommendation: string;
}

export interface DoctorReport {
  version: 1;
  generatedAt: string;
  inventoryPath?: string;
  summary: {
    skillCount: number;
    duplicateNameCount: number;
    scriptBearingCount: number;
    findingCount: number;
  };
  findings: DoctorFinding[];
}

export interface SkillPolicyEntry {
  tier?: SkillTier;
  family?: string;
  aliases?: string[];
  preferred_for?: string[];
  avoid_for?: string[];
  overlaps?: string[];
  supersedes?: string[];
  notes?: string;
}

export interface PolicyV1 {
  version: 1;
  skills: Record<string, SkillPolicyEntry>;
}

export interface PolicyComparedVariant {
  skillId: string;
  contentRevision: string;
}

export interface DuplicateDecision {
  version: 1;
  displayName: string;
  selectedSkillId: string;
  comparedVariants: PolicyComparedVariant[];
  actor: string;
  reason: string;
  decidedAt: string;
  decisionDigest: string;
}

export interface PolicyMigration {
  version: 1;
  sourcePolicyVersion: 1;
  sourcePolicyDigest: string;
  migrationVersion: number;
  migratedAt: string;
  unresolvedNames: string[];
  unresolvedEntries: Record<string, SkillPolicyEntry>;
  rollbackArtifact: string;
  rollbackDigest: string;
}

export interface PolicyV2 {
  version: 2;
  canonicalByName: Record<string, string>;
  skillsById: Record<string, SkillPolicyEntry>;
  duplicateDecisions: Record<string, DuplicateDecision>;
  migration: PolicyMigration;
}

export type Policy = PolicyV1 | PolicyV2;

export type SkillVariantState = 'unique' | 'canonical' | 'shadowed-duplicate' | 'unresolved-duplicate';

export interface EffectiveSkill extends SkillRecord {
  tier: SkillTier;
  family?: string;
  aliases: string[];
  preferredFor: string[];
  avoidFor: string[];
  overlaps: string[];
  supersedes: string[];
  notes?: string;
  routeEligible: boolean;
  qualifiedExplicitAllowed: boolean;
  variantState: SkillVariantState;
  effectiveReasons: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  source: 'scan' | 'policy' | 'doctor' | 'source' | 'curation' | 'eval';
  confidence: number;
}

export interface SkillGraph {
  version: 1;
  generatedAt: string;
  mode: 'raw' | 'effective';
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: GraphEdge[];
}

export interface EffectiveRegistry {
  version: 1 | 2;
  generatedAt: string;
  inputs?: {
    inventoryDigest: string;
    policyDigest: string;
    policySource: string;
    policySelection: 'active' | 'explicit';
  };
  inventory: Inventory;
  policy: Policy;
  skills: EffectiveSkill[];
  graph: SkillGraph;
}

export interface RouteCandidate {
  skillId: string;
  name: string;
  score: number;
  tier: SkillTier;
  family?: string;
  path: string;
  reasons: string[];
}

export interface RouteExclusion {
  skillId?: string;
  name: string;
  reason: string;
}

export interface RouteResult {
  version: 1;
  generatedAt: string;
  prompt: string;
  recommendations: RouteCandidate[];
  exclusions: RouteExclusion[];
  hookText: string;
}

export type EvalPrimaryCaseType = 'explicit' | 'implicit-natural' | 'multi-skill' | 'negative-near-miss';
export type EvalMembership = 'train' | 'holdout';
export type EvalDeduplicationResult = 'passed' | 'failed' | 'not-run';
export type EvalEvidenceLevel = 'demo' | 'smoke' | 'candidate' | 'release';

export interface EvalDatasetProvenance {
  labelAuthor: string;
  sourceClass: string;
  createdAt: string;
  reviewedAt: string;
  deduplicationResult: EvalDeduplicationResult;
  holdoutFrozen: boolean;
  /**
   * Optional author-declared digest. Eval reports always contain the computed
   * dataset digest; when this value is supplied it must match that digest.
   */
  datasetDigest?: string;
}

export interface EvalBaseline {
  top1Rate: number;
  top3Rate: number;
  avoidHits: number;
  abstentionRate: number;
  meanAdvisoryBytes: number;
}

export interface EvalCase {
  id?: string;
  prompt: string;
  expected: string[];
  avoid?: string[];
  primaryCaseType?: EvalPrimaryCaseType;
  membership?: EvalMembership;
}

/**
 * The optional fields keep legacy fixture suites readable. Only version 2
 * suites with complete provenance, baseline, typed cases, and holdout evidence
 * can become release evidence.
 */
export interface EvalSuite {
  version?: 1 | 2;
  provenance?: EvalDatasetProvenance;
  baseline?: EvalBaseline;
  evals: EvalCase[];
}

export interface EvalComposition {
  total: number;
  explicit: number;
  implicitNatural: number;
  multiSkill: number;
  negativeNearMiss: number;
  untyped: number;
  releaseCounted: number;
  releaseScored: number;
}

export interface EvalLeakageResult {
  pass: boolean;
  count: number;
  cases: Array<{
    index: number;
    id?: string;
    expectedNames: string[];
    matchedDisplayNames: string[];
    matchedAliases: string[];
    copiedDescriptions: string[];
  }>;
}

export interface EvalHoldoutResult {
  count: number;
  requiredCount: number;
  ratio: number;
  pass: boolean;
}

export interface EvalProvenanceResult {
  provided: boolean;
  complete: boolean;
  issues: string[];
  labelAuthor?: string;
  sourceClass?: string;
  createdAt?: string;
  reviewedAt?: string;
  deduplicationResult?: EvalDeduplicationResult;
  holdoutFrozen?: boolean;
  declaredDatasetDigest?: string;
  datasetDigestMatches?: boolean;
}

export interface EvalBaselineComparison {
  provided: boolean;
  nonRegression: boolean;
  improvement: boolean;
  perfectBaseline: boolean;
  pass: boolean;
  improvements: string[];
  regressions: string[];
}

export interface EvalRunRow {
  id?: string;
  prompt: string;
  expected: string[];
  avoid: string[];
  primaryCaseType?: EvalPrimaryCaseType;
  membership?: EvalMembership;
  releaseCounted: boolean;
  releaseScored: boolean;
  recommended: string[];
  avoidedButRecommended: string[];
  validationErrors: string[];
  leakage: Omit<EvalLeakageResult['cases'][number], 'index' | 'id' | 'expectedNames'> & { hasLeakage: boolean };
  hookText: string;
}

export interface EvalRunReport {
  version: 2;
  generatedAt: string;
  evalFile: string;
  fixture: boolean;
  evidenceLevel: EvalEvidenceLevel;
  releaseEvidenceEligible: boolean;
  thresholdPass: boolean;
  pass: boolean;
  datasetDigest: string;
  effectiveRevisionDigest: string;
  composition: EvalComposition;
  holdout: EvalHoldoutResult;
  leakage: EvalLeakageResult;
  provenance: EvalProvenanceResult;
  baselineComparison: EvalBaselineComparison;
  count: number;
  top1: number;
  top3: number;
  avoidHits: number;
  top1Rate: number;
  top3Rate: number;
  abstentionRate: number;
  meanAdvisoryBytes: number;
  regression: {
    scoredCount: number;
    top1: number;
    top3: number;
    top1Rate: number;
    top3Rate: number;
  };
  invalidCaseCount: number;
  validationErrors: string[];
  confidence: {
    level: string;
    count: number;
    releaseReady: boolean;
    message: string;
  };
  minCount: number;
  minTop1: number;
  minTop3: number;
  maxAvoidHits: number;
  summary: string;
  rows: EvalRunRow[];
}

/**
 * A revision receipt is the common identity carried by every trusted runtime
 * surface. `revisionId` is monotonic publication identity; the digests bind
 * the semantic workspace and effective routing model.
 */
export interface RevisionRef {
  workspaceId: string;
  revisionId: string;
  workspaceRevision: string;
  effectiveDigest: string | null;
  effectiveRevisionDigest: string | null;
}

export type RouteWarningState = 'none' | 'degraded' | 'blocked';
export type RouteServingMode = 'current' | 'last-known-good';

export interface RouteDecisionCandidate {
  skillId: string;
  displayName: string;
  score: number;
  tier: SkillTier;
  reasonCodes: string[];
}

export interface RouteDecisionExclusion {
  skillId?: string;
  displayName: string;
  reasonCode: string;
}

/** Deterministic, prompt-free payload shared by CLI, hook, MCP, and HTTP. */
export interface RouteDecisionV2 {
  kind: 'skillmap.route-decision';
  schemaVersion: 2;
  revision: RevisionRef;
  servingMode: RouteServingMode;
  recommendations: RouteDecisionCandidate[];
  exclusions: RouteDecisionExclusion[];
  hookText: string;
  warningState: RouteWarningState;
  warningCodes: string[];
}

/** Operational wrapper. Raw prompt text and local paths are intentionally absent. */
export interface RouteResultV2 {
  kind: 'skillmap.route-result';
  schemaVersion: 2;
  routeId: string;
  createdAt: string;
  promptStored: false;
  decision: RouteDecisionV2;
  decisionDigest: string;
  latencyMs: number;
}

export type RouteSurface = 'cli' | 'hook' | 'mcp' | 'api';
export type RouteOutcome = 'recommended' | 'abstained' | 'blocked' | 'error';

export interface RouteEventV1 {
  kind: 'skillmap.route-event';
  schemaVersion: 1;
  eventId: string;
  routeId: string;
  createdAt: string;
  revision: RevisionRef;
  currentRevision: RevisionRef;
  surface: RouteSurface;
  outcome: RouteOutcome;
  selectedSkillIds: string[];
  reasonCodes: string[];
  warningCodes: string[];
  latencyBucket: 'lt-10ms' | 'lt-50ms' | 'lt-250ms' | 'gte-250ms';
  degradedCode?: string;
  decisionDigest?: string;
  promptStored: false;
  payloadDigest: string;
}

export interface RouteFeedbackV1 {
  kind: 'skillmap.route-feedback';
  schemaVersion: 1;
  feedbackId: string;
  routeId: string;
  createdAt: string;
  revision: RevisionRef;
  outcome: 'correct' | 'wrong' | 'missing' | 'unsafe';
  selectedSkillIds: string[];
  expectedSkillIds: string[];
  unsafeSkillIds: string[];
  reasonCode: 'operator-correct' | 'operator-wrong' | 'operator-missing' | 'operator-unsafe';
  idempotencyKeyHash: string;
  promptStored: false;
  commentStored: false;
  payloadDigest: string;
}

export type JobType =
  | 'scan'
  | 'doctor'
  | 'doctor-pack'
  | 'graph-build'
  | 'eval-run'
  | 'sources-check';

export type JobParameters =
  | { type: 'scan' }
  | { type: 'doctor' }
  | { type: 'doctor-pack'; summary: boolean }
  | { type: 'graph-build'; mode: 'raw' | 'effective' }
  | { type: 'eval-run' }
  | { type: 'sources-check' };

export interface JobRequestV1 {
  kind: 'skillmap.job-request';
  schemaVersion: 1;
  expectedRevision: string;
  idempotencyKey: string;
  requestedBy: 'local-operator' | 'cli' | 'api';
  confirmation: 'none';
  parameters: JobParameters;
}

export interface JobV1 {
  kind: 'skillmap.job';
  schemaVersion: 1;
  jobId: string;
  type: JobType;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  expectedRevision: string;
  idempotencyKey: string;
  requestDigest: string;
  confirmation: 'none';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  resultReceipt?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
}

export interface ApiSuccessEnvelope<T> {
  kind: 'skillmap.api-response';
  schemaVersion: 1;
  ok: true;
  requestId: string;
  servingRevision: RevisionRef | null;
  currentRevision: RevisionRef | null;
  compatibility: 'compatible' | 'degraded' | 'upgrade-required' | 'client-too-new' | 'incompatible';
  data: T;
}

export interface ApiErrorEnvelope {
  kind: 'skillmap.api-response';
  schemaVersion: 1;
  ok: false;
  requestId: string;
  servingRevision: RevisionRef | null;
  currentRevision: RevisionRef | null;
  compatibility: 'compatible' | 'degraded' | 'upgrade-required' | 'client-too-new' | 'incompatible';
  error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;
