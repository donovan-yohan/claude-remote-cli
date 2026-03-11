# Bug Analysis: --continue Flag Errors When No Previous Session Exists

> **Status**: Confirmed | **Date**: 2026-03-11
> **Severity**: Medium
> **Affected Area**: server/sessions.ts, server/ws.ts

## Symptoms
- When `--continue` flag is passed (via `defaultContinue` config or NewSessionDialog toggle) and Claude CLI has no previous session to continue, the session errors and the user sees the error/disconnection instead of a graceful fallback to a new session.

## Reproduction Steps
1. Enable `defaultContinue` in config or toggle "Continue" in the new session dialog
2. Start a repo session in a directory where Claude CLI has no previous conversation
3. Claude CLI errors with `--continue` because there's nothing to continue from
4. The session either dies or shows an error flash before retry

## Root Cause

There are **two interacting bugs**:

### Bug 1: WebSocket doesn't survive PTY replacement (primary)

The retry mechanism in `sessions.ts:182-205` correctly detects when `--continue` fails quickly and respawns without it. However, `ws.ts:85` captures `session.pty` at WebSocket connection time as a **local const**:

```typescript
// ws.ts:85 — captured ONCE at connection time
const ptyProcess = session.pty;
```

When the retry replaces `session.pty` (sessions.ts:202), the WebSocket handler still references the old PTY:
- **ws.ts:113**: Old PTY's `onExit` fires → closes WebSocket connection
- **ws.ts:91**: Data handler attached to old PTY → new PTY output never reaches client
- **ws.ts:106**: Client input writes to old (dead) PTY → user input goes nowhere

The session object survives (retry returns early before cleanup), but the WebSocket connection is severed.

### Bug 2: Tmux session name collision on retry

When `useTmux` is true, the retry at `sessions.ts:190-194` reuses the same `tmuxSessionName`. If the original tmux session hasn't fully cleaned up yet, `tmux new-session -s <same-name>` will fail because the name is already taken.

## Evidence
- `sessions.ts:202`: `session.pty = retryPty;` — replaces the PTY reference on the session object
- `ws.ts:85`: `const ptyProcess = session.pty;` — local binding, not reactive to replacement
- `ws.ts:113`: `ptyProcess.onExit(() => { ws.close(1000); })` — closes WebSocket when OLD PTY exits
- `sessions.ts:190`: Retry uses same `tmuxSessionName` — potential collision

## Impact Assessment
- Affects all users with `defaultContinue` enabled or who use the continue toggle
- Affects both repo sessions and worktree sessions (sessions created at index.ts:754 also use `--continue`)
- Tmux users hit both bugs; non-tmux users only hit Bug 1
- The retry mechanism (sessions.ts:182-205) works correctly at the session layer but its effects are invisible to connected WebSocket clients

## Recommended Fix Direction

**Option A (Recommended): Make WebSocket handlers reactive to PTY replacement**
- Instead of capturing `session.pty` once, have the WebSocket handler read from `session.pty` dynamically
- Add a PTY replacement event/callback mechanism so `ws.ts` can detach from the old PTY and reattach to the new one
- On retry: dispose old data handler, reattach to new PTY, suppress the old PTY's `onExit` close behavior

**Option B: Prevent the need for retry entirely**
- Before spawning with `--continue`, check if Claude CLI has a previous session to continue (e.g., check `~/.claude/` for session state)
- Only add `--continue` if a continuable session exists
- Downside: relies on Claude CLI internals that may change

**Option C: Generate a unique tmux session name for retry**
- For Bug 2 specifically: append a retry suffix to `tmuxSessionName` on retry
