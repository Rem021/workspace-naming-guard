import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bridge", Path(__file__).parents[1] / "scripts/title_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def row(key="folder:a", title="Mac｜修复命名", **agent_overrides):
    return {"address": {"environment": "local", "worktree": key},
            "path": "/same/directory", "agents": [{"paneKey": "chat:a", "conversationName": title,
            "stateStartedAt": 1, **agent_overrides}]}


def snapshot(*rows, truncated=False):
    return {"ok": True, "result": {"worktrees": list(rows), "truncated": truncated}}


class BridgeTests(unittest.TestCase):
    def test_same_directory_keeps_exact_workspace_association(self):
        result = bridge.observations(snapshot(row(), row("id:repo::/same/directory::workspace:b", "另一任务")))
        self.assertEqual([x["id"] for x in result], ["folder:a", "repo::/same/directory::workspace:b"])
        self.assertEqual([x["title"] for x in result], ["Mac｜修复命名", "另一任务"])

    def test_identity_selectors_and_no_prompt_fallback(self):
        a = row("identity:wt2:local:abc", None, prompt="SECRET", lastAssistantMessage="SECRET")
        self.assertEqual(bridge.observations(snapshot(a)), [])
        a["agents"][0]["displayName"] = "任务标题"
        self.assertEqual(bridge.observations(snapshot(a))[0]["id"], "identity:wt2:local:abc")

    def test_children_cannot_steal_title_latest_primary_is_used(self):
        a = row()
        a["agents"] += [{"paneKey": "child", "parentPaneKey": "chat:a", "conversationName": "子任务", "stateStartedAt": 99},
                        {"paneKey": "chat:b", "conversationName": "最新主题", "stateStartedAt": 2}]
        result = bridge.observations(snapshot(a))
        self.assertEqual(result[0]["sourceKey"], "chat:b")
        self.assertEqual(result[0]["title"], "最新主题")

    def test_duplicate_or_missing_addresses_and_other_environments_are_skipped(self):
        remote = row("folder:remote")
        remote["address"]["environment"] = "another-orca"
        self.assertEqual(bridge.observations(snapshot(row(), row(), remote, {"agents": []})), [])

    def test_incomplete_or_oversized_snapshot_fails_closed(self):
        for data in (snapshot(row(), truncated=True), {"ok": False},
                     snapshot(*(row(f"folder:{i}") for i in range(501)))):
            with self.assertRaises(ValueError):
                bridge.observations(data)

    def test_sync_only_forwards_titles_and_requires_plugin_ack(self):
        a = row(prompt="SECRET", lastAssistantMessage="SECRET", toolInput="SECRET")
        with patch.object(bridge, "cli_json", side_effect=[snapshot(a),
                          {"result": {"result": {"titleSource": "connected", "status": "active"}}}]) as call:
            self.assertEqual(bridge.sync("/orca", "local.workspace-naming-guard")["titles"], 1)
            payload = call.call_args_list[1].args[1]
            self.assertNotIn("SECRET", str(payload))
            self.assertEqual(payload[:5], ["plugin", "dev", "request", "local.workspace-naming-guard", "naming.observeTitles"])
        with patch.object(bridge, "cli_json", side_effect=[snapshot(), {"result": {"result": {}}}]):
            with self.assertRaises(RuntimeError):
                bridge.sync("/orca", "plugin")


if __name__ == "__main__":
    unittest.main()
