# 1.1.2 — correct the standby-name regression

## Cause

Version 1.1.1 enabled a 60-second fallback by default. A plugin rename fixes the workspace display name and can suppress Orca's future AI sidebar title. Chat tab titles remain separate, so a workspace could have a meaningful chat and still display `Project｜待命工作区 <ID>`. Counting a fallback rename as success did not validate the intended task-topic naming behavior.

## Correction

- Remove the timeout and `fallbackNames` setting. Previously saved `true` values have no effect. Immediate standby naming remains explicitly opt-in and defaults off.
- A plugin-owned, unchanged standby may advance to a meaningful branch name, even beyond the initial new-workspace window. User edits and locks remain final.
- Match newer creation events through `workspaceListId`, preserving exact workspace identity.
- Expose a read-only `naming.standbyInventory` request for recovery, restricted to unchanged, unlocked standby records written by this plugin. No new capabilities.

## Validation and recovery

- 44 tests passed; TypeScript check, manifest validation and five panel scenarios passed.
- Live Orca 1.4.259: a new untitled disposable folder workspace stayed unchanged after 63 seconds, with the plugin active and waiting for a title.
- A controlled delayed-title test then set a meaningful workspace title through the CLI. The worker automatically added the project prefix. This tests title arrival, not native AI title generation. The disposable folder entry was removed without deleting its shared directory.
- A recovery inventory identified nine current unchanged plugin-owned standby names. Eight had linked native chat titles; those were recovered through the official Orca CLI and each result was read back. One had neither a linked title nor a meaningful branch and was left unchanged. Older unowned standby names were not rewritten. Private per-workspace recovery receipts remain outside the repository.

## Remaining boundary

This plugin consumes sidebar workspace titles and branch names, not native chat tab titles. The official plugin surfaces do not provide reliable per-workspace native-chat title coverage, especially for Antigravity. The history API is a separate directory-based listing and is not used here. This release fixes the regression and preserves real titles when the host supplies them; it does not claim universal native-chat topic naming.
