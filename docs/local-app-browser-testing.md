# Embedded local-app browser acceptance

The browser gates exercise the packaged `assets/local-app/v1` application
against a real foreground `skillmap dashboard` connector and disposable
workspaces. The runner builds the CLI first and executes every CLI preparation
command from a temporary consumer directory, never from the repository root.

## Install browser engines

Install root and web dependencies, then the Playwright engines and Linux host
libraries:

```bash
npm ci
npm --prefix apps/web ci
npm --prefix apps/web exec playwright install --with-deps chromium firefox webkit
```

Playwright is lockfile-pinned. A missing browser executable or host library is
a failed/blocked gate; the runner does not substitute another engine.

## Critical cross-browser gate

Run one engine explicitly:

```bash
npm run test:browser:chromium
npm run test:browser:firefox
npm run test:browser:webkit
```

Run the release matrix sequentially:

```bash
npm run test:cross-browser
```

The ordinary commands above are source-checkout gates. CI additionally binds
the critical Chromium gate to the exact retained package candidate. To reproduce
that release gate locally, point both inputs at verified, persistent locations:

```bash
SKILLMAP_TEST_TARBALL=/absolute/path/to/skillmap-0.1.0.tgz \
SKILLMAP_BROWSER_ARTIFACTS=/absolute/path/to/browser-chromium-evidence \
npm run test:browser:candidate:chromium
```

The tarball directory must also contain the matching `pack-manifest.json` and
`SHA256SUMS`. The command fails closed when candidate metadata is absent or
mismatched, installs the tarball in a disposable consumer, and records
`candidate-chromium.json` alongside `qa-chromium.json`. It never packs or builds
the source checkout as a substitute for the retained candidate.

Each engine must pass the same real flows:

- initialized fragment capability bootstrap, origin-scoped same-tab reload,
  cross-port cookie/referrer isolation, and rejected one-time-token replay;
- live revision-bound policy dry-run, calculated current/projected impact, and
  a separate explicit apply control;
- a ten-gate onboarding view whose native-agent curation step exposes the exact
  prepare, dry-run, and confirm commands without executing an agent or mutation;
- in-memory eval review that blocks an incomplete case, accepts an explicit
  edit/import, advances an unapproved revision, and clears prompt/label data
  from the page and browser storage;
- confirmed deferred GitHub source adoption that runs no implicit check or
  fetch, plus an escaped, bounded, memory-only upstream diff view;
- one recommended route and one safe abstention;
- redacted feedback and route-event persistence;
- warm connector loss, cached redacted view, bounded retry, and reconnect;
- intentional local-app/connector asset-version mismatch, fail-closed cached
  data suppression, authorization clearing, and an explicit restart/new-link
  recovery requirement;
- partial-legacy onboarding adoption;
- derived-only last-known-good recovery;
- foreground workspace validation/selection and browser-cache replacement;
- clean connector shutdown and zero unexpected console, page, request, or HTTP
  failures.

Use the runner directly only when combining diagnostic flags:

```bash
node apps/web/scripts/local-app-browser.mjs --browser=firefox --critical
```

Firefox and WebKit accept `--critical` only. Accessibility, deterministic
visual comparison, and performance are intentionally pinned to Chromium so
those deeper measurements have one controlled environment.

## Chromium quality lanes

```bash
npm run test:a11y
npm run test:visual
npm run test:perf
```

The accessibility lane is an automated keyboard, focus, labeling, and semantic
control gate, not a complete WCAG audit. Geometry checks remain part of the
visual lane at 320x740, 390x844, and 1024x768 across every product route.

### Deterministic visual regression

`test:visual` is a pixel-diff gate, not a screenshot-presence check. Reviewed
PNG baselines and an environment manifest live under:

```text
apps/web/tests/visual-baselines/local-app/chromium-linux/
```

The gate fixes and verifies:

- Playwright and Chromium versions;
- Linux, 1024x768 viewport, and 1x device scale;
- test-only Inter files from the lockfile-pinned `@fontsource/inter` package,
  served through same-origin Playwright routes so the production CSP is not
  weakened;
- light color scheme, reduced motion, `en-US`, and UTC;
- a fixed browser clock;
- disabled animations/transitions and hidden carets;
- normalized random workspace/revision/skill/digest/latency text.

The reviewed baseline set covers ready overview, route recommendation, policy
dry-run, native-agent curation handoff, eval review editor, escaped upstream
source diff, and derived-state recovery. The source-diff browser fixture owns
only presentation, escaping, and no-storage assertions. The production backend
suite separately exercises the one-fetch immutable GitHub comparison with a
deterministic injected transport; no browser release gate depends on live
GitHub availability.

