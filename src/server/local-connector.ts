import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { apiError, apiSuccess, type ApiReceiptContext } from '../core/api-envelope.js';
import { redactedMetadataLabel } from '../core/redacted-metadata.js';
import { assertJobRequest } from '../core/jobs.js';
import { assertRouteEvent } from '../core/route-events.js';
import { validateGithubRef, validateGithubRepository, validateGithubSubtree } from '../network/github-source-fetcher.js';
import { ConnectorAuthError, ConnectorSecurity } from './security.js';
import { connectorCompatibilityReceipt } from './compatibility.js';
import type { ApiEnvelope, JobRequestV1, RevisionRef, RouteFeedbackV1, RouteResultV2, SkillTier } from '../schemas/types.js';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_EVAL_IMPORT_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_REQUESTS = 32;

export interface ConnectorRevisionContext extends ApiReceiptContext {
  etag: string;
}

export interface LocalConnectorBackend {
  start?(): Promise<void>;
  close?(): Promise<void>;
  revisionContext(): Promise<ConnectorRevisionContext>;
  health(): Promise<unknown>;
  bootstrap(): Promise<unknown>;
  workspace(): Promise<unknown>;
  dashboard(): Promise<unknown>;
  listSkills(input: { query?: string; cursor?: string; limit: number }): Promise<unknown>;
  showSkill(skillId: string): Promise<unknown>;
  previewRoute(input: { prompt: string; max?: number; skillId?: string }): Promise<{ result: RouteResultV2; currentRevision: RevisionRef }>;
  recordFeedback(routeId: string, input: {
    outcome: RouteFeedbackV1['outcome'];
    selectedSkillIds?: string[];
    expectedSkillIds?: string[];
    unsafeSkillIds?: string[];
    reasonCode: string;
    idempotencyKey: string;
  }): Promise<unknown>;
  listRoutes(input: { cursor?: string; limit: number }): Promise<unknown>;
  showRoute(routeId: string): Promise<unknown>;
  policyReviews(): Promise<unknown>;
  previewPolicy?(input: { expectedRevision: string; confirmation: 'review' }): Promise<unknown>;
  proposePolicy?(input: { reviewId: string; action: 'select-canonical' | 'set-skill-policy' | 'retire-unmatched'; skillId?: string; tier?: SkillTier; actor: string; reason: string; expectedRevision: string }): Promise<unknown>;
  decidePolicyReview?(input: { proposalId: string; proposalDigest: string; decision: 'accept' | 'hold' | 'reject'; expectedRevision: string; confirmation: 'review' }): Promise<unknown>;
  decidePolicy?(input: { displayName: string; skillId: string; actor: string; reason: string; expectedRevision: string }): Promise<unknown>;
  applyReviewedPolicy?(input: { expectedRevision: string; confirmation: 'review' }): Promise<unknown>;
  sources(): Promise<unknown>;
  adoptSource?(input: { skillId: string; sourceType: 'local' | 'github'; expectedRevision: string; confirm: true; reason?: string; repository?: string; sourcePath?: string; ref?: string }): Promise<unknown>;
  sourceDiff?(input: { skillId: string; expectedRevision: string }, runtime?: { signal?: AbortSignal }): Promise<unknown>;
  reviewSource?(input: { skillId: string; decision: 'hold' | 'accepted' | 'ignore'; reason: string; expectedRevision: string }): Promise<unknown>;
  evals(input: { cursor?: string; limit: number }): Promise<unknown>;
  importEvalSuite?(input: { suite: unknown; expectedRevision: string }): Promise<unknown>;
  mcpManifest?(): Promise<unknown>;
  verifyHook?(input: { prompt: string }): Promise<unknown>;
  createJob(request: JobRequestV1): Promise<unknown>;
  listJobs?(): Promise<unknown>;
  showJob(jobId: string): Promise<unknown>;
  cancelJob?(jobId: string, input: { idempotencyKey: string }): Promise<unknown>;
  validateRoot?(input: { candidate: string }): Promise<unknown>;
  approveRoot?(input: { validationId: string; expectedRevision: string | null }): Promise<unknown>;
  validateWorkspace?(input: { candidate: string; mode: 'select-existing' | 'create-new' }): Promise<unknown>;
  selectWorkspace?(input: { validationId: string; confirm: true }): Promise<unknown>;
  adoptPartialLegacy?(input: { confirm: true }): Promise<unknown>;
  migrateState?(input: { confirm: true }): Promise<unknown>;
  recoverState?(input: { confirm: true }): Promise<unknown>;
  stateRevisions?(input: { cursor?: string; limit: number }): Promise<unknown>;
  rollbackState?(input: { targetRevision: string; expectedRevision: string; actor: string; reason: string; confirm: true }): Promise<unknown>;
}

export interface StartLocalConnectorOptions {
  backend: LocalConnectorBackend;
  port?: number;
  staticRoot?: string;
  bootstrapTtlMs?: number;
}

export interface RunningLocalConnector {
  origin: string;
  bootstrapUrl: string;
  port: number;
  close(): Promise<void>;
}

