# Relay Phase 3: Spotlight Command Palette + Sidebar Header + Product Identity

> **Status**: Planned
> **Phase**: 3 of 3 (Relay product evolution)
> **Parent design**: `~/.gstack/projects/donovan-yohan-claude-remote-cli/ceo-plans/2026-03-23-relay-product-evolution.md`
> **Depends on**: Phase 2 (GitHub API — for rich search data)
> **Reviews**: Design review (8/10), CEO review (CLEAR), Eng review (CLEAR)

## Goal

Replace the sidebar search with a spotlight command palette (Cmd+P / Ctrl+P), collapse the sidebar header to a single line, and establish the "Relay" product identity throughout the UI.

## Problem

Current sidebar has 3 lines of chrome before the first workspace:
1. `« WORKSPACES` (title + collapse button)
2. `Home` (navigation item)
3. `> search workspaces...` (search bar)

The search only finds workspaces by name. There's no way to quickly jump to a PR, ticket, or trigger an action without clicking through menus. The product is called "claude-remote-cli" despite supporting multiple agents (Claude, Codex).

## Approach

### Spotlight Command Palette

Triggered by `Cmd+P` (macOS) / `Ctrl+P` (Windows/Linux). Replaces sidebar search entirely.

**Overlay design:**
```
┌────────────────────────────────────────┐
│  > search workspaces, PRs, commands... │
├────────────────────────────────────────┤
│  NEEDS ATTENTION (3)                   │
│  ● #9156 feat: ISSUER_CYCLED (ext-api) │
│  ● #9144 review requested (ext-api)    │
│  ● #9038 add Veryfi OCR (ext-api)      │
│  WORKSPACES                            │
│  ■ claude-remote-cli                   │
│  ■ belayer                             │
│  ■ extend-api                          │
│  PULL REQUESTS                         │
│  ● #9156 feat: ISSUER_CYCLED...        │
│  ● #9154 feat: add OpenAPI spec...     │
│  COMMANDS                              │
│  + New worktree                        │
│  + New agent session                   │
│  ⚙ Settings                            │
└────────────────────────────────────────┘
```

**Searchable entities** (all from svelte-query cache, no new API calls):
- Workspaces (name match)
- Active sessions (name, branch match)
- Pull requests (title, number, branch match)
- Tickets (title, key match — both GitHub Issues and Jira)
- Commands: "New worktree", "New agent session", "Settings"

**Result behavior:**
| Entity | Action on Enter |
|--------|----------------|
| Workspace | Navigate to workspace (same as sidebar click) |
| Session | Switch to session tab |
| Pull request | Navigate to workspace + PR branch |
| Ticket | Open "Start Work" modal |
| Command | Execute the command |

**Default state (no query):**
Show "Needs Attention" section at top (PRs with changes-requested + awaiting your review), then recent workspaces. This makes spotlight useful even without typing — it's a quick "what needs attention?" glance.

**Keyboard interaction:**
- Arrow up/down moves focus between results
- Enter selects focused result
- Escape closes spotlight
- Typing filters results (debounced 150ms)
- Category headers are not focusable (skip in arrow nav)

**Result limits:** Max 5 results per category (prevents overwhelming). Total max ~25 items visible.

**Empty state:** "No results for '{query}'" — no CTA needed, just type differently.

**Cold cache:** If svelte-query cache is empty (e.g., fresh page load before first fetch), show a loading indicator in each category until data arrives. Spotlight is usable immediately — cached categories show results, pending categories show skeleton rows.

**Styling:** Dark overlay with `var(--surface)` background, `var(--border)` borders. Search input with `>` prompt prefix (matching SmartSearch terminal aesthetic). Monospace text throughout.

### Sidebar Header Collapse

Before (3 lines of chrome):
```
│ «  WORKSPACES           │
│ ⌂ Home                  │
│ > search workspaces...  │
```

After (1 line of chrome):
```
│ «  Relay                │
```

- `«` collapses the sidebar (existing behavior)
- "Relay" is the app name, clicking it navigates to Home (replaces the Home navigation item)
- Search is replaced by spotlight (Cmd+P)
- Sidebar immediately shows workspace list after the single header line

### Product Identity: Relay

UI touchpoints to update:
- Sidebar header: "Relay" (replaces "WORKSPACES")
- Browser tab title: "Relay" (replaces "claude-remote-cli")
- PinGate screen: "Relay" branding
- Settings dialog header
- Spotlight overlay placeholder text
- Mobile header

**NOT in this PR's scope:**
- npm package rename (`claude-remote-cli` → `relay-cli`) — separate effort, see TODOS.md
- CLI binary rename
- Config directory rename
- GitHub repo rename

The identity change is UI-only in this PR. The internal package name, CLI command, and config paths remain unchanged to avoid breaking changes.

### SmartSearch Removal

`SmartSearch.svelte` is deleted. Its functionality is fully replaced by spotlight:
- Workspace name search → spotlight "Workspaces" category
- Keyboard navigation → spotlight arrow nav
- `>` prompt aesthetic → spotlight search input

The `SearchableSelect.svelte` component is **not** removed — it's used in dialogs and filter dropdowns, not for workspace search.

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/Spotlight.svelte` | Command palette overlay component |

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/App.svelte` | Add Cmd+P listener, render Spotlight overlay, remove SmartSearch import |
| `frontend/src/components/Sidebar.svelte` | Collapse header to single line, remove search bar, update branding |
| `frontend/src/components/PinGate.svelte` | Update branding to "Relay" |
| `frontend/src/components/MobileHeader.svelte` | Update branding to "Relay" |
| `frontend/src/components/dialogs/SettingsDialog.svelte` | Update header branding |
| `frontend/src/app.css` | Update any hardcoded title references |

## Files to Delete

| File | Reason |
|------|--------|
| `frontend/src/components/SmartSearch.svelte` | Replaced by Spotlight |

## Tests

- Spotlight: Cmd+P opens overlay, Escape closes
- Spotlight search: workspace matches, PR matches, ticket matches, command matches
- Spotlight keyboard nav: arrow up/down, Enter to select, category skip
- Spotlight cold cache: loading indicators for unfetched categories
- Sidebar header: click "Relay" navigates to Home
- SmartSearch removal: no regressions in sidebar behavior

## Accessibility

- Spotlight overlay: `role="dialog"`, `aria-modal="true"`, `aria-label="Command palette"`
- Search input: `role="combobox"`, `aria-expanded`, `aria-controls`
- Result list: `role="listbox"`, each result `role="option"`
- Category headers: `role="presentation"` (not focusable)
- Focus trap within spotlight when open
- `Cmd+P` / `Ctrl+P` announced via `aria-keyshortcuts`
