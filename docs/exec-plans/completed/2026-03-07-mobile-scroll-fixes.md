# Mobile Scroll & Navigation Fixes

> **Status**: Completed | **Created**: 2026-03-07 | **Completed**: 2026-03-07
> **Design Doc**: N/A (bug fixes + small feature — no brainstorm needed)
> **For Claude:** Use /harness:orchestrate to execute this plan.
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix mobile scroll UX bugs (keyboard flicker on FAB tap, scroll-to-top on keyboard toggle) and add skip-to-bottom button + swipe-to-open sidebar gesture.

**Architecture:** All changes are in `Terminal.svelte` and `App.svelte`. The FAB keyboard fix uses the same `onmousedown` + `preventDefault()` pattern already proven in `Toolbar.svelte`. The scroll-position fix preserves xterm's `viewportY` across `fit()` calls. The swipe gesture is a document-level touch handler in `App.svelte`.

**Tech Stack:** Svelte 5, xterm.js, visualViewport API, touch events

---

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-07 | Design | Use `onmousedown`+`preventDefault` for FABs (same as Toolbar) | Proven pattern — Toolbar already prevents keyboard flicker this way |
| 2026-03-07 | Design | Save/restore `viewportY` around `fit()` | `fit()` resets scroll position; preserving it prevents jump-to-top |
| 2026-03-07 | Design | Swipe gesture in App.svelte, not Terminal.svelte | Needs to work even when sidebar overlay is showing; App owns sidebar state |
| 2026-03-07 | Design | Left-edge swipe zone = 30px, threshold = 50px horizontal | Standard mobile gesture parameters; avoids false positives from content scroll |

## Progress

- [x] Task 1: Fix keyboard flicker on scroll FAB tap _(completed 2026-03-07, d45fdf5)_
- [x] Task 2: Add "skip to bottom" FAB button _(completed 2026-03-07, cd74ee7)_
- [x] Task 3: Fix scroll-to-top on keyboard open/close _(completed 2026-03-07, 867cfd0)_
- [x] Task 4: Add swipe-from-left to open sidebar _(completed 2026-03-07, 8e1a1d4)_

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Fix keyboard flicker on scroll FAB tap

The scroll FABs (`scrollPageUp`/`scrollPageDown`) use `onclick` handlers. On mobile, tapping a button transfers focus from the hidden `MobileInput` to the FAB button, which closes the virtual keyboard. The keyboard then reopens when focus returns. This causes rapid open/close flicker.

**Root cause:** `onclick` fires *after* the browser's default focus-transfer on `mousedown`. The `Toolbar.svelte` component already solves this exact problem — it uses `onmousedown` with `e.preventDefault()` to block focus transfer, then handles the button action in the mousedown handler.

**Files:**
- Modify: `frontend/src/components/Terminal.svelte:512-519` (scroll FABs markup)
- Modify: `frontend/src/components/Terminal.svelte:389-395` (scroll functions)

**Step 1: Replace `onclick` with `onmousedown` + `preventDefault` on the scroll FABs**

In `Terminal.svelte`, change the scroll FAB section (around line 512-519) from:

```svelte
{#if isMobileDevice && thumbVisible}
  <div class="scroll-fabs">
    <!-- svelte-ignore a11y_consider_explicit_label -->
    <button class="scroll-fab" onclick={scrollPageUp} aria-label="Page up">&#9650;</button>
    <!-- svelte-ignore a11y_consider_explicit_label -->
    <button class="scroll-fab" onclick={scrollPageDown} aria-label="Page down">&#9660;</button>
  </div>
{/if}
```

To:

```svelte
{#if isMobileDevice && thumbVisible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scroll-fabs" onmousedown={onScrollFabMouseDown}>
    <button class="scroll-fab" data-dir="up" aria-label="Page up">&#9650;</button>
    <button class="scroll-fab" data-dir="down" aria-label="Page down">&#9660;</button>
  </div>
{/if}
```

And add the handler function (near `scrollPageUp`/`scrollPageDown`, around line 389):

```typescript
function onScrollFabMouseDown(e: MouseEvent) {
  e.preventDefault();
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  const dir = btn.dataset['dir'];
  if (dir === 'up') term?.scrollPages(-1);
  else if (dir === 'down') term?.scrollPages(1);
}
```

**Step 2: Verify on mobile**

- Open on mobile device
- Tap the page-up/page-down FABs while keyboard is open
- Expected: keyboard stays open, terminal scrolls, no flicker

**Step 3: Commit**

```bash
git add frontend/src/components/Terminal.svelte
git commit -m "fix: prevent keyboard flicker when tapping scroll FABs on mobile"
```

---

### Task 2: Add "skip to bottom" FAB button

Add a third FAB below the page-down arrow that scrolls to the very bottom of the terminal output.

**Files:**
- Modify: `frontend/src/components/Terminal.svelte:389-395` (add scrollToBottom function)
- Modify: `frontend/src/components/Terminal.svelte:512-519` (add button markup)
- Modify: `frontend/src/components/Terminal.svelte:575-607` (add CSS for new button)