export async function startLocalConnector(options: StartLocalConnectorOptions): Promise<RunningLocalConnector> {
  await options.backend.start?.();
  let security: ConnectorSecurity | undefined;
  let active = 0;
  let closePromise: Promise<void> | undefined;
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!security) return sendJson(res, 503, apiError('STARTING', 'The local connector is still starting.', emptyContext(), { retryable: true }));
    if (active >= MAX_CONCURRENT_REQUESTS) return sendJson(res, 503, apiError('CONCURRENCY_LIMIT', 'The local connector is busy. Retry shortly.', emptyContext(), { retryable: true }));
    active += 1;
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('request timeout')));
    try {
      await handleRequest(req, res, security, options.backend, options.staticRoot);
    } catch (error) {
      if (documentAuthError(req, error)) sendDocumentAuthError(res, error);
      else await handleError(res, error, options.backend);
    } finally {
      active -= 1;
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  try {
    await listen(server, options.port ?? 0);
  } catch (error) {
    await options.backend.close?.().catch(() => undefined);
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local connector did not receive a TCP port.');
  security = new ConnectorSecurity({ host: '127.0.0.1', port: address.port, ...(options.bootstrapTtlMs !== undefined ? { bootstrapTtlMs: options.bootstrapTtlMs } : {}) });
  return {
    origin: security.origin,
    bootstrapUrl: security.bootstrapUrl('/app'),
    port: address.port,
    async close(): Promise<void> {
      if (closePromise) return closePromise;
      const serverClose = new Promise<void>((resolve, reject) => {
        const forceTimer = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 5_000);
        server.close((error) => {
          clearTimeout(forceTimer);
          for (const socket of sockets) socket.destroy();
          if (error) reject(error); else resolve();
        });
        server.closeIdleConnections?.();
      });
      closePromise = serverClose.finally(async () => {
        await options.backend.close?.();
      });
      return closePromise;
    }
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  security: ConnectorSecurity,
  backend: LocalConnectorBackend,
  staticRoot?: string
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', security.origin);
  security.clearLegacyCookies(req, res);
  if (!url.pathname.startsWith('/api/')) {
    // Host/origin validation still runs before the one-time exchange.
    security.authorize(req, { publicHealth: true });
    if (url.pathname === '/app' && url.searchParams.has('bootstrap') && method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'The one-time connector bootstrap exchange requires GET.');
    }
    if (method === 'GET' && security.tryExchangeBootstrap(url, res)) return;
    return serveStatic(res, url.pathname, staticRoot);
  }

  const publicHealth = method === 'GET' && url.pathname === '/api/v1/health';
  const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  security.authorize(req, { mutation, publicHealth });
  const context = await safeRevisionContext(backend);

  if (method === 'GET' && url.pathname === '/api/v1/health') return sendApi(res, 200, apiSuccess(await stableRead(backend, context, () => backend.health()), context), context.etag);
  if (method === 'GET' && url.pathname === '/api/v1/bootstrap') {
    return sendApi(res, 200, apiSuccess({
      ...(await asRecord(stableRead(backend, context, () => backend.bootstrap()))),
      connectorCompatibility: connectorCompatibilityReceipt()
    }, context), context.etag);
  }
  if (method === 'GET' && url.pathname === '/api/v1/workspace') return sendApi(res, 200, apiSuccess(await stableRead(backend, context, () => backend.workspace()), context), context.etag);
  if (method === 'GET' && url.pathname === '/api/v1/dashboard') {
    if (notModified(res, req, context.etag)) return;
    return sendApi(res, 200, apiSuccess(await stableRead(backend, context, () => backend.dashboard()), context), context.etag);
  }
  if (method === 'GET' && url.pathname === '/api/v1/skills') {
    if (notModified(res, req, context.etag)) return;
    const limit = parseLimit(url.searchParams.get('limit'));
    return sendApi(res, 200, apiSuccess(await stableRead(backend, context, () => backend.listSkills({ query: optionalBounded(url.searchParams.get('query'), 256), cursor: optionalBounded(url.searchParams.get('cursor'), 1024), limit })), context), context.etag);
  }
  const skillMatch = method === 'GET' ? url.pathname.match(/^\/api\/v1\/skills\/(sk_[A-Za-z0-9_-]{43})$/) : null;
  if (skillMatch) return sendApi(res, 200, apiSuccess(await stableRead(backend, context, () => backend.showSkill(skillMatch[1])), context), context.etag);

  if (method === 'POST' && url.pathname === '/api/v1/routes/preview') {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['prompt'], ['max', 'skillId']);
    const prompt = requiredString(body.prompt, 'prompt', 32 * 1024);
    const max = body.max === undefined ? undefined : requiredInteger(body.max, 'max', 1, 10);
    const skillId = body.skillId === undefined ? undefined : qualifiedSkillId(body.skillId);
    const execution = await backend.previewRoute({
      prompt,
      ...(max !== undefined ? { max } : {}),
      ...(skillId !== undefined ? { skillId } : {})
    });
    const routeContext: ConnectorRevisionContext = {
      servingRevision: execution.result.decision.revision,
      currentRevision: execution.currentRevision,
      compatibility: execution.result.decision.servingMode === 'last-known-good' ? 'degraded' : 'compatible',
      requestId: context.requestId,
      etag: `"${execution.currentRevision.workspaceRevision}"`
    };
    return sendApi(res, 200, apiSuccess(execution.result, routeContext), routeContext.etag);
  }
  const routeDetailMatch = method === 'GET' ? url.pathname.match(/^\/api\/v1\/routes\/([^/]+)$/) : null;
  if (routeDetailMatch) {
    const event = await stableRead(backend, context, () => backend.showRoute(routeDetailMatch[1]));
    return sendApi(res, 200, apiSuccess(routeEventReceipt(event), context), context.etag);
  }
  const feedbackMatch = method === 'POST' ? url.pathname.match(/^\/api\/v1\/routes\/([0-9a-f-]{36})\/feedback$/i) : null;
  if (feedbackMatch) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['outcome', 'reasonCode', 'idempotencyKey'], ['selectedSkillIds', 'expectedSkillIds', 'unsafeSkillIds']);
    const outcome = oneOf(body.outcome, ['correct', 'wrong', 'missing', 'unsafe'], 'outcome') as RouteFeedbackV1['outcome'];
    const selectedSkillIds = skillIdArray(body.selectedSkillIds, 'selectedSkillIds');
    const expectedSkillIds = skillIdArray(body.expectedSkillIds, 'expectedSkillIds');
    const unsafeSkillIds = skillIdArray(body.unsafeSkillIds, 'unsafeSkillIds');
    const feedback = await backend.recordFeedback(feedbackMatch[1], {
      outcome,
      reasonCode: requiredCode(body.reasonCode, 'reasonCode'),
      idempotencyKey: requiredCode(body.idempotencyKey, 'idempotencyKey', 128),
      ...(selectedSkillIds !== undefined ? { selectedSkillIds } : {}),
      ...(expectedSkillIds !== undefined ? { expectedSkillIds } : {}),
      ...(unsafeSkillIds !== undefined ? { unsafeSkillIds } : {})
    });
    const feedbackContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(feedback, feedbackContext), feedbackContext.etag);
  }
  if (method === 'GET' && url.pathname === '/api/v1/routes') {
    return sendApi(res, 200, apiSuccess(await stableRead(backend, context, () => backend.listRoutes({ cursor: optionalBounded(url.searchParams.get('cursor'), 1024), limit: parseLimit(url.searchParams.get('limit')) })), context));
  }
  if (method === 'GET' && url.pathname === '/api/v1/policy/reviews') {
    if (notModified(res, req, context.etag)) return;
    const reviews = await stableRead(backend, context, () => backend.policyReviews());
    return sendApi(res, 200, apiSuccess(policyReviewsReceipt(reviews), context), context.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/policy/preview' && backend.previewPolicy) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['expectedRevision', 'confirmation'], []);
    if (body.confirmation !== 'review') throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Policy preview requires confirmation=review.');
    const previewed = await stableRead(backend, context, () => backend.previewPolicy!({
      expectedRevision: requiredRevision(body.expectedRevision),
      confirmation: 'review'
    }));
    return sendApi(res, 200, apiSuccess(policyPreviewReceipt(previewed), context), context.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/policy/proposals' && backend.proposePolicy) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['reviewId', 'action', 'actor', 'reason', 'expectedRevision'], ['skillId', 'tier']);
    const action = oneOf(body.action, ['select-canonical', 'set-skill-policy', 'retire-unmatched'], 'action') as 'select-canonical' | 'set-skill-policy' | 'retire-unmatched';
    const proposed = await stableRead(backend, context, () => backend.proposePolicy!({
      reviewId: requiredCode(body.reviewId, 'reviewId', 64),
      action,
      actor: requiredCode(body.actor, 'actor', 80),
      reason: requiredString(body.reason, 'reason', 1000),
      expectedRevision: requiredRevision(body.expectedRevision),
      ...(body.skillId !== undefined ? { skillId: qualifiedSkillId(body.skillId) } : {}),
      ...(body.tier !== undefined ? { tier: oneOf(body.tier, ['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'], 'tier') as SkillTier } : {})
    }));
    return sendApi(res, 201, apiSuccess(policyProposalReceipt(proposed), context), context.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/policy/decisions' && (backend.decidePolicyReview || backend.decidePolicy)) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    let decided: unknown;
    if (body.proposalId !== undefined) {
      if (!backend.decidePolicyReview) throw new HttpError(404, 'ENDPOINT_UNAVAILABLE', 'Policy proposal decisions are unavailable.');
      exactBody(body, ['proposalId', 'proposalDigest', 'decision', 'expectedRevision', 'confirmation'], []);
      if (body.confirmation !== 'review') throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Policy decisions require confirmation=review.');
      decided = await backend.decidePolicyReview({
        proposalId: requiredCode(body.proposalId, 'proposalId', 64),
        proposalDigest: requiredDigest(body.proposalDigest, 'proposalDigest'),
        decision: oneOf(body.decision, ['accept', 'hold', 'reject'], 'decision') as 'accept' | 'hold' | 'reject',
        expectedRevision: requiredRevision(body.expectedRevision),
        confirmation: 'review'
      });
    } else {
      if (!backend.decidePolicy) throw new HttpError(404, 'ENDPOINT_UNAVAILABLE', 'Direct canonical decisions are unavailable.');
      exactBody(body, ['displayName', 'skillId', 'actor', 'reason', 'expectedRevision'], []);
      decided = await backend.decidePolicy({
        displayName: requiredString(body.displayName, 'displayName', 200),
        skillId: qualifiedSkillId(body.skillId),
        actor: requiredCode(body.actor, 'actor', 80),
        reason: requiredString(body.reason, 'reason', 1000),
        expectedRevision: requiredRevision(body.expectedRevision)
      });
    }
    const decidedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(policyDecisionReceipt(decided), decidedContext), decidedContext.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/policy/apply' && backend.applyReviewedPolicy) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['expectedRevision', 'confirmation'], []);
    if (body.confirmation !== 'review') throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Reviewed policy application requires confirmation=review.');
    const applied = await backend.applyReviewedPolicy({ expectedRevision: requiredRevision(body.expectedRevision), confirmation: 'review' });
    const appliedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(applied, appliedContext), appliedContext.etag);
  }
  if (method === 'GET' && url.pathname === '/api/v1/sources') {
    if (notModified(res, req, context.etag)) return;
    return sendApi(res, 200, apiSuccess(await stableRead(backend, context, () => backend.sources()), context), context.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/sources/adoptions' && backend.adoptSource) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['skillId', 'sourceType', 'expectedRevision', 'confirm'], ['reason', 'repository', 'sourcePath', 'ref']);
    if (body.confirm !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Source adoption requires confirm=true after reviewing the source classification.');
    const sourceType = oneOf(body.sourceType, ['local', 'github'], 'sourceType') as 'local' | 'github';
    const common = { skillId: qualifiedSkillId(body.skillId), sourceType, expectedRevision: requiredRevision(body.expectedRevision), confirm: true as const };
    let adopted: unknown;
    if (sourceType === 'local') {
      if (body.repository !== undefined || body.sourcePath !== undefined || body.ref !== undefined) throw new HttpError(400, 'INPUT_INVALID', 'Local source adoption does not accept GitHub coordinates.');
      adopted = await backend.adoptSource({ ...common, reason: requiredString(body.reason, 'reason', 500) });
    } else {
      if (body.reason !== undefined) throw new HttpError(400, 'INPUT_INVALID', 'GitHub source adoption does not accept a local classification reason.');
      adopted = await backend.adoptSource({
        ...common,
        repository: githubRepository(body.repository),
        sourcePath: githubSourcePath(body.sourcePath),
        ref: githubRef(body.ref)
      });
    }
    const adoptedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(sourceAdoptionReceipt(adopted), adoptedContext), adoptedContext.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/sources/diff' && backend.sourceDiff) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['skillId', 'expectedRevision'], []);
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once('aborted', abort);
    res.once('close', abort);
    try {
      const diffed = await stableRead(backend, context, () => backend.sourceDiff!(
        { skillId: qualifiedSkillId(body.skillId), expectedRevision: requiredRevision(body.expectedRevision) },
        { signal: controller.signal }
      ));
      return sendApi(res, 200, apiSuccess(sourceDiffReceipt(diffed), context), context.etag);
    } finally {
      req.off('aborted', abort);
      res.off('close', abort);
    }
  }
  if (method === 'POST' && url.pathname === '/api/v1/sources/reviews' && backend.reviewSource) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['skillId', 'decision', 'reason', 'expectedRevision'], []);
    const reviewed = await backend.reviewSource({
      skillId: qualifiedSkillId(body.skillId),
      decision: oneOf(body.decision, ['hold', 'accepted', 'ignore'], 'decision') as 'hold' | 'accepted' | 'ignore',
      reason: requiredString(body.reason, 'reason', 1000),
      expectedRevision: requiredRevision(body.expectedRevision)
    });
    const reviewedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(sourceReviewReceipt(reviewed), reviewedContext), reviewedContext.etag);
  }
  if (method === 'GET' && url.pathname === '/api/v1/evals') {
    exactQuery(url, ['cursor', 'limit']);
    const limit = parseLimit(url.searchParams.get('limit'));
    const input = { cursor: optionalBounded(url.searchParams.get('cursor'), 1024), limit };
    return sendApi(res, 200, apiSuccess(evalsReceipt(await stableRead(backend, context, () => backend.evals(input)), limit), context), context.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/evals/import' && backend.importEvalSuite) {
    const body = await readJsonBody(req, MAX_EVAL_IMPORT_REQUEST_BYTES) as Record<string, unknown>;
    exactBody(body, ['suite', 'expectedRevision'], []);
    const imported = await backend.importEvalSuite({ suite: body.suite, expectedRevision: requiredRevision(body.expectedRevision) });
    const importedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(imported, importedContext), importedContext.etag);
  }
  if (method === 'GET' && url.pathname === '/api/v1/integrations/mcp' && backend.mcpManifest) {
    return sendApi(res, 200, apiSuccess(await stableRead(backend, context, () => backend.mcpManifest!()), context), context.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/integrations/hook/verify' && backend.verifyHook) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['prompt'], []);
    const result = await backend.verifyHook({ prompt: requiredString(body.prompt, 'prompt', 32 * 1024) });
    const verifiedContext = await safeRevisionContext(backend);
    return sendApi(res, 200, apiSuccess(result, verifiedContext), verifiedContext.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/jobs') {
    const body = await readJsonBody(req);
    try { assertJobRequest(body); } catch (error) { throw new HttpError(400, 'JOB_REQUEST_INVALID', error instanceof Error ? error.message : 'The job request is invalid.'); }
    const created = await backend.createJob(body as JobRequestV1);
    const jobContext = await safeRevisionContext(backend);
    return sendApi(res, 202, apiSuccess(jobCreationReceipt(created), jobContext), jobContext.etag);
  }
  if (method === 'GET' && url.pathname === '/api/v1/jobs' && backend.listJobs) {
    return sendApi(res, 200, apiSuccess(jobListReceipt(await stableRead(backend, context, () => backend.listJobs!())), context));
  }
  const cancelJobMatch = method === 'POST' ? url.pathname.match(/^\/api\/v1\/jobs\/([0-9a-f-]{36})\/cancel$/i) : null;
  if (cancelJobMatch && backend.cancelJob) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['idempotencyKey'], []);
    const cancelled = await backend.cancelJob(cancelJobMatch[1], { idempotencyKey: requiredCode(body.idempotencyKey, 'idempotencyKey', 128) });
    const cancelledContext = await safeRevisionContext(backend);
    const receipt = jobCancellationReceipt(cancelled);
    return sendApi(res, receipt.state === 'cancelled' ? 200 : 202, apiSuccess(receipt, cancelledContext), cancelledContext.etag);
  }
  const jobMatch = method === 'GET' ? url.pathname.match(/^\/api\/v1\/jobs\/([0-9a-f-]{36})$/i) : null;
  if (jobMatch) return sendApi(res, 200, apiSuccess(jobStatusReceipt(await backend.showJob(jobMatch[1])), context), context.etag);
  if (method === 'POST' && url.pathname === '/api/v1/workspaces/validate' && backend.validateWorkspace) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['candidate', 'mode'], []);
    const validated = await backend.validateWorkspace({
      candidate: requiredString(body.candidate, 'candidate', 4096),
      mode: oneOf(body.mode, ['select-existing', 'create-new'], 'mode') as 'select-existing' | 'create-new'
    });
    return sendApi(res, 200, apiSuccess(workspaceValidationReceipt(validated), context));
  }
  if (method === 'POST' && url.pathname === '/api/v1/workspaces/select' && backend.selectWorkspace) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['validationId', 'confirm'], []);
    if (body.confirm !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Workspace selection requires confirm=true after reviewing the validated mode and label.');
    const selected = await backend.selectWorkspace({ validationId: requiredCode(body.validationId, 'validationId', 128), confirm: true });
    const selectedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(workspaceSelectionReceipt(selected), selectedContext), selectedContext.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/roots/validate' && backend.validateRoot) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['candidate'], []);
    return sendApi(res, 200, apiSuccess(await backend.validateRoot({ candidate: requiredString(body.candidate, 'candidate', 4096) }), context));
  }
  if (method === 'POST' && url.pathname === '/api/v1/roots/approve' && backend.approveRoot) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['validationId', 'expectedRevision'], []);
    const approved = await backend.approveRoot({
      validationId: requiredCode(body.validationId, 'validationId', 128),
      expectedRevision: nullableRevision(body.expectedRevision)
    });
    const approvedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(rootApprovalReceipt(approved), approvedContext), approvedContext.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/state/adopt-partial-legacy' && backend.adoptPartialLegacy) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['confirm'], []);
    if (body.confirm !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Partial legacy adoption requires confirm=true after reviewing every configured root.');
    const adopted = await backend.adoptPartialLegacy({ confirm: true });
    const adoptedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(partialLegacyReceipt(adopted), adoptedContext), adoptedContext.etag);
  }
  if (method === 'GET' && url.pathname === '/api/v1/state/revisions' && backend.stateRevisions) {
    exactQuery(url, ['limit', 'cursor']);
    if (notModified(res, req, context.etag)) return;
    const cursor = optionalBounded(url.searchParams.get('cursor'), 1024);
    const history = await stableRead(backend, context, () => backend.stateRevisions!({
      limit: parseLimit(url.searchParams.get('limit')),
      ...(cursor ? { cursor } : {})
    }));
    return sendApi(res, 200, apiSuccess(revisionHistoryReceipt(history), context), context.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/state/rollback' && backend.rollbackState) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['targetRevision', 'expectedRevision', 'actor', 'reason', 'confirm'], []);
    if (body.confirm !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Rollback requires confirm=true after reviewing the verified target revision.');
    const rolledBack = await backend.rollbackState({
      targetRevision: requiredRevision(body.targetRevision),
      expectedRevision: requiredRevision(body.expectedRevision),
      actor: requiredCode(body.actor, 'actor', 64),
      reason: requiredCode(body.reason, 'reason', 128),
      confirm: true
    });
    const rollbackContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(rollbackReceipt(rolledBack), rollbackContext), rollbackContext.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/state/migrate' && backend.migrateState) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['confirm'], []);
    if (body.confirm !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'State migration requires confirm=true after reviewing the existing local files.');
    const migrated = await backend.migrateState({ confirm: true });
    const migratedContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(stateMutationReceipt(migrated, 'migrated'), migratedContext), migratedContext.etag);
  }
  if (method === 'POST' && url.pathname === '/api/v1/state/recover' && backend.recoverState) {
    const body = await readJsonBody(req) as Record<string, unknown>;
    exactBody(body, ['confirm'], []);
    if (body.confirm !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'State recovery requires confirm=true after reviewing the current diagnostics.');
    const recovered = await backend.recoverState({ confirm: true });
    const recoveredContext = await safeRevisionContext(backend);
    return sendApi(res, 201, apiSuccess(stateMutationReceipt(recovered, 'recovered'), recoveredContext), recoveredContext.etag);
  }
  throw new HttpError(404, 'NOT_FOUND', 'The requested local API endpoint does not exist.');
}

