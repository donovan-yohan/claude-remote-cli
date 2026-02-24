# claude-remote-cli

Remote web interface for interacting with Claude Code CLI sessions from any device.

## Prerequisites

| Dependency | Why |
|------------|-----|
| **[Node.js 24+](https://nodejs.org/)** | Runtime for the server |
| **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** | The CLI that powers each terminal session — must be in your `PATH` |
| **[GitHub CLI (`gh`)](https://cli.github.com/)** | *Optional* — required for the **PRs tab**. Run `gh auth login` after installing. |

## Getting Started

### 1. Install

```bash
npm install -g claude-remote-cli
```

### 2. Start the server

```bash
claude-remote-cli
```

On first launch you'll be prompted to set a PIN. This PIN protects access to your Claude sessions.

Open `http://localhost:3456` in your browser and enter your PIN.

### 3. Add your project directories

Click **Settings** in the app to add root directories — these are parent folders that contain your git repos (scanned one level deep).

You can also edit `~/.config/claude-remote-cli/config.json` directly:

```json
{
  "rootDirs": ["/home/you/projects", "/home/you/work"]
}
```

### 4. Run as a background service (recommended)

To keep the server running after you close your terminal and auto-start on login:

```bash
claude-remote-cli --bg
```

This installs a persistent service (launchd on macOS, systemd on Linux) that restarts on crash. See [Background Service](#background-service) for more options.

### 5. Access from your phone with Tailscale

claude-remote-cli binds to `0.0.0.0` by default, but you should **not** expose it to the public internet. Use [Tailscale](https://tailscale.com/) to create a private encrypted network between your devices.

1. **Install Tailscale** on your computer (the one running claude-remote-cli) and on your phone/tablet
   - macOS: `brew install tailscale` or download from [tailscale.com/download](https://tailscale.com/download)
   - Linux: follow the [install guide](https://tailscale.com/download/linux)
   - iOS/Android: install the Tailscale app from your app store

2. **Sign in** to the same Tailscale account on both devices

3. **Find your computer's Tailscale IP** — run `tailscale ip` on your computer, or check the Tailscale admin console. It will look like `100.x.y.z`.

4. **Open the app** on your phone at `http://100.x.y.z:3456`

That's it. Your traffic is encrypted end-to-end via WireGuard, no ports are exposed to the internet, and only devices on your Tailscale network can reach the server.

> **Alternatives:** You can also use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared tunnel --url http://localhost:3456`) or [ngrok](https://ngrok.com/) (`ngrok http 3456`), but these expose your server to the public internet and rely on the PIN as your only layer of defense. Tailscale keeps everything private.

## Platform Support

Tested on **macOS** and **Linux**. Windows is not currently tested — file watching and PTY spawning may behave differently.

## CLI Usage

```
Usage: claude-remote-cli [options]
       claude-remote-cli <command>

Commands:
  update             Update to the latest version from npm
  install            Install as a background service (survives reboot)
  uninstall          Stop and remove the background service
  status             Show whether the service is running

Options:
  --bg               Shortcut: install and start as background service
  --port <port>      Override server port (default: 3456)
  --host <host>      Override bind address (default: 0.0.0.0)
  --config <path>    Path to config.json (default: ~/.config/claude-remote-cli/config.json)
  --version, -v      Show version
  --help, -h         Show this help
```

## Background Service

Run as a persistent service that starts on login and restarts on crash:

```bash
claude-remote-cli --bg
```

Or with custom options:

```bash
claude-remote-cli install --port 4000
```

Manage the service:

```bash
claude-remote-cli status      # Check if running
claude-remote-cli uninstall   # Stop and remove
```

- **macOS**: Uses launchd (`~/Library/LaunchAgents/`)
- **Linux**: Uses systemd user units (`~/.config/systemd/user/`)
- **Logs (macOS)**: `~/.config/claude-remote-cli/logs/`
- **Logs (Linux)**: `journalctl --user -u claude-remote-cli -f`

## Configuration

Config is stored at `~/.config/claude-remote-cli/config.json` (created on first run).

When running from source, it uses `./config.json` in the project root instead.

| Field | Default | Description |
|-------|---------|-------------|
| `host` | `0.0.0.0` | Bind address |
| `port` | `3456` | Server port |
| `cookieTTL` | `24h` | Auth cookie lifetime (e.g. `30m`, `12h`, `7d`) |
| `rootDirs` | `[]` | Directories containing your git repos (scanned one level deep) |
| `claudeCommand` | `claude` | Path to the Claude Code CLI binary |
| `claudeArgs` | `[]` | Extra arguments passed to every Claude session |

Root directories can also be managed from the **Settings** button in the app.

### PIN Management

The PIN hash is stored in config under `pinHash`. To reset:

1. Delete the `pinHash` field from your config file
2. Restart the server
3. You'll be prompted to set a new PIN

## Features

- **PIN-protected access** with rate limiting
- **Repo sessions** — click any idle repo to instantly open Claude with `--continue` (no dialog), or start fresh from the new-session dialog
- **Branch-aware worktrees** — create worktrees from new or existing branches with a type-to-search branch picker
- **Tabbed sidebar** — switch between Repos, Worktrees, and PRs views with shared filters and item counts
- **Worktree isolation** — each worktree session runs in its own git worktree under `.worktrees/`
- **Resume sessions** — click inactive worktrees to reconnect with `--continue`
- **Persistent session names** — display names, branch names, and timestamps survive server restarts
- **Clipboard image paste** — paste screenshots directly into remote terminal sessions (macOS clipboard + xclip on Linux)
- **Pull requests tab** — view your open PRs (authored and review-requested) per repo via `gh` CLI, with Author/Reviewer filter and one-click session creation from any PR branch
- **Yolo mode** — skip permission prompts with `--dangerously-skip-permissions` (per-session pill button)
- **Worktree cleanup** — delete inactive worktrees via the trash pill button (removes worktree, prunes refs, deletes branch)
- **Sidebar filters** — filter by root directory, repo, or text search
- **Inline actions** — pill buttons on session cards for rename, YOLO, worktree creation, and delete (hover on desktop, long-press on mobile)
- **Resizable sidebar** — drag the sidebar edge to resize; collapse/expand with a button (persisted to localStorage)
- **Scrollback buffer** — reconnect to a session and see prior output
- **Touch toolbar** — mobile-friendly buttons for special keys (hidden on desktop)
- **Responsive layout** — works on desktop and mobile with slide-out sidebar
- **Real-time updates** — worktree changes on disk are pushed to the browser instantly via WebSocket
- **Update notifications** — toast notification when a new version is available, with one-click update
- **CLI self-update** — `claude-remote-cli update` to update from npm

## Architecture

TypeScript + ESM backend (Express + node-pty + WebSocket) compiled to `dist/`. Svelte 5 frontend (runes + Vite) compiled to `dist/frontend/`.

```
claude-remote-cli/
├── bin/
│   └── claude-remote-cli.ts  # CLI entry point
├── server/
│   ├── index.ts        # Express server, REST API routes
│   ├── sessions.ts     # PTY session manager (node-pty)
│   ├── ws.ts           # WebSocket relay (PTY ↔ browser)
│   ├── watcher.ts      # File watcher for .worktrees/ changes
│   ├── auth.ts         # PIN hashing, verification, rate limiting
│   ├── config.ts       # Config loading/saving, worktree metadata
│   ├── clipboard.ts    # System clipboard operations (image paste)
│   ├── service.ts      # Background service management (launchd/systemd)
│   └── types.ts        # Shared TypeScript interfaces
├── frontend/
│   └── src/
│       ├── components/  # Svelte 5 components (Sidebar, Terminal, SessionList, etc.)
│       ├── lib/state/   # Reactive state modules (.svelte.ts)
│       ├── lib/api.ts   # REST API client
│       ├── lib/ws.ts    # WebSocket connection management
│       └── lib/types.ts # Frontend TypeScript interfaces
├── test/               # Unit tests (node:test)
├── dist/               # Compiled output (gitignored)
├── config.example.json
└── package.json
```

## License

MIT
