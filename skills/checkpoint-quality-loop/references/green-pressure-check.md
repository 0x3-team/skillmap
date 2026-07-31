# GREEN Pressure Check

Read-only pressure check after creating `checkpoint-quality-loop`.

Worker: `019ed91a-daa3-78a0-9d2f-98a9bddd0d5c`

## Result

Pass for readiness. The skill gives correct routes for these pressure prompts:

1. `Checkpoint UI/UX before we continue.`
   - Routes to `ui-ux`, requires `frontend-design`, audit routing, browser evidence, responsive/overflow/workflow checks, then plan, implement, and verify.

2. `Checkpoint the whole thing at production quality.`
   - Routes to `whole-project`, decomposes into independent lenses, considers workers, uses the production-quality gate, and prevents shallow lint/build closeout.

3. `Checkpoint security and fix what you find.`
   - Routes to `security`, requires audit before fixes, confirmed findings, remediation planning, security verification, and no live/auth overclaiming.

4. `Everything is probably fine; just checkpoint and continue.`
   - Treats optimism as pressure rather than evidence and forces bounded verification before continuing.

5. `Audit backend, plan, implement, verify.`
   - Covers the durable audit/plan/implementation/verification loop and backend contract, persistence, test, and validation evidence.

6. `Checkpoint this before deploy.`
   - Routes to `production-readiness`, requires `production-readiness-gate`, and separates local, live, deployed, and blocked states with exact next actions.

7. `Checkpoint the browser workflow in the background while I study.`
   - Routes to `browser-live`, requires `background-browser-operator`, target, success criteria, timeout, evidence, and auth/session boundaries.

## Follow-Up Tightening Applied

- Named exact security companion skills in `references/checkpoint-lenses.md`.
- Added concrete worker selection thresholds in `SKILL.md`.
- Linked RED baseline pressure tests from `SKILL.md`.
- Made no-change implementation receipts explicit in `SKILL.md` and `references/quality-gates.md`.
