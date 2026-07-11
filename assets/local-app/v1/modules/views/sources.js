import { escapeHtml, humanize, metric, pageHead, pill, revisionLine, shortDigest } from '../render.js';

export async function renderSources(ctx) {
  const data = await ctx.api('/api/v1/sources');
  const items = Array.isArray(data.items) ? data.items : [];
  const untrackedItems = Array.isArray(data.untrackedItems) ? data.untrackedItems.slice(0, 100) : [];
  const untrackedTotal = finiteCount(data.untrackedTotal, untrackedItems.length);
  const counts = countStates(items);
  ctx.mount(`${pageHead('Sources', 'Adopt source identity explicitly, inspect immutable upstream differences in memory, and record hash-bound review decisions.', `<button class="button job-action" type="button" data-job="sources-check" ${ctx.state.connected ? '' : 'disabled'}>Check sources</button>`)}
    ${revisionLine(data.revision || ctx.state.dashboard?.revision, ctx.state.dashboard?.servingMode)}
    <section class="metrics compact-metrics" aria-label="Source coverage">${metric('Coverage', humanize(data.coverage), 'Never inferred from zero rows')}${metric('Classified', `${finiteCount(data.trackedSkills, 0)}/${finiteCount(data.inventorySkills, 0)}`, 'Approved inventory')}${metric('Untracked', untrackedTotal, data.untrackedTruncated ? `First ${untrackedItems.length} shown` : 'Awaiting adoption')}${metric('Risky/error', counts.risky, 'Fail closed')}</section>
    <p class="callout ${data.coverage === 'covered' ? 'good' : ''}"><strong>${escapeHtml(humanize(data.coverage))}</strong><br>Adoption records source identity only and never changes skill roots. A GitHub reference remains unresolved until an explicit Sources Check. Review decisions do not rerun policy or approve routing.</p>
    ${untrackedSources(untrackedItems, untrackedTotal, data.untrackedTruncated, ctx.state.connected)}
    <section class="panel spaced-panel"><div class="panel-head"><h2>Source records</h2><span>${items.length} item${items.length === 1 ? '' : 's'}</span></div><div class="panel-body flush"><div class="table-wrap source-table-wrap"><table><thead><tr><th>Skill</th><th>State</th><th>Risk</th><th>Resolved commit</th><th>Review and diff</th></tr></thead><tbody>${sourceRows(items, ctx.state.connected)}</tbody></table></div><div class="source-cards">${sourceCards(items, ctx.state.connected)}</div></div></section>
    <div id="source-diff-result" class="source-diff-result" aria-live="polite"></div>`);
  ctx.jobs.bindJobActions();
  for (const form of document.querySelectorAll('.source-review')) form.addEventListener('submit', event => submitSourceReview(ctx, event));
  for (const form of document.querySelectorAll('.source-adoption')) {
    form.addEventListener('change', event => { if (event.target.name === 'sourceType') configureAdoptionForm(form); });
    form.addEventListener('submit', event => submitSourceAdoption(ctx, event));
    configureAdoptionForm(form);
  }
  for (const button of document.querySelectorAll('.source-diff')) button.addEventListener('click', () => loadSourceDiff(ctx, button));
}

function untrackedSources(items, total, truncated, connected) {
  const body = items.length
    ? `<div class="source-untracked-grid">${items.map((item, index) => sourceAdoptionCard(item, index, connected)).join('')}</div>${truncated ? `<p class="microcopy">This bounded view shows ${items.length} of ${total} untracked skills. Adopt these, refresh, then continue in stable qualified-ID order.</p>` : ''}`
    : '<div class="empty"><strong>No untracked approved skill</strong><span>Every approved inventory skill exposed by this revision has a source classification.</span></div>';
  return `<section class="panel spaced-panel"><div class="panel-head"><h2>Source adoption</h2><span>${total} untracked</span></div><div class="panel-body">${body}</div></section>`;
}

