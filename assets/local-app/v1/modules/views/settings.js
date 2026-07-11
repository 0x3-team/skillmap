import { escapeHtml, humanize, pageHead, pill, revisionLine, safeDate, shortDigest } from '../render.js';
import { clearSavedSkillView, hasPrivateMetadata, loadSavedSkillView } from '../state.js';

export async function renderSettings(ctx) {
  const workspace = ctx.state.workspace;
  const savedSkillView = loadSavedSkillView(ctx.activeWorkspaceId());
  const history = await loadRevisionHistory(ctx);
  ctx.mount(`${pageHead('Settings', 'Review approved roots, retention defaults, browser preferences, diagnostics, and immutable revision recovery.')}
    ${revisionLine(workspace?.revision || ctx.state.dashboard?.revision, workspace?.servingMode || ctx.state.dashboard?.servingMode)}
    <div class="section-grid"><section class="panel"><div class="panel-head"><h2>Approved roots</h2><span>${workspace?.roots?.length || 0}</span></div><div class="panel-body">${workspace?.roots?.length ? `<ul class="stack-list">${workspace.roots.map(item => `<li><span>${escapeHtml(item.label)}</span><small><code>${item.rootId}</code><br>Approved ${safeDate(item.approvedAt)}</small></li>`).join('')}</ul>` : '<div class="empty"><strong>No approved roots</strong><span>Return to onboarding to validate one explicitly.</span></div>'}</div></section>
    <section class="panel"><div class="panel-head"><h2>Privacy defaults</h2><span>Local</span></div><div class="panel-body"><ul class="stack-list"><li><span>Raw prompt persistence</span><small>Off</small></li><li><span>Telemetry</span><small>Off</small></li><li><span>Route events</span><small>Redacted · 90 days · 10,000 max</small></li><li><span>Cloud sync</span><small>Not configured</small></li><li><span>Saved skill view</span><small>${savedSkillView ? 'Filters only; search excluded' : 'None'}</small></li></ul>${savedSkillView ? '<button id="clear-skill-preferences" class="quiet-button spaced-control" type="button">Clear saved skill view</button>' : ''}</div></section></div>
    <section class="panel spaced-panel"><div class="panel-head"><h2>Filesystem freshness</h2><span>${workspace?.filesystemDirty ? 'Changed' : 'Verified'}</span></div><div class="panel-body"><ul class="stack-list"><li><span>State</span><small>${escapeHtml(workspace?.filesystemFreshness?.state || 'not-started')}</small></li><li><span>Reason</span><small>${escapeHtml(humanize(workspace?.filesystemFreshness?.reasonCode || 'none'))}</small></li><li><span>Last verified</span><small>${safeDate(workspace?.filesystemFreshness?.lastVerifiedAt, 'Not yet verified')}</small></li><li><span>Automatic mutation</span><small>Never</small></li></ul>${workspace?.filesystemDirty ? '<p class="callout">Run the allowlisted scan job only after reviewing changed roots. Curation, policy, and sources are not rerun automatically.</p>' : ''}</div></section>
    <div class="section-grid spaced-panel"><section class="panel"><div class="panel-head"><h2>Diagnostics & updates</h2><span>Redacted</span></div><div class="panel-body"><ul class="stack-list"><li><span>Diagnostics payload</span><small>Revision IDs, readiness, compatibility, freshness</small></li><li><span>Raw prompts and paths</span><small>Excluded</small></li><li><span>Update channel</span><small>Manual · no background network check</small></li><li><span>Installed product version</span><small>${escapeHtml(ctx.state.bootstrap?.connectorCompatibility?.productVersion || 'unavailable')}</small></li></ul><button id="export-diagnostics" class="button spaced-control" type="button">Export redacted diagnostics</button></div></section>
    <section class="panel"><div class="panel-head"><h2>Recovery & uninstall</h2><span>Manual handoff</span></div><div class="panel-body"><ol class="step-list"><li><span>Inspect state</span><code>skillmap state status --json</code></li><li><span>Recover derived corruption only</span><code>skillmap state recover --confirm</code></li><li><span>Stop this dashboard</span><code>Ctrl+C</code></li><li><span>Remove a global CLI install</span><code>npm uninstall -g skillmap</code></li></ol><p class="callout spaced-callout">Uninstalling the CLI intentionally preserves the workspace’s <code>.skillmap</code> history and skill roots. Export diagnostics and review those files before any separate manual deletion.</p></div></section></div>
    <section class="panel spaced-panel"><div class="panel-head"><h2>Revision history</h2><span>${history.items.length} loaded${history.hasMore ? ' · bounded' : ''}</span></div><div class="panel-body">${revisionHistory(history)}</div></section>`);
  document.querySelector('#clear-skill-preferences')?.addEventListener('click', event => {
    clearSavedSkillView(ctx.activeWorkspaceId());
    event.currentTarget.remove();
    ctx.toast('Saved skill filters cleared.');
  });
  document.querySelector('#export-diagnostics')?.addEventListener('click', () => exportDiagnostics(ctx));
  const rollbackForm = document.querySelector('#rollback-form');
  if (rollbackForm) {
    rollbackForm.addEventListener('change', () => updateRollbackPreview(history));
    rollbackForm.addEventListener('submit', event => rollbackRevision(ctx, history, event));
    updateRollbackPreview(history);
  }
}

