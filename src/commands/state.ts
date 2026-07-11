import { flagString, hasFlag } from '../core/args.js';
import { WorkspaceStateStore } from '../core/workspace-state/index.js';

export async function stateCommand(cwd: string, positionals: string[], flags: Record<string, string | boolean | string[]>): Promise<unknown> {
  const action = positionals[0] ?? 'status';
  const store = WorkspaceStateStore.open(cwd);
  if (action === 'status') {
    if (!await store.isMigrated()) return { migrated: false, summary: 'SkillMap workspace state is not migrated. Run `skillmap state migrate --confirm` after initialization.' };
    const read = await store.readCurrent({ purpose: 'status' });
    return {
      migrated: true,
      source: read.source,
      current: pointerReceipt(read.currentPointer),
      serving: pointerReceipt(read.selectedPointer),
      currentFailure: read.currentFailure,
      legacyDivergence: read.legacyDivergence,
      summary: `SkillMap workspace state: current=${read.currentPointer.revisionId}, serving=${read.selectedPointer.revisionId} (${read.source}), divergence=${read.legacyDivergence.length}.`
    };
  }
  if (action === 'migrate') {
    requireConfirm(flags, 'state migrate');
    const publication = await store.migrateLegacy({ confirm: true, approveForRouting: hasFlag(flags, 'approve-routing'), actor: flagString(flags, 'actor') ?? 'local-cli', reason: flagString(flags, 'reason') ?? 'Explicit legacy workspace migration.' });
    return publicationResult('Migrated', publication);
  }
  if (action === 'import-legacy') {
    requireConfirm(flags, 'state import-legacy');
    const current = await store.readCurrent({ purpose: 'status' });
    const publication = await store.publishLegacySnapshot({
      expectedRevisionId: current.currentPointer.revisionId,
      approveForRouting: hasFlag(flags, 'approve-routing'),
      actor: flagString(flags, 'actor') ?? 'local-cli',
      reason: flagString(flags, 'reason') ?? 'Explicitly imported reviewed legacy projection changes.'
    });
    return publicationResult('Imported reviewed legacy projections', publication);
  }
  if (action === 'rollback') {
    requireConfirm(flags, 'state rollback');
    const targetRevisionId = requiredFlag(flags, 'target');
    const expectedRevisionId = requiredFlag(flags, 'expected-revision');
    const actor = requiredFlag(flags, 'actor');
    const reason = requiredFlag(flags, 'reason');
    const publication = await store.rollback({ targetRevisionId, expectedRevisionId, actor, reason, approveForRouting: hasFlag(flags, 'approve-routing') });
    return publicationResult('Rolled back as a new revision', publication);
  }
  if (action === 'recover') {
    requireConfirm(flags, 'state recover');
    const publication = await store.recoverFromLastKnownGood({ confirm: true, actor: flagString(flags, 'actor') ?? 'local-cli', reason: flagString(flags, 'reason') });
    return publicationResult('Recovered last-known-good as a new revision', publication);
  }
  if (action === 'repair-projections') {
    requireConfirm(flags, 'state repair-projections');
    await store.repairLegacyProjections({ confirm: true });
    const read = await store.readCurrent({ purpose: 'status' });
    return { repaired: true, revision: pointerReceipt(read.currentPointer), summary: `Repaired legacy projections from ${read.currentPointer.revisionId}.` };
  }
  throw new Error('Supported state commands: state status|migrate|import-legacy|rollback|recover|repair-projections.');
}

function pointerReceipt(pointer: { workspaceId: string; revisionId: string; workspaceRevision: string; effectiveDigest: string | null; effectiveRevisionDigest: string | null; sequence: number }): Record<string, unknown> {
  return {
    workspaceId: pointer.workspaceId,
    revisionId: pointer.revisionId,
    sequence: pointer.sequence,
    workspaceRevision: pointer.workspaceRevision,
    effectiveDigest: pointer.effectiveDigest,
    effectiveRevisionDigest: pointer.effectiveRevisionDigest
  };
}

function publicationResult(label: string, publication: Awaited<ReturnType<WorkspaceStateStore['migrateLegacy']>>): Record<string, unknown> {
  return {
    revision: pointerReceipt(publication.pointer),
    lastKnownGoodUpdated: publication.lastKnownGoodUpdated,
    warnings: publication.warnings,
    summary: `${label}: ${publication.pointer.revisionId}${publication.lastKnownGoodUpdated ? ' (routing approved)' : ''}.`
  };
}

function requireConfirm(flags: Record<string, string | boolean | string[]>, action: string): void {
  if (!hasFlag(flags, 'confirm')) throw new Error(`${action} requires --confirm.`);
}

function requiredFlag(flags: Record<string, string | boolean | string[]>, name: string): string {
  const value = flagString(flags, name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}
