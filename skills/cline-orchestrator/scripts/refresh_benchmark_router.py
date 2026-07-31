#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


DEFAULT_CACHE = Path.home() / ".codex" / "cline-orchestrator" / "benchmark-router.json"
SOURCES = [
    "https://notes.designarena.ai/how-glm-5-2-beat-fable-5-at-website-design/",
    "https://designarena.ai/leaderboard/code",
    "https://www.swebench.com/",
    "https://terminal-bench.com/",
]


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def stale_after(now_iso: str) -> str:
    now = datetime.fromisoformat(now_iso)
    return (now + timedelta(days=7)).replace(microsecond=0).isoformat()


def is_stale(data: dict[str, Any]) -> bool:
    value = data.get("stale_after")
    if not isinstance(value, str):
        return True
    try:
        return datetime.now(timezone.utc) >= datetime.fromisoformat(value)
    except ValueError:
        return True


def check_sources(timeout: int, offline: bool) -> list[dict[str, Any]]:
    checked: list[dict[str, Any]] = []
    for url in SOURCES:
        if offline:
            checked.append({"url": url, "status": "not_checked_offline"})
            continue
        try:
            request = Request(url, headers={"User-Agent": "codex-cline-orchestrator/1.0"})
            with urlopen(request, timeout=timeout) as response:
                checked.append({"url": url, "status": response.status})
        except (HTTPError, URLError, TimeoutError) as exc:
            checked.append({"url": url, "status": "error", "error": str(exc)[:200]})
    return checked


def build_router(offline: bool, timeout: int) -> dict[str, Any]:
    retrieved_at = iso_now()
    return {
        "retrieved_at": retrieved_at,
        "stale_after": stale_after(retrieved_at),
        "policy": "Delegate to Cline only when a Cline-accessible model is materially stronger and Codex can supervise, review, incorporate, and verify the output.",
        "sources_checked": check_sources(timeout=timeout, offline=offline),
        "routes": [
            {
                "task_class": "ui_ux_design_visual_implementation",
                "preferred_agent": "cline",
                "preferred_model": "zai/glm-5.2",
                "required_flags": ["--json", "--thinking", "xhigh", "-P", "cline", "-m", "zai/glm-5.2"],
                "reason": "Design Arena evidence indicates GLM 5.2 leads the Website/Web Dev single-turn HTML slice; use only for design/UI-adjacent work until refreshed evidence expands scope.",
                "source": "Design Arena / Design Arena notes",
                "caveats": "Category-specific evidence; not a blanket coding or product-ops claim.",
            },
            {
                "task_class": "general_repo_implementation",
                "preferred_agent": "codex",
                "preferred_model": "codex",
                "required_flags": [],
                "reason": "No current router evidence in this cache says Cline is materially stronger for general repo implementation.",
                "source": "default policy",
                "caveats": "Refresh coding-agent benchmarks before changing this route.",
            },
            {
                "task_class": "browser_product_operations",
                "preferred_agent": "codex",
                "preferred_model": "codex",
                "required_flags": [],
                "reason": "Use Cline only if task-specific browser/web-agent benchmark evidence is fresh and relevant.",
                "source": "default policy",
                "caveats": "Live/browser/account workflows need stricter supervision and permissions.",
            },
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--refresh", action="store_true", help="Refresh the cache")
    parser.add_argument("--offline", action="store_true", help="Do not fetch sources")
    parser.add_argument("--timeout", type=int, default=10)
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()

    args.cache.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] | None = None
    if args.cache.exists() and not args.refresh:
        data = json.loads(args.cache.read_text(encoding="utf-8"))
        if is_stale(data):
            data["stale"] = True
        else:
            data["stale"] = False
    else:
        data = build_router(offline=args.offline, timeout=args.timeout)
        data["stale"] = False
        args.cache.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    if args.json:
        print(json.dumps(data, indent=2, sort_keys=True))
    else:
        print(f"Benchmark router: {'stale' if data.get('stale') else 'fresh'}")
        print(f"Cache: {args.cache}")
        for route in data.get("routes", []):
            print(f"- {route['task_class']}: {route['preferred_agent']} / {route['preferred_model']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