Current screenshots are always written to the artifact directory. When the
pixel mismatch exceeds the reviewed threshold, a red/blue diff PNG is written
and the process exits non-zero.

Baseline creation is explicit and is refused outside Linux Chromium:

1. Run the critical Chromium lane and review the intended UI change.
2. Use the exact CI image `mcr.microsoft.com/playwright:v1.61.1-noble` so the
   operating-system and browser manifest match CI.
3. Generate candidates from the repository root without creating root-owned
   files:

   ```bash
   mkdir -p /tmp/skillmap-visual-update
   docker run --rm --ipc=host \
     --user "$(id -u):$(id -g)" \
     -v "$PWD:/work" \
     -v /tmp/skillmap-visual-update:/artifacts \
     -w /work \
     -e SKILLMAP_BROWSER_ARTIFACTS=/artifacts \
     mcr.microsoft.com/playwright:v1.61.1-noble \
     npm run test:visual:update
   ```

4. Inspect every changed baseline PNG and the current screenshots under the
   artifact directory. Do not approve an unexplained difference.
5. Rerun `npm run test:visual` without the update flag.
6. Commit the reviewed PNG files and manifest together.

The gate never creates a missing baseline during a normal test run.

## Performance and static-asset budgets

`test:perf` prepares a real 500-skill workspace and records browser-side or
end-to-end timings in `qa-chromium.json`:

| Measurement | Enforced provisional gate | Optimization target | Environment override |
| --- | ---: | ---: | --- |
| Cold authenticated startup | 6000 ms | — | `SKILLMAP_LOCAL_APP_COLD_STARTUP_BUDGET_MS` |
| Warm authenticated startup | 2500 ms | 1000 ms, not enforced and currently unmet | `SKILLMAP_LOCAL_APP_WARM_STARTUP_BUDGET_MS` |
| Route result | 2000 ms | — | `SKILLMAP_LOCAL_APP_ROUTE_BUDGET_MS` |
| Route-transition feedback | 200 ms | — | `SKILLMAP_LOCAL_APP_TRANSITION_FEEDBACK_BUDGET_MS` |
| Route-transition completion | 1000 ms | — | `SKILLMAP_LOCAL_APP_TRANSITION_COMPLETE_BUDGET_MS` |
| 500-skill filter/render | 100 ms | — | `SKILLMAP_LOCAL_APP_FILTER_500_BUDGET_MS` |
| Authenticated deep link | 4000 ms | — | `SKILLMAP_LOCAL_APP_DEEP_LINK_BUDGET_MS` |
| All packaged static files, raw | 393216 bytes | — | `SKILLMAP_LOCAL_APP_STATIC_RAW_BUDGET_BYTES` |
| All packaged static files, gzip-9 | 102400 bytes | — | `SKILLMAP_LOCAL_APP_STATIC_GZIP_BUDGET_BYTES` |

Every packaged local-app file is listed with raw and gzip-9 bytes in the QA
report. An override changes the gate for an explicit experiment; it must not be
used in CI to conceal a regression.

The gzip gate was first deliberately rebased from 64 KiB to 72 KiB on 2026-07-10
after stable trace permalinks, actionable policy proposals/decisions, feedback
backlog, and redacted diagnostics/uninstall handoff completed the Personal V1
workflow. The combined unminified static source measured 230,155 raw bytes and
67,466 gzip-9 bytes. The 72 KiB limit preserves about 9% reviewed headroom while
the unchanged 256 KiB raw cap still catches accidental bodies, fixtures, or
large dependencies. This is a recorded product-baseline change, not a CI-only
override.

The completed plan-gap pass then added bounded skill source/policy/route
history, prompt-free paginated eval traces and run progress, exact integration
handoffs, durable Activity receipts, and prompt-free eval contract validation.
The final packaged local app measured 256693 raw bytes and 74210 gzip-9 bytes
across 25 files. That legitimate workflow completion exceeded the 72 KiB cap
and left the 256 KiB
raw cap with less than 3% headroom. The reviewed final provisional gates are
therefore 288 KiB raw and 80 KiB gzip-9, leaving about 15% and 11% headroom
respectively. These defaults are source-controlled and apply locally and in CI;
they are not an environment-only waiver.

