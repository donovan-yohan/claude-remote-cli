# Codex Review Fixes — Org Dashboard

> **Status**: Active
> **Phase**: Follow-up to org dashboard cleanup (PR #42)
> **Source**: Multi-agent Codex review of dy/feat/org-dashboard-phase5 vs master

## Goal

Fix all 10 findings from the Codex multi-agent code review (security, correctness, architecture, test coverage) on the `dy/feat/org-dashboard-cleanup` branch.

## Findings & Fixes

### HIGH (6 findings)

#### F1. Trusted client-supplied ticketContext
- **Files**: `server/index.ts:753`, `:990`, `server/ticket-transitions.ts:158`
- **Issue**: `POST /sessions` trusts caller-supplied `ticketContext` and immediately uses it to mutate GitHub/Jira/Linear state. An authenticated client can forge ticket IDs, sources, or repo paths.
- **Fix**: Validate `ticketContext` server-side before allowing transitions — verify ticket ID format per source, verify the claimed integration is configured, and verify the repo path is a configured workspace.

#### F2. Merged PR transitions unreachable
- **Files**: `server/org-dashboard.ts:135`, `:186`, `:260`
- **Issue**: Only fetches `is:open` PRs but `checkPrTransitions()` contains a `MERGED -> ready-for-qa` path that can never fire. The UI's "All" filter can never show closed/merged PRs.
- **Fix**: Add a separate merged PR fetch (e.g. `is:merged merged:>7days`) specifically for transition checks in `checkPrTransitions`, passing both open and merged PRs to the transition engine.

#### F3. Poller timestamp gap
- **Files**: `server/review-poller.ts:133`, `:179`, `:269`
- **Issue**: `lastPollTimestamp` is saved after the full cycle. Notifications arriving between fetch and save are skipped permanently.
- **Fix**: Capture poll-start timestamp before the fetch and use that as the watermark when saving.

#### F4. Shutdown race in poller
- **Files**: `server/review-poller.ts:57`, `:62`, `server/index.ts:1210`
- **Issue**: `stopPolling()` clears the interval but doesn't cancel/await in-flight polls. A running poll can create worktrees/sessions after `serializeAll()`.
- **Fix**: Track the active poll promise, make `stopPolling()` async and await the in-flight poll, call `await stopPolling()` in the shutdown handler.

#### F5. Premature idempotency update
- **Files**: `server/ticket-transitions.ts:165`, `:196`, `:214`
- **Issue**: `transitionMap.set()` is called before the remote transition succeeds. If the API call fails, retries are suppressed permanently.
- **Fix**: Move `transitionMap.set()` after successful API calls. On failure, do not update the map so retries can proceed.

#### F6. Branch links missing ticket source
- **Files**: `server/ticket-transitions.ts:133`, `server/branch-linker.ts:43`, `server/types.ts:280`
- **Issue**: Branch links don't carry the ticket source, so transitions guess Jira vs Linear from ticket shape and env vars. With both integrations enabled, the wrong system can be driven.
- **Fix**: Add `source: 'github' | 'jira' | 'linear'` to `BranchLink` type, persist it through `branch-linker`, and use the explicit value in transitions instead of guessing.

### MEDIUM (4 findings)

#### F7. SSRF risk via JIRA_BASE_URL
- **Files**: `server/integration-jira.ts:50`, `:89`, `server/ticket-transitions.ts:65`
- **Issue**: `JIRA_BASE_URL` is interpolated directly into outbound requests. A misconfigured env var can leak Jira Basic auth credentials to an attacker-controlled host.
- **Fix**: Validate `JIRA_BASE_URL` at module initialization — parse with `URL` constructor, require `https://` protocol, reject and warn if invalid.

#### F8. hasActiveSession key mismatch
- **Files**: `server/index.ts:290`, `server/branch-linker.ts:117`
- **Issue**: `hasActiveSession` is computed against workspace-root keys, but worktree sessions store `repoPath` as the worktree path. Active review worktrees never show as active.
- **Fix**: Normalize comparison — check if any session's `repoPath` starts with the workspace root, not strict equality.

#### F9. No tests for automation lifecycle
- **Files**: `server/index.ts:581`, `server/review-poller.ts:51`
- **Issue**: `PATCH /config/automations`, forced `autoReviewOnCheckout` disabling, and poller start/stop/shutdown have zero test coverage.
- **Fix**: Add tests for the automation config route, forced disabling logic, poller start/stop behavior, and shutdown await.

#### F10. Jira/Linear transitions untested
- **Files**: `server/ticket-transitions.ts:63`, `:133`
- **Issue**: Tests only cover the GitHub-label path. Jira/Linear transitions, status-mapping lookups, and source-detection are untested.
- **Fix**: Add tests for Jira/Linear transition paths including status-mapping lookups, source detection, and the premature-idempotency fix from F5.

## Approach

1. Fix all 10 findings in priority order (HIGH first, then MEDIUM)
2. Group related fixes: F5+F10 (transitions), F3+F4+F9 (poller), F6+F8 (branch linker)
3. Each fix includes corresponding test coverage
4. All work on the existing `dy/feat/org-dashboard-cleanup` branch

## Key Decisions

1. **Validate, don't resolve** — F1 validates ticket format/config rather than re-fetching from source (too expensive for every session creation)
2. **Separate merged PR fetch** — F2 adds a dedicated merged-PR query rather than changing the main open-PR query, to avoid breaking the existing dashboard view
3. **Async stopPolling** — F4 changes the stopPolling API to async, which is a minor breaking change but necessary for correctness
4. **Source in BranchLink** — F6 adds a required field to the type, requiring updates to all branch-link creation sites
