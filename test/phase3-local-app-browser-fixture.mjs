import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(repo, 'assets', 'local-app', 'v1');
const requireFromWeb = createRequire(path.join(repo, 'apps', 'web', 'package.json'));
const { chromium } = requireFromWeb('playwright');
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const ROOT_ID = '00000000-0000-4000-8000-000000000005';
const REVISION = {
  workspaceId: WORKSPACE_ID,
  revisionId: 'r00000000000000000001-00000000-0000-4000-8000-000000000002',
  workspaceRevision: `sha256:${'a'.repeat(64)}`,
  effectiveDigest: `sha256:${'b'.repeat(64)}`,
  effectiveRevisionDigest: `sha256:${'c'.repeat(64)}`
};
const ALPHA = `sk_${'A'.repeat(43)}`;
const ALPHA_VARIANT = `sk_${'B'.repeat(43)}`;
const BETA = `sk_${'C'.repeat(43)}`;
const OLDER_REVISION = { ...REVISION, revisionId: 'r00000000000000000000-00000000-0000-4000-8000-000000000003', workspaceRevision: `sha256:${'d'.repeat(64)}` };
const ROLLBACK_REVISION = { ...REVISION, revisionId: 'r00000000000000000002-00000000-0000-4000-8000-000000000004', workspaceRevision: `sha256:${'e'.repeat(64)}` };
const JOB_ONE = '11111111-1111-4111-8111-111111111111';
const JOB_TWO = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = '33333333-3333-4333-8333-333333333333';
const FIXTURE_CAPABILITY = 'A'.repeat(43);
const FIXTURE_CSRF = 'B'.repeat(43);
const API_REQUEST_ID = '00000000-0000-4000-8000-000000000009';
const SKILLS = [
  { skillId: ALPHA, displayName: 'alpha-review', contentRevision: `sha256:${'1'.repeat(64)}`, tier: 'specialist', routeEligible: true, qualifiedExplicitAllowed: true, variantState: 'canonical', hasScripts: false, sourceScope: 'project', description: 'Review alpha systems.' },
  { skillId: ALPHA_VARIANT, displayName: 'alpha-review', contentRevision: `sha256:${'2'.repeat(64)}`, tier: 'explicit-only', routeEligible: false, qualifiedExplicitAllowed: true, variantState: 'shadowed-duplicate', hasScripts: true, sourceScope: 'project', description: 'A second qualified alpha variant.' },
  { skillId: BETA, displayName: 'beta-build', contentRevision: `sha256:${'3'.repeat(64)}`, tier: 'active-default', routeEligible: true, qualifiedExplicitAllowed: true, variantState: 'canonical', hasScripts: false, sourceScope: 'project', description: 'Build beta systems.' }
];
const ROUTE_EVENT = {
  kind: 'skillmap.route-event', schemaVersion: 1,
  eventId: '44444444-4444-4444-8444-444444444444', routeId: TRACE_ID,
  createdAt: '2026-07-10T12:00:00.000Z', revision: REVISION, currentRevision: REVISION,
  surface: 'api', outcome: 'recommended', selectedSkillIds: [ALPHA],
  reasonCodes: ['description-match'], warningCodes: [], latencyBucket: 'lt-50ms',
  decisionDigest: `sha256:${'d'.repeat(64)}`, promptStored: false,
  payloadDigest: `sha256:${'e'.repeat(64)}`
};

