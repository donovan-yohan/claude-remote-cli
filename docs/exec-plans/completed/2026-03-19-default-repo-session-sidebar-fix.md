# Fix: Default Repo Session Sidebar — 6 Bugs

> **Status**: Complete | **Created**: 2026-03-19 | **Last Updated**: 2026-03-19
> **Bug Analysis**: `docs/bug-analyses/2026-03-19-default-repo-session-sidebar-bug-analysis.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-19 | Design | All 6 bugs fixed in single file `WorkspaceItem.svelte` | All root causes are in the same component; no server changes needed |
| 2026-03-19 | Design | Use `createRepoSession` instead of `createSession` for repo root click | `createSession` hits `POST /sessions` (worktree endpoint); `createRepoSession` hits `POST /sessions/repo` |
| 2026-03-19 | Design | Add `.context-menu-spacer` with `flex: 1` for right-alignment | Pushes ContextMenu to right edge in all secondary rows |

## Progress

- [x] Task 1: Fix repo root always visible + correct name + correct click handler
- [x] Task 2: Add secondary row to idle repo root entry
- [x] Task 3: Fix secondary row item order for active sessions
- [x] Task 4: Fix secondary row item order for inactive worktrees
- [x] Task 5: Right-align ContextMenu (dots) in all secondary rows
- [x] Task 6: Build and verify (187/187 tests pass)

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

### Task 1: Fix repo root always visible + correct name + correct click handler

**File:** `frontend/src/components/WorkspaceItem.svelte`

**Why:** Bugs 1, 2, 3 — repo root hidden when empty, wrong name, wrong click handler.

**Steps:**

1. Change import: replace `createSession` with `createRepoSession` from `'../lib/api.js'`
   - Line 6: `import { createSession } from '../lib/api.js';` → `import { createRepoSession } from '../lib/api.js';`

2. Extract the repo root entry (lines 249-277) OUT of the `{#if allSessions.length > 0 || inactiveWorktrees.length > 0}` conditional. It should render whenever `!collapsed && !inReorderMode`, regardless of whether sessions/worktrees exist.

3. The repo root rendering condition should check: does the `workspace.path` group in `sessionGroups` have 0 sessions? If yes, show the idle repo root. This is already done at line 249 `{:else if isRepoRoot}` but it's inside the session groups loop. Restructure: render the idle repo root entry BEFORE the `<ul>` conditional when the workspace.path group has no sessions.

4. Change name from `workspace.name` to `'default'` in the idle repo root display (line 274).

5. Change `createSession(...)` to `createRepoSession(...)` in the onclick handler (line 261), and pass `continue: true` so it continues a previous conversation if one exists.

6. Also update `worktreeMenuItems` (lines 110-157) which also uses `createSession` — these need to stay as `createSession` since they're for worktrees. So we need BOTH imports: `createSession` for worktrees and `createRepoSession` for repo root.

**Verification:** `npm run build` compiles without errors.

---

### Task 2: Add secondary row to idle repo root entry

**File:** `frontend/src/components/WorkspaceItem.svelte`

**Why:** Bug 4 — idle repo root has no secondary row.

**Steps:**

1. Add a conditional `session-row-secondary` div to the idle repo root `<li>` showing only the default branch name (no ContextMenu — idle repo has no actions yet):
   ```svelte
   {#if workspace.defaultBranch}
     <div class="session-row-secondary">
       <span class="secondary-branch">{workspace.defaultBranch}</span>
     </div>
   {/if}
   ```

2. ~~Create a `repoRootMenuItems()` function~~ — Scope cut: idle repo root has no meaningful menu items yet. ContextMenu omitted to avoid rendering an empty menu.

**Verification:** `npm run build` compiles without errors.

---

### Task 3: Fix secondary row item order for active sessions

**File:** `frontend/src/components/WorkspaceItem.svelte`

**Why:** Bug 5 — order is worktree→PR→time→dots, should be time→branch→PR→dots.

**Steps:**

1. In the active session `session-row-secondary` (lines 238-247), reorder to:
   ```svelte
   <div class="session-row-secondary">
     <span class="secondary-time">{sessionTime(representative)}</span>
     {#if representative.branchName}
       <span class="secondary-branch">{representative.branchName}</span>
     {/if}
     {#if meta?.prNumber}
       <span class="secondary-pr">PR #{meta.prNumber}</span>
     {/if}
     <span class="context-menu-spacer"></span>
     <ContextMenu items={sessionMenuItems(representative)} />
   </div>
   ```

2. Remove the old `secondary-worktree` reference — replace with `secondary-branch` using `representative.branchName`.

**Verification:** `npm run build` compiles without errors.

---

### Task 4: Fix secondary row item order for inactive worktrees

**File:** `frontend/src/components/WorkspaceItem.svelte`

**Why:** Bug 5 — inactive worktrees also have wrong order.

**Steps:**

1. In the inactive worktree `session-row-secondary` (lines 314-319), reorder to:
   ```svelte
   <div class="session-row-secondary">
     <span class="secondary-time">{worktreeTime(wt)}</span>
     {#if wt.branchName}
       <span class="secondary-branch">{wt.branchName}</span>
     {/if}
     {#if meta?.prNumber}
       <span class="secondary-pr">PR #{meta.prNumber}</span>
     {/if}
     <span class="context-menu-spacer"></span>
     <ContextMenu items={worktreeMenuItems(wt)} />
   </div>
   ```

**Verification:** `npm run build` compiles without errors.

---

### Task 5: Right-align ContextMenu in all secondary rows

**File:** `frontend/src/components/WorkspaceItem.svelte`

**Why:** Bug 6 — dots not pushed to the right edge.

**Steps:**

1. Add CSS for the spacer that pushes dots right:
   ```css
   .context-menu-spacer {
     flex: 1;
   }
   ```

2. Add CSS for secondary-branch (if not already present):
   ```css
   .secondary-branch {
     white-space: nowrap;
     overflow: hidden;
     text-overflow: ellipsis;
     min-width: 0;
   }
   ```

**Verification:** `npm run build` compiles without errors.

---

### Task 6: Build and verify

**Steps:**

1. Run `npm run build` to verify compilation.
2. Run `npm test` to verify no test regressions.

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
-

**What didn't:**
-

**Learnings to codify:**
-
