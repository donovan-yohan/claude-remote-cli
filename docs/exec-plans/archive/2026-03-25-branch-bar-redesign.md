# Branch Bar Redesign

> **Status**: Complete | **Created**: 2026-03-25
> **Design**: `docs/design-docs/2026-03-25-branch-bar-redesign-design.md`

## Progress

- [x] Task 1: Backend — enriched branches endpoint + new git helpers
- [x] Task 2: Backend — new workspace endpoints (rename-branch, create-branch, pr-base)
- [x] Task 3: Frontend — BranchSwitcher.svelte enhancement (worktree-aware, disabled state, create branch)
- [x] Task 4: Frontend — TargetBranchSwitcher.svelte + PrTopBar layout redesign
- [x] Task 5: Frontend — inline rename flow + RenameWarningModal
- [x] Task 6: Frontend — App.svelte wiring + API client functions
- [x] Task 7: Build verification

## Dependency Graph

```
Task 1 ──┐
         ├──→ Task 3 ──┐
Task 2 ──┤             ├──→ Task 6 ──→ Task 7
         ├──→ Task 4 ──┤
         └──→ Task 5 ──┘
```

Tasks 1 & 2 are independent (backend). Tasks 3, 4, 5 depend on backend types. Task 6 wires everything. Task 7 verifies build.

---

### Task 1: Backend — enriched branches endpoint + new git helpers

**Files:**
- `server/git.ts` — add `listBranchesEnriched()` function
- `server/index.ts` — update `GET /branches` handler
- `server/types.ts` — add `BranchInfo` interface

**What:**
1. Add `BranchInfo` interface to `server/types.ts`:
   ```typescript
   export interface BranchInfo {
     name: string;
     isLocal: boolean;
     isRemote: boolean;
     checkedOutIn?: {
       worktreePath: string;
       worktreeName: string;
       sessionId?: string;
     };
   }
   ```

