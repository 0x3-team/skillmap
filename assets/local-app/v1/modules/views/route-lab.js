import { escapeHtml, formatNumber, humanize, pageHead, revisionLine, shortDigest } from '../render.js';

export function renderRouteLab(ctx) {
  const result = ctx.state.routeResult;
  ctx.mount(`${pageHead('Route Lab', 'Execute the deterministic router against one approved revision. The raw prompt is not persisted.')}
    ${revisionLine(result?.decision?.revision || ctx.state.dashboard?.revision, result?.decision?.servingMode || ctx.state.dashboard?.servingMode)}
    <section class="panel"><div class="panel-head"><h2>Prompt</h2><span>Retention off</span></div><div class="panel-body">
      <form id="route-form"><div class="field"><label for="route-prompt">What are you trying to do?</label><textarea id="route-prompt" maxlength="32768" placeholder="Describe the work without naming a skill…" required></textarea><small>Sent only to this loopback connector. Route history stores skill IDs and decision metadata, never this text.</small></div><div class="form-actions"><button class="button primary" type="submit">Run route</button><button class="quiet-button" id="cancel-route" type="button" disabled>Cancel</button><button class="quiet-button" id="clear-route" type="button">Clear</button></div></form>
      <div id="route-output" class="route-output" aria-live="polite">${result ? renderRouteResult(result, ctx) : '<div class="empty"><strong>No route executed yet</strong><span>Submit a prompt to see real recommendations, exclusions, latency, and revision evidence.</span></div>'}</div>
    </div></section>`);
  document.querySelector('#route-form').addEventListener('submit', event => runRoute(ctx, event));
  document.querySelector('#cancel-route').addEventListener('click', () => ctx.state.routeController?.abort());
  document.querySelector('#clear-route').addEventListener('click', () => { ctx.state.routeResult = null; renderRouteLab(ctx); });
  ctx.onViewDispose?.(() => {
    ctx.state.routeController?.abort();
    ctx.state.routeController = null;
  });
  bindFeedback(ctx);
  bindRouteResultActions(ctx);
}

export function renderRouteResult(result, ctx) {
  const decision = result.decision;
  const recommendations = decision.recommendations || [];
  const exclusions = decision.exclusions || [];
  return `<div class="panel-head"><h3>${recommendations.length ? `${recommendations.length} recommendation${recommendations.length === 1 ? '' : 's'}` : 'No confident recommendation'}</h3><span>${formatNumber(result.latencyMs)} ms · promptStored ${String(result.promptStored)}</span></div>
    ${recommendations.length ? recommendations.map(item => `<article class="route-item"><div><h3>${escapeHtml(item.displayName)}</h3><p><code>${escapeHtml(item.skillId)}</code><br>${escapeHtml(item.reasonCodes.map(humanize).join(' · '))}</p><a class="text-link" href="${ctx.skillPermalink(item.skillId)}">Open skill detail</a></div><span class="score">${formatNumber(item.score)}</span></article>`).join('') : '<div class="empty"><strong>Abstained safely</strong><span>Try a more specific task description or select a qualified skill explicitly.</span></div>'}
    ${exclusions.length ? `<details class="route-exclusions"><summary>${exclusions.length} exclusion${exclusions.length === 1 ? '' : 's'} with machine reasons</summary><ul class="stack-list">${exclusions.slice(0, 20).map(item => `<li><span>${escapeHtml(item.displayName)}</span><small>${escapeHtml(humanize(item.reasonCode))}</small></li>`).join('')}</ul></details>` : ''}
    ${decision.warningCodes?.length ? `<p class="callout">${escapeHtml(decision.warningCodes.map(humanize).join(' · '))}</p>` : ''}
    <div class="form-actions"><button class="quiet-button copy-hint" type="button">Copy compact hint</button><button class="quiet-button open-trace" type="button" data-route-id="${result.routeId}">Open redacted trace</button></div>
    <div class="feedback-bar" aria-label="Route feedback"><span class="subtle">Was this route useful?</span>${['correct', 'wrong', 'missing', 'unsafe'].map(outcome => `<button class="quiet-button feedback" type="button" data-outcome="${outcome}" data-route-id="${result.routeId}">${humanize(outcome)}</button>`).join('')}</div>
    <p class="microcopy">Decision <code>${shortDigest(result.decisionDigest)}</code> · no prompt or free-form feedback comment is stored.</p>`;
}

async function runRoute(ctx, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const cancel = form.querySelector('#cancel-route');
  const promptInput = form.querySelector('#route-prompt');
  const output = document.querySelector('#route-output');
  const prompt = promptInput.value;
  ctx.state.routeController?.abort();
  const controller = new AbortController();
  ctx.state.routeController = controller;
  const ownsView = () => ctx.state.routeController === controller && form.isConnected && output?.isConnected;
  button.disabled = true;
  cancel.disabled = false;
  button.textContent = 'Routing…';
  try {
    const routeResult = await ctx.api('/api/v1/routes/preview', { body: { prompt, max: 5 }, signal: controller.signal });
    if (!ownsView()) return;
    ctx.state.routeResult = routeResult;
    promptInput.value = '';
    output.innerHTML = renderRouteResult(routeResult, ctx);
    bindFeedback(ctx);
    bindRouteResultActions(ctx);
    ctx.updateRevision(routeResult.decision.revision);
  } catch (error) {
    if (!ownsView()) return;
    output.innerHTML = `<p class="callout">${escapeHtml(controller.signal.aborted ? 'Route request cancelled. The prompt was not retained.' : error.safeMessage || 'Route execution failed.')}</p>`;
  } finally {
    if (ctx.state.routeController === controller) ctx.state.routeController = null;
    if (form.isConnected) {
      button.disabled = false;
      cancel.disabled = true;
      button.textContent = 'Run route';
    }
  }
}

function bindFeedback(ctx) {
  for (const button of document.querySelectorAll('.feedback')) button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await ctx.api(`/api/v1/routes/${button.dataset.routeId}/feedback`, { body: { outcome: button.dataset.outcome, reasonCode: `operator-${button.dataset.outcome}`, idempotencyKey: `feedback-${button.dataset.routeId}-${button.dataset.outcome}` } });
      ctx.toast('Feedback recorded without the raw prompt.');
    } catch (error) { ctx.toast(error.safeMessage || 'Feedback could not be recorded.'); button.disabled = false; }
  });
}

function bindRouteResultActions(ctx) {
  document.querySelector('.copy-hint')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ctx.state.routeResult?.decision?.hookText || ''); ctx.toast('Compact route hint copied.'); }
    catch { ctx.toast('Clipboard access is unavailable.'); }
  });
  document.querySelector('.open-trace')?.addEventListener('click', event => {
    ctx.navigate('traces', { traceId: event.currentTarget.dataset.routeId });
  });
}
