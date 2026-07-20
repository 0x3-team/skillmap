import { canonicalJson } from './canonical-payload.js';
import { hashText } from './fs.js';
import { redactedMetadataLabel } from './redacted-metadata.js';
import {
  prepareRouteRankingSkill,
  rankPreparedRoutePrompt,
  rankRoutePrompt,
  type PreparedRouteRankingSkill,
  type RouteRankingResult,
  type RouteRankingSkill
} from '../contracts/route-ranking.js';

export const SKILL_DISCOVERY_INDEX_SCHEMA_VERSION: 1 = 1;
export type SkillDiscoveryStrategy = 'reference' | 'shadow' | 'indexed';

export interface SkillDiscoveryIndexEntry {
  ordinal: number;
  skillId: string;
  routingMetadataDigest: string;
  searchHaystack: string;
  mcpSearchHaystack: string;
}

export interface SkillDiscoveryIndex {
  schemaVersion: typeof SKILL_DISCOVERY_INDEX_SCHEMA_VERSION;
  effectiveRevisionDigest: string;
  skillCount: number;
  entries: readonly SkillDiscoveryIndexEntry[];
  searchOrdinals: readonly number[];
  mcpSearchOrdinals: readonly number[];
  routePostings: Readonly<Record<string, readonly number[]>>;
  routeAlwaysCheckOrdinals: readonly number[];
  routePolicySensitiveOrdinals: readonly number[];
  skillOrdinalById: Readonly<Record<string, number>>;
  indexDigest: string;
}

export interface SkillDiscoveryStrategyComparison {
  strategy: SkillDiscoveryStrategy;
  effectiveRevisionDigest: string;
  candidateCount: number;
  totalSkillCount: number;
  referenceCompared: boolean;
  matched: boolean | null;
  referenceDigest: string | null;
  indexedDigest: string;
}

export interface IndexedRouteRankingOptions {
  strategy: SkillDiscoveryStrategy;
  index?: SkillDiscoveryIndex;
  effectiveRevisionDigest?: string;
  /** Test/acceptance-only equality check. Runtime indexed mode leaves this off. */
  verifyIndexed?: boolean;
}

