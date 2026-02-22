# ADR-001: Modular Express Server Architecture

## Status
Accepted

## Date
2026-02-21

## Decider(s)
Donovan Yohan

## Context
claude-remote-cli is a remote web interface for Claude Code CLI sessions. The server must handle several distinct concerns: HTTP routing, PTY process lifecycle, WebSocket relay, file system watching, authentication, and configuration I/O. A single monolithic file would become difficult to navigate and modify as features are added. However, the project is small enough that introducing a formal layered architecture (hexagonal, clean architecture, etc.) would add unnecessary abstraction without proportional benefit.

## Decision
The server MUST be organized into seven modules under `server/`, each responsible for a single concern:

| Module | Responsibility |
|--------|---------------|
| `index.ts` | Express app setup, HTTP route handlers, server startup |
| `sessions.ts` | PTY process spawning, in-memory session registry, session lifecycle (create/list/get/kill/resize) |
| `ws.ts` | WebSocket upgrade handling, PTY-to-browser data relay, event channel broadcast |
| `watcher.ts` | File system watching for `.claude/worktrees/` directories, debounced event emission |
| `auth.ts` | PIN hashing (bcrypt), PIN verification, rate limiting, cookie token generation |
| `config.ts` | Config file I/O (load/save JSON), default values |
| `service.ts` | Background service install/uninstall/status management (launchd on macOS, systemd on Linux) |
| `types.ts` | Shared TypeScript interfaces (Session, Config, ServicePaths, Platform, InstallOpts) |

Modules are TypeScript source files compiled to `dist/server/` via `tsc`. Modules MUST communicate through ESM `import` statements. There is no dependency injection container, no service layer, and no abstract interfaces. `index.ts` serves as the composition root, wiring modules together at startup.

Modules SHOULD NOT import `index.ts`. Cross-module dependencies flow downward: `index.ts` imports all others; `ws.ts` imports `sessions`; all other modules are self-contained.

## Consequences

### Positive
- Each file stays under 120 lines, making it easy to read and modify in isolation
- New contributors can understand the full server by reading six small files
- No framework boilerplate or abstraction layers to learn
- Module boundaries map directly to the npm dependency graph (e.g., only `auth.js` depends on bcrypt, only `sessions.js` depends on node-pty)

### Negative
- `index.js` accumulates route handlers and grows as new REST endpoints are added; it currently handles routes for sessions, repos, worktrees, roots, and auth
- No formal interface contracts between modules means refactoring a module's API requires updating all callers manually

### Risks
- If the project grows significantly (e.g., adding user accounts, multi-tenant support), this flat module structure may need to evolve into a layered or domain-grouped architecture
