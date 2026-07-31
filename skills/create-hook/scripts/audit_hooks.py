#!/usr/bin/env python3
"""Read-only audit of Codex hook sources for a global or project scope."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any


HOOK_EVENTS = (
    "SessionStart",
    "SubagentStart",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "UserPromptSubmit",
    "SubagentStop",
    "Stop",
)


def load_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    if not path.exists():
        return None, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - diagnostic path
        return None, f"{type(exc).__name__}: {exc}"
    if not isinstance(data, dict):
        return None, "top-level JSON is not an object"
    return data, None


def inspect_config(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "exists": path.exists(),
        "features_hooks": "unspecified",
        "deprecated_codex_hooks": "absent",
        "inline_hook_events": [],
    }
    if not path.exists():
        return result

    text = path.read_text(encoding="utf-8")
    hooks_match = re.search(r"(?m)^\s*hooks\s*=\s*(true|false)\s*(?:#.*)?$", text)
    if hooks_match:
        result["features_hooks"] = hooks_match.group(1)

    codex_hooks_match = re.search(
        r"(?m)^\s*codex_hooks\s*=\s*(true|false)\s*(?:#.*)?$", text
    )
    if codex_hooks_match:
        result["deprecated_codex_hooks"] = codex_hooks_match.group(1)

    events: list[str] = []
    for event in HOOK_EVENTS:
        if re.search(rf"(?m)^\s*\[\[hooks\.{re.escape(event)}\]\]\s*$", text):
            events.append(event)
    result["inline_hook_events"] = events
    return result


def summarize_hooks_json(data: dict[str, Any] | None) -> dict[str, int]:
    if not data:
        return {}
    hooks = data.get("hooks")
    if not isinstance(hooks, dict):
        return {}
    summary: dict[str, int] = {}
    for event, groups in hooks.items():
        if isinstance(groups, list):
            summary[event] = len(groups)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=("global", "project"), required=True)
    parser.add_argument("--repo", help="Repository root for project scope")
    args = parser.parse_args()

    if args.scope == "global":
        root = Path.home() / ".codex"
    else:
        if not args.repo:
            parser.error("--repo is required for project scope")
        root = Path(args.repo).expanduser().resolve() / ".codex"

    hooks_json = root / "hooks.json"
    config_toml = root / "config.toml"
    hooks_dir = root / "hooks"

    data, json_error = load_json(hooks_json)
    config = inspect_config(config_toml)
    script_files = sorted(
        str(path.relative_to(hooks_dir))
        for path in hooks_dir.rglob("*")
        if path.is_file()
    ) if hooks_dir.exists() else []

    report = {
        "scope": args.scope,
        "root": str(root),
        "hooks_json": {
            "path": str(hooks_json),
            "exists": hooks_json.exists(),
            "error": json_error,
            "events": summarize_hooks_json(data),
        },
        "config_toml": {
            "path": str(config_toml),
            **config,
        },
        "hooks_dir": {
            "path": str(hooks_dir),
            "exists": hooks_dir.exists(),
            "files": script_files,
        },
        "warnings": [],
    }

    if hooks_json.exists() and config.get("inline_hook_events"):
        report["warnings"].append(
            "This layer has hooks.json and inline [hooks]; Codex will load both and warn."
        )
    if config.get("features_hooks") == "false":
        report["warnings"].append("Hooks are disabled with [features] hooks = false.")
    if config.get("deprecated_codex_hooks") != "absent":
        report["warnings"].append(
            "Deprecated codex_hooks feature key is present; use hooks instead."
        )

    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
