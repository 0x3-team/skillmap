import { clearConnectorAuth } from './state.js';

export const EXPECTED_CONNECTOR_COMPATIBILITY = Object.freeze({ apiVersion: 'v1', localAppAssetVersion: 'v1', productVersion: '0.1.0' });

const COMPATIBILITY_ERROR_CODES = new Set(['API_ENVELOPE_INCOMPATIBLE', 'LOCAL_APP_VERSION_MISMATCH']);
const CONNECTOR_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function createApiClient(state, { setConnected, showStaleNotice, blockCompatibility }) {
  async function api(pathname, options = {}) {
    if (state.compatibilityBlocked && pathname !== '/api/v1/bootstrap') throw state.compatibilityBlocked;
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    const method = options.method || (options.body === undefined ? 'GET' : 'POST');
    const publicHealth = method === 'GET' && pathname.split('?', 1)[0] === '/api/v1/health';
    if (!publicHealth) {
      if (!CONNECTOR_TOKEN.test(state.capability || '')) {
        clearConnectorAuth(state);
        throw { code: 'CAPABILITY_REQUIRED', safeMessage: 'Open the one-time SkillMap dashboard URL from the CLI.' };
      }
      headers['x-skillmap-capability'] = state.capability;
    }
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const cacheable = options.body === undefined && method === 'GET' && options.cache !== false;
    if (cacheable && state.etags.has(pathname)) headers['if-none-match'] = state.etags.get(pathname);
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (mutation) {
      if (!CONNECTOR_TOKEN.test(state.csrf || '')) {
        clearConnectorAuth(state);
        throw { code: 'CSRF_REJECTED', safeMessage: 'Reopen the one-time SkillMap dashboard URL before making changes.' };
      }
      headers['x-skillmap-csrf'] = state.csrf;
    }
    let response;
    try {
      response = await fetch(pathname, {
        method,
        credentials: 'omit',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw { code: 'REQUEST_CANCELLED', safeMessage: 'The local request was cancelled.' };
      setConnected(false, 'Disconnected');
      if (cacheable && state.responseCache.has(pathname)) {
        state.offlineData = true;
        showStaleNotice('Showing the last in-memory redacted response. Reconnect before making changes.');
        return state.responseCache.get(pathname);
      }
      throw { code: 'CONNECTOR_OFFLINE', safeMessage: 'The local connector is not responding. Your last redacted view is still available.' };
    }
    if (response.status === 304) {
      if (state.responseCache.has(pathname)) return state.responseCache.get(pathname);
      state.etags.delete(pathname);
      return api(pathname, { ...options, cache: false });
    }
    if (response.status === 401) clearConnectorAuth(state);
    let envelope;
    try { envelope = await response.json(); } catch { throw { code: 'MALFORMED_RESPONSE', safeMessage: 'The connector returned a malformed response.' }; }
    try { assertApiEnvelope(envelope); } catch (error) {
      state.compatibilityBlocked = error;
      blockCompatibility(error);
      throw error;
    }
    if (envelope.ok) {
      try { assertEndpointPayload(pathname, envelope.data, method); } catch (error) {
        state.compatibilityBlocked = error;
        blockCompatibility(error);
        throw error;
      }
    }
    if (!response.ok || !envelope.ok) {
      const error = envelope.error || { code: 'REQUEST_FAILED', message: 'The local request failed.' };
      if (error.code === 'CAPABILITY_REQUIRED') clearConnectorAuth(state);
      const revisionRetryAttempt = options.revisionRetryAttempt || 0;
      if (response.status === 409 && error.code === 'REVISION_CHANGED_RETRY' && error.retryable === true && revisionRetryAttempt < 1) {
        if (options.signal?.aborted) throw { code: 'REQUEST_CANCELLED', safeMessage: 'The local request was cancelled.' };
        state.etags.delete(pathname);
        return api(pathname, { ...options, revisionRetryAttempt: revisionRetryAttempt + 1 });
      }
      throw { code: error.code, safeMessage: error.message, retryable: error.retryable, details: error.details, status: response.status };
    }
    if (pathname === '/api/v1/bootstrap') {
      try { assertConnectorCompatibility(envelope.data?.connectorCompatibility); } catch (error) {
        state.compatibilityBlocked = error;
        blockCompatibility(error);
        throw error;
      }
      state.compatibilityBlocked = null;
    }
    state.offlineData = false;
    setConnected(true, envelope.compatibility === 'degraded' ? 'Degraded' : 'Connected');
    if (cacheable) {
      const etag = response.headers.get('etag');
      if (etag) state.etags.set(pathname, etag);
      state.responseCache.set(pathname, envelope.data);
    }
    return envelope.data;
  }

  api.invalidate = () => {
    state.etags.clear();
    state.responseCache.clear();
    state.viewStale = false;
  };

  return api;
}

export function isCompatibilityError(error) {
  return COMPATIBILITY_ERROR_CODES.has(error?.code);
}

export function assertApiEnvelope(envelope) {
  const fail = () => { throw incompatibleEnvelope(); };
  if (!isRecord(envelope) || envelope.kind !== 'skillmap.api-response' || envelope.schemaVersion !== 1 || typeof envelope.ok !== 'boolean') fail();
  const expectedKeys = envelope.ok
    ? ['kind', 'schemaVersion', 'ok', 'requestId', 'servingRevision', 'currentRevision', 'compatibility', 'data']
    : ['kind', 'schemaVersion', 'ok', 'requestId', 'servingRevision', 'currentRevision', 'compatibility', 'error'];
  if (!hasExactKeys(envelope, expectedKeys) || !UUID.test(envelope.requestId)) fail();
  if (!isRevisionRefOrNull(envelope.servingRevision) || !isRevisionRefOrNull(envelope.currentRevision)) fail();
  if (!['compatible', 'degraded', 'upgrade-required', 'client-too-new', 'incompatible'].includes(envelope.compatibility)) fail();
  if (envelope.ok) {
    if (!Object.hasOwn(envelope, 'data')) fail();
  } else if (!isSafeApiError(envelope.error)) fail();
}

export function assertEndpointPayload(pathname, data, method = 'GET') {
  if (!isRecord(data)) throw incompatibleEnvelope();
  const route = String(pathname).split('?', 1)[0];
  const normalizedMethod = String(method).toUpperCase();
  const shape = endpointShape(route, normalizedMethod);
  if (!shape || !hasAllowedKeys(data, shape.required, shape.optional)) throw incompatibleEnvelope();
  if (!validateEndpointPayload(route, normalizedMethod, data)) throw incompatibleEnvelope();
}

export function assertConnectorCompatibility(receipt) {
  const valid = receipt && typeof receipt === 'object' && !Array.isArray(receipt)
    && hasExactKeys(receipt, Object.keys(EXPECTED_CONNECTOR_COMPATIBILITY))
    && Object.keys(EXPECTED_CONNECTOR_COMPATIBILITY).every(key => receipt[key] === EXPECTED_CONNECTOR_COMPATIBILITY[key]);
  if (!valid) {
    throw {
      code: 'LOCAL_APP_VERSION_MISMATCH',
      safeMessage: 'This local app bundle is not compatible with the running connector. Restart skillmap dashboard after updating SkillMap.',
      expectedCompatibility: EXPECTED_CONNECTOR_COMPATIBILITY,
      receivedCompatibility: safeCompatibilityReceipt(receipt)
    };
  }
}

function safeCompatibilityReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const safe = {};
  for (const key of ['apiVersion', 'localAppAssetVersion', 'productVersion']) {
    const item = value[key];
    safe[key] = typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(item) ? item : 'invalid';
  }
  return safe;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_ID = /^r[0-9]{20}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const BOOTSTRAP_STATES = new Set(['uninitialized', 'partial-legacy', 'needs-state-migration', 'recovery-required', 'ready', 'attention-required', 'manual-repair-required']);
const READINESS_PHASES = new Set([
  'needs-state-migration', 'state-corrupt', 'missing-inventory', 'needs-config', 'empty-inventory', 'identity-invalid', 'fixture-inventory',
  'needs-doctor', 'needs-doctor-pack', 'needs-policy', 'needs-duplicate-resolution', 'needs-curation', 'stale-curation', 'needs-effective',
  'stale-effective', 'needs-graph', 'needs-sources', 'needs-source-review', 'needs-eval', 'eval-fixture', 'eval-failing',
  'needs-routing-approval', 'ready'
]);
const SERVING_MODES = new Set(['current', 'last-known-good', 'unavailable']);
const SKILL_TIERS = new Set(['active-default', 'specialist', 'explicit-only', 'archived', 'blocked']);
const SKILL_VARIANTS = new Set(['unique', 'canonical', 'shadowed-duplicate', 'unresolved-duplicate']);
const SKILL_SCOPES = new Set(['user', 'project', 'plugin', 'fixture', 'unknown']);
const SOURCE_STATES = new Set(['external-clean', 'external-modified', 'external-stale', 'external-risky-update', 'local-authored', 'local-modified', 'unknown']);
const ROUTE_SURFACES = new Set(['cli', 'hook', 'mcp', 'api']);
const ROUTE_OUTCOMES = new Set(['recommended', 'abstained', 'blocked', 'error']);
const LATENCY_BUCKETS = new Set(['lt-10ms', 'lt-50ms', 'lt-250ms', 'gte-250ms']);
const FRESHNESS_REASONS = new Set([
  'verification-pending', 'workspace-uninitialized', 'watch-event', 'manifest-mismatch', 'watcher-unavailable',
  'approved-state-unavailable', 'baseline-invalid', 'root-unavailable', 'root-identity-changed', 'unsafe-entry',
  'verification-limit', 'verification-timeout', 'verification-failed'
]);
const MCP_TOOL_INPUT_SCHEMAS = Object.freeze({
  route_prompt: '{"type":"object","additionalProperties":false,"properties":{"prompt":{"type":"string","minLength":1,"maxLength":32768},"max":{"type":"integer","minimum":1,"maximum":10},"skillId":{"type":"string","pattern":"^sk_[A-Za-z0-9_-]{43}$"}},"required":["prompt"]}',
  search_skills: '{"type":"object","additionalProperties":false,"properties":{"query":{"type":"string","maxLength":256},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20},"cursor":{"type":"string","maxLength":1024}}}',
  show_skill: '{"type":"object","additionalProperties":false,"properties":{"skillId":{"type":"string","pattern":"^sk_[A-Za-z0-9_-]{43}$"}},"required":["skillId"]}',
  show_skillgraph: '{"type":"object","additionalProperties":false,"properties":{"limit":{"type":"integer","minimum":1,"maximum":100,"default":20},"cursor":{"type":"string","maxLength":1024}}}',
  doctor_summary: '{"type":"object","additionalProperties":false,"properties":{"limit":{"type":"integer","minimum":1,"maximum":100,"default":20},"cursor":{"type":"string","maxLength":1024}}}',
  source_status: '{"type":"object","additionalProperties":false,"properties":{"limit":{"type":"integer","minimum":1,"maximum":100,"default":20},"cursor":{"type":"string","maxLength":1024}}}'
});

function incompatibleEnvelope() {
  return { code: 'API_ENVELOPE_INCOMPATIBLE', safeMessage: 'The connector returned an unsupported API envelope. Restart the dashboard with the matching SkillMap application.' };
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function isRevisionRefOrNull(value) {
  if (value === null) return true;
  return isRecord(value)
    && hasExactKeys(value, ['workspaceId', 'revisionId', 'workspaceRevision', 'effectiveDigest', 'effectiveRevisionDigest'])
    && UUID.test(value.workspaceId)
    && REVISION_ID.test(value.revisionId)
    && DIGEST.test(value.workspaceRevision)
    && (value.effectiveDigest === null || DIGEST.test(value.effectiveDigest))
    && (value.effectiveRevisionDigest === null || DIGEST.test(value.effectiveRevisionDigest));
}
function isSafeApiError(value) {
  return isRecord(value)
    && hasExactKeys(value, Object.hasOwn(value, 'details') ? ['code', 'message', 'retryable', 'details'] : ['code', 'message', 'retryable'])
    && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)
    && typeof value.message === 'string'
    && value.message.length >= 1
    && value.message.length <= 240
    && !/[\r\n\t]/.test(value.message)
    && typeof value.retryable === 'boolean'
    && (!Object.hasOwn(value, 'details') || (isRecord(value.details) && Object.keys(value.details).length <= 50));
}

function validateEndpointPayload(route, method, data) {
  const allowHookText = route === '/api/v1/routes/preview' || route === '/api/v1/integrations/hook/verify';
  const allowSchemaPrompt = route === '/api/v1/integrations/mcp';
  if (!isBoundedPublicValue(data, 0, new Set(), allowHookText, allowSchemaPrompt)) return false;

  if (method === 'GET' && route === '/api/v1/health') {
    return ['ok', 'attention-required', 'needs-bootstrap', 'state-unavailable'].includes(data.status)
      && data.process === 'skillmap-dashboard' && isVersionText(data.version)
      && ['compatible', 'degraded', 'upgrade-required', 'client-too-new', 'incompatible'].includes(data.compatibility);
  }
  if (method === 'GET' && route === '/api/v1/bootstrap') return isBootstrapPayload(data);
  if (method === 'GET' && route === '/api/v1/workspace') return isWorkspacePayload(data);
  if (method === 'GET' && route === '/api/v1/dashboard') return isDashboardPayload(data);
  if (method === 'GET' && route === '/api/v1/skills') return isSkillPage(data);
  if (method === 'GET' && /^\/api\/v1\/skills\/sk_[A-Za-z0-9_-]{43}$/.test(route)) return isSkillDetail(data);
  if (method === 'POST' && route === '/api/v1/routes/preview') return isRouteResult(data);
  if (method === 'GET' && route === '/api/v1/routes') return isRoutePage(data);
  if (method === 'GET' && /^\/api\/v1\/routes\/[0-9a-f-]{36}$/i.test(route)) return isRouteEvent(data);
  if (method === 'POST' && /^\/api\/v1\/routes\/[0-9a-f-]{36}\/feedback$/i.test(route)) return isRouteFeedback(data);
  if (method === 'GET' && route === '/api/v1/policy/reviews') return isPolicyReviews(data);
  if (method === 'POST' && route === '/api/v1/policy/preview') return isPolicyPreview(data);
  if (method === 'POST' && route === '/api/v1/policy/proposals') return isPolicyProposal(data);
  if (method === 'POST' && route === '/api/v1/policy/decisions') return isPolicyDecision(data);
  if (method === 'POST' && route === '/api/v1/policy/apply') return isPolicyApply(data);
  if (method === 'GET' && route === '/api/v1/sources') return isSourcesPayload(data);
  if (method === 'POST' && route === '/api/v1/sources/adoptions') return isSourceAdoption(data);
  if (method === 'POST' && route === '/api/v1/sources/diff') return isSourceDiff(data);
  if (method === 'POST' && route === '/api/v1/sources/reviews') return isSourceReview(data);
  if (method === 'GET' && route === '/api/v1/evals') return isEvalsPayload(data);
  if (method === 'POST' && route === '/api/v1/evals/import') return isEvalImport(data);
  if (method === 'GET' && route === '/api/v1/integrations/mcp') return isMcpManifest(data);
  if (method === 'POST' && route === '/api/v1/integrations/hook/verify') return isHookVerification(data);
  if (route === '/api/v1/jobs' && method === 'GET') return data.items.length <= 100 && data.items.every(isJob) && isNonnegativeInteger(data.total) && data.total >= data.items.length;
  if (route === '/api/v1/jobs' && method === 'POST') return isJob(data.job) && typeof data.created === 'boolean';
  if (method === 'GET' && /^\/api\/v1\/jobs\/[0-9a-f-]{36}$/i.test(route)) return isJob(data);
  if (method === 'POST' && /^\/api\/v1\/jobs\/[0-9a-f-]{36}\/cancel$/i.test(route)) {
    return ['cancelled', 'cancellation-requested'].includes(data.state)
      && UUID.test(data.jobId)
      && ['queued', 'running', 'cancelled'].includes(data.jobState)
      && DIGEST.test(data.cancellationDigest)
      && typeof data.idempotent === 'boolean'
      && typeof data.publicationPrevented === 'boolean';
  }
  if (method === 'GET' && route === '/api/v1/state/revisions') return isRevisionHistory(data);
  if (method === 'POST' && route === '/api/v1/state/rollback') {
    return data.state === 'rolled-back' && isRevisionRefOrNull(data.revision) && data.revision !== null
      && REVISION_ID.test(data.targetRevisionId) && data.routingApproved === false
      && data.routingApprovalRequired === true && isNonnegativeInteger(data.warningCount);
  }
  if (method === 'POST' && route === '/api/v1/state/migrate') {
    return data.state === 'migrated' && data.migrated === true && typeof data.alreadyMigrated === 'boolean'
      && isRevisionRefOrNull(data.revision) && data.revision !== null && isNonnegativeInteger(data.warningCount);
  }
  if (method === 'POST' && route === '/api/v1/state/recover') {
    return data.state === 'recovered' && data.recovered === true
      && isRevisionRefOrNull(data.revision) && data.revision !== null && isNonnegativeInteger(data.warningCount);
  }
  if (method === 'POST' && route === '/api/v1/workspaces/validate') return isWorkspaceValidation(data);
  if (method === 'POST' && route === '/api/v1/workspaces/select') return isWorkspaceSelection(data);
  if (method === 'POST' && route === '/api/v1/roots/validate') return isRootValidation(data);
  if (method === 'POST' && route === '/api/v1/roots/approve') return isRootApproval(data);
  if (method === 'POST' && route === '/api/v1/state/adopt-partial-legacy') return isPartialLegacyReceipt(data);
  return false;
}

function isBootstrapPayload(data) {
  if (typeof data.initialized !== 'boolean' || typeof data.routingReady !== 'boolean' || typeof data.productReady !== 'boolean') return false;
  if (!isConnectorCompatibilityReceipt(data.connectorCompatibility)) return false;
  if (Object.hasOwn(data, 'configuredRootCount') && !isNonnegativeInteger(data.configuredRootCount)) return false;
  if (Object.hasOwn(data, 'revision') && !isRevisionRefOrNull(data.revision)) return false;
  if (Object.hasOwn(data, 'currentRevision') && !isRevisionRefOrNull(data.currentRevision)) return false;
  if (Object.hasOwn(data, 'readiness') && !exactRecord(data.readiness, ['verdict', 'phase'], [], {
    verdict: value => ['ok', 'attention required', 'blocked'].includes(value), phase: value => READINESS_PHASES.has(value)
  })) return false;
  return isBootstrapStateConsistent(data)
    && (!Object.hasOwn(data, 'recoverable') || typeof data.recoverable === 'boolean')
    && (!Object.hasOwn(data, 'servingMode') || SERVING_MODES.has(data.servingMode))
    && (!Object.hasOwn(data, 'errorCode') || /^[A-Z][A-Z0-9_]{0,79}$/.test(data.errorCode))
    && (!Object.hasOwn(data, 'guidance') || isSafeText(data.guidance, 1_000));
}

function isBootstrapStateConsistent(data) {
  const flags = `${+data.initialized}${+data.routingReady}${+data.productReady}:${data.nextAction}`;
  if (data.state === 'partial-legacy') {
    return flags === `000:${data.configuredRootCount > 0 ? 'adopt-configured-roots' : 'approve-roots'}` && isNonnegativeInteger(data.configuredRootCount);
  }
  if (data.state === 'attention-required') {
    return ['100:approve-routing', '100:continue-onboarding'].includes(flags)
      && (!Object.hasOwn(data, 'recoverable') || data.recoverable === false);
  }
  if (data.state === 'ready') {
    return ['110:route', '111:route'].includes(flags)
      && (!data.productReady || data.readiness?.verdict === 'ok' && data.readiness.phase === 'ready')
      && (!Object.hasOwn(data, 'recoverable') || data.recoverable === false);
  }
  const exact = {
    uninitialized: '000:approve-roots', 'needs-state-migration': '100:state-migrate',
    'recovery-required': '100:state-recover', 'manual-repair-required': '100:state-status'
  }[data.state];
  if (flags !== exact) return false;
  if (data.state === 'recovery-required') return data.recoverable === true;
  if (data.state === 'manual-repair-required') return !Object.hasOwn(data, 'recoverable') || data.recoverable === false;
  return !Object.hasOwn(data, 'configuredRootCount');
}

function isWorkspacePayload(data) {
  return UUID.test(data.workspaceId)
    && isSafeText(data.name, 200)
    && isReadiness(data.readiness)
    && isRevisionRefOrNull(data.revision)
    && isRevisionRefOrNull(data.currentRevision) && data.currentRevision !== null
    && SERVING_MODES.has(data.servingMode)
    && typeof data.routingReady === 'boolean'
    && typeof data.filesystemDirty === 'boolean'
    && isFilesystemFreshness(data.filesystemFreshness)
    && (!data.filesystemFreshness.filesystemDirty || data.filesystemDirty)
    && Array.isArray(data.roots) && data.roots.length <= 1_000
    && data.roots.every(root => exactRecord(root, ['rootId', 'label', 'approvedAt'], [], {
      rootId: value => UUID.test(value), label: value => isSafeText(value, 200), approvedAt: isTimestamp
    }));
}

function isDashboardPayload(data) {
  return exactRecord(data.workspace, ['workspaceId', 'name'], [], { workspaceId: value => UUID.test(value), name: value => isSafeText(value, 200) })
    && isRevisionRefOrNull(data.revision)
    && isRevisionRefOrNull(data.currentRevision) && data.currentRevision !== null
    && SERVING_MODES.has(data.servingMode)
    && typeof data.routingReady === 'boolean'
    && typeof data.filesystemDirty === 'boolean'
    && isFilesystemFreshness(data.filesystemFreshness)
    && (!data.filesystemFreshness.filesystemDirty || data.filesystemDirty)
    && isReadiness(data.readiness)
    && exactRecord(data.counts, ['skills', 'routeEligible', 'sourceTracked', 'evalCases'], [], {
      skills: isNonnegativeInteger, routeEligible: isNonnegativeInteger, sourceTracked: isNonnegativeInteger, evalCases: isNonnegativeInteger
    })
    && exactRecord(data.evidence, [
      'inventorySkills', 'observedRoutes', 'evalConfidence', 'releaseEvidenceEligible', 'tokenMetricsSource',
      'doctorPresent', 'doctorPackPresent', 'curationPresent', 'curationStale'
    ], [], {
      inventorySkills: isNonnegativeInteger,
      observedRoutes: isNonnegativeInteger,
      evalConfidence: item => ['none', 'demo', 'weak', 'alpha', 'release'].includes(item),
      releaseEvidenceEligible: value => typeof value === 'boolean',
      tokenMetricsSource: item => item === 'not-measured',
      doctorPresent: value => typeof value === 'boolean',
      doctorPackPresent: value => typeof value === 'boolean',
      curationPresent: value => typeof value === 'boolean',
      curationStale: value => typeof value === 'boolean'
    });
}

function isReadiness(value) {
  return exactRecord(value, ['verdict', 'phase', 'warnings', 'nextActions'], [], {
    verdict: item => ['ok', 'attention required', 'blocked'].includes(item),
    phase: item => READINESS_PHASES.has(item),
    warnings: item => isStringList(item, 20, 1_000),
    nextActions: item => isStringList(item, 20, 1_000)
  });
}

function isFilesystemFreshness(value) {
  if (!exactRecord(value, ['state', 'filesystemDirty', 'reasonCode', 'observedAt', 'lastVerifiedAt', 'observedDigest', 'expectedDigest', 'rootIds', 'suggestedJobType'], [], {
    state: item => ['inactive', 'clean', 'dirty', 'unavailable'].includes(item),
    filesystemDirty: item => typeof item === 'boolean',
    reasonCode: item => item === null || FRESHNESS_REASONS.has(item),
    observedAt: isNullableTimestamp,
    lastVerifiedAt: isNullableTimestamp,
    observedDigest: item => item === null || DIGEST.test(item),
    expectedDigest: item => item === null || DIGEST.test(item),
    rootIds: item => Array.isArray(item) && item.length <= 1_000 && item.every(value => UUID.test(value)) && item.join() === [...new Set(item)].sort().join(),
    suggestedJobType: item => item === null || item === 'scan'
  })) return false;
  const empty = value.observedDigest === null && value.expectedDigest === null && value.rootIds.length === 0;
  if (value.state === 'inactive') return !value.filesystemDirty && value.reasonCode === null && value.observedAt === null && value.lastVerifiedAt === null && empty && value.suggestedJobType === null;
  if (value.state === 'unavailable') return !value.filesystemDirty && value.reasonCode === 'workspace-uninitialized' && value.observedAt === null && value.lastVerifiedAt !== null && empty && value.suggestedJobType === null;
  if (value.state === 'clean') return !value.filesystemDirty && value.reasonCode === null && value.observedAt === null && value.lastVerifiedAt !== null
    && value.observedDigest !== null && value.observedDigest === value.expectedDigest && value.rootIds.length === 0 && value.suggestedJobType === null;
  if (!value.filesystemDirty || value.reasonCode === null || value.reasonCode === 'workspace-uninitialized' || value.observedAt === null || value.suggestedJobType !== 'scan') return false;
  if (value.reasonCode === 'verification-pending') return value.lastVerifiedAt === null && empty;
  const digestPair = value.observedDigest === null === (value.expectedDigest === null);
  return value.lastVerifiedAt !== null && digestPair
    && (!['watch-event', 'watcher-unavailable'].includes(value.reasonCode) || value.observedDigest !== null && value.rootIds.length > 0)
    && (value.reasonCode !== 'manifest-mismatch' || value.observedDigest !== null && value.observedDigest !== value.expectedDigest && value.rootIds.length > 0);
}

function isSkillPage(data) {
  return Array.isArray(data.items) && data.items.length <= 100 && data.items.every(isSkillListItem)
    && (data.nextCursor === null || isSafeCursor(data.nextCursor))
    && typeof data.hasMore === 'boolean'
    && Number.isInteger(data.limit) && data.limit >= 1 && data.limit <= 100;
}

function isSkillListItem(value) {
  return exactRecord(value, ['skillId', 'displayName', 'contentRevision', 'tier', 'routeEligible', 'qualifiedExplicitAllowed', 'variantState', 'hasScripts', 'sourceScope', 'description'], [], {
    skillId: item => /^sk_[A-Za-z0-9_-]{43}$/.test(item),
    displayName: item => isSafeText(item, 200),
    contentRevision: item => DIGEST.test(item),
    tier: item => SKILL_TIERS.has(item),
    routeEligible: item => typeof item === 'boolean',
    qualifiedExplicitAllowed: item => typeof item === 'boolean',
    variantState: item => SKILL_VARIANTS.has(item),
    hasScripts: item => typeof item === 'boolean',
    sourceScope: item => SKILL_SCOPES.has(item),
    description: item => isSafeText(item, 500)
  });
}

function isSkillDetail(data) {
  if (!/^sk_[A-Za-z0-9_-]{43}$/.test(data.skillId) || !isSafeText(data.displayName, 200) || !DIGEST.test(data.contentRevision)
    || !isSafeText(data.description, 2_000) || !SKILL_TIERS.has(data.tier) || typeof data.routeEligible !== 'boolean'
    || typeof data.qualifiedExplicitAllowed !== 'boolean' || !SKILL_VARIANTS.has(data.variantState) || typeof data.hasScripts !== 'boolean'
    || ![data.scriptCount, data.referenceCount, data.assetCount].every(isNonnegativeInteger) || typeof data.frontmatterValid !== 'boolean'
    || !isRevisionRefOrNull(data.revision) || data.revision === null) return false;
  if (Object.hasOwn(data, 'family') && data.family !== null && !isSafeText(data.family, 200)) return false;
  const source = exactRecord(data.sourceContext, ['tracked', 'sourceType', 'state', 'checked', 'reviewable', 'risk', 'upstreamCommit', 'revisionBound'], [], {
    tracked: item => typeof item === 'boolean', sourceType: item => item === null || ['local', 'github', 'unknown'].includes(item),
    state: item => item === 'not-tracked' || SOURCE_STATES.has(item),
    checked: item => typeof item === 'boolean', reviewable: item => typeof item === 'boolean', risk: item => item === null || ['low', 'high'].includes(item),
    upstreamCommit: item => item === null || /^[a-f0-9]{40,64}$/.test(item), revisionBound: item => typeof item === 'boolean'
  });
  const policy = exactRecord(data.policyContext, ['version', 'configured', 'canonical', 'canonicalSkillId', 'tier', 'variantState', 'routeMode'], [], {
    version: item => item === 1 || item === 2, configured: item => typeof item === 'boolean', canonical: item => typeof item === 'boolean',
    canonicalSkillId: item => item === null || /^sk_[A-Za-z0-9_-]{43}$/.test(item),
    tier: item => SKILL_TIERS.has(item), variantState: item => SKILL_VARIANTS.has(item),
    routeMode: item => ['implicit-and-explicit', 'qualified-explicit-only', 'blocked'].includes(item)
  });
  const history = exactRecord(data.routeHistory, ['items', 'limit', 'scanLimit', 'scannedEvents', 'scanTruncated', 'matchesTruncated'], [], {
    items: items => Array.isArray(items) && items.length <= 10 && items.every(isSkillRouteHistoryItem),
    limit: isNonnegativeInteger, scanLimit: isNonnegativeInteger, scannedEvents: isNonnegativeInteger,
    scanTruncated: item => typeof item === 'boolean', matchesTruncated: item => typeof item === 'boolean'
  });
  return source && policy && history;
}

function isSkillRouteHistoryItem(value) {
  return exactRecord(value, ['routeId', 'createdAt', 'surface', 'outcome', 'latencyBucket', 'reasonCodes', 'warningCodes', 'revisionId', 'promptStored'], [], {
    routeId: item => UUID.test(item), createdAt: isTimestamp, surface: item => ROUTE_SURFACES.has(item),
    outcome: item => ROUTE_OUTCOMES.has(item), latencyBucket: item => LATENCY_BUCKETS.has(item),
    reasonCodes: item => isMachineCodeList(item, 10, 64), warningCodes: item => isMachineCodeList(item, 10, 64),
    revisionId: item => REVISION_ID.test(item), promptStored: item => item === false
  });
}

function isRouteResult(data) {
  return data.kind === 'skillmap.route-result' && data.schemaVersion === 2 && UUID.test(data.routeId) && isTimestamp(data.createdAt)
    && data.promptStored === false && isRouteDecision(data.decision) && DIGEST.test(data.decisionDigest)
    && typeof data.latencyMs === 'number' && Number.isFinite(data.latencyMs) && data.latencyMs >= 0;
}

function isRouteDecision(value) {
  return exactRecord(value, ['kind', 'schemaVersion', 'revision', 'servingMode', 'recommendations', 'exclusions', 'hookText', 'warningState', 'warningCodes'], [], {
    kind: item => item === 'skillmap.route-decision', schemaVersion: item => item === 2,
    revision: item => isRevisionRefOrNull(item) && item !== null,
    servingMode: item => ['current', 'last-known-good'].includes(item),
    recommendations: items => Array.isArray(items) && items.length <= 10 && items.every(isRouteRecommendation),
    exclusions: items => Array.isArray(items) && items.length <= 100 && items.every(isRouteExclusion),
    hookText: item => isSafeText(item, 16_384), warningState: item => ['none', 'degraded', 'blocked'].includes(item),
    warningCodes: item => isMachineCodeList(item, 32, 64)
  });
}

function isRouteRecommendation(value) {
  return exactRecord(value, ['skillId', 'displayName', 'score', 'tier', 'reasonCodes'], [], {
    skillId: item => /^sk_[A-Za-z0-9_-]{43}$/.test(item), displayName: item => isSafeText(item, 200),
    score: item => typeof item === 'number' && Number.isFinite(item), tier: item => SKILL_TIERS.has(item), reasonCodes: item => isMachineCodeList(item, 32, 64)
  });
}

function isRouteExclusion(value) {
  return exactRecord(value, ['displayName', 'reasonCode'], ['skillId'], {
    displayName: item => isSafeText(item, 200), reasonCode: item => isMachineCode(item, 128),
    skillId: item => /^sk_[A-Za-z0-9_-]{43}$/.test(item)
  });
}

function isRoutePage(data) {
  return data.events.length <= 100 && data.events.every(isRouteEvent) && (data.nextCursor === null || isSafeCursor(data.nextCursor))
    && isNonnegativeInteger(data.total)
    && exactRecord(data.feedbackBacklog, ['reviewedRoutes', 'pendingRoutes', 'recordedFeedback', 'outcomeCounts', 'pendingRouteIds'], [], {
      reviewedRoutes: isNonnegativeInteger, pendingRoutes: isNonnegativeInteger, recordedFeedback: isNonnegativeInteger,
      outcomeCounts: item => exactRecord(item, ['correct', 'wrong', 'missing', 'unsafe'], [], {
        correct: isNonnegativeInteger, wrong: isNonnegativeInteger, missing: isNonnegativeInteger, unsafe: isNonnegativeInteger
      }),
      pendingRouteIds: item => Array.isArray(item) && item.length <= 100 && item.every(value => UUID.test(value))
    });
}

function isRouteEvent(value) {
  return exactRecord(value, ['kind', 'schemaVersion', 'eventId', 'routeId', 'createdAt', 'revision', 'currentRevision', 'surface', 'outcome', 'selectedSkillIds', 'reasonCodes', 'warningCodes', 'latencyBucket', 'promptStored', 'payloadDigest'], ['degradedCode', 'decisionDigest'], {
    kind: item => item === 'skillmap.route-event', schemaVersion: item => item === 1, eventId: item => UUID.test(item), routeId: item => UUID.test(item),
    createdAt: isTimestamp, revision: item => isRevisionRefOrNull(item) && item !== null, currentRevision: item => isRevisionRefOrNull(item) && item !== null,
    surface: item => ROUTE_SURFACES.has(item), outcome: item => ROUTE_OUTCOMES.has(item),
    selectedSkillIds: item => isSkillIdList(item, 10), reasonCodes: item => isMachineCodeList(item, 32, 64), warningCodes: item => isMachineCodeList(item, 32, 64),
    latencyBucket: item => LATENCY_BUCKETS.has(item), promptStored: item => item === false, payloadDigest: item => DIGEST.test(item),
    degradedCode: isMachineText, decisionDigest: item => DIGEST.test(item)
  });
}

function isRouteFeedback(value) {
  return exactRecord(value, ['kind', 'schemaVersion', 'feedbackId', 'routeId', 'createdAt', 'revision', 'outcome', 'selectedSkillIds', 'expectedSkillIds', 'unsafeSkillIds', 'reasonCode', 'idempotencyKeyHash', 'promptStored', 'commentStored', 'payloadDigest'], [], {
    kind: item => item === 'skillmap.route-feedback', schemaVersion: item => item === 1, feedbackId: item => UUID.test(item), routeId: item => UUID.test(item),
    createdAt: isTimestamp, revision: item => isRevisionRefOrNull(item) && item !== null, outcome: item => ['correct', 'wrong', 'missing', 'unsafe'].includes(item),
    selectedSkillIds: item => isSkillIdList(item, 10), expectedSkillIds: item => isSkillIdList(item, 10), unsafeSkillIds: item => isSkillIdList(item, 10),
    reasonCode: item => item === `operator-${value.outcome}`, idempotencyKeyHash: item => DIGEST.test(item), promptStored: item => item === false,
    commentStored: item => item === false, payloadDigest: item => DIGEST.test(item)
  });
}

function isPolicyReviews(data) {
  return data.items.length <= 200 && data.items.every(item => exactRecord(item, [
    'reviewId', 'queue', 'action', 'state', 'blocking', 'displayName', 'skillIds', 'contentRevisions', 'queueFingerprint'
  ], ['currentTier'], {
    reviewId: item => isMachineCode(item, 64),
    queue: item => ['duplicate', 'unmatched', 'uncovered', 'explicit-only', 'blocked'].includes(item),
    action: item => ['select-canonical', 'set-skill-policy', 'retire-unmatched'].includes(item),
    state: item => ['configured', 'needs-review'].includes(item),
    blocking: item => typeof item === 'boolean',
    displayName: item => isSafeText(item, 200),
    skillIds: item => isSkillIdList(item, 20),
    contentRevisions: item => Array.isArray(item) && item.length <= 20 && item.every(value => DIGEST.test(value)),
    queueFingerprint: item => DIGEST.test(item),
    currentTier: item => SKILL_TIERS.has(item)
  })) && isNonnegativeInteger(data.actionable) && isNonnegativeInteger(data.blocking)
    && (!Object.hasOwn(data, 'policyVersion') || [1, 2].includes(data.policyVersion))
    && (!Object.hasOwn(data, 'revision') || isRevisionRefOrNull(data.revision) && data.revision !== null);
}

function isPolicyPreview(data) {
  return typeof data.currentPresent === 'boolean'
    && isPolicySummary(data.currentSummary, false)
    && isPolicySummary(data.projectedSummary, false)
    && isPolicySummary(data.delta, true)
    && isStringList(data.warnings, 20, 64)
    && typeof data.routingApprovalEligible === 'boolean'
    && data.wouldPublish === false
    && (!Object.hasOwn(data, 'state') || data.state === 'previewed')
    && (!Object.hasOwn(data, 'revision') || isRevisionRefOrNull(data.revision) && data.revision !== null);
}

function isPolicySummary(value, allowNegative) {
  return exactRecord(value, ['skills', 'routeEligible', 'edges'], [], {
    skills: item => Number.isSafeInteger(item) && (allowNegative || item >= 0),
    routeEligible: item => Number.isSafeInteger(item) && (allowNegative || item >= 0),
    edges: item => Number.isSafeInteger(item) && (allowNegative || item >= 0)
  });
}

function isPolicyProposal(data) {
  return data.state === 'proposed' && UUID.test(data.proposalId) && DIGEST.test(data.proposalDigest)
    && isMachineCode(data.reviewId, 64) && ['duplicate', 'unmatched', 'uncovered', 'explicit-only', 'blocked'].includes(data.queue)
    && ['select-canonical', 'set-skill-policy', 'retire-unmatched'].includes(data.action)
    && REVISION_ID.test(data.expectedRevision) && isTimestamp(data.expiresAt)
    && Array.isArray(data.decisionOptions) && data.decisionOptions.length >= 1 && data.decisionOptions.length <= 3
    && data.decisionOptions.every(item => ['accept', 'hold', 'reject'].includes(item)) && data.wouldPublish === false
    && (!Object.hasOwn(data, 'skillId') || /^sk_[A-Za-z0-9_-]{43}$/.test(data.skillId))
    && (!Object.hasOwn(data, 'tier') || SKILL_TIERS.has(data.tier));
}

function isPolicyDecision(data) {
  return data.state === 'recorded' && DIGEST.test(data.decisionDigest)
    && isRevisionRefOrNull(data.revision) && data.revision !== null && data.routingApprovalRequired === true
    && (!Object.hasOwn(data, 'reviewId') || isMachineCode(data.reviewId, 64))
    && (!Object.hasOwn(data, 'queue') || ['duplicate', 'unmatched', 'uncovered', 'explicit-only', 'blocked'].includes(data.queue))
    && (!Object.hasOwn(data, 'action') || ['select-canonical', 'set-skill-policy', 'retire-unmatched'].includes(data.action))
    && (!Object.hasOwn(data, 'decision') || ['accept', 'hold', 'reject'].includes(data.decision))
    && (!Object.hasOwn(data, 'skillId') || /^sk_[A-Za-z0-9_-]{43}$/.test(data.skillId))
    && (!Object.hasOwn(data, 'tier') || SKILL_TIERS.has(data.tier))
    && (!Object.hasOwn(data, 'policyChanged') || typeof data.policyChanged === 'boolean');
}

function isPolicyApply(data) {
  return data.applied === true && isStringList(data.warnings, 20, 240) && isPolicySummary(data.effectiveSummary, false)
    && isRevisionRefOrNull(data.revision) && data.revision !== null && typeof data.routingApproved === 'boolean';
}

function isSourcesPayload(data) {
  return ['not-configured', 'not-applicable', 'partial', 'covered'].includes(data.coverage)
    && isNonnegativeInteger(data.inventorySkills) && isNonnegativeInteger(data.trackedSkills)
    && data.items.length <= 10_000 && data.items.every(isSourceItem)
    && data.untrackedItems.length <= 100 && data.untrackedItems.every(item => exactRecord(item, ['skillId', 'displayName', 'contentRevision'], [], {
      skillId: value => /^sk_[A-Za-z0-9_-]{43}$/.test(value), displayName: value => isSafeText(value, 200), contentRevision: value => DIGEST.test(value)
    }))
    && isNonnegativeInteger(data.untrackedTotal) && typeof data.untrackedTruncated === 'boolean'
    && isRevisionRefOrNull(data.revision) && data.revision !== null;
}

function isSourceItem(value) {
  return exactRecord(value, ['skillId', 'displayName', 'contentRevision', 'sourceType', 'checked', 'reviewable', 'state', 'risk', 'upstreamCommit'], [], {
    skillId: item => item === null || /^sk_[A-Za-z0-9_-]{43}$/.test(item),
    displayName: item => isSafeText(item, 200), contentRevision: item => item === null || DIGEST.test(item),
    sourceType: item => ['local', 'github', 'unknown'].includes(item),
    checked: item => typeof item === 'boolean', reviewable: item => typeof item === 'boolean',
    state: item => ['external-clean', 'external-modified', 'external-stale', 'external-risky-update', 'local-authored', 'local-modified', 'unknown'].includes(item),
    risk: item => item === null || ['low', 'high'].includes(item), upstreamCommit: item => item === null || /^[a-f0-9]{40,64}$/.test(item)
  });
}

function isSourceAdoption(data) {
  return /^sk_[A-Za-z0-9_-]{43}$/.test(data.skillId) && isRevisionRefOrNull(data.revision) && data.revision !== null
    && data.routingApprovalRequired === true
    && (!Object.hasOwn(data, 'state') || data.state === 'adopted')
    && (!Object.hasOwn(data, 'sourceType') || ['local', 'github'].includes(data.sourceType))
    && (!Object.hasOwn(data, 'adoptionDigest') || DIGEST.test(data.adoptionDigest))
    && (!Object.hasOwn(data, 'nextAction') || data.nextAction === 'sources-check');
}

function isSourceDiff(data) {
  return /^sk_[A-Za-z0-9_-]{43}$/.test(data.skillId) && SOURCE_STATES.has(data.state)
    && (data.risk === null || ['low', 'high'].includes(data.risk))
    && (data.upstreamCommit === null || /^[a-f0-9]{40,64}$/.test(data.upstreamCommit))
    && exactRecord(data.diff, ['additions', 'deletions', 'changedLines', 'truncated', 'lines'], [], {
      additions: isNonnegativeInteger, deletions: isNonnegativeInteger, changedLines: isNonnegativeInteger,
      truncated: item => typeof item === 'boolean',
      lines: items => Array.isArray(items) && items.length <= 120 && items.every(line => exactRecord(line, ['kind', 'line', 'text'], [], {
        kind: item => ['local', 'upstream'].includes(item), line: item => Number.isSafeInteger(item) && item >= 1, text: item => isSafeText(item, 500)
      }))
    })
    && data.promptStored === false && data.persisted === false
    && isRevisionRefOrNull(data.revision) && data.revision !== null;
}

function isSourceReview(data) {
  return /^sk_[A-Za-z0-9_-]{43}$/.test(data.skillId) && ['hold', 'accepted', 'ignore'].includes(data.decision)
    && isRevisionRefOrNull(data.revision) && data.revision !== null && data.routingApprovalRequired === true
    && (!Object.hasOwn(data, 'state') || data.state === 'recorded')
    && (!Object.hasOwn(data, 'reviewDigest') || DIGEST.test(data.reviewDigest));
}

function isEvalsPayload(data) {
  if (typeof data.present !== 'boolean' || typeof data.releaseEvidenceEligible !== 'boolean' || typeof data.pass !== 'boolean'
    || !isStringList(data.evidenceIssues, 100, 80) || !isRevisionRefOrNull(data.revision) || data.revision === null
    || !isEvalRun(data.currentRun) || data.recentRuns.length > 12 || !data.recentRuns.every(isEvalRun)
    || data.caseResults.length > 100 || !data.caseResults.every(isEvalCaseResult)
    || !exactRecord(data.caseResultsPagination, ['total', 'limit', 'hasMore', 'nextCursor'], [], {
      total: item => Number.isSafeInteger(item) && item >= data.caseResults.length && item <= 10_000,
      limit: item => Number.isInteger(item) && item >= 1 && item <= 100,
      hasMore: item => typeof item === 'boolean', nextCursor: item => item === null || isSafeCursor(item)
    })
    || !['available', 'empty', 'unavailable', 'binding-mismatch', 'invalid', 'too-large'].includes(data.caseTraceState)
    || data.promptStored !== false) return false;
  if (Object.hasOwn(data, 'evidenceLevel') && !['demo', 'smoke', 'candidate', 'release'].includes(data.evidenceLevel)) return false;
  for (const key of ['datasetDigest', 'effectiveRevisionDigest']) if (Object.hasOwn(data, key) && data[key] !== null && !DIGEST.test(data[key])) return false;
  for (const key of ['composition', 'holdout', 'leakage', 'baselineComparison']) if (Object.hasOwn(data, key) && !isEvalAggregate(data[key])) return false;
  for (const key of ['count', 'avoidHits']) if (Object.hasOwn(data, key) && !isNonnegativeInteger(data[key])) return false;
  for (const key of ['top1Rate', 'top3Rate']) if (Object.hasOwn(data, key) && !(typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0 && data[key] <= 1)) return false;
  return !Object.hasOwn(data, 'caseResultsSchemaVersion') || data.caseResultsSchemaVersion === 3;
}

function isEvalRun(value) {
  return exactRecord(value, ['runId', 'suiteId', 'jobId', 'state', 'expectedRevision', 'resultRevisionId', 'resultWorkspaceRevision', 'reportRevision', 'reportBinding', 'reportArtifactDigest', 'reportEffectiveRevisionDigest', 'createdAt', 'startedAt', 'completedAt', 'errorCode', 'progress', 'reportAvailable'], [], {
    runId: item => item === null || /^evalrun_[A-Za-z0-9_-]{8,80}$/.test(item),
    suiteId: item => item === null || /^evalsuite_[A-Za-z0-9_-]{8,80}$/.test(item), jobId: item => item === null || UUID.test(item),
    state: item => ['not-run', 'queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(item),
    expectedRevision: item => item === null || REVISION_ID.test(item), resultRevisionId: item => item === null || REVISION_ID.test(item),
    resultWorkspaceRevision: item => item === null || DIGEST.test(item), reportRevision: item => item === null || isRevisionRefOrNull(item) && item !== null,
    reportBinding: item => ['result-revision', 'carried-forward', 'report-only', 'unavailable'].includes(item),
    reportArtifactDigest: item => item === null || DIGEST.test(item), reportEffectiveRevisionDigest: item => item === null || DIGEST.test(item),
    createdAt: isNullableTimestamp, startedAt: isNullableTimestamp, completedAt: isNullableTimestamp,
    errorCode: item => item === null || isMachineText(item),
    progress: item => exactRecord(item, ['mode', 'completedCases', 'totalCases', 'ratio'], [], {
      mode: candidate => ['determinate', 'indeterminate', 'unavailable'].includes(candidate),
      completedCases: candidate => candidate === null || isNonnegativeInteger(candidate), totalCases: candidate => candidate === null || isNonnegativeInteger(candidate),
      ratio: candidate => candidate === null || typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 && candidate <= 1
    }),
    reportAvailable: item => typeof item === 'boolean'
  });
}

function isEvalCaseResult(value) {
  return exactRecord(value, ['caseId', 'primaryCaseType', 'membership', 'releaseCounted', 'releaseScored', 'expectedSkillIds', 'avoidSkillIds', 'recommendedSkillIds', 'avoidedButRecommendedSkillIds', 'top1Hit', 'top3Hit', 'abstained', 'advisoryBytes', 'outcome', 'reasonCodes', 'validationCodes', 'leakageCodes'], ['qualifiedSkillId'], {
    caseId: item => /^evalcase_[A-Za-z0-9_-]{8,100}$/.test(item), primaryCaseType: item => ['explicit', 'implicit-natural', 'multi-skill', 'negative-near-miss'].includes(item),
    membership: item => ['train', 'holdout'].includes(item), releaseCounted: item => typeof item === 'boolean', releaseScored: item => typeof item === 'boolean',
    expectedSkillIds: item => isSkillIdList(item, 100), avoidSkillIds: item => isSkillIdList(item, 100),
    recommendedSkillIds: item => isSkillIdList(item, 100), avoidedButRecommendedSkillIds: item => isSkillIdList(item, 100),
    qualifiedSkillId: item => /^sk_[A-Za-z0-9_-]{43}$/.test(item), top1Hit: item => typeof item === 'boolean', top3Hit: item => typeof item === 'boolean',
    abstained: item => typeof item === 'boolean', advisoryBytes: item => isNonnegativeInteger(item) && item <= 1_048_576,
    outcome: item => ['top1-hit', 'top3-hit', 'correct-abstention', 'miss', 'unsafe', 'invalid'].includes(item),
    reasonCodes: item => isStringList(item, 100, 80), validationCodes: item => isStringList(item, 100, 80), leakageCodes: item => isStringList(item, 100, 80)
  });
}

function isEvalAggregate(value) {
  if (!isRecord(value) || Object.keys(value).length < 1 || Object.keys(value).length > 32) return false;
  return Object.entries(value).every(([key, item]) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)
    && (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || isMachineText(item)));
}

function isEvalImport(data) {
  return data.imported === true && [2, 3].includes(data.schemaVersion) && isNonnegativeInteger(data.cases)
    && isRecord(data.composition) && Object.keys(data.composition).length <= 16
    && Object.entries(data.composition).every(([key, value]) => isMachineText(key) && isNonnegativeInteger(value))
    && DIGEST.test(data.datasetDigest) && data.promptRetention === 'local-eval-suite'
    && isRevisionRefOrNull(data.revision) && data.revision !== null && data.routingApprovalRequired === true;
}

function isMcpManifest(data) {
  const toolNames = Object.keys(MCP_TOOL_INPUT_SCHEMAS);
  return data.version === 2 && data.readOnly === true && data.verifiedLocally === true
    && data.tools.length === toolNames.length
    && new Set(data.tools.map(tool => tool?.name)).size === toolNames.length
    && data.tools.every(tool => exactRecord(tool, ['name', 'description', 'inputSchema'], [], {
      name: item => Object.hasOwn(MCP_TOOL_INPUT_SCHEMAS, item),
      description: item => isSafeText(item, 500),
      inputSchema: item => JSON.stringify(item) === MCP_TOOL_INPUT_SCHEMAS[tool.name]
    }))
    && exactRecord(data.limits, ['requestBytes', 'responseBytes', 'pageSizeMax'], [], {
      requestBytes: item => Number.isSafeInteger(item) && item >= 1, responseBytes: item => Number.isSafeInteger(item) && item >= 1,
      pageSizeMax: item => Number.isSafeInteger(item) && item >= 1 && item <= 100
    });
}

function isHookVerification(data) {
  return data.host === 'codex' && data.action === 'dry-run'
    && exactRecord(data.readiness, ['verdict', 'phase', 'allowed', 'routingReady'], [], {
      verdict: item => item === null || ['ok', 'attention required', 'blocked'].includes(item),
      phase: item => item === null || READINESS_PHASES.has(item),
      allowed: item => typeof item === 'boolean', routingReady: item => typeof item === 'boolean'
    })
    && data.readiness.allowed === (data.readiness.routingReady && data.readiness.verdict === 'ok' && data.readiness.phase === 'ready')
    && isSafeText(data.hookText, 16_384) && data.promptStored === false && data.installPerformed === false;
}

function isWorkspaceValidation(data) {
  return data.state === 'validated' && UUID.test(data.validationId) && ['select-existing', 'create-new'].includes(data.mode)
    && isSafeText(data.label, 200) && Number.isInteger(data.expiresInSeconds) && data.expiresInSeconds >= 1 && data.expiresInSeconds <= 300
    && data.confirmationRequired === true;
}

function isWorkspaceSelection(data) {
  return data.state === 'selected' && UUID.test(data.selectionId) && ['select-existing', 'create-new'].includes(data.mode)
    && typeof data.created === 'boolean' && typeof data.alreadySelected === 'boolean' && isSafeText(data.label, 200)
    && (data.workspaceId === null || UUID.test(data.workspaceId)) && BOOTSTRAP_STATES.has(data.bootstrapState);
}

function isRootValidation(data) {
  return UUID.test(data.validationId) && isSafeText(data.label, 200) && data.directory === true && data.symlink === false
    && Number.isInteger(data.expiresInSeconds) && data.expiresInSeconds >= 1 && data.expiresInSeconds <= 300;
}

function isRootApproval(data) {
  return data.state === 'approved' && data.approved === true && typeof data.alreadyApproved === 'boolean'
    && isRevisionRefOrNull(data.revision) && data.revision !== null && data.routingApprovalRequired === true
    && (!Object.hasOwn(data, 'rootId') || UUID.test(data.rootId));
}

function isPartialLegacyReceipt(data) {
  return data.state === 'adopted' && data.adopted === true && isRevisionRefOrNull(data.revision) && data.revision !== null
    && data.routingApprovalRequired === true && (!Object.hasOwn(data, 'rootCount') || isNonnegativeInteger(data.rootCount))
    && (!Object.hasOwn(data, 'nextAction') || data.nextAction === 'scan');
}

function isJob(value) {
  if (!exactRecord(value, ['jobId', 'type', 'state', 'expectedRevision', 'idempotencyKey', 'requestDigest', 'confirmation', 'createdAt'], ['kind', 'schemaVersion', 'startedAt', 'completedAt', 'resultReceipt', 'error'])) return false;
  if (!UUID.test(value.jobId) || !['scan', 'doctor', 'doctor-pack', 'graph-build', 'eval-run', 'sources-check'].includes(value.type)
    || !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(value.state) || !REVISION_ID.test(value.expectedRevision)
    || !DIGEST.test(value.idempotencyKey) || !DIGEST.test(value.requestDigest) || value.confirmation !== 'none' || !isTimestamp(value.createdAt)) return false;
  if (Object.hasOwn(value, 'kind') && value.kind !== 'skillmap.job') return false;
  if (Object.hasOwn(value, 'schemaVersion') && value.schemaVersion !== 1) return false;
  if (Object.hasOwn(value, 'startedAt') && !isNullableTimestamp(value.startedAt)) return false;
  if (Object.hasOwn(value, 'completedAt') && !isNullableTimestamp(value.completedAt)) return false;
  if (Object.hasOwn(value, 'resultReceipt') && !isSafeScalarRecord(value.resultReceipt)) return false;
  if (Object.hasOwn(value, 'error') && !exactRecord(value.error, ['code', 'message', 'retryable'], [], {
    code: isMachineText, message: item => isSafeText(item, 240), retryable: item => typeof item === 'boolean'
  })) return false;
  return true;
}

function isRevisionHistory(data) {
  return data.items.length <= 100 && data.items.every(item => exactRecord(item, ['revision', 'sequence', 'parentRevisionId', 'createdAt', 'mutation', 'isCurrent', 'isRoutingServing', 'routingApprovalRecorded', 'artifactCount'], [], {
    revision: value => isRevisionRefOrNull(value) && value !== null,
    sequence: value => Number.isSafeInteger(value) && value >= 1,
    parentRevisionId: value => value === null || REVISION_ID.test(value),
    createdAt: isTimestamp,
    mutation: value => exactRecord(value, ['kind', 'actor', 'reasonDigest', 'sourceRevisionId', 'targetRevisionId'], [], {
      kind: item => ['legacy-migration', 'legacy-snapshot', 'rollback', 'recovery'].includes(item),
      actor: item => item === null || isMachineText(item), reasonDigest: item => item === null || DIGEST.test(item),
      sourceRevisionId: item => item === null || REVISION_ID.test(item), targetRevisionId: item => item === null || REVISION_ID.test(item)
    }),
    isCurrent: value => typeof value === 'boolean', isRoutingServing: value => typeof value === 'boolean',
    routingApprovalRecorded: value => typeof value === 'boolean', artifactCount: isNonnegativeInteger
  })) && Number.isInteger(data.limit) && data.limit >= 1 && data.limit <= 100 && typeof data.hasMore === 'boolean'
    && (data.nextCursor === null || isSafeCursor(data.nextCursor)) && isRevisionRefOrNull(data.currentRevision) && data.currentRevision !== null
    && (data.routingRevisionId === null || REVISION_ID.test(data.routingRevisionId));
}

function exactRecord(value, required, optional = [], checks = {}) {
  if (!isRecord(value) || !hasAllowedKeys(value, required, optional)) return false;
  for (const [key, check] of Object.entries(checks)) {
    if (Object.hasOwn(value, key) && !check(value[key])) return false;
  }
  return true;
}

function isBoundedPublicValue(value, depth, seen, allowHookText, allowSchemaPrompt) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return true;
  if (typeof value === 'string') return value.length <= 1_048_576 && !value.includes('\u0000');
  if (!value || typeof value !== 'object' || depth > 10 || seen.has(value)) return false;
  seen.add(value);
  let valid = true;
  if (Array.isArray(value)) {
    valid = value.length <= 10_000 && value.every(item => isBoundedPublicValue(item, depth + 1, seen, allowHookText, allowSchemaPrompt));
  } else {
    const entries = Object.entries(value);
    valid = entries.length <= 256;
    for (const [key, item] of entries) {
      if (!valid || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key) || isPrivateResponseKey(key, allowHookText, allowSchemaPrompt)
        || !isBoundedPublicValue(item, depth + 1, seen, allowHookText, allowSchemaPrompt)) {
        valid = false;
        break;
      }
    }
  }
  seen.delete(value);
  return valid;
}

