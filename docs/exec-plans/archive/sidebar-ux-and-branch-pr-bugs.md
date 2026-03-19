# Plan: Sidebar UX & Branch/PR Handling — 7 Issues

> **Status**: Complete | **Created**: 2026-03-19
> **Source**: `docs/bug-analyses/2026-03-19-sidebar-ux-and-branch-pr-bugs-bug-analysis.md`
> **Branch**: `manaslu`

## Progress

- [x] Task 1: Fix context menu opacity/readability
- [x] Task 2: Triple dots — hover overlay on web, long-press on mobile
- [x] Task 3: Fix branch listener to gate on agentState + strip ANSI
- [x] Task 4: Fix PR handling — remove OPEN-only filter, return full state
- [x] Task 5: Remove grip handle dots from workspace headers
- [x] Task 6: Collapse Add Workspace + Settings into one row
- [x] Task 7: Show branch name for active repo sessions + last activity for inactive

---

### Task 1: Fix context menu opacity/readability

**Files:** `frontend/src/components/WorkspaceItem.svelte`

**Problem:** `.session-row-secondary` has `opacity: 0.7` which reduces readability of the context menu trigger and other secondary text.

**Fix:** Replace the blanket `opacity: 0.7` on `.session-row-secondary` with individual opacity/color treatment on the child elements that need dimming (`.secondary-time`, `.secondary-branch`). The ContextMenu trigger and PR badge should remain fully opaque. The context menu popup itself is `position: fixed` at z-index 1000 so it doesn't inherit row opacity, but the trigger button does since it's inline.

**Changes:**
1. In `WorkspaceItem.svelte` style: remove `opacity: 0.7` from `.session-row-secondary`
2. The secondary text elements already use `color: var(--text-muted)` and `.secondary-time` already has `opacity: 0.7` — that's sufficient dimming. The row-level opacity is redundant/harmful.

---

### Task 2: Triple dots — hover overlay on web, long-press on mobile

**Files:** `frontend/src/components/WorkspaceItem.svelte`, `frontend/src/components/ContextMenu.svelte`

**Problem:** Triple-dots trigger is inline in the secondary row, inflating row height inconsistently.

**Fix:**
1. In `WorkspaceItem.svelte`: Remove the `<ContextMenu>` and `.context-menu-spacer` from inside `.session-row-secondary` for both active and inactive rows. Instead, place the `<ContextMenu>` as a direct child of the `<li class="session-row">` with `position: absolute; right: 8px; top: 50%; transform: translateY(-50%)`.
2. Add `.session-row { position: relative; }` (already has it implicitly via flex column).
3. On web: hide the trigger by default, show on `.session-row:hover .context-menu-trigger { opacity: 1; }`.
4. On mobile: Add `ontouchstart`/`ontouchend`/`ontouchmove` long-press (500ms) handlers on each `<li class="session-row">` that opens the context menu. Hide the trigger button entirely on mobile.
5. `ContextMenu.svelte`: Add an `openMenu()` export function so the parent can programmatically open it. Add prop `hideButton?: boolean` for mobile mode.

**ContextMenu changes:**
- Add `export function openMenu()` that sets `open = true` and positions the menu relative to a passed element or uses fallback center positioning
- Add `hideTrigger` prop — when true, don't render the trigger button (mobile uses long-press instead)
- Add `anchorEl` prop — optional element to position relative to (used when opened programmatically)

**WorkspaceItem changes for each session row (active + inactive):**
- Move `<ContextMenu>` outside `.session-row-secondary`, as a sibling positioned absolutely over the row
- Add long-press handler for mobile: `ontouchstart`, `ontouchend`, `ontouchmove` with 500ms timer
- On desktop: the trigger is `opacity: 0` by default, `opacity: 1` on `.session-row:hover`
- Add a subtle semi-transparent background gradient on the right side of the overlay to ensure the dots are readable over any content

---

### Task 3: Fix branch listener — gate on agentState + strip ANSI

**Files:** `server/ws.ts`

**Problem:** The `needsBranchRename` buffer captures all WebSocket messages from connection start, including terminal escape sequences sent before Claude is ready.

**Fix:**
1. In the `ws.on('message', ...)` handler, add a guard before the `needsBranchRename` block: only begin buffering when `ptySession.agentState === 'waiting-for-input'`. Until then, pass through to PTY normally.
2. In `spawnBranchRename()`, strip ANSI escape sequences from `firstMessage` before inserting into the prompt. Use a simple regex: `firstMessage.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x1f]/g, '').trim()`
3. Wire up `ptySession.branchRenamePrompt` — if set, use it instead of the hardcoded prompt string.

---

### Task 4: Fix PR handling — remove OPEN-only filter

**Files:** `server/git.ts`

**Problem:** `getPrForBranch()` returns `null` for CLOSED/MERGED PRs, which breaks the archive CTA and prevents showing PR state in the sidebar.

**Fix:**
1. In `server/git.ts:getPrForBranch()`: Remove the `if (data.state !== 'OPEN') return null;` filter. Return the full PR info regardless of state.
2. The `PrTopBar` and `pr-state.ts` already handle MERGED/CLOSED states correctly — the state machine has `archive-merged` and `archive-closed` actions defined. Removing the filter makes them reachable again.

---

### Task 5: Remove grip handle dots

**Files:** `frontend/src/components/WorkspaceItem.svelte`

**Problem:** Grip handle `⠿` is redundant since the whole workspace item is draggable via `svelte-dnd-action`.

**Fix:**
1. Remove both `<span class="grip-handle ...">⠿</span>` elements (the reorder-mode and normal variants)
2. Remove all `.grip-handle` CSS rules
3. Remove the `.workspace-header:hover .grip-handle` CSS rule
4. Keep the `cursor: grab` on `.workspace-header.reorder-mode` since the whole header is the drag target

---

### Task 6: Collapse Add Workspace + Settings into one row

**Files:** `frontend/src/components/Sidebar.svelte`

**Problem:** Two stacked full-width buttons waste vertical space.

**Fix:**
1. Wrap both buttons in a single `<div class="sidebar-footer-row">` with `display: flex; gap: 8px; margin: 8px; align-items: stretch;`
2. `+ Add Workspace` becomes `flex: 1` (takes remaining space)
3. Settings becomes a square icon-only button: `⚙` with `width: 40px; height: 40px; flex-shrink: 0;` — remove the "Settings" text label
4. Remove the separate margin/spacing from each button since the parent row handles it

---

### Task 7: Show branch name for active repo sessions + last activity for inactive

**Files:** `server/index.ts`, `frontend/src/components/WorkspaceItem.svelte`

**Problem:** `POST /sessions/repo` doesn't pass `branchName`, so active repo sessions have no branch name. Inactive worktrees don't show last activity time.

**Fix:**
1. In `server/index.ts` `POST /sessions/repo` handler: Before creating the session, fetch the current branch via `execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath })` and pass `branchName` to `sessions.create()`. Wrap in try/catch — if git fails, proceed without.
2. In `WorkspaceItem.svelte`: For inactive worktree rows, render `worktreeTime(wt)` in the secondary row (it already does at line 327). Verify this works — `wt.lastActivity` should come from the worktree metadata. If empty, that's OK — just don't render.

## Verification

After all tasks:
1. `npm run build` must succeed
2. `npm test` must pass
