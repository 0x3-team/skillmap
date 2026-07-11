const SAFE_SNAPSHOT_KEYS = new Set(['workspace', 'dashboard']);
const ABSOLUTE_PATH = /(^|[\s("'=])(?:\/(?!\/)[^\s"'<>),;]+|[A-Za-z]:\\[^\s"'<>),;]+|\\\\[^\s"'<>),;]+)/;
const PRIVATE_KEYS = /^(?:candidate(?:Path|Value)?|configuredPath|realPath|path|(?:raw)?prompt(?:Text|Preview|Value|Input|Content)?|hookText|(?:raw)?(?:skill)?body(?:Text|Preview|Value|Content)?|reason(?:Text|Preview|Value|Content)?|comment(?:Text|Preview|Value|Content)?|secret(?:Value)?|token(?:Value)?|password(?:Value)?|privateKey(?:Value)?)$/i;
const CONNECTOR_AUTH_STORAGE_KEY = 'skillmap.connector-auth.v1';
const CONNECTOR_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SNAPSHOT_KIND = 'skillmap.safe-snapshot';
const SNAPSHOT_SCHEMA_VERSION = 1;

export function createState() {
  const connectorAuth = consumeConnectorAuthFragment();
  return {
    capability: connectorAuth.capability,
    csrf: connectorAuth.csrf,
    bootstrap: null,
    workspace: null,
    dashboard: null,
    connected: false,
    connectionLabel: 'Connecting',
    activeRoute: '',
    routeResult: null,
    skills: [],
    selectedSkill: null,
    routeController: null,
    workspaceValidation: null,
    etags: new Map(),
    responseCache: new Map(),
    pollTimer: null,
    viewStale: false,
    offlineData: false,
    compatibilityBlocked: null,
    workspaceEpoch: 0,
    renderEpoch: 0,
    bootController: null,
    viewCleanup: null
  };
}

export function rememberSnapshot(key, value, compatibility, validatePayload) {
  if (!SAFE_SNAPSHOT_KEYS.has(key)
    || !isCompatibilityReceipt(compatibility)
    || typeof validatePayload !== 'function'
    || !passesPayloadValidation(value, validatePayload)
    || hasPrivateMetadata(value)) {
    removeSnapshot(key);
    return false;
  }
  try {
    sessionStorage.setItem(`skillmap:${key}`, JSON.stringify({
      kind: SNAPSHOT_KIND,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      key,
      compatibility: { ...compatibility },
      data: value
    }));
    return true;
  } catch {
    return false;
  }
}

export function recallSnapshot(key, compatibility, validatePayload) {
  if (!SAFE_SNAPSHOT_KEYS.has(key)) return null;
  try {
    const snapshot = JSON.parse(sessionStorage.getItem(`skillmap:${key}`));
    const valid = snapshot
      && typeof snapshot === 'object'
      && !Array.isArray(snapshot)
      && Object.keys(snapshot).sort().join(',') === 'compatibility,data,key,kind,schemaVersion'
      && snapshot.kind === SNAPSHOT_KIND
      && snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION
      && snapshot.key === key
      && sameCompatibility(snapshot.compatibility, compatibility)
      && typeof validatePayload === 'function'
      && passesPayloadValidation(snapshot.data, validatePayload)
      && !hasPrivateMetadata(snapshot.data);
    if (!valid) {
      removeSnapshot(key);
      return null;
    }
    return snapshot.data;
  } catch {
    removeSnapshot(key);
    return null;
  }
}

export function clearPersistedSnapshots() {
  for (const key of SAFE_SNAPSHOT_KEYS) removeSnapshot(key);
}

export function clearSkillMapStorage() {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith('skillmap:')) storage.removeItem(key);
      }
    } catch {}
  }
}

export function clearConnectorAuth(state) {
  try { sessionStorage.removeItem(CONNECTOR_AUTH_STORAGE_KEY); } catch {}
  if (state && typeof state === 'object') {
    state.capability = '';
    state.csrf = '';
  }
}

export function resetWorkspaceState(state) {
  try { state.viewCleanup?.(); } catch {}
  state.viewCleanup = null;
  state.workspaceEpoch += 1;
  state.renderEpoch += 1;
  state.bootController?.abort();
  state.routeController?.abort();
  if (state.pollTimer) clearInterval(state.pollTimer);
  Object.assign(state, {
    bootstrap: null, workspace: null, dashboard: null, routeResult: null,
    skills: [], selectedSkill: null, routeController: null, workspaceValidation: null,
    pollTimer: null, viewStale: false, offlineData: false, compatibilityBlocked: null, bootController: null, viewCleanup: null
  });
  state.etags.clear();
  state.responseCache.clear();
  clearSkillMapStorage();
}

