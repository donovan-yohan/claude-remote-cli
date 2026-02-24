# Svelte Migration & Menu UI Redesign

> **Status**: Approved | **Date**: 2026-02-23

## Goal

Migrate the frontend from vanilla JS to Svelte 5 (runes) with Vite, and redesign the session list items with git status indicators, hover-reveal actions, and smooth text overflow.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Svelte 5 with runes syntax | Compiles away, tiny runtime, natural reactivity for WebSocket-driven state |
| Meta-framework | Standalone Svelte + Vite (not SvelteKit) | Single-page app, SvelteKit would conflict with existing Express server |
| Migration strategy | Full rewrite | App is ~1700 lines, incremental would mean maintaining two paradigms |
| Build output | `dist/frontend/` | Clean separation, aligns with existing `dist/server/` and `dist/bin/` |
| Git status data | `gh` CLI on the server | Server is the dev machine with full git/gh auth |
| xterm.js | npm dependency, not vendored | Proper imports, tree-shakeable, version-managed |

## Architecture

### Project Structure

```
frontend/
  src/
    App.svelte
    lib/
      state/
        sessions.svelte.ts   # $state for sessions, worktrees, repos, git status
        auth.svelte.ts        # $state for PIN auth
        ui.svelte.ts          # $state for sidebar, tabs, filters
      api.ts                  # fetch wrappers
      ws.ts                   # WebSocket connection manager
      types.ts                # Shared frontend types
    components/
      PinGate.svelte
      Sidebar.svelte
      SessionList.svelte
      SessionItem.svelte      # Active + inactive variants via props
      SessionFilters.svelte
      Terminal.svelte          # xterm.js mount
      Toolbar.svelte
      MobileHeader.svelte
      ContextMenu.svelte
      UpdateToast.svelte
      dialogs/
        NewSessionDialog.svelte
        SettingsDialog.svelte
        DeleteWorktreeDialog.svelte
  index.html
  vite.config.ts
  svelte.config.js
```

### State Architecture (Svelte 5 Runes)

State modules are `.svelte.ts` files exporting reactive state and mutation functions.

```ts
// sessions.svelte.ts
let sessions = $state<SessionSummary[]>([]);
let worktrees = $state<WorktreeInfo[]>([]);
let repos = $state<RepoInfo[]>([]);
let activeSessionId = $state<string | null>(null);
let attentionSessions = $state<Record<string, boolean>>({});
let gitStatuses = $state<Record<string, GitStatus>>({});

let activeSession = $derived(sessions.find(s => s.id === activeSessionId));
```

### Build Pipeline

- `npm run build` → `tsc && vite build` (backend + frontend)
- `npm run dev` → Vite dev server with proxy to Express
- `npm start` → full build then start Express
- Express serves `dist/frontend/` as static files
- `package.json` `files`: `["dist/"]`

## Session Item UI Design

### 3-Row Layout

```
┌─────────────────────────────────────────┐
│ ●  feat/better-menu-ui            ✎  ×  │  row 1: status dot + name + hover actions
│ ⑂  personal · claude-remote-cli         │  row 2: git icon + root · repo
│    4m · +271 -142                       │  row 3: time · diff stats
└─────────────────────────────────────────┘
```

- **Row 1**: Status dot (green/blue/amber/gray) + session name. Action buttons (rename, kill/delete) appear on hover only (`opacity: 0` → `1` on `li:hover`).
- **Row 2**: Git status icon (PR open / merged / branch-only) sits under the status dot in a fixed ~16px left column. Root short name and repo name follow.
- **Row 3**: Relative timestamp. If git diff data available, append `· +{additions} -{deletions}` in green/red.

### Text Overflow

- CSS `mask-image` gradient fade on the right edge (no ellipsis)
- On hover, text slides left via `transform: translateX()` to reveal full content
- Fade mask removed on hover

### Git Status Icons

- **Open PR**: pull request icon (purple)
- **Merged PR**: merged icon (purple/filled)
- **No PR / local only**: branch icon (gray)
- All ~14px, left-aligned under the status dot

### Bug Fix: Name Wrapping

Remove `flex-wrap: wrap` from `.session-info`. Use a proper grid/flex layout where the name truncates instead of wrapping below the status dot.

## New Server Endpoint

```
GET /git-status?repo=<path>&branch=<name>
```

Runs `gh pr view <branch> --json state,additions,deletions` and/or `git diff --stat <base>..<branch>`.

Response:
```json
{
  "prState": "open" | "merged" | "closed" | null,
  "additions": 271,
  "deletions": 142
}
```

Frontend fetches lazily per-worktree, caches in `gitStatuses` state, refreshes on worktree list changes (debounced).

## What Gets Deleted

- `public/app.js` — replaced by Svelte components
- `public/style.css` — replaced by scoped Svelte styles + small global CSS
- `public/vendor/` — xterm.js becomes npm dependency
- `public/index.html` — replaced by `frontend/index.html`

## What Gets Preserved

- `public/sw.js`, `public/manifest.json`, icons → moved to `frontend/public/`
- All server modules unchanged (except `index.ts` static path + new endpoint)
- `bin/`, `test/` unchanged
