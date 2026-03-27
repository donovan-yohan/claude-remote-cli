# Bug Analysis: Inactive Worktrees Not Shown in Sidebar

> **Status**: Confirmed | **Date**: 2026-03-26
> **Severity**: High
> **Affected Area**: `server/index.ts` (GET /worktrees), `frontend/src/components/Sidebar.svelte`

## Symptoms
- Existing worktrees (e.g., `rainier` with branch `tui-outline-aesthetic`) not visible in the sidebar
- Only worktrees with active sessions appear (via session grouping, not worktree discovery)
- Killing an active session makes its worktree disappear entirely
- Opening a PR branch session fails with "branch already used by worktree" because the app doesn't know the worktree exists and tries to create a duplicate

## Reproduction Steps
1. Add a workspace directly (not via rootDir scanning)
2. Create a worktree in that workspace (e.g., via "new worktree" button)
3. Start a session in the worktree — it shows in sidebar via session grouping
4. Kill the session — the worktree disappears from sidebar
5. Try to open a PR session for the same branch — fails with duplicate checkout error

## Root Cause

**`GET /worktrees` only scans `config.rootDirs`, not `config.workspaces`.**

The worktree discovery endpoint (`server/index.ts:609-698`) builds its scan list from `config.rootDirs` — it iterates root directories, finds repos by checking for `.git/`, then runs `git worktree list --porcelain` on each.

However, workspaces can be added individually to `config.workspaces[]` without their parent directory being in `config.rootDirs[]`. When this happens, `GET /worktrees` never scans that workspace's repo, so all its worktrees are invisible to the frontend.

The sidebar (`Sidebar.svelte:186-190`) filters `sessionState.worktrees` by `wt.repoPath === workspace.path`. Since the worktree endpoint returns nothing for workspaces outside rootDirs, this produces an empty list.

Worktrees with active sessions still appear because the session grouping logic (`groupedByPath` at line 191-200) groups sessions by `worktreePath`, which is set during session creation and doesn't depend on worktree discovery.

## Evidence

**Data flow trace:**
1. `GET /workspaces` (line 171): returns paths from `config.workspaces[]` — includes directly-added workspaces
2. `GET /worktrees` (line 618-639): scans repos under `config.rootDirs[]` — does NOT include `config.workspaces[]`
3. `git worktree list --porcelain` returns `rainier` correctly when run from the repo
4. Sidebar filter at line 186-190 gets empty `sessionState.worktrees` for unscanned workspaces
5. Active sessions still show via `sessionsByGroup` / `groupedByPath` (independent of worktree discovery)

**Confirming test:** User killed the active session on `everest-9436` — it disappeared, confirming it was only visible via the session path, not worktree discovery.

## Impact Assessment
- All workspaces added directly (not discovered via rootDirs) lose inactive worktree visibility
- Users cannot resume work in inactive worktrees — they're invisible
- PR session creation fails when branch is already checked out in an undiscovered worktree
- The `findOrCreateWorktreeForBranch` fix (v3.17.1) mitigates the creation crash but doesn't fix visibility

## Recommended Fix Direction

**Primary fix:** In `GET /worktrees` (`server/index.ts`), include `config.workspaces[]` in `reposToScan` alongside rootDir-discovered repos. Deduplicate by path to avoid double-scanning repos that appear in both.

```typescript
// After rootDir scanning loop, also add directly-configured workspaces
const configWorkspaces = getConfig().workspaces ?? [];
for (const wp of configWorkspaces) {
  if (reposToScan.some(r => r.path === wp)) continue; // already discovered via rootDir
  const root = roots.find(r => wp.startsWith(r)) || '';
  reposToScan.push({ path: wp, name: wp.split('/').filter(Boolean).pop() || '', root });
}
```

**Secondary consideration:** The sidebar has two competing worktree rendering paths — `buildSidebarItems()` (in `sidebar-items.ts`) and the inline filter in `Sidebar.svelte`. These should be unified to prevent future divergence.

## Architecture Review

### Systemic Spread
The `config.workspaces` vs `config.rootDirs` split is a known duality — workspaces can come from either source. But the worktree endpoint only consults one source. Any other endpoint that needs "all repos" would have the same gap.

**Affected:** Only `GET /worktrees` currently. The branches endpoint (`GET /branches`) takes `?repo=` param so it works per-workspace.

### Design Gap
There is no single "get all repo paths" helper. Each endpoint reconstructs the list differently:
- `GET /workspaces` reads `config.workspaces[]`
- `GET /worktrees` scans `config.rootDirs[]`
- Review poller uses `deps.getWorkspacePaths()` which reads `config.workspaces[]`

A shared `getAllRepoPaths(config)` that merges both sources would prevent this class of bug.

### Testing Gaps
No integration test covers the scenario where a workspace exists in `config.workspaces` but not under any `rootDir`. The worktree discovery tests likely only test the rootDir path.

### Harness Context Gaps
None — the bug is purely a code-level data source mismatch.