**Step 1: Add `scrollToBottom` function**

Near `scrollPageUp`/`scrollPageDown` (around line 389), add:

```typescript
function scrollToBottom() {
  if (!term) return;
  term.scrollToBottom();
}
```

**Step 2: Add the button to the FABs markup**

Update the scroll-fabs section to include the new button. The `onmousedown` handler from Task 1 handles dispatch, so just add the data attribute:

```svelte
{#if isMobileDevice && thumbVisible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="scroll-fabs" onmousedown={onScrollFabMouseDown}>
    <button class="scroll-fab" data-dir="up" aria-label="Page up">&#9650;</button>
    <button class="scroll-fab" data-dir="down" aria-label="Page down">&#9660;</button>
    <button class="scroll-fab scroll-fab-bottom" data-dir="bottom" aria-label="Skip to bottom">&#8615;</button>
  </div>
{/if}
```

**Step 3: Update the `onScrollFabMouseDown` handler to support `bottom`**

```typescript
function onScrollFabMouseDown(e: MouseEvent) {
  e.preventDefault();
  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;
  const dir = btn.dataset['dir'];
  if (dir === 'up') term?.scrollPages(-1);
  else if (dir === 'down') term?.scrollPages(1);
  else if (dir === 'bottom') term?.scrollToBottom();
}
```

**Step 4: Add CSS for the bottom button**

In the `@media (hover: none)` section, add a small visual separator between the page-down and skip-to-bottom buttons:

```css
.scroll-fab-bottom {
  margin-top: 4px;
  border-top: 1px solid var(--border);
}
```

**Step 5: Verify on mobile**

- Scroll up in terminal
- Tap the skip-to-bottom button (double-down-arrow icon)
- Expected: terminal instantly jumps to the bottom

**Step 6: Commit**

```bash
git add frontend/src/components/Terminal.svelte
git commit -m "feat: add skip-to-bottom FAB button for mobile terminal scroll"
```

---

### Task 3: Fix scroll-to-top on keyboard open/close

When the virtual keyboard opens or closes, the terminal scroll position jumps to the top. This happens because `fitAddon.fit()` resets xterm's scroll position when the terminal dimensions change.

**Root cause:** `fitAddon.fit()` recalculates rows/cols and can reset `viewportY` to `baseY` (the bottom). But the real problem is more subtle — during keyboard transitions, the ResizeObserver fires `fit()` which changes the row count, and xterm re-renders at a different scroll offset. We need to preserve and restore the viewport scroll position across `fit()` calls.

**Files:**
- Modify: `frontend/src/components/Terminal.svelte:32-36` (fitTerm function)
- Modify: `frontend/src/components/Terminal.svelte:134-142` (ResizeObserver callback)

**Step 1: Add scroll-position-preserving wrapper for fit()**

Replace the `fitTerm` export (around line 32) and update the ResizeObserver callback:

Update `fitTerm()`:

```typescript
export function fitTerm() {
  if (!term) return;
  const savedViewportY = term.buffer.active.viewportY;
  fitAddon?.fit();
  term.scrollToLine(savedViewportY);
  sendPtyResize(term.cols, term.rows);
  updateScrollbar();
}
```

Update the ResizeObserver callback (around line 136):

```typescript
roTimer = setTimeout(() => {
  const savedViewportY = t.buffer.active.viewportY;
  fitAddon.fit();
  t.scrollToLine(savedViewportY);
  sendPtyResize(t.cols, t.rows);
  updateScrollbar();
}, isMobileDevice ? 150 : 0);
```

**Step 2: Verify on mobile**

- Scroll to a specific position in the terminal (middle of output)
- Tap to open the keyboard
- Expected: terminal stays at the same scroll position
- Close the keyboard
- Expected: terminal stays at the same scroll position

**Step 3: Commit**

```bash
git add frontend/src/components/Terminal.svelte
git commit -m "fix: preserve terminal scroll position across keyboard open/close"
```

---

### Task 4: Add swipe-from-left to open sidebar

Add a touch gesture that opens the sidebar when the user swipes from the left edge of the screen to the right, regardless of what's currently in view (terminal, header, etc.).

**Files:**
- Modify: `frontend/src/App.svelte:48-79` (onMount — add touch handlers)

**Step 1: Add swipe gesture state and handlers in `App.svelte`**

Inside the `onMount` callback, after the existing `isMobileDevice` block (around line 52), add the swipe detection:

```typescript
// Mobile: swipe from left edge to open sidebar
if (isMobileDevice) {
  const EDGE_ZONE = 30; // px from left edge to start swipe
  const SWIPE_THRESHOLD = 50; // px horizontal movement to trigger
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeTracking = false;

  const onSwipeTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    if (touch.clientX <= EDGE_ZONE && !ui.sidebarOpen) {
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      swipeTracking = true;
    }
  };

  const onSwipeTouchMove = (e: TouchEvent) => {
    if (!swipeTracking) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - swipeStartX;
    const dy = Math.abs(touch.clientY - swipeStartY);
    // If vertical movement exceeds horizontal, cancel (it's a scroll)
    if (dy > dx) {
      swipeTracking = false;
      return;
    }
    if (dx >= SWIPE_THRESHOLD) {
      swipeTracking = false;
      openSidebar();
    }
  };

  const onSwipeTouchEnd = () => {
    swipeTracking = false;
  };

  document.addEventListener('touchstart', onSwipeTouchStart, { passive: true });
  document.addEventListener('touchmove', onSwipeTouchMove, { passive: true });
  document.addEventListener('touchend', onSwipeTouchEnd);

  // Add to cleanup — need to update the existing return
  const cleanupSwipe = () => {
    document.removeEventListener('touchstart', onSwipeTouchStart);
    document.removeEventListener('touchmove', onSwipeTouchMove);
    document.removeEventListener('touchend', onSwipeTouchEnd);
  };

  // Store for cleanup merging
  (window as any).__cleanupSwipe = cleanupSwipe;
}
```

**Important:** The existing `onMount` has a conditional return (only returns cleanup when `isMobileDevice && window.visualViewport`). We need to merge the cleanup. Refactor the onMount return to handle both:

Replace the entire `onMount` callback body to properly combine both cleanup functions:

```typescript
onMount(() => {
  checkExistingAuth();

  let cleanupViewport: (() => void) | undefined;
  let cleanupSwipe: (() => void) | undefined;

  // Mobile: track virtual keyboard via visualViewport API
  if (isMobileDevice && window.visualViewport) {
    const vv = window.visualViewport;
    let fitTimer: ReturnType<typeof setTimeout> | null = null;

    const onViewportResize = () => {
      const kbHeight = window.innerHeight - vv.height;
      keyboardOpen = kbHeight > 50;
      if (mainAppEl) {
        if (keyboardOpen) {
          mainAppEl.style.height = vv.height + 'px';
        } else {
          mainAppEl.style.height = '';
        }
      }
      // Prevent iOS from scrolling the viewport when keyboard opens
      window.scrollTo(0, 0);
      // Debounce fitTerm — visualViewport fires resize/scroll rapidly
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(() => terminalRef?.fitTerm(), 100);
    };
    vv.addEventListener('resize', onViewportResize);
    vv.addEventListener('scroll', onViewportResize);
    cleanupViewport = () => {
      vv.removeEventListener('resize', onViewportResize);
      vv.removeEventListener('scroll', onViewportResize);
      if (fitTimer) clearTimeout(fitTimer);
    };
  }

  // Mobile: swipe from left edge to open sidebar
  if (isMobileDevice) {
    const EDGE_ZONE = 30;
    const SWIPE_THRESHOLD = 50;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeTracking = false;

    const onSwipeTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (touch.clientX <= EDGE_ZONE && !ui.sidebarOpen) {
        swipeStartX = touch.clientX;
        swipeStartY = touch.clientY;
        swipeTracking = true;
      }
    };

    const onSwipeTouchMove = (e: TouchEvent) => {
      if (!swipeTracking) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - swipeStartX;
      const dy = Math.abs(touch.clientY - swipeStartY);
      if (dy > dx) {
        swipeTracking = false;
        return;
      }
      if (dx >= SWIPE_THRESHOLD) {
        swipeTracking = false;
        openSidebar();
      }
    };

    const onSwipeTouchEnd = () => {
      swipeTracking = false;
    };

    document.addEventListener('touchstart', onSwipeTouchStart, { passive: true });
    document.addEventListener('touchmove', onSwipeTouchMove, { passive: true });
    document.addEventListener('touchend', onSwipeTouchEnd);
    cleanupSwipe = () => {
      document.removeEventListener('touchstart', onSwipeTouchStart);
      document.removeEventListener('touchmove', onSwipeTouchMove);
      document.removeEventListener('touchend', onSwipeTouchEnd);
    };
  }

  return () => {
    cleanupViewport?.();
    cleanupSwipe?.();
  };
});
```

**Step 2: Verify on mobile**

- From any screen (terminal active, keyboard open or closed)
- Place finger on left edge of screen and swipe right
- Expected: sidebar opens
- Swipe vertically from the left edge
- Expected: nothing happens (vertical scroll, not sidebar open)
- With sidebar already open, swipe from left edge
- Expected: nothing happens (sidebar already open)

**Step 3: Commit**

```bash
git add frontend/src/App.svelte
git commit -m "feat: add swipe-from-left gesture to open sidebar on mobile"
```

---

## Outcomes & Retrospective

**What worked:**
- Reusing the Toolbar's `onmousedown` + `preventDefault()` pattern for FABs — proven pattern, zero debugging needed
- Parallel worker dispatch (Task 2 + Task 4 on different files) cut wall-clock time
- Save/restore `viewportY` around `fit()` is a clean, minimal fix for the scroll jump

**What didn't:**
- Nothing notable — all tasks were straightforward bug fixes and small features

**Learnings to codify:**
- `onmousedown` + `preventDefault()` is the standard pattern for any mobile button that should not steal focus from MobileInput
- `fitAddon.fit()` resets xterm scroll position — always save/restore `viewportY` when calling it