The qualified eval-suite/v3 authority pass then added the in-browser v3
contract editor, exact digest calculation, historical baseline resolution,
qualified-ID migration, and candidate-only legacy review. The subsequent
trust-boundary pass added exact per-endpoint response validation, compatibility-
bound snapshot revalidation, exact MCP tool/schema binding, and producer-aligned
bootstrap, hook, feedback, identifier, and filesystem-freshness correlations.
The resulting 26-file bundle measures 389377 raw bytes and 102187 gzip-9 bytes.
The reviewed provisional gates remain 384 KiB raw and 100 KiB gzip-9: no later
environment waiver or silent rebase was used. This leaves 3839 raw bytes and 213
gzip bytes of deliberately tight headroom. Runtime gates for the 500-skill
startup, route, transition, filter, and deep-link workflows remain independent,
so contract growth cannot hide a runtime regression. An environment override
remains an experiment only, never a CI waiver.

Cold and warm startup are separate runs and separate report fields. The cold
measurement is the first authenticated application load. The warm measurement
is an authenticated reload with the browser cache warm; it is not inferred from
the cold run.

The authenticated deep-link timing measures an ordinary authenticated Activity
reload through its ready state. The deliberately injected revision-conflict
retry is exercised immediately afterward as a separate resilience assertion;
its forced failure latency is not mislabeled as normal deep-link performance.

The 2500 ms warm gate reflects the current measured 500-skill local corpus and
keeps regression headroom for shared CI. The final accepted 2026-07-10
500-skill run measured 2443 ms cold and 2386 ms warm: both passed their
provisional gates,
and the warm measurement did **not** meet the product plan's 1000 ms
optimization target. `qa-chromium.json` records both
judgments independently as `gateStatus` and `optimizationTargetStatus`; the
1000 ms target cannot make the gate pass and is never represented as achieved
when the measurement is above it.

### Public Next.js performance profile

The public viewer has a separate production-build gate. The harness adds no
analytics: Playwright installs page-local PerformanceObservers before
navigation, reads only numeric Web Vitals from the same browser process, and
fails any browser request outside the exact loopback application origin.

```bash
npm --prefix apps/web run build
SKILLMAP_WEB_PERF_ARTIFACTS=/tmp/skillmap-public-web-performance \
  npm run test:web:perf
```

The agreed baseline profile is headless Chromium at 1440 by 1000 on loopback,
without CPU or network throttling, using a fresh browser context for each
public route. CI enforces LCP at or below 2500 ms, INP at or below 200 ms on
the interactive landing and dashboard profiles, CLS at or below 0.1, and at
most 294912 JavaScript bytes per route, including both external encoded chunks
and inline Next/Flight scripts. The report records the exact chunk list and
inline byte count for `/`, `/dashboard`, every public trust route, and
`/support`.
Environment overrides exist for explicit experiments but must not be used to
conceal a CI regression:

- `SKILLMAP_WEB_LCP_BUDGET_MS`
- `SKILLMAP_WEB_INP_BUDGET_MS`
- `SKILLMAP_WEB_CLS_BUDGET`
- `SKILLMAP_WEB_ROUTE_JS_BUDGET_BYTES`

The final accepted 2026-07-10 production baseline measured a worst-route LCP of
600 ms, INP of 56 ms, CLS of 0, and 247008 total JavaScript bytes on
`/dashboard`; the heaviest static trust route loaded 232084 total JavaScript
bytes. The 288 KiB route limit leaves about 19% reviewed headroom above the
heaviest route while still turning an accidental shared dependency, inline
payload, or chunk expansion into a CI review.

This synthetic gate is a repeatable regression signal, not field performance
evidence. Public beta still requires review on the supported shipping devices
and networks.

## Evidence and failure artifacts

Set an explicit artifact directory when evidence must be retained:

```bash
SKILLMAP_BROWSER_ARTIFACTS=/tmp/skillmap-browser-evidence npm run test:visual
```

The directory contains:

- `qa-<browser>.json` with engine/version, modes, status, timings, and asset
  sizes;
- `candidate-chromium.json` with the exact tarball digest, package version,
  temporary-consumer execution mode, and candidate-bound gate status;
- `web-performance.json` with route-level Core Web Vitals and JavaScript chunk
  budgets for the public Next.js application;
- `run.log` when invoked by CI;
- `screenshots/*.png` for current visual renders;
- `diffs/*.png` for failed pixel comparisons.

Without the variable, artifacts go to a process-specific temporary directory.
Set `SKILLMAP_KEEP_E2E_WORKSPACE=1` only for local debugging; normal runs remove
all temporary workspaces on success and failure.

No app assertion is converted to a warning or fallback pass. Expected replay,
offline, conflict, and outcome-unknown failures are narrowly scoped and counted
by endpoint and status; every other diagnostic fails the lane.