async function safeRevisionContext(backend: LocalConnectorBackend): Promise<ConnectorRevisionContext> {
  return backend.revisionContext();
}

async function stableRead<T>(backend: LocalConnectorBackend, captured: ConnectorRevisionContext, operation: () => Promise<T>): Promise<T> {
  const data = await operation();
  const after = await safeRevisionContext(backend);
  if (after.etag !== captured.etag) throw new HttpError(409, 'REVISION_CHANGED_RETRY', 'The workspace changed while this view was being composed. Retry against the new revision.', true);
  return data;
}

async function serveStatic(res: ServerResponse, pathname: string, staticRoot?: string): Promise<void> {
  if (!staticRoot) return sendBuiltInShell(res);
  const relative = pathname === '/' || pathname === '/app' || pathname.startsWith('/app/') ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!relative || relative.includes('..') || path.isAbsolute(relative)) throw new HttpError(400, 'STATIC_PATH_INVALID', 'The static asset path is invalid.');
  const root = await realpath(path.resolve(staticRoot));
  let target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new HttpError(400, 'STATIC_PATH_INVALID', 'The static asset path is invalid.');
  try {
    const lexical = await lstat(target);
    if (lexical.isSymbolicLink()) throw new HttpError(403, 'STATIC_SYMLINK_REJECTED', 'Symbolic-link assets are not served by the local connector.');
    if (lexical.isDirectory()) {
      target = path.join(target, 'index.html');
      await lstat(target);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    target = path.join(root, 'index.html');
  }
  const body = await readStaticAsset(root, target);
  res.statusCode = 200;
  // Stable asset names must revalidate across package/API upgrades.
  res.setHeader('Cache-Control', target.endsWith('index.html') ? 'no-store' : 'no-cache, must-revalidate');
  res.setHeader('Content-Type', contentType(target));
  res.end(body);
}

interface StaticPathSnapshot {
  rootRealPath: string;
  targetRealPath: string;
  chain: Array<{ path: string; stats: Stats }>;
  file: Stats;
}

