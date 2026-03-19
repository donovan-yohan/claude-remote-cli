# Workspace Reorder & Sidebar Polish

**Created:** 2026-03-19
**Status:** Draft

## Problem

Workspaces in the sidebar are ordered by insertion time (FIFO) with no way to reorder them. Users with many workspaces can't prioritize the ones they use most. Additionally, the workspace header has three action buttons (`+`, `>_`, `⚙`) that crowd the name, and inactive sessions use blanket `opacity: 0.6` which hurts readability on dark backgrounds.

## Goals

1. **Drag-and-drop workspace reordering** — works on both desktop and mobile
2. **Sidebar header simplification** — remove redundant action buttons, give more space to workspace names
3. **Inactive session contrast** — readable without losing visual hierarchy

## Non-Goals

- Reordering sessions/worktrees within a workspace (keep `lastActivity` sort)
- Auto-sort options (alphabetical, most recent) — may add later
- Reordering via context menu ("Move up"/"Move down")

---

## Design

### 1. Sidebar Header Simplification

**Remove** the `+` (new session) and `>_` (new terminal) action buttons from `WorkspaceItem` workspace headers. **Keep only** the `⚙` (settings) button.

**Rationale:**
- `+ new worktree` row already exists below each workspace's session list
- Repo root entry is always visible and clickable to start a repo session
- Terminal creation is accessible via the new session dialog

**Settings button behavior:**
- Desktop: hover-only (opacity 0 → 1 on `.workspace-header:hover`)
- Mobile: always visible (opacity 1)

This matches the current pattern but with only one button instead of three, freeing horizontal space for workspace names.

### 2. Drag-and-Drop Reordering

#### Library

[`svelte-dnd-action`](https://github.com/isaacHagwortzki/svelte-dnd-action) — Svelte-native, handles mouse + touch, provides FLIP animations, zone-based API that works well with `{#each}` blocks.

#### Desktop Interaction

1. **Drag handle** — A grip icon (`⠿` or 6-dot grip SVG) appears on hover, positioned to the **left of the collapse chevron** in the workspace header
2. **Initiate drag** — mousedown on the grip handle starts the drag. The workspace item gets a `dragging` class with slight elevation (box-shadow) and reduced opacity
3. **Drop indicator** — A horizontal accent-colored line appears between workspaces to indicate drop position
4. **On drop** — The new order is persisted immediately via `PUT /workspaces/reorder`

**Visual states:**
- Default: grip handle hidden (opacity 0)
- Hover on workspace header: grip handle fades in (opacity 1)
- Dragging: workspace item elevated, other items shift with FLIP animation
- Drop target: 2px accent line between items

#### Mobile Interaction

1. **Enter reorder mode** — Long-press (500ms) on any workspace header enters reorder mode
2. **Reorder mode UI changes:**
   - Collapse chevrons on all workspace headers are replaced with grip dots (drag handles)
   - Workspace contents (sessions, worktrees, "new worktree" row) are collapsed/hidden — only workspace headers are shown
   - A floating "Done" button appears anchored to the bottom of the sidebar (above "Add Workspace" / "Settings" buttons)
3. **Drag to reorder** — Touch-drag on any workspace header (the entire header is the drag target, not just the grip icon) to reorder
4. **Exit reorder mode** — Tap "Done" button. Order is persisted via `PUT /workspaces/reorder`. Workspace contents expand back to their previous collapse state.

**Floating "Done" button spec:**
- Position: sticky bottom of sidebar, above existing bottom buttons
- Style: accent border, accent text, full-width within sidebar padding (matches "Add Workspace" button style)
- Label: "Done reordering"

#### Reorder Mode State

Add `reorderMode: boolean` to `ui.svelte.ts`. When true:
- `Sidebar.svelte` renders workspace items in drag-enabled mode
- `WorkspaceItem.svelte` hides session list and shows grip handle instead of chevron
- SmartSearch is hidden (can't search while reordering)
- "Add Workspace" button is hidden (can't add during reorder)

### 3. Backend: Reorder Endpoint

**`PUT /workspaces/reorder`**

```typescript
// Request body
{ paths: string[] }  // Complete ordered list of workspace paths

// Response
200 { workspaces: Workspace[] }  // Reordered list with full metadata
400 { error: string }            // If paths don't match current set
```

**Validation:**
- Request `paths` must contain exactly the same set of paths as current config (no additions/removals)
- Returns 400 if sets differ

**Implementation:** Update `config.workspaces` array order and `saveConfig()`. The existing `GET /workspaces` already returns in config array order, so no other changes needed.

### 4. Inactive Session Contrast

**Current:** `.session-row.inactive { opacity: 0.6; }` — dims everything uniformly.

**Proposed:** Replace blanket opacity with targeted color treatment:

```css
/* Remove */
.session-row.inactive { opacity: 0.6; }
.session-row.inactive:hover { opacity: 1; }

/* Replace with */
.session-row.inactive .session-name {
  color: var(--text-muted);  /* #888 instead of dimmed white */
}

.session-row.inactive .dot-inactive {
  background: #555;  /* Brighter than --border (#333) for visibility */
}

.session-row.inactive:hover .session-name {
  color: var(--text);
}
```

**Result:** Inactive items are visually subordinate (muted color) but text remains legible. The inactive dot is distinguishable from the background. Hover still reveals full brightness.

---

## Component Changes

| Component | Changes |
|-----------|---------|
| `Sidebar.svelte` | Wrap workspace list in `svelte-dnd-action` zone; add reorder mode state; hide SmartSearch/Add in reorder mode; show floating "Done" button |
| `WorkspaceItem.svelte` | Remove `+` and `>_` action buttons; add grip handle (left of chevron); swap chevron for grip in reorder mode; hide session list in reorder mode; update inactive row styles |
| `ui.svelte.ts` | Add `reorderMode` state |
| `sessions.svelte.ts` | Add `reorderWorkspaces(paths: string[])` API call + local state update |
| `server/workspaces.ts` | Add `PUT /workspaces/reorder` route |

## New Dependency

- `svelte-dnd-action` — drag-and-drop for Svelte. Used in `Sidebar.svelte` only.

---

## Edge Cases

1. **Single workspace** — Grip handle still shown on hover (desktop) / reorder mode still enterable (mobile), but no-op since there's nothing to reorder
2. **Drag during loading** — If a session is in loading state (shimmer), the workspace is still draggable — loading is per-session, not per-workspace
3. **Concurrent reorder** — Last write wins. Since this is single-user, not a real concern
4. **Workspace added during reorder mode** — Exit reorder mode first; "Add Workspace" is hidden during reorder
5. **Long workspace names** — With fewer action buttons, names have ~66px more horizontal space before truncation
