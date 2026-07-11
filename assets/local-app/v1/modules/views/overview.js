import { actionButton } from '../jobs.js';
import { escapeHtml, humanize, metric, pageHead, revisionLine, verdictClass } from '../render.js';

export function renderOverview(ctx) {
  const dashboard = ctx.state.dashboard;
  const readiness = dashboard?.readiness || {};
  ctx.mount(`${pageHead('Overview', 'Approved local state, observed activity, and the exact next operator action.', '<button class="button" id="refresh-overview" type="button">Refresh</button><button class="button primary" type="button" data-route="route">Open Route Lab</button>')}
    ${revisionLine(dashboard?.revision, dashboard?.servingMode)}
    ${dashboard?.filesystemDirty ? `<p class="callout"><strong>Approved roots changed after this revision.</strong><br>${escapeHtml(humanize(dashboard.filesystemFreshness?.reasonCode || 'filesystem-dirty'))}. Routing keeps serving only the prior approved revision; run a reviewed scan when ready.</p>` : ''}
    <section class="metrics" aria-label="Workspace metrics">
      ${metric('Skills', dashboard?.counts?.skills ?? 0, 'Approved inventory')}
      ${metric('Route eligible', dashboard?.counts?.routeEligible ?? 0, 'Current effective policy')}
      ${metric('Source coverage', `${dashboard?.counts?.sourceTracked ?? 0}/${dashboard?.counts?.skills ?? 0}`, 'Revisioned source state')}
      ${metric('Eval cases', dashboard?.counts?.evalCases ?? 0, dashboard?.evidence?.releaseEvidenceEligible ? 'Release-counted evidence' : 'Not release evidence')}
    </section>
    <div class="section-grid">
      <section class="panel"><div class="panel-head"><h2>Readiness</h2><span>${escapeHtml(readiness.phase || 'unknown')}</span></div><div class="panel-body">
        <div class="readiness"><span class="verdict ${verdictClass(readiness.verdict)}">${escapeHtml(readiness.verdict || 'unknown')}</span><div><h3>${escapeHtml(humanize(readiness.phase || 'unknown'))}</h3><p>${escapeHtml(readiness.warnings?.[0] || 'No blocking warning was recorded for this revision.')}</p></div></div>
        ${readiness.nextActions?.length ? `<div class="form-actions">${readiness.nextActions.slice(0, 3).map(actionButton).join('')}</div>` : ''}
      </div></section>
      <section class="panel"><div class="panel-head"><h2>Evidence labels</h2><span>Never blended</span></div><div class="panel-body"><ul class="stack-list">
        <li><span>Observed routes</span><small>${dashboard?.evidence?.observedRoutes ?? 0} local events</small></li>
        <li><span>Eval confidence</span><small>${escapeHtml(dashboard?.evidence?.evalConfidence || 'none')}</small></li>
        <li><span>Token metrics</span><small>${escapeHtml(dashboard?.evidence?.tokenMetricsSource || 'not measured')}</small></li>
      </ul></div></section>
    </div>`);
  document.querySelector('#refresh-overview')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await ctx.refreshOverview(); } catch (error) { ctx.toast(error.safeMessage || 'Refresh failed.'); }
    finally { button.disabled = false; }
  });
  ctx.jobs.bindJobActions();
}
