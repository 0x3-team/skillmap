import os from 'node:os';
import path from 'node:path';
import { hashText, readJson } from './fs.js';
import { computePayloadDigest } from './canonical-payload.js';
import { readWorkspaceIdentity } from './config.js';
import { isQualifiedInventory, isOpaqueUuid } from './identity.js';
import { resolveCurrentEffective } from './effective-state.js';
import { buildSkillMapStatus, fileExists, skillmapDir, stableJson, type CurationReceipt, type EvalConfidenceLevel, type SkillMapStatus } from './status.js';
import type { EffectiveRegistry, Inventory, SkillTier } from '../schemas/types.js';

type SnapshotMode = 'release-ready' | 'attention-required';
type DashboardVerdict = 'ok' | 'attention-required' | 'blocked';
type DashboardTier = 'core' | 'preferred' | 'optional' | 'fallback' | 'blocked';
type SourceState = 'clean' | 'modified' | 'stale' | 'risky' | 'unknown' | 'error' | 'local';
type ReviewStatus = 'none' | 'reviewed' | 'held' | 'needs-review';
type PolicyQueue = 'unmatched' | 'duplicate' | 'explicit-only' | 'blocked' | 'inventory-missing';
type PolicyState = 'ready' | 'needs-review' | 'held';
type ConnectorState = 'online' | 'offline' | 'blocked' | 'unauthorized';

export interface DashboardSnapshot {
  version: 2;
  kind: 'skillmap.dashboard-snapshot';
  schemaVersion: 2;
  workspaceId: string;
  workspaceRevision: string;
  workspaceName: string;
  generatedAt: string;
  producer: { name: string; version: string };
  compatibility: { minReaderSchemaVersion: 2; maxReaderSchemaVersion: 2 };
  inputDigests: Record<string, string>;
  payloadDigest: string;
  redactionClassification: 'shareable-redacted';
  redacted: true;
  mode: SnapshotMode;
  source: 'local-snapshot';
  status: {
    verdict: DashboardVerdict;
    label: string;
    summary: string;
    warnings: string[];
    nextActions: string[];
  };
  tokenMetrics: {
    fullBodyTokens?: number;
    catalogTokens?: number;
    hookTokensMean?: number;
    tokensAvoidedVsBodies?: number;
    tokensAvoidedVsCatalog?: number;
    sampleSize: number;
    method: 'workspace-estimate' | 'eval-report' | 'unknown';
    computedAt: string;
  };
  productivity: {
    routeCount: number;
    top1Rate?: number;
    top3Rate?: number;
    avoidHits?: number;
    evalConfidence: EvalConfidenceLevel;
    releaseReady: boolean;
    avgRecommendations?: number;
    avgHookChars?: number;
  };
  connector: {
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
  };
  curationReceipt?: {
    modelLabel: NonNullable<SkillMapStatus['curation']>['modelVerification'];
    curator: string;
    recordedAt: string;
    policyHash: string;
  };
  skills: SkillTableRow[];
  recentRouteTraces: RouteTraceRecord[];
  policyReviews: PolicyReviewRow[];
  sources: SourceRow[];
}

interface SkillTableRow {
  id: string;
  name: string;
  tier: DashboardTier;
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
  trustLabel: NonNullable<SkillMapStatus['curation']>['modelVerification'];
  reasonHints: string[];
}

