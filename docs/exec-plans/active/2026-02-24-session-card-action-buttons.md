# Session Card Action Buttons — Implementation Plan

> **Status**: Completed | **Created**: 2026-02-24 | **Last Updated**: 2026-02-24
> **Design Doc**: `docs/design-docs/2026-02-24-session-card-action-buttons-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-02-24 | Design | Pill-shaped hover buttons replacing context menu | Context menu was disconnected, not discoverable on touch, and overlapped status bar |
| 2026-02-24 | Design | Monospace text labels for YOLO and + worktree | Clear, distinctive labels that read well at small sizes |
| 2026-02-24 | Design | Align rows 2-3 with padding-left instead of spacer elements | Spacer elements were unreliable; padding is simpler |

## Progress

- [x] Task 1: Update SessionItem — new props, pill button markup, alignment fix _(completed 2026-02-24)_
- [x] Task 2: Update SessionItem — new pill button styles _(completed 2026-02-24)_
- [x] Task 3: Wire SessionList — new action handlers for worktree and repo variants _(completed 2026-02-24)_
- [x] Task 4: Remove context menu plumbing from Sidebar and App _(completed 2026-02-24)_
- [x] Task 5: Build verification and visual check _(completed 2026-02-24)_

## Surprises & Discoveries

| Date | What was unexpected | Impact | What was done |
|------|---------------------|--------|---------------|
| 2026-02-24 | Worker had to remove `oncontextmenu` prop from SessionList.svelte to fix type errors | None — Task 3+4 will re-wire SessionList anyway | Removed the stale prop usage early |

## Plan Drift

| Date | What changed | Why |
|------|-------------|-----|
| 2026-02-24 | Idle repo click now creates session directly (no dialog). YOLO button added to idle repos. `+ worktree` opens dialog in worktrees tab. | User feedback: clicking idle repo should skip dialog; YOLO should be one-tap. |
| 2026-02-24 | Inactive worktree YOLO creates session directly (no dialog). Was: opens dialog with yolo pre-selected. | Consistency: all YOLO actions are direct, no dialog. |

---

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the right-click context menu on session cards with inline pill-shaped hover buttons, fix row alignment, and improve button legibility across all three card variants.

**Architecture:** Frontend-only change across 4 Svelte components. `SessionItem.svelte` gets new props and pill button markup/styles. `SessionList.svelte` wires new action handlers. `App.svelte` and `Sidebar.svelte` drop context menu plumbing. `ContextMenu.svelte` becomes unused.

**Tech Stack:** Svelte 5 (runes), TypeScript, CSS scoped styles

---

### Task 1: Update SessionItem — new props, pill button markup, alignment fix

**Files:**
- Modify: `frontend/src/components/SessionItem.svelte:1-174` (script + template)

**Step 1: Add new props to SessionItem**

In the `$props()` destructuring, add `onresumeYolo` and `ondelete` callbacks. Remove the `oncontextmenu` prop.

```typescript
let {
  variant,
  gitStatus,
  onclick,
  onkill,
  onrename,
  onresumeYolo,
  ondelete,
}: {
  variant: ItemVariant;
  gitStatus?: GitStatus | undefined;
  onclick: () => void;
  onkill?: () => void;
  onrename?: () => void;
  onresumeYolo?: () => void;
  ondelete?: () => void;
} = $props();
```

**Step 2: Add event handlers for new buttons**

Replace `handleContextMenu` with handlers for the new buttons:

```typescript
function handleResumeYolo(e: MouseEvent) {
  e.stopPropagation();
  onresumeYolo?.();
}

