# Changelog

## 1.1.0 (2026-11-14)

A rewrite on Orca's official plugin API.

- **Official API only.** Workspaces are listed with `workspace.list` and renamed with `workspace.rename` (host API 1.5). The plugin no longer reads Orca's runtime token or socket, its session journal database, `diskutil` or `PlistBuddy`, and it declares `workspace:write` for the renames it makes.
- **New sidebar panel** (English and Chinese): status, pause switch, rename history with Undo, and Suggestions for older workspaces with Apply and Ignore.
- **Safe on install.** Workspaces that already exist are never renamed automatically; they get suggestions. Project checkouts on `main`/`master`/`trunk`/`develop` and project root folders are skipped.
- **Builds on Orca's own titles.** New workspaces wait for Orca's agent title, then get the project prefix. A meaningful branch names a worktree directly. Standby names are now opt-in, because they replace Orca's AI title.
- **Settings in Orca's Settings page:** automatic renaming, project prefix aliases, standby names and their label. They replace the `PROJECT_ALIASES_JSON`, `AI_VOLUME_PATH`, `AI_VOLUME_UUID` and `ORCA_NAMING_READ_ONLY` environment variables, which a GUI app rarely receives.
- **Fixes:**
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
