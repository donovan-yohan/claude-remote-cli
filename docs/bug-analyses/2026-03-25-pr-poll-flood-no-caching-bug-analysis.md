# Bug Analysis: PR Poll Flood — No Negative Caching for Branches Without PRs

> **Status**: Confirmed | **Date**: 2026-03-25
> **Severity**: Medium
> **Affected Area**: server/webhook-manager.ts, server/workspaces.ts, frontend/src/App.svelte, frontend/src/components/PrTopBar.svelte

## Symptoms
- Network tab shows 128+ requests accumulating, many returning 404
- Requests alternate between `prs` (org-dashboard) and `pr?path=%2FUsers%2Fdonova...` (per-session PR lookup)
- All `pr?path=` requests for branches without PRs return 404
- Continuous polling even when nothing has changed — no user activity, no branch changes, no PR creation

## Reproduction Steps
1. Configure multiple workspaces without GitHub webhooks enabled
2. Open any workspace session where the active branch has no open PR
3. Open browser DevTools → Network tab
4. Wait 30+ seconds and observe repeated `pr?path=` requests returning 404, interleaved with `prs` requests

## Root Cause

Three compounding issues create an excessive polling cascade with no intelligence about when to stop:

### 1. Smart polling broadcasts per-repo events in a loop (`server/webhook-manager.ts:78-81`)

Every 30 seconds, `startSmartPolling` iterates over all unwebhooked workspaces and broadcasts separate `pr-updated` + `ci-updated` WebSocket events for each repo:

```typescript
for (const [ownerRepo] of repoMap) {
  broadcastEvent('pr-updated', { repo: ownerRepo });
  broadcastEvent('ci-updated', { repo: ownerRepo });
}
```

With N unwebhooked workspaces, this emits 2N WebSocket events per cycle.

### 2. Frontend invalidates all PR queries for every event (`frontend/src/App.svelte:305-312`)

Each `pr-updated` or `ci-updated` event triggers three blanket invalidations:

```typescript
queryClient.invalidateQueries({ queryKey: ['org-prs'] });
queryClient.invalidateQueries({ queryKey: ['pr'] });
queryClient.invalidateQueries({ queryKey: ['ci-status'] });
```

No deduplication — N events → N × 3 invalidation calls. TanStack deduplicates in-flight requests per query key, but the events arrive in rapid succession across microtasks.

### 3. No negative caching — "no PR found" triggers the same polling as "PR exists" (`server/workspaces.ts:544, PrTopBar.svelte:44-49`)

The `/workspaces/pr` endpoint spawns `gh pr view <branch>` (a subprocess + GitHub API call) on every request and returns HTTP 404 when no PR exists. The frontend's `fetchPrForBranchOrNull` returns `null`, and TanStack caches this as `data: null` with `staleTime: 60_000`. But every smart polling event invalidates this cache, forcing a refetch that spawns another subprocess and hits the GitHub API again — even though nothing has changed.

**The key missing insight**: once a branch has no PR, the only things that can create one are:
- User action (`gh pr create`, GitHub UI)
- A `ref-changed` event (push to remote)

Neither of these happens during idle polling. The smart polling broadcast is purely a "re-check for changes" signal, but for a branch that already has no PR, there's nothing to re-check unless something actually changed.

## Evidence

- `server/webhook-manager.ts:78-81`: Per-repo loop broadcasting — each repo generates its own event
- `server/workspaces.ts:535,544`: `getPrForBranch()` spawns `gh pr view` subprocess on every call; returns 404 for missing PRs
- `server/git.ts:236-246`: Each call spawns `gh pr view <branch> --json ...` with 5s timeout — a GitHub API call
- `frontend/src/App.svelte:305-312`: Blanket invalidation with no debouncing or repo filtering
- `frontend/src/components/PrTopBar.svelte:44-49`: `staleTime: 60_000` is moot because invalidation overrides staleness
- `server/org-dashboard.ts:103`: `/org-dashboard/prs` has server-side cache (60s TTL), so `prs` requests are cheap. But `/workspaces/pr` has NO server-side cache — every request spawns a subprocess
- Screenshot: 128 requests with 2.7kB transferred — mostly 404 responses from cached-nothing refetches

## Impact Assessment
- **GitHub API rate**: Each uncached `pr?path=` request spawns `gh pr view` which counts against the 5000 req/hr authenticated rate limit
- **Server load**: Each request spawns a child process (`gh`) with 5s timeout
- **Browser network**: 404s pollute the network tab, make real issues harder to spot
- **Battery/bandwidth**: Continuous polling on mobile wastes resources for zero benefit

