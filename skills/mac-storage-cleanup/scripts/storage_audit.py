#!/usr/bin/env python3
"""Read-only macOS storage audit for Codex cleanup proposals."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
from typing import Iterable


HOME = Path.home()
DEFAULT_OUTPUT = Path("/private/tmp/mac-storage-audit")


BASE_CATEGORIES = [
    ("trash", [HOME / ".Trash"], "low"),
    ("downloads", [HOME / "Downloads"], "medium"),
    ("user-caches", [HOME / "Library" / "Caches"], "low"),
    ("user-logs", [HOME / "Library" / "Logs"], "low"),
    ("xcode-derived-data", [HOME / "Library" / "Developer" / "Xcode" / "DerivedData"], "low"),
    ("xcode-simulators", [HOME / "Library" / "Developer" / "CoreSimulator" / "Devices"], "medium"),
    ("npm-cache", [HOME / ".npm"], "low"),
    ("pnpm-store", [HOME / ".pnpm-store"], "low"),
    ("yarn-cache", [HOME / ".yarn"], "low"),
    ("general-cache", [HOME / ".cache"], "low"),
    ("cargo-cache", [HOME / ".cargo" / "registry", HOME / ".cargo" / "git"], "low"),
    ("go-mod-cache", [HOME / "go" / "pkg" / "mod"], "low"),
]


FULL_CATEGORIES = [
    ("system-caches", [Path("/Library/Caches")], "low"),
    ("system-logs", [Path("/Library/Logs")], "low"),
    ("temp-folders", [Path("/private/var/folders")], "medium"),
]


LARGE_FILE_ROOTS = [
    HOME / "Downloads",
    HOME / "Desktop",
    HOME / "Movies",
    HOME / "Documents",
]


GENERATED_DIR_NAMES = {
    ".next",
    ".nuxt",
    ".parcel-cache",
    ".pytest_cache",
    ".ruff_cache",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
}


EXCLUDED_PARTS = {
    ".codex",
    "Library/Mobile Documents",
    "Library/Photos",
    "Pictures/Photos Library.photoslibrary",
}


def human_size(num: int) -> str:
    value = float(num)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{num} B"


def is_excluded(path: Path) -> bool:
    text = str(path)
    return any(part in text for part in EXCLUDED_PARTS)


def dir_size(path: Path) -> int:
    total = 0
    for root, dirs, files in os.walk(path, topdown=True, onerror=lambda _: None):
        root_path = Path(root)
        dirs[:] = [d for d in dirs if not is_excluded(root_path / d)]
        for name in files:
            file_path = root_path / name
            if is_excluded(file_path):
                continue
            try:
                total += file_path.stat().st_size
            except OSError:
                continue
    return total


def child_sizes(path: Path, category: str, risk: str) -> list[dict]:
    rows = []
    if not path.exists() or is_excluded(path):
        return rows
    try:
        children = list(path.iterdir())
    except OSError:
        children = []
    for child in children:
        if is_excluded(child):
            continue
        try:
            size = dir_size(child) if child.is_dir() else child.stat().st_size
        except OSError:
            continue
        if size <= 0:
            continue
        rows.append(
            {
                "path": str(child),
                "size_bytes": size,
                "size": human_size(size),
                "category": category,
                "risk": risk,
            }
        )
    return rows


def large_files(min_bytes: int) -> list[dict]:
    rows = []
    for root in LARGE_FILE_ROOTS:
        if not root.exists():
            continue
        for current, dirs, files in os.walk(root, topdown=True, onerror=lambda _: None):
            current_path = Path(current)
            dirs[:] = [d for d in dirs if not is_excluded(current_path / d)]
            for name in files:
                path = current_path / name
                if is_excluded(path):
                    continue
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                if size >= min_bytes:
                    rows.append(
                        {
                            "path": str(path),
                            "size_bytes": size,
                            "size": human_size(size),
                            "category": "large-file",
                            "risk": "medium",
                        }
                    )
    return rows


def generated_dirs(search_roots: list[Path]) -> list[dict]:
    rows = []
    ignored = {"Library", "Applications", "Pictures", "Movies", ".Trash"}
    for root in search_roots:
        if not root.exists():
            continue
        for current, dirs, _files in os.walk(root, topdown=True, onerror=lambda _: None):
            current_path = Path(current)
            if is_excluded(current_path):
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs if d not in ignored and not is_excluded(current_path / d)]
            matched = [d for d in dirs if d in GENERATED_DIR_NAMES]
            for name in matched:
                path = current_path / name
                try:
                    size = dir_size(path)
                except OSError:
                    continue
                if size <= 0:
                    continue
                rows.append(
                    {
                        "path": str(path),
                        "size_bytes": size,
                        "size": human_size(size),
                        "category": "generated-project-dir",
                        "risk": "medium" if name == "node_modules" else "low",
                    }
                )
            dirs[:] = [d for d in dirs if d not in GENERATED_DIR_NAMES]
    return rows


def docker_summary() -> list[str]:
    try:
        result = subprocess.run(
            ["docker", "system", "df"],
            check=False,
            capture_output=True,
            text=True,
            timeout=8,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return [line.rstrip() for line in result.stdout.splitlines() if line.strip()]


def disk_free() -> str:
    try:
        result = subprocess.run(["df", "-h", "/"], check=False, capture_output=True, text=True)
    except FileNotFoundError:
        return ""
    return result.stdout.strip()


def audit(scope: str, min_large_file_bytes: int) -> dict:
    candidates = []
    categories = list(BASE_CATEGORIES)
    if scope == "full":
        categories.extend(FULL_CATEGORIES)

    for category, paths, risk in categories:
        for path in paths:
            candidates.extend(child_sizes(path, category, risk))

    candidates.extend(large_files(min_large_file_bytes))
    candidates.extend(generated_dirs([HOME / "Documents", HOME / "Desktop", HOME / "Downloads"]))
    candidates.sort(key=lambda item: item["size_bytes"], reverse=True)

    return {
        "scope": scope,
        "home": str(HOME),
        "disk": disk_free(),
        "docker_system_df": docker_summary(),
        "candidates": candidates,
        "totals": totals(candidates),
        "excluded_patterns": sorted(EXCLUDED_PARTS),
    }


def totals(candidates: Iterable[dict]) -> dict:
    by_risk: dict[str, int] = {}
    for item in candidates:
        by_risk[item["risk"]] = by_risk.get(item["risk"], 0) + int(item["size_bytes"])
    return {risk: {"bytes": size, "size": human_size(size)} for risk, size in sorted(by_risk.items())}


def write_markdown(report: dict, output_path: Path) -> None:
    lines = [
        "# Mac Storage Audit",
        "",
        "Read-only report. Nothing was deleted or modified.",
        "",
        "## Disk",
        "",
        "```",
        report["disk"] or "df output unavailable",
        "```",
        "",
        "## Reclaimable Candidates by Risk",
        "",
    ]
    for risk, data in report["totals"].items():
        lines.append(f"- {risk}: {data['size']}")

    lines.extend(["", "## Top Candidates", ""])
    for item in report["candidates"][:50]:
        lines.append(f"- {item['size']} | {item['risk']} | {item['category']} | `{item['path']}`")

    if report["docker_system_df"]:
        lines.extend(["", "## Docker", "", "```"])
        lines.extend(report["docker_system_df"])
        lines.append("```")

    lines.extend(["", "## Excluded Patterns", ""])
    for pattern in report["excluded_patterns"]:
        lines.append(f"- `{pattern}`")

    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only macOS storage audit.")
    parser.add_argument("--scope", choices=["home", "full"], default="home")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--min-large-file-mb", type=int, default=500)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    min_large_file_bytes = args.min_large_file_mb * 1024 * 1024
    report = audit(args.scope, min_large_file_bytes)

    json_path = args.output / "storage-audit.json"
    md_path = args.output / "storage-audit.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    write_markdown(report, md_path)

    print(f"Wrote {md_path}")
    print(f"Wrote {json_path}")
    for risk, data in report["totals"].items():
        print(f"{risk}: {data['size']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
