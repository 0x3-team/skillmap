---
name: frontend-design
description: Create or improve production-quality frontend UI/UX in code, including React, Next.js, Tailwind CSS, shadcn/Radix, responsive layouts, design systems, accessibility, motion, landing pages, dashboards, visual redesigns, and frontend QA. Use when the user asks for UI, UX, frontend design, visual polish, web or app screens, components, responsive or mobile fixes, landing pages, design-to-code work, or screenshot-backed frontend verification. When Magic UI components, animations, backgrounds, or marketing UI could help, use the globally configured Magic UI MCP.
---

# Frontend Design

## Overview

Build polished, usable interfaces that fit the existing product instead of generic templates. Prefer the repo's design system and component patterns, then use shadcn/Radix and Magic UI selectively when they improve fidelity, motion, or speed.

## Workflow

1. Inspect the current app before designing: routes, existing components, tokens, CSS framework, icon library, screenshots, and target users.
2. Define the screen's job in one sentence, then choose a visual direction that matches the product type.
3. Reuse local primitives first. In React/Tailwind projects, use shadcn/Radix for standard controls and Magic UI for high-polish animated or marketing-facing elements.
4. Implement in code with responsive constraints, keyboard states, focus states, loading/empty/error states, and reduced-motion handling where animation is used.
5. Verify with the project's normal checks plus browser screenshots at desktop and mobile sizes. Fix visible overlap, clipping, unreadable contrast, and layout shift before handoff.

## Magic UI MCP

Use Magic UI when a React, Next.js, Tailwind, or shadcn-style project needs polished components such as marquees, animated text, bento grids, device mocks, border beams, grid backgrounds, blur fades, or similar landing-page and brand moments.

When MCP tools are available, use the Magic UI MCP before hand-rolling those patterns:

- Use `searchRegistryItems` for targeted discovery by keyword.
- Use `listRegistryItems` for browsing by kind, query, limit, or offset.
- Use `getRegistryItem` before implementation to retrieve install instructions, source, examples, and related items.

If the Magic UI MCP is not exposed in the current session, continue with local patterns and note that a Codex restart or new session may be needed after global MCP config changes.

Do not use Magic UI as decoration by default. Avoid it for dense operational dashboards, admin tools, medical/study utilities, or data-heavy workflows unless a specific component clearly improves comprehension or interaction.

## Design Rules

- Start from a concrete visual target when one exists: screenshot, Figma, live URL, brand page, existing component, or generated mock.
- Keep hierarchy tight: one clear primary action, scannable section headings, predictable navigation, and body text sized for the container.
- Use real controls for real jobs: icon buttons for tools, toggles for binary settings, tabs for view switches, menus for option sets, inputs/sliders/steppers for numbers.
- Use accessible color contrast, semantic HTML, labels, focus outlines, keyboard operation, and `aria-*` only where native semantics are insufficient.
- Constrain fixed-format UI with stable grid tracks, aspect ratios, min/max dimensions, and overflow rules so hover states and dynamic text cannot resize the layout.
- Use motion to clarify state changes or add brand polish, not to distract. Respect reduced motion.
- Do not add broad refactors, new UI libraries, or decorative effects unless they are needed for the requested surface.

## Verification

Run the strongest practical checks for the repo: typecheck, lint, tests, build, Storybook, visual snapshots, or browser smoke tests. For visual work, a passing build is not enough; inspect rendered desktop and mobile screenshots before calling the work complete.
