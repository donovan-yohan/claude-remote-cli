# Architecture

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed architecture guidance.

## Overview

Remote web interface for Claude Code CLI sessions. Node.js backend manages PTY processes and relays I/O over WebSockets to a vanilla JS + xterm.js frontend.

## Server Modules

| Module | Role |
|--------|------|
| `server/index.js` | Express app, REST API routes, auth middleware, config loading |
| `server/sessions.js` | PTY spawning via `node-pty`, session lifecycle, scrollback buffering (256KB max) |
| `server/ws.js` | WebSocket upgrade handler, bidirectional PTY relay, scrollback replay on connect |
| `server/watcher.js` | File system watching for `.claude/worktrees/` directories, debounced event emission |
| `server/auth.js` | PIN hashing (bcrypt), rate limiting (5 fails = 15-min lockout), cookie token generation |
| `server/config.js` | Config loading/saving with defaults |

## Frontend

Single-page app in `public/`. No build step, no framework.

| File | Role |
|------|------|
| `public/app.js` | All frontend logic: session management, WebSocket, terminal, filtering, sidebar |
| `public/index.html` | HTML structure with PIN gate, sidebar, terminal container, dialogs |
| `public/style.css` | Dark theme, responsive mobile-first layout |
| `public/vendor/` | Bundled xterm.js and addon-fit.js |

## Data Flow

```
Browser (xterm.js) <--WebSocket /ws/:id--> server/ws.js <--PTY I/O--> node-pty <--spawns--> claude CLI
                                                |
                                           scrollback buffer (in-memory, per session)

Browser (app.js)   <--WebSocket /ws/events-- server/ws.js <-- watcher.js (fs.watch on .claude/worktrees/)
                                                           <-- POST/DELETE /roots (manual broadcast)
```

1. User types in xterm.js terminal
2. Keystrokes sent via WebSocket to server
3. Server writes to PTY stdin
4. PTY stdout/stderr relayed back over WebSocket
5. xterm.js renders output in browser
6. Resize events sent as JSON: `{type: 'resize', cols, rows}`

## REST API Routes

- `POST /auth` - Authenticate with PIN, returns session cookie
- `GET /sessions` - List active sessions
- `POST /sessions` - Create new session or resume worktree
- `PATCH /sessions/:id` - Rename session (syncs `/rename` to PTY)
- `DELETE /sessions/:id` - Terminate session
- `GET /repos` - Scan root directories for git repos
- `GET /worktrees` - List available inactive Claude Code worktrees
- `GET /roots` / `POST /roots` / `DELETE /roots` - Manage root directories (POST/DELETE also rebuild watcher + broadcast)

## WebSocket Channels

- `/ws/:sessionId` - PTY relay (bidirectional: terminal I/O + resize)
- `/ws/events` - Server-to-client broadcast (JSON `{type: "worktrees-changed"}`)

## Session Object Structure

```javascript
{
  id,            // random hex
  root,          // configured root directory
  repoName,      // repository name
  repoPath,      // working directory
  worktreeName,  // Claude Code worktree name
  displayName,   // user-friendly name
  pty,           // node-pty process
  createdAt,     // ISO timestamp
  lastActivity,  // ISO timestamp
  scrollback,    // array of data chunks, max 256KB
}
```

## CLI Entry Point

`bin/claude-remote-cli.js` - Parses flags (`--port`, `--host`, `--config`), manages config directory at `~/.config/claude-remote-cli/`, prompts for PIN on first run.

---

## Architecture Rules (derived from ADRs)

> Regenerate with `/adr:update`. See [docs/adrs/](../adrs/) for full decision records.

### Server module structure

- [ADR-001] The server MUST be organized into six modules under `server/`: `index.js`, `sessions.js`, `ws.js`, `watcher.js`, `auth.js`, `config.js`.
- [ADR-001] Modules MUST communicate through direct `require()` imports with no DI container, service layer, or abstract interfaces.
- [ADR-001] `index.js` MUST serve as the composition root, wiring all other modules at startup.
- [ADR-001] Modules SHOULD NOT import `index.js`; cross-module dependencies flow downward only.

### Frontend architecture

- [ADR-002] The frontend MUST be a single-page application using plain HTML, CSS, and JavaScript in `public/`.
- [ADR-002] There MUST NOT be a build step, transpiler, or bundler.
- [ADR-002] All application logic MUST reside in `public/app.js` as a single IIFE.
- [ADR-002] Styles MUST be in `public/style.css`; the HTML entry point MUST be `public/index.html`.
- [ADR-002] Vendor dependencies MUST be self-hosted as pre-built files in `public/vendor/` and loaded via `<script>` tags.
- [ADR-002] The frontend MUST use ES5-compatible syntax (`var`, `.then()`, no arrow functions, no template literals).
- [ADR-002] DOM manipulation MUST use `document.getElementById`, `document.createElement`, and event listeners directly.

### PTY session management

