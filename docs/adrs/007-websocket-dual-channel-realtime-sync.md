# ADR-007: WebSocket Dual-Channel Design for Real-Time Sync

## Status
Accepted

## Date
2026-02-21

## Decider(s)
Donovan Yohan

## Context
The application has two distinct real-time communication needs: (1) bidirectional terminal I/O between the browser and a specific PTY session, and (2) server-to-client broadcast notifications when the state of worktree directories changes. Mixing both types of traffic on a single WebSocket connection would complicate message routing, require every terminal data frame to be parsed for control messages, and couple session-specific connections to global broadcast events. A single shared connection would also mean losing global event updates whenever the user switches sessions or disconnects from a terminal.

## Decision
The server MUST expose two separate WebSocket channels, both handled by a single `WebSocketServer` instance using the `noServer` mode with manual upgrade routing.

### PTY Channel (`/ws/:sessionId`)
- Each PTY channel connection MUST be scoped to a single session identified by the hex session ID in the URL path
- The URL pattern MUST match `/ws/[a-f0-9]+`
- **Server-to-client**: Raw PTY output data MUST be sent as text frames, with no JSON wrapping or framing protocol
- **Client-to-server**: Text frames MUST be forwarded directly to the PTY's stdin, except for JSON messages with `type: "resize"` which MUST trigger a PTY resize operation
- On connection, the server MUST replay the session's full scrollback buffer before attaching the live data handler
- When the PTY process exits, the server MUST close the WebSocket with code 1000

### Event Channel (`/ws/events`)
- The event channel MUST be accessible at the fixed path `/ws/events`
- This channel is server-to-client only; client messages are ignored
- Event messages MUST be JSON objects with a `type` field
- Supported event types: `worktrees-changed` (no additional fields), `session-idle-changed` (includes `sessionId: string` and `idle: boolean`)
- All connected event channel clients MUST receive every broadcast event
- Connected clients are tracked in an in-memory `Set` and removed on close

### WorktreeWatcher Integration
- `WorktreeWatcher` (in `server/watcher.js`) MUST monitor `.claude/worktrees/` directories across all configured root directories using `fs.watch`
- File system change events MUST be debounced with a 500ms delay before emitting a `worktrees-changed` event
- The `worktrees-changed` event MUST trigger a broadcast to all event channel clients via `broadcastEvent`
- REST endpoints that modify roots (POST/DELETE `/roots`) MUST also trigger `worktrees-changed` broadcasts and rebuild the watcher

### Frontend Reconnection
- The frontend MUST auto-reconnect the event socket with a 3-second delay when the connection closes
- The PTY channel MUST auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, capped at 10s, max 30 attempts) when the connection drops unexpectedly
- A WebSocket close with code 1000 (PTY exited normally) MUST NOT trigger auto-reconnect; the frontend MUST display `[Session ended]`
- Before each reconnect attempt, the frontend MUST verify the session still exists via `GET /sessions`; if gone, display `[Session ended]` and stop retrying

### Authentication
- Both WebSocket channels MUST require authentication via the `token` cookie, verified during the HTTP upgrade before the WebSocket handshake completes
- Unauthenticated upgrade requests MUST receive a `401 Unauthorized` response and the socket MUST be destroyed

## Consequences

### Positive
- Clean separation of concerns: terminal I/O is raw and fast with no parsing overhead; event messages are structured JSON
- The event channel survives session switches; the frontend always stays informed about worktree changes regardless of which terminal session is active
- Raw PTY data on the terminal channel means zero encoding overhead for high-throughput terminal output
- Single `WebSocketServer` instance with `noServer` mode avoids port conflicts and shares the HTTP server

### Negative
- Two WebSocket connections per authenticated client increases the number of open file descriptors on the server
- The event channel is broadcast-only with no per-client filtering; all clients receive all events even if they are only interested in a subset of repositories
- No message acknowledgment or delivery guarantees on the event channel; if a client misses an event, it must wait for the next one or poll via REST

### Risks
- `fs.watch` behavior varies across operating systems (especially on Linux with inotify limits); the watcher may silently fail to detect changes on some platforms
- The 500ms debounce window means rapid successive worktree changes are collapsed into a single event, which could theoretically cause the frontend to miss intermediate states (mitigated by the frontend re-fetching the full worktree list on each event)
- If many clients connect to the event channel simultaneously, the broadcast loop iterates over all of them synchronously, which could introduce latency for large client counts
