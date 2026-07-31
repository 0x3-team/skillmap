---
name: x-opportunity-reality-check
description: Fact-check and evaluate X posts, GitHub repos, trading bots, Polymarket/Kalshi/crypto/AI automation claims, side-income ideas, bounty claims, and business opportunities for realism. Use when the user asks "is this real", "is this legit", "can this make money", "how realistic is this", sends an X post/thread/article with a repo or guide, asks about trading bots, delta-neutral or arbitrage claims, passive income claims, GitHub project viability, or wants odds, risks, and a practical go/no-go recommendation.
---

# X Opportunity Reality Check

Use this skill to separate signal from hype when the user sends an X post, repo, article, or money-making claim.

## Default Outcome

Answer the real question: "Should I spend time or money on this?"

Give a direct verdict, realistic success probability, key evidence, hidden blockers, and the safest next step. Keep legal/financial risk visible without turning the answer into generic disclaimers.

## Workflow

1. Capture the claim.
   - Identify the promised outcome, required capital/time, repo/tool/article, platform, and proof offered.
   - Distinguish "can be built", "can run", "can profit", and "can profit for this user".

2. Verify primary sources.
   - Browse current sources when claims involve money, markets, platform rules, APIs, repositories, pricing, laws, or live availability.
   - Prefer primary sources: GitHub repo, official docs, claim platform, market API, exchange/platform rules, archived package status, maintainer comments, commit history.
   - For X posts, resolve linked `t.co` URLs and check the linked article/repo directly.

3. Inspect the implementation.
   - If a repo is attached, check files, install docs, dependencies, recent commits, issues, tests, license, API usage, and whether advertised files/commands exist.
   - Look for real execution paths: wallet signing, order placement, authenticated API calls, persistence, risk controls, logging, retries, simulation vs live mode.
   - For trading bots, separate scanners, paper trading, backtests, and live execution.

4. Check economics and constraints.
   - Estimate fees, spread/slippage, latency, minimum capital, liquidity, rate limits, API access, geofencing, tax/legal constraints, and operational maintenance.
   - For US-based usage, explicitly check platform availability and restrictions when relevant.
   - For "risk-free" claims, identify the residual risk: counterparty, settlement, account ban, execution, borrow/funding, bridge, oracle, legal, liquidity, or model risk.

5. Score the opportunity.
   - `Realness`: is the post/repo/project real?
   - `Reproducibility`: can the user reproduce the advertised setup?
   - `Profit realism`: can it realistically make money after costs?
   - `User fit`: does it fit the user's capital, location, skills, and time?
   - `Risk`: what can go wrong and how expensive is failure?

6. Recommend next action.
   - Choose one: `skip`, `watch`, `paper-test`, `small experiment`, `build only as research`, or `pursue`.
   - Define the smallest non-destructive validation step and the stop condition.

## Output Shape

- `Verdict`: direct answer.
- `Probability`: rough ranges for reproduction and profit, with confidence.
- `What is real`: verified facts.
- `What is hype or missing`: mismatches, unsupported claims, missing files, fake proof, or bad assumptions.
- `Blockers`: legal/platform/access/capital/API/liquidity/time constraints.
- `Recommended next step`: one practical action.

## Red Flags

- Missing repo files that the post tells users to run.
- Simulation or paper-trading code presented as live profit.
- No real order placement, private-key flow, wallet signing, broker integration, or settlement path.
- Archived or deprecated SDKs used as if current.
- Screenshots of profit without reproducible trades, wallet history, or verifiable IDs.
- "Risk-free", "guaranteed", "passive", "delta neutral", or "arbitrage" claims with no fee/slippage/funding/liquidity math.
- Requires platform access the user likely does not have.
- Depends on private alpha, invite-only APIs, or TOS violations.

## Guardrails

- Do not encourage illegal platform access or evasion of geofencing/KYC.
- Do not treat financial claims as stable; verify current platform rules and docs.
- Do not call an opportunity profitable only because the repo runs.
- Do not spend user money or submit trades/orders.
- Do not over-research low-value ideas after the decisive blocker is found.
