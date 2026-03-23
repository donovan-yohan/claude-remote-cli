# Plan: Fix PR/CI Query Infinite Loop

> **Status**: Completed | **Created**: 2026-03-23
> **Source**: `docs/bug-analyses/2026-03-23-pr-query-infinite-loop-bug-analysis.md`
> **Branch**: `fix/pr-query-infinite-loop`

## Progress

- [x] Task 1: Wrap refetch calls in `untrack()` to break the reactive loop
- [x] Task 2: Build and verify no regressions

---

### Task 1: Wrap refetch calls in `untrack()` to break the reactive loop
**File:** `frontend/src/components/PrTopBar.svelte`
**Change:**
1. Add `import { untrack } from 'svelte';` to the script imports
2. Wrap the `prQuery.refetch()` and `ciQuery.refetch()` calls at lines 59-64 in `untrack()` so the effect only tracks `sessionId`:

```typescript
$effect(() => {
  if (sessionId) {
    untrack(() => {
      prQuery.refetch();
      ciQuery.refetch();
    });
  }
});
```

This ensures the effect re-runs only when `sessionId` changes, not when the query stores update from the refetch they triggered.

### Task 2: Build and verify no regressions
**Command:** `npm run build`
**Verify:** Build succeeds with no TypeScript errors. The `untrack` import is valid Svelte 5 API.
