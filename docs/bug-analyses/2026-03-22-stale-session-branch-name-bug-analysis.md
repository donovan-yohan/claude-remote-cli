# Bug Analysis: Session Branch Name Doesn't Update After Checkout

> **Status**: Confirmed | **Date**: 2026-03-22
> **Severity**: Medium
> **Affected Area**: server/pty-handler.ts, server/watcher.ts, server/index.ts, frontend sidebar

## Symptoms
- Sidebar shows `master` for a repo session even though the main repo has been checked out to `dy/feat/org-dashboard-phase5`
- Branch name is frozen at whatever branch was active when the session was created
- Affects both the sidebar secondary text and the PrTopBar/BranchSwitcher display

## Reproduction Steps
1. Start a repo session when the main repo is on `master`
2. In another terminal, run `git checkout dy/feat/org-dashboard-phase5` in the main repo
3. Observe sidebar — still shows `master` for the session
4. Even triggering `refreshAll()` (e.g., switching tabs) doesn't fix it

## Root Cause

`session.branchName` is set **once at creation time** in `server/pty-handler.ts:175` and **never updated afterward**:

```ts
branchName: branchName || worktreeName || '',
```

The value originates from `git rev-parse --abbrev-ref HEAD` run at session creation (`server/index.ts:870`). Four gaps prevent it from ever being refreshed:

1. **No `.git/HEAD` watcher**: `WorktreeWatcher` (`server/watcher.ts`) only watches `.worktrees/` and `.claude/worktrees/` directories for filesystem changes. It does NOT watch `.git/HEAD` (main repo) or worktree `.git` reference files, so branch checkout events are invisible.

2. **No periodic polling**: No `setInterval` or scheduled task re-reads the current branch for active sessions.

3. **`GET /sessions` serves stale data**: Returns in-memory `Session` objects with their creation-time `branchName`. Unlike `GET /worktrees` (which re-runs `git worktree list --porcelain` on each call), `GET /sessions` never re-reads from git.

4. **Main repo excluded from worktree refresh**: `parseWorktreeListPorcelain()` explicitly skips the main worktree (`wtPath === repoPath`), so even when worktree data is fresh, it can't update the branch for repo sessions.

The only existing update path is the AI-driven `spawnBranchRename()` in `server/hooks.ts`, which broadcasts `session-renamed` — but this is for rename events, not checkout detection.

## Evidence
- `server/pty-handler.ts:175` — `branchName` set once, never mutated except by `spawnBranchRename()`
- `server/watcher.ts:101-113` — `_watchRepo()` only watches worktree directories, not `.git/HEAD`
- `server/index.ts:870` — branch read via `git rev-parse` at creation, result stored immutably
- `server/index.ts:332-333` — `GET /sessions` returns `sessions.list()` (in-memory)
- `server/watcher.ts:66` — `parseWorktreeListPorcelain` skips main worktree
- `frontend/src/lib/state/sessions.svelte.ts:60-94` — `refreshAll()` does not reconcile session branches with fresh git data

## Impact Assessment
- Every repo session and worktree session displays a stale branch name after any `git checkout` / `git switch` operation
- Users cannot tell what branch a session is actually working on
- The PrTopBar branch switcher also shows stale data (it reads from `activeSession.branchName`)
- Worktree sessions are slightly less affected — their *inactive* state re-reads from git, but their *active* state still uses the stale session object

## Recommended Fix Direction

**Watch `.git/HEAD` for changes and update active sessions reactively:**

1. **Extend `WorktreeWatcher`** (or create a new `BranchWatcher`) to watch:
   - `<repoPath>/.git/HEAD` for the main repo
   - `<worktreePath>/.git` (a reference file) for each worktree
   - Use `fs.watch()` on these files; debounce like existing worktree watcher

2. **On HEAD change**: Re-read the branch via `git rev-parse --abbrev-ref HEAD`, update `session.branchName` for any active session in that repo/worktree, and broadcast a `session-renamed` (or new `branch-changed`) WebSocket event.

3. **Optionally enrich `GET /sessions`**: On each call, cross-reference active sessions with a quick `git rev-parse` to serve fresh branch names (adds minor latency but ensures consistency on page load).

4. **Frontend `refreshAll()` reconciliation**: When worktree data arrives with a different branch than the session's `branchName`, update the session state. This handles the case where the watcher misses an event.
