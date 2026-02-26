# Session Item Loading Shimmer

**Created:** 2026-02-26

## Problem

When a user clicks to start a session, kill a session, or delete a worktree, there is no visual feedback on the session list item. The card lingers in its previous state until the async operation completes and `refreshAll()` updates the list. This creates a "did it work?" moment.

## Design

### Approach

CSS pseudo-element overlay shimmer on SessionItem. A horizontal light band sweeps left-to-right across the card on a 1.5s loop. Card content remains visible (not skeleton-replaced) so the user retains context about which item is loading. Interaction is disabled on loading cards.

### State Layer (`sessions.svelte.ts`)

A `loadingItems` reactive set keyed by item identifier (session ID, worktree path, or repo path). Three exported functions:

- `setLoading(key: string)` — adds key to set
- `clearLoading(key: string)` — removes key from set
- `isLoading(key: string)` — returns boolean

Exposed via `getSessionState()` as `get loadingItems()`, following the `attentionSessions` pattern.

### Consumers

**SessionList.svelte** — wraps async handlers (`handleStartRepoSession`, `handleStartWorktreeSession`, `handleKillSession`, `handlePRClick`) with `setLoading(key)` before `await`, `clearLoading(key)` in `finally`. Passes `isLoading` prop to SessionItem.

**DeleteWorktreeDialog.svelte** — calls `setLoading(worktree.path)` in `handleConfirm`, `clearLoading` in `finally`.

### SessionItem Changes

**New prop:** `isLoading: boolean` (default `false`).

**Behavior when loading:**
- `li` gets a `loading` CSS class
- `pointer-events: none` — disables clicks and hover effects
- `opacity: 0.7` — visually mutes the card

**Shimmer animation:** `::after` pseudo-element on `li.loading`:
- `position: absolute; inset: 0; border-radius: inherit`
- `background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)`
- `background-size: 200% 100%`
- `animation: shimmer 1.5s ease-in-out infinite`
- `pointer-events: none`

```css
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### Loading Key Map

| Action | Loading key |
|--------|------------|
| Start repo session | `repo.path` |
| Start worktree session | `wt.path` |
| Kill session | `session.id` |
| PR click (existing worktree) | `worktree.path` |
| PR click (new worktree) | `repo.path + ':' + pr.headRefName` |
| Delete worktree | `wt.path` |

## Decisions

- **Overlay, not skeleton:** User already knows what they clicked — retain context.
- **All async actions covered:** Starting, killing, and deleting all trigger shimmer.
- **Interaction disabled during loading:** Prevents double-submits and conflicting actions.
- **State in module, not component:** Allows both SessionList and DeleteWorktreeDialog to participate.
- **Pure CSS animation:** No JS overhead, no extra DOM elements, no new components.
