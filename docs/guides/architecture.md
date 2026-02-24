# Architecture

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed architecture guidance.

## Overview

Remote web interface for Claude Code CLI sessions. TypeScript + ESM backend (Express + node-pty + WebSocket) compiled to `dist/`. Svelte 5 frontend (runes + Vite) compiled to `dist/frontend/`.

## Server Modules

Nine TypeScript modules under `server/`, compiled to `dist/server/` via `tsc`:

| Module | Role |
|--------|------|
| `server/index.ts` | Composition root: Express app, REST API routes, auth middleware, static file serving |
| `server/sessions.ts` | PTY spawning via `node-pty`, session lifecycle, scrollback buffering (256KB max) |
| `server/ws.ts` | WebSocket upgrade handler, bidirectional PTY relay, scrollback replay on connect |
| `server/watcher.ts` | File system watching for `.worktrees/` directories, debounced event emission |
| `server/auth.ts` | PIN hashing (bcrypt), rate limiting (5 fails = 15-min lockout), cookie token generation |
| `server/config.ts` | Config loading/saving with defaults, worktree metadata persistence |
| `server/clipboard.ts` | System clipboard detection and image-set operations (osascript on macOS, xclip on Linux) |
| `server/service.ts` | Background service install/uninstall/status (launchd on macOS, systemd on Linux) |
| `server/types.ts` | Shared TypeScript interfaces (Session, SessionType, Config, ServicePaths, WorktreeMetadata, Platform, InstallOpts) |

Modules communicate via ESM `import` statements. `index.ts` is the composition root and should not be imported by other modules.

## Frontend

Svelte 5 SPA in `frontend/`, built by Vite and output to `dist/frontend/`. Express serves the compiled output.

| File / Directory | Role |
|------------------|------|
| `frontend/src/` | Svelte 5 components and TypeScript modules using runes syntax |
| `frontend/index.html` | HTML entry point (Vite template) |
| `frontend/vite.config.ts` | Vite build configuration, output to `dist/frontend/` |
| `dist/frontend/` | Compiled SPA served by Express |

xterm.js is consumed as an npm dependency (no manual vendoring). The server serves `dist/frontend/` via `express.static(path.join(__dirname, '..', 'frontend'))` from `dist/server/`.

## Data Flow

```
Browser (xterm.js) <--WebSocket /ws/:id--> server/ws.ts <--PTY I/O--> node-pty <--spawns--> claude CLI
                                                |
                                           scrollback buffer (in-memory, per session)

Browser (app.js)   <--WebSocket /ws/events-- server/ws.ts <-- watcher.ts (fs.watch on .worktrees/)
                                                           <-- POST/DELETE /roots (manual broadcast)
```

1. User types in xterm.js terminal
2. Keystrokes sent via WebSocket to server
3. Server writes to PTY stdin
4. PTY stdout/stderr relayed back over WebSocket
5. xterm.js renders output in browser
6. Resize events sent as JSON: `{type: 'resize', cols, rows}`

## REST API Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth` | Authenticate with PIN, returns session cookie |
| `GET` | `/sessions` | List active sessions |
| `POST` | `/sessions` | Create new worktree session or resume existing worktree (accepts `branchName` for branch selection and `claudeArgs` for flags) |
| `POST` | `/sessions/repo` | Create a repo session (no worktree) — one per repo, supports `continue` for `--continue` mode |
| `GET` | `/branches` | List local and remote branches for a repo |
| `PATCH` | `/sessions/:id` | Rename session (syncs `/rename` to PTY) |
| `DELETE` | `/sessions/:id` | Terminate session |
| `GET` | `/repos` | Scan root directories for git repos |
| `GET` | `/worktrees` | List available inactive Claude Code worktrees |
| `DELETE` | `/worktrees` | Remove a worktree, prune refs, delete its branch |
| `GET` | `/roots` | List configured root directories |
| `POST` | `/roots` | Add a root directory (rebuilds watcher + broadcasts) |
| `DELETE` | `/roots` | Remove a root directory (rebuilds watcher + broadcasts) |
| `GET` | `/version` | Check for updates (compares installed vs. npm registry latest) |
| `POST` | `/sessions/:id/image` | Upload clipboard image (base64), set system clipboard, paste into PTY |
| `POST` | `/update` | Self-update via `npm install -g claude-remote-cli@latest` |

## WebSocket Channels

- `/ws/:sessionId` - PTY relay (bidirectional: terminal I/O + resize)
- `/ws/events` - Server-to-client broadcast (JSON `{type: "worktrees-changed"}` or `{type: "session-idle-changed", sessionId, idle}`)

## Session Object Structure

