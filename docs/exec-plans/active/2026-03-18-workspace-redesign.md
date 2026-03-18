# Workspace Redesign — v3 Rearchitecture

> **Status**: Complete | **Created**: 2026-03-18 | **Last Updated**: 2026-03-18
> **Design Doc**: `docs/design-docs/2026-03-18-workspace-redesign-design.md`
> **For Claude:** Use /harness:orchestrate to execute this plan.

## Decision Log

| Date | Phase | Decision | Rationale |
|------|-------|----------|-----------|
| 2026-03-18 | Design | Full Workspace Rearchitecture (D1) | Complete workspace-first model, correct foundation |
| 2026-03-18 | Design | Direct folder addition replaces roots (D2) | Simpler mental model; breaking change OK for v3 |
| 2026-03-18 | Design | No v2→v3 migration (D3) | Clean break, users re-add folders |
| 2026-03-18 | Design | Each tab = separate Claude process (D4) | Reuses existing session creation |
| 2026-03-18 | Design | Terminal aesthetic: pure black, monospace, solid grey (D18) | Differentiates from generic SaaS |
| 2026-03-18 | Design | Conductor-inspired sidebar + terminal flavor (D19) | Letter icons, status dots, PR#/diff inline |
| 2026-03-18 | Eng | Query params for workspace paths (D12) | Matches existing `?repo=` pattern |
| 2026-03-18 | Eng | Reuse `repoPath` for workspace grouping (D13) | DRY — no schema change |
| 2026-03-18 | Eng | Extract workspace routes to Express Router (D14) | Single-concern per ADR-001 |
| 2026-03-18 | Eng | PR state machine in frontend `lib/pr-state.ts` (D15) | Presentation logic; pure function |
| 2026-03-18 | Eng | Poll-on-focus via svelte-query (D16) | Avoids hammering gh CLI |

## Progress

- [x] Task 1: Create v3 branch from v2.15.17 + update design system CSS
- [x] Task 2: Backend — `workspaces.ts` module (replaces roots)
- [x] Task 3: Backend — enhance `git.ts` (activity feed, CI status, branch switch)
- [x] Task 4: Backend — `index.ts` route migration (mount workspace router, remove old routes)
- [x] Task 5: Backend — per-workspace settings in `config.ts`
- [x] Task 6: Frontend — types, API client, state modules update
- [x] Task 7: Frontend — Sidebar rearchitecture (WorkspaceItem, flat list)
- [x] Task 8: Frontend — Smart search component
- [x] Task 9: Frontend — PR state machine (`lib/pr-state.ts`) + tests
- [x] Task 10: Frontend — PR top bar component
- [x] Task 11: Frontend — Session tab bar component
- [x] Task 12: Frontend — Repo dashboard component
- [x] Task 13: Frontend — App.svelte layout routing + empty states
- [x] Task 14: Frontend — Keyboard shortcuts
- [x] Task 15: Frontend — Tab persistence (localStorage)
- [x] Task 16: Frontend — Mobile responsive
- [x] Task 17: Cleanup — remove old components + SDK code
- [x] Task 18: Tests — backend workspace + git modules (wired git functions into workspaces.ts)
- [x] Task 19: Integration testing + version bump (docs updated, build + tests verified)

## Surprises & Discoveries

_None yet — updated during execution by /harness:orchestrate._

## Plan Drift

_None yet — updated when tasks deviate from plan during execution._

---

## Dependency Graph

```
Task 1 (branch + CSS)
├── Task 2 (workspaces.ts) ──┐
├── Task 3 (git.ts)          ├── Task 4 (index.ts routes)
├── Task 5 (config.ts)  ─────┘        │
│                                       ▼
├── Task 6 (frontend types/API/state) ──┐
│                                       ├── Task 7 (Sidebar)
│                                       ├── Task 8 (SmartSearch)
│                                       ├── Task 9 (PR state machine)
│                                       │        │
│                                       │        ▼
│                                       ├── Task 10 (PrTopBar)
│                                       ├── Task 11 (SessionTabBar)
│                                       ├── Task 12 (RepoDashboard)
│                                       │        │
│                                       │        ▼
│                                       └── Task 13 (App.svelte routing)
│                                                │
│                                    ┌───────────┼───────────┐
│                                    ▼           ▼           ▼
│                              Task 14      Task 15     Task 16
│                              (keyboard)   (persist)   (mobile)
│                                    │           │           │
│                                    └───────────┼───────────┘
│                                                ▼
│                                          Task 17 (cleanup)
│                                                │
│                                    ┌───────────┴───────────┐
│                                    ▼                       ▼
│                              Task 18                 Task 19
│                              (backend tests)   (integration + bump)
```

