# Background Service Design

## Goal

Allow `claude-remote-cli` to run as a persistent background service that survives reboots, using native platform service managers (launchd on macOS, systemd on Linux).

## CLI Commands

| Command | What it does |
|---------|-------------|
| `claude-remote-cli --bg` | Shortcut: installs + starts the service |
| `claude-remote-cli install` | Creates the platform service and enables it |
| `claude-remote-cli uninstall` | Stops and removes the platform service |
| `claude-remote-cli status` | Shows whether the service is installed, running, and on which port |

## Platform Backends

### macOS — launchd

- Plist at `~/Library/LaunchAgents/com.claude-remote-cli.plist`
- `launchctl load/unload` to manage
- `RunAtLoad: true` — starts on login
- `KeepAlive: true` — restarts on crash
- stdout/stderr → `~/.config/claude-remote-cli/logs/`

### Linux — systemd (user-level)

- Unit at `~/.config/systemd/user/claude-remote-cli.service`
- `systemctl --user enable/start/stop/disable`
- `Restart=on-failure`
- Logs via `journalctl --user -u claude-remote-cli`

## Service Configuration

The service is installed with the current CLI flags baked in. `claude-remote-cli --bg --port 4000` installs a service running on port 4000. To change, uninstall and re-install.

## Log Location

- macOS: `~/.config/claude-remote-cli/logs/stdout.log` and `stderr.log`
- Linux: systemd journal (native)

## New Module

`server/service.js` — handles install/uninstall/status with platform detection (`process.platform`). No new dependencies — uses `fs` and `child_process`.
