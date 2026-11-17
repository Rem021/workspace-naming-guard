# Native chat title repair — 2026-11-16

## Problem and fix

On Orca 1.4.261, native chats had meaningful titles while their sidebar workspaces retained random creation names. The plugin's workspace API only supplied sidebar titles. A live scoped `agents.list` probe returned a native session ID with a null title; `agent.listSessions` returned no sessions for that workspace. History-by-directory is also unsuitable because multiple workspaces share a directory.

Version 1.2.0 adds a separate optional Python connector using only the official `orca worktree ps` and `orca plugin dev request` commands. It forwards exact workspace IDs, parent-chat titles and pane IDs, discarding activity previews. Plugin code continues to use only the official Plugin API with its original four permissions. Temporary exploratory agent/history permissions were removed from the final manifest.

The worker can name previously unlabelled new workspaces, promote plugin-owned branch or standby names, and follow refinements from the same chat. It keeps manually renamed, ignored and undone workspaces locked. A second chat cannot take over a workspace once a chat has named it. Old unowned workspaces remain suggestions. The arbitrary six-hour cutoff is removed. Title observations expire after two minutes; name writes recheck the current value and lock on a detected intervening rename.

## Verification

- 52 Orca plugin tests passed (naming rules, worker integration and panel behavior).
- 6 Python connector tests passed, including same-directory isolation, parent/subagent selection, duplicate IDs, incomplete snapshots and no prompt forwarding.
- TypeScript `tsc --noEmit` passed.
- `orca plugin check` passed all five panel scenarios without issues or warnings.
- Live on Orca 1.4.261: the connector delivered 74 exact workspace-title observations. Three previously missed workspaces were recovered through the plugin's suggestion/apply path and read back from `worktree ps`.
- An isolated repair worktree received synthetic title observations to test automatic branch-to-chat promotion, same-chat refinement, and rejection of overwriting a subsequent manual rename. These checks passed; this was not a new model-generated conversation test.
- The local macOS connector was installed as a user LaunchAgent, verified running, and the plugin reported active/connected. No Orca restart or application-bundle modification was performed.

## Limits

Native chat synchronization is verified with the development-folder installation, not a marketplace-only installation or a different OS. The connector needs a working Orca CLI and a plugin that accepts the observation protocol. It does not generate missing chat titles, rename chat tabs, summarize conversations, or change Git branches. Offline source data is not reused after its TTL. A narrow race still exists between the final name read and Orca's rename call because the public API does not offer compare-and-swap.

Private workspace identifiers and local acceptance logs are intentionally excluded from this public report.
