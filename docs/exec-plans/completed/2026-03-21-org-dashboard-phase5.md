# Plan: PR Review Automation (Phase 5)

> **Status**: Completed | **Created**: 2026-03-21
> **Design doc**: `docs/design-docs/2026-03-21-org-dashboard-phase5-design.md`
> **Branch**: `dy/feat/org-dashboard-phase5` (from `dy/feat/org-dashboard-phase4`)

## Goal

Auto-detect GitHub review requests, create worktrees, and optionally run the user's code review prompt — so there's already a review started by the time they check in.

## Tasks

### Task 1: Add automation types to Config
**File:** `server/types.ts`
**Change:** Add `automations` field to the `Config` interface with `autoCheckoutReviewRequests`, `autoReviewOnCheckout`, `lastPollTimestamp`, and `pollIntervalMs` fields.

### Task 2: Create review-poller module
**File:** `server/review-poller.ts` (new)
**Dependencies:** Task 1
**Change:** Create the polling module with:
- `startPolling(deps)` / `stopPolling()` lifecycle functions (no auto-start at module level)
- Poll `gh api /notifications` filtered for `reason === "review_requested"`
- On new review request: resolve owner/repo → workspace path, run `gh pr checkout <number>` in a new worktree
- If auto-review enabled: find workspace's `promptCodeReview` setting and create a session with that as initial prompt
- Persist `lastPollTimestamp` to config after each poll cycle
- Error handling: gh not installed, auth failure, timeout — log and continue
- Export `ReviewPollerDeps` interface for testability (inject exec, config functions)

### Task 3: Integrate poller into server lifecycle
**File:** `server/index.ts`
**Dependencies:** Task 2
**Change:**
- Import `startPolling`, `stopPolling` from `./review-poller.js`
- Call `startPolling()` in `main()` after router setup if `automations.autoCheckoutReviewRequests` is true
- Add `PATCH /config/automations` endpoint to toggle automation settings + start/stop poller
- Add `GET /config/automations` endpoint to read current settings
- Call `stopPolling()` on server close

### Task 4: Add frontend API functions
**File:** `frontend/src/lib/api.ts`
**Dependencies:** Task 3
**Change:** Add `fetchAutomations()` and `updateAutomations(settings)` API functions.

### Task 5: Add frontend types
**File:** `frontend/src/lib/types.ts`
**Dependencies:** Task 1
**Change:** Add `AutomationSettings` interface matching the backend type.

### Task 6: Create AutomationPanel component
**File:** `frontend/src/components/AutomationPanel.svelte` (new)
**Dependencies:** Tasks 4, 5
**Change:** Toggle controls for:
- Auto-checkout review requests (toggle switch)
- Auto-review on checkout (toggle switch, disabled when auto-checkout is off)
- Brief description text explaining what each toggle does
- Uses `@tanstack/svelte-query` for data fetching (matches existing pattern)

### Task 7: Add AutomationPanel to OrgDashboard
**File:** `frontend/src/components/OrgDashboard.svelte`
**Dependencies:** Task 6
**Change:** Import and render `AutomationPanel` below the PR table section.

### Task 8: Build and verify
**Dependencies:** All above
**Change:** Run `npm run build` and `npm test` to verify everything compiles and passes.

## Architecture Notes

- Polling module follows single-concern pattern (like `org-dashboard.ts`, `branch-linker.ts`)
- Uses `gh api /notifications` with client-side `reason === "review_requested"` filter (GitHub API doesn't support server-side reason filtering)
- Worktree creation uses `git fetch origin pull/N/head:<branch>` + `git worktree add` (handles forked PRs via GitHub's `pull/N/head` refspec)
- `promptCodeReview` already exists in `WorkspaceSettings` — no new prompt field needed
- Both toggles default OFF; auto-review depends on auto-checkout being enabled
- `lastPollTimestamp` persists in config to survive restarts

## Drift Log

- Worktree creation changed from `git worktree add -b` + `gh pr checkout` to `git fetch origin pull/N/head:branch` + `git worktree add` — original approach had branch conflicts
- Added `buildPollerDeps()` helper in index.ts to share deps between boot and PATCH handler
- Case-insensitive ownerRepo comparison added (matches org-dashboard.ts pattern)
