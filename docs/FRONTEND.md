# Frontend

Svelte 5 SPA for claude-remote-cli. Built with runes syntax, TypeScript, and Vite. The frontend provides terminal access, session management, and real-time worktree monitoring.

## Current State

- Svelte 5 with runes (`$state`, `$derived`, `$effect`, `$props()`) — TypeScript throughout
- Vite builds `frontend/` to `dist/frontend/`; Express serves compiled output
- xterm.js consumed as npm dependency (`@xterm/xterm`, `@xterm/addon-fit`)
- Mobile-first responsive design with touch toolbar (hidden on desktop)

## Component Map

| Component | Role |
|-----------|------|
| `App.svelte` | Root layout: sidebar + terminal + mobile header |
| `Sidebar.svelte` | Two-tab sidebar (Repos / Worktrees), session list, filters |
| `SessionList.svelte` | Filtered session list with status grouping |
| `SessionItem.svelte` | 3-row session card: status dot + name, git metadata, time + diff stats |
| `SessionFilters.svelte` | Filter controls for session list |
| `Terminal.svelte` | xterm.js terminal wrapper with WebSocket connection |
| `Toolbar.svelte` | Mobile touch toolbar for terminal interaction |
| `MobileHeader.svelte` | Mobile header with session info |
| `MobileInput.svelte` | Mobile text input for terminal commands |
| `ContextMenu.svelte` | Right-click/long-press context menu |
| `PinGate.svelte` | PIN authentication screen |
| `ImageToast.svelte` | Clipboard image paste feedback |
| `UpdateToast.svelte` | Version update notification |
| `dialogs/` | New session, settings, and other modal dialogs |

## State Management

State lives in `.svelte.ts` modules under `frontend/src/lib/state/` exporting reactive state and mutation functions. Components import state — they do not own it.

## Conventions

- Scoped `<style>` blocks in each component; global CSS variables in `frontend/src/app.css`
- Sidebar status dots: green (running), blue (idle), amber glow (needs attention), gray (inactive)
- Attention state: tracked in `attentionSessions` reactive state; set when session becomes idle while not viewed; cleared when user opens session
- Hover effects: fade mask on overflow text, scroll reveal animation, action button opacity reveal
- Avoid naming local variables `state` in `.svelte` files — conflicts with `$state` rune

## WebSocket Reconnection

- **Event socket** (`/ws/events`): auto-reconnect with fixed 3-second delay
- **PTY socket** (`/ws/:sessionId`): exponential backoff (1s, 2s, 4s, 8s, capped at 10s, max 30 attempts)
- Close code 1000 = PTY exited — no reconnect, shows `[Session ended]`
- Before reconnect, client verifies session still exists via `GET /sessions`
- `[Reconnecting...]` shown once to avoid terminal spam
- All event WebSocket connections must have both `close` and `error` handlers

## Key Patterns

- The new-session dialog is tab-aware: repo mode hides branch input and shows "Continue previous conversation" checkbox; worktree mode shows branch input
- Worktree naming convention: `mobile-<name>-<timestamp>`
- Settings dialog close triggers `refreshAll()` for immediate sidebar update
- Cookie TTL uses human-readable format: `s` (seconds), `m` (minutes), `h` (hours), `d` (days). Default: `24h`
- Root directory scanning: one level deep for git repos, hidden directories excluded

## See Also

- [Architecture](ARCHITECTURE.md) — full data flow and API routes
- [Design](DESIGN.md) — backend patterns, auth flow, session types
