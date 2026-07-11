# SkillMap beUI Website And Dashboard Implementation Plan

## Planner Metadata
- Repository/path: `/home/codex/projects/skillmap`
- Branch: `main`, aligned with `origin/main` during planning
- Date: 2026-07-09
- Planning mode: lightweight orchestration with two read-only planning workers
- Product surface: two-page web experience using beUI components
- Pages in scope: `/` landing page and `/dashboard` logged-in product dashboard
- Stack observed: Node >=20 TypeScript CLI package, no frontend app currently present
- Implementation status: not started
- Worker scopes:
  - Landing page UX, visual hierarchy, copy, responsive behavior, beUI component usage
  - Dashboard workflow, data contracts, architecture, privacy boundaries, QA
- Local sources inspected:
  - `README.md`
  - `HANDOFF.md`
  - `package.json`
  - `docs/architecture.md`
  - `docs/commands.md`
  - `docs/host-compatibility.md`
  - `docs/security.md`
  - `docs/threat-model.md`
  - `docs/release-checklist.md`
  - `src/schemas/types.ts`
  - `src/core/status.ts`
  - `src/core/route.ts`
  - `src/commands/export.ts`
  - `src/commands/mcp.ts`
- beUI MCP components inspected:
  - `command-palette`
  - `button`
  - `tabs`
  - `animated-badge`
  - `number`
  - `table`
  - `input`
  - `select`
  - `drawer`
  - `tooltip`
  - `animated-toast-stack`
  - `expandable-action-bar`
- External inspiration sources from the prior research pass:
  - Claude Skills / Anthropic skills repository: https://github.com/anthropics/skills
  - Agent Skills open standard: https://agentskills.io/specification
  - Smithery MCP publishing/distribution docs: https://smithery.ai/docs/build and https://smithery.ai/docs/build/publish
  - VS Code extension marketplace docs: https://code.visualstudio.com/docs/configure/extensions/extension-marketplace
  - Raycast Store: https://www.raycast.com/store
  - Hugging Face Hub: https://huggingface.co/
  - npm registry docs: https://docs.npmjs.com/cli/v11/using-npm/registry/
  - Docker Hub repositories docs: https://docs.docker.com/docker-hub/repos/
  - GPT Store announcement: https://openai.com/index/introducing-the-gpt-store/
  - MCP directories inspected as market signals: https://www.pulsemcp.com/servers, https://mcp.directory/, https://glama.ai/mcp/servers
- Assumptions:
  - The first implementation should add a frontend surface without destabilizing the existing CLI package.
  - beUI components should be installed into the frontend app through the beUI/shadcn flow, not copied by hand unless the installer is blocked.
  - Hosted SkillMap is a redacted mirror and workflow console at first; local SkillMap artifacts remain the operational source of truth until a hosted backend is explicitly designed.

## Executive Goal
Create a serious two-page SkillMap web product that communicates and demonstrates the real service:

1. SkillMap hosts and curates skill intelligence outside the agent prompt.
2. SkillMap routes each task to compact, policy-backed skill advice.
3. SkillMap helps teams save context tokens, move faster, and use higher-quality skills with provenance, trust, and eval visibility.

The landing page should sell the value without reading like a static registry. The dashboard should prove the value through route traces, token-savings estimates, policy/trust state, skill health, and local connector status.

## Source Of Truth Contract
- Intent: turn SkillMap from a local-only CLI narrative into a scalable hosted-service product surface while preserving the local-first trust boundary.
- Current behavior: this repo is a TypeScript CLI with scan, doctor, policy, graph, route, eval, sources, export/import, hook, and read-only MCP commands. There is no web app.
- Expected outcome: a planned frontend app with exactly two user-facing pages, `/` and `/dashboard`, using beUI components for interaction polish and operational density.
- Truth owner: existing CLI artifacts and docs remain the source truth for current capabilities; this plan is the source truth for the next web implementation slice.
- Contract boundary: the dashboard may render from redacted snapshots, fixtures, and connector status. It must not claim live hosted mutation of local skill roots, raw prompts, or hook installation.
- Displaced path: none. No existing frontend surface is displaced.
- Cutover: a future implementation can ship the web app as an additive `apps/web` surface while root CLI packaging and release checks continue to pass.
- Acceptance evidence:
  - Browser screenshots for `/` and `/dashboard` at desktop and mobile widths.
  - Rendered dashboard from redacted fixture snapshots.
  - Route Lab interaction showing recommendations, reasons, exclusions, hook text length, and token estimate.
  - No text overlap or clipped controls in screenshots.
  - Build/type/test checks for both CLI and web app.
