import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { EvalRunV3ReleaseContext } from '../contracts/validate.js';
import { hashText } from '../core/fs.js';
import { WorkspaceStateError, WorkspaceStateStore, type ValidatedRevision } from '../core/workspace-state/index.js';
import { openApprovedWorkspaceRead, type ApprovedWorkspaceRead } from './workspace-read-model.js';

const MAX_EFFECTIVE_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_EVAL_SUITE_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_EVAL_REPORT_ARTIFACT_BYTES = 64 * 1024 * 1024;

export interface EvalRunV3ExecutionContext extends Omit<EvalRunV3ReleaseContext, 'companionSuite'> {}

export interface EvalRunV3StatusSnapshot {
  /** Receipt-verified report bytes parsed exactly once for status validation. */
  report: Record<string, unknown>;
  /** Receipt-verified companion suite and independently resolved revision context. */
  context: EvalRunV3ReleaseContext;
}

export async function prepareEvalRunV3ExecutionContext(
  cwd: string,
  companionSuite: unknown,
  captured?: ApprovedWorkspaceRead
): Promise<EvalRunV3ExecutionContext> {
  const approved = captured ?? await openApprovedWorkspaceRead(cwd, 'routing');
  const baseline = baselineSourceRevision(companionSuite);
  const baselineRevision = baseline ? await findApprovedRevision(cwd, baseline.revisionId) : null;
  return {
    approvedRevision: revisionRef(approved.state.revision),
    effectiveArtifact: await readVerifiedEffectiveArtifact(approved.state.revision),
    baselineEffectiveArtifact: baselineRevision ? await readVerifiedEffectiveArtifact(baselineRevision) : null,
    approvedBaselineRevision: baselineRevision ? revisionRef(baselineRevision) : null
  };
}

export async function prepareEvalRunV3ExecutionContextIfPresent(
  cwd: string,
  approved: ApprovedWorkspaceRead
): Promise<EvalRunV3ExecutionContext | undefined> {
  const suiteArtifact = approved.state.revision.manifest.artifacts.find((artifact) => artifact.path === 'real-evals.json');
  if (!suiteArtifact) return undefined;
  const suite = parseVerifiedJson(await readVerifiedArtifactText(approved.state.revision, 'real-evals.json', MAX_EVAL_SUITE_ARTIFACT_BYTES), 'eval suite');
  if (!isRecord(suite) || suite.kind !== 'skillmap.eval-suite' || suite.schemaVersion !== 3) return undefined;
  return prepareEvalRunV3ExecutionContext(cwd, suite, approved);
}

export async function prepareEvalRunV3StatusContext(
  cwd: string,
  approved: ApprovedWorkspaceRead
): Promise<EvalRunV3StatusSnapshot | undefined> {
  const reportArtifact = approved.state.revision.manifest.artifacts.find((artifact) => artifact.path === 'eval-report.json');
  const suiteArtifact = approved.state.revision.manifest.artifacts.find((artifact) => artifact.path === 'real-evals.json');
  if (!reportArtifact || !suiteArtifact) return undefined;
  const report = parseVerifiedJson(await readVerifiedArtifactText(approved.state.revision, 'eval-report.json', MAX_EVAL_REPORT_ARTIFACT_BYTES), 'eval report');
  if (!isRecord(report) || report.kind !== 'skillmap.eval-run' || report.schemaVersion !== 3) return undefined;
  const suite = parseVerifiedJson(await readVerifiedArtifactText(approved.state.revision, 'real-evals.json', MAX_EVAL_SUITE_ARTIFACT_BYTES), 'eval suite');
  const runRevision = recordValue(report.revision);
  if (!runRevision || typeof runRevision.revisionId !== 'string') {
    throw new WorkspaceStateError('EVAL_RELEASE_CONTEXT_INVALID', 'The immutable eval-run/v3 report has no revision binding.');
  }
  const approvedRevision = await findApprovedRevision(cwd, runRevision.revisionId, 'run');
  const baseline = baselineSourceRevision(suite);
  const baselineRevision = baseline ? await findApprovedRevision(cwd, baseline.revisionId) : null;
  return {
    report,
    context: {
      companionSuite: suite,
      approvedRevision: revisionRef(approvedRevision),
      effectiveArtifact: await readVerifiedEffectiveArtifact(approvedRevision),
      baselineEffectiveArtifact: baselineRevision ? await readVerifiedEffectiveArtifact(baselineRevision) : null,
      approvedBaselineRevision: baselineRevision ? revisionRef(baselineRevision) : null
    }
  };
}

