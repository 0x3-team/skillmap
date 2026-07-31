---
name: cline-orchestrator
description: "Delegate supervised UI/UX design, visual implementation, design audits, image-to-code, plan critiques, or other benchmark-approved slices from Codex to Cline/ClinePass/GLM through the terminal. Use when Codex should own and steward Cline as a child specialist: keep Cline current, inspect Cline skills, select Cline only when current benchmark evidence says it helps, run GLM 5.2 with xhigh reasoning, capture provenance, recover interrupted Cline work through Codex, incorporate only reviewed output, and verify the final project behavior."
---

# Cline Orchestrator

Use Cline as a managed child capability, not as an autonomous owner. Codex remains planner, supervisor, editor, integrator, and final verifier.

Default delegation is narrow: UI/UX design, visual implementation, design critique, image-to-code, and design audits. Delegate outside that slice only when the benchmark router has fresh evidence that a Cline-accessible model is materially better for the task class.

## Required Rules

- Make every Cline/GLM use obvious in the final task record.
- Do not claim GLM 5.2 was used unless Cline JSON output or explicit CLI flags prove it.
- Run GLM 5.2 with `--thinking xhigh`; never lower it unless the user explicitly overrides this for the current task.
- Treat Cline output as untrusted until Codex reviews it.
- Incorporate means synthesize into the project, not GitHub merge automation.
- Salvage interrupted Cline work only when quality can be preserved; otherwise restart from a refreshed Codex plan and the correct skills.
- Codex owns Cline stewardship: updates, skills/plugins, feature selection, benchmark routing, logs, and provenance.

## References

Read these only when needed:

- `references/cline-stewardship.md`: before running Cline, updating it, listing skills, or installing approved Cline capabilities.
- `references/benchmark-router.md`: before delegating a new task class or when benchmark data may be stale.
- `references/cline-feature-selection.md`: when selecting Cline flags, modes, worktrees, rules, skills, MCP, plugins, or Kanban.
- `references/delegate-prompt-contract.md`: before constructing a Cline prompt.
- `references/safety-and-incorporation-gates.md`: before accepting, adapting, rejecting, or salvaging Cline output.
- `references/provenance-receipt.md`: before final reporting.

## Helper Scripts

Run helpers from the skill directory or by absolute path:

```bash
python3 scripts/refresh_cline_capability_state.py --json
python3 scripts/refresh_benchmark_router.py --json
python3 scripts/run_cline_delegate.py --repo "$PWD" --mode audit --task "..." --dry-run
python3 scripts/summarize_cline_ndjson.py path/to/cline.ndjson --format markdown
```

The scripts use only the Python standard library. They must not print raw Cline config files, secrets, API keys, or env values.

## Workflow

1. Anchor the project and plan.
   - Confirm repo path, branch, dirty state, product route/surface, acceptance criteria, and the exact Codex plan slice.
   - Read local `AGENTS.md`, README/docs, package scripts, and nearby code before delegation.
   - Decide whether Cline should implement, audit, generate alternatives, perform image-to-code, or critique a plan.

2. Steward Cline.
   - Run `refresh_cline_capability_state.py --json`.
   - If Cline reports updates are available, run the updater and record before/after state.
   - Inspect project/global Cline skills. Use installed relevant skills in the prompt.
   - Install a new Cline skill/plugin/MCP only when it is trusted, task-fit, and permission-bounded. For broad local/browser/network/repo access, get explicit user approval.

3. Refresh routing evidence.
   - Run `refresh_benchmark_router.py --json`.
   - Treat benchmark evidence as stale after seven days.
   - Current default: use Cline/GLM 5.2 for UI/UX/design slices; Codex handles other tasks unless fresh evidence says otherwise.

4. Preflight Cline runtime.
   - Run `command -v cline`, `cline --version`, and `cline --help` when selecting optional features.
   - If auth/model state is uncertain, run a no-file smoke test:

```bash
cline --json --auto-approve false --timeout 45 --cwd "$REPO" \
  'Respond exactly: CLINE_READY. Do not inspect files or run tools.'
```

5. Select mode and features.
   - Always use `--json` for supervised runs.
   - For GLM 5.2, pass `-P cline -m zai/glm-5.2 --thinking xhigh`.
   - Use `--timeout` on every delegated run.
   - Use `--plan` for read-only design planning or second opinions.
   - Use isolated worktrees for implementation; use read-only target repo context for audits.
   - Use screenshots, image paths, local URLs, browser notes, and repo rules as task context when useful.

6. Build the delegate prompt.
   - Use `references/delegate-prompt-contract.md`.
   - Include the plan slice, scope, product context, route, screenshots/URLs, acceptance criteria, allowed files, forbidden moves, and expected output label.
   - Tell Cline not to commit, push, deploy, edit secrets, inspect credentials, or run destructive commands.

7. Run Cline and capture evidence.
   - Prefer `scripts/run_cline_delegate.py` so logs and provenance are structured.
   - Save NDJSON logs under `~/.codex/cline-orchestrator/runs/`.
   - Extract actual provider/model from `run_result.model`; do not infer.

8. Recover interruptions through Codex.
   - Preserve logs, prompt, flags, worktree, changed files, and final text.
   - Classify the run as `salvageable`, `audit-only useful`, or `discard and restart`.
   - If salvageable, Codex takes over and verifies.
   - If audit-only useful, extract the insight and implement cleanly.
   - If discard/restart, refresh the plan, invoke the correct local skills, and re-run Cline only with a tighter prompt and `--thinking xhigh`.

9. Review, synthesize, and incorporate.
   - Compare Cline output against the Codex plan, repo conventions, design system, accessibility, performance, and data contracts.
   - Accept, adapt, or reject each meaningful contribution.
   - Run Codex-owned checks; Cline-reported checks are claims, not proof.
   - For frontend/UI work, inspect the real app/browser surface across relevant viewports.

10. Emit the provenance receipt.
   - Use `references/provenance-receipt.md`.
   - Include Cline/GLM use, provider/model, benchmark router freshness, stewardship/update state, skills/plugins used, mode, accepted/rejected output, interruption fallback, evidence path, and Codex verification.

## Acceptance Gate

This skill succeeds only when:

- Cline was used or deliberately skipped for a recorded reason.
- Update state, skills/plugins considered or used, and benchmark-router state are recorded.
- Actual provider/model and `--thinking xhigh` status are recorded for GLM runs.
- Cline output is reviewed and incorporated, adapted, or rejected by Codex.
- Interrupted work has a salvage/restart decision.
- Codex runs validation and captures target-perspective evidence.
- Final reporting clearly separates local validation, live verification, pushed/deployed status, blocked checks, and next action.
