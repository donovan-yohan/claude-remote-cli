# Bug Analysis: Non-tmux sessions can't scroll during active Claude streaming

> **Status**: Confirmed | **Date**: 2026-03-20
> **Severity**: High
> **Affected Area**: `frontend/src/components/Terminal.svelte` — alternate screen scroll + missing viewport freeze

## Symptoms
- In non-tmux terminal sessions, the terminal viewport resets every time Claude sends new output
- User cannot scroll through Claude Code's conversation while Claude is actively streaming/generating
- Scrolling briefly takes effect but immediately snaps back as new content arrives
- Tmux sessions do not exhibit this problem (copy-mode decouples viewport from live output)

## Reproduction Steps
1. Create a session WITHOUT tmux enabled
2. Send a prompt to Claude that produces a long response (longer than one screen)
3. While Claude is actively streaming, try to scroll up to read earlier output
4. Observe: the terminal immediately jumps back as new tokens arrive — scroll position cannot be maintained

## Root Cause

The root cause is **architectural**: non-tmux sessions have no mechanism to decouple the user's viewport from the TUI application's live rendering during streaming.

### The chain of events:

1. **Claude Code runs in the alternate screen buffer** (`\x1b[?1049h`). In alternate screen, xterm.js has no scrollback — `baseY` = 0, `viewportY` = 0. The TUI application controls what content is displayed on screen.

2. **Touch/wheel scroll works correctly** — the handler at `Terminal.svelte:447-467` sends SGR mouse wheel sequences (`\x1b[<64;col;rowM` / `\x1b[<65;col;rowM`) to the PTY. Claude Code's TUI processes these and scrolls its conversation view.

3. **During active streaming, Claude Code continuously re-renders** — each new token/chunk causes the TUI to reposition the cursor at home (`\x1b[H`) and redraw the entire screen to show the latest content. This happens tens of times per second during streaming.

4. **Each re-render overrides the user's scroll position** — the TUI's auto-follow behavior immediately replaces whatever the user scrolled to with the latest content. The user's scroll input is received and processed, but its effect is instantly overwritten by the next render frame.

5. **The web app faithfully renders every update** — `ws.ts:64` writes PTY data directly to xterm.js (`term.write(event.data)`), and xterm.js processes the escape sequences, showing exactly what the TUI sends. There is no intermediate buffering layer.

### Why tmux sessions don't have this problem:

Tmux provides a **viewport freeze mechanism** via copy-mode (`Ctrl-b [`):
- When the user enters copy-mode, tmux freezes the displayed output
- New PTY output continues to be captured in tmux's own buffer but **does not affect the user's view**
- The user can scroll freely through tmux's scrollback regardless of ongoing PTY activity
- Exiting copy-mode resumes live output

Non-tmux sessions lack this intermediate buffer layer. The web app has no equivalent of tmux's copy-mode — the xterm.js terminal is directly coupled to the PTY output stream.

## Evidence
- `Terminal.svelte:447-467`: SGR wheel events are correctly sent to PTY during alternate screen
- `ws.ts:64`: PTY data written directly to terminal with no buffering: `term.write(event.data as string)`
- `Terminal.svelte:168-169`: `onWriteParsed` and `onScroll` only update the custom scrollbar thumb, don't preserve scroll position
- Prior bug analysis (`2026-03-17-non-tmux-scroll-bug-analysis.md`) confirmed scroll events reach Claude Code correctly — the issue is not event delivery but **rendering overwrite**
- In alternate screen buffer: `baseY` = 0, `viewportY` = 0 — xterm.js has no scrollback to preserve
- All UI components above/below the terminal have fixed heights (`PrTopBar: 36px`, `SessionTabBar: 32px`, `Toolbar: fixed`) — no layout-triggered ResizeObserver during streaming

## Impact Assessment
- **All non-tmux sessions** are affected during active Claude streaming
- Mobile and desktop users both affected (different scroll mechanisms, same root cause)
- Users cannot review earlier conversation output while Claude is responding
- Workaround exists: enable tmux for the session (tmux copy-mode provides viewport freeze)
- Feature parity gap: tmux sessions have a critical UX advantage over non-tmux sessions

## Recommended Fix Direction

Implement a **virtual scroll lock** (web-app-level copy-mode equivalent) for non-tmux alternate screen sessions:

### Option A — Screen buffer snapshotting (recommended)
1. Periodically capture the visible screen content via `buffer.active.getLine(y)` into a ring buffer of screen snapshots
2. When the user initiates a scroll in alternate screen (non-tmux), transition to "frozen" mode:
   - Continue writing PTY data to xterm.js in the background (TUI keeps working)
   - Render the frozen snapshot as a text overlay on top of the live terminal
   - Allow the user to navigate through captured snapshots (scroll up = older frames)
3. When the user scrolls to bottom or taps a "Back to live" indicator, dismiss the overlay and show live output
4. This replicates tmux copy-mode behavior at the web app level without requiring tmux

### Option B — Output gating during scroll
1. When user scrolls up in alternate screen, pause `term.write()` calls (buffer incoming data)
2. User reviews current screen without disruption
3. When user scrolls back to bottom, flush buffered data to xterm.js
4. Risk: large buffer accumulation during extended scroll; TUI state may desync if events are delayed

### Option C — Default to tmux (quickest workaround)
1. Make `useTmux: true` the default for all sessions
2. Show a user-facing note if tmux is unavailable
3. Downside: doesn't fix the root cause; users who prefer non-tmux sessions still affected