## Recommended Fix Direction

Per user's insight: **if we already polled and there's no PR, wait for the user to visit the session or for a branch change before polling again.**

1. **Server-side negative cache** on `/workspaces/pr`: Cache "no PR" results per branch for 5 minutes. Invalidate on `ref-changed` or `pr-updated` webhook events.
2. **Batch smart polling broadcasts**: Replace per-repo loop with a single `pr-updated` event containing all repos.
3. **Debounce frontend invalidation**: Coalesce rapid `pr-updated`/`ci-updated` events into a single invalidation cycle (e.g., 500ms debounce).
4. **PrTopBar: stop refetching null results on poll events**: When `prQuery.data` is `null`, only refetch on explicit user action (refresh button), `ref-changed` events for the specific session, or when the session first becomes visible. Use TanStack's `enabled` option to gate refetching.
5. **HTTP semantics**: Return `200 { pr: null }` instead of `404` for "no PR found" — 404 should mean "endpoint not found", not "query returned empty".

## Architecture Review

### Systemic Spread
- `server/workspaces.ts:544,547`: Two identical `res.status(404)` calls for "no PR" — both the `try` success path (pr is null) and the `catch` path return 404. The pattern of returning 404 for valid "no data" queries appears in no other endpoint — all other 404s (`server/hooks.ts:164`, `server/index.ts:817,1110,1130,1153`) correctly indicate "resource not found" (session doesn't exist, preset doesn't exist).
- `frontend/src/App.svelte:282-284` and `App.svelte:310-312`: The `invalidatePrQueries()` function and the `pr-updated`/`ci-updated` handler both call the same 3 invalidations. The `session-ended` handler (line 295) and `ref-changed` handler (line 303) both call `invalidatePrQueries()`, which means `ref-changed` events also trigger blanket invalidation of ALL PR queries (not just the affected workspace). This is the same "invalidate everything" pattern repeated across 4 call sites with no per-workspace targeting.

### Design Gap
The PR data layer has no concept of **per-workspace query targeting**. The WebSocket event handler receives `repo` in the event payload but discards it — invalidating ALL queries regardless of which repo changed. The TanStack query keys already include workspace path (`['pr', workspacePath, currentBranch]`), which means targeted invalidation is architecturally possible but not wired up.

Additionally, there's no server-side caching layer for the `/workspaces/pr` endpoint. The org-dashboard endpoint has a `CACHE_TTL_MS = 60_000` cache (`server/org-dashboard.ts:15,103`), but the per-branch PR endpoint spawns a subprocess on every call. The caching responsibility is split: some endpoints cache server-side, some rely entirely on frontend `staleTime`, and the invalidation events bypass both.

A better design would:
- Use per-workspace query invalidation on the frontend: `queryClient.invalidateQueries({ queryKey: ['pr', affectedWorkspacePath] })`
- Add a server-side negative cache for PR lookups, invalidated by incoming webhook events
- Establish a consistent caching strategy: either all GitHub-backed endpoints cache server-side, or the frontend has smart staleness policies that the backend doesn't override

### Testing Gaps
- **Missing test cases:** No test verifies that smart polling doesn't generate N separate WebSocket events for N workspaces. A test like `startSmartPolling(configWith5Workspaces)` → assert `broadcastEvent` called at most 2 times (not 10) would catch the multiplication.
- **Missing test cases:** No test verifies that `/workspaces/pr` returns consistent HTTP status for "no PR" — a test asserting `GET /workspaces/pr?path=...&branch=no-pr-branch` returns 200 with `null` body would prevent the 404 misuse.
- **Infrastructure gaps:** No integration test exercises the full poll → WebSocket → invalidation → refetch cycle. The smart polling, WebSocket broadcast, and TanStack invalidation are tested (if at all) in isolation, so cascade volume issues are invisible.

### Harness Context Gaps
- `docs/ARCHITECTURE.md` describes `webhook-manager.ts` as "GitHub webhook CRUD, smee client lifecycle, health state, auto-provision backfill" but does not mention the smart polling fallback behavior or its 30-second interval. The polling is a significant architectural feature that affects network volume.
- No documentation describes the PR data caching strategy — which endpoints cache server-side vs relying on frontend `staleTime`, or how WebSocket invalidation events interact with TanStack query caches.
