# claude-remote-cli

Remote web interface for interacting with Claude Code CLI sessions from any device. TypeScript + ESM backend (Express + node-pty + WebSocket) compiled to `dist/`. Svelte 5 frontend (runes + Vite) compiled to `dist/frontend/`.

## Quick Reference

| Action | Command |
|--------|---------|
| Build | `npm run build` |
| Test | `npm test` |
| Start | `npm start` |
| Run (global) | `claude-remote-cli` |
| Version bump | `npm version patch\|minor\|major` |

## Documentation Map

| Category | Path | When to look here |
|----------|------|-------------------|
| Architecture | `docs/ARCHITECTURE.md` | Module boundaries, data flow, API routes, ADR rules |
| Design | `docs/DESIGN.md` | Backend patterns, auth flow, PTY management, session types |
| Frontend | `docs/FRONTEND.md` | Svelte 5 components, state management, UI conventions |
| Quality | `docs/QUALITY.md` | Test runner, test files, isolation patterns |
| Plans | `docs/PLANS.md` | Active work, completed plans, tech debt |
| Design Docs | `docs/design-docs/` | Feature brainstorm outputs and design decisions |
| References | `docs/references/` | Deployment guide, review agent setup |
| ADRs | `docs/adrs/` | Architecture decision records (normative constraints) |

## Key Patterns

- Nine server modules under `server/`, each owning one concern — update ADRs when adding modules
- `node-pty` requires native compilation; `postinstall` script fixes prebuilt binaries on macOS
- `CLAUDECODE` env var must be stripped from PTY env to allow nesting Claude sessions
- Scrollback buffer capped at 256KB per session; oldest chunks trimmed first (FIFO)
- Config at `~/.config/claude-remote-cli/config.json` (global) or `./config.json` (local dev)
- PIN reset: delete `pinHash` from config file and restart server
- Requires Node.js >= 24.0.0 (use `nvm use` with `.nvmrc`)
- All relative imports use `.js` extensions; Node builtins use `node:` prefix
- npm package — publishing automated via GitHub Actions (see `docs/references/deployment.md`)

## Deployment

`npm version <type>` → `git push && git push --tags` → CI publishes. See `docs/references/deployment.md`.

## Workflow

> brainstorm → plan → orchestrate → complete

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `/harness:brainstorm` | Design through collaborative dialogue |
| 2 | `/harness:plan` | Create living implementation plan |
| 3 | `/harness:orchestrate` | Execute with agent teams + micro-reflects |
| 4 | `/harness:complete` | Reflect, review, and create PR |
