# Design

Backend patterns and conventions for claude-remote-cli. The server is a composition-root architecture where `index.ts` wires together single-concern modules communicating via ESM imports.

## Key Decisions

| Decision | Rationale | Source |
|----------|-----------|--------|
| No dependency injection | Direct ESM imports are simpler for a small module count | ADR-001 |
| In-memory sessions only | No persistence needed — sessions are ephemeral PTY processes | ADR-003 |
| bcrypt + cookie tokens | Simple, secure auth without external dependencies | ADR-004 |
| node:test, no Jest/Vitest | Fewer dependencies, built-in to Node.js | ADR-005 |
| Dual distribution (global + local) | npm global for production, local clone for dev | ADR-006 |
| TypeScript + ESM migration | Type safety, modern module system, strict mode | ADR-008 |

## Config Precedence (canonical)

1. CLI flags (`--port`, `--host`, `--config`)
2. Environment variables (`CLAUDE_REMOTE_PORT`, `CLAUDE_REMOTE_HOST`, `CLAUDE_REMOTE_CONFIG`)
3. Config file (`~/.config/claude-remote-cli/config.json` global, `./config.json` dev)
4. Hardcoded defaults

## PTY Management

- `CLAUDECODE` env var stripped from PTY env to allow nesting
- Scrollback buffer: max 256KB per session, FIFO eviction
- PTY sessions survive browser disconnects — server keeps them alive
- Session auto-deleted when PTY exits; WebSocket closed with code 1000
- `claudeArgs` from POST body merged with `config.claudeArgs` (config args first)
- Resuming a worktree passes `--continue` to Claude CLI

## Session Types

- **Repo sessions** (`POST /sessions/repo`) — Claude runs directly in repo root. One per repo path (409 on conflict). Supports `continue: true` for `--continue` mode.
- **Worktree sessions** (`POST /sessions`) — Creates git worktree under `.worktrees/`. Multiple per repo allowed.

## Idle Detection

- `idle: true` when no PTY output for 5 seconds
- `onIdleChange(callback)` is single-subscriber (not EventEmitter)
- `ws.ts` broadcasts `session-idle-changed` events over event WebSocket

## Clipboard Image Passthrough

1. Browser paste/drop detects image, base64-encodes and POSTs to `/sessions/:id/image`
2. Server saves to `/tmp/claude-remote-cli/:sessionId/paste-:timestamp.:ext`
3. Attempts system clipboard set (osascript on macOS, xclip on Linux)
4. If clipboard set succeeds: sends `\x16` (Ctrl+V) to PTY stdin
5. If fails: returns file path; frontend shows "Insert Path" button

**Platform-specific:** On Windows/Linux, xterm.js intercepts Ctrl+V (custom key handler reads Clipboard API). On macOS, only Cmd+V triggers paste.

## Background Service

- `--bg` is shortcut for `install` (installs + starts)
- Service files generated with current CLI flags baked in
- macOS: launchd plist (`RunAtLoad` + `KeepAlive`); Linux: systemd user unit (`Restart=on-failure`)
- To change port/host: `uninstall` then re-install with new flags

## Deep Docs

| Document | Purpose |
|----------|---------|
| `design-docs/core-beliefs.md` | Agent-first operating principles |
| `design-docs/` | Feature design documents (brainstorm outputs) |

## See Also

- [Architecture](ARCHITECTURE.md) — module boundaries and invariants
- [Frontend](FRONTEND.md) — Svelte 5 patterns and component conventions
- [Quality](QUALITY.md) — testing patterns and test isolation
- [Plans](PLANS.md) — active and completed execution plans
