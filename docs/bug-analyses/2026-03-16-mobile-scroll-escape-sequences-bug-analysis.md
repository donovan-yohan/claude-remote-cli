# Bug Analysis: Mobile Scroll Inserts Escape Sequences in Non-tmux Sessions

> **Status**: Fixed | **Date**: 2026-03-16
> **Severity**: High
> **Affected Area**: `frontend/src/components/Terminal.svelte` — custom touch scroll handler

## Symptoms
- Touch scrolling on mobile inserts garbled characters like `<64;27;24M<64;27;24M7;24MMM...` into the terminal
- Only happens in non-tmux, non-Claude Code sessions (plain shell prompt)
- Tmux and Claude Code sessions handle scroll correctly because they consume mouse events

## Reproduction Steps
1. Open claude-remote-cli on a mobile device
2. Connect to a non-tmux session
3. Run a Claude Code session (or any program that enables alternate screen + mouse tracking)
4. After the program exits, return to the shell prompt
5. Attempt to scroll by swiping — garbled escape sequences appear as text

## Root Cause

Two independent issues combined to cause the bug:

**Issue 1: Touch handler sent SGR mouse sequences without checking mouse tracking mode**

The touch scroll handler at `Terminal.svelte:435` checked only `term.buffer.active.type === 'alternate'` to decide whether to send SGR mouse wheel sequences (`\x1b[<64;col;rowM`). But alternate screen mode does NOT imply mouse tracking is enabled. After a program exits without properly restoring terminal state (or when alternate screen is active without mouse tracking, e.g. `less` without mouse mode), the handler sent SGR sequences to a shell that couldn't consume them.

The shell echoed these sequences back. xterm.js consumed the `\x1b[` CSI prefix and displayed the remaining `<64;27;24M` as text — producing the garbled output.

**Issue 2: xterm.js could also generate mouse sequences from synthetic mouse events**

On mobile, touch events generate synthetic `mousedown`/`mouseup`/`mousemove` events. If mouse tracking was left enabled by a previous application (e.g., Claude Code crashed without cleanup), xterm.js's CoreMouseService would process these synthetic events and generate additional escape sequences.

## Evidence
- `\x1b[<64;col;rowM` is the SGR mouse wheel-up format — matches the garbled text exactly (after CSI consumption)
- xterm.js v6 exposes `term.modes.mouseTrackingMode` to check if mouse tracking is active
- The touch handler only checked `term.buffer.active.type === 'alternate'`, not mouse tracking mode
- No suppression of synthetic mouse/wheel events on `.xterm-screen` on mobile

## Impact Assessment
- All mobile users in non-tmux sessions experience garbled text when scrolling after running Claude Code or other TUI apps
- Core mobile interaction (scrolling) is broken in the most common non-tmux scenario
- Desktop users unaffected (xterm.js handles mouse events natively)

## Fix Applied

1. **Added `mouseTrackingMode` check**: SGR sequences are now only sent when BOTH alternate screen is active AND mouse tracking is enabled (`term.modes.mouseTrackingMode !== 'none'`)
2. **Arrow key fallback for pagers**: When alternate screen is active but mouse tracking is OFF (e.g., `less`, `man`), the handler sends arrow Up/Down keys instead — works with most pagers
3. **Suppressed synthetic mouse events**: Added capture-phase listeners on `.xterm-screen` to stop `wheel`, `mousedown`, `mouseup`, `mousemove` events from reaching xterm.js's mouse handler on mobile, preventing stale mouse tracking from generating sequences
