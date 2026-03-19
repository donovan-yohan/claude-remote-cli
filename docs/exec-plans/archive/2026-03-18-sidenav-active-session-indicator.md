# Plan: Sidenav Active Session Indicator

> **Status**: Active | **Created**: 2026-03-18
> **Source**: `docs/bug-analyses/2026-03-18-sidenav-active-session-indicator-bug-analysis.md`

## Goal

Make the currently active session visually obvious in the sidenav at a glance, and auto-select when only one session exists.

## Progress

- [x] Task 1: Add left accent border to selected session item
- [x] Task 2: Auto-select single session on page load
- [x] Task 3: Verify existing tests pass (140/140 pass)

---

### Task 1: Add left accent border to selected session item

**File:** `frontend/src/components/SessionItem.svelte`

Add a `border-left: 3px solid var(--accent)` to `li.active-session.selected` as a strong secondary visual signal. This works in tandem with the existing background change and is visible at any sidebar width. Adjust padding-left to compensate for the border width so items don't shift.

**Changes:**
1. In the CSS for `li.active-session.selected` (~line 169), add `border-left: 3px solid var(--accent)` and reduce left padding by 3px to prevent layout shift
2. Add a transparent left border to `li.active-session` (base state) so the layout is stable: `border-left: 3px solid transparent`

### Task 2: Auto-select single session on page load

**File:** `frontend/src/App.svelte`

After `refreshAll()` completes on auth (~line 160), if no `activeSessionId` is set and no URL `?session=` param is present, auto-select if exactly one session exists.

**Changes:**
1. After the URL param handling block (line 168), add:
   ```ts
   if (!sessionState.activeSessionId && sessionState.sessions.length === 1) {
     handleSelectSession(sessionState.sessions[0].id);
   }
   ```
   Note: Use `handleSelectSession` which sets activeSessionId, clears attention, and closes sidebar + focuses terminal. On desktop the sidebar stays open (closeSidebar is a no-op when not mobile overlay), on mobile it's fine since the user hasn't opened it yet.

### Task 3: Verify existing tests pass

Run `npm test` to ensure nothing is broken.
