# Bug Analysis: Sidebar Session Model — 1:1 Session-to-Row Instead of 1:1 Folder-to-Row

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: Full stack — server session creation, frontend sidebar rendering, session-to-tab mapping

## Symptoms
1. **No persistent "default" session for main repo** — when a repo session is killed, it disappears entirely from the sidebar. Should always exist (active or inactive).
2. **Duplicate sidebar entries** — clicking "+" in the tab bar opens NewSessionDialog which creates a new `type: 'repo'` session via `POST /sessions/repo`. Each creates a separate sidebar row, leading to N identical entries for the same repo folder.
3. **Sidebar shows 1 row per session** — but should show 1 row per folder (repo root or worktree). Multiple sessions for the same folder should only appear as tabs within that folder's entry.
4. **Branch auto-rename not working** — separate issue noted but not root-caused here (previously analyzed in `2026-03-18-branch-auto-rename-not-implemented-bug-analysis.md`).

## Reproduction Steps
1. Add a workspace (e.g. `claude-remote-cli`)
2. Click the "+" button on the workspace header or tab bar "+" → creates a session
3. Click "+" again → creates another session at the same repo path
4. Sidebar shows 2 entries for the same folder (both named `claude-remote-cli`)
5. Kill one session → it disappears entirely (no inactive state)

## Root Cause

### Issue 1: No duplicate prevention for repo-level sessions

**`POST /sessions/repo` (server/index.ts:728-780)** has a comment on line 752: `"Multiple sessions per repo allowed (multi-tab support)"` — it intentionally skips uniqueness checks and always creates a new session. Every "+" click produces a new session = a new sidebar row.

In contrast, `POST /sessions` (the worktree path, line 618-620) checks `findRepoSession()` and returns 409 for duplicate repo sessions — but only on the worktree creation flow, not the direct repo session flow.

### Issue 2: Sidebar renders 1 row per session, not 1 row per folder

**WorkspaceItem.svelte:179-196** iterates `sessions` and renders one `<li>` per session:
```svelte
{#each sessions as session (session.id)}
  <li class="session-row">...</li>
{/each}
```

There is no grouping layer. If 3 sessions exist for the same `repoPath`, 3 rows appear.

### Issue 3: No persistent "default" entry for the repo root

When all sessions for a repo path are killed, that path has zero sessions. The sidebar shows nothing for that folder. The current model only shows:
- Active sessions (with PTY processes)
- Inactive worktrees (git worktrees with no active session)

There is no concept of a "persistent folder entry" that survives session kills. The repo root is not a git worktree (it's the main working tree), so it doesn't appear in the inactive worktrees list.

**Sidebar.svelte:118-124** computes:
```
activeSessions = getSessionsForWorkspace(workspace.path)  // sessions with matching repoPath
inactiveWorktrees = worktrees where no active session exists
```

The repo root never appears in `inactiveWorktrees` because `sessionState.worktrees` only contains git worktrees (from `git worktree list`), not the main working tree.

### Issue 4: Tab bar correctly groups by folder, but sidebar doesn't

**App.svelte:281-284** already groups tabs correctly:
```typescript
workspaceSessions = allWorkspaceSessions.filter(s => s.repoPath === activeSession.repoPath)
```

This shows only sessions in the **same directory** as the active session in the tab bar. The sidebar should use the same grouping principle — but it doesn't.

## Evidence

| Component | Current Behavior | Expected Behavior |
|-----------|-----------------|-------------------|
| `POST /sessions/repo` (index.ts:752) | Always creates new session | Should reuse or allow multi-tab within single sidebar entry |
| `WorkspaceItem.svelte:179` | 1 row per session | 1 row per unique `repoPath` |
| `Sidebar.svelte:118-119` | `activeSessions` = flat list | Should be grouped by `repoPath` |
| `sessions.findRepoSession()` (sessions.ts:206) | Only finds first repo session | Not used by `/sessions/repo` endpoint |
| Inactive worktrees | Only git worktrees | Should include main repo as persistent entry |
| `allowMultiple` param (api.ts:184) | Dead code — never checked | Was intended for this but never wired up |

## Impact Assessment
- **User confusion**: Multiple identical entries in sidebar for the same folder
- **No way to return to repo root**: Once a repo session is killed, the entry vanishes
- **Mental model mismatch**: Users expect the sidebar to represent folders, not processes
- **Tab bar is correct**: The per-directory grouping in `App.svelte:281` is the right model — sidebar doesn't match it

## Recommended Fix Direction

This is an **architectural change**, not a simple bug fix. The sidebar needs to shift from a session-centric model to a folder-centric model:

1. **Sidebar grouping**: Group sessions by `repoPath` before rendering. Each unique `repoPath` gets one sidebar row, regardless of how many sessions it has. The row's status indicator reflects the "most active" session in that group. Clicking the row selects the most recent session (or creates one if none exist).

2. **Persistent repo root entry**: The main repo folder (workspace path itself) always appears as the first entry under each workspace, even with zero active sessions. It serves as the "default" entry. Show it as inactive when no session exists.

3. **Session count indicator**: When a folder has multiple sessions (tabs), show a small count badge on the sidebar row (e.g., `repo-name [3]`). This replaces showing duplicate rows.

4. **Tab bar remains the multi-session UI**: The tab bar already correctly shows all sessions within the selected folder. This is the right place for multi-session management — not the sidebar.

5. **`POST /sessions/repo` change**: Remove the "always create" behavior. Instead, when creating a new tab for an existing folder, the server should still create a new session (for the PTY process), but the frontend should navigate to the existing sidebar entry and add a tab rather than creating a new sidebar row.

6. **Inactive worktrees + repo root**: Ensure the main working tree appears in the sidebar's inactive entries when it has no active session. Currently `sessionState.worktrees` (from `git worktree list`) includes the main worktree, but `Sidebar.svelte:120-123` filters it out with `wt.path.startsWith(workspace.path + '/')` which excludes the main worktree (whose path IS the workspace path).
