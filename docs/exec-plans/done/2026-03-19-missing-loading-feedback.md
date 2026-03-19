# Plan: Missing Loading Feedback on Session/Worktree Creation

> **Status**: Complete | **Created**: 2026-03-19
> **Source**: docs/bug-analyses/2026-03-19-missing-loading-feedback-bug-analysis.md

## Goal

Add loading feedback (disabled state, text change) to all session/worktree creation flows, following the existing `DeleteWorktreeDialog` pattern.

## Progress

- [x] Task 1: Add loading state to `handleNewWorktree` in App.svelte
- [x] Task 2: Show loading state on "+ new worktree" button in WorkspaceItem.svelte
- [x] Task 3: Add loading state to inactive worktree resume click in WorkspaceItem.svelte
- [x] Task 4: Add creating state to NewSessionDialog submit button
- [x] Task 5: Add loading state to RepoDashboard CTA buttons
- [x] Task 6: Build and verify

---

### Task 1: Add loading state to `handleNewWorktree` in App.svelte

**File:** `frontend/src/App.svelte`
**What:** Wrap `handleNewWorktree` with `setLoading`/`clearLoading` using key `new-worktree:{workspace.path}`. Guard against double-clicks by checking `isItemLoading` at entry.

### Task 2: Show loading state on "+ new worktree" button in WorkspaceItem.svelte

**File:** `frontend/src/components/WorkspaceItem.svelte`
**What:** Import `isItemLoading` from sessions state. Derive loading state from `isItemLoading('new-worktree:' + workspace.path)`. When loading: show "creating..." text, reduce opacity, disable pointer events.

### Task 3: Add loading state to inactive worktree resume click in WorkspaceItem.svelte

**File:** `frontend/src/components/WorkspaceItem.svelte`
**What:** Wrap the inline `createSession` calls (lines 270-280) with `setLoading(wt.path)`/`clearLoading(wt.path)`. Show a loading indicator on the row using `isItemLoading(wt.path)`. Same for context menu Resume actions (lines 115-143).

### Task 4: Add creating state to NewSessionDialog submit button

**File:** `frontend/src/components/dialogs/NewSessionDialog.svelte`
**What:** Add `let creating = $state(false)`. Set `creating = true` before API call in `handleSubmit`, reset in finally. Button text changes to "Creating..." when creating. Button disabled when creating.

### Task 5: Add loading state to RepoDashboard CTA buttons

**File:** `frontend/src/components/RepoDashboard.svelte`
**What:** Accept optional `creatingWorktree` prop. When true, the "+ New Worktree" button shows "Creating..." and is disabled. The prop comes from App.svelte checking `isItemLoading`.

### Task 6: Build and verify

Run `npm run build` to verify no TypeScript errors.
