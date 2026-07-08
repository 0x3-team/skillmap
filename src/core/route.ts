import type { EffectiveRegistry, EffectiveSkill, RouteCandidate, RouteExclusion, RouteResult } from '../schemas/types.js';

export function routePrompt(registry: EffectiveRegistry, prompt: string, max = 3): RouteResult {
  const tokens = tokenize(prompt);
  const named = new Set(registry.skills.filter((skill) => prompt.toLowerCase().includes(skill.name.toLowerCase())).map((skill) => skill.name));
  const candidates: RouteCandidate[] = [];
  const exclusions: RouteExclusion[] = [];

  for (const skill of registry.skills) {
    if (skill.tier === 'blocked' || skill.tier === 'archived') {
      exclusions.push({ name: skill.name, reason: `tier=${skill.tier}` });
      continue;
    }
    if (skill.tier === 'explicit-only' && !named.has(skill.name)) {
      exclusions.push({ name: skill.name, reason: 'explicit-only and not named in prompt' });
      continue;
    }
    const scored = scoreSkill(skill, tokens, prompt);
    if (scored.score >= 5) candidates.push(scored);
  }

  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
  for (const candidate of [...candidates]) {
    const skill = registry.skills.find((s) => s.name === candidate.name);
    if (!skill) continue;
    for (const superseded of skill.supersedes) {
      if (byName.has(superseded)) {
        byName.delete(superseded);
        exclusions.push({ name: superseded, reason: `superseded by ${skill.name}` });
      }
    }
  }

  const recommendations = [...byName.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, max);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    prompt,
    recommendations,
    exclusions: exclusions.slice(0, 12),
    hookText: renderHookText(recommendations, exclusions)
  };
}

function scoreSkill(skill: EffectiveSkill, tokens: Set<string>, prompt: string): RouteCandidate {
  const reasons: string[] = [];
  let score = 0;
  const add = (amount: number, reason: string) => {
    score += amount;
    reasons.push(reason);
  };
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes(skill.name.toLowerCase())) add(10, 'skill name explicitly mentioned');
  for (const token of uniqueTokens(skill.name)) if (tokens.has(token)) add(2, `name token:${token}`);
  for (const token of uniqueTokens(skill.description)) if (tokens.has(token)) add(1, `description token:${token}`);
  for (const alias of skill.aliases) if (phraseMatches(alias, lowerPrompt, tokens)) add(5, `alias:${alias}`);
  for (const intent of skill.preferredFor) if (phraseMatches(intent, lowerPrompt, tokens)) add(6, `preferred_for:${intent}`);
  for (const avoid of skill.avoidFor) if (phraseMatches(avoid, lowerPrompt, tokens)) add(-8, `avoid_for:${avoid}`);
  if (skill.family && tokens.has(skill.family.toLowerCase())) add(4, `family:${skill.family}`);
  if (score > 0 && skill.tier === 'active-default') add(5, 'active-default tier boost');
  if (score > 0 && skill.tier === 'specialist') add(1, 'specialist tier');
  if (score > 0 && skill.hasScripts) add(-1, 'script-bearing caution');
  return { name: skill.name, score, tier: skill.tier, family: skill.family, path: skill.path, reasons };
}

function phraseMatches(phrase: string, lowerPrompt: string, tokens: Set<string>): boolean {
  const lower = phrase.toLowerCase();
  if (lowerPrompt.includes(lower)) return true;
  const parts = phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((token) => token.length >= 2 && !STOP.has(token));
  return parts.length > 0 && parts.every((part) => tokens.has(part));
}

function renderHookText(recommendations: RouteCandidate[], exclusions: RouteExclusion[]): string {
  if (recommendations.length === 0) return 'SkillMap: no confident skill recommendation.';
  const rec = recommendations.map((item) => `${item.name}${item.family ? ` (${item.family})` : ''}`).join(', ');
  const avoid = exclusions.filter((item) => item.reason.includes('superseded')).slice(0, 2);
  const suffix = avoid.length ? ` Avoid: ${avoid.map((item) => `${item.name}: ${item.reason}`).join('; ')}.` : '';
  return `SkillMap: prefer ${rec}.${suffix}`.slice(0, 500);
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
