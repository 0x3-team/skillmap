---
name: visual-qa
description: Use after frontend, UI, UX, visual polish, responsive layout, design-to-code, dashboard, website, app-screen, or TUI changes when the result must be checked visually with screenshots, browser/TUI evidence, viewports, states, overflow, or interaction smoke tests.
---

# Visual QA

Use this skill to verify what the user can actually see and operate. Code inspection is not visual QA.

The goal is to capture fresh target-perspective evidence after the last meaningful edit and decide whether the UI is acceptable, blocked, or needs another implementation pass.

## When To Use

Use this skill when:

- The task changed UI, layout, styling, copy fit, spacing, responsive behavior, visual hierarchy, charts, canvases, animations, modals, nav, dashboards, websites, or app screens.
- The user asks to inspect screenshots, verify the real UI, check mobile/desktop, or make sure nothing overlaps.
- A checkpoint, acceptance review, or implementation orchestrator needs visual target evidence.

Skip this skill when:

- The change is backend-only, data-only, CLI-only, or documentation-only.
- The UI cannot be run or captured and the user only requested code review; state the limitation instead.

## Evidence Contract

Before claiming visual verification, capture or inspect at least one target-perspective artifact:

- browser screenshot,
- TUI screenshot/capture,
- simulator screenshot,
- rendered page in a real browser,
- image diff,
- canvas-pixel check for 3D/canvas work,
- recorded interaction evidence when motion/drag/drop matters.

Screenshots must be fresh after the last meaningful edit. Stale screenshots are historical context, not proof.

## Workflow

1. Anchor the surface:
   - route/path/screen, dev server command, viewport targets, auth limits, and primary workflow.
2. Identify required states:
   - default, loading, empty, error, disabled, hover/focus when feasible, modal/menu, populated data, and narrow/wide layout.
3. Start or reuse the app only when needed.
   - Record URL, port, server command, and cleanup responsibility.
4. Capture evidence:
   - desktop viewport relevant to the product.
   - mobile/narrow viewport when responsive behavior matters.
   - any specific states named by the user or changed by the patch.
5. Inspect with a product-quality lens:
   - text overflow, clipping, wrapping, truncation, contrast, visual hierarchy, density, focus state, hit targets, alignment, spacing, scroll behavior, sticky elements, modals, z-index, icon fit, data table usability, chart labels, and empty/error states.
6. Exercise key interactions:
   - navigation, buttons, menus, forms, filters, search, selection, drag/drop, keyboard/focus, and dismissal where relevant.
7. Report status:
   - `verified visually`
   - `validated locally, visual gaps found`
   - `implemented but visually unproven`
   - `blocked`

## Viewport Defaults

Use product-appropriate sizes, but default to:

- Desktop: around `1440x900` or the app's normal desktop size.
- Narrow/mobile: around `390x844` for responsive web.
- Tablet or intermediate widths when the layout has breakpoint-sensitive navigation or tables.

For desktop apps, also check a smaller window where layout compression is likely.

## Common Failure Checks

- Text overlaps neighboring content.
- Buttons grow or shift layout when labels change.
- Cards are nested inside cards unnecessarily.
- Hero-scale text appears inside compact panels.
- Dense operational tools look like marketing pages.
- Mobile nav blocks core content.
- Empty/loading/error states are unstyled or misleading.
- Modals overflow the viewport.
- Tables are unusable at narrow widths.
- Color palette is one-note or contrast is weak.
- Canvas/3D surfaces render blank or cropped.

## Guardrails

- Do not claim authenticated visual QA unless authenticated flow was actually checked.
- Do not claim live verification from local screenshots.
- Do not keep servers, browsers, simulators, or watchers running without a cleanup receipt.
- Do not use visual QA to justify broad unrelated redesigns.
- If a browser/tool is unavailable, say exactly what was blocked and what lower-confidence check was done.

## Output Shape

```text
Visual QA:
- Surface:
- Build/run state:
- Evidence captured:
- Viewports/states checked:
- Interactions checked:
- Findings:
- Status:
- Cleanup:
```
