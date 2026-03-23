# Plan: Fix sidenav tab identity leak

> **Status**: Complete | **Created**: 2026-03-22
> **Source**: `docs/bug-analyses/2026-03-22-sidenav-tab-leak-bug-analysis.md`

## Goal
Sidebar rows should display group/worktree identity (branch name, aggregate status), not the individual tab's identity. Adding or switching tabs must never change what the sidenav shows.

## Progress

- [x] Task 1: Add group display name function to WorkspaceItem.svelte
- [x] Task 2: Replace icon logic with aggregate status across all sessions
- [x] Task 3: Build and verify

---

### Task 1: Add group display name function
**File:** `frontend/src/components/WorkspaceItem.svelte`
**Change:** Add `groupDisplayName(groupPath, groupSessions)` that returns:
- Repo-root groups (`groupPath === workspace.path`): "default" (unless user renamed)
- Worktree groups: branch name from the first session (all share the same worktree)
Replace `sessionDisplayName(representative)` on line 263 with this function.

### Task 2: Replace icon logic with aggregate group status
**File:** `frontend/src/components/WorkspaceItem.svelte`
**Change:** Add `groupStatusDotClass(groupSessions)` that computes the highest-priority status across ALL non-terminal sessions (attention > permission-prompt > running > idle). Replace the `{#if representative.type === 'terminal'}` conditional (lines 258-262) to always show a status dot using this aggregate.

### Task 3: Build and verify
Run `npm run build` to ensure no TypeScript/Svelte errors.
