# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Remote web interface for interacting with Claude Code CLI sessions from any device.

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start the server (`node server/index.js`) |
| `npm test` | Run all tests (`node --test test/*.test.js`) |
| `node --test test/auth.test.js` | Run a single test file |
| `claude-remote-cli` | Run as global CLI (after `npm install -g`) |
| `npm version patch\|minor\|major` | Bump version, commit, and tag (see [deployment guide](docs/guides/deployment.md)) |

## Architecture

Node.js backend (Express + node-pty + WebSocket) manages Claude Code CLI sessions as PTY processes. Vanilla JS frontend with xterm.js renders terminals in the browser. No build step.

- `bin/` - CLI entry point, flag parsing, config directory setup
- `server/` - Express REST API, WebSocket relay, PTY session manager, auth, config
- `public/` - Single-page app (HTML/CSS/JS), bundled xterm.js vendor libs
- `test/` - Unit tests using Node.js built-in `node:test`

## Documentation Map

| Topic | Location |
|-------|----------|
| Architecture & Data Flow | [docs/guides/architecture.md](docs/guides/architecture.md) |
| Testing | [docs/guides/testing.md](docs/guides/testing.md) |
| Patterns & Conventions | [docs/guides/patterns.md](docs/guides/patterns.md) |
| Guide Index | [docs/guides/index.md](docs/guides/index.md) |
| Risk Contract | [docs/risk-contract.json](docs/risk-contract.json) |
| Review Agent Setup | [docs/guides/review-agent-setup.md](docs/guides/review-agent-setup.md) |
| ADRs | [docs/adrs/](docs/adrs/) |
| Active Plans | [docs/exec-plans/active/](docs/exec-plans/active/) |
| Deployment & Publishing | [docs/guides/deployment.md](docs/guides/deployment.md) |
| Completed Plans | [docs/exec-plans/completed/](docs/exec-plans/completed/) |

## Gotchas

- `node-pty` requires native compilation; `postinstall` script fixes prebuilt binaries on macOS
- `CLAUDECODE` env var must be stripped from PTY env to allow nesting Claude sessions
- Scrollback buffer is capped at 256KB per session; oldest chunks are trimmed first
- Config lives at `~/.config/claude-remote-cli/config.json` when installed globally, `./config.json` for local dev
- PIN reset: delete `pinHash` from config file and restart server
- Requires Node.js >= 20.0.0
- ADRs in `docs/adrs/` enforce structural constraints (e.g., server module list); update ADRs when adding new modules
