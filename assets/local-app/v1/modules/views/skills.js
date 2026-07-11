import { recordCanonicalDecision } from '../policy-actions.js';
import { escapeHtml, humanize, pageHead, pill, revisionLine, safeDate, shortDigest } from '../render.js';
import { BUILT_IN_SKILL_VIEWS, COLUMN_LABELS, filterAndSortSkills, normalizeSkillView, parseSkillView, savedSkillViewProjection, skillViewToQuery } from '../skill-view-state.js';
import { clearSavedSkillView, loadSavedSkillView, saveSkillView } from '../state.js';

export async function renderSkills(ctx, descriptor = {}) {
  ctx.state.skills = await loadAllSkills(ctx);
  const workspaceId = ctx.activeWorkspaceId();
  const saved = loadSavedSkillView(workspaceId);
  let view = parseSkillView(new URLSearchParams(location.search), saved);
  const tiers = uniqueValues(ctx.state.skills, 'tier');
  const variants = uniqueValues(ctx.state.skills, 'variantState');
  const groups = [...groupSkills(ctx.state.skills).entries()].filter(([, items]) => items.length > 1);
  ctx.mount(`${pageHead('Skills', 'Filter qualified variants in the approved revision. Search and view controls are URL-owned; skill bodies and paths stay out of the list.', '')}
    ${revisionLine(ctx.state.dashboard?.revision, ctx.state.dashboard?.servingMode)}
    <section class="panel"><div class="panel-head responsive-head"><div><h2>Approved variants</h2><span id="skills-count">${ctx.state.skills.length} shown</span></div><div class="saved-view-actions"><label for="skill-view">View</label><select id="skill-view">${viewOptions(saved, view.view)}</select><button id="save-skill-view" class="quiet-button" type="button">Save filters</button><button id="clear-saved-skill-view" class="quiet-button" type="button" ${saved ? '' : 'disabled'}>Clear saved</button></div></div>
      <div class="panel-body filter-bar">
        <div class="field filter-search"><label for="skill-search">Search skills</label><input id="skill-search" type="search" placeholder="Name, ID, description" value="${escapeHtml(view.q)}" autocomplete="off"></div>
        <div class="field"><label for="skill-tier">Tier</label><select id="skill-tier"><option value="all">All tiers</option>${tiers.map(item => option(item, view.tier, humanize(item))).join('')}</select></div>
        <div class="field"><label for="skill-eligibility">Routing</label><select id="skill-eligibility">${option('all', view.eligibility, 'All')}${option('eligible', view.eligibility, 'Eligible')}${option('ineligible', view.eligibility, 'Ineligible')}</select></div>
        <div class="field"><label for="skill-scripts">Scripts</label><select id="skill-scripts">${option('all', view.scripts, 'All')}${option('yes', view.scripts, 'Has scripts')}${option('no', view.scripts, 'No scripts')}</select></div>
        <div class="field"><label for="skill-variant">Variant</label><select id="skill-variant"><option value="all">All states</option><option value="noncanonical" ${view.variant === 'noncanonical' ? 'selected' : ''}>Non-canonical</option>${variants.map(item => option(item, view.variant, humanize(item))).join('')}</select></div>
        <div class="field"><label for="skill-sort">Sort</label><select id="skill-sort">${['name', 'tier', 'variant', 'scripts', 'revision'].map(item => option(item, view.sort, humanize(item))).join('')}</select></div>
        <button id="skill-direction" class="quiet-button direction-button" type="button" aria-label="Sort ${view.direction === 'asc' ? 'descending' : 'ascending'}">${view.direction === 'asc' ? '↑ Asc' : '↓ Desc'}</button>
        <details class="column-picker"><summary class="quiet-button">Columns</summary><fieldset><legend>Visible columns</legend>${Object.entries(COLUMN_LABELS).map(([key, label]) => `<label><input type="checkbox" value="${key}" ${view.columns.includes(key) ? 'checked' : ''}>${escapeHtml(label)}</label>`).join('')}</fieldset></details>
      </div>
      <div class="panel-body flush"><div class="table-wrap skill-table-wrap"><table><thead id="skills-head"></thead><tbody id="skills-body"></tbody></table></div><div id="skills-cards" class="skill-cards"></div></div>
    </section>
    ${groups.length ? `<section class="panel spaced-panel"><div class="panel-head"><h2>Variant sets</h2><span>${groups.length} comparable name${groups.length === 1 ? '' : 's'}</span></div><div class="panel-body"><ul class="stack-list">${groups.map(([name, items], index) => `<li><span><strong>${escapeHtml(name)}</strong><br><small>${items.length} qualified variants</small></span><button class="quiet-button compare-variants" type="button" data-group-index="${index}">Compare</button></li>`).join('')}</ul></div></section>` : ''}
    <div id="skill-detail" aria-live="polite"></div>
    <div id="variant-compare" aria-live="polite"></div>`);

  const rerender = ({ syncUrl = true } = {}) => {
    view = normalizeSkillView(view);
    if (syncUrl) {
      const parameters = skillViewToQuery(view);
      history.replaceState({}, '', `${location.pathname}${parameters.size ? `?${parameters}` : ''}`);
    }
    renderSkillCollection(ctx, view);
  };
  bindFilters(ctx, () => view, next => { view = next; rerender(); }, saved);
  bindVariantGroups(ctx, groups);
  rerender({ syncUrl: false });
  if (descriptor.skillId) await renderSkillDetail(ctx, descriptor.skillId, true);
}

