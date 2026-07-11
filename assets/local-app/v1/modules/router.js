export const ROUTES = new Set(['overview', 'onboarding', 'workspaces', 'route', 'skills', 'policies', 'evals', 'sources', 'trust', 'integrations', 'activity', 'traces', 'settings']);
export const GLOBAL_ROUTES = new Set(['onboarding', 'workspaces']);
export const ROUTE_TITLES = Object.freeze({
  overview: 'Overview', onboarding: 'Onboarding', workspaces: 'Workspaces', route: 'Route Lab', skills: 'Skills', policies: 'Policies',
  evals: 'Evals', sources: 'Sources', trust: 'Trust', integrations: 'Integrations', activity: 'Activity', traces: 'Redacted trace', settings: 'Settings'
});

const SKILL_ID = /^sk_[A-Za-z0-9_-]{43}$/;
const TRACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseLocation(pathname) {
  const pieces = pathname.split('/').filter(Boolean);
  let route = 'overview';
  let routeIndex = -1;
  if (pieces[0] === 'app') {
    if (ROUTES.has(pieces[1])) { route = pieces[1]; routeIndex = 1; }
    else if (ROUTES.has(pieces[2])) { route = pieces[2]; routeIndex = 2; }
  }
  const candidateSkillId = route === 'skills' ? pieces[routeIndex + 1] : undefined;
  const candidateTraceId = route === 'traces' ? pieces[routeIndex + 1] : undefined;
  return {
    route,
    skillId: SKILL_ID.test(candidateSkillId || '') ? candidateSkillId : null,
    traceId: TRACE_ID.test(candidateTraceId || '') ? candidateTraceId : null
  };
}

export function routePath(route, workspaceId, { skillId = null, traceId = null } = {}) {
  const safeRoute = ROUTES.has(route) ? route : 'overview';
  const base = workspaceId && !GLOBAL_ROUTES.has(safeRoute) ? `/app/${workspaceId}/${safeRoute}` : `/app/${safeRoute}`;
  if (safeRoute === 'skills' && SKILL_ID.test(skillId || '')) return `${base}/${skillId}`;
  if (safeRoute === 'traces' && TRACE_ID.test(traceId || '')) return `${base}/${traceId}`;
  return base;
}

export function replaceCanonicalPath(pathname, { preserveSearch = true, preserveHash = true } = {}) {
  const parameters = preserveSearch ? new URLSearchParams(location.search) : new URLSearchParams();
  parameters.delete('bootstrap');
  const query = parameters.toString();
  const target = `${pathname}${query ? `?${query}` : ''}${preserveHash ? location.hash : ''}`;
  if (`${location.pathname}${location.search}${location.hash}` !== target) history.replaceState({}, '', target);
}
