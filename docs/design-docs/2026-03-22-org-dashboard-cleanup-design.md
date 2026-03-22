# Org Dashboard Cleanup

> **Status**: Planned
> **Phase**: Follow-up to Phases 1-5
> **Depends on**: PRs #38-#41 merged

## Goal

Address all deferred items from the org dashboard PR review cycle — testing gaps, correctness issues, and quality improvements.

## Follow-up Items

### Testing Gaps

#### T1. Tests for Jira integration router
- **Source**: PR #40 review
- **What**: `server/integration-jira.ts` has no unit tests
- **How**: Create `test/integration-jira.test.ts` mirroring `test/integration-github.test.ts` — mock HTTP responses for `/configured`, `/issues`, `/statuses` endpoints
- **Priority**: Medium

#### T2. Tests for Linear integration router
- **Source**: PR #40 review
- **What**: `server/integration-linear.ts` has no unit tests
- **How**: Create `test/integration-linear.test.ts` — mock GraphQL responses for `/configured`, `/issues`, `/states`
- **Priority**: Medium

#### T3. Tests for Jira/Linear ticket transition paths
- **Source**: PR #40 review
- **What**: `ticket-transitions.ts` Jira/Linear branches not tested
- **How**: Add test cases to existing `test/ticket-transitions.test.ts` — mock `getStatusMapping()` return values, test transition ordering
- **Priority**: Medium

#### T4. Tests for review-poller module
- **Source**: PR #41 review
- **What**: `server/review-poller.ts` has no unit tests despite dependency-injected design
- **How**: Create `test/review-poller.test.ts` — mock `execAsync`, config load/save; test notification filtering, worktree creation, first-run guard, JSON parse safety
- **Priority**: Medium

### Correctness

#### C1. Multi-repo issue number collision in branch linker
- **Source**: PR #39 review
- **What**: `getBranchLinksForIssue` keys on issue number alone (`GH-123`), not unique across repos. `getTicketIdForPr` matches branch name without repo context.
- **How**: Namespace keys as `${repoName}#${issueNumber}` or pass `repoPath` through the linking chain. Update `branch-linker.ts`, callers, and frontend `getTicketIdForPr`.
- **Priority**: High (incorrect data display)

#### C2. `detectTicketSource()` ambiguous for 3+ char ticket prefixes
- **Source**: PR #40 review
- **What**: When both Jira and Linear are configured, 3+ character prefixes (e.g., `ENG-123`) can't be reliably attributed to either provider.
- **How**: Check ticket prefix against configured Jira `projectKey` and Linear `teamId` explicitly before falling back to length heuristic.
- **Priority**: Low (rare configuration overlap)

#### C3. `setInterval` overlap with slow `pollOnce`
- **Source**: PR #41 review
- **What**: If `pollOnce` takes longer than the interval, calls overlap (concurrent worktree creation, config writes).
- **How**: Add `let polling = false` guard at top of `pollOnce`; skip if already running.
- **Priority**: Low (5-min default makes overlap near-impossible)

### Dead Code / Config

#### D1. `enableIssues` config flag not wired
- **Source**: PR #39 review
- **What**: `Config.integrations.github.enableIssues` exists in types but nothing reads it.
- **How**: Either wire it to skip GitHub Issues fetching when `false`, or remove the field.
- **Priority**: Low

#### D2. Dead `ticketId` in TicketCard
- **Source**: PR #40 review
- **What**: Unused `$derived` variable in `frontend/src/components/TicketCard.svelte`.
- **How**: Remove the dead computed property.
- **Priority**: Low

### Performance

#### P1. `getStatusMapping()` repeated disk reads
- **Source**: PR #40 review
- **What**: `loadConfig(configPath)` called inside loop for each PR transition check.
- **How**: Hoist `loadConfig` call before the loop, pass config as parameter.
- **Priority**: Low (negligible at current scale)

#### P2. Non-fatal GitHub errors not cached
- **Source**: PR #39 review
- **What**: Repos that consistently fail `gh issue list` get re-polled every request.
- **How**: Cache error results with short TTL (e.g., 5 minutes).
- **Priority**: Low

### UX

#### U1. `activeTab` on unconfigured integration
- **Source**: PR #40 review
- **What**: Tab can remain set to Jira/Linear after deconfiguration; error state is handled but confusing.
- **How**: Auto-switch to first configured tab on data load, or disable unconfigured tab buttons.
- **Priority**: Low

#### U2. Org dashboard action pill not actionable
- **Source**: PR #38 review
- **What**: Action pills render as `<button>` with hover effects but no `onclick`.
- **How**: Either make non-interactive (`<span>`) or add click-to-navigate-to-workspace behavior.
- **Priority**: Low

### API Limitations (Document Only)

#### A1. `requested_reviewers` not in GitHub search API
- **Source**: PR #38 review
- **What**: Reviewer detection is best-effort; `search/issues` doesn't return this field.
- **Action**: Add note to `docs/LEARNINGS.md`

#### A2. `reviewDecision` not in search API
- **Source**: PR #38 review
- **What**: PR status dot always shows "success" because field is null.
- **Action**: Add note to `docs/LEARNINGS.md`

#### A3. "All" filter shows only open PRs
- **Source**: PR #38 review
- **What**: Backend query is `is:open`; "All" only filters the returned open PRs.
- **Action**: Either rename to "Open/Review Requested" or add closed PR fetching.

## Approach

### Scope for cleanup PR

Focus on items that improve **correctness and test coverage**:
- All T items (testing gaps) — highest value per effort
- C1 (multi-repo collision) — correctness
- C3 (polling overlap guard) — one-line fix
- D1, D2 (dead code removal) — trivial
- P1 (config in loop) — easy hoist
- A1-A3 (documentation) — quick doc updates

Defer UX items (U1, U2), performance optimizations (P2), and the ticket source ambiguity (C2) to a separate UX polish pass.

## Key Decisions

1. **Tests over features** — this cleanup is about hardening, not adding functionality
2. **Target PR #41 as base** — cleanup PR stacks on the full org dashboard chain
3. **No new modules** — only test files, fixes to existing code, and doc updates