function bindFilters(ctx, getView, setView, saved) {
  let currentSaved = saved;
  const update = (key, value) => setView({ ...getView(), [key]: value, view: 'custom' });
  document.querySelector('#skill-search').addEventListener('input', event => update('q', event.target.value));
  for (const [id, key] of [['#skill-tier', 'tier'], ['#skill-eligibility', 'eligibility'], ['#skill-scripts', 'scripts'], ['#skill-variant', 'variant'], ['#skill-sort', 'sort']]) {
    document.querySelector(id).addEventListener('change', event => update(key, event.target.value));
  }
  document.querySelector('#skill-direction').addEventListener('click', () => update('direction', getView().direction === 'asc' ? 'desc' : 'asc'));
  for (const checkbox of document.querySelectorAll('.column-picker input')) checkbox.addEventListener('change', () => {
    const columns = [...document.querySelectorAll('.column-picker input:checked')].map(item => item.value);
    update('columns', columns);
  });
  document.querySelector('#skill-view').addEventListener('change', event => {
    const value = event.target.value;
    const preset = value === 'saved' ? currentSaved : BUILT_IN_SKILL_VIEWS[value];
    if (!preset) return;
    setView({ ...preset, q: '', view: value });
  });
  document.querySelector('#save-skill-view').addEventListener('click', () => {
    currentSaved = savedSkillViewProjection(getView());
    if (!saveSkillView(ctx.activeWorkspaceId(), currentSaved)) return ctx.toast('This filter view could not be stored locally.');
    const savedOption = document.querySelector('#skill-view option[value="saved"]');
    if (savedOption) savedOption.disabled = false;
    document.querySelector('#clear-saved-skill-view').disabled = false;
    document.querySelector('#skill-view').value = 'saved';
    const next = { ...getView(), view: 'saved' };
    ctx.toast('Filters, sort, and columns saved locally. Search text was excluded.');
    setView(next);
  });
  document.querySelector('#clear-saved-skill-view')?.addEventListener('click', () => {
    clearSavedSkillView(ctx.activeWorkspaceId());
    currentSaved = null;
    document.querySelector('#skill-view option[value="saved"]').disabled = true;
    document.querySelector('#clear-saved-skill-view').disabled = true;
    document.querySelector('#skill-view').value = 'all';
    ctx.toast('Saved skill filters cleared.');
    setView({ ...BUILT_IN_SKILL_VIEWS.all, q: '', view: 'all' });
  });
}

