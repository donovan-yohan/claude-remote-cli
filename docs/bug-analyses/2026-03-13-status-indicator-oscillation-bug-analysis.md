# Bug Analysis: Status Indicator Oscillation

> **Status**: Confirmed | **Date**: 2026-03-13
> **Severity**: High
> **Affected Area**: frontend/state/sessions, server/sessions idle timer

## Symptoms
- Session shows "waiting for input" (flashing orange attention dot)
- User clicks on it, attention clears and it shows "idle" (blue dot)
- Without any user input, session transitions back to "active/running" (green dot)
- Then cycles back to "attention" (flashing orange) within seconds
- This oscillation repeats indefinitely
- Critical blocker for planned notification system (would fire spurious push/desktop notifications)

## Reproduction Steps
1. Open a Claude session (worktree type)
2. Let it run — Claude produces intermittent output (thinking, status updates)
3. Switch to a different session
4. Observe: the first session flashes orange (attention)
5. Click back to it — attention clears, shows idle/blue
6. Switch away again
7. Within 5-10 seconds, it flashes orange again despite no user input

## Root Cause

Two interacting problems in the idle detection and attention tracking system:

### Problem 1: No "dismissed" tracking in attention state

`clearAttention()` (`sessions.svelte.ts:76-78`) simply deletes the flag:
```typescript
export function clearAttention(sessionId: string): void {
  delete attentionSessions[sessionId];
}
```

But `setAttention()` (`sessions.svelte.ts:63-74`) unconditionally re-sets the flag on every `idle: true` event when the session is not active:
```typescript
if (idle && sessionId !== activeSessionId && session?.type !== 'terminal') {
  attentionSessions[sessionId] = true;  // re-triggers even if user just dismissed it
}
```

There is no mechanism to track that the user has already acknowledged/dismissed this attention state. Every idle transition is treated as a fresh "needs attention" event.

### Problem 2: PTY background noise causes rapid idle cycling

The backend idle timer (`sessions.ts:73, 148-159`) uses a 5-second timeout:
```typescript
const IDLE_TIMEOUT_MS = 5000;

function resetIdleTimer(): void {
  if (session.idle) {
    session.idle = false;
    if (idleChangeCallback) idleChangeCallback(session.id, false);  // broadcasts idle:false
  }
  // ...
  idleTimer = setTimeout(() => {
    session.idle = true;
    if (idleChangeCallback) idleChangeCallback(session.id, true);  // broadcasts idle:true
  }, IDLE_TIMEOUT_MS);
}
```

This fires on ANY PTY output (`proc.onData` at `sessions.ts:167-169`), including:
- Claude Code thinking/status indicators
- Terminal escape sequences (cursor positioning, color changes)
- tmux status line refreshes
- Background process output

Claude sessions regularly produce intermittent output without user input, causing the cycle:
1. PTY output → `idle: false` broadcast
2. 5s silence → `idle: true` broadcast → attention flag set (if not active session)
3. More PTY output → back to step 1

### Combined effect

The 5-second idle timer + unconditional attention re-triggering creates a feedback loop where sessions oscillate between "running" and "attention" states every few seconds, even without user interaction.

## Evidence
- `server/sessions.ts:148-159`: `resetIdleTimer()` fires on every `onData` event
- `server/sessions.ts:167-169`: `onData` handler calls `resetIdleTimer()` for ALL output
- `server/ws.ts:135-137`: Every idle change is broadcast to all clients
- `frontend/src/App.svelte:153-154`: Every broadcast calls `setAttention()`
- `frontend/src/lib/state/sessions.svelte.ts:69-73`: No guard against re-triggering after user dismissal
- `frontend/src/lib/state/sessions.svelte.ts:76-78`: `clearAttention` is stateless — no memory of dismissal

## Impact Assessment
- **User experience**: Constant flashing orange dots are distracting and misleading — users can't tell which sessions genuinely need attention
- **Notification system blocker**: Building push notifications (mobile) or desktop alerts on this state would cause continuous spurious alerts
- **Trust erosion**: Users stop trusting the status indicators, defeating their purpose
- **All non-terminal sessions affected**: The `type !== 'terminal'` guard in `setAttention` prevents this for terminal-type sessions, but all Claude/worktree sessions are susceptible

## Recommended Fix Direction

### Fix 1: Track dismissed state (primary fix)
Add a "last acknowledged" timestamp or "dismissed until next active cycle" flag. When user clicks a session:
- Record that attention was dismissed
- Only re-trigger attention after the session has gone through a full NEW cycle: `idle → active (user-initiated or meaningful output) → idle` that starts AFTER the dismissal

### Fix 2: Distinguish meaningful output from noise (complementary)
Not all PTY output means the session needs attention. Consider:
- Ignoring output that consists only of escape sequences / control characters
- Requiring a minimum output threshold before resetting idle timer
- Using a separate "needs input" signal from Claude Code itself (e.g., detecting the input prompt pattern)

### Fix 3: Hysteresis / debounce on attention transitions
- Don't set attention immediately on first idle transition
- Require the session to be idle for longer (e.g., 15-30s) before triggering attention
- Or: require multiple consecutive idle periods before attention triggers

For the notification system, Fix 1 is essential. Fix 2 would provide the most accurate status signals long-term.
