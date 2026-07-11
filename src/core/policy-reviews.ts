import type { Inventory, Policy, PolicyV2, SkillPolicyEntry, SkillTier } from '../schemas/types.js';
import { canonicalJson } from './canonical-payload.js';
import { hashText } from './fs.js';
import { duplicateDecisionMatchesInventory } from './policy-state.js';

export type PolicyReviewQueue = 'duplicate' | 'unmatched' | 'uncovered' | 'explicit-only' | 'blocked';
export type PolicyReviewAction = 'select-canonical' | 'set-skill-policy' | 'retire-unmatched';

export interface PolicyReviewQueueItem {
  reviewId: string;
  queue: PolicyReviewQueue;
  action: PolicyReviewAction;
  state: 'needs-review' | 'configured';
  blocking: boolean;
  displayName: string;
  rawKey: string;
  skillIds: string[];
  contentRevisions: string[];
  currentTier?: SkillTier;
  queueFingerprint: string;
}

export function buildPolicyReviewQueue(inventory: Inventory, policy: Policy): PolicyReviewQueueItem[] {
  const items: Omit<PolicyReviewQueueItem, 'reviewId' | 'queueFingerprint'>[] = [];
  const byName = new Map<string, Inventory['skills']>();
  const byId = new Map(inventory.skills.map((skill) => [skill.skillId, skill]));
  for (const skill of inventory.skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);

  for (const [name, variants] of [...byName.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (variants.length < 2 || (policy.version === 2 && duplicateDecisionMatchesInventory(policy, inventory, name))) continue;
    const sorted = [...variants].sort((left, right) => left.skillId.localeCompare(right.skillId));
    items.push({
      queue: 'duplicate', action: 'select-canonical', state: 'needs-review', blocking: true,
      displayName: name, rawKey: name,
      skillIds: sorted.map((skill) => skill.skillId),
      contentRevisions: sorted.map((skill) => skill.contentRevision)
    });
  }

  if (policy.version === 1) {
    for (const name of Object.keys(policy.skills).filter((name) => !byName.has(name)).sort()) {
      items.push({ queue: 'unmatched', action: 'retire-unmatched', state: 'needs-review', blocking: true, displayName: name, rawKey: name, skillIds: [], contentRevisions: [] });
    }
    for (const [name, variants] of [...byName.entries()].filter(([name]) => !policy.skills[name]).sort(([left], [right]) => left.localeCompare(right))) {
      if (variants.length !== 1) continue;
      const skill = variants[0];
      items.push({ queue: 'uncovered', action: 'set-skill-policy', state: 'needs-review', blocking: true, displayName: name, rawKey: skill.skillId, skillIds: [skill.skillId], contentRevisions: [skill.contentRevision] });
    }
  } else {
    for (const skillId of Object.keys(policy.skillsById).filter((skillId) => !byId.has(skillId)).sort()) {
      items.push({ queue: 'unmatched', action: 'retire-unmatched', state: 'needs-review', blocking: true, displayName: skillId, rawKey: skillId, skillIds: [skillId], contentRevisions: [] });
    }
    for (const name of policy.migration.unresolvedNames.filter((name) => !byName.has(name)).sort()) {
      items.push({ queue: 'unmatched', action: 'retire-unmatched', state: 'needs-review', blocking: true, displayName: name, rawKey: name, skillIds: [], contentRevisions: [] });
    }
    for (const [name, variants] of [...byName.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (variants.length !== 1) continue;
      const skill = variants[0];
      const entry = policy.skillsById[skill.skillId];
      if (!entry) {
        items.push({ queue: 'uncovered', action: 'set-skill-policy', state: 'needs-review', blocking: true, displayName: name, rawKey: skill.skillId, skillIds: [skill.skillId], contentRevisions: [skill.contentRevision] });
      } else if (entry.tier === 'explicit-only' || entry.tier === 'blocked') {
        items.push({
          queue: entry.tier, action: 'set-skill-policy', state: 'configured', blocking: false,
          displayName: name, rawKey: skill.skillId, skillIds: [skill.skillId], contentRevisions: [skill.contentRevision], currentTier: entry.tier
        });
      }
    }
    for (const skill of [...inventory.skills].sort((left, right) => left.skillId.localeCompare(right.skillId))) {
      if ((byName.get(skill.name)?.length ?? 0) < 2) continue;
      const entry = policy.skillsById[skill.skillId];
      if (entry?.tier !== 'explicit-only' && entry?.tier !== 'blocked') continue;
      items.push({
        queue: entry.tier, action: 'set-skill-policy', state: 'configured', blocking: false,
        displayName: skill.name, rawKey: skill.skillId, skillIds: [skill.skillId], contentRevisions: [skill.contentRevision], currentTier: entry.tier
      });
    }
  }

  return items.map((item) => {
    const queueFingerprint = hashText(canonicalJson(item));
    return { ...item, reviewId: `pr_${queueFingerprint.slice('sha256:'.length, 'sha256:'.length + 40)}`, queueFingerprint };
  }).slice(0, 200);
}

export function setReviewedSkillPolicy(policy: PolicyV2, inventory: Inventory, skillId: string, tier: SkillTier): PolicyV2 {
  const skill = inventory.skills.find((candidate) => candidate.skillId === skillId);
  if (!skill) throw new Error('The reviewed skill identity is not present in the current inventory.');
  if (!['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'].includes(tier)) throw new Error('The reviewed policy tier is invalid.');
  const next = clonePolicy(policy);
  next.skillsById[skillId] = { ...(next.skillsById[skillId] ?? {}), tier };
  return next;
}

export function retireUnmatchedPolicyEntry(policy: PolicyV2, inventory: Inventory, rawKey: string): PolicyV2 {
  const next = clonePolicy(policy);
  const currentIds = new Set(inventory.skills.map((skill) => skill.skillId));
  const currentNames = new Set(inventory.skills.map((skill) => skill.name));
  if (Object.prototype.hasOwnProperty.call(next.skillsById, rawKey)) {
    if (currentIds.has(rawKey)) throw new Error('A current policy entry cannot be retired through the unmatched queue.');
    delete next.skillsById[rawKey];
    return next;
  }
  if (next.migration.unresolvedNames.includes(rawKey)) {
    if (currentNames.has(rawKey)) throw new Error('A current unresolved name cannot be retired through the unmatched queue.');
    next.migration.unresolvedNames = next.migration.unresolvedNames.filter((name) => name !== rawKey);
    delete next.migration.unresolvedEntries[rawKey];
    return next;
  }
  throw new Error('The unmatched policy entry is no longer present.');
}

function clonePolicy(policy: PolicyV2): PolicyV2 {
  return JSON.parse(JSON.stringify(policy)) as PolicyV2;
}
