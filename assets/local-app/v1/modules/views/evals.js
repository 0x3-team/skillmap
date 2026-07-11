import {
  createEvalReviewState,
  disposeEvalReviewState,
  EVAL_CASE_TYPES,
  EVAL_MEMBERSHIPS,
  evalReviewPage,
  labelsToInput,
  parseEvalReviewSuite,
  parseLabelInput,
  setEvalReviewPage,
  summarizeEvalReview,
  updateEvalReviewCase
} from '../eval-review-state.js';
import {
  createEvalV3ReviewState,
  disposeEvalV3ReviewState,
  EVAL_V3_CASE_TYPES,
  EVAL_V3_MEMBERSHIPS,
  EVAL_V3_SOURCE_CLASSES,
  evalV3ReviewPage,
  finalizeEvalSuiteV3Snapshot,
  legacyV2MigrationPreview,
  migrateEvalSuiteV2ToV3,
  parseEvalSuiteV3,
  refreshEvalSuiteV3Digests,
  setEvalV3ReviewPage,
  skillIdsToInput,
  summarizeEvalV3Review,
  updateEvalV3Case,
  updateEvalV3SuiteField
} from '../eval-v3-review-state.js';
import { aggregateRows, escapeHtml, humanize, metric, pageHead, percent, pill, revisionLine, safeDate, shortDigest } from '../render.js';

const EVAL_CASE_PAGE_SIZE = 20;
const TERMINAL_RUN_STATES = new Set(['succeeded', 'failed', 'cancelled']);

export async function renderEvals(ctx) {
  const data = await ctx.api(`/api/v1/evals?limit=${EVAL_CASE_PAGE_SIZE}`, { cache: false });
  const catalogs = await loadEvalReviewCatalogs(ctx);
  const session = { review: null, reviewMode: null, data, catalogs, cursor: null, cursorStack: [], disposed: false, watching: false };
  ctx.onViewDispose?.(() => {
    session.disposed = true;
    clearReview(session);
  });
  ctx.mount(`${pageHead('Evals', 'Review the qualified v3 authority, run it against approved revisions, and inspect its prompt-free revisioned case trace.', '<button class="button job-action" id="eval-run-button" type="button" data-job="eval-run">Run approved suite</button>')}
    ${revisionLine(data.revision || ctx.state.dashboard?.revision, ctx.state.dashboard?.servingMode)}
    <div id="eval-runtime-root">${evalRuntime(data, session)}</div>
    <section class="panel"><div class="panel-head"><div><h2>Review a local eval suite</h2><span>v3 authority up to 500 KiB · v2 migration up to 60 KiB</span></div>${pill('local-sensitive', 'warn')}</div><div class="panel-body"><div class="eval-authority-note"><strong>Only eval-suite/v3 can become release authority.</strong><span>A v3 import still creates an unapproved revision; its later run must replay the frozen cases against both the selected historical baseline artifact and the approved current registry. Legacy v2 stays candidate-only.</span></div><form id="eval-review-loader" class="spaced-control"><div class="field"><label for="eval-suite-file">Eval suite file</label><input id="eval-suite-file" name="suite" type="file" accept="application/json,.json" required><small>Private prompts and labels stay only in this page's in-memory draft until an explicit import. They are never written to browser storage or route-event history. Use the CLI when the exact JSON exceeds the connector's bounded browser request.</small></div><div class="form-actions"><button class="button" type="submit">Open local review</button></div></form>${catalogNotice(catalogs)}<div id="eval-review-status" aria-live="polite"></div><div id="eval-review-root"></div></div></section>
    ${data.present ? evalEvidence(data) : noEvalEvidence(data)}`);
  ctx.jobs.bindJobActions();
  bindEvalRuntime(ctx, session);
  const initialRunId = data.currentRun?.runId || null;
  document.querySelector('#eval-run-button')?.addEventListener('click', () => { void watchEvalRun(ctx, session, initialRunId); });
  if (['queued', 'running'].includes(data.currentRun?.state)) void watchEvalRun(ctx, session, data.currentRun.runId);
  document.querySelector('#eval-review-loader').addEventListener('submit', event => loadEvalSuite(ctx, session, event));
}

async function loadEvalReviewCatalogs(ctx) {
  const [skillsResult, revisionsResult] = await Promise.allSettled([loadEvalSkills(ctx), loadEvalRevisions(ctx)]);
  const revisionCatalog = revisionsResult.status === 'fulfilled'
    ? revisionsResult.value
    : { items: [], currentRevisionId: ctx.currentRevisionId(), hasMore: false, nextCursor: null, truncated: false };
  return {
    skills: skillsResult.status === 'fulfilled' ? skillsResult.value : [],
    revisions: revisionCatalog.items,
    currentRevisionId: revisionCatalog.currentRevisionId,
    revisionCatalogHasMore: revisionCatalog.hasMore,
    revisionCatalogNextCursor: revisionCatalog.nextCursor,
    revisionCatalogTruncated: revisionCatalog.truncated,
    skillCatalogAvailable: skillsResult.status === 'fulfilled',
    revisionCatalogAvailable: revisionsResult.status === 'fulfilled'
  };
}

async function loadEvalSkills(ctx) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const data = await ctx.api(`/api/v1/skills?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...(data.items || []));
    if (!data.nextCursor) return items;
    cursor = data.nextCursor;
  }
  throw new Error('The approved skill catalog exceeded the bounded review pagination limit.');
}

async function loadEvalRevisions(ctx) {
  const items = [];
  let cursor = null;
  let currentRevisionId = ctx.currentRevisionId();
  for (let page = 0; page < 10; page += 1) {
    const data = await ctx.api(`/api/v1/state/revisions?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...(data.items || []));
    currentRevisionId = data.currentRevision?.revisionId || currentRevisionId;
    if (!data.hasMore || !data.nextCursor) return { items, currentRevisionId, hasMore: false, nextCursor: null, truncated: false };
    cursor = data.nextCursor;
  }
  return { items, currentRevisionId, hasMore: true, nextCursor: cursor, truncated: true };
}

function catalogNotice(catalogs) {
  if (catalogs.skillCatalogAvailable && catalogs.revisionCatalogAvailable) {
    const truncation = catalogs.revisionCatalogTruncated
      ? ' The visible history is capped at 500 entries; an imported v3 suite’s exact older RevisionRef is resolved on demand. Use the CLI to browse or select other older baselines.'
      : '';
    return `<p class="microcopy">Loaded ${catalogs.skills.length} approved qualified skill${catalogs.skills.length === 1 ? '' : 's'} and ${catalogs.revisions.length} verified revision histor${catalogs.revisions.length === 1 ? 'y entry' : 'y entries'} for local cross-checking.${escapeHtml(truncation)}</p>`;
  }
  return '<p class="callout spaced-callout">One or more review catalogs could not be loaded. You may inspect a draft, but v3 import remains blocked until qualified IDs and the historical RevisionRef can be verified.</p>';
}

