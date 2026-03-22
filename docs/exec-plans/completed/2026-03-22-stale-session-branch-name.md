# Plan: Fix Stale Session Branch Names

> **Status**: Completed | **Created**: 2026-03-22
> **Source**: `docs/bug-analyses/2026-03-22-stale-session-branch-name-bug-analysis.md`

## Goal

Make session branch names update reactively when users run `git checkout` / `git switch` in the repo or worktree, so the sidebar and PrTopBar always show the current branch.

## Architecture

The fix adds a `BranchWatcher` class that watches `.git/HEAD` files for changes and updates active sessions via a callback. This mirrors the existing `WorktreeWatcher` pattern but targets branch changes instead of worktree directory changes.

**Data flow:**
```
.git/HEAD file changes → BranchWatcher detects → reads new branch name →
  finds matching sessions → updates session.branchName →
    broadcasts 'session-renamed' WebSocket event →
      frontend renameSession() updates sidebar display
```

## Progress

- [x] Task 1: Create `BranchWatcher` class in `server/watcher.ts`
- [x] Task 2: Integrate `BranchWatcher` into `server/index.ts`
- [x] Task 3: Enrich `GET /sessions` with live branch for repo sessions
- [x] Task 4: Add test for `BranchWatcher`

---

### Task 1: Create `BranchWatcher` class in `server/watcher.ts`

**What:** Add a `BranchWatcher` class alongside the existing `WorktreeWatcher`.

**Design:**
- Constructor takes a callback: `(repoOrWorktreePath: string, newBranch: string) => void`
- `rebuild(rootDirs: string[])`: scans all repos in rootDirs, watches `.git/HEAD` for each repo AND `.git` file for each worktree (worktree .git is a reference file that also changes on checkout)
- Uses `fs.watch()` on `.git/HEAD` files, debounced per-path (300ms)
- On change, runs `git rev-parse --abbrev-ref HEAD` in the repo/worktree directory
- Only fires callback if the branch actually changed (track last-known branch per path)

**Key details:**
- For the main repo: watch `<repoPath>/.git/HEAD`
- For worktrees: watch `<worktreePath>/.git/HEAD` (worktrees have a `.git/` directory inside their checkout with their own HEAD)
  - Actually: worktrees under `.worktrees/` may have their `.git` as a reference file, but they also have a separate HEAD at `<repoPath>/.git/worktrees/<name>/HEAD`. Need to verify and watch the correct file.
- Debounce per-path to avoid rapid-fire events during rebase/merge
- Non-persistent watchers (same as WorktreeWatcher)

**File:** `server/watcher.ts`

### Task 2: Integrate `BranchWatcher` into `server/index.ts`

**What:** Wire up the `BranchWatcher` so it updates active sessions and broadcasts events.

**Design:**
1. Create `BranchWatcher` instance alongside `WorktreeWatcher` (line ~245)
2. Pass callback that:
   - Finds all active sessions where `session.repoPath === repoPath` or `session.cwd === worktreePath`
   - Updates `session.branchName` to the new branch
   - Broadcasts `session-renamed` event for each affected session (reuses existing event type — frontend already handles it)
3. Call `branchWatcher.rebuild()` with same `config.workspaces` dirs
4. Also rebuild when workspaces change (same as worktree watcher rebuild)

**File:** `server/index.ts`

### Task 3: Enrich `GET /sessions` with live branch for repo sessions

**What:** When `GET /sessions` is called, re-read the current branch for repo sessions so page loads/refreshes also get fresh data (not just WebSocket events).

**Design:**
- In `sessions.list()` or in the `GET /sessions` handler, for each session with `type === 'repo'`, run a quick `git rev-parse --abbrev-ref HEAD` in `session.repoPath`
- Update `session.branchName` if it changed
- This is a belt-and-suspenders approach — the watcher handles real-time, this handles reconnection/refresh
- Make the endpoint async (it's currently sync)
- Rate-limit: only re-read if last check was >5s ago (cache per session)

**File:** `server/index.ts`

### Task 4: Add test for `BranchWatcher`

**What:** Unit test the BranchWatcher detects branch changes.

**Design:**
- Create a temp git repo
- Create BranchWatcher watching the temp dir
- Simulate a checkout by writing to `.git/HEAD`
- Assert callback fires with correct path and branch name
- Test debounce: rapid changes only fire once

**File:** `test/branch-watcher.test.ts`
