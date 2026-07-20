const PUBLIC_ROOT_PATHS = [
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'package.json'
];

export const PUBLIC_DOC_PATHS = new Set([
  'docs/architecture.md',
  'docs/architecture/hosted-registry.md',
  'docs/commands.md',
  'docs/curation.md',
  'docs/decisions/2026-07-11-hosted-architecture.md',
  'docs/decisions/2026-07-11-hosted-legal-boundary.md',
  'docs/dogfood.md',
  'docs/external-pilot-runbook.md',
  'docs/first-run.md',
  'docs/hooks.md',
  'docs/host-compatibility.md',
  'docs/local-app-browser-testing.md',
  'docs/launch/free-public-alpha-go-to-market.md',
  'docs/launch/hosted-alpha-pilot-runbook.md',
  'docs/launch/initial-corpus-operations.md',
  'docs/launch/initial-corpus-v1.json',
  'docs/launch/public-alpha-policy-pack.md',
  'docs/operations/free-public-alpha-runbook.md',
  'docs/operations/hosted-alpha-deploy.md',
  'docs/personal-v1-runbook.md',
  'docs/release-checklist.md',
  'docs/release-provenance.md',
  'docs/research/2026-07-11-skillmap-hosted-library-verified-research.md',
  'docs/security.md',
  'docs/security/hosted-threat-model.md',
  'docs/specs/advisory-v1.md',
  'docs/specs/evidence-states-v1.md',
  'docs/specs/grade-receipt-v1.md',
  'docs/specs/host-profile-v1.md',
  'docs/specs/hosted-identity-v1.md',
  'docs/specs/package-format-v1.md',
  'docs/specs/registry-tuf-profile-v1.md',
  'docs/specs/route-plan-v1.md',
  'docs/specs/source-coverage-receipt-v1.md',
  'docs/support.md',
  'docs/telemetry.md',
  'docs/threat-model.md',
  'docs/troubleshooting.md',
  'docs/ui-acceptance-matrix.md'
]);

const PUBLIC_LOCAL_APP_PATHS = [
  'assets/local-app/v1/app.css',
  'assets/local-app/v1/app.js',
  'assets/local-app/v1/index.html',
  'assets/local-app/v1/modules/api.js',
  'assets/local-app/v1/modules/app-shell.js',
  'assets/local-app/v1/modules/eval-review-state.js',
  'assets/local-app/v1/modules/eval-v3-review-state.js',
  'assets/local-app/v1/modules/jobs.js',
  'assets/local-app/v1/modules/policy-actions.js',
  'assets/local-app/v1/modules/render.js',
  'assets/local-app/v1/modules/router.js',
  'assets/local-app/v1/modules/skill-view-state.js',
  'assets/local-app/v1/modules/state.js',
  'assets/local-app/v1/modules/views/activity.js',
  'assets/local-app/v1/modules/views/evals.js',
  'assets/local-app/v1/modules/views/index.js',
  'assets/local-app/v1/modules/views/integrations.js',
  'assets/local-app/v1/modules/views/onboarding.js',
  'assets/local-app/v1/modules/views/overview.js',
  'assets/local-app/v1/modules/views/policies.js',
  'assets/local-app/v1/modules/views/route-lab.js',
  'assets/local-app/v1/modules/views/settings.js',
  'assets/local-app/v1/modules/views/skills.js',
  'assets/local-app/v1/modules/views/sources.js',
  'assets/local-app/v1/modules/views/trust.js',
  'assets/local-app/v1/modules/views/workspaces.js'
];

const PUBLIC_CONTRACT_PATHS = [
  'contracts/api-envelope/v1.schema.json',
  'contracts/canonicalization-v1.md',
  'contracts/common/v1.schema.json',
  'contracts/dashboard/v2.schema.json',
  'contracts/dashboard/v3.schema.json',
  'contracts/eval-run/v2.schema.json',
  'contracts/eval-run/v3.schema.json',
  'contracts/eval-suite/v2.schema.json',
  'contracts/eval-suite/v3.schema.json',
  'contracts/event/v1.schema.json',
  'contracts/hosted-api-response/v1.schema.json',
  'contracts/hosted-audit-receipt/v1.schema.json',
  'contracts/hosted-audit-summary/v1.schema.json',
  'contracts/hosted-grade-receipt/v1.schema.json',
  'contracts/hosted-grade-summary/v1.schema.json',
  'contracts/hosted-review-state/v1.schema.json',
  'contracts/hosted-skill-list/v1.schema.json',
  'contracts/hosted-skill/v1.schema.json',
  'contracts/hosted-submission/v1.schema.json',
  'contracts/job/v1.schema.json',
  'contracts/manifest.json',
  'contracts/mcp-doctor-summary-result/v1.schema.json',
  'contracts/mcp-route-prompt-result/v1.schema.json',
  'contracts/mcp-search-skills-result/v1.schema.json',
  'contracts/mcp-show-skill-result/v1.schema.json',
  'contracts/mcp-show-skillgraph-result/v1.schema.json',
  'contracts/mcp-source-status-result/v1.schema.json',
  'contracts/route-feedback/v1.schema.json',
  'contracts/route-result/v2.schema.json',
  'contracts/skill-identity/v1.schema.json',
  'contracts/sync-envelope/v1.schema.json',
  'contracts/test-vectors/canonicalization-v1.json',
  'contracts/type-facade.ts',
  'contracts/workspace-revision/v1.schema.json'
];

