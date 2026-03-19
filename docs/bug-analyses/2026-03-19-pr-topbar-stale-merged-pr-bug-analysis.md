# Bug Analysis: PrTopBar shows stale merged PR data for reused branch names

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: Medium
> **Affected Area**: PrTopBar, server/git.ts

## Symptoms
- PrTopBar shows "PR #24 +84 -399 Archive" for the `lhotse` worktree, even though PR #24 was already merged and no new work has started
- The sidebar was already fixed (commit ac3a3b6) but the top bar was not

## Reproduction Steps
1. Complete work on a worktree branch (e.g., `lhotse`), merge the PR
2. Start new work on the same worktree (branch name unchanged)
3. PrTopBar still displays the old merged PR's metadata

## Root Cause
`gh pr view <branch>` returns the most recent PR for a branch regardless of state (OPEN, CLOSED, MERGED). The sidebar was patched to filter `pr.state === 'OPEN'` in `fetchMetaForSession` (server/sessions.ts:376), but `PrTopBar.svelte` consumes `prQuery.data` without filtering, so merged/closed PRs still render in the top bar.

Additionally, this problem is amplified by the worktree naming convention: mountain peak names (lhotse, makalu, kilimanjaro) are reused across feature cycles, so the same branch name accumulates PR history on GitHub.

## Evidence
- `gh pr view lhotse --json number,state` → `{"number":24,"state":"MERGED"}`
- PrTopBar.svelte:66-67 — `let pr = $derived(prQuery.data ?? null)` with no state filter
- Sidebar fix in ac3a3b6 only patched server/sessions.ts, not the PrTopBar path

## Key Finding: Branch names are independent of worktree directories
Git worktree directory names and branch names are fully independent. `git branch -m lhotse new-name` renames the branch while the worktree directory stays `.worktrees/lhotse`. This means the planned v3 branch auto-rename feature would naturally prevent stale PR associations.

## Impact Assessment
- Any worktree reusing a branch name that previously had a PR will show stale PR data in the top bar
- The "Archive" button is shown for already-merged PRs, which is confusing for new work
- Diff stats (+84 -399) are misleading as they reflect the old PR, not current work

## Recommended Fix Direction
Two complementary fixes:

1. **Short-term**: Filter merged/closed PRs in PrTopBar — either suppress the PR section entirely when state !== 'OPEN', or only show the Archive button (no diff stats/link) for merged/closed PRs
2. **Long-term**: Implement branch auto-rename (v3 design) so reused worktree names get fresh branch names, avoiding GitHub PR history conflicts entirely
