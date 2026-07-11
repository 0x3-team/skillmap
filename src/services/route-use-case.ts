import { randomUUID } from 'node:crypto';
import { validateRoutePrompt } from '../contracts/route-ranking.js';
import { assertContract } from '../contracts/validate.js';
import { canonicalJson } from '../core/canonical-payload.js';
import { hashText } from '../core/fs.js';
import { normalizeRouteLimit, routeSemanticDecision } from '../core/route.js';
import type { EffectiveRegistry, RevisionRef, RouteDecisionV2, RouteResultV2, RouteServingMode } from '../schemas/types.js';

const ROUTE_RESULT_SCHEMA = 'https://skillmap.dev/contracts/route-result/v2.schema.json';

export interface ApprovedRoutingState {
  servingRevision: RevisionRef;
  currentRevision: RevisionRef;
  servingMode: RouteServingMode;
  effective: EffectiveRegistry;
  warningCodes: string[];
}

export interface RouteUseCaseInput {
  prompt: string;
  max?: number;
  qualifiedSkillId?: string;
}

export interface RouteUseCaseOutput {
  result: RouteResultV2;
  currentRevision: RevisionRef;
}

export class ApprovedStateUnavailableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApprovedStateUnavailableError';
    this.code = code;
  }
}

export function executeRouteUseCase(state: ApprovedRoutingState, input: RouteUseCaseInput): RouteUseCaseOutput {
  const started = performance.now();
  const prompt = validateRoutePrompt(input.prompt, Boolean(input.qualifiedSkillId));
  const max = normalizeRouteLimit(input.max ?? 3);
  const semantic = routeSemanticDecision(state.effective, prompt || 'qualified skill selection', max, input.qualifiedSkillId);
  const warningCodes = [...new Set(state.warningCodes)].sort().slice(0, 32);
  const decision: RouteDecisionV2 = {
    kind: 'skillmap.route-decision',
    schemaVersion: 2,
    revision: state.servingRevision,
    servingMode: state.servingMode,
    recommendations: semantic.recommendations,
    exclusions: semantic.exclusions,
    hookText: semantic.hookText,
    warningState: state.servingMode === 'last-known-good' || warningCodes.length > 0 ? 'degraded' : 'none',
    warningCodes
  };
  const decisionDigest = hashText(canonicalJson(decision));
  const result: RouteResultV2 = {
    kind: 'skillmap.route-result',
    schemaVersion: 2,
    routeId: randomUUID(),
    createdAt: new Date().toISOString(),
    promptStored: false,
    decision,
    decisionDigest,
    latencyMs: Math.max(0, Math.round((performance.now() - started) * 1000) / 1000)
  };
  assertContract(ROUTE_RESULT_SCHEMA, result);
  return { result, currentRevision: state.currentRevision };
}
