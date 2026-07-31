# Testing Compatibility

Liquid glass is a visual effect with browser-specific failure modes. A build passing is not enough.

## Minimum Verification

For implementation work:

1. Run the repo's relevant static checks: lint, typecheck, tests, and production build.
2. Run browser smoke tests at desktop and mobile widths.
3. Capture screenshots and inspect for clipping, text overlap, excessive distortion, and horizontal overflow.
4. Check console warnings/errors after hydration and after interacting with controls.
5. Verify fallback behavior by forcing enhancement off.

For Safari-targeted work, test real Safari or iOS Safari when possible. If unavailable, say exactly what was not verified.

## Browser Matrix

Use these checks:

- Chromium/Chrome: primary development baseline; check console and visual fidelity.
- Safari/macOS: filter refresh behavior, stale SVG IDs, filter region clipping, performance.
- iOS Safari: DPR sizing, touch interactions, shimmer/smear artifacts, memory pressure.
- Firefox: SVG filter rendering and CSS fallback quality.
- Reduced motion: no continuous animation or pointer-follow dependency.
- Low-power fallback: acceptable non-WebGL/non-SVG look.

## Feature Detection

SVG displacement enhancement:

```js
function canUseSvgDisplacement() {
  return typeof SVGElement !== "undefined"
    && typeof document !== "undefined"
    && !!document.createElementNS
    && (typeof CSS === "undefined" || CSS.supports?.("filter", "url(#x)") !== false);
}
```

Treat this as a coarse gate only; browser-specific bugs still require visual testing.

WebGL enhancement:

```js
function canUseWebGL() {
  const canvas = document.createElement("canvas");
  return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
}
```

Always catch init failures and keep a CSS fallback.

## Common Failures

- **Text becomes unreadable**: Move text to a foreground layer above the filtered/refraction layer.
- **Mobile overflow**: Constrain widths with `max-width`, stable aspect ratios, and explicit min heights.
- **Safari stale filter**: Regenerate filter ID or remount the `<filter>` after substantial map changes.
- **Clipped shadow/highlight**: Increase filter region modestly, or move shadow to CSS outside the filter.
- **WebGL tainted canvas**: Fix CORS headers and `crossorigin` attributes for images/video/fonts.
- **Low FPS**: Reduce WebGL roots, avoid `data-dynamic`, lower blur passes/displacement, or switch the surface to SVG/CSS.
- **Hydration mismatch**: Render fallback on the server and enable SVG/WebGL after mount only.

## Playwright Checks

Use browser checks similar to:

```js
const messages = [];
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) messages.push(msg.text());
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.locator("[data-glass-ready], .glass-panel").first().waitFor();
const metrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  glassCount: document.querySelectorAll(".glass-panel, [data-glass]").length,
}));
```

Flag horizontal overflow, console errors, zero-size canvases, missing SVG filters, and text boxes wider than their glass panels.
