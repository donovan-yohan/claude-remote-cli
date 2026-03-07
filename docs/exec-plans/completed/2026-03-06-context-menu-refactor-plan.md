# Context Menu Refactor - Execution Plan

**Design doc:** `docs/design-docs/2026-03-06-context-menu-refactor-design.md`
**Goal:** Replace hover/longpress action pills with universal "..." context menu

## Steps

### Step 1: Rewrite ContextMenu.svelte as generic dropdown
- [x] **File:** `frontend/src/components/ContextMenu.svelte`
- Accept `items` prop (array of `{ label, action, danger?, disabled? }`)
- Render always-visible "..." trigger button
- Open/close dropdown with positioning logic
- Close on outside click, Escape, or item select
- Style consistently with existing design system

### Step 2: Refactor SessionItem.svelte
- [x] **File:** `frontend/src/components/SessionItem.svelte`
- Replace individual action callback props with `menuItems` prop
- Remove `.session-actions` container and all action pill buttons
- Remove `createLongpressClick` usage — onclick fires directly
- Add `<ContextMenu>` component
- Remove hover/longpress CSS for action reveal
- Keep `scrollOnHover` for text overflow

### Step 3: Refactor PullRequestItem.svelte
- [x] **File:** `frontend/src/components/PullRequestItem.svelte`
- Replace `onYolo` prop with `menuItems` prop
- Remove `.pr-actions` hover-gated container and action pills
- Remove `createLongpressClick` usage
- Add `<ContextMenu>` component
- Keep review badge inline (informational)

### Step 4: Update SessionList.svelte
- [x] **File:** `frontend/src/components/SessionList.svelte`
- Build `menuItems` arrays per variant:
  - Active → `[{ label: 'Rename', action: handleRename }, { label: 'Kill', action: handleKill, danger: true }]`
  - Inactive worktree → `[{ label: 'Customize', action: ... }, { label: 'Resume', action: handleResume }, { label: 'Resume (YOLO)', action: handleResumeYolo }, { label: 'Delete', action: handleDelete, danger: true }]`
  - Idle repo → `[{ label: 'Customize', action: ... }, { label: 'New Worktree', action: handleNewWorktree }]`
- Pass `menuItems` to each `<SessionItem>`

### Step 5: Update PrRepoGroup.svelte
- [x] **File:** `frontend/src/components/PrRepoGroup.svelte`
- Build `menuItems` for each `<PullRequestItem>`:
  - `[{ label: 'Open in GitHub', action: openExternal }, { label: 'Start (YOLO)', action: handleYolo }]`
- Pass `menuItems` to each `<PullRequestItem>`

### Step 6: Clean up lib/actions.ts
- [x] **File:** `frontend/src/lib/actions.ts`
- Remove `createLongpressClick` function
- Remove `mobileReveal` function
- Keep `scrollOnHover` unchanged

### Step 7: Build, test, verify
- [x] Run `npm run build` to verify compilation
- [x] Run `npm test` to verify existing tests pass
