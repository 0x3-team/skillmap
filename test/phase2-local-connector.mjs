import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { request as nodeRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startLocalConnector } from '../dist/server/local-connector.js';
import { LOCAL_CONNECTOR_COMPATIBILITY_RECEIPT } from '../dist/server/compatibility.js';
import { SkillMapLocalBackend } from '../dist/server/skillmap-backend.js';
import { createAndRecordFeedback, createRouteEvent, readRouteEvent, recordRouteEvent } from '../dist/core/route-events.js';

const SKILL_ID = `sk_${'A'.repeat(43)}`;
const ROUTE_ID = '11111111-1111-4111-8111-111111111111';
const REVISION = {
  workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revisionId: 'r00000000000000000001-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workspaceRevision: `sha256:${'1'.repeat(64)}`,
  effectiveDigest: `sha256:${'2'.repeat(64)}`,
  effectiveRevisionDigest: `sha256:${'4'.repeat(64)}`
};
const ETAG = '"workspace-fixture-revision"';

test('connector binds only IPv4 loopback, requires the exact Host, emits no CORS, and closes idempotently', async t => {
  const { backend } = fakeBackend();
  const connector = await startLocalConnector({ backend });
  t.after(() => connector.close());

  const origin = new URL(connector.origin);
  assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(Number(origin.port), connector.port);
  assert.equal(new URL(connector.bootstrapUrl).origin, connector.origin);

  const health = await rawRequest(connector.origin, { pathname: '/api/v1/health' });
  assert.equal(health.status, 200);
  assert.equal(json(health).ok, true);
  assert.equal(health.headers['access-control-allow-origin'], undefined);
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.match(String(health.headers['content-security-policy']), /default-src 'self'/);

  for (const host of [`localhost:${connector.port}`, `127.0.0.1`, `127.0.0.1:${connector.port}.invalid`]) {
    const rejected = await rawRequest(connector.origin, {
      pathname: '/api/v1/health',
      headers: { host }
    });
    assert.equal(rejected.status, 400);
    assert.equal(json(rejected).error.code, 'HOST_REJECTED');
    assert.equal(rejected.headers['access-control-allow-origin'], undefined);
  }

  await assert.rejects(
    rawRequest(connector.origin, { pathname: '/api/v1/health', connectHost: '::1', timeoutMs: 250 }),
    error => ['ECONNREFUSED', 'EADDRNOTAVAIL', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(error.code)
  );

  await connector.close();
  await connector.close();
  await assert.rejects(
    rawRequest(connector.origin, { pathname: '/api/v1/health', timeoutMs: 250 }),
    error => ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)
  );
});

test('bootstrap exchange is one-time, expires, and returns capability material only in the redirect fragment', { concurrency: false }, async t => {
  const { backend } = fakeBackend();
  const connector = await startLocalConnector({ backend });
  t.after(() => connector.close());

  const unauthenticated = await rawRequest(connector.origin, { pathname: '/api/v1/dashboard' });
  assert.equal(unauthenticated.status, 401);
  assert.equal(json(unauthenticated).error.code, 'CAPABILITY_REQUIRED');

  const session = await exchangeBootstrap(connector);
  const redirectTarget = new URL(session.redirect.headers.location, connector.origin);
  assert.equal(redirectTarget.pathname, '/app');
  assert.equal(redirectTarget.search, '');
  assert.equal(session.redirect.headers['set-cookie'], undefined);
  assert.equal(session.redirect.headers['cache-control'], 'no-store');
  assert.equal(session.redirect.headers['referrer-policy'], 'no-referrer');
  assert.equal(session.redirect.body, '');
  assert.equal(session.redirect.body.includes(session.bootstrapToken), false);
  assert.equal(redirectTarget.search.includes(session.bootstrapToken), false);
  assert.equal(redirectTarget.search.includes(session.capability), false);
  assert.equal(redirectTarget.search.includes(session.csrf), false);
  assert.equal(session.csrfToken, session.csrf);
  assert.deepEqual(json(session.initializedResponse).data.connectorCompatibility, LOCAL_CONNECTOR_COMPATIBILITY_RECEIPT);

  const reload = await authenticatedGet(connector, session, '/api/v1/dashboard');
  const secondReload = await authenticatedGet(connector, session, '/api/v1/dashboard');
  assert.equal(reload.status, 200);
  assert.equal(secondReload.status, 200);
  assert.equal(reload.body.includes(session.capability), false);
  assert.equal(secondReload.body.includes(session.capability), false);

  const replayUrl = new URL(connector.bootstrapUrl);
  const replay = await rawRequest(connector.origin, { pathname: `${replayUrl.pathname}${replayUrl.search}` });
  assert.equal(replay.status, 401);
  assert.equal(json(replay).error.code, 'BOOTSTRAP_INVALID');
  assert.equal(replay.body.includes(replayUrl.searchParams.get('bootstrap')), false);

  const documentReplay = await rawRequest(connector.origin, {
    pathname: `${replayUrl.pathname}${replayUrl.search}`,
    headers: { accept: 'text/html,application/xhtml+xml', 'sec-fetch-dest': 'document' }
  });
  assert.equal(documentReplay.status, 401);
  assert.match(String(documentReplay.headers['content-type']), /^text\/html/);
  assert.match(documentReplay.body, /BOOTSTRAP_INVALID/);
  assert.match(documentReplay.body, /invalid or expired/);
  assert.equal(documentReplay.body.includes(replayUrl.searchParams.get('bootstrap')), false);
  assert.doesNotMatch(documentReplay.body, /<(?:style|script)\b|style=/i);
  assert.doesNotMatch(String(documentReplay.headers['content-security-policy']), /unsafe-inline/);

  const apiStillJson = await rawRequest(connector.origin, {
    pathname: '/api/v1/dashboard',
    headers: { accept: 'text/html', 'sec-fetch-dest': 'document' }
  });
  assert.equal(apiStillJson.status, 401);
  assert.match(String(apiStillJson.headers['content-type']), /^application\/json/);
  assert.equal(json(apiStillJson).error.code, 'CAPABILITY_REQUIRED');

  const realDateNow = Date.now;
  let currentTime = realDateNow();
  Date.now = () => currentTime;
  t.after(() => { Date.now = realDateNow; });
  const expiring = await startLocalConnector({ backend: fakeBackend().backend });
  t.after(() => expiring.close());
  currentTime += 5 * 60_000 + 1;
  const expiredUrl = new URL(expiring.bootstrapUrl);
  const expired = await rawRequest(expiring.origin, { pathname: `${expiredUrl.pathname}${expiredUrl.search}` });
  assert.equal(expired.status, 401);
  assert.equal(json(expired).error.code, 'BOOTSTRAP_INVALID');
});

test('bootstrap exchange rejects every non-GET method without consuming the one-time token', async t => {
  const connector = await startLocalConnector({ backend: fakeBackend().backend });
  t.after(() => connector.close());
  const bootstrap = new URL(connector.bootstrapUrl);
  const pathname = `${bootstrap.pathname}${bootstrap.search}`;
  const bootstrapToken = bootstrap.searchParams.get('bootstrap');

  for (const method of ['HEAD', 'POST', 'PUT', 'OPTIONS']) {
    const rejected = await rawRequest(connector.origin, { method, pathname });
    assert.equal(rejected.status, 405, method);
    assert.equal(rejected.headers.allow, 'GET', method);
    assert.equal(rejected.body.includes(bootstrapToken), false, method);
    if (method !== 'HEAD') assert.equal(json(rejected).error.code, 'METHOD_NOT_ALLOWED', method);
  }

  const session = await exchangeBootstrap(connector);
  assert.equal(session.bootstrapToken, bootstrapToken);
  assert.equal(session.initializedResponse.status, 200);
});

