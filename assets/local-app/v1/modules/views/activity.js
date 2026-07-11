import { escapeHtml, humanize, pageHead, pill, revisionLine, safeDate, shortDigest } from '../render.js';
import { clearPendingCancellationKey, hasPrivateMetadata, pendingCancellationKey } from '../state.js';

const PRIVATE_RECEIPT_KEY = /prompt|body|path|secret|token|password|command|stdout|stderr|diff/i;
const SECRET_RECEIPT_VALUE = /CANARY_|\bsk_(?:live|test|proj)_[A-Za-z0-9_-]{8,}\b|\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{8,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bAKIA[0-9A-Z]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i;

export async function renderActivity(ctx) {
  const [routesData, jobsData] = await Promise.all([ctx.api('/api/v1/routes?limit=100', { cache: false }), ctx.api('/api/v1/jobs', { cache: false })]);
  const events = routesData.events || [];
  const jobs = jobsData.items || [];
  const feedback = routesData.feedbackBacklog || { reviewedRoutes: 0, pendingRoutes: events.length, recordedFeedback: 0, outcomeCounts: {}, pendingRouteIds: events.map(event => event.routeId).slice(0, 20) };
  for (const job of jobs) if (['succeeded', 'failed', 'cancelled'].includes(job.state)) clearPendingCancellationKey(job.jobId);
  ctx.mount(`${pageHead('Activity', 'Review durable maintenance receipts and redacted route events. Raw prompts, paths, hook text, and free-form notes are excluded.')}
    <div class="section-grid"><section class="panel"><div class="panel-head"><h2>Maintenance jobs</h2><span>${jobs.length} of ${jobsData.total ?? jobs.length} loaded</span></div><div class="panel-body">${renderJobList(jobs)}</div></section>
    <section class="panel"><div class="panel-head"><h2>Route events</h2><span>${events.length} of ${routesData.total ?? events.length} loaded</span></div><div class="panel-body">${routeList(ctx, events)}</div></section></div>
    <section class="panel spaced-panel"><div class="panel-head"><h2>Feedback backlog</h2><span>${feedback.pendingRoutes || 0} pending</span></div><div class="panel-body">${feedbackBacklog(ctx, feedback)}</div></section>
    <section class="panel spaced-panel"><div class="panel-head"><h2>Operational boundaries</h2><span>Revisioned receipts</span></div><div class="panel-body"><ul class="stack-list"><li><span>Job cancellation</span><small>Idempotent · publication-safe</small></li><li><span>Route retention</span><small>90 date partitions · 10,000 retained records</small></li><li><span>Raw prompt history</span><small>Never stored</small></li></ul></div></section>
    <dialog id="cancel-job-dialog" class="confirmation-dialog" aria-labelledby="cancel-job-title"><form method="dialog"><span class="verdict blocked">Confirm</span><h2 id="cancel-job-title">Request job cancellation?</h2><p id="cancel-job-copy">The backend will prevent publication only if the job has not already committed a revision.</p><div class="dialog-receipt"><span>Job</span><code id="cancel-job-id">—</code></div><div class="form-actions"><button class="quiet-button" value="keep" type="submit">Keep job running</button><button class="button danger" value="confirm" type="submit">Request cancellation</button></div></form></dialog>`);
  const dialog = document.querySelector('#cancel-job-dialog');
  let dialogOpener = null;
  for (const button of document.querySelectorAll('.cancel-job')) button.addEventListener('click', () => {
    dialogOpener = button;
    dialog.returnValue = '';
    dialog.dataset.jobId = button.dataset.jobId;
    dialog.dataset.jobType = button.dataset.jobType;
    document.querySelector('#cancel-job-id').textContent = button.dataset.jobId;
    document.querySelector('#cancel-job-copy').textContent = `Cancel ${humanize(button.dataset.jobType)} only if it has not published. A running job may return cancellation-requested while its executor stops.`;
    dialog.showModal();
  });
  dialog.addEventListener('close', () => {
    const confirmed = dialog.returnValue === 'confirm';
    const jobId = dialog.dataset.jobId;
    dialogOpener?.focus({ preventScroll: true });
    dialogOpener = null;
    if (confirmed) void cancelJob(ctx, jobId);
  });
}

function feedbackBacklog(ctx, feedback) {
  const pending = Array.isArray(feedback.pendingRouteIds) ? feedback.pendingRouteIds.filter(value => /^[0-9a-f-]{36}$/i.test(value)).slice(0, 20) : [];
  const outcomes = feedback.outcomeCounts || {};
  return `<div class="detail-grid"><dl><div><dt>Reviewed routes</dt><dd>${Number(feedback.reviewedRoutes) || 0}</dd></div><div><dt>Pending routes</dt><dd>${Number(feedback.pendingRoutes) || 0}</dd></div><div><dt>Recorded outcomes</dt><dd>${Number(feedback.recordedFeedback) || 0}</dd></div></dl><dl><div><dt>Correct</dt><dd>${Number(outcomes.correct) || 0}</dd></div><div><dt>Wrong</dt><dd>${Number(outcomes.wrong) || 0}</dd></div><div><dt>Missing</dt><dd>${Number(outcomes.missing) || 0}</dd></div><div><dt>Unsafe</dt><dd>${Number(outcomes.unsafe) || 0}</dd></div></dl></div>${pending.length ? `<h3>Awaiting operator feedback</h3><ul class="stack-list">${pending.map(routeId => `<li><code>${escapeHtml(routeId)}</code><a class="text-link" href="${ctx.tracePermalink(routeId)}">Review trace</a></li>`).join('')}</ul>` : '<div class="empty"><strong>No feedback backlog in this page</strong><span>Every loaded route has at least one immutable operator outcome.</span></div>'}<p class="microcopy">Backlog counts are bounded to the loaded retained page. Raw prompts and comments are never included.</p>`;
}

export async function renderTraceDetail(ctx, descriptor) {
  if (!descriptor.traceId) {
    ctx.mount(`${pageHead('Activity', 'Inspect one retained redacted route event.', '<button class="quiet-button" type="button" data-route="activity">Back to activity</button>')}
      <p class="callout"><strong>TRACE_ID_INVALID</strong><br>This trace link does not contain a valid route identifier.</p>`);
    return;
  }
  const event = await ctx.api(`/api/v1/routes/${encodeURIComponent(descriptor.traceId)}`, { cache: false });
  const selectedSkillIds = Array.isArray(event.selectedSkillIds) ? event.selectedSkillIds.filter(value => /^sk_[A-Za-z0-9_-]{43}$/.test(value)).slice(0, 10) : [];
  ctx.mount(`${pageHead('Activity', 'Inspect one retained redacted route event. The URL is stable for the bounded retention window.', '<button class="quiet-button" type="button" data-route="activity">Back to activity</button><button class="quiet-button" type="button" data-route="route">Open Route Lab</button>')}
    ${revisionLine(event.revision, event.degradedCode ? 'last-known-good' : 'current')}
    <section class="panel"><div class="panel-head"><div><h2>Redacted trace</h2><span>${safeDate(event.createdAt)}</span></div>${pill(event.outcome, event.outcome === 'recommended' ? 'good' : event.outcome === 'error' || event.outcome === 'blocked' ? 'bad' : 'warn')}</div>
      <div class="panel-body"><div class="detail-grid"><dl>
        <div><dt>Contract</dt><dd><code>${escapeHtml(event.kind)} v${escapeHtml(event.schemaVersion)}</code></dd></div>
        <div><dt>Route ID</dt><dd><code>${escapeHtml(event.routeId)}</code></dd></div>
        <div><dt>Event ID</dt><dd><code>${escapeHtml(event.eventId)}</code></dd></div>
        <div><dt>Surface</dt><dd>${escapeHtml(humanize(event.surface))}</dd></div>
        <div><dt>Latency bucket</dt><dd>${escapeHtml(humanize(event.latencyBucket))}</dd></div>
      </dl><dl>
        <div><dt>Decision digest</dt><dd><code>${shortDigest(event.decisionDigest || '')}</code></dd></div>
        <div><dt>Payload digest</dt><dd><code>${shortDigest(event.payloadDigest || '')}</code></dd></div>
        <div><dt>Current revision</dt><dd><code>${escapeHtml(event.currentRevision?.revisionId || 'unavailable')}</code></dd></div>
        <div><dt>Prompt stored</dt><dd>${event.promptStored === false ? 'No' : 'Unexpected'}</dd></div>
      </dl></div></div>
    </section>
    <section class="panel spaced-panel"><div class="panel-head"><h2>Immutable revision binding</h2><span>Opaque identifiers only</span></div><div class="panel-body"><div class="detail-grid"><dl>
      <div><dt>Workspace ID</dt><dd><code>${escapeHtml(event.revision?.workspaceId || 'unavailable')}</code></dd></div>
      <div><dt>Serving revision</dt><dd><code>${escapeHtml(event.revision?.revisionId || 'unavailable')}</code></dd></div>
      <div><dt>Workspace digest</dt><dd><code>${shortDigest(event.revision?.workspaceRevision || '')}</code></dd></div>
      <div><dt>Effective digest</dt><dd><code>${shortDigest(event.revision?.effectiveRevisionDigest || event.revision?.effectiveDigest || '')}</code></dd></div>
    </dl><dl>
      <div><dt>Current revision</dt><dd><code>${escapeHtml(event.currentRevision?.revisionId || 'unavailable')}</code></dd></div>
      <div><dt>Current workspace digest</dt><dd><code>${shortDigest(event.currentRevision?.workspaceRevision || '')}</code></dd></div>
      <div><dt>Current effective digest</dt><dd><code>${shortDigest(event.currentRevision?.effectiveRevisionDigest || event.currentRevision?.effectiveDigest || '')}</code></dd></div>
      <div><dt>Serving parity</dt><dd>${event.currentRevision?.revisionId === event.revision?.revisionId ? 'Current' : 'Last-known-good'}</dd></div>
    </dl></div></div></section>
    <div class="section-grid spaced-panel">
      <section class="panel"><div class="panel-head"><h2>Selected skills</h2><span>${selectedSkillIds.length}</span></div><div class="panel-body">${selectedSkillList(ctx, selectedSkillIds)}</div></section>
      <section class="panel"><div class="panel-head"><h2>Decision codes</h2><span>Bounded</span></div><div class="panel-body"><div class="trace-code-group"><h3>Reasons</h3>${codeList(event.reasonCodes, 'No recommendation reason code')}</div><div class="trace-code-group"><h3>Warnings</h3>${codeList(event.warningCodes, 'No warning code')}</div>${event.degradedCode ? `<div class="trace-code-group"><h3>Degraded serving</h3>${codeList([event.degradedCode], 'None')}</div>` : ''}</div></section>
    </div>
    <p class="microcopy">This detail is reconstructed from the canonical retained route-event ledger. Raw prompt text, hook text, paths, and free-form comments are not represented.</p>`);
}

export function renderJobList(jobs) {
  if (!jobs.length) return '<div class="empty"><strong>No maintenance jobs</strong><span>Allowlisted jobs and their receipts appear here.</span></div>';
  return `<ul class="stack-list activity-list">${jobs.map(job => `<li><div><strong>${escapeHtml(humanize(job.type))}</strong><br><small>Created ${safeDate(job.createdAt)} · <code>${escapeHtml(job.jobId?.slice(0, 12) || 'unknown')}</code></small>${jobTerminalDetail(job)}</div><span class="activity-actions">${pill(job.state, job.state === 'succeeded' ? 'good' : job.state === 'failed' ? 'bad' : 'warn')}${['queued', 'running'].includes(job.state) ? `<button class="quiet-button cancel-job" type="button" data-job-id="${escapeHtml(job.jobId)}" data-job-type="${escapeHtml(job.type)}">Cancel job</button>` : ''}</span></li>`).join('')}</ul>`;
}

function jobTerminalDetail(job) {
  if (job.state === 'queued') return '<small class="help-text">Waiting for the isolated executor. No completion receipt exists yet.</small>';
  if (job.state === 'running') return `<small class="help-text">Started ${safeDate(job.startedAt)}. A completion receipt will appear after the terminal transition.</small>`;
  if (!['succeeded', 'failed', 'cancelled'].includes(job.state)) return '<small class="help-text">Unsupported job state; refresh from the connector.</small>';

  const completed = `<small class="help-text">Completed ${safeDate(job.completedAt)}</small>`;
  if (job.state === 'failed') return `${completed}${jobErrorDetail(job.error)}`;
  const entries = safeReceiptEntries(job.resultReceipt);
  const empty = job.state === 'cancelled'
    ? 'Cancellation completed, but no safe result fields were exposed.'
    : 'The job completed, but no safe result fields were exposed.';
  return `${completed}${entries.length ? resultReceiptDetail(entries, job.state) : `<small class="help-text">${empty}</small>`}`;
}

function resultReceiptDetail(entries, state) {
  const outcome = state === 'cancelled' ? 'Cancellation receipt' : 'Result receipt';
  return `<details class="spaced-control"><summary>${outcome} · ${entries.length} field${entries.length === 1 ? '' : 's'}</summary><ul class="stack-list spaced-control">${entries.map(([key, value]) => `<li><span>${escapeHtml(humanize(key))}</span><small><code>${escapeHtml(receiptValue(value))}</code></small></li>`).join('')}</ul></details>`;
}

function jobErrorDetail(error) {
  const code = typeof error?.code === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(error.code) ? error.code : 'JOB_FAILED';
  const message = safeReceiptString(error?.message) ? error.message : 'The isolated job did not complete.';
  return `<p class="callout spaced-control"><strong>${escapeHtml(code)}</strong><br>${escapeHtml(message)}${error?.retryable === true ? '<br>Retryable after reviewing the current revision.' : ''}</p>`;
}

function safeReceiptEntries(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return [];
  return Object.entries(receipt).slice(0, 32).filter(([key, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || PRIVATE_RECEIPT_KEY.test(key)) return false;
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return true;
    return safeReceiptString(value) && !hasPrivateMetadata({ [key]: value });
  });
}

function safeReceiptString(value) {
  return typeof value === 'string'
    && value.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !SECRET_RECEIPT_VALUE.test(value)
    && !hasPrivateMetadata(value);
}

function receiptValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function routeList(ctx, events) {
  if (!events.length) return '<div class="empty"><strong>No observed route events</strong><span>Eval executions do not populate this observed-activity ledger.</span></div>';
  return `<ul class="stack-list activity-list">${events.map(event => `<li><span><strong>${escapeHtml(humanize(event.outcome))}</strong><br><small>${escapeHtml(event.surface)} · ${safeDate(event.createdAt)} · <code>${escapeHtml(event.routeId || '')}</code></small></span><span class="activity-actions"><small>${event.selectedSkillIds.length} skill${event.selectedSkillIds.length === 1 ? '' : 's'}<br><code>${shortDigest(event.decisionDigest || '')}</code></small><a class="text-link" href="${ctx.tracePermalink(event.routeId)}">Open redacted trace</a></span></li>`).join('')}</ul>`;
}

function selectedSkillList(ctx, skillIds) {
  if (!skillIds.length) return '<div class="empty"><strong>No skill selected</strong><span>This route abstained or was blocked before selection.</span></div>';
  return `<ul class="stack-list">${skillIds.map(skillId => `<li><span><code>${escapeHtml(skillId)}</code></span><a class="text-link" href="${ctx.skillPermalink(skillId)}">Open skill detail</a></li>`).join('')}</ul>`;
}

function codeList(values, empty) {
  const codes = Array.isArray(values) ? values.filter(value => typeof value === 'string').slice(0, 32) : [];
  if (!codes.length) return `<p class="subtle">${escapeHtml(empty)}</p>`;
  return `<ul class="stack-list">${codes.map(code => `<li><code>${escapeHtml(code)}</code></li>`).join('')}</ul>`;
}

async function cancelJob(ctx, jobId) {
  if (!ctx.state.connected) return ctx.toast('Reconnect before requesting cancellation.');
  try {
    const receipt = await ctx.api(`/api/v1/jobs/${jobId}/cancel`, { body: { idempotencyKey: pendingCancellationKey(jobId) } });
    if (receipt.state === 'cancelled') clearPendingCancellationKey(jobId);
    ctx.toast(receipt.state === 'cancelled'
      ? `Job ${jobId.slice(0, 8)} cancelled before publication.`
      : `Cancellation requested for job ${jobId.slice(0, 8)}. Refreshing its durable state.`);
    await renderActivity(ctx);
  } catch (error) {
    ctx.toast(error.safeMessage || 'The job could not be cancelled safely.');
  }
}
