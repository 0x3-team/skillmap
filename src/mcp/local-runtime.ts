import { apiSuccess, type ApiReceiptContext } from '../core/api-envelope.js';
import { canonicalJson } from '../core/canonical-payload.js';
import { hashText, readJson } from '../core/fs.js';
import { createRouteEvent, recordRouteEvent } from '../core/route-events.js';
import { redactedMetadataLabel } from '../core/redacted-metadata.js';
import {
  SkillDiscoveryIndexCache,
  type SkillDiscoveryStrategy,
  type SkillDiscoveryStrategyComparison
} from '../core/skill-discovery-index.js';
import type { DoctorReport, RevisionRef } from '../schemas/types.js';
import { executeRouteUseCase } from '../services/route-use-case.js';
import {
  createSkillDiscoveryUseCase,
  projectMcpSkillDetail,
  projectMcpSkillSummary
} from '../services/skill-discovery-use-case.js';
import {
  approvedArtifactPath,
  openApprovedRoutingState,
  openApprovedWorkspaceRead,
  type ApprovedWorkspaceRead
} from '../services/workspace-read-model.js';
import { SkillMapMcpToolError, type SkillMapMcpRuntime } from './tool-runtime.js';
import type {
  PaginatedMcpInput,
  RoutePromptInput,
  SearchSkillsInput,
  ShowSkillInput,
  SkillMapMcpToolInput,
  SkillMapMcpToolName
} from './tool-schemas.js';

export interface LocalSkillMapMcpRuntimeOptions {
  discoveryStrategy?: SkillDiscoveryStrategy;
  indexCache?: SkillDiscoveryIndexCache;
  onStrategyComparison?: (comparison: SkillDiscoveryStrategyComparison) => void;
}

interface CachedRevisionPage {
  metadata: unknown;
  values: readonly unknown[];
  binding: string;
}

/** Local approved-workspace adapter; protocol and transport remain in src/mcp/server. */
export class LocalSkillMapMcpRuntime implements SkillMapMcpRuntime {
  readonly #indexCache: SkillDiscoveryIndexCache;
  readonly #pageCache = new Map<string, CachedRevisionPage>();
  readonly #discoveryStrategy: SkillDiscoveryStrategy;
  readonly #onStrategyComparison?: (comparison: SkillDiscoveryStrategyComparison) => void;

  constructor(readonly cwd: string, options: LocalSkillMapMcpRuntimeOptions = {}) {
    this.#indexCache = options.indexCache ?? new SkillDiscoveryIndexCache(2);
    this.#discoveryStrategy = options.discoveryStrategy ?? 'indexed';
    this.#onStrategyComparison = options.onStrategyComparison;
  }

  async callTool(name: SkillMapMcpToolName, input: SkillMapMcpToolInput) {
    try {
      if (name === 'route_prompt') return await this.#route(input as RoutePromptInput);
      return await this.#readTool(name, input);
    } catch (error) {
      if (error instanceof SkillMapMcpToolError) throw error;
      throw mapLocalSkillMapMcpToolError(error);
    }
  }