function renderSkillCollection(ctx, view) {
  const skills = filterAndSortSkills(ctx.state.skills, view);
  document.querySelector('#skills-count').textContent = `${skills.length} of ${ctx.state.skills.length} shown`;
  document.querySelector('#skills-head').innerHTML = `<tr><th scope="col">Skill</th>${view.columns.map(column => `<th scope="col">${escapeHtml(COLUMN_LABELS[column])}</th>`).join('')}</tr>`;
  document.querySelector('#skills-body').innerHTML = skills.length
    ? skills.map(skill => `<tr><td>${skillIdentity(ctx, skill, 'table')}</td>${view.columns.map(column => `<td>${skillColumn(skill, column)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${view.columns.length + 1}"><div class="empty"><strong>No matching skills</strong><span>Adjust the URL-owned filters or run a reviewed scan after approving roots.</span></div></td></tr>`;
  document.querySelector('#skills-cards').innerHTML = skills.length
    ? skills.map(skill => `<article class="skill-card"><div class="skill-card-head">${skillIdentity(ctx, skill, 'card')}</div><dl>${view.columns.map(column => `<div><dt>${escapeHtml(COLUMN_LABELS[column])}</dt><dd>${skillColumn(skill, column)}</dd></div>`).join('')}</dl></article>`).join('')
    : '<div class="empty"><strong>No matching skills</strong><span>Adjust filters to restore this mobile list.</span></div>';
  bindSkillRows(ctx);
}

function skillIdentity(ctx, skill, surface) {
  return `<button class="row-link skill-row" type="button" data-skill-id="${skill.skillId}">${escapeHtml(skill.displayName)}</button><br><code>${skill.skillId}</code><br><a class="text-link skill-permalink" href="${ctx.skillPermalink(skill.skillId)}" aria-label="Open permanent detail for ${escapeHtml(skill.displayName)}">${surface === 'card' ? 'Open detail' : 'Permalink'}</a>`;
}

function skillColumn(skill, column) {
  if (column === 'tier') return `<span class="pill ${skill.routeEligible ? 'good' : 'warn'}">${escapeHtml(skill.tier)}</span>`;
  if (column === 'variant') return escapeHtml(humanize(skill.variantState));
  if (column === 'scripts') return skill.hasScripts ? '<span class="pill warn">Review</span>' : '<span class="pill good">None</span>';
  if (column === 'revision') return `<code>${shortDigest(skill.contentRevision)}</code>`;
  if (column === 'scope') return escapeHtml(humanize(skill.sourceScope || 'unknown'));
  if (column === 'eligibility') return skill.routeEligible ? '<span class="pill good">Eligible</span>' : '<span class="pill warn">Excluded</span>';
  return '—';
}

function bindSkillRows(ctx) {
  for (const button of document.querySelectorAll('.skill-row')) button.addEventListener('click', () => renderSkillDetail(ctx, button.dataset.skillId, false));
  for (const link of document.querySelectorAll('.skill-permalink')) link.addEventListener('click', event => {
    event.preventDefault();
    history.pushState({}, '', event.currentTarget.getAttribute('href'));
    void ctx.renderRoute('skills');
  });
}

async function renderSkillDetail(ctx, skillId, deepLinked) {
  const target = document.querySelector('#skill-detail');
  target.innerHTML = '<section class="panel spaced-panel"><div class="loading-view compact" role="status"><span class="spinner" aria-hidden="true"></span><span>Loading skill detail…</span></div></section>';
  try {
    ctx.state.selectedSkill = await ctx.api(`/api/v1/skills/${skillId}`);
    const skill = ctx.state.selectedSkill;
    document.title = `${skill.displayName} · Skills · SkillMap local`;
    target.innerHTML = `<section class="panel spaced-panel skill-detail"><div class="panel-head"><div><h2>${escapeHtml(skill.displayName)}</h2><span>${escapeHtml(humanize(skill.variantState))}</span></div><button id="close-skill-detail" class="quiet-button" type="button">${deepLinked ? 'Back to skills' : 'Close detail'}</button></div><div class="panel-body"><p>${escapeHtml(skill.description || 'No redacted description is available.')}</p><div class="detail-grid"><dl><div><dt>Qualified ID</dt><dd><code>${skill.skillId}</code></dd></div><div><dt>Content revision</dt><dd><code>${shortDigest(skill.contentRevision)}</code></dd></div><div><dt>Tier</dt><dd>${pill(skill.tier, skill.routeEligible ? 'good' : 'warn')}</dd></div><div><dt>Explicit route</dt><dd>${skill.qualifiedExplicitAllowed ? 'Allowed' : 'Blocked'}</dd></div></dl><dl><div><dt>Scripts</dt><dd>${skill.scriptCount}</dd></div><div><dt>References</dt><dd>${skill.referenceCount}</dd></div><div><dt>Assets</dt><dd>${skill.assetCount}</dd></div><div><dt>Frontmatter</dt><dd>${skill.frontmatterValid ? 'Valid' : 'Needs review'}</dd></div></dl></div>${renderSourceContext(skill.sourceContext)}${renderPolicyContext(skill.policyContext)}${renderRouteHistory(ctx, skill.routeHistory)}<p class="microcopy">This detail contains redacted metadata only. Skill bodies, prompts, script paths, source locations, policy notes, and root paths are not returned.</p></div></section>`;
    document.querySelector('#close-skill-detail').addEventListener('click', () => {
      ctx.state.selectedSkill = null;
      if (deepLinked) ctx.navigate('skills', { replace: true, search: new URLSearchParams(location.search) });
      else target.replaceChildren();
    });
    target.querySelector('h2')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  } catch (error) {
    target.innerHTML = `<p class="callout spaced-panel">${escapeHtml(error.safeMessage || 'Skill detail could not be loaded.')}</p>`;
  }
}

function renderSourceContext(source = {}) {
  return `<section class="spaced-panel" aria-labelledby="skill-source-context"><h3 id="skill-source-context">Source context</h3><div class="detail-grid"><dl><div><dt>Tracked</dt><dd>${source.tracked ? 'Yes' : 'No'}</dd></div><div><dt>Type</dt><dd>${source.sourceType ? sourceTypePill(source.sourceType) : 'Not tracked'}</dd></div><div><dt>Status</dt><dd>${pill(source.state || 'not-tracked')}</dd></div><div><dt>Checked</dt><dd>${source.checked ? 'Yes' : 'No'}</dd></div></dl><dl><div><dt>Revision bound</dt><dd>${source.revisionBound ? 'Yes' : 'No'}</dd></div><div><dt>Reviewable</dt><dd>${source.reviewable ? 'Yes' : 'No'}</dd></div><div><dt>Risk</dt><dd>${source.risk ? pill(source.risk, source.risk === 'high' ? 'bad' : 'good') : 'Not recorded'}</dd></div><div><dt>Upstream commit</dt><dd>${source.upstreamCommit ? `<code>${shortDigest(source.upstreamCommit)}</code>` : 'Not recorded'}</dd></div></dl></div></section>`;
}

function sourceTypePill(value) {
  if (value === 'github') return '<span class="pill warn">GitHub</span>';
  return pill(value);
}

function renderPolicyContext(policy = {}) {
  return `<section class="spaced-panel" aria-labelledby="skill-policy-context"><h3 id="skill-policy-context">Policy context</h3><div class="detail-grid"><dl><div><dt>Policy version</dt><dd>${Number(policy.version) === 2 ? '2' : '1'}</dd></div><div><dt>Configured</dt><dd>${policy.configured ? 'Yes' : 'No'}</dd></div><div><dt>Tier</dt><dd>${pill(policy.tier || 'unknown')}</dd></div><div><dt>Route mode</dt><dd>${pill(policy.routeMode || 'blocked', policy.routeMode === 'implicit-and-explicit' ? 'good' : 'warn')}</dd></div></dl><dl><div><dt>Variant</dt><dd>${escapeHtml(humanize(policy.variantState || 'unknown'))}</dd></div><div><dt>Canonical</dt><dd>${policy.canonical ? 'Yes' : 'No'}</dd></div><div><dt>Canonical skill</dt><dd>${policy.canonicalSkillId ? `<code>${escapeHtml(policy.canonicalSkillId)}</code>` : 'Not selected'}</dd></div></dl></div></section>`;
}

function renderRouteHistory(ctx, history = {}) {
  const items = Array.isArray(history.items) ? history.items.slice(0, 10) : [];
  const body = items.length
    ? `<ul class="stack-list">${items.map(item => `<li><span><strong>${escapeHtml(humanize(item.outcome))}</strong><br><small>${escapeHtml(humanize(item.surface))} · ${escapeHtml(safeDate(item.createdAt))} · ${escapeHtml(humanize(item.latencyBucket))}</small><br><small>${escapeHtml((item.reasonCodes || []).slice(0, 10).map(humanize).join(' · ') || 'No reason codes')}</small></span><span><code>${escapeHtml(item.routeId)}</code><br><a class="text-link" href="${ctx.tracePermalink(item.routeId)}">Open redacted trace</a></span></li>`).join('')}</ul>`
    : '<div class="empty"><strong>No retained route history</strong><span>This skill was not selected in the bounded recent route window.</span></div>';
  const bounded = history.matchesTruncated || history.scanTruncated ? ' Additional retained events may exist outside this bounded view.' : '';
  return `<section class="spaced-panel" aria-labelledby="skill-route-history"><h3 id="skill-route-history">Recent route history</h3>${body}<p class="microcopy">Shows at most 10 prompt-free records from the newest 50 retained route events.${bounded} Raw prompts are never returned.</p></section>`;
}

function bindVariantGroups(ctx, groups) {
  for (const button of document.querySelectorAll('.compare-variants')) button.addEventListener('click', async () => {
    const group = groups[Number(button.dataset.groupIndex)];
    if (!group) return;
    await renderVariantCompare(ctx, group[0], group[1]);
  });
}

async function renderVariantCompare(ctx, displayName, skills) {
  const target = document.querySelector('#variant-compare');
  target.innerHTML = '<section class="panel spaced-panel"><div class="loading-view compact" role="status"><span class="spinner" aria-hidden="true"></span><span>Comparing variants…</span></div></section>';
  try {
    const details = await Promise.all(skills.map(skill => ctx.api(`/api/v1/skills/${skill.skillId}`)));
    target.innerHTML = `<section class="panel spaced-panel"><div class="panel-head"><h2>Compare ${escapeHtml(displayName)}</h2><span>Review only</span></div><div class="panel-body"><div class="variant-grid">${details.map(detail => `<article><h3>${escapeHtml(detail.displayName)}</h3><code>${detail.skillId}</code><p>${escapeHtml(detail.description || 'No description')}</p><ul class="stack-list"><li><span>Tier</span><small>${escapeHtml(detail.tier)}</small></li><li><span>Scripts</span><small>${detail.scriptCount}</small></li><li><span>Revision</span><small><code>${shortDigest(detail.contentRevision)}</code></small></li></ul></article>`).join('')}</div><form id="skill-canonical-form" class="canonical-form"><fieldset><legend>Canonical variant</legend>${details.map((detail, index) => `<label class="choice-option"><input type="radio" name="skillId" value="${detail.skillId}" ${index === 0 ? 'checked' : ''}><span><strong>${escapeHtml(detail.displayName)}</strong><small><code>${detail.skillId}</code></small></span></label>`).join('')}</fieldset><div class="field"><label for="skill-canonical-reason">Review reason</label><textarea id="skill-canonical-reason" name="reason" required maxlength="1000" placeholder="What was compared and why this variant wins"></textarea></div><p class="callout">Recording this choice creates a reviewed canonical decision. It does not apply policy or advance routing approval.</p><button class="button primary" type="submit">Record canonical decision</button></form></div></section>`;
    document.querySelector('#skill-canonical-form').addEventListener('submit', async event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      await recordCanonicalDecision(ctx, { displayName, skillId: values.get('skillId'), reason: values.get('reason'), button: event.currentTarget.querySelector('[type="submit"]') });
    });
  } catch (error) {
    target.innerHTML = `<p class="callout spaced-panel">${escapeHtml(error.safeMessage || 'Variants could not be compared.')}</p>`;
  }
}

async function loadAllSkills(ctx) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const pathname = `/api/v1/skills?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = await ctx.api(pathname);
    items.push(...(response.items || []));
    if (!response.nextCursor) return items;
    cursor = response.nextCursor;
  }
  throw { code: 'PAGINATION_LIMIT', safeMessage: 'The skill list exceeded the bounded local pagination limit.' };
}

function viewOptions(saved, selected) {
  const builtIns = Object.entries(BUILT_IN_SKILL_VIEWS).map(([key, value]) => option(key, selected, value.label)).join('');
  return `${builtIns}<option value="saved" ${selected === 'saved' ? 'selected' : ''} ${saved ? '' : 'disabled'}>Saved locally</option>${option('custom', selected, 'Current URL')}`;
}

function option(value, selected, label) { return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`; }
function uniqueValues(items, key) { return [...new Set(items.map(item => item[key]).filter(Boolean))].sort(); }
function groupSkills(skills) { const groups = new Map(); for (const skill of skills) { const items = groups.get(skill.displayName) || []; items.push(skill); groups.set(skill.displayName, items); } return groups; }
