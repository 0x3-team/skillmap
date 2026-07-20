import { normalizeRouteRankingLimit, rankRoutePrompt } from '../contracts/route-ranking.js';
import {
  SkillDiscoveryIndexCache,
  rankRoutePromptWithDiscoveryIndex,
  type SkillDiscoveryStrategy,
  type SkillDiscoveryStrategyComparison
} from './skill-discovery-index.js';
import type { EffectiveRegistry, RouteDecisionCandidate, RouteDecisionExclusion, RouteResult } from '../schemas/types.js';
import { redactedMetadataLabel } from './redacted-metadata.js';

export interface SemanticRouteDecision {
  recommendations: RouteDecisionCandidate[];
  exclusions: RouteDecisionExclusion[];
  hookText: string;
}

export interface RouteDiscoveryOptions {
  strategy?: SkillDiscoveryStrategy;
  indexCache?: SkillDiscoveryIndexCache;
  effectiveRevisionDigest?: string | null;
  verifyIndexed?: boolean;
  onStrategyComparison?: (comparison: SkillDiscoveryStrategyComparison) => void;
}

export function routePrompt(
  registry: EffectiveRegistry,
  prompt: string,
  max = 3,
  qualifiedSkillId?: string,
  options: RouteDiscoveryOptions = {}
): RouteResult {
  const ranked = executeRouteRanking(registry, prompt, max, qualifiedSkillId, options);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    prompt,
    recommendations: ranked.recommendations,
    exclusions: ranked.exclusions,
    hookText: ranked.hookText
  };
}

/**
 * Return only deterministic, redacted routing semantics. Runtime adapters add
 * the approved revision receipt, route id, timestamp, latency, and event.
 */
export function routeSemanticDecision(
  registry: EffectiveRegistry,
  prompt: string,
  max = 3,
  qualifiedSkillId?: string,
  options: RouteDiscoveryOptions = {}
): SemanticRouteDecision {
  const legacy = routePrompt(registry, prompt, normalizeRouteLimit(max), qualifiedSkillId, options);
  const recommendations = legacy.recommendations.map((candidate) => ({
    skillId: candidate.skillId,
    displayName: redactedMetadataLabel(candidate.name, candidate.skillId),
    score: candidate.score,
    tier: candidate.tier,
    reasonCodes: [...new Set(candidate.reasons.map(routeReasonCode))].sort()
  }));
  const exclusions = legacy.exclusions.map((exclusion) => ({
    ...(exclusion.skillId ? { skillId: exclusion.skillId } : {}),
    displayName: redactedMetadataLabel(exclusion.name, exclusion.skillId ?? 'unqualified-skill'),
    reasonCode: exclusionReasonCode(exclusion.reason)
  }));
  return {
    recommendations,
    exclusions,
    hookText: legacy.hookText
  };
}

function executeRouteRanking(
  registry: EffectiveRegistry,
  prompt: string,
  max: number,
  qualifiedSkillId: string | undefined,
  options: RouteDiscoveryOptions
) {
  const strategy = options.strategy ?? 'reference';
  if (strategy === 'reference') return rankRoutePrompt(registry.skills, prompt, max, qualifiedSkillId);
  const effectiveRevisionDigest = options.effectiveRevisionDigest;
  if (!effectiveRevisionDigest) throw new Error(`${strategy} route discovery requires an approved effective revision digest.`);
  const indexCache = options.indexCache;
  if (!indexCache) throw new Error(`${strategy} route discovery requires an injected bounded index cache.`);
  const index = indexCache.getOrCompile(registry.skills, effectiveRevisionDigest);
  const execution = rankRoutePromptWithDiscoveryIndex(registry.skills, prompt, max, qualifiedSkillId, {
    strategy,
    index,
    effectiveRevisionDigest,
    ...(options.verifyIndexed ? { verifyIndexed: true } : {})
  });
  options.onStrategyComparison?.(execution.comparison);
  return execution.result;
}

export function normalizeRouteLimit(value: number): number {
  return normalizeRouteRankingLimit(value);
}

function routeReasonCode(reason: string): string {
  if (reason.startsWith('qualified skillId')) return 'explicit-qualified-id';
  if (reason.startsWith('skill name')) return 'explicit-display-name';
  if (reason.startsWith('name token:')) return 'name-token-match';
  if (reason.startsWith('description token:')) return 'description-token-match';
  if (reason.startsWith('alias:')) return 'alias-match';
  if (reason.startsWith('preferred_for:')) return 'preferred-intent-match';
  if (reason.startsWith('avoid_for:')) return 'avoid-intent-match';
  if (reason.startsWith('family:')) return 'family-match';
  if (reason.startsWith('active-default')) return 'active-default-boost';
  if (reason.startsWith('specialist')) return 'specialist-tier';
  if (reason.startsWith('script-bearing')) return 'script-bearing-caution';
  return 'scored-match';
}

function exclusionReasonCode(reason: string): string {
  if (reason.startsWith('tier=blocked')) return 'tier-blocked';
  if (reason.startsWith('tier=archived')) return 'tier-archived';
  if (reason.startsWith('qualified invocation')) return 'qualified-invocation-blocked';
  if (reason.startsWith('variant=')) return 'implicit-routing-disabled';
  if (reason.startsWith('explicit-only')) return 'explicit-only-not-requested';
  if (reason.startsWith('superseded by')) return 'superseded';
  return 'excluded';
}