  async #route(input: RoutePromptInput) {
    const state = await openApprovedRoutingState(this.cwd);
    const context = receiptContext(
      state.servingRevision,
      state.currentRevision,
      state.servingMode === 'last-known-good'
    );
    try {
      const execution = executeRouteUseCase(
        state,
        {
          prompt: input.prompt,
          ...(input.max !== undefined ? { max: input.max } : {}),
          ...(input.skillId ? { qualifiedSkillId: input.skillId } : {})
        },
        {
          strategy: this.#discoveryStrategy,
          indexCache: this.#indexCache,
          onStrategyComparison: this.#onStrategyComparison
        }
      );
      await recordRouteEvent(this.cwd, createRouteEvent(execution.result, execution.currentRevision, 'mcp'));
      return apiSuccess(execution.result, context);
    } catch (error) {
      throw mapLocalSkillMapMcpToolError(error, context);
    }
  }

  async #readTool(name: Exclude<SkillMapMcpToolName, 'route_prompt'>, input: SkillMapMcpToolInput) {
    const read = await openApprovedWorkspaceRead(this.cwd, 'routing');
    const context = contextFromRead(read);
    try {
      if (name === 'search_skills') {
        const search = input as SearchSkillsInput;
        const discovery = createSkillDiscoveryUseCase(read, {
          strategy: this.#discoveryStrategy,
          indexCache: this.#indexCache,
          onStrategyComparison: this.#onStrategyComparison,
          searchExposure: 'mcp'
        });
        const page = discovery.search({
          ...(search.query !== undefined ? { query: search.query } : {}),
          ...(search.cursor !== undefined ? { cursor: search.cursor } : {}),
          limit: search.limit ?? 20
        });
        return apiSuccess({ ...page, items: page.items.map(projectMcpSkillSummary) }, context);
      }

      if (name === 'show_skill') {
        const discovery = createSkillDiscoveryUseCase(read, {
          strategy: this.#discoveryStrategy,
          indexCache: this.#indexCache,
          onStrategyComparison: this.#onStrategyComparison
        });
        const skill = discovery.getSkill((input as ShowSkillInput).skillId);
        return apiSuccess({ skill: projectMcpSkillDetail(skill) }, context);
      }

      if (!read.effective) throw approvedEffectiveMissing();
      const pagination = input as PaginatedMcpInput;
      if (name === 'show_skillgraph') {
        const graph = await pageRevisionValues(this.#pageCache, name, pagination, read.servingRevision, () => {
          const publicGraphId = (value: string) => mcpGraphIdentifier(value);
          return {
            metadata: null,
            values: [
              ...read.effective!.graph.nodes.map((node) => ({
                kind: 'node' as const,
                id: publicGraphId(node.id),
                type: mcpGraphNodeType(node.type),
                label: redactedMetadataLabel(node.label, publicGraphId(node.id))
              })),
              ...read.effective!.graph.edges.map((edge) => ({
                kind: 'edge' as const,
                from: publicGraphId(edge.from),
                to: publicGraphId(edge.to),
                type: mcpGraphEdgeType(edge.type),
                source: mcpGraphSource(edge.source),
                confidence: Number.isFinite(edge.confidence) ? Math.max(0, Math.min(1, edge.confidence)) : 0
              }))
            ]
          };
        });
        return apiSuccess({ graph: graph.page }, context);
      }

      if (name === 'doctor_summary') {
        const doctor = await pageRevisionValues(this.#pageCache, name, pagination, read.servingRevision, async () => {
          const report = await readJson<DoctorReport>(approvedArtifactPath(read, 'doctor.json'));
          const skillIdByPath = new Map(read.effective!.skills.map((skill) => [skill.path, skill.skillId]));
          const findings = report.findings.map((finding) => {
            const presentation = mcpDoctorPresentation(finding.id);
            const skillIds = [...new Set(finding.skills
              .map((item) => qualifiedSkillId(item) ? item : skillIdByPath.get(item))
              .filter(qualifiedSkillId))].slice(0, 20);
            return {
              id: mcpOpaqueIdentifier('finding', finding.id),
              severity: mcpDoctorSeverity(finding.severity),
              title: presentation.title,
              skillIds,
              recommendationCode: presentation.code
            };
          });
          return {
            metadata: {
              skillCount: nonNegativeInteger(report.summary.skillCount),
              duplicateNameCount: nonNegativeInteger(report.summary.duplicateNameCount),
              scriptBearingCount: nonNegativeInteger(report.summary.scriptBearingCount),
              findingCount: nonNegativeInteger(report.summary.findingCount)
            },
            values: findings
          };
        });
        return apiSuccess({ summary: doctor.metadata, findings: doctor.page }, context);
      }

      const source = await pageRevisionValues(this.#pageCache, name, pagination, read.servingRevision, async () => {
        const report = await readJson<{
          coverage?: string;
          inventorySkills?: number;
          trackedSkills?: number;
          records?: Array<Record<string, unknown>>;
        }>(approvedArtifactPath(read, 'source-status.json'));
        const records = (report.records ?? []).map((record) => {
          const skillId = qualifiedSkillId(record.skillId) ? record.skillId : null;
          return {
            skillId,
            displayName: redactedMetadataLabel(record.skill, skillId ?? 'unknown'),
            contentRevision: digestOrNull(record.contentRevision),
            state: mcpSourceState(record.state),
            risk: mcpSourceRisk(record.risk),
            upstreamCommit: typeof record.upstreamCommit === 'string' && /^[a-f0-9]{40,64}$/.test(record.upstreamCommit)
              ? record.upstreamCommit
              : null
          };
        });
        return {
          metadata: {
            coverage: mcpSourceCoverage(report.coverage),
            inventorySkills: nonNegativeInteger(report.inventorySkills),
            trackedSkills: nonNegativeInteger(report.trackedSkills)
          },
          values: records
        };
      });
      return apiSuccess({ ...source.metadata, records: source.page }, context);
    } catch (error) {
      throw mapLocalSkillMapMcpToolError(error, context);
    }
  }
}