function exportDiagnostics(ctx) {
  const compatibility = ctx.state.bootstrap?.connectorCompatibility || {};
  const workspace = ctx.state.workspace || {};
  const dashboard = ctx.state.dashboard || {};
  const payload = {
    kind: 'skillmap.local-diagnostics',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    productVersion: compatibility.productVersion || null,
    apiVersion: compatibility.apiVersion || null,
    localAppAssetVersion: compatibility.localAppAssetVersion || null,
    connectionState: ctx.state.connected ? 'connected' : 'offline',
    bootstrapState: ctx.state.bootstrap?.state || null,
    workspaceId: workspace.workspaceId || dashboard.workspace?.workspaceId || null,
    servingRevision: workspace.revision || dashboard.revision || null,
    currentRevision: ctx.state.bootstrap?.currentRevision || null,
    readinessPhase: dashboard.readinessPhase || null,
    servingMode: workspace.servingMode || dashboard.servingMode || null,
    filesystemFreshness: workspace.filesystemFreshness || null,
    filesystemDirty: workspace.filesystemDirty === true,
    privacy: { rawPromptPersistence: false, telemetry: false, cloudSync: false },
    updateChannel: { mode: 'manual', backgroundNetworkChecks: false }
  };
  if (hasPrivateMetadata(payload)) return ctx.toast('Diagnostics export was blocked because private metadata was detected.');
  const bytes = `${JSON.stringify(payload, null, 2)}\n`;
  if (new TextEncoder().encode(bytes).length > 64 * 1024) return ctx.toast('Diagnostics export exceeded its 64 KiB safety bound.');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `skillmap-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  ctx.toast('Redacted diagnostics exported.');
}

function revisionHistory(history) {
  if (!history.items.length) return '<div class="empty"><strong>No revision history is available</strong><span>The connector returned no verified immutable ancestry.</span></div>';
  const candidates = history.items.filter(item => !item.isCurrent);
  return `<div class="revision-layout"><ol class="revision-list">${history.items.map(item => `<li class="revision-item ${item.isCurrent ? 'current' : ''}"><div><strong>Revision ${item.sequence}</strong><span>${safeDate(item.createdAt)}</span></div><code>${escapeHtml(item.revision?.revisionId || 'invalid-revision')}</code><div class="revision-badges">${item.isCurrent ? pill('current', 'good') : ''}${item.isRoutingServing ? pill('routing-serving', 'warn') : ''}${item.routingApprovalRecorded ? pill('approval-recorded', 'good') : ''}${item.mutation?.kind ? pill(item.mutation.kind) : ''}</div><dl><div><dt>Parent</dt><dd><code>${item.parentRevisionId ? escapeHtml(item.parentRevisionId.slice(0, 18)) : 'Origin'}</code></dd></div><div><dt>Artifacts</dt><dd>${item.artifactCount ?? '—'}</dd></div><div><dt>Actor</dt><dd>${escapeHtml(item.mutation?.actor || 'not recorded')}</dd></div><div><dt>Reason receipt</dt><dd><code>${shortDigest(item.mutation?.reasonDigest)}</code></dd></div></dl></li>`).join('')}</ol>
    <form id="rollback-form" class="rollback-form"><fieldset ${candidates.length ? '' : 'disabled'}><legend>Select an ancestor</legend>${candidates.map((item, index) => `<label class="choice-option"><input type="radio" name="targetRevision" value="${item.revision.revisionId}" ${index === 0 ? 'checked' : ''}><span><strong>Revision ${item.sequence}</strong><small><code>${escapeHtml(item.revision.revisionId)}</code>${item.isRoutingServing ? '<br>Currently routing-serving' : ''}</small></span></label>`).join('')}</fieldset><div id="rollback-preview" class="callout" aria-live="polite"></div><label class="confirmation-check"><input type="checkbox" name="confirmRollback" value="yes" required ${candidates.length ? '' : 'disabled'}><span>I understand the new rollback revision is unapproved. Routing either stays on a verified safety-equivalent last-known-good revision or abstains until explicit approval.</span></label><button class="button danger" type="submit" ${candidates.length ? '' : 'disabled'}>Rollback to selected revision</button><small class="help-text">The backend re-verifies target ancestry, expected current revision, and publication safety. This browser does not predict LKG eligibility or approval.</small></form></div>${history.hasMore ? '<p class="callout">More ancestry exists beyond the 500-item UI safety bound. Use the local CLI for older reviewed history.</p>' : ''}`;
}

function updateRollbackPreview(history) {
  const form = document.querySelector('#rollback-form');
  const targetRevision = form ? new FormData(form).get('targetRevision') : null;
  const item = history.items.find(value => value.revision?.revisionId === targetRevision);
  const preview = document.querySelector('#rollback-preview');
  if (!preview) return;
  preview.innerHTML = item
    ? `<strong>Review-only rollback target</strong><br>Revision ${item.sequence} from ${escapeHtml(safeDate(item.createdAt))}. The new revision will be unapproved; routing may stay on a verified safety-equivalent LKG or abstain.`
    : '<strong>No rollback target selected</strong><br>Select a verified ancestor to continue.';
}

async function rollbackRevision(ctx, history, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const targetRevision = values.get('targetRevision');
  if (!targetRevision || values.get('confirmRollback') !== 'yes') return;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Publishing rollback…';
  try {
    const receipt = await ctx.api('/api/v1/state/rollback', { body: {
      targetRevision,
      expectedRevision: history.currentRevision.revisionId,
      actor: 'local-app',
      reason: 'operator-rollback',
      confirm: true
    } });
    ctx.invalidate();
    ctx.toast(`Rollback published as ${receipt.revision.revisionId.slice(0, 14)}. The new revision is unapproved; serving state will be rechecked.`);
    await ctx.boot(true);
  } catch (error) {
    ctx.toast(error.safeMessage || 'Rollback was not published. Refresh revision history and review the target again.');
    button.disabled = false;
    button.textContent = 'Rollback to selected revision';
  }
}

async function loadRevisionHistory(ctx) {
  const items = [];
  let cursor = null;
  let currentRevision = null;
  let routingRevisionId = null;
  let hasMore = false;
  for (let page = 0; page < 10; page += 1) {
    const data = await ctx.api(`/api/v1/state/revisions?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    items.push(...(data.items || []));
    currentRevision = data.currentRevision || currentRevision;
    routingRevisionId = data.routingRevisionId ?? routingRevisionId;
    hasMore = data.hasMore === true;
    cursor = data.nextCursor;
    if (!hasMore || !cursor) break;
  }
  return { items, currentRevision, routingRevisionId, hasMore };
}
