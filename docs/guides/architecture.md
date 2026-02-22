# Architecture

> Part of the [Harness documentation system](../../CLAUDE.md). Edit this file for detailed architecture guidance.

## Overview

Remote web interface for Claude Code CLI sessions. TypeScript + ESM backend (Express + node-pty + WebSocket) compiled to `dist/`. Vanilla JS frontend with xterm.js renders terminals in the browser.

## Server Modules

Nine TypeScript modules under `server/`, compiled to `dist/server/` via `tsc`:

| Module | Role |
|--------|------|
| `server/index.ts` | Composition root: Express app, REST API routes, auth middleware, static file serving |
| `server/sessions.ts` | PTY spawning via `node-pty`, session lifecycle, scrollback buffering (256KB max) |
| `server/ws.ts` | WebSocket upgrade handler, bidirectional PTY relay, scrollback replay on connect |
| `server/watcher.ts` | File system watching for `.claude/worktrees/` directories, debounced event emission |
| `server/auth.ts` | PIN hashing (bcrypt), rate limiting (5 fails = 15-min lockout), cookie token generation |
| `server/config.ts` | Config loading/saving with defaults, worktree metadata persistence |
| `server/clipboard.ts` | System clipboard detection and image-set operations (osascript on macOS, xclip on Linux) |
| `server/service.ts` | Background service install/uninstall/status (launchd on macOS, systemd on Linux) |
| `server/types.ts` | Shared TypeScript interfaces (Session, Config, ServicePaths, WorktreeMetadata, Platform, InstallOpts) |

Modules communicate via ESM `import` statements. `index.ts` is the composition root and should not be imported by other modules.

## Frontend

Single-page app in `public/`. No build step, no framework. ES5-compatible syntax only.

| File | Role |
|------|------|
| `public/app.js` | All frontend logic: session management, WebSocket, terminal, filtering, sidebar, update toast, clipboard image paste, context menus, touch toolbar |
| `public/index.html` | HTML structure with PIN gate, sidebar, terminal container, dialogs, context menus |
| `public/style.css` | Dark theme, responsive mobile-first layout |
| `public/vendor/` | Bundled xterm.js and addon-fit.js |

## Data Flow

```
Browser (xterm.js) <--WebSocket /ws/:id--> server/ws.ts <--PTY I/O--> node-pty <--spawns--> claude CLI
                                                |
                                           scrollback buffer (in-memory, per session)

Browser (app.js)   <--WebSocket /ws/events-- server/ws.ts <-- watcher.ts (fs.watch on .claude/worktrees/)
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
| `POST` | `/sessions` | Create new session or resume worktree (accepts `claudeArgs` for flags like `--dangerously-skip-permissions`) |
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
- `/ws/events` - Server-to-client broadcast (JSON `{type: "worktrees-changed"}`)

## Session Object Structure

```typescript
{
  id: string;            // crypto.randomBytes(8).toString('hex')
  root: string;          // configured root directory
  repoName: string;      // repository name
  repoPath: string;      // working directory (repo or worktree path)
  worktreeName: string;  // Claude Code worktree name
  displayName: string;   // user-friendly name
  pty: IPty;             // node-pty process handle
  createdAt: string;     // ISO timestamp
  lastActivity: string;  // ISO timestamp
  scrollback: string[];  // data chunks, max 256KB total
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
