# Bug Analysis: Sidebar touch scroll blocked by drag-and-drop

> **Status**: Confirmed | **Date**: 2026-03-24
> **Severity**: High
> **Affected Area**: `frontend/src/components/Sidebar.svelte` — `svelte-dnd-action` dndzone

## Symptoms
- On mobile, the sidebar workspace list cannot be scrolled because touch events are intercepted
- Attempting to scroll initiates a drag-and-drop reorder instead
- The drag-to-reorder interaction steals all touch events, making the sidebar unusable when the workspace list exceeds viewport height

## Reproduction Steps
1. Open the app on a mobile device (or use mobile emulation)
2. Have enough workspaces in the sidebar that the list overflows
3. Try to scroll the sidebar by swiping up/down
4. Observe: the touch is intercepted by `svelte-dnd-action` for drag-and-drop instead of scrolling

## Root Cause

The `use:dndzone` directive (`Sidebar.svelte:209`) is applied to the `.workspace-list` container **unconditionally** — it is always active regardless of whether the user is in reorder mode:

```svelte
<div
  class="workspace-list"
  use:dndzone={{ items: localDndItems, flipDurationMs, type: 'workspaces', dropTargetStyle: {} }}
  ...
>
```

`svelte-dnd-action` attaches `touchstart` listeners to all draggable child elements. When a touch event fires, the library intercepts it to initiate a potential drag operation, which `preventDefault()`s the touch and blocks the browser's native scroll.

The existing long-press mechanism (lines 148–170) only controls entering `ui.reorderMode` — it does **not** prevent `svelte-dnd-action` from intercepting touches. The library has a `dragDisabled` option specifically for this use case, but the current code does not use it.

## Evidence

1. **`Sidebar.svelte:209`** — `use:dndzone={{ items: localDndItems, flipDurationMs, type: 'workspaces', dropTargetStyle: {} }}` — no `dragDisabled` option passed
2. **`svelte-dnd-action` README (line 113)** — documents `dragDisabled: Boolean` option: "Setting it to true will make it impossible to drag elements out of the dnd-zone. You can change it at any time, and the zone will adjust on the fly"
3. **`svelte-dnd-action` README (line 125)** — also documents `delayTouchStart` option for touch scroll conflicts, but `dragDisabled` is the correct fix here since the app already has an explicit reorder mode gate
4. **`pointerAction.js:647`** — library attaches `touchstart` listener to each draggable element unconditionally when `dragDisabled` is false (the default)
5. **`ui.svelte.ts:35,62-63`** — `reorderMode` state exists and is toggled by `enterReorderMode()`/`exitReorderMode()` but is never wired to `dragDisabled`

## Impact Assessment

- **All mobile users** cannot scroll the sidebar when they have more workspaces than fit on screen
- Desktop users are unaffected (mouse events use different handling path)
- The reorder feature itself works — it's just always-on instead of gated behind reorder mode

## Recommended Fix Direction

Pass `dragDisabled: !ui.reorderMode` to the `dndzone` configuration on the `.workspace-list` div. This ensures:

- **Normal state** (`reorderMode: false`): `dragDisabled: true` — touch events pass through to native scroll
- **Reorder mode** (`reorderMode: true`, entered via long-press): `dragDisabled: false` — drag-and-drop works

The change is a single property addition on line 209:

```svelte
use:dndzone={{ items: localDndItems, flipDurationMs, type: 'workspaces', dropTargetStyle: {}, dragDisabled: !ui.reorderMode }}
```

**Regression considerations:**
- Desktop reorder mode: verify it still works (enter via button/long-press, drag items, click "Done reordering")
- Mobile long-press: verify the 500ms long-press still enters reorder mode and enables dragging
- Sidebar scroll: verify the `.workspace-list` scrolls normally on mobile when NOT in reorder mode
- The `delayTouchStart` option is NOT needed here since the reorder mode gate is sufficient
