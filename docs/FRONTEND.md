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
| `SessionList.svelte` | Filtered session/PR list with status grouping and svelte-query PR fetching |
| `SessionItem.svelte` | 3-row session card: status dot + name, git metadata, time + diff stats |
| `SessionFilters.svelte` | Filter controls (root, repo, search) + Author/Reviewer toggle for PRs tab |
| `PullRequestItem.svelte` | 3-row PR card: state icon + title, author + role badge, time + diff stats |
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

State lives in `.svelte.ts` modules under `frontend/src/lib/state/` exporting reactive state and mutation functions. Components import state — they do not own it. PR data is managed via `@tanstack/svelte-query` v6 (cache + manual refresh), not in state modules.

## Conventions

- Scoped `<style>` blocks in each component; global CSS variables in `frontend/src/app.css`
- Sidebar status dots: green (running), blue (idle), amber glow (needs attention), gray (inactive)
- Attention state: tracked in `attentionSessions` reactive state; set when session becomes idle while not viewed; cleared when user opens session
- Hover effects: fade mask on overflow text, scroll reveal animation, action button opacity reveal
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

- The new-session dialog is tab-aware: repo mode hides branch input and shows "Continue previous conversation" checkbox; worktree mode shows branch input; PRs tab falls back to repo mode. The `open()` method accepts an optional `tab` option to force a specific tab (e.g., `{ tab: 'worktrees' }`)
- Idle repo items skip the dialog: clicking the card body creates a repo session directly with `continue: true`; the YOLO pill creates a repo session with `continue: true` + `--dangerously-skip-permissions`; the `+ worktree` pill opens the new session dialog defaulted to the worktrees tab
- Inactive worktree YOLO buttons also skip the dialog, creating a worktree session directly with `--dangerously-skip-permissions`
- PRs tab uses `@tanstack/svelte-query` `createQuery` with `Accessor` pattern: `createQuery<T>(() => ({...}))` — the options must be wrapped in a function for Svelte 5 runes reactivity
- Filters (root, repo, search) live below the tab bar; repo dropdown pulses with accent border when PRs tab is active and no repo is selected
- PR click cascade: active session → inactive worktree → create new worktree + session
- Worktree naming convention: `mobile-<name>-<timestamp>`
- Settings dialog close triggers `refreshAll()` for immediate sidebar update
- Cookie TTL uses human-readable format: `s` (seconds), `m` (minutes), `h` (hours), `d` (days). Default: `24h`
- Root directory scanning: one level deep for git repos, hidden directories excluded

## Mobile Touch & Scroll

- xterm.js built-in touch scroll is disabled on mobile (`.xterm-viewport` gets `touch-action: none` + `overflow-y: hidden`) — it produces jerky one-line-at-a-time scrolling
- Custom content-area touch scroll: `onTerminalTouchStart` → `onDocumentTouchMove` → `onDocumentTouchEnd` with pixel-based scroll-to-line conversion
- Touch handlers registered via `addEventListener({ passive: false })` on `document` — Svelte 5's `ontouchmove` is passive by default, silently ignoring `preventDefault()`
- `touchcancel` wired to the same handler as `touchend` to prevent stuck scroll state
- `overscroll-behavior: none` on `html, body` prevents pull-to-refresh
- Mobile font size: 12px (vs 14px desktop) for more terminal content visibility
- Scroll FABs: page-up/page-down floating buttons shown when `isMobileDevice && thumbVisible`, using `term.scrollPages()`
- ResizeObserver debounced 150ms on mobile (0ms desktop) to avoid xterm re-render flash during keyboard animation
- Long-press text selection: 500ms hold triggers selection mode (haptic vibrate, `user-select: text` on `.xterm-screen`, accent outline indicator). Next tap exits selection mode and clears browser selection
- All touch handlers guard against null `e.touches[0]` and missing DOM elements

## Mobile Keyboard Handling

- `visualViewport` API tracks keyboard open/close: when `window.innerHeight - vv.height > 50`, keyboard is considered open
- When keyboard is open: `.main-app` height is set to `visualViewport.height`, `MobileHeader` is hidden, terminal is re-fit via `fitTerm()`
- `window.scrollTo(0, 0)` prevents iOS viewport scroll when keyboard opens
- On mobile, `.main-app` uses `position: fixed; inset: 0` to prevent page-level scrolling
- Tapping the terminal area focuses the hidden `MobileInput` via a `touchend` handler on `terminal-wrapper`
- Toolbar buttons use `mousedown` with `preventDefault()` to prevent keyboard dismissal, then `onRefocusMobileInput()` to retain focus
- `MobileInput` is a hidden `<form>` + `<input>` (on-screen via `clip-path: inset(50%)` for Gboard cursor tracking) that uses an event-intent pipeline to translate `InputEvent` types directly to terminal commands
- Event-intent architecture: `beforeinput` captures intent (`inputType`, `data`, `getTargetRanges()`), `input` dispatches to typed handlers (insert, delete, replacement, paste, fallback). Buffer trimmed to last word when >20 chars. Debug panel logs all events with gap-finder signals (`FALLBACK_DIFF`, `WARN`)
- xterm's internal `.xterm-helper-textarea` is disabled on mobile (`disabled` + `tabIndex=-1`) to prevent focus fights with `MobileInput`
- `t.onData()` is only wired on desktop; on mobile, `MobileInput` sends directly via `sendPtyData()` to avoid double-sending

## See Also

- [Architecture](ARCHITECTURE.md) — full data flow and API routes
- [Design](DESIGN.md) — backend patterns, auth flow, session types