Parallelizable groups:
- **Group A** (backend, after Task 1): Tasks 2, 3, 5 can run in parallel
- **Group B** (frontend components, after Task 6): Tasks 7, 8, 9, 11, 12 can run in parallel
- **Group C** (polish, after Task 13): Tasks 14, 15, 16 can run in parallel

---

### Task 1: Create v3 branch from v2.15.17 + update design system CSS

**Goal:** Establish the v3 branch base and apply the terminal aesthetic CSS changes.

**Steps:**

1. Create branch `v3-workspace-redesign` from tag `v2.15.17`:
   ```bash
   git checkout v2.15.17 -b v3-workspace-redesign
   ```

2. Update `frontend/src/app.css` — replace CSS custom properties with v3 terminal aesthetic:
   ```css
   :root {
     --bg: #000000;
     --surface: #0a0a0a;
     --surface-hover: #141414;
     --accent: #d97757;
     --text: #e0e0e0;
     --text-muted: #888888;
     --border: #333333;

     --status-success: #4ade80;
     --status-error: #f87171;
     --status-warning: #fbbf24;
     --status-merged: #a78bfa;
     --status-info: #60a5fa;

     --font-mono: 'SF Mono', 'Cascadia Code', 'JetBrains Mono',
                  'Fira Code', 'Consolas', monospace;
     --font-size-xs: 0.75rem;
     --font-size-sm: 0.8125rem;
     --font-size-base: 0.875rem;
     --font-size-lg: 1rem;

     --sidebar-width: 240px;
     --toolbar-height: auto;
   }
   ```

3. Update `html, body` font-family to use `var(--font-mono)`.

4. Commit: `feat: v3 foundation — branch from v2.15.17 + terminal aesthetic CSS`

**Verification:** `npm run build` succeeds. App renders with pure black background and monospace fonts.

---

### Task 2: Backend — `workspaces.ts` module (replaces roots)

**Goal:** Create new `workspaces.ts` server module that handles workspace CRUD, replacing the inline roots logic in `index.ts`.

**Steps:**

1. Create `server/workspaces.ts` as an Express Router:
   ```typescript
   import { Router } from 'express';
   import fs from 'node:fs';
   import path from 'node:path';
   import { execFile } from 'node:child_process';
   import { promisify } from 'node:util';

   const execFileAsync = promisify(execFile);

   export interface Workspace {
     path: string;
     name: string;
     isGitRepo: boolean;
     defaultBranch: string | null;
   }

   // Validate and resolve workspace path
   export async function validateWorkspacePath(rawPath: string): Promise<string> {
     const resolved = path.resolve(rawPath);
     const stat = await fs.promises.stat(resolved);
     if (!stat.isDirectory()) throw new Error('Not a directory');
     return resolved;
   }

   // Detect if path is a git repo and get default branch
   export async function detectGitRepo(dirPath: string): Promise<{ isGitRepo: boolean; defaultBranch: string | null }> {
     try {
       await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dirPath });
       // Get default branch
       try {
         const { stdout } = await execFileAsync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: dirPath });
         const defaultBranch = stdout.trim().replace('refs/remotes/origin/', '');
         return { isGitRepo: true, defaultBranch };
       } catch {
         // No remote HEAD — try common branch names
         for (const branch of ['main', 'master', 'development']) {
           try {
             await execFileAsync('git', ['rev-parse', '--verify', branch], { cwd: dirPath });
             return { isGitRepo: true, defaultBranch: branch };
           } catch { continue; }
         }
         return { isGitRepo: true, defaultBranch: null };
       }
     } catch {
       return { isGitRepo: false, defaultBranch: null };
     }
   }

   export function createWorkspaceRouter(/* config, saveConfig, broadcastEvent */): Router {
     const router = Router();
     // GET /workspaces — list all
     // POST /workspaces — add (body: {path})
     // DELETE /workspaces — remove (body: {path})
     // GET /workspaces/dashboard?path=X — dashboard data
     // GET /workspaces/settings?path=X — per-workspace settings
     // PATCH /workspaces/settings?path=X — update settings
     // GET /workspaces/ci-status?path=X&branch=Y — CI check results
     // POST /workspaces/branch?path=X — switch branch
     return router;
   }
   ```