const PUBLIC_DIST_MODULES = [
  'cli',
  'commands/apply-policy',
  'commands/common',
  'commands/curate',
  'commands/dashboard',
  'commands/doctor-pack',
  'commands/doctor',
  'commands/eval',
  'commands/export',
  'commands/graph',
  'commands/hook',
  'commands/identity',
  'commands/import',
  'commands/ingest-agent-review',
  'commands/init',
  'commands/list',
  'commands/mcp',
  'commands/policy',
  'commands/route',
  'commands/scan',
  'commands/sources',
  'commands/state',
  'commands/status',
  'contracts/eval-semantics',
  'contracts/fixture-path',
  'contracts/generated/schema-bundle',
  'contracts/generated/types',
  'contracts/route-ranking',
  'contracts/validate',
  'core/api-envelope',
  'core/args',
  'core/canonical-payload',
  'core/config',
  'core/dashboard-snapshot',
  'core/display-name',
  'core/doctor-rules',
  'core/effective-state',
  'core/eval-confidence',
  'core/frontmatter',
  'core/fs',
  'core/graph',
  'core/identity-migrations',
  'core/identity',
  'core/inventory',
  'core/jobs',
  'core/policy-reviews',
  'core/policy-state',
  'core/policy',
  'core/redacted-metadata',
  'core/reports',
  'core/roots',
  'core/route-events',
  'core/route',
  'core/skill-discovery-index',
  'core/skill-tree-limits',
  'core/status',
  'core/workspace-state/durability',
  'core/workspace-state/errors',
  'core/workspace-state/index',
  'core/workspace-state/legacy',
  'core/workspace-state/lock',
  'core/workspace-state/paths',
  'core/workspace-state/revision',
  'core/workspace-state/schema',
  'core/workspace-state/types',
  'hosted/audit-grade',
  'mcp/local-runtime',
  'mcp/results',
  'mcp/server',
  'mcp/tool-registry',
  'mcp/tool-runtime',
  'mcp/tool-schemas',
  'mcp/transports/stdio',
  'network/github-source-fetcher',
  'schemas/types',
  'server/compatibility',
  'server/filesystem-freshness',
  'server/local-connector',
  'server/security',
  'server/skillmap-backend',
  'services/eval-release-context',
  'services/eval-use-case',
  'services/route-use-case',
  'services/skill-discovery-use-case',
  'services/status-use-case',
  'services/workspace-read-model'
];

const PUBLIC_PACKAGE_PATHS = new Set([
  ...PUBLIC_ROOT_PATHS,
  ...PUBLIC_DOC_PATHS,
  ...PUBLIC_LOCAL_APP_PATHS,
  ...PUBLIC_CONTRACT_PATHS,
  ...PUBLIC_DIST_MODULES.flatMap(module => [`dist/${module}.d.ts`, `dist/${module}.js`])
]);

// These hooks are automatic code-execution surfaces during npm install in at
// least one supported install shape (dependency, bare/local, link, or git).
// Pack/publish-only hooks such as prepack, postpack, and prepublishOnly remain
// permitted because they do not execute when a retained tarball is installed.
export const FORBIDDEN_INSTALL_LIFECYCLE_SCRIPTS = Object.freeze([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare'
]);

const PRIVACY_CANARIES = [
  {
    label: 'PEM private-key material',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/
  },
  {
    label: 'GitHub credential',
    pattern: /(?:github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{36,255})/
  },
  {
    label: 'npm credential',
    pattern: /npm_[A-Za-z0-9]{36,255}/
  },
  {
    label: 'AWS access-key credential',
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/
  },
  {
    label: 'API secret-key credential',
    pattern: /sk-(?:proj-|svcacct-|ant-api\d{2}-)?[A-Za-z0-9_-]{32,255}/
  },
  {
    label: 'Stripe live credential',
    pattern: /(?:sk|rk)_live_[A-Za-z0-9]{20,255}/
  },
  {
    label: 'Slack credential',
    pattern: /xox[baprs]-[A-Za-z0-9-]{20,255}/
  },
  {
    label: 'Google API credential',
    pattern: /AIza[0-9A-Za-z_-]{35}/
  },
  {
    label: 'POSIX private home path',
    pattern: /(?:^|[\s"'`=:(])(?:(?:file:\/\/)?\/(?:Users|home)\/(?!(?:you|user|username|example|sample)(?=[/\s"'`]|$))[A-Za-z0-9._-]{1,64}|\/root)(?=[/\s"'`]|$)/m
  },
  {
    label: 'Windows private home path',
    pattern: /(?:^|[\s"'`=:(])(?:file:\/\/\/)?[A-Za-z]:[\\/]+Users[\\/]+(?!(?:you|user|username|example|sample)(?=[\\/\s"'`]|$))[A-Za-z0-9._-]{1,64}(?=[\\/\s"'`]|$)/im
  }
];

export function packagePathPolicyError(value) {
  if (PUBLIC_PACKAGE_PATHS.has(value)) return null;
  if (value.startsWith('docs/')) {
    return `documentation path is not in the exact public-doc allowlist: ${value}`;
  }
  return `path is outside the exact public package allowlist: ${value} (only reviewed exact paths are permitted)`;
}

export function packageManifestPolicyError(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return 'archived package.json must be an object';
  }
  if (manifest.scripts === undefined) return null;
  if (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts)) {
    return 'archived package.json scripts must be an object when present';
  }
  for (const lifecycle of FORBIDDEN_INSTALL_LIFECYCLE_SCRIPTS) {
    if (Object.prototype.hasOwnProperty.call(manifest.scripts, lifecycle)) {
      return `archived package.json must not define automatic install lifecycle script "${lifecycle}"`;
    }
  }
  return null;
}

export function findPackagePrivacyCanary(bytes) {
  const text = Buffer.isBuffer(bytes)
    ? bytes.toString('utf8')
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
  for (const canary of PRIVACY_CANARIES) {
    if (canary.pattern.test(text)) return canary.label;
  }
  return null;
}
