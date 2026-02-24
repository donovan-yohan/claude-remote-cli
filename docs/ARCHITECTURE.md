# Architecture

This document describes the high-level architecture of claude-remote-cli.
If you want to familiarize yourself with the codebase, you are in the right place.

## Bird's Eye View

claude-remote-cli is a remote web interface for interacting with Claude Code CLI sessions from any device. A user opens the web UI in a browser, authenticates with a PIN, and gets a terminal connected to a Claude Code CLI process running on the host machine. The server manages PTY processes, relays I/O over WebSocket, and watches for git worktree changes.

Input: browser keystrokes, session management commands, clipboard images.
Output: terminal rendering via xterm.js, real-time session state updates.

The system has two compilation targets: a TypeScript + ESM backend (Express + node-pty + WebSocket) compiled to `dist/`, and a Svelte 5 frontend (runes + Vite) compiled to `dist/frontend/`.

## Code Map

### `server/`

Nine TypeScript modules compiled to `dist/server/` via `tsc`. Modules communicate via ESM `import` statements.

| Module | Role |
|--------|------|
| `index.ts` | Composition root: Express app, REST routes, auth middleware, static serving |
| `sessions.ts` | PTY spawning via node-pty, session lifecycle, scrollback buffering (256KB max) |
| `ws.ts` | WebSocket upgrade handler, bidirectional PTY relay, scrollback replay |
| `watcher.ts` | File system watching for `.worktrees/` directories, debounced event emission |
| `auth.ts` | PIN hashing (bcrypt), rate limiting (5 fails = 15-min lockout), cookie tokens |
| `config.ts` | Config loading/saving with defaults, worktree metadata persistence |
| `clipboard.ts` | System clipboard detection and image-set operations (osascript/xclip) |
| `service.ts` | Background service install/uninstall/status (launchd on macOS, systemd on Linux) |
| `types.ts` | Shared TypeScript interfaces |

**Architecture Invariant:** `index.ts` is the composition root and MUST NOT be imported by other modules. Cross-module dependencies flow downward: `index.ts` imports all others; `ws.ts` may import `sessions`; all other modules are self-contained. Each module owns a single concern and confines its npm dependencies (e.g., only `auth.ts` depends on bcrypt, only `sessions.ts` depends on node-pty).

### `frontend/`

Svelte 5 SPA built by Vite, output to `dist/frontend/`. Express serves the compiled output.

| Path | Role |
|------|------|
| `frontend/src/components/` | Svelte 5 components (Terminal, Sidebar, SessionList, dialogs, etc.) |
| `frontend/src/lib/state/` | Reactive state modules (`.svelte.ts` files) exporting state + mutations |
| `frontend/src/lib/api.ts` | REST API client functions |
| `frontend/src/lib/ws.ts` | WebSocket connection management (PTY relay + event channel) |
| `frontend/src/lib/types.ts` | Frontend TypeScript interfaces |

**Architecture Invariant:** The frontend does NOT vendor any libraries. xterm.js and xterm-addon-fit are npm dependencies. State lives in `.svelte.ts` modules, not in component files.

### `bin/`

`bin/claude-remote-cli.ts` — CLI entry point. Parses flags (`--port`, `--host`, `--config`, `--version`, `--help`, `--bg`, `install`, `uninstall`, `status`, `update`), manages config directory, prompts for PIN on first run.

**Architecture Invariant:** CLI flags are passed to the server via environment variables (`CLAUDE_REMOTE_CONFIG`, `CLAUDE_REMOTE_PORT`, `CLAUDE_REMOTE_HOST`), not direct function calls.

### `test/`

Unit tests using `node:test` and `node:assert`. TypeScript source compiled via `tsc -p tsconfig.test.json`.

**Architecture Invariant:** No external test framework. Tests MUST NOT require a running server instance.

## Data Flow

