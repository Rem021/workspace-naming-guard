#!/usr/bin/env python3
"""Forward exact native-chat titles through Orca's supported CLI/plugin request APIs.

No private Orca files, database access, network, shell command interpolation or agent input.
The plugin alone decides whether a title may rename a workspace.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time

LABEL = "dev.rem021.workspace-naming-guard.title-bridge"
DEFAULT_PLUGIN = "local.workspace-naming-guard"


def workspace_id(row: dict) -> str | None:
    address = row.get("address") or {}
    if address.get("environment") != "local":
        return None
    value = address.get("worktree", "")
    if not isinstance(value, str):
        return None
    if value.startswith("id:"):
        value = value[3:]
    elif not value.startswith(("identity:", "folder:")):
        return None
    return value if value and len(value) <= 1024 else None


def observations(snapshot: dict) -> list[dict]:
    if snapshot.get("ok") is not True:
        raise ValueError("workspace_snapshot_failed")
    result = snapshot.get("result", {})
    rows = result.get("worktrees")
    if not isinstance(rows, list) or result.get("truncated"):
        raise ValueError("workspace_snapshot_incomplete")
    counts = collections.Counter(workspace_id(row) for row in rows)
    output = []
    for row in rows:
        key = workspace_id(row)
        if not key or counts[key] != 1:
            continue
        candidates = []
        for agent in row.get("agents", []):
            if agent.get("parentPaneKey"):
                continue
            source = agent.get("paneKey")
            title = agent.get("conversationName") or agent.get("displayName") or agent.get("taskTitle")
            if not isinstance(source, str) or not source or len(source) > 1024:
                continue
            if not isinstance(title, str) or not title.strip() or len(title) > 512:
                continue
            # Never substitute a prompt, assistant message, path, or another workspace's title.
            at = agent.get("stateStartedAt", 0)
            candidates.append((at if isinstance(at, (int, float)) else 0, source, title.strip()))
        if candidates:
            _, source, title = max(candidates)
            output.append({"id": key, "title": title, "sourceKey": source})
    # The plugin API caps workspace.list at 500 too. Refuse a partial observation batch.
    if len(output) > 500:
        raise ValueError("too_many_workspace_titles")
    return output


def cli_json(cli: str, args: list[str]) -> dict:
    run = subprocess.run([cli, *args, "--environment", "local", "--json"],
                         capture_output=True, text=True, timeout=45, check=False)
    if run.returncode:
        # CLI errors may contain private titles/paths; do not log their raw output.
        raise RuntimeError("orca_command_failed")
    answer = json.loads(run.stdout)
    if answer.get("ok") is not True:
        raise RuntimeError("orca_request_failed")
    return answer


def sync(cli: str, plugin: str) -> dict:
    titles = observations(cli_json(cli, ["worktree", "ps", "--limit", "10000"]))
    answer = cli_json(cli, ["plugin", "dev", "request", plugin, "naming.observeTitles",
                            "--data", json.dumps({"titles": titles}, ensure_ascii=False)])
    view = answer.get("result", {}).get("result", {})
    if view.get("titleSource") != "connected":
        raise RuntimeError("title_source_not_acknowledged")
    return {"titles": len(titles), "status": view.get("status"), "counts": view.get("counts")}


def install(cli: str, plugin: str) -> None:
    if sys.platform != "darwin":
        raise RuntimeError("launch_agent_requires_macos")
    # Confirm the intended plugin accepts the protocol before installing a background job.
    sync(cli, plugin)
    directory = Path.home() / "Library/Application Support/Workspace Naming Guard"
    directory.mkdir(parents=True, exist_ok=True)
    script = directory / "title_bridge.py"
    shutil.copy2(__file__, script)
    plist = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    plist.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(script), "--orca", cli, "--plugin", plugin, "--watch"],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "ProcessType": "Background",
        "StandardOutPath": str(directory / "bridge.log"),
        "StandardErrorPath": str(directory / "bridge-error.log"),
    }
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{LABEL}"], capture_output=True, check=False)
    with plist.open("wb") as handle:
        plistlib.dump(data, handle)
    subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
    print(json.dumps({"installed": True, "label": LABEL}))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orca", default=shutil.which("orca"))
    parser.add_argument("--plugin", default=DEFAULT_PLUGIN)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--watch", action="store_true")
    mode.add_argument("--install", action="store_true")
    args = parser.parse_args()
    if not args.orca or not Path(args.orca).is_file():
        parser.error("Pass --orca with the absolute path to the Orca CLI")
    if args.install:
        install(str(Path(args.orca).absolute()), args.plugin)
        return 0
    previous = None
    while True:
        try:
            result = sync(args.orca, args.plugin)
            message = json.dumps({"ok": True, **result}, sort_keys=True)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            message = json.dumps({"ok": False, "error": "title_sync_unavailable"})
            if not args.watch:
                print(message, flush=True)
                return 1
        if message != previous:
            print(message, flush=True)
            previous = message
        if not args.watch:
            return 0
        time.sleep(30)


if __name__ == "__main__":
    raise SystemExit(main())
