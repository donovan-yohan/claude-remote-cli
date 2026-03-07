# PRD: UX Streamlining & Mobile Improvements

## Objective
Audit and streamline the claude-remote-cli frontend UX by replacing hover-dependent action patterns with a universal context menu, adding a "Customize" flow for re-launching sessions with different settings, introducing arbitrary terminal sessions for non-agent tasks, and improving filter dropdowns with inline search. These changes prioritize mobile usability while keeping the desktop experience clean.

## Goals

| # | Goal | Status | Attempts | Design Doc | Plan |
|---|------|--------|----------|------------|------|
| 1 | Context menu refactor | complete | 1 | [design](../design-docs/2026-03-06-context-menu-refactor-design.md) | [plan](../exec-plans/completed/2026-03-06-context-menu-refactor-plan.md) |
| 2 | Customize session flow | complete | 1 | [design](../design-docs/2026-03-06-customize-session-flow-design.md) | [plan](../exec-plans/completed/2026-03-06-customize-session-flow-plan.md) |
| 3 | Arbitrary terminal sessions | pending | 0 | - | - |
| 4 | Searchable filter dropdowns | pending | 0 | - | - |

## Acceptance Criteria

| Goal | Criteria |
|------|----------|
| 1 | Every SessionItem (active, inactive worktree, idle repo) and PullRequestItem has a visible "..." button that opens a dropdown menu with the correct action set per state. All hover/longpress action pill patterns are fully removed. Menu closes on outside click or Escape. Works identically on desktop and mobile. Menu items: Active → Rename, Kill; Inactive worktree → Customize, Resume, Resume (YOLO), Delete; Idle repo → Customize (new session), New Worktree. Existing tests pass. |
| 2 | Inactive worktrees and idle repos show a "Customize" option in the context menu. Clicking it opens NewSessionDialog pre-filled with the item's root, repo, agent, branch, and extra args. User can modify any field and submit to create a new session. Active sessions do NOT show "Customize". |
| 3 | New "Terminals" tab in sidebar between PRs and existing tabs. "+" button creates a bare shell session starting at `~` (user's home directory). Terminal sessions are not tied to any coding agent — they spawn a plain shell (user's default shell). No tracking of inactive terminals; they exist while open and disappear when closed. Backend supports a new `'terminal'` session type that spawns `$SHELL` without agent wrappers. |
| 4 | Root and repo filter dropdowns are replaced with searchable dropdown components using a text input + filtered option list pattern, matching the existing branch autocomplete UX in NewSessionDialog. Typing filters options in real-time. Clicking an option selects it and closes the dropdown. Clearing the input resets the filter. |

## Context & Decisions
- **Tech stack**: Svelte 5 (runes), TypeScript + ESM backend, node-pty
- **Menu items per state**: Active → Rename, Kill. Inactive worktree → Customize, Resume, Resume (YOLO), Delete. Idle repo → Customize, New Worktree
- **Customize is for inactive items only** — user must kill an active session before customizing
- **Terminal sessions**: Start at `~`, no agent, no continue/resume, no worktree metadata persistence. New session type `'terminal'` on backend
- **Replace hover entirely** — "..." menu is the sole action access method on all platforms, removing all hover/longpress action reveal patterns
- **Searchable dropdowns**: Reuse the branch autocomplete pattern from NewSessionDialog for root/repo filters in SessionFilters
- **No new dependencies** — all changes use existing libraries (Svelte 5, xterm.js, node-pty)
- **ADR compliance** — update ADRs if adding new server modules; follow existing module boundaries

## Reflections & Lessons

### Goal 1: Context Menu Refactor
- The old `ContextMenu.svelte` was barely used (only for worktree right-click). Rewriting it as a generic dropdown with `MenuItem[]` prop was clean and reusable.
- Removing `createLongpressClick` and `mobileReveal` from `actions.ts` significantly simplified the codebase. The two-tap mobile reveal pattern was complex and the always-visible "..." button is a better UX.
- The `scrollOnHover` action stays intact but no longer listens for custom `longpressstart`/`longpressend` events — text scroll is now purely a hover enhancement.
- Svelte's type-checked `onkeydown` handler requires `Event` (not `MouseEvent`) when shared with `onclick`. Using `Event` as the parameter type avoids the type error.
- "Customize" menu items were added in Goal 1 (calling `onOpenNewSession`) so the menu structure matches the acceptance criteria. Goal 2 will make the pre-fill behavior work.

### Goal 2: Customize Session Flow
- Minimal change: defined `OpenSessionOptions` in `types.ts` and extended `open()` to accept pre-fill overrides. Only 5 files touched, no backend changes.
- `WorktreeInfo` and `RepoInfo` don't carry agent/args history, so those fields default to server config. Branch is pre-filled for worktrees from `wt.branchName`.
- Threading callback options through Sidebar/App was clean — just added optional second parameter to the existing `onOpenNewSession` callback chain.
- Goal 1 had already wired the "Customize" menu items, so Goal 2 was purely about making `open()` accept and apply pre-fill data.
