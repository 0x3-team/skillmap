#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


RISK_PATTERNS = {
    "git_commit": re.compile(r"\bgit\s+commit\b", re.I),
    "git_push": re.compile(r"\bgit\s+push\b", re.I),
    "destructive_rm": re.compile(r"\brm\s+-[^\n]*r[f]?", re.I),
    "sudo": re.compile(r"\bsudo\b", re.I),
    "deploy": re.compile(r"\b(deploy|wrangler\s+deploy|vercel\s+deploy|netlify\s+deploy)\b", re.I),
    "secret_access": re.compile(r"\b(OPENAI_API_KEY|api[_-]?key|secret|password|token)\b", re.I),
}


def load_events(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    events: list[dict[str, Any]] = []
    invalid: list[str] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as exc:
            invalid.append(f"line {line_number}: {exc}")
            continue
        if isinstance(parsed, dict):
            events.append(parsed)
        else:
            invalid.append(f"line {line_number}: non-object JSON event")
    return events, invalid


def event_text(event: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("text", "message", "error", "hookEventName", "type"):
        value = event.get(key)
        if isinstance(value, str):
            parts.append(value)
    nested = event.get("event")
    if isinstance(nested, dict):
        for key in ("text", "message", "error", "type", "contentType"):
            value = nested.get(key)
            if isinstance(value, str):
                parts.append(value)
    return "\n".join(parts)


def summarize(events: list[dict[str, Any]], invalid: list[str], source: Path) -> dict[str, Any]:
    result_events = [event for event in events if event.get("type") == "run_result"]
    run_result = result_events[-1] if result_events else {}
    model = run_result.get("model") if isinstance(run_result.get("model"), dict) else {}
    usage = run_result.get("usage") or run_result.get("aggregateUsage") or {}
    final_text = run_result.get("text")

    event_types: dict[str, int] = {}
    tool_events = 0
    errors: list[str] = []
    risk_hits: dict[str, int] = {name: 0 for name in RISK_PATTERNS}

    for event in events:
        typ = str(event.get("type", "unknown"))
        event_types[typ] = event_types.get(typ, 0) + 1
        text = event_text(event)
        nested = event.get("event")
        nested_type = nested.get("type") if isinstance(nested, dict) else None
        combined_type = f"{typ} {nested_type or ''}".lower()
        if "tool" in combined_type:
            tool_events += 1
        if "error" in combined_type or event.get("error"):
            errors.append(text[:500] or json.dumps(event)[:500])
        for name, pattern in RISK_PATTERNS.items():
            if pattern.search(text):
                risk_hits[name] += 1

    risk_hits = {name: count for name, count in risk_hits.items() if count}
    status = "completed" if run_result.get("finishReason") == "completed" else "unknown"
    if errors or invalid:
        status = "attention"

    return {
        "source": str(source),
        "status": status,
        "event_count": len(events),
        "event_types": event_types,
        "invalid_lines": invalid,
        "finish_reason": run_result.get("finishReason"),
        "duration_ms": run_result.get("durationMs"),
        "iterations": run_result.get("iterations"),
        "provider": model.get("provider"),
        "model": model.get("id") or model.get("name"),
        "model_info": model.get("info") if isinstance(model.get("info"), dict) else None,
        "usage": usage,
        "tool_event_count": tool_events,
        "errors": errors[:10],
        "risk_hits": risk_hits,
        "final_text": final_text,
    }


def markdown(summary: dict[str, Any]) -> str:
    provider = summary.get("provider") or "unknown"
    model = summary.get("model") or "unknown"
    risk_hits = summary.get("risk_hits") or {}
    lines = [
        "Cline/GLM use: yes",
        f"Provider/model observed: {provider}/{model}",
        "Thinking: not visible",
        "Benchmark router: not recorded in NDJSON",
        "Cline stewardship: not recorded in NDJSON",
        "Mode: not recorded in NDJSON",
        f"Cline contribution: {str(summary.get('final_text') or '').strip()[:300] or 'no final text'}",
        "Accepted into project: pending Codex review",
        f"Rejected or adapted: risk hits {risk_hits}" if risk_hits else "Rejected or adapted: pending Codex review",
        "Interruption/fallback: none" if summary.get("finish_reason") == "completed" else "Interruption/fallback: review required",
        f"Evidence: {summary.get('source')}",
        "Codex verification: pending",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Path to Cline NDJSON log")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args()

    if not args.path.exists():
        print(f"missing NDJSON log: {args.path}", file=sys.stderr)
        return 2
    events, invalid = load_events(args.path)
    summary = summarize(events, invalid, args.path)
    if args.format == "json":
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print(markdown(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
