#!/usr/bin/env python3
"""Smoke-test the local Obscura MCP stdio server.

This verifies the real MCP path Codex uses: initialize, tools/list,
browser_navigate, and browser_snapshot.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-test Obscura MCP over stdio")
    parser.add_argument("--obscura", default="/Users/stevmq/.cargo/bin/obscura")
    parser.add_argument("--url", default="https://example.com")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--allow-private-network", action="store_true")
    parser.add_argument("--stealth", action="store_true")
    return parser.parse_args()


def request(proc: subprocess.Popen[str], method: str, params: dict[str, Any] | None, ident: int, timeout: float) -> dict[str, Any]:
    assert proc.stdin is not None
    assert proc.stdout is not None
    message: dict[str, Any] = {"jsonrpc": "2.0", "id": ident, "method": method}
    if params is not None:
        message["params"] = params
    proc.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
    proc.stdin.flush()

    deadline = time.time() + timeout
    while time.time() < deadline:
        line = proc.stdout.readline()
        if line:
            return json.loads(line)
        time.sleep(0.05)
    raise TimeoutError(f"timed out waiting for {method}")


def text_from_tool_result(result: dict[str, Any]) -> str:
    content = result.get("result", {}).get("content", [])
    if not content:
        return ""
    first = content[0]
    if isinstance(first, dict):
        return str(first.get("text", ""))
    return str(first)


def main() -> int:
    args = parse_args()
    cmd = [args.obscura, "mcp"]
    if args.allow_private_network:
        cmd.append("--allow-private-network")
    if args.stealth:
        cmd.append("--stealth")

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    try:
        init = request(
            proc,
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "obscura-skill-smoke", "version": "1.0"},
            },
            1,
            args.timeout,
        )
        tools = request(proc, "tools/list", {}, 2, args.timeout)
        nav = request(
            proc,
            "tools/call",
            {"name": "browser_navigate", "arguments": {"url": args.url, "waitUntil": "domcontentloaded"}},
            3,
            args.timeout,
        )
        snap = request(proc, "tools/call", {"name": "browser_snapshot", "arguments": {}}, 4, args.timeout)

        tool_names = [tool.get("name", "") for tool in tools.get("result", {}).get("tools", [])]
        snapshot = text_from_tool_result(snap)
        summary = {
            "ok": "error" not in init and "error" not in tools and "error" not in nav and "error" not in snap,
            "server": init.get("result", {}).get("serverInfo"),
            "tool_count": len(tool_names),
            "tools_sample": tool_names[:12],
            "navigate_error": nav.get("error"),
            "snapshot_preview": snapshot[:400],
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0 if summary["ok"] and summary["tool_count"] > 0 and snapshot else 1
    finally:
        if proc.stdin:
            try:
                proc.stdin.close()
            except BrokenPipeError:
                pass
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