interface RouteTraceRecord {
  id: string;
  createdAt: string;
  rawPromptStored: false;
  recommendations: Array<{ name: string; score: number; tier: DashboardTier; family?: string; reasons: string[] }>;
  exclusions: Array<{ name: string; reason: string; severity: 'info' | 'warning' | 'blocked' }>;
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

interface PolicyReviewRow {
  id: string;
  queue: PolicyQueue;
  name: string;
  state: PolicyState;
  reason: string;
  nextAction: string;
}

interface SourceRow {
  id: string;
  name: string;
  source: string;
  state: SourceState;
  lastCheckedAt: string;
  reviewStatus: ReviewStatus;
  nextAction: string;
}

interface PackageJsonLike {
  version?: string;
}

interface EvalReportLike {
  version?: 1 | 2;
  generatedAt?: string;
  count?: number;
  top1Rate?: number;
  top3Rate?: number;
  avoidHits?: number;
  pass?: boolean;
  rows?: EvalRowLike[];
}

interface EvalRowLike {
  prompt?: string;
  recommended?: string[];
  avoidedButRecommended?: string[];
  hookText?: string;
}

interface SourceRegistryLike {
  version?: 1;
  records?: SourceRecordLike[];
}

interface SourceStatusLike {
  version?: 1;
  generatedAt?: string;
  records?: SourceStatusRecordLike[];
}

interface SourceRecordLike {
  skill?: string;
  skillId?: string;
  contentRevision?: string;
  localPath?: string;
  installedAt?: string;
  source?: { type?: 'github'; repo?: string; path?: string; ref?: string } | { type?: 'local'; path?: string } | { type?: 'unknown' };
}

interface SourceStatusRecordLike extends SourceRecordLike {
  state?: string;
  risk?: string;
  error?: string;
  currentHash?: string;
  upstreamHash?: string;
  upstreamManifestDigest?: string;
  upstreamCommit?: string;
  upstreamContentRevision?: string;
}

interface SourceDecisionRegistryLike {
  records?: SourceDecisionRecordLike[];
}

interface SourceDecisionRecordLike {
  skill?: string;
  skillId?: string;
  contentRevision?: string;
  localPath?: string;
  appliesToState?: string;
  decision?: 'hold' | 'accepted' | 'ignore';
  reason?: string;
  currentHash?: string;
  upstreamHash?: string;
  upstreamManifestDigest?: string;
  upstreamCommit?: string;
  upstreamContentRevision?: string;
  reviewedAt?: string;
}

const SNAPSHOT_COMMAND = 'skillmap export --dashboard-snapshot --redact-paths --output .skillmap/dashboard-snapshot.json';

export async function buildDashboardSnapshot(cwd: string): Promise<DashboardSnapshot> {
  const generatedAt = new Date().toISOString();
  const dir = skillmapDir(cwd);
  const status = await buildSkillMapStatus(cwd);
  const inventory = await readOptionalJson<Inventory>(path.join(dir, 'inventory.json'));
  const savedEffective = await readOptionalJson<EffectiveRegistry>(path.join(dir, 'effective.json'));
  const evalReport = await readOptionalJson<EvalReportLike>(path.join(dir, 'eval-report.json'));
  const sourceRegistry = await readOptionalJson<SourceRegistryLike>(path.join(dir, 'sources.json'));
  const sourceStatus = await readOptionalJson<SourceStatusLike>(path.join(dir, 'source-status.json'));
  const sourceDecisions = await readOptionalJson<SourceDecisionRegistryLike>(path.join(dir, 'source-decisions.json'));
  const curationReceipt = await readOptionalJson<CurationReceipt>(path.join(dir, 'curation/receipt.json'));
  const pkg = await readOptionalJson<PackageJsonLike>(path.join(cwd, 'package.json'));
  const workspaceIdentity = await readWorkspaceIdentity(cwd);
  if (!inventory || !isQualifiedInventory(inventory)) {
    throw new Error('Dashboard snapshot export requires a qualified inventory v2. Run `skillmap scan` first.');
  }
  const effective = await resolveCurrentEffective(cwd, inventory, savedEffective);
  if (curationReceipt && !/^sha256:[a-f0-9]{64}$/.test(curationReceipt.outputs?.policy?.hash ?? '')) {
    throw new Error('Dashboard snapshot export refuses a curation receipt without a valid policy digest. Re-run the curation receipt workflow first.');
  }
  const sourceRecords = sourceStatus?.records ?? sourceRegistry?.records ?? [];
  const sourceDecisionRecords = sourceDecisions?.records ?? [];
  const effectiveSkills = effective?.skills ?? inventory?.skills ?? [];
  const recentRouteTraces = buildRouteTraces(cwd, evalReport, effective);
  const skills = buildSkillRows(effectiveSkills, sourceRecords, sourceDecisionRecords, curationReceipt, recentRouteTraces, status.readinessPhase === 'identity-invalid');
  const releaseReady = status.verdict === 'ok' && status.readinessPhase === 'ready';
  const tokenMetrics = buildTokenMetrics(effectiveSkills, recentRouteTraces, generatedAt);
  const workspaceId = inventory?.workspaceId ?? workspaceIdentity?.workspaceId;
  if (!workspaceId) throw new Error('Dashboard snapshot export requires an initialized workspace identity. Run `skillmap init` and `skillmap scan`.');
  const inputDigests = dashboardInputDigests(status, recentRouteTraces);
  const workspaceRevision = hashText(stableJson({ workspaceId, inputDigests }));
  const base: Omit<DashboardSnapshot, 'payloadDigest'> = {
    version: 2,
    kind: 'skillmap.dashboard-snapshot',
    schemaVersion: 2,
    workspaceId,
    workspaceRevision,
    workspaceName: safeDashboardName(path.basename(cwd) || 'workspace'),
    generatedAt,
    producer: { name: 'skillmap', version: safeProducerVersion(pkg?.version) },
    compatibility: { minReaderSchemaVersion: 2, maxReaderSchemaVersion: 2 },
    inputDigests,
    redactionClassification: 'shareable-redacted',
    redacted: true,
    mode: releaseReady ? 'release-ready' : 'attention-required',
    source: 'local-snapshot',
    status: buildStatusSummary(cwd, status),
    tokenMetrics,
    productivity: {
      routeCount: Number(status.eval?.count ?? recentRouteTraces.length),
      top1Rate: status.eval?.top1Rate,
      top3Rate: status.eval?.top3Rate,
      avoidHits: status.eval?.avoidHits,
      evalConfidence: status.eval?.confidence.level ?? 'none',
      releaseReady: Boolean(status.eval?.pass && status.eval?.confidence.releaseReady),
      avgRecommendations: average(recentRouteTraces.map((trace) => trace.recommendations.length)),
      avgHookChars: average(recentRouteTraces.map((trace) => trace.hookChars))
    },
    connector: {
      state: releaseReady ? 'online' : 'blocked',
      cliVersion: safeProducerVersion(pkg?.version),
      cwdAlias: '$PROJECT',
      lastSeenAt: generatedAt,
      redactionEnabled: true,
      readOnlyMode: true,
      allowedCommands: ['skillmap status --json', 'skillmap sources check', SNAPSHOT_COMMAND],
      nextCommand: status.nextActions[0] ?? SNAPSHOT_COMMAND,
      message: releaseReady
        ? 'Fresh redacted local dashboard snapshot exported from CLI artifacts.'
        : `Snapshot exported, but SkillMap status is ${status.verdict} at readiness phase ${status.readinessPhase}.`
    },
    curationReceipt: curationReceipt ? {
      modelLabel: safeTrustLabel(curationReceipt.modelVerification),
      curator: safeDashboardName(curationReceipt.host),
      recordedAt: safeIsoTimestamp(curationReceipt.createdAt, generatedAt),
      policyHash: curationReceipt.outputs?.policy?.hash ?? 'missing'
    } : undefined,
    skills,
    recentRouteTraces,
    policyReviews: buildPolicyReviews(status, effective),
    sources: buildSourceRows(cwd, sourceRecords, sourceDecisionRecords, sourceStatus?.generatedAt ?? generatedAt)
  };
  const cleanBase = JSON.parse(JSON.stringify(base)) as Omit<DashboardSnapshot, 'payloadDigest'>;
  const snapshot = { ...cleanBase, payloadDigest: computePayloadDigest(cleanBase) };
  assertDashboardSnapshotContract(snapshot);
  assertDashboardSnapshotPrivacy(snapshot);
  return snapshot;
}

async function readOptionalJson<T>(file: string): Promise<T | undefined> {
  if (!(await fileExists(file))) return undefined;
  return readJson<T>(file);
}

function buildStatusSummary(cwd: string, status: SkillMapStatus): DashboardSnapshot['status'] {
  const verdict = dashboardVerdict(status.verdict);
  return {
    verdict,
    label: verdict === 'ok' ? 'Ready' : verdict === 'blocked' ? 'Blocked' : 'Attention required',
    summary: verdict === 'ok'
      ? 'SkillMap status is ready for local dashboard use.'
      : `SkillMap status is ${status.verdict} at readiness phase ${status.readinessPhase}.`,
    warnings: status.warnings.map((warning) => redactStatusText(cwd, status, warning)).slice(0, 25),
    nextActions: status.nextActions.map((action) => redactStatusText(cwd, status, action))
  };
}

function dashboardVerdict(verdict: SkillMapStatus['verdict']): DashboardVerdict {
  return verdict === 'attention required' ? 'attention-required' : verdict;
}

function buildSkillRows(
  skills: Array<EffectiveRegistry['skills'][number] | Inventory['skills'][number]>,
  sourceRecords: SourceStatusRecordLike[],
  sourceDecisions: SourceDecisionRecordLike[],
  curationReceipt: CurationReceipt | undefined,
  traces: RouteTraceRecord[],
  routingBlocked: boolean
): SkillTableRow[] {
  const traceStats = new Map<string, { count: number; last?: string }>();
  for (const trace of traces) {
    for (const rec of trace.recommendations) {
      const current = traceStats.get(rec.name) ?? { count: 0 };
      current.count += 1;
      if (!current.last || trace.createdAt > current.last) current.last = trace.createdAt;
      traceStats.set(rec.name, current);
    }
  }
  return skills.map((skill) => {
    const tier = 'tier' in skill ? skill.tier : 'specialist';
    const sourceRecord = findSourceForSkill(skill, sourceRecords);
    const decision = findSourceDecision(sourceRecord, sourceDecisions);
    const stats = traceStats.get(skill.name);
    return {
      id: skill.skillId,
      name: safeDashboardName(skill.name),
      tier: dashboardTier(tier),
      family: 'family' in skill ? safeDashboardLabel(skill.family) : undefined,
      routeEligible: routingBlocked ? false : ('routeEligible' in skill ? skill.routeEligible : false),
      hasScripts: skill.hasScripts,
      sourceState: sourceState(sourceRecord),
      reviewStatus: reviewStatus(sourceRecord, decision),
      bodyBytes: skill.bodyBytes,
      descriptionBytes: skill.descriptionBytes,
      routeCount: stats?.count ?? 0,
      lastRecommendedAt: stats?.last,
      lastHash: skill.contentRevision,
      trustLabel: safeTrustLabel(curationReceipt?.modelVerification),
      reasonHints: safeReasonHints(skill, tier)
    };
  });
}

function buildRouteTraces(cwd: string, evalReport: EvalReportLike | undefined, effective: EffectiveRegistry | undefined): RouteTraceRecord[] {
  const traces: RouteTraceRecord[] = [];
  const rows = evalReport?.rows ?? [];
  for (const [index, row] of rows.slice(0, Math.max(0, 12 - traces.length)).entries()) {
    const knownNames = new Set((effective?.skills ?? []).map((skill) => skill.name));
    const recommended = (row.recommended ?? []).filter((name) => knownNames.has(name)).slice(0, 5);
    const safeRecommended = recommended.map(safeDashboardName);
    const hookText = renderFallbackHook(safeRecommended).slice(0, 500);
    const traceReceipt = hashText(stableJson({
      kind: 'skillmap.redacted-eval-trace',
      generatedAt: safeIsoTimestamp(evalReport?.generatedAt, '1970-01-01T00:00:00.000Z'),
      index,
      recommended: safeRecommended,
      avoided: (row.avoidedButRecommended ?? []).filter((name) => knownNames.has(name)).slice(0, 5).map(safeDashboardName)
    }));
    traces.push({
      id: `eval-${traceReceipt.replace('sha256:', '').slice(0, 12)}`,
      createdAt: safeIsoTimestamp(evalReport?.generatedAt, new Date().toISOString()),
      rawPromptStored: false,
      recommendations: recommended.map((name, recIndex) => {
        const skill = effective?.skills.find((item) => item.name === name);
        return {
          name: safeDashboardName(name),
          score: Number((1 - (recIndex * 0.1)).toFixed(2)),
          tier: dashboardTier(skill?.tier ?? 'specialist'),
          family: safeDashboardLabel(skill?.family),
          reasons: ['eval report recommendation']
        };
      }),
      exclusions: (row.avoidedButRecommended ?? []).filter((name) => knownNames.has(name)).slice(0, 5).map((name) => ({
        name: safeDashboardName(name),
        reason: 'avoid-listed skill was recommended during eval',
        severity: 'warning' as const
      })),
      hookText: redactPath(cwd, hookText),
      hookChars: hookText.length,
      statusWarnings: [],
      tokenEstimate: {
        hookTokens: estimateTokens(hookText.length),
        catalogTokensAvoided: effective ? estimateTokens(catalogChars(effective.skills)) : undefined,
        fullBodyTokensAvoided: effective ? estimateTokens(effective.skills.reduce((sum, skill) => sum + skill.bodyBytes, 0)) : undefined,
        method: 'estimated from chars / 4'
      }
    });
  }
  return traces;
}

function buildPolicyReviews(status: SkillMapStatus, effective: EffectiveRegistry | undefined): PolicyReviewRow[] {
  const rows: PolicyReviewRow[] = [];
  for (const name of status.policy?.unmatchedEntries ?? []) {
    rows.push({ id: `policy-unmatched-${slug(name)}`, queue: 'unmatched', name: safeDashboardName(name), state: 'needs-review', reason: 'Policy entry has no matching inventory skill.', nextAction: 'Remove policy entry or rescan/adopt the missing skill.' });
  }
  for (const group of status.policy?.duplicateInventoryNameGroups ?? []) {
    rows.push({ id: `policy-duplicate-${slug(group.name)}`, queue: 'duplicate', name: safeDashboardName(group.name), state: 'needs-review', reason: `${group.paths.length} inventory entries share this policy key.`, nextAction: 'Choose a canonical skill or split policy entries.' });
  }
  for (const name of status.policy?.inventoryWithoutPolicy.slice(0, 40) ?? []) {
    rows.push({ id: `policy-inventory-missing-${slug(name)}`, queue: 'inventory-missing', name: safeDashboardName(name), state: 'needs-review', reason: 'Inventory skill has no reviewed policy entry.', nextAction: 'Add a policy entry or intentionally leave specialist fallback.' });
  }
  for (const skill of effective?.skills ?? []) {
    if (skill.tier === 'explicit-only') {
      rows.push({ id: `policy-explicit-${slug(skill.name)}`, queue: 'explicit-only', name: safeDashboardName(skill.name), state: 'ready', reason: 'Skill is explicit-only and excluded from implicit routing unless named.', nextAction: 'Keep explicit-only unless reviewed for safe implicit use.' });
    }
    if (skill.tier === 'blocked') {
      rows.push({ id: `policy-blocked-${slug(skill.name)}`, queue: 'blocked', name: safeDashboardName(skill.name), state: 'held', reason: 'Skill is blocked by policy.', nextAction: 'Keep blocked until a reviewed policy change is applied.' });
    }
  }
  return rows.slice(0, 100);
}

function buildSourceRows(
  cwd: string,
  records: SourceStatusRecordLike[],
  sourceDecisions: SourceDecisionRecordLike[],
  fallbackCheckedAt: string
): SourceRow[] {
  return records.map((record) => {
    const decision = findSourceDecision(record, sourceDecisions);
    const state = sourceState(record);
    return {
      id: `source-${slug(record.skill ?? 'unknown')}`,
      name: safeDashboardName(record.skill ?? 'unknown'),
      source: sourceLabel(cwd, record),
      state,
      lastCheckedAt: safeIsoTimestamp(fallbackCheckedAt, new Date().toISOString()),
      reviewStatus: reviewStatus(record, decision),
      nextAction: nextSourceAction(state, decision)
    };
  });
}

function findSourceForSkill(
  skill: EffectiveRegistry['skills'][number] | Inventory['skills'][number],
  records: SourceStatusRecordLike[]
): SourceStatusRecordLike | undefined {
  const exactId = records.find((record) => record.skillId === skill.skillId);
  if (exactId) return exactId;
  const exactPath = records.find((record) => !record.skillId && record.localPath === skill.path && record.skill === skill.name);
  if (exactPath) return exactPath;
  const legacy = records.filter((record) => !record.skillId && !record.localPath && record.skill === skill.name);
  return legacy.length === 1 ? legacy[0] : undefined;
}

function findSourceDecision(
  record: SourceStatusRecordLike | undefined,
  decisions: SourceDecisionRecordLike[]
): SourceDecisionRecordLike | undefined {
  if (!record) return undefined;
  if (record.skillId) return decisions.find((decision) => decision.skillId === record.skillId);
  if (record.localPath) return decisions.find((decision) => !decision.skillId && decision.localPath === record.localPath && decision.skill === record.skill);
  const legacy = decisions.filter((decision) => !decision.skillId && decision.skill === record.skill);
  return legacy.length === 1 ? legacy[0] : undefined;
}

function buildTokenMetrics(
  skills: Array<EffectiveRegistry['skills'][number] | Inventory['skills'][number]>,
  traces: RouteTraceRecord[],
  generatedAt: string
): DashboardSnapshot['tokenMetrics'] {
  const fullBodyTokens = estimateTokens(skills.reduce((sum, skill) => sum + skill.bodyBytes, 0));
  const catalogTokens = estimateTokens(catalogChars(skills));
  const hookTokensMean = average(traces.map((trace) => trace.tokenEstimate.hookTokens));
  return {
    fullBodyTokens,
    catalogTokens,
    hookTokensMean,
    tokensAvoidedVsBodies: hookTokensMean === undefined ? undefined : Math.max(0, fullBodyTokens - hookTokensMean),
    tokensAvoidedVsCatalog: hookTokensMean === undefined ? undefined : Math.max(0, catalogTokens - hookTokensMean),
    sampleSize: skills.length,
    method: skills.length ? 'workspace-estimate' : 'unknown',
    computedAt: generatedAt
  };
}

function sourceState(record: SourceStatusRecordLike | undefined): SourceState {
  if (!record) return 'unknown';
  if (record.error) return 'error';
  switch (record.state) {
    case 'external-clean':
      return 'clean';
    case 'external-modified':
    case 'local-modified':
      return 'modified';
    case 'external-stale':
      return 'stale';
    case 'external-risky-update':
      return 'risky';
    case 'local-authored':
      return 'local';
    default:
      return record.risk === 'high' ? 'risky' : 'unknown';
  }
}

function reviewStatus(record: SourceStatusRecordLike | undefined, decision: SourceDecisionRecordLike | undefined): ReviewStatus {
  const requiresImmutableTree = Boolean(record && (
    ['external-modified', 'external-stale', 'external-risky-update'].includes(record.state ?? '')
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
  const state = sourceState(record);
  if (state === 'clean' || state === 'local') return 'reviewed';
  if (!record) return 'none';
  return 'needs-review';
}

function nextSourceAction(state: SourceState, decision: SourceDecisionRecordLike | undefined): string {
  if (decision?.decision === 'hold') return 'Held after review';
  if (state === 'clean' || state === 'local') return 'No action';
  if (state === 'unknown') return 'Run skillmap sources adopt or review source provenance';
  if (state === 'error') return 'Fix source check error and rerun skillmap sources check';
  return 'Run skillmap sources diff SKILL and record a review decision';
}

function sourceLabel(cwd: string, record: SourceRecordLike): string {
  if (record.source?.type === 'github') {
    const repo = record.source.repo;
    const sourcePath = record.source.path;
    const refValue = record.source.ref;
    const validRepo = typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
    const validPath = typeof sourcePath === 'string' && !sourcePath.split('/').includes('..') && /^[A-Za-z0-9._/-]+$/.test(sourcePath);
    const validRef = refValue === undefined || (typeof refValue === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(refValue) && !refValue.split('/').includes('..'));
    if (!validRepo || !validPath || !validRef) return 'github.com/redacted-source';
    const ref = refValue ? `@${refValue}` : '';
    return `github.com/${repo}/${sourcePath}${ref}`;
  }
  if (record.source?.type === 'local' && record.source.path) return redactLocalPath(cwd, record.source.path);
  return record.source?.type ?? 'unknown';
}

function safeDashboardName(value: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,159}$/.test(value) && !DASHBOARD_SECRET_PATTERNS.some((pattern) => pattern.test(value))) return value;
  return `redacted-${hashText(value).replace('sha256:', '').slice(0, 16)}`;
}

function safeDashboardLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,159}$/.test(value) && !DASHBOARD_SECRET_PATTERNS.some((pattern) => pattern.test(value))
    ? value
    : undefined;
}

