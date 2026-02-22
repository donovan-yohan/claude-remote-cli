# ADR-003: PTY-Based Session Management with In-Memory State

## Status
Accepted

## Date
2026-02-21

## Decider(s)
Donovan Yohan

## Context
The core purpose of claude-remote-cli is to let users interact with Claude Code CLI from a browser. This requires spawning a real terminal process that Claude Code can run inside, capturing its output (including ANSI escape sequences, color codes, and cursor movement), and relaying input from the browser. A simple `child_process.spawn` with piped stdio would not preserve terminal semantics. The application also needs to track active sessions so users can reconnect to them after navigating away or refreshing the page.

## Decision
Sessions MUST be managed using `node-pty` to spawn pseudo-terminal processes. Each session represents one Claude Code CLI process running in a PTY.

### Session Registry
- Active sessions MUST be stored in an in-memory `Map` keyed by session ID
- Session IDs MUST be generated using `crypto.randomBytes(8).toString('hex')` (16-character hex strings)
- There MUST NOT be a database or persistent storage for session state; sessions exist only while their PTY process is alive
- When a PTY process exits, its session MUST be automatically removed from the registry

### Scrollback Buffer
- Each session MUST maintain a scrollback buffer that stores all PTY output chunks
- The scrollback buffer MUST be capped at 256KB per session
- When the buffer exceeds 256KB, the oldest chunks MUST be trimmed first (FIFO eviction)
- On WebSocket connection, the full scrollback buffer MUST be replayed to the client so users see previous output

### PTY Environment
- The `CLAUDECODE` environment variable MUST be stripped from the PTY's environment to prevent conflicts when spawning Claude Code inside a Claude-managed server process
- The PTY MUST be configured with `xterm-256color` as the terminal name

### Session Lifecycle API
The sessions module MUST export: `create`, `get`, `list`, `kill`, `resize`, `updateDisplayName`.

## Consequences

### Positive
- Full terminal fidelity: ANSI colors, cursor positioning, interactive prompts, and TUI interfaces all work correctly
- Scrollback replay enables seamless reconnection -- users see the full session history when they return
- No database dependency keeps the deployment simple (single `npm install` and `npm start`)
- In-memory state is fast with zero serialization overhead

### Negative
- All session state is lost on server restart; there is no way to resume a session after the server process exits
- Memory usage grows linearly with active sessions (up to 256KB scrollback per session plus PTY process overhead)
- No session persistence means sessions cannot be shared across multiple server instances

### Risks
- If many concurrent sessions are created (e.g., 50+), memory consumption from scrollback buffers alone could reach ~12.5MB, plus the memory used by each Claude Code process itself
- The 256KB scrollback cap means very long sessions will lose early output; users cannot scroll back to the beginning of extended conversations
