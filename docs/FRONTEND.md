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
| `Sidebar.svelte` | Three-tab sidebar (Repos / Worktrees / PRs), session list, filters |
| `SessionList.svelte` | Filtered session/worktree list with status grouping, recency sorting, and collapsible repo groups |
| `SessionItem.svelte` | 3-row session card: status dot + name, git metadata, time + diff stats; shimmer overlay during loading |
| `SessionFilters.svelte` | Filter controls (root, repo, search) + Author/Reviewer toggle for PRs tab |
| `PrRepoGroup.svelte` | Collapsible per-repo PR group with svelte-query fetching and PR count badge |
| `PullRequestItem.svelte` | 3-row PR card: state icon + title, author + role badge, time + diff stats |
| `Terminal.svelte` | xterm.js terminal wrapper with WebSocket connection |
| `Toolbar.svelte` | Mobile touch toolbar for terminal interaction |
| `MobileHeader.svelte` | Mobile header with session info |
| `MobileInput.svelte` | Mobile text input for terminal commands |
| `ContextMenu.svelte` | Universal "..." dropdown menu for session/item actions |
| `PinGate.svelte` | PIN authentication screen |
| `ImageToast.svelte` | Clipboard image paste feedback |
| `UpdateToast.svelte` | Version update notification |
| `dialogs/` | New session, settings, and other modal dialogs |

## State Management

State lives in `.svelte.ts` modules under `frontend/src/lib/state/` exporting reactive state and mutation functions. Components import state — they do not own it. PR data is managed via `@tanstack/svelte-query` v6 (cache + manual refresh), not in state modules.

| Module | Role |
|--------|------|
| `sessions.svelte.ts` | Session list, worktrees, repos, attention flags, notification preferences, git statuses, loading state |
| `config.svelte.ts` | Global session defaults (continue, yolo, tmux, agent, notifications); shared by SettingsDialog, SessionList, NewSessionDialog |
| `auth.svelte.ts` | Authentication state (PIN check, cookie token) |
| `ui.svelte.ts` | UI state (active tab, sidebar, filters) |

## Conventions

- Scoped `<style>` blocks in each component; global CSS variables in `frontend/src/app.css`
- Sidebar status dots: green (running), blue (idle), amber glow (needs attention), gray (inactive)
- Attention state: tracked in `attentionSessions` reactive state; set when session becomes idle while not viewed; cleared when user opens session
- Loading state: tracked in `loadingItems` reactive state; `setLoading`/`clearLoading` wrap async actions (start, kill, delete); SessionItem shows CSS shimmer overlay with `pointer-events: none`
- Hover effects: fade mask on overflow text, scroll reveal animation
- Avoid naming local variables `state` in `.svelte` files — conflicts with `$state` rune
- `bind:this` refs used in `$effect` must be declared with `$state()` — plain `let` refs won't trigger effect re-runs in Svelte 5

## WebSocket Reconnection

- **Event socket** (`/ws/events`): auto-reconnect with fixed 3-second delay
- **PTY socket** (`/ws/:sessionId`): exponential backoff (1s, 2s, 4s, 8s, capped at 10s, max 30 attempts)
- Close code 1000 = PTY exited — no reconnect, shows `[Session ended]`
- Before reconnect, client verifies session still exists via `GET /sessions`
- `[Reconnecting...]` shown once to avoid terminal spam
- All event WebSocket connections must have both `close` and `error` handlers

## Key Patterns

- The new-session dialog is tab-aware: repo mode hides branch input and shows "Continue previous conversation" checkbox; worktree mode shows branch input; PRs tab falls back to repo mode. The `open()` method accepts `OpenSessionOptions` with `tab`, `branchName`, `agent`, and `claudeArgs` for pre-filling (used by the "Customize" context menu action)
- All session/item actions are accessed via a "..." context menu button (ContextMenu component). Menu items vary by state: Active → Rename, Kill; Inactive worktree → Customize, Resume, Resume (YOLO), Delete; Idle repo → Customize, New Worktree
- "Customize" opens NewSessionDialog pre-filled with the item's root, repo, and branch (for worktrees). Idle repo items also support direct click to create a repo session with `continue: true`
- PRs tab uses `PrRepoGroup` components — each repo group independently fetches PRs via `@tanstack/svelte-query` `createQuery` with `Accessor` pattern: `createQuery<T>(() => ({...}))` — the options must be wrapped in a function for Svelte 5 runes reactivity
- Filters (root, repo, search) live below the tab bar
- PR click cascade: active session → inactive worktree → create new worktree + session
- Worktree naming convention: `mobile-<name>-<timestamp>`
- Settings dialog close triggers `refreshAll()` for immediate sidebar update
- Cookie TTL uses human-readable format: `s` (seconds), `m` (minutes), `h` (hours), `d` (days). Default: `24h`
- Root directory scanning: one level deep for git repos, hidden directories excluded

## Mobile Touch & Input

- Custom touch scroll replaces xterm.js built-in (smoother UX); handlers use `addEventListener({ passive: false })` on `document`
- Long-press (500ms) triggers text selection: tmux sessions enter copy-mode (vi bindings, toolbar buttons for navigation); non-tmux sessions use browser-native selection with copy-on-tap
- `MobileInput` uses event-intent architecture: `beforeinput` captures intent, `input` dispatches to typed handlers (insert, delete, replacement, paste). Autocorrect at cursor-0 (iOS Safari bug) is recovered by sending backspaces + corrected text instead of reverting
- `visualViewport` API tracks keyboard state; layout adjusts dynamically (header hidden, terminal re-fit)
- xterm's internal `.xterm-helper-textarea` disabled on mobile to prevent focus fights with `MobileInput`
- Toolbar buttons use `mousedown` + `preventDefault()` to avoid keyboard dismissal
- Event-intent pipeline logic extracted to `server/mobile-input-pipeline.ts` (pure functions, no DOM); tested via JSON fixtures in `test/fixtures/mobile-input/`. When fixing mobile keyboard bugs, add a fixture first (see `docs/QUALITY.md` Mobile Input Testing section)

## See Also

- [Architecture](ARCHITECTURE.md) — full data flow and API routes
- [Design](DESIGN.md) — backend patterns, auth flow, session types