- Evidence lane:
  - CLI: `npm run typecheck`, `npm test`, package dry-run if packaging is touched.
  - Web: `npm run lint`, `npm run typecheck`, `npm run build`, Playwright visual smoke at `/` and `/dashboard`.
  - Product: screenshots plus fixture-driven states, not only code diffs.
- Kill criteria:
  - The landing page looks like a generic marketplace and fails to foreground token savings and route intelligence.
  - The dashboard cannot render without raw local paths, raw prompts, or raw `SKILL.md` bodies.
  - The implementation changes CLI release behavior or package contents without explicit approval.
  - The dashboard implies hosted destructive mutation, global hook install, or automatic source updates.
- Forbidden moves:
  - Do not claim SkillMap is already a production hosted service.
  - Do not claim Codex always loads every full skill body by default.
  - Do not install global hooks.
  - Do not upload private skills, prompts, or local paths by default.
  - Do not turn beUI motion into decorative background effects that reduce dashboard scannability.

## Native Planning Superiority
- Codex Native baseline: a likely native outline would propose a landing page and dashboard from the chat context, but would not anchor the CLI boundary, beUI component surface, privacy contract, route/eval artifacts, or implementation handoff.
- What this planning pass does better:
  - Anchors current repo state and confirms no frontend app exists.
  - Names concrete beUI components and install commands.
  - Separates hosted-service positioning from current local-first evidence.
  - Defines dashboard fixture contracts from existing `Inventory`, `EffectiveRegistry`, `RouteResult`, and `SkillMapStatus` shapes.
  - Includes blocker semantics, forbidden moves, and acceptance evidence beyond build success.
- User-specific context used:
  - SkillMap only works at scale if skills are hosted outside the agent context.
  - The user wants a scalable service, not a personal local script.
  - The service must save tokens, boost productivity, and surface top-notch skills.
  - UI should be useful, visually polished, and operational rather than decorative.
- Superiority score target: 5
- Proof artifacts:
  - This saved plan file.
  - beUI MCP component inspection.
  - Worker outputs synthesized into landing and dashboard requirements.
  - Current CLI code/docs references mapped to future dashboard contracts.

## Orchestration Decision
- Mode: lightweight workers
- Worker count: 2
- Decision reason: the plan spans product positioning, UI/UX, component selection, data contracts, privacy, architecture, and QA. Two distinct lenses improved quality without over-orchestrating.
- Independent surfaces:
  - Landing page and service narrative.
  - Dashboard workflow, contracts, privacy, and validation.
- Workers used or skipped:
  - Used: landing UX worker.
  - Used: dashboard/data-contract worker.
  - Skipped: additional backend/auth/pricing worker because auth, billing, tenancy, and deployment are intentionally out of scope for the two-page first implementation slice.
- Thread decision: no visible thread created. This is one parent-owned plan artifact.
- Token/context rationale: parent retained repo and beUI source truth; workers inspected non-overlapping planning lenses.
- Reconsider trigger: add a third worker if the user expands this into auth, billing, hosted backend schema, pricing, enterprise admin, or production deployment.

## Background Browser Lane
- Needed: no
- Target/surface: none for this planning pass
- Safety boundary: external inspiration research already completed in the prior pass and is summarized in this file; no account/auth browser surface is needed.
- Required receipt: none
- Stop condition: none

## Research And Inspiration Findings
The external references point toward a hybrid product pattern, not a plain registry.

Adopt:
- Marketplace discovery from VS Code, Raycast, npm, Docker, and Hugging Face: search, filters, publisher/source metadata, install commands, version state, and category navigation.
- Skill primitive from Claude Skills and Agent Skills: a skill is a portable folder with instructions, metadata, and optional supporting files loaded only when needed.
- Distribution/control-plane pattern from Smithery: publishing, registry pages, configuration, installation paths, and operational status.
- GPT Store-style broad discoverability only where useful for top-level categories and collections.

Adapt:
- Registry cards should become trust cards: install state, scripts, provenance, eval confidence, source freshness, and route impact.
- Store search should become Router Lab: users type a job, not only a keyword, and SkillMap returns the best skills and the reason.
- Extension marketplace install buttons should become local connector actions: copy command, request local action, or sync redacted snapshot.
- Hugging Face-style model/dataset detail pages should become Skill Detail drawers with metadata, route history, provenance, and review state.

Avoid:
- A generic app-store clone where cards are the product.
- Hero pages with decorative orbs, giant illustrations, or vague AI productivity copy.
- Claims that hosted SkillMap can mutate local skills or install hooks automatically.
- Unsupported “dramatically smarter routing” claims.

