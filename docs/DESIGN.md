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
| Multi-agent CLI support | Abstract UI concepts (yolo, continue) map to agent-specific flags via `AGENT_COMMANDS`/`AGENT_YOLO_ARGS`/`AGENT_CONTINUE_ARGS` records in sessions.ts | Design doc |
| Global session defaults | `defaultContinue`, `defaultYolo`, `launchInTmux` extend the `defaultAgent` pattern; shared reactive store (`config.svelte.ts`) ensures all components see fresh values after settings changes | Design doc |
| Tmux clipboard passthrough | OSC 52 sequences from tmux flow through PTY→WebSocket to xterm.js; frontend handler decodes and writes to browser Clipboard API. Shift+click bypasses tmux mouse capture for native selection | Design doc |

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
- Re-attaching to a previous agent conversation uses agent-specific continue args (`--continue` for Claude, `resume --last` for Codex); reconnecting to a live PTY session requires no special args
- **PTY retry on `--continue` failure:** If a session spawned with continue args exits non-zero within 3 seconds, the retry mechanism strips continue args and respawns. WebSocket clients are reattached via `onPtyReplacedCallbacks` (supports multiple concurrent connections). Tmux retries use a `-retry` suffix on the session name to avoid collision.

## Session Types

- **Repo sessions** (`POST /sessions/repo`) — The selected coding agent runs directly in the repo root. One per repo path (409 on conflict). Supports `continue: true`, which maps to agent-specific continue args.
- **Worktree sessions** (`POST /sessions`) — Creates git worktree under `.worktrees/` and launches the selected coding agent there. Multiple per repo allowed. If a branch is already checked out (main worktree or another worktree), auto-redirects to that location instead of failing.
- **Worktree deletion** (`DELETE /worktrees`) — Validated via `git worktree list` (supports arbitrary paths, not just `.worktrees/`). Main worktree cannot be deleted.

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

## Slash Commands

- Claude Code slash commands live in `.claude/commands/` and are tracked in git
- `.gitignore` ignores `.claude/` subdirectories individually (not blanket) to allow `commands/` to be versioned
- Commands are markdown prompt templates executed interactively by Claude

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
