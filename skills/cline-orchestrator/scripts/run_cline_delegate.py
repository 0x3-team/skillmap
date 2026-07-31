#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parents[1]
RUN_ROOT = Path.home() / ".codex" / "cline-orchestrator" / "runs"
SUMMARY_SCRIPT = SKILL_DIR / "scripts" / "summarize_cline_ndjson.py"


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip().lower()).strip("-")
    return cleaned[:60].strip("-._") or "cline-task"


def run(args: list[str], cwd: Path | None = None, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=str(cwd) if cwd else None, text=True, capture_output=True, timeout=timeout, check=False)


def maybe_create_worktree(repo: Path, slug: str, mode: str, no_worktree: bool) -> tuple[Path, str | None, list[str]]:
    if mode != "implement" or no_worktree:
        return repo, None, []
    parent = repo.parent
    worktree = parent / f".cline-delegate-{slug}"
    branch = f"codex/cline-{slug}"
    cmd = ["git", "worktree", "add", str(worktree), "-b", branch, "HEAD"]
    proc = run(cmd, cwd=repo, timeout=120)
    notes = [f"$ {' '.join(cmd)}", proc.stdout.strip(), proc.stderr.strip()]
    if proc.returncode != 0:
        raise RuntimeError("\n".join(part for part in notes if part))
    return worktree, branch, notes


def build_prompt(args: argparse.Namespace) -> str:
    pieces = [
        "You are Cline running as a child specialist for Codex.",
        "Codex remains project owner, integrator, and final verifier.",
        f"Mode: {args.mode}",
        f"Task: {args.task}",
        "Rules: do not commit, push, deploy, publish, inspect secrets, edit credentials, run destructive commands, or broaden scope.",
        "Read local repo instructions before editing or auditing.",
        "For GLM 5.2, operate at maximum reasoning.",
        "End with: output label, changed files or findings, design rationale, checks run, integration assumptions, risks/blockers.",
    ]
    if args.plan_slice:
        pieces.append(f"Plan slice:\n{args.plan_slice}")
    if args.allowed:
        pieces.append("Allowed files/areas: " + ", ".join(args.allowed))
    if args.context:
        pieces.append("Additional context:\n" + "\n".join(args.context))
    return "\n\n".join(pieces)


def parse_summary(log_path: Path) -> dict[str, Any]:
    proc = run([sys.executable, str(SUMMARY_SCRIPT), str(log_path)], timeout=60)
    if proc.returncode != 0:
        return {"summary_error": proc.stderr.strip(), "returncode": proc.returncode}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return {"summary_error": str(exc), "raw": proc.stdout[-1000:]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--mode", choices=("implement", "audit", "design-pass", "plan-critique", "review"), default="audit")
    parser.add_argument("--slug", default=None)
    parser.add_argument("--plan-slice", default="")
    parser.add_argument("--context", action="append", default=[])
    parser.add_argument("--allowed", action="append", default=[])
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--provider", default="cline")
    parser.add_argument("--model", default="zai/glm-5.2")
    parser.add_argument("--thinking", default="xhigh")
    parser.add_argument("--auto-approve", choices=("true", "false"), default="false")
    parser.add_argument("--no-worktree", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    repo = args.repo.expanduser().resolve()
    if not repo.exists():
        print(f"repo does not exist: {repo}", file=sys.stderr)
        return 2
    cline = shutil.which("cline")
    if not cline:
        print("cline not found on PATH", file=sys.stderr)
        return 2

    if "glm-5.2" in args.model.lower() and args.thinking != "xhigh":
        print("GLM 5.2 delegation must use --thinking xhigh", file=sys.stderr)
        return 2

    slug = slugify(args.slug or args.task)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = RUN_ROOT / f"{timestamp}-{slug}"
    log_path = run_dir / "cline.ndjson"
    run_dir.mkdir(parents=True, exist_ok=True)

    worktree_notes: list[str] = []
    try:
        cwd, branch, worktree_notes = maybe_create_worktree(repo, slug, args.mode, args.no_worktree or args.dry_run)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    prompt = build_prompt(args)
    command = [
        cline,
        "--json",
        "-P",
        args.provider,
        "-m",
        args.model,
        "--thinking",
        args.thinking,
        "--timeout",
        str(args.timeout),
        "--auto-approve",
        args.auto_approve,
        "--cwd",
        str(cwd),
        prompt,
    ]

    metadata: dict[str, Any] = {
        "repo": str(repo),
        "cwd": str(cwd),
        "branch": branch,
        "mode": args.mode,
        "provider_requested": args.provider,
        "model_requested": args.model,
        "thinking_requested": args.thinking,
        "auto_approve": args.auto_approve,
        "timeout": args.timeout,
        "log_path": str(log_path),
        "run_dir": str(run_dir),
        "worktree_notes": [note for note in worktree_notes if note],
        "command_preview": command[:-1] + ["<delegate_prompt>"],
    }

    (run_dir / "prompt.txt").write_text(prompt + "\n", encoding="utf-8")
    (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    if args.dry_run:
        metadata["dry_run"] = True
        if args.json:
            print(json.dumps(metadata, indent=2, sort_keys=True))
        else:
            print(f"Dry run. Metadata: {run_dir / 'metadata.json'}")
            print(" ".join(command[:-1] + ["<delegate_prompt>"]))
        return 0

    with log_path.open("w", encoding="utf-8") as log:
        proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert proc.stdout is not None
        for line in proc.stdout:
            print(line, end="")
            log.write(line)
        stderr = proc.stderr.read() if proc.stderr else ""
        returncode = proc.wait(timeout=args.timeout + 30)

    metadata["returncode"] = returncode
    metadata["stderr_tail"] = stderr[-4000:]
    summary = parse_summary(log_path) if log_path.exists() else {"summary_error": "missing log"}
    metadata["summary"] = summary
    (run_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    if args.json:
        print(json.dumps(metadata, indent=2, sort_keys=True))
    elif returncode != 0:
        print(stderr[-2000:], file=sys.stderr)
    return returncode


if __name__ == "__main__":
    raise SystemExit(main())
