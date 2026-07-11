export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

export function humanize(value) {
  return String(value || '').replace(/[_:-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export function shortDigest(value) {
  return value ? `${String(value).slice(0, 14)}…${String(value).slice(-6)}` : '—';
}

export function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—';
}

export function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

export function safeDate(value, fallback = 'Not recorded') {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}

export function pageHead(title, copy, actions = '') {
  return `<header class="page-head"><div><h1 tabindex="-1">${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
}

export function revisionLine(revision, mode) {
  return `<div class="revision-line" aria-label="Serving revision"><span>Serving <code>${escapeHtml(revision?.revisionId || 'unavailable')}</code></span><span>Effective <code>${shortDigest(revision?.effectiveRevisionDigest || revision?.effectiveDigest || '')}</code></span><span class="pill ${mode === 'last-known-good' ? 'warn' : 'good'}">${escapeHtml(mode || 'unknown')}</span></div>`;
}

export function metric(label, value, note) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(note)}</small></div>`;
}

export function verdictClass(value) {
  return value === 'ok' ? 'ok' : value === 'blocked' ? 'blocked' : '';
}

export function stateClass(value) {
  return /clean|local-authored|covered|accepted|succeeded|ready|pass/.test(value || '') ? 'good' : /risky|error|blocked|failed|unsafe/.test(value || '') ? 'bad' : 'warn';
}

export function pill(value, tone = stateClass(value)) {
  return `<span class="pill ${tone}">${escapeHtml(humanize(value || 'unknown'))}</span>`;
}

export function loadingState(label) {
  return `<div class="loading-view compact" role="status"><span class="spinner" aria-hidden="true"></span><span>Loading ${escapeHtml(label)}…</span></div>`;
}

export function errorView(error) {
  return `${pageHead('This view could not be loaded', 'The connector returned a bounded machine-readable error.', '<button class="button" id="view-retry" type="button">Retry</button>')}<p class="callout"><strong>${escapeHtml(error?.code || 'VIEW_ERROR')}</strong><br>${escapeHtml(error?.safeMessage || 'Review local diagnostics and retry.')}</p>`;
}

export function aggregateRows(value, empty = 'No evidence recorded') {
  const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
  if (!entries.length) return `<li><span>${escapeHtml(empty)}</span><small>—</small></li>`;
  return entries.map(([key, item]) => `<li><span>${escapeHtml(humanize(key))}</span><small>${escapeHtml(formatAggregateValue(item))}</small></li>`).join('');
}

function formatAggregateValue(value) {
  if (typeof value === 'boolean') return value ? 'Pass' : 'Not met';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return humanize(value);
  if (value === null || value === undefined) return '—';
  return 'Recorded';
}