function isPrivateResponseKey(key, allowHookText, allowSchemaPrompt = false) {
  if (['promptStored', 'promptRetention', 'commentStored', 'reasonCode', 'reasonCodes', 'reasonDigest', 'tokenMetricsSource'].includes(key)) return false;
  if (key === 'hookText') return !allowHookText;
  if (key === 'prompt') return !allowSchemaPrompt;
  return /^(?:(?:raw)?prompt|(?:raw)?(?:skill)?body|candidate|configuredPath|realPath|path|reason|comment|secret|token|password|privateKey)/i.test(key);
}

function isSafeScalarRecord(value) {
  if (!isRecord(value) || Object.keys(value).length > 32) return false;
  return Object.entries(value).every(([key, item]) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)
    && !isPrivateResponseKey(key, false)
    && (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || isSafeText(item, 256)));
}

function isSafeText(value, maximum) { return typeof value === 'string' && Array.from(value).length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }
function isMachineCode(value, maximum) { return typeof value === 'string' && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function isMachineText(value) { return isMachineCode(value, 128); }
function isVersionText(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value); }
function isConnectorCompatibilityReceipt(value) {
  return exactRecord(value, ['apiVersion', 'localAppAssetVersion', 'productVersion'], [], {
    apiVersion: isVersionText, localAppAssetVersion: isVersionText, productVersion: isVersionText
  });
}
function isTimestamp(value) { return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)); }
function isNullableTimestamp(value) { return value === null || isTimestamp(value); }
function isNonnegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
function isSafeCursor(value) { return typeof value === 'string' && value.length <= 1_024 && /^[A-Za-z0-9_-]+$/.test(value); }
function isStringList(value, maximum, itemMaximum) { return Array.isArray(value) && value.length <= maximum && value.every(item => isSafeText(item, itemMaximum)); }
function isMachineCodeList(value, maximum, itemMaximum) { return Array.isArray(value) && value.length <= maximum && value.every(item => isMachineCode(item, itemMaximum)); }
function isSkillIdList(value, maximum) { return Array.isArray(value) && value.length <= maximum && value.every(item => /^sk_[A-Za-z0-9_-]{43}$/.test(item)); }