```typescript
{
  id: string;            // crypto.randomBytes(8).toString('hex')
  type: SessionType;     // 'repo' | 'worktree' — determines sidebar tab and cleanup behavior
  root: string;          // configured root directory
  repoName: string;      // repository name
  repoPath: string;      // working directory (repo or worktree path)
  worktreeName: string;  // Claude Code worktree name (empty for repo sessions)
  displayName: string;   // user-friendly name
  pty: IPty;             // node-pty process handle
  createdAt: string;     // ISO timestamp
  lastActivity: string;  // ISO timestamp
  scrollback: string[];  // data chunks, max 256KB total
  idle: boolean;         // true when no PTY output for 5+ seconds
}

// Persisted to ~/.config/claude-remote-cli/worktree-meta/<name>.json
interface WorktreeMetadata {
  worktreePath: string;
  displayName: string;
  lastActivity: string;
}
```

## CLI Entry Point

`bin/claude-remote-cli.ts` (compiled to `dist/bin/claude-remote-cli.js`) — Parses flags (`--port`, `--host`, `--config`, `--version`, `--help`, `--bg`, `install`, `uninstall`, `status`, `update`), manages config directory at `~/.config/claude-remote-cli/`, prompts for PIN on first run.

---

## Architecture Rules (derived from ADRs)

> Regenerate with `/adr:update`. These rules are the normative constraints from accepted ADRs.

### Server module structure

- [ADR-001] The server MUST be organized into nine TypeScript modules under `server/`: `index.ts`, `sessions.ts`, `ws.ts`, `watcher.ts`, `auth.ts`, `config.ts`, `service.ts`, `clipboard.ts`, and `types.ts`.
- [ADR-001] Modules MUST communicate through ESM `import` statements; no dependency injection container or abstract interfaces.
- [ADR-001] `index.ts` MUST serve as the composition root and SHOULD NOT be imported by other modules.
- [ADR-001] Cross-module dependencies MUST flow downward: `index.ts` imports all others; `ws.ts` MAY import `sessions`; all other modules SHOULD be self-contained.
- [ADR-001] Each module MUST own a single concern; npm-level dependencies MUST be confined to the module responsible for that concern (e.g., only `auth.ts` depends on bcrypt, only `sessions.ts` depends on node-pty).

### TypeScript and ESM

- [ADR-008] The project MUST use ESM (`"type": "module"` in `package.json`); all `require()` / `module.exports` MUST be replaced with `import` / `export`.
- [ADR-008] All relative imports MUST use `.js` extensions (NodeNext module resolution convention).
- [ADR-008] Node.js built-in modules MUST use the `node:` prefix (e.g., `import fs from 'node:fs'`).
- [ADR-008] `__dirname` / `__filename` MUST be replaced with `fileURLToPath(import.meta.url)` + `path.dirname()`.
- [ADR-008] TypeScript MUST compile via `tsc` to `dist/`; target `ES2024`, module `NodeNext`, strict mode enabled.
- [ADR-008] Full strict mode MUST be enabled: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- [ADR-008] Shared interfaces MUST live in `server/types.ts`; module-local types SHOULD stay in their own file.
- [ADR-008] Minimum Node.js version MUST be `>=24.0.0`.

### Frontend

> ADR-002 (vanilla JS constraint) was superseded by the Svelte 5 migration. The rules below reflect the current state.

- The frontend MUST be a single-page application built with Svelte 5 (runes syntax) and TypeScript in `frontend/`.
- Vite MUST be used as the build tool; compiled output goes to `dist/frontend/`.
- Express MUST serve `dist/frontend/` via `express.static`; the static path MUST resolve one level up from `dist/server/` (i.e., `path.join(__dirname, '..', 'frontend')`).
- xterm.js and xterm-addon-fit MUST be consumed as npm dependencies (no manual vendoring).

### PTY session management

- [ADR-003] Sessions MUST be managed using `node-pty` to spawn pseudo-terminal processes; each session represents one CLI process running in a PTY.
- [ADR-003] Active sessions MUST be stored in an in-memory `Map` keyed by session ID; there MUST NOT be a database or persistent storage for session state.
- [ADR-003] Session IDs MUST be generated with `crypto.randomBytes(8).toString('hex')` (16-character hex strings).
- [ADR-003] When a PTY process exits, its session MUST be automatically removed from the registry.
- [ADR-003] Each session MUST maintain a scrollback buffer capped at 256KB; oldest chunks MUST be trimmed first (FIFO eviction) when the cap is exceeded.
- [ADR-003] On WebSocket connection, the full scrollback buffer MUST be replayed to the client before attaching the live data handler.
- [ADR-003] The `CLAUDECODE` environment variable MUST be stripped from the PTY environment; the PTY MUST be configured with `xterm-256color` as the terminal name.
- [ADR-003] The sessions module MUST export: `create`, `get`, `list`, `kill`, `resize`, `updateDisplayName`, `write`, `onIdleChange`, `findRepoSession`.

### Authentication

