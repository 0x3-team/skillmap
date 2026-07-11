export type SnapshotMode = "release-ready" | "attention-required";
export type ConnectorState = "online" | "offline" | "blocked" | "unauthorized";
export type DashboardSourceType = "fixture" | "local-snapshot";
export type DashboardView = "local-snapshot" | SnapshotMode;
export type SnapshotIntegrityState =
  | "verified"
  | "legacy-unverified"
  | "failed"
  | "not-applicable";
export type SkillTier = "core" | "preferred" | "optional" | "fallback" | "blocked";
export type SourceState =
  | "clean"
  | "modified"
  | "stale"
  | "risky"
  | "unknown"
  | "error"
  | "local";
export type ReviewStatus = "none" | "reviewed" | "held" | "needs-review";
export type EvalConfidence = "none" | "demo" | "weak" | "alpha" | "release";

export interface StatusSummary {
  verdict: "ok" | "attention-required" | "blocked";
  label: string;
  summary: string;
  warnings: string[];
  nextActions: string[];
}

export interface TokenSavingsMetrics {
  fullBodyTokens?: number;
  catalogTokens?: number;
  hookTokensMean?: number;
  tokensAvoidedVsBodies?: number;
  tokensAvoidedVsCatalog?: number;
  sampleSize: number;
  method: "prior-audit" | "workspace-estimate" | "eval-report" | "unknown";
  computedAt: string;
}

export interface ProductivityMetrics {
  routeCount: number;
  top1Rate?: number;
  top3Rate?: number;
  avoidHits?: number;
  evalConfidence: EvalConfidence;
  releaseReady: boolean;
  avgRecommendations?: number;
  avgHookChars?: number;
}

export interface ConnectorStatus {
  state: ConnectorState;
  cliVersion?: string;
  cwdAlias?: string;
  lastSeenAt?: string;
  lastSnapshotHash?: string;
  redactionEnabled: boolean;
  readOnlyMode: boolean;
  allowedCommands: string[];
  nextCommand?: string;
  message: string;
}

export interface SkillTableRow {
  id: string;
  name: string;
  tier: SkillTier;
  family?: string;
  routeEligible: boolean;
  hasScripts: boolean;
  sourceState: SourceState;
  reviewStatus: ReviewStatus;
  bodyBytes: number;
  descriptionBytes: number;
  routeCount: number;
  lastRecommendedAt?: string;
  lastHash: string;
  trustLabel: "provider-verified" | "user-reported" | "unverified-user-reported";
  reasonHints: string[];
}

export interface RouteCandidate {
  name: string;
  score: number;
  tier: SkillTier;
  family?: string;
  reasons: string[];
}

export interface RouteExclusion {
  name: string;
  reason: string;
  severity: "info" | "warning" | "blocked";
}

export interface RouteTraceRecord {
  id: string;
  createdAt: string;
  promptPreview?: string;
  rawPromptStored: false;
  recommendations: RouteCandidate[];
  exclusions: RouteExclusion[];
  hookText: string;
  hookChars: number;
  statusWarnings: string[];
  tokenEstimate: {
    hookTokens: number;
    catalogTokensAvoided?: number;
    fullBodyTokensAvoided?: number;
    method: string;
  };
}

export type VerifiedRouteTraceRecord = Omit<RouteTraceRecord, "promptPreview"> & { promptPreview?: never };

export interface PolicyReviewRow {
  id: string;
  queue: "unmatched" | "duplicate" | "explicit-only" | "blocked" | "inventory-missing";
  name: string;
  state: "ready" | "needs-review" | "held";
  reason: string;
  nextAction: string;
}

export interface SourceRow {
  id: string;
  name: string;
  source: string;
  state: SourceState;
  lastCheckedAt: string;
  reviewStatus: ReviewStatus;
  nextAction: string;
}

export interface CurationReceipt {
  modelLabel: "provider-verified" | "user-reported" | "unverified-user-reported";
  curator: string;
  recordedAt: string;
  policyHash: string;
}

export interface DashboardSnapshotPayload {
  workspaceId: string;
  workspaceName: string;
  generatedAt: string;
  redacted: true;
  mode: SnapshotMode;
  status: StatusSummary;
  tokenMetrics: TokenSavingsMetrics;
  productivity: ProductivityMetrics;
  connector: ConnectorStatus;
  curationReceipt?: CurationReceipt;
  skills: SkillTableRow[];
  recentRouteTraces: RouteTraceRecord[];
  policyReviews: PolicyReviewRow[];
  sources: SourceRow[];
}

export interface DashboardSnapshotV1 extends DashboardSnapshotPayload {
  version: 1;
  snapshotHash?: string;
  sourceType?: DashboardSourceType;
  source?: DashboardSourceType;
}

export interface DashboardSnapshotV2 extends Omit<DashboardSnapshotPayload, "recentRouteTraces"> {
  version: 2;
  kind: "skillmap.dashboard-snapshot";
  schemaVersion: 2;
  workspaceRevision: string;
  producer: {
    name: string;
    version: string;
  };
  compatibility: {
    minReaderSchemaVersion: 2;
    maxReaderSchemaVersion: 2;
  };
  inputDigests: Record<string, string>;
  payloadDigest: string;
  redactionClassification: "shareable-redacted";
  source: "local-snapshot";
  recentRouteTraces: VerifiedRouteTraceRecord[];
}

export type DashboardSnapshot = DashboardSnapshotV1 | DashboardSnapshotV2;

export interface DashboardSourceInfo {
  type: DashboardSourceType;
  label: string;
  configured: boolean;
  loaded: boolean;
  generatedAt?: string;
  loadedAt: string;
  integrity: SnapshotIntegrityState;
  payloadDigest?: string;
  transportDigest?: string;
  /** Compatibility display alias for transportDigest. */
  snapshotHash?: string;
  redacted: boolean;
  readOnly: true;
  stale: boolean;
  message: string;
  warnings: string[];
  error?: string;
}

export interface DashboardCommandSet {
  exportSnapshot: string;
  loadSnapshot: string;
  routeTrace: string;
}

export interface DashboardPageData {
  initialView: DashboardView;
  fixtures: Record<SnapshotMode, DashboardSnapshot>;
  fixtureSources: Record<SnapshotMode, DashboardSourceInfo>;
  localSnapshot?: DashboardSnapshot;
  localSource?: DashboardSourceInfo;
  snapshotLoadError?: DashboardSourceInfo;
  commands: DashboardCommandSet;
}
