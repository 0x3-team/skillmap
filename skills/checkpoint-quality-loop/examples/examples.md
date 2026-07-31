# Checkpoint Quality Loop Examples

## UI/UX Checkpoint

User: "Checkpoint UI/UX before we continue."

Expected route:

- Create/reuse goal.
- Lens: `ui-ux`.
- Use `audit-orchestrator` plus `frontend-design`.
- Use browser evidence when feasible.
- Plan confirmed findings before implementation.
- Verify with browser and code quality receipts.

## Whole-Project Checkpoint

User: "Checkpoint the whole thing like this is going to OpenAI production."

Expected route:

- Create/reuse goal.
- Lens: `whole-project`.
- Decompose into independent lenses.
- Emit orchestration decision and consider 2-5 workers.
- Audit before planning; implement from plan; re-verify before closeout.

## Security Checkpoint With Remediation

User: "Checkpoint security and fix anything serious."

Expected route:

- Create/reuse goal.
- Lens: `security`.
- Audit first and freeze confirmed findings.
- Plan remediation before changes unless tiny and obvious.
- Verify auth/security/data behavior and do not overclaim live coverage.

## Production Readiness Checkpoint

User: "Checkpoint before deploy."

Expected route:

- Create/reuse goal.
- Lens: `production-readiness`.
- Use `production-readiness-gate`.
- Separate validated locally, verified live, pushed/deployed, and blocked.
- Require exact next deploy/manual actions.

## Lightweight Read-Only Exception

User: "Give me a quick read-only checkpoint summary only."

Expected route:

- No goal required.
- Label verdict `lightweight checkpoint only`.
- Do not implement.
- State that full checkpoint loop was not run.

