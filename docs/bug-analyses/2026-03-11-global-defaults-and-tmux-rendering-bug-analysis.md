# Bug Analysis: Global Defaults Not Applied on Quick-Start + Missing Characters in tmux

> **Status**: Confirmed | **Date**: 2026-03-11
> **Severity**: Medium
> **Affected Area**: SessionList.svelte (frontend), sessions.ts (backend)

## Bug 1: Global Defaults Not Applied on Quick-Start Click

### Symptoms
- Clicking an idle repo (or worktree) list item to "quick start" a session does not apply the tmux or yolo global settings, even when they are toggled ON in Settings.
- The session starts without tmux wrapping and without yolo mode, despite the user having enabled these defaults.

### Reproduction Steps
1. Open the app and go to Settings.
2. Toggle "YOLO mode" and/or "Launch in tmux" ON.
3. Close the Settings dialog.
4. Click an idle repo item in the sidebar to quick-start a session.
5. Observe: session starts without tmux/yolo, ignoring the global defaults.

### Root Cause
`configDefaults` in `SessionList.svelte` (line 29) is fetched **once** on component mount via `onMount()` (lines 31-42). After the user changes settings in `SettingsDialog`, the dialog saves to the server and calls `refreshAll()` on close — but `refreshAll()` only refreshes sessions/repos/worktrees data, **not** config defaults.

The `SessionList` component does not re-mount when settings change, so its `onMount` callback never re-runs. The stale `configDefaults` (with initial values `defaultYolo: false`, `launchInTmux: false`) is used when creating sessions via:
- `handleStartRepoSession()` (line 275)
- `handleStartWorktreeSession()` (line 254)
- `handlePRClick()` (line 178)

### Evidence
- `SessionList.svelte:29`: Initial state `{ defaultContinue: true, defaultYolo: false, launchInTmux: false }`
- `SessionList.svelte:31-42`: `onMount` fetches once, never re-fetched
- `SettingsDialog.svelte:110-113`: `handleClose()` calls `refreshAll()` which does NOT refresh config
- `handleStartRepoSession` (line 283-285): Uses stale `configDefaults.defaultYolo` and `configDefaults.launchInTmux`

### Impact Assessment
- All "quick start" flows (repo click, worktree click, PR click) are affected
- Users must use the "Customize" context menu option to manually set tmux/yolo per session
- Global defaults only work correctly on fresh page load (initial mount)

### Recommended Fix Direction
Re-fetch `configDefaults` when settings change. Options:
1. **Event-based**: Dispatch a custom event from SettingsDialog on close; SessionList listens and re-fetches
2. **Shared reactive store**: Move config defaults into a shared Svelte state module (similar to `sessions.svelte.js`) that both SettingsDialog and SessionList read from
3. **Fetch on demand**: Re-fetch config defaults each time a quick-start handler is invoked (simplest but adds latency)

Option 2 (shared store) is cleanest — it mirrors the existing pattern used for sessions state.

---

## Bug 2: Missing Characters in Terminal When Running in tmux

### Symptoms
- When a session is launched with "Launch in tmux" enabled, emoji and special Unicode characters (Claude logo, status icons, separators) render as underscores or blank spaces in the terminal.
- Non-tmux sessions render these characters correctly.

### Reproduction Steps
1. Enable "Launch in tmux" in Settings (or via Customize dialog).
2. Start a new session.
3. Observe: Claude Code's UI shows underscores where emoji/icons should appear (e.g., `________ Opus 4.6`, `__ bypass permissions on`).

### Root Cause
In `server/sessions.ts:52-61`, `resolveTmuxSpawn()` creates the tmux command without the `-u` flag:

```typescript
function resolveTmuxSpawn(command, args, tmuxSessionName) {
  return {
    command: 'tmux',
    args: ['new-session', '-s', tmuxSessionName, '--', command, ...args],
  };
}
```

The `-u` flag forces tmux to use UTF-8 mode regardless of the locale settings in the environment. Without it, tmux may fall back to ASCII-safe rendering, causing wide Unicode characters (emoji, Nerd Font glyphs) to display as underscores or be dropped entirely.

### Evidence
- `server/sessions.ts:57-59`: tmux args are `['new-session', '-s', name, '--', cmd, ...args]` — no `-u` flag
- Screenshot shows systematic replacement of emoji/icon characters with underscores
- Non-tmux sessions work correctly (same xterm.js, same PTY TERM setting)

### Impact Assessment
- All tmux-wrapped sessions are affected
- The terminal is still functional but the UI is degraded (missing icons, labels harder to read)
- Only affects visual rendering, not session functionality

### Recommended Fix Direction
Add `-u` flag to the tmux invocation in `resolveTmuxSpawn()`:

```typescript
args: ['-u', 'new-session', '-s', tmuxSessionName, '--', command, ...args],
```

This forces UTF-8 mode in tmux regardless of locale settings. The `-u` flag must come before the `new-session` subcommand (it's a server/global option, not a session option).
