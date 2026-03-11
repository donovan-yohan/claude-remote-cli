# Fix: SearchableSelect Dropdown Click-Outside Race Condition

> **Status**: Complete | **Created**: 2026-03-11 | **Completed**: 2026-03-11
> **Source**: `docs/bug-analyses/2026-03-11-searchable-select-dropdown-bug-analysis.md`

## Goal
Fix the SearchableSelect dropdown so clicking the trigger button opens the dropdown and keeps it open.

## Progress

- [x] Task 1: Fix `onWindowClick` in SearchableSelect.svelte
- [x] Task 2: Verify build + type check passes

---

### Task 1: Fix onWindowClick guard
**File:** `frontend/src/components/SearchableSelect.svelte`
**Change:** Add `document.contains(e.target as Node)` guard to `onWindowClick` so detached DOM nodes (from Svelte conditional re-render) don't trigger `close()`.

**Before:**
```typescript
function onWindowClick(e: MouseEvent) {
  if (open && wrapperEl && !wrapperEl.contains(e.target as Node)) {
    close();
  }
}
```

**After:**
```typescript
function onWindowClick(e: MouseEvent) {
  if (open && wrapperEl && document.contains(e.target as Node) && !wrapperEl.contains(e.target as Node)) {
    close();
  }
}
```

### Task 2: Verify build + type check
**Command:** `npm run check && npm run build`
**Expected:** Clean compilation, no type errors.
