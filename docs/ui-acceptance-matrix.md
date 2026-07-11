# Local App UI Acceptance Matrix

This matrix is the release gate for the static local application served by
`skillmap dashboard`. It keeps automated evidence, manual evidence, and states
that do not apply separate. A green browser run is not a substitute for the
manual checks listed below.

Status legend:

- `A` — asserted by the real local-backend Playwright lane.
- `F` — asserted by a focused API, state-store, or component fixture test.
- `M` — requires a recorded manual check before public beta.
- `N/A` — the state is intentionally not meaningful for that route.
- `—` — applicable but not yet accepted; this blocks the relevant release gate.

## Route-by-state applicability

| Route | Live local | Loading | Empty | Stale/dirty | Warm offline | Blocked | Permission | Malformed/corrupt | Version mismatch | Server error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Onboarding | A | F | F | F | A | F | F | F | A | F |
| Overview | A | F | F | F | A | F | F | F | A | F |
| Route Lab | A | F | A | F | A | F | N/A | F | A | F |
| Workspaces | A | F | F | F | A | F | F | F | A | F |
| Skills | A | F | F | F | A | F | N/A | F | A | F |
| Policies | A | F | A | F | A | F | N/A | F | A | F |
| Evals | A | F | F | F | A | F | N/A | F | A | F |
| Sources | A | F | F | F | A | F | N/A | F | A | F |
| Trust | A | F | N/A | N/A | A | N/A | N/A | N/A | A | F |
| Integrations | F | F | F | F | A | F | N/A | F | A | F |
| Activity | A | F | A | F | A | F | N/A | F | A | F |
| Settings | F | F | N/A | F | A | F | F | F | A | F |

The local connector has no hosted authentication lifecycle. `Unauthorized`
means a rejected or expired loopback capability and is exercised at the
connector boundary, not rendered as a fake hosted sign-in state. Cold connector
failure is likewise owned by the browser/CLI launch surface; only a warm,
already-authorized page can provide the in-app offline view.

## Automated browser evidence

Run the modes sequentially so each receives a fresh connector and workspace:

```bash
npm run test:cross-browser
npm run test:a11y
npm run test:visual
npm run test:perf
```

The real-backend critical lane runs independently in Chromium, Firefox, and
WebKit. The Chromium CI lane installs and executes the exact retained package
candidate from a temporary consumer; Firefox and WebKit remain source-checkout
gates. The lanes currently assert:

- one-time fragment capability exchange, immediate URL scrubbing, origin-scoped
  same-tab reload, no authorization cookies or referrer leakage to another
  loopback port, and replay rejection;
- partial-legacy onboarding and derived-only recovery;
- real recommend and safe-abstain routes for materially different prompts;
- a live policy dry-run with current/projected/delta evidence, no publication,
  and a separate explicit policy-apply affordance;
- exact native-agent curation prepare/dry-run/confirm handoff commands and
  evidence-derived progress from 3/10 to 4/10 only after a real doctor job;
- an in-memory eval editor that blocks an incomplete case, imports a reviewed
  suite through the real connector, and clears prompt/label data from DOM and
  browser storage;
- a confirmed, revisioned, deferred GitHub source adoption through the real
  connector, followed by a bounded escaped diff presentation fixture with no
  script execution or browser persistence;
- prompt-free route and feedback persistence;
- stable redacted trace permalinks plus reload/back/forward navigation;
- actionable duplicate/unmatched/uncovered policy proposals with explicit
  accept/hold/reject receipts, including a hold that remains blocking;
- page-bounded feedback backlog and redacted 64 KiB diagnostics export;
- warm disconnect, cached redacted view, and manual reconnect;
- an intentional connector/local-app asset-version mismatch that suppresses
  cached workspace data and mutation controls, clears authorization, and
  requires a restarted connector plus newly printed bootstrap URL;
- a single bounded retry for revision-change conflicts;
- foreground workspace validation/selection with stale client-cache removal;
- no workspace directory paths in rendered receipts, browser storage, or event
  files;
- clean foreground connector shutdown with no unexpected browser diagnostics.

Version compatibility is a pre-route gate in the shared application shell, not
a state implemented separately by each view. The real-backend lane asserts the
global mismatch blocker and its authorization/cache/mutation guarantees. The
focused browser fixture additionally opens every canonical onboarding,
workspace, product, and trace-detail URL under a mismatched bootstrap receipt
and proves that no route-specific API or control renders before that blocker.
The `A` cells above therefore refer to this one global gate; they do not imply
that each view owns a separate mismatch component.

Chromium-focused lanes additionally assert:

- keyboard access to the skip link, main content, navigation, forms, and feedback;
- no horizontal document overflow on every product route at 320, 390, and 1024
  CSS pixels;
- reviewed pixel baselines for overview, route, policy dry-run, curation
  handoff, eval editor, source diff, and recovery states in the pinned
  Linux/Chromium/font/clock environment;
- cold and warm startup, route result, transition feedback/completion,
  authenticated deep-link, and real 500-skill filter budgets;
- per-file and aggregate raw/gzip packaged static-asset budgets.

Focused fixtures and backend tests cover migration/recovery, state corruption,
revision conflict, request limits, origin/CSRF/capability rejection,
single-snapshot immutable GitHub fetching/diffing, and error-envelope rendering.
The intercepted source diff in the browser lane is presentation evidence, not a
claim of live GitHub network coverage. Static CSS checks may confirm that reduced-motion and
forced-color rules exist, but they do not accept rendered dark mode,
forced-colors, zoom/reflow, or screen-reader behavior; those remain manual below.
The browser lane must not silently allowlist unexpected console, page, request,
or HTTP errors.

## Manual public-beta gate

Record the browser, operating system, date, operator, and result for every item:

- Exploratory parity on the shipping operating systems for Chromium, Firefox,
  and WebKit beyond the automated critical flows.
- 320x740, 390x844, 768x1024, 1024x768, and 1440x1000 in light and dark mode.
- Keyboard-only focus order and visible focus; touch-only targets at least 44 by
  44 CSS pixels where practical.
- VoiceOver or NVDA route announcements, table reading, form errors, and
  feedback confirmation.
- Contrast plus forced-colors/high-contrast behavior.
- 200 and 400 percent zoom/reflow without hidden actions or two-dimensional
  page scrolling.
- Reduced-motion behavior with no hydration, focus, or layout regressions.
- Permission-denied workspace, malformed response, corrupt revision, and
  connector-version mismatch recovery copy.

Open manual items remain a public-beta blocker even when automated checks pass.