export function createLocalSkillMapMcpRuntime(
  cwd: string,
  options: LocalSkillMapMcpRuntimeOptions = {}
): LocalSkillMapMcpRuntime {
  return new LocalSkillMapMcpRuntime(cwd, options);
}

async function pageRevisionValues<M, T>(
  cache: Map<string, CachedRevisionPage>,
  tool: string,
  input: PaginatedMcpInput,
  revision: RevisionRef,
  build: () => Promise<{ metadata: M; values: readonly T[] }> | { metadata: M; values: readonly T[] }
): Promise<{
  metadata: M;
  page: { items: T[]; limit: number; hasMore: boolean; nextCursor: string | null; sortKey: 'stable-v1' };
}> {
  const cacheKey = hashText(canonicalJson({ tool, revision }));
  let cached = cache.get(cacheKey);
  if (!cached) {
    const material = await build();
    cached = {
      metadata: material.metadata,
      values: material.values,
      binding: hashText(canonicalJson({ tool, revisionId: revision.revisionId, values: material.values }))
    };
    cache.set(cacheKey, cached);
    while (cache.size > 6) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  } else {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
  }

  const values = cached.values as readonly T[];
  const limit = input.limit ?? 20;
  const start = input.cursor ? decodeCursor(input.cursor, tool, cached.binding) : 0;
  const items = values.slice(start, start + limit);
  const next = start + items.length;
  return {
    metadata: cached.metadata as M,
    page: {
      items,
      limit,
      hasMore: next < values.length,
      nextCursor: next < values.length ? encodeCursor(tool, cached.binding, next) : null,
      sortKey: 'stable-v1'
    }
  };
}

