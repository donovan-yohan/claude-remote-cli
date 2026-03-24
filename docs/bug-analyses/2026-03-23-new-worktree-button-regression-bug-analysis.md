# Bug Analysis: New Worktree Button Opens Session Dialog Instead of Creating Worktree

> **Status**: Confirmed | **Date**: 2026-03-23
> **Severity**: High
> **Affected Area**: `POST /workspaces/worktree` endpoint, `handleNewWorktree` in App.svelte

## Symptoms
- Clicking "+ new worktree" (sidebar or dashboard) opens the "New Agent Session" dialog instead of creating a worktree
- The dialog is the `CustomizeSessionDialog` which can only create repo sessions — no worktree options
- Regression: used to create worktrees instantly, now always falls back to the wrong dialog

## Reproduction Steps
1. Have a workspace with an existing `.worktrees/<mountainName>` directory (e.g., extend-api with `.worktrees/everest`)
2. Ensure the workspace has no `nextMountainIndex` in its per-workspace settings
3. Click "+ new worktree" in the sidebar or "+ New Worktree" in the dashboard
4. Observe: "New Agent Session" dialog opens instead of worktree being created

## Root Cause

**Two interacting bugs** cause this regression:

### Bug 1: Mountain name collision — no retry on conflict

`POST /workspaces/worktree` (server/workspaces.ts:582-597) picks the next mountain name using the per-workspace `nextMountainIndex`. If the name/branch/directory already exists, the `git worktree add` command fails with a 500 error. There is **no collision detection or retry logic**.

Compare with `POST /sessions` (server/index.ts:945-948) which **does** handle directory collisions:
```javascript
if (fs.existsSync(targetDir)) {
  targetDir = targetDir + '-' + Date.now().toString(36);
  dirName = path.basename(targetDir);
}
```

### Bug 2: Dual mountain index counters — global vs per-workspace desync

Two different endpoints create worktrees with different counters:
- `POST /sessions` (index.ts:933) uses `config.nextMountainIndex` — the **global** counter
- `POST /workspaces/worktree` (workspaces.ts:584) uses `settings.nextMountainIndex` — the **per-workspace** counter

If a worktree was created via `POST /sessions` (or externally), the per-workspace counter in `POST /workspaces/worktree` is never incremented. For workspaces where the per-workspace counter was never set (defaults to 0 → "everest"), this causes permanent collisions.

### Bug 3: Silent error fallback opens wrong dialog

`handleNewWorktree` (App.svelte:463-465) catches all errors silently and opens `CustomizeSessionDialog`, which:
- Has no worktree creation capability (was stripped in the tab bar redesign at 7a4ce7c)
- Creates repo sessions via `createRepoSession()`, not worktree sessions
- Shows no error message to the user

## Evidence

**extend-api workspace state:**
- `.worktrees/everest` exists (created previously)
- Per-workspace `nextMountainIndex`: NOT SET (defaults to 0 → "everest")
- Global `nextMountainIndex`: 4 (out of sync)

**Reproduction of git failure:**
```
$ git worktree add -b everest .worktrees/everest development
fatal: a branch named 'everest' already exists
```

**Code path:** `handleNewWorktree` → `createWorktree()` → `POST /workspaces/worktree` → git fails → catch → `customizeDialogRef.open()` → wrong dialog

## Impact Assessment

- **All workspaces** with existing worktrees and no per-workspace `nextMountainIndex` are affected
- The "+ new worktree" button is completely broken for these workspaces
- The fallback dialog creates repo sessions, not worktrees — users get the wrong session type
- No error message is shown, so users don't know what failed

## Recommended Fix Direction

1. **Add collision handling to `POST /workspaces/worktree`**: If the mountain name, branch, or directory already exists, auto-increment to the next available name (loop through MOUNTAIN_NAMES until a free slot is found)
2. **Unify mountain counters**: Either migrate `POST /sessions` to use per-workspace counters or remove the duplicate worktree creation from `POST /sessions` entirely (it's redundant now that `POST /workspaces/worktree` exists)
3. **Fix the error fallback**: Log the error to console, and either show an error toast or fall back to a worktree-aware dialog (not `CustomizeSessionDialog`)
