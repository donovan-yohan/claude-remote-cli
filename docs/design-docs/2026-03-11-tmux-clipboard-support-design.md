# Tmux Clipboard Support Design

**Date:** 2026-03-11
**Status:** Approved

## Problem

When tmux runs inside xterm.js (via the "Launch in tmux" setting), mouse events are captured by tmux. Users cannot select text to copy — click-drag selects in tmux's internal buffer (never reaching the browser clipboard), and right-click opens the browser context menu instead of being useful.

## Solution

Two complementary mechanisms that cover different workflows:

### 1. OSC 52 Clipboard Passthrough (copy only)

tmux emits OSC 52 escape sequences when text is copied in copy-mode. xterm.js intercepts these and writes the decoded payload to the browser Clipboard API.

**How it works:**

1. User enters tmux copy-mode (prefix + `[`), selects text, presses Enter
2. tmux emits `\033]52;c;<base64-encoded-text>\a`
3. xterm.js `onOsc` handler detects sequence 52
4. Handler base64-decodes the payload and calls `navigator.clipboard.writeText()`

**Server-side (sessions.ts):** Add tmux options to `resolveTmuxSpawn()`:

- `set set-clipboard on` — tells tmux to emit OSC 52 on copy (session-scoped, not global)
- `set allow-passthrough on` — allows OSC sequences to pass through to the outer terminal (xterm.js)

No other server changes needed — OSC 52 sequences are just bytes flowing through the existing PTY → WebSocket pipeline.

**Frontend (Terminal.svelte):** Register a handler via xterm.js `parser.registerOscHandler(52, ...)` to intercept the sequence, decode the base64 payload, and write to `navigator.clipboard.writeText()`.

### 2. Shift+Click Browser Selection Bypass

Hold Shift to bypass tmux's mouse capture and use xterm.js's native selection layer.

**How it works:**

1. User holds Shift and click-drags in the terminal
2. xterm.js natively does not forward Shift+mouse events to the PTY — tmux never sees them
3. xterm.js's built-in selection layer highlights the text
4. User can Shift+right-click to open the browser context menu (which includes Copy)
5. Or use Cmd/Ctrl+C to copy the selection

**Frontend (Terminal.svelte):** Verify that xterm.js's default Shift+mouse bypass behavior is not being interfered with by custom touch/mouse handlers. The existing `attachCustomKeyEventHandler` only intercepts keyboard events (Ctrl+V), so mouse events should pass through. If any custom event listeners on the terminal container (e.g., touch handlers) suppress mouse events, gate them on `!event.shiftKey`.

## Components Affected

| File | Change |
|------|--------|
| `server/sessions.ts` | Add `set-clipboard on` and `allow-passthrough on` to tmux spawn args |
| `frontend/src/components/Terminal.svelte` | Add OSC 52 handler; verify Shift+mouse bypass works |

## Scope Boundaries

- **Copy only** — no OSC 52 paste direction (security risk; paste already works via Ctrl/Cmd+V)
- **No custom right-click menu** — browser default context menu is sufficient
- **No mobile changes** — mobile already has long-press selection mode
- **Desktop only** — this addresses desktop tmux interaction

## Testing

- Manual: launch a tmux session, enter copy-mode, copy text, verify it appears in browser clipboard
- Manual: Shift+drag in tmux terminal, verify xterm.js selection layer activates, Shift+right-click shows browser context menu with Copy
- Unit: OSC 52 base64 decode logic (if extracted to a utility)