function encodeCursor(tool: string, binding: string, offset: number): string {
  const body = { version: 1, tool, binding, offset };
  return Buffer.from(JSON.stringify({ ...body, digest: hashText(canonicalJson(body)) }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, tool: string, binding: string): number {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('cursor is invalid.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('cursor is invalid.');
  const record = value as Record<string, unknown>;
  const required = ['binding', 'digest', 'offset', 'tool', 'version'];
  if (Object.keys(record).sort().join('\0') !== required.join('\0')) throw new Error('cursor is invalid.');
  const { digest, ...body } = record;
  if (
    record.version !== 1
    || record.tool !== tool
    || record.binding !== binding
    || !Number.isInteger(record.offset)
    || (record.offset as number) < 0
    || digest !== hashText(canonicalJson(body))
  ) throw new Error('cursor is stale or invalid.');
  return record.offset as number;
}

function contextFromRead(read: ApprovedWorkspaceRead): ApiReceiptContext {
  return receiptContext(
    read.servingRevision,
    read.currentRevision,
    read.state.source === 'last-known-good'
  );
}

function receiptContext(
  servingRevision: RevisionRef,
  currentRevision: RevisionRef,
  degraded: boolean
): ApiReceiptContext {
  return {
    servingRevision,
    currentRevision,
    compatibility: degraded ? 'degraded' : 'compatible'
  };
}

export function mapLocalSkillMapMcpToolError(
  error: unknown,
  context?: ApiReceiptContext
): SkillMapMcpToolError {
  if (error instanceof SkillMapMcpToolError) return error;
  const rawMessage = error instanceof Error ? error.message : '';
  const candidateCode = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
  let code = 'TOOL_CALL_FAILED';
  let message = 'The SkillMap tool call failed.';
  if (/^APPROVED_[A-Z0-9_]{1,56}$/.test(candidateCode)) {
    code = candidateCode;
    message = 'The approved SkillMap state is unavailable.';
  } else if (/current canonical or raw routing state differs from the last explicitly approved revision/i.test(rawMessage)) {
    code = 'APPROVED_REVISION_STALE';
    message = 'Current canonical or raw routing state differs from the last explicitly approved revision.';
  } else if (/not found/i.test(rawMessage)) {
    code = 'SKILL_NOT_FOUND';
    message = 'Skill was not found in the approved revision.';
  } else if (/cursor/i.test(rawMessage)) {
    code = 'INVALID_CURSOR';
    message = 'Pagination cursor is stale or invalid.';
  }
  return new SkillMapMcpToolError(code, message, {
    ...(context ? { context } : {})
  });
}

function approvedEffectiveMissing(): Error {
  const error = new Error('The approved workspace revision has no effective routing registry.');
  Object.assign(error, { code: 'APPROVED_EFFECTIVE_MISSING' });
  return error;
}

function digestOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value) ? value : null;
}

function qualifiedSkillId(value: unknown): value is string {
  return typeof value === 'string' && /^sk_[A-Za-z0-9_-]{43}$/.test(value);
}

function mcpOpaqueIdentifier(namespace: string, value: unknown): string {
  return `${namespace}_${hashText(typeof value === 'string' ? value : canonicalJson(value)).slice('sha256:'.length, 39)}`;
}

function mcpGraphIdentifier(value: string): string {
  return redactedMetadataLabel(value, '') === value ? value : mcpOpaqueIdentifier('node', value);
}

function mcpGraphNodeType(value: unknown): string {
  return typeof value === 'string' && ['skill', 'policy-skill', 'root', 'risk', 'resource', 'family', 'intent'].includes(value)
    ? value
    : 'other';
}

function mcpGraphEdgeType(value: unknown): string {
  return typeof value === 'string' && [
    'installed_at',
    'risk_flag',
    'has_reference',
    'belongs_to',
    'supersedes',
    'overlaps',
    'preferred_for',
    'avoid_for'
  ].includes(value)
    ? value
    : 'related';
}

function mcpGraphSource(value: unknown): 'scan' | 'policy' | 'doctor' | 'source' | 'curation' | 'eval' {
  return typeof value === 'string' && ['scan', 'policy', 'doctor', 'source', 'curation', 'eval'].includes(value)
    ? value as 'scan' | 'policy' | 'doctor' | 'source' | 'curation' | 'eval'
    : 'scan';
}

function mcpDoctorSeverity(value: unknown): 'P0' | 'P1' | 'P2' | 'P3' {
  return typeof value === 'string' && ['P0', 'P1', 'P2', 'P3'].includes(value)
    ? value as 'P0' | 'P1' | 'P2' | 'P3'
    : 'P3';
}

const MCP_DOCTOR_PRESENTATIONS = Object.freeze({
  'duplicate-name': { title: 'Duplicate skill names require policy review.', code: 'doctor-duplicate-name' },
  'invalid-frontmatter': { title: 'Skill frontmatter is invalid.', code: 'doctor-invalid-frontmatter' },
  'missing-description': { title: 'A skill description is missing.', code: 'doctor-missing-description' },
  'script-bearing': { title: 'A skill contains executable scripts.', code: 'doctor-script-bearing' },
  'large-body': { title: 'A skill body is unusually large.', code: 'doctor-large-body' },
  'long-description': { title: 'A skill description is unusually long.', code: 'doctor-long-description' },
  'broad-trigger': { title: 'A skill uses broad routing language.', code: 'doctor-broad-trigger' },
  'duplicate-description': { title: 'Skill descriptions are duplicated.', code: 'doctor-duplicate-description' },
  unknown: { title: 'A SkillMap diagnostic finding requires review.', code: 'doctor-unknown' }
} as const);

function mcpDoctorPresentation(id: unknown): (typeof MCP_DOCTOR_PRESENTATIONS)[keyof typeof MCP_DOCTOR_PRESENTATIONS] {
  const category = typeof id === 'string' ? id.split(':', 1)[0] : 'unknown';
  return Object.hasOwn(MCP_DOCTOR_PRESENTATIONS, category)
    ? MCP_DOCTOR_PRESENTATIONS[category as keyof typeof MCP_DOCTOR_PRESENTATIONS]
    : MCP_DOCTOR_PRESENTATIONS.unknown;
}

function mcpSourceCoverage(value: unknown): 'not-configured' | 'not-applicable' | 'partial' | 'covered' {
  return typeof value === 'string' && ['not-configured', 'not-applicable', 'partial', 'covered'].includes(value)
    ? value as 'not-configured' | 'not-applicable' | 'partial' | 'covered'
    : 'not-configured';
}

function mcpSourceState(value: unknown): string {
  return typeof value === 'string' && [
    'external-clean',
    'external-modified',
    'external-stale',
    'external-risky-update',
    'local-authored',
    'local-modified',
    'unknown'
  ].includes(value)
    ? value
    : 'unknown';
}

function mcpSourceRisk(value: unknown): 'low' | 'high' | null {
  return value === 'low' || value === 'high' ? value : null;
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}
