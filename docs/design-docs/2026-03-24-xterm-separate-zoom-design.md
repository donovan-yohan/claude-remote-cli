---
status: current
---
# Design: Separate Terminal Zoom

## Goal

Allow users to zoom the xterm terminal panel independently from the browser page zoom. The default terminal font size (14px) is larger than the app's content font size, so page-level zoom makes the terminal comically large when users just want readable sidebar text. Separate zoom gives users fine-grained control over terminal readability without affecting the rest of the UI.

## Approach

Add Cmd/Ctrl + =/- keyboard shortcuts that adjust the xterm font size when the terminal is focused, persisted globally via localStorage. Desktop-only feature — mobile terminals keep the fixed 12px size.

## Key Decisions

1. **Global zoom level** — one font size setting shared across all terminal sessions (not per-workspace)
2. **Unified keyboard handler** — zoom checks added to the existing `attachCustomKeyEventHandler` callback alongside the Ctrl+V paste handler, using early-return `if` blocks
3. **Transient overlay** — small pill in top-right of terminal wrapper showing zoom percentage (e.g., "120%"), fades out after ~1.5s. No persistent indicator.
4. **Shared constant** — `DEFAULT_TERMINAL_FONT_SIZE = 14` extracted to `ui.svelte.ts` and imported where needed
5. **Update estimateTerminalDimensions** — scale the hardcoded char width/line height assumptions by the font size ratio so pre-connection estimates are accurate
6. **Test pure logic** — extract `clampFontSize()`, `zoomPercentage()`, and dimension scaling into pure functions testable with the existing Node.js test runner. No new frontend test infrastructure.

## Implementation Details

### Files to modify
- `frontend/src/lib/state/ui.svelte.ts` — add `DEFAULT_TERMINAL_FONT_SIZE`, `MIN_TERMINAL_FONT_SIZE = 8`, `MAX_TERMINAL_FONT_SIZE = 28`, persistence functions, getter/setter on `getUi()`
- `frontend/src/components/Terminal.svelte` — extend key handler with zoom shortcuts, apply persisted font size on mount, add overlay markup + CSS, call `fitTerm()` after zoom
- `frontend/src/lib/utils.ts` — update `estimateTerminalDimensions()` to import and use font size constant with scaling

### New test file
- `test/terminal-zoom.test.ts` — test `clampFontSize()`, `zoomPercentage()`, dimension scaling

### Keyboard shortcuts (desktop only)
- `Cmd/Ctrl + =` or `Cmd/Ctrl + +` — zoom in (increment 1px, max 28px)
- `Cmd/Ctrl + -` — zoom out (decrement 1px, min 8px)
- `Cmd/Ctrl + 0` — reset to default (14px)
- `e.preventDefault()` blocks browser zoom; `return false` blocks xterm processing

### Persistence
- localStorage key: `claude-remote-terminal-font-size`
- Follows same pattern as sidebar width persistence in ui.svelte.ts

### Overlay
- Positioned top-right of `.terminal-wrapper`
- Shows zoom percentage relative to base 14px (e.g., 100%, 114%, 57%)
- CSS opacity transition, fades out after ~1.5s
- Only renders on desktop (`isMobileDevice` guard)

## Status

status: current
eng-review: clean (2026-03-24)