export interface IndexedRouteRankingResult {
  result: RouteRankingResult;
  comparison: SkillDiscoveryStrategyComparison;
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const preparedSkillsByIndex = new WeakMap<SkillDiscoveryIndex, readonly PreparedRouteRankingSkill[]>();

/**
 * Compile only deterministic, approved-registry metadata. No timestamps, paths,
 * prompts, bodies, or request state enter the index or its digest.
 */
export function compileSkillDiscoveryIndex(
  skills: readonly RouteRankingSkill[],
  effectiveRevisionDigest: string
): SkillDiscoveryIndex {
  assertRevisionDigest(effectiveRevisionDigest);
  const preparedSkills = skills.map(prepareRouteRankingSkill);
  const seenIds = new Set<string>();
  const postings = new Map<string, number[]>();
  const alwaysCheck = new Set<number>();
  const policySensitive: number[] = [];
  const skillOrdinalById = Object.create(null) as Record<string, number>;

  const entries = skills.map((skill, ordinal): SkillDiscoveryIndexEntry => {
    if (!skill.skillId || seenIds.has(skill.skillId)) {
      throw new Error(`Skill discovery index requires unique non-empty skill IDs; duplicate at ordinal ${ordinal}.`);
    }
    seenIds.add(skill.skillId);
    skillOrdinalById[skill.skillId] = ordinal;

    const positiveFields = [skill.name, skill.description, ...skill.aliases, ...skill.preferredFor, skill.family ?? ''];
    for (const token of conservativeIndexTokens(positiveFields.join(' '))) {
      const ordinals = postings.get(token);
      if (ordinals) ordinals.push(ordinal);
      else postings.set(token, [ordinal]);
    }

    // These fields can score through exact bounded phrase matching even when
    // the ranker's prompt-token path has no usable ASCII token (for example
    // "go", "C++", or a Unicode-only name). Checking this bounded subset is
    // conservative and cannot reduce recall.
    const boundedPositiveFields = [skill.name, ...skill.aliases, ...skill.preferredFor];
    if (boundedPositiveFields.some((value) => value.length > 0 && conservativeIndexTokens(value).length === 0)) {
      alwaysCheck.add(ordinal);
    }

    if (skill.tier === 'blocked' || skill.tier === 'archived' || skill.tier === 'explicit-only' || !skill.routeEligible) {
      policySensitive.push(ordinal);
    }

    return {
      ordinal,
      skillId: skill.skillId,
      routingMetadataDigest: hashText(canonicalJson({
        name: normalizeIndexedText(skill.name),
        description: normalizeIndexedText(skill.description),
        aliases: skill.aliases.map(normalizeIndexedText),
        preferredFor: skill.preferredFor.map(normalizeIndexedText),
        avoidFor: skill.avoidFor.map(normalizeIndexedText),
        family: skill.family ? normalizeIndexedText(skill.family) : null,
        tier: skill.tier,
        routeEligible: skill.routeEligible,
        qualifiedExplicitAllowed: skill.qualifiedExplicitAllowed,
        variantState: skill.variantState,
        hasScripts: skill.hasScripts,
        supersedes: skill.supersedes.map(normalizeIndexedText)
      })),
      searchHaystack: searchHaystack(skill),
      mcpSearchHaystack: mcpSearchHaystack(skill)
    };
  });

  const searchOrdinals = skills
    .map((_, ordinal) => ordinal)
    .sort((leftOrdinal, rightOrdinal) => skillDiscoverySort(skills[leftOrdinal], skills[rightOrdinal]));
  const mcpSearchOrdinals = skills
    .map((_, ordinal) => ordinal)
    .sort((leftOrdinal, rightOrdinal) => skillDiscoveryMcpSort(skills[leftOrdinal], skills[rightOrdinal]));
  const routePostings = Object.create(null) as Record<string, readonly number[]>;
  for (const token of [...postings.keys()].sort(codePointCompare)) {
    routePostings[token] = postings.get(token) ?? [];
  }

  const material = {
    schemaVersion: SKILL_DISCOVERY_INDEX_SCHEMA_VERSION,
    effectiveRevisionDigest,
    skillCount: skills.length,
    entries,
    searchOrdinals,
    mcpSearchOrdinals,
    routePostings,
    routeAlwaysCheckOrdinals: [...alwaysCheck].sort(numberCompare),
    routePolicySensitiveOrdinals: policySensitive,
    skillOrdinalById
  };
  const index = {
    ...material,
    indexDigest: hashText(canonicalJson(material))
  } satisfies SkillDiscoveryIndex;
  const frozen = deepFreeze(index);
  preparedSkillsByIndex.set(frozen, preparedSkills);
  return frozen;
}

export function serializeSkillDiscoveryIndex(index: SkillDiscoveryIndex): string {
  assertIndexShape(index);
  return canonicalJson(index);
}

/** Exact current substring search over precomputed lower-case haystacks. */
export function searchSkillOrdinalsWithDiscoveryIndex(
  index: SkillDiscoveryIndex,
  skills: readonly RouteRankingSkill[],
  effectiveRevisionDigest: string,
  query: string,
  exposure: SkillDiscoverySearchExposure = 'local'
): number[] {
  assertIndexBinding(index, skills, effectiveRevisionDigest);
  const normalizedQuery = query.toLowerCase();
  const ordinals: number[] = [];
  const searchOrdinals = exposure === 'mcp' ? index.mcpSearchOrdinals : index.searchOrdinals;
  for (const ordinal of searchOrdinals) {
    const entry = index.entries[ordinal];
    const skill = skills[ordinal];
    assertOrdinalBinding(entry, skill, ordinal);
    const haystack = exposure === 'mcp' ? entry.mcpSearchHaystack : entry.searchHaystack;
    if (!normalizedQuery || haystack.includes(normalizedQuery)) ordinals.push(ordinal);
  }
  return ordinals;
}

/**
 * Execute the existing full scanner over a conservative exact candidate
 * superset. The scanner still owns scoring, exclusions, supersession, sorting,
 * and hook rendering; this module only avoids scoring provably irrelevant
 * eligible skills.
 */
export function rankRoutePromptWithDiscoveryIndex(
  skills: readonly RouteRankingSkill[],
  prompt: string,
  max = 3,
  qualifiedSkillId?: string,
  options: IndexedRouteRankingOptions = { strategy: 'reference' }
): IndexedRouteRankingResult {
  if (options.strategy === 'reference') {
    const result = rankRoutePrompt(skills, prompt, max, qualifiedSkillId);
    return {
      result,
      comparison: {
        strategy: 'reference',
        effectiveRevisionDigest: options.effectiveRevisionDigest ?? 'reference-unbound',
        candidateCount: skills.length,
        totalSkillCount: skills.length,
        referenceCompared: false,
        matched: null,
        referenceDigest: null,
        indexedDigest: canonicalResultDigest(result)
      }
    };
  }

  const index = options.index;
  const effectiveRevisionDigest = options.effectiveRevisionDigest;
  if (!index || !effectiveRevisionDigest) {
    throw new Error(`${options.strategy} discovery strategy requires a revision-bound index.`);
  }
  assertIndexBinding(index, skills, effectiveRevisionDigest);
  const candidateOrdinals = selectRouteCandidateOrdinals(index, skills, prompt, qualifiedSkillId);
  const candidateSkills = candidateOrdinals.map((ordinal) => skills[ordinal]);
  const preparedSkills = preparedSkillsByIndex.get(index) ?? skills.map(prepareRouteRankingSkill);
  const candidatePreparedSkills = candidateOrdinals.map((ordinal) => preparedSkills[ordinal]);
  const indexedResult = rankPreparedRoutePrompt(candidatePreparedSkills, prompt, max, qualifiedSkillId);
  const indexedDigest = canonicalResultDigest(indexedResult);

  if (options.strategy === 'indexed' && !options.verifyIndexed) {
    return {
      result: indexedResult,
      comparison: {
        strategy: 'indexed',
        effectiveRevisionDigest,
        candidateCount: candidateSkills.length,
        totalSkillCount: skills.length,
        referenceCompared: false,
        matched: null,
        referenceDigest: null,
        indexedDigest
      }
    };
  }

  const referenceResult = rankRoutePrompt(skills, prompt, max, qualifiedSkillId);
  const referenceDigest = canonicalResultDigest(referenceResult);
  const matched = referenceDigest === indexedDigest;
  if (options.strategy === 'indexed' && !matched) {
    throw new Error(`Skill discovery index semantic mismatch: reference=${referenceDigest}; indexed=${indexedDigest}.`);
  }
  return {
    result: options.strategy === 'shadow' ? referenceResult : indexedResult,
    comparison: {
      strategy: options.strategy,
      effectiveRevisionDigest,
      candidateCount: candidateSkills.length,
      totalSkillCount: skills.length,
      referenceCompared: true,
      matched,
      referenceDigest,
      indexedDigest
    }
  };
}

export class SkillDiscoveryIndexCache {
  readonly #maximumRevisions: number;
  readonly #indexes = new Map<string, SkillDiscoveryIndex>();

