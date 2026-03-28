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
| Mobile input tests | Add fixture to `test/fixtures/mobile-input/` before fixing keyboard bugs |

## Design System

Always read `DESIGN.md` before making any visual or UI decisions. All font choices, colors, spacing, border-radius, button styles, and aesthetic direction are defined there. Do not deviate without explicit user approval. In QA mode, flag any code that doesn't match DESIGN.md.

## Documentation Map

| Category | Path | When to look here |
|----------|------|-------------------|
| Architecture | `docs/ARCHITECTURE.md` | Module boundaries, data flow, API routes, ADR rules |
| Visual Design | `DESIGN.md` | TUI aesthetic, colors, buttons, icons, border-radius rules |
| Design | `docs/DESIGN.md` | Backend patterns, auth flow, PTY management, session types |
| Frontend | `docs/FRONTEND.md` | Svelte 5 components, state management, UI conventions |
| Quality | `docs/QUALITY.md` | Test runner, test files, isolation patterns |
| Plans | `docs/PLANS.md` | Active work, completed plans, tech debt |
| Design Docs | `docs/design-docs/` | Feature brainstorm outputs and design decisions |
| References | `docs/references/` | Deployment guide, review agent setup |
| ADRs | `docs/adrs/` | Architecture decision records (normative constraints) |
| Learnings | `docs/LEARNINGS.md` | Persistent cross-session learnings (architecture, debugging, patterns) |

## Key Patterns

- Twenty-seven server modules under `server/`, each owning one concern — update ADRs when adding modules
- `node-pty` requires native compilation; `postinstall` script fixes prebuilt binaries on macOS
- `CLAUDECODE` env var must be stripped from PTY env to allow nesting Claude sessions
- Scrollback buffer capped at 256KB per session; oldest chunks trimmed first (FIFO)
- Config at `~/.config/claude-remote-cli/config.json` (global) or `./config.json` (local dev)
- PIN reset: run `claude-remote-cli pin reset` on the host machine (interactive TTY required)
- Requires Node.js >= 24.0.0 (use `nvm use` with `.nvmrc`)
- All relative imports use `.js` extensions; Node builtins use `node:` prefix
- npm package — publishing automated via GitHub Actions (see `docs/references/deployment.md`)

## Branching & Deployment

- **`nightly`** — default branch, active development. PRs target here. Every push auto-publishes `@nightly`.
- **`master`** — protected, stable releases only. Tags trigger `@latest` publish.
- **Stable release** — PR from `nightly` → `master`, merge, tag with `npm version`, sync back to `nightly`.
- **Hotfixes** — branch off `master`, PR to `master`, tag, merge `master` back to `nightly`.
- Always use PRs for audit trail — never push directly to `master`.
- See `docs/references/deployment.md` for full workflow.

## Workflow

> brainstorm → plan → orchestrate → complete

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `/harness:brainstorm` | Design through collaborative dialogue |
| 2 | `/harness:plan` | Create living implementation plan |
| 3 | `/harness:orchestrate` | Execute with agent teams + micro-reflects |
| 4 | `/harness:complete` | Reflect, review, and create PR |
