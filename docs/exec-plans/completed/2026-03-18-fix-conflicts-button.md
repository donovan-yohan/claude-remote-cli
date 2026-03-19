# Fix Conflicts Button — Implementation Plan

> **Status**: Complete | **Created**: 2026-03-18
> **Design**: `docs/design-docs/2026-03-18-fix-conflicts-button-design.md`

## Progress

- [x] Task 1: Add `baseRefName` to dashboard PR data (backend)
- [x] Task 2: Add `baseRefName` to PullRequest type (frontend)
- [x] Task 3: Add `promptFixConflicts` to WorkspaceSettings
- [x] Task 4: Add worktree-for-existing-branch endpoint support
- [x] Task 5: Replace "Conflicts" badge with "Fix Conflicts" button in RepoDashboard
- [x] Task 6: Wire `onFixConflicts` handler in App.svelte
- [x] Task 7: Verify build passes

---

### Task 1: Add `baseRefName` to dashboard PR data (backend)

**File:** `server/workspaces.ts`
**Change:**
1. Add `baseRefName` to the `fields` string (line ~224): append `,baseRefName`
2. In `mapRawPr()` (line ~238), add: `baseRefName: (raw.baseRefName as string) ?? '',`

**File:** `server/types.ts`
**Change:** Add `baseRefName: string;` to the `PullRequest` interface (after `headRefName`)

**Depends on:** Nothing

---

### Task 2: Add `baseRefName` to PullRequest type (frontend)

**File:** `frontend/src/lib/types.ts`
**Change:** Add `baseRefName: string;` to the `PullRequest` interface (after `headRefName`)

**Depends on:** Nothing (parallel with Task 1)

---

### Task 3: Add `promptFixConflicts` to WorkspaceSettings

**File:** `server/types.ts`
**Change:** Add `promptFixConflicts?: string;` to `WorkspaceSettings` (after `promptGeneral`)

**File:** `frontend/src/lib/types.ts`
**Change:** Add `promptFixConflicts?: string;` to `WorkspaceSettings` (after `promptGeneral`)

**Depends on:** Nothing (parallel with Tasks 1-2)

---

### Task 4: Add worktree-for-existing-branch endpoint support

**File:** `server/workspaces.ts`
**Change:** Modify `POST /workspaces/worktree` to accept an optional `branch` body parameter. When provided:
- Skip mountain name generation and branch creation (`-b`)
- Use `git worktree add <worktreePath> <branch>` (checkout existing branch)
- Derive worktree directory name from the branch name (sanitized)
- Skip incrementing `nextMountainIndex`
- Still ensure `.worktrees/` is in `.gitignore`

When `branch` is not provided, behavior is unchanged (current mountain name flow).

**Depends on:** Nothing (parallel)

---

### Task 5: Replace "Conflicts" badge with "Fix Conflicts" button

**File:** `frontend/src/components/RepoDashboard.svelte`
**Change:**
1. Add `onFixConflicts` prop: `onFixConflicts: (pr: PullRequest) => void`
2. Replace the static `<span class="pr-badge pr-badge-conflict">` with:
   ```svelte
   <button
     class="pr-action-pill pr-conflict-pill"
     title="Open worktree and fix merge conflicts"
     onclick={() => onFixConflicts(pr)}
   >
     Fix Conflicts
   </button>
   ```
3. Restyle `.pr-badge-conflict` → `.pr-conflict-pill` as a clickable pill (error color background, white text, cursor pointer)

**Depends on:** Task 2 (PullRequest type must have `baseRefName`)

---

### Task 6: Wire `onFixConflicts` handler in App.svelte

**File:** `frontend/src/App.svelte`
**Change:**
1. Import `sendPtyData` from `../lib/ws.js`
2. Add `handleFixConflicts(pr: PullRequest)` function:
   - Look through `sessionState.sessions` and `sessionState.worktrees` for one matching `pr.headRefName`
   - If found: create new session tab in that worktree path via `createSession()`, set as active, send conflict prompt
   - If not found: create worktree for existing branch via `createWorktree()` with branch param, then create session, set as active, send conflict prompt
   - Default prompt: `Merge the branch "{baseRefName}" into this branch and resolve all merge conflicts. Use \`git merge {baseRefName}\` and fix any conflicts in the working tree. After resolving, verify the build passes.`
   - Check workspace settings for `promptFixConflicts` override (interpolate `{baseRefName}` and `{headRefName}`)
3. Pass `onFixConflicts={handleFixConflicts}` to `<RepoDashboard>`

**File:** `frontend/src/lib/api.ts`
**Change:** Update `createWorktree()` to accept optional `branch` parameter and pass it in the POST body.

**Depends on:** Tasks 3, 4, 5

---

### Task 7: Verify build passes

Run `npm run build` and `npm test` to verify everything compiles and tests pass.

**Depends on:** All previous tasks
