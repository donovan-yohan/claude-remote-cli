# Bug Analysis: New Tab Button & Session Modal Mismatch with Workspace-Driven Architecture

> **Status**: Confirmed | **Date**: 2026-03-21
> **Severity**: High
> **Affected Area**: SessionTabBar, NewSessionDialog, App.svelte session creation flow

## Symptoms
- "+" dropdown says "New Claude Session" — vendor-specific, should be generic ("New Agent Session")
- "New Terminal" option opens the same NewSessionDialog modal instead of creating a terminal — **impossible to create a terminal session**
- Modal shows "Repo Session" / "Worktree" tabs that are irrelevant in workspace-driven mode (workspace already knows its folder)
- Neither option creates a session instantly — both force the user through a modal even for default-settings sessions

## Reproduction Steps
1. Open the app with a workspace active
2. Click "+" in the session tab bar
3. Observe dropdown says "New Claude Session" and "New Terminal"
4. Click "New Terminal" — the NewSessionDialog modal opens (same as "New Claude Session") instead of creating a terminal
5. Observe modal shows "Repo Session" / "Worktree" tabs that don't apply to workspace context

## Root Cause

The session creation flow was designed for the old repo-selection model and was never updated for workspace-driven sessions. Four distinct issues:

### 1. Vendor-specific label
`SessionTabBar.svelte:125` hardcodes "New Claude Session" — should be "New Agent Session" since the app supports multiple agents (Claude, Codex).

### 2. Terminal creation is broken
`App.svelte:696` wires `onNewTerminal` as:
```typescript
onNewTerminal={() => handleOpenNewSession(undefined, { agent: 'claude' })}
```
This opens the **same** NewSessionDialog with `agent: 'claude'` pre-selected — it does NOT create a terminal. The `createTerminalSession()` function exists in `api.ts:221` but is **never called** anywhere in the frontend.

### 3. Modal shows irrelevant Repo/Worktree tabs
`NewSessionDialog.svelte:244-262` renders "Repo Session" and "Worktree" tab selectors. In workspace-driven mode, the workspace already determines which folder the session targets. These tabs are architectural leftovers from when users had to pick a repo at session creation time.

### 4. No instant creation path
Both dropdown options route through `handleOpenNewSession()` → `newSessionDialogRef?.open()` (App.svelte:362-370), forcing users through a modal dialog for every new session. There is no way to create a session with workspace defaults in one click.

## Evidence
- `SessionTabBar.svelte:125` — "New Claude Session" text
- `SessionTabBar.svelte:134` — "New Terminal" text
- `App.svelte:695-696` — both callbacks route to `handleOpenNewSession()`
- `App.svelte:362-370` — `handleOpenNewSession()` always opens the dialog
- `NewSessionDialog.svelte:119` — `open()` always sets `activeTab = 'repos'` and shows modal
- `NewSessionDialog.svelte:244-262` — Repo Session / Worktree tabs rendered unconditionally
- `api.ts:221-224` — `createTerminalSession()` exists but is unused

## Impact Assessment
- **Terminal sessions are impossible to create** — the "New Terminal" button is completely broken
- **Extra friction for every new session** — modal is unnecessary when workspace defaults suffice
- **Confusing UI** — Repo/Worktree tabs don't match the workspace-driven mental model
- **Vendor lock-in in labels** — "Claude" in button text doesn't reflect multi-agent support

## Recommended Fix Direction

Redesign the "+" dropdown to have three options with distinct behaviors:

1. **"New Agent Session"** — creates instantly with workspace defaults (no modal), calls `createRepoSession()` with workspace path and global defaults
2. **"New Terminal"** — creates instantly with workspace defaults (no modal), calls `createTerminalSession()` which is already implemented server-side
3. **"Customize..."** — opens a **simplified** modal with only agent customization options (agent select, yolo mode, tmux, extra args). No Repo/Worktree tabs — the workspace context already determines the folder. This is either a new modal or a repurposed NewSessionDialog stripped of its tab UI.
