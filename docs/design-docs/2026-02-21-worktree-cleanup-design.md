# Worktree Cleanup from UI

## Problem

Worktrees created via Claude Code persist in `.claude/worktrees/` indefinitely. Users can close sessions but cannot remove the underlying worktree directories. This leaves stale worktrees consuming disk space and cluttering the sidebar after PRs are merged or worktrees are accidentally created.

## Design

### API: `DELETE /worktrees`

**Request body:** `{ worktreePath: string, repoPath: string }`

Server-side sequence:
1. Validate `worktreePath` exists and lives inside a `.claude/worktrees/` directory
2. Check no active session uses this path — return `409 Conflict` if one does
3. Derive the branch name from the worktree directory name
4. Run `git worktree remove <worktreePath>` from the parent repo (`repoPath`)
5. Run `git worktree prune` in the parent repo
6. Run `git branch -D <branchName>` in the parent repo
7. Filesystem deletion triggers the existing `WorktreeWatcher` → broadcasts `worktrees-changed` to all clients
8. Return `200 { ok: true }` or error with message

**Error cases:**
- Active session on worktree → `409` with message "Close the session first"
- `git worktree remove` fails (uncommitted changes) → `500` with git's error message; no `--force`
- Path not inside `.claude/worktrees/` → `400` validation error

### Frontend: Context Menu + Confirmation Dialog

**Context menu** (new pattern):
- Long-press (mobile, ~500ms) or right-click (desktop) on inactive worktree items
- Positioned near the touch/click point
- Single option: "Delete worktree"
- Dismissed on outside click/tap or Escape

**Confirmation dialog** (native `<dialog>`, matches existing patterns):
- Header: "Delete worktree?"
- Body: worktree name + warning that branch will also be deleted
- Buttons: "Cancel" / "Delete"
- On confirm: `DELETE /worktrees` call
- UI updates automatically via `worktrees-changed` WebSocket event

### What changes

| Layer | File | Change |
|-------|------|--------|
| Server | `server/index.ts` | Add `DELETE /worktrees` endpoint |
| Frontend HTML | `public/index.html` | Add confirmation dialog, context menu container |
| Frontend CSS | `public/style.css` | Context menu and confirmation dialog styles |
| Frontend JS | `public/app.js` | Context menu logic, long-press/right-click handlers, delete API call |
| Tests | `test/` | Unit test for the new endpoint |

### Constraints

- Frontend remains ES5 vanilla JS (no build step)
- `git worktree remove` (not `--force`) so uncommitted work is protected
- Deletion blocked when session is active (no auto-kill)
- Branch is always deleted alongside the worktree (full cleanup)
