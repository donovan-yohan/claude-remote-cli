# claude-remote-cli

Remote web interface for interacting with Claude Code CLI sessions from any device.

## Quick Start

### Install from npm

```bash
npm install -g claude-remote-cli
claude-remote-cli
```

### Or run from source

```bash
git clone https://github.com/donovan-yohan/claude-remote-cli.git
cd claude-remote-cli
npm install
node server/index.js
```

On first launch you'll be prompted to set a PIN. Then open `http://localhost:3456` in your browser.

## Prerequisites

- **Node.js 20+**
- **Claude Code CLI** installed and available in your PATH (or configure `claudeCommand` in config)

## Platform Support

Tested on **macOS** and **Linux**. Windows is not currently tested — file watching and PTY spawning may behave differently.

## CLI Usage

```
Usage: claude-remote-cli [options]
       claude-remote-cli <command>

Commands:
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
- **Worktree isolation** — each session runs in its own Claude Code `--worktree`
- **Resume sessions** — click inactive worktrees to reconnect
- **Sidebar filters** — filter by root directory, repo, or text search
- **Inline rename** — rename sessions with the pencil icon (syncs with Claude Code's `/rename`)
- **Scrollback buffer** — reconnect to a session and see prior output
- **Touch toolbar** — mobile-friendly buttons for special keys (arrows, Enter, Escape, Ctrl+C, Tab, y/n)
- **Responsive layout** — works on desktop and mobile with slide-out sidebar
- **Real-time updates** — worktree changes on disk are pushed to the browser instantly via WebSocket

## Architecture

```
claude-remote-cli/
├── bin/
│   └── claude-remote-cli.js  # CLI entry point
├── server/
│   ├── index.js       # Express server, REST API routes
│   ├── sessions.js    # PTY session manager (node-pty)
│   ├── ws.js          # WebSocket relay (PTY ↔ browser)
│   ├── watcher.js     # File watcher for .claude/worktrees/ changes
│   ├── auth.js        # PIN hashing, verification, rate limiting
│   └── config.js      # Config loading/saving
├── public/
│   ├── index.html     # Single-page app
│   ├── app.js         # Frontend logic
│   ├── style.css      # Styles (dark theme)
│   └── vendor/        # Self-hosted xterm.js + addon-fit
├── config.example.json
└── package.json
```

## Remote Access

To access from your phone or another device, expose the server via a tunnel or VPN:

- **Tailscale** (recommended): Install on both devices, access via Tailscale IP
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3456`
- **ngrok**: `ngrok http 3456`

## License

MIT
