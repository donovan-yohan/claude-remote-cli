# PR Lifecycle Top Bar

> **Status**: Complete | **Created**: 2026-03-19
> **Design**: `docs/design-docs/2026-03-19-pr-lifecycle-top-bar-design.md`

## Progress

- [x] Task 1: Extend PrInfo type and git.ts data fetching
- [x] Task 2: Add session-ended broadcast event
- [x] Task 3: Update pr-state.ts state machine
- [x] Task 4: Enhance PrTopBar component
- [x] Task 5: Wire session-ended event and archive flow in App.svelte
- [x] Task 6: Verification — build + test

## Drift Log

_(empty)_

---

### Task 1: Extend PrInfo type and git.ts data fetching

**Goal:** Add `additions`, `deletions`, `mergeable`, `unresolvedCommentCount` to the PR data pipeline.

**Files:**
- `server/types.ts` — Add fields to `PrInfo` interface
- `frontend/src/lib/types.ts` — Mirror the same fields
- `server/git.ts` — Add `additions,deletions,mergeable` to `gh pr view --json` fields; add new `getUnresolvedCommentCount()` function using `gh api graphql`; export it
- `server/workspaces.ts` — At the `/workspaces/pr` endpoint, call `getUnresolvedCommentCount()` and merge into response

**Details:**
- `PrInfo` gains: `additions: number`, `deletions: number`, `mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'`, `unresolvedCommentCount: number`
- `getPrForBranch()` already queries `gh pr view --json number,title,url,state,headRefName,baseRefName,reviewDecision,isDraft`. Append `additions,deletions,mergeable` to the field list. Parse and return them.
- New `getUnresolvedCommentCount(repoPath, prNumber)` runs: `gh api graphql -f query='...'` with the reviewThreads query. Parse the response, count `isResolved === false`. Return 0 on any error.
- In workspaces.ts `/pr` endpoint: after `getPrForBranch()`, if pr exists and state is OPEN, call `getUnresolvedCommentCount(workspacePath, pr.number)`. Merge `unresolvedCommentCount` into response. For non-OPEN PRs, set to 0.

---

### Task 2: Add session-ended broadcast event

**Goal:** Emit `session-ended` event when PTY exits or SDK session ends, so frontend can refetch PR data.

**Files:**
- `server/sessions.ts` — Add `onSessionEnd` callback array (same pattern as `onIdleChange`); call it from `kill()` and have pty-handler call it on PTY exit
- `server/pty-handler.ts` — In `proc.onExit()`, before `sessionsMap.delete(id)`, call the session-end callbacks with `{ sessionId, repoPath, branchName }`
- `server/ws.ts` — Register `sessions.onSessionEnd()` callback that broadcasts `session-ended` event

**Details:**
- In `sessions.ts`: add `type SessionEndCallback = (sessionId: string, repoPath: string, branchName: string) => void` and `const sessionEndCallbacks: SessionEndCallback[] = []`. Add `onSessionEnd(cb)` function. Export it.
- In `pty-handler.ts`: the `createPtySession` function receives `sessionsMap` as a parameter. We need it to also receive the callback list, OR we add a hook in sessions.ts. Better approach: have `sessions.ts` wrap pty-handler exit. Actually, looking at the code, pty-handler directly deletes from the map. The cleanest approach: add `sessionEndCallbacks` to `sessions.ts` and have pty-handler import and call them. pty-handler already imports from sessions indirectly. Actually, pty-handler is imported BY sessions.ts. So we should: export `sessionEndCallbacks` from sessions.ts, import in pty-handler, and call from `proc.onExit()`.
- Wait — looking more carefully, `createPtySession` receives `sessionsMap` directly. The callbacks should be passed the same way, OR we can keep it simpler: just have sessions.ts's `kill()` function call the callbacks, and for natural PTY exit, have pty-handler call the exported callbacks array.
- Simplest: export `fireSessionEnd(sessionId, repoPath, branchName)` from sessions.ts. Call it in pty-handler's `proc.onExit()` before `sessionsMap.delete()`, and in sessions.ts `kill()` before `sessions.delete()`.
- In `ws.ts`: add `sessions.onSessionEnd((sessionId, repoPath, branchName) => { broadcastEvent('session-ended', { sessionId, repoPath, branchName }); });`

---

### Task 3: Update pr-state.ts state machine

**Goal:** Add new action types for conflicts, unresolved comments, and dual-button support.

**Files:**
- `frontend/src/lib/pr-state.ts` — New types, updated `derivePrAction()`, new `deriveSecondaryAction()`, updated prompts

