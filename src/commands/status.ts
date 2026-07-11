import { buildSkillMapStatus, type SkillMapStatus } from '../core/status.js';
import { WorkspaceStateError } from '../core/workspace-state/index.js';
import { buildApprovedStatus } from '../services/status-use-case.js';

export async function statusCommand(cwd: string): Promise<unknown> {
  let approved: Awaited<ReturnType<typeof buildApprovedStatus>>['approved'];
  let status: SkillMapStatus;
  try {
    ({ approved, status } = await buildApprovedStatus(cwd));
  } catch (error) {
    if (error instanceof WorkspaceStateError && error.code === 'STATE_NOT_MIGRATED') {
      const status = await buildSkillMapStatus(cwd);
      status.verdict = 'blocked';
      if (status.readinessPhase === 'missing-inventory') {
        status.warnings.unshift('No approved workspace revision exists because the workspace has not been initialized and scanned.');
      } else {
        status.readinessPhase = 'needs-state-migration';
        status.warnings.unshift('Workspace state has not been migrated into an immutable approved revision. Run a mutating CLI workflow or `skillmap state migrate --confirm`.');
        status.nextActions = ['skillmap state migrate --confirm'];
      }
      return { status, revision: null, summary: renderStatus(status) };
    }
    if (error instanceof WorkspaceStateError) {
      const status: SkillMapStatus = {
        version: 1,
        generatedAt: new Date().toISOString(),
        verdict: 'blocked',
        readinessPhase: 'state-corrupt',
        cwd,
        artifacts: {},
        warnings: [
          `Approved workspace state is unavailable (${error.code}).`,
          'Automatic recovery is offered only when the current revision has derived-only corruption and an eligible last-known-good revision validates.'
        ],
        nextActions: ['skillmap state status --json', 'Repair or restore the marker, pointer, or canonical revision state after manual review']
      };
      return { status, revision: null, stateError: { code: error.code, message: error.message }, summary: renderStatus(status) };
    }
    throw error;
  }
  return {
    status,
    revision: {
      serving: approved.servingRevision,
      current: approved.currentRevision,
      servingMode: approved.state.source,
      stateHealth: approved.state.currentFailure?.code ?? 'verified'
    },
    summary: renderStatus(status)
  };
}

function renderStatus(status: SkillMapStatus): string {
  const lines = [`SkillMap status: ${status.verdict}`, `Readiness phase: ${status.readinessPhase}`, ''];
  if (status.config) {
    lines.push('Config:', `- Profile: ${status.config.profile}`, `- Roots: ${status.config.roots.length}`, '');
  }
  if (status.inventory) {
    lines.push('Inventory:', `- Skills: ${status.inventory.skills}`, `- Roots: ${status.inventory.roots}`, `- Root types: ${Object.entries(status.inventory.rootTypes).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`, `- Last scan: ${status.inventory.generatedAt}`, '');
  } else lines.push('Inventory: missing', '');
  if (status.policy) {
    lines.push('Policy:', `- Entries: ${status.policy.entries}`, `- Matched entries: ${status.policy.matchedEntries}`, `- Unmatched entries: ${status.policy.unmatchedEntries.length}`, `- Unresolved duplicate-name groups: ${status.policy.duplicateInventoryNameGroups.length}`, `- Tiers: ${Object.entries(status.policy.tiers).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`, '');
    if (status.policy.unmatchedEntries.length) lines.push(`- Unmatched sample: ${status.policy.unmatchedEntries.slice(0, 8).join(', ')}`, '');
    if (status.policy.duplicateInventoryNameGroups.length) lines.push(`- Duplicate sample: ${status.policy.duplicateInventoryNameGroups.slice(0, 8).map((group) => group.name).join(', ')}`, '');
  } else lines.push('Policy: missing or not validated', '');
  if (status.effective) lines.push('Effective registry:', `- Skills: ${status.effective.skills}`, `- Route eligible: ${status.effective.routeEligible}`, `- Graph: ${status.effective.graphNodes} nodes, ${status.effective.graphEdges} edges`, `- Stale: ${status.effective.stale ? 'yes' : 'no'}`, '');
  else lines.push('Effective registry: missing', '');
  if (status.curation?.present) lines.push('Curation:', '- Receipt: present', `- Host: ${status.curation.host}`, `- Model: ${status.curation.model}`, `- Model verification: ${status.curation.modelVerification}`, `- Stale: ${status.curation.stale ? 'yes' : 'no'}`, '');
  else lines.push('Curation:', '- Receipt: missing', '');
  if (status.sources) lines.push('Sources:', `- Coverage: ${status.sources.coverage}`, `- Classified skill names: ${status.sources.trackedSkills}/${status.sources.inventorySkills}`, `- External: ${status.sources.external}`, `- Local authored: ${status.sources.localAuthored}`, `- Unknown: ${status.sources.unknown}`, `- Modified: ${status.sources.modified}`, `- Updates available: ${status.sources.stale}`, `- Risky updates: ${status.sources.riskyUpdates}`, `- Unreviewed non-clean: ${status.sources.unreviewedNonClean}`, '');
  if (status.eval) lines.push('Eval:', `- Present: ${status.eval.present ? 'yes' : 'no'}`, `- Count: ${status.eval.count ?? 0}`, `- Evidence: ${status.eval.evidenceLevel ?? status.eval.confidence.level}`, `- Release eligible: ${status.eval.releaseEvidenceEligible ? 'yes' : 'no'}`, `- Confidence: ${status.eval.confidence.level}`, `- Pass: ${status.eval.pass ?? 'unknown'}`, `- Fixture: ${status.eval.fixture ? 'yes' : 'no'}`, '');
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
