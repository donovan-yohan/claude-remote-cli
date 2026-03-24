# Fix: Sidebar touch scroll blocked by drag-and-drop

> **Status**: Complete | **Created**: 2026-03-24
> **Source**: `docs/bug-analyses/2026-03-24-sidebar-touch-scroll-blocked-by-dnd-bug-analysis.md`
> **Branch**: `cook`

## Goal

Fix mobile sidebar scrolling by gating `svelte-dnd-action` drag behind `reorderMode`. No regressions to desktop or mobile reorder flow.

## Progress

- [x] Task 1: Add `dragDisabled: !ui.reorderMode` to dndzone config
- [x] Task 2: Build and verify no compile errors (0 errors, 23 pre-existing warnings)
- [x] Task 3: Run existing test suite (377 pass, 0 fail)

---

### Task 1: Add `dragDisabled` to dndzone config
**File:** `frontend/src/components/Sidebar.svelte`
**Line:** 209
**Change:** Add `dragDisabled: !ui.reorderMode` to the `use:dndzone` options object

Current:
```svelte
use:dndzone={{ items: localDndItems, flipDurationMs, type: 'workspaces', dropTargetStyle: {} }}
```

After:
```svelte
use:dndzone={{ items: localDndItems, flipDurationMs, type: 'workspaces', dropTargetStyle: {}, dragDisabled: !ui.reorderMode }}
```

**Why this works:** When `reorderMode` is `false` (default), `dragDisabled` is `true` — the library won't attach touch/pointer handlers to children, allowing native scroll. When the user long-presses (500ms) and enters reorder mode, `dragDisabled` becomes `false` and dragging works. The library docs confirm it adjusts "on the fly" when `dragDisabled` changes.

### Task 2: Build verification
**Command:** `npm run build`
**Expected:** Clean compile, no TypeScript or Svelte errors

### Task 3: Test suite
**Command:** `npm test`
**Expected:** All existing tests pass — no regressions