- [ADR-004] On first run, the server MUST prompt the user to set a PIN via readline; the PIN MUST be hashed with bcrypt (10 salt rounds) and stored under `pinHash` in the config file.
- [ADR-004] PIN verification MUST use `bcrypt.compare` against the stored hash; no plaintext PIN MUST ever be stored or logged.
- [ADR-004] On successful PIN verification, the server MUST generate a session token using `crypto.randomBytes(32).toString('hex')` and set it as an `httpOnly`, `sameSite: strict` cookie.
- [ADR-004] Authenticated tokens MUST be stored in an in-memory `Set`; token expiry MUST be enforced via `setTimeout` based on the configured `cookieTTL` (default 24 hours).
- [ADR-004] Failed PIN attempts MUST be tracked per IP; after 5 failures, the IP MUST be locked out for 15 minutes; a successful auth MUST clear the counter for that IP.
- [ADR-004] WebSocket upgrade requests MUST be authenticated by checking the `token` cookie; unauthenticated connections MUST be rejected with a 401 before the upgrade completes.

### Testing

- [ADR-005] All unit tests MUST use `node:test` and `node:assert`; no external test framework (Jest, Vitest, Mocha) SHOULD be installed for unit testing.
- [ADR-005] Test files MUST be TypeScript source files in `test/` with the naming convention `*.test.ts`.
- [ADR-005] Tests MUST be compiled via `tsc -p tsconfig.test.json` and runnable via `npm test` (`tsc -p tsconfig.test.json && node --test dist/test/*.test.js`).
- [ADR-005] Eight test files MUST exist: `auth.test.ts`, `clipboard.test.ts`, `config.test.ts`, `sessions.test.ts`, `service.test.ts`, `paths.test.ts`, `version.test.ts`, and `worktrees.test.ts`.
- [ADR-008] `auth.test.ts` MUST use the `_resetForTesting()` export from `auth.ts` before each test to get fresh rate-limit state.
- [ADR-005] `sessions.test.ts` MUST clean up spawned PTY processes in `afterEach` hooks to prevent resource leaks.
- [ADR-005] `config.test.ts` MUST use temporary directories and clean up files between tests.
- [ADR-005] E2E tests (Playwright) SHOULD be kept separate from unit tests and MUST NOT be run as part of `npm test`.

### Distribution and CLI

- [ADR-006] The package MUST declare a `bin` entry pointing to `dist/bin/claude-remote-cli.js` (compiled from `bin/claude-remote-cli.ts`), which MUST parse CLI flags before delegating to the server.
- [ADR-006] CLI flags MUST be passed to the server via environment variables (`CLAUDE_REMOTE_CONFIG`, `CLAUDE_REMOTE_PORT`, `CLAUDE_REMOTE_HOST`).
- [ADR-006] Configuration MUST be resolved in this precedence order: CLI flags > environment variables > config file > built-in defaults.
- [ADR-006] Config file location MUST be `~/.config/claude-remote-cli/config.json` for global installs and `./config.json` for local dev; the config directory MUST be created automatically if absent.
- [ADR-006] The `CLAUDE_REMOTE_CONFIG` environment variable MAY override the default config file path.
- [ADR-006] The `files` field in `package.json` MUST limit the published package to `dist/` and `config.example.json`; TypeScript source, test files, and documentation MUST NOT be published.
- [ADR-008] The project MUST be compiled via `tsc` before running or publishing; `npm start` MUST compile before starting.

### WebSocket channels

- [ADR-007] The server MUST expose two separate WebSocket channels handled by a single `WebSocketServer` in `noServer` mode with manual upgrade routing.
- [ADR-007] The PTY channel URL pattern MUST match `/ws/[a-f0-9]+`; raw PTY output MUST be sent as text frames with no JSON wrapping; client text frames MUST be forwarded to PTY stdin, except `{"type":"resize"}` messages which MUST trigger a PTY resize.
- [ADR-007] When the PTY process exits, the server MUST close the WebSocket with code 1000.
- [ADR-007] The event channel MUST be accessible at `/ws/events` and MUST be server-to-client only; event messages MUST be JSON objects with a `type` field.
- [ADR-007] Connected event channel clients MUST be tracked in an in-memory `Set` and removed on close.
- [ADR-007] File system changes in `.worktrees/` directories MUST be debounced 500ms before emitting a `worktrees-changed` broadcast to all event channel clients.
- [ADR-007] REST endpoints that modify roots (POST/DELETE `/roots`) MUST also trigger `worktrees-changed` broadcasts and rebuild the watcher.
- [ADR-007] The frontend MUST auto-reconnect the event socket with a 3-second delay on close.
- [ADR-007] The PTY channel MUST auto-reconnect with exponential backoff (1s–10s, max 30 attempts) on unexpected close; code 1000 (PTY exit) MUST NOT trigger reconnect.
- [ADR-007] Both WebSocket channels MUST require authentication via the `token` cookie verified during HTTP upgrade; unauthenticated upgrade requests MUST be rejected with 401 and the socket MUST be destroyed.
