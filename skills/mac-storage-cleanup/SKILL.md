---
name: mac-storage-cleanup
description: Find wasted disk space on macOS and propose cleanup candidates. Use when the user asks Codex to scan a Mac/MacBook for useless files, wasted storage, large caches, logs, downloads, build artifacts, Xcode simulator data, Docker/container leftovers, package-manager caches, node_modules, duplicate archives, old installers, or to free disk space. Always run read-only analysis first and ask explicit permission before deleting or moving anything.
---

# Mac Storage Cleanup

## Core Rule

Never delete, move, truncate, or modify files during the first pass. Start with a read-only audit, produce a ranked report, explain risk, and ask the user which cleanup actions to approve.

Use `scripts/storage_audit.py` for the read-only scan when available. Read `references/safety.md` before proposing deletion if the user wants to clean anything.

## Workflow

1. Confirm scope if unclear: home folder only, whole Mac, or specific paths.
2. Run a read-only audit. Prefer:

```bash
python3 /Users/francescomistero/.codex/skills/mac-storage-cleanup/scripts/storage_audit.py --scope home --output /private/tmp/mac-storage-audit
```

Use `--scope full` only if the user asked for a full Mac scan and approves commands that may read broader system paths.

3. Review the generated Markdown and JSON reports.
4. Group candidates by safety:
   - Low risk: app caches, package caches, temporary build folders, old logs, Trash, downloaded installers, duplicate archives where newer copies exist.
   - Medium risk: old downloads, large media exports, project build artifacts, `node_modules`, Python/Go/Rust build caches, Docker images/volumes, Xcode derived data and simulator runtimes.
   - Protected: Codex history/logs, user documents/photos, keychains, mail databases, iCloud library internals, application support databases, source repositories unless the user explicitly names them.
5. Ask for explicit approval with exact paths and estimated space before cleanup.
6. Prefer moving user-visible files to Trash over permanent deletion. For generated caches and build artifacts, deletion is acceptable only after approval.
7. After cleanup, re-check free space with `df -h /` and summarize reclaimed space.

## Report Requirements

Return a concise storage report with:

- Total likely reclaimable storage, split by low/medium/high risk.
- Top 20 largest candidates with path, size, category, and recommendation.
- Commands proposed for cleanup, but do not execute them until the user approves.
- Items intentionally excluded and why.

Use absolute paths in all cleanup proposals.

## Deletion Approval

The user must approve deletion after seeing the exact candidate list. Treat broad language like "clean it" as approval only for low-risk items already shown in the report. Ask again before touching medium-risk or protected paths.

When approval is given:

- Use shell commands with the smallest path set possible.
- Avoid wildcards unless the expanded paths were listed in the report.
- Do not use `sudo` unless the user explicitly asks and the target is clearly safe.
- Never run `rm -rf /`, `rm -rf ~`, or commands built from unreviewed variables.
- If the environment requires elevated permissions, request escalation with a clear justification.

## Useful Commands

Read-only inspection:

```bash
df -h /
du -xhd 1 "$HOME" 2>/dev/null | sort -h
find "$HOME/Downloads" -type f -size +500M -print
```

Common macOS cleanup targets to inspect:

- `~/.Trash`
- `~/Downloads`
- `~/Library/Caches`
- `~/Library/Logs`
- `~/Library/Developer/Xcode/DerivedData`
- `~/Library/Developer/CoreSimulator/Devices`
- `~/Library/Containers`
- `~/.npm`, `~/.pnpm-store`, `~/.yarn`, `~/.cache`, `~/.cargo`, `~/go/pkg/mod`
- Docker data via `docker system df` if Docker is installed

## Boundaries

This skill is for storage triage and cleanup suggestions. It is not a malware scanner, backup tool, or duplicate-photo manager. Recommend backups before deleting personal files or anything outside cache/build/temp categories.