2. Implement each route handler with proper error handling (400 for invalid path, 409 for duplicate, 403 for permission denied).

3. Add path autocomplete endpoint: `GET /workspaces/autocomplete?prefix=X` — returns directory listing for path completion.

4. Commit: `feat: add workspaces.ts module — CRUD, git detection, path autocomplete`

**Verification:** Unit test for `validateWorkspacePath`, `detectGitRepo`.

---

### Task 3: Backend — enhance `git.ts` (activity feed, CI status, branch switch)

**Goal:** Expand `git.ts` from 52 lines to include activity feed, CI status, and branch switching.

**Steps:**

1. Add `getActivityFeed(repoPath, since)` — runs `git log --all --since=24h --oneline --max-count=50 --format='%H|%h|%s|%an|%ar|%D'`, parses into structured array.

2. Add `getCiStatus(repoPath, branch)` — runs `gh pr checks <branch> --json name,state,conclusion`, returns `{ total, passing, failing, pending }`.

3. Add `getDefaultBranch(repoPath)` — runs `git symbolic-ref refs/remotes/origin/HEAD` with fallback to main/master.

4. Add `switchBranch(repoPath, branch)` — runs `git checkout <branch>` with error handling for dirty worktree.

5. Add `getPrForBranch(repoPath, branch)` — runs `gh pr view <branch> --json number,title,url,state,headRefName,baseRefName,reviewDecision,isDraft`, returns PR info or null.

6. Commit: `feat: enhance git.ts — activity feed, CI status, branch switch, PR lookup`

**Verification:** Unit test with mocked execFile for each function.

---

### Task 4: Backend — `index.ts` route migration

**Goal:** Mount workspace router, remove inline roots/repos routes.

**Steps:**

1. Import and mount workspace router: `app.use(createWorkspaceRouter(config, saveConfig, broadcastEvent, requireAuth))`.

2. Remove inline routes: `GET /roots`, `POST /roots`, `DELETE /roots`, `GET /repos`.

