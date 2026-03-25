---
status: implemented
---
# Fix Conflicts Button Design

> **Status**: Approved | **Created**: 2026-03-18

## Goal

Replace the static "Conflicts" badge on the dashboard PR list with an actionable "Fix Conflicts" button that opens the PR's branch in a worktree session and sends Claude an initial prompt to merge the target branch and resolve conflicts.

## Approach

**Merge strategy (default).** When the user clicks "Fix Conflicts", Claude is prompted to run `git merge <targetBranch>` and resolve all conflicts. This is safer than rebase for open PRs with reviewers, and matches GitHub's own merge behavior. The merge strategy is the default; a future `promptFixConflicts` workspace setting allows customization.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Default to `git merge` (not rebase) | Safer for open PRs; doesn't rewrite history; matches GitHub behavior |
| Add `baseRefName` to dashboard PR query | One extra field on data already fetched; avoids on-demand API call latency |
| Reuse existing worktree if branch is already checked out | Avoids cluttering sidebar with duplicates |
| Create new session tab (not reuse existing session) | Provides clean context for conflict resolution prompt |
| Add `promptFixConflicts` to WorkspaceSettings | Matches existing pattern (`promptCodeReview`, `promptCreatePr`, etc.) |

## Design

### 1. Dashboard PR Data — Add `baseRefName`

The `gh pr list` call in `server/workspaces.ts` already fetches many fields. Add `baseRefName` to the field list. Update the `PullRequest` type in both `server/types.ts` and `frontend/src/lib/types.ts` to include `baseRefName: string`.

### 2. Dashboard UI — Replace Badge with Button

In `RepoDashboard.svelte`, replace the static `<span class="pr-badge pr-badge-conflict">Conflicts</span>` with a clickable `<button>` styled as an error-colored action pill:

```svelte
{#if pr.mergeable === 'CONFLICTING'}
  <button
    class="pr-action-pill pr-conflict-pill"
    title="Open worktree and fix merge conflicts"
    onclick={() => onFixConflicts(pr)}
  >
    Fix Conflicts
  </button>
{/if}
```

Style: error color background (matching the existing conflict badge aesthetic) with white text, same pill dimensions as "Merge" button.

### 3. Click Handler Flow

`onFixConflicts(pr: PullRequest)` is a new prop callback on RepoDashboard, handled by the parent (`App.svelte` or wherever the dashboard is rendered). The flow:

1. **Find existing worktree** for `pr.headRefName` by checking the sessions/worktrees list
2. **If worktree exists:** create a new session tab in that worktree's path
3. **If no worktree:** create a new worktree for the branch via `POST /workspaces/worktree`, then create a session
4. **Send initial prompt** to the new session: default merge prompt or workspace-customized `promptFixConflicts`

### 4. Default Conflict Resolution Prompt

```
Merge the branch "{baseRefName}" into this branch and resolve all merge conflicts. Use `git merge {baseRefName}` and fix any conflicts in the working tree. After resolving, verify the build passes.
```

### 5. Workspace Settings — `promptFixConflicts`

Add `promptFixConflicts?: string` to `WorkspaceSettings` in both server and frontend types. When set, it replaces the default prompt. The `{baseRefName}` and `{headRefName}` placeholders are interpolated at runtime.

### 6. Backend — Worktree for Existing Branch

The existing `POST /workspaces/worktree` creates a new branch from the base. For "Fix Conflicts", we need to check out an *existing* branch. Add an optional `branch` parameter to the worktree creation endpoint that checks out an existing branch instead of creating a new one.

## Scope

**In scope:**
- Dashboard "Fix Conflicts" button replacing "Conflicts" badge
- `baseRefName` in dashboard PR data
- Worktree creation for existing branches
- Session creation with conflict resolution prompt
- `promptFixConflicts` workspace setting

**Out of scope:**
- Rebase strategy option (future work)
- PrTopBar conflict state (already handled by "Fix Errors" when CI fails due to conflicts)
- Auto-detection of conflict resolution completion
