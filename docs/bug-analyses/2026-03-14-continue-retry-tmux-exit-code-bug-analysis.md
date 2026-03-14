# Bug Analysis: --continue Retry Fails Because Tmux Masks Exit Code

> **Status**: Confirmed | **Date**: 2026-03-14
> **Severity**: High
> **Affected Area**: server/sessions.ts (retry logic in `attachHandlers`)

## Symptoms
- When `--continue` flag is passed (via `defaultContinue` config) and Claude CLI has no previous session to continue, the user sees "Reconnecting" followed by "Session ended" instead of a graceful fallback to a new session.
- The prior fix (2026-03-11, `onPtyReplacedCallbacks`) addressed the WebSocket reattachment problem but the retry itself never fires in this scenario.

## Reproduction Steps
1. Enable `defaultContinue` in settings (or have it enabled by default)
2. Enable `launchInTmux` in settings
3. Start a repo session in a directory where Claude CLI has no previous conversation
4. Observe: "Reconnecting..." then "Session ended" — no retry notice appears

## Root Cause

The retry condition at `sessions.ts:186` requires **three** conditions:

```typescript
if (canRetry && (Date.now() - spawnTime) < 3000 && exitCode !== 0) {
```

When `useTmux` is true, the PTY process is `tmux new-session -s <name> -- claude --continue`. The execution flow:

1. Claude CLI (inside tmux) finds no previous session → exits with non-zero code
2. The tmux session ends (all windows closed)
3. The tmux **client** process (which is the PTY) exits with **code 0**

Tmux client always exits with code 0 when a session ends normally from tmux's perspective — it does not propagate the inner command's exit code. This causes `exitCode !== 0` to evaluate as **false**, so the retry path is never entered.

The session is then deleted via the normal exit path (`sessions.ts:229`), and the frontend — which has just received the session ID from the 201 response — tries to connect a WebSocket to a session that no longer exists.

### Secondary scenario (non-tmux)

Even without tmux, if `claude --continue` exits with code 0 when there's no previous session (rather than non-zero), the same failure occurs. The retry mechanism is fragile because it relies on exact exit codes.

## Evidence
- `sessions.ts:186`: Retry condition requires `exitCode !== 0`
- `sessions.ts:96-100`: When `useTmux` is true, PTY spawns `tmux new-session -s ... -- claude --continue`
- Verified: `tmux new-session -- /bin/false` returns exit code 0 from the client
- Verified with node-pty: wrapping a failing command (`/bin/sh -c '/bin/false; exit 0'`) reports PTY exit code 0
- `ws.ts:69-73` (server): If session is deleted, WebSocket upgrade gets 404 → socket destroyed
- `ws.ts:52-61` (frontend): Non-1000 close → "Reconnecting"; reconnect finds session gone → "Session ended"
- The 2026-03-11 fix (`onPtyReplacedCallbacks`) correctly handles PTY replacement when retry fires — but the retry itself never fires in this case

## Impact Assessment
- Affects all users with both `defaultContinue` and `launchInTmux` enabled
- May also affect non-tmux users if `claude --continue` exits with code 0
- The prior fix (onPtyReplacedCallbacks) is correct but unreachable in this scenario
- First-time repo sessions are broken when defaultContinue is on — requires user to disable continue or manually retry

## Recommended Fix Direction

**Relax the retry condition to not require non-zero exit code.** The 3-second timing window is already a strong heuristic — no user quits a session within 3 seconds of creation. Change:

```typescript
// Before:
if (canRetry && (Date.now() - spawnTime) < 3000 && exitCode !== 0) {

// After:
if (canRetry && (Date.now() - spawnTime) < 3000) {
```

This makes the retry fire whenever a session with `--continue` args exits within 3 seconds, regardless of exit code. The timing check prevents false positives from normal user-initiated exits (which always take longer than 3 seconds).