function consumeConnectorAuthFragment() {
  const empty = { capability: '', csrf: '' };
  try {
    const hash = globalThis.location?.hash || '';
    const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
    const parameters = new URLSearchParams(fragment);
    const hasAuthFragment = parameters.has('skillmap-capability') || parameters.has('skillmap-csrf');
    if (hasAuthFragment) {
      const capabilityValues = parameters.getAll('skillmap-capability');
      const csrfValues = parameters.getAll('skillmap-csrf');
      const exact = [...parameters.keys()].length === 2
        && capabilityValues.length === 1
        && csrfValues.length === 1
        && CONNECTOR_TOKEN.test(capabilityValues[0])
        && CONNECTOR_TOKEN.test(csrfValues[0]);
      const target = `${globalThis.location.pathname}${globalThis.location.search}`;
      globalThis.history?.replaceState?.({}, '', target);
      if (!exact) {
        clearConnectorAuth();
        return empty;
      }
      const auth = { capability: capabilityValues[0], csrf: csrfValues[0] };
      sessionStorage.setItem(CONNECTOR_AUTH_STORAGE_KEY, JSON.stringify(auth));
      return auth;
    }
    const stored = JSON.parse(sessionStorage.getItem(CONNECTOR_AUTH_STORAGE_KEY));
    if (stored && typeof stored === 'object' && !Array.isArray(stored)
      && Object.keys(stored).length === 2
      && CONNECTOR_TOKEN.test(stored.capability)
      && CONNECTOR_TOKEN.test(stored.csrf)) {
      return { capability: stored.capability, csrf: stored.csrf };
    }
    clearConnectorAuth();
  } catch {
    clearConnectorAuth();
  }
  return empty;
}

export function pendingJobKey(slot, type) {
  const key = `skillmap:job-key:${slot}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `ui:${type}:${randomId()}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `ui:${type}:${randomId()}`;
  }
}

export function clearPendingJobKey(slot) {
  try { sessionStorage.removeItem(`skillmap:job-key:${slot}`); } catch {}
}

export function pendingCancellationKey(jobId) {
  const key = `skillmap:job-cancel-key:${jobId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = `ui-cancel:${jobId}:${randomId()}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `ui-cancel:${jobId}:${randomId()}`;
  }
}

export function clearPendingCancellationKey(jobId) {
  try { sessionStorage.removeItem(`skillmap:job-cancel-key:${jobId}`); } catch {}
}

export function loadSavedSkillView(workspaceId) {
  if (!isWorkspaceId(workspaceId)) return null;
  try { return sanitizeSavedSkillView(JSON.parse(localStorage.getItem(`skillmap:saved-skill-view:${workspaceId}`))); } catch { return null; }
}

export function saveSkillView(workspaceId, value) {
  if (!isWorkspaceId(workspaceId)) return false;
  const safe = sanitizeSavedSkillView(value);
  if (!safe) return false;
  try { localStorage.setItem(`skillmap:saved-skill-view:${workspaceId}`, JSON.stringify(safe)); return true; } catch { return false; }
}

export function clearSavedSkillView(workspaceId) {
  if (!isWorkspaceId(workspaceId)) return;
  try { localStorage.removeItem(`skillmap:saved-skill-view:${workspaceId}`); } catch {}
}

export function hasPrivateMetadata(value, seen = new Set()) {
  if (typeof value === 'string') return ABSOLUTE_PATH.test(value) || /\bfile:\/\//i.test(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => hasPrivateMetadata(item, seen));
  return Object.entries(value).some(([key, item]) => PRIVATE_KEYS.test(key) || hasPrivateMetadata(item, seen));
}

function passesPayloadValidation(value, validatePayload) {
  try {
    validatePayload(value);
    return true;
  } catch {
    return false;
  }
}

function isCompatibilityReceipt(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'apiVersion,localAppAssetVersion,productVersion'
    && ['apiVersion', 'localAppAssetVersion', 'productVersion'].every(key => typeof value[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value[key]));
}

function sameCompatibility(value, expected) {
  return isCompatibilityReceipt(value)
    && isCompatibilityReceipt(expected)
    && value.apiVersion === expected.apiVersion
    && value.localAppAssetVersion === expected.localAppAssetVersion
    && value.productVersion === expected.productVersion;
}

function removeSnapshot(key) {
  if (!SAFE_SNAPSHOT_KEYS.has(key)) return;
  try { sessionStorage.removeItem(`skillmap:${key}`); } catch {}
}

function sanitizeSavedSkillView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tier = safeCode(value.tier, 'all');
  const eligibility = ['all', 'eligible', 'ineligible'].includes(value.eligibility) ? value.eligibility : 'all';
  const scripts = ['all', 'yes', 'no'].includes(value.scripts) ? value.scripts : 'all';
  const variant = safeCode(value.variant, 'all');
  const sort = ['name', 'tier', 'variant', 'scripts', 'revision'].includes(value.sort) ? value.sort : 'name';
  const direction = value.direction === 'desc' ? 'desc' : 'asc';
  const allowedColumns = new Set(['tier', 'variant', 'scripts', 'revision', 'scope', 'eligibility']);
  const columns = Array.isArray(value.columns) ? [...new Set(value.columns.filter(item => allowedColumns.has(item)))].slice(0, 6) : ['tier', 'variant', 'scripts', 'revision'];
  return { tier, eligibility, scripts, variant, sort, direction, columns };
}

function safeCode(value, fallback) {
  const code = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(code) ? code : fallback;
}

function isWorkspaceId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
