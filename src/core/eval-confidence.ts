import { EVAL_RELEASE_POLICY } from '../contracts/eval-semantics.js';

export type EvalConfidenceLevel = 'none' | 'demo' | 'weak' | 'alpha' | 'release';

export interface EvalConfidence {
  level: EvalConfidenceLevel;
  count: number;
  releaseReady: boolean;
  message: string;
}

export function evalConfidence(count: number, releaseEvidenceEligible = false): EvalConfidence {
  if (count <= 0) return { level: 'none', count, releaseReady: false, message: 'no saved eval report is available' };
  if (!releaseEvidenceEligible) return { level: 'demo', count, releaseReady: false, message: 'case count alone is demo/smoke evidence; a credible eval v2 receipt is required' };
  if (count < 5) return { level: 'demo', count, releaseReady: false, message: 'fewer than 5 evals is demo-only evidence' };
  if (count < 25) return { level: 'weak', count, releaseReady: false, message: 'fewer than 25 evals is weak evidence' };
  if (count < EVAL_RELEASE_POLICY.minCount) return { level: 'alpha', count, releaseReady: false, message: `fewer than ${EVAL_RELEASE_POLICY.minCount} evals is alpha evidence` };
  return { level: 'release', count, releaseReady: true, message: 'validated eval v2 evidence meets the release threshold' };
}