function evalRuntime(data, session) {
  return `<div class="eval-runtime-grid">
    <section class="panel eval-run-panel" aria-labelledby="eval-run-heading">
      <div class="panel-head"><div><h2 id="eval-run-heading">Eval run</h2><span>Durable job and revision receipt</span></div>${pill(data.currentRun?.state || 'not-run', runTone(data.currentRun?.state))}</div>
      <div class="panel-body">${evalRunState(data.currentRun, data.recentRuns || [])}</div>
    </section>
    <section class="panel eval-trace-panel" aria-labelledby="eval-case-trace-heading">
      <div class="panel-head"><div><h2 id="eval-case-trace-heading">Revisioned case trace</h2><span>eval-run/v3 · prompt-free</span></div>${pill(data.caseTraceState || 'unavailable', traceTone(data.caseTraceState))}</div>
      <div class="panel-body">${evalCaseTrace(data, session)}</div>
    </section>
  </div>`;
}

function evalRunState(run, recentRuns) {
  if (!run || run.state === 'not-run') {
    return '<div class="empty compact-empty"><strong>No eval run receipt</strong><span>Import and approve a reviewed suite, then run it explicitly. No private prompt is included in this view.</span></div>';
  }
  const progress = run.progress || {};
  const determinate = progress.mode === 'determinate' && Number.isInteger(progress.totalCases);
  const progressLabel = determinate
    ? `${Number(progress.completedCases || 0).toLocaleString()} of ${Number(progress.totalCases).toLocaleString()} cases`
    : progress.mode === 'indeterminate' ? `${humanize(run.state)} · exact case progress is not emitted by the isolated runner` : 'Case progress unavailable for this receipt';
  const progressControl = progress.mode === 'unavailable'
    ? '<span class="eval-progress-unavailable" aria-hidden="true"></span>'
    : `<progress aria-label="Eval run progress" max="${determinate ? Math.max(1, Number(progress.totalCases)) : 1}" ${determinate ? `value="${Math.min(Number(progress.completedCases || 0), Math.max(1, Number(progress.totalCases)))}"` : ''}></progress>`;
  return `<div class="eval-run-progress" role="status" aria-live="polite"><div><strong>${escapeHtml(progressLabel)}</strong><span>${escapeHtml(evalReportBindingCopy(run))}</span></div>${progressControl}</div>
    <dl class="eval-run-receipt">
      <div><dt>Run</dt><dd><code>${escapeHtml(run.runId || 'unavailable')}</code></dd></div>
      <div><dt>Job</dt><dd><code>${escapeHtml(run.jobId || 'local report')}</code></dd></div>
      <div><dt>Expected revision</dt><dd><code>${escapeHtml(run.expectedRevision || 'unavailable')}</code></dd></div>
      <div><dt>Result revision</dt><dd><code>${escapeHtml(run.resultRevisionId || 'not published')}</code></dd></div>
      <div><dt>Report revision</dt><dd><code>${escapeHtml(run.reportRevision?.revisionId || 'not bound')}</code></dd></div>
      <div><dt>Evidence binding</dt><dd>${escapeHtml(humanize(run.reportBinding || 'unavailable'))}</dd></div>
      <div><dt>Effective revision</dt><dd><code>${escapeHtml(run.reportEffectiveRevisionDigest || 'not bound')}</code></dd></div>
      <div><dt>Completed</dt><dd>${escapeHtml(safeDate(run.completedAt, 'Not completed'))}</dd></div>
      <div><dt>Error code</dt><dd>${run.errorCode ? `<code>${escapeHtml(run.errorCode)}</code>` : 'None'}</dd></div>
    </dl>
    ${recentRunList(recentRuns)}`;
}

function evalReportBindingCopy(run) {
  if (run.reportBinding === 'result-revision') return "The prompt-free report is bound directly to this job's result revision.";
  if (run.reportBinding === 'carried-forward') return "The prompt-free report is carried forward unchanged from this job's result revision and still matches the serving effective revision.";
  if (run.reportBinding === 'report-only') return 'The prompt-free report binds to this serving revision but has no durable local job receipt.';
  if (run.state === 'queued' || run.state === 'running') return 'This job has not published a report; the trace panel may still show the last approved report.';
  return 'This job receipt does not bind the report currently shown in the independently revisioned trace panel.';
}

function recentRunList(runs) {
  if (!runs.length) return '<p class="microcopy">No durable eval jobs are retained yet; this may be a report created directly by the local CLI.</p>';
  return `<details class="eval-recent-runs"><summary>Recent eval jobs (${runs.length})</summary><ul class="stack-list">${runs.slice(0, 12).map(run => `<li><span><code>${escapeHtml(run.jobId || run.runId || 'unknown')}</code></span><small>${escapeHtml(humanize(run.state))} · ${escapeHtml(safeDate(run.completedAt || run.createdAt))}</small></li>`).join('')}</ul></details>`;
}

