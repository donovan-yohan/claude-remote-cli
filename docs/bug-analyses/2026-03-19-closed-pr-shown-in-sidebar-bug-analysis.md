# Bug Analysis: Closed PR shown in sidebar

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: Medium
> **Affected Area**: server/sessions.ts, server/git.ts

## Symptoms
- Closed PR #11 still appears in the sidebar next to the "everest" worktree
- The sidebar shows "PR #11" with no indication the PR is closed
- Diff stats (+4588 -346) are from the closed PR, not the working tree

## Reproduction Steps
1. Have a worktree ("everest") whose branch had PR #11
2. Close PR #11 on GitHub
3. Observe the sidebar still shows "PR #11" with the closed PR's diff stats

## Root Cause
`fetchMetaForSession` in `server/sessions.ts:365-391` calls `getPrForBranch()` which runs `gh pr view <branch>`. The `gh pr view` command returns the **most recent** PR for a branch regardless of state (open, closed, or merged). The function then unconditionally uses `pr.number` without checking `pr.state`:

```typescript
const pr = await getPrForBranch(repoPath, branch);
if (pr) {
  prNumber = pr.number;        // ← no state check
  additions = pr.additions;
  deletions = pr.deletions;
}
```

The sidebar `WorkspaceItem.svelte` renders `meta.prNumber` without any state awareness — it has no concept of whether the PR is open, closed, or merged.

## Evidence
- `gh pr view 11 --json state` returns `{"state":"CLOSED"}` confirming the PR is closed
- `getPrForBranch` in `server/git.ts:253-314` includes `state` in its return type but doesn't filter by it
- The dashboard endpoint (`GET /workspaces/dashboard`) correctly uses `--state open` when listing PRs, confirming this is an oversight in the session meta path

## Impact Assessment
- Any closed/merged PR continues to display in the sidebar indefinitely
- Diff stats from closed PRs are misleading (they show the PR's stats, not working tree changes)
- Users may think a PR is still active when it isn't

## Recommended Fix Direction

**Option A (minimal — filter in `fetchMetaForSession`):**
After calling `getPrForBranch`, check `pr.state === 'OPEN'` (or `'DRAFT'`) before using the PR data. Fall through to working tree diff for closed/merged PRs.

**Option B (richer — propagate state to sidebar):**
Add `prState` to `SessionMeta` so the sidebar can show visual differentiation (e.g., strikethrough for closed, purple for merged). This aligns with how `PrTopBar` already handles these states.

Option A is the simplest fix. Option B is more useful but requires frontend changes.
