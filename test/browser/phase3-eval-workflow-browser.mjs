import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { finalizeEvalSuiteV3Snapshot } from '../../assets/local-app/v1/modules/eval-v3-review-state.js';
import { validateContract } from '../../dist/contracts/validate.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const assets = path.join(repo, 'assets', 'local-app', 'v1');
const requireFromWeb = createRequire(path.join(repo, 'apps', 'web', 'package.json'));
const { chromium } = requireFromWeb('playwright');
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const REVISION = {
  workspaceId: WORKSPACE_ID,
  revisionId: 'r00000000000000000002-00000000-0000-4000-8000-000000000002',
  workspaceRevision: `sha256:${'a'.repeat(64)}`,
  effectiveDigest: `sha256:${'b'.repeat(64)}`,
  effectiveRevisionDigest: `sha256:${'c'.repeat(64)}`
};
const RESULT_REVISION = {
  ...REVISION,
  revisionId: 'r00000000000000000001-00000000-0000-4000-8000-000000000003',
  workspaceRevision: `sha256:${'f'.repeat(64)}`
};
const SKILL_ID = `sk_${'A'.repeat(43)}`;
const CAPABILITY = 'A'.repeat(43);
const CSRF = 'B'.repeat(43);
const PRIVATE_PROMPT = 'PRIVATE-EVAL-BROWSER-PROMPT-CANARY';
const API_REQUEST_ID = '00000000-0000-4000-8000-000000000009';

