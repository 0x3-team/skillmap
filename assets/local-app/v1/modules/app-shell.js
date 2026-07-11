import { assertEndpointPayload, createApiClient, EXPECTED_CONNECTOR_COMPATIBILITY, isCompatibilityError } from './api.js';
import { createJobActions } from './jobs.js';
import { errorView, escapeHtml, loadingState } from './render.js';
import { parseLocation, replaceCanonicalPath, ROUTES, ROUTE_TITLES, routePath } from './router.js';
import { clearConnectorAuth, clearPersistedSnapshots, createState, recallSnapshot, rememberSnapshot, resetWorkspaceState } from './state.js';
import { VIEWS } from './views/index.js';

export function createLocalApp() {
  const state = createState();
  const root = document.querySelector('#view-root');
  const loading = document.querySelector('#loading-view');
  const app = document.querySelector('#app');
  const banner = document.querySelector('#connection-banner');
  const retry = document.querySelector('#retry-button');
  const nav = document.querySelector('#primary-nav');
  const viewNotice = document.querySelector('#view-state-banner');
  const context = {
    state,
    root,
    api: null,
    jobs: null,
    mount(html) { root.innerHTML = html; },
    navigate,
    renderRoute,
    boot,
    refreshOverview,
    refreshWorkspaceState,
    activeWorkspaceId,
    bootstrapNeedsOnboarding,
    currentRevisionId,
    clearClientWorkspaceState,
    invalidate,
    toast,
    updateRevision,
    skillPermalink(skillId) { return routePath('skills', activeWorkspaceId(), { skillId }); },
    tracePermalink(traceId) { return routePath('traces', activeWorkspaceId(), { traceId }); }
  };
  const api = createApiClient(state, { setConnected, showStaleNotice, blockCompatibility });
  context.api = api;
  context.jobs = createJobActions(context);

  async function start() {
    document.addEventListener('click', handleRouteClick);
    window.addEventListener('popstate', () => { void renderRoute(routeFromLocation()); });
    retry.addEventListener('click', () => { void boot(true); });
    document.querySelector('#refresh-view').addEventListener('click', () => {
      invalidate();
      void renderRoute(routeFromLocation());
    });
    await boot(false);
  }

  async function boot(fromRetry) {
    const epoch = state.workspaceEpoch + 1;
    state.workspaceEpoch = epoch;
    state.bootController?.abort();
    const controller = new AbortController();
    state.bootController = controller;
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
    setConnected(false, fromRetry ? 'Retrying' : 'Connecting');
    try {
      state.bootstrap = await api('/api/v1/bootstrap', { cache: false, signal: controller.signal });
      if (epoch !== state.workspaceEpoch) return;
      if (state.bootstrap.initialized && !requiresOnboarding(state.bootstrap.state)) {
        [state.workspace, state.dashboard] = await Promise.all([api('/api/v1/workspace', { signal: controller.signal }), api('/api/v1/dashboard', { signal: controller.signal })]);
        if (epoch !== state.workspaceEpoch) return;
        rememberAppSnapshot('workspace', state.workspace);
        rememberAppSnapshot('dashboard', state.dashboard);
      } else {
        state.workspace = null;
        state.dashboard = null;
      }
      setConnected(true, ['degraded', 'attention-required', 'manual-repair-required', 'recovery-required', 'needs-state-migration', 'partial-legacy'].includes(state.bootstrap.state) ? 'Attention' : 'Connected');
      loading.hidden = true;
      app.setAttribute('aria-busy', 'false');
      updateChrome();
      const requested = routeFromLocation();
      const onboardingRequired = bootstrapNeedsOnboarding(state.bootstrap);
      await renderRoute(onboardingRequired && !['trust', 'workspaces'].includes(requested.route) ? { route: 'onboarding', skillId: null } : requested);
      if (epoch !== state.workspaceEpoch) return;
      startPolling();
    } catch (error) {
      if (epoch !== state.workspaceEpoch || controller.signal.aborted) return;
      if (isCompatibilityError(error)) {
        blockCompatibility(error);
        return;
      }
      const cachedWorkspace = recallAppSnapshot('workspace');
      const cachedDashboard = recallAppSnapshot('dashboard');
      if (cachedWorkspace && cachedDashboard) {
        state.workspace = cachedWorkspace;
        state.dashboard = cachedDashboard;
        state.bootstrap = { initialized: true, state: 'offline' };
        state.offlineData = true;
        loading.hidden = true;
        app.setAttribute('aria-busy', 'false');
        updateChrome();
        setConnected(false, 'Disconnected');
        showStaleNotice('Showing the last redacted workspace snapshot. Mutations remain paused until reconnection.');
        await renderRoute(routeFromLocation());
        startPolling();
      } else {
        loading.innerHTML = `<div class="empty"><strong>Connector authorization is unavailable</strong><p>${escapeHtml(error.safeMessage || 'Reopen the one-time URL printed by skillmap dashboard.')}</p></div>`;
        app.setAttribute('aria-busy', 'false');
      }
    } finally {
      if (state.bootController === controller) state.bootController = null;
    }
  }

  async function renderRoute(input) {
    try { state.viewCleanup?.(); } catch {}
    state.viewCleanup = null;
    const renderEpoch = state.renderEpoch + 1;
    state.renderEpoch = renderEpoch;
    let descriptor;
    if (typeof input === 'string') {
      const parsed = parseLocation(location.pathname);
      descriptor = {
        route: ROUTES.has(input) ? input : 'overview',
        skillId: input === 'skills' ? parsed.skillId : null,
        traceId: input === 'traces' ? parsed.traceId : null
      };
    } else descriptor = input || routeFromLocation();
    if (descriptor.route !== 'workspaces') state.workspaceValidation = null;
    state.activeRoute = descriptor.route;
    document.title = `${ROUTE_TITLES[descriptor.route] || 'Workspace'} · SkillMap local`;
    const navRoute = descriptor.route === 'traces' ? 'activity' : descriptor.route;
    for (const link of nav.querySelectorAll('[data-route]')) {
      if (link.dataset.route === navRoute) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = loadingState((ROUTE_TITLES[descriptor.route] || 'workspace').toLowerCase());
    try {
      const view = VIEWS[descriptor.route] || VIEWS.overview;
      const renderContext = {
        ...context,
        mount(html) { if (state.renderEpoch === renderEpoch) root.innerHTML = html; },
        onViewDispose(callback) {
          if (state.renderEpoch === renderEpoch && typeof callback === 'function') state.viewCleanup = callback;
        }
      };
      await view(renderContext, descriptor);
      if (state.renderEpoch !== renderEpoch) return;
    } catch (error) {
      if (state.renderEpoch !== renderEpoch) return;
      root.innerHTML = errorView(error);
      document.querySelector('#view-retry')?.addEventListener('click', () => { void renderRoute(descriptor); });
    } finally {
      if (state.renderEpoch !== renderEpoch) return;
      root.setAttribute('aria-busy', 'false');
      const focusTarget = root.querySelector('h1') || document.querySelector('#main');
      focusTarget?.focus({ preventScroll: true });
    }
  }

  function navigate(route, options = {}) {
    const safeRoute = ROUTES.has(route) ? route : 'overview';
    const pathname = routePath(safeRoute, activeWorkspaceId(), { skillId: options.skillId || null, traceId: options.traceId || null });
    const parameters = options.search instanceof URLSearchParams ? options.search : new URLSearchParams();
    const target = `${pathname}${parameters.size ? `?${parameters}` : ''}`;
    history[options.replace ? 'replaceState' : 'pushState']({}, '', target);
    void renderRoute({ route: safeRoute, skillId: options.skillId || null, traceId: options.traceId || null });
  }

  function routeFromLocation() {
    const parsed = parseLocation(location.pathname);
    const workspaceId = activeWorkspaceId();
    if (['workspaces', 'onboarding'].includes(parsed.route)) {
      replaceCanonicalPath(`/app/${parsed.route}`);
      return parsed;
    }
    if (bootstrapNeedsOnboarding(state.bootstrap)) {
      if (parsed.route === 'trust' && !workspaceId) {
        replaceCanonicalPath('/app/trust');
        return parsed;
      }
      replaceCanonicalPath('/app/onboarding');
      return { route: 'onboarding', skillId: null };
    }
    if (!workspaceId) {
      replaceCanonicalPath('/app/onboarding');
      return { route: 'onboarding', skillId: null };
    }
    replaceCanonicalPath(routePath(parsed.route, workspaceId, { skillId: parsed.skillId, traceId: parsed.traceId }));
    return parsed;
  }

  function handleRouteClick(event) {
    const control = event.target.closest('[data-route]');
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    navigate(control.dataset.route);
  }

  function activeWorkspaceId() {
    const value = state.workspace?.workspaceId || state.dashboard?.workspace?.workspaceId || state.bootstrap?.currentRevision?.workspaceId || state.bootstrap?.revision?.workspaceId;
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
  }

  function currentRevisionId() {
    return state.dashboard?.currentRevision?.revisionId || state.workspace?.currentRevision?.revisionId || null;
  }

  function requiresOnboarding(bootstrapState) {
    return ['needs-state-migration', 'recovery-required', 'manual-repair-required', 'partial-legacy'].includes(bootstrapState);
  }

  function bootstrapNeedsOnboarding(bootstrap) {
    const current = bootstrap?.currentRevision || state.dashboard?.currentRevision || state.workspace?.currentRevision;
    const currentHasEffectiveRegistry = Boolean(current?.effectiveRevisionDigest || current?.effectiveDigest);
    return !bootstrap?.initialized || requiresOnboarding(bootstrap.state) || (bootstrap.routingReady !== true && !bootstrap.revision && !currentHasEffectiveRegistry);
  }

  function clearClientWorkspaceState() {
    resetWorkspaceState(state);
    root.replaceChildren();
    loading.hidden = false;
    loading.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Opening the selected workspace…</span>';
    app.setAttribute('aria-busy', 'true');
    hideStaleNotice();
  }

  async function refreshOverview() {
    const epoch = state.workspaceEpoch;
    const [workspace, dashboard] = await Promise.all([api('/api/v1/workspace'), api('/api/v1/dashboard')]);
    if (epoch !== state.workspaceEpoch) return;
    state.workspace = workspace;
    state.dashboard = dashboard;
    rememberAppSnapshot('workspace', state.workspace);
    rememberAppSnapshot('dashboard', state.dashboard);
    updateChrome();
    await renderRoute('overview');
  }

  async function refreshWorkspaceState(background) {
    const epoch = state.workspaceEpoch;
    try {
      const previous = state.dashboard?.currentRevision?.revisionId;
      const [workspace, dashboard] = await Promise.all([api('/api/v1/workspace'), api('/api/v1/dashboard')]);
      if (epoch !== state.workspaceEpoch) return;
      state.workspace = workspace;
      state.dashboard = dashboard;
      rememberAppSnapshot('workspace', workspace);
      rememberAppSnapshot('dashboard', dashboard);
      updateChrome();
      if (previous && dashboard?.currentRevision?.revisionId !== previous) {
        state.viewStale = true;
        if (background) toast('A new workspace revision is available.');
        if (state.activeRoute === 'overview') {
          state.viewStale = false;
          hideStaleNotice();
          await renderRoute('overview');
        } else showStaleNotice('A newer workspace revision is available. Refresh this view before making a revision-bound decision.');
      }
    } catch (error) {
      if (!background) throw error;
    }
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (bootstrapNeedsOnboarding(state.bootstrap)) return;
    state.pollTimer = setInterval(() => { void refreshWorkspaceState(true); }, 5000);
  }

  function invalidate() {
    api.invalidate();
    hideStaleNotice();
  }

  function updateChrome() {
    const name = safeChromeLabel(state.workspace?.name || state.dashboard?.workspace?.name || 'Uninitialized workspace');
    document.querySelector('#workspace-button').textContent = name;
    updateRevision(state.dashboard?.revision || state.workspace?.revision);
  }

  function updateRevision(revision) {
    document.querySelector('#revision-short').textContent = revision?.revisionId ? revision.revisionId.slice(0, 14) : 'no revision';
  }

  function setConnected(connected, label) {
    state.connected = connected;
    state.connectionLabel = label;
    const dot = document.querySelector('#connection-dot');
    dot.className = `status-dot ${connected ? 'online' : 'offline'}`;
    document.querySelector('#connection-label').textContent = label;
    document.querySelector('#sidebar-connector').textContent = label;
    banner.hidden = connected;
    if (!connected) {
      document.querySelector('#banner-title').textContent = label === 'Connecting' || label === 'Retrying' ? `${label} to connector` : 'Connector disconnected';
      document.querySelector('#banner-copy').textContent = state.workspace ? 'The last redacted view is retained. Mutations are paused.' : 'Reopen the one-time dashboard URL if authorization cannot be restored.';
    }
  }

  function showStaleNotice(message) {
    document.querySelector('#view-state-copy').textContent = message;
    viewNotice.hidden = false;
  }
  function hideStaleNotice() { viewNotice.hidden = true; }

  function blockCompatibility(error) {
    try { state.viewCleanup?.(); } catch {}
    state.viewCleanup = null;
    clearConnectorAuth(state);
    api.invalidate();
    clearPersistedSnapshots();
    Object.assign(state, {
      bootstrap: null,
      workspace: null,
      dashboard: null,
      routeResult: null,
      skills: [],
      selectedSkill: null,
      workspaceValidation: null,
      viewStale: false,
      offlineData: false
    });
    state.compatibilityBlocked = error;
    state.renderEpoch += 1;
    state.routeController?.abort();
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
    loading.hidden = true;
    app.setAttribute('aria-busy', 'false');
    setConnected(false, 'Update required');
    hideStaleNotice();
    document.querySelector('#workspace-button').textContent = 'Compatibility blocked';
    document.querySelector('#revision-short').textContent = 'blocked';
    const received = error?.receivedCompatibility;
    root.innerHTML = `<section id="compatibility-blocked" class="compatibility-blocked" data-error-code="${escapeHtml(error?.code || 'API_COMPATIBILITY_BLOCKED')}" role="alert"><span class="verdict blocked">Blocked</span><h1 tabindex="-1">Local app update required</h1><p>${escapeHtml(error?.safeMessage || 'The local app and connector versions do not match.')}</p><dl><div><dt>Expected API</dt><dd><code>${EXPECTED_CONNECTOR_COMPATIBILITY.apiVersion}</code></dd></div><div><dt>Expected assets</dt><dd><code>${EXPECTED_CONNECTOR_COMPATIBILITY.localAppAssetVersion}</code></dd></div><div><dt>Expected product</dt><dd><code>${EXPECTED_CONNECTOR_COMPATIBILITY.productVersion}</code></dd></div>${received ? `<div><dt>Received</dt><dd><code>${escapeHtml(`${received.apiVersion} · ${received.localAppAssetVersion} · ${received.productVersion}`)}</code></dd></div>` : ''}</dl><p class="callout">No cached workspace data or mutation controls are available in this state. Authorization was cleared. Stop this dashboard process, update SkillMap, start <code>skillmap dashboard</code> again, and open the newly printed URL.</p><small>Error code: <code>${escapeHtml(error?.code || 'API_COMPATIBILITY_BLOCKED')}</code></small></section>`;
    root.querySelector('h1')?.focus({ preventScroll: true });
  }

  function toast(message) {
    const region = document.querySelector('#toast-region');
    region.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
    setTimeout(() => { region.innerHTML = ''; }, 4500);
  }

  return { start, boot, renderRoute, navigate, state };
}

function snapshotEndpoint(key) {
  return key === 'workspace' ? '/api/v1/workspace' : key === 'dashboard' ? '/api/v1/dashboard' : null;
}

function rememberAppSnapshot(key, value) {
  const endpoint = snapshotEndpoint(key);
  if (!endpoint) return false;
  return rememberSnapshot(key, value, EXPECTED_CONNECTOR_COMPATIBILITY, candidate => assertEndpointPayload(endpoint, candidate));
}

function recallAppSnapshot(key) {
  const endpoint = snapshotEndpoint(key);
  if (!endpoint) return null;
  return recallSnapshot(key, EXPECTED_CONNECTOR_COMPATIBILITY, candidate => assertEndpointPayload(endpoint, candidate));
}

function safeChromeLabel(value) {
  const label = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return label && label.length <= 96 && !/[\\/]/.test(label) && !/^file:/i.test(label) ? label : 'Local workspace';
}