function safeProducerVersion(value: unknown): string {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,79}$/.test(value) ? value : '0.0.0-unknown';
}

function safeTrustLabel(value: unknown): NonNullable<SkillMapStatus['curation']>['modelVerification'] {
  return value === 'provider-verified' || value === 'user-reported' || value === 'unverified-user-reported'
    ? value
    : 'unverified-user-reported';
}

function safeIsoTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function dashboardTier(tier: SkillTier): DashboardTier {
  switch (tier) {
    case 'active-default':
      return 'core';
    case 'specialist':
      return 'preferred';
    case 'explicit-only':
      return 'optional';
    case 'archived':
      return 'fallback';
    case 'blocked':
      return 'blocked';
  }
}

function renderFallbackHook(names: string[]): string {
  return names.length ? `SkillMap: prefer ${names.join(', ')}.` : 'SkillMap: no confident skill recommendation.';
}

function catalogChars(skills: Array<EffectiveRegistry['skills'][number] | Inventory['skills'][number]>): number {
  return skills.reduce((sum, skill) => sum + skill.name.length + skill.descriptionBytes + 8, 0);
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function average(values: number[]): number | undefined {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return undefined;
  return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2));
}

function dashboardInputDigests(status: SkillMapStatus, recentRouteTraces: RouteTraceRecord[]): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const [name, artifact] of Object.entries(status.artifacts)) {
    if (name === 'eval') continue;
    if (artifact.hash) digests[name] = artifact.hash;
  }
  if (status.artifacts.eval?.present) {
    digests.evalProjection = hashText(stableJson({
      kind: 'skillmap.redacted-eval-projection',
      schemaVersion: 1,
      count: status.eval?.count ?? 0,
      top1Rate: status.eval?.top1Rate ?? null,
      top3Rate: status.eval?.top3Rate ?? null,
      avoidHits: status.eval?.avoidHits ?? 0,
      evidenceLevel: status.eval?.confidence.level ?? 'none',
      releaseReady: Boolean(status.eval?.pass && status.eval?.confidence.releaseReady),
      recentRouteTraces
    }));
  }
  return digests;
}