test('modular local app renders URL-owned skill workflows at desktop and 320px', async t => {
  const server = createServer((request, response) => { void handleRequest(request, response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`${origin}/app/${WORKSPACE_ID}/overview#skillmap-capability=${FIXTURE_CAPABILITY}&skillmap-csrf=${FIXTURE_CSRF}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '', 'connector credentials remained in the visible URL');
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('skillmap.connector-auth.v1'))), {
    capability: FIXTURE_CAPABILITY,
    csrf: FIXTURE_CSRF
  });
  assert.equal((await page.locator('body').textContent()).includes(FIXTURE_CAPABILITY), false, 'capability leaked into rendered text');
  await capture(page, 'overview-desktop.png');
  assert.equal(await page.getByRole('button', { name: 'Switch workspace', exact: true }).textContent(), 'Fixture workspace');
  await page.getByRole('link', { name: 'Skills', exact: true }).click();
  await page.getByRole('heading', { name: 'Skills', exact: true }).waitFor();
  assert.equal(await page.locator('#skills-body tr').count(), 3);

  await page.getByLabel('Search skills', { exact: true }).fill('alpha');
  await page.locator('#skill-eligibility').selectOption('eligible');
  await page.getByLabel('Sort', { exact: true }).selectOption('revision');
  assert.equal(new URL(page.url()).searchParams.get('q'), 'alpha');
  assert.equal(new URL(page.url()).searchParams.get('eligibility'), 'eligible');
  assert.equal(await page.locator('#skills-body tr').count(), 1);
  await page.getByRole('button', { name: 'Save filters', exact: true }).click();
  const saved = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith('skillmap:saved-skill-view:'))?.[1]);
  assert.ok(saved);
  assert.equal(saved.includes('alpha'), false, 'search text entered persistent browser storage');

  await page.getByRole('button', { name: 'alpha-review', exact: true }).click();
  await page.getByText('Qualified ID', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Source context', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Policy context', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Recent route history', exact: true }).waitFor();
  assert.match(await page.locator('#skill-detail').textContent(), /GitHub/);
  assert.match(await page.locator('#skill-detail').textContent(), /External Clean/);
  assert.match(await page.locator('#skill-detail').textContent(), /Implicit And Explicit/);
  assert.equal(await page.locator('#skill-detail').getByRole('link', { name: 'Open redacted trace', exact: true }).getAttribute('href'), `/app/${WORKSPACE_ID}/traces/${TRACE_ID}`);
  assert.equal((await page.locator('#skill-detail').textContent()).includes('prompt'), true, 'skill detail did not explain its prompt-free boundary');
  assert.equal((await page.locator('#skill-detail').textContent()).includes('/fixture/private'), false, 'skill detail rendered a private source location');
  assert.match(page.url(), /\/skills\?/);
  await page.getByRole('button', { name: 'Close detail', exact: true }).click();
  const permalink = page.getByRole('link', { name: 'Open permanent detail for alpha-review', exact: true }).first();
  await permalink.click();
  await page.getByText('Qualified ID', { exact: true }).waitFor();
  assert.match(page.url(), new RegExp(`/skills/${ALPHA}(?:\\?|$)`));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Qualified ID', { exact: true }).waitFor();

  await page.setViewportSize({ width: 320, height: 760 });
  assert.equal(await page.locator('.skill-cards').isVisible(), true);
  assert.equal(await page.locator('.skill-table-wrap').isVisible(), false);
  await assertContained(page, 'skills');
  await capture(page, 'skills-mobile.png');

  await page.goto(`${origin}/app/${WORKSPACE_ID}/policies`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Policies', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Compare redacted metadata', exact: true }).click();
  await page.getByRole('heading', { name: 'Compare alpha-review', exact: true }).waitFor();
  const proposalRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/policy/proposals' && request.method() === 'POST');
  await page.getByLabel('Review rationale').fill('Compared both exact qualified variants and held the decision for another operator pass.');
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click();
  assert.deepEqual((await proposalRequest).postDataJSON(), {
    reviewId: `pr_${'a'.repeat(40)}`, action: 'select-canonical', actor: 'local-operator',
    reason: 'Compared both exact qualified variants and held the decision for another operator pass.', expectedRevision: REVISION.revisionId,
    skillId: ALPHA
  });
  await page.getByRole('heading', { name: 'Proposal ready for decision', exact: true }).waitFor();
  const decisionRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/policy/decisions' && request.method() === 'POST');
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  assert.deepEqual((await decisionRequest).postDataJSON(), {
    proposalId: '55555555-5555-4555-8555-555555555555', proposalDigest: `sha256:${'b'.repeat(64)}`,
    decision: 'hold', expectedRevision: REVISION.revisionId, confirmation: 'review'
  });
  await assertContained(page, 'policies');
  for (const [route, title] of [['evals', 'Evals'], ['sources', 'Sources'], ['trust', 'Trust & privacy'], ['integrations', 'Integrations'], ['activity', 'Activity'], ['settings', 'Settings']]) {
    await page.goto(`${origin}/app/${WORKSPACE_ID}/${route}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await assertContained(page, route);
  }
  await exerciseTracePermalink(page, origin);
  for (const [route, title] of [['workspaces', 'Workspaces'], ['onboarding', 'Set up this local workspace']]) {
    await page.goto(`${origin}/app/${route}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await assertContained(page, route);
  }
  await exerciseCancellationDialog(page, origin);
  await exerciseRollback(page, origin);
  assert.deepEqual(errors, []);
});

test('version mismatch globally blocks every canonical route before cached views or mutation controls render', async t => {
  const server = createServer((request, response) => { void handleRequest(request, response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const targets = [
    '/app/onboarding', '/app/workspaces',
    ...['overview', 'route', 'skills', 'policies', 'evals', 'sources', 'trust', 'integrations', 'activity', 'settings'].map(route => `/app/${WORKSPACE_ID}/${route}`),
    `/app/${WORKSPACE_ID}/traces/${TRACE_ID}`
  ];
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const requests = [];
    page.on('request', request => { if (request.url().includes('/api/v1/')) requests.push(new URL(request.url()).pathname); });
    await page.addInitScript(() => {
      sessionStorage.setItem('skillmap.connector-auth.v1', JSON.stringify({ capability: 'A'.repeat(43), csrf: 'B'.repeat(43) }));
      sessionStorage.setItem('skillmap:workspace', JSON.stringify({ workspaceId: '00000000-0000-4000-8000-000000000001', name: 'Cached workspace' }));
      sessionStorage.setItem('skillmap:dashboard', JSON.stringify({ counts: { skills: 999 }, revision: null }));
    });
    await page.route('**/api/v1/bootstrap', route => route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(apiSuccess({
        initialized: true, state: 'ready', routingReady: true, productReady: true, nextAction: 'route', readiness: { verdict: 'ok', phase: 'ready' },
        connectorCompatibility: { apiVersion: 'v1', localAppAssetVersion: 'v2', productVersion: '0.1.0' }
      }))
    }));
    await page.goto(`${origin}${target}`, { waitUntil: 'networkidle' });
    const blocked = page.locator('#compatibility-blocked[data-error-code="LOCAL_APP_VERSION_MISMATCH"]');
    await blocked.waitFor();
    await page.getByRole('heading', { name: 'Local app update required', exact: true }).waitFor();
    assert.equal(await page.locator('#connection-label').textContent(), 'Update required', `${target} did not enter the global compatibility state`);
    assert.equal(await blocked.getByRole('button').count(), 0, `${target} exposed an unusable retry control after authorization was cleared`);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('skillmap.connector-auth.v1')), null, `${target} retained connector authorization`);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('skillmap:workspace')), null, `${target} retained an incompatible workspace snapshot`);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('skillmap:dashboard')), null, `${target} retained an incompatible dashboard snapshot`);
    assert.equal(requests.includes('/api/v1/workspace'), false, `${target} fetched workspace data after the global gate`);
    assert.equal(requests.includes('/api/v1/dashboard'), false, `${target} fetched dashboard data after the global gate`);
    assert.equal((await page.locator('body').textContent()).includes('999'), false, `${target} leaked cached dashboard data through the mismatch block`);
    assert.equal(await page.locator('.job-action, form[action], .policy-decision, .source-review').count(), 0, `${target} exposed mutation controls`);
    await page.close();
  }
});

test('navigating away aborts an in-flight Route Lab request without an unhandled rejection', async t => {
  const server = createServer((request, response) => { void handleRequest(request, response, { delayRoute: true }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${origin}/app/${WORKSPACE_ID}/route#skillmap-capability=${FIXTURE_CAPABILITY}&skillmap-csrf=${FIXTURE_CSRF}`, { waitUntil: 'networkidle' });
  await page.getByLabel('What are you trying to do?').fill('PRIVATE-DELAYED-ROUTE-PROMPT');
  const pending = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/routes/preview');
  await page.getByRole('button', { name: 'Run route', exact: true }).click();
  await pending;
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await page.waitForTimeout(250);
  assert.deepEqual(errors, []);
});

test('incompatible workspace state reaches manual repair instead of the version blocker', async t => {
  const server = createServer((request, response) => { void handleRequest(request, response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.addInitScript(() => {
    sessionStorage.setItem('skillmap.connector-auth.v1', JSON.stringify({ capability: 'A'.repeat(43), csrf: 'B'.repeat(43) }));
  });
  await page.route('**/api/v1/bootstrap', route => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(apiSuccess({
      initialized: true, state: 'manual-repair-required', routingReady: false, productReady: false, nextAction: 'state-status',
      errorCode: 'STATE_MANIFEST_INVALID', guidance: 'Run the bounded local state diagnostic.',
      connectorCompatibility: { apiVersion: 'v1', localAppAssetVersion: 'v1', productVersion: '0.1.0' }
    }, { compatibility: 'incompatible', servingRevision: null, currentRevision: null }))
  }));
  await page.goto(`${origin}/app/onboarding`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Set up this local workspace', exact: true }).waitFor();
  await page.getByText('Manual state repair required', { exact: true }).waitFor();
  assert.equal(await page.locator('#compatibility-blocked').count(), 0);
  assert.equal(await page.locator('#connection-label').textContent(), 'Attention');
});

test('malformed and clean browser contexts fail closed before an API request', async t => {
  const server = createServer((request, response) => { void handleRequest(request, response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const malformed = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const malformedApiRequests = [];
  malformed.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) malformedApiRequests.push(request.url()); });
  await malformed.addInitScript(() => {
    sessionStorage.setItem('skillmap.connector-auth.v1', JSON.stringify({ capability: 'A'.repeat(43), csrf: 'B'.repeat(43) }));
  });
  await malformed.goto(`${origin}/app#skillmap-capability=short&skillmap-csrf=${FIXTURE_CSRF}`, { waitUntil: 'networkidle' });
  await malformed.getByText('Connector authorization is unavailable', { exact: true }).waitFor();
  assert.equal(new URL(malformed.url()).hash, '');
  assert.equal(await malformed.evaluate(() => sessionStorage.getItem('skillmap.connector-auth.v1')), null);
  assert.deepEqual(malformedApiRequests, []);

  const clean = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const cleanApiRequests = [];
  clean.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) cleanApiRequests.push(request.url()); });
  await clean.goto(`${origin}/app`, { waitUntil: 'networkidle' });
  await clean.getByText('Connector authorization is unavailable', { exact: true }).waitFor();
  assert.deepEqual(cleanApiRequests, []);
});

async function assertContained(page, label) {
  const containment = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(containment.document <= containment.viewport, `${label}: ${JSON.stringify(containment)}`);
  assert.ok(containment.body <= containment.viewport, `${label}: ${JSON.stringify(containment)}`);
}

async function exerciseCancellationDialog(page, origin) {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(`${origin}/app/${WORKSPACE_ID}/activity`, { waitUntil: 'networkidle' });
  const cancelRequests = [];
  page.on('request', request => { if (/\/api\/v1\/jobs\/[0-9a-f-]+\/cancel$/i.test(new URL(request.url()).pathname)) cancelRequests.push(request); });
  const first = page.locator(`.cancel-job[data-job-id="${JOB_ONE}"]`);
  await first.click();
  await page.getByRole('button', { name: 'Request cancellation', exact: true }).click();
  await page.getByText(`Job ${JOB_ONE.slice(0, 8)} cancelled before publication.`, { exact: true }).waitFor();
  assert.equal(cancelRequests.length, 1);
  assert.deepEqual(Object.keys(cancelRequests[0].postDataJSON()), ['idempotencyKey']);
  assert.match(cancelRequests[0].postDataJSON().idempotencyKey, new RegExp(`^ui-cancel:${JOB_ONE}:`));

  const second = page.locator(`.cancel-job[data-job-id="${JOB_TWO}"]`);
  await second.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(cancelRequests.length, 1, 'dismissed second dialog replayed the prior confirm returnValue');
  assert.equal(await second.evaluate(element => document.activeElement === element), true, 'dialog dismissal did not restore focus to its opener');
}

async function exerciseTracePermalink(page, origin) {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${origin}/app/${WORKSPACE_ID}/activity`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Open redacted trace', exact: true }).click();
  await page.getByRole('heading', { name: 'Redacted trace', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/app/${WORKSPACE_ID}/traces/${TRACE_ID}`);
  await page.getByText(TRACE_ID, { exact: true }).waitFor();
  await page.getByText('Prompt stored', { exact: true }).waitFor();
  assert.equal((await page.locator('#view-root').textContent()).includes('private fixture prompt'), false);
  await capture(page, 'trace-detail-desktop.png');
  await page.setViewportSize({ width: 320, height: 760 });
  await assertContained(page, 'trace detail');
  await capture(page, 'trace-detail-mobile.png');

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Redacted trace', exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'Activity', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Route events', exact: true }).waitFor();
  await page.goForward();
  await page.getByRole('heading', { name: 'Redacted trace', exact: true }).waitFor();
}

