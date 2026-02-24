# Repo Sessions + Tabbed Sidebar Design

> Date: 2026-02-23
> Status: Approved

## Problem

The app currently only supports worktree-based sessions. Users should also be able to open Claude sessions directly in their root repo directories without creating a worktree. The sidebar needs to accommodate both session types.

## Decisions

- **Approach A** (new route + session type field) was chosen over extending the existing route or a full refactor
- Repo sessions: one active session per repo, user chooses fresh vs. `--continue`
- Sidebar: two tabs (Repos / Worktrees) with shared filters, counts in tab labels
- New-session dialog is tab-aware (hides branch input for repo sessions)
- Unit tests only for now; route-level integration tests deferred

## Data Model

Add `type: 'repo' | 'worktree'` to the `Session` interface in `server/types.ts`. Defaults to `'worktree'` for backwards compatibility.

`CreateParams` in `server/sessions.ts` gets an optional `type` field.

`SessionSummary` (returned by `list()`) includes `type`.

New helper: `findRepoSession(repoPath: string): SessionSummary | undefined` — scans active sessions for a repo-type session matching the given path. Used for the one-per-repo constraint.

## Backend

### New Route: `POST /sessions/repo`

```
Body: {
  repoPath: string       // required — absolute path to the git repo
  repoName?: string      // display name, falls back to last path segment
  continue?: boolean     // if true, pass --continue to Claude CLI
  claudeArgs?: string[]  // extra CLI args (e.g. --dangerously-skip-permissions)
}
```

Behavior:
1. Call `findRepoSession(repoPath)` — if exists, return 409 Conflict
2. Build command args: prepend `--continue` if `continue === true`, append `claudeArgs`
3. Call `sessions.create({ repoPath, repoName, cwd: repoPath, type: 'repo', command, args })`
4. No `git worktree add`, no branch creation, no worktree metadata

### Existing `POST /sessions` (unchanged behavior)

Continues to create worktrees. Now explicitly passes `type: 'worktree'` to `sessions.create()`, but the default handles it either way.

### `DELETE /sessions/:id` (no changes)

Killing a session SIGTERMs the PTY and removes from registry. Worktree cleanup is a separate concern (`DELETE /worktrees`). Repo sessions have no cleanup beyond the PTY kill.

## Frontend

### Tabbed Sidebar

Two tabs replace the current flat list header:

| Tab | Content |
|-----|---------|
| **Repos (N)** | Active repo sessions (status dots) above divider, idle repos (from `GET /repos`) below |
| **Worktrees (N)** | Active worktree sessions above divider, inactive worktrees (from `GET /worktrees`) below |

- Counts reflect items after filtering (root, repo, text filters still apply to both)
- Tab state persists during the session (not across page reloads)
- Default tab: Repos

### Repos Tab Behavior

- **Active repo session**: click to connect, shows rename button, shows kill button
- **Idle repo**: click opens new-session dialog pre-filled for that repo
- No context menu on idle repos (they aren't disposable)
- No "delete" action on repo sessions (killing the session is sufficient)

### Worktrees Tab Behavior

Identical to current behavior:
- Active worktree sessions: click to connect, rename/kill buttons
- Inactive worktrees: click to resume, right-click for context menu (resume yolo, delete)

### New Session Dialog (Tab-Aware)

**Opened from Repos tab:**
- Root select → Repo select (same cascade)
- "Continue previous conversation?" checkbox (maps to `continue: true`)
- No branch input
- Submit button: "New Session"
- Calls `POST /sessions/repo`

**Opened from Worktrees tab:**
- Existing behavior unchanged
- Root select → Repo select → Branch input with autocomplete
- Submit button: "New Worktree"
- Calls `POST /sessions`

The `+` button at the sidebar bottom inherits context from the currently active tab.

## Tests

Unit tests only (route-level deferred).

### `sessions.test.ts` additions

1. `type` defaults to `'worktree'` when not specified in `create()`
2. `type: 'repo'` is correctly set when passed to `create()`
3. `list()` output includes `type` field
4. `findRepoSession(repoPath)` returns existing repo session for matching path
5. `findRepoSession(repoPath)` returns undefined when no repo session exists
6. `findRepoSession(repoPath)` ignores worktree sessions at the same path

### `worktrees.test.ts` addition

7. Paths outside `.worktrees/` are valid (no false rejection for repo session paths)

## Non-Goals

- Route-level / HTTP integration tests (deferred)
- E2E / Playwright tests
- Persisting tab state across page reloads
- Repo session metadata persistence (no equivalent of worktree metadata files)