Not relevant for this first slice:
- Billing/pricing pages.
- Creator monetization.
- Enterprise SSO.
- Full public skill publishing workflow.
- Hosted source update application.

## Current State
Current repo state:
- The repo is clean on `main` during planning.
- `package.json` defines a CLI package named `skillmap`, version `0.1.0`.
- CLI commands cover scan/list/doctor/doctor-pack/status, curation, policy application, graph, route, eval, sources, hook, export/import, and MCP.
- `src/schemas/types.ts` defines key domain types:
  - `Inventory`
  - `SkillRecord`
  - `Policy`
  - `EffectiveRegistry`
  - `EffectiveSkill`
  - `SkillGraph`
  - `RouteResult`
  - `RouteCandidate`
  - `RouteExclusion`
- `src/core/status.ts` defines `SkillMapStatus`, `CurationReceipt`, eval confidence, source summary, warnings, and next actions.
- `src/core/route.ts` implements deterministic routing. It scores against names, descriptions, aliases, `preferredFor`, `avoidFor`, family, tier, and script-bearing caution; it excludes blocked/archived/unnamed explicit-only skills and records superseded exclusions.
- `src/commands/export.ts` exports redacted local artifacts and can replace project/home paths with `$PROJECT`/`$HOME`.
- `src/commands/mcp.ts` exposes read-only tools: `route_prompt`, `search_skills`, `show_skill`, `show_skillgraph`, `doctor_summary`, and `source_status`.

Planning implications:
- The web app should be additive, ideally under `apps/web`, so root CLI packaging remains stable.
- First dashboard implementation should render from fixtures and redacted snapshots before any live hosted ingestion.
- Root package release behavior must remain protected by existing checks.
- The landing page should phrase evidence carefully:
  - Current evidence supports large context-efficiency benefits.
  - Routing quality improved modestly in the prior sample.
  - Token-savings numbers should be labeled as sample/audit-derived estimates.

## Future State
The future product has two pages.

### Page 1: `/` Landing Page
Job:
Communicate SkillMap as hosted skill intelligence for agent teams.

Primary promise:
`Route the right skills without flooding the prompt.`

Supporting copy:
`SkillMap turns sprawling agent skill libraries into compact, policy-backed route advice, helping teams save context, move faster, and trust which skills are used.`

Required first-viewport elements:
- Top navigation:
  - SkillMap logo/name
  - Product
  - Router Lab
  - Trust
  - Docs
  - Sign in
  - Open dashboard
- Hero:
  - H1 above.
  - Supporting copy above.
  - Primary CTA: `Open dashboard`
  - Secondary CTA: `Run sample route`
  - beUI `command-palette` style product preview showing:
    - Query: `Review this auth PR and verify mobile UX`
    - Recommended skills:
      - `security-review`
      - `frontend-design`
      - `build-web-apps:frontend-testing-debugging`
    - Reason chips:
      - `preferred_for: auth review`
      - `alias: mobile UX`
      - `blocked duplicate excluded`
    - Compact hook text preview.
    - Token estimate: `17.5 avg route-hint tokens in prior audit`
- Proof strip:
  - beUI `number` counters:
    - `17.5` avg route-hint tokens, labeled prior audit.
    - `185` eval prompts.
    - `100%` top-3 in recorded eval sample.
    - `0` avoid hits in recorded eval sample.
  - Copy must say these are sample-backed, not universal guarantees.
- How it works:
  - `Index`: import or sync skill metadata and provenance.
  - `Govern`: tier, dedupe, block, review, and evaluate.
  - `Route`: send only compact, traceable advice to agents.
- Hosted value section:
  - `Central skill intelligence`
  - `Shared policy`
  - `Route telemetry`
  - `Source freshness`
  - `Local connector control`
- Dashboard preview:
  - Shows the actual dashboard concept, not a decorative mock.
  - Must include route traces, token savings, skill health, source freshness, and connector status.

Visual direction:
- Professional developer control plane.
- Bright neutral base, charcoal text, teal/cyan routing accent, green verified/savings, amber warning, restrained red risk.
- Dense but breathable, no nested card sprawl.
- Use full-width bands and constrained content rather than floating page sections.
- No decorative orbs, bokeh, giant hero illustration, or one-note purple/dark-blue palette.

### Page 2: `/dashboard`
Job:
Let a logged-in workspace understand and operate its skill intelligence layer.

Shell:
- Left sidebar on desktop:
  - Overview
  - Route Lab
  - Skills
  - Policies
  - Trust
  - Sources
  - Connector
  - QA
- Top bar:
  - Workspace selector using beUI `select`
  - Global search / `Cmd-K` using beUI `command-palette`
  - Last sync badge
  - Theme toggle can be deferred unless already available in the app scaffold
