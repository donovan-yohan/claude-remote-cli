# Bug Analysis: Worktree branch name reuse causes stale PR associations

> **Status**: Confirmed | **Date**: 2026-03-25
> **Severity**: High
> **Affected Area**: server/workspaces.ts (worktree creation), server/git.ts (PR lookup), server/sessions.ts (session meta), PrTopBar.svelte
> **Recurrence of**: 2026-03-19-closed-pr-shown-in-sidebar, 2026-03-19-pr-topbar-stale-merged-pr

## Symptoms
- New worktrees created with recycled mountain names (e.g., `kilimanjaro`, `everest`) immediately show old merged/closed PRs
- PR #27 (CLOSED) appears for `everest` branch; PR #28 (MERGED) appears for `kilimanjaro` branch
- PrTopBar shows stale diff stats, PR links, and action buttons (e.g., "Archive") for PRs that are already merged/closed
- Users cannot get a "fresh start" — every new worktree inherits the PR history of its branch name

## Reproduction Steps
1. Create worktree → gets branch `kilimanjaro`, PR #28 created and merged
2. Delete/archive worktree (local branch deleted via `git branch -D`)
3. Create another worktree → `nextMountainIndex` cycles back, collision check passes (local branch gone), new branch `kilimanjaro` created off `master`
4. `gh pr view kilimanjaro` returns merged PR #28 — GitHub remembers the branch→PR association forever
5. PrTopBar and sidebar display the stale PR data

## Root Cause

**Two compounding issues:**

### 1. Branch name reuse (primary)
`POST /workspaces/worktree` (workspaces.ts:620-641) assigns mountain names from a 31-item rotating list. The collision check only verifies:
- `git rev-parse --verify <branch>` — does the local branch exist?
- `fs.existsSync(<path>)` — does the directory exist?

When a worktree is deleted (`DELETE /worktrees`, index.ts:862-929), the local branch is deleted (`git branch -D`), so the collision check passes on the next cycle. But **GitHub permanently associates branch names with PRs** — `gh pr view <branch>` returns the most recent PR for that branch name regardless of state.

### 2. No stale PR filtering (amplifier)
Neither code path filters out MERGED/CLOSED PRs:

- **PrTopBar path**: `GET /workspaces/pr` (workspaces.ts:534-549) returns the PR regardless of state. Line 541 explicitly returns merged/closed PRs with `unresolvedCommentCount: 0`.
- **Sidebar path**: `fetchMetaForSession` (sessions.ts:507-511) calls `getPrForBranch()` and uses `pr.number` with no state check.
- **Prior partial fix regressed**: The 2026-03-19 analysis noted a sidebar fix in commit ac3a3b6 filtering `pr.state === 'OPEN'`, but current code (sessions.ts:508-511) has no such filter.

## Evidence
- `gh pr view kilimanjaro --json number,state` → `{"number":28,"state":"MERGED"}`
- `gh pr view everest --json number,state` → `{"number":27,"state":"CLOSED"}`
- workspaces.ts:534-549 — `GET /workspaces/pr` returns PR regardless of state
- sessions.ts:507-511 — `fetchMetaForSession` uses PR with no state filter
- workspaces.ts:631 — collision check only tests local branch existence
- index.ts:919 — `git branch -D` deletes local branch but GitHub retains PR association
- Screenshots confirm PrTopBar showing "PR #28 +494 -412 Archive" for freshly-created `kilimanjaro` worktree

## Impact Assessment
- **Every worktree** that reuses a mountain name with PR history shows stale data
- With only 31 mountain names, this becomes inevitable after moderate use
- Stale "Archive" buttons on merged PRs are confusing — users may think the PR is still active
- Diff stats from old PRs are misleading for new work
- Branch auto-rename (on first message) mitigates this after the first interaction, but the initial state is always broken

## Recommended Fix Direction

### Layer 1: Unique branch names (eliminates the root cause)
Append a short unique suffix to mountain branch names: e.g., `kilimanjaro-a3f2` where `a3f2` is 4 chars of random hex. This ensures `gh pr view` never matches a historical PR.

Changes needed:
- `POST /workspaces/worktree` (workspaces.ts:626-627): generate suffix, append to branch name
- Collision check: adapt to the new naming (still check `git rev-parse` + dir exists)
- The suffix is ephemeral — branch auto-rename replaces it after the first message anyway

### Layer 2: Filter stale PRs (defense in depth)
Even with unique names, add filtering as a guardrail:
- `GET /workspaces/pr`: return 404 when `pr.state` is MERGED or CLOSED **and** the PR was last updated more than 1 day ago
- `fetchMetaForSession`: same filter — MERGED/CLOSED + older than 1 day
- The 1-day grace period allows users to see a just-merged PR before it disappears (useful for the archive flow)

### Layer 3: Local branch cleanup only
- Local branch cleanup on worktree delete is already implemented (`git branch -D`, index.ts:919) — verify it works correctly
- **Do NOT delete remote branches** — respect the user's repo configuration (e.g., GitHub "delete branch on merge" setting). Remote branch lifecycle is the repo owner's responsibility.

## Architecture Review

### Systemic Spread
The stale PR issue affects every consumer of `getPrForBranch()`:
1. `GET /workspaces/pr` → PrTopBar (confirmed affected)
2. `fetchMetaForSession` → sidebar PR badge (confirmed affected)
3. `GET /workspaces/dashboard` → uses `--state open` in its own query, so NOT affected (dashboard has its own PR fetching via `gh pr list`)

The stale-PR problem is confined to the two paths that use `getPrForBranch()` without filtering. The fix should be applied at `getPrForBranch()` itself or immediately after each call site.

### Design Gap
The worktree naming system treats mountain names as reusable identifiers, but the GitHub API treats branch names as permanent identifiers. This impedance mismatch was identified in the 2026-03-19 analysis but the recommended long-term fix (unique branch names) was never implemented. The branch auto-rename feature partially addresses this but only kicks in after user interaction — the initial state is always broken.

The 31-name rotation means collisions are **guaranteed** for active projects, not theoretical.

### Testing Gaps
No tests verify that:
1. A reused mountain name with a historical PR returns clean state
2. `GET /workspaces/pr` filters merged/closed PRs for fresh branches
3. The collision check handles the case where a branch doesn't exist locally but has GitHub PR history

### Harness Context Gaps
The prior bug analyses (2026-03-19) identified both the short-term (filter) and long-term (unique names) fixes. The short-term filter was applied to the sidebar but either regressed or was never applied to the PrTopBar path. No learning was captured about the need for unique branch names, so the long-term fix never entered the implementation pipeline.
