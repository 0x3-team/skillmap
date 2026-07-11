export const DEFAULT_COLUMNS = Object.freeze(['tier', 'variant', 'scripts', 'revision']);
export const COLUMN_LABELS = Object.freeze({ tier: 'Tier', variant: 'Variant', scripts: 'Scripts', revision: 'Revision', scope: 'Scope', eligibility: 'Routing' });
const SORTS = new Set(['name', 'tier', 'variant', 'scripts', 'revision']);
const DIRECTIONS = new Set(['asc', 'desc']);
const ELIGIBILITY = new Set(['all', 'eligible', 'ineligible']);
const SCRIPTS = new Set(['all', 'yes', 'no']);

export const BUILT_IN_SKILL_VIEWS = Object.freeze({
  all: Object.freeze({ label: 'All skills', tier: 'all', eligibility: 'all', scripts: 'all', variant: 'all', sort: 'name', direction: 'asc', columns: DEFAULT_COLUMNS }),
  'route-ready': Object.freeze({ label: 'Route eligible', tier: 'all', eligibility: 'eligible', scripts: 'all', variant: 'all', sort: 'name', direction: 'asc', columns: [...DEFAULT_COLUMNS, 'eligibility'] }),
  'script-review': Object.freeze({ label: 'Scripts to review', tier: 'all', eligibility: 'all', scripts: 'yes', variant: 'all', sort: 'name', direction: 'asc', columns: DEFAULT_COLUMNS }),
  variants: Object.freeze({ label: 'Non-canonical variants', tier: 'all', eligibility: 'all', scripts: 'all', variant: 'noncanonical', sort: 'name', direction: 'asc', columns: DEFAULT_COLUMNS })
});

export function parseSkillView(parameters, savedView = null) {
  const requestedView = parameters.get('view') || 'all';
  const preset = requestedView === 'saved' && savedView ? savedView : BUILT_IN_SKILL_VIEWS[requestedView] || BUILT_IN_SKILL_VIEWS.all;
  return normalizeSkillView({
    q: boundedQuery(parameters.get('q') || ''),
    tier: parameters.get('tier') || preset.tier,
    eligibility: parameters.get('eligibility') || preset.eligibility,
    scripts: parameters.get('scripts') || preset.scripts,
    variant: parameters.get('variant') || preset.variant,
    sort: parameters.get('sort') || preset.sort,
    direction: parameters.get('direction') || preset.direction,
    columns: parameters.has('columns') ? parameters.get('columns').split(',') : preset.columns,
    view: requestedView === 'saved' && !savedView ? 'all' : requestedView
  });
}

export function normalizeSkillView(value) {
  const columns = [...new Set((Array.isArray(value.columns) ? value.columns : DEFAULT_COLUMNS).filter(item => Object.hasOwn(COLUMN_LABELS, item)))].slice(0, 6);
  return {
    q: boundedQuery(value.q || ''),
    tier: safeCode(value.tier, 'all'),
    eligibility: ELIGIBILITY.has(value.eligibility) ? value.eligibility : 'all',
    scripts: SCRIPTS.has(value.scripts) ? value.scripts : 'all',
    variant: safeCode(value.variant, 'all'),
    sort: SORTS.has(value.sort) ? value.sort : 'name',
    direction: DIRECTIONS.has(value.direction) ? value.direction : 'asc',
    columns: columns.length ? columns : [...DEFAULT_COLUMNS],
    view: safeCode(value.view, 'all')
  };
}

export function skillViewToQuery(view) {
  const normalized = normalizeSkillView(view);
  const parameters = new URLSearchParams();
  if (normalized.q) parameters.set('q', normalized.q);
  if (normalized.tier !== 'all') parameters.set('tier', normalized.tier);
  if (normalized.eligibility !== 'all') parameters.set('eligibility', normalized.eligibility);
  if (normalized.scripts !== 'all') parameters.set('scripts', normalized.scripts);
  if (normalized.variant !== 'all') parameters.set('variant', normalized.variant);
  if (normalized.sort !== 'name') parameters.set('sort', normalized.sort);
  if (normalized.direction !== 'asc') parameters.set('direction', normalized.direction);
  if (normalized.columns.join(',') !== DEFAULT_COLUMNS.join(',')) parameters.set('columns', normalized.columns.join(','));
  if (normalized.view !== 'all') parameters.set('view', normalized.view);
  return parameters;
}

export function savedSkillViewProjection(view) {
  const { q: _discarded, view: _label, ...safe } = normalizeSkillView(view);
  return safe;
}

export function filterAndSortSkills(skills, view) {
  const normalized = normalizeSkillView(view);
  const query = normalized.q.toLowerCase();
  const filtered = skills.filter(skill => {
    if (query && ![skill.displayName, skill.skillId, skill.description].join(' ').toLowerCase().includes(query)) return false;
    if (normalized.tier !== 'all' && skill.tier !== normalized.tier) return false;
    if (normalized.eligibility === 'eligible' && !skill.routeEligible) return false;
    if (normalized.eligibility === 'ineligible' && skill.routeEligible) return false;
    if (normalized.scripts === 'yes' && !skill.hasScripts) return false;
    if (normalized.scripts === 'no' && skill.hasScripts) return false;
    if (normalized.variant === 'noncanonical' && /canonical|only/i.test(skill.variantState || '')) return false;
    if (!['all', 'noncanonical'].includes(normalized.variant) && skill.variantState !== normalized.variant) return false;
    return true;
  });
  const direction = normalized.direction === 'desc' ? -1 : 1;
  return filtered.sort((left, right) => direction * compareSkill(left, right, normalized.sort));
}

function compareSkill(left, right, sort) {
  const values = {
    name: [left.displayName, right.displayName],
    tier: [left.tier, right.tier],
    variant: [left.variantState, right.variantState],
    scripts: [String(Boolean(left.hasScripts)), String(Boolean(right.hasScripts))],
    revision: [left.contentRevision, right.contentRevision]
  }[sort] || [left.displayName, right.displayName];
  return String(values[0] || '').localeCompare(String(values[1] || '')) || String(left.skillId).localeCompare(String(right.skillId));
}

function boundedQuery(value) {
  return Array.from(String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 160).join('');
}

function safeCode(value, fallback) {
  const code = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(code) ? code : fallback;
}