function evalCaseTrace(data, session) {
  const state = data.caseTraceState;
  const messages = {
    empty: ['No case results in this report', 'The immutable report is valid but contains no case-result rows.'],
    unavailable: ['No revisioned case trace yet', 'Run an approved suite to publish a prompt-free case trace tied to its job and revision receipt.'],
    'binding-mismatch': ['Case trace withheld', 'The report dataset or effective digest does not bind to the serving revision. Run the suite again after approving the intended revision.'],
    invalid: ['Case trace unavailable', 'The retained report did not satisfy the eval-run/v3 structural projection. Review local diagnostics before rerunning it.'],
    'too-large': ['Case trace exceeds the UI bound', 'Use the local CLI to inspect this report, reduce the reviewed suite, and publish a bounded run.']
  };
  if (state !== 'available') {
    const [title, copy] = messages[state] || messages.unavailable;
    return `<div class="empty compact-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
  }
  const cases = data.caseResults || [];
  const page = data.caseResultsPagination || {};
  if (!cases.length) return '<div class="empty compact-empty"><strong>No cases on this page</strong><span>The cursor may be stale. Return to the first case page and retry.</span></div>';
  const start = session.cursorStack.length * Number(page.limit || EVAL_CASE_PAGE_SIZE) + 1;
  return `<div class="eval-case-traces">${cases.map(evalCaseTraceItem).join('')}</div>
    <nav class="eval-trace-pagination" aria-label="Eval case trace pages"><button class="quiet-button" id="eval-trace-previous" type="button" ${session.cursorStack.length ? '' : 'disabled'}>Previous cases</button><span>Cases ${start}–${Math.min(start + cases.length - 1, Number(page.total || cases.length))} of ${Number(page.total || cases.length).toLocaleString()}</span><button class="quiet-button" id="eval-trace-next" type="button" ${page.hasMore && page.nextCursor ? '' : 'disabled'}>Next cases</button></nav>`;
}

function evalCaseTraceItem(item) {
  return `<details class="eval-trace-item"><summary><span><code>${escapeHtml(item.caseId)}</code><small>${escapeHtml(humanize(item.primaryCaseType))} · ${escapeHtml(humanize(item.membership))}</small></span>${pill(item.outcome, outcomeTone(item.outcome))}</summary><dl class="eval-trace-detail">
    ${evalTraceField('Expected skill IDs', item.expectedSkillIds)}
    ${evalTraceField('Actual skill IDs', item.recommendedSkillIds)}
    ${evalTraceField('Avoid targets', item.avoidSkillIds)}
    ${evalTraceField('Avoid hits', item.avoidedButRecommendedSkillIds)}
    ${evalTraceField('Outcome and reason codes', item.reasonCodes)}
    ${evalTraceField('Validation codes', item.validationCodes)}
    ${evalTraceField('Leakage codes', item.leakageCodes)}
  </dl></details>`;
}

function evalTraceField(label, values) {
  const items = Array.isArray(values) ? values : [];
  return `<div><dt>${escapeHtml(label)}</dt><dd>${items.length ? items.map(item => `<code>${escapeHtml(item)}</code>`).join(' ') : 'None'}</dd></div>`;
}

function bindEvalRuntime(ctx, session) {
  document.querySelector('#eval-trace-next')?.addEventListener('click', () => { void changeEvalCasePage(ctx, session, 'next'); });
  document.querySelector('#eval-trace-previous')?.addEventListener('click', () => { void changeEvalCasePage(ctx, session, 'previous'); });
}

async function changeEvalCasePage(ctx, session, direction) {
  const pagination = session.data?.caseResultsPagination || {};
  if (direction === 'next') {
    if (!pagination.nextCursor) return;
    session.cursorStack.push(session.cursor);
    session.cursor = pagination.nextCursor;
  } else {
    if (!session.cursorStack.length) return;
    session.cursor = session.cursorStack.pop() || null;
  }
  await refreshEvalRuntime(ctx, session, { resetOnStale: true });
}

async function refreshEvalRuntime(ctx, session, options = {}) {
  if (session.disposed) return;
  const root = document.querySelector('#eval-runtime-root');
  if (!root) return;
  const query = new URLSearchParams({ limit: String(EVAL_CASE_PAGE_SIZE) });
  if (session.cursor) query.set('cursor', session.cursor);
  try {
    session.data = await ctx.api(`/api/v1/evals?${query}`, { cache: false });
    if (session.disposed || !document.querySelector('#eval-runtime-root')) return;
    root.innerHTML = evalRuntime(session.data, session);
    bindEvalRuntime(ctx, session);
  } catch (error) {
    if (options.resetOnStale && error.code === 'EVAL_CURSOR_INVALID') {
      session.cursor = null;
      session.cursorStack = [];
      return refreshEvalRuntime(ctx, session);
    }
    root.innerHTML = `<section class="panel eval-runtime-error"><div class="empty"><strong>Case trace unavailable</strong><span>${escapeHtml(error.safeMessage || 'The bounded eval run response could not be loaded.')}</span><button class="button" id="eval-runtime-retry" type="button">Retry eval trace</button></div></section>`;
    document.querySelector('#eval-runtime-retry')?.addEventListener('click', () => { void refreshEvalRuntime(ctx, session, { resetOnStale: true }); });
  }
}

async function watchEvalRun(ctx, session, initialRunId) {
  if (session.watching || session.disposed) return;
  session.watching = true;
  let trackedRunId = ['queued', 'running'].includes(session.data?.currentRun?.state) ? session.data.currentRun.runId : null;
  try {
    for (let attempt = 0; attempt < 90 && !session.disposed; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 250 : 1000));
      await refreshEvalRuntime(ctx, session, { resetOnStale: true });
      const run = session.data?.currentRun;
      if (['queued', 'running'].includes(run?.state)) trackedRunId = run.runId;
      const changedRun = run?.runId && run.runId !== initialRunId;
      if (TERMINAL_RUN_STATES.has(run?.state) && (run.runId === trackedRunId || changedRun)) {
        ctx.invalidate();
        await ctx.refreshWorkspaceState(false);
        if (!session.disposed) await ctx.renderRoute('evals');
        return;
      }
      if (!trackedRunId && attempt >= 9) return;
    }
  } finally {
    session.watching = false;
  }
}

function runTone(state) { return state === 'succeeded' ? 'good' : state === 'failed' || state === 'cancelled' ? 'bad' : 'warn'; }
function traceTone(state) { return state === 'available' || state === 'empty' ? 'good' : state === 'invalid' || state === 'binding-mismatch' ? 'bad' : 'warn'; }
function outcomeTone(outcome) { return ['top1-hit', 'top3-hit', 'correct-abstention'].includes(outcome) ? 'good' : outcome === 'unsafe' || outcome === 'invalid' ? 'bad' : 'warn'; }

function noEvalEvidence(data) {
  const issues = data.evidenceIssues || [];
  return `<section class="panel spaced-panel"><div class="empty"><strong>No revisioned eval report</strong><span>Review and import an eval-suite/v3 document as an unapproved revision, approve the intended state separately, then run its contextual replay. A legacy v2 import remains candidate-only.</span>${issues.length ? `<ul class="issue-list">${issues.map(item => `<li>${escapeHtml(humanize(item))}</li>`).join('')}</ul>` : ''}</div></section>`;
}

function evalEvidence(data) {
  const issues = data.evidenceIssues || [];
  return `<section class="metrics spaced-panel" aria-label="Eval metrics">${metric('Cases', data.count, 'All typed cases')}${metric('Top-1', percent(data.top1Rate), 'Release-scored only')}${metric('Top-3', percent(data.top3Rate), 'Release-scored only')}${metric('Avoid hits', data.avoidHits, 'Must remain zero')}</section>
    <div class="evidence-banner ${data.releaseEvidenceEligible ? 'eligible' : ''}"><div><strong>${data.releaseEvidenceEligible ? 'Release evidence eligible' : 'Iteration evidence only'}</strong><span>${escapeHtml(data.evidenceLevel || 'Evidence level not classified')} · ${data.pass ? 'reported pass' : 'gate not passed'}</span></div>${pill(data.releaseEvidenceEligible ? 'eligible' : 'not-eligible', data.releaseEvidenceEligible ? 'good' : 'warn')}</div>
    <div class="evidence-grid">
      ${evidencePanel('Provenance', `<ul class="stack-list"><li><span>Dataset digest</span><small><code>${shortDigest(data.datasetDigest)}</code></small></li><li><span>Effective revision</span><small><code>${shortDigest(data.effectiveRevisionDigest)}</code></small></li><li><span>Prompt stored in report response</span><small>${String(data.promptStored)}</small></li></ul>`, 'Revision-bound')}
      ${evidencePanel('Composition', `<ul class="stack-list">${aggregateRows(data.composition)}</ul>`, 'Typed cases')}
      ${evidencePanel('Holdout', `<ul class="stack-list">${aggregateRows(data.holdout, 'No holdout evidence')}</ul>`, evidenceTone(data.holdout))}
      ${evidencePanel('Leakage review', `<ul class="stack-list">${aggregateRows(data.leakage, 'No leakage review')}</ul>`, evidenceTone(data.leakage))}
      ${evidencePanel('Baseline comparison', `<ul class="stack-list">${aggregateRows(data.baselineComparison, 'No baseline comparison')}</ul>`, evidenceTone(data.baselineComparison))}
      ${evidencePanel('Open evidence issues', issues.length ? `<ul class="issue-list">${issues.map(item => `<li>${escapeHtml(humanize(item))}</li>`).join('')}</ul>` : '<p class="callout good">No evidence issue was reported for this revision.</p>', `${issues.length} issue${issues.length === 1 ? '' : 's'}`)}
    </div>`;
}

function evidencePanel(title, body, label) { return `<section class="panel"><div class="panel-head"><h2>${escapeHtml(title)}</h2><span>${escapeHtml(label)}</span></div><div class="panel-body">${body}</div></section>`; }
function evidenceTone(value) { return value && Object.keys(value).length ? 'Recorded' : 'Missing'; }

async function loadEvalSuite(ctx, session, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const input = form.querySelector('[type="file"]');
  const file = input.files?.[0];
  if (!file) return;
  const status = document.querySelector('#eval-review-status');
  if (file.size > 500 * 1024) {
    input.value = '';
    status.innerHTML = '<p class="callout spaced-callout">The suite exceeds the 500 KiB eval-suite/v3 browser review limit. Use the local CLI after reviewing it outside the browser. Legacy v2 remains limited to 60 KiB.</p>';
    return;
  }
  button.disabled = true;
  button.textContent = 'Reading locally…';
  try {
    const text = await file.text();
    input.value = '';
    clearReview(session);
    const header = parseJsonHeader(text);
    if (header?.kind === 'skillmap.eval-suite' && header?.schemaVersion === 3) {
      session.reviewMode = 'v3';
      const parsed = parseEvalSuiteV3(text);
      await resolveImportedBaselineRevision(ctx, session.catalogs, parsed);
      session.review = createEvalV3ReviewState(parsed);
      status.innerHTML = '<p class="callout good spaced-callout"><strong>eval-suite/v3 loaded in ephemeral memory.</strong><br>Review the exact qualified identities, provenance, historical baseline, timestamps, and canonical digests before import.</p>';
    } else {
      session.reviewMode = 'v2';
      session.review = createEvalReviewState(parseEvalReviewSuite(text));
      status.innerHTML = '<p class="callout spaced-callout"><strong>Legacy v2 loaded as candidate-only migration input.</strong><br>It may be reviewed or imported for iteration, but it cannot authorize a release claim. Convert every display-name label to one qualified skill ID to prepare a v3 draft.</p>';
    }
    renderReviewEditor(ctx, session);
  } catch (error) {
    input.value = '';
    clearReview(session);
    status.innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.safeMessage || error.message || 'The eval suite could not be reviewed.')}</p>`;
    document.querySelector('#eval-review-root').replaceChildren();
  } finally {
    button.disabled = false;
    button.textContent = 'Open local review';
  }
}