```
Browser (xterm.js) <--WebSocket /ws/:id--> ws.ts <--PTY I/O--> node-pty <--spawns--> claude CLI
                                              |
                                         scrollback buffer (in-memory, per session)

Browser (Svelte)   <--WebSocket /ws/events-- ws.ts <-- watcher.ts (fs.watch on .worktrees/)
                                                    <-- POST/DELETE /roots (manual broadcast)
```

1. User types in xterm.js terminal
2. Keystrokes sent via WebSocket to server
3. Server writes to PTY stdin
4. PTY stdout/stderr relayed back over WebSocket
5. xterm.js renders output in browser
6. Resize events sent as JSON: `{type: 'resize', cols, rows}`

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth` | Authenticate with PIN, returns session cookie |
| `GET` | `/sessions` | List active sessions |
| `POST` | `/sessions` | Create worktree session (accepts `branchName`, `claudeArgs`) |
| `POST` | `/sessions/repo` | Create repo session (no worktree, supports `continue`) |
| `GET` | `/branches` | List local and remote branches |
| `GET` | `/git-status` | PR state and diff stats for a branch |
| `PATCH` | `/sessions/:id` | Rename session |
| `DELETE` | `/sessions/:id` | Terminate session |
| `GET` | `/repos` | Scan root directories for git repos |
| `GET` | `/worktrees` | List inactive Claude Code worktrees |
| `DELETE` | `/worktrees` | Remove worktree, prune refs, delete branch |
| `GET/POST/DELETE` | `/roots` | Manage configured root directories |
| `GET` | `/version` | Check for npm updates |
| `POST` | `/sessions/:id/image` | Upload clipboard image |
| `POST` | `/update` | Self-update via npm |

## WebSocket Channels

- `/ws/:sessionId` — PTY relay (bidirectional: terminal I/O + resize). Close code 1000 = PTY exited.
- `/ws/events` — Server-to-client broadcast (`worktrees-changed`, `session-idle-changed`).

Both channels require authentication via `token` cookie verified during HTTP upgrade.

## Cross-Cutting Concerns

**Build:** TypeScript compiles via `tsc` to `dist/`. Frontend builds via Vite to `dist/frontend/`. ESM throughout (`"type": "module"`), all relative imports use `.js` extensions, Node builtins use `node:` prefix.

**Auth:** Every HTTP request (except `/auth` POST) and every WebSocket upgrade requires a valid session cookie. Rate limiting is per-IP.

**Session lifecycle:** Sessions are in-memory only. PTY exit triggers automatic cleanup. Scrollback buffers cap at 256KB with FIFO eviction.

---

## Architecture Rules (derived from ADRs)

> Regenerate with `/adr:update`. These rules are the normative constraints from accepted ADRs.

### Server module structure

- [ADR-001] The server MUST be organized into nine TypeScript modules under `server/`: `index.ts`, `sessions.ts`, `ws.ts`, `watcher.ts`, `auth.ts`, `config.ts`, `service.ts`, `clipboard.ts`, and `types.ts`.
- [ADR-001] Modules MUST communicate through ESM `import` statements; no dependency injection container or abstract interfaces.
- [ADR-001] `index.ts` MUST serve as the composition root and SHOULD NOT be imported by other modules.
- [ADR-001] Cross-module dependencies MUST flow downward: `index.ts` imports all others; `ws.ts` MAY import `sessions`; all other modules SHOULD be self-contained.
- [ADR-001] Each module MUST own a single concern; npm-level dependencies MUST be confined to the module responsible for that concern.

### TypeScript and ESM

- [ADR-008] The project MUST use ESM (`"type": "module"` in `package.json`); all `require()` / `module.exports` MUST be replaced with `import` / `export`.
- [ADR-008] All relative imports MUST use `.js` extensions (NodeNext module resolution convention).
- [ADR-008] Node.js built-in modules MUST use the `node:` prefix.
- [ADR-008] `__dirname` / `__filename` MUST be replaced with `fileURLToPath(import.meta.url)` + `path.dirname()`.
- [ADR-008] TypeScript MUST compile via `tsc` to `dist/`; target `ES2024`, module `NodeNext`, strict mode enabled.
- [ADR-008] Full strict mode MUST be enabled: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- [ADR-008] Shared interfaces MUST live in `server/types.ts`; module-local types SHOULD stay in their own file.
- [ADR-008] Minimum Node.js version MUST be `>=24.0.0`.

### Frontend

> ADR-002 (vanilla JS constraint) was superseded by the Svelte 5 migration.

- The frontend MUST be a single-page application built with Svelte 5 (runes syntax) and TypeScript in `frontend/`.
- Vite MUST be used as the build tool; compiled output goes to `dist/frontend/`.
- Express MUST serve `dist/frontend/` via `express.static`; the static path resolves one level up from `dist/server/`.
- xterm.js and xterm-addon-fit MUST be consumed as npm dependencies (no manual vendoring).

### PTY session management

- [ADR-003] Sessions MUST be managed using `node-pty`; each session represents one CLI process running in a PTY.
- [ADR-003] Active sessions MUST be stored in an in-memory `Map` keyed by session ID; no database or persistent storage.
- [ADR-003] Session IDs MUST be generated with `crypto.randomBytes(8).toString('hex')`.
- [ADR-003] When a PTY process exits, its session MUST be automatically removed.
- [ADR-003] Each session MUST maintain a scrollback buffer capped at 256KB; oldest chunks trimmed first (FIFO).
- [ADR-003] On WebSocket connection, the full scrollback MUST be replayed before attaching live data.
- [ADR-003] The `CLAUDECODE` environment variable MUST be stripped from the PTY environment.
- [ADR-003] The sessions module MUST export: `create`, `get`, `list`, `kill`, `resize`, `updateDisplayName`, `write`, `onIdleChange`, `findRepoSession`.

### Authentication

- [ADR-004] PIN MUST be hashed with bcrypt (10 salt rounds) and stored in config.
- [ADR-004] Session tokens MUST be `crypto.randomBytes(32).toString('hex')`, set as `httpOnly`, `sameSite: strict` cookies.
- [ADR-004] Tokens stored in in-memory `Set` with `setTimeout` expiry based on `cookieTTL` (default 24h).
- [ADR-004] 5 failed PIN attempts per IP = 15-minute lockout.
- [ADR-004] WebSocket upgrades MUST be authenticated; unauthenticated connections rejected with 401.

### Testing

- [ADR-005] All unit tests MUST use `node:test` and `node:assert`; no external test framework.
- [ADR-005] Test files MUST be TypeScript in `test/` with `*.test.ts` naming.
- [ADR-005] Eight test files MUST exist: `auth`, `clipboard`, `config`, `sessions`, `service`, `paths`, `version`, `worktrees`.
- [ADR-005] E2E tests (Playwright) SHOULD be separate from unit tests.

### Distribution and CLI

- [ADR-006] The `bin` entry MUST point to `dist/bin/claude-remote-cli.js`.
- [ADR-006] CLI flags passed via environment variables to the server.
- [ADR-006] Config precedence: CLI flags > env vars > config file > defaults.
- [ADR-006] Config at `~/.config/claude-remote-cli/config.json` (global) or `./config.json` (dev).
- [ADR-006] Published package limited to `dist/` and `config.example.json`.

### WebSocket channels

- [ADR-007] Two WebSocket channels via single `WebSocketServer` in `noServer` mode.
- [ADR-007] PTY channel at `/ws/[a-f0-9]+`; raw text frames, no JSON wrapping (except resize).
- [ADR-007] Event channel at `/ws/events`; server-to-client only, JSON with `type` field.
- [ADR-007] `.worktrees/` changes debounced 500ms before broadcast.
- [ADR-007] PTY reconnects with exponential backoff (1s–10s, max 30 attempts); code 1000 = no reconnect.
- [ADR-007] Both channels require cookie auth on upgrade.
