---
name: safari-web-extensions
description: Build, package, test, and reason about Safari Web Extensions for iOS, iPadOS, and macOS. Use when creating or modifying Safari extensions, WebExtension manifests/content scripts/background scripts/popups/options pages, extension-native app messaging, App Store packaging, Safari permissions, or Safari-specific debugging.
---

# Safari Web Extensions

Use this skill for Safari extension work. A professional Safari extension is not just a web frontend and not just a Swift app. It is a combined Apple product:

- a native containing app for iOS, iPadOS, and/or macOS,
- WebExtension files: `manifest.json`, content scripts, background/service worker, popup/options pages, CSS, assets, localization,
- a native app extension bridge for Safari-specific messaging and App Store packaging.

## Default Architecture

Prefer a multiplatform Safari Extension App project in Xcode when we are building a real App Store product.

Use this structure unless the existing repo has a better established layout:

```text
App/
  iOS/
  macOS/
  Shared/
Extension/
  manifest.json
  background/
  content/
  popup/
  options/
  styles/
  assets/
  rules/
Engine/
  theme/
  color/
  dom/
  focus/
  settings/
Tests/
  fixtures/
  snapshots/
  sites/
docs/
```

For a comfort/dark-mode extension, keep the core engine as platform-neutral TypeScript/JavaScript that can be tested outside Safari, then package it into the Safari extension target.

## When Starting A New Product

1. Define the product surface first: toolbar popup, native app settings, per-site state, and first-run permission education.
2. Choose platform scope:
   - use multiplatform iOS + macOS for an App Store product,
   - use macOS temporary extension loading only for early engine experiments,
   - do not ship separate codebases unless platform behavior genuinely requires it.
3. Use Apple’s Safari Extension App template or `xcrun safari-web-extension-packager` to generate the Xcode project.
4. Keep the native app small: onboarding, enable instructions, settings, purchase state if needed, issue reporting if intentionally included.
5. Keep the extension engine deterministic and local: no account, no remote API, no browsing-data collection unless the user explicitly changes the product strategy.

## Existing Skills To Combine

- Use `build-ios-apps:*` for simulator build/run, SwiftUI iOS app surfaces, and iOS-specific UX.
- Use `build-macos-apps:*` for macOS SwiftUI shell, settings, commands, signing, packaging, and local run scripts.
- Use `build-web-apps:*` for popup/options UI, TypeScript build tooling, CSS, and browser-side app surfaces.
- Use `frontend-design` for product UI/UX and visual polish.
- Use `competitor-profiling`, `competitors`, `pricing`, `aso`, and `x-opportunity-reality-check` for market positioning, App Store listing, competitor analysis, pricing, and go/no-go judgment.

## Manifest And WebExtension Rules

- Treat `manifest.json` as a cross-browser contract but verify Safari compatibility before relying on any key or API.
- Prefer Manifest V3 for new work unless an existing Safari compatibility constraint forces another choice.
- Use `browser.*` or `chrome.*` intentionally. Safari supports both namespaces, but cross-browser abstractions should be explicit.
- Content scripts are for page reads/writes. Background/service worker code is for extension state, toolbar commands, tab coordination, and messaging.
- Do not assume Chrome behavior equals Safari behavior. Check Safari support for every API used by the engine.
- iOS requires nonpersistent background behavior. Design background code around top-level event listeners and durable storage, not long-lived runtime state.
- Use the Storage API for extension state. Keep storage small and schema-versioned.
- Be careful with `nativeMessaging`: content scripts cannot directly send native messages. Route through extension pages/background scripts when native communication is required.

## Safari Product Rules

- Minimize permissions. If all-site access is required, explain why in plain language in the containing app and App Store privacy copy.
- Treat privacy as product quality: do not collect URLs or browsing data by default. If issue reporting exists, make exactly what is sent explicit.
- Avoid white flash and visual jump as first-class quality gates for dark/warm mode extensions.
- Per-site controls must be fast and obvious: current site on/off, mode override, and reset.
- Keep the user model simple. Prefer modes such as `Auto`, `Dark`, `Warm`, and `Focus` over exposing dozens of sliders.
- Hide advanced tuning behind per-site or expert settings.

## Dark/Warm/Focus Engine Guidance

For a Noir-class comfort extension, do not rely on a global CSS filter as the main engine.

Use a layered approach:

1. Inject a tiny anti-flash base style as early as Safari allows.
2. Detect whether the page already has a good dark mode before overriding it.
3. Analyze computed colors for background, text, borders, controls, links, SVGs, and common component surfaces.
4. Generate CSS variables and override rules rather than mutating every node repeatedly.
5. Transform images/media separately: dim or warm photos without inverting them by default.
6. Keep contrast measurable. Any transformed text/background pair must stay readable.
7. Re-run narrowly on DOM changes using throttled observers; avoid full-page rescans on every mutation.
8. Maintain a small site-fix rules layer for high-value broken sites, but do not build a product that depends entirely on manual rules.
9. For Focus mode, reduce clutter conservatively: hide or soften obvious sticky banners, sidebars, newsletter blocks, recommendations, and overlays only when detection confidence is high.
10. Always provide a one-tap current-site disable path.

## Testing And Verification

Use three levels of testing:

1. Engine tests outside Safari:
   - color transformation unit tests,
   - DOM fixture tests,
   - contrast checks,
   - storage migration tests,
   - site-rule matching tests.
2. Browser/extension tests:
   - temporary macOS Safari extension loading for fast iteration,
   - Safari Web Inspector for content/background scripts,
   - manual permission and profile checks,
   - screenshots before/after mode changes.
3. Apple platform tests:
   - Xcode build for macOS app and extension,
   - iOS Simulator build/install/enable flow,
   - real-device check before App Store submission,
   - TestFlight smoke with permissions, Private Browsing, Profiles, and iCloud/sync behavior where applicable.

For dark/warm mode products, maintain a brutal site set and do not declare the engine good until it works on representative pages:

```text
Google Search
Gmail
Google Docs
Wikipedia
YouTube
Amazon
GitHub
Stack Overflow
MDN
Apple
Stripe
New York Times
BBC
Reddit
Hacker News
Medium
Substack
Notion public pages
login forms
native-dark-mode sites
```

The quality gate is visual, not just technical. For each mode, capture before/after screenshots and inspect readability, contrast, image handling, form controls, sticky elements, load flash, and scrolling performance.

## Debugging Workflow

1. Reproduce on the smallest page/site where the bug appears.
2. Identify the failing layer: permission, injection timing, manifest/API support, content script, background script, native bridge, settings storage, CSS generation, or DOM mutation handling.
3. Check Safari-specific compatibility before rewriting working cross-browser code.
4. Use Safari Web Inspector for page/content scripts and extension background where available.
5. On macOS, use temporary extension loading for quick file iteration when Xcode packaging is not needed.
6. For iOS, build and install the containing app, then enable the extension in Safari settings or the Safari More menu.
7. Record the site URL pattern, mode, Safari version, platform, and repro steps in a local issue/fix log.

## Distribution And App Store

- Safari extensions are distributed through the App Store as apps containing extensions.
- A paid product should use the App Store purchase model unless the user explicitly asks for subscriptions or accounts.
- For user trust, prefer universal purchase when feasible.
- Use clear App Store copy: what the extension does, why permissions are required, whether browsing data is collected, and how users disable it for a site.
- Avoid copycat positioning. Study competitors for quality bars and gaps, but do not copy names, icons, screenshots, branding, or UI.

## Source Links

Primary references are in `references/sources.md`. Re-check them live when starting serious implementation because Safari, Xcode, App Store Connect, and WebExtension support change over time.