async function resolveImportedBaselineRevision(ctx, catalogs, suite) {
  const targetRevisionId = suite?.baseline?.provenance?.sourceRevision?.revisionId;
  if (!targetRevisionId || catalogs.revisions.some(item => item?.revision?.revisionId === targetRevisionId)) return;
  let cursor = catalogs.revisionCatalogNextCursor;
  let hasMore = catalogs.revisionCatalogHasMore;
  for (let page = 0; page < 190 && hasMore && cursor; page += 1) {
    const data = await ctx.api(`/api/v1/state/revisions?limit=50&cursor=${encodeURIComponent(cursor)}`);
    const match = (data.items || []).find(item => item?.revision?.revisionId === targetRevisionId);
    if (match) {
      catalogs.revisions.push(match);
      return;
    }
    cursor = data.nextCursor || null;
    hasMore = data.hasMore === true && Boolean(cursor);
  }
}

function parseJsonHeader(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function renderReviewEditor(ctx, session) {
  if (session.reviewMode === 'v3') return renderV3ReviewEditor(ctx, session);
  return renderLegacyReviewEditor(ctx, session);
}

function renderLegacyReviewEditor(ctx, session) {
  const state = session.review;
  if (!state?.suite) return;
  const summary = summarizeEvalReview(state);
  const page = evalReviewPage(state);
  const root = document.querySelector('#eval-review-root');
  root.innerHTML = `<section class="eval-review" aria-labelledby="eval-review-heading">
    <div class="panel-head eval-review-head"><div><h2 id="eval-review-heading" tabindex="-1">Legacy v2 migration review</h2><span>Page ${page.page + 1} of ${page.pageCount} · ${page.total} case${page.total === 1 ? '' : 's'}</span></div>${pill('candidate-only', 'warn')}</div>
    <div class="eval-authority-note legacy"><strong>Display-name labels are not release authority.</strong><span>These counts are migration diagnostics only. A release-capable suite must use qualified skill IDs, per-case provenance, canonical digests, and a replayable historical RevisionRef in eval-suite/v3.</span></div>
    <div class="eval-review-summary" aria-live="polite">
      ${reviewMetric('Release-counted', summary.releaseCounted, 150, summary.quotas.releaseCounted.met)}
      ${reviewMetric('Implicit natural', summary.counts['implicit-natural'], 100, summary.quotas.implicitNatural.met)}
      ${reviewMetric('Multi-skill', summary.counts['multi-skill'], 25, summary.quotas.multiSkill.met)}
      ${reviewMetric('Negative / near-miss', summary.counts['negative-near-miss'], 25, summary.quotas.negativeNearMiss.met)}
      ${reviewMetric('Frozen holdout', summary.releaseHoldout, summary.requiredHoldout, summary.quotas.holdout.met)}
      ${reviewMetric('Disjoint label issues', summary.overlapCases, 0, summary.overlapCases === 0, true)}
    </div>
    ${reviewWarnings(summary)}
    ${legacyMigrationGuidance(session)}
    <form id="eval-review-form" autocomplete="off">
      <div class="eval-case-list">${page.items.map((item, offset) => evalCaseEditor(item, page.start + offset)).join('')}</div>
      <nav class="eval-pagination" aria-label="Eval review pages"><button id="eval-page-previous" class="quiet-button" type="button" ${page.page === 0 ? 'disabled' : ''}>Previous cases</button><span>Cases ${page.total ? page.start + 1 : 0}–${Math.min(page.start + page.items.length, page.total)} of ${page.total}</span><button id="eval-page-next" class="quiet-button" type="button" ${page.page + 1 >= page.pageCount ? 'disabled' : ''}>Next cases</button></nav>
      <div class="eval-import-confirmation"><label class="confirmation-check"><input id="eval-review-confirm" type="checkbox" required><span>I understand this legacy v2 import is candidate-only. It creates an unapproved revision and cannot become release authority without an explicit v3 migration and contextual replay.</span></label><button id="eval-review-import" class="button" type="submit" ${summary.canImport && ctx.state.connected ? '' : 'disabled'}>Import legacy v2 candidate</button></div>
      <div id="eval-import-result" aria-live="polite"></div>
    </form>
  </section>`;
  root.querySelector('#eval-review-form').addEventListener('change', event => updateEditorField(ctx, session, event));
  root.querySelector('#eval-review-form').addEventListener('submit', event => importReviewedSuite(ctx, session, event));
  root.querySelector('#eval-page-previous').addEventListener('click', () => { setEvalReviewPage(state, page.page - 1); renderLegacyReviewEditor(ctx, session); document.querySelector('#eval-review-heading')?.focus(); });
  root.querySelector('#eval-page-next').addEventListener('click', () => { setEvalReviewPage(state, page.page + 1); renderLegacyReviewEditor(ctx, session); document.querySelector('#eval-review-heading')?.focus(); });
  root.querySelector('#eval-create-v3-draft')?.addEventListener('click', () => migrateLegacyDraft(ctx, session));
}

function legacyMigrationGuidance(session) {
  const preview = legacyV2MigrationPreview(session.review.suite, session.catalogs.skills);
  const rows = preview.mappings.slice(0, 30).map(item => `<li><span>${escapeHtml(item.name)}</span><small>${item.status === 'mapped' ? `<code>${escapeHtml(item.skillId)}</code>` : item.status === 'ambiguous' ? `${item.matches.length} variants · choose a canonical qualified identity in Skills first` : 'No approved qualified identity found'}</small></li>`).join('');
  const hidden = Math.max(0, preview.mappings.length - 30);
  return `<section class="eval-migration-panel" aria-labelledby="eval-migration-heading"><div><h3 id="eval-migration-heading">Qualified-ID migration</h3><p>${preview.canConvert ? 'Every legacy label maps uniquely in the approved skill catalog. Create an in-memory v3 draft, then add the missing reviewer and historical baseline evidence.' : 'Resolve every missing or ambiguous display name before conversion. The editor never guesses between variants or drops an unresolved label.'}</p></div>${rows ? `<ul class="stack-list eval-mapping-list">${rows}${hidden ? `<li><span>${hidden} more mapping${hidden === 1 ? '' : 's'}</span><small>Review with the local CLI</small></li>` : ''}</ul>` : '<p class="callout">No display-name labels were found, or the approved skill catalog is unavailable.</p>'}<button id="eval-create-v3-draft" class="button primary" type="button" ${preview.canConvert && session.catalogs.skillCatalogAvailable ? '' : 'disabled'}>Create v3 draft in memory</button></section>`;
}

function migrateLegacyDraft(ctx, session) {
  try {
    const suite = migrateEvalSuiteV2ToV3(session.review.suite, session.catalogs.skills);
    disposeEvalReviewState(session.review);
    session.reviewMode = 'v3';
    session.review = createEvalV3ReviewState(suite);
    document.querySelector('#eval-review-status').innerHTML = '<p class="callout good spaced-callout"><strong>Qualified labels migrated into a v3 draft.</strong><br>No file or revision was written. Add the independent reviewer, verify each case provenance record, and select the exact historical baseline RevisionRef before import.</p>';
    renderV3ReviewEditor(ctx, session);
    document.querySelector('#eval-review-heading')?.focus();
  } catch (error) {
    document.querySelector('#eval-review-status').innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.message || 'The legacy labels could not be migrated safely.')}</p>`;
  }
}

function renderV3ReviewEditor(ctx, session) {
  const state = session.review;
  if (!state?.suite) return;
  const summary = summarizeEvalV3Review(state, session.catalogs);
  const page = evalV3ReviewPage(state);
  const suite = state.suite;
  const root = document.querySelector('#eval-review-root');
  root.innerHTML = `<section class="eval-review eval-v3-review" aria-labelledby="eval-review-heading">
    <div class="panel-head eval-review-head"><div><h2 id="eval-review-heading" tabindex="-1">eval-suite/v3 review</h2><span>Page ${page.page + 1} of ${page.pageCount} · ${page.total} case${page.total === 1 ? '' : 's'}</span></div>${pill(summary.canImport ? 'contract complete' : 'review blocked', summary.canImport ? 'good' : 'warn')}</div>
    <div class="eval-authority-note"><strong>Release-authoritative format, not a release approval.</strong><span>Import preserves this exact local-sensitive v3 document in a new unapproved revision. Release eligibility is granted only after the isolated runner resolves the historical artifact and deterministically replays both registries.</span></div>
    <div class="eval-review-summary" aria-live="polite">
      ${reviewMetric('Release-counted', summary.releaseCounted, 150, summary.quotas.releaseCounted.met)}
      ${reviewMetric('Implicit natural', summary.counts['implicit-natural'], 100, summary.quotas.implicitNatural.met)}
      ${reviewMetric('Multi-skill', summary.counts['multi-skill'], 25, summary.quotas.multiSkill.met)}
      ${reviewMetric('Negative / near-miss', summary.counts['negative-near-miss'], 25, summary.quotas.negativeNearMiss.met)}
      ${reviewMetric('Frozen holdout', summary.releaseHoldout, summary.requiredHoldout, summary.quotas.holdout.met)}
      ${reviewMetric('Blocking issues', summary.blocking.length, 0, summary.blocking.length === 0, true)}
    </div>
    ${reviewWarnings(summary)}
    ${v3CatalogReference(session.catalogs)}
    <form id="eval-v3-review-form" autocomplete="off">
      <section class="eval-v3-section" aria-labelledby="eval-v3-identity-heading"><div class="eval-v3-section-head"><div><h3 id="eval-v3-identity-heading">Suite identity</h3><p>Opaque identity and human label; updatedAt changes whenever this in-memory editor changes a field.</p></div>${pill('v3')}</div><div class="eval-v3-form-grid">
        ${v3TextField('Suite ID', 'suiteId', suite.suiteId, 'evalsuite_ plus 8–80 URL-safe characters', 90)}
        ${v3TextField('Suite name', 'name', suite.name, '1–200 printable characters', 200)}
        ${v3TextField('Suite created at', 'createdAt', suite.createdAt, 'UTC, for example 2026-07-11T10:00:00.000Z', 40)}
        <div class="field"><label>Suite updated at<input value="${escapeHtml(suite.updatedAt)}" readonly></label><small>Managed locally; included in payloadDigest, excluded from datasetDigest.</small></div>
        <div class="field eval-v3-fixed"><span>Redaction classification</span><strong>${escapeHtml(humanize(suite.redactionClassification || 'missing'))}</strong><small>Must remain local-sensitive because cases contain private prompts and labels.</small></div>
      </div></section>
      <section class="eval-v3-section" aria-labelledby="eval-v3-provenance-heading"><div class="eval-v3-section-head"><div><h3 id="eval-v3-provenance-heading">Dataset provenance</h3><p>Real operator assertions. Synthetic provenance is inspectable but cannot satisfy the release trust boundary.</p></div>${pill('holdout frozen', 'warn')}</div><div class="eval-v3-form-grid">
        ${v3TextField('Label author', 'provenance.labelAuthor', suite.provenance.labelAuthor, 'Person or stable local reviewer identity', 200)}
        ${v3TextField('Reviewed by', 'provenance.reviewedBy', suite.provenance.reviewedBy, 'Independent reviewer identity', 200)}
        ${v3SelectField('Source class', 'provenance.sourceClass', EVAL_V3_SOURCE_CLASSES, suite.provenance.sourceClass)}
        ${v3TextField('Dataset created at', 'provenance.createdAt', suite.provenance.createdAt, 'Real UTC timestamp', 40)}
        ${v3TextField('Holdout frozen at', 'provenance.holdoutFrozenAt', suite.provenance.holdoutFrozenAt, 'Must follow every case label review', 40)}
        ${v3TextField('Dataset reviewed at', 'provenance.reviewedAt', suite.provenance.reviewedAt, 'Must follow the baseline replay', 40)}
        <div class="field eval-v3-fixed"><span>Deduplication</span><strong>${escapeHtml(humanize(suite.provenance.deduplicationResult || 'missing'))}</strong><small>Must be passed; duplicate normalized prompts still block locally.</small></div>
        <div class="field eval-v3-fixed"><span>Holdout state</span><strong>${suite.provenance.holdoutFrozen === true ? 'Frozen' : 'Not frozen'}</strong><small>Must be frozen; the ordered case projection is digest-bound.</small></div>
      </div></section>
      ${v3BaselineEditor(suite, session.catalogs)}
      ${v3DigestReceipt(suite)}
      <section class="eval-v3-section" aria-labelledby="eval-v3-cases-heading"><div class="eval-v3-section-head"><div><h3 id="eval-v3-cases-heading">Frozen cases</h3><p>Prompts remain local-sensitive in this in-memory draft. Expected and avoid labels are exact qualified IDs, never display names.</p></div>${pill(`${page.total} cases`)}</div><div class="eval-case-list">${page.items.map((item, offset) => evalV3CaseEditor(item, page.start + offset)).join('')}</div></section>
      <nav class="eval-pagination" aria-label="Eval v3 review pages"><button id="eval-v3-page-previous" class="quiet-button" type="button" ${page.page === 0 ? 'disabled' : ''}>Previous cases</button><span>Cases ${page.total ? page.start + 1 : 0}–${Math.min(page.start + page.items.length, page.total)} of ${page.total}</span><button id="eval-v3-page-next" class="quiet-button" type="button" ${page.page + 1 >= page.pageCount ? 'disabled' : ''}>Next cases</button></nav>
      <div class="eval-import-confirmation"><label class="confirmation-check"><input id="eval-v3-review-confirm" type="checkbox" required><span>I reviewed every qualified label, case provenance record, timestamp, frozen membership, historical RevisionRef, and replay metric. Import creates an unapproved local-sensitive revision; it does not itself prove or approve release eligibility.</span></label><button id="eval-v3-review-import" class="button primary" type="submit" ${summary.canImport && ctx.state.connected ? '' : 'disabled'}>Import exact v3 suite</button></div>
      <div id="eval-v3-import-result" aria-live="polite"></div>
    </form>
  </section>`;
  root.querySelector('#eval-v3-review-form').addEventListener('change', event => updateV3EditorField(ctx, session, event));
  root.querySelector('#eval-v3-review-form').addEventListener('submit', event => importV3Suite(ctx, session, event));
  root.querySelector('#eval-v3-page-previous').addEventListener('click', () => { setEvalV3ReviewPage(state, page.page - 1); renderV3ReviewEditor(ctx, session); document.querySelector('#eval-review-heading')?.focus(); });
  root.querySelector('#eval-v3-page-next').addEventListener('click', () => { setEvalV3ReviewPage(state, page.page + 1); renderV3ReviewEditor(ctx, session); document.querySelector('#eval-review-heading')?.focus(); });
  void refreshV3DigestReceipt(session, state.digestVersion);
}

function v3TextField(label, path, value, help, maxlength) {
  return `<div class="field"><label>${escapeHtml(label)}<input data-v3-suite-field="${escapeHtml(path)}" value="${escapeHtml(value)}" maxlength="${maxlength}" spellcheck="false" autocomplete="off"></label><small>${escapeHtml(help)}</small></div>`;
}

function v3SelectField(label, path, values, selected) {
  return `<div class="field"><label>${escapeHtml(label)}<select data-v3-suite-field="${escapeHtml(path)}">${selectOptions(values, selected)}</select></label></div>`;
}

function v3BaselineEditor(suite, catalogs) {
  const revisionId = suite.baseline.provenance.sourceRevision?.revisionId || '';
  const candidates = catalogs.revisions.filter(item => item?.routingApprovalRecorded === true
    && item?.revision?.revisionId !== catalogs.currentRevisionId
    && item?.revision?.effectiveDigest
    && item?.revision?.effectiveRevisionDigest);
  return `<section class="eval-v3-section" aria-labelledby="eval-v3-baseline-heading"><div class="eval-v3-section-head"><div><h3 id="eval-v3-baseline-heading">Historical approved baseline</h3><p>Select the exact immutable RevisionRef used for replay, then enter metrics produced from this same frozen case set. The browser does not pretend to possess the historical effective artifact; contextual run validation recomputes these values.</p></div>${pill(revisionId ? 'revision selected' : 'selection required', revisionId ? 'good' : 'warn')}</div><div class="eval-v3-baseline-grid">
    <div class="field baseline-revision-field"><label>Approved historical RevisionRef<select data-v3-suite-field="baseline.provenance.sourceRevision"><option value="">Choose an approval-recorded historical revision…</option>${candidates.map(item => `<option value="${escapeHtml(item.revision.revisionId)}" ${item.revision.revisionId === revisionId ? 'selected' : ''}>Revision ${Number(item.sequence).toLocaleString()} · ${escapeHtml(item.revision.revisionId.slice(0, 28))}</option>`).join('')}</select></label><small>Current and verified-but-unapproved revisions are excluded. Both effective digests and a durable approval receipt must be present.</small></div>
    ${v3NumberField('Top-1 rate', 'baseline.top1Rate', suite.baseline.top1Rate, 0, 1, '0.0001')}
    ${v3NumberField('Top-3 rate', 'baseline.top3Rate', suite.baseline.top3Rate, 0, 1, '0.0001')}
    ${v3NumberField('Avoid hits', 'baseline.avoidHits', suite.baseline.avoidHits, 0, 1000000, '1')}
    ${v3NumberField('Abstention rate', 'baseline.abstentionRate', suite.baseline.abstentionRate, 0, 1, '0.0001')}
    ${v3NumberField('Mean advisory bytes', 'baseline.meanAdvisoryBytes', suite.baseline.meanAdvisoryBytes, 0, 1048576, '0.01')}
    ${v3TextField('Replay completed at', 'baseline.provenance.completedAt', suite.baseline.provenance.completedAt, 'Real UTC timestamp after holdout freeze', 40)}
  </div>${revisionId ? `<dl class="eval-baseline-revision"><div><dt>Revision ID</dt><dd><code>${escapeHtml(revisionId)}</code></dd></div><div><dt>Exact effective digest</dt><dd><code>${escapeHtml(suite.baseline.provenance.sourceRevision?.effectiveDigest || 'missing')}</code></dd></div><div><dt>Semantic effective digest</dt><dd><code>${escapeHtml(suite.baseline.provenance.sourceRevision?.effectiveRevisionDigest || 'missing')}</code></dd></div></dl>` : ''}</section>`;
}

function v3NumberField(label, path, value, minimum, maximum, step) {
  return `<div class="field"><label>${escapeHtml(label)}<input data-v3-suite-field="${escapeHtml(path)}" type="number" min="${minimum}" max="${maximum}" step="${step}" value="${Number.isFinite(value) ? value : ''}" inputmode="decimal"></label></div>`;
}

function v3DigestReceipt(suite) {
  return `<section class="eval-v3-digests" aria-labelledby="eval-v3-digests-heading"><div><h3 id="eval-v3-digests-heading">Canonical digest receipt</h3><p>Computed in this browser with sorted-key canonical JSON and SHA-256. The payload projection excludes only the top-level payload/transport digest fields, matching the runtime contract.</p></div><dl><div><dt>Frozen case set</dt><dd><code id="eval-v3-case-digest">${escapeHtml(suite.provenance.frozenCaseSetDigest)}</code></dd></div><div><dt>Dataset</dt><dd><code id="eval-v3-dataset-digest">${escapeHtml(suite.datasetDigest)}</code></dd></div><div><dt>Payload</dt><dd><code id="eval-v3-payload-digest">${escapeHtml(suite.payloadDigest)}</code></dd></div></dl><div id="eval-v3-digest-status" class="microcopy" role="status">Recomputing canonical digests…</div></section>`;
}

function v3CatalogReference(catalogs) {
  if (!catalogs.skills.length) return '';
  return `<details class="eval-skill-catalog"><summary>Approved qualified skill reference (${catalogs.skills.length})</summary><div class="table-wrap"><table><thead><tr><th>Display name</th><th>Qualified ID</th><th>Routing</th></tr></thead><tbody>${catalogs.skills.slice(0, 500).map(skill => `<tr><td>${escapeHtml(skill.displayName || 'unnamed')}</td><td><code>${escapeHtml(skill.skillId)}</code></td><td>${escapeHtml(skill.routeEligible ? 'implicit approved' : skill.qualifiedExplicitAllowed ? 'qualified explicit only' : 'blocked')}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function evalV3CaseEditor(item, index) {
  return `<fieldset class="eval-case eval-v3-case" data-case-index="${index}"><legend>Case ${index + 1} · <code>${escapeHtml(item.caseId || 'ID required')}</code></legend><div class="eval-v3-case-grid">
    <div class="field"><label>Case ID<input data-v3-case-index="${index}" data-v3-case-field="caseId" value="${escapeHtml(item.caseId)}" maxlength="109" spellcheck="false"></label></div>
    <div class="field"><label>Primary case type<select data-v3-case-index="${index}" data-v3-case-field="primaryCaseType">${selectOptions(EVAL_V3_CASE_TYPES, item.primaryCaseType)}</select></label></div>
    <div class="field"><label>Membership<select data-v3-case-index="${index}" data-v3-case-field="membership">${selectOptions(EVAL_V3_MEMBERSHIPS, item.membership)}</select></label></div>
    <div class="field"><label>Optional qualifiedSkillId<input data-v3-case-index="${index}" data-v3-case-field="qualifiedSkillId" value="${escapeHtml(item.qualifiedSkillId || '')}" maxlength="46" spellcheck="false"></label><small>Explicit cases only; must also appear in expected IDs.</small></div>
    <div class="field eval-v3-prompt-field"><label>Local-sensitive prompt<textarea data-v3-case-index="${index}" data-v3-case-field="prompt" rows="4" maxlength="32768" spellcheck="true">${escapeHtml(item.prompt)}</textarea></label><small>Maximum 32,768 UTF-8 bytes; never copied into route history or browser storage.</small></div>
    <div class="field"><label>Expected qualified skill IDs<textarea data-v3-case-index="${index}" data-v3-case-field="expectedSkillIds" rows="4" maxlength="4700" spellcheck="false">${escapeHtml(skillIdsToInput(item.expectedSkillIds))}</textarea></label><small>One exact <code>sk_…</code> ID per line.</small></div>
    <div class="field"><label>Avoid qualified skill IDs<textarea data-v3-case-index="${index}" data-v3-case-field="avoidSkillIds" rows="4" maxlength="4700" spellcheck="false">${escapeHtml(skillIdsToInput(item.avoidSkillIds))}</textarea></label><small>Must be disjoint from expected IDs.</small></div>
  </div><div class="eval-v3-provenance-strip"><strong>Per-case label provenance</strong>
    <div class="field"><label>Author<input data-v3-case-index="${index}" data-v3-case-field="labelProvenance.author" value="${escapeHtml(item.labelProvenance.author)}" maxlength="200"></label></div>
    <div class="field"><label>Source class<select data-v3-case-index="${index}" data-v3-case-field="labelProvenance.sourceClass">${selectOptions(EVAL_V3_SOURCE_CLASSES, item.labelProvenance.sourceClass)}</select></label></div>
    <div class="field"><label>Created at<input data-v3-case-index="${index}" data-v3-case-field="labelProvenance.createdAt" value="${escapeHtml(item.labelProvenance.createdAt)}" maxlength="40" spellcheck="false"></label></div>
    <div class="field"><label>Reviewed at<input data-v3-case-index="${index}" data-v3-case-field="labelProvenance.reviewedAt" value="${escapeHtml(item.labelProvenance.reviewedAt)}" maxlength="40" spellcheck="false"></label></div>
  </div></fieldset>`;
}

function updateV3EditorField(ctx, session, event) {
  const suiteControl = event.target.closest('[data-v3-suite-field]');
  const caseControl = event.target.closest('[data-v3-case-index][data-v3-case-field]');
  if (!suiteControl && !caseControl) return;
  try {
    if (suiteControl) updateEvalV3SuiteField(session.review, suiteControl.dataset.v3SuiteField, suiteControl.value, session.catalogs.revisions);
    else updateEvalV3Case(session.review, Number(caseControl.dataset.v3CaseIndex), caseControl.dataset.v3CaseField, caseControl.value);
    const focus = suiteControl
      ? `[data-v3-suite-field="${CSS.escape(suiteControl.dataset.v3SuiteField)}"]`
      : `[data-v3-case-index="${Number(caseControl.dataset.v3CaseIndex)}"][data-v3-case-field="${CSS.escape(caseControl.dataset.v3CaseField)}"]`;
    renderV3ReviewEditor(ctx, session);
    document.querySelector(focus)?.focus();
  } catch (error) {
    document.querySelector('#eval-v3-import-result').innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.message || 'The field could not be updated.')}</p>`;
  }
}

async function refreshV3DigestReceipt(session, version) {
  const state = session.review;
  if (session.reviewMode !== 'v3' || !state?.suite) return;
  try {
    const digests = await refreshEvalSuiteV3Digests(state.suite, { canApply: () => session.review === state && state.digestVersion === version });
    if (!digests.applied || session.review !== state || state.digestVersion !== version) return;
    document.querySelector('#eval-v3-case-digest').textContent = digests.caseSetDigest;
    document.querySelector('#eval-v3-dataset-digest').textContent = digests.datasetDigest;
    document.querySelector('#eval-v3-payload-digest').textContent = digests.payloadDigest;
    document.querySelector('#eval-v3-digest-status').textContent = 'Canonical SHA-256 digests are current for this in-memory draft.';
  } catch (error) {
    if (session.review !== state || state.digestVersion !== version) return;
    for (const id of ['#eval-v3-case-digest', '#eval-v3-dataset-digest', '#eval-v3-payload-digest']) {
      const output = document.querySelector(id);
      if (output) output.textContent = 'not computed';
    }
    document.querySelector('#eval-v3-digest-status').textContent = error.message || 'Canonical digest computation failed.';
  }
}

async function importV3Suite(ctx, session, event) {
  event.preventDefault();
  const state = session.review;
  const result = document.querySelector('#eval-v3-import-result');
  if (!state?.suite || !event.currentTarget.querySelector('#eval-v3-review-confirm').checked) return;
  const button = event.currentTarget.querySelector('#eval-v3-review-import');
  const expectedRevision = ctx.currentRevisionId();
  if (!ctx.state.connected || !expectedRevision) {
    result.innerHTML = '<p class="callout spaced-callout">Reconnect to a current workspace revision before importing.</p>';
    return;
  }
  button.disabled = true;
  button.textContent = 'Computing and importing…';
  const controls = [...event.currentTarget.elements];
  for (const control of controls) control.disabled = true;
  const draftVersion = state.digestVersion;
  try {
    const finalized = await finalizeEvalSuiteV3Snapshot(state.suite);
    if (session.review !== state || state.digestVersion !== draftVersion) throw new Error('The in-memory draft changed while its digests were computed. Review the latest values and import again.');
    const importState = { ...state, suite: finalized.suite };
    const summary = summarizeEvalV3Review(importState, session.catalogs);
    if (!summary.canImport) throw new Error(`Resolve ${summary.blocking.length} blocking v3 review issue${summary.blocking.length === 1 ? '' : 's'} before import.`);
    const requestBytes = new TextEncoder().encode(JSON.stringify({ suite: finalized.suite, expectedRevision })).length;
    if (requestBytes > 512 * 1024) throw new Error('The exact v3 import request exceeds the connector’s 512 KiB eval-import bound. Save and import the reviewed JSON with the local CLI.');
    if (session.review !== state || state.digestVersion !== draftVersion) throw new Error('The in-memory draft changed before submission. Review the latest values and import again.');
    const imported = await ctx.api('/api/v1/evals/import', { body: { suite: finalized.suite, expectedRevision } });
    const count = Number(imported.cases || finalized.suite.cases.length);
    clearReview(session);
    document.querySelector('#eval-suite-file').value = '';
    document.querySelector('#eval-review-status').innerHTML = `<p class="callout good spaced-callout"><strong>${count} v3 cases imported as an unapproved revision.</strong><br>The exact qualified suite passed structural and digest validation. Private draft data was cleared from this page. Approve the intended revision separately, then run the isolated contextual replay.</p>`;
    document.querySelector('#eval-review-root').replaceChildren();
    ctx.invalidate();
    ctx.toast(`${count} eval-suite/v3 cases imported. Approval and contextual replay are still required.`);
    await ctx.refreshWorkspaceState(false);
  } catch (error) {
    result.innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.safeMessage || error.message || 'The exact v3 suite was rejected.')}</p>`;
    button.disabled = false;
    button.textContent = 'Import exact v3 suite';
    for (const control of controls) control.disabled = false;
  }
}

function reviewMetric(label, value, required, met, inverse = false) {
  const requirement = inverse ? `target ${required}` : `minimum ${required}`;
  return `<div class="eval-review-metric ${met ? 'met' : ''}"><span>${escapeHtml(label)}</span><strong>${Number(value)}</strong><small>${requirement} · ${met ? 'met' : 'not met'}</small></div>`;
}

function reviewWarnings(summary) {
  const items = [...summary.blocking.slice(0, 20), ...summary.warnings.slice(0, 20)];
  if (!items.length) return '<p class="callout good eval-review-notice">No structural, leakage, quota, holdout, provenance, or baseline warning was detected.</p>';
  const hidden = Math.max(0, summary.blocking.length + summary.warnings.length - items.length);
  return `<div class="callout eval-review-notice"><strong>${summary.blocking.length} blocking issue${summary.blocking.length === 1 ? '' : 's'} · ${summary.warnings.length} evidence warning${summary.warnings.length === 1 ? '' : 's'}</strong><ul class="issue-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}${hidden ? `<li>${hidden} additional issue${hidden === 1 ? '' : 's'} not shown in this bounded summary.</li>` : ''}</ul></div>`;
}

