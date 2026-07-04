import { buildSkillMapStatus, type SkillMapStatus } from '../core/status.js';

export async function statusCommand(cwd: string): Promise<unknown> {
  const status = await buildSkillMapStatus(cwd);
  return { status, summary: renderStatus(status) };
}

function renderStatus(status: SkillMapStatus): string {
  const lines = [`SkillMap status: ${status.verdict}`, ''];
  if (status.inventory) {
    lines.push('Inventory:');
    lines.push(`- Skills: ${status.inventory.skills}`);
    lines.push(`- Roots: ${status.inventory.roots.length}`);
    lines.push(`- Root types: ${formatRecord(status.inventory.rootTypes) || 'none'}`);
    lines.push(`- Last scan: ${status.inventory.generatedAt}`);
    lines.push('');
  } else {
    lines.push('Inventory: missing', '');
  }
  if (status.policy) {
    lines.push('Policy:');
    lines.push(`- Entries: ${status.policy.entries}`);
    lines.push(`- Matched entries: ${status.policy.matchedEntries}`);
    lines.push(`- Unmatched entries: ${status.policy.unmatchedEntries}`);
    if (status.policy.unmatchedSample.length) lines.push(`- Unmatched sample: ${status.policy.unmatchedSample.slice(0, 8).join(', ')}`);
    lines.push(`- Tiers: ${formatRecord(status.policy.tierCounts) || 'none'}`);
    lines.push('');
  } else {
    lines.push('Policy: missing', '');
  }
  if (status.effective) {
    lines.push('Effective registry:');
    lines.push(`- Skills: ${status.effective.skills}`);
    lines.push(`- Route eligible: ${status.effective.routeEligible}`);
    lines.push(`- Graph: ${status.effective.graphNodes} nodes, ${status.effective.graphEdges} edges`);
    lines.push(`- Stale: ${status.effective.stale ? 'yes' : 'no'}`);
    lines.push('');
  } else {
    lines.push('Effective registry: missing', '');
  }
  lines.push('Curation:');
  if (status.curation?.present) {
    lines.push(`- Host: ${status.curation.host}`);
    lines.push(`- Model: ${status.curation.model} (${status.curation.modelVerification})`);
    lines.push(`- Mode: ${status.curation.mode}`);
    lines.push(`- Stale: ${status.curation.stale ? 'yes' : 'no'}`);
  } else {
    lines.push('- Receipt: missing');
  }
  lines.push('');
  if (status.eval?.present) {
    lines.push('Eval:');
    lines.push(`- Cases: ${status.eval.count}`);
    lines.push(`- Pass: ${status.eval.pass}`);
    lines.push(`- Confidence: ${status.eval.confidence.level}`);
    lines.push('');
  }
  if (status.warnings.length) {
    lines.push('Warnings:');
    for (const warning of status.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  if (status.nextActions.length) {
    lines.push('Next actions:');
    for (const action of status.nextActions) lines.push(`- ${action}`);
  }
  return lines.join('\n').trimEnd();
}

function formatRecord(record: Record<string, number>): string {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(', ');
}