async function exerciseRollback(page, origin) {
  await page.goto(`${origin}/app/${WORKSPACE_ID}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Revision history', exact: true }).waitFor();
  const form = page.locator('#rollback-form');
  await form.getByRole('radio').first().check();
  await form.getByLabel(/I understand the new rollback revision is unapproved/).check();
  const requestPromise = page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/state/rollback' && request.method() === 'POST');
  await form.getByRole('button', { name: 'Rollback to selected revision', exact: true }).click();
  const request = await requestPromise;
  assert.deepEqual(request.postDataJSON(), {
    targetRevision: OLDER_REVISION.revisionId,
    expectedRevision: REVISION.revisionId,
    actor: 'local-app',
    reason: 'operator-rollback',
    confirm: true
  });
  await page.getByText(/Rollback published as r0000000000000/).waitFor();
}

async function capture(page, name) {
  const directory = process.env.SKILLMAP_PHASE3_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
}

async function handleRequest(request, response, options = {}) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/v1/')) {
    if (options.delayRoute && url.pathname === '/api/v1/routes/preview') {
      setTimeout(() => {
        if (!response.destroyed) apiResponse(url.pathname, request.method || 'GET', response);
      }, 150);
      return;
    }
    return apiResponse(url.pathname, request.method || 'GET', response);
  }
  const relative = url.pathname === '/' || url.pathname === '/app' || url.pathname.startsWith('/app/') ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const target = path.resolve(assets, relative);
  if (!target.startsWith(`${assets}${path.sep}`)) return end(response, 404, 'text/plain', 'not found');
  try {
    const body = await readFile(target);
    const type = target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.js') ? 'text/javascript; charset=utf-8' : target.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    end(response, 200, type, body);
  } catch { end(response, 404, 'text/plain', 'not found'); }
}

function apiResponse(pathname, method, response) {
  const dashboard = {
    workspace: { workspaceId: WORKSPACE_ID, name: 'Fixture workspace' }, revision: REVISION, currentRevision: REVISION, servingMode: 'current', routingReady: true,
    filesystemDirty: false, filesystemFreshness: {
      state: 'clean', filesystemDirty: false, reasonCode: null, observedAt: null, lastVerifiedAt: new Date().toISOString(),
      observedDigest: `sha256:${'4'.repeat(64)}`, expectedDigest: `sha256:${'4'.repeat(64)}`, rootIds: [], suggestedJobType: null
    },
    readiness: { verdict: 'ok', phase: 'ready', warnings: [], nextActions: [] }, counts: { skills: 3, routeEligible: 2, sourceTracked: 2, evalCases: 12 },
    evidence: {
      inventorySkills: 3, observedRoutes: 2, evalConfidence: 'alpha', releaseEvidenceEligible: false, tokenMetricsSource: 'not-measured',
      doctorPresent: true, doctorPackPresent: true, curationPresent: true, curationStale: false
    }
  };
  let data;
  if (pathname === '/api/v1/bootstrap') data = { initialized: true, state: 'ready', routingReady: true, productReady: true, nextAction: 'route', readiness: { verdict: 'ok', phase: 'ready' }, revision: REVISION, currentRevision: REVISION, connectorCompatibility: { apiVersion: 'v1', localAppAssetVersion: 'v1', productVersion: '0.1.0' } };
  else if (pathname === '/api/v1/workspace') data = { workspaceId: WORKSPACE_ID, name: 'Fixture workspace', readiness: dashboard.readiness, revision: REVISION, currentRevision: REVISION, servingMode: 'current', routingReady: true, filesystemDirty: false, filesystemFreshness: dashboard.filesystemFreshness, roots: [{ rootId: ROOT_ID, label: 'skills', approvedAt: new Date().toISOString() }] };
  else if (pathname === '/api/v1/dashboard') data = dashboard;
  else if (pathname === '/api/v1/skills') data = { items: SKILLS, nextCursor: null, hasMore: false, limit: 100 };
  else if (pathname.startsWith('/api/v1/skills/')) {
    const skill = SKILLS.find(item => item.skillId === pathname.split('/').at(-1));
    const selected = skill.skillId === ALPHA;
    data = {
      ...skill,
      sourceScope: undefined,
      family: 'fixture',
      qualifiedExplicitAllowed: true,
      scriptCount: skill.hasScripts ? 1 : 0,
      referenceCount: 2,
      assetCount: 0,
      frontmatterValid: true,
      sourceContext: selected
        ? { tracked: true, sourceType: 'github', state: 'external-clean', checked: true, reviewable: false, risk: 'low', upstreamCommit: 'a'.repeat(40), revisionBound: true }
        : { tracked: false, sourceType: null, state: 'not-tracked', checked: false, reviewable: false, risk: null, upstreamCommit: null, revisionBound: false },
      policyContext: {
        version: 2,
        configured: true,
        canonical: selected,
        canonicalSkillId: ALPHA,
        tier: skill.tier,
        variantState: skill.variantState,
        routeMode: skill.routeEligible ? 'implicit-and-explicit' : 'qualified-explicit-only'
      },
      routeHistory: {
        items: selected ? [{
          routeId: TRACE_ID,
          createdAt: ROUTE_EVENT.createdAt,
          surface: ROUTE_EVENT.surface,
          outcome: ROUTE_EVENT.outcome,
          latencyBucket: ROUTE_EVENT.latencyBucket,
          reasonCodes: ROUTE_EVENT.reasonCodes,
          warningCodes: ROUTE_EVENT.warningCodes,
          revisionId: REVISION.revisionId,
          promptStored: false
        }] : [],
        limit: 10,
        scanLimit: 50,
        scannedEvents: 1,
        scanTruncated: false,
        matchesTruncated: false
      },
      revision: REVISION
    };
  } else if (pathname === '/api/v1/policy/reviews') data = { items: [{ reviewId: `pr_${'a'.repeat(40)}`, queue: 'duplicate', action: 'select-canonical', displayName: 'alpha-review', skillIds: [ALPHA, ALPHA_VARIANT], contentRevisions: [`sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`], state: 'needs-review', blocking: true, queueFingerprint: `sha256:${'a'.repeat(64)}` }], actionable: 1, blocking: 1, policyVersion: 2, revision: REVISION };
  else if (pathname === '/api/v1/policy/proposals' && method === 'POST') data = { state: 'proposed', proposalId: '55555555-5555-4555-8555-555555555555', proposalDigest: `sha256:${'b'.repeat(64)}`, reviewId: `pr_${'a'.repeat(40)}`, queue: 'duplicate', action: 'select-canonical', skillId: ALPHA, expectedRevision: REVISION.revisionId, expiresAt: '2099-07-10T13:00:00.000Z', decisionOptions: ['accept', 'hold', 'reject'], wouldPublish: false };
  else if (pathname === '/api/v1/policy/decisions' && method === 'POST') data = { state: 'recorded', reviewId: `pr_${'a'.repeat(40)}`, queue: 'duplicate', action: 'select-canonical', decision: 'hold', skillId: ALPHA, decisionDigest: `sha256:${'c'.repeat(64)}`, policyChanged: false, revision: REVISION, routingApprovalRequired: true };
  else if (pathname === '/api/v1/evals') data = {
    present: false, releaseEvidenceEligible: false, pass: false, evidenceIssues: ['EVAL_HOLDOUT_MISSING'], revision: REVISION,
    currentRun: {
      runId: null, suiteId: null, jobId: null, state: 'not-run', expectedRevision: null, resultRevisionId: null, resultWorkspaceRevision: null,
      reportRevision: null, reportBinding: 'unavailable', reportArtifactDigest: null, reportEffectiveRevisionDigest: null,
      createdAt: null, startedAt: null, completedAt: null, errorCode: null,
      progress: { mode: 'unavailable', completedCases: null, totalCases: null, ratio: null }, reportAvailable: false
    },
    recentRuns: [], caseResults: [], caseResultsPagination: { total: 0, limit: 20, hasMore: false, nextCursor: null }, caseTraceState: 'unavailable', promptStored: false
  };
  else if (pathname === '/api/v1/sources') data = { coverage: 'partial', inventorySkills: 3, trackedSkills: 2, items: [], untrackedItems: [], untrackedTotal: 0, untrackedTruncated: false, revision: REVISION };
  else if (pathname === '/api/v1/routes/preview' && method === 'POST') data = {
    kind: 'skillmap.route-result', schemaVersion: 2, routeId: TRACE_ID, createdAt: ROUTE_EVENT.createdAt, promptStored: false, latencyMs: 25,
    decision: {
      kind: 'skillmap.route-decision', schemaVersion: 2, revision: REVISION, servingMode: 'current', recommendations: [], exclusions: [],
      hookText: 'SkillMap: no confident skill recommendation.', warningState: 'none', warningCodes: []
    },
    decisionDigest: `sha256:${'d'.repeat(64)}`
  };
  else if (pathname === `/api/v1/routes/${TRACE_ID}` && method === 'GET') data = ROUTE_EVENT;
  else if (pathname === '/api/v1/routes') data = { events: [ROUTE_EVENT], nextCursor: null, total: 1, feedbackBacklog: { reviewedRoutes: 0, pendingRoutes: 1, recordedFeedback: 0, outcomeCounts: { correct: 0, wrong: 0, missing: 0, unsafe: 0 }, pendingRouteIds: [TRACE_ID] } };
  else if (pathname === '/api/v1/jobs' && method === 'GET') data = { items: [fixtureJob(JOB_ONE, 'scan'), fixtureJob(JOB_TWO, 'doctor')], total: 2 };
  else if (/^\/api\/v1\/jobs\/[0-9a-f-]{36}\/cancel$/i.test(pathname) && method === 'POST') {
    const jobId = pathname.split('/').at(-2);
    data = { state: 'cancelled', jobId, jobState: 'cancelled', cancellationDigest: `sha256:${'f'.repeat(64)}`, idempotent: false, publicationPrevented: true };
  }
  else if (pathname === '/api/v1/state/revisions' && method === 'GET') data = {
    items: [
      { revision: REVISION, sequence: 2, parentRevisionId: OLDER_REVISION.revisionId, createdAt: '2026-07-10T12:00:00.000Z', mutation: { kind: 'legacy-snapshot', actor: 'fixture', reasonDigest: `sha256:${'6'.repeat(64)}`, sourceRevisionId: null, targetRevisionId: null }, isCurrent: true, isRoutingServing: true, routingApprovalRecorded: true, artifactCount: 8 },
      { revision: OLDER_REVISION, sequence: 1, parentRevisionId: null, createdAt: '2026-07-09T12:00:00.000Z', mutation: { kind: 'legacy-migration', actor: 'fixture', reasonDigest: `sha256:${'7'.repeat(64)}`, sourceRevisionId: null, targetRevisionId: null }, isCurrent: false, isRoutingServing: false, routingApprovalRecorded: true, artifactCount: 6 }
    ], limit: 50, hasMore: false, nextCursor: null, currentRevision: REVISION, routingRevisionId: REVISION.revisionId
  };
  else if (pathname === '/api/v1/state/rollback' && method === 'POST') data = { state: 'rolled-back', revision: ROLLBACK_REVISION, targetRevisionId: OLDER_REVISION.revisionId, routingApproved: false, routingApprovalRequired: true, warningCount: 0 };
  else return end(response, 404, 'application/json', JSON.stringify(apiFailure({ code: 'NOT_FOUND', message: 'Not found.', retryable: false })));
  end(response, 200, 'application/json; charset=utf-8', JSON.stringify(apiSuccess(data)));
}

function apiSuccess(data, { compatibility = 'compatible', servingRevision = REVISION, currentRevision = REVISION } = {}) {
  return {
    kind: 'skillmap.api-response', schemaVersion: 1, ok: true, requestId: API_REQUEST_ID,
    servingRevision, currentRevision, compatibility, data
  };
}

function apiFailure(error, { compatibility = 'compatible', servingRevision = REVISION, currentRevision = REVISION } = {}) {
  return {
    kind: 'skillmap.api-response', schemaVersion: 1, ok: false, requestId: API_REQUEST_ID,
    servingRevision, currentRevision, compatibility, error
  };
}

function fixtureJob(jobId, type) {
  return { kind: 'skillmap.job', schemaVersion: 1, jobId, type, state: 'queued', expectedRevision: REVISION.revisionId, idempotencyKey: `sha256:${'8'.repeat(64)}`, requestDigest: `sha256:${'9'.repeat(64)}`, confirmation: 'none', createdAt: '2026-07-10T12:00:00.000Z' };
}

function end(response, status, type, body) {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}
