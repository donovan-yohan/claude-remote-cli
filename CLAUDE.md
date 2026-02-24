# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Remote web interface for interacting with Claude Code CLI sessions from any device.

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm start` | Build + start server (`tsc && node dist/server/index.js`) |
| `npm test` | Build + run all tests (`tsc -p tsconfig.test.json && node --test dist/test/*.test.js`) |
| `claude-remote-cli` | Run as global CLI (after `npm install -g`) |
| `npm version patch\|minor\|major` | Bump version, commit, and tag (see [deployment guide](docs/guides/deployment.md)) |

## Architecture

TypeScript + ESM backend (Express + node-pty + WebSocket) compiled to `dist/`. Svelte 5 frontend (runes + Vite) compiled to `dist/frontend/`.

- `bin/` - CLI entry point (TypeScript source), compiled to `dist/bin/`
- `server/` - Express REST API, WebSocket relay, PTY session manager, auth, config, shared types (TypeScript source), compiled to `dist/server/`
- `frontend/` - Svelte 5 SPA (TypeScript + Svelte components, Vite build), compiled to `dist/frontend/`
- `test/` - Unit tests using Node.js built-in `node:test` (TypeScript source), compiled to `dist/test/`
- `dist/` - Compiled JavaScript output (gitignored)

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

## Deployment

This is an npm package. Publishing is automated via GitHub Actions — bump version with `npm version`, push to `master` with tags, and CI publishes. See [deployment guide](docs/guides/deployment.md).

## Gotchas

- `node-pty` requires native compilation; `postinstall` script fixes prebuilt binaries on macOS
- `CLAUDECODE` env var must be stripped from PTY env to allow nesting Claude sessions
- Scrollback buffer is capped at 256KB per session; oldest chunks are trimmed first
- Config lives at `~/.config/claude-remote-cli/config.json` when installed globally, `./config.json` for local dev
- PIN reset: delete `pinHash` from config file and restart server
- Requires Node.js >= 24.0.0 (use `nvm use` with `.nvmrc`)
- ADRs in `docs/adrs/` enforce structural constraints (e.g., server module list); update ADRs when adding new modules
