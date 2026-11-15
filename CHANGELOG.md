# Changelog

## 1.1.2 (2026-11-15)

- Remove the default 60-second standby fallback introduced in 1.1.1, including its saved setting. It prematurely fixed workspace names and prevented later Orca AI titles. Without a meaningful title, the default behavior is to leave the workspace alone.
- Promote plugin-owned standby names when a meaningful branch later becomes available, including beyond the initial six-hour window. Manual edits, Undo and Ignore remain protected.
- Use `workspaceListId` from creation events on newer hosts so events and list rows match even when raw ids differ.
- Add a read-only inventory of unchanged plugin-owned standby names for targeted recovery; no additional capabilities.
- Clarify that sidebar titles are separate from native chat tab titles. No claim of native-chat title support or new history access.

## 1.1.1 (2026-11-14)

- New untitled workspaces now receive a standby name after a 60-second title grace period by default. The `fallbackNames` setting can disable this; `standbyNames` still opts into immediate naming. The default standby label is `待命工作区` (saved custom labels are preserved).
- Fix branchless folder-project sessions being mistaken for the project root because they share its directory. Meaningful dashed folder workspace names now supply a topic without a Git branch.
- Treat English and Chinese creation placeholders as untitled, rather than final topics.
- Preserve creation-event evidence through the first scan and truncated/delayed listings. Events observed while paused stay suggestion-only.
- Show an error status when renaming fails, instead of a green success status. Keep retrying and preserve manual-rename, Undo and Ignore locks.
- No new capabilities. Orca 1.4.258 still cannot supply native chat titles through the plugin API: fallback names are standby names, not chat summaries, and replace Orca's future AI workspace title.

## 1.1.0 (2026-11-14)

A rewrite on Orca's official plugin API.

- **Official API only.** Workspaces are listed with `workspace.list` and renamed with `workspace.rename` (host API 1.5). The plugin no longer reads Orca's runtime token or socket, its session journal database, `diskutil` or `PlistBuddy`, and it declares `workspace:write` for the renames it makes.
- **New sidebar panel** (English and Chinese): status, pause switch, rename history with Undo, and Suggestions for older workspaces with Apply and Ignore.
- **Safe on install.** Workspaces that already exist are never renamed automatically; they get suggestions. Project checkouts (default branches, or a worktree in the project’s own folder) and project root folders are skipped.
- **Builds on Orca's own titles.** New workspaces wait for Orca's agent title, then get the project prefix. A meaningful branch names a worktree directly. Standby names are now opt-in, because they replace Orca's AI title.
- **Settings in Orca's Settings page:** automatic renaming, project prefix aliases, standby names and their label (default `Standby`). They replace the `PROJECT_ALIASES_JSON`, `AI_VOLUME_PATH`, `AI_VOLUME_UUID` and `ORCA_NAMING_READ_ONLY` environment variables, which a GUI app rarely receives.
- **Fixes:**
  - A lock is kept when a workspace drops out of one list (a host offline, Orca starting); a workspace is forgotten only after 14 days missing.
  - A truncated first list (over 500 workspaces) no longer makes old workspaces look new later.
  - Only workspaces first seen in the last 6 hours while the plugin is on are renamed on their own; ones seen while paused become suggestions.
  - Apply carries on past a failed rename and reports how many failed; an Undo cannot be undone again.
  - `Agent | Topic` with a half-width bar is read like `Agent｜Topic`; project names such as `constructor` are safe; titles in Cyrillic, Korean, Japanese and other scripts are named.
  - A checkout in the project's own folder is skipped whatever its branch; standby names no longer keep the plugin polling.
  - A first-run baseline is now saved, so new workspaces are told apart from old ones.
  - The built-in demo aliases are gone; they renamed any project called `Orca` or `Game`.
  - A rename that fails is reported and retried instead of stopping the pass.
  - A failing status bar update can no longer reject the worker's check.
  - Long titles are cut at a word boundary.
  - Names with an unknown prefix are never rewritten.
- **Store page:** the icon is now 512×512 with transparent corners (the old one had white corners on dark backgrounds). The cover and screenshots are redrawn to match what the plugin does.

## 1.0.2 (2026-11-08)

- Bilingual topic examples in the store images.

## 1.0.1

- Redesigned cover, icon and screenshots.

## 1.0.0

- First release.
