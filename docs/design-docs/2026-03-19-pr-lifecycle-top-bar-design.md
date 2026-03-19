# PR Lifecycle Top Bar Design

**Date:** 2026-03-19
**Status:** Draft

## Problem

The PrTopBar currently fetches PR status on mount, window focus, and a 60s stale timer — but has no awareness of when Claude finishes work (pushes commits, creates PRs, merges). This means the bar is often stale after the most important moments. Additionally, the bar lacks key PR lifecycle features: merge conflict detection, diff stats, unresolved comment counts, and a proper archive flow.

## Design

### 1. Session-End PR Refresh

**Trigger:** When a Claude session's PTY exits or an SDK turn completes, the server broadcasts a new `session-ended` event over `/ws/events`. The frontend uses this to invalidate the svelte-query cache for PR and CI data, triggering an immediate refetch.

**Server side (`ws.ts` / `pty-handler.ts`):**
- `proc.onExit()` in pty-handler calls `broadcastEvent('session-ended', { sessionId })` before deleting from the session map
- SDK handler emits the same event on `turn_completed` when the session goes idle

**Frontend side (`App.svelte` / `ws.ts`):**
- Event socket handler for `session-ended` calls `queryClient.invalidateQueries({ queryKey: ['pr'] })` and `queryClient.invalidateQueries({ queryKey: ['ci-status'] })` to refetch all PR/CI data
- This is workspace-scoped — only the active session's workspace PR data matters, but invalidating all is cheap since svelte-query deduplicates

### 2. Session Resume PR Refresh

**Trigger:** When the user clicks a session tab or reconnects, PrTopBar already refetches on mount (svelte-query). But we add an explicit refetch when the `sessionId` prop changes (session switch/resume):

```svelte
$effect(() => {
  if (sessionId) {
    prQuery.refetch();
    ciQuery.refetch();
  }
});
```

This ensures switching between session tabs immediately shows fresh PR state.

### 3. Extended PR Data Model

Extend `PrInfo` (in `server/git.ts` and `frontend/src/lib/types.ts`) with new fields:

```typescript
export interface PrInfo {
  // existing
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision: string | null;
  // new
  additions: number;
  deletions: number;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  unresolvedCommentCount: number;
}
```

**Diff stats + mergeable:** Add `additions,deletions,mergeable` to the `gh pr view --json` fields list in `getPrForBranch()`. These are first-class fields on the GH GraphQL PR object — no extra API call needed.

**Unresolved comments:** New function in `git.ts`:

```typescript
async function getUnresolvedCommentCount(
  repoPath: string,
  prNumber: number,
): Promise<number>
```

Uses `gh api graphql` to query `pullRequest.reviewThreads` where `isResolved: false`. Returns count. Called alongside `getPrForBranch` and merged into the response at the `/workspaces/pr` endpoint.

### 4. Updated PR State Machine

Extend `pr-state.ts` with new action types and inputs:

```typescript
export type PrActionType =
  | 'none'
  | 'create-pr'
  | 'ready-for-review'
  | 'review-pr'           // renamed from 'code-review'
  | 'resolve-comments'    // NEW: unresolved review comments
  | 'fix-conflicts'       // NEW: merge conflicts detected
  | 'fix-errors'
  | 'checks-running'
  | 'archive-merged'
  | 'archive-closed';
```

Updated priority order in `derivePrAction()`:

```
1. No PR, no commits ahead        → none
2. No PR, commits ahead           → create-pr
3. PR Draft                       → ready-for-review
4. PR Merged                      → archive-merged (purple bar)
5. PR Closed                      → archive-closed
6. PR Open + CONFLICTING          → fix-conflicts (red bar)
7. PR Open + CI failing           → fix-errors
8. PR Open + CI pending           → checks-running
9. PR Open + unresolved comments  → resolve-comments + review-pr (two buttons)
10. PR Open + all clear           → review-pr
```

**Key change:** When there are unresolved comments, we show **two** action buttons:
- `Resolve Comments (N)` — primary action, accent color
- `Review PR` — secondary action, muted color

This requires PrTopBar to support a `secondaryAction` alongside the primary `prAction`.

### 5. PrTopBar Visual Treatments

#### Layout (left to right):
```
[branch-switcher] > [target-branch] | [PR #N ↗] [+555 -28] | [state-badge] | [action-btn] [secondary-btn?]
```

