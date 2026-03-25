# Bug Analysis: Desktop drag broken + reorder mode UX is jarring

> **Status**: Confirmed | **Date**: 2026-03-25
> **Severity**: High
> **Affected Area**: `frontend/src/components/Sidebar.svelte`, `frontend/src/components/WorkspaceItem.svelte`, `frontend/src/lib/state/ui.svelte.ts`

## Symptoms
- Desktop: Cannot reorder workspaces with mouse drag at all — drag-and-drop is completely non-functional
- Mobile: Long-press triggers "reorder mode" which collapses all workspace content (sessions, actions, dividers) into a stripped-down list, creating a jarring mode switch
- User expectation: free in-place drag on desktop (always), same drag on mobile but activated by long-press instead of immediate touch

## Reproduction Steps
1. Open the app on desktop
2. Try to drag a workspace item to reorder — nothing happens, no grab cursor, no drag
3. Open on mobile, long-press the sidebar → reorder mode activates
4. Observe: all session lists, action buttons, collapse chevrons, and dividers disappear; the sidebar becomes a flat list of workspace names only

## Root Cause

Commit `7e7da8f` ("gate sidebar DnD behind reorder mode") added `dragDisabled: !ui.reorderMode` to fix mobile scroll being blocked by `svelte-dnd-action` (bug L-014). The fix is correct in concept — drag must be gated on mobile — but the implementation has two problems:

### Problem 1: Desktop drag has no entry point

The only way to set `reorderMode = true` is the `ontouchstart` handler on `.workspace-list` (Sidebar.svelte:212). Touch events don't fire from mouse input. There is no `onmousedown` or button-based entry point for desktop users. Since `dragDisabled: !ui.reorderMode` evaluates to `dragDisabled: true` when `reorderMode` is `false`, `svelte-dnd-action` removes all `mousedown` listeners from draggable children (pointerAction.js:643-648), making drag impossible.

### Problem 2: Reorder mode UI is destructively different

When `inReorderMode` is true, WorkspaceItem.svelte hides:
- Collapse chevron (line 226: `{#if !inReorderMode}`)
- Workspace action buttons / settings icon (line 241: `{#if !inReorderMode}`)
- Session lists (line 254: `{#if !collapsed && !inReorderMode}`)
- Add-worktree row (line 384: `{#if !collapsed && !inReorderMode}`)
- Workspace dividers (line 392: `{#if !inReorderMode}`)
- Click navigation is suppressed (line 223: `if (!inReorderMode) onSelectWorkspace(...)`)

This turns a normal sidebar into a flat list of just workspace names + icons, which is the "jarring completely different experience" the user described.

### Why this happened

The original mobile scroll fix (L-014) recommended `dragDisabled: !ui.reorderMode` as a single-line fix. This was correct for the mobile scroll issue. But then the `reorderMode` concept was expanded to also collapse the UI, turning what should have been a simple drag-gating flag into a full mode switch. The two concerns (enabling/disabling the DnD library vs. changing the visual layout) were coupled to a single state variable.

## Evidence

1. **Sidebar.svelte:209** — `dragDisabled: !ui.reorderMode` gates all drag behind reorder mode
2. **Sidebar.svelte:212-214** — Only `ontouchstart/end/move` handlers exist for entering reorder mode; no mouse equivalent
3. **pointerAction.js:643-648** — When `dragDisabled` is true, library removes `mousedown` listeners from all children
4. **WorkspaceItem.svelte:226,241,254,384,392** — Five `{#if !inReorderMode}` gates that hide content
5. **Commit 7e7da8f** — The fix that introduced the regression, intended to fix mobile scroll

## Impact Assessment

- **All desktop users** cannot reorder workspaces — the feature is completely broken on desktop
- **All mobile users** experience a jarring mode switch to reorder — instead of in-place drag, the entire sidebar transforms
- The underlying reorder API (PUT /workspaces/reorder) and persistence work correctly — this is purely a frontend input/UX issue

## Recommended Fix Direction

Replace the current `reorderMode` approach with device-aware drag gating:

1. **Desktop (pointer: fine / mouse)**: Always keep `dragDisabled: false`. Mouse-based drag does not conflict with scroll (scroll uses mouse wheel, not drag). No mode toggle needed.
2. **Mobile (pointer: coarse / touch)**: Keep `dragDisabled: true` by default. Long-press (500ms) sets a lightweight `dragEnabled` flag → `dragDisabled: false`. After `finalize` event, reset to `dragDisabled: true`.
3. **Remove content-hiding**: Strip all `{#if !inReorderMode}` guards from WorkspaceItem. The sidebar should look identical during drag — just with grab cursors on the items being dragged.
4. **Remove `reorderMode` state**: Replace with a simpler `mobileDragEnabled` flag that only controls `dragDisabled`, not the visual layout.

Key constraint: `svelte-dnd-action` needs `dragDisabled: false` BEFORE the touch starts — enabling it mid-touch won't retroactively initiate a drag. So the mobile long-press approach requires two gestures: long-press to enable, then drag. This is acceptable UX if the sidebar doesn't visually transform between gestures.

## Architecture Review

### Systemic Spread

The `inReorderMode` / `ui.reorderMode` flag is referenced in exactly two components: `Sidebar.svelte` (DnD gating + longpress + Done button) and `WorkspaceItem.svelte` (5 content gates + cursor change). The coupling is limited to these two files — no other components or server modules reference it. **No systemic spread beyond these two files.**

### Design Gap

**Input-method-agnostic DnD gating**: The code treats all input methods (mouse, touch) identically via a single `dragDisabled` boolean tied to a mode toggle. This ignores a fundamental platform difference: mouse drag doesn't conflict with scroll (wheel-based), while touch drag does (gesture-based). The correct abstraction is device-aware drag gating that uses different strategies per input method, not a one-size-fits-all mode toggle.

**Concern coupling**: A single `reorderMode` boolean controls two independent concerns: (1) whether the DnD library intercepts events, and (2) what content is visible. These should be separate — the DnD library's `dragDisabled` property is a technical necessity for touch scroll compatibility, not a reason to change the visual layout.

### Testing Gaps

No automated tests exist for drag-and-drop behavior. The regression was introduced by a one-line change that passed all existing tests. Desktop drag breakage went undetected because:
- No integration test verifies that workspace items are draggable via mouse
- No test asserts that `dragDisabled` is `false` when appropriate
- No visual regression test catches the sidebar collapsing in reorder mode

### Harness Context Gaps

`docs/FRONTEND.md` has no section on drag-and-drop patterns or the workspace reorder feature. The mobile touch section mentions long-press for text selection but not for reorder mode. The `reorderMode` state is not documented in the state management table.