2. Add `listBranchesEnriched()` to `server/git.ts`:
   - Run `git branch -a --format=%(refname:short)` (existing)
   - Run `git worktree list --porcelain` to get worktree→branch mapping
   - Parse porcelain output: each worktree block has `worktree <path>` and `branch refs/heads/<name>`
   - Accept a `sessions` parameter (array of `{ id, worktreePath }`) for cross-referencing
   - For each branch, check if any worktree has it checked out; if so, annotate with `checkedOutIn`
   - Track `isLocal` and `isRemote` separately (don't deduplicate like current `normalizeBranchNames`)
   - Return `BranchInfo[]` sorted by name

3. Update `GET /branches` handler in `server/index.ts`:
   - Call `listBranchesEnriched()` instead of `listBranches()`
   - Pass `sessions.list()` mapped to `{ id, worktreePath }` for cross-referencing
   - Return `BranchInfo[]` (breaking change from `string[]`)

**Acceptance:** `GET /branches?repo=<path>` returns `BranchInfo[]` with correct `checkedOutIn` annotations.

---

### Task 2: Backend — new workspace endpoints

**Files:**
- `server/git.ts` — add `renameBranch()`, `createBranch()`, `changePrBase()`
- `server/workspaces.ts` — add 3 new POST routes

**What:**
1. Add to `server/git.ts`:
   - `renameBranch(repoPath, newName, options)` — runs `git branch -m <newName>` (renames current branch), returns `{ success, oldName, newName }` or error
   - `createBranch(repoPath, branchName, options)` — runs `git checkout -b <branchName>`, returns `{ success, branch }` or error
   - `changePrBase(repoPath, prNumber, baseBranch, options)` — runs `gh pr edit <prNumber> --base <baseBranch>`, returns `{ success }` or error

2. Add routes to `server/workspaces.ts`:
   - `POST /workspaces/rename-branch` — body: `{ newName }`, query: `path`. Calls `renameBranch()`. Returns `{ success, oldName, newName }` or `{ error }`
   - `POST /workspaces/create-branch` — body: `{ branchName }`, query: `path`. Calls `createBranch()`. Returns `{ success, branch }` or `{ error }`
   - `POST /workspaces/pr-base` — body: `{ prNumber, baseBranch }`, query: `path`. Calls `changePrBase()`. Returns `{ success }` or `{ error }`

**Acceptance:** All 3 endpoints return expected JSON. Error cases (no git repo, bad branch name, gh not installed) return 400/500 with `{ error }`.

---

### Task 3: Frontend — BranchSwitcher.svelte enhancement

**Files:**
- `frontend/src/components/BranchSwitcher.svelte`
- `frontend/src/lib/types.ts` — add `BranchInfo` interface

**What:**
1. Add `BranchInfo` interface to `frontend/src/lib/types.ts`:
   ```typescript
   export interface BranchInfo {
     name: string;
     isLocal: boolean;
     isRemote: boolean;
     checkedOutIn?: {
       worktreePath: string;
       worktreeName: string;
       sessionId?: string;
     };
   }
   ```

2. Update BranchSwitcher props:
   - Add `disabled?: boolean` prop (default false)
   - Add `onJumpToSession?: (sessionId: string) => void` callback
   - Add `onStartSession?: (worktreePath: string) => void` callback
   - Add `onCreateBranch?: (branchName: string) => void` callback
   - Add `currentWorktreePath?: string` prop (to distinguish "this worktree" from "other worktree")

3. Update TanStack Query to fetch `BranchInfo[]` instead of `string[]`

4. Add "create branch" row: when `filterText` doesn't exactly match any branch name, show `+ Create "{filterText}"` at top of list. Selecting it calls `onCreateBranch`

5. Worktree awareness in branch rows:
   - If `branch.checkedOutIn` exists AND `branch.checkedOutIn.worktreePath !== currentWorktreePath`:
     - Add `text-decoration: line-through`, muted color
     - Show worktree name in parentheses: `(denali)`
     - Add link-out icon button at right edge
     - Clicking branch name row does nothing (prevent selection)
     - Clicking link-out icon: if `sessionId` exists, call `onJumpToSession(sessionId)`; else call `onStartSession(worktreePath)`
   - If `branch.checkedOutIn.worktreePath === currentWorktreePath`: show checkmark (existing)

6. Disabled state:
   - When `disabled` is true: trigger button gets `opacity: 0.5`, `cursor: not-allowed`, `title="Unavailable while agent is running"`
   - `openDropdown()` returns early if `disabled`

**Acceptance:** Dropdown shows worktree-aware branches, disabled state works, create branch option appears.

---

### Task 4: Frontend — TargetBranchSwitcher + PrTopBar layout redesign

**Files:**
- `frontend/src/components/TargetBranchSwitcher.svelte` — new file
- `frontend/src/components/PrTopBar.svelte` — layout changes

**What:**
1. Create `TargetBranchSwitcher.svelte`:
   - Similar structure to BranchSwitcher but simpler
   - Props: `workspacePath`, `currentBase` (current PR base branch), `prNumber`, `disabled`
   - Fetches branches from same `GET /branches` endpoint, filters to `isRemote: true` only, strips `origin/` prefix
   - On select, calls `POST /workspaces/pr-base` with `prNumber` and selected branch
   - Trigger shows: `{currentBase}` + caret SVG (diamond/chevron)
   - Same filter input, dropdown pattern
   - Loading/error states for the gh pr edit call

2. Update PrTopBar layout:
   - Replace `›` separator with SVG right-arrow `→` between branch switcher and target
   - Wrap target in `TargetBranchSwitcher` instead of static `<span>`
   - Add `agentRunning` prop, forward as `disabled` to both switchers
   - Add hover-reveal icon buttons in `.bar-left`:
     - Copy button (clipboard icon) — copies `currentBranch` to clipboard via `navigator.clipboard.writeText()`
     - Rename button (pencil icon) — triggers inline rename mode (Task 5)
     - CSS: `opacity: 0; transition: opacity 0.15s` on icons, `.bar-left:hover .hover-icon { opacity: 1 }`
     - On mobile: always `opacity: 1` (no hover on touch devices)
   - Arrow always visible when PR exists (part of resting state)
   - Mobile `@media (max-width: 600px)`: hide `.target-branch` and arrow (existing rule, extend to cover arrow)

**Acceptance:** Top bar shows `⑂ branch [copy][rename] → target ◇` layout. Target is clickable dropdown. Icons fade in on hover.

---

### Task 5: Frontend — inline rename flow + RenameWarningModal

**Files:**
- `frontend/src/components/PrTopBar.svelte` — inline rename state
- `frontend/src/components/dialogs/RenameWarningModal.svelte` — new modal

**What:**
1. Inline rename in PrTopBar:
   - Add `renaming` state (boolean)
   - When rename icon clicked: set `renaming = true`, replace branch name text with `<input>` pre-filled with current branch name
   - Input: `Enter` confirms rename (calls `POST /workspaces/rename-branch`), `Escape` cancels
   - On successful rename: update `currentBranch`, check if PR exists — if yes, show RenameWarningModal
   - Rename icon disabled when `agentRunning` is true

2. Create `RenameWarningModal.svelte`:
   - Uses `DialogShell` (compact variant, not fullscreen)
   - Props: `oldName`, `newName`, `workspacePath`, `onClose`
   - Content: "Branch renamed: {old} → {new}. This PR's head branch no longer matches. Push the renamed branch to update GitHub?"
   - Three buttons:
     - **Push**: runs `git push origin {newName}` + `git push origin --delete {oldName}` (two sequential fetch calls to new backend endpoints, or combine into one push endpoint). On success, close modal + refetch PR
     - **Ignore**: close modal, no action
     - **Cancel**: calls `POST /workspaces/rename-branch` with the reverse rename (`newName` → `oldName`), then close modal
   - Loading state during push/cancel operations

3. Backend support for push (add to Task 2 if not already covered):
   - The push can be done via a new `POST /workspaces/push-branch` endpoint: `git push origin {branch}` + optional `git push origin --delete {oldBranch}`
   - Or: combine into the rename-branch response flow

**Acceptance:** Clicking pencil icon enables inline edit. Enter renames. If PR exists, warning modal appears with Push/Ignore/Cancel.

---

### Task 6: Frontend — App.svelte wiring + API client functions

**Files:**
- `frontend/src/lib/api.ts` — add new API functions
- `frontend/src/App.svelte` — pass new props to PrTopBar

**What:**
1. Add to `api.ts`:
   - `renameBranch(workspacePath, newName)` → `POST /workspaces/rename-branch`
   - `createBranch(workspacePath, branchName)` → `POST /workspaces/create-branch`
   - `changePrBase(workspacePath, prNumber, baseBranch)` → `POST /workspaces/pr-base`
   - `pushBranch(workspacePath, branch, deleteOld?)` → `POST /workspaces/push-branch`
   - Update `fetchBranches()` return type from `string[]` to `BranchInfo[]`

2. Update `App.svelte`:
   - Pass `agentRunning={activeSession?.agentState === 'processing'}` to PrTopBar
   - Pass session jump/start callbacks through to PrTopBar → BranchSwitcher:
     - `onJumpToSession`: sets active session ID
     - `onStartSession`: creates session in the worktree (existing `createSession()` flow)

**Acceptance:** Full end-to-end flow works: branch switching with worktree awareness, target branch changing, rename with warning modal, copy to clipboard.

---

### Task 7: Build verification

**What:**
- Run `npm run build` to verify TypeScript compilation
- Run `npm test` to verify existing tests pass
- Fix any type errors or build issues

**Acceptance:** `npm run build` exits 0. `npm test` passes.
