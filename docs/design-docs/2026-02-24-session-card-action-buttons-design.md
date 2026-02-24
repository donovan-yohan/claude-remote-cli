# Session Card Action Buttons — Design

**Date:** 2026-02-24
**Status:** Approved

## Problem

1. Right-click context menu on inactive worktrees feels disconnected — it slides the div, overlaps the status bar, and is not discoverable on mobile/touch.
2. Row 2 (`personal · claude-remote-cli`) and row 3 (`just now`) are misaligned with the session name.
3. The existing action buttons (✎, ×) are too small, have no background, and lack contrast — nearly invisible on selected (accent) cards.

## Solution

Replace the context menu with inline pill-shaped hover buttons on all three card variants. Fix alignment. Improve button legibility.

### Card Actions

| Card type | Buttons | Labels |
|-----------|---------|--------|
| Active session | Rename, Kill | `✎` icon, `×` icon |
| Inactive worktree | Resume yolo, Delete | `YOLO` monospace, 🗑 trash icon |
| Idle repo | New worktree | `+ worktree` monospace |

### Button Styling

- Pill shape: `border-radius: 12px`, `padding: 2px 8px`, min-height ~24px
- Background: `rgba(255, 255, 255, 0.1)` default, `rgba(255, 255, 255, 0.2)` on hover
- Selected (accent) cards: `rgba(255, 255, 255, 0.2)` / `rgba(255, 255, 255, 0.3)` on hover
- Text color: `var(--text)` default, `#fff` on selected cards
- Destructive buttons (delete/kill): `rgba(231, 76, 60, 0.15)` background, red text on hover
- Monospace font for `YOLO` and `+ worktree`, system font for icons
- Opacity transition: `0 → 1` on card hover; always visible on touch devices (`@media (hover: none)`)

### Alignment Fix

Remove `row-2-spacer` and `row-3-spacer` elements. Apply `padding-left: 16px` to rows 2 and 3, matching status dot width (8px) + margin (8px) so text aligns with the session name.

### Data Flow

- Inactive worktree buttons: `SessionItem` gets `onresumeYolo` and `ondelete` props. `SessionList` handles YOLO internally (creates session directly with `--dangerously-skip-permissions`, no dialog). Delete is passed up to `App.svelte` which opens the delete worktree dialog.
- Idle repo card body click: `SessionList.handleStartRepoSession()` creates a repo session directly with `continue: true` (no dialog).
- Idle repo YOLO button: `SessionList.handleStartRepoSessionYolo()` creates a repo session directly with `continue: true` + `--dangerously-skip-permissions` (no dialog).
- Idle repo `+ worktree` button: calls `onNewWorktree` which opens the new session dialog forced to the worktrees tab via `open(repo, { tab: 'worktrees' })`.

### Cleanup

- Remove `ContextMenu.svelte` usage from `App.svelte`
- Remove `oncontextmenu` prop chain through `Sidebar → SessionList → SessionItem`
- Wire delete worktree dialog to the inline trash button instead of context menu
- Wire resume-yolo to the inline YOLO button instead of context menu
