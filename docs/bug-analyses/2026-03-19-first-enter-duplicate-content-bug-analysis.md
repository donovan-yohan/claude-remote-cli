# Bug Analysis: First Enter Modifies/Duplicates Input on New Worktree Sessions

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: server/ws.ts (branch rename interception, lines 172-193)

## Symptoms
- On new worktree sessions (mountain-named), the first Enter press modifies the user's input
- **Duplication variant**: Entire message appears twice (seen in `makalu` worktree)
- **Truncation variant**: Words deleted from end of input ("being sent" → "being")
- Happens 100% of the time on first Enter of a new mountain-named worktree session
- Does NOT happen on subsequent Enter presses (flag is cleared after first)

## Reproduction Steps
1. Open the web interface
2. Click "New Worktree" on any workspace (creates mountain-named worktree)
3. Wait for Claude Code to load in the terminal
4. Type a message (e.g., "hello world")
5. Press Enter
6. Observe: text is duplicated or truncated

## Root Cause

The branch rename interception logic in `server/ws.ts:172-193` sends user keystrokes to the PTY **twice** and relies on `\x15` (Ctrl+U) to undo the first set — but Ctrl+U doesn't work reliably in Claude Code's custom Ink/React TUI.

**The code flow:**

```
1. User types "hello world" — each character arrives as WebSocket message
2. Line 178-179: Character buffered AND passed through to PTY
   → PTY echoes character → user sees it in Claude Code's input
3. User presses Enter
4. Line 187: \x15 (Ctrl+U) sent to PTY to "clear the input line"
5. Line 188: renamePrompt + buffered "hello world" + \r sent to PTY
```

**Why it fails:** Claude Code uses a custom React/Ink text input component, NOT readline. `\x15` (Ctrl+U) behavior is undefined in this context:
- **If Ctrl+U does nothing**: passthrough text stays + replay appends → **duplication**
- **If Ctrl+U partially clears**: some passthrough remains, replay overlaps → **truncation**

## Evidence
- `makalu` screenshot: text exactly doubled, no rename prompt visible (scrolled above)
- `lhotse` screenshot: "being sent" → "being" — Ctrl+U partially cleared the line
- Code at `server/ws.ts:179`: `ptySession.pty.write(str)` — passthrough sends chars to PTY during buffering
- Code at `server/ws.ts:187-188`: `\x15` + replay sends the SAME chars again
- `needsBranchRename` is set `true` for all mountain-named worktrees (`server/index.ts:732`)
- Bug only on first Enter: `needsBranchRename = false` after first interception (line 189)

## Impact Assessment
- All new worktree sessions with mountain names are affected (the primary creation flow)
- First interaction with Claude Code sends garbled/duplicated input
- Users must manually fix the input or start over
- The rename prompt itself may also be malformed due to the duplication

## Recommended Fix Direction

**Remove the passthrough-then-undo approach.** Don't send characters to the PTY during buffering — buffer silently and send only once when Enter is detected:

```typescript
// server/ws.ts - branch rename interception
if (ptySession.needsBranchRename) {
    if (!(ptySession as any)._renameBuffer) (ptySession as any)._renameBuffer = '';
    const enterIndex = str.indexOf('\r');
    if (enterIndex === -1) {
        // Buffer WITHOUT passthrough — don't write to PTY
        (ptySession as any)._renameBuffer += str;
        return; // silent buffering, no echo until Enter
    }
    // Enter detected — send everything to PTY in one shot (no Ctrl+U needed)
    const buffered: string = (ptySession as any)._renameBuffer;
    const beforeEnter = buffered + str.slice(0, enterIndex);
    const afterEnter = str.slice(enterIndex);
    const renamePrompt = `Before doing anything else...`;
    ptySession.pty.write(renamePrompt + beforeEnter + afterEnter);
    // ... cleanup
}
```

**Trade-off**: User types "blind" (no echo) until Enter, but this is a one-time occurrence per worktree and eliminates the duplication/truncation bug entirely. The PTY will echo the full message (rename prompt + user text) after Enter.

**Alternative (better UX)**: Echo characters back to the WebSocket client directly (not via PTY) during buffering, so the user sees their typing. Then on Enter, clear the client terminal and send the full message to PTY. This requires coordinating client-side clearing with server-side injection.
