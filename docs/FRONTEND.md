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
| `App.svelte` | Root layout: sidebar + main area (dashboard / PR top bar + tabs + terminal) |
| `Sidebar.svelte` | Flat workspace list with smart search, no tabs |
| `WorkspaceItem.svelte` | Workspace tree item: letter icon, sessions, inactive worktrees, context menus |
| `SmartSearch.svelte` | Terminal-style typeahead search with `>` prompt |
| `PrTopBar.svelte` | Dynamic PR/CI bar with branch switcher, diff stats, merge conflict detection, dual action buttons (resolve+review), archive flow |
| `SessionTabBar.svelte` | Multi-tab session management per worktree (role=tablist) |
| `RepoDashboard.svelte` | Workspace dashboard: PRs with merge status, activity feed, CTAs |
| `BranchSwitcher.svelte` | Branch dropdown with filter for PR top bar |
| `FileBrowser.svelte` | Lazy-loading tree-view filesystem browser with multi-select, filter, keyboard nav |
| `EmptyState.svelte` | Reusable empty state with icon, heading, description, CTA |
| `Terminal.svelte` | xterm.js terminal wrapper with WebSocket connection |
| `Toolbar.svelte` | Mobile touch toolbar for terminal interaction |
| `MobileHeader.svelte` | Mobile header with session info |
| `ContextMenu.svelte` | Universal "..." dropdown menu for session/item actions |
| `PinGate.svelte` | PIN authentication screen |
| `ImageToast.svelte` | Clipboard image paste feedback |
| `UpdateToast.svelte` | Version update notification |
| `AgentBadge.svelte` | Agent type indicator badge (Claude/Codex) |
| `SearchableSelect.svelte` | Searchable dropdown filter replacing native selects |
| `SessionItem.svelte` | Session list item with status dot, context menu, metadata row |
| `MobileInput.svelte` | Event-intent mobile keyboard input handler |
| `OrgDashboard.svelte` | Cross-repo PR list and tickets panel with tab navigation |
| `TicketsPanel.svelte` | Multi-provider ticket list: GitHub Issues, Jira, Linear tabs with skeleton loading and branch link indicators |
| `TicketCard.svelte` | Individual ticket row: status dot, provider-native metadata (labels/sprint/cycle/priority), branch link, Start Work button |
| `StartWorkModal.svelte` | Start Work modal: ticket info, workspace selector (for Jira/Linear), branch name input, creates worktree session with ticket context |
| `StatusMappingModal.svelte` | Map workflow transition states (in-progress, code-review, ready-for-qa) to Jira/Linear status IDs |
| `dialogs/` | Session customization, settings, workspace, and worktree deletion dialogs |

## State Management

State lives in `.svelte.ts` modules under `frontend/src/lib/state/` exporting reactive state and mutation functions. Components import state — they do not own it. PR data is managed via `@tanstack/svelte-query` v6 (cache + manual refresh), not in state modules.

| Module | Role |
|--------|------|
| `sessions.svelte.ts` | Session list, worktrees, repos, attention flags, notification preferences, git statuses, loading state |
| `config.svelte.ts` | Global session defaults (continue, yolo, tmux, agent, notifications); shared by SettingsDialog, SessionList, NewSessionDialog |
| `auth.svelte.ts` | Authentication state (PIN check, cookie token) |
| `ui.svelte.ts` | UI state (active tab, sidebar, filters) |
| `sessions.svelte.ts` (agentState) | `agentState` per session (`processing` \| `idle` \| `waiting-for-input` \| `permission-prompt`) updated from `session-idle-changed` events; drives sidebar dot color and attention logic |

## Conventions

- Scoped `<style>` blocks in each component; global CSS variables in `frontend/src/app.css`
- Sidebar status dots: green (processing), blue (idle), amber glow (waiting-for-input/attention), yellow pulse (permission-prompt), gray (inactive/initializing)
- Attention state: tracked in `attentionSessions` reactive state; set when session becomes idle while not viewed; cleared when user opens session
- Loading state: tracked in `loadingItems` reactive state; `setLoading`/`clearLoading` wrap async actions (start, kill, delete); WorkspaceItem shows CSS shimmer overlay with `pointer-events: none`
- Hover effects: fade mask on overflow text, scroll reveal animation
- Avoid naming local variables `state` in `.svelte` files — conflicts with `$state` rune
- `bind:this` refs used in `$effect` must be declared with `$state()` — plain `let` refs won't trigger effect re-runs in Svelte 5

## WebSocket Reconnection

- **Event socket** (`/ws/events`): auto-reconnect with fixed 3-second delay
- **PTY socket** (`/ws/:sessionId`): exponential backoff (1s, 2s, 4s, 8s, capped at 10s, max 30 attempts)
- **SDK socket** (`/ws/:sessionId`): separate reconnect counter from PTY; exponential backoff
- Close code 1000 = session ended — no reconnect
- Before PTY reconnect, client verifies session still exists via `GET /sessions`
- `[Reconnecting...]` shown once to avoid terminal spam
- All event WebSocket connections must have both `close` and `error` handlers
- SDK reconnect replays stored events from server on reconnection

## Key Patterns

- **Tab bar "+" dropdown** has three options: "New Agent" (instant create with workspace defaults), "New Terminal" (instant create via `createTerminalSession()`), "Customize..." (opens `CustomizeSessionDialog` with agent options only — no repo/worktree tabs). `Cmd/Ctrl+T` triggers instant agent creation. New tabs auto-name as "Agent 1", "Terminal 1" etc. and append rightmost
- All session/item actions are accessed via a "..." context menu button (ContextMenu component). Menu items vary by state: Active → Rename, Kill; Inactive worktree → Customize, Resume, Resume (YOLO), Delete; Idle repo → Customize, New Worktree
- "Customize" opens NewSessionDialog pre-filled with the item's root, repo, and branch (for worktrees). Idle repo items also support direct click to create a repo session with `continue: true` via `POST /sessions/repo`
- **Session creation API split**: `createSession()` → `POST /sessions` (creates worktrees); `createRepoSession()` → `POST /sessions/repo` (repo root, no worktree). Use the correct one based on context — calling `createSession` without `worktreePath` creates an unwanted worktree
- Repo root items always display "default" as their name (unless the user has explicitly renamed the active session). Both active and idle repo entries in `WorkspaceItem.svelte` enforce this
- Session item secondary row order: timestamp → branch name → PR number → context menu (right-aligned via `.context-menu-spacer`). This applies to active sessions and inactive worktrees. Idle-repo entries show only the default branch name (no timestamp or PR). Diff stats appear in the primary row
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
