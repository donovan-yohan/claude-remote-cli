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
- PTY sessions survive browser disconnects — the server keeps them alive in memory; only PTY process exit removes a session
- Session auto-deleted when PTY exits; WebSocket closed with code 1000 on exit
- `claudeArgs` from POST body are merged with `config.claudeArgs` (config args first, request args appended)
- Resuming a worktree passes `--continue` to the Claude CLI (not `--resume`)
- Sessions module exports: `create`, `get`, `list`, `kill`, `resize`, `updateDisplayName`, `write`, `onIdleChange`

## Idle Detection

- Each session tracks idle state: `idle: true` when no PTY output for 5 seconds
- `onIdleChange(callback)` is a single-subscriber callback pattern (not EventEmitter) — only one listener at a time
- `ws.ts` subscribes to idle changes and broadcasts `session-idle-changed` events over the event WebSocket
- Idle timer is cleared when PTY exits to prevent stale callbacks

## Worktree Metadata Persistence

Worktree metadata (display name, last activity) is persisted to `~/.config/claude-remote-cli/worktree-meta/<worktree-name>.json` so that session names and timestamps survive server restarts. Metadata is written on session creation, rename, and activity; read when listing inactive worktrees in the sidebar.

## Yolo Mode

Passes `--dangerously-skip-permissions` to the Claude CLI, skipping all permission prompts. Available in two places:

- **New session dialog:** "Yolo mode" checkbox sends `claudeArgs: ['--dangerously-skip-permissions']` in the POST body
- **Context menu:** "Resume in yolo mode" on inactive worktrees resumes with the flag

The flag is per-session and not persisted — resuming a worktree normally will use standard permission mode regardless of how it was originally created.

## Worktree Cleanup

`DELETE /worktrees` removes a worktree from disk:

1. Validates path is inside `.claude/worktrees/`
2. Checks no active session is using the worktree (409 if conflict)
3. `git worktree remove <path>` (fails if uncommitted changes — no `--force`)
4. `git worktree prune` (non-fatal on failure)
5. `git branch -D <branchName>` (non-fatal on failure)

Accessible via right-click/long-press context menu on inactive worktrees in the sidebar.

## Update Notifications

- `GET /version` compares installed version against npm registry latest using `semverLessThan`
- If an update is available, the frontend shows a toast with a one-click "Update now" button
- `POST /update` runs `npm install -g claude-remote-cli@latest` via `child_process.execFile`
- Toast appears once per page load (checked on app init)

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

## WebSocket Reconnection

- **Event socket** (`/ws/events`): auto-reconnects with fixed 3-second delay on close
- **PTY socket** (`/ws/:sessionId`): auto-reconnects with exponential backoff (1s, 2s, 4s, 8s, capped at 10s, max 30 attempts)
- Close code 1000 = PTY exited normally — no reconnect, shows `[Session ended]`
- Before each reconnect attempt, the client verifies the session still exists via `GET /sessions`
- `[Reconnecting...]` is only shown once (on first attempt) to avoid terminal spam
- All event WebSocket connections must have both `close` and `error` handlers to prevent unhandled exceptions

## Frontend Conventions

- Vanilla JS, no build step, no framework
- ES5-compatible syntax: `var`, function expressions, `.then()` chains (no arrow functions, destructuring, or template literals)
- All frontend state lives in `public/app.js` module-level variables inside a single IIFE
- Vendor libraries (xterm.js, addon-fit.js) bundled in `public/vendor/`, loaded via `<script>` tags
- DOM manipulation via `document.getElementById`, `document.createElement`, and event listeners
- Mobile-first responsive design with touch toolbar (hidden on desktop to maximize terminal space)
- Sidebar status dots: green (running), blue (idle), amber glow (needs attention), gray (inactive worktree)
- Attention state: tracked client-side in `attentionSessions` object; set when a session becomes idle while not actively viewed; cleared when user opens the session

## Clipboard Image Passthrough

Allows pasting images from the client clipboard into the remote terminal:

1. **Browser paste event** (macOS Cmd+V) or **Ctrl+V interception** (Windows/Linux) detects image in clipboard
2. Image is base64-encoded and POSTed to `POST /sessions/:id/image`
3. Server saves to `/tmp/claude-remote-cli/:sessionId/paste-:timestamp.:ext`
4. Server attempts to set the system clipboard via `clipboard.ts` (osascript on macOS, xclip on Linux)
5. If clipboard set succeeds: sends `\x16` (Ctrl+V) to PTY stdin so Claude reads it
6. If clipboard set fails: returns the file path; frontend shows an "Insert Path" button

**Platform-specific Ctrl+V handling:** On Windows/Linux, xterm.js intercepts Ctrl+V internally without firing a native paste event, so a custom key event handler (`attachCustomKeyEventHandler`) reads the clipboard via the Clipboard API. On macOS, Ctrl+V sends raw `\x16` to the terminal (used by vim etc.), so only Cmd+V triggers clipboard paste.

Drag-and-drop image upload uses the same `uploadImage()` flow.

## Background Service

- `--bg` is a shortcut for `install` (installs + starts)
- Service files are generated with current CLI flags baked in
- macOS: launchd plist with `RunAtLoad` + `KeepAlive`
- Linux: systemd user unit with `Restart=on-failure`
- To change port/host: `uninstall` then re-install with new flags
