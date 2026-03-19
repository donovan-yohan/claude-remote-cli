# Bug Analysis: No Clear Active Session Indicator in Sidenav

> **Status**: Confirmed | **Date**: 2026-03-18
> **Severity**: Medium
> **Affected Area**: frontend/src/components/SessionItem.svelte, sessions.svelte.ts, App.svelte

## Symptoms
- When looking at the sidenav, it's not immediately clear which session is currently being viewed in the main content area
- The sidebar shows sessions with status dots (green/blue/amber) but no strong visual differentiation for the "currently selected" session

## Reproduction Steps
1. Open the app with one or more active sessions
2. Click a session to view it (terminal/chat opens in main area)
3. Reopen the sidebar (especially on mobile)
4. Observe: the session item may not have a visually distinct "selected" indicator, or the indicator was never visible due to sidebar closing simultaneously

## Root Cause

Three compounding issues prevent the active session from being clearly indicated:

### 1. No auto-selection on page load
`activeSessionId` initializes as `null` in `sessions.svelte.ts:8`. After `refreshAll()` fetches sessions on auth, no session is automatically selected — the user must click one. If only one session exists, it still isn't selected by default.

### 2. closeSidebar() races selection highlight (mobile)
`handleSelectSession` in `App.svelte:196-201` simultaneously sets `activeSessionId` AND calls `closeSidebar()`. On mobile, the sidebar slides away before the user can register the visual change.

### 3. Single weak visual signal
The `.selected` state (`SessionItem.svelte:169-172`) only changes the background to `var(--accent)` and text to white. While visible, it's:
- Easy to miss when quickly glancing at the sidebar
- Indistinguishable when only one session exists (no contrast with other items)
- Missing secondary indicators (left accent border, bold treatment, icon badge)

## Evidence
- `SessionItem.svelte:100-106`: `class:selected={isSelected}` applied to `<li>`
- `SessionItem.svelte:169-172`: selected style is `background: var(--accent); color: #fff;`
- `sessions.svelte.ts:8`: `let activeSessionId = $state<string | null>(null);`
- `App.svelte:196-201`: `handleSelectSession` calls `closeSidebar()` immediately
- `App.svelte:158-181`: post-auth `refreshAll()` has no auto-select logic

## Impact Assessment
- Usability issue affecting all users, especially those with multiple sessions
- More impactful on mobile where sidebar closes on selection
- Users can lose track of which session they're interacting with
- No way to tell at a glance which session is active without clicking around

## Recommended Fix Direction

1. **Add a left accent border** to the selected session item (e.g., `border-left: 3px solid var(--accent)`) as a secondary visual signal that's visible at any sidebar width
2. **Auto-select on load**: If `activeSessionId` is null after `refreshAll()` and exactly one session exists, auto-select it
3. **Consider keeping sidebar open on desktop** after selection (only close on mobile), or add a brief delay before closing on mobile so the highlight is visible
4. **Optional**: Add a subtle "viewing" icon or badge to the selected item for additional visual clarity
