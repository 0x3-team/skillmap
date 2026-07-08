import { buildSkillMapStatus, type SkillMapStatus } from '../core/status.js';

export async function statusCommand(cwd: string): Promise<unknown> {
  const status = await buildSkillMapStatus(cwd);
  return { status, summary: renderStatus(status) };
}

function renderStatus(status: SkillMapStatus): string {
  const lines = [`SkillMap status: ${status.verdict}`, ''];
  if (status.inventory) {
    lines.push('Inventory:', `- Skills: ${status.inventory.skills}`, `- Roots: ${status.inventory.roots}`, `- Root types: ${Object.entries(status.inventory.rootTypes).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`, `- Last scan: ${status.inventory.generatedAt}`, '');
  } else lines.push('Inventory: missing', '');
  if (status.policy) {
    lines.push('Policy:', `- Entries: ${status.policy.entries}`, `- Matched entries: ${status.policy.matchedEntries}`, `- Unmatched entries: ${status.policy.unmatchedEntries.length}`, `- Tiers: ${Object.entries(status.policy.tiers).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`, '');
    if (status.policy.unmatchedEntries.length) lines.push(`- Unmatched sample: ${status.policy.unmatchedEntries.slice(0, 8).join(', ')}`, '');
  } else lines.push('Policy: missing or not validated', '');
  if (status.effective) lines.push('Effective registry:', `- Skills: ${status.effective.skills}`, `- Route eligible: ${status.effective.routeEligible}`, `- Graph: ${status.effective.graphNodes} nodes, ${status.effective.graphEdges} edges`, `- Stale: ${status.effective.stale ? 'yes' : 'no'}`, '');
  else lines.push('Effective registry: missing', '');
  if (status.curation?.present) lines.push('Curation:', '- Receipt: present', `- Host: ${status.curation.host}`, `- Model: ${status.curation.model}`, `- Model verification: ${status.curation.modelVerification}`, `- Stale: ${status.curation.stale ? 'yes' : 'no'}`, '');
  else lines.push('Curation:', '- Receipt: missing', '');
  if (status.sources) lines.push('Sources:', `- External: ${status.sources.external}`, `- Local authored: ${status.sources.localAuthored}`, `- Unknown: ${status.sources.unknown}`, `- Modified: ${status.sources.modified}`, `- Updates available: ${status.sources.stale}`, `- Risky updates: ${status.sources.riskyUpdates}`, '');
  if (status.eval) lines.push('Eval:', `- Present: ${status.eval.present ? 'yes' : 'no'}`, `- Count: ${status.eval.count ?? 0}`, `- Confidence: ${status.eval.confidence.level}`, `- Pass: ${status.eval.pass ?? 'unknown'}`, '');
  if (status.warnings.length) {
    lines.push('Warnings:');
    for (const warning of status.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  if (status.nextActions.length) {
    lines.push('Next actions:');
    for (const action of status.nextActions) lines.push(`- ${action}`);
  }
  return lines.join('\n');
}
