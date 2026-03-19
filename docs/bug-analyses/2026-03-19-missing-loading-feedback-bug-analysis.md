# Bug Analysis: Missing Loading Feedback on Worktree/Session Creation

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: Medium
> **Affected Area**: Frontend — WorkspaceItem, App, NewSessionDialog, api

## Symptoms
- Clicking "+ new worktree" in the sidebar produces no visual feedback while the git worktree and session are being created (several seconds)
- The button remains clickable, allowing accidental duplicate creation via rapid clicks
- Same issue affects: dashboard "+ New Worktree" button, "New Session" dialog create button, and worktree "Resume" context menu action
- Delete worktree dialog is the only flow that correctly shows loading state ("Deleting...")

## Reproduction Steps
1. Open the app with a workspace visible in the sidebar
2. Click "+ new worktree" on any workspace
3. Observe: no spinner, no disabled state, no "Creating..." text — the UI appears frozen
4. The worktree eventually appears after several seconds with no intermediate feedback

## Root Cause

`handleNewWorktree()` in `App.svelte` (lines 351-389) performs two sequential async API calls — `createWorktree()` then `createSession()` — without setting any loading state before or clearing it after. The button in `WorkspaceItem.svelte` (lines 305-310) has no `disabled` prop or loading indicator.

**Loading infrastructure already exists but is unused for creation flows:**
- `setLoading(key)` / `clearLoading(key)` / `isItemLoading(key)` are defined in `sessions.svelte.ts` (lines 178-188)
- These are only used by `DeleteWorktreeDialog.svelte` — never for creation

| Flow | Has Loading? | Spinner? | Button Disabled? | Loading Text? |
|------|---|---|---|---|
| + new worktree (sidebar) | No | No | No | No |
| + New Worktree (dashboard) | No | No | No | No |
| New Session dialog create | No | No | No | No |
| Resume Worktree (context menu) | No | No | No | No |
| Delete Worktree confirm | **Yes** | No | **Yes** | **"Deleting..."** |

## Evidence
- `WorkspaceItem.svelte:305-310` — no disabled/loading props on `add-worktree-btn`
- `App.svelte:351-389` — `handleNewWorktree()` has no loading state management
- `NewSessionDialog.svelte:392` — create button has no creating state (only branch refresh has spinner)
- `sessions.svelte.ts:178-188` — `setLoading/clearLoading/isItemLoading` exist but unused for creation
- `DeleteWorktreeDialog.svelte:10,27,36,76,80,82` — correctly implements loading pattern as reference

## Impact Assessment
- Users perceive the app as unresponsive during worktree creation
- Rapid clicks can trigger multiple concurrent git worktree operations, creating duplicate worktrees
- Inconsistent UX — delete shows feedback but create does not

## Recommended Fix Direction

1. Use the existing `setLoading()`/`clearLoading()` infrastructure for all creation flows
2. Add a `creating` state to `handleNewWorktree()` that disables the button and shows feedback text
3. Apply the same pattern to `NewSessionDialog` create button and worktree resume action
4. Follow the `DeleteWorktreeDialog` as the reference implementation for consistent loading UX
