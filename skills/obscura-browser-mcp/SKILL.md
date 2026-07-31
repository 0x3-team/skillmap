---
name: obscura-browser-mcp
description: Use the local Obscura MCP browser server from Codex as the default worker browser for fast DOM/text web automation, page extraction, form interaction, cookies/storage checks, console/network diagnostics, and agent browser work where screenshots are not required. Use when the user mentions Obscura, asks whether an agent can browse or act on their behalf through MCP, wants to verify Obscura MCP access, compare Obscura with Chrome/Playwright, or run web research, scraping, smoke checks, or browser workflows that can be proven with DOM/text evidence rather than visual screenshots.
---

# Obscura Browser MCP

## Overview

Use Obscura as the default local MCP-controlled browser for fast, text-first browser work. It is useful for navigation, extraction, interaction, cookies, storage, JavaScript evaluation, network logs, and console logs; it is not a replacement for Chrome when visual rendering, screenshots, profile state, extensions, or pixel-level QA matter.

## First Checks

Anchor the target before acting:

- Current MCP server name: `obscura`.
- Expected command: `/Users/stevmq/.cargo/bin/obscura`.
- Expected args: `mcp`.
- Expected transport: stdio.
- Expected Codex config block: `[mcp_servers.obscura]`.

If the tool namespace is not visible in the current running session, verify config with `codex mcp get obscura` and tell the user that a fresh Codex session or app restart may be required for newly added MCP tools to appear.

## Default Routing Rule

Use Obscura for browser labor by default, then escalate to Chrome, the in-app browser, Playwright screenshots, or computer-use only when the claim needs visual, authenticated, profile-specific, extension-specific, anti-bot, or browser-parity proof.

Typical flow:

1. Obscura does the work: navigate, inspect, click, fill, extract, summarize, and capture DOM/text evidence.
2. Chrome verifies when needed: screenshots, responsive layout, logged-in profile state, extension behavior, CAPTCHA/2FA, payments, account settings, or exact Chromium rendering.

## When To Use Obscura

Prefer Obscura for:

- Fast page navigation and text extraction.
- Accessibility/DOM snapshots, markdown extraction, link discovery, and structured extraction.
- Click, fill, type, select, keypress, tab, wait, and JavaScript evaluation workflows.
- Cookie and storage-state inspection where a disposable browser state is acceptable.
- Network request and console-message diagnostics.
- Agentic browsing through MCP when a real Chrome profile is unnecessary.

Prefer Chrome, the in-app browser, computer-use, or a real Playwright/Chromium session for:

- Screenshots, visual QA, layout inspection, canvas/video/WebGL, or pixel evidence.
- Logged-in profile state, extensions, passkeys, browser-specific permissions, or account dashboards.
- Anti-bot-heavy targets where full Chrome behavior, proxy strategy, or manual review is required.
- Actions that are paid, destructive, credential-sensitive, CAPTCHA/2FA-gated, or privacy-sensitive without explicit user approval.

## Operating Pattern

1. Verify availability when current access is uncertain:
   - Run `python3 /Users/stevmq/.agents/skills/obscura-browser-mcp/scripts/smoke_obscura_mcp.py`.
   - If this passes but tools are absent in Codex, the installed MCP is valid but the current session has not loaded it.

2. Use the Obscura tools for the page workflow:
   - Navigate first with `browser_navigate`.
   - Read state with `browser_snapshot`, `browser_markdown`, `browser_links`, or `browser_extract`.
   - Interact with refs from the snapshot when available; otherwise use selectors carefully.
   - Inspect diagnostics with `browser_network_requests` and `browser_console_messages`.
   - Use `browser_storage_state` or cookie tools when session state matters.

3. Keep state boundaries explicit:
   - Treat Obscura as an isolated browser session unless the user has configured shared cookies/storage.
   - Do not claim logged-in, visual, or profile-browser verification from Obscura alone.
   - Use `--allow-private-network` only when the user explicitly wants local/private-network browsing.
   - Do not expose Obscura MCP over HTTP without auth, origin allowlisting, and network isolation.

## Visibility

The user cannot watch Obscura as a visual browser because Obscura does not render pixels or support screenshots. Make work observable by reporting concrete evidence:

- Current URL and title.
- Snapshot or markdown excerpts.
- Clicked refs/selectors and filled field names.
- Network and console summaries.
- Tool calls completed and blocked checks.
- Whether the browser state was isolated, authenticated, or unknown.

When visual proof is required, route the task to Chrome, in-app browser, Playwright screenshots, or computer-use and say why.

## Closeout Receipt

Close Obscura browser work with:

```text
Obscura status:
- Target:
- MCP access: <available | installed-but-session-not-loaded | blocked>
- Actions completed:
- Evidence captured:
- Auth/session state:
- Visual coverage: none unless verified elsewhere
- Durable state touched:
- Blocked/not verified:
```
