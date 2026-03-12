# Bug Analysis: Mobile Touch Scroll Broken in tmux / Alternate Screen

> **Status**: Confirmed | **Date**: 2026-03-12
> **Severity**: High
> **Affected Area**: `frontend/src/components/Terminal.svelte` — custom touch scroll handler

## Symptoms
- Touch scrolling on mobile does nothing when tmux is running
- Desktop scrolling works fine (mouse wheel events pass through to PTY)
- Touch scrolling works on mobile when tmux is NOT active (normal buffer has scrollback)

## Reproduction Steps
1. Open claude-remote-cli on a mobile device (or touch-enabled browser)
2. Connect to a session running inside tmux
3. Generate enough output to exceed the visible area (e.g., `ls -la /usr/bin`)
4. Attempt to scroll up by swiping — nothing happens

## Root Cause

The custom mobile touch scroll handler (`Terminal.svelte:400-409`) uses `term.buffer.active.baseY` as the maximum scroll position. When tmux (or any program using the alternate screen buffer via DECSET 1049) is active, xterm.js's alternate buffer always has `baseY = 0` because tmux manages its own scrollback internally.

**The scroll math (line 407-408):**
```ts
const maxScroll = term.buffer.active.baseY;  // Always 0 in alternate screen
const targetLine = Math.max(0, Math.min(maxScroll, ...));  // Clamped to 0
```

This means `term.scrollToLine(0)` is called every time — a no-op.

**Why desktop works:** Desktop doesn't use the custom touch scroll. xterm.js's default mouse handling converts wheel events into escape sequences (`\x1b[M` with button codes 64/65) that get sent to the PTY. tmux (with `mouse on`) interprets these natively.

## Evidence
- `Terminal.svelte:76-77` — xterm's native touch scroll is explicitly disabled on mobile (`touchAction: 'none'`, `overflowY: 'hidden'`)
- `Terminal.svelte:407` — `term.buffer.active.baseY` is `0` when alternate screen is active
- No detection of alternate screen buffer anywhere in the codebase (grep for `buffer.normal`, `buffer.alternate`, `buffer.type` returns no results)
- No mouse wheel escape sequence generation in the touch handler

## Impact Assessment
- All mobile users with tmux enabled (default/recommended mode) cannot scroll
- Scrolling is a core mobile interaction — this is a major usability issue
- Also affects any alternate-screen program (vim, less, man, nano, etc.)
- Desktop users unaffected

## Recommended Fix Direction

**Detect alternate screen and send mouse wheel escape sequences instead of calling `scrollToLine`:**

1. **Detect alternate screen**: xterm.js exposes `term.buffer.active.type` — when it equals `'alternate'`, the terminal is in alternate screen mode

2. **In alternate screen mode**: Convert touch scroll deltas into SGR mouse wheel escape sequences and send via `sendPtyData()`:
   - Wheel up: `\x1b[<64;col;rowM`
   - Wheel down: `\x1b[<65;col;rowM`
   - This lets tmux (with `set -g mouse on`) handle scrolling natively

3. **In normal screen mode**: Keep existing `term.scrollToLine()` behavior (it works correctly for normal buffer scrollback)

4. **Accumulate fractional lines**: Track sub-line deltas to avoid requiring large swipe gestures for single-line scrolls
