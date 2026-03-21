# Bug Analysis: Mobile sessions stuck on "Reconnecting" after sleep/resume

> **Status**: Confirmed | **Date**: 2026-03-21
> **Severity**: High
> **Affected Area**: `frontend/src/lib/ws.ts` — WebSocket reconnection logic

## Symptoms
- On mobile, letting the app go to sleep and then resuming shows "Reconnecting..." indefinitely
- Sessions never recover until the app is force-closed and reopened
- Both the PTY socket and event socket become unresponsive

## Reproduction Steps
1. Open a session on mobile (iOS Safari or Android Chrome)
2. Switch to another app or lock the phone for 30+ seconds
3. Return to the app
4. Observe: terminal shows "[Reconnecting...]" or appears frozen
5. Wait — it never recovers. Must force-close and reopen.

## Root Cause

Two missing mechanisms in `ws.ts`:

### 1. No `visibilitychange` listener — zombie WebSocket detection relies on `onclose`

When mobile browsers go to sleep, the OS kills TCP connections silently. The browser does NOT immediately fire `onclose` on the dead WebSocket — this can take 30-60+ seconds (or never, on some mobile browsers). During this window:

- `ptyWs` still holds a reference to the dead socket
- `ptyWs.readyState` may report `OPEN` even though the connection is dead
- `sendPtyData()` silently fails — data goes nowhere
- The reconnection logic in `scheduleReconnect()` is never triggered because `onclose` hasn't fired

The app has `visibilitychange` listeners in `analytics.ts` (line 109) and `notifications.ts` (line 33), but **neither triggers WebSocket health checks or reconnection**.

### 2. No heartbeat/ping-pong mechanism

There is no client-side ping or server-side WebSocket keepalive to detect dead connections proactively. The WebSocket library (`ws`) supports pings at the protocol level, but neither the server (`server/ws.ts`) nor the client (`frontend/src/lib/ws.ts`) implements them.

Without heartbeats, a zombie WebSocket can persist indefinitely until the browser eventually detects the TCP timeout (which mobile browsers often deprioritize for background pages).

### 3. Event socket has the same problem

The event socket reconnection (`ws.ts:25-27`) also relies solely on `onclose`:
```javascript
eventWs.onclose = () => {
  setTimeout(() => connectEventSocket(onMessage), 3000);
};
```
After mobile sleep, the event socket is equally dead, meaning no `session-state-changed` or `session-idle-changed` events are received. The sidebar/UI goes stale.

### Why force-close and reopen works

When the user kills the app entirely, the browser destroys all WebSocket objects. On reopen, fresh connections are created from scratch — no zombie sockets to deal with.

## Evidence
- `ws.ts:66-80`: `onclose` handler is the ONLY trigger for PTY reconnection
- `ws.ts:25-27`: `onclose` handler is the ONLY trigger for event socket reconnection
- No `visibilitychange` or `pageshow` listener anywhere in `ws.ts` or `App.svelte` for reconnection
- No ping/pong or heartbeat in `server/ws.ts` or client `ws.ts`
- `analytics.ts:109` and `notifications.ts:33` use `visibilitychange`/`document.hidden` but not for WebSocket health

## Impact Assessment
- **All mobile users** affected when backgrounding/resuming the app
- Makes the app feel broken/unreliable on mobile — the primary use case
- Users must force-close and reopen to recover, losing their terminal scroll position
- Event socket death means sidebar state also goes stale silently

## Recommended Fix Direction

### Fix 1: Add `visibilitychange` reconnection trigger (primary fix)

In `ws.ts`, add a page visibility listener that proactively checks and reconnects both sockets when the page becomes visible:

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Check PTY socket health
    if (ptyWs && ptyWs.readyState !== WebSocket.OPEN) {
      // Socket is dead — trigger reconnection
      ptyWs.close();  // force onclose to fire
    }
    // Check event socket health
    if (eventWs && eventWs.readyState !== WebSocket.OPEN) {
      eventWs.close();
    }
  }
});
```

The problem: `readyState` may still report `OPEN` on a zombie socket. So a simple readyState check is insufficient. Better approach: **send a probe and set a response timeout**.

### Fix 2: Client-side heartbeat with timeout

Add a periodic ping from the client. If no pong (or any data) is received within a timeout, force-close and reconnect:

```typescript
// After socket.onopen:
const pingInterval = setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'ping' }));
    // If no response in 5s, assume dead
    const timeout = setTimeout(() => {
      socket.close();
    }, 5000);
    // Clear timeout when any message received
    // (requires wiring into onmessage)
  }
}, 15000);
```

### Fix 3: Combined approach (recommended)

1. On `visibilitychange` → `visible`: immediately send a ping on both sockets, set a 3-second timeout. If no response, force-close and reconnect.
2. Add a periodic heartbeat (every 30s) as a safety net for gradual connection degradation.
3. Server-side: handle `{ type: 'ping' }` messages with a `{ type: 'pong' }` response (the PTY `ws.on('message')` handler in `server/ws.ts` already has JSON parsing — just add a ping/pong case).
