# Execution Plan: New Tab Quick-Create & Customize Redesign

> **Status**: Completed | **Created**: 2026-03-21
> **Design**: `docs/design-docs/2026-03-21-new-tab-quick-create-design.md`
> **Branch**: `new-agent-quick-open`

## Progress

- [x] Task 1: Update backend `POST /sessions/terminal` to accept `cwd`
- [x] Task 2: Update `createTerminalSession()` in `api.ts` to accept `cwd`
- [x] Task 3: Rename `NewSessionDialog.svelte` → `CustomizeSessionDialog.svelte` and strip it down
- [x] Task 4: Update `SessionTabBar.svelte` with 3-option dropdown
- [x] Task 5: Update `App.svelte` — new handlers, wire callbacks, update Cmd+T
- [x] Task 6: Fix tab ordering — sort by `createdAt` ascending in `sessions.svelte.ts`
- [x] Task 7: Auto-name tabs — assign "Agent N" / "Terminal N" display names
- [x] Task 8: Update all references to `NewSessionDialog` across codebase
- [x] Task 9: Build verification

---

### Task 1: Update backend `POST /sessions/terminal` to accept `cwd`
**File:** `server/index.ts`
**Change:** Read `req.body.cwd` (optional), use it as `repoPath` and `cwd` instead of `os.homedir()`. Fall back to `os.homedir()` if not provided.

### Task 2: Update `createTerminalSession()` in `api.ts`
**File:** `frontend/src/lib/api.ts`
**Change:** Accept optional `cwd` parameter, send it as JSON body in POST request.

### Task 3: Rename and simplify dialog
**Files:** `frontend/src/components/dialogs/NewSessionDialog.svelte` → `CustomizeSessionDialog.svelte`
**Change:**
- Git mv the file
- Remove `activeTab` state, tab rendering, branch input/autocomplete/refresh
- Remove all worktree-related logic
- Simplify `open()` to accept `{ name: string; path: string }`
- Title: "New Agent Session — {workspaceName}"
- Always call `createRepoSession()` on submit

### Task 4: Update `SessionTabBar.svelte`
**File:** `frontend/src/components/SessionTabBar.svelte`
**Change:**
- Rename `onNewSession` prop → `onNewAgent`
- Add `onCustomize` prop
- Update dropdown: "New Agent" (🤖), "New Terminal" (🖥), "Customize..." (⚙)
- Update `selectNewSession()` → `selectNewAgent()`
- Add `selectCustomize()` handler

### Task 5: Update `App.svelte`
**File:** `frontend/src/App.svelte`
**Change:**
- Replace `handleOpenNewSession()` with `handleQuickAgent()`, `handleQuickTerminal()`, `handleCustomize()`
- Wire SessionTabBar props: `onNewAgent`, `onNewTerminal`, `onCustomize`
- Wire sidebar's "New Session" actions to `handleQuickAgent()`
- Update Cmd+T handler to call `handleQuickAgent()`
- Update dialog ref from `newSessionDialogRef` to `customizeDialogRef`
- Import `createTerminalSession` from api.ts
- Import `CustomizeSessionDialog` instead of `NewSessionDialog`

### Task 6: Fix tab ordering
**File:** `frontend/src/lib/state/sessions.svelte.ts`
**Change:** After `sessions = s`, sort by `createdAt` ascending to ensure new tabs appear rightmost. `createdAt` exists on `SessionSummary`.

### Task 7: Auto-name tabs
**File:** `server/index.ts`
**Change:** The `POST /sessions/repo` handler already uses sessions to create, but doesn't auto-name. Add logic to assign "Agent {N}" display name when creating repo sessions if no displayName is provided. Terminal naming already works via `nextTerminalName()`.

### Task 8: Update all references to `NewSessionDialog`
**Files:** `App.svelte`, `frontend/src/components/WorkspaceItem.svelte`, any other files importing or referencing `NewSessionDialog`
**Change:** Update imports, type refs, and component usage to `CustomizeSessionDialog`.

### Task 9: Build verification
**Command:** `npm run build`
**Verify:** No TypeScript or Svelte errors.