async function readStaticAsset(root: string, target: string): Promise<Buffer> {
  const before = await captureStaticPath(root, target);
  if (!Number.isSafeInteger(before.file.size) || before.file.size < 0 || before.file.size > MAX_RESPONSE_BYTES) {
    throw new HttpError(413, 'STATIC_ASSET_TOO_LARGE', 'The static asset exceeds the local connector response limit.');
  }
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(target, constants.O_RDONLY | noFollow);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') throw new HttpError(403, 'STATIC_SYMLINK_REJECTED', 'Symbolic-link assets are not served by the local connector.');
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new HttpError(409, 'STATIC_ASSET_CHANGED', 'The static asset changed while it was being opened.', true);
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new HttpError(403, 'STATIC_ASSET_INVALID', 'The static asset is not a regular contained file.');
    if (!sameFileSnapshot(before.file, opened)) {
      throw new HttpError(409, 'STATIC_ASSET_CHANGED', 'The static asset changed while it was being opened.', true);
    }
    if (!Number.isSafeInteger(opened.size) || opened.size < 0 || opened.size > MAX_RESPONSE_BYTES) {
      throw new HttpError(413, 'STATIC_ASSET_TOO_LARGE', 'The static asset exceeds the local connector response limit.');
    }
    const body = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < body.length) {
      const result = await handle.read(body, offset, Math.min(64 * 1024, body.length - offset), offset);
      if (result.bytesRead <= 0) throw new HttpError(409, 'STATIC_ASSET_CHANGED', 'The static asset changed while it was being read.', true);
      offset += result.bytesRead;
    }
    const overflow = Buffer.allocUnsafe(1);
    if ((await handle.read(overflow, 0, 1, body.length)).bytesRead !== 0) {
      throw new HttpError(409, 'STATIC_ASSET_CHANGED', 'The static asset changed while it was being read.', true);
    }
    const afterHandle = await handle.stat();
    if (!sameFileSnapshot(opened, afterHandle)) {
      throw new HttpError(409, 'STATIC_ASSET_CHANGED', 'The static asset changed while it was being read.', true);
    }
    let after: StaticPathSnapshot;
    try {
      after = await captureStaticPath(root, target);
    } catch (error) {
      throw new HttpError(409, 'STATIC_ASSET_CHANGED', 'The static asset path changed while it was being read.', true);
    }
    if (before.rootRealPath !== after.rootRealPath
      || before.targetRealPath !== after.targetRealPath
      || !sameStaticPathChain(before.chain, after.chain)
      || !sameFileSnapshot(opened, after.file)) {
      throw new HttpError(409, 'STATIC_ASSET_CHANGED', 'The static asset path changed while it was being read.', true);
    }
    return body;
  } finally {
    await handle.close();
  }
}

async function captureStaticPath(root: string, target: string): Promise<StaticPathSnapshot> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new HttpError(403, 'STATIC_PATH_ESCAPE', 'The static asset escapes the configured bundle root.');
  }
  const chain: StaticPathSnapshot['chain'] = [];
  let current = resolvedRoot;
  const segments = relative.split(path.sep);
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) current = path.join(current, segments[index]);
    const stats = await lstat(current);
    const final = index === segments.length - 1;
    if (stats.isSymbolicLink()) throw new HttpError(403, 'STATIC_SYMLINK_REJECTED', 'Symbolic-link assets are not served by the local connector.');
    if (final ? !stats.isFile() : !stats.isDirectory()) {
      throw new HttpError(403, 'STATIC_ASSET_INVALID', `The static asset ${final ? 'is not a regular file' : 'has a non-directory ancestor'}.`);
    }
    chain.push({ path: current, stats });
  }
  const rootRealPath = await realpath(resolvedRoot);
  const targetRealPath = await realpath(resolvedTarget);
  if (targetRealPath !== rootRealPath && !targetRealPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new HttpError(403, 'STATIC_PATH_ESCAPE', 'The static asset escapes the configured bundle root.');
  }
  return { rootRealPath, targetRealPath, chain, file: chain[chain.length - 1].stats };
}

