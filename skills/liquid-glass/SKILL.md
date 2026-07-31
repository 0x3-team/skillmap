---
name: liquid-glass
description: Design and implement high-quality liquid glass UI effects for web apps. Use when the user asks for liquid glass, Aave-style SVG displacement glass, LiquidGlass/WebGL glass, glass refraction, glassmorphism with realistic distortion, Safari-compatible glass, React/Next/Tailwind glass components, or a decision between CSS/SVG/WebGL glass approaches.
---

# Liquid Glass

## Overview

Build liquid glass as a progressive system: Aave-style SVG displacement for normal DOM UI, LiquidGlass/WebGL for high-fidelity hero/video/canvas moments, and plain CSS glass as the fallback. Do not treat simple `backdrop-filter` glass as the premium implementation.

## Renderer Decision

Use this default decision order:

1. **Aave-style SVG displacement** for app UI, menus, nav, cards, sheets, toolbars, buttons, and reusable React components.
2. **LiquidGlass/WebGL** only for showpiece hero sections, magnifiers, live video, canvas/QR surfaces, interactive demos, or when the user explicitly wants the highest visual fidelity.
3. **CSS fallback** for unsupported browsers, reduced-performance devices, server render before hydration, or failure to initialize SVG/WebGL.

Avoid using the older React Bits-style SVG `backdrop-filter: url(#...)` path as the main production path; it is useful as a quick prototype or fallback pattern, but the hybrid above covers the higher-quality cases.

## Workflow

1. Anchor on the target app and existing design system before writing code. Read local instructions, package scripts, current component primitives, styling stack, SSR constraints, and browser support targets.
2. Choose the renderer from the decision order. If the user asks for "best-looking" or "wow", consider WebGL; if they ask for production app UI or cross-browser compatibility, start with SVG displacement.
3. Implement a progressive component:
   - stable semantic DOM and accessible content
   - separate refracted visual layer from readable text/content
   - SVG displacement or WebGL enhancement after mount
   - CSS glass fallback that still looks intentional
4. Cache expensive work. Recompute displacement maps only on resize, DPR change, or relevant prop changes. Do not regenerate maps on every animation frame.
5. Verify visually and technically: run build/typecheck/lint as appropriate, inspect desktop and mobile screenshots, check console errors, and test Safari/iOS Safari when Safari compatibility is part of the goal.

## Reference Routing

- For production DOM components, read [SVG Displacement](references/svg-displacement.md).
- For high-fidelity/WebGL components, read [WebGL LiquidGlass](references/webgl-liquidglass.md).
- For browser validation and failure modes, read [Testing Compatibility](references/testing-compatibility.md).
- For original links, documentation, and source provenance, read [Source Index](references/source-index.md).

## Implementation Guardrails

- Preserve legibility. Do not refract critical text unless a clean foreground text layer remains above the effect.
- Keep filter regions bounded. Large SVG filter boxes and full-page canvas captures are common performance traps.
- Treat Safari as the hard target. Use fresh filter IDs or remount keys when filter updates get stale, keep displacement conservative, and verify on real Safari where possible.
- Use WebGL sparingly. Each WebGL root has setup cost and device/hardware variability; never put dozens of WebGL glass surfaces in dense operational UI.
- Respect `prefers-reduced-motion` and low-power contexts. Disable continuous shimmer, pointer-follow effects, or every-frame captures unless the interaction requires them.
- Make fallback explicit. Feature-detect SVG filters/WebGL where needed and keep a non-distorted translucent glass style as the baseline.