function sourceAdoptionCard(item, index, connected) {
  return `<article class="source-adoption-card"><div class="skill-card-head"><div><strong>${escapeHtml(item.displayName || 'Unknown skill')}</strong><br><code>${escapeHtml(item.skillId || 'unqualified')}</code></div>${pill('untracked', 'warn')}</div><p>Content revision <code>${shortDigest(item.contentRevision)}</code></p><form class="source-adoption" data-skill-id="${escapeHtml(item.skillId || '')}" autocomplete="off"><div class="field"><label>Source type<select name="sourceType"><option value="local">Local-authored</option><option value="github">GitHub</option></select></label></div><div class="source-adoption-fields" data-source-fields="local"><div class="field"><label>Classification reason<textarea name="reason" rows="3" maxlength="500" spellcheck="true" placeholder="Why this skill is authored and maintained locally"></textarea></label><small>Maximum 500 UTF-8 bytes.</small></div></div><div class="source-adoption-fields" data-source-fields="github" hidden><div class="field"><label>Repository<input name="repository" maxlength="140" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="owner/repository"></label></div><div class="field"><label>Source path<input name="sourcePath" maxlength="1024" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="skills/example"></label></div><div class="field"><label>Reference<input name="ref" maxlength="240" autocomplete="off" autocapitalize="off" spellcheck="false" value="main"></label></div><small>GitHub resolution is deliberately deferred. Run Sources Check after adoption to resolve and inspect an immutable commit.</small></div><label class="confirmation-check"><input name="confirmAdoption" type="checkbox" required><span>I reviewed this qualified skill ID. Adoption records source metadata and never changes approved skill roots.</span></label><button class="button primary" type="submit" ${connected ? '' : 'disabled'}>Adopt source</button><div class="source-action-result" aria-live="polite"></div></form></article>`;
}

function sourceRows(items, connected) {
  if (!items.length) return '<tr><td colspan="5"><div class="empty"><strong>Source tracking is not configured</strong><span>Zero records are not reported as clean coverage. Adopt an approved skill above.</span></div></td></tr>';
  return items.map(item => `<tr><td>${sourceIdentity(item)}</td><td>${pill(item.state)}</td><td>${escapeHtml(humanize(item.risk || 'unclassified'))}</td><td><code>${item.upstreamCommit ? escapeHtml(item.upstreamCommit.slice(0, 12)) : 'unresolved'}</code></td><td>${sourceActions(item, connected)}</td></tr>`).join('');
}

function sourceCards(items, connected) {
  if (!items.length) return '<div class="empty"><strong>No source records</strong><span>Adopt reviewed source metadata first.</span></div>';
  return items.map(item => `<article class="source-card"><div class="skill-card-head">${sourceIdentity(item)}${pill(item.state)}</div><dl><div><dt>Risk</dt><dd>${escapeHtml(humanize(item.risk || 'unclassified'))}</dd></div><div><dt>Commit</dt><dd><code>${item.upstreamCommit ? escapeHtml(item.upstreamCommit.slice(0, 12)) : 'unresolved'}</code></dd></div></dl>${sourceActions(item, connected)}</article>`).join('');
}

function sourceIdentity(item) { return `<div><strong>${escapeHtml(item.displayName || 'Unknown')}</strong><br><code>${escapeHtml(item.skillId || 'unqualified')}</code></div>`; }

function sourceActions(item, connected) {
  const review = sourceReview(item, connected);
  const diff = item.skillId && item.sourceType === 'github'
    ? `<button class="quiet-button source-diff" type="button" data-skill-id="${escapeHtml(item.skillId)}" data-display-name="${escapeHtml(item.displayName || 'source') }" ${connected ? '' : 'disabled'}>Preview upstream diff</button>`
    : '<span class="subtle">Local-authored sources have no upstream diff.</span>';
  return `<div class="source-record-actions">${review}${diff}</div>`;
}