- [ADR-003] Sessions MUST be managed using `node-pty` to spawn pseudo-terminal processes.
- [ADR-003] Active sessions MUST be stored in an in-memory `Map` keyed by session ID.
- [ADR-003] Session IDs MUST be generated using `crypto.randomBytes(8).toString('hex')`.
- [ADR-003] There MUST NOT be a database or persistent storage for session state.
- [ADR-003] When a PTY process exits, its session MUST be automatically removed from the registry.
- [ADR-003] Each session MUST maintain a scrollback buffer capped at 256KB with FIFO eviction.
- [ADR-003] On WebSocket connection, the full scrollback buffer MUST be replayed to the client.
- [ADR-003] The `CLAUDECODE` environment variable MUST be stripped from the PTY's environment.
- [ADR-003] The PTY MUST be configured with `xterm-256color` as the terminal name.
- [ADR-003] The sessions module MUST export: `create`, `get`, `list`, `kill`, `resize`, `updateDisplayName`.

### Authentication

- [ADR-004] On first run, the server MUST prompt the user to set a PIN via the terminal.
- [ADR-004] The PIN MUST be hashed using bcrypt with 10 salt rounds before storage.
- [ADR-004] The bcrypt hash MUST be stored in the config file under the `pinHash` key.
- [ADR-004] PIN verification MUST use `bcrypt.compare` against the stored hash.
- [ADR-004] On successful verification, the server MUST generate a token using `crypto.randomBytes(32).toString('hex')`.
- [ADR-004] The token MUST be set as an `httpOnly`, `sameSite: strict` cookie with configurable TTL (default: 24h).
- [ADR-004] Authenticated tokens MUST be stored in an in-memory `Set` with `setTimeout`-based expiry.
- [ADR-004] Failed PIN attempts MUST be tracked per IP; after 5 failures, the IP MUST be locked out for 15 minutes.
- [ADR-004] A successful authentication MUST clear the rate limit counter for that IP.
- [ADR-004] WebSocket upgrade requests MUST be authenticated by checking the `token` cookie.
- [ADR-004] Unauthenticated WebSocket connections MUST be rejected with a 401 before the upgrade completes.

### Testing

- [ADR-005] All unit tests MUST use `node:test` and `node:assert`; no external test framework SHOULD be installed.
- [ADR-005] Test files MUST be in `test/` with the naming convention `*.test.js`.
- [ADR-005] Tests MUST be runnable via `npm test` (`node --test test/*.test.js`).
- [ADR-005] Individual test files MUST be runnable in isolation via `node --test test/<file>.test.js`.
- [ADR-005] `auth.test.js` MUST clear the `require` cache before each test for fresh module state.
- [ADR-005] `sessions.test.js` MUST clean up spawned PTY processes in `afterEach` hooks.
- [ADR-005] `config.test.js` MUST use temporary directories and clean up files between tests.
- [ADR-005] E2E tests SHOULD be kept separate from unit tests.

### Distribution and configuration

- [ADR-006] The package MUST declare a `bin` entry pointing to `bin/claude-remote-cli.js`.
- [ADR-006] The CLI MUST parse `--port`, `--host`, `--config`, `--version`, `--help` flags before delegating to `server/index.js`.
- [ADR-006] CLI flags MUST be passed to the server via environment variables (`CLAUDE_REMOTE_CONFIG`, `CLAUDE_REMOTE_PORT`, `CLAUDE_REMOTE_HOST`).
- [ADR-006] Configuration precedence MUST be: CLI flags > environment variables > config file > built-in defaults.
- [ADR-006] Global install config MUST be at `~/.config/claude-remote-cli/config.json`; local dev config MUST be at `./config.json`.
- [ADR-006] The config directory MUST be created automatically if it does not exist.
- [ADR-006] The `CLAUDE_REMOTE_CONFIG` environment variable MAY override both default config paths.
- [ADR-006] The `files` field in `package.json` MUST limit published content to `bin/`, `server/`, `public/`, and `config.example.json`.

### WebSocket channels

- [ADR-007] The server MUST expose two separate WebSocket channels via a single `WebSocketServer` in `noServer` mode.
- [ADR-007] PTY channel (`/ws/:sessionId`) MUST be scoped to one session; the URL pattern MUST match `/ws/[a-f0-9]+`.
- [ADR-007] PTY server-to-client data MUST be sent as raw text frames with no JSON wrapping.
- [ADR-007] PTY client-to-server text frames MUST be forwarded to stdin, except JSON `type: "resize"` messages which MUST trigger a PTY resize.
- [ADR-007] On PTY channel connection, the server MUST replay the scrollback buffer before attaching the live handler.
- [ADR-007] When a PTY process exits, the server MUST close the WebSocket with code 1000.
- [ADR-007] Event channel MUST be at the fixed path `/ws/events`; it is server-to-client only.
- [ADR-007] Event messages MUST be JSON objects with a `type` field.
- [ADR-007] `WorktreeWatcher` MUST monitor `.claude/worktrees/` directories using `fs.watch` with 500ms debounce.
- [ADR-007] The frontend MUST auto-reconnect the event socket with a 3-second delay on close.
- [ADR-007] Both WebSocket channels MUST require authentication via the `token` cookie during HTTP upgrade.
- [ADR-007] Unauthenticated upgrade requests MUST receive a 401 response and the socket MUST be destroyed.