#### Diff stats badge:
- Inline after PR link: `+{additions}` in green, `-{deletions}` in red
- Monospace, small font, no background — just colored text
- Hidden on mobile (same as target-branch)

#### State-specific bar treatments:

**Merged (purple):**
- Bar background: subtle purple tint (`var(--status-merged)` at 10% opacity)
- State badge: "Merged" in purple pill
- Action: "Archive" button (accent on purple)

**Conflicts (red):**
- Bar background: subtle red tint (`var(--status-error)` at 10% opacity)
- State badge: "Conflicts" in red pill
- Action: "Fix Conflicts" button sends prompt to terminal

**No PR:**
- Standard bar background
- No PR link, no diff stats
- Action: "Open PR" button (accent color)

**Open (normal):**
- Standard bar background
- PR link + diff stats visible
- Action: "Review PR" and optionally "Resolve Comments (N)"

#### Prompts for action buttons:

| Action | Prompt sent to terminal |
|--------|------------------------|
| Open PR | `Create a pull request for branch "{branch}". Write a clear title and description.` |
| Fix Conflicts | `There are merge conflicts with the base branch "{baseBranch}". Run \`git merge {baseBranch}\` and resolve all conflicts.` |
| Review PR | `Review the pull request #{number} for branch "{branch}". Read the diff, check for bugs and code quality.` |
| Resolve Comments (N) | `There are {N} unresolved review comments on PR #{number}. Read each comment thread, triage them, and address the feedback.` |
| Archive | No prompt — triggers archive flow (below) |

### 6. Archive Flow

When "Archive" is clicked (merged/closed PRs):

1. **Confirm:** Brief confirmation since it's destructive (kill + delete)
2. **Kill session:** `DELETE /sessions/:id`
3. **Delete worktree:** `DELETE /worktrees` with the session's worktree path
4. **UI update:** `refreshAll()` to remove from sidebar — session disappears, worktree disappears
5. **No remote branch deletion** — user can do that separately from GitHub

For repo sessions (no worktree), archive just kills the session.

### 7. `session-ended` Event

New broadcast event type added to the event WebSocket:

```typescript
broadcastEvent('session-ended', {
  sessionId: string,
  repoPath: string,    // helps frontend scope the refetch
  branchName: string,
});
```

Emitted from:
- `pty-handler.ts` `proc.onExit()` — before `sessionsMap.delete()`
- `sdk-handler.ts` — on turn completion when session goes idle

The frontend event handler in `App.svelte` (or a dedicated effect) invalidates queries:

```typescript
// In event socket handler
if (msg.type === 'session-ended') {
  queryClient.invalidateQueries({ queryKey: ['pr'] });
  queryClient.invalidateQueries({ queryKey: ['ci-status'] });
}
```

### 8. GraphQL Query for Unresolved Comments

```graphql
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
        }
      }
    }
  }
}
```

Parse `nwo` (owner/repo) from `gh repo view --json nameWithOwner` (cached per repo path). Count nodes where `isResolved === false`.

## Files Changed

| File | Change |
|------|--------|
| `server/git.ts` | Add `additions`, `deletions`, `mergeable` to `gh pr view` fields; new `getUnresolvedCommentCount()` function; update `PrInfo` interface |
| `server/types.ts` | Update `PrInfo` type if shared |
| `server/pty-handler.ts` | Emit `session-ended` broadcast on PTY exit |
| `server/ws.ts` | Accept + forward `session-ended` events |
| `server/index.ts` | Update `/workspaces/pr` endpoint to include new fields + comment count |
| `frontend/src/lib/types.ts` | Update `PrInfo` interface |
| `frontend/src/lib/pr-state.ts` | Add `fix-conflicts`, `resolve-comments` action types; update `derivePrAction()` with new priority order; update `getActionPrompt()` |
| `frontend/src/components/PrTopBar.svelte` | Diff stats display, dual action buttons, bar color treatments, session-switch refetch, archive flow |
| `frontend/src/App.svelte` | Wire `session-ended` event to query invalidation; wire archive callback |
| `frontend/src/lib/api.ts` | No changes needed (existing `fetchPrForBranch` returns whatever server sends) |

## Non-Goals

- Real-time PR webhook integration (polling is sufficient for now)
- Remote branch deletion on archive
- Inline diff viewer in the top bar (just line counts)
- Comment thread content preview (just the count)