async function findVerifiedRevision(cwd: string, revisionId: string): Promise<ValidatedRevision> {
  const store = WorkspaceStateStore.open(cwd);
  let startRevisionId: string | undefined;
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const page = await store.readRevisionAncestry({ limit: 100, ...(startRevisionId ? { startRevisionId } : {}) });
    const match = page.revisions.find((revision) => revision.manifest.revisionId === revisionId);
    if (match) return match;
    if (!page.nextRevisionId) break;
    startRevisionId = page.nextRevisionId;
  }
  throw new WorkspaceStateError('EVAL_RELEASE_REVISION_UNTRUSTED', `Eval release revision ${revisionId} is not in the verified current ancestry.`);
}

async function findApprovedRevision(cwd: string, revisionId: string, role: 'baseline' | 'run' = 'baseline'): Promise<ValidatedRevision> {
  try {
    return await WorkspaceStateStore.open(cwd).findRoutingApprovedRevision(revisionId);
  } catch (error) {
    throw new WorkspaceStateError(
      role === 'baseline' ? 'EVAL_RELEASE_BASELINE_UNAPPROVED' : 'EVAL_RELEASE_REVISION_UNAPPROVED',
      `Eval ${role} revision ${revisionId} is not backed by a durable routing-approval receipt.`,
      { cause: error }
    );
  }
}

async function readVerifiedEffectiveArtifact(revision: ValidatedRevision): Promise<string> {
  return readVerifiedArtifactText(revision, 'effective.json', MAX_EFFECTIVE_ARTIFACT_BYTES);
}

async function readVerifiedArtifactText(revision: ValidatedRevision, relative: string, maxBytes: number): Promise<string> {
  const artifact = revision.manifest.artifacts.find((candidate) => candidate.path === relative);
  if (!artifact || artifact.bytes < 2 || artifact.bytes > maxBytes) {
    throw new WorkspaceStateError('EVAL_RELEASE_ARTIFACT_MISSING', `Revision ${revision.manifest.revisionId} has no bounded immutable ${relative} artifact.`);
  }
  const file = path.join(revision.directory, 'workspace', '.skillmap', ...relative.split('/'));
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(file, constants.O_RDONLY | noFollow);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== artifact.bytes) {
      throw new WorkspaceStateError('EVAL_RELEASE_ARTIFACT_INVALID', `The immutable ${relative} artifact changed after revision validation.`);
    }
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text, 'utf8') !== artifact.bytes || hashText(text) !== artifact.digest) {
      throw new WorkspaceStateError('EVAL_RELEASE_ARTIFACT_INVALID', `The immutable ${relative} artifact no longer matches its revision receipt.`);
    }
    return text;
  } finally {
    await handle.close();
  }
}

function parseVerifiedJson(text: string, label: string): unknown {
  try { return JSON.parse(text) as unknown; } catch {
    throw new WorkspaceStateError('EVAL_RELEASE_ARTIFACT_INVALID', `The immutable ${label} artifact is not valid JSON.`);
  }
}

function baselineSourceRevision(value: unknown): { revisionId: string } | null {
  const suite = recordValue(value);
  const baseline = recordValue(suite?.baseline);
  const provenance = recordValue(baseline?.provenance);
  if (provenance?.sourceKind !== 'approved-effective-revision') return null;
  const sourceRevision = recordValue(provenance.sourceRevision);
  if (!sourceRevision || typeof sourceRevision.revisionId !== 'string') {
    throw new WorkspaceStateError('EVAL_BASELINE_REVISION_INVALID', 'The reviewed eval-suite/v3 baseline has no historical revision binding.');
  }
  return { revisionId: sourceRevision.revisionId };
}

function revisionRef(revision: ValidatedRevision): Record<string, unknown> {
  return {
    workspaceId: revision.manifest.workspaceId,
    revisionId: revision.manifest.revisionId,
    workspaceRevision: revision.manifest.workspaceRevision,
    effectiveDigest: revision.manifest.effectiveDigest,
    effectiveRevisionDigest: revision.manifest.effectiveRevisionDigest
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