function endpointShape(route, method) {
  if (method === 'GET' && route === '/api/v1/health') return shape(['status', 'process', 'version', 'compatibility']);
  if (method === 'GET' && route === '/api/v1/bootstrap') return shape(
    ['state', 'initialized', 'routingReady', 'productReady', 'nextAction', 'connectorCompatibility'],
    ['configuredRootCount', 'servingMode', 'revision', 'currentRevision', 'readiness', 'recoverable', 'errorCode', 'guidance']
  );
  if (method === 'GET' && route === '/api/v1/workspace') return shape(
    ['workspaceId', 'name', 'readiness', 'revision', 'currentRevision', 'servingMode', 'routingReady', 'filesystemDirty', 'filesystemFreshness', 'roots']
  );
  if (method === 'GET' && route === '/api/v1/dashboard') return shape(
    ['workspace', 'revision', 'currentRevision', 'servingMode', 'routingReady', 'filesystemDirty', 'filesystemFreshness', 'readiness', 'counts', 'evidence']
  );
  if (method === 'GET' && route === '/api/v1/skills') return shape(['items', 'nextCursor', 'hasMore', 'limit']);
  if (method === 'GET' && /^\/api\/v1\/skills\/sk_[A-Za-z0-9_-]{43}$/.test(route)) return shape(
    ['skillId', 'displayName', 'contentRevision', 'description', 'tier', 'routeEligible', 'qualifiedExplicitAllowed', 'variantState', 'hasScripts', 'scriptCount', 'referenceCount', 'assetCount', 'frontmatterValid', 'sourceContext', 'policyContext', 'routeHistory', 'revision'],
    ['family']
  );
  if (method === 'POST' && route === '/api/v1/routes/preview') return shape(
    ['kind', 'schemaVersion', 'routeId', 'createdAt', 'promptStored', 'decision', 'decisionDigest', 'latencyMs']
  );
  if (method === 'GET' && route === '/api/v1/routes') return shape(['events', 'nextCursor', 'total', 'feedbackBacklog']);
  if (method === 'GET' && /^\/api\/v1\/routes\/[0-9a-f-]{36}$/i.test(route)) return shape(
    ['kind', 'schemaVersion', 'eventId', 'routeId', 'createdAt', 'revision', 'currentRevision', 'surface', 'outcome', 'selectedSkillIds', 'reasonCodes', 'warningCodes', 'latencyBucket', 'promptStored', 'payloadDigest'],
    ['degradedCode', 'decisionDigest']
  );
  if (method === 'POST' && /^\/api\/v1\/routes\/[0-9a-f-]{36}\/feedback$/i.test(route)) return shape(
    ['kind', 'schemaVersion', 'feedbackId', 'routeId', 'createdAt', 'revision', 'outcome', 'selectedSkillIds', 'expectedSkillIds', 'unsafeSkillIds', 'reasonCode', 'idempotencyKeyHash', 'promptStored', 'commentStored', 'payloadDigest']
  );
  if (method === 'GET' && route === '/api/v1/policy/reviews') return shape(['items', 'actionable', 'blocking'], ['policyVersion', 'revision']);
  if (method === 'POST' && route === '/api/v1/policy/preview') return shape(['currentPresent', 'currentSummary', 'projectedSummary', 'delta', 'warnings', 'routingApprovalEligible', 'wouldPublish'], ['state', 'revision']);
  if (method === 'POST' && route === '/api/v1/policy/proposals') return shape(
    ['state', 'proposalId', 'proposalDigest', 'reviewId', 'queue', 'action', 'expectedRevision', 'expiresAt', 'decisionOptions', 'wouldPublish'],
    ['skillId', 'tier']
  );
  if (method === 'POST' && route === '/api/v1/policy/decisions') return shape(
    ['state', 'decisionDigest', 'revision', 'routingApprovalRequired'],
    ['reviewId', 'queue', 'action', 'decision', 'skillId', 'tier', 'policyChanged']
  );
  if (method === 'POST' && route === '/api/v1/policy/apply') return shape(['applied', 'warnings', 'effectiveSummary', 'revision', 'routingApproved']);
  if (method === 'GET' && route === '/api/v1/sources') return shape(['coverage', 'inventorySkills', 'trackedSkills', 'items', 'untrackedItems', 'untrackedTotal', 'untrackedTruncated', 'revision']);
  if (method === 'POST' && route === '/api/v1/sources/adoptions') return shape(['skillId', 'revision', 'routingApprovalRequired'], ['state', 'sourceType', 'adoptionDigest', 'nextAction']);
  if (method === 'POST' && route === '/api/v1/sources/diff') return shape(['skillId', 'state', 'risk', 'upstreamCommit', 'diff', 'promptStored', 'persisted', 'revision']);
  if (method === 'POST' && route === '/api/v1/sources/reviews') return shape(['skillId', 'decision', 'revision', 'routingApprovalRequired'], ['state', 'reviewDigest']);
  if (method === 'GET' && route === '/api/v1/evals') return shape(
    ['present', 'releaseEvidenceEligible', 'pass', 'evidenceIssues', 'revision', 'currentRun', 'recentRuns', 'caseResults', 'caseResultsPagination', 'caseTraceState', 'promptStored'],
    ['evidenceLevel', 'datasetDigest', 'effectiveRevisionDigest', 'composition', 'holdout', 'leakage', 'baselineComparison', 'count', 'top1Rate', 'top3Rate', 'avoidHits', 'caseResultsSchemaVersion']
  );
  if (method === 'POST' && route === '/api/v1/evals/import') return shape(['imported', 'schemaVersion', 'cases', 'composition', 'datasetDigest', 'promptRetention', 'revision', 'routingApprovalRequired']);
  if (method === 'GET' && route === '/api/v1/integrations/mcp') return shape(['version', 'readOnly', 'tools', 'limits', 'verifiedLocally']);
  if (method === 'POST' && route === '/api/v1/integrations/hook/verify') return shape(['host', 'action', 'readiness', 'hookText', 'promptStored', 'installPerformed']);
  if (route === '/api/v1/jobs' && method === 'GET') return shape(['items', 'total']);
  if (route === '/api/v1/jobs' && method === 'POST') return shape(['job', 'created']);
  if (method === 'GET' && /^\/api\/v1\/jobs\/[0-9a-f-]{36}$/i.test(route)) return jobShape();
  if (method === 'POST' && /^\/api\/v1\/jobs\/[0-9a-f-]{36}\/cancel$/i.test(route)) return shape(['state', 'jobId', 'jobState', 'cancellationDigest', 'idempotent', 'publicationPrevented']);
  if (method === 'POST' && route === '/api/v1/workspaces/validate') return shape(['state', 'validationId', 'mode', 'label', 'expiresInSeconds', 'confirmationRequired']);
  if (method === 'POST' && route === '/api/v1/workspaces/select') return shape(['state', 'selectionId', 'mode', 'created', 'alreadySelected', 'label', 'workspaceId', 'bootstrapState']);
  if (method === 'POST' && route === '/api/v1/roots/validate') return shape(['validationId', 'label', 'directory', 'symlink', 'expiresInSeconds']);
  if (method === 'POST' && route === '/api/v1/roots/approve') return shape(['state', 'approved', 'alreadyApproved', 'revision', 'routingApprovalRequired'], ['rootId']);
  if (method === 'POST' && route === '/api/v1/state/adopt-partial-legacy') return shape(['state', 'adopted', 'revision', 'routingApprovalRequired'], ['rootCount', 'nextAction']);
  if (method === 'GET' && route === '/api/v1/state/revisions') return shape(['items', 'hasMore', 'nextCursor', 'currentRevision', 'routingRevisionId'], ['limit']);
  if (method === 'POST' && route === '/api/v1/state/rollback') return shape(['state', 'revision', 'targetRevisionId', 'routingApproved', 'routingApprovalRequired', 'warningCount']);
  if (method === 'POST' && route === '/api/v1/state/migrate') return shape(['state', 'migrated', 'alreadyMigrated', 'revision', 'warningCount']);
  if (method === 'POST' && route === '/api/v1/state/recover') return shape(['state', 'recovered', 'revision', 'warningCount']);
  return null;
}

function shape(required, optional = []) { return { required, optional }; }
function jobShape() {
  return shape(['jobId', 'type', 'state', 'expectedRevision', 'idempotencyKey', 'requestDigest', 'confirmation', 'createdAt'], ['kind', 'schemaVersion', 'startedAt', 'completedAt', 'resultReceipt', 'error']);
}
function hasAllowedKeys(value, required, optional) {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key));
}
