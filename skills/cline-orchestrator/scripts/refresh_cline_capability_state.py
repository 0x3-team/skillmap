#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


DESIGN_SKILL_HINTS = (
    "design",
    "frontend",
    "image-to-code",
    "imagegen",
    "interface",
    "ui",
    "ux",
    "visual",
    "stitch",
    "redesign",
)


def run(args: list[str], timeout: int = 60) -> dict[str, Any]:
    try:
        proc = subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError:
        return {"cmd": args, "returncode": 127, "stdout": "", "stderr": "command not found"}
    except subprocess.TimeoutExpired as exc:
        return {"cmd": args, "returncode": 124, "stdout": exc.stdout or "", "stderr": exc.stderr or "timeout"}
    return {
        "cmd": args,
        "returncode": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }


def parse_skill_json(text: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def summarize_skills(skills: list[dict[str, Any]]) -> dict[str, Any]:
    names = [str(skill.get("name")) for skill in skills if skill.get("name")]
    design = [name for name in names if any(hint in name.lower() for hint in DESIGN_SKILL_HINTS)]
    return {"count": len(names), "names": names, "design_relevant": design}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    parser.add_argument("--update", action="store_true", help="Run cline update --verbose")
    parser.add_argument("--install-skill", action="append", default=[], help="Trusted skill package to install for Cline")
    parser.add_argument("--global-skill", action="store_true", help="Install requested skill globally")
    parser.add_argument("--yes", action="store_true", help="Allow install-skill actions")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    cline_path = shutil.which("cline")
    result: dict[str, Any] = {"cline_path": cline_path, "actions": []}
    if not cline_path:
        result["error"] = "cline not found on PATH"
        print(json.dumps(result, indent=2, sort_keys=True))
        return 2

    version = run(["cline", "--version"], timeout=args.timeout)
    result["version"] = {
        "returncode": version["returncode"],
        "stdout": version["stdout"].strip(),
        "stderr": version["stderr"].strip(),
    }

    if args.update:
        update = run(["cline", "update", "--verbose"], timeout=max(args.timeout, 180))
        result["actions"].append({
            "action": "cline_update",
            "returncode": update["returncode"],
            "stdout_tail": update["stdout"][-2000:],
            "stderr_tail": update["stderr"][-2000:],
        })

    project_raw = run(["cline", "skill", "list", "--json"], timeout=args.timeout)
    global_raw = run(["cline", "skill", "list", "-g", "--json"], timeout=args.timeout)
    project_skills = parse_skill_json(project_raw["stdout"])
    global_skills = parse_skill_json(global_raw["stdout"])
    result["project_skills"] = summarize_skills(project_skills)
    result["global_skills"] = summarize_skills(global_skills)
    result["skill_list_status"] = {
        "project_returncode": project_raw["returncode"],
        "global_returncode": global_raw["returncode"],
    }

    for package in args.install_skill:
        if not args.yes:
            result["actions"].append({
                "action": "install_skill_skipped",
                "package": package,
                "reason": "pass --yes to allow installs",
            })
            continue
        cmd = ["cline", "skill", "add", package, "--agent", "cline"]
        if args.global_skill:
            cmd.insert(3, "-g")
        install = run(cmd, timeout=max(args.timeout, 180))
        result["actions"].append({
            "action": "install_skill",
            "package": package,
            "returncode": install["returncode"],
            "stdout_tail": install["stdout"][-2000:],
            "stderr_tail": install["stderr"][-2000:],
        })

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"Cline: {cline_path} {result['version']['stdout']}")
        print(f"Project skills: {result['project_skills']['count']}")
        print(f"Global skills: {result['global_skills']['count']}")
        if result["global_skills"]["design_relevant"]:
            print("Design-relevant global skills: " + ", ".join(result["global_skills"]["design_relevant"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
