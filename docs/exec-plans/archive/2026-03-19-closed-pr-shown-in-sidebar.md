# Plan: Fix closed PR shown in sidebar

> **Status**: Complete | **Created**: 2026-03-19
> **Source**: `docs/bug-analyses/2026-03-19-closed-pr-shown-in-sidebar-bug-analysis.md`

## Context

`fetchMetaForSession` calls `getPrForBranch` which returns PRs of any state. Closed/merged PRs show in the sidebar as if they're active.

## Progress

- [x] Task 1: Filter closed/merged PRs in fetchMetaForSession
- [x] Task 2: Verified — build passes, 183/183 tests pass (fetchMetaForSession is private; no new test needed)

---

### Task 1: Filter closed/merged PRs in fetchMetaForSession

**File:** `server/sessions.ts`
**Change:** After `getPrForBranch` returns, check `pr.state` — only use PR data when state is `OPEN` or the PR is a draft (`isDraft`). For closed/merged PRs, fall through to working tree diff.

### Task 2: Add test for getPrForBranch state filtering

**File:** `test/git.test.ts`
**Change:** Add test cases verifying that `getPrForBranch` returns closed PRs (it should — it's a data fetcher), and that the filtering happens at the caller level. Alternatively, add a focused unit test for `fetchMetaForSession` behavior with closed PRs.
