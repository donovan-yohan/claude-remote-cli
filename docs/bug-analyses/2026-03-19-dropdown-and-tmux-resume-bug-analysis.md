# Bug Analysis: Dropdown Menu Broken + Tmux Resume Missing UTF-8

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: ContextMenu / WorkspaceItem (frontend), session restore (server/sessions.ts)

## Bug A: Triple-dots dropdown menu doesn't render when clicked

### Symptoms
- Clicking the `···` context menu on session/worktree rows does nothing visible
- The menu opens (state updates) but renders off-screen or at 0×0 size inside the overlay

### Reproduction Steps
1. Hover over a session row in the sidebar
2. Click the `···` button that appears
3. Menu does not appear

### Root Cause
Commit `1d5d676` moved the `<ContextMenu>` component from inline in `.session-row-secondary` to a new `.row-menu-overlay` div with this CSS:

```css
.row-menu-overlay {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);  /* ← THE BUG */
}
```

The `transform` property creates a **new containing block** for all `position: fixed` descendants ([CSS spec](https://www.w3.org/TR/css-transforms-1/#containing-block-for-all-descendants)). The ContextMenu's backdrop (`position: fixed; inset: 0`) and menu (`position: fixed`) are now constrained to the overlay element's bounds instead of the viewport:
- Backdrop covers only the ~24px overlay area, not the full screen
- Menu is positioned relative to the overlay, rendering off-screen or invisible

### Evidence
- `ContextMenu.svelte:154-158`: backdrop uses `position: fixed; inset: 0`
- `ContextMenu.svelte:160-170`: menu uses `position: fixed`
- `WorkspaceItem.svelte:581-593`: `.row-menu-overlay` has `transform: translateY(-50%)`
- Before `1d5d676`, ContextMenu was a sibling inside a flex row with no `transform` ancestor

### Impact
- All session/worktree context menus (Rename, Kill, Resume, Delete) are inaccessible on desktop
- Mobile long-press also broken since it calls `menu.openAt()` which renders in the same container

### Recommended Fix Direction
Either:
1. Remove `transform` from `.row-menu-overlay` and use a different centering technique (e.g., `top: 0; bottom: 0; display: flex; align-items: center`)
2. Portal the ContextMenu's dropdown (backdrop + menu `<ul>`) to `document.body` using a Svelte action or `{@html}` approach so it escapes the transformed container

Option 1 is simpler and maintains the current architecture.

---

## Bug B: Resumed tmux sessions don't render special characters

### Symptoms
- After a server update and session restore, tmux sessions show underscores or garbled text where Unicode/special characters should appear (e.g., status icons)

### Reproduction Steps
1. Have active tmux-wrapped sessions
2. Server restarts (update or manual restart)
3. Sessions restore and attach to surviving tmux sessions
4. Unicode characters render incorrectly

### Root Cause
Initial tmux sessions are created via `resolveTmuxSpawn()` which passes the `-u` flag:
```ts
// pty-handler.ts:27
args: ['-u', 'new-session', '-s', tmuxSessionName, '--', command, ...args, ...]
```

The `-u` flag forces tmux to use UTF-8 mode for the client connection.

When sessions are restored (`sessions.ts:315-318`), the attach command omits `-u`:
```ts
command = 'tmux';
args = ['attach-session', '-t', s.tmuxSessionName];
// Missing: '-u' flag
```

Without `-u`, the new tmux client may not use UTF-8, causing multi-byte characters to render as underscores or garbled text.

### Evidence
- `server/pty-handler.ts:27`: `-u` is passed during `new-session`
- `server/sessions.ts:317-318`: `-u` is NOT passed during `attach-session`
- Prior bug analysis (`tmux-underscore-rendering-bug-analysis.md`) documented the same rendering symptom

### Impact
- All resumed tmux sessions after a server update have broken Unicode rendering
- Affects status indicators, icons, and any non-ASCII content in the terminal

### Recommended Fix Direction
Add `-u` to the tmux attach command in `sessions.ts`:
```ts
command = 'tmux';
args = ['-u', 'attach-session', '-t', s.tmuxSessionName];
```
