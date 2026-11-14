# Automatic naming repair — 1.1.1

Validated on Orca 1.4.258, 2026-11-14.

## Findings

- The installed 1.1.0 worker was active and could rename meaningful branch titles. The failure was not a stopped worker.
- Default settings waited for an Orca sidebar title without providing a fallback. Native chat titles are not available through this host's plugin API.
- Branchless folder-project sessions can share their project's directory; treating the directory basename alone as a project checkout excluded these sessions.
- Creation events previously only scheduled a scan. A first or truncated baseline could swallow a new workspace before automatic naming began.

## Changes

After a 60-second grace period, a new untitled workspace gets `Project｜待命工作区 <8-hex-id>` by default. The new `fallbackNames` setting opts out; immediate naming remains separately configurable. Real sidebar titles take precedence during the grace period. Dashed folder workspace names can provide topics, and Chinese/English placeholder names remain eligible for fallback.

Creation-event evidence is retained until its row appears. Paused events, pre-install workspaces, manual renames, Undo, Ignore and the six-hour automatic naming boundary remain protected. Rename failures show an error state.

## Verification

- 41 plugin tests passed, including startup/truncated-list creation, pause/resume, fallback after restart, grace period, custom labels, expiry and manual locks.
- TypeScript type check passed; plugin manifest validation and five panel scenarios passed.
- Live development worker: a new `seagrass` folder workspace changed to `Mac｜待命工作区 a81ebcdf` automatically after approximately 63 seconds, without requesting a manual check. Read back through Orca's workspace API and plugin history.
- Three recent previously stalled random names also received fallback names. The live Chinese panel displayed the history with zero reported errors and zero pending requests.
- Both disposable folder workspace entries created for this task were removed through Orca; their shared directory was not deleted.

## Limit

This release restores automatic sidebar naming. It does not summarize native chat contents. A standby rename replaces Orca's future AI workspace title on this host; disable fallback if preserving that future title is preferred. All access remains through the existing four plugin capabilities.