function safeReasonHints(
  skill: EffectiveRegistry['skills'][number] | Inventory['skills'][number],
  tier: SkillTier
): string[] {
  const hints = [`tier=${dashboardTier(tier)}`, `route=${'routeEligible' in skill && skill.routeEligible ? 'eligible' : 'blocked'}`];
  if ('variantState' in skill) hints.push(`variant=${skill.variantState}`);
  if (!skill.implicitAllowed) hints.push('frontmatter=invalid');
  return hints;
}

function assertDashboardSnapshotContract(snapshot: DashboardSnapshot): void {
  if (!isOpaqueUuid(snapshot.workspaceId)) throw new Error('Dashboard snapshot workspaceId must be an opaque UUID.');
  if (!/^sha256:[a-f0-9]{64}$/.test(snapshot.workspaceRevision) || !/^sha256:[a-f0-9]{64}$/.test(snapshot.payloadDigest)) {
    throw new Error('Dashboard snapshot revision and payload digests must be lowercase sha256 values.');
  }
  if (Object.keys(snapshot.inputDigests).length === 0 || Object.values(snapshot.inputDigests).some((digest) => !/^sha256:[a-f0-9]{64}$/.test(digest))) {
    throw new Error('Dashboard snapshot inputDigests must contain validated artifact digests.');
  }
  for (const [index, skill] of snapshot.skills.entries()) {
    if (!/^sk_[A-Za-z0-9_-]{43}$/.test(skill.id)) throw new Error(`Dashboard snapshot skill ${index} lacks a qualified ID.`);
    if (!/^sha256:[a-f0-9]{64}$/.test(skill.lastHash)) throw new Error(`Dashboard snapshot skill ${index} lacks a content revision.`);
  }
  if (snapshot.curationReceipt && !/^sha256:[a-f0-9]{64}$/.test(snapshot.curationReceipt.policyHash)) {
    throw new Error('Dashboard snapshot curation policyHash must be a sha256 digest.');
  }
  if (!Number.isFinite(Date.parse(snapshot.generatedAt)) || !Number.isFinite(Date.parse(snapshot.tokenMetrics.computedAt))) {
    throw new Error('Dashboard snapshot timestamps must be ISO-compatible.');
  }
  for (const trace of snapshot.recentRouteTraces) if (!Number.isFinite(Date.parse(trace.createdAt))) throw new Error('Dashboard route trace timestamp is invalid.');
  for (const source of snapshot.sources) if (!Number.isFinite(Date.parse(source.lastCheckedAt))) throw new Error('Dashboard source timestamp is invalid.');
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'unknown';
}

