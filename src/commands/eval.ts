import path from 'node:path';
import { flagString, hasFlag } from '../core/args.js';
import { readJson, writeJson } from '../core/fs.js';
import {
  CANONICAL_EVAL_DATASET_REF,
  evaluateEvalSuite,
  evaluateEvalSuiteV3,
  evalUsesFixture,
  parseEvalSuiteDocument,
  persistedEvalReport
} from '../services/eval-use-case.js';
import { prepareEvalRunV3ExecutionContext, type EvalRunV3ExecutionContext } from '../services/eval-release-context.js';
import { openApprovedWorkspaceRead } from '../services/workspace-read-model.js';
import { fileExists, outDir } from './common.js';

export { computeEvalDatasetDigest } from '../services/eval-use-case.js';

/** CLI adapter: flags/filesystem/save behavior around the pure eval use case. */
export interface EvalCommandRuntime {
  releaseContext?: EvalRunV3ExecutionContext;
}

export async function evalCommand(
  cwd: string,
  flags: Record<string, string | boolean | string[]>,
  runtime: EvalCommandRuntime = {}
): Promise<unknown> {
  const explicitFile = flagString(flags, 'file');
  const canonicalEvalFile = path.join(outDir(cwd), 'real-evals.json');
  const evalFile = explicitFile ? path.resolve(cwd, explicitFile) : canonicalEvalFile;
  if (!explicitFile && !(await fileExists(evalFile))) {
    throw new Error('No eval file specified and .skillmap/real-evals.json was not found. Pass --file FILE for ad hoc evals.');
  }

  const approved = await openApprovedWorkspaceRead(cwd, 'routing');
  if (!approved.effective) throw new Error('The approved revision has no effective registry for eval execution.');
  const document = parseEvalSuiteDocument(await readJson<unknown>(evalFile));
  const thresholds = {
    minCount: numberFlag(flags, 'min-count', 150),
    minTop1: numberFlag(flags, 'min-top1', 0.8),
    minTop3: numberFlag(flags, 'min-top3', 0.92),
    maxAvoidHits: numberFlag(flags, 'max-avoid-hits', 0)
  };
  if (document.schemaVersion === 3) {
    const releaseContext = runtime.releaseContext ?? await prepareEvalRunV3ExecutionContext(cwd, document.suite, approved);
    const startedAt = new Date().toISOString();
    const report = evaluateEvalSuiteV3(approved.effective, document.suite, {
      revision: approved.servingRevision,
      effectiveArtifact: releaseContext.effectiveArtifact as string,
      baselineEffectiveArtifact: releaseContext.baselineEffectiveArtifact as string | null,
      approvedBaselineRevision: releaseContext.approvedBaselineRevision,
      startedAt,
      ...thresholds
    });
    if (hasFlag(flags, 'save-report')) {
      await writeJson(path.join(outDir(cwd), 'eval-report.json'), report);
    }
    return report;
  }

  const report = evaluateEvalSuite(approved.effective, document.suite, {
    evalFile,
    generatedAt: new Date().toISOString(),
    fixture: evalUsesFixture(approved.effective, evalFile),
    ...thresholds
  });
  if (approved.servingRevision.effectiveRevisionDigest !== report.effectiveRevisionDigest) {
    throw new Error('Approved revision semantic effective digest does not match the eval routing model.');
  }
  if (hasFlag(flags, 'save-report')) {
    const persistedFile = path.resolve(evalFile) === path.resolve(canonicalEvalFile)
      ? CANONICAL_EVAL_DATASET_REF
      : evalFile;
    await writeJson(path.join(outDir(cwd), 'eval-report.json'), persistedEvalReport(report, persistedFile));
  }
  return report;
}

function numberFlag(flags: Record<string, string | boolean | string[]>, name: string, fallback: number): number {
  const raw = flagString(flags, name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number.`);
  return value;
}
