---
status: implemented
date: 2026-03-23
---

# Design: Separate Session and Worktree Concerns

## Problem Statement

Sessions and worktrees are tangled. `POST /sessions` is a 200-line endpoint that creates git worktrees, manages mountain name counters, detects stale branches, redirects to existing worktrees, AND spawns PTY processes. The session data model (`type: 'repo' | 'worktree' | 'terminal'`) conflates *where* a session runs with *what* it is. Two separate mountain name counters (global vs per-workspace) desync, causing worktree creation failures that silently open the wrong dialog.

### Symptoms

- "+ new worktree" button broken for workspaces with existing worktrees (mountain name collision)
- `POST /sessions` duplicates worktree creation logic from `POST /workspaces/worktree`
- Session type `'worktree'` is meaningless with tabs — a session doesn't care that it's in a worktree
- `POST /sessions/repo` exists only because repo root sessions need different creation logic — but the difference is just `cwd`

## Design Principles

1. **Sessions don't manage worktrees.** A session is a PTY process in a directory. It doesn't create, detect, or clean up git worktrees.
2. **Worktrees don't manage sessions.** The worktree API creates/deletes git worktrees. It doesn't spawn processes.
3. **One counter, one owner.** Mountain names are per-workspace, managed solely by the worktree API.
4. **Session type = process type.** `'agent' | 'terminal'`, not `'repo' | 'worktree' | 'terminal'`.

## New Data Model

### Session

```
Session {
  id: string
  type: 'agent' | 'terminal'          // what kind of process
  agent: AgentType                      // 'claude' | 'codex' (only for type='agent')
  workspacePath: string                 // which workspace this belongs to
  worktreePath: string | null           // which worktree (null = repo root)
  cwd: string                           // actual directory the PTY runs in
                                        //   = worktreePath ?? workspacePath
  displayName: string                   // user-visible tab name
  branchName: string                    // git branch (informational, not authoritative)
  createdAt: string
  lastActivity: string
  // ... PTY internals (pty, scrollback, useTmux, etc.) unchanged
}
```

**Key changes:**
- `type` is `'agent' | 'terminal'` — no more `'repo' | 'worktree'` distinction
- `workspacePath` is always the workspace root (foreign key to workspace)
- `worktreePath` is nullable — `null` means repo root, non-null means a worktree directory
- `cwd` is derived: `worktreePath ?? workspacePath`
- `repoPath` is renamed to `cwd` (it was always used as the working directory)
- `root` field removed — it was a legacy rootDirs concept, unused in v3

### Worktree (unchanged)

The `WorktreeInfo` type stays as-is. Worktrees are discovered by `git worktree list` and the filesystem watcher. They have no server-side registry — they're git's concern.

### Workspace (unchanged)

`Workspace { path, name, isGitRepo, defaultBranch }` stays as-is.

## New API Contracts

### Sessions

```
GET    /sessions                  — list all active sessions
POST   /sessions                  — create session
PATCH  /sessions/:id              — rename session
DELETE /sessions/:id              — kill session
POST   /sessions/:id/image        — upload clipboard image
```

**`POST /sessions` request body:**

```typescript
{
  workspacePath: string;               // required — which workspace
  worktreePath?: string | null;        // optional — null/omitted = repo root
  type?: 'agent' | 'terminal';        // default: 'agent'
  agent?: AgentType;                   // default: from workspace settings
  yolo?: boolean;                      // default: from workspace settings
  useTmux?: boolean;                   // default: from workspace settings
  claudeArgs?: string[];               // default: from workspace settings
  continue?: boolean;                  // default: auto-detect (.claude/ dir present)
  cols?: number;
  rows?: number;
  initialPrompt?: string;              // injected after agent reaches waiting-for-input
  needsBranchRename?: boolean;         // flag for mountain-name worktrees
  branchRenamePrompt?: string;
}
```

**What this endpoint does:**
1. Resolve session settings (agent, yolo, tmux, args) from workspace defaults + overrides
2. Determine `cwd` = `worktreePath ?? workspacePath`
3. Determine `--continue` behavior:
   - If `continue` is explicitly passed, use it
   - If `needsBranchRename` is true, don't continue (brand new worktree)
   - Otherwise, auto-detect: `.claude/` directory exists in `cwd` → continue