function redactLocalPath(cwd: string, value: string): string {
  const redacted = redactPath(cwd, value);
  if (redacted !== value) return redacted;
  if (path.isAbsolute(value) || /^[A-Za-z]:\\/.test(value) || /^\\\\/.test(value)) return '$ABS_PATH';
  return value;
}

function redactPath(cwd: string, value: string): string {
  return value
    .replaceAll(cwd, '$PROJECT')
    .replaceAll(os.homedir(), '$HOME')
    .replace(/(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]+/g, '$1$ABS_PATH')
    .replace(/(^|[\s("'=:])[A-Za-z]:\\[^\s"'<>),;]+/g, '$1$ABS_PATH')
    .replace(/(^|[\s("'=:])\\\\[^\s"'<>),;]+/g, '$1$ABS_PATH');
}

function redactStatusText(cwd: string, status: SkillMapStatus, value: string): string {
  const configuredRoots = status.config?.roots.map((root) => path.resolve(cwd, root.replace(/^~(?=$|\/)/, os.homedir()))) ?? [];
  const artifactPaths = Object.values(status.artifacts).map((artifact) => artifact.path);
  let redacted = value;
  for (const sensitive of [cwd, os.homedir(), ...configuredRoots, ...artifactPaths].filter(Boolean).sort((a, b) => b.length - a.length)) {
    redacted = redacted.replaceAll(sensitive, sensitive === cwd ? '$PROJECT' : sensitive === os.homedir() ? '$HOME' : '$ABS_PATH');
  }
  return redactPath(cwd, redacted);
}

function assertDashboardSnapshotPrivacy(value: unknown, location = '$'): void {
  if (typeof value === 'string') {
    if (containsAbsolutePath(value)) throw new Error(`Dashboard snapshot contains an absolute path at ${location}.`);
    for (const pattern of DASHBOARD_SECRET_PATTERNS) {
      if (pattern.test(value)) throw new Error(`Dashboard snapshot contains a secret or privacy canary at ${location}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDashboardSnapshotPrivacy(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/^(rawPrompt|prompt|promptText|rawSkillBody|skillBodyText)$/i.test(key)) {
      throw new Error(`Dashboard snapshot contains forbidden raw text field ${key} at ${location}.`);
    }
    assertDashboardSnapshotPrivacy(nested, `${location}.${key}`);
  }
}

function containsAbsolutePath(value: string): boolean {
  return /(^|[\s("'=:])\/(?!\/)[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])[A-Za-z]:\\[^\s"'<>),;]+/.test(value)
    || /(^|[\s("'=:])\\\\[^\s"'<>),;]+/.test(value)
    || /\bfile:\/\//i.test(value);
}

const DASHBOARD_SECRET_PATTERNS = [
  /CANARY_/i,
  /\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b/,
  /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i
];
