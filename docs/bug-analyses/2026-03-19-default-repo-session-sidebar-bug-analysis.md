# Bug Analysis: Default Repo Session — Missing, Misnamed, Wrong Click Handler, Missing Secondary Row, Wrong Item Order

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: `WorkspaceItem.svelte` (all 6 issues), `Sidebar.svelte` (grouping)

## Symptoms
1. When there are no worktrees or active sessions, the default repo root entry doesn't appear at all
2. The repo root entry shows `workspace.name` (e.g., "claude-remote-cli") instead of "default"
3. Clicking the repo root entry creates a **new worktree** instead of opening a session at the repo root directory
4. The idle repo root entry has no secondary row (missing time, branch, PR, dots)
5. Active session secondary row items are in wrong order: worktreeName → PR → time → dots
6. ContextMenu (triple dots) is not right-aligned — no spacer pushes it to the end

## Reproduction Steps
1. Add a workspace with no worktrees and no active sessions
2. Observe: no entry appears under the workspace (Bug 1)
3. Create a worktree session, then observe the repo root entry that appears
4. Note name shows "claude-remote-cli" not "default" (Bug 2)
5. Click the repo root entry → a new worktree is created instead of a repo session (Bug 3)
6. Observe no secondary line on the repo root entry (Bug 4)
7. On active sessions, observe order is worktree→PR→time→dots instead of time→branch→PR→dots (Bug 5)
8. When worktreeName is absent, dots sit immediately after time with no right-alignment (Bug 6)

## Root Cause

### Bug 1: Repo root hidden when no sessions/worktrees exist
**WorkspaceItem.svelte:201** — the session list is gated by:
```svelte
{#if !collapsed && !inReorderMode && (allSessions.length > 0 || inactiveWorktrees.length > 0)}
```
When both are empty, the entire `<ul>` (including the persistent repo root entry at line 249) never renders. The repo root entry is **inside** the conditional that requires at least one session or worktree to exist.

### Bug 2: Repo root shows workspace name instead of "default"
**WorkspaceItem.svelte:274** — the idle repo root entry displays:
```svelte
<span class="session-name">{isItemLoading(repoLoadingKey) ? 'starting...' : workspace.name}</span>
```
Should show `'default'` per FRONTEND.md:86: *"Repo root items always display 'default' as their name"*.

### Bug 3: Click creates worktree instead of repo session
**WorkspaceItem.svelte:261** — the onclick calls:
```typescript
createSession({ repoPath: workspace.path, repoName: workspace.name })
```
This hits `POST /sessions` (the **worktree creation** endpoint at server/index.ts:641-656). With no `worktreePath` and no `branchName`, the server picks the next mountain name and creates a brand new git worktree.

Should call `createRepoSession()` which hits `POST /sessions/repo` — that creates a session at the repo root directory without creating a worktree.

### Bug 4: No secondary row on idle repo root
**WorkspaceItem.svelte:271-276** — the idle repo root entry only has `session-row-primary`:
```svelte
<li class="session-row inactive" ...>
  <div class="session-row-primary">
    <span class="dot dot-inactive"></span>
    <span class="session-name">...</span>
  </div>
</li>
```
Missing `session-row-secondary` div entirely. Should show default branch name and ContextMenu at minimum.

### Bug 5: Wrong item order in secondary row
**WorkspaceItem.svelte:238-246** — active session secondary row order:
```
worktreeName → PR# → time → ContextMenu
```
FRONTEND.md:87 specifies: *"timestamp → branch name → PR number → context menu (right-aligned)"*. Expected order:
```
time → branchName → PR → context menu (right-aligned)
```

Same issue exists for inactive worktrees (lines 314-319): `PR → time → ContextMenu`.

### Bug 6: ContextMenu not right-aligned
**WorkspaceItem.svelte** CSS `.session-row-secondary` (line 534-543) — no mechanism to push ContextMenu to the right edge. The `.secondary-worktree` has `flex: 1` but when absent, everything left-aligns. The ContextMenu needs `margin-left: auto` or a spacer element.

## Evidence

| Location | Current | Expected |
|----------|---------|----------|
| `WorkspaceItem.svelte:201` | Conditional hides repo root when 0 sessions + 0 worktrees | Repo root always visible |
| `WorkspaceItem.svelte:274` | Shows `workspace.name` | Shows `'default'` |
| `WorkspaceItem.svelte:261` | Calls `createSession()` → `POST /sessions` → creates worktree | Should call `createRepoSession()` → `POST /sessions/repo` → repo session |
| `WorkspaceItem.svelte:271-276` | No secondary row | Should have time, branch, dots |
| `WorkspaceItem.svelte:238-246` | worktree → PR → time → dots | time → branch → PR → dots(right) |
| `.session-row-secondary` CSS | No right-alignment mechanism | ContextMenu needs `margin-left: auto` |

## Impact Assessment
- **Users can't access repo root**: The primary interaction (clicking to open a session) creates an unwanted worktree instead
- **No visual cue when workspace is empty**: Users see nothing under a workspace with no worktrees — no indication they can start working
- **Inconsistent with documented behavior**: FRONTEND.md specifies exact naming and ordering that isn't implemented
- **Context menu inaccessible on repo root**: No dots menu means no Customize/Rename options

## Recommended Fix Direction

All fixes are in `WorkspaceItem.svelte`:

1. **Bug 1**: Move the repo root entry rendering **outside** or before the `allSessions.length > 0 || inactiveWorktrees.length > 0` guard. The repo root entry should always render when not collapsed.

2. **Bug 2**: Change `workspace.name` to `'default'` in the idle repo root name display.

3. **Bug 3**: Import and call `createRepoSession()` instead of `createSession()` in the idle repo root onclick handler.

4. **Bug 4**: Add a `session-row-secondary` div to the idle repo root entry with branch name (workspace defaultBranch) and ContextMenu.

5. **Bug 5**: Reorder secondary row items to: time → branchName → PR → context menu (right-aligned).

6. **Bug 6**: Add a spacer or `margin-left: auto` on the ContextMenu wrapper in the secondary row to push dots to the right edge.
