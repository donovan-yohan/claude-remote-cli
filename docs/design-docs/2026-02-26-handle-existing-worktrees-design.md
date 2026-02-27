# Handle Existing Worktrees Design

**Date:** 2026-02-26
**Status:** Proposed

## Problem

When creating a worktree for a branch that's already checked out (either in the main worktree or another worktree), `git worktree add` fails with:

```
fatal: '<branch>' is already used by worktree at '<path>'
```

The server surfaces this as a raw 500 error. Users expect the UI to detect this and redirect to the existing worktree.

Additionally, worktrees at arbitrary paths (outside `.worktrees/` and `.claude/worktrees/`) cannot be deleted from the UI because `isValidWorktreePath` rejects them.

## Design

### Change 1: Auto-redirect to existing worktree on branch conflict

**Where:** `POST /sessions` in `server/index.ts`

After confirming the branch exists locally, check `git worktree list --porcelain` to see if it's already checked out somewhere. If so, skip `git worktree add` and open a session at the existing path.

**Logic:**

```
if (branchName && branchExists) {
  // NEW: Check if branch is already checked out in a worktree
  const worktrees = parseWorktreeListPorcelain(gitWorktreeList, repoPath);
  const existing = findWorktreeForBranch(allWorktrees, branchName);

  if (existing is main worktree) {
    → create repo session at repoPath (same as POST /sessions/repo)
  } else if (existing is another worktree) {
    → create worktree session at existing.path with --continue
  } else {
    → proceed with git worktree add as before
  }
}
```

**Key details:**
- Must include the main worktree in the search (currently `parseWorktreeListPorcelain` skips it). Write a variant or separate search that includes all entries.
- When redirecting to the main worktree, create a **repo session** (auto-detect).
- When redirecting to another worktree, create a **worktree session** with `--continue`.
- Return 201 with the session — the frontend doesn't need to know about the redirect.

### Change 2: Git-based delete validation

**Where:** `DELETE /worktrees` in `server/index.ts`, `isValidWorktreePath` in `server/watcher.ts`

Replace directory-name validation with git-based validation: a path is valid for deletion if it appears in `git worktree list --porcelain` output for the given repo.

**Logic:**

```
// Instead of: isValidWorktreePath(worktreePath) — checks directory name
// Use: isGitWorktree(repoPath, worktreePath) — checks git worktree list

async function isGitWorktree(repoPath, worktreePath): boolean {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
  const allWorktrees = parseAllWorktrees(stdout);  // includes main
  return allWorktrees.some(wt => wt.path === worktreePath && wt.path !== repoPath);
}
```

**Safety:** Still prevent deleting the main worktree (that would be destructive). Only allow deleting non-main worktrees that git recognizes.

### Change 3: Helper to find worktree by branch (including main)

**Where:** `server/watcher.ts`

Add a `parseAllWorktrees` function that works like `parseWorktreeListPorcelain` but includes the main worktree. This is used by both Change 1 (branch conflict detection) and Change 2 (delete validation).

```typescript
interface ParsedWorktreeEntry {
  path: string;
  branch: string;
  isMain: boolean;
}

function parseAllWorktrees(stdout: string, repoPath: string): ParsedWorktreeEntry[]
```

## Files Changed

| File | Change |
|------|--------|
| `server/watcher.ts` | Add `parseAllWorktrees` function, `ParsedWorktreeEntry` type |
| `server/index.ts` | Update `POST /sessions` with branch-conflict detection; update `DELETE /worktrees` with git-based validation |

## Non-Changes

- `GET /worktrees` — already uses `git worktree list` for discovery; main worktree skip is correct for listing
- `WorktreeWatcher` — no change; filesystem watching scope is unchanged
- Frontend — no changes needed; the redirect is transparent (same 201 response shape)

## Edge Cases

1. **Branch checked out in main worktree** → auto-detect, create repo session
2. **Branch checked out in worktree outside `.worktrees/`** → create worktree session there
3. **Branch checked out in `.worktrees/` dir** → create worktree session (existing behavior, just detected earlier)
4. **Orphaned worktree (directory exists but git doesn't track it)** → existing fallback handles this
5. **Deleting worktree at arbitrary path** → git-validated, allowed if git recognizes it
6. **Attempting to delete main worktree** → rejected (path === repoPath check)