4. Build CLI args and spawn PTY
5. Return session summary

**What this endpoint does NOT do:**
- Create git worktrees
- Detect stale branches
- Check if a branch is already checked out elsewhere
- Manage mountain name counters
- Redirect to existing worktrees

**Eliminated endpoints:**
- `POST /sessions/repo` — merged into `POST /sessions` (just pass `worktreePath: null`)
- `POST /sessions/terminal` — merged into `POST /sessions` (pass `type: 'terminal'`)

### Worktrees

```
POST   /workspaces/worktree       — create worktree (existing, unchanged path)
DELETE /worktrees                  — delete worktree (existing, unchanged)
GET    /worktrees                  — list inactive worktrees (existing, unchanged)
```

**`POST /workspaces/worktree` changes:**

1. **Collision handling**: If the mountain name branch or directory already exists, auto-increment to the next available name (loop through MOUNTAIN_NAMES, max one full cycle).
2. **Stale branch detection** (moved from `POST /sessions`): If resuming an existing worktree whose branch is merged/at-base, create a fresh branch with `<mountain>-<timestamp>` suffix.
3. **Unified counter**: Per-workspace `nextMountainIndex` is the sole counter. Remove the global `config.nextMountainIndex` field. The `POST /sessions` endpoint no longer touches mountain names.
4. **Branch checkout**: The existing `branch` parameter continues to work for checking out a specific branch into a new worktree.

### Workspaces

No changes to workspace endpoints.

## Migration Path

### Server Changes

#### `server/index.ts` — Session endpoints

**`POST /sessions`**: Strip down to ~50 lines:
1. Validate `workspacePath` is a configured workspace
2. Resolve settings via `resolveSessionSettings()`
3. Compute `cwd = worktreePath ?? workspacePath`
4. Determine continue args (auto-detect or explicit)
5. Build CLI args, call `sessions.create()`
6. Return session summary

**`POST /sessions/repo`**: Delete. Callers use `POST /sessions` with `worktreePath: null`.

**`POST /sessions/terminal`**: Delete. Callers use `POST /sessions` with `type: 'terminal'`.

