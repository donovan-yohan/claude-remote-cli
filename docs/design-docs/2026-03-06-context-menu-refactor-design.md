---
status: implemented
created: 2026-03-06
branch: master
supersedes:
implemented-by:
consulted-learnings: []
---

# Context Menu Refactor Design

**Date:** 2026-03-06
**Goal:** Replace all hover/longpress action pill patterns with a universal "..." context menu dropdown

## Problem

Currently, SessionItem and PullRequestItem use hover-dependent action pills (inline buttons) that appear on `:hover` or mobile longpress. This pattern:
- Is invisible on mobile until you long-press
- Clutters the row on hover/longpress
- Uses different reveal mechanisms on desktop vs mobile
- The old `ContextMenu.svelte` exists but is barely used (only for worktrees)

## Solution

Replace all inline action pills with a single always-visible "..." button that opens a dropdown menu. Remove the hover/longpress reveal pattern entirely.

## Design Decisions

1. **Single ContextMenu component** - Rewrite `ContextMenu.svelte` as a generic, reusable dropdown menu that accepts a list of menu items and positions itself relative to the trigger button.

2. **"..." button always visible** - The three-dot button is rendered at the far right of each list item, always visible (no hover gate). This ensures mobile parity.

3. **Menu items per state** (from PRD):
   - **Active session**: Rename, Kill
   - **Inactive worktree**: Customize, Resume, Resume (YOLO), Delete
   - **Idle repo**: Customize (new session), New Worktree
   - **PullRequestItem**: Open in GitHub, YOLO (keep existing external link and YOLO buttons but move to menu)

4. **Positioning** - The menu opens below the "..." button, right-aligned to avoid overflow. Falls back to opening above if insufficient space below.

5. **Dismissal** - Close on: outside click, Escape key, selecting a menu item.

6. **Remove longpress/hover action patterns** - Remove `createLongpressClick` from SessionItem/PullRequestItem. The click handler fires directly. Remove `.session-actions` and `.pr-actions` hover-gated containers.

7. **Keep longpress for text scroll** - The `scrollOnHover` action stays (it's about text overflow, not action reveal). But remove the `mobileReveal`/`createLongpressClick` wrapper — the item's `onclick` fires directly without the two-tap dance.

## Component Architecture

### ContextMenu.svelte (rewrite)
```
Props:
  - items: Array<{ label: string, action: () => void, danger?: boolean, disabled?: boolean }>
  - buttonClass?: string (for styling the trigger)

State:
  - open: boolean
  - menuPosition: { top, left } computed from trigger button bounds

Template:
  <button class="context-menu-trigger" onclick={toggle}>...</button>
  {#if open}
    <div class="context-menu-backdrop" onclick={close} />
    <ul class="context-menu" style:top style:left>
      {#each items as item}
        <li onclick={item.action} class:danger={item.danger}>{item.label}</li>
      {/each}
    </ul>
  {/if}
```

### SessionItem.svelte changes
- Remove: `onkill`, `onrename`, `onresumeYolo`, `ondelete`, `onNewWorktree` individual props
- Add: `menuItems: Array<{ label: string, action: () => void, danger?: boolean }>` prop
- Remove: `.session-actions` container and all action pill buttons
- Remove: `createLongpressClick` usage, use direct onclick
- Add: `<ContextMenu items={menuItems} />` inside the `<li>`

### PullRequestItem.svelte changes
- Remove: `onYolo` prop and YOLO pill button
- Add: `menuItems` prop
- Remove: hover-gated `.pr-actions` container
- Keep: review badge inline (not in menu — it's informational, not an action)
- Add: `<ContextMenu items={menuItems} />` inside the `<li>`

### SessionList.svelte changes
- Build `menuItems` arrays per variant when rendering SessionItem/PullRequestItem
- Wire existing handler functions as menu item actions

### lib/actions.ts changes
- Keep `scrollOnHover` as-is
- Remove `createLongpressClick` and `mobileReveal` (no longer needed)

## File Changes

| File | Change |
|------|--------|
| `frontend/src/components/ContextMenu.svelte` | Full rewrite as generic dropdown |
| `frontend/src/components/SessionItem.svelte` | Replace action pills with ContextMenu, simplify props |
| `frontend/src/components/PullRequestItem.svelte` | Replace action pills with ContextMenu |
| `frontend/src/components/SessionList.svelte` | Build menuItems arrays, pass to items |
| `frontend/src/components/PrRepoGroup.svelte` | Build menuItems for PR items |
| `frontend/src/lib/actions.ts` | Remove `createLongpressClick`, `mobileReveal` |
