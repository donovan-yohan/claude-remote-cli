# Patterns & Conventions

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed patterns guidance.

## Config Precedence

1. CLI flags (`--port`, `--host`, `--config`)
2. Environment variables (`CLAUDE_REMOTE_PORT`, `CLAUDE_REMOTE_HOST`, `CLAUDE_REMOTE_CONFIG`)
3. Config file (`~/.config/claude-remote-cli/config.json` when global, `./config.json` for dev)
4. Hardcoded defaults

## Authentication Flow

1. First run: CLI prompts for PIN, bcrypt-hashes it, saves to config
2. Browser: user enters PIN at login screen
3. Server verifies via bcrypt, issues `crypto.randomBytes(32)` cookie token
4. Rate limiting: per-IP, 5 failures = 15-minute lockout
5. To reset PIN: delete `pinHash` from config and restart

## PTY Management

- `CLAUDECODE` env var is stripped from PTY env to allow nesting
- Worktree naming convention: `mobile-<name>-<timestamp>`
- Scrollback buffer: max 256KB per session, auto-trims oldest entries
- Session auto-deleted when PTY exits; WebSocket closed on exit

## Cookie TTL Parsing

Human-readable format: `s` (seconds), `m` (minutes), `h` (hours), `d` (days). Default: `24h`.

## Root Directory Scanning

Scans configured `rootDirs` one level deep for git repos. Hidden directories (starting with `.`) are excluded.

## Real-Time Worktree Sync

- `WorktreeWatcher` monitors `.claude/worktrees/` dirs using `fs.watch` (macOS/Linux only)
- File system events are debounced (500ms) before broadcasting `worktrees-changed` via `/ws/events`
- REST root changes (POST/DELETE `/roots`) also trigger watcher rebuild + broadcast
- Frontend auto-reconnects the event socket with 3-second retry on close
- Settings dialog close triggers `refreshAll()` for immediate sidebar update

## Frontend Conventions

- Vanilla JS, no build step, no framework
- All frontend state lives in `public/app.js` module-level variables
- Vendor libraries (xterm.js) bundled in `public/vendor/`
- Mobile-first responsive design with touch toolbar
