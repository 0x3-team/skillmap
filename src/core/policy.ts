import { readFile } from 'node:fs/promises';
import type { EffectiveRegistry, EffectiveSkill, Inventory, Policy, SkillPolicyEntry, SkillTier } from '../schemas/types.js';
import { buildGraph } from './graph.js';

const TIERS = new Set<SkillTier>(['active-default', 'specialist', 'explicit-only', 'archived', 'blocked']);
type ListKey = 'aliases' | 'preferred_for' | 'avoid_for' | 'overlaps' | 'supersedes';

export const EMPTY_POLICY: Policy = { version: 1, skills: {} };

export async function readPolicy(file?: string): Promise<Policy> {
  if (!file) return EMPTY_POLICY;
  const text = await readFile(file, 'utf8');
  if (file.endsWith('.json')) return validatePolicy(JSON.parse(text));
  return validatePolicy(parsePolicyYaml(text));
}

export function validatePolicy(policy: unknown): Policy {
  const raw = policy as Policy;
  if (!raw || raw.version !== 1 || typeof raw.skills !== 'object' || raw.skills === null) {
    throw new Error('Policy must have version: 1 and a skills object.');
  }
  for (const [name, entry] of Object.entries(raw.skills)) {
    if (!name.trim()) throw new Error('Policy contains an empty skill name.');
    if (entry.tier && !TIERS.has(entry.tier)) throw new Error(`Invalid tier for ${name}: ${entry.tier}`);
    for (const listKey of ['aliases', 'preferred_for', 'avoid_for', 'overlaps', 'supersedes'] as const) {
      const value = entry[listKey];
      if (value !== undefined && !Array.isArray(value)) throw new Error(`${name}.${listKey} must be a list.`);
    }
  }
  return raw;
}

export function parsePolicyYaml(text: string): Policy {
  const policy: Policy = { version: 1, skills: {} };
  let currentSkill: string | undefined;
  let currentList: ListKey | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^version:\s*1\s*$/.test(line)) continue;
    if (/^skills:\s*$/.test(line)) continue;
    const skillMatch = line.match(/^ {2}([^\s][^:]*):\s*$/);
    if (skillMatch) {
      currentSkill = skillMatch[1].trim();
      policy.skills[currentSkill] = policy.skills[currentSkill] ?? {};
      currentList = undefined;
      continue;
    }
    const fieldMatch = line.match(/^ {4}([A-Za-z0-9_]+):\s*(.*)$/);
    if (fieldMatch && currentSkill) {
      const [, key, value] = fieldMatch as [string, keyof SkillPolicyEntry, string];
      if (isListKey(key)) {
        currentList = key;
        assignList(policy.skills[currentSkill], key, value ? [stripQuotes(value)] : []);
      } else {
        currentList = undefined;
        (policy.skills[currentSkill] as Record<string, unknown>)[key] = stripQuotes(value);
      }
      continue;
    }
    const listMatch = line.match(/^ {6}-\s*(.*)$/);
    if (listMatch && currentSkill && currentList) {
      const list = (policy.skills[currentSkill][currentList] ?? []) as string[];
      list.push(stripQuotes(listMatch[1]));
      assignList(policy.skills[currentSkill], currentList, list);
    }
  }
  return policy;
}

export function renderPolicy(policy: Policy): string {
  const lines = ['version: 1', 'skills:'];
  for (const [name, entry] of Object.entries(policy.skills).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${name}:`);
    if (entry.tier) lines.push(`    tier: ${entry.tier}`);
    if (entry.family) lines.push(`    family: ${entry.family}`);
    for (const key of ['aliases', 'preferred_for', 'avoid_for', 'overlaps', 'supersedes'] as const) {
      const list = entry[key];
      if (list && list.length) {
        lines.push(`    ${key}:`);
        for (const item of list) lines.push(`      - ${item}`);
      }
    }
    if (entry.notes) lines.push(`    notes: ${entry.notes}`);
  }
  return `${lines.join('\n')}\n`;
}

export function buildEffectiveRegistry(inventory: Inventory, policy: Policy): EffectiveRegistry {
  const skills: EffectiveSkill[] = inventory.skills.map((skill) => {
    const entry = policy.skills[skill.name] ?? {};
    const tier = entry.tier ?? 'specialist';
    const effective: EffectiveSkill = {
      ...skill,
      tier,
      family: entry.family,
      aliases: entry.aliases ?? [],
      preferredFor: entry.preferred_for ?? [],
      avoidFor: entry.avoid_for ?? [],
      overlaps: entry.overlaps ?? [],
      supersedes: entry.supersedes ?? [],
      notes: entry.notes,
      routeEligible: tier !== 'archived' && tier !== 'blocked',
      effectiveReasons: []
    };
    effective.effectiveReasons.push(`tier=${tier}`);
    if (entry.family) effective.effectiveReasons.push(`family=${entry.family}`);
    if (entry.supersedes?.length) effective.effectiveReasons.push(`supersedes=${entry.supersedes.join(',')}`);
    return effective;
  });
  const graph = buildGraph(inventory, 'effective', policy, skills);
  return { version: 1, generatedAt: new Date().toISOString(), inventory, policy, skills, graph };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function isListKey(key: string): key is ListKey {
  return ['aliases', 'preferred_for', 'avoid_for', 'overlaps', 'supersedes'].includes(key);
}

function assignList(entry: SkillPolicyEntry, key: ListKey, value: string[]): void {
  switch (key) {
    case 'aliases':
      entry.aliases = value;
      break;
    case 'preferred_for':
      entry.preferred_for = value;
      break;
    case 'avoid_for':
      entry.avoid_for = value;
      break;
    case 'overlaps':
      entry.overlaps = value;
      break;
    case 'supersedes':
      entry.supersedes = value;
      break;
  }
}
