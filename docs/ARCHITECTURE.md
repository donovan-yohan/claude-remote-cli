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
| `frontend/src/lib/actions.ts` | Shared Svelte actions (scroll-on-hover, longpress-click) |
| `frontend/src/lib/utils.ts` | Shared utilities (path display, relative time formatting, device detection) |

**Architecture Invariant:** The frontend does NOT vendor any libraries. xterm.js, xterm-addon-fit, and `@tanstack/svelte-query` are npm dependencies. State lives in `.svelte.ts` modules, not in component files (PR data is an exception — managed via svelte-query cache).

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
| `GET` | `/pull-requests` | Open PRs (authored + review-requested) for a repo via `gh` CLI |
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

## Architecture Decision Records

> Normative constraints are documented in `docs/adrs/`. Regenerate with `/adr:update`.

| ADR | Topic |
|-----|-------|
| ADR-001 | Modular server architecture (nine modules, composition root, dependency flow) |
| ADR-003 | PTY session management (in-memory state, scrollback, CLAUDECODE stripping) |
| ADR-004 | PIN authentication (bcrypt, cookie tokens, rate limiting) |
| ADR-005 | Built-in test runner (node:test, nine test files, no external framework) |
| ADR-006 | Dual distribution (npm global + local dev, CLI flags via env vars) |
| ADR-007 | WebSocket dual channels (PTY relay + event broadcast, debounced watcher) |
| ADR-008 | TypeScript + ESM (strict mode, .js extensions, node: prefix, Node >= 24) |

> ADR-002 (vanilla JS frontend) was superseded by the Svelte 5 migration.
