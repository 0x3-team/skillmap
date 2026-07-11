import { renderActivity, renderTraceDetail } from './activity.js';
import { renderEvals } from './evals.js';
import { renderIntegrations } from './integrations.js';
import { renderOnboarding } from './onboarding.js';
import { renderOverview } from './overview.js';
import { renderPolicies } from './policies.js';
import { renderRouteLab } from './route-lab.js';
import { renderSettings } from './settings.js';
import { renderSkills } from './skills.js';
import { renderSources } from './sources.js';
import { renderTrust } from './trust.js';
import { renderWorkspaces } from './workspaces.js';

export const VIEWS = Object.freeze({
  overview: renderOverview,
  onboarding: renderOnboarding,
  workspaces: renderWorkspaces,
  route: renderRouteLab,
  skills: renderSkills,
  policies: renderPolicies,
  evals: renderEvals,
  sources: renderSources,
  trust: renderTrust,
  integrations: renderIntegrations,
  activity: renderActivity,
  traces: renderTraceDetail,
  settings: renderSettings
});