**`GET /sessions`**: Update `list()` return type to use new fields. Keep the live branch enrichment (it's read-only, not management).

#### `server/workspaces.ts` — Worktree endpoint

**`POST /workspaces/worktree`**: Add collision-retry loop:
```
for (let attempt = 0; attempt < MOUNTAIN_NAMES.length; attempt++) {
  const index = (settings.nextMountainIndex ?? 0) + attempt;
  const name = MOUNTAIN_NAMES[index % MOUNTAIN_NAMES.length];
  if (!branchExists(name) && !dirExists(name)) {
    // use this name
    setWorkspaceSettings({ nextMountainIndex: index + 1 });
    break;
  }
}
```

Move stale branch detection from `POST /sessions` to here.

#### `server/sessions.ts` — Session registry

Update `CreateParams` and internal `Session` type:
- Replace `type: SessionType` with `type: 'agent' | 'terminal'`
- Replace `repoPath` with `cwd`
- Add `workspacePath` and `worktreePath`
- Remove `root` field

Update `SerializedPtySession` for persistence compatibility (version 3 format with migration from v2).

#### `server/types.ts` — Type definitions

```typescript
// Before
export type SessionType = 'repo' | 'worktree' | 'terminal';

// After
export type SessionType = 'agent' | 'terminal';
```

Update `BaseSession`, `PtySession`, `SessionSummary` to use new fields.

Remove global `nextMountainIndex` from `Config` type.

#### `server/index.ts` — Remove global mountain counter

Delete the `config.nextMountainIndex` usage in `POST /sessions`. The worktree endpoint owns this entirely.

### Frontend Changes

#### `frontend/src/lib/types.ts`

```typescript
// Before
export interface SessionSummary {
  type: 'repo' | 'worktree' | 'terminal';
  repoPath: string;
  // ...
}

// After
export interface SessionSummary {
  type: 'agent' | 'terminal';
  workspacePath: string;
  worktreePath: string | null;
  cwd: string;
  // ...
}
```

#### `frontend/src/lib/api.ts`

- `createSession()` — update body to new contract, remove `repoPath`
- Delete `createRepoSession()` — callers use `createSession({ worktreePath: null })`
- Delete `createTerminalSession()` — callers use `createSession({ type: 'terminal' })`

#### `frontend/src/components/Sidebar.svelte`

Session grouping changes from `s.repoPath` to `s.worktreePath ?? s.workspacePath`:
```typescript
// Before
for (const s of activeSessions) {
  const existing = groups.get(s.repoPath);
  // ...
}

// After
for (const s of activeSessions) {
  const groupKey = s.worktreePath ?? s.workspacePath;
  const existing = groups.get(groupKey);
  // ...
}
```

#### `frontend/src/components/WorkspaceItem.svelte`

Update `groupDisplayName()` — check `s.type === 'agent'` instead of `s.type === 'repo'` for repo root detection. Use `s.worktreePath === null` to identify repo root sessions.

#### `frontend/src/App.svelte`

- `handleNewWorktree()`: Keep as-is (calls `createWorktree()` then `createSession()`)
- `handleQuickAgent()`: Call `createSession({ workspacePath, worktreePath: null, type: 'agent' })`
- `handleQuickTerminal()`: Call `createSession({ workspacePath, worktreePath: activeSession?.worktreePath, type: 'terminal' })`
- `handleCustomize()`: Update `CustomizeSessionDialog` to use new API
- Remove `handleFixConflicts()` worktree creation — it should call the worktree API first, then create a session

#### `frontend/src/components/dialogs/CustomizeSessionDialog.svelte`

Update `handleSubmit()` to call `createSession()` instead of `createRepoSession()`.

#### `frontend/src/lib/state/sessions.svelte.ts`

Update `getSessionsForWorkspace()`:
```typescript
// Before: path prefix matching
return sessions.filter(s => s.repoPath === workspacePath || s.repoPath.startsWith(workspacePath + '/'));

// After: explicit workspace field
return sessions.filter(s => s.workspacePath === workspacePath);
```

### Error Handling Fix

`handleNewWorktree` catch block (App.svelte): Log the error to console and show an error toast instead of silently opening the wrong dialog.

## What Moves Where

| Behavior | Before | After |
|----------|--------|-------|
| Mountain name generation | `POST /sessions` (global counter) + `POST /workspaces/worktree` (per-workspace counter) | `POST /workspaces/worktree` only (per-workspace counter with collision retry) |
| Stale branch detection | `POST /sessions` | `POST /workspaces/worktree` |
| Branch redirect (already checked out) | `POST /sessions` | Removed — caller decides via `POST /workspaces/worktree` response |
| `--continue` auto-detection | `POST /sessions` | `POST /sessions` (stays — it's a session concern) |
| Worktree directory creation | `POST /sessions` + `POST /workspaces/worktree` | `POST /workspaces/worktree` only |

## NOT in Scope

- **Worktree ID system**: Worktrees are identified by filesystem path, not assigned IDs. Path-based identification matches git's own model.
- **Workspace IDs**: Workspaces continue to use filesystem paths as identifiers.
- **REST nesting** (`/workspaces/:id/worktrees/:id/sessions`): Over-structured for this project size. Flat endpoints with query params are simpler.
- **Database persistence for sessions**: Sessions remain in-memory with update-time serialization.
- **Refactoring the hooks system**: Hooks reference `repoPath` internally but this is a pass-through — update field names but don't restructure.

## Test Impact

- Update `test/sessions.test.ts` — new `CreateParams` shape, remove `findRepoSession()`
- Update `test/workspaces.test.ts` — collision handling, stale branch detection
- Add test: mountain name collision retries to next available name
- Add test: `POST /sessions` with `worktreePath: null` replaces `POST /sessions/repo`
- Add test: `POST /sessions` with `type: 'terminal'` replaces `POST /sessions/terminal`
- Remove tests for worktree creation in `POST /sessions`

## Success Criteria

- `POST /sessions` is <60 lines, zero git awareness
- `POST /sessions/repo` and `POST /sessions/terminal` are deleted
- Mountain name counter is per-workspace only, with collision retry
- "+ new worktree" button works even when existing worktrees occupy earlier mountain names
- Sidebar grouping uses `workspacePath` + `worktreePath` instead of path prefix matching
- All existing tests pass (updated for new types)
- Session persistence (auto-update) works with new field names (v3 migration)