- Mobile:
  - Sidebar becomes a beUI `drawer`.
  - Primary tabs become scrollable beUI `tabs` or drawer-backed navigation.
  - Selected-row actions use beUI `expandable-action-bar` at the bottom.

Dashboard tabs or sections:
- `Overview`:
  - Status verdict: ok, attention required, blocked.
  - Token-savings estimate.
  - Route confidence.
  - Eval confidence.
  - Source freshness.
  - Curation receipt.
  - Local connector state.
- `Route Lab`:
  - Primary workflow.
  - Prompt input / command search.
  - Recommendations with score, tier, family, trust, and reason trace.
  - Exclusions with reasons.
  - Hook text and hook text length.
  - Token estimate and avoided-token calculation.
- `Skills`:
  - beUI `table` with virtualized, sortable, selectable, resizable, reorderable rows.
  - Rows show name, tier, family, route eligibility, scripts, source state, review state, body size, description size, last hash, route count.
  - Row drawer shows skill detail, reasons, source provenance, conflicts, and route history.
- `Policies`:
  - Tier distribution.
  - Unmatched policy entries.
  - Duplicate inventory name groups.
  - Inventory without policy.
  - Explicit-only and blocked queues.
- `Trust`:
  - Curation receipt.
  - Model verification label: `user-reported`, `unverified-user-reported`, or `provider-verified`.
  - Script-bearing skill count.
  - Source review receipts.
  - Risky/stale/unknown source state.
- `Sources`:
  - External provenance records.
  - Stale/risky/unknown states.
  - Conservative actions: copy local command, request local review, mark held through a future connector job.
- `Connector`:
  - CLI version.
  - Current project alias.
  - Last redacted snapshot hash.
  - Last sync time.
  - Redaction enabled.
  - Read-only mode.
  - Allowed local commands.
  - Offline/blocked/unauthorized states with exact next commands.
- `QA`:
  - Eval count.
  - Top-1/top-3 rates.
  - Avoid hits.
  - Confidence level.
  - Fixture-root warnings.
  - Release-readiness gates.

## beUI Component Plan
Install beUI components into the future frontend app through the beUI/shadcn flow. Use npm commands because this repo currently uses npm.

Core install commands:
```bash
npx shadcn add @beui/command-palette
npx shadcn add @beui/button
npx shadcn add @beui/tabs
npx shadcn add @beui/animated-badge
npx shadcn add @beui/number
npx shadcn add @beui/table
npx shadcn add @beui/input
npx shadcn add @beui/select
npx shadcn add @beui/drawer
npx shadcn add @beui/tooltip
npx shadcn add @beui/animated-toast-stack
npx shadcn add @beui/expandable-action-bar
```

Expected dependencies from beUI inspection:
- `motion`
- `lucide-react`
- `clsx`
- `tailwind-merge`
- `@tanstack/react-virtual` for the beUI table
- React/React DOM and Tailwind/shadcn app setup

Component mapping:
- `command-palette`:
  - Landing hero route preview.
  - Dashboard global `Cmd-K`.
  - Route Lab prompt and skill search.
- `button` / `StatefulButton`:
  - Landing CTAs.
  - Sync/route/copy actions.
  - Loading/success/error states for local connector actions.
- `tabs`:
  - Dashboard top sections.
  - Inner `Policies`, `Trust`, and `QA` segmented views.
- `animated-badge`:
  - Trust state, source state, eval confidence, route eligibility, connector status.
- `number`:
  - Landing proof strip.
  - Dashboard token-savings and eval counters.
- `table`:
  - Skills inventory.
  - Route traces.
  - Policy review rows.
  - Source status rows.
- `input`:
  - Filter fields and route prompt fallback where command palette is not appropriate.
- `select`:
  - Workspace selector.
  - Agent host filter: Codex, Claude, Cursor, MCP.
  - Snapshot/eval state filter.
- `drawer`:
  - Skill detail panel.
  - Route trace detail.
  - Source/provenance detail.
  - Mobile navigation.
- `tooltip`:
  - Explanations for trust labels, eval confidence, token estimates, and model-verification labels.
- `animated-toast-stack`:
  - Sync completed.
  - Snapshot imported.
  - Local action requested.
  - Copy command success/failure.
- `expandable-action-bar`:
  - Selected rows in tables.
  - Route Lab quick actions: copy hint, export trace, open skill, request review.

