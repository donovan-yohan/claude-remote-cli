---
status: implemented
---
# PR Review Automation

> **Status**: Implemented
> **Phase**: 5 of 5 (Org Dashboard initiative)
> **Parent design**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/donovanyohan-master-design-20260321-160000.md`
> **Depends on**: Phase 1 (org dashboard), Phase 2 (branch linking for PR↔ticket context)

## Goal

Automatically detect when the user is requested as a PR reviewer, create a worktree, check out the PR branch, and optionally run the user's review instructions — so there's already a review started by the time they check in.

## Approach

### Key Decisions

1. **Polling, not webhooks** — local npm package can't receive webhooks without ngrok. Poll `gh api /notifications` with client-side filter for `reason === "review_requested"` (GitHub API doesn't support server-side reason filtering)
2. **Separate module:** `server/review-poller.ts` owns the `setInterval` loop (not org-dashboard.ts — one concern per module)
3. **Lifecycle:** `startPolling(config)` / `stopPolling()` called from `main()`. Timer only starts when `automations.autoCheckoutReviewRequests` is true. Cleared when toggled off via API.
4. **Persistence:** `lastPollTimestamp` in config — survives restarts, prevents re-detecting old requests
5. **Auto-review reuses existing `promptCodeReview`** from WorkspaceSettings — no new field needed
6. **Both toggles default OFF** — auto-review requires auto-checkout to be on (UI enforced)
7. **Global config, not per-group** — simplest first. Per-group can be added later if needed.

### Files to Create

| File | Purpose |
|------|---------|
| `server/review-poller.ts` | Polling loop: fetch notifications, filter for review requests, create worktree + optional auto-review |
| `frontend/src/components/AutomationPanel.svelte` | Toggle controls for auto-checkout and auto-review |

### Files to Modify

| File | Change |
|------|--------|
| `server/types.ts` | Add `automations` to Config |
| `server/index.ts` | Call `startPolling()` / `stopPolling()` from `main()`, add toggle API endpoint |
| `frontend/src/components/OrgDashboard.svelte` | Add AutomationPanel below PR table |

### Reviewer Concerns

- Automation scope is global, not per-group — may need per-group later
- `setInterval` in review-poller.ts must not leak into tests — export start/stop functions, don't auto-start at module level
- Forked PR checkout requires `gh pr checkout` not raw branch names

### Success Criteria

- Auto-checkout toggle creates worktrees on review requests
- Auto-review toggle runs `promptCodeReview` on auto-checkout
- `lastPollTimestamp` persists across restarts
- Both toggles default to OFF
- Polling stops when toggles are turned off