function evalCaseEditor(item, index) {
  return `<fieldset class="eval-case" data-case-index="${index}"><legend>Case ${index + 1}${item.id ? ` · ${escapeHtml(item.id)}` : ''}</legend><div class="eval-case-prompt"><span>Local-sensitive prompt</span><p>${escapeHtml(item.prompt)}</p></div><div class="eval-case-fields"><div class="field"><label>Primary case type<select data-case-index="${index}" data-field="primaryCaseType">${selectOptions(EVAL_CASE_TYPES, item.primaryCaseType)}</select></label></div><div class="field"><label>Membership<select data-case-index="${index}" data-field="membership">${selectOptions(EVAL_MEMBERSHIPS, item.membership)}</select></label></div><div class="field"><label>Expected labels<textarea data-case-index="${index}" data-field="expected" rows="3" maxlength="20100" spellcheck="false" aria-describedby="eval-label-help-${index}">${escapeHtml(labelsToInput(item.expected))}</textarea></label><small id="eval-label-help-${index}">One exact display name per line; expected and avoid sets must be disjoint.</small></div><div class="field"><label>Avoid labels<textarea data-case-index="${index}" data-field="avoid" rows="3" maxlength="20100" spellcheck="false">${escapeHtml(labelsToInput(item.avoid))}</textarea></label><small>Negative / near-miss cases require at least one avoid label.</small></div></div></fieldset>`;
}