function sourceReview(item, connected) {
  if (item.sourceType === 'github' && item.checked !== true) return '<span class="subtle">Run Sources Check before recording a review.</span>';
  return item.skillId && item.reviewable === true
    ? `<form class="source-review" data-skill-id="${escapeHtml(item.skillId)}"><label><span class="sr-only">Source review decision for ${escapeHtml(item.displayName || item.skillId)}</span><select name="decision" aria-label="Source review decision"><option value="hold">Hold</option><option value="accepted">Accept exact state</option><option value="ignore">Ignore</option></select></label><label><span class="sr-only">Source review reason for ${escapeHtml(item.displayName || item.skillId)}</span><input name="reason" required maxlength="1000" aria-label="Source review reason" placeholder="What was reviewed" autocomplete="off"></label><button class="quiet-button" type="submit" ${connected ? '' : 'disabled'}>Record review</button><div class="source-action-result" aria-live="polite"></div></form>`
    : '<span class="subtle">No review action required.</span>';
}

function configureAdoptionForm(form) {
  const github = form.elements.sourceType.value === 'github';
  for (const region of form.querySelectorAll('[data-source-fields]')) {
    const active = region.dataset.sourceFields === (github ? 'github' : 'local');
    region.hidden = !active;
    for (const control of region.querySelectorAll('input, textarea')) control.required = active && (control.name !== 'ref');
  }
}

