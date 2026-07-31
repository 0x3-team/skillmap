# Source Index

Use this file to recover original sources, documentation, and observed evidence before making new liquid glass decisions. Recheck live docs when browser support, package versions, or vendor behavior matters.

## Primary Design Sources

- Aave design article: https://aave.com/design/building-glass-for-the-web
  - Use for production SVG displacement strategy, Safari-oriented implementation notes, filter refresh behavior, bounded filter footprint, and the "SVG for DOM, WebGL for video/canvas" split.
- Aave live article page, inspected 2026-06-21:
  - Observed DOM included many inline SVG filters and `feDisplacementMap` nodes, plus WebGL/canvas demos for richer media cases.
  - Observed filter primitive pattern included `feFlood`, `feImage`, `feComposite`, `feGaussianBlur`, `feDisplacementMap`, and `feColorMatrix`.
- ybouane LiquidGlass repo: https://github.com/ybouane/liquidglass
  - Use for high-fidelity WebGL/DOM-rasterization architecture, async init contract, `data-config`, `data-dynamic`, `markChanged`, and performance limitations.
- ybouane LiquidGlass live demo: https://liquid-glass.ybouane.com/
  - Use for visual quality reference and WebGL "wow" benchmark.
- npm package: https://www.npmjs.com/package/@ybouane/liquidglass
  - Recheck latest version and audit status before installing in a production repo.

## Standards And Compatibility Docs

- MDN CSS `filter`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/filter
- MDN SVG `<filter>`: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/filter
- MDN SVG `feDisplacementMap`: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap
- MDN `SVGFEDisplacementMapElement.scale`: https://developer.mozilla.org/en-US/docs/Web/API/SVGFEDisplacementMapElement/scale
- MDN CSS `backdrop-filter`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
- MDN WebGL API: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
- Can I Use `feDisplacementMap`: https://caniuse.com/mdn-svg_elements_fedisplacementmap
- Can I Use `backdrop-filter`: https://caniuse.com/css-backdrop-filter

## Prior Local Evidence

- LiquidGlass cloned 2026-06-21 from GitHub HEAD `5ebda520bebdef7786566bc8cb151cac0e593314`; package version was `1.0.3`.
- Local LiquidGlass build passed with `npm run build` in the cloned checkout.
- Local audit of the upstream checkout on 2026-06-21 reported dev/tooling advisories for `esbuild` and transitive `tmp`; re-run `npm audit` before adopting.
- Live LiquidGlass demo rendered correctly in Playwright desktop/mobile but showed low FPS in headless Chromium and desktop WebGL `ReadPixels` performance warnings.
- Live Aave article rendered correctly in Playwright desktop/mobile with no horizontal overflow; console showed several SVG path `d="undefined"` errors and desktop WebGL `ReadPixels` warnings, but no page-level crash.

## React Bits Context

- React Bits `GlassSurface` was provided by the user as pasted source, not as the preferred final architecture.
- Its value is API shape and simple fallback behavior. Its limitation is relying on SVG filters inside `backdrop-filter`, which is not the preferred cross-browser production path.
