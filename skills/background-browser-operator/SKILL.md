---
name: background-browser-operator
description: Work with browser surfaces in a controlled background lane while the user studies, meets, reviews, or does another primary task. Use Obscura MCP as the default browser labor surface for DOM/text workflows, and escalate to Chrome, in-app browser, or computer-use for visual, authenticated, profile-specific, extension, or browser-parity proof. Use when the user asks to keep browser work running in the background, monitor or verify a web flow without interrupting them, open a target before manual handoff, or pair browser verification with planning, audit, implementation, production-readiness, Safari extension, or frontend-design work.
---

# Background Browser Operator

## Purpose

Operate browser surfaces without stealing the user's active focus. This is a support skill: it should be called alongside the domain skill that owns the work, such as `planning-orchestrator`, `implementation-orchestrator`, `audit-orchestrator`, `production-readiness-gate`, `frontend-design`, `safari-web-extensions`, or an account/app connector skill.

Use this skill to preserve the user's real-world task while still gathering browser evidence, monitoring a web flow, preparing manual steps, or validating UI behavior.

## When To Use

- The user says to work in the browser while they study, meet, review, or do something else.
- The browser task can proceed without immediate user attention.
- A browser/account/manual step is required, but the agent should first open or identify the relevant target.
- A plan, audit, implementation, release gate, or UI task needs browser evidence and should not commandeer the foreground session.
- The real target is a logged-in browser, Comet/Chrome session, installed extension, in-app browser, or OS/browser UI.

## When Not To Use

- The task does not involve a browser, web app, extension, or account workflow.
- The user explicitly wants to control the browser themselves without background automation.
- The requested action is destructive, paid, credential-sensitive, 2FA/CAPTCHA-gated, or privacy-sensitive and the user has not explicitly approved the action.
- The browser surface would write durable user, account, production, study, or progress state without a clear permission and rollback path.

## Browser Surface Routing

Choose the least disruptive surface that can prove the claim:

1. `Obscura MCP`: default worker browser for navigation, DOM snapshots, markdown/text extraction, link discovery, simple form interaction, JS evaluation, cookies/storage checks, and console/network diagnostics when screenshots are not required.
2. `in-app browser`: isolated UI checks, screenshots, unauthenticated flows, local web apps, and manual-step preparation.
3. `Chrome/Comet/profile browser`: logged-in state, installed extensions, account-specific pages, browser automations, or workflows where the user's real profile is the target.
4. `computer-use`: OS/browser UI that browser automation cannot reach.
5. `manual handoff`: auth, 2FA, CAPTCHA, payment, privacy-sensitive, destructive, or account-owner steps.

If the requested target depends on the user's existing session, say that explicitly. Do not treat an unauthenticated or isolated browser check as authenticated/live verification. Do not treat Obscura output as visual proof; use Chrome, screenshots, or computer-use when the result must be seen.

## Safety Boundaries

- Identify the foreground task before acting when evidence suggests the user is studying, in a meeting, using Anki, taking notes, or using another active workflow.
- Do not steal keyboard or browser focus unless the user explicitly asked for active control.
- Prefer passive observation, Obscura DOM/text checks, isolated browser checks, screenshots, and status receipts over foreground interaction.
- Never treat a temporary audit server as the source of truth for persistent user data.
- Never overwrite study progress, local app state, account settings, production data, or browser profile state from a browser test.
- Keep authenticated, live, local, and observed-only states separate.
- If a step requires user attention, stop and provide exact manual steps after opening or identifying the target when feasible.

## Required Background Browser Receipt

Every invocation must close with this receipt:

```text
Background browser status:
- Target:
- Surface used: <Obscura MCP | in-app browser | Chrome/Comet/profile | computer-use | manual handoff | none>
- Mode: <passive monitor | active background verification | user-attention-required>
- Actions completed:
- Evidence captured:
- Auth/session state:
- User focus interrupted: <yes | no | unknown>
- Durable state touched: <yes | no>
- Blocked/not verified:
- Next checkpoint or stop condition:
```

Use `none` or `unknown` honestly. Do not invent screenshots, auth state, or live verification.

## Composability Rules

- With `planning-orchestrator`: add a background browser lane to the plan, including target, safety boundary, receipt, and stop condition.
- With `implementation-orchestrator`: use browser work as validation or manual handoff support while the parent owns edits and integration.
- With `audit-orchestrator`: gather browser evidence without changing state; mark auth or account limits as blocked checks.
- With `production-readiness-gate`: separate local browser observation from live/authenticated verification.
- With `frontend-design`: validate rendered UI while preserving study/product state and avoiding temporary-server confusion.
- With `safari-web-extensions`: use the browser surface that actually hosts the extension and record profile/session assumptions.

## Manual Handoff Pattern

When the user must act manually:

1. Open or identify the exact target when feasible.
2. State why automation should stop.
3. Provide concrete ordered steps.
4. State what evidence the user should report back.
5. Preserve any background monitor or next checkpoint separately.

## Common Mistakes

- Treating this skill as a full replacement for the domain skill.
- Claiming logged-in or live verification from an isolated browser.
- Continuing after auth, CAPTCHA, payment, or destructive account boundaries.
- Restarting or using a local preview server without checking whether it is the correct source of truth.
- Inspecting a study app in a way that overwrites progress or browser state.
- Saying "done" without the background browser receipt.
