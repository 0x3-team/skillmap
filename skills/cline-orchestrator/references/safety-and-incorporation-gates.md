# Safety And Incorporation Gates

## Stop Cline Immediately If It Attempts

- `git commit`, `git push`, publishing, deployments, or package releases without explicit scope.
- Credential/secret inspection.
- Database writes or migrations without explicit scope.
- `rm -rf`, `sudo`, destructive filesystem operations, or broad rewrites.
- Out-of-scope files or unrelated refactors.

## Interruption Fallback

When Cline is interrupted, times out, crashes, loses context, produces partial work, or exits ambiguously:

1. Preserve logs, prompt, flags, worktree, changed files, observed provider/model, and final text.
2. Re-anchor from live repo state and the Codex plan.
3. Classify the run:
   - `salvageable`: coherent, scoped, reviewable, and repairable without losing quality.
   - `audit-only useful`: implementation is not trustworthy, but critique/ideas are useful.
   - `discard and restart`: confused, low-quality, incompatible, or more costly to repair than redo.
4. Salvage only when quality can be preserved.
5. If restarting, invoke the correct Codex skills and rerun Cline only with a tighter prompt and `--thinking xhigh`.

## Incorporation

- Treat Cline output as a claim.
- Inspect diffs and new dependencies.
- Adapt useful ideas to repo patterns instead of copying blindly.
- Reject unsupported design taste that conflicts with product direction, accessibility, performance, architecture, or data contracts.
- Run Codex-owned tests/build/lint/smoke/browser checks.
- Record accepted, adapted, rejected, and unverified items.

