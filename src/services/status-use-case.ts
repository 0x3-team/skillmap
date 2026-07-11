import { buildSkillMapStatus, type SkillMapStatus } from '../core/status.js';
import { prepareEvalRunV3StatusContext } from './eval-release-context.js';
import { openApprovedWorkspaceRead, type ApprovedWorkspaceRead } from './workspace-read-model.js';

export async function buildApprovedStatus(cwd: string, captured?: ApprovedWorkspaceRead): Promise<{ status: SkillMapStatus; approved: ApprovedWorkspaceRead; routing?: ApprovedWorkspaceRead; routingReady: boolean }> {
  const approved = captured ?? await openApprovedWorkspaceRead(cwd, 'status');
  let evalReleaseSnapshot;
  let evalReleaseContextIssue: string | undefined;
  try {
    evalReleaseSnapshot = await prepareEvalRunV3StatusContext(cwd, approved);
  } catch (error) {
    evalReleaseContextIssue = error instanceof Error ? error.message : String(error);
  }
  const status = await buildSkillMapStatus(approved.revisionRoot, {
    immutableRevision: true,
    servingRevision: approved.servingRevision,
    ...(evalReleaseSnapshot ? { evalReleaseSnapshot } : {}),
    ...(evalReleaseContextIssue ? { evalReleaseContextIssue } : {})
  });
  status.cwd = cwd;
  let routingReady = false;
  let routingStateCode = 'STATE_ROUTING_APPROVAL_REQUIRED';
  let routing: ApprovedWorkspaceRead | undefined;
  try {
    routing = await openApprovedWorkspaceRead(cwd, 'routing');
    routingReady = routing.state.source === 'current'
      && routing.servingRevision.revisionId === approved.currentRevision.revisionId;
    if (!routingReady && routing.state.source === 'last-known-good') routingStateCode = 'STATE_ROUTING_REVISION_NOT_CURRENT';
  } catch (error) {
    routingStateCode = stateCode(error) ?? routingStateCode;
  }
  if (approved.state.source === 'last-known-good') {
    status.readinessPhase = 'state-corrupt';
    status.warnings.unshift(`Serving explicit last-known-good revision ${approved.servingRevision.revisionId}; current revision failed derived validation.`);
    status.nextActions = ['skillmap state status --json', 'skillmap state recover --confirm'];
  } else if (!routingReady) {
    status.warnings.unshift(`Current revision is not the exact explicitly approved routing revision (${routingStateCode}).`);
    if (status.readinessPhase === 'ready') {
      status.readinessPhase = 'needs-routing-approval';
      status.nextActions = ['skillmap apply-policy --dry-run', 'skillmap apply-policy'];
    }
  }
  for (const divergence of approved.state.legacyDivergence) status.warnings.push(`Legacy projection ${divergence.path}: ${divergence.code} (${divergence.severity}).`);
  if (status.verdict === 'ok' && (status.readinessPhase !== 'ready' || status.warnings.length > 0)) status.verdict = 'attention required';
  return { status, approved, ...(routing ? { routing } : {}), routingReady };
}

function stateCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' && /^STATE_[A-Z0-9_]+$/.test(value) ? value : undefined;
}
