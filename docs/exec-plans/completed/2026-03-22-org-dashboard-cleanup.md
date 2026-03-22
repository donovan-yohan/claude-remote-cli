# Plan: Org Dashboard Cleanup

> **Status**: Completed | **Created**: 2026-03-22
> **Design doc**: `docs/design-docs/2026-03-22-org-dashboard-cleanup-design.md`
> **Branch**: `dy/feat/org-dashboard-cleanup` (from `dy/feat/org-dashboard-phase5`)

## Goal

Address deferred review items: testing gaps, correctness fixes, dead code removal, perf fix, and documentation.

## Tasks

### Task 1: Tests for Jira integration router
**File:** `test/integration-jira.test.ts` (new)
**Change:** Create tests mirroring `test/integration-github.test.ts`:
- Mock `JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_BASE_URL` env vars
- Mock `fetch` for Jira REST API responses
- Test `GET /configured` returns true/false based on env vars
- Test `GET /issues` returns mapped JiraIssue array with caching
- Test `GET /statuses?projectKey=X` returns workflow statuses
- Test error cases: auth failure (401), missing env vars, network timeout

### Task 2: Tests for Linear integration router
**File:** `test/integration-linear.test.ts` (new)
**Change:** Create tests mirroring Jira test structure:
- Mock `LINEAR_API_KEY` env var
- Mock `fetch` for Linear GraphQL responses
- Test `GET /configured` returns true/false
- Test `GET /issues` returns mapped LinearIssue array with caching
- Test `GET /states?teamId=X` returns workflow states
- Test error cases: auth failure, missing env vars, non-ok response

### Task 3: Tests for Jira/Linear ticket transition paths
**File:** `test/ticket-transitions.test.ts` (modify)
**Change:** Add test cases for:
- `detectTicketSource()` returning 'jira' vs 'linear' vs 'github'
- Jira transition: mock fetch to `/rest/api/3/issue/{id}/transitions`, verify correct transition ID sent
- Linear state update: mock GraphQL mutation, verify correct state ID sent
- Transition ordering: verify `transitionMap.set()` only after successful transition
- Missing status mapping: verify graceful skip when no mapping configured

### Task 4: Tests for review-poller module
**File:** `test/review-poller.test.ts` (new)
**Change:** Test with dependency-injected mocks:
- `startPolling` / `stopPolling` / `isPolling` lifecycle
- `pollOnce` filters notifications by `lastPollTimestamp`
- First-run guard: default timestamp is "now", not epoch
- JSON parse safety: non-JSON lines in gh output are skipped
- Worktree dedup: existing worktree path skipped
- Case-insensitive ownerRepo matching
- Error handling: gh not installed (ENOENT), timeout, auth failure

### Task 5: Polling overlap guard
**File:** `server/review-poller.ts`
**Change:** Add `let pollInFlight = false` module-level flag. At top of `pollOnce`, return early if flag is set. Set to true at start, false in finally block.

### Task 6: Hoist `loadConfig` out of transition loop
**File:** `server/ticket-transitions.ts`
**Change:** In `checkPrTransitions` and `transitionOnSessionCreate`, load config once before the loop and pass it to `getStatusMapping()` as a parameter instead of re-reading from disk per iteration.

### Task 7: Remove dead code
**Files:** `frontend/src/components/TicketCard.svelte`, `server/types.ts`
**Change:**
- Remove unused `ticketId` derived variable from TicketCard (lines 34-38)
- Remove `enableIssues` from `Config.integrations.github` type (dead config field)

### Task 8: Document API limitations in LEARNINGS.md
**File:** `docs/LEARNINGS.md`
**Change:** Add entries:
- L-006: GitHub Search API doesn't return `requested_reviewers` — reviewer detection is best-effort in org dashboard
- L-007: GitHub Search API doesn't return `reviewDecision` — PR status dot defaults to success
- L-008: Org dashboard "All" filter operates on `is:open` backend query — can't show closed PRs without additional API call

### Task 9: Build and verify
**Dependencies:** All above
**Change:** Run `npm run build` and `npm test` to verify everything compiles and passes.

## Drift Log

_(empty — no deviations yet)_