async function submitSourceAdoption(ctx, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const output = form.querySelector('.source-action-result');
  const expectedRevision = ctx.currentRevisionId();
  if (!ctx.state.connected || !expectedRevision) {
    output.innerHTML = '<p class="callout spaced-callout">Reconnect to a current revision before adopting a source.</p>';
    return;
  }
  const values = new FormData(form);
  const sourceType = values.get('sourceType');
  const boundedFields = sourceType === 'github'
    ? [['Repository', values.get('repository'), 140], ['Source path', values.get('sourcePath'), 1024], ['Reference', values.get('ref'), 240]]
    : [['Classification reason', values.get('reason'), 500]];
  const oversized = boundedFields.find(([, value, maximum]) => utf8Length(value) > maximum);
  if (oversized) {
    output.innerHTML = `<p class="callout spaced-callout">${escapeHtml(oversized[0])} exceeds the ${oversized[2]} byte connector limit.</p>`;
    return;
  }
  const body = sourceType === 'github'
    ? { skillId: form.dataset.skillId, sourceType: 'github', repository: values.get('repository'), sourcePath: values.get('sourcePath'), ref: values.get('ref'), expectedRevision, confirm: true }
    : { skillId: form.dataset.skillId, sourceType: 'local', reason: values.get('reason'), expectedRevision, confirm: true };
  button.disabled = true;
  button.textContent = 'Adopting…';
  output.innerHTML = '<p class="subtle" role="status">Recording source identity as a new unapproved revision…</p>';
  try {
    const receipt = await ctx.api('/api/v1/sources/adoptions', { body });
    form.reset();
    configureAdoptionForm(form);
    output.innerHTML = `<div class="callout good spaced-callout"><strong>${escapeHtml(humanize(receipt.sourceType))} source adopted</strong><br>Receipt <code>${shortDigest(receipt.adoptionDigest)}</code> · revision <code>${escapeHtml(receipt.revision?.revisionId || 'unavailable')}</code>. Roots were not changed.${receipt.sourceType === 'github' ? ' Run Sources Check to resolve the immutable GitHub reference.' : ''}</div>`;
    ctx.invalidate();
    ctx.toast('Source identity adopted. Routing approval remains required.');
    await ctx.refreshWorkspaceState(false);
  } catch (error) {
    output.innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.safeMessage || 'The source was not adopted.')}</p>`;
  } finally {
    button.disabled = !ctx.state.connected;
    button.textContent = 'Adopt source';
  }
}

async function submitSourceReview(ctx, event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const output = form.querySelector('.source-action-result');
  const values = new FormData(form);
  const expectedRevision = ctx.currentRevisionId();
  if (!ctx.state.connected || !expectedRevision) {
    output.innerHTML = '<p class="callout spaced-callout">Reconnect before recording a source review.</p>';
    return;
  }
  button.disabled = true;
  try {
    const receipt = await ctx.api('/api/v1/sources/reviews', { body: { skillId: form.dataset.skillId, decision: values.get('decision'), reason: values.get('reason'), expectedRevision } });
    form.reset();
    output.innerHTML = `<p class="callout good spaced-callout">Review recorded as <strong>${escapeHtml(humanize(receipt.decision))}</strong>. Receipt <code>${shortDigest(receipt.reviewDigest)}</code>.</p>`;
    ctx.invalidate();
    ctx.toast('Source review recorded. Reapply policy before routing from the changed canonical state.');
    await ctx.refreshWorkspaceState(false);
  } catch (error) { output.innerHTML = `<p class="callout spaced-callout">${escapeHtml(error.safeMessage || 'The source review was not recorded.')}</p>`; }
  finally { button.disabled = !ctx.state.connected; }
}

async function loadSourceDiff(ctx, button) {
  const target = document.querySelector('#source-diff-result');
  const expectedRevision = ctx.currentRevisionId();
  if (!ctx.state.connected || !expectedRevision) {
    target.innerHTML = '<p class="callout spaced-panel">Reconnect to a current revision before requesting an upstream diff.</p>';
    return;
  }
  button.disabled = true;
  button.textContent = 'Loading diff…';
  target.innerHTML = '<section class="panel spaced-panel"><div class="loading-view compact" role="status"><span class="spinner" aria-hidden="true"></span><span>Fetching a bounded upstream comparison in the foreground…</span></div></section>';
  try {
    const receipt = await ctx.api('/api/v1/sources/diff', { body: { skillId: button.dataset.skillId, expectedRevision } });
    target.innerHTML = sourceDiffReceipt(receipt, button.dataset.displayName);
    target.querySelector('h2')?.focus({ preventScroll: true });
  } catch (error) {
    target.innerHTML = `<p class="callout spaced-panel">${escapeHtml(error.safeMessage || 'The source diff could not be loaded.')}</p>`;
  } finally {
    button.disabled = !ctx.state.connected;
    button.textContent = 'Preview upstream diff';
  }
}

function sourceDiffReceipt(receipt, displayName) {
  const diff = receipt.diff || {};
  const lines = Array.isArray(diff.lines) ? diff.lines.slice(0, 120) : [];
  return `<section class="panel spaced-panel source-diff-panel"><div class="panel-head"><div><h2 tabindex="-1">Upstream diff · ${escapeHtml(displayName || receipt.skillId || 'source')}</h2><span>${escapeHtml(humanize(receipt.state || 'unknown'))} · ${escapeHtml(humanize(receipt.risk || 'unclassified'))}</span></div><code>${receipt.upstreamCommit ? escapeHtml(receipt.upstreamCommit.slice(0, 12)) : 'unresolved'}</code></div><div class="panel-body"><section class="metrics compact-metrics" aria-label="Diff summary">${metric('Additions', finiteCount(diff.additions, 0), 'Bounded preview')}${metric('Deletions', finiteCount(diff.deletions, 0), 'Bounded preview')}${metric('Changed lines', finiteCount(diff.changedLines, 0), diff.truncated ? 'Truncated' : 'Complete response')}${metric('Persisted', receipt.persisted === false ? 'No' : 'Unexpected', 'Memory-only view')}</section>${lines.length ? `<ol class="source-diff-lines" aria-label="Escaped source diff">${lines.map(line => `<li class="source-diff-line ${line.kind === 'upstream' ? 'upstream' : 'local'}"><span>${line.kind === 'upstream' ? '+' : '−'} ${finiteCount(line.line, 0)}</span><code>${escapeHtml(String(line.text || '').slice(0, 500))}</code></li>`).join('')}</ol>` : '<div class="empty"><strong>No changed line was returned</strong><span>The source may be clean, local-authored, unresolved, or unchanged.</span></div>'}<p class="microcopy">This escaped diff is response-only: prompt stored <strong>${receipt.promptStored === false ? 'no' : 'unexpected'}</strong>; persisted <strong>${receipt.persisted === false ? 'no' : 'unexpected'}</strong>. It is never written to browser storage.</p></div></section>`;
}

function finiteCount(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function countStates(items) {
  return items.reduce((counts, item) => {
    if (!/clean|local-authored/.test(item.state || '')) counts.review += 1;
    if (/risky|error|blocked/.test(item.state || '')) counts.risky += 1;
    return counts;
  }, { review: 0, risky: 0 });
}
