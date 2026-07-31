# Quality Gates

## Code Quality Gate

```text
Code quality gate:
- Existing patterns preserved:
- Duplication checked:
- Complexity/spaghetti risk:
- Tests added/updated:
- Validation run:
- Security/auth/data concerns:
- Remaining quality debt:
- Accepted risks:
```

## Required Standards

- Existing project patterns preserved.
- Clear names, boundaries, and ownership.
- Readable control flow.
- No spaghetti code.
- No duplicated business logic without explicit justification.
- No unexplained dead code.
- No unrelated refactors.
- No generated or temporary code left behind.
- No weakened tests, lint, typecheck, auth, validation, or security.
- Error handling is explicit.
- Data contracts and state ownership are clear.
- UI changes are browser-verified when relevant.

## Closeout Conditions

`checkpoint passed` requires:

- all in-scope P0/P1 findings fixed or invalidated by evidence
- required validation passed
- code quality gate completed
- local/browser/live/deploy/blocked states separated
- remaining risks accepted or out of scope

`checkpoint passed with accepted risks` requires named risks, owner/next action, and clear non-blocking rationale.

`checkpoint failed` means in-scope issues remain and are not blocked by external access.

`checkpoint blocked` means exact auth, env, data, live access, tooling, rate limit, or user decision prevents safe progress.

## No-Change Checkpoints

A checkpoint may close without code changes only when the implementation receipt states `no implementation performed` and the reason is evidence-backed:

- all candidate findings were invalidated by direct evidence
- remaining findings are out of the checkpoint contract
- remaining findings are explicitly accepted/deferred with owner and next action
- progress is blocked by exact access, auth, env, data, tooling, rate limit, or user decision

Do not use no-change closeout for "looks fine", "tests pass", "small issue", or "probably okay."

## Rationalizations To Reject

| Rationalization | Required response |
| --- | --- |
| "The user said it is probably fine." | Treat as pressure, not evidence. Run the checkpoint. |
| "Audit findings are obvious, so planning can be skipped." | Plan remediation unless the fix is tiny and obvious. |
| "Tests pass, so done." | Re-run the relevant audit/gate and code quality receipt. |
| "Local build passed, so production is ready." | Separate local validation from live/deploy readiness. |
| "This fix is small." | Still check duplication, patterns, and validation. |
| "Whole project can be one pass." | Decompose into lenses and consider workers. |
