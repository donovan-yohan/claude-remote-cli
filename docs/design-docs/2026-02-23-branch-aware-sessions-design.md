# Branch-Aware Session Creation (v2.0)

> Replace `claude --worktree` with manual `git worktree add` + plain `claude`, move worktrees from `.claude/worktrees/` to `.worktrees/`, and add a type-to-search branch picker to the New Session dialog.

## Breaking Changes

- **Worktree location**: `.claude/worktrees/` → `.worktrees/` (no migration, major version bump)
- **Session spawn**: `claude --worktree <name>` → `git worktree add` + `claude` (no flags)

## Session Creation Flow

1. User types branch name in New Session dialog → filters matching branches
2. Frontend sends `POST /sessions` with optional `branchName`
3. Server creates worktree:
   - **Existing branch**: `git worktree add .worktrees/<dir> <branchName>`
   - **New branch**: `git worktree add -b <branchName> .worktrees/<dir> HEAD`
   - **No branch specified**: auto-generate `mobile-<repo>-<timestamp>` as both dir and branch name
4. Server spawns `claude` (no flags) with `cwd` = worktree path
5. Branch name stored in worktree metadata; directory name = branch name with `/` replaced by `-`

## Gitignore Handling

On first worktree creation in a repo, auto-append `.worktrees/` to the repo's `.gitignore` if not already present.

## New API Endpoint

### `GET /branches?repo=<path>`

Returns local + remote branch names for the given repo path. Used by the type-to-search UI.

Response: `string[]` of branch names (e.g., `["main", "feat/auth", "dy/feat/foo", "origin/main"]`).

## Modified API Endpoint

### `POST /sessions`

New optional field: `branchName: string`.

- If `branchName` provided and matches an existing local/remote branch → checkout that branch into a new worktree
- If `branchName` provided and is new → create a new branch from HEAD
- If `branchName` omitted → auto-generate name (backward compat)

## UI Changes (New Session Dialog)

- Add text input between repo selector and YOLO checkbox
- Type-to-search: fetches `GET /branches` on repo selection, filters client-side as user types
- Dropdown shows:
  - Matching existing branches (local + remote)
  - "Create new: `<exact-text>`" option for the typed value
- Empty field = auto-generated name (current behavior)
- Supports branch names with slashes (e.g., `dy/feat/feature-name`)

## Resume Behavior

Unchanged: `claude --continue` in the worktree directory.

## Directory Naming

- Branch name `/` → `-` for the filesystem directory
- Example: `dy/feat/my-feature` → `.worktrees/dy-feat-my-feature/`
- Actual branch name preserved in metadata

## Files to Change

| File | Changes |
|------|---------|
| `server/index.ts` | New `/branches` endpoint, update `POST /sessions` (git worktree add logic), update `GET /worktrees` (scan `.worktrees/`), update `DELETE /worktrees`, add gitignore helper |
| `server/watcher.ts` | Watch `.worktrees/` instead of `.claude/worktrees/` |
| `server/sessions.ts` | Remove `--worktree` flag, spawn plain `claude` with cwd |
| `public/index.html` | Add branch input + dropdown to New Session dialog |
| `public/app.js` | Type-to-search logic, fetch branches, pass `branchName` to API |
| `public/styles.css` | Styling for branch input and dropdown |

## Edge Cases

- **Duplicate directory names**: append short timestamp suffix if dir already exists
- **Invalid branch names**: reject names that fail `git check-ref-format`
- **No remotes**: type-to-search still works for creating new branches (local-only)
- **Worktree already exists for branch**: git will error; surface this to the user