function sameStaticPathChain(left: StaticPathSnapshot['chain'], right: StaticPathSnapshot['chain']): boolean {
  return left.length === right.length && left.every((entry, index) => entry.path === right[index]?.path && sameFileSnapshot(entry.stats, right[index].stats));
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function sendBuiltInShell(res: ServerResponse): void {
  const body = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SkillMap local app</title><link rel="stylesheet" href="/local-app.css"></head><body><main><h1>SkillMap local app</h1><p>The secure connector is running. Install or build the versioned local UI assets to use the browser workflow.</p></main></body></html>';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(body);
}

function documentAuthError(req: IncomingMessage, error: unknown): error is ConnectorAuthError {
  if (!(error instanceof ConnectorAuthError) || (req.url ?? '').startsWith('/api/')) return false;
  const accept = String(req.headers.accept ?? '').toLowerCase();
  return req.headers['sec-fetch-dest'] === 'document' && accept.split(',').some((value) => value.trim().startsWith('text/html'));
}

function sendDocumentAuthError(res: ServerResponse, error: ConnectorAuthError): void {
  const code = escapeHtml(error.code);
  const message = escapeHtml(error.message);
  const body = Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SkillMap connector link unavailable</title></head><body><main><h1>Connector link unavailable</h1><p><code>${code}</code></p><p>${message}</p></main></body></html>`, 'utf8');
  res.statusCode = error.status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_REQUEST_BYTES): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'CONTENT_TYPE_REQUIRED', 'Mutation requests require application/json.');
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'The request body exceeds the local connector limit.');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new HttpError(413, 'REQUEST_TOO_LARGE', 'The request body exceeds the local connector limit.');
    chunks.push(buffer);
  }
  if (bytes === 0) throw new HttpError(400, 'BODY_REQUIRED', 'A JSON request body is required.');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.'); }
}

async function handleError(res: ServerResponse, error: unknown, backend: LocalConnectorBackend): Promise<void> {
  if (res.headersSent) { res.destroy(); return; }
  const context = await safeRevisionContext(backend).catch(() => ({ ...emptyContext(), etag: '"unavailable"' }));
  if (error instanceof ConnectorAuthError) return sendJson(res, error.status, apiError(error.code, error.message, context));
  if (error instanceof HttpError) return sendJson(res, error.status, apiError(error.code, error.message, context, { retryable: error.retryable }));
  const stateCode = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
  const workspaceError = stateCode ? workspaceHttpError(stateCode) : undefined;
  if (workspaceError) {
    return sendJson(res, workspaceError.status, apiError(
      stateCode as string,
      workspaceError.message,
      context,
      { retryable: workspaceError.retryable }
    ));
  }
  const jobError = stateCode ? jobHttpError(stateCode) : undefined;
  if (jobError) return sendJson(res, 409, apiError(stateCode as string, jobError.message, context, { retryable: jobError.retryable }));
  const routeEventError = stateCode ? routeEventHttpError(stateCode) : undefined;
  if (routeEventError) return sendJson(res, routeEventError.status, apiError(stateCode as string, routeEventError.message, context, { retryable: false }));
  const feedbackError = stateCode ? feedbackHttpError(stateCode) : undefined;
  if (feedbackError) return sendJson(res, feedbackError.status, apiError(stateCode as string, feedbackError.message, context, { retryable: false }));
  const sourceError = stateCode ? sourceHttpError(stateCode) : undefined;
  if (sourceError) return sendJson(res, sourceError.status, apiError(stateCode as string, sourceError.message, context, { retryable: sourceError.retryable }));
  const policyError = stateCode ? policyHttpError(stateCode) : undefined;
  if (policyError) return sendJson(res, policyError.status, apiError(stateCode as string, policyError.message, context, { retryable: policyError.retryable }));
  const evalError = stateCode ? evalHttpError(stateCode) : undefined;
  if (evalError) return sendJson(res, evalError.status, apiError(stateCode as string, evalError.message, context, { retryable: evalError.retryable }));
  if (stateCode === 'STATE_CONFLICT') {
    return sendJson(res, 409, apiError('REVISION_CONFLICT', error instanceof Error ? error.message : 'The workspace revision changed before the operation could be applied.', context, { retryable: true }));
  }
  if (stateCode?.startsWith('STATE_')) {
    return sendJson(res, 409, apiError(stateCode, error instanceof Error ? error.message : 'The workspace state cannot complete this operation.', context, { retryable: false }));
  }
  const code = error instanceof Error && error.name === 'ApprovedStateUnavailableError' ? 'APPROVED_STATE_UNAVAILABLE' : 'INTERNAL_ERROR';
  return sendJson(res, code === 'APPROVED_STATE_UNAVAILABLE' ? 409 : 500, apiError(code, code === 'INTERNAL_ERROR' ? 'The local connector could not complete the request.' : 'No approved workspace revision is available.', context, { retryable: code !== 'INTERNAL_ERROR' }));
}

function workspaceHttpError(code: string): { status: 400 | 409; retryable: boolean; message: string } | undefined {
  const errors: Record<string, { status: 400 | 409; retryable: boolean; message: string }> = {
    WORKSPACE_CANDIDATE_INVALID: { status: 400, retryable: false, message: 'The workspace candidate is invalid.' },
    WORKSPACE_CANDIDATE_EXISTS: { status: 400, retryable: false, message: 'The new workspace candidate already exists.' },
    WORKSPACE_PARENT_INVALID: { status: 400, retryable: false, message: 'The new workspace parent is invalid.' },
    WORKSPACE_MODE_INVALID: { status: 400, retryable: false, message: 'The workspace selection mode is invalid.' },
    WORKSPACE_VALIDATION_INVALID: { status: 409, retryable: true, message: 'The workspace validation expired. Validate the directory again.' },
    WORKSPACE_VALIDATION_CHANGED: { status: 409, retryable: true, message: 'The workspace changed after validation. Validate the directory again.' },
    WORKSPACE_SWITCH_JOBS_ACTIVE: { status: 409, retryable: true, message: 'A workspace has a queued or running job. Finish or cancel it before switching.' },
    WORKSPACE_SWITCH_IN_PROGRESS: { status: 409, retryable: true, message: 'Another foreground workspace switch is already in progress.' },
    WORKSPACE_CREATE_FAILED: { status: 409, retryable: true, message: 'The confirmed workspace could not be created safely.' },
    WORKSPACE_FRESHNESS_START_FAILED: { status: 409, retryable: false, message: 'The selected workspace could not start safe filesystem observation.' },
    WORKSPACE_FRESHNESS_STOP_FAILED: { status: 409, retryable: false, message: 'The previous workspace could not stop filesystem observation safely.' },
    WORKSPACE_VALIDATION_LIMIT: { status: 409, retryable: true, message: 'Too many workspace validations are active. Confirm one or wait for expiry before retrying.' },
    ROOT_VALIDATION_LIMIT: { status: 409, retryable: true, message: 'Too many root validations are active. Approve one or wait for expiry before retrying.' }
  };
  return errors[code];
}

function jobHttpError(code: string): { retryable: boolean; message: string } | undefined {
  const errors: Record<string, { retryable: boolean; message: string }> = {
    JOB_LEDGER_CAPACITY: { retryable: true, message: 'The local job ledger is full of queued or running work. Finish or cancel a job before retrying.' },
    JOB_LEDGER_BUSY: { retryable: true, message: 'The local job ledger is busy. Retry after the current job operation completes.' },
    JOB_NOT_CANCELLABLE: { retryable: false, message: 'Only queued or running jobs can be cancelled.' },
    JOB_PUBLICATION_COMMITTED: { retryable: false, message: 'The job already published its workspace revision and cannot be cancelled.' },
    JOB_CANCELLATION_IDEMPOTENCY_CONFLICT: { retryable: false, message: 'This job already has a cancellation request with a different idempotency key.' }
  };
  return errors[code];
}

function feedbackHttpError(code: string): { status: 400 | 409; message: string } | undefined {
  const errors: Record<string, { status: 400 | 409; message: string }> = {
    FEEDBACK_ROUTE_INVALID: { status: 400, message: 'Feedback routeId is invalid.' },
    FEEDBACK_REASON_INVALID: { status: 400, message: 'Feedback reasonCode does not match the selected outcome.' },
    FEEDBACK_IDEMPOTENCY_INVALID: { status: 400, message: 'Feedback idempotencyKey is invalid.' },
    FEEDBACK_SKILL_IDS_INVALID: { status: 400, message: 'Feedback skill IDs must be bounded qualified identifiers.' },
    FEEDBACK_SKILL_BINDING_INVALID: { status: 400, message: 'Feedback labels must belong to the recorded immutable revision.' },
    FEEDBACK_SELECTION_CONFLICT: { status: 409, message: 'Feedback selectedSkillIds cannot rewrite the recorded route selection.' },
    FEEDBACK_IDEMPOTENCY_CONFLICT: { status: 409, message: 'Feedback idempotencyKey was already used for a different request.' },
    FEEDBACK_OUTCOME_CONFLICT: { status: 409, message: 'Feedback for this route outcome already has a different immutable request.' },
    FEEDBACK_REVISION_CONFLICT: { status: 409, message: 'Feedback labels no longer bind to the recorded immutable revision.' },
    FEEDBACK_ROUTE_NOT_FOUND: { status: 409, message: 'The retained route event is unavailable for feedback.' }
  };
  return errors[code];
}

function routeEventHttpError(code: string): { status: 400 | 404; message: string } | undefined {
  const errors: Record<string, { status: 400 | 404; message: string }> = {
    ROUTE_EVENT_ID_INVALID: { status: 400, message: 'Route event routeId is invalid.' },
    ROUTE_EVENT_NOT_FOUND: { status: 404, message: 'The retained route event was not found.' }
  };
  return errors[code];
}

function policyHttpError(code: string): { status: 400 | 409; retryable: boolean; message: string } | undefined {
  const errors: Record<string, { status: 400 | 409; retryable: boolean; message: string }> = {
    POLICY_REQUIRED: { status: 409, retryable: false, message: 'A reviewed policy artifact is required before using this workflow.' },
    POLICY_V2_REQUIRED: { status: 409, retryable: false, message: 'Actionable policy review requires an active policy v2 migration.' },
    POLICY_PROPOSAL_LIMIT: { status: 409, retryable: true, message: 'Too many policy proposals are active. Decide one or wait for expiry.' },
    POLICY_PROPOSAL_INVALID: { status: 409, retryable: true, message: 'The policy proposal is invalid, expired, or already decided. Create a fresh proposal.' },
    POLICY_REVIEW_STALE: { status: 409, retryable: true, message: 'The policy review queue changed. Refresh it and create a fresh proposal.' }
  };
  return errors[code];
}

function sourceHttpError(code: string): { status: number; retryable: boolean; message: string } | undefined {
  const errors: Record<string, { status: number; retryable: boolean; message: string }> = {
    INVALID_REPOSITORY: { status: 400, retryable: false, message: 'The GitHub repository coordinate is invalid.' },
    INVALID_REF: { status: 400, retryable: false, message: 'The GitHub ref is invalid.' },
    INVALID_SUBTREE: { status: 400, retryable: false, message: 'The GitHub source path is invalid.' },
    REQUEST_ABORTED: { status: 409, retryable: true, message: 'The source diff was cancelled before completion.' },
    REQUEST_TIMEOUT: { status: 504, retryable: true, message: 'The GitHub source request timed out.' },
    RATE_LIMITED: { status: 429, retryable: true, message: 'GitHub rate limiting prevented the source diff.' },
    NETWORK_ERROR: { status: 502, retryable: true, message: 'The GitHub source could not be reached safely.' },
    HTTP_ERROR: { status: 502, retryable: true, message: 'GitHub rejected the bounded source request.' },
    RESPONSE_TOO_LARGE: { status: 413, retryable: false, message: 'The GitHub response exceeds the source diff limit.' },
    SOURCE_TREE_TOO_LARGE: { status: 413, retryable: false, message: 'The GitHub source tree exceeds the source diff limit.' },
    SOURCE_ENTRY_LIMIT: { status: 413, retryable: false, message: 'The GitHub source tree has too many entries.' },
    SUBTREE_NOT_FOUND: { status: 409, retryable: false, message: 'The adopted GitHub source path was not found.' },
    UNSUPPORTED_ENTRY: { status: 409, retryable: false, message: 'The GitHub source contains an unsupported entry.' },
    SOURCE_CHANGED: { status: 409, retryable: true, message: 'The GitHub source changed during immutable resolution.' },
    SOURCE_BINDING_INVALID: { status: 409, retryable: false, message: 'The source record is not bound to the approved inventory skill. Run scan and adopt it again.' },
    SOURCE_LOCAL_CHANGED: { status: 409, retryable: true, message: 'The approved local skill changed during source inspection. Run scan and retry.' }
  };
  return errors[code];
}

function evalHttpError(code: string): { status: 400 | 409; retryable: boolean; message: string } | undefined {
  const errors: Record<string, { status: 400 | 409; retryable: boolean; message: string }> = {
    EVAL_CURSOR_INVALID: { status: 400, retryable: true, message: 'The eval case cursor is invalid or stale. Restart from the first case page.' },
    EVAL_SKILL_CATALOG_INVALID: { status: 409, retryable: false, message: 'The v3 eval suite does not match the approved routing skill catalog.' },
    EVAL_REPORT_TOO_LARGE: { status: 409, retryable: false, message: 'The immutable eval report exceeds the local application read limit.' },
    EVAL_REPORT_INVALID: { status: 409, retryable: false, message: 'The immutable eval report failed its revision-bound integrity check.' }
  };
  return errors[code];
}

function notModified(res: ServerResponse, req: IncomingMessage, etag: string): boolean {
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.setHeader('ETag', etag);
    res.end();
    return true;
  }
  return false;
}

function sendApi(res: ServerResponse, status: number, envelope: ApiEnvelope<unknown>, etag?: string): void {
  if (etag) res.setHeader('ETag', etag);
  sendJson(res, status, envelope);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (body.length > MAX_RESPONSE_BYTES) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(`${JSON.stringify(apiError('RESPONSE_TOO_LARGE', 'The response exceeded the local connector limit.', emptyContext()))}\n`);
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

function emptyContext(): ConnectorRevisionContext { return { servingRevision: null, currentRevision: null, compatibility: 'degraded', requestId: randomUUID(), etag: '"unavailable"' }; }
function listen(server: Server, port: number): Promise<void> { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); }); }
function contentType(file: string): string { if (file.endsWith('.html')) return 'text/html; charset=utf-8'; if (file.endsWith('.js')) return 'text/javascript; charset=utf-8'; if (file.endsWith('.css')) return 'text/css; charset=utf-8'; if (file.endsWith('.svg')) return 'image/svg+xml'; if (file.endsWith('.json')) return 'application/json; charset=utf-8'; return 'application/octet-stream'; }
function parseLimit(value: string | null): number { if (value === null) return 20; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new HttpError(400, 'LIMIT_INVALID', 'limit must be an integer between 1 and 100.'); return parsed; }
function optionalBounded(value: string | null, max: number): string | undefined { if (value === null || value === '') return undefined; if (value.length > max) throw new HttpError(400, 'QUERY_INVALID', 'A query parameter exceeds its size limit.'); return value; }
function nullableRevision(value: unknown): string | null { if (value === null) return null; if (typeof value !== 'string' || !/^r[0-9]{20}-[0-9a-f-]{36}$/i.test(value)) throw new HttpError(400, 'INPUT_INVALID', 'expectedRevision must be a canonical revision id or null.'); return value; }
function requiredRevision(value: unknown): string { const revision = nullableRevision(value); if (!revision) throw new HttpError(400, 'INPUT_INVALID', 'expectedRevision must be a canonical revision id.'); return revision; }
function requiredString(value: unknown, label: string, maxBytes: number): string { if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > maxBytes || value.includes('\u0000')) throw new HttpError(400, 'INPUT_INVALID', `${label} is invalid.`); return value; }
function requiredInteger(value: unknown, label: string, min: number, max: number): number { if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new HttpError(400, 'INPUT_INVALID', `${label} is invalid.`); return value as number; }
function requiredCode(value: unknown, label: string, max = 64): string { if (typeof value !== 'string' || value.length < 1 || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new HttpError(400, 'INPUT_INVALID', `${label} is invalid.`); return value; }
function requiredDigest(value: unknown, label: string): string { if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new HttpError(400, 'INPUT_INVALID', `${label} is invalid.`); return value; }
function githubRepository(value: unknown): string { try { return validateGithubRepository(requiredString(value, 'repository', 140)); } catch { throw new HttpError(400, 'INPUT_INVALID', 'repository must be a canonical OWNER/REPO value.'); } }
function githubSourcePath(value: unknown): string { try { const normalized = validateGithubSubtree(requiredString(value, 'sourcePath', 1024)); if (!normalized) throw new Error('empty'); return normalized; } catch { throw new HttpError(400, 'INPUT_INVALID', 'sourcePath must be a bounded normalized relative path.'); } }
function githubRef(value: unknown): string { try { return validateGithubRef(requiredString(value, 'ref', 240)); } catch { throw new HttpError(400, 'INPUT_INVALID', 'ref is invalid.'); } }
function qualifiedSkillId(value: unknown): string { if (typeof value !== 'string' || !/^sk_[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(400, 'INPUT_INVALID', 'skillId is invalid.'); return value; }
function skillIdArray(value: unknown, label: string): string[] | undefined { if (value === undefined) return undefined; if (!Array.isArray(value) || value.length > 10) throw new HttpError(400, 'INPUT_INVALID', `${label} is invalid.`); return value.map(qualifiedSkillId); }
function oneOf(value: unknown, values: readonly string[], label: string): string { if (typeof value !== 'string' || !values.includes(value)) throw new HttpError(400, 'INPUT_INVALID', `${label} is invalid.`); return value; }
function exactBody(value: Record<string, unknown>, required: string[], optional: string[]): void { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'INPUT_INVALID', 'The request body must be an object.'); for (const key of required) if (!Object.hasOwn(value, key)) throw new HttpError(400, 'INPUT_INVALID', `The request body is missing ${key}.`); const allowed = new Set([...required, ...optional]); for (const key of Object.keys(value)) if (!allowed.has(key)) throw new HttpError(400, 'INPUT_INVALID', `The request body contains unknown field ${key}.`); }
function exactQuery(url: URL, allowed: string[]): void { const accepted = new Set(allowed); for (const key of url.searchParams.keys()) if (!accepted.has(key)) throw new HttpError(400, 'QUERY_INVALID', `Unknown query parameter ${key}.`); }
async function asRecord(value: Promise<unknown>): Promise<Record<string, unknown>> { const resolved = await value; return resolved && typeof resolved === 'object' && !Array.isArray(resolved) ? resolved as Record<string, unknown> : { state: resolved }; }

function rootApprovalReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: machineState(record.state) ?? 'approved',
    approved: record.approved === true,
    alreadyApproved: record.alreadyApproved === true,
    rootId: opaqueId(record.rootId),
    revision: revisionReceipt(record.revision),
    routingApprovalRequired: record.routingApprovalRequired !== false
  });
}

function routeEventReceipt(value: unknown): Record<string, unknown> {
  assertRouteEvent(value);
  return value as unknown as Record<string, unknown>;
}

function policyDecisionReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: machineState(record.state) ?? 'recorded',
    reviewId: safeMachineCode(record.reviewId, 64),
    queue: typeof record.queue === 'string' && ['duplicate', 'unmatched', 'uncovered', 'explicit-only', 'blocked'].includes(record.queue) ? record.queue : undefined,
    action: typeof record.action === 'string' && ['select-canonical', 'set-skill-policy', 'retire-unmatched'].includes(record.action) ? record.action : undefined,
    decision: typeof record.decision === 'string' && ['accept', 'hold', 'reject'].includes(record.decision) ? record.decision : undefined,
    skillId: safeSkillId(record.skillId),
    tier: typeof record.tier === 'string' && ['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'].includes(record.tier) ? record.tier : undefined,
    decisionDigest: safeDigest(record.decisionDigest),
    policyChanged: typeof record.policyChanged === 'boolean' ? record.policyChanged : undefined,
    revision: revisionReceipt(record.revision),
    routingApprovalRequired: record.routingApprovalRequired !== false
  });
}

function policyReviewsReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  const items = Array.isArray(record.items) ? record.items.slice(0, 200).flatMap((raw) => {
    const item = objectRecord(raw);
    const queue = typeof item.queue === 'string' && ['duplicate', 'unmatched', 'uncovered', 'explicit-only', 'blocked'].includes(item.queue) ? item.queue : undefined;
    const reviewId = safeMachineCode(item.reviewId ?? item.id, 64);
    if (!queue || !reviewId) return [];
    const action = typeof item.action === 'string' && ['select-canonical', 'set-skill-policy', 'retire-unmatched'].includes(item.action)
      ? item.action
      : queue === 'duplicate' ? 'select-canonical' : queue === 'unmatched' ? 'retire-unmatched' : 'set-skill-policy';
    const skillIds = Array.isArray(item.skillIds) ? item.skillIds.flatMap((candidate) => safeSkillId(candidate) ? [candidate as string] : []).slice(0, 20) : [];
    const contentRevisions = Array.isArray(item.contentRevisions) ? item.contentRevisions.flatMap((candidate) => safeDigest(candidate) ? [candidate as string] : []).slice(0, 20) : [];
    return [compactReceipt({
      reviewId,
      queue,
      action,
      state: item.state === 'configured' ? 'configured' : 'needs-review',
      blocking: item.blocking === true || (item.blocking === undefined && !['explicit-only'].includes(queue)),
      displayName: redactedMetadataLabel(typeof item.displayName === 'string' ? item.displayName : 'policy-review', skillIds[0] ?? reviewId),
      skillIds,
      contentRevisions,
      currentTier: typeof item.currentTier === 'string' && ['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'].includes(item.currentTier) ? item.currentTier : undefined,
      queueFingerprint: safeDigest(item.queueFingerprint)
    })];
  }) : [];
  const actionable = Number.isSafeInteger(record.actionable) && (record.actionable as number) >= 0 ? record.actionable as number : items.filter((item) => item.state === 'needs-review').length;
  const blocking = Number.isSafeInteger(record.blocking) && (record.blocking as number) >= 0 ? record.blocking as number : items.filter((item) => item.blocking === true).length;
  return compactReceipt({
    items,
    actionable,
    blocking,
    policyVersion: record.policyVersion === 1 || record.policyVersion === 2 ? record.policyVersion : undefined,
    revision: revisionReceipt(record.revision)
  });
}

function policyProposalReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  const decisionOptions = Array.isArray(record.decisionOptions)
    ? record.decisionOptions.filter((item): item is string => typeof item === 'string' && ['accept', 'hold', 'reject'].includes(item)).slice(0, 3)
    : [];
  return compactReceipt({
    state: record.state === 'proposed' ? 'proposed' : undefined,
    proposalId: opaqueId(record.proposalId),
    proposalDigest: safeDigest(record.proposalDigest),
    reviewId: safeMachineCode(record.reviewId, 64),
    queue: typeof record.queue === 'string' && ['duplicate', 'unmatched', 'uncovered', 'explicit-only', 'blocked'].includes(record.queue) ? record.queue : undefined,
    action: typeof record.action === 'string' && ['select-canonical', 'set-skill-policy', 'retire-unmatched'].includes(record.action) ? record.action : undefined,
    skillId: safeSkillId(record.skillId),
    tier: typeof record.tier === 'string' && ['active-default', 'specialist', 'explicit-only', 'archived', 'blocked'].includes(record.tier) ? record.tier : undefined,
    expectedRevision: canonicalRevisionId(record.expectedRevision),
    expiresAt: safeTimestamp(record.expiresAt),
    decisionOptions,
    wouldPublish: false
  });
}

function policyPreviewReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: record.state === 'previewed' ? 'previewed' : undefined,
    revision: revisionReceipt(record.revision),
    currentPresent: record.currentPresent === true,
    currentSummary: policySummaryReceipt(record.currentSummary, false),
    projectedSummary: policySummaryReceipt(record.projectedSummary, false),
    delta: policySummaryReceipt(record.delta, true),
    warnings: Array.isArray(record.warnings) ? record.warnings.slice(0, 20).flatMap((item) => {
      const warning = safeMachineCode(item, 64);
      return warning ? [warning] : [];
    }) : [],
    routingApprovalEligible: record.routingApprovalEligible === true,
    wouldPublish: false
  });
}

function policySummaryReceipt(value: unknown, allowNegative: boolean): Record<string, number> {
  const record = objectRecord(value);
  const count = (item: unknown): number => Number.isSafeInteger(item) && Math.abs(item as number) <= 1_000_000 && (allowNegative || (item as number) >= 0) ? item as number : 0;
  return { skills: count(record.skills), routeEligible: count(record.routeEligible), edges: count(record.edges) };
}

function sourceReviewReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: machineState(record.state) ?? 'recorded',
    skillId: safeSkillId(record.skillId),
    decision: typeof record.decision === 'string' && ['hold', 'accepted', 'ignore'].includes(record.decision) ? record.decision : undefined,
    reviewDigest: safeDigest(record.reviewDigest),
    revision: revisionReceipt(record.revision),
    routingApprovalRequired: record.routingApprovalRequired !== false
  });
}

function sourceAdoptionReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: record.state === 'adopted' ? 'adopted' : undefined,
    skillId: safeSkillId(record.skillId),
    sourceType: record.sourceType === 'local' || record.sourceType === 'github' ? record.sourceType : undefined,
    adoptionDigest: safeDigest(record.adoptionDigest),
    revision: revisionReceipt(record.revision),
    routingApprovalRequired: true,
    nextAction: record.nextAction === 'sources-check' ? 'sources-check' : undefined
  });
}

function sourceDiffReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  const rawDiff = objectRecord(record.diff);
  const rawLines = Array.isArray(rawDiff.lines) ? rawDiff.lines : [];
  const lines = rawLines.slice(0, 120).flatMap((item) => {
    const line = objectRecord(item);
    if ((line.kind !== 'local' && line.kind !== 'upstream') || !Number.isSafeInteger(line.line) || (line.line as number) < 1 || typeof line.text !== 'string') return [];
    return [{ kind: line.kind, line: line.line as number, text: line.text.slice(0, 500) }];
  });
  const count = (item: unknown): number => Number.isSafeInteger(item) && (item as number) >= 0 && (item as number) <= 1_000_000 ? item as number : 0;
  return compactReceipt({
    skillId: safeSkillId(record.skillId),
    state: typeof record.state === 'string' && ['external-clean', 'external-modified', 'external-stale', 'external-risky-update', 'local-authored', 'local-modified', 'unknown'].includes(record.state) ? record.state : 'unknown',
    risk: record.risk === 'low' || record.risk === 'high' ? record.risk : null,
    upstreamCommit: record.upstreamCommit === null ? null : commitHash(record.upstreamCommit),
    diff: {
      additions: count(rawDiff.additions),
      deletions: count(rawDiff.deletions),
      changedLines: count(rawDiff.changedLines),
      truncated: rawDiff.truncated === true || rawLines.length > lines.length,
      lines
    },
    promptStored: false,
    persisted: false,
    revision: revisionReceipt(record.revision)
  });
}

function partialLegacyReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: machineState(record.state) ?? 'adopted',
    adopted: record.adopted === true,
    rootCount: Number.isInteger(record.rootCount) && (record.rootCount as number) >= 0 ? record.rootCount : undefined,
    revision: revisionReceipt(record.revision),
    routingApprovalRequired: record.routingApprovalRequired !== false,
    nextAction: machineState(record.nextAction)
  });
}

function stateMutationReceipt(value: unknown, action: 'migrated' | 'recovered'): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: action,
    [action]: record[action] === true,
    ...(action === 'migrated' ? { alreadyMigrated: record.alreadyMigrated === true } : {}),
    revision: revisionReceipt(record.revision),
    warningCount: Array.isArray(record.warnings) ? Math.min(record.warnings.length, 1000) : 0
  });
}

function workspaceValidationReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: 'validated',
    validationId: opaqueId(record.validationId),
    mode: typeof record.mode === 'string' && ['select-existing', 'create-new'].includes(record.mode) ? record.mode : undefined,
    label: redactedMetadataLabel(record.label, 'Local workspace'),
    expiresInSeconds: Number.isInteger(record.expiresInSeconds) && (record.expiresInSeconds as number) >= 1 && (record.expiresInSeconds as number) <= 300 ? record.expiresInSeconds : 300,
    confirmationRequired: true
  });
}

function workspaceSelectionReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: 'selected',
    selectionId: opaqueId(record.selectionId),
    mode: typeof record.mode === 'string' && ['select-existing', 'create-new'].includes(record.mode) ? record.mode : undefined,
    created: record.created === true,
    alreadySelected: record.alreadySelected === true,
    label: redactedMetadataLabel(record.label, 'Local workspace'),
    workspaceId: record.workspaceId === null ? null : opaqueId(record.workspaceId),
    bootstrapState: machineState(record.bootstrapState)
  });
}

function evalsReceipt(value: unknown, requestedLimit: number): Record<string, unknown> {
  const record = objectRecord(value);
  const rawResults = Array.isArray(record.caseResults) ? record.caseResults.slice(0, requestedLimit) : [];
  const caseResults = rawResults.map(evalCaseResultReceipt).filter((item): item is Record<string, unknown> => Boolean(item));
  const rawPagination = objectRecord(record.caseResultsPagination);
  const total = Number.isSafeInteger(rawPagination.total)
    && (rawPagination.total as number) >= caseResults.length
    && (rawPagination.total as number) <= 10_000
    ? rawPagination.total as number
    : caseResults.length;
  const recentRuns = Array.isArray(record.recentRuns)
    ? record.recentRuns.slice(0, 12).map(evalRunReceipt).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const evidenceIssues = Array.isArray(record.evidenceIssues)
    ? [...new Set(record.evidenceIssues.slice(0, 100).map(evalMachineCode).filter((item): item is string => Boolean(item)))]
    : [];
  return compactReceipt({
    present: record.present === true,
    evidenceLevel: typeof record.evidenceLevel === 'string' && ['demo', 'smoke', 'candidate', 'release'].includes(record.evidenceLevel) ? record.evidenceLevel : undefined,
    releaseEvidenceEligible: record.releaseEvidenceEligible === true,
    pass: record.pass === true,
    datasetDigest: record.datasetDigest === null ? null : safeDigest(record.datasetDigest),
    effectiveRevisionDigest: record.effectiveRevisionDigest === null ? null : safeDigest(record.effectiveRevisionDigest),
    composition: evalAggregateReceipt(record.composition),
    holdout: evalAggregateReceipt(record.holdout),
    leakage: evalAggregateReceipt(record.leakage),
    baselineComparison: evalAggregateReceipt(record.baselineComparison),
    count: evalCount(record.count),
    top1Rate: evalRate(record.top1Rate),
    top3Rate: evalRate(record.top3Rate),
    avoidHits: evalCount(record.avoidHits),
    evidenceIssues,
    revision: revisionReceipt(record.revision),
    currentRun: evalRunReceipt(record.currentRun) ?? evalRunReceipt({ state: 'not-run', progress: { mode: 'unavailable' }, reportAvailable: false }),
    recentRuns,
    caseResultsSchemaVersion: record.caseResultsSchemaVersion === 3 ? 3 : undefined,
    caseResults,
    caseResultsPagination: {
      total,
      limit: requestedLimit,
      hasMore: rawPagination.hasMore === true,
      nextCursor: rawPagination.nextCursor === null ? null : safeCursor(rawPagination.nextCursor) ?? null
    },
    caseTraceState: typeof record.caseTraceState === 'string' && ['available', 'empty', 'unavailable', 'binding-mismatch', 'invalid', 'too-large'].includes(record.caseTraceState) ? record.caseTraceState : 'invalid',
    promptStored: false
  });
}

function evalRunReceipt(value: unknown): Record<string, unknown> | undefined {
  const record = objectRecord(value);
  const state = typeof record.state === 'string' && ['not-run', 'queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(record.state) ? record.state : undefined;
  if (!state) return undefined;
  const progress = objectRecord(record.progress);
  const mode = typeof progress.mode === 'string' && ['determinate', 'indeterminate', 'unavailable'].includes(progress.mode) ? progress.mode : 'unavailable';
  return {
    runId: record.runId === null ? null : typeof record.runId === 'string' && /^evalrun_[A-Za-z0-9_-]{8,80}$/.test(record.runId) ? record.runId : null,
    suiteId: record.suiteId === null ? null : typeof record.suiteId === 'string' && /^evalsuite_[A-Za-z0-9_-]{8,80}$/.test(record.suiteId) ? record.suiteId : null,
    jobId: record.jobId === null ? null : opaqueId(record.jobId) ?? null,
    state,
    expectedRevision: record.expectedRevision === null ? null : canonicalRevisionId(record.expectedRevision) ?? null,
    resultRevisionId: record.resultRevisionId === null ? null : canonicalRevisionId(record.resultRevisionId) ?? null,
    resultWorkspaceRevision: record.resultWorkspaceRevision === null ? null : safeDigest(record.resultWorkspaceRevision) ?? null,
    reportRevision: record.reportRevision === null ? null : revisionReceipt(record.reportRevision) ?? null,
    reportBinding: typeof record.reportBinding === 'string' && ['result-revision', 'carried-forward', 'report-only', 'unavailable'].includes(record.reportBinding) ? record.reportBinding : 'unavailable',
    reportArtifactDigest: record.reportArtifactDigest === null ? null : safeDigest(record.reportArtifactDigest) ?? null,
    reportEffectiveRevisionDigest: record.reportEffectiveRevisionDigest === null ? null : safeDigest(record.reportEffectiveRevisionDigest) ?? null,
    createdAt: record.createdAt === null ? null : safeTimestamp(record.createdAt) ?? null,
    startedAt: record.startedAt === null ? null : safeTimestamp(record.startedAt) ?? null,
    completedAt: record.completedAt === null ? null : safeTimestamp(record.completedAt) ?? null,
    errorCode: record.errorCode === null ? null : evalMachineCode(record.errorCode) ?? null,
    progress: {
      mode,
      completedCases: progress.completedCases === null ? null : evalCount(progress.completedCases) ?? null,
      totalCases: progress.totalCases === null ? null : evalCount(progress.totalCases) ?? null,
      ratio: progress.ratio === null ? null : evalRate(progress.ratio) ?? null
    },
    reportAvailable: record.reportAvailable === true
  };
}

function evalCaseResultReceipt(value: unknown): Record<string, unknown> | undefined {
  const record = objectRecord(value);
  const caseId = typeof record.caseId === 'string' && /^evalcase_[A-Za-z0-9_-]{8,100}$/.test(record.caseId) ? record.caseId : undefined;
  const primaryCaseType = typeof record.primaryCaseType === 'string' && ['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss'].includes(record.primaryCaseType) ? record.primaryCaseType : undefined;
  const membership = record.membership === 'train' || record.membership === 'holdout' ? record.membership : undefined;
  const expectedSkillIds = evalSkillIdList(record.expectedSkillIds);
  const avoidSkillIds = evalSkillIdList(record.avoidSkillIds);
  const qualifiedSkillId = record.qualifiedSkillId === undefined ? undefined : safeSkillId(record.qualifiedSkillId);
  const recommendedSkillIds = evalSkillIdList(record.recommendedSkillIds);
  const avoidedButRecommendedSkillIds = evalSkillIdList(record.avoidedButRecommendedSkillIds);
  const outcome = typeof record.outcome === 'string' && ['top1-hit', 'top3-hit', 'correct-abstention', 'miss', 'unsafe', 'invalid'].includes(record.outcome) ? record.outcome : undefined;
  const advisoryBytes = evalAdvisoryBytes(record.advisoryBytes);
  const reasonCodes = evalCodeList(record.reasonCodes);
  const validationCodes = evalCodeList(record.validationCodes);
  const leakageCodes = evalCodeList(record.leakageCodes);
  if (!caseId || !primaryCaseType || !membership || expectedSkillIds === undefined || avoidSkillIds === undefined
    || (record.qualifiedSkillId !== undefined && qualifiedSkillId === undefined)
    || recommendedSkillIds === undefined || avoidedButRecommendedSkillIds === undefined || !outcome
    || advisoryBytes === undefined || reasonCodes === undefined || validationCodes === undefined || leakageCodes === undefined) return undefined;
  return {
    caseId,
    primaryCaseType,
    membership,
    releaseCounted: record.releaseCounted === true,
    releaseScored: record.releaseScored === true,
    expectedSkillIds,
    avoidSkillIds,
    ...(qualifiedSkillId ? { qualifiedSkillId } : {}),
    recommendedSkillIds,
    avoidedButRecommendedSkillIds,
    top1Hit: record.top1Hit === true,
    top3Hit: record.top3Hit === true,
    abstained: record.abstained === true,
    advisoryBytes,
    outcome,
    reasonCodes,
    validationCodes,
    leakageCodes
  };
}

function evalSkillIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const result = value.map(safeSkillId);
  if (result.some((item) => item === undefined) || new Set(result).size !== result.length) return undefined;
  return result as string[];
}

function evalCodeList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const result = value.map(evalMachineCode);
  if (result.some((item) => item === undefined) || new Set(result).size !== result.length) return undefined;
  return result as string[];
}

function evalMachineCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value) ? value : undefined;
}

function evalCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000 ? value as number : undefined;
}

function evalAdvisoryBytes(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_048_576 ? value as number : undefined;
}

function evalRate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function evalAggregateReceipt(value: unknown): Record<string, number | boolean | string | null> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, number | boolean | string | null> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) continue;
    if (typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean' || item === null) result[key] = item as number | boolean | null;
    else if (typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item)) result[key] = item;
  }
  return Object.keys(result).length ? result : undefined;
}

function jobCreationReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({ job: jobStatusReceipt(record.job ?? record), created: record.created === true });
}

function jobListReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  const items = Array.isArray(record.items) ? record.items.slice(0, 100).map(jobStatusReceipt) : [];
  const total = Number.isSafeInteger(record.total) && (record.total as number) >= items.length && (record.total as number) <= 10_000
    ? record.total
    : items.length;
  return { items, total };
}

function jobStatusReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  const resultReceipt = objectRecord(record.resultReceipt);
  const safeResult: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(resultReceipt).slice(0, 32)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || /prompt|body|path|secret|token|password|command|stdout|stderr|diff/i.test(key)) continue;
    if (typeof item === 'string' && item.length <= 256 || typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean' || item === null) {
      safeResult[key] = item as string | number | boolean | null;
    }
  }
  const error = objectRecord(record.error);
  const errorCode = safeMachineCode(error.code, 64);
  return compactReceipt({
    kind: record.kind === 'skillmap.job' ? 'skillmap.job' : undefined,
    schemaVersion: record.schemaVersion === 1 ? 1 : undefined,
    jobId: opaqueId(record.jobId),
    type: typeof record.type === 'string' && ['scan', 'doctor', 'doctor-pack', 'graph-build', 'eval-run', 'sources-check'].includes(record.type) ? record.type : undefined,
    state: typeof record.state === 'string' && ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(record.state) ? record.state : undefined,
    expectedRevision: canonicalRevisionId(record.expectedRevision),
    idempotencyKey: safeDigest(record.idempotencyKey),
    requestDigest: safeDigest(record.requestDigest),
    confirmation: record.confirmation === 'none' ? 'none' : undefined,
    createdAt: safeTimestamp(record.createdAt),
    startedAt: safeTimestamp(record.startedAt),
    completedAt: safeTimestamp(record.completedAt),
    resultReceipt: Object.keys(safeResult).length ? safeResult : undefined,
    error: errorCode ? { code: errorCode, message: 'The isolated job did not complete.', retryable: error.retryable === true } : undefined
  });
}

function jobCancellationReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  const state = typeof record.state === 'string' && ['cancelled', 'cancellation-requested'].includes(record.state) ? record.state : undefined;
  return compactReceipt({
    state,
    jobId: opaqueId(record.jobId),
    jobState: typeof record.jobState === 'string' && ['queued', 'running', 'cancelled'].includes(record.jobState) ? record.jobState : undefined,
    cancellationDigest: safeDigest(record.cancellationDigest),
    idempotent: record.idempotent === true,
    publicationPrevented: record.publicationPrevented === true
  });
}

function rollbackReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  return compactReceipt({
    state: record.state === 'rolled-back' ? 'rolled-back' : undefined,
    revision: revisionReceipt(record.revision),
    targetRevisionId: canonicalRevisionId(record.targetRevisionId),
    routingApproved: false,
    routingApprovalRequired: true,
    warningCount: Number.isInteger(record.warningCount) && (record.warningCount as number) >= 0 && (record.warningCount as number) <= 1_000 ? record.warningCount : 0
  });
}

function revisionHistoryReceipt(value: unknown): Record<string, unknown> {
  const record = objectRecord(value);
  const items = Array.isArray(record.items) ? record.items.slice(0, 100).map((value) => {
    const item = objectRecord(value);
    const mutation = objectRecord(item.mutation);
    return compactReceipt({
      revision: revisionReceipt(item.revision),
      sequence: Number.isSafeInteger(item.sequence) && (item.sequence as number) >= 1 ? item.sequence : undefined,
      parentRevisionId: item.parentRevisionId === null ? null : canonicalRevisionId(item.parentRevisionId),
      createdAt: safeTimestamp(item.createdAt),
      mutation: compactReceipt({
        kind: typeof mutation.kind === 'string' && ['legacy-migration', 'legacy-snapshot', 'rollback', 'recovery'].includes(mutation.kind) ? mutation.kind : undefined,
        actor: mutation.actor === null ? null : safeMachineCode(mutation.actor, 64),
        reasonDigest: mutation.reasonDigest === null ? null : safeDigest(mutation.reasonDigest),
        sourceRevisionId: mutation.sourceRevisionId === null ? null : canonicalRevisionId(mutation.sourceRevisionId),
        targetRevisionId: mutation.targetRevisionId === null ? null : canonicalRevisionId(mutation.targetRevisionId)
      }),
      isCurrent: item.isCurrent === true,
      isRoutingServing: item.isRoutingServing === true,
      routingApprovalRecorded: item.routingApprovalRecorded === true,
      artifactCount: Number.isSafeInteger(item.artifactCount) && (item.artifactCount as number) >= 0 ? item.artifactCount : undefined
    });
  }) : [];
  return compactReceipt({
    items,
    limit: Number.isInteger(record.limit) && (record.limit as number) >= 1 && (record.limit as number) <= 100 ? record.limit : undefined,
    hasMore: record.hasMore === true,
    nextCursor: record.nextCursor === null ? null : safeCursor(record.nextCursor),
    currentRevision: revisionReceipt(record.currentRevision),
    routingRevisionId: record.routingRevisionId === null ? null : canonicalRevisionId(record.routingRevisionId)
  });
}

function objectRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function compactReceipt(value: Record<string, unknown>): Record<string, unknown> { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
function machineState(value: unknown): string | undefined { return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) ? value : undefined; }
function opaqueId(value: unknown): string | undefined { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : undefined; }
function safeSkillId(value: unknown): string | undefined { return typeof value === 'string' && /^sk_[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined; }
function safeDigest(value: unknown): string | undefined { return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value) ? value : undefined; }
function commitHash(value: unknown): string | undefined { return typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value) ? value : undefined; }
function canonicalRevisionId(value: unknown): string | undefined { return typeof value === 'string' && /^r[0-9]{20}-[0-9a-f-]{36}$/i.test(value) ? value : undefined; }
function safeMachineCode(value: unknown, maximum: number): string | undefined { return typeof value === 'string' && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : undefined; }
function safeCursor(value: unknown): string | undefined { return typeof value === 'string' && value.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined; }
function safeTimestamp(value: unknown): string | undefined { return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : undefined; }
function revisionReceipt(value: unknown): RevisionRef | undefined {
  const record = objectRecord(value);
  if (!opaqueId(record.workspaceId) || typeof record.revisionId !== 'string' || !/^r[0-9]{20}-[0-9a-f-]{36}$/i.test(record.revisionId) || !safeDigest(record.workspaceRevision)) return undefined;
  const effectiveDigest = record.effectiveDigest === null ? null : safeDigest(record.effectiveDigest);
  const effectiveRevisionDigest = record.effectiveRevisionDigest === null ? null : safeDigest(record.effectiveRevisionDigest);
  if (effectiveDigest === undefined || effectiveRevisionDigest === undefined) return undefined;
  return { workspaceId: record.workspaceId as string, revisionId: record.revisionId, workspaceRevision: record.workspaceRevision as string, effectiveDigest, effectiveRevisionDigest };
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false) { super(message); this.name = 'HttpError'; }
}
