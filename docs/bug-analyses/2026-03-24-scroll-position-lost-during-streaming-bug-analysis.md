# Bug Analysis: Scroll position lost when Claude sends new output during streaming

> **Status**: Confirmed | **Date**: 2026-03-24
> **Severity**: High
> **Affected Area**: `frontend/src/components/Terminal.svelte`, `frontend/src/lib/ws.ts` — alternate screen viewport coupling

## Symptoms
- User scrolls up in a terminal session to read earlier Claude output
- When Claude sends a new message/token, the terminal view jumps away from the user's scroll position
- Users cannot read previous text while the agent is actively working and sending new messages
- Affects both mobile (touch scroll) and desktop (mouse wheel) in non-tmux sessions

## Reproduction Steps
1. Open a non-tmux Claude session
2. Send Claude a prompt that produces a long response (longer than one screen)
3. While Claude is actively streaming, scroll up to read earlier output
4. Observe: the terminal view immediately jumps back — scroll position cannot be maintained

## Root Cause

This is the **same architectural limitation** identified in the [2026-03-20 non-tmux scroll during streaming analysis](2026-03-20-non-tmux-scroll-during-streaming-bug-analysis.md), which remains unresolved.

### The chain of events:

1. **Claude Code runs in the alternate screen buffer** (`\x1b[?1049h`). In alternate screen, xterm.js has no scrollback — `baseY=0`, `viewportY=0`. The TUI application fully controls what is displayed on screen.

2. **User scroll works correctly at the moment of interaction** — mobile touch scroll sends SGR mouse wheel sequences (`Terminal.svelte:447-467`), desktop wheel events are forwarded by xterm.js natively. Claude Code's TUI processes these and scrolls the conversation view.

3. **During active streaming, Claude Code continuously re-renders** — each new token causes the TUI to reposition the cursor at home (`\x1b[H`) and redraw the entire visible screen to show the latest content. This happens tens of times per second.

4. **Each re-render overrides the user's scroll position** — the TUI's auto-follow behavior replaces whatever the user scrolled to with the latest content. The user's scroll input is received and processed, but immediately overwritten by the next render frame.

5. **The web app faithfully renders every frame** — `ws.ts:123` writes PTY data directly to xterm.js (`term.write(str)`), and xterm.js processes the escape sequences. There is no intermediate buffering or viewport preservation layer.

### Verified NOT the cause:
- **`window.scrollTo(0, 0)` in `App.svelte:91`** — only fires on mobile `visualViewport` resize/scroll events (keyboard open/close), not on PTY data writes
- **Reactive cascades clearing `activeSessionId`** — event socket handlers (`session-state-changed`, `session-idle-changed`, etc.) do not change `activeSessionId`; the `$effect` that reconnects the terminal does not re-fire during streaming
- **`refreshAll()` from `worktrees-changed`** — updates session list but does not change `activeSessionId` unless the session no longer exists (impossible during active streaming)
- **ResizeObserver** — preserves scroll position via `wasAtBottom`/`savedViewportY` logic
- **Scrollback replay** — only happens on WebSocket connection, not during ongoing streaming
- **xterm.js default behavior** — in normal screen mode, `term.write()` does NOT auto-scroll when user is scrolled up; this issue is specific to alternate screen mode where the TUI controls rendering

### Why tmux sessions are unaffected:
Tmux provides copy-mode (`Ctrl-b [`), which freezes the displayed output. New PTY data is captured in tmux's internal buffer but does not affect the user's view until copy-mode is exited.

## Evidence
- `ws.ts:123`: PTY data written directly to terminal: `term.write(str)` — no buffering or scroll preservation
- `Terminal.svelte:168-169`: `onWriteParsed` and `onScroll` only update the custom scrollbar thumb, not viewport position
- `Terminal.svelte:447-467`: Touch scroll correctly sends SGR mouse wheel events — the events are processed but immediately overwritten
- Prior analysis `2026-03-20-non-tmux-scroll-during-streaming-bug-analysis.md`: confirmed same root cause
- `git log --grep="scroll" --since="2026-03-20"`: no fix was implemented for the prior analysis

## Impact Assessment
- **All non-tmux sessions** affected during active Claude streaming (both agent and terminal types running TUI apps)
- Both mobile and desktop users affected (different scroll mechanisms, same root cause)
- Users cannot review earlier conversation output while Claude is responding
- This is a **high-impact UX gap** — the most common user workflow (read earlier context while Claude works) is completely broken for non-tmux sessions
- Workaround: enable tmux for sessions (tmux copy-mode provides viewport freeze)

## Recommended Fix Direction

Implement a **web-app-level virtual scroll lock** (copy-mode equivalent for non-tmux sessions):

### Option A — Screen buffer snapshotting (recommended)
1. Periodically capture visible screen content via `buffer.active.getLine(y)` into a ring buffer of screen snapshots
2. When user scrolls in alternate screen (non-tmux), enter "frozen" mode:
   - Continue writing PTY data to xterm.js in the background
   - Render the frozen snapshot as a read-only text overlay on top of the live terminal
   - Allow user to scroll through captured snapshots (earlier frames)
3. "Back to live" indicator at bottom dismisses overlay and resumes live view
4. Replicates tmux copy-mode behavior at the web app level

### Option B — Output gating during scroll
1. When user scrolls up in alternate screen, pause `term.write()` (buffer incoming WebSocket data)
2. User reviews current screen content without disruption
3. When user scrolls to bottom / taps "resume", flush buffered data
4. Risk: large buffer accumulation; TUI state desync if events are delayed

### Option C — Default tmux for all sessions (interim workaround)
1. Make `useTmux: true` the default for new sessions
2. Educate users about copy-mode (`Ctrl-b [`)
3. Doesn't fix root cause; users who prefer non-tmux are still affected