Components to avoid in the first implementation:
- `shader-background`: too decorative for the operational dashboard and likely to distract from trust/state.
- `dock`: too OS-like for a SaaS control plane.
- `tilt-card`: can make registry cards feel like marketing objects; use only if a later landing polish pass needs subtle affordance.
- `marquee`: not useful unless later showing integrations or trusted publishers; not needed for the first slice.

## Data Contracts
The first UI implementation should define a dashboard envelope around existing CLI contracts. It can live under `apps/web/lib/contracts/skillmap-dashboard.ts` until a shared package is justified.

```ts
export type ConnectorState = 'online' | 'offline' | 'blocked' | 'unauthorized';

export interface DashboardSnapshot {
  version: 1;
  workspaceId: string;
  generatedAt: string;
  redacted: true;
  status: SkillMapStatus;
  inventory?: Inventory;
  effective?: EffectiveRegistry;
  evalReport?: EvalReport;
  sourceStatus?: SourceStatus;
  curationReceipt?: CurationReceipt;
  tokenMetrics: TokenSavingsMetrics;
  productivity: ProductivityMetrics;
  connector?: ConnectorStatus;
  recentRouteTraces: RouteTraceRecord[];
}

export interface TokenSavingsMetrics {
  fullBodyTokens?: number;
  catalogTokens?: number;
  hookTokensMean?: number;
  tokensAvoidedVsBodies?: number;
  tokensAvoidedVsCatalog?: number;
  sampleSize: number;
  method: 'prior-audit' | 'workspace-estimate' | 'eval-report' | 'unknown';
  computedAt: string;
}

export interface ProductivityMetrics {
  routeCount: number;
  top1Rate?: number;
  top3Rate?: number;
  avoidHits?: number;
  evalConfidence: 'none' | 'demo' | 'weak' | 'alpha' | 'release';
  releaseReady: boolean;
  avgRecommendations?: number;
  avgHookChars?: number;
}

export interface SkillTableRow {
  id: string;
  name: string;
  tier: SkillTier;
  family?: string;
  routeEligible: boolean;
  hasScripts: boolean;
  sourceState: 'clean' | 'modified' | 'stale' | 'risky' | 'unknown' | 'error' | 'local';
  reviewStatus: 'none' | 'reviewed' | 'held' | 'needs-review';
  bodyBytes: number;
  descriptionBytes: number;
  routeCount: number;
  lastRecommendedAt?: string;
}

export interface RouteTraceRecord {
  id: string;
  createdAt: string;
  promptHash: string;
  promptPreview?: string;
  rawPromptStored: false;
  recommendations: RouteCandidate[];
  exclusions: RouteExclusion[];
  hookText: string;
  hookChars: number;
  statusWarnings: string[];
  tokenEstimate: {
    hookTokens: number;
    catalogTokensAvoided?: number;
    fullBodyTokensAvoided?: number;
    method: string;
  };
}

export interface ConnectorStatus {
  state: ConnectorState;
  cliVersion?: string;
  cwdAlias?: string;
  lastSeenAt?: string;
  lastSnapshotHash?: string;
  redactionEnabled: boolean;
  readOnlyMode: boolean;
  allowedCommands: string[];
}
```

Fixture files for the first UI slice:
- `apps/web/data/fixtures/dashboard-snapshot.release-ready.json`
- `apps/web/data/fixtures/dashboard-snapshot.attention-required.json`
- `apps/web/data/fixtures/route-traces.sample.json`
- `apps/web/data/fixtures/policy-review.sample.json`
- `apps/web/data/fixtures/connector-status.offline.json`
- `apps/web/data/fixtures/connector-status.blocked.json`
- `apps/web/data/fixtures/privacy-redaction.sample.json`

Fixture requirements:
- Include release-ready and attention-required states.
- Include stale effective registry, missing curation receipt, unknown source state, and risky update examples.
- Include route traces with superseded exclusions, explicit-only exclusions, blocked/archived exclusions, and no-confident-route.
- Use `$PROJECT` and `$HOME` placeholders, not real local paths.
- Store raw prompts as hashes with optional short previews only.

## Non-Goals
- No npm publication, GitHub release, or tag work.
- No global hook installation.
- No source update application.
- No live hosted backend implementation in this two-page UI slice.
- No billing, pricing, SSO, teams, or creator monetization.
- No public skill publishing workflow beyond visible navigation/copy placeholders.
- No raw prompt or raw skill-body upload.
- No claim that dashboard data is live unless a connector/snapshot actually supplies it.

## Phase Plan
### Phase 0: Product And Frontend Boundary
Goal: add a web app boundary without destabilizing the CLI.

Tasks:
- Choose `apps/web` as the frontend app location.
- Keep root CLI package scripts and package `files` behavior intact.
- Add a small README in `apps/web` explaining that the web app is an additive product surface.
- Decide whether root package becomes an npm workspace now or whether `apps/web` remains independent for the first slice.