test('capability headers fail closed while legacy SkillMap cookies are rejected and expired selectively', async t => {
  const connector = await startLocalConnector({ backend: fakeBackend().backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const cases = [
    ['clean context', undefined],
    ['malformed header', 'not-a-capability'],
    ['wrong header', 'Z'.repeat(43)],
    ['multiple headers', [session.capability, session.capability]]
  ];
  for (const [label, capability] of cases) {
    const response = await rawRequest(connector.origin, {
      pathname: '/api/v1/dashboard',
      headers: capability === undefined ? {} : { 'x-skillmap-capability': capability }
    });
    assert.equal(response.status, 401, label);
    assert.equal(json(response).error.code, 'CAPABILITY_REQUIRED', label);
    assert.equal(response.body.includes(session.capability), false, label);
  }

  const capCookieName = 'skillmap_cap_12345';
  const csrfCookieName = 'skillmap_csrf_12345';
  const legacyReplay = await rawRequest(connector.origin, {
    pathname: '/api/v1/dashboard',
    headers: {
      cookie: `${capCookieName}=${session.capability}; ${csrfCookieName}=${session.csrf}; session_keep=yes`
    }
  });
  assert.equal(legacyReplay.status, 401);
  assert.equal(json(legacyReplay).error.code, 'CAPABILITY_REQUIRED');
  assert.equal(legacyReplay.body.includes(session.capability), false);
  assert.equal(legacyReplay.body.includes(session.csrf), false);
  const expiredCookies = responseSetCookies(legacyReplay);
  assert.equal(expiredCookies.length, 2);
  assert.match(expiredCookies.find(value => value.startsWith(`${capCookieName}=`)), /Max-Age=0;.*SameSite=Strict; HttpOnly$/);
  assert.match(expiredCookies.find(value => value.startsWith(`${csrfCookieName}=`)), /Max-Age=0;.*SameSite=Strict$/);
  assert.equal(expiredCookies.some(value => value.startsWith('session_keep=')), false);

  const unrelatedOnly = await rawRequest(connector.origin, {
    pathname: '/api/v1/dashboard',
    headers: { cookie: 'session_keep=yes' }
  });
  assert.equal(unrelatedOnly.status, 401);
  assert.deepEqual(responseSetCookies(unrelatedOnly), []);
});

test('simultaneous loopback connectors keep fragment capabilities isolated without setting shared cookies', async t => {
  const first = await startLocalConnector({ backend: fakeBackend().backend });
  const second = await startLocalConnector({ backend: fakeBackend().backend });
  t.after(() => Promise.all([first.close(), second.close()]));
  const firstSession = await exchangeBootstrap(first);
  const secondSession = await exchangeBootstrap(second);
  assert.notEqual(firstSession.capability, secondSession.capability);
  assert.notEqual(firstSession.csrf, secondSession.csrf);
  assert.equal(firstSession.redirect.headers['set-cookie'], undefined);
  assert.equal(secondSession.redirect.headers['set-cookie'], undefined);

  const firstView = await authenticatedGet(first, firstSession, '/api/v1/dashboard');
  const secondView = await authenticatedGet(second, secondSession, '/api/v1/dashboard');
  assert.equal(firstView.status, 200);
  assert.equal(secondView.status, 200);

  const firstTokenAtSecond = await authenticatedGet(second, firstSession, '/api/v1/dashboard');
  const secondTokenAtFirst = await authenticatedGet(first, secondSession, '/api/v1/dashboard');
  assert.equal(firstTokenAtSecond.status, 401);
  assert.equal(secondTokenAtFirst.status, 401);
  assert.equal(json(firstTokenAtSecond).error.code, 'CAPABILITY_REQUIRED');
  assert.equal(json(secondTokenAtFirst).error.code, 'CAPABILITY_REQUIRED');
});

test('capability, Origin, Fetch Metadata, and session CSRF checks fail closed without CORS', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const routeBody = { prompt: 'route this private canary prompt', max: 3 };

  const missingOrigin = await postJson(connector, session, '/api/v1/routes/preview', routeBody, { origin: null });
  assert.equal(missingOrigin.status, 403);
  assert.equal(json(missingOrigin).error.code, 'ORIGIN_REQUIRED');

  const wrongOrigin = await postJson(connector, session, '/api/v1/routes/preview', routeBody, { origin: 'https://attacker.invalid' });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(json(wrongOrigin).error.code, 'ORIGIN_REJECTED');
  assert.equal(wrongOrigin.headers['access-control-allow-origin'], undefined);

  const crossSite = await postJson(connector, session, '/api/v1/routes/preview', routeBody, { fetchSite: 'cross-site' });
  assert.equal(crossSite.status, 403);
  assert.equal(json(crossSite).error.code, 'FETCH_SITE_REJECTED');

  const missingCsrf = await postJson(connector, session, '/api/v1/routes/preview', routeBody, { csrf: null });
  assert.equal(missingCsrf.status, 403);
  assert.equal(json(missingCsrf).error.code, 'CSRF_REJECTED');

  const missingCapability = await postJson(connector, { ...session, capability: undefined }, '/api/v1/routes/preview', routeBody);
  assert.equal(missingCapability.status, 401);
  assert.equal(json(missingCapability).error.code, 'CAPABILITY_REQUIRED');

  const wrongCsrf = await postJson(connector, session, '/api/v1/routes/preview', routeBody, { csrf: 'wrong-proof' });
  assert.equal(wrongCsrf.status, 403);
  assert.equal(json(wrongCsrf).error.code, 'CSRF_REJECTED');

  const wellFormedWrongCsrf = await postJson(connector, session, '/api/v1/routes/preview', routeBody, { csrf: 'Y'.repeat(43) });
  assert.equal(wellFormedWrongCsrf.status, 403);
  assert.equal(json(wellFormedWrongCsrf).error.code, 'CSRF_REJECTED');

  const multipleCsrf = await postJson(connector, session, '/api/v1/routes/preview', routeBody, { csrf: [session.csrf, session.csrf] });
  assert.equal(multipleCsrf.status, 403);
  assert.equal(json(multipleCsrf).error.code, 'CSRF_REJECTED');

  const accepted = await postJson(connector, session, '/api/v1/routes/preview', routeBody);
  assert.equal(accepted.status, 200);
  assert.equal(json(accepted).ok, true);
  assert.equal(json(accepted).data.promptStored, false);
  assert.equal(accepted.body.includes(routeBody.prompt), false);
  assert.equal(accepted.headers['access-control-allow-origin'], undefined);
  assert.deepEqual(fixture.calls.previewRoute.at(-1), routeBody);

  const crossSiteHealth = await rawRequest(connector.origin, {
    pathname: '/api/v1/health',
    headers: { 'sec-fetch-site': 'cross-site' }
  });
  assert.equal(crossSiteHealth.status, 403);
  assert.equal(json(crossSiteHealth).error.code, 'FETCH_SITE_REJECTED');

  const preflight = await rawRequest(connector.origin, {
    method: 'OPTIONS',
    pathname: '/api/v1/routes/preview',
    headers: {
      origin: 'https://attacker.invalid',
      'access-control-request-method': 'POST'
    }
  });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
});

test('connector feedback preserves routed selections and rejects an explicit historical rewrite', async t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-connector-feedback-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  await recordRouteEvent(cwd, createRouteEvent(routeResult(), REVISION, 'api'));
  const fixture = fakeBackend({
    async recordFeedback(routeId, input) { return createAndRecordFeedback(cwd, { routeId, ...input }); }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const omitted = await postJson(connector, session, `/api/v1/routes/${ROUTE_ID}/feedback`, {
    outcome: 'correct', reasonCode: 'operator-correct', idempotencyKey: 'connector-feedback-omitted-1'
  });
  assert.equal(omitted.status, 201, omitted.body);
  assert.deepEqual(json(omitted).data.selectedSkillIds, [SKILL_ID]);

  const explicitEmpty = await postJson(connector, session, `/api/v1/routes/${ROUTE_ID}/feedback`, {
    outcome: 'wrong', reasonCode: 'operator-wrong', idempotencyKey: 'connector-feedback-empty-1', selectedSkillIds: []
  });
  assert.equal(explicitEmpty.status, 409, explicitEmpty.body);
  assert.equal(json(explicitEmpty).error.code, 'FEEDBACK_SELECTION_CONFLICT');
  assert.equal(explicitEmpty.body.includes('connector-feedback-empty-1'), false);
});

test('connector route detail is a strict authenticated redacted permalink with 400 and 404 boundaries', async t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skillmap-connector-route-detail-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const event = createRouteEvent(routeResult(), REVISION, 'api');
  await recordRouteEvent(cwd, event);
  const fixture = fakeBackend({
    async showRoute(routeId) { return readRouteEvent(cwd, routeId); }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const detail = await authenticatedGet(connector, session, `/api/v1/routes/${ROUTE_ID}`);
  assert.equal(detail.status, 200, detail.body);
  assert.deepEqual(json(detail).data, event);
  assert.equal(json(detail).data.promptStored, false);
  assert.equal(detail.body.includes('"prompt":'), false);
  assert.equal(detail.body.includes('hookText'), false);
  assert.equal(detail.body.includes('/home/'), false);

  const invalid = await authenticatedGet(connector, session, '/api/v1/routes/not-a-route-id');
  assert.equal(invalid.status, 400, invalid.body);
  assert.equal(json(invalid).error.code, 'ROUTE_EVENT_ID_INVALID');

  const missing = await authenticatedGet(connector, session, '/api/v1/routes/33333333-3333-4333-8333-333333333333');
  assert.equal(missing.status, 404, missing.body);
  assert.equal(json(missing).error.code, 'ROUTE_EVENT_NOT_FOUND');
});

test('cancellation, revision history, and rollback APIs enforce exact inputs and return redacted receipts', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const jobId = '22222222-2222-4222-8222-222222222222';

  const history = await authenticatedGet(connector, session, '/api/v1/state/revisions?limit=1');
  assert.equal(history.status, 200, history.body);
  assert.deepEqual(fixture.calls.stateRevisions, [{ limit: 1 }]);
  assert.deepEqual(Object.keys(json(history).data).sort(), ['currentRevision', 'hasMore', 'items', 'limit', 'nextCursor', 'routingRevisionId']);
  assert.deepEqual(Object.keys(json(history).data.items[0]).sort(), ['artifactCount', 'createdAt', 'isCurrent', 'isRoutingServing', 'mutation', 'parentRevisionId', 'revision', 'routingApprovalRecorded', 'sequence']);
  assert.equal(json(history).data.items[0].routingApprovalRecorded, true);
  assert.deepEqual(Object.keys(json(history).data.items[0].mutation).sort(), ['actor', 'kind', 'reasonDigest', 'sourceRevisionId', 'targetRevisionId']);
  assert.equal(history.body.includes('/home/operator'), false);
  assert.equal(history.body.includes('private operator reason'), false);

  const unknownQuery = await authenticatedGet(connector, session, '/api/v1/state/revisions?limit=1&path=%2Fprivate');
  assert.equal(unknownQuery.status, 400);
  assert.equal(json(unknownQuery).error.code, 'QUERY_INVALID');
  assert.equal(fixture.calls.stateRevisions.length, 1);

  const invalidCancel = await postJson(connector, session, `/api/v1/jobs/${jobId}/cancel`, {
    idempotencyKey: 'cancel-job-1', unexpected: '/private'
  });
  assert.equal(invalidCancel.status, 400);
  assert.equal(fixture.calls.cancelJob.length, 0);
  const cancelled = await postJson(connector, session, `/api/v1/jobs/${jobId}/cancel`, { idempotencyKey: 'cancel-job-1' });
  assert.equal(cancelled.status, 200, cancelled.body);
  assert.deepEqual(fixture.calls.cancelJob, [{ jobId, input: { idempotencyKey: 'cancel-job-1' } }]);
  assert.deepEqual(Object.keys(json(cancelled).data).sort(), ['cancellationDigest', 'idempotent', 'jobId', 'jobState', 'publicationPrevented', 'state']);
  assert.equal(cancelled.body.includes('cancel-job-1'), false);
  assert.equal(cancelled.body.includes('/home/operator'), false);

  const unconfirmed = await postJson(connector, session, '/api/v1/state/rollback', {
    targetRevision: REVISION.revisionId,
    expectedRevision: REVISION.revisionId,
    actor: 'local-api',
    reason: 'operator-rollback',
    confirm: false
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(json(unconfirmed).error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(fixture.calls.rollbackState.length, 0);

  const invalidReason = await postJson(connector, session, '/api/v1/state/rollback', {
    targetRevision: REVISION.revisionId,
    expectedRevision: REVISION.revisionId,
    actor: 'local-api',
    reason: 'free text is forbidden',
    confirm: true
  });
  assert.equal(invalidReason.status, 400);
  assert.equal(fixture.calls.rollbackState.length, 0);

  const rolledBack = await postJson(connector, session, '/api/v1/state/rollback', {
    targetRevision: REVISION.revisionId,
    expectedRevision: REVISION.revisionId,
    actor: 'local-api',
    reason: 'operator-rollback',
    confirm: true
  });
  assert.equal(rolledBack.status, 201, rolledBack.body);
  assert.equal(fixture.calls.rollbackState.length, 1);
  assert.deepEqual(Object.keys(json(rolledBack).data).sort(), ['revision', 'routingApprovalRequired', 'routingApproved', 'state', 'targetRevisionId', 'warningCount']);
  assert.equal(json(rolledBack).data.routingApproved, false);
  assert.equal(json(rolledBack).data.routingApprovalRequired, true);
  assert.equal(rolledBack.body.includes('operator-rollback'), false);
  assert.equal(rolledBack.body.includes('/home/operator'), false);
});

test('policy preview and source adoption/diff APIs enforce discriminated inputs and project bounded receipts', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const unconfirmedPreview = await postJson(connector, session, '/api/v1/policy/preview', { expectedRevision: REVISION.revisionId, confirmation: 'none' });
  assert.equal(unconfirmedPreview.status, 400);
  const preview = await postJson(connector, session, '/api/v1/policy/preview', { expectedRevision: REVISION.revisionId, confirmation: 'review' });
  assert.equal(preview.status, 200, preview.body);
  assert.deepEqual(fixture.calls.previewPolicy, [{ expectedRevision: REVISION.revisionId, confirmation: 'review' }]);
  assert.deepEqual(Object.keys(json(preview).data).sort(), ['currentPresent', 'currentSummary', 'delta', 'projectedSummary', 'revision', 'routingApprovalEligible', 'state', 'warnings', 'wouldPublish']);
  assert.equal(json(preview).data.currentPresent, true);
  assert.deepEqual(json(preview).data.warnings, ['POLICY_DUPLICATE_NAMES']);
  assert.equal(json(preview).data.wouldPublish, false);
  assert.equal(preview.body.includes('/home/operator'), false);
  assert.equal(preview.body.includes('private-policy'), false);

  const commonAdoption = { skillId: SKILL_ID, expectedRevision: REVISION.revisionId, confirm: true };
  for (const body of [
    { ...commonAdoption, sourceType: 'local', reason: 'Reviewed local authorship.', repository: 'owner/repo' },
    { ...commonAdoption, sourceType: 'github', repository: 'owner/repo', sourcePath: '../escape', ref: 'main' },
    { ...commonAdoption, sourceType: 'github', repository: 'owner/repo', sourcePath: 'skills/demo', ref: 'main', token: 'forbidden' },
    { ...commonAdoption, sourceType: 'local', reason: 'Reviewed local authorship.', confirm: false }
  ]) {
    const rejected = await postJson(connector, session, '/api/v1/sources/adoptions', body);
    assert.equal(rejected.status, 400, rejected.body);
  }
  assert.equal(fixture.calls.adoptSource.length, 0);

  const local = await postJson(connector, session, '/api/v1/sources/adoptions', { ...commonAdoption, sourceType: 'local', reason: 'Reviewed local authorship.' });
  assert.equal(local.status, 201, local.body);
  assert.deepEqual(Object.keys(json(local).data).sort(), ['adoptionDigest', 'nextAction', 'revision', 'routingApprovalRequired', 'skillId', 'sourceType', 'state']);
  assert.equal(local.body.includes('Reviewed local authorship'), false);
  assert.equal(local.body.includes('/home/operator'), false);

  const github = await postJson(connector, session, '/api/v1/sources/adoptions', {
    ...commonAdoption, sourceType: 'github', repository: 'owner/repo', sourcePath: 'skills/demo', ref: 'feature/source-v2'
  });
  assert.equal(github.status, 201, github.body);
  assert.equal(fixture.calls.adoptSource.length, 2);
  assert.deepEqual(fixture.calls.adoptSource[1], {
    ...commonAdoption, sourceType: 'github', repository: 'owner/repo', sourcePath: 'skills/demo', ref: 'feature/source-v2'
  });

  const invalidDiff = await postJson(connector, session, '/api/v1/sources/diff', { skillId: SKILL_ID, expectedRevision: REVISION.revisionId, path: '/private' });
  assert.equal(invalidDiff.status, 400);
  const diff = await postJson(connector, session, '/api/v1/sources/diff', { skillId: SKILL_ID, expectedRevision: REVISION.revisionId });
  assert.equal(diff.status, 200, diff.body);
  assert.equal(fixture.calls.sourceDiff.length, 1);
  assert.equal(fixture.calls.sourceDiff[0].signal instanceof AbortSignal, true);
  assert.deepEqual(Object.keys(json(diff).data).sort(), ['diff', 'persisted', 'promptStored', 'revision', 'risk', 'skillId', 'state', 'upstreamCommit']);
  assert.deepEqual(Object.keys(json(diff).data.diff).sort(), ['additions', 'changedLines', 'deletions', 'lines', 'truncated']);
  assert.equal(json(diff).data.diff.lines.length, 120);
  assert.equal(json(diff).data.diff.lines.every((line) => line.text.length <= 500), true);
  assert.equal(json(diff).data.diff.truncated, true);
  assert.equal(json(diff).data.persisted, false);
  assert.equal(json(diff).data.promptStored, false);
  assert.equal(diff.body.includes('/home/operator'), false);
  assert.equal(diff.body.includes('private-token'), false);
  assert.equal(diff.body.includes('PRIVATE-DIFF'), false);
});

test('source diff maps timeout safely and rejects a response when the revision changes in flight', async t => {
  let activeRevision = REVISION;
  let activeEtag = ETAG;
  const nextRevision = { ...REVISION, revisionId: 'r00000000000000000002-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', workspaceRevision: `sha256:${'9'.repeat(64)}` };
  const fixture = fakeBackend({
    async revisionContext() { return { servingRevision: activeRevision, currentRevision: activeRevision, compatibility: 'compatible', etag: activeEtag }; },
    async sourceDiff(input) {
      if (input.skillId === SKILL_ID) {
        activeRevision = nextRevision;
        activeEtag = '"source-diff-next"';
        return { skillId: SKILL_ID, state: 'unknown', risk: null, upstreamCommit: null, diff: { additions: 0, deletions: 0, changedLines: 0, truncated: false, lines: [] }, promptStored: false, persisted: false, revision: REVISION };
      }
      throw codedError('REQUEST_TIMEOUT', 'private timeout transport details');
    }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const changed = await postJson(connector, session, '/api/v1/sources/diff', { skillId: SKILL_ID, expectedRevision: REVISION.revisionId });
  assert.equal(changed.status, 409);
  assert.equal(json(changed).error.code, 'REVISION_CHANGED_RETRY');

  activeRevision = REVISION;
  activeEtag = ETAG;
  const otherSkill = `sk_${'B'.repeat(43)}`;
  const timeout = await postJson(connector, session, '/api/v1/sources/diff', { skillId: otherSkill, expectedRevision: REVISION.revisionId });
  assert.equal(timeout.status, 504);
  assert.equal(json(timeout).error.code, 'REQUEST_TIMEOUT');
  assert.equal(json(timeout).error.retryable, true);
  assert.equal(timeout.body.includes('private timeout'), false);
});

test('JSON bodies, field sets, prompts, query strings, and pagination limits are bounded', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const wrongType = await rawRequest(connector.origin, {
    method: 'POST',
    pathname: '/api/v1/routes/preview',
    headers: mutationHeaders(connector, session, { 'content-type': 'text/plain' }),
    body: '{}'
  });
  assert.equal(wrongType.status, 415);
  assert.equal(json(wrongType).error.code, 'CONTENT_TYPE_REQUIRED');

  const malformed = await rawRequest(connector.origin, {
    method: 'POST',
    pathname: '/api/v1/routes/preview',
    headers: mutationHeaders(connector, session, { 'content-type': 'application/json' }),
    body: '{'
  });
  assert.equal(malformed.status, 400);
  assert.equal(json(malformed).error.code, 'MALFORMED_JSON');

  const unknown = await postJson(connector, session, '/api/v1/routes/preview', { prompt: 'valid route prompt', unexpected: true });
  assert.equal(unknown.status, 400);
  assert.equal(json(unknown).error.code, 'INPUT_INVALID');

  const invalidMax = await postJson(connector, session, '/api/v1/routes/preview', { prompt: 'valid route prompt', max: 11 });
  assert.equal(invalidMax.status, 400);
  assert.equal(json(invalidMax).error.code, 'INPUT_INVALID');

  const oversizedPrompt = await postJson(connector, session, '/api/v1/routes/preview', { prompt: 'x'.repeat(32 * 1024 + 1) });
  assert.equal(oversizedPrompt.status, 400);
  assert.equal(json(oversizedPrompt).error.code, 'INPUT_INVALID');

  const oversizedBody = await postJson(connector, session, '/api/v1/routes/preview', { prompt: 'x'.repeat(70 * 1024) });
  assert.equal(oversizedBody.status, 413);
  assert.equal(json(oversizedBody).error.code, 'REQUEST_TOO_LARGE');

  const oversizedChunkedBody = await rawRequest(connector.origin, {
    method: 'POST',
    pathname: '/api/v1/routes/preview',
    headers: mutationHeaders(connector, session, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }),
    body: JSON.stringify({ prompt: 'x'.repeat(70 * 1024) })
  });
  assert.equal(oversizedChunkedBody.status, 413);
  assert.equal(json(oversizedChunkedBody).error.code, 'REQUEST_TOO_LARGE');

  for (const limit of ['0', '101', '1.5', 'NaN']) {
    const rejected = await authenticatedGet(connector, session, `/api/v1/skills?limit=${limit}`);
    assert.equal(rejected.status, 400);
    assert.equal(json(rejected).error.code, 'LIMIT_INVALID');
  }
  const queryTooLong = await authenticatedGet(connector, session, `/api/v1/skills?query=${'q'.repeat(257)}`);
  assert.equal(queryTooLong.status, 400);
  assert.equal(json(queryTooLong).error.code, 'QUERY_INVALID');
  const cursorTooLong = await authenticatedGet(connector, session, `/api/v1/skills?cursor=${'c'.repeat(1025)}`);
  assert.equal(cursorTooLong.status, 400);
  assert.equal(json(cursorTooLong).error.code, 'QUERY_INVALID');

  const maximum = await authenticatedGet(connector, session, '/api/v1/skills?query=alpha&cursor=next&limit=100');
  assert.equal(maximum.status, 200);
  assert.deepEqual(fixture.calls.listSkills.at(-1), { query: 'alpha', cursor: 'next', limit: 100 });
});

test('workspace validate/select API is strict, same-origin, and returns only redacted receipts', async t => {
  const canaryPath = '/opt/private/WORKSPACE-PATH-CANARY';
  const fixture = fakeBackend({
    async validateWorkspace(input) {
      fixture.calls.validateWorkspace.push(input);
      return { state: 'validated', validationId: ROUTE_ID, mode: input.mode, label: canaryPath, candidate: canaryPath, expiresInSeconds: 300, confirmationRequired: true };
    },
    async selectWorkspace(input) {
      fixture.calls.selectWorkspace.push(input);
      return { state: 'selected', selectionId: ROUTE_ID, mode: 'select-existing', created: false, alreadySelected: false, label: canaryPath, workspaceId: REVISION.workspaceId, bootstrapState: 'ready', path: canaryPath };
    }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const unknown = await postJson(connector, session, '/api/v1/workspaces/validate', { candidate: canaryPath, mode: 'select-existing', recursive: true });
  assert.equal(unknown.status, 400);
  const invalidMode = await postJson(connector, session, '/api/v1/workspaces/validate', { candidate: canaryPath, mode: 'discover-all' });
  assert.equal(invalidMode.status, 400);
  const crossOrigin = await postJson(connector, session, '/api/v1/workspaces/validate', { candidate: canaryPath, mode: 'select-existing' }, { origin: 'https://attacker.invalid' });
  assert.equal(crossOrigin.status, 403);
  assert.equal(fixture.calls.validateWorkspace.length, 0);

  const validated = await postJson(connector, session, '/api/v1/workspaces/validate', { candidate: canaryPath, mode: 'select-existing' });
  assert.equal(validated.status, 200);
  assert.equal(validated.body.includes(canaryPath), false);
  assert.equal(json(validated).data.validationId, ROUTE_ID);
  assert.equal(json(validated).data.label, 'Local workspace');
  const refused = await postJson(connector, session, '/api/v1/workspaces/select', { validationId: ROUTE_ID, confirm: false });
  assert.equal(refused.status, 400);
  assert.equal(fixture.calls.selectWorkspace.length, 0);
  const selected = await postJson(connector, session, '/api/v1/workspaces/select', { validationId: ROUTE_ID, confirm: true });
  assert.equal(selected.status, 201);
  assert.equal(selected.body.includes(canaryPath), false);
  assert.deepEqual(Object.keys(json(selected).data).sort(), ['alreadySelected', 'bootstrapState', 'created', 'label', 'mode', 'selectionId', 'state', 'workspaceId']);
  assert.equal(fixture.calls.selectWorkspace.length, 1);
});

test('workspace API maps only allowlisted validation and job blockers to actionable 400/409 errors', async t => {
  const canaryPath = '/opt/private/WORKSPACE-ERROR-CANARY';
  const changedId = '33333333-3333-4333-8333-333333333333';
  const unknownId = '44444444-4444-4444-8444-444444444444';
  const fixture = fakeBackend({
    async validateWorkspace() {
      throw codedError('WORKSPACE_CANDIDATE_INVALID', `Candidate ${canaryPath} is not usable.`);
    },
    async selectWorkspace(input) {
      if (input.validationId === ROUTE_ID) throw codedError('WORKSPACE_VALIDATION_INVALID', `Expired ${canaryPath}.`);
      if (input.validationId === changedId) throw codedError('WORKSPACE_VALIDATION_CHANGED', `Changed ${canaryPath}.`);
      if (input.validationId === REVISION.workspaceId) throw codedError('WORKSPACE_SWITCH_JOBS_ACTIVE', `Queued job at ${canaryPath}.`);
      throw codedError('WORKSPACE_NOT_ALLOWLISTED', `Unexpected ${canaryPath}.`);
    }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const invalid = await postJson(connector, session, '/api/v1/workspaces/validate', { candidate: canaryPath, mode: 'select-existing' });
  assert.equal(invalid.status, 400);
  assert.equal(json(invalid).error.code, 'WORKSPACE_CANDIDATE_INVALID');
  assert.equal(json(invalid).error.retryable, false);
  assert.equal(invalid.body.includes(canaryPath), false);

  for (const validationId of [ROUTE_ID, changedId]) {
    const stale = await postJson(connector, session, '/api/v1/workspaces/select', { validationId, confirm: true });
    assert.equal(stale.status, 409);
    assert.match(json(stale).error.code, /^WORKSPACE_VALIDATION_(?:INVALID|CHANGED)$/);
    assert.equal(json(stale).error.retryable, true);
    assert.match(json(stale).error.message, /Validate the directory again/);
    assert.doesNotMatch(json(stale).error.message, /finish or cancel/i);
    assert.equal(stale.body.includes(canaryPath), false);
  }

  const jobs = await postJson(connector, session, '/api/v1/workspaces/select', { validationId: REVISION.workspaceId, confirm: true });
  assert.equal(jobs.status, 409);
  assert.equal(json(jobs).error.code, 'WORKSPACE_SWITCH_JOBS_ACTIVE');
  assert.equal(json(jobs).error.retryable, true);
  assert.match(json(jobs).error.message, /Finish or cancel it before switching/);
  assert.doesNotMatch(json(jobs).error.message, /validate the directory/i);
  assert.equal(jobs.body.includes(canaryPath), false);

  const unknown = await postJson(connector, session, '/api/v1/workspaces/select', { validationId: unknownId, confirm: true });
  assert.equal(unknown.status, 500, 'unknown WORKSPACE_* codes must not bypass the explicit error allowlist');
  assert.equal(json(unknown).error.code, 'INTERNAL_ERROR');
  assert.equal(unknown.body.includes(canaryPath), false);
});

test('validation, job-ledger, and cancellation capacity conflicts map to actionable retry metadata', async t => {
  const fixture = fakeBackend({
    async validateWorkspace() { throw codedError('WORKSPACE_VALIDATION_LIMIT', 'private workspace validation details'); },
    async validateRoot() { throw codedError('ROOT_VALIDATION_LIMIT', 'private root validation details'); },
    async createJob() { throw codedError('JOB_LEDGER_CAPACITY', 'private job ledger details'); },
    async cancelJob() { throw codedError('JOB_CANCELLATION_IDEMPOTENCY_CONFLICT', 'private cancellation key details'); }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const workspaceLimit = await postJson(connector, session, '/api/v1/workspaces/validate', { candidate: '/local-workspace', mode: 'select-existing' });
  assert.equal(workspaceLimit.status, 409);
  assert.equal(json(workspaceLimit).error.code, 'WORKSPACE_VALIDATION_LIMIT');
  assert.equal(json(workspaceLimit).error.retryable, true);
  assert.match(json(workspaceLimit).error.message, /wait for expiry/i);

  const rootLimit = await postJson(connector, session, '/api/v1/roots/validate', { candidate: '/local-root' });
  assert.equal(rootLimit.status, 409);
  assert.equal(json(rootLimit).error.code, 'ROOT_VALIDATION_LIMIT');
  assert.equal(json(rootLimit).error.retryable, true);

  const jobLimit = await postJson(connector, session, '/api/v1/jobs', {
    kind: 'skillmap.job-request', schemaVersion: 1,
    expectedRevision: REVISION.revisionId,
    idempotencyKey: 'connector-ledger-capacity-1', requestedBy: 'api', confirmation: 'none',
    parameters: { type: 'doctor' }
  });
  assert.equal(jobLimit.status, 409);
  assert.equal(json(jobLimit).error.code, 'JOB_LEDGER_CAPACITY');
  assert.equal(json(jobLimit).error.retryable, true);
  assert.match(json(jobLimit).error.message, /Finish or cancel/i);

  const cancellationConflict = await postJson(connector, session, '/api/v1/jobs/22222222-2222-4222-8222-222222222222/cancel', {
    idempotencyKey: 'connector-cancel-conflict-1'
  });
  assert.equal(cancellationConflict.status, 409);
  assert.equal(json(cancellationConflict).error.code, 'JOB_CANCELLATION_IDEMPOTENCY_CONFLICT');
  assert.equal(json(cancellationConflict).error.retryable, false);
  for (const response of [workspaceLimit, rootLimit, jobLimit, cancellationConflict]) {
    assert.equal(response.body.includes('private'), false);
  }
});

test('one capability session survives a real foreground workspace switch and observes a new bootstrap/ETag', async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'skillmap-connector-workspace-switch-'));
  const initial = path.join(parent, 'initial');
  const selected = path.join(parent, 'selected');
  mkdirSync(initial);
  mkdirSync(path.join(selected, '.skillmap'), { recursive: true });
  writeFileSync(path.join(selected, '.skillmap', 'config.yml'), 'version: 1\nprofile: personal-v1\nroots: []\n');
  const backend = new SkillMapLocalBackend(initial);
  const connector = await startLocalConnector({ backend });
  t.after(async () => { await connector.close(); rmSync(parent, { recursive: true, force: true }); });
  const session = await exchangeBootstrap(connector);
  assert.equal(json(session.initializedResponse).data.state, 'uninitialized');

  const validated = await postJson(connector, session, '/api/v1/workspaces/validate', { candidate: selected, mode: 'select-existing' });
  assert.equal(validated.status, 200);
  assert.equal(validated.body.includes(selected), false);
  const switched = await postJson(connector, session, '/api/v1/workspaces/select', { validationId: json(validated).data.validationId, confirm: true });
  assert.equal(switched.status, 201);
  assert.equal(switched.body.includes(selected), false);
  const after = await authenticatedGet(connector, session, '/api/v1/bootstrap');
  assert.equal(after.status, 200);
  assert.equal(json(after).data.state, 'partial-legacy');
  assert.notEqual(after.headers.etag, session.initializedResponse.headers.etag);

  const replayUrl = new URL(connector.bootstrapUrl);
  const replay = await rawRequest(connector.origin, { pathname: `${replayUrl.pathname}${replayUrl.search}` });
  assert.equal(replay.status, 401);
  assert.equal(json(replay).error.code, 'BOOTSTRAP_INVALID');
});

test('a failure after workspace commit leaves the API outcome unknown but exposes only the newly active bootstrap state', async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'skillmap-connector-workspace-ambiguous-'));
  const initial = path.join(parent, 'initial');
  const selected = path.join(parent, 'selected');
  mkdirSync(initial);
  mkdirSync(path.join(selected, '.skillmap'), { recursive: true });
  writeFileSync(path.join(selected, '.skillmap', 'config.yml'), 'version: 1\nprofile: personal-v1\nroots: []\n');
  const backend = new SkillMapLocalBackend(initial);
  const commitSelection = backend.selectWorkspace.bind(backend);
  backend.selectWorkspace = async input => {
    await commitSelection(input);
    throw codedError('FAIL_AFTER_WORKSPACE_COMMIT', 'The selection response failed after commit.');
  };
  const connector = await startLocalConnector({ backend });
  t.after(async () => { await connector.close(); rmSync(parent, { recursive: true, force: true }); });
  const session = await exchangeBootstrap(connector);
  const oldEtag = session.initializedResponse.headers.etag;
  const validated = await postJson(connector, session, '/api/v1/workspaces/validate', { candidate: selected, mode: 'select-existing' });
  const ambiguous = await postJson(connector, session, '/api/v1/workspaces/select', { validationId: json(validated).data.validationId, confirm: true });
  assert.equal(ambiguous.status, 500);
  assert.equal(json(ambiguous).error.code, 'INTERNAL_ERROR');
  assert.equal(ambiguous.body.includes(selected), false);

  const active = await authenticatedGet(connector, session, '/api/v1/bootstrap');
  assert.equal(active.status, 200);
  assert.equal(json(active).data.state, 'partial-legacy');
  assert.notEqual(active.headers.etag, oldEtag);
  assert.equal(active.body.includes(initial), false);
  assert.equal(active.body.includes(selected), false);
});

test('matching ETags return an empty 304 without recomputing the representation', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const first = await authenticatedGet(connector, session, '/api/v1/dashboard');
  assert.equal(first.status, 200);
  assert.equal(first.headers.etag, ETAG);
  assert.equal(fixture.calls.dashboard, 1);

  const cached = await authenticatedGet(connector, session, '/api/v1/dashboard', { 'if-none-match': ETAG });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.etag, ETAG);
  assert.equal(cached.body.length, 0);
  assert.equal(fixture.calls.dashboard, 1, 'a matching current ETag must short-circuit before backend composition');
});

test('read composition rejects revision skew and state conflicts map to HTTP 409', async t => {
  let activeRevision = REVISION;
  let activeEtag = ETAG;
  const nextRevision = {
    ...REVISION,
    revisionId: 'r00000000000000000002-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    workspaceRevision: `sha256:${'9'.repeat(64)}`
  };
  const fixture = fakeBackend({
    async revisionContext() {
      return { servingRevision: activeRevision, currentRevision: activeRevision, compatibility: 'compatible', etag: activeEtag };
    },
    async dashboard() {
      activeRevision = nextRevision;
      activeEtag = '"workspace-next-revision"';
      return { composedFrom: nextRevision.revisionId };
    },
    async approveRoot() {
      const error = new Error('Expected revision no longer matches current state.');
      error.code = 'STATE_CONFLICT';
      throw error;
    }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const skewed = await authenticatedGet(connector, session, '/api/v1/dashboard');
  assert.equal(skewed.status, 409);
  assert.equal(json(skewed).error.code, 'REVISION_CHANGED_RETRY');
  assert.equal(json(skewed).error.retryable, true);
  assert.equal(json(skewed).currentRevision.revisionId, nextRevision.revisionId);

  const conflicted = await postJson(connector, session, '/api/v1/roots/approve', {
    validationId: 'root-validation-1',
    expectedRevision: nextRevision.revisionId
  });
  assert.equal(conflicted.status, 409);
  assert.equal(json(conflicted).error.code, 'REVISION_CONFLICT');
  assert.equal(json(conflicted).error.retryable, true);
});

test('unexpected backend failures and oversized responses are returned as bounded redacted errors', async t => {
  const canary = 'Bearer private-secret at /home/operator/private.txt';
  const fixture = fakeBackend({
    async sources() { throw new Error(canary); },
    async dashboard() { return { blob: 'x'.repeat(2 * 1024 * 1024) }; }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const failed = await authenticatedGet(connector, session, '/api/v1/sources');
  assert.equal(failed.status, 500);
  assert.equal(json(failed).error.code, 'INTERNAL_ERROR');
  assert.equal(failed.body.includes(canary), false);
  assert.equal(failed.body.includes('/home/operator'), false);
  assert.equal(failed.body.toLowerCase().includes('private-secret'), false);

  const oversized = await authenticatedGet(connector, session, '/api/v1/dashboard');
  assert.equal(oversized.status, 500);
  assert.equal(json(oversized).error.code, 'RESPONSE_TOO_LARGE');
  assert.ok(oversized.body.length < 2 * 1024 * 1024);
});

test('state errors redact POSIX, Windows, UNC, and file URL locations while retaining machine codes', async t => {
  const locations = ['/tmp/private/state.json', '/opt/skillmap/private.json', 'C:\\Users\\operator\\state.json', 'C:/private/state.json', '\\\\server\\share\\state.json', 'file:///private/var/state.json'];
  for (const location of locations) {
    const fixture = fakeBackend({
      async approveRoot() {
        const error = new Error(`Unsafe state target ${location}`);
        error.code = 'STATE_UNSAFE_PATH';
        throw error;
      }
    });
    const connector = await startLocalConnector({ backend: fixture.backend });
    const session = await exchangeBootstrap(connector);
    const response = await postJson(connector, session, '/api/v1/roots/approve', { validationId: 'root-validation-1', expectedRevision: REVISION.revisionId });
    assert.equal(response.status, 409);
    assert.equal(json(response).error.code, 'STATE_UNSAFE_PATH');
    assert.equal(response.body.includes(location), false);
    await connector.close();
  }
});

test('concurrency limit rejects request 33 while 32 authenticated requests are active', { timeout: 10_000 }, async t => {
  const allEntered = deferred();
  const release = deferred();
  let entered = 0;
  const fixture = fakeBackend({
    async dashboard() {
      entered += 1;
      if (entered === 32) allEntered.resolve();
      await release.promise;
      return { ready: true };
    }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(async () => { release.resolve(); await connector.close(); });
  const session = await exchangeBootstrap(connector);

  const activeRequests = Array.from({ length: 32 }, () => authenticatedGet(connector, session, '/api/v1/dashboard'));
  await allEntered.promise;
  const overflow = await authenticatedGet(connector, session, '/api/v1/dashboard');
  assert.equal(overflow.status, 503);
  assert.equal(json(overflow).error.code, 'CONCURRENCY_LIMIT');
  assert.equal(json(overflow).error.retryable, true);
  release.resolve();
  const completed = await Promise.all(activeRequests);
  assert.equal(completed.every(response => response.status === 200), true);
});

test('graceful close drains an in-flight request, is idempotent, then refuses new connections', { timeout: 5_000 }, async t => {
  const entered = deferred();
  const release = deferred();
  const fixture = fakeBackend({
    async dashboard() {
      entered.resolve();
      await release.promise;
      return { closedSafely: true };
    }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  let closing;
  t.after(async () => { release.resolve(); await (closing ?? connector.close()); });
  const session = await exchangeBootstrap(connector);
  const pending = authenticatedGet(connector, session, '/api/v1/dashboard');
  await entered.promise;

  let closeSettled = false;
  closing = connector.close().then(() => { closeSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(closeSettled, false);
  } finally {
    release.resolve();
  }
  assert.equal((await pending).status, 200);
  await closing;
  assert.equal(closeSettled, true);
  await connector.close();
  await assert.rejects(
    rawRequest(connector.origin, { pathname: '/api/v1/health', timeoutMs: 250 }),
    error => ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)
  );
});

test('job requests reject unknown fields before reaching the backend', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const request = {
    kind: 'skillmap.job-request',
    schemaVersion: 1,
    expectedRevision: REVISION.revisionId,
    idempotencyKey: 'job-fixture-1',
    requestedBy: 'api',
    confirmation: 'none',
    parameters: { type: 'doctor' },
    unexpected: 'must-not-reach-backend'
  };
  const rejected = await postJson(connector, session, '/api/v1/jobs', request);
  assert.equal(rejected.status, 400);
  assert.equal(json(rejected).error.code, 'JOB_REQUEST_INVALID');
  assert.equal(fixture.calls.createJob.length, 0);
});

test('job create, list, and show projectors never echo a raw idempotency key', async t => {
  const rawKey = 'sk_live_CONNECTOR_JOB_KEY_SECRET_CANARY';
  const jobId = '22222222-2222-4222-8222-222222222222';
  const unsafeJob = {
    kind: 'skillmap.job', schemaVersion: 1, jobId, type: 'doctor', state: 'queued',
    expectedRevision: REVISION.revisionId, idempotencyKey: rawKey,
    requestDigest: `sha256:${'8'.repeat(64)}`, confirmation: 'none', createdAt: '2026-07-10T00:00:00.000Z'
  };
  const fixture = fakeBackend({
    async createJob() { return { job: unsafeJob, created: true, request: { idempotencyKey: rawKey } }; },
    async listJobs() { return { items: [unsafeJob], total: 1, idempotencyKey: rawKey }; },
    async showJob() { return { ...unsafeJob, path: '/home/operator/private-job.json' }; }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const created = await postJson(connector, session, '/api/v1/jobs', {
    kind: 'skillmap.job-request', schemaVersion: 1, expectedRevision: REVISION.revisionId,
    idempotencyKey: rawKey, requestedBy: 'api', confirmation: 'none', parameters: { type: 'doctor' }
  });
  const listed = await authenticatedGet(connector, session, '/api/v1/jobs');
  const shown = await authenticatedGet(connector, session, `/api/v1/jobs/${jobId}`);
  for (const response of [created, listed, shown]) {
    assert.equal(response.status === 200 || response.status === 202, true, response.body);
    assert.equal(response.body.includes(rawKey), false);
    assert.equal(response.body.includes('/home/operator'), false);
  }
  assert.equal(json(created).data.job.idempotencyKey, undefined);
  assert.equal(json(listed).data.items[0].idempotencyKey, undefined);
  assert.equal(json(shown).data.idempotencyKey, undefined);
});

test('policy and source review mutations are bounded and revision-bound before backend dispatch', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const policy = await postJson(connector, session, '/api/v1/policy/decisions', {
    displayName: 'frontend-design', skillId: SKILL_ID, actor: 'local-operator', reason: 'Compared every current full-tree revision.', expectedRevision: REVISION.revisionId
  });
  assert.equal(policy.status, 201);
  assert.equal(fixture.calls.decidePolicy.length, 1);
  const source = await postJson(connector, session, '/api/v1/sources/reviews', {
    skillId: SKILL_ID, decision: 'hold', reason: 'Holding the reviewed upstream state.', expectedRevision: REVISION.revisionId
  });
  assert.equal(source.status, 201);
  assert.equal(fixture.calls.reviewSource.length, 1);
  const invalid = await postJson(connector, session, '/api/v1/sources/reviews', {
    skillId: SKILL_ID, decision: 'overwrite', reason: 'unsafe', expectedRevision: REVISION.revisionId
  });
  assert.equal(invalid.status, 400);
  assert.equal(json(invalid).error.code, 'INPUT_INVALID');
  assert.equal(fixture.calls.reviewSource.length, 1);
});

test('policy proposals and accept-hold-reject decisions are strict, revision-bound, and redacted', async t => {
  const canary = '/home/operator/PRIVATE-POLICY-REVIEW-CANARY';
  const reviewId = `pr_${'a'.repeat(40)}`;
  const proposalId = '55555555-5555-4555-8555-555555555555';
  const proposalDigest = `sha256:${'5'.repeat(64)}`;
  const fixture = fakeBackend({
    async policyReviews() {
      return {
        items: [{ reviewId, queue: 'uncovered', action: 'set-skill-policy', state: 'needs-review', blocking: true, displayName: canary, skillIds: [SKILL_ID], contentRevisions: [`sha256:${'6'.repeat(64)}`], queueFingerprint: `sha256:${'7'.repeat(64)}`, rawKey: canary }],
        actionable: 1, blocking: 1, policyVersion: 2, revision: REVISION, path: canary
      };
    },
    async proposePolicy(input) {
      fixture.calls.proposePolicy.push(input);
      return {
        state: 'proposed', proposalId, proposalDigest, reviewId, queue: 'uncovered', action: 'set-skill-policy',
        skillId: input.skillId, tier: input.tier, expectedRevision: input.expectedRevision,
        expiresAt: '2026-07-10T01:00:00.000Z', decisionOptions: ['accept', 'hold', 'reject'], wouldPublish: false,
        actor: input.actor, reason: input.reason, path: canary
      };
    },
    async decidePolicyReview(input) {
      fixture.calls.decidePolicyReview.push(input);
      return {
        state: 'recorded', reviewId, queue: 'uncovered', action: 'set-skill-policy', decision: input.decision,
        skillId: SKILL_ID, tier: 'specialist', decisionDigest: `sha256:${'8'.repeat(64)}`,
        policyChanged: input.decision === 'accept', revision: REVISION, routingApprovalRequired: true,
        proposalDigest: input.proposalDigest, reason: canary, path: canary
      };
    }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);

  const reviews = await authenticatedGet(connector, session, '/api/v1/policy/reviews');
  assert.equal(reviews.status, 200);
  assert.equal(json(reviews).data.items[0].queue, 'uncovered');
  assert.equal(json(reviews).data.items[0].action, 'set-skill-policy');
  assert.equal(json(reviews).data.actionable, 1);
  assert.equal(reviews.body.includes(canary), false);
  assert.equal(json(reviews).data.items[0].rawKey, undefined);

  const proposed = await postJson(connector, session, '/api/v1/policy/proposals', {
    reviewId, action: 'set-skill-policy', skillId: SKILL_ID, tier: 'specialist', actor: 'local-operator',
    reason: 'Reviewed the exact qualified identity for a specialist policy entry.', expectedRevision: REVISION.revisionId
  });
  assert.equal(proposed.status, 201, proposed.body);
  assert.deepEqual(Object.keys(json(proposed).data).sort(), ['action', 'decisionOptions', 'expectedRevision', 'expiresAt', 'proposalDigest', 'proposalId', 'queue', 'reviewId', 'skillId', 'state', 'tier', 'wouldPublish']);
  assert.equal(proposed.body.includes(canary), false);
  assert.equal(fixture.calls.proposePolicy.length, 1);

  const decided = await postJson(connector, session, '/api/v1/policy/decisions', {
    proposalId, proposalDigest, decision: 'hold', expectedRevision: REVISION.revisionId, confirmation: 'review'
  });
  assert.equal(decided.status, 201, decided.body);
  assert.deepEqual(Object.keys(json(decided).data).sort(), ['action', 'decision', 'decisionDigest', 'policyChanged', 'queue', 'reviewId', 'revision', 'routingApprovalRequired', 'skillId', 'state', 'tier']);
  assert.equal(json(decided).data.decision, 'hold');
  assert.equal(json(decided).data.policyChanged, false);
  assert.equal(decided.body.includes(canary), false);
  assert.equal(fixture.calls.decidePolicyReview.length, 1);

  const invalid = await postJson(connector, session, '/api/v1/policy/proposals', {
    reviewId, action: 'set-skill-policy', skillId: SKILL_ID, tier: 'owner', actor: 'local-operator',
    reason: 'Reviewed the exact qualified identity for a specialist policy entry.', expectedRevision: REVISION.revisionId
  });
  assert.equal(invalid.status, 400);
  assert.equal(fixture.calls.proposePolicy.length, 1);
});

test('mutation responses project opaque receipts and never expose raw CLI objects, paths, or review reasons', async t => {
  const canary = 'PRIVATE-MUTATION-REASON-CANARY';
  const privatePath = '/home/operator/private-skill/SKILL.md';
  const fixture = fakeBackend({
    async approveRoot() {
      return { state: 'approved', approved: true, rootId: REVISION.workspaceId, revision: REVISION, roots: [privatePath], files: [privatePath], summary: canary };
    },
    async decidePolicy(input) {
      return { state: 'recorded', skillId: input.skillId, decisionDigest: `sha256:${'5'.repeat(64)}`, revision: REVISION, routingApprovalRequired: true, policy: { notes: canary }, policyArtifact: privatePath, reason: canary };
    },
    async reviewSource(input) {
      return { state: 'recorded', skillId: input.skillId, decision: input.decision, reviewDigest: `sha256:${'6'.repeat(64)}`, revision: REVISION, routingApprovalRequired: true, record: { localPath: privatePath, reason: canary } };
    }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const approved = await postJson(connector, session, '/api/v1/roots/approve', { validationId: 'validated-root-1', expectedRevision: REVISION.revisionId });
  const decided = await postJson(connector, session, '/api/v1/policy/decisions', { displayName: 'frontend-design', skillId: SKILL_ID, actor: 'local-operator', reason: canary, expectedRevision: REVISION.revisionId });
  const reviewed = await postJson(connector, session, '/api/v1/sources/reviews', { skillId: SKILL_ID, decision: 'hold', reason: canary, expectedRevision: REVISION.revisionId });
  for (const response of [approved, decided, reviewed]) {
    assert.equal(response.status, 201);
    assert.equal(response.body.includes(canary), false);
    assert.equal(response.body.includes(privatePath), false);
    assert.equal(response.body.includes('/home/operator'), false);
  }
  assert.deepEqual(Object.keys(json(approved).data).sort(), ['alreadyApproved', 'approved', 'revision', 'rootId', 'routingApprovalRequired', 'state']);
  assert.deepEqual(Object.keys(json(decided).data).sort(), ['decisionDigest', 'revision', 'routingApprovalRequired', 'skillId', 'state']);
  assert.deepEqual(Object.keys(json(reviewed).data).sort(), ['decision', 'reviewDigest', 'revision', 'routingApprovalRequired', 'skillId', 'state']);
});

test('state migration and recovery require literal confirmation before backend dispatch', async t => {
  const warningCanary = 'projection failed at /opt/private-skill/state.json and C:\\Users\\operator\\secret.json';
  const fixture = fakeBackend({
    async migrateState() { return { migrated: true, alreadyMigrated: false, revision: REVISION, warnings: [warningCanary] }; },
    async recoverState() { return { recovered: true, revision: REVISION, warnings: [warningCanary] }; }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const refused = await postJson(connector, session, '/api/v1/state/migrate', { confirm: false });
  assert.equal(refused.status, 400);
  assert.equal(json(refused).error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(fixture.calls.migrateState, 0);
  const migrated = await postJson(connector, session, '/api/v1/state/migrate', { confirm: true });
  assert.equal(migrated.status, 201);
  const recovered = await postJson(connector, session, '/api/v1/state/recover', { confirm: true });
  assert.equal(recovered.status, 201);
  for (const response of [migrated, recovered]) {
    assert.equal(response.body.includes('/opt/private-skill'), false);
    assert.equal(response.body.includes('C:\\Users'), false);
    assert.equal(json(response).data.warningCount, 1);
  }
});

test('partial legacy adoption requires literal confirmation before backend dispatch', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const refused = await postJson(connector, session, '/api/v1/state/adopt-partial-legacy', { confirm: false });
  assert.equal(refused.status, 400);
  assert.equal(json(refused).error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(fixture.calls.adoptPartialLegacy, 0);
  const adopted = await postJson(connector, session, '/api/v1/state/adopt-partial-legacy', { confirm: true });
  assert.equal(adopted.status, 201);
  assert.equal(json(adopted).data.state, 'adopted');
  assert.equal(fixture.calls.adoptPartialLegacy, 1);
});

test('eval suite import is bounded, revision-bound, and dispatched only as structured JSON', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const suite = { version: 2, evals: [{ prompt: 'Review responsive layout', expected: ['frontend-design'], avoid: [], primaryCaseType: 'implicit-natural', membership: 'train' }] };
  const imported = await postJson(connector, session, '/api/v1/evals/import', { suite, expectedRevision: REVISION.revisionId });
  assert.equal(imported.status, 201);
  assert.equal(fixture.calls.importEvalSuite.length, 1);
  assert.deepEqual(fixture.calls.importEvalSuite[0].suite, suite);
  const browserSizedV3 = {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    cases: Array.from({ length: 3 }, (_, index) => ({ caseId: `evalcase_large${index}`, prompt: `${index}${'x'.repeat(30 * 1024)}` }))
  };
  const largeImported = await postJson(connector, session, '/api/v1/evals/import', { suite: browserSizedV3, expectedRevision: REVISION.revisionId });
  assert.equal(largeImported.status, 201, 'credible v3 browser suites must not inherit the generic 64 KiB request ceiling');
  assert.equal(fixture.calls.importEvalSuite.length, 2);
  const overBoundV3 = {
    kind: 'skillmap.eval-suite',
    schemaVersion: 3,
    cases: Array.from({ length: 18 }, (_, index) => ({ caseId: `evalcase_huge${index}`, prompt: `${index}${'x'.repeat(30 * 1024)}` }))
  };
  const tooLarge = await postJson(connector, session, '/api/v1/evals/import', { suite: overBoundV3, expectedRevision: REVISION.revisionId });
  assert.equal(tooLarge.status, 413);
  assert.equal(json(tooLarge).error.code, 'REQUEST_TOO_LARGE');
  assert.equal(fixture.calls.importEvalSuite.length, 2);
  const unknown = await postJson(connector, session, '/api/v1/evals/import', { suite, expectedRevision: REVISION.revisionId, outputPath: '/tmp/escape' });
  assert.equal(unknown.status, 400);
  assert.equal(fixture.calls.importEvalSuite.length, 2);
});

test('integration verification exposes bounded receipts without installing hooks or echoing prompts', async t => {
  const fixture = fakeBackend();
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const manifest = await authenticatedGet(connector, session, '/api/v1/integrations/mcp');
  assert.equal(manifest.status, 200);
  assert.equal(json(manifest).data.readOnly, true);
  const prompt = 'PRIVATE-INTEGRATION-PROMPT-CANARY';
  const hook = await postJson(connector, session, '/api/v1/integrations/hook/verify', { prompt });
  assert.equal(hook.status, 200);
  assert.equal(json(hook).data.promptStored, false);
  assert.equal(json(hook).data.installPerformed, false);
  assert.equal(hook.body.includes(prompt), false);
  assert.deepEqual(fixture.calls.verifyHook, [prompt]);
});

test('activity can read the durable job list without revision-only caching', async t => {
  const fixture = fakeBackend({
    async listJobs() { return { items: [{ jobId: '22222222-2222-4222-8222-222222222222', type: 'doctor', state: 'running' }], total: 1 }; }
  });
  const connector = await startLocalConnector({ backend: fixture.backend });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const listed = await authenticatedGet(connector, session, '/api/v1/jobs', { 'if-none-match': ETAG });
  assert.equal(listed.status, 200);
  assert.equal(json(listed).data.total, 1);
  assert.equal(listed.headers.etag, undefined);
});

test('static asset serving rejects final and ancestor symlink escapes and oversized sparse files', {
  skip: process.platform === 'win32' ? 'File symlink creation is not reliably available without Windows developer mode or elevated privileges.' : false
}, async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'skillmap-static-security-'));
  const staticRoot = path.join(parent, 'public');
  const outside = path.join(parent, 'outside-secret.txt');
  const outsideDirectory = path.join(parent, 'outside-assets');
  mkdirSync(staticRoot, { recursive: true });
  mkdirSync(outsideDirectory, { recursive: true });
  writeFileSync(path.join(staticRoot, 'index.html'), '<h1>safe shell</h1>');
  writeFileSync(outside, 'STATIC-SYMLINK-ESCAPE-CANARY');
  writeFileSync(path.join(outsideDirectory, 'nested.txt'), 'STATIC-ANCESTOR-SYMLINK-CANARY');
  symlinkSync(outside, path.join(staticRoot, 'leak.txt'));
  symlinkSync(outsideDirectory, path.join(staticRoot, 'linked-assets'), 'dir');
  const oversizedPath = path.join(staticRoot, 'oversized.bin');
  writeFileSync(oversizedPath, '');
  truncateSync(oversizedPath, (2 * 1024 * 1024) + 1);

  const connector = await startLocalConnector({ backend: fakeBackend().backend, staticRoot });
  t.after(() => connector.close());
  const session = await exchangeBootstrap(connector);
  const escaped = await authenticatedGet(connector, session, '/leak.txt');
  assert.ok([400, 403, 404].includes(escaped.status));
  assert.equal(escaped.body.includes('STATIC-SYMLINK-ESCAPE-CANARY'), false);
  const ancestorEscape = await authenticatedGet(connector, session, '/linked-assets/nested.txt');
  assert.ok([400, 403, 404].includes(ancestorEscape.status));
  assert.equal(ancestorEscape.body.includes('STATIC-ANCESTOR-SYMLINK-CANARY'), false);
  const oversized = await authenticatedGet(connector, session, '/oversized.bin');
  assert.equal(oversized.status, 413);
  assert.equal(json(oversized).error.code, 'STATIC_ASSET_TOO_LARGE');
});

test('local app deep links fall back to HTML without shadowing app.js or app.css assets', async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'skillmap-static-routing-'));
  const staticRoot = path.join(parent, 'public');
  mkdirSync(staticRoot, { recursive: true });
  writeFileSync(path.join(staticRoot, 'index.html'), '<h1>local app shell</h1>');
  writeFileSync(path.join(staticRoot, 'app.js'), 'globalThis.__skillmapLoaded = true;');
  writeFileSync(path.join(staticRoot, 'app.css'), 'body { color: green; }');
  mkdirSync(path.join(staticRoot, 'empty-route'));
  const connector = await startLocalConnector({ backend: fakeBackend().backend, staticRoot });
  t.after(() => connector.close());

  const protectedApi = await rawRequest(connector.origin, { pathname: '/api/v1/dashboard' });
  assert.equal(protectedApi.status, 401);
  assert.equal(json(protectedApi).error.code, 'CAPABILITY_REQUIRED');

  const script = await rawRequest(connector.origin, { pathname: '/app.js' });
  assert.equal(script.status, 200);
  assert.match(String(script.headers['content-type']), /javascript/);
  assert.equal(script.headers['cache-control'], 'no-cache, must-revalidate');
  assert.match(script.body, /__skillmapLoaded/);
  const stylesheet = await rawRequest(connector.origin, { pathname: '/app.css' });
  assert.equal(stylesheet.status, 200);
  assert.match(String(stylesheet.headers['content-type']), /text\/css/);
  assert.equal(stylesheet.headers['cache-control'], 'no-cache, must-revalidate');
  const deepLink = await rawRequest(connector.origin, { pathname: `/app/${REVISION.workspaceId}/route` });
  assert.equal(deepLink.status, 200);
  assert.match(String(deepLink.headers['content-type']), /text\/html/);
  assert.match(deepLink.body, /local app shell/);
  const emptyDirectoryFallback = await rawRequest(connector.origin, { pathname: '/empty-route' });
  assert.equal(emptyDirectoryFallback.status, 200);
  assert.match(String(emptyDirectoryFallback.headers['content-type']), /text\/html/);
  assert.match(emptyDirectoryFallback.body, /local app shell/);
});

function fakeBackend(overrides = {}) {
  const calls = {
    dashboard: 0,
    listSkills: [],
    previewRoute: [],
    showRoute: [],
    createJob: [],
    decidePolicy: [],
    proposePolicy: [],
    decidePolicyReview: [],
    reviewSource: [],
    migrateState: 0,
    adoptPartialLegacy: 0,
    recoverState: 0,
    importEvalSuite: [],
    verifyHook: [],
    validateWorkspace: [],
    selectWorkspace: [],
    cancelJob: [],
    stateRevisions: [],
    rollbackState: [],
    previewPolicy: [],
    adoptSource: [],
    sourceDiff: []
  };
  const backend = {
    async revisionContext() {
      return {
        servingRevision: REVISION,
        currentRevision: REVISION,
        compatibility: 'compatible',
        etag: ETAG
      };
    },
    async health() { return { status: 'ok' }; },
    async bootstrap() { return { initialized: true }; },
    async workspace() { return { workspaceId: REVISION.workspaceId }; },
    async dashboard() { calls.dashboard += 1; return { ready: true }; },
    async listSkills(input) { calls.listSkills.push(input); return { items: [], nextCursor: null }; },
    async showSkill(skillId) { return { skillId }; },
    async previewRoute(input) { calls.previewRoute.push(input); return { result: routeResult(), currentRevision: REVISION }; },
    async showRoute(routeId) { calls.showRoute.push(routeId); return createRouteEvent(routeResult(), REVISION, 'api'); },
    async recordFeedback(routeId, input) { return { routeId, ...input, promptStored: false, commentStored: false }; },
    async listRoutes() { return { items: [], nextCursor: null }; },
    async policyReviews() { return { items: [] }; },
    async previewPolicy(input) {
      calls.previewPolicy.push(input);
      return {
        state: 'previewed', revision: REVISION,
        currentPresent: true,
        currentSummary: { skills: 1, routeEligible: 1, edges: 0 },
        projectedSummary: { skills: 1, routeEligible: 0, edges: 1 },
        delta: { skills: 0, routeEligible: -1, edges: 1 },
        warnings: ['POLICY_DUPLICATE_NAMES', 'unsafe warning with spaces'],
        routingApprovalEligible: false, wouldPublish: false,
        policyFile: '/home/operator/private-policy.yml', writes: ['/private/effective.json']
      };
    },
    async decidePolicy(input) { calls.decidePolicy.push(input); return input; },
    async proposePolicy(input) { calls.proposePolicy.push(input); return input; },
    async decidePolicyReview(input) { calls.decidePolicyReview.push(input); return input; },
    async sources() { return { items: [], untrackedItems: [], untrackedTotal: 0, untrackedTruncated: false }; },
    async adoptSource(input) {
      calls.adoptSource.push(input);
      return {
        state: 'adopted', skillId: input.skillId, sourceType: input.sourceType,
        adoptionDigest: `sha256:${'9'.repeat(64)}`, revision: REVISION,
        routingApprovalRequired: true, nextAction: 'sources-check',
        reason: input.reason, path: '/home/operator/private-source.json'
      };
    },
    async sourceDiff(input, runtime) {
      calls.sourceDiff.push({ input, signal: runtime?.signal });
      return {
        skillId: input.skillId, state: 'external-risky-update', risk: 'high', upstreamCommit: 'a'.repeat(40),
        diff: {
          additions: 70, deletions: 70, changedLines: 70, truncated: false,
          lines: Array.from({ length: 130 }, (_unused, index) => ({ kind: index % 2 ? 'local' : 'upstream', line: index + 1, text: `${'x'.repeat(600)}-PRIVATE-DIFF-${index}` }))
        },
        promptStored: false, persisted: false, revision: REVISION,
        path: '/home/operator/private-skill.md', token: 'private-token'
      };
    },
    async reviewSource(input) { calls.reviewSource.push(input); return input; },
    async evals() { return { items: [] }; },
    async importEvalSuite(input) {
      calls.importEvalSuite.push(input);
      return { imported: true, cases: input.suite.cases?.length ?? input.suite.evals.length };
    },
    async mcpManifest() { return { readOnly: true, tools: [], limits: { requestBytes: 65536 } }; },
    async verifyHook(input) { calls.verifyHook.push(input.prompt); return { promptStored: false, installPerformed: false, hookText: 'SkillMap: prefer frontend-design.', readiness: { allowed: false } }; },
    async createJob(request) { calls.createJob.push(request); return { jobId: '22222222-2222-4222-8222-222222222222' }; },
    async listJobs() { return { items: [], total: 0 }; },
    async showJob(jobId) { return { jobId, state: 'succeeded' }; },
    async cancelJob(jobId, input) {
      calls.cancelJob.push({ jobId, input });
      return {
        state: 'cancelled', jobId, jobState: 'cancelled',
        cancellationDigest: `sha256:${'6'.repeat(64)}`,
        idempotent: false, publicationPrevented: true,
        idempotencyKey: input.idempotencyKey, path: '/home/operator/private-job.json'
      };
    },
    async validateRoot(input) { return { validationId: 'root-validation-1', ...input }; },
    async approveRoot(input) { return { rootId: 'root-fixture', ...input }; },
    async validateWorkspace(input) { calls.validateWorkspace.push(input); return { state: 'validated', validationId: ROUTE_ID, mode: input.mode, label: 'Local workspace', expiresInSeconds: 300, confirmationRequired: true }; },
    async selectWorkspace(input) { calls.selectWorkspace.push(input); return { state: 'selected', selectionId: ROUTE_ID, mode: 'select-existing', created: false, alreadySelected: false, label: 'Local workspace', workspaceId: REVISION.workspaceId, bootstrapState: 'ready' }; },
    async migrateState(input) { calls.migrateState += 1; return { migrated: true, ...input }; },
    async adoptPartialLegacy() { calls.adoptPartialLegacy += 1; return { state: 'adopted', adopted: true, rootCount: 1, routingApprovalRequired: true, nextAction: 'scan' }; },
    async recoverState(input) { calls.recoverState += 1; return { recovered: true, ...input }; },
    async stateRevisions(input) {
      calls.stateRevisions.push(input);
      return {
        items: [{
          revision: REVISION,
          sequence: 1,
          parentRevisionId: null,
          createdAt: '2026-07-10T00:00:00.000Z',
          mutation: {
            kind: 'legacy-migration', actor: 'local-api', reasonDigest: `sha256:${'7'.repeat(64)}`,
            sourceRevisionId: null, targetRevisionId: null, reason: 'private operator reason'
          },
          isCurrent: true, isRoutingServing: true, routingApprovalRecorded: true, artifactCount: 4,
          path: '/home/operator/private-revision.json'
        }],
        limit: input.limit,
        hasMore: false,
        nextCursor: null,
        currentRevision: REVISION,
        routingRevisionId: REVISION.revisionId,
        reason: 'private history reason'
      };
    },
    async rollbackState(input) {
      calls.rollbackState.push(input);
      return {
        state: 'rolled-back', revision: REVISION, targetRevisionId: input.targetRevision,
        routingApproved: true, routingApprovalRequired: false, warningCount: 1,
        actor: input.actor, reason: input.reason, path: '/home/operator/private-rollback.json'
      };
    },
    ...overrides
  };
  return { backend, calls };
}

function routeResult() {
  return {
    kind: 'skillmap.route-result',
    schemaVersion: 2,
    routeId: ROUTE_ID,
    createdAt: '2026-07-10T00:00:00.000Z',
    promptStored: false,
    decision: {
      kind: 'skillmap.route-decision',
      schemaVersion: 2,
      revision: REVISION,
      servingMode: 'current',
      recommendations: [{ skillId: SKILL_ID, displayName: 'frontend-design', score: 12, tier: 'specialist', reasonCodes: ['DESCRIPTION_MATCH'] }],
      exclusions: [],
      hookText: 'SkillMap: prefer frontend-design.',
      warningState: 'none',
      warningCodes: []
    },
    decisionDigest: `sha256:${'3'.repeat(64)}`,
    latencyMs: 2
  };
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function exchangeBootstrap(connector) {
  const bootstrap = new URL(connector.bootstrapUrl);
  const redirect = await rawRequest(connector.origin, { pathname: `${bootstrap.pathname}${bootstrap.search}` });
  assert.equal(redirect.status, 303);
  assert.deepEqual(responseSetCookies(redirect), []);
  const redirectTarget = new URL(redirect.headers.location, connector.origin);
  assert.equal(redirectTarget.origin, connector.origin);
  assert.equal(redirectTarget.search, '');
  const fragment = new URLSearchParams(redirectTarget.hash.slice(1));
  assert.deepEqual([...fragment.keys()].sort(), ['skillmap-capability', 'skillmap-csrf']);
  const capability = fragment.get('skillmap-capability');
  const csrf = fragment.get('skillmap-csrf');
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
  assert.match(csrf, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(capability, csrf);
  const bootstrapToken = bootstrap.searchParams.get('bootstrap');
  assert.match(bootstrapToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(redirect.body.includes(bootstrapToken), false);
  assert.equal(redirectTarget.search.includes(bootstrapToken), false);
  const initialized = await rawRequest(connector.origin, {
    pathname: '/api/v1/bootstrap',
    headers: { 'x-skillmap-capability': capability }
  });
  assert.equal(initialized.status, 200);
  assert.equal(json(initialized).data.csrfToken, undefined);
  assert.equal(initialized.body.includes(capability), false);
  assert.equal(initialized.body.includes(csrf), false);
  return {
    redirect,
    bootstrapToken,
    capability,
    csrf,
    csrfToken: csrf,
    initializedResponse: initialized
  };
}

function authenticatedGet(connector, session, pathname, headers = {}) {
  return rawRequest(connector.origin, {
    pathname,
    headers: { 'x-skillmap-capability': session.capability, ...headers }
  });
}

function postJson(connector, session, pathname, value, options = {}) {
  const body = JSON.stringify(value);
  return rawRequest(connector.origin, {
    method: 'POST',
    pathname,
    headers: mutationHeaders(connector, session, {
      'content-type': 'application/json',
      ...(options.origin === null ? { origin: undefined } : options.origin ? { origin: options.origin } : {}),
      ...(options.fetchSite ? { 'sec-fetch-site': options.fetchSite } : {}),
      ...(options.csrf === null ? { 'x-skillmap-csrf': undefined } : options.csrf ? { 'x-skillmap-csrf': options.csrf } : {})
    }),
    body
  });
}

function mutationHeaders(connector, session, extra = {}) {
  const headers = {
    origin: connector.origin,
    'sec-fetch-site': 'same-origin',
    'x-skillmap-capability': session.capability,
    'x-skillmap-csrf': session.csrfToken,
    ...extra
  };
  for (const [key, value] of Object.entries(headers)) if (value === undefined) delete headers[key];
  return headers;
}

function responseSetCookies(response) {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? header : [header].filter(Boolean);
}

function rawRequest(origin, {
  method = 'GET',
  pathname = '/',
  headers = {},
  body,
  connectHost,
  timeoutMs = 5_000
} = {}) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = nodeRequest({
      hostname: connectHost ?? target.hostname,
      port: Number(target.port),
      method,
      path: pathname,
      headers: { connection: 'close', ...headers }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error('client request timed out');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(body);
  });
}

function json(response) {
  return JSON.parse(response.body);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
