# PR Poll Flood Fix — Negative Caching + Targeted Invalidation

> **Status**: Completed | **Created**: 2026-03-25
> **Bug analysis**: `docs/bug-analyses/2026-03-25-pr-poll-flood-no-caching-bug-analysis.md`
> **Branch**: `fix/pr-poll-flood`

## Summary

Fix excessive PR polling by adding server-side negative caching for `/workspaces/pr`, batching smart polling broadcasts, debouncing frontend invalidation, and fixing HTTP semantics (200 instead of 404 for "no PR found").

## Progress

### Server-side fixes (Tasks 1-3)
- [x] Task 1: Server-side PR cache with negative caching
- [x] Task 2: Batch smart polling broadcasts
- [x] Task 3: Fix HTTP semantics — return 200 for "no PR"

### Frontend fixes (Tasks 4-5)
- [x] Task 4: Throttle frontend invalidation (per-workspace scoping deferred)
- [x] Task 5: Update frontend to handle new 200 response for "no PR"

### Verification (Task 6)
- [x] Task 6: Manual verification + ARCHITECTURE.md update

---

### Task 1: Server-side PR cache with negative caching

**Why:** Every `/workspaces/pr` request spawns a `gh pr view` subprocess (GitHub API call). No caching means the same branch is queried every 30 seconds even when nothing has changed. Negative results ("no PR") should be cached with a longer TTL since they rarely change without user action.

**Files:**
- MODIFY `server/workspaces.ts` — add a per-branch in-memory cache for PR results (positive: 60s TTL, negative: 5min TTL)
- MODIFY `server/workspaces.ts` — accept a `clearPrCache(workspacePath?)` function for invalidation
- MODIFY `server/index.ts` — wire webhook/ref-changed events to clear the PR cache

**Implementation details:**
- Cache key: `${workspacePath}:${branch}`
- Cache structure: `Map<string, { result: PrInfo | null; fetchedAt: number }>`
- Positive TTL: 60s (same as org-dashboard)
- Negative TTL: 300s (5 minutes — no PR rarely changes without user action)
- Export `clearPrCache(workspacePath?: string)` to allow targeted invalidation
- On `ref-changed` events: clear cache entries matching the affected workspace
- On `pr-updated` webhook events: clear all cache entries (webhook means something actually changed)

### Task 2: Batch smart polling broadcasts

**Why:** The smart polling loop broadcasts N `pr-updated` + N `ci-updated` events (one per unwebhooked repo). This generates 2N WebSocket messages per cycle. Batching into 2 messages (one `pr-updated`, one `ci-updated`) reduces broadcast volume.

**Files:**
- MODIFY `server/webhook-manager.ts` — replace per-repo `broadcastEvent` loop with single batched broadcasts

**Implementation details:**
- Replace the `for (const [ownerRepo] of repoMap)` loop with:
  ```typescript
  if (repoMap.size > 0) {
    broadcastEvent('pr-updated', { repos: [...repoMap.keys()] });
    broadcastEvent('ci-updated', { repos: [...repoMap.keys()] });
  }
  ```
- The frontend handler already ignores the `repo`/`repos` payload (it invalidates everything), so this is backwards-compatible. Task 4 will add payload awareness.

### Task 3: Fix HTTP semantics — return 200 for "no PR"

**Why:** HTTP 404 should mean "endpoint not found", not "query returned empty results." Returning 404 for "no PR found" creates noisy error entries in browser dev tools and misuses the status code.

**Files:**
- MODIFY `server/workspaces.ts` — change both 404 responses for "no PR" to `200 { pr: null }`

**Implementation details:**
- Line 544: `res.status(404).json({ error: 'No PR found for branch' })` → `res.json({ pr: null })`
- Line 547 (catch block): `res.status(404).json({ error: 'No PR found for branch' })` → `res.json({ pr: null })`

### Task 4: Debounce frontend invalidation + scope to affected workspace

**Why:** Each WebSocket event triggers 3 blanket `invalidateQueries` calls that invalidate ALL PR/CI queries regardless of which workspace changed. Multiple rapid events from smart polling compound this. Debouncing and scoping to the affected workspace eliminates redundant refetches.

**Files:**
- MODIFY `frontend/src/App.svelte` — debounce the `pr-updated`/`ci-updated` handler (500ms), use workspace-scoped invalidation where possible

**Implementation details:**
- Add a debounce timer for PR/CI invalidation events:
  ```typescript
  let prInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedPrInvalidate(): void {
    if (prInvalidateTimer) clearTimeout(prInvalidateTimer);
    prInvalidateTimer = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['org-prs'] });
      queryClient.invalidateQueries({ queryKey: ['pr'] });
      queryClient.invalidateQueries({ queryKey: ['ci-status'] });
      prInvalidateTimer = null;
    }, 500);
  }
  ```
- Replace direct `invalidateQueries` calls in the `pr-updated`/`ci-updated` handler with `debouncedPrInvalidate()`
- Keep `invalidatePrQueries()` (used by `session-ended` and `ref-changed`) as immediate — those are targeted events that should propagate quickly
- The `ref-changed` handler already has its own 5s debounce timer, so it stays as-is

### Task 5: Update frontend to handle new 200 response for "no PR"

**Why:** The server now returns `200 { pr: null }` instead of `404` for "no PR found". The frontend `fetchPrForBranchOrNull` currently returns `null` on any non-OK response, so we need to update it to parse the new response shape.

**Files:**
- MODIFY `frontend/src/lib/api.ts` — update `fetchPrForBranchOrNull` to handle `{ pr: null }` response

**Implementation details:**
- Current code returns `null` on `!res.ok`. New code:
  ```typescript
  export async function fetchPrForBranchOrNull(workspacePath: string, branch: string): Promise<PrInfo | null> {
    const res = await fetch('/workspaces/pr?path=' + encodeURIComponent(workspacePath) + '&branch=' + encodeURIComponent(branch));
    if (!res.ok) return null;
    const data = await res.json() as { pr: PrInfo | null } | PrInfo;
    // Handle both new shape { pr: null } and legacy shape (direct PrInfo object)
    if (data && 'pr' in data) return data.pr;
    return data as PrInfo;
  }
  ```

### Task 6: Manual verification + ARCHITECTURE.md update

**Why:** Verify the fix reduces network noise and update docs to reflect the new caching strategy.

**Files:**
- MODIFY `docs/ARCHITECTURE.md` — update `webhook-manager.ts` description to mention smart polling + batching
- RUN `npm run build` — verify TypeScript compilation
- RUN `npm test` — verify all tests pass

**Verification steps:**
1. Build succeeds with no errors
2. Tests pass
3. Review the diff for correctness
