import { readFile } from 'node:fs/promises';
import type { EffectiveRegistry, EffectiveSkill, Inventory, Policy, PolicyV1, SkillPolicyEntry, SkillTier, SkillVariantState } from '../schemas/types.js';
import { buildGraph } from './graph.js';
import { duplicateDecisionMatchesInventory, resolveActivePolicyFile, validatePolicyV2 } from './policy-state.js';

const TIERS = new Set<SkillTier>(['active-default', 'specialist', 'explicit-only', 'archived', 'blocked']);
type ListKey = 'aliases' | 'preferred_for' | 'avoid_for' | 'overlaps' | 'supersedes';

export const EMPTY_POLICY: PolicyV1 = { version: 1, skills: Object.create(null) as Record<string, SkillPolicyEntry> };

export async function readPolicy(file?: string): Promise<Policy> {
  if (!file) return EMPTY_POLICY;
  const text = await readFile(file, 'utf8');
  if (file.endsWith('.json')) return validatePolicy(JSON.parse(text));
  return validatePolicy(parsePolicyYaml(text));
}

export async function readActivePolicy(cwd: string, explicitFile?: string): Promise<{ policy: Policy; file?: string }> {
  const activeFile = explicitFile ?? await resolveActivePolicyFile(cwd);
  if (activeFile) return { policy: await readPolicy(activeFile), file: activeFile };
  const legacyFile = `${cwd}/.skillmap/policy.yml`;
  try {
    return { policy: await readPolicy(legacyFile), file: legacyFile };
  } catch (error) {
    if (isMissingFile(error)) return { policy: EMPTY_POLICY };
    throw error;
  }
}

export function validatePolicy(policy: unknown): Policy {
  if (policy && typeof policy === 'object' && !Array.isArray(policy) && (policy as { version?: unknown }).version === 2) {
    return validatePolicyV2(policy);
  }
  const raw = policy as PolicyV1;
  if (!raw || raw.version !== 1 || typeof raw.skills !== 'object' || raw.skills === null || Array.isArray(raw.skills)) {
    throw new Error('Policy must have version: 1 and a skills object.');
  }
  const skills = Object.create(null) as Record<string, SkillPolicyEntry>;
  for (const [name, entry] of Object.entries(raw.skills)) {
    if (!name.trim()) throw new Error('Policy contains an empty skill name.');
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Policy entry for ${name} must be an object.`);
    const allowed = new Set(['tier', 'family', 'aliases', 'preferred_for', 'avoid_for', 'overlaps', 'supersedes', 'notes']);
    const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
    if (unknown.length) throw new Error(`Policy entry for ${name} contains unknown field(s): ${unknown.join(', ')}.`);
    if (entry.tier && !TIERS.has(entry.tier)) throw new Error(`Invalid tier for ${name}: ${entry.tier}`);
    for (const listKey of ['aliases', 'preferred_for', 'avoid_for', 'overlaps', 'supersedes'] as const) {
      const value = entry[listKey];
      if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) throw new Error(`${name}.${listKey} must be a string list.`);
    }
    skills[name] = { ...entry };
  }
  return { version: 1, skills };
}

export function parsePolicyYaml(text: string): PolicyV1 {
  const policy: PolicyV1 = { version: 1, skills: Object.create(null) as Record<string, SkillPolicyEntry> };
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
      if (!Object.prototype.hasOwnProperty.call(policy.skills, currentSkill)) policy.skills[currentSkill] = {};
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
        if (key !== 'tier' && key !== 'family' && key !== 'notes') throw new Error(`Unsupported policy field ${String(key)} for ${currentSkill}.`);
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
  if (policy.version === 2) return `${JSON.stringify(policy, null, 2)}\n`;
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
  const byName = new Map<string, Inventory['skills']>();
  for (const skill of inventory.skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  const validCanonical = new Map<string, string>();
  if (policy.version === 2) {
    for (const [name, variants] of byName) {
      if (variants.length > 1 && duplicateDecisionMatchesInventory(policy, inventory, name)) {
        validCanonical.set(name, policy.canonicalByName[name]);
      }
    }
  }
  const skills: EffectiveSkill[] = inventory.skills.map((skill) => {
    const exactNamePolicy = policy.version === 1 && Object.prototype.hasOwnProperty.call(policy.skills, skill.name);
    const entry = policy.version === 1 ? (exactNamePolicy ? policy.skills[skill.name] : {}) : policy.skillsById[skill.skillId] ?? {};
    const tier = entry.tier ?? 'specialist';
    const variants = byName.get(skill.name) ?? [skill];
    const canonicalSkillId = validCanonical.get(skill.name);
    const variantState: SkillVariantState = variants.length === 1
      ? 'unique'
      : canonicalSkillId === skill.skillId
        ? 'canonical'
        : canonicalSkillId
          ? 'shadowed-duplicate'
          : 'unresolved-duplicate';
    const exactVariantPolicy = policy.version === 2 && Boolean(policy.skillsById[skill.skillId]);
    const qualifiedExplicitAllowed = tier !== 'archived'
      && tier !== 'blocked'
      && skill.implicitAllowed
      && skill.frontmatterValid
      // Policy v2 is identity-qualified and therefore deny-by-default. A newly
      // observed identity must receive an exact reviewed entry before either
      // implicit or qualified-explicit invocation can use it.
      && (policy.version === 1 ? exactNamePolicy : exactVariantPolicy);
    const routeEligible = qualifiedExplicitAllowed && (variantState === 'unique' || variantState === 'canonical');
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
      routeEligible,
      qualifiedExplicitAllowed,
      variantState,
      effectiveReasons: []
    };
    effective.effectiveReasons.push(`tier=${tier}`);
    effective.effectiveReasons.push(`variant=${variantState}`);
    if (entry.family) effective.effectiveReasons.push(`family=${entry.family}`);
    if (entry.supersedes?.length) effective.effectiveReasons.push(`supersedes=${entry.supersedes.join(',')}`);
    if (variantState === 'shadowed-duplicate') effective.effectiveReasons.push(`canonical=${canonicalSkillId}`);
    if (variantState === 'unresolved-duplicate') effective.effectiveReasons.push('implicit routing blocked pending canonical decision');
    if (policy.version === 2 && !exactVariantPolicy) effective.effectiveReasons.push('qualified identity has no reviewed policy v2 entry');
    if (policy.version === 1 && !exactNamePolicy) effective.effectiveReasons.push('display name has no reviewed policy v1 entry');
    return effective;
  });
  const graph = buildGraph(inventory, 'effective', policy, skills);
  return { version: policy.version, generatedAt: new Date().toISOString(), inventory, policy, skills, graph };
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

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT');
}
