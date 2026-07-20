import { canonicalJson } from '../core/canonical-payload.js';
import { hashText } from '../core/fs.js';
import { redactedMetadataDescription, redactedMetadataLabel } from '../core/redacted-metadata.js';
import {
  SkillDiscoveryIndexCache,
  searchSkillOrdinalsWithDiscoveryIndex,
  skillDiscoveryMcpSearchHaystack,
  skillDiscoveryMcpSort,
  skillDiscoverySearchHaystack,
  skillDiscoverySort,
  type SkillDiscoverySearchExposure,
  type SkillDiscoveryStrategy,
  type SkillDiscoveryStrategyComparison
} from '../core/skill-discovery-index.js';
import type { EffectiveSkill, RevisionRef } from '../schemas/types.js';
import {
  openApprovedWorkspaceRead,
  type ApprovedWorkspaceRead
} from './workspace-read-model.js';

export interface SkillDiscoverySearchInput {
  query?: string;
  cursor?: string;
  limit: number;
}

export interface SkillDiscoveryPage<T> {
  items: T[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  sortKey: 'stable-v1';
}

export interface SkillDiscoverySelection {
  page: SkillDiscoveryPage<EffectiveSkill>;
  comparison: SkillDiscoveryStrategyComparison;
}

export interface SkillDiscoveryUseCaseOptions {
  strategy?: SkillDiscoveryStrategy;
  indexCache?: SkillDiscoveryIndexCache;
  onStrategyComparison?: (comparison: SkillDiscoveryStrategyComparison) => void;
  searchExposure?: SkillDiscoverySearchExposure;
}

export interface SkillDiscoveryUseCase {
  readonly servingRevision: RevisionRef;
  readonly currentRevision: RevisionRef;
  readonly strategy: SkillDiscoveryStrategy;
  select(input: SkillDiscoverySearchInput): SkillDiscoverySelection;
  search(input: SkillDiscoverySearchInput): SkillDiscoveryPage<EffectiveSkill>;
  getSkill(skillId: string): EffectiveSkill;
}

export interface SkillDiscoveryBaseSummary {
  skillId: string;
  displayName: string;
  contentRevision: string;
  tier: EffectiveSkill['tier'];
  routeEligible: boolean;
  qualifiedExplicitAllowed: boolean;
  variantState: EffectiveSkill['variantState'];
  hasScripts: boolean;
}

export interface McpSkillSummary extends SkillDiscoveryBaseSummary {
  referenceCount: number;
  assetCount: number;
  trust: 'parsed' | 'invalid-frontmatter';
}

export interface LocalSkillSummary extends SkillDiscoveryBaseSummary {
  sourceScope: EffectiveSkill['scope'];
  description: string;
}

const MAX_QUERY_BYTES = 256;
const MAX_CURSOR_BYTES = 1_024;
const MAX_PAGE_SIZE = 100;
const CURSOR_TOOL = 'search_skills';

/** Open the immutable approved routing read before constructing discovery. */
export async function openApprovedSkillDiscovery(
  cwd: string,
  options: SkillDiscoveryUseCaseOptions = {}
): Promise<SkillDiscoveryUseCase> {
  const read = await openApprovedWorkspaceRead(cwd, 'routing');
  return createSkillDiscoveryUseCase(read, options);
}

/** Pure request-independent use case over one already-approved workspace read. */
export function createSkillDiscoveryUseCase(
  read: ApprovedWorkspaceRead,
  options: SkillDiscoveryUseCaseOptions = {}
): SkillDiscoveryUseCase {
  const effective = read.effective;
  if (!effective) throw approvedEffectiveMissing();
  const strategy = options.strategy ?? 'reference';
  const indexCache = options.indexCache ?? new SkillDiscoveryIndexCache(2);
  const searchExposure = options.searchExposure ?? 'local';
  const skillById = new Map(effective.skills.map((skill) => [skill.skillId, skill]));

  const select = (input: SkillDiscoverySearchInput): SkillDiscoverySelection => {
    const limit = normalizeSkillDiscoveryLimit(input.limit);
    const query = normalizeSkillDiscoveryQuery(input.query);
    const referenceOrdinals = strategy === 'indexed'
      ? undefined
      : referenceSearchOrdinals(effective.skills, query, searchExposure);
    const revisionDigest = read.servingRevision.effectiveRevisionDigest;
    let selectedOrdinals: number[];
    let comparison: SkillDiscoveryStrategyComparison;

    if (strategy === 'reference') {
      selectedOrdinals = referenceOrdinals ?? [];
      const resultDigest = ordinalResultDigest(selectedOrdinals, effective.skills);
      comparison = {
        strategy,
        effectiveRevisionDigest: revisionDigest ?? 'reference-unbound',
        candidateCount: selectedOrdinals.length,
        totalSkillCount: effective.skills.length,
        referenceCompared: false,
        matched: null,
        referenceDigest: null,
        indexedDigest: resultDigest
      };
    } else {
      if (!revisionDigest) throw new Error(`${strategy} discovery strategy requires an approved effective revision digest.`);
      const index = indexCache.getOrCompile(effective.skills, revisionDigest);
      const indexedOrdinals = searchSkillOrdinalsWithDiscoveryIndex(index, effective.skills, revisionDigest, query, searchExposure);
      const indexedDigest = ordinalResultDigest(indexedOrdinals, effective.skills);
      if (strategy === 'indexed') {
        selectedOrdinals = indexedOrdinals;
        comparison = {
          strategy,
          effectiveRevisionDigest: revisionDigest,
          candidateCount: indexedOrdinals.length,
          totalSkillCount: effective.skills.length,
          referenceCompared: false,
          matched: null,
          referenceDigest: null,
          indexedDigest
        };
      } else {
        const stableReferenceOrdinals = referenceOrdinals ?? [];
        const referenceDigest = ordinalResultDigest(stableReferenceOrdinals, effective.skills);
        selectedOrdinals = stableReferenceOrdinals;
        comparison = {
          strategy,
          effectiveRevisionDigest: revisionDigest,
          candidateCount: indexedOrdinals.length,
          totalSkillCount: effective.skills.length,
          referenceCompared: true,
          matched: referenceDigest === indexedDigest,
          referenceDigest,
          indexedDigest
        };
      }
    }

    options.onStrategyComparison?.(comparison);
    const selectedSkills = selectedOrdinals.map((ordinal) => effective.skills[ordinal]);
    return {
      page: pageSkills(selectedSkills, { ...input, limit }, query, read.servingRevision),
      comparison
    };
  };

  return Object.freeze({
    servingRevision: read.servingRevision,
    currentRevision: read.currentRevision,
    strategy,
    select,
    search: (input: SkillDiscoverySearchInput) => select(input).page,
    getSkill: (skillId: string): EffectiveSkill => {
      const skill = skillById.get(skillId);
      if (!skill) throw new Error('Skill was not found in the approved revision.');
      return skill;
    }
  });
}

export function projectSkillDiscoveryBaseSummary(skill: EffectiveSkill): SkillDiscoveryBaseSummary {
  return {
    skillId: skill.skillId,
    displayName: redactedMetadataLabel(skill.name, skill.skillId),
    contentRevision: skill.contentRevision,
    tier: skill.tier,
    routeEligible: skill.routeEligible,
    qualifiedExplicitAllowed: skill.qualifiedExplicitAllowed,
    variantState: skill.variantState,
    hasScripts: skill.hasScripts
  };
}

/** Explicit MCP projection: never add description, scope, path, or body fields. */
export function projectMcpSkillSummary(skill: EffectiveSkill): McpSkillSummary {
  return {
    ...projectSkillDiscoveryBaseSummary(skill),
    referenceCount: skill.referenceCount,
    assetCount: skill.assetCount,
    trust: skill.frontmatterValid ? 'parsed' : 'invalid-frontmatter'
  };
}

/** MCP detail intentionally remains the same metadata-only allowlist. */
export function projectMcpSkillDetail(skill: EffectiveSkill): McpSkillSummary {
  return projectMcpSkillSummary(skill);
}

/** Explicit richer loopback-API projection; still redacted and path-free. */
export function projectLocalSkillSummary(skill: EffectiveSkill): LocalSkillSummary {
  return {
    ...projectSkillDiscoveryBaseSummary(skill),
    sourceScope: skill.scope,
    description: redactedMetadataDescription(skill.description, 500)
  };
}

export function normalizeSkillDiscoveryQuery(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error('Skill search query must be a string.');
  if (value.includes('\0')) throw new Error('Skill search query contains a forbidden NUL byte.');
  if (Buffer.byteLength(value, 'utf8') > MAX_QUERY_BYTES) {
    throw new Error(`Skill search query exceeds the ${MAX_QUERY_BYTES}-byte limit.`);
  }
  // Preserve the established loopback API behavior while giving MCP and local
  // callers one exact search contract: trim ASCII/Unicode edge whitespace,
  // case-fold, and then apply substring matching to the canonical haystack.
  return value.trim().toLowerCase();
}

export function normalizeSkillDiscoveryLimit(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_PAGE_SIZE) {
    throw new Error(`Skill search limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value as number;
}

function referenceSearchOrdinals(
  skills: readonly EffectiveSkill[],
  query: string,
  exposure: SkillDiscoverySearchExposure
): number[] {
  const haystack = exposure === 'mcp' ? skillDiscoveryMcpSearchHaystack : skillDiscoverySearchHaystack;
  const sort = exposure === 'mcp' ? skillDiscoveryMcpSort : skillDiscoverySort;
  return skills
    .map((_, ordinal) => ordinal)
    .filter((ordinal) => !query || haystack(skills[ordinal]).includes(query))
    .sort((leftOrdinal, rightOrdinal) => sort(skills[leftOrdinal], skills[rightOrdinal]));
}

function pageSkills(
  values: EffectiveSkill[],
  input: SkillDiscoverySearchInput,
  normalizedQuery: string,
  revision: RevisionRef
): SkillDiscoveryPage<EffectiveSkill> {
  const binding = hashText(canonicalJson({
    version: 1,
    tool: CURSOR_TOOL,
    revisionId: revision.revisionId,
    effectiveRevisionDigest: revision.effectiveRevisionDigest,
    query: normalizedQuery,
    skillIds: values.map((skill) => skill.skillId)
  }));
  const offset = input.cursor ? decodeCursor(input.cursor, binding) : 0;
  const items = values.slice(offset, offset + input.limit);
  const next = offset + items.length;
  return {
    items,
    limit: input.limit,
    hasMore: next < values.length,
    nextCursor: next < values.length ? encodeCursor(binding, next) : null,
    sortKey: 'stable-v1'
  };
}

function encodeCursor(binding: string, offset: number): string {
  const body = { version: 1, tool: CURSOR_TOOL, binding, offset };
  return Buffer.from(JSON.stringify({ ...body, digest: hashText(canonicalJson(body)) }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, binding: string): number {
  if (Buffer.byteLength(cursor, 'utf8') > MAX_CURSOR_BYTES || cursor.includes('\0')) {
    throw new Error('Pagination cursor is invalid.');
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Pagination cursor is invalid.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pagination cursor is invalid.');
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['version', 'tool', 'binding', 'offset', 'digest'])) throw new Error('Pagination cursor is invalid.');
  const { digest, ...body } = record;
  if (
    record.version !== 1
    || record.tool !== CURSOR_TOOL
    || record.binding !== binding
    || !Number.isInteger(record.offset)
    || (record.offset as number) < 0
    || digest !== hashText(canonicalJson(body))
  ) {
    throw new Error('Pagination cursor is stale or invalid.');
  }
  return record.offset as number;
}

function exactKeys(record: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(record).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function ordinalResultDigest(ordinals: readonly number[], skills: readonly EffectiveSkill[]): string {
  return hashText(canonicalJson(ordinals.map((ordinal) => skills[ordinal]?.skillId ?? null)));
}

function approvedEffectiveMissing(): Error {
  const error = new Error('The approved workspace revision has no effective routing registry.');
  error.name = 'ApprovedStateUnavailableError';
  Object.assign(error, { code: 'APPROVED_EFFECTIVE_MISSING' });
  return error;
}
