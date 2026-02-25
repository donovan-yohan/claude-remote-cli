# Mobile Scroll & Touch UX Implementation Plan

> **Status**: Active | **Created**: 2026-02-25 | **Last Updated**: 2026-02-25
> **Design Doc**: `docs/design-docs/2026-02-25-mobile-scroll-ux-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-25 | Design | Drop CSS transform for keyboard | Clips top of terminal — can't scroll to session start while keyboard open |
| 2026-02-25 | Design | Use full safe-area-inset-bottom (not /2) | Safer default, avoids content behind home indicator |
| 2026-02-25 | Design | Use CSS user-select for long-press (not PTY escape sequences) | Don't pollute PTY stream — could confuse Claude Code mid-interaction |
| 2026-02-25 | Design | Use term.scrollPages() for FABs (not SGR sequences) | We're not tmux — scrollback is client-side in xterm buffer |
| 2026-02-25 | Plan | Safe area insets already done in Toolbar/UpdateToast | Only need overscroll-behavior on body |
| 2026-02-25 | Plan | viewport-fit=cover already in index.html | No HTML change needed |
| 2026-02-25 | Plan | App.svelte already debounces fitTerm 100ms | Gap is ResizeObserver in Terminal.svelte — needs keyboard guard |

## Progress

- [ ] Task 1: overscroll-behavior: none
- [ ] Task 2: Mobile font size 12px
- [ ] Task 3: Scroll FABs
- [ ] Task 4: Debounce ResizeObserver fit() during keyboard
- [ ] Task 5: Long-press text selection
- [ ] Task 6: Build + test

## Surprises & Discoveries

- `viewport-fit=cover` and `env(safe-area-inset-bottom)` already implemented — safe area inset task collapsed to a no-op
- App.svelte already debounces fitTerm with 100ms timer — only the ResizeObserver in Terminal.svelte needs a keyboard guard

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

## Task 1: overscroll-behavior: none

**Files:**
- Modify: `frontend/src/app.css:29-36`

**Step 1: Add overscroll-behavior to body**

In `app.css`, add `overscroll-behavior: none` to the `html, body` block:

```css
html, body {
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
}
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: 0 errors, same warnings as before

**Step 3: Commit**

```bash
git add frontend/src/app.css
git commit -m "fix: add overscroll-behavior: none to prevent pull-to-refresh on mobile"
```

---

## Task 2: Mobile font size 12px

**Files:**
- Modify: `frontend/src/components/Terminal.svelte:41`

**Step 1: Change fontSize to be mobile-aware**

In `Terminal.svelte`, change the xterm Terminal config:

```typescript
const t = new Terminal({
  cursorBlink: true,
  fontSize: isMobileDevice ? 12 : 14,
  fontFamily: 'Menlo, monospace',
  scrollback: 10000,
  // ...
});
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: 0 errors

**Step 3: Commit**

```bash
git add frontend/src/components/Terminal.svelte
git commit -m "feat: use 12px font on mobile for more terminal content"
```

---

## Task 3: Scroll FABs (floating action buttons)

**Files:**
- Modify: `frontend/src/components/Terminal.svelte` (markup + CSS + handlers)

**Step 1: Add scroll FAB handlers**

In Terminal.svelte, add two functions after the existing scrollbar handlers (after `onScrollbarClick`):

```typescript
function scrollPageUp() {
  term?.scrollPages(-1);
}

function scrollPageDown() {
  term?.scrollPages(1);
}
```

**Step 2: Add FAB markup**

In Terminal.svelte, inside `.terminal-wrapper` after the `.terminal-scrollbar` div, add:

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

**Step 3: Add FAB styles**

In Terminal.svelte `<style>`, add inside the existing `@media (hover: none)` block:

```css
.scroll-fabs {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1;
  opacity: 0.15;
  pointer-events: auto;
}

.scroll-fab {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
}

