---
name: unknown-diff-commit-gate
description: Review an ambiguous dirty git worktree before committing. Use when the user says changes may or may not be worthy, asks to inspect uncommitted work, commit only good changes, separate user/concurrent edits, or decide whether local diffs are safe. Do not use when the user already specified an exact commit scope.
---

# Unknown Diff Commit Gate

## Purpose

Protect the repo from accidental commits by reviewing dirty work as evidence first. Commit only the validated, intentional set when the user asked for that; leave unrelated or newly appearing changes untouched and reported.

## Required Inputs

- A git repo with uncommitted changes.
- User intent for the dirty work: review only, commit if worthy, split commits, or reject/defer.

## Workflow

1. Freeze the starting state.
   - Run `git status --short --branch`.
   - Capture changed file list with `git diff --name-status` and staged state with `git diff --cached --name-status`.
   - Do not reset, checkout, clean, or overwrite files.

2. Classify each change.
   - `intended`: clearly supports the user's requested goal.
   - `possibly useful`: needs validation or explanation.
   - `unrelated/user-owned`: likely from the user or another agent; do not touch.
   - `generated/noise`: build artifacts, caches, stale generated files, or accidental churn.

3. Validate the intended set.
   - Read the actual diffs, not only filenames.
   - Check schema/data contracts when code expects new columns, tables, env vars, routes, or APIs.
   - Run the smallest meaningful checks: typecheck, lint, tests, build, migrations dry run, browser smoke, or live read-only validation when required.
   - If generated files are stale, run the normal generation/build command before judging type errors.

4. Decide commit scope.
   - If all reviewed changes are coherent and verified, commit them with a clear message when requested.
   - If the worktree changed during validation, re-run `git status`; leave new/concurrent changes out unless reviewed.
   - If only part of the diff is valid, stage only that subset non-interactively and report the rest.

5. Report without overclaiming.
   - Separate reviewed-and-committed files from left-uncommitted files.
   - Say exactly which checks passed, failed, or were blocked.

## Output Format

- `Verdict`: commit, partial commit, do not commit, or review-only.
- `Committed`: commit hash and file scope, if committed.
- `Left uncommitted`: files and why.
- `Validation`: commands/checks and results.
- `Risks/blockers`: schema, generated files, env vars, live access, or concurrent changes.

## Validation Checklist

- Starting and ending `git status` inspected.
- No unrelated user/concurrent changes reverted.
- Commit scope matches files actually reviewed.
- Live schema or migration compatibility checked when relevant.
- The final answer does not imply unreviewed files are safe.

## Common Mistakes

- Committing everything because the diff "looks related."
- Mixing a later refactor batch into the already validated set.
- Treating stale generated type files as source bugs without regenerating through the normal build path.
- Accepting code that depends on unapplied database migrations.

## Good Trigger Prompts

- "Read through these changes. If they are worthy, commit them."
- "I changed some stuff myself; inspect it and continue safely."
- "Tell me whether this dirty worktree is good or should be discarded."
- "Commit only the validated changes and leave the rest."