3. Move `GET /pull-requests` and `GET /git-status` into `workspaces.ts` router (they're workspace-scoped now). Keep `GET /branches` and `GET /worktrees` in `index.ts` since they're used independently.

4. Update `watcher.ts` — change from watching `.worktrees/` directories under roots to watching workspace folders. Pass workspace paths instead of rootDirs to `watcher.rebuild()`.

5. Remove `scanReposInRoot()` and `scanAllRepos()` functions.

6. Commit: `refactor: mount workspace router, remove inline roots/repos routes`

**Verification:** `npm run build` succeeds. Existing tests pass (with updated paths).

---

### Task 5: Backend — per-workspace settings in `config.ts`

**Goal:** Extend config to support per-workspace settings.

**Steps:**

1. Add `WorkspaceSettings` type to `server/types.ts`:
   ```typescript
   export interface WorkspaceSettings {
     defaultAgent?: AgentType;
     defaultContinue?: boolean;
     defaultYolo?: boolean;
     launchInTmux?: boolean;
     claudeArgs?: string[];
   }
   ```

2. Add `workspaces` and `workspaceSettings` fields to `Config` type:
   ```typescript
   export interface Config {
     // ... existing fields ...
     workspaces?: string[];  // replaces rootDirs
     workspaceSettings?: Record<string, WorkspaceSettings>;  // keyed by path
   }
   ```

3. Add helper functions in `config.ts`:
   - `getWorkspaceSettings(configPath, workspacePath)` — returns merged global + per-workspace settings
   - `setWorkspaceSettings(configPath, workspacePath, settings)` — saves per-workspace override

4. Commit: `feat: per-workspace settings in config.ts`

**Verification:** Unit test for settings merge (workspace overrides global).

---

### Task 6: Frontend — types, API client, state modules update

**Goal:** Update frontend types, API functions, and state modules for workspace model.

**Steps:**

1. Update `frontend/src/lib/types.ts`:
   - Add `Workspace` interface: `{ path, name, isGitRepo, defaultBranch }`
   - Add `DashboardData`: `{ prs, activity, repoInfo }`
   - Add `CiStatus`: `{ total, passing, failing, pending }`
   - Add `ActivityEntry`: `{ hash, shortHash, message, author, timeAgo, branches }`
   - Add `PrInfo`: `{ number, title, url, state, headRefName, baseRefName, isDraft, reviewDecision }`
   - Remove `root` field from `SessionSummary`, `WorktreeInfo`, `RepoInfo`
   - Remove `TabId` from `OpenSessionOptions` (no more tabs)

2. Update `frontend/src/lib/api.ts`:
   - Replace `fetchRoots()` with `fetchWorkspaces()`
   - Add `addWorkspace(path)`, `removeWorkspace(path)`
   - Add `fetchDashboard(path)`, `fetchCiStatus(path, branch)`, `fetchPrForBranch(path, branch)`
   - Add `fetchWorkspaceSettings(path)`, `updateWorkspaceSettings(path, settings)`
   - Add `autocompleteWorkspacePath(prefix)`
   - Add `switchBranch(path, branch)`
   - Remove `fetchRepos()`, `fetchRoots()`

3. Update `frontend/src/lib/state/ui.svelte.ts`:
   - Remove `TabId` type and `activeTab` state (no more tabs)
   - Remove `rootFilter`, `repoFilter`, `prRoleFilter`
   - Add `searchQuery` state for smart search
   - Add `activeWorkspacePath` state
   - Add `activeSessionTabs` state: `Record<string, string[]>` (workspace path → session IDs)
   - Add `activeTabIndex` state: `Record<string, number>` (workspace path → active tab index)

4. Update `frontend/src/lib/state/sessions.svelte.ts`:
   - Replace `repos` state with `workspaces` state
   - Update `refreshAll()` to call `fetchWorkspaces()` instead of `fetchRepos()`
   - Remove `refreshGitStatuses()` (replaced by per-session polling)
   - Add `getSessionsForWorkspace(path)` helper

5. Commit: `refactor: update frontend types, API, and state for workspace model`

**Verification:** TypeScript compiles with `npm run build`.

---

### Task 7: Frontend — Sidebar rearchitecture (WorkspaceItem, flat list)

**Goal:** Replace the 4-tab Sidebar + SessionList with a flat workspace tree.

**Steps:**

1. Create `frontend/src/components/WorkspaceItem.svelte`:
   - Colored letter initial (first char) in styled monospace block
   - Workspace name: bold, `--font-size-lg`
   - Nested session items: indented, status dot + name + optional PR# + diff stats
   - `+` button at bottom of session list (new worktree)
   - Quick-action buttons (new session, new terminal, settings) — visible on hover (desktop), always visible (mobile)
   - Bold text for unread items
   - Solid `--border` bottom separator

2. Rewrite `frontend/src/components/Sidebar.svelte`:
   - Remove tab bar entirely
   - Smart search input at top
   - Render `WorkspaceItem` for each workspace
   - `[+ Add Workspace]` button at bottom
   - `[Settings]` button at bottom
   - Keep resize handle and collapse behavior

3. Delete `frontend/src/components/SessionList.svelte` (replaced by workspace tree in Sidebar)
4. Delete `frontend/src/components/SessionFilters.svelte` (replaced by SmartSearch)
5. Delete `frontend/src/components/PrRepoGroup.svelte` (PRs move to dashboard)

6. Commit: `feat: sidebar rearchitecture — flat workspace tree, remove tabs`

**Verification:** Sidebar renders workspace tree with sessions nested. Click workspace → activates it.

---

### Task 8: Frontend — Smart search component

**Goal:** Replace root/repo/search filters with a smart typeahead search.

**Steps:**

1. Create `frontend/src/components/SmartSearch.svelte`:
   - Monospace input with `>` prompt prefix (terminal style)
   - On keyup: filter workspaces by name/path match
   - Dropdown below input showing matched workspace names with bold match chars
   - Click or Enter: navigate to workspace
   - Escape: close dropdown, clear input
   - Style: `--surface` bg, `--border`, monospace throughout

2. Wire into Sidebar as the top element.

3. Commit: `feat: smart search component — terminal-style workspace filter`

**Verification:** Type in search → workspaces filter. Click result → workspace activates.

---

### Task 9: Frontend — PR state machine (`lib/pr-state.ts`) + tests

**Goal:** Pure function implementing the 8-state PR top bar state machine, with exhaustive tests.

**Steps:**

1. Create `frontend/src/lib/pr-state.ts`:
   ```typescript
   export type PrAction =
     | { type: 'none' }
     | { type: 'create-pr'; color: 'accent' }
     | { type: 'ready-for-review'; color: 'muted' }
     | { type: 'code-review'; color: 'success' }
     | { type: 'fix-errors'; failing: number; total: number; color: 'error' }
     | { type: 'checks-running'; color: 'warning' }
     | { type: 'archive-merged'; color: 'merged' }
     | { type: 'archive-closed'; color: 'muted' };

   export interface PrStateInput {
     commitsAhead: number;
     prState: 'OPEN' | 'CLOSED' | 'MERGED' | 'DRAFT' | null;
     ciPassing: number;
     ciFailing: number;
     ciPending: number;
     ciTotal: number;
   }

   export function derivePrAction(input: PrStateInput): PrAction { ... }
   export function getActionLabel(action: PrAction): string { ... }
   export function getActionPrompt(action: PrAction, branchName: string): string { ... }
   ```

2. Create `test/pr-state.test.ts` — exhaustive tests for all 8 states plus edge cases (zero CI checks, null PR state).

3. Commit: `feat: PR state machine — pure function with exhaustive tests`

**Verification:** `npm test` passes. All 8 states + edge cases covered.

---

### Task 10: Frontend — PR top bar component

**Goal:** Dynamic Conductor-style PR top bar with branch info, PR link, and context-aware action button.

**Steps:**

1. Create `frontend/src/components/PrTopBar.svelte`:
   - 36px height, `--surface` bg, bottom `--border`
   - Left: branch icon + branch name > target branch (breadcrumb)
   - Center: PR number as link (clickable to GitHub)
   - Right: action button (pill, state-colored bg)
   - Uses `derivePrAction()` from `pr-state.ts`
   - Action button click: sends prompt to active session via PTY stdin
   - Mobile: collapse to branch + action button only

2. Create `frontend/src/components/BranchSwitcher.svelte`:
   - Dropdown triggered by clicking branch name
   - Lists branches from `fetchBranches()`
   - Click branch → calls `switchBranch()` API

3. Data fetching: use `@tanstack/svelte-query` with `refetchOnWindowFocus: true` and `staleTime: 60000` for PR and CI data.

4. Commit: `feat: PR top bar — dynamic action button, branch switcher`

**Verification:** PR top bar renders correct state for each branch/PR/CI combination.

---

### Task 11: Frontend — Session tab bar component

**Goal:** Multi-tab session management above the terminal.

**Steps:**

1. Create `frontend/src/components/SessionTabBar.svelte`:
   - 32px height, horizontal tab strip
   - Active tab: `--surface` bg, bottom border `--accent`, `--text`
   - Inactive tab: transparent, `--text-muted`
   - Session icon: robot for Claude, terminal icon for shell
   - Close × on each tab (hover on desktop, always on mobile)
   - `+` button at end: dropdown with "New Session" and "New Terminal"
   - Click tab: switches active session
   - Keyboard: Cmd+1-9 to switch (wired in Task 14)
   - `role="tablist"` / `role="tab"` for a11y

2. Wire into App.svelte: render above Terminal component when workspace has sessions.

3. Commit: `feat: session tab bar — multi-tab session management`

**Verification:** Create multiple sessions, switch between tabs, close tabs.

---

### Task 12: Frontend — Repo dashboard component

**Goal:** Development dashboard shown when workspace is selected with no active sessions (or when clicking workspace name).

**Steps:**

1. Create `frontend/src/components/RepoDashboard.svelte`:
   - Fetches dashboard data via `fetchDashboard(workspacePath)` using svelte-query
   - **PR section:** heading "OPEN PULL REQUESTS", list of PR rows
     - Each row: status icon + title + author + metadata left, action button (pill) right
     - Authored PRs first with subtle "author" badge, reviewer PRs with "reviewer" badge
   - **Activity section:** heading "RECENT ACTIVITY", list of commit entries
     - Each entry: short hash (monospace muted) + message + branch in parens
   - **CTA section:** `[+ Start Session]` and `[+ New Worktree]` buttons
   - Loading: skeleton placeholders
   - Empty: "No open pull requests" / "No recent commits (24h)"
   - Error: "Install gh for PR features" / "Run gh auth login"

2. Commit: `feat: repo dashboard — PRs, activity feed, empty states`

**Verification:** Dashboard renders PRs and activity for a git repo. Shows empty states for non-git workspace.

---

### Task 13: Frontend — App.svelte layout routing + empty states

**Goal:** Wire everything together in App.svelte with correct view routing.

**Steps:**

1. Update `frontend/src/App.svelte`:
   - Replace `activeTab`-based routing with workspace-based routing
   - If no workspace selected: show global empty state ("Add a workspace to get started")
   - If workspace selected, no sessions: show `RepoDashboard`
   - If workspace selected, has sessions: show `PrTopBar` + `SessionTabBar` + `Terminal`
   - Remove SDK-related conditional (no more `activeSessionMode === 'sdk'`)
   - Remove `SessionView` import (no more SDK mode)

2. Create `frontend/src/components/EmptyState.svelte`:
   - Reusable empty state component with icon, heading, description, CTA button
   - Terminal aesthetic: monospace, muted text, accent button

3. Commit: `feat: App.svelte layout routing — workspace-first view switching`

**Verification:** Full flow works: add workspace → see dashboard → start session → terminal with tab bar + PR top bar.

---

### Task 14: Frontend — Keyboard shortcuts

**Goal:** IDE-style keyboard shortcuts for workspace and tab navigation.

**Steps:**

1. Add global keydown listener in App.svelte:
   - `Cmd+T` / `Ctrl+T`: new session tab in current workspace
   - `Cmd+W` / `Ctrl+W`: close current session tab
   - `Cmd+1` through `Cmd+9`: switch to tab N (Cmd+9 = last tab)
   - `Cmd+Shift+[`: previous tab
   - `Cmd+Shift+]`: next tab
   - Only active when terminal area is focused (not in search input)
   - Prevent default browser behavior for these combos

2. Commit: `feat: keyboard shortcuts — Cmd+T/W/1-9/Shift+[/] for tab navigation`

**Verification:** Test each shortcut creates/closes/switches tabs.

---

### Task 15: Frontend — Tab persistence (localStorage)

**Goal:** Persist open session tabs per workspace across page reloads.

**Steps:**

1. Add to `ui.svelte.ts`:
   - `saveTabState()`: serialize `activeSessionTabs` and `activeTabIndex` to localStorage
   - `loadTabState()`: restore on page load
   - Called on tab open, close, switch
   - Handle stale sessions: on restore, verify session still exists via API, remove if not

2. Extend session persistence (`pending-sessions.json`) to include tab layout metadata.

3. Commit: `feat: tab persistence — save/restore tab layout across reloads`

**Verification:** Open multiple tabs, refresh page, tabs restore correctly.

---

### Task 16: Frontend — Mobile responsive

**Goal:** Apply mobile-specific treatments for all new components.

**Steps:**

1. PrTopBar: `@media (max-width: 600px)` — hide target branch and PR link, show only branch name + action button.

2. SessionTabBar: horizontal scroll, 44px touch targets, × always visible.

3. WorkspaceItem: 44px touch targets, quick-action buttons always visible.

4. RepoDashboard: full-width cards, larger tap targets.

5. SmartSearch: full-width input in sidebar overlay.

6. Add workspace dialog: text input with autocomplete (no `showDirectoryPicker` on mobile).

7. Commit: `feat: mobile responsive — all new components adapted for touch`

**Verification:** Test on mobile viewport (375px width): sidebar, dashboard, PR bar, tabs all usable.

---

### Task 17: Cleanup — remove old components + SDK code

**Goal:** Remove v3.0 SDK code and old v2 components that are no longer needed.

**Steps:**

1. Delete SDK-related files (if they exist on v2.15 base — they shouldn't, but verify):
   - `server/sdk-handler.ts`
   - Frontend SDK components: `ChatView`, `ChatInput`, `PermissionCard`, `QuickReplies`, `CostDisplay`, `AgentBadge`, `cards/` directory
   - `frontend/src/lib/state/sdk.svelte.ts`

2. Delete replaced components:
   - `SessionList.svelte` (replaced by workspace tree in Sidebar)
   - `SessionFilters.svelte` (replaced by SmartSearch)
   - `PrRepoGroup.svelte` (replaced by RepoDashboard)
   - `PullRequestItem.svelte` (restyled in RepoDashboard)
   - `SessionItem.svelte` (functionality merged into WorkspaceItem)

3. Remove unused API functions from `api.ts`: `fetchRoots()`, `fetchRepos()`.

4. Remove unused state: `rootFilter`, `repoFilter`, `prRoleFilter` from `ui.svelte.ts` (if not already removed in Task 6).

5. Commit: `chore: remove replaced v2 components and unused code`

**Verification:** `npm run build` succeeds with no unused imports.

---

### Task 18: Tests — backend workspace + git modules

**Goal:** Unit tests for new backend functionality.

**Steps:**

1. Create `test/workspaces.test.ts`:
   - `validateWorkspacePath`: valid dir, nonexistent, file path, symlink
   - `detectGitRepo`: git repo, non-git folder
   - Workspace CRUD: add, add duplicate (409), remove, list
   - Path autocomplete: returns directory entries

2. Expand `test/git.test.ts` (or create):
   - `getActivityFeed`: parses git log output
   - `getCiStatus`: parses gh pr checks output
   - `switchBranch`: success and dirty-worktree error
   - `getPrForBranch`: PR exists and no PR

3. `test/config.test.ts`:
   - Per-workspace settings: get with global fallback, set override

4. `test/pr-state.test.ts` (already created in Task 9)

5. Commit: `test: backend workspace, git, config, and PR state machine tests`

**Verification:** `npm test` — all tests pass.

---

### Task 19: Integration testing + version bump

**Goal:** Final verification and version bump.

**Steps:**

1. Run full build: `npm run build`
2. Run all tests: `npm test`
3. Manual smoke test: start server, add workspace, see dashboard, create session, use tabs, test PR top bar
4. Update `docs/ARCHITECTURE.md` — reflect new module structure (workspaces.ts, enhanced git.ts)
5. Update `docs/FRONTEND.md` — reflect new component map
6. Update `docs/DESIGN.md` — add terminal aesthetic and workspace model decisions
7. Update `CLAUDE.md` — reflect v3 changes
8. Update `docs/PLANS.md` — move this plan to completed
9. Version bump: `npm version major` (3.0.0)

10. Commit: `3.0.0`

**Verification:** Clean build, all tests pass, version 3.0.0.

---

## Outcomes & Retrospective

_Filled by /harness:complete when work is done._

**What worked:**
- Parallel agent dispatching for independent modules (3 backend agents, 3 frontend component agents, 3 polish agents) — each group completed in ~30s
- PR state machine as pure function with exhaustive tests — caught design at code time, not runtime
- Building off v2.15.17 base (clean break from v3.0 SDK work) — avoided entanglement with discarded code
- Design doc from CEO/Eng/Design reviews provided clear specs for every component — minimal ambiguity during implementation

**What didn't:**
- Agent-produced code sometimes left stubs ("TODO: wire up git.ts functions") that needed manual integration
- Cascading type changes from removing `root` field required touching many components — could have been anticipated with a type migration step
- SettingsDialog and NewSessionDialog needed manual fixes after the state module changes — agents only handled the files they were assigned

**Learnings to codify:**
- When removing a field from a shared type, create a dedicated "type migration" task that updates ALL consumers, not just the type definition
- Agent tasks should specify "also update any files that import this module" when changing exports
- The workspace-first model (flat sidebar, no tabs) is simpler than the 4-tab approach — fewer state variables, fewer components, clearer navigation
