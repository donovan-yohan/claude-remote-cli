# Session Resilience: Auto-Reconnect & Input-Awaiting Detection

**Date**: 2026-02-22
**Status**: Approved

## Problem

When a mobile phone sleeps or a browser tab suspends, the PTY WebSocket closes. The user sees `[Connection closed]` and assumes the session is dead. In reality, the PTY continues running server-side and the scrollback buffer persists — the user just needs to reconnect.

Secondary problem: when users have multiple sessions, there's no way to tell which ones are waiting for user input vs. actively processing.

## Feature 1: PTY WebSocket Auto-Reconnect

### Scope

Client-side only (`public/app.js`). No server changes needed — the server already keeps PTY alive on disconnect and replays scrollback on new connections.

### Behavior

1. PTY WebSocket closes unexpectedly (phone sleep, network drop, tab suspend)
2. Show `[Reconnecting...]` in terminal instead of `[Connection closed]`
3. Retry with exponential backoff: 1s, 2s, 4s, 8s, capped at 10s
4. On successful reconnect:
   - Server replays full scrollback on new connection (existing behavior)
   - Terminal clears and shows current state seamlessly
   - Send resize message to sync terminal dimensions
5. On permanent failure (session gone / server 404):
   - Show `[Session ended]` and stop retrying

### Distinguishing Intentional vs. Unexpected Close

- **Code 1000 (normal close)**: PTY exited naturally → show `[Session ended]`, no retry
- **Any other close code**: Unexpected disconnect → attempt reconnect

### Edge Cases

- **User switches sessions**: `connectToSession()` already closes the old WebSocket. The reconnect logic must be cancelled when the user intentionally navigates away.
- **User kills session from another device**: Server returns 404 on WebSocket upgrade → stop retrying.
- **Server restarts**: All sessions lost (in-memory) → 404 → stop retrying.
- **Multiple rapid disconnects**: Backoff timer resets on successful connection; interrupted retries are cancelled by new attempts.

### Implementation

Modify `connectToSession()` in `public/app.js`:
- Track a `reconnectTimer` and `reconnectAttempt` counter per connection
- On `ws.onclose`: if close code !== 1000 and this session is still active, schedule reconnect
- On reconnect attempt: create new WebSocket, clear terminal, replay scrollback (automatic)
- On `ws.onopen` after reconnect: reset attempt counter, send resize
- Cancel reconnect when `connectToSession()` is called for a different session or user navigates away

## Feature 2: Input-Awaiting Detection (Notification Dot)

### Scope

Server-side activity detection (`server/sessions.ts`) + API exposure (`server/index.ts`) + client-side rendering (`public/app.js`).

### How to Detect "Awaiting Input"

Claude Code CLI is a terminal application. When it's processing, it produces PTY output (streaming text, tool calls, etc.). When it's waiting for input, the output stops. We can use **PTY output silence** as a heuristic:

- Track time since last PTY `onData` event (already tracked as `lastActivity`)
- If no output for N seconds (e.g., 5s), consider the session "idle" (likely awaiting input)
- If output is actively flowing, consider it "busy"

This is a heuristic — it won't be perfect (e.g., a long compile with no output would look idle). But for Claude Code CLI, which streams output while processing, it's a reasonable signal.

### Server Changes

Add an `idle` boolean to session state:
- `session.idle`: `true` when no PTY output for 5+ seconds, `false` when output is flowing
- Broadcast `session-idle-changed` events over the `/ws/events` channel when state transitions
- Include `idle` in `GET /sessions` response

### Client Changes — Unified Status Dot

Instead of a single notification dot, use a unified status dot system for all sessions:

| State | Color | Description |
|-------|-------|-------------|
| Running | Green (#4ade80) | PTY actively producing output |
| Idle | Blue (#60a5fa) | Active session, no output for 5s |
| Needs attention | Yellow-orange glow (#f59e0b) | Idle + user hasn't viewed session since it went idle |
| Inactive | Gray (#6b7280) | Worktree with no running session |

- Listen for `session-idle-changed` events on the event WebSocket
- Track "attention" state: a session becomes attention-worthy when it goes idle and the user is viewing a different session
- Clear the attention state when the user opens that session
- Render status dots in the sidebar for both active sessions and inactive worktrees

### API

`GET /sessions` response adds `idle: boolean` per session.

Event WebSocket broadcasts: `{ type: "session-idle-changed", sessionId: string, idle: boolean }`

## Non-Goals

- Push notifications (browser Notification API) — can add later
- Automatic session cleanup/timeout
- Heartbeat/ping-pong protocol
- Service worker for background connection maintenance

## Files to Modify

| File | Changes |
|------|---------|
| `public/app.js` | Auto-reconnect logic in `connectToSession()`, notification dot rendering |
| `public/style.css` | Notification dot styles |
| `server/sessions.ts` | Add `idle` tracking with timer-based detection |
| `server/types.ts` | Add `idle` to Session type |
| `server/index.ts` | Include `idle` in session list API response |
| `server/ws.ts` | Broadcast `session-idle-changed` events |
