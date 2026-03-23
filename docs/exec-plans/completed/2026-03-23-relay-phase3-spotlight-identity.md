# Relay Phase 3: Spotlight Command Palette + Sidebar Header + Product Identity

> **Status**: Active | **Created**: 2026-03-23 | **Last Updated**: 2026-03-23
> **Design Doc**: `docs/design-docs/2026-03-23-relay-phase3-spotlight-identity-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-23 | Plan | 5 tasks, sequential | Small scope, all UI-only changes |

## Progress

- [x] Task 1: Create Spotlight.svelte command palette component
- [x] Task 2: Wire Spotlight into App.svelte (Cmd+P, overlay, data)
- [x] Task 3: Collapse sidebar header + remove SmartSearch
- [x] Task 4: Relay branding (PinGate, MobileHeader, Settings, HTML title)
- [x] Task 5: Build + test verification

## Surprises & Discoveries

_None yet._

## Plan Drift

_None yet._

---

### Task 1: Create Spotlight.svelte command palette component

**Goal:** Create the Spotlight overlay component with search, categorized results, keyboard nav.

**Files to create:**
- `frontend/src/components/Spotlight.svelte`

**Steps:**

1. Create `Spotlight.svelte` with props: `open`, `onClose`, `workspaces`, `sessions`, `prs`, `tickets` (GitHub issues + Jira), `onSelectWorkspace`, `onSelectSession`, `onSelectPr`, `onSelectTicket`, `onCommand`.
2. Implement search across all entity types using the svelte-query cache data passed as props.
3. Categorize results: "Needs Attention" (default, no query), "Workspaces", "Sessions", "Pull Requests", "Tickets", "Commands".
4. Keyboard navigation: arrow up/down, Enter to select, Escape to close. Category headers skip.
5. Focus trap when open. Dark overlay backdrop.
6. Accessibility: role="dialog", aria-modal, combobox pattern.
7. Max 5 results per category. Debounce input 150ms.

---

### Task 2: Wire Spotlight into App.svelte

**Goal:** Add Cmd+P keyboard shortcut, render Spotlight overlay, pass data from state/queries.

**Files to modify:**
- `frontend/src/App.svelte`

**Steps:**

1. Import Spotlight component.
2. Add `spotlightOpen` state. Add Cmd+P / Ctrl+P handler in existing keydown listener.
3. Render `<Spotlight>` after the main-app div (as overlay).
4. Pass workspaces, sessions, org PRs (from query), ticket data, and action handlers.
5. Wire commands: "New worktree", "New agent session", "Settings" → existing handlers.

---

### Task 3: Collapse sidebar header + remove SmartSearch

**Goal:** Reduce sidebar header to single line with "Relay" branding. Remove Home button and SmartSearch.

**Files to modify:**
- `frontend/src/components/Sidebar.svelte`

**Files to delete:**
- `frontend/src/components/SmartSearch.svelte`

**Steps:**

1. Remove SmartSearch import and usage.
2. Remove Home button div.
3. Change sidebar header: replace "Workspaces" label with "Relay". Click on "Relay" navigates to Home (same as old Home button).
4. Clean up `handleSmartSearchSelect` function.
5. Delete `SmartSearch.svelte`.

---

### Task 4: Relay branding across UI

**Goal:** Update all "Claude Remote CLI" / "claude-remote-cli" references in the UI to "Relay".

**Files to modify:**
- `frontend/src/components/PinGate.svelte` — h1 text
- `frontend/src/components/MobileHeader.svelte` — no change needed (uses dynamic title)
- `frontend/src/components/dialogs/SettingsDialog.svelte` — dialog title
- `frontend/index.html` — `<title>` tag
- `frontend/src/App.svelte` — sessionTitle fallback

**Steps:**

1. PinGate: Change `<h1>Claude Remote CLI</h1>` → `<h1>Relay</h1>`.
2. index.html: Change `<title>Claude Remote CLI</title>` → `<title>Relay</title>`.
3. App.svelte: Change `sessionTitle` fallback from `'Claude Remote CLI'` → `'Relay'`.
4. SettingsDialog: Change `<h2>Settings</h2>` → `<h2>Relay Settings</h2>` (keep "Settings" in title but add brand).

---

### Task 5: Build + test verification

**Goal:** Ensure everything compiles and tests pass.

**Steps:**

1. `npm run build` — must succeed
2. `npm test` — must pass

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._
