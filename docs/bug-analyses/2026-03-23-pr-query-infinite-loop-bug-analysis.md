# Bug Analysis: PR/CI Query Infinite Loop

> **Status**: Confirmed | **Date**: 2026-03-23
> **Severity**: Critical
> **Affected Area**: frontend/src/components/PrTopBar.svelte

## Symptoms
- Network tab shows 583+ requests growing rapidly to 1878+ within seconds
- All requests to `/workspaces/pr?path=` and `/workspaces/ci-status?path=` endpoints
- Requests initiated by `sw.js:4` (service worker pass-through) and `index-B` (main bundle)
- All requests stuck in "pending" status, saturating the browser's connection pool
- UI becomes unresponsive due to request flooding

## Reproduction Steps
1. Open claude-remote-cli web interface
2. Navigate to any workspace with a session (so `sessionId` is non-null)
3. Open browser DevTools → Network tab
4. Observe continuous rapid-fire requests to `pr?path=` and `ci-status?path=`

## Root Cause

The `$effect` at `PrTopBar.svelte:59-64` creates an infinite reactive loop:

```typescript
$effect(() => {
  if (sessionId) {
    prQuery.refetch();
    ciQuery.refetch();
  }
});
```

In Svelte 5, `$effect()` auto-tracks all reactive values read during synchronous execution. TanStack Query's `createQuery` returns a reactive proxy — accessing `.refetch` on the query object tracks the entire query store as a dependency.

**The infinite cycle:**
1. `$effect` runs → reads `sessionId` (tracked), accesses `prQuery.refetch` (tracked), accesses `ciQuery.refetch` (tracked)
2. `prQuery.refetch()` starts a fetch → query transitions to `isFetching: true` → reactive state update
3. Reactive change re-triggers the `$effect` → calls `refetch()` again
4. Goto step 2

Each refetch call mutates the query state that the effect is tracking, creating a synchronous feedback loop that fires as fast as the browser can process microtasks.

## Evidence
- `PrTopBar.svelte:59-64`: The `$effect` accesses reactive TanStack Query stores and calls `.refetch()` which mutates those stores
- `PrTopBar.svelte:43-56`: Both `prQuery` and `ciQuery` are created via `createQuery` which returns Svelte 5 reactive proxies
- Network tab screenshots show hundreds of pending `pr?path=` and `ci-status?path=` requests accumulating rapidly
- The effect was introduced in commit `b159f1c0` (PR lifecycle top bar feature)
- The `invalidatePrQueries()` added in `5155ac2` (auto-refresh feature) likely amplifies the loop by invalidating query caches via WebSocket events, further triggering the reactive cycle

## Impact Assessment
- **Browser**: Connection pool saturation, UI freeze, potential tab crash
- **Server**: Hundreds of concurrent `gh pr checks` and `gh pr view` subprocess spawns per second, risking GitHub API rate limiting and server resource exhaustion
- **User experience**: Application unusable when any session is active

## Recommended Fix Direction

Use Svelte 5's `untrack()` to prevent the effect from tracking the query stores:

```typescript
import { untrack } from 'svelte';

$effect(() => {
  if (sessionId) {
    untrack(() => {
      prQuery.refetch();
      ciQuery.refetch();
    });
  }
});
```

This ensures the effect only re-runs when `sessionId` changes (its intended behavior), not when the query state updates from the refetch it just triggered.
