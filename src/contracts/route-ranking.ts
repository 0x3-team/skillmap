export type RouteRankingTier = 'active-default' | 'specialist' | 'explicit-only' | 'archived' | 'blocked';
export type RouteRankingVariantState = 'unique' | 'canonical' | 'shadowed-duplicate' | 'unresolved-duplicate';

export interface RouteRankingSkill {
  skillId: string;
  name: string;
  description: string;
  tier: RouteRankingTier;
  family?: string;
  path: string;
  aliases: string[];
  preferredFor: string[];
  avoidFor: string[];
  supersedes: string[];
  routeEligible: boolean;
  qualifiedExplicitAllowed: boolean;
  variantState: RouteRankingVariantState;
  hasScripts: boolean;
}

export interface RouteRankingCandidate {
  skillId: string;
  name: string;
  score: number;
  tier: RouteRankingTier;
  family?: string;
  path: string;
  reasons: string[];
}

export interface RouteRankingExclusion {
  skillId?: string;
  name: string;
  reason: string;
}

export interface RouteRankingResult {
  recommendations: RouteRankingCandidate[];
  exclusions: RouteRankingExclusion[];
  hookText: string;
}

export const DEFAULT_ROUTE_RANKING_MAX = 3;
export const MAX_ROUTE_PROMPT_BYTES = 32 * 1024;

/** Exact prompt guard shared by CLI/API routing and contextual eval replay. */
export function validateRoutePrompt(prompt: unknown, qualified = false): string {
  if (typeof prompt !== 'string') throw new Error('Route prompt must be a string.');
  if (new TextEncoder().encode(prompt).byteLength > MAX_ROUTE_PROMPT_BYTES) {
    throw new Error(`Route prompt exceeds the ${MAX_ROUTE_PROMPT_BYTES}-byte limit.`);
  }
  if (!prompt.trim() && !qualified) throw new Error('Route prompt must not be empty.');
  if (prompt.includes('\u0000')) throw new Error('Route prompt contains a forbidden NUL byte.');
  return prompt;
}

/** Pure deterministic ranking shared by runtime routing and eval validation. */
export function rankRoutePrompt(
  skills: readonly RouteRankingSkill[],
  prompt: string,
  max = DEFAULT_ROUTE_RANKING_MAX,
  qualifiedSkillId?: string
): RouteRankingResult {
  const normalizedMax = normalizeRouteRankingLimit(max);
  const tokens = tokenize(prompt);
  // NFKC/case-fold the prompt once. Phrase matching may inspect thousands of
  // bounded policy entries; repeatedly normalizing the full prompt per entry
  // turns an otherwise bounded replay into an avoidable CPU amplifier.
  const normalizedPrompt = normalizePromptForPhraseSearch(prompt);
  if (qualifiedSkillId) {
    const skill = skills.find((entry) => entry.skillId === qualifiedSkillId);
    if (!skill) throw new Error(`Qualified skillId is not present in the effective registry: ${qualifiedSkillId}`);
    const exclusions: RouteRankingExclusion[] = [];
    if (skill.tier === 'blocked' || skill.tier === 'archived') {
      exclusions.push({ skillId: skill.skillId, name: skill.name, reason: `tier=${skill.tier}` });
    } else if (!skill.qualifiedExplicitAllowed) {
      exclusions.push({ skillId: skill.skillId, name: skill.name, reason: 'qualified invocation is blocked by policy or frontmatter' });
    }
    const recommendations = exclusions.length === 0 ? [scoreSkill(skill, tokens, normalizedPrompt, true)].slice(0, normalizedMax) : [];
    return { recommendations, exclusions, hookText: renderLegacyRouteHookText(recommendations, exclusions) };
  }
  const named = new Set(skills.filter((skill) => boundedPhraseIncludes(normalizedPrompt, skill.name)).map((skill) => skill.name));
  const candidates: RouteRankingCandidate[] = [];
  const exclusions: RouteRankingExclusion[] = [];

  for (const skill of skills) {
    if (skill.tier === 'blocked' || skill.tier === 'archived') {
      exclusions.push({ skillId: skill.skillId, name: skill.name, reason: `tier=${skill.tier}` });
      continue;
    }
    if (!skill.routeEligible) {
      exclusions.push({ skillId: skill.skillId, name: skill.name, reason: `variant=${skill.variantState}; implicit routing disabled` });
      continue;
    }
    if (skill.tier === 'explicit-only' && !named.has(skill.name)) {
      exclusions.push({ skillId: skill.skillId, name: skill.name, reason: 'explicit-only and not named in prompt' });
      continue;
    }
    const scored = scoreSkill(skill, tokens, normalizedPrompt, false);
    if (scored.score >= 5) candidates.push(scored);
  }

  const skillById = new Map(skills.map((skill) => [skill.skillId, skill]));
  const byId = new Map(candidates.map((candidate) => [candidate.skillId, candidate]));
  const candidatesByName = new Map<string, RouteRankingCandidate[]>();
  for (const candidate of candidates) {
    candidatesByName.set(candidate.name, [...(candidatesByName.get(candidate.name) ?? []), candidate]);
  }
  for (const candidate of [...candidates]) {
    const skill = skillById.get(candidate.skillId);
    if (!skill) continue;
    for (const superseded of skill.supersedes) {
      const targets = candidatesByName.get(superseded) ?? [];
      for (const target of targets) {
        if (byId.delete(target.skillId)) exclusions.push({ skillId: target.skillId, name: target.name, reason: `superseded by ${skill.name}` });
      }
      candidatesByName.delete(superseded);
    }
  }

  const recommendations = [...byId.values()]
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.skillId.localeCompare(right.skillId))
    .slice(0, normalizedMax);
  return {
    recommendations,
    exclusions: exclusions.slice(0, 12),
    hookText: renderLegacyRouteHookText(recommendations, exclusions)
  };
}

