# Bug Analysis: SearchableSelect Dropdown Click Does Nothing

> **Status**: Confirmed | **Date**: 2026-03-11
> **Severity**: Medium
> **Affected Area**: `frontend/src/components/SearchableSelect.svelte`

## Symptoms
- Clicking the roots or repos filter dropdowns in the sidebar does nothing
- The dropdown appears to never open

## Reproduction Steps
1. Open the web interface
2. Navigate to a tab that shows the sidebar filters (sessions, worktrees, or PRs)
3. Click the "All roots" or "All repos" dropdown
4. Nothing happens — dropdown does not open

## Root Cause
Race condition between Svelte conditional rendering and the `<svelte:window onclick>` handler.

**Event sequence:**
1. User clicks `.ss-trigger` button → `openDropdown()` sets `open = true`
2. Svelte re-renders the `{#if open}` block: removes the button, inserts the search input
3. The click event continues bubbling up to `<svelte:window onclick={onWindowClick} />`
4. `onWindowClick` evaluates `wrapperEl.contains(e.target as Node)` — but `e.target` (the now-removed button) is no longer in the DOM tree
5. `Node.contains()` returns `false` for a detached node → `close()` fires → `open` back to `false`

The dropdown opens and closes within the same event cycle.

## Evidence
- `SearchableSelect.svelte:59` — `<svelte:window onclick={onWindowClick} />` listens to ALL window clicks
- `SearchableSelect.svelte:93-104` — the trigger button is inside an `{:else}` block, so it's removed from DOM when `open` becomes `true`
- `SearchableSelect.svelte:46` — `wrapperEl.contains(e.target)` fails when `e.target` is a detached DOM node
- This is a well-known pattern issue with Svelte conditional rendering + document/window click-outside handlers

## Impact Assessment
- Root and repo filter dropdowns are completely non-functional
- Users cannot filter sessions by root directory or repository
- Search text input still works (it's not a SearchableSelect)

## Recommended Fix Direction
Add a `document.contains(e.target as Node)` guard to `onWindowClick` so that clicks on elements that have been removed from the DOM (by re-rendering) are ignored:

```typescript
function onWindowClick(e: MouseEvent) {
  if (open && wrapperEl && document.contains(e.target as Node) && !wrapperEl.contains(e.target as Node)) {
    close();
  }
}
```

This single-line change fixes the race condition without altering the component's architecture.