test('Evals renders durable progress and paginated prompt-free case traces at desktop and 320px', async t => {
  const fixture = await startFixture(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${fixture.origin}/app/${WORKSPACE_ID}/evals#skillmap-capability=${CAPABILITY}&skillmap-csrf=${CSRF}`, { waitUntil: 'networkidle' });

  await page.getByRole('heading', { name: 'Evals', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Eval run', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Revisioned case trace', exact: true }).waitFor();
  await page.getByText('21 of 21 cases', { exact: true }).waitFor();
  await page.getByText(/carried forward unchanged/).waitFor();
  await page.getByText('Carried Forward', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Eval run progress').getAttribute('value'), '21');
  assert.equal(await page.locator('.eval-trace-item').count(), 20);
  await page.locator('.eval-trace-item summary').first().click();
  await page.locator('.eval-trace-item').first().getByText('Expected skill IDs', { exact: true }).waitFor();
  assert.equal(await page.locator('.eval-trace-item').first().getByText(SKILL_ID, { exact: true }).count(), 2);
  assert.equal((await page.locator('body').textContent()).includes(PRIVATE_PROMPT), false);
  await capture(page, 'eval-workflow-desktop.png');

  await page.getByRole('button', { name: 'Next cases', exact: true }).click();
  await page.getByText('Cases 21–21 of 21', { exact: true }).waitFor();
  assert.equal(await page.locator('.eval-trace-item').count(), 1);
  await page.getByRole('button', { name: 'Previous cases', exact: true }).click();
  await page.getByText('Cases 1–20 of 21', { exact: true }).waitFor();

  await page.setViewportSize({ width: 320, height: 760 });
  await page.locator('.eval-trace-item summary').first().click();
  const containment = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(containment.document <= containment.viewport, JSON.stringify(containment));
  assert.ok(containment.body <= containment.viewport, JSON.stringify(containment));
  await capture(page, 'eval-workflow-mobile.png');
  assert.deepEqual(errors, []);
});

test('Evals keeps a meaningful bounded error state when a case page cannot load', async t => {
  const fixture = await startFixture(t, { failCursor: true });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
  await page.goto(`${fixture.origin}/app/${WORKSPACE_ID}/evals#skillmap-capability=${CAPABILITY}&skillmap-csrf=${CSRF}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Next cases', exact: true }).click();
  await page.getByText('Case trace unavailable', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Retry eval trace', exact: true }).waitFor();
  assert.equal((await page.locator('body').textContent()).includes(PRIVATE_PROMPT), false);
});

test('Evals reviews, canonicalizes, and submits the exact local-sensitive v3 authority without retaining its prompt in the page', async t => {
  const fixture = await startFixture(t, { deepBaseline: true });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  const privateDraftPrompt = 'PRIVATE-V3-REVIEW-PROMPT-CANARY prepare the focused workflow.';
  const finalized = await finalizeEvalSuiteV3Snapshot(evalSuiteV3(privateDraftPrompt));
  await page.goto(`${fixture.origin}/app/${WORKSPACE_ID}/evals#skillmap-capability=${CAPABILITY}&skillmap-csrf=${CSRF}`, { waitUntil: 'networkidle' });
  await page.locator('#eval-suite-file').setInputFiles({ name: 'reviewed-v3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(finalized.suite)) });
  await page.getByRole('button', { name: 'Open local review', exact: true }).click();

  await page.getByRole('heading', { name: 'eval-suite/v3 review', exact: true }).waitFor();
  await page.getByText('Contract Complete', { exact: true }).waitFor().catch(async error => {
    const body = (await page.locator('body').innerText()).slice(0, 8_000);
    throw new Error(`${error.message}\nRendered body:\n${body}`);
  });
  await page.getByText('Canonical SHA-256 digests are current for this in-memory draft.', { exact: true }).waitFor();
  assert.ok(fixture.revisionCursors.includes('p10'), 'the exact baseline beyond the 500-entry visible cap was not resolved on demand');
  assert.equal(await page.locator('#eval-v3-dataset-digest').textContent(), finalized.datasetDigest);
  assert.equal(await page.locator('#eval-v3-payload-digest').textContent(), finalized.payloadDigest);
  assert.equal((await page.locator('body').textContent()).includes(privateDraftPrompt), true, 'the active local-sensitive in-memory editor hid its own review prompt');
  await capture(page, 'eval-v3-review-desktop.png');
  await page.setViewportSize({ width: 320, height: 760 });
  const containment = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(containment.document <= containment.viewport, JSON.stringify(containment));
  assert.ok(containment.body <= containment.viewport, JSON.stringify(containment));
  await capture(page, 'eval-v3-review-mobile.png');

  await page.locator('#eval-v3-review-confirm').check();
  await page.getByRole('button', { name: 'Import exact v3 suite', exact: true }).click();
  await page.getByText(/1 v3 cases imported as an unapproved revision/).waitFor();
  assert.equal(fixture.imports.length, 1);
  assert.deepEqual(Object.keys(fixture.imports[0]).sort(), ['expectedRevision', 'suite']);
  assert.equal(fixture.imports[0].expectedRevision, REVISION.revisionId);
  assert.equal(fixture.imports[0].suite.payloadDigest, finalized.payloadDigest);
  assert.equal(validateContract('https://skillmap.dev/contracts/eval-suite/v3.schema.json', fixture.imports[0].suite).ok, true);
  assert.equal((await page.locator('body').textContent()).includes(privateDraftPrompt), false, 'private v3 prompt remained in the DOM after import disposal');
});

test('Evals labels v2 as candidate-only and migrates unique display names into a blocked in-memory v3 draft', async t => {
  const fixture = await startFixture(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 980, height: 820 } });
  await page.goto(`${fixture.origin}/app/${WORKSPACE_ID}/evals#skillmap-capability=${CAPABILITY}&skillmap-csrf=${CSRF}`, { waitUntil: 'networkidle' });
  await page.locator('#eval-suite-file').setInputFiles({ name: 'legacy-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacySuiteV2())) });
  await page.getByRole('button', { name: 'Open local review', exact: true }).click();

  await page.getByRole('heading', { name: 'Legacy v2 migration review', exact: true }).waitFor();
  await page.getByText('Candidate Only', { exact: true }).waitFor();
  await page.getByText('Display-name labels are not release authority.', { exact: true }).waitFor();
  await page.locator('.eval-migration-panel').getByText(SKILL_ID, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Create v3 draft in memory', exact: true }).click();
  await page.getByRole('heading', { name: 'eval-suite/v3 review', exact: true }).waitFor();
  await page.getByText('Review Blocked', { exact: true }).waitFor();
  await page.getByText(/Select a historical approved effective revision/).waitFor();
  assert.equal(fixture.imports.length, 0, 'legacy migration wrote a revision without explicit v3 import');
});

async function startFixture(t, options = {}) {
  const imports = [];
  const revisionCursors = [];
  const fixtureOptions = { ...options, imports, revisionCursors };
  const server = createServer((request, response) => { void handleRequest(request, response, fixtureOptions); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { origin: `http://127.0.0.1:${server.address().port}`, imports, revisionCursors };
}

async function handleRequest(request, response, options) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/v1/')) return apiResponse(request, url, response, options);
  const relative = url.pathname === '/' || url.pathname === '/app' || url.pathname.startsWith('/app/') ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const target = path.resolve(assets, relative);
  if (!target.startsWith(`${assets}${path.sep}`)) return end(response, 404, 'text/plain', 'not found');
  try {
    const body = await readFile(target);
    const type = target.endsWith('.html') ? 'text/html; charset=utf-8' : target.endsWith('.js') ? 'text/javascript; charset=utf-8' : target.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    end(response, 200, type, body);
  } catch { end(response, 404, 'text/plain', 'not found'); }
}

async function apiResponse(request, url, response, options) {
  const dashboard = {
    workspace: { workspaceId: WORKSPACE_ID, name: 'Eval fixture workspace' }, revision: REVISION, currentRevision: REVISION,
    servingMode: 'current', routingReady: true, filesystemDirty: false,
    filesystemFreshness: {
      state: 'clean', filesystemDirty: false, reasonCode: null, observedAt: null, lastVerifiedAt: '2026-07-10T12:00:00.000Z',
      observedDigest: `sha256:${'4'.repeat(64)}`, expectedDigest: `sha256:${'4'.repeat(64)}`, rootIds: [], suggestedJobType: null
    },
    readiness: { verdict: 'attention required', phase: 'needs-eval', warnings: [], nextActions: [] },
    counts: { skills: 1, routeEligible: 1, sourceTracked: 1, evalCases: 21 },
    evidence: {
      inventorySkills: 1, observedRoutes: 0, evalConfidence: 'demo', releaseEvidenceEligible: false, tokenMetricsSource: 'not-measured',
      doctorPresent: true, doctorPackPresent: true, curationPresent: true, curationStale: false
    }
  };
  let data;
  if (url.pathname === '/api/v1/bootstrap') data = { initialized: true, state: 'ready', revision: REVISION, currentRevision: REVISION, routingReady: true, productReady: false, nextAction: 'route', readiness: { verdict: 'attention required', phase: 'needs-eval' }, connectorCompatibility: { apiVersion: 'v1', localAppAssetVersion: 'v1', productVersion: '0.1.0' } };
  else if (url.pathname === '/api/v1/workspace') data = { workspaceId: WORKSPACE_ID, name: 'Eval fixture workspace', readiness: dashboard.readiness, revision: REVISION, currentRevision: REVISION, servingMode: 'current', routingReady: true, filesystemDirty: false, filesystemFreshness: dashboard.filesystemFreshness, roots: [] };
  else if (url.pathname === '/api/v1/dashboard') data = dashboard;
  else if (url.pathname === '/api/v1/skills') data = { items: [{ skillId: SKILL_ID, displayName: 'alpha', description: 'Focused workflow support.', tier: 'active-default', routeEligible: true, qualifiedExplicitAllowed: true, variantState: 'unique', hasScripts: false, sourceScope: 'project', contentRevision: `sha256:${'9'.repeat(64)}` }], nextCursor: null, hasMore: false, limit: 100 };
  else if (url.pathname === '/api/v1/state/revisions') {
    const cursor = url.searchParams.get('cursor');
    options.revisionCursors.push(cursor);
    if (options.deepBaseline) {
      const page = cursor ? Number(cursor.slice(1)) : 0;
      const terminal = page >= 10;
      data = {
        items: terminal
          ? [revisionHistoryItem(RESULT_REVISION, 1, false)]
          : [revisionHistoryItem(page === 0 ? REVISION : deepRevision(page), 12 - page, page === 0)],
        limit: 50,
        hasMore: !terminal,
        nextCursor: terminal ? null : `p${page + 1}`,
        currentRevision: REVISION,
        routingRevisionId: REVISION.revisionId
      };
    } else {
      data = {
        items: [revisionHistoryItem(REVISION, 2, true), revisionHistoryItem(RESULT_REVISION, 1, false)],
        limit: 50, hasMore: false, nextCursor: null, currentRevision: REVISION, routingRevisionId: REVISION.revisionId
      };
    }
  }
  else if (url.pathname === '/api/v1/evals' && request.method === 'GET') {
    if (options.failCursor && url.searchParams.get('cursor')) {
      return end(response, 409, 'application/json; charset=utf-8', JSON.stringify(apiFailure({
        code: 'EVAL_TRACE_UNAVAILABLE', message: 'The bounded case trace page could not be loaded.', retryable: true
      })));
    }
    data = evalPayload(url.searchParams.get('cursor'));
  } else if (url.pathname === '/api/v1/evals/import' && request.method === 'POST') {
    const body = await readJsonRequest(request);
    options.imports.push(body);
    data = { imported: true, schemaVersion: body?.suite?.schemaVersion, cases: body?.suite?.cases?.length || 0, composition: { total: body?.suite?.cases?.length || 0 }, datasetDigest: body?.suite?.datasetDigest, promptRetention: 'local-eval-suite', revision: REVISION, routingApprovalRequired: true };
  } else return end(response, 404, 'application/json; charset=utf-8', JSON.stringify(apiFailure({ code: 'NOT_FOUND', message: 'Not found.', retryable: false })));
  end(response, 200, 'application/json; charset=utf-8', JSON.stringify(apiSuccess(data)));
}

function apiSuccess(data) {
  return {
    kind: 'skillmap.api-response', schemaVersion: 1, ok: true, requestId: API_REQUEST_ID,
    servingRevision: REVISION, currentRevision: REVISION, compatibility: 'compatible', data
  };
}

function apiFailure(error) {
  return {
    kind: 'skillmap.api-response', schemaVersion: 1, ok: false, requestId: API_REQUEST_ID,
    servingRevision: REVISION, currentRevision: REVISION, compatibility: 'compatible', error
  };
}

function revisionHistoryItem(revision, sequence, isCurrent) {
  return { revision, sequence, parentRevisionId: sequence === 1 ? null : RESULT_REVISION.revisionId, createdAt: `2026-07-10T12:00:${String(sequence).padStart(2, '0')}.000Z`, mutation: { kind: 'legacy-snapshot', actor: 'fixture', reasonDigest: `sha256:${String(sequence % 10).repeat(64)}`, sourceRevisionId: null, targetRevisionId: null }, isCurrent, isRoutingServing: isCurrent, routingApprovalRecorded: true, artifactCount: 8 };
}

function deepRevision(page) {
  const digit = String((page % 8) + 1);
  return {
    ...RESULT_REVISION,
    revisionId: `r${String(12 - page).padStart(20, '0')}-${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    workspaceRevision: `sha256:${digit.repeat(64)}`
  };
}

async function readJsonRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function evalPayload(cursor) {
  const all = Array.from({ length: 21 }, (_unused, index) => caseResult(index));
  const caseResults = cursor ? all.slice(20) : all.slice(0, 20);
  return {
    present: true,
    evidenceLevel: 'candidate', releaseEvidenceEligible: false, pass: false,
    datasetDigest: `sha256:${'d'.repeat(64)}`, effectiveRevisionDigest: REVISION.effectiveRevisionDigest,
    composition: { total: 21, implicitNatural: 21, multiSkill: 0, negativeNearMiss: 0, releaseCounted: 21 },
    holdout: { count: 5, requiredCount: 30, ratio: 0.238, pass: false }, leakage: { count: 0, pass: true },
    baselineComparison: { provided: true, pass: false }, count: 21, top1Rate: 1, top3Rate: 1, avoidHits: 0,
    evidenceIssues: ['EVAL_COMPOSITION_INCOMPLETE'], revision: REVISION,
    currentRun: {
      runId: 'evalrun_browserfixture01', suiteId: 'evalsuite_browserfixture01', jobId: '11111111-1111-4111-8111-111111111111', state: 'succeeded',
      expectedRevision: RESULT_REVISION.revisionId, resultRevisionId: RESULT_REVISION.revisionId,
      resultWorkspaceRevision: RESULT_REVISION.workspaceRevision, reportRevision: REVISION,
      reportBinding: 'carried-forward', reportArtifactDigest: `sha256:${'e'.repeat(64)}`,
      reportEffectiveRevisionDigest: REVISION.effectiveRevisionDigest,
      createdAt: '2026-07-10T12:00:00.000Z', startedAt: '2026-07-10T12:00:01.000Z', completedAt: '2026-07-10T12:00:02.000Z',
      errorCode: null, progress: { mode: 'determinate', completedCases: 21, totalCases: 21, ratio: 1 }, reportAvailable: true
    },
    recentRuns: [], caseResultsSchemaVersion: 3, caseResults,
    caseResultsPagination: { total: 21, limit: 20, hasMore: !cursor, nextCursor: cursor ? null : 'NEXT_CURSOR' },
    caseTraceState: 'available', promptStored: false
  };
}

function caseResult(index) {
  return {
    caseId: `evalcase_browsercase${String(index).padStart(8, '0')}`,
    primaryCaseType: 'implicit-natural', membership: index < 5 ? 'holdout' : 'train', releaseCounted: true, releaseScored: true,
    expectedSkillIds: [SKILL_ID], avoidSkillIds: [], recommendedSkillIds: [SKILL_ID], avoidedButRecommendedSkillIds: [],
    top1Hit: true, top3Hit: true, abstained: false, advisoryBytes: 80, outcome: 'top1-hit', reasonCodes: ['EXPECTED_TOP1'], validationCodes: [], leakageCodes: []
  };
}

function evalSuiteV3(prompt) {
  return {
    kind: 'skillmap.eval-suite', schemaVersion: 3, suiteId: 'evalsuite_browserworkflow01', name: 'Browser workflow suite',
    createdAt: '2026-07-10T12:00:00.000Z', updatedAt: '2026-07-10T12:05:00.000Z', datasetDigest: `sha256:${'0'.repeat(64)}`,
    provenance: {
      labelAuthor: 'operator-a', reviewedBy: 'reviewer-b', sourceClass: 'operator-authored', createdAt: '2026-07-10T12:00:00.000Z',
      holdoutFrozenAt: '2026-07-10T12:02:00.000Z', reviewedAt: '2026-07-10T12:04:00.000Z', deduplicationResult: 'passed', holdoutFrozen: true,
      frozenCaseSetDigest: `sha256:${'0'.repeat(64)}`
    },
    baseline: {
      top1Rate: 0.5, top3Rate: 0.75, avoidHits: 0, abstentionRate: 0, meanAdvisoryBytes: 90,
      provenance: { sourceKind: 'approved-effective-revision', completedAt: '2026-07-10T12:03:00.000Z', caseSetDigest: `sha256:${'0'.repeat(64)}`, sourceRevision: RESULT_REVISION }
    },
    cases: [{
      caseId: 'evalcase_browserworkflow01', prompt, expectedSkillIds: [SKILL_ID], avoidSkillIds: [], primaryCaseType: 'implicit-natural', membership: 'holdout',
      labelProvenance: { author: 'operator-a', sourceClass: 'operator-authored', createdAt: '2026-07-10T12:00:00.000Z', reviewedAt: '2026-07-10T12:01:00.000Z' }
    }],
    redactionClassification: 'local-sensitive', payloadDigest: `sha256:${'0'.repeat(64)}`
  };
}

function legacySuiteV2() {
  return {
    version: 2,
    provenance: { labelAuthor: 'operator-a', sourceClass: 'operator-authored', createdAt: '2026-07-10T12:00:00.000Z', reviewedAt: '2026-07-10T12:04:00.000Z', deduplicationResult: 'passed', holdoutFrozen: true },
    baseline: { top1Rate: 0.5, top3Rate: 0.75, avoidHits: 0, abstentionRate: 0, meanAdvisoryBytes: 90 },
    evals: [{ id: 'legacy-browser-one', prompt: 'Prepare the focused workflow.', expected: ['alpha'], avoid: [], primaryCaseType: 'implicit-natural', membership: 'holdout' }]
  };
}

async function capture(page, name) {
  const directory = process.env.SKILLMAP_EVAL_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
}

function end(response, status, type, body) {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}
