---
status: superseded
created: 2026-03-06
branch: master
supersedes:
implemented-by:
consulted-learnings: []
---

# Customize Session Flow Design

## Objective

Enable users to "customize" inactive worktrees and idle repos by opening the NewSessionDialog pre-filled with the item's available data (root, repo, branch, agent, args). Users modify fields and submit to create a new session with their preferred settings.

## Current State

- Goal 1 added "Customize" menu items in context menus for inactive worktrees and idle repos
- "Customize" currently calls `onOpenNewSession(repo)` which passes only a `RepoInfo { name, path, root }` to `NewSessionDialog.open()`
- The dialog pre-fills root and repo, but NOT branch, agent, or args
- For inactive worktrees, the worktree tab should open; currently no tab override is passed

## Design Decisions

### D1: Extend `open()` options, not the callback chain
Rather than creating a new callback or changing `onOpenNewSession`'s signature to a complex object, extend the existing `options` parameter of `NewSessionDialog.open()`:
```typescript
open(repo?: RepoInfo | null, options?: {
  yolo?: boolean;
  tab?: 'repos' | 'worktrees';
  branchName?: string;
  agent?: AgentType;
  claudeArgs?: string;
})
```
The callback `onOpenNewSession` changes from `(repo?: RepoInfo) => void` to `(repo?: RepoInfo, options?: OpenOptions) => void` to thread options through.

### D2: Pre-fill available data, default the rest
- **Inactive worktrees**: pre-fill root, repo, branch (from `WorktreeInfo.branchName`), tab = `worktrees`. Agent and args use server defaults.
- **Idle repos**: pre-fill root, repo, tab = `repos`. Branch, agent, and args use defaults.
- Rationale: `WorktreeInfo` and `RepoInfo` don't carry agent/args history. Adding backend persistence for these fields is out of scope.

### D3: Agent defaults from server unless overridden
The dialog already fetches `defaultAgent` from server config on each `open()`. When `options.agent` is provided, it overrides the server default. This keeps the pre-fill mechanism generic.

### D4: No dialog title change
The dialog title stays "New Session" / "New Worktree" based on active tab. No "Customize" title variant — the dialog's behavior is identical, just pre-filled.

## Changes Required

### 1. `NewSessionDialog.svelte` — Extend `open()` options
- Add `branchName`, `agent`, `claudeArgs` to options type
- After loading defaults, apply any provided overrides:
  - `branchName` → set `branchInput` and close branch dropdown
  - `agent` → override `selectedAgent` after default fetch
  - `claudeArgs` → set `claudeArgsInput`

### 2. `SessionList.svelte` — Pass worktree data in menu actions
- `inactiveWorktreeMenu`: call `onOpenNewSession(repo, { tab: 'worktrees', branchName: wt.branchName })`
- `idleRepoMenu`: keep as `onOpenNewSession(repo)` (repos tab is already the default)

### 3. `Sidebar.svelte` — Update callback type
- Change `onOpenNewSession` type from `(repo?: RepoInfo) => void` to accept optional second `options` parameter
- Thread options through to SessionList

### 4. `App.svelte` — Thread options to dialog
- `handleOpenNewSession(repo?, options?)` → `newSessionDialogRef?.open(repo, options)`

## Non-changes
- No backend changes needed
- No new components
- No type definition changes to `WorktreeInfo` or `RepoInfo`
- Active sessions still have no "Customize" option (already correct from Goal 1)