  constructor(maximumRevisions = 2) {
    if (!Number.isInteger(maximumRevisions) || maximumRevisions < 1 || maximumRevisions > 16) {
      throw new Error('Skill discovery index cache size must be an integer between 1 and 16.');
    }
    this.#maximumRevisions = maximumRevisions;
  }

  get size(): number {
    return this.#indexes.size;
  }

  getOrCompile(skills: readonly RouteRankingSkill[], effectiveRevisionDigest: string): SkillDiscoveryIndex {
    assertRevisionDigest(effectiveRevisionDigest);
    const cached = this.#indexes.get(effectiveRevisionDigest);
    if (cached) {
      assertIndexBinding(cached, skills, effectiveRevisionDigest);
      this.#indexes.delete(effectiveRevisionDigest);
      this.#indexes.set(effectiveRevisionDigest, cached);
      return cached;
    }
    const compiled = compileSkillDiscoveryIndex(skills, effectiveRevisionDigest);
    this.#indexes.set(effectiveRevisionDigest, compiled);
    while (this.#indexes.size > this.#maximumRevisions) {
      const oldest = this.#indexes.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#indexes.delete(oldest);
    }
    return compiled;
  }

  revisionDigests(): string[] {
    return [...this.#indexes.keys()];
  }

  clear(): void {
    this.#indexes.clear();
  }
}

export function skillDiscoverySort(left: RouteRankingSkill, right: RouteRankingSkill): number {
  return left.name.localeCompare(right.name) || left.skillId.localeCompare(right.skillId);
}

export function skillDiscoverySearchHaystack(skill: RouteRankingSkill): string {
  return searchHaystack(skill);
}

export function skillDiscoveryMcpSort(left: RouteRankingSkill, right: RouteRankingSkill): number {
  const leftLabel = redactedMetadataLabel(left.name, left.skillId);
  const rightLabel = redactedMetadataLabel(right.name, right.skillId);
  return leftLabel.localeCompare(rightLabel) || left.skillId.localeCompare(right.skillId);
}

export type SkillDiscoverySearchExposure = 'local' | 'mcp';

export function skillDiscoveryMcpSearchHaystack(skill: RouteRankingSkill): string {
  return mcpSearchHaystack(skill);
}

function selectRouteCandidateOrdinals(
  index: SkillDiscoveryIndex,
  skills: readonly RouteRankingSkill[],
  prompt: string,
  qualifiedSkillId?: string
): number[] {
  if (qualifiedSkillId) {
    const ordinal = index.skillOrdinalById[qualifiedSkillId];
    // Preserve the scanner's canonical missing-qualified-id error.
    if (ordinal === undefined) return skills.map((_, candidateOrdinal) => candidateOrdinal);
    assertOrdinalBinding(index.entries[ordinal], skills[ordinal], ordinal);
    return [ordinal];
  }

  const selected = new Set<number>([
    ...index.routeAlwaysCheckOrdinals,
    ...index.routePolicySensitiveOrdinals
  ]);
  for (const token of conservativeIndexTokens(prompt)) {
    const ordinals = index.routePostings[token];
    if (!ordinals) continue;
    for (const ordinal of ordinals) selected.add(ordinal);
  }
  if (selected.size === skills.length) return skills.map((_, ordinal) => ordinal);
  const ordered = [...selected].sort(numberCompare);
  for (const ordinal of ordered) assertOrdinalBinding(index.entries[ordinal], skills[ordinal], ordinal);
  return ordered;
}

function searchHaystack(skill: RouteRankingSkill): string {
  return [skill.skillId, skill.name, skill.description, ...skill.aliases, ...skill.preferredFor].join(' ').toLowerCase();
}

function mcpSearchHaystack(skill: RouteRankingSkill): string {
  return [skill.skillId, redactedMetadataLabel(skill.name, skill.skillId)].join(' ').toLowerCase();
}

/**
 * Deliberately broader than the ranker's tokenization. Extra candidates cost
 * work but cannot change results; excluding stop words here could cause a miss
 * if ranking semantics later become more permissive.
 */
function conservativeIndexTokens(value: string): string[] {
  return [...new Set(normalizeIndexedText(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 3))];
}

function normalizeIndexedText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function assertIndexBinding(
  index: SkillDiscoveryIndex,
  skills: readonly RouteRankingSkill[],
  effectiveRevisionDigest: string
): void {
  assertIndexShape(index);
  assertRevisionDigest(effectiveRevisionDigest);
  if (index.effectiveRevisionDigest !== effectiveRevisionDigest) {
    throw new Error(`Skill discovery index revision binding mismatch: expected ${effectiveRevisionDigest}; received ${index.effectiveRevisionDigest}.`);
  }
  if (index.skillCount !== skills.length || index.entries.length !== skills.length) {
    throw new Error('Skill discovery index registry binding mismatch: skill count changed.');
  }
}

function assertIndexShape(index: SkillDiscoveryIndex): void {
  if (!index || index.schemaVersion !== SKILL_DISCOVERY_INDEX_SCHEMA_VERSION || !DIGEST_PATTERN.test(index.indexDigest)) {
    throw new Error('Skill discovery index is malformed or has an unsupported schema version.');
  }
}

function assertOrdinalBinding(
  entry: SkillDiscoveryIndexEntry | undefined,
  skill: RouteRankingSkill | undefined,
  ordinal: number
): void {
  if (!entry || !skill || entry.ordinal !== ordinal || entry.skillId !== skill.skillId) {
    throw new Error(`Skill discovery index registry binding mismatch at ordinal ${ordinal}.`);
  }
}

function assertRevisionDigest(value: string): void {
  if (!DIGEST_PATTERN.test(value)) throw new Error('Skill discovery index requires a lowercase sha256 effective revision digest.');
}

function canonicalResultDigest(value: unknown): string {
  // Route candidates intentionally use optional properties with undefined at
  // runtime. JSON-RPC/CLI serialization omits them, so compare the same public
  // JSON projection rather than an in-memory object artifact.
  return hashText(canonicalJson(JSON.parse(JSON.stringify(value))));
}

function numberCompare(left: number, right: number): number {
  return left - right;
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
