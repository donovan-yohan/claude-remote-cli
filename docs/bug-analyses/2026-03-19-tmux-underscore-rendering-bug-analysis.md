# Bug Analysis: tmux Unicode Characters Rendering as Underscores

> **Status**: Hypothesis (needs reproduction test) | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: `frontend/src/components/Terminal.svelte`, tmux PTY rendering pipeline

## Symptoms
- Claude Code status indicators (⏵, ✗, ●, etc.) render as `_` underscores in the web terminal
- Only affects tmux-wrapped sessions viewed through xterm.js
- Actual text content renders correctly — only specific Unicode icon characters are affected
- Reported as a regression — was previously working

## Reproduction Steps
1. Start server with tmux enabled (Settings → Launch in tmux)
2. Open any Claude Code session through the web UI
3. Give Claude a task that triggers tool use (e.g. "run ls")
4. Observe that status indicator characters before tool names render as `_`

## Root Cause (Hypothesis)

The recent change from `term.clear()` to `term.reset()` in `Terminal.svelte:220` (commit `b47fd32`) wipes all terminal state when navigating to a session. This includes:

- Character set configuration (G0/G1/G2/G3 sets, GL/GR pointers)
- Terminal modes (including any Unicode-related modes set by tmux at startup)
- DEC special character sets

**The mechanism:**

1. tmux sends terminal setup escape sequences when a session starts (character encoding, terminal modes, etc.)
2. These sequences are stored in the scrollback buffer as part of the raw PTY output
3. The scrollback buffer has a 256KB FIFO cap — on long-running sessions, these initial setup sequences get evicted
4. When the user navigates to a session, `term.reset()` fires, wiping all terminal state
5. Scrollback is replayed, but the initial setup sequences are missing
6. tmux's ongoing output contains wide Unicode characters (Claude Code's status icons) that depend on the terminal being in the correct state
7. Without the proper state, these characters render as `_` (tmux's standard replacement for characters with unknown display width)

With the old `term.clear()`, terminal state was preserved — only content was cleared. The accumulated terminal modes from tmux's initialization survived across session switches.

## Evidence
- Commit `b47fd32` explicitly changed `term.clear()` → `term.reset()` to "prevent state leaks from tmux/TUI sessions"
- The `_` replacement pattern is consistent with tmux's `utf8_width()` fallback behavior for characters with undetermined display width
- Only tmux-wrapped sessions are affected — the tmux layer intercepts and reinterprets character widths
- The `$effect` that calls `reset()` fires on EVERY session navigation, including fresh page loads
- The `scheduleReconnect()` function in `ws.ts:117` still uses `term.clear()` (not reset), which could explain why reconnects after disconnection might not show the issue

## Impact Assessment
- All tmux-wrapped Claude Code sessions show garbled status indicators
- The tool output prefixes, status spinners, and error indicators are unreadable
- Non-tmux sessions are unaffected (no tmux layer to misinterpret character widths)
- Affects all users with "Launch in tmux" enabled

## Recommended Fix Direction

**Primary fix**: Revert `term.reset()` back to `term.clear()` in `Terminal.svelte:220`. The original "state leak" problem that `reset()` was meant to fix (alternate screen buffer state leaking between sessions) should be addressed more surgically — e.g., by explicitly writing the alternate screen buffer exit sequence (`\033[?1049l`) before clearing, rather than resetting all terminal state.

**Alternative**: If `reset()` must be kept, add a post-reset initialization step that sends tmux's expected terminal setup sequences to xterm.js before replaying scrollback:
```typescript
term.reset();
// Re-establish UTF-8 and Unicode state that tmux expects
term.write('\x1b%G');  // Select UTF-8 character set
```

**Diagnostic step first**: Revert to `term.clear()` and verify the issue resolves. If it does, the hypothesis is confirmed. If not, investigate tmux version changes or Claude Code's Unicode character choices.