.scroll-fab:active {
  opacity: 1;
  background: var(--border);
}
```

**Step 4: Build to verify**

Run: `npm run build`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/components/Terminal.svelte
git commit -m "feat: add scroll page-up/page-down FABs on mobile"
```

---

## Task 4: Debounce ResizeObserver fit() during keyboard animation

**Files:**
- Modify: `frontend/src/components/Terminal.svelte:10-16` (props), `134-138` (ResizeObserver)
- Modify: `frontend/src/App.svelte:216-220` (pass prop)

**Step 1: Add keyboardOpen prop to Terminal.svelte**

Update the props destructuring:

```typescript
let {
  sessionId,
  onImageUpload,
  keyboardAnimating = false,
}: {
  sessionId: string | null;
  onImageUpload?: (text: string, showInsert: boolean, path?: string) => void;
  keyboardAnimating?: boolean;
} = $props();
```

**Step 2: Guard the ResizeObserver**

Change the ResizeObserver callback in `onMount` from:

```typescript
const ro = new ResizeObserver(() => {
  fitAddon.fit();
  sendPtyResize(t.cols, t.rows);
  updateScrollbar();
});
```

To:

```typescript
let roTimer: ReturnType<typeof setTimeout> | null = null;
const ro = new ResizeObserver(() => {
  // Skip immediate fit() during keyboard animation — debounce to avoid
  // xterm re-render flash from rapid visualViewport resize events.
  if (roTimer) clearTimeout(roTimer);
  roTimer = setTimeout(() => {
    fitAddon.fit();
    sendPtyResize(t.cols, t.rows);
    updateScrollbar();
  }, isMobileDevice ? 150 : 0);
});
```

Note: We debounce all mobile ResizeObserver calls (not just during keyboard) because the ResizeObserver fires during the layout resize animation. The 150ms debounce on mobile ensures we only fit once after the resize settles. Desktop gets immediate (0ms) behavior — no regression.

**Step 3: Clean up timer in teardown**

Add to the cleanup function:

```typescript
return () => {
  if (roTimer) clearTimeout(roTimer);
  ro.disconnect();
  // ... rest of cleanup
};
```

**Step 4: Build to verify**

Run: `npm run build`
Expected: 0 errors

**Step 5: Commit**

```bash
git add frontend/src/components/Terminal.svelte frontend/src/App.svelte
git commit -m "fix: debounce ResizeObserver fit() on mobile to reduce keyboard animation flash"
```

---

## Task 5: Long-press text selection

**Files:**
- Modify: `frontend/src/components/Terminal.svelte` (new state + handlers + CSS)

**Step 1: Add selection mode state**

After the content-area touch scroll state block, add:

```typescript
// ── Long-press text selection state (mobile) ─────────────────────────────
let selectionMode = $state(false);
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressStartX = 0;
let longPressStartY = 0;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;
```

**Step 2: Add long-press detection to onTerminalTouchStart**

Update `onTerminalTouchStart` to start the long-press timer:

```typescript
function onTerminalTouchStart(e: TouchEvent) {
  if ((e.target as HTMLElement).closest('.terminal-scrollbar')) return;
  if ((e.target as HTMLElement).closest('.scroll-fabs')) return;
  if (!term) return;
  const touch = e.touches[0];
  if (!touch) return;

  // Content scroll tracking
  contentTouchStartY = touch.clientY;
  contentScrollStartLine = term.buffer.active.viewportY;
  contentTouchMoved = false;
  contentScrolling = true;

  // Long-press detection
  longPressStartX = touch.clientX;
  longPressStartY = touch.clientY;
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    enterSelectionMode();
  }, LONG_PRESS_MS);
}
```

**Step 3: Cancel long-press on movement**

Update `onDocumentTouchMove` — add at the top of the content-area scroll branch (inside `if (contentScrolling && term)`), before the existing dead-zone check:

```typescript
// Cancel long-press timer if finger moved too far
if (longPressTimer) {
  const dx = contentTouchStartY - touch.clientY;
  // Use contentTouchStartY for vertical (already computed as deltaY below)
  // but also need horizontal check
  const moveX = Math.abs(touch.clientX - longPressStartX);
  const moveY = Math.abs(contentTouchStartY - touch.clientY);
  if (moveX > LONG_PRESS_MOVE_TOLERANCE || moveY > LONG_PRESS_MOVE_TOLERANCE) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}
```

**Step 4: Cancel long-press on touch end**

Update `onDocumentTouchEnd`:

```typescript
function onDocumentTouchEnd() {
  scrollbarDragging = false;
  contentScrolling = false;
  contentTouchMoved = false;
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}
```

**Step 5: Implement enterSelectionMode and exitSelectionMode**

```typescript
function enterSelectionMode() {
  longPressTimer = null;
  selectionMode = true;
  contentScrolling = false; // stop scroll — user wants to select

  // Haptic feedback
  if (navigator.vibrate) navigator.vibrate(50);

  // Enable text selection on xterm's screen element
  const xtermScreen = containerEl.querySelector('.xterm-screen') as HTMLElement | null;
  if (xtermScreen) {
    xtermScreen.style.userSelect = 'text';
    xtermScreen.style.webkitUserSelect = 'text';
  }
}

function exitSelectionMode() {
  selectionMode = false;
  const xtermScreen = containerEl.querySelector('.xterm-screen') as HTMLElement | null;
  if (xtermScreen) {
    xtermScreen.style.userSelect = '';
    xtermScreen.style.webkitUserSelect = '';
  }
  // Clear any browser selection
  window.getSelection()?.removeAllRanges();
}
```

**Step 6: Exit selection mode on next touch**

Update `onTerminalTouchStart` — add at the very top, before the scrollbar guard:

```typescript
if (selectionMode) {
  exitSelectionMode();
  return; // consume the touch that exits selection mode
}
```

**Step 7: Suppress scroll during selection mode**

Update the content-area scroll branch in `onDocumentTouchMove` — add a guard:

```typescript
// Content-area touch scroll
if (contentScrolling && term && !selectionMode) {
```

**Step 8: Don't focus input during selection**

Update `onTerminalTouchEnd`:

```typescript
function onTerminalTouchEnd(e: TouchEvent) {
  if (scrollbarDragging) return;
  if (contentTouchMoved) return;
  if (selectionMode) return;
  if ((e.target as HTMLElement).closest('.terminal-scrollbar')) return;
  mobileInputRef?.focus();
}
```

**Step 9: Clean up timer in teardown**

Add to the cleanup return:

```typescript
if (longPressTimer) clearTimeout(longPressTimer);
```

**Step 10: Add visual indicator CSS**

In `<style>`, inside `@media (hover: none)`:

```css
.terminal-wrapper.selection-mode .terminal-container {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
```

**Step 11: Add selection-mode class to wrapper**

Update the wrapper markup:

```svelte
<div
  class="terminal-wrapper"
  class:drag-over={dragOver}
  class:selection-mode={selectionMode}
  ontouchstart={isMobileDevice ? onTerminalTouchStart : undefined}
  ontouchend={isMobileDevice ? onTerminalTouchEnd : undefined}
>
```

**Step 12: Build to verify**

Run: `npm run build`
Expected: 0 errors

**Step 13: Commit**

```bash
git add frontend/src/components/Terminal.svelte
git commit -m "feat: add long-press text selection mode on mobile"
```

---

## Task 6: Build + test + final verification

**Step 1: Full build**

Run: `npm run build`
Expected: 0 errors, no new warnings

**Step 2: Run tests**

Run: `npm test`
Expected: 77/77 pass (or more if new tests added)

**Step 3: Review diff**

Run: `git diff --stat`
Verify only expected files changed.

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