**Details:**
- Add `PrActionType`: `'resolve-comments'` and `'fix-conflicts'`
- Add to `PrStateInput`: `mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null`, `unresolvedCommentCount: number`
- Updated `derivePrAction()` priority:
  1. No PR + no commits → none
  2. No PR + commits → create-pr
  3. Draft → ready-for-review
  4. Merged → archive-merged
  5. Closed → archive-closed
  6. Open + CONFLICTING → fix-conflicts (red)
  7. Open + CI failing → fix-errors
  8. Open + CI pending → checks-running
  9. Open + unresolved comments > 0 → resolve-comments (primary)
  10. Open + all clear → review-pr (renamed from code-review)
- New `deriveSecondaryAction()`: returns `review-pr` action when primary is `resolve-comments`, null otherwise
- Rename `code-review` → `review-pr` everywhere
- Update `getActionPrompt()` with new action types:
  - `fix-conflicts`: `There are merge conflicts with the base branch "{baseBranch}". Run \`git merge {baseBranch}\` and resolve all conflicts.`
  - `resolve-comments`: `There are {N} unresolved review comments on PR #{number}. Read each comment thread, triage them, and address the feedback.`
  - `review-pr`: `Review the pull request #{number} for branch "{branch}". Read the diff, check for bugs and code quality.`
- `getActionPrompt` needs additional context params: `baseBranch`, `prNumber`, `unresolvedCommentCount`. Change signature to accept a context object.

---

### Task 4: Enhance PrTopBar component

**Goal:** Add diff stats, bar color treatments, dual action buttons, session-switch refetch.

**Files:**
- `frontend/src/components/PrTopBar.svelte` — Major update

**Details:**
- **Props:** Add `onArchive` callback (already exists in props but not wired to actions properly)
- **Session-switch refetch:** Add `$effect` that calls `prQuery.refetch()` and `ciQuery.refetch()` when `sessionId` changes
- **Diff stats:** After PR link, show `+{additions}` in green and `-{deletions}` in red. Use `pr.additions` / `pr.deletions`. Hidden on mobile via media query.
- **State machine integration:** Update `prAction` derivation to pass new fields (`mergeable`, `unresolvedCommentCount`). Compute `secondaryAction` via `deriveSecondaryAction()`.
- **Bar color treatment:**
  - Merged: add `bar-merged` class → purple-tinted background
  - Conflicts: add `bar-conflicts` class → red-tinted background
  - Otherwise: standard background
- **Dual buttons:** When `secondaryAction` exists, render two buttons. Primary on the right, secondary (muted style) next to it.
- **Action handler:** Update `handleActionClick` to pass context (baseBranch, prNumber, unresolvedCommentCount) to `getActionPrompt`. For archive actions, call `onArchive`.
- **State badge:** Between diff stats and action button, show a small state pill: "Open", "Draft", "Merged" (purple), "Closed", "Conflicts" (red). Replaces the implicit state info.

**CSS additions:**
- `.bar-merged` — `background: color-mix(in srgb, var(--status-merged) 8%, var(--surface))`
- `.bar-conflicts` — `background: color-mix(in srgb, var(--status-error) 8%, var(--surface))`
- `.diff-stats` — inline flex, gap 6px, monospace xs
- `.diff-add` — `color: var(--status-success)`
- `.diff-del` — `color: var(--status-error)`
- `.state-badge` — small pill with state-appropriate color
- `.action-btn--secondary` — muted background variant

---

### Task 5: Wire session-ended event and archive flow in App.svelte

**Goal:** Connect session-ended broadcast to query invalidation; implement archive callback.

**Files:**
- `frontend/src/App.svelte` — Handle new event type; implement `handleArchive()`
- `frontend/src/lib/ws.ts` — Update `EventCallback` type to include new event fields

**Details:**
- In `ws.ts`: extend the `EventCallback` message type to include `repoPath?: string` field (already has `sessionId`, `idle`, `branchName`).
- In `App.svelte` `handleEventMessage()`: add case for `msg.type === 'session-ended'` → call `queryClient.invalidateQueries({ queryKey: ['pr'] })` and `queryClient.invalidateQueries({ queryKey: ['ci-status'] })`.
- `handleArchive()` function:
  1. Get the active session's info (id, worktreePath, repoPath, type)
  2. If session exists: `await killSession(sessionId)`
  3. If it's a worktree session with a worktreePath: `await deleteWorktree(worktreePath, repoPath)`
  4. Call `refreshAll()` to update sidebar
  5. Navigate to dashboard view (clear activeSessionId)
- Pass `handleArchive` as `onArchive` prop to `PrTopBar`

---

### Task 6: Verification — build + test

**Goal:** Ensure everything compiles and existing tests pass.

**Steps:**
1. `npm run build` — TypeScript compilation for both server and frontend
2. `npm test` — Run existing test suite
3. Fix any type errors or test failures