export function normalizeRouteRankingLimit(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Route max must be a finite number between 1 and 10.');
  const integer = Math.trunc(value);
  if (integer < 1 || integer > 10) throw new Error('Route max must be an integer between 1 and 10.');
  return integer;
}

/** Exact legacy hook renderer used by routePrompt, including its 500-character cap. */
export function renderLegacyRouteHookText(
  recommendations: readonly RouteRankingCandidate[],
  exclusions: readonly RouteRankingExclusion[]
): string {
  if (recommendations.length === 0) return 'SkillMap: no confident skill recommendation.';
  const rec = recommendations.map((item) => {
    const name = safeHookLabel(item.name, item.skillId);
    const family = item.family && isCodeLikeHookLabel(item.family) ? ` (${item.family})` : '';
    return `${name}${family}`;
  }).join(', ');
  const avoid = exclusions.filter((item) => item.reason.includes('superseded')).slice(0, 2);
  const suffix = avoid.length ? ` Avoid superseded: ${avoid.map((item) => item.skillId ?? safeHookLabel(item.name, 'unqualified-skill')).join(', ')}.` : '';
  return `SkillMap: prefer ${rec}.${suffix}`.slice(0, 500);
}

function scoreSkill(skill: RouteRankingSkill, tokens: Set<string>, normalizedPrompt: string, qualifiedMention = false): RouteRankingCandidate {
  const reasons: string[] = [];
  let score = 0;
  const add = (amount: number, reason: string): void => {
    score += amount;
    reasons.push(reason);
  };
  if (qualifiedMention) add(100, 'qualified skillId explicitly mentioned');
  if (boundedPhraseIncludes(normalizedPrompt, skill.name)) add(10, 'skill name explicitly mentioned');
  for (const token of uniqueTokens(skill.name)) if (tokens.has(token)) add(2, `name token:${token}`);
  for (const token of uniqueTokens(skill.description)) if (tokens.has(token)) add(1, `description token:${token}`);
  for (const alias of skill.aliases) if (phraseMatches(alias, normalizedPrompt, tokens)) add(5, `alias:${alias}`);
  for (const intent of skill.preferredFor) if (phraseMatches(intent, normalizedPrompt, tokens)) add(6, `preferred_for:${intent}`);
  for (const avoid of skill.avoidFor) if (phraseMatches(avoid, normalizedPrompt, tokens, { allowWeakSingleTerm: true })) add(-8, `avoid_for:${avoid}`);
  if (skill.family && tokens.has(skill.family.toLowerCase())) add(4, `family:${skill.family}`);
  if (score > 0 && skill.tier === 'active-default') add(5, 'active-default tier boost');
  if (score > 0 && skill.tier === 'specialist') add(1, 'specialist tier');
  if (score > 0 && skill.hasScripts) add(-1, 'script-bearing caution');
  return { skillId: skill.skillId, name: skill.name, score, tier: skill.tier, family: skill.family, path: skill.path, reasons };
}

function phraseMatches(
  phrase: string,
  normalizedPrompt: string,
  tokens: Set<string>,
  options: { allowWeakSingleTerm?: boolean } = {}
): boolean {
  const lower = phrase.toLowerCase();
  const parts = phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((token) => token.length >= 2 && !STOP.has(token));
  if (parts.length === 1 && WEAK_ROUTE_TERMS.has(parts[0]) && !options.allowWeakSingleTerm) return false;
  if (boundedPhraseIncludes(normalizedPrompt, lower)) return true;
  return parts.length > 0 && parts.every((part) => tokens.has(part));
}

function boundedPhraseIncludes(normalizedText: string, phrase: string): boolean {
  const lowerPhrase = phrase.normalize('NFKC').toLocaleLowerCase('en-US');
  if (lowerPhrase.length === 0) return false;
  let offset = 0;
  while (offset <= normalizedText.length - lowerPhrase.length) {
    const index = normalizedText.indexOf(lowerPhrase, offset);
    if (index < 0) return false;
    const before = index === 0 ? '' : Array.from(normalizedText.slice(Math.max(0, index - 2), index)).at(-1) ?? '';
    const afterIndex = index + lowerPhrase.length;
    const after = afterIndex >= normalizedText.length ? '' : Array.from(normalizedText.slice(afterIndex, afterIndex + 2))[0] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    offset = index + 1;
  }
  return false;
}

function normalizePromptForPhraseSearch(prompt: string): string {
  // Preserve the previous lower-case -> NFKC -> locale-fold ordering while
  // computing it once for the whole rank operation.
  return prompt.toLowerCase().normalize('NFKC').toLocaleLowerCase('en-US');
}

function safeHookLabel(displayName: string, skillId: string): string {
  return isCodeLikeHookLabel(displayName) ? displayName : skillId;
}

function isCodeLikeHookLabel(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,79}$/.test(value);
}

function tokenize(value: string): Set<string> {
  return new Set(tokenizeToArray(value));
}

function tokenizeToArray(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((token) => token.length > 2 && !STOP.has(token));
}

function uniqueTokens(value: string): Set<string> {
  return new Set(tokenizeToArray(value));
}

const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'use', 'using', 'when', 'you', 'your', 'our', 'are', 'was', 'were', 'task', 'skill', 'app', 'make', 'less', 'more', 'verify']);
const WEAK_ROUTE_TERMS = new Set(['app', 'apps', 'code', 'coding', 'dashboard', 'dashboards', 'review', 'reviews', 'task', 'tasks', 'tool', 'tools']);