Acceptance:
- Root `npm run typecheck` and `npm test` still pass.
- CLI package dry-run contents remain unchanged unless explicitly approved.
- The web app can run independently.

### Phase 1: Web Scaffold And beUI Foundation
Goal: create the minimum Next.js/Tailwind/shadcn/beUI foundation for two pages.

Recommended route:
- Add a Next.js App Router app under `apps/web`.
- Configure Tailwind, shadcn, beUI, lucide, and motion.
- Install beUI components listed in this plan.
- Create design tokens for neutral canvas, charcoal text, teal routing, green verified/savings, amber warning, red risk.
- Add reduced-motion-safe defaults.

Likely files:
- `apps/web/package.json`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/components/motion/*`
- `apps/web/components/skillmap/*`
- `apps/web/lib/contracts/skillmap-dashboard.ts`
- `apps/web/lib/fixtures.ts`
- `apps/web/data/fixtures/*.json`

Acceptance:
- `cd apps/web && npm run dev` serves the app.
- `cd apps/web && npm run build` passes.
- beUI components render without hydration errors.
- Reduced motion can be verified through OS/browser setting or test hook.

### Phase 2: Landing Page
Goal: build `/` as a high-conversion but utility-led product page.

Implementation sections:
- Header/nav.
- Hero with command-palette route preview.
- Proof strip with animated numbers.
- How-it-works band: Index, Govern, Route.
- Hosted value band.
- Dashboard preview band.
- Final CTA.

Copy requirements:
- Must include token savings, productivity, and top-skill routing.
- Must say hosted skill intelligence or equivalent.
- Must avoid plain registry positioning.
- Must label audit metrics as sample-backed.

Acceptance:
- First viewport shows SkillMap name, value proposition, CTA, and product UI preview.
- The next section is visible below the fold on desktop and mobile.
- The page contains no decorative-only hero image.
- The page remains legible and non-overlapping at 1440, 1024, 768, 390, and 320 px widths.

### Phase 3: Dashboard Data And Fixture Layer
Goal: make `/dashboard` render real-shaped data before live connector/backend work.

Tasks:
- Define dashboard contracts from existing CLI types.
- Create fixture snapshots.
- Add fixture loader and derived selectors:
  - `getOverviewMetrics`
  - `getSkillRows`
  - `getRouteTraceRows`
  - `getPolicyReviewRows`
  - `getSourceRows`
  - `getConnectorState`
- Add schema validation if the web app has a validation library; otherwise add focused TypeScript and fixture tests.

Acceptance:
- Dashboard can switch between release-ready and attention-required fixture snapshots.
- No real filesystem access is required.
- No raw local paths or raw prompts appear in fixtures.
- Token-savings calculations show method and sample size.

### Phase 4: Dashboard UI
Goal: build the dense operator product surface.

Implementation sections:
- Dashboard shell with sidebar, top bar, workspace selector, and global command palette.
- Overview metric grid.
- Route Lab with prompt input, recommendations, exclusions, hook text, token estimate.
- Skills table with drawer.
- Policies section with tier/unmatched/duplicate queues.
- Trust section with receipt/model/source labels.
- Sources table with review state.
- Connector panel with online/offline/blocked states.
- QA section with eval confidence and release gates.

Acceptance:
- `Route Lab` is visually and functionally primary.
- Skills inventory is not the only main thing users see.
- Tables support keyboard focus and have useful empty/loading/error states.
- Drawers close with Escape and do not trap scrolling incorrectly.
- Toasts report only non-destructive actions.
- Mobile navigation remains usable.

### Phase 5: QA And Acceptance Evidence
Goal: prove the two pages work as product surfaces.

Required checks:
- Root CLI:
  - `npm run typecheck`
  - `npm test`
- Web app:
  - `cd apps/web && npm run lint`
  - `cd apps/web && npm run typecheck`
  - `cd apps/web && npm run build`
- Browser:
  - Start dev server.
  - Capture screenshots for `/` and `/dashboard` at 1440x1000, 1024x768, 390x844, and 320x740.
  - Verify no text overlap, clipped buttons, broken drawers, horizontal overflow, or blank beUI panels.
- Accessibility:
  - Keyboard open/close for command palette and drawers.
  - Tab order through nav, CTA, Route Lab, table rows, drawers.
  - Visible focus outlines.
  - Reduced-motion behavior.
- Privacy:
  - Fixture audit for no raw local paths.
  - Fixture audit for no raw prompts beyond approved preview strings.

Acceptance:
- Implementation cannot be called complete until screenshots and validation outputs are captured.

## Task Backlog
### Foundation
- Add `apps/web`.
- Add Tailwind/shadcn setup.
- Install selected beUI components.
- Add SkillMap visual tokens.
- Add typed fixture contracts.

### Landing
- Build `LandingHeader`.
- Build `HeroRoutePreview` using `command-palette`.
- Build `ProofMetricStrip` using `number`.
- Build `HowItWorksBand` with `animated-badge`.
- Build `HostedValueBand`.
- Build `DashboardPreview`.
- Add responsive rules and copy review.

### Dashboard
- Build `DashboardShell`.
- Build `WorkspaceSelector`.
- Build `GlobalCommandPalette`.
- Build `OverviewMetrics`.
- Build `RouteLab`.
- Build `SkillsTable`.
- Build `SkillDetailDrawer`.
- Build `PolicyQueues`.
- Build `TrustPanel`.
- Build `SourcesTable`.
- Build `ConnectorPanel`.
- Build `QaPanel`.
- Build `ActionToastProvider`.

### Data
- Define contract types.
- Add release-ready fixture.
- Add attention-required fixture.
- Add route trace fixture.
- Add policy review fixture.
- Add connector fixtures.
- Add redaction fixture.
- Add selectors/derivations.

### QA
- Add fixture tests.
- Add responsive screenshot test.
- Add keyboard smoke test.
- Add privacy fixture test.
- Add reduced-motion test or manual checklist.

## Acceptance Criteria
Product:
- The landing page makes SkillMap feel like a hosted skill intelligence service, not a personal registry.
- The dashboard makes Route Lab and token impact primary, not inventory browsing.
- The two pages communicate these three benefits: save tokens, improve productivity, use top-tier skills.
- Claims are honest and evidence-bounded.

Visual:
- UI is calm, dense, and professional.
- beUI motion clarifies state changes and does not become decorative.
- Text fits in all containers at desktop and mobile widths.
- Cards are shallow, compact, and not nested inside other cards.
- Palette is not dominated by purple, dark blue, beige, or brown.

Utility:
- Users can route a prompt, inspect reasons, see exclusions, view hook text, and understand token impact.
- Users can see skill health, policy state, trust/provenance, source freshness, connector health, and eval confidence.
- Users can understand next actions when connector is offline, blocked, or stale.

Privacy/trust:
- Default fixtures and dashboard state use redacted snapshots.
- Raw local paths and raw prompts are absent by default.
- Hosted UI does not claim direct write capability into local skill roots.
- Model verification labels are explicit.

Engineering:
- Root CLI tests still pass.
- Web app builds.
- Browser screenshots validate both pages.
- The implementation remains scoped to the two-page surface unless explicitly expanded.

## Validation Plan
Run after implementation:

```bash
# Root CLI package
npm run typecheck
npm test

# Web app
cd apps/web
npm run lint
npm run typecheck
npm run build
```

Browser validation:
- Start the web dev server.
- Visit `/`.
- Visit `/dashboard`.
- Capture desktop and mobile screenshots.
- Exercise:
  - Landing CTA focus/hover.
  - Command palette open/close.
  - Dashboard tab switching.
  - Route Lab route preview.
  - Skills table row detail drawer.
  - Connector offline state.
  - Toast stack.

Privacy validation:
- Search fixtures for `/home/`, `/Users/`, and unredacted user paths.
- Search route trace fixtures for raw prompt strings if `rawPromptStored` is false.
- Verify `$PROJECT` and `$HOME` placeholders are used where paths appear.

Accessibility validation:
- Keyboard-only navigation works.
- Drawer closes with Escape.
- Command palette closes with Escape.
- Focus outlines are visible.
- Reduced motion disables or softens non-essential animation.

Performance validation:
- Landing first viewport should not depend on heavy canvas/shader effects.
- Dashboard table should use virtualization for large rows.
- Avoid blocking client render on unnecessary animation.

## Risks And Dependencies
- No frontend app exists. A web scaffold decision is required before implementation.
- Next.js/shadcn/beUI setup may require new dependencies and package boundaries.
- Root CLI package should not accidentally include web app build artifacts in `npm pack`.
- Hosted backend, auth, tenancy, billing, and live sync are out of scope and remain future decisions.
- Current token savings numbers are prior audit evidence, not guaranteed per user.
- Productivity is hard to prove. Start with route count, eval confidence, route correctness, and context-size estimates rather than time-saved claims.
- Source freshness can be unknown or rate-limited; the UI must show unknown honestly.
- beUI table is powerful but should be configured carefully to avoid cramped mobile layouts.
- Any future mutation flow needs explicit local approval and receipts.

## Implementation Orchestrator Handoff
Recommended first implementation slice:
Create an additive `apps/web` Next.js app with the two routes `/` and `/dashboard`, beUI component foundation, static fixtures, and full rendered UI. Do not build hosted backend/auth in the first slice.

Phase order:
1. Scaffold `apps/web`.
2. Install beUI components.
3. Add typed fixture contracts and fixture data.
4. Build landing page.
5. Build dashboard with fixture data.
6. Validate with build/type/browser screenshots.

Likely files to change or add:
- `docs/plans/2026-07-09-skillmap-beui-website-dashboard-plan.md`
- `apps/web/package.json`
- `apps/web/next.config.*`
- `apps/web/tsconfig.json`
- `apps/web/tailwind.config.*`
- `apps/web/components.json`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/globals.css`
- `apps/web/components/motion/*`
- `apps/web/components/skillmap/*`
- `apps/web/lib/contracts/skillmap-dashboard.ts`
- `apps/web/lib/fixtures.ts`
- `apps/web/data/fixtures/*.json`
- Optional root docs update pointing to the web app after implementation is verified.

Allowed changes:
- Add an isolated frontend app.
- Add beUI component files into the frontend app.
- Add fixtures and mock data.
- Add web-only test/screenshot tooling if needed.
- Add docs describing the web surface.

Disallowed changes:
- Do not change CLI command behavior as part of the UI slice.
- Do not publish npm.
- Do not create GitHub release/tag.
- Do not install global hooks.
- Do not add hosted mutation claims.
- Do not upload local skill roots or prompts.
- Do not alter package release contents without checking `npm pack --dry-run`.

Required skills/tools for implementation:
- `frontend-design` for UI work.
- beUI MCP for component details and install commands.
- Context7 for current Next.js/shadcn/Tailwind docs before implementation because these docs drift.
- Playwright or equivalent browser screenshot verification after the UI is running.
- Root CLI validation commands before closeout.

Open questions that should block implementation:
- Should the web app live in `apps/web` or a separate repo?
- Should root package become an npm workspace now, or should `apps/web` remain independent for the first slice?
- Is Next.js acceptable for the frontend implementation?

Open questions that can be resolved during execution:
- Exact icon choices from `lucide-react`.
- Minor copy refinements.
- Fixture row counts.
- Whether dashboard sections are tabs or sidebar routes internally, as long as the public route remains `/dashboard`.

Stop conditions:
- Stop if beUI installation requires destructive changes to the CLI root package.
- Stop if the app cannot build without changing CLI module/package behavior.
- Stop if screenshots show the beUI components are blank, overlapping, or unusable on mobile.
- Stop if the design drifts into a generic registry and loses token savings/routing as the primary story.

Do not claim complete until:
- Both `/` and `/dashboard` render in a browser.
- Desktop and mobile screenshots are captured.
- Web build/type/lint pass.
- Root CLI typecheck/tests still pass.
- Fixtures prove redaction and non-raw-prompt defaults.
- The final response distinguishes implemented, validated locally, and not deployed.

The future implementation orchestrator should turn the chosen slice into its own goal, run implementation/validation cycles, and continue until the slice acceptance criteria are satisfied or a real blocker is documented. It should not report verified unless target-perspective evidence is captured from the rendered routes, fixture payloads, route trace UI, screenshots, and command output.

## Orchestration Closeout
- Workers actually used: 2
- Worker scopes:
  - Landing page UX and visual/component plan.
  - Dashboard workflow, data contracts, architecture, and QA.
- Worker results accepted:
  - Exactly two pages: `/` and `/dashboard`.
  - Landing should sell hosted skill intelligence, not registry browsing.
  - Dashboard should be a redacted mirror and workflow console.
  - Route Lab is the primary dashboard workflow.
  - beUI component map and responsive requirements.
  - Privacy and connector constraints.
- Worker results rejected:
  - None rejected, but dashboard tab count is consolidated under one `/dashboard` route rather than separate pages.
- Worker results unverified:
  - No live frontend behavior exists yet.
  - No hosted backend/auth/connector exists yet.
- Parent verification:
  - Confirmed current repo has no frontend app.
  - Confirmed current domain types and status/route/export/MCP boundaries from source.
  - Confirmed beUI components and npm install commands through MCP.
- Gaps that would benefit from more workers:
  - Auth/tenancy/pricing/backend plan if the user expands beyond the two-page UI.
  - Production deployment plan if a host is selected.
- Visible thread considered: no. This planning task is a single artifact and does not need a user-owned parallel thread.
