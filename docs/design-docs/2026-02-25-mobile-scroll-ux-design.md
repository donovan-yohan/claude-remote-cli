# Mobile Scroll & Touch UX Improvements

**Created:** 2026-02-25
**Status:** Approved
**Branch:** fix/scroll-ux

## Context

Terminal scrolling on mobile Android is broken — xterm.js's internal touch handler scrolls one line at a time, and there's no content-area swipe scroll. The initial fix (already implemented on the branch) adds smooth touch-to-scroll and disables xterm's line-by-line handling.

This design covers 6 additional mobile UX patterns inspired by [claude-wormhole](https://github.com/ssv445/claude-wormhole), adapted for our architecture (direct PTY, no tmux layer).

## Patterns

### 1. Debounce fit() during keyboard animation

**Problem:** When the virtual keyboard opens/closes, `visualViewport` fires multiple resize events. Each triggers `fitAddon.fit()` + xterm re-render, causing a flash.

**Wormhole approach:** Skip fit() entirely while keyboard is open (works for them because they use CSS transform instead of layout resize).

**Our approach:** We keep layout resize (it gives correct row count — see trade-off below). Guard the ResizeObserver to skip fit() while the keyboard is animating. Fire fit() once after the animation settles (~300ms debounce).

**Trade-off:** Wormhole's transform approach is smoother but clips the top of the terminal behind the viewport when the keyboard is open — users can't scroll to the very top of the session. Our layout resize ensures all visible rows are truly visible, which matters when reading long Claude responses while typing.

**Files:** `Terminal.svelte` (ResizeObserver guard), `App.svelte` (pass keyboard state down)

### 2. overscroll-behavior: none

**Problem:** Android pull-to-refresh and elastic overscroll can interfere with terminal touch gestures.

**Our approach:** Add `overscroll-behavior: none` to `html, body` in `app.css`. One-line fix, no trade-offs.

**Files:** `app.css`

### 3. Safe area insets for notch/home indicator

**Problem:** On modern phones with home indicators (iPhone X+, Android gesture nav), bottom UI can be hidden behind the indicator.

**Wormhole approach:** Uses `env(safe-area-inset-bottom) / 2` — half the inset because their bottom bar is already tall.

**Our approach:** Use the full `env(safe-area-inset-bottom)` on the bottom toolbar/input area. Add `viewport-fit=cover` to the HTML meta tag to enable the inset variables.

**Trade-off:** Full inset is slightly more padding than wormhole's half-inset, but safer — avoids any content behind the indicator. Can tune down if it looks excessive.

**Files:** `index.html` (viewport meta), `app.css` or `Toolbar.svelte` / `MobileInput.svelte` (padding)

### 4. Mobile font size 12px

**Problem:** 14px font on small mobile screens shows fewer columns/rows than necessary.

**Wormhole approach:** 11px on mobile.

**Our approach:** 12px — slightly larger for readability, still gains ~2 extra columns and ~3 extra rows vs 14px on a typical phone.

**Files:** `Terminal.svelte` (xterm config)

### 5. Long-press for text selection

**Problem:** On mobile, there's no way to select/copy text from the terminal. xterm.js's `SelectionService` exists but is blocked by our touch scroll handlers consuming touch events.

**Wormhole approach:** Sends escape sequences (`\x1b[?1000l...`) through WebSocket to disable tmux's mouse tracking, letting xterm's native selection work. Uses `navigator.vibrate(50)` for haptic feedback.

**Our approach:** We don't go through tmux, so sending escape sequences could confuse Claude Code mid-interaction. Instead: on 500ms long-press (finger stays within 10px), temporarily set CSS `user-select: text` on the xterm screen element and suppress our scroll handlers. This lets the browser's native text selection work without touching the PTY stream. Haptic feedback via `navigator.vibrate(50)` if available. Exit selection mode on next `touchstart`.

**Trade-off:** Wormhole's approach toggles xterm's actual selection service (richer integration). Our CSS approach is less invasive but relies on browser native selection over a canvas element, which may not work well since xterm renders to canvas. Fallback: if canvas selection doesn't work, we'll use xterm's `select()` API with coordinates computed from touch position.

**Files:** `Terminal.svelte` (new long-press handlers + selection mode state)

### 6. Scroll FABs (floating action buttons)

**Problem:** The scrollbar thumb (12px wide) is a small touch target. Some users prefer tapping buttons over dragging.

**Wormhole approach:** Sends SGR mouse wheel escape sequences to tmux for page-up/page-down. 10% opacity, positioned mid-right.

**Our approach:** Use xterm.js client-side API `term.scrollPages(-1)` / `term.scrollPages(1)`. No PTY involvement — scrolling stays in the local scrollback buffer. Semi-transparent, mobile-only, positioned mid-right edge.

**Trade-off:** Wormhole's approach scrolls the remote tmux session. Ours scrolls the local xterm buffer, which is correct for our architecture (scrollback is client-side).

**Files:** `Terminal.svelte` (new markup + CSS, mobile-only via `@media` or `isMobileDevice`)

## Not Included

**CSS transform for keyboard:** Wormhole shifts the terminal up via `translateY(-Npx)` instead of resizing. This clips the top of the terminal while the keyboard is open — users can't scroll to the start of the session. Our layout resize is better for reading Claude output while typing.

## Implementation Order

1. overscroll-behavior (trivial CSS)
2. Mobile font size (one-line config change)
3. Safe area insets (CSS + HTML meta)
4. Scroll FABs (new markup, self-contained)
5. Debounce fit() during keyboard (cross-component state)
6. Long-press text selection (most complex, needs testing)