function selectOptions(values, selected) {
  return `<option value="" ${values.includes(selected) ? '' : 'selected'}>Choose…</option>${values.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(humanize(value))}</option>`).join('')}`;
}

function updateEditorField(ctx, session, event) {
  const control = event.target.closest('[data-case-index][data-field]');
  if (!control || !session.review?.suite) return;
  const index = Number(control.dataset.caseIndex);
  const field = control.dataset.field;
  const value = field === 'expected' || field === 'avoid' ? parseLabelInput(control.value) : control.value;
  updateEvalReviewCase(session.review, index, { [field]: value });
  renderReviewEditor(ctx, session);
  document.querySelector(`[data-case-index="${index}"][data-field="${field}"]`)?.focus();
}

async function importReviewedSuite(ctx, session, event) {
  event.preventDefault();
  const state = session.review;
  const result = document.querySelector('#eval-import-result');
  if (!state?.suite) return;
  const summary = summarizeEvalReview(state);
  if (!summary.canImport) {
    result.innerHTML = '<p class="callout spaced-callout">Resolve the structural prompt and label issues before importing. Migration warnings remain visible; this v2 candidate cannot become release evidence.</p>';
    return;
  }
  if (!event.currentTarget.querySelector('#eval-review-confirm').checked) return;
  const button = event.currentTarget.querySelector('#eval-review-import');
  const expectedRevision = ctx.currentRevisionId();
  if (!ctx.state.connected || !expectedRevision) {
    result.innerHTML = '<p class="callout spaced-callout">Reconnect to a current workspace revision before importing.</p>';
    return;
  }
  button.disabled = true;
  button.textContent = 'Importing…';
  try {
    const imported = await ctx.api('/api/v1/evals/import', { body: { suite: state.suite, expectedRevision } });
    const count = Number(imported.cases || state.suite.evals.length);
    clearReview(session);
    document.querySelector('#eval-suite-file').value = '';
    document.querySelector('#eval-review-status').innerHTML = `<p class="callout good spaced-callout">${count} legacy v2 cases were imported as an unapproved candidate revision. Private prompts and labels were cleared from this page. Migrate to eval-suite/v3 before making any release evidence claim.</p>`;
    document.querySelector('#eval-review-root').replaceChildren();
    ctx.invalidate();
    ctx.toast(`${count} legacy v2 candidate cases imported. A qualified v3 migration is still required.`);
    await ctx.refreshWorkspaceState(false);
  } catch (error) {
    result.innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.safeMessage || error.message || 'The eval suite was rejected.')}</p>`;
    button.disabled = false;
    button.textContent = 'Import legacy v2 candidate';
  }
}

function clearReview(session) {
  if (session.reviewMode === 'v3') disposeEvalV3ReviewState(session.review);
  else if (session.review) disposeEvalReviewState(session.review);
  session.review = null;
  session.reviewMode = null;
}
