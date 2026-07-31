---
name: pr-ci-status-monitor
description: Check pull requests, CI failures, review comments, CodeRabbit feedback, GitHub issue/bounty status, Algora or payout claim state, and required next actions. Use when the user asks to check PR status, CI status, failing checks, review comments, CodeRabbit comments, whether something was merged/paid/rewarded/blocked, contribution or bounty status, or asks for a concise monitor/update on GitHub work.
---

# PR CI Status Monitor

Use this skill for current, evidence-based status checks around PRs, CI, reviews, and bounty or claim workflows.

## Workflow

1. Resolve targets.
   - Identify repo, PR/issue numbers, claim URLs, branch names, and expected payout or merge criteria.
   - Prefer explicit URLs from the user. If missing, inspect recent local branch/remotes or known session context.

2. Refresh live state.
   - Use GitHub tooling (`gh` or GitHub connector) for PR state, checks, reviews, comments, mergeability, and CI logs.
   - Use claim/payout pages or APIs for Algora, bounty platforms, wallets, or reward status.
   - Browse or query live sources when status could have changed.

3. Classify status.
   - `Needs action`: failing check, requested changes, maintainer question, conflict, missing claim, blocked auth/payment setup.
   - `Waiting`: open with passing checks and no required response.
   - `Done unpaid`: merged/accepted but no confirmed payout.
   - `Paid`: confirmed paid from a reliable source.
   - `Blocked`: platform access, repo permission, unavailable page, or ambiguous claim state.

4. If CI failed.
   - Pull the failing job/log summary.
   - Identify the first actionable failure, not every cascade.
   - Recommend or implement a focused fix only if the user asked for fixes.

5. Report concisely.
   - Distinguish potential payout from confirmed payout.
   - Include links and exact states.
   - Say whether the user needs to respond.

## Output Shape

- `Status`: one-line overall result.
- `Per target`: PR/claim state, checks, reviews/comments, payout or merge state.
- `Action needed`: yes/no, with exact next step.
- `Confirmed value`: paid/merged/rewarded evidence, or `$0`/none if not confirmed.

## Guardrails

- Do not rely on stale memory for current PR/CI/payout state.
- Do not say "paid" unless the payment is confirmed by the platform, wallet, or maintainer record.
- Do not post comments, submit PRs, claim bounties, or push branches unless the user explicitly asks.
- Do not expose tokens, private config, or hidden claim data in the final answer.