function handleDelete(e: MouseEvent) {
  e.stopPropagation();
  ondelete?.();
}
```

**Step 3: Update the template — remove contextmenu, add pill buttons per variant**

Remove `oncontextmenu={handleContextMenu}` from the `<li>`. Replace the `session-actions` block with variant-aware buttons:

```svelte
<div class="session-actions">
  {#if variant.kind === 'active'}
    {#if onrename}
      <button class="action-pill" aria-label="Rename session" onclick={handleRename}>✎</button>
    {/if}
    {#if onkill}
      <button class="action-pill action-pill--danger" aria-label="Kill session" onclick={handleKill}>×</button>
    {/if}
  {:else if variant.kind === 'inactive-worktree'}
    {#if onresumeYolo}
      <button class="action-pill action-pill--mono" aria-label="Resume in yolo mode" onclick={handleResumeYolo}>YOLO</button>
    {/if}
    {#if ondelete}
      <button class="action-pill action-pill--danger" aria-label="Delete worktree" onclick={handleDelete}>🗑</button>
    {/if}
  {:else if variant.kind === 'idle-repo'}
    <button class="action-pill action-pill--mono" aria-label="New worktree" onclick={handleClick}>+ worktree</button>
  {/if}
</div>
```

Move `session-actions` outside the `{#if isActive}` guard so it renders for all variants.

**Step 4: Fix alignment — remove spacers, add padding-left to rows 2 and 3**

In the template, remove the `<span class="row-2-spacer">` and `<span class="row-3-spacer">` elements. The padding will be handled in CSS (Task 2).

**Step 5: Run type check**

Run: `npm run check:svelte`
Expected: No errors related to SessionItem

---

### Task 2: Update SessionItem — new pill button styles

**Files:**
- Modify: `frontend/src/components/SessionItem.svelte:176-428` (style block)

**Step 1: Replace old button styles with pill button styles**

Remove the old `.session-rename-btn`, `.session-rename-btn:hover`, `.session-kill`, `.session-kill:hover`, `.session-kill:active` rules.

Add the new pill button styles:

```css
/* Pill action buttons */
.action-pill {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: var(--text);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 12px;
  touch-action: manipulation;
  flex-shrink: 0;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  transition: background 0.15s, color 0.15s;
  line-height: 1;
}

.action-pill:hover {
  background: rgba(255, 255, 255, 0.2);
}

.action-pill--mono {
  font-family: monospace;
  font-size: 0.65rem;
  letter-spacing: 0.02em;
}

.action-pill--danger:hover {
  background: rgba(231, 76, 60, 0.15);
  color: #e74c3c;
}

/* Selected card overrides */
li.active-session.selected .action-pill {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

li.active-session.selected .action-pill:hover {
  background: rgba(255, 255, 255, 0.3);
}

li.active-session.selected .action-pill--danger:hover {
  background: rgba(231, 76, 60, 0.25);
  color: #fca5a5;
}
```

**Step 2: Update session-actions to show for all variants, not just active**

The `.session-actions` opacity reveal should work for all card types:

```css
.session-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s 0.1s;
}

li:hover .session-actions {
  opacity: 1;
}

@media (hover: none) {
  .session-actions {
    opacity: 1;
  }
}
```

**Step 3: Fix alignment — update rows 2 and 3 padding**

Remove `.row-2-spacer` and `.row-3-spacer` CSS rules. Update `.session-row-2` and `.session-row-3`:

```css
.session-row-2 {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding-left: 16px;
}

.session-row-3 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-left: 16px;
}
```

Update `.pr-icon` to remove the `width: 16px` since the spacer it replaced is gone — it should just be inline:

```css
.pr-icon {
  font-size: 0.65rem;
  flex-shrink: 0;
}
```

**Step 4: Run type check**

Run: `npm run check:svelte`
Expected: No errors

---

### Task 3: Wire SessionList — new action handlers for worktree and repo variants

**Files:**
- Modify: `frontend/src/components/SessionList.svelte:1-182`

**Step 1: Replace onContextMenu prop with onResumeYolo and onDeleteWorktree**

Update the props:

```typescript
let {
  onSelectSession,
  onOpenNewSession,
  onResumeYolo,
  onDeleteWorktree,
}: {
  onSelectSession: (id: string) => void;
  onOpenNewSession: (repo?: RepoInfo) => void;
  onResumeYolo: (wt: WorktreeInfo) => void;
  onDeleteWorktree: (wt: WorktreeInfo) => void;
} = $props();
```

**Step 2: Update the inactive worktree SessionItem usage**

Replace the `oncontextmenu` prop with inline action props:

```svelte
{#each filteredWorktrees as wt (wt.path)}
  <SessionItem
    variant={{ kind: 'inactive-worktree', worktree: wt }}
    gitStatus={state.gitStatuses[wt.repoPath + ':' + wt.name]}
    onclick={() => handleStartWorktreeSession(wt)}
    onresumeYolo={() => onResumeYolo(wt)}
    ondelete={() => onDeleteWorktree(wt)}
  />
{/each}
```

**Step 3: Run type check**

Run: `npm run check:svelte`
Expected: No errors

---

### Task 4: Remove context menu plumbing from Sidebar and App

**Files:**
- Modify: `frontend/src/components/Sidebar.svelte:1-44`
- Modify: `frontend/src/App.svelte:1-215`

**Step 1: Update Sidebar props — replace onContextMenu with onResumeYolo and onDeleteWorktree**

```typescript
let {
  onSelectSession,
  onOpenNewSession,
  onOpenSettings,
  onResumeYolo,
  onDeleteWorktree,
}: {
  onSelectSession: (id: string) => void;
  onOpenNewSession: (repo?: RepoInfo) => void;
  onOpenSettings: () => void;
  onResumeYolo: (wt: WorktreeInfo) => void;
  onDeleteWorktree: (wt: WorktreeInfo) => void;
} = $props();
```

Pass through to SessionList:

```svelte
<SessionList
  {onSelectSession}
  {onOpenNewSession}
  {onResumeYolo}
  {onDeleteWorktree}
/>
```

**Step 2: Update App.svelte — remove ContextMenu, wire direct handlers**

Remove the `ContextMenu` import and `contextMenuRef` variable.

Remove `handleContextMenu` function.

Rename `handleContextMenuResumeYolo` to `handleResumeYolo` and `handleContextMenuDelete` to `handleDeleteWorktree`.

Update Sidebar usage:

```svelte
<Sidebar
  onSelectSession={handleSelectSession}
  onOpenNewSession={handleOpenNewSession}
  onOpenSettings={handleOpenSettings}
  onResumeYolo={handleResumeYolo}
  onDeleteWorktree={handleDeleteWorktree}
/>
```

Remove the ContextMenu component from the dialogs section:

```svelte
<!-- Remove this: -->
<!-- <ContextMenu bind:this={contextMenuRef} ... /> -->
```

**Step 3: Run type check**

Run: `npm run check:svelte`
Expected: No errors

---

### Task 5: Build verification and visual check

**Files:** None (verification only)

**Step 1: Full build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add frontend/src/components/SessionItem.svelte \
       frontend/src/components/SessionList.svelte \
       frontend/src/components/Sidebar.svelte \
       frontend/src/App.svelte
git commit -m "feat: replace context menu with inline pill action buttons on session cards"
```

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
