# Plan: Session Persistence Across Updates

> **Status**: Active | **Created**: 2026-03-16
> **Design**: `docs/design-docs/2026-03-16-session-persistence-across-updates-design.md`

## Progress

- [x] Task 1: Add `SerializedSession` type and persistence helpers to `sessions.ts`
- [x] Task 2: Add `serializeAll()` — serialize sessions + scrollback to disk
- [x] Task 3: Add `restoreFromDisk()` — restore sessions on startup
- [x] Task 4: Wire into `index.ts` — call restore on boot, serialize before update exit
- [x] Task 5: Add tests for serialize/restore round-trip
- [x] Task 6: Verify build + existing tests pass

---

### Task 1: Add `SerializedSession` type and persistence helpers

**File:** `server/sessions.ts`

Add a `SerializedSession` interface capturing the fields needed for restoration:
```ts
interface SerializedSession {
  id: string;
  type: SessionType;
  agent: AgentType;
  root: string;
  repoName: string;
  repoPath: string;
  worktreeName: string;
  branchName: string;
  displayName: string;
  createdAt: string;
  lastActivity: string;
  useTmux: boolean;
  tmuxSessionName: string;
  customCommand: string | null;  // non-null for terminal sessions
  cwd: string;                   // working directory for respawn
}
```

Also add a `pendingSessionsPath(configDir)` and `scrollbackDir(configDir)` helper. The config directory is derived from `CONFIG_PATH` (dirname).

**Note:** We need to store `cwd` in the Session interface since it's not currently tracked after creation. Add `cwd: string` to the `Session` interface in `types.ts` and populate it during `create()`.

### Task 2: Add `serializeAll(configDir: string)`

**File:** `server/sessions.ts`

Export a function that:
1. Creates `scrollback/` dir under `configDir` if needed
2. For each session in the Map:
   - Write `scrollback/<id>.buf` with `session.scrollback.join('')`
   - Build a `SerializedSession` object
3. Write `pending-sessions.json` to `configDir` with `{ version: 1, timestamp: ISO, sessions: [...] }`

### Task 3: Add `restoreFromDisk(configDir: string, options)`

**File:** `server/sessions.ts`

Export a function that:
1. Check for `<configDir>/pending-sessions.json`; if missing, return
2. Parse JSON. If `timestamp` is older than 5 minutes, delete file and return
3. For each serialized session:
   a. **Tmux sessions**: check `tmux has-session -t <name>`. If alive, spawn a PTY attached to it (`tmux attach-session -t <name>`)
   b. **Non-tmux agent sessions**: respawn with `--continue` args (reuse existing `AGENT_CONTINUE_ARGS`)
   c. **Non-tmux terminal sessions**: respawn shell in `cwd`
   d. Load scrollback from `scrollback/<id>.buf` if it exists
   e. Register session in the Map with the **original ID**
   f. Attach PTY handlers (idle, scrollback, exit cleanup)
   g. Delete the scrollback file
4. Delete `pending-sessions.json`
5. Clean up `scrollback/` directory

**Key:** Use the existing `create()` internal patterns but with a predetermined ID. Either refactor `create()` to accept an optional `id` parameter, or extract the PTY spawn + handler attachment into an internal helper.

### Task 4: Wire into `index.ts`

**File:** `server/index.ts`

1. **On startup** (in `main()`, after `setupWebSocket`): call `sessions.restoreFromDisk(configDir)` where `configDir = path.dirname(CONFIG_PATH)`
2. **In `POST /update`**: before `process.exit(0)`, call `sessions.serializeAll(configDir)`. Also skip killing tmux sessions during update (currently `gracefulShutdown` kills them all).
3. **Tmux cleanup on startup**: The existing orphaned-tmux-cleanup block (lines 1048-1060) must NOT kill tmux sessions that are being restored. Reorder: restore first, then clean up only tmux sessions that weren't adopted.

### Task 5: Add tests

**File:** `test/sessions.test.ts` (extend existing)

Test the serialize/restore round-trip:
- `serializeAll` writes correct JSON and scrollback files
- `restoreFromDisk` reads them back, creates sessions with correct IDs
- Stale timestamp (>5 min) causes skip
- Missing scrollback file still restores session (empty scrollback)

These tests should mock the PTY spawn (since we can't actually spawn claude in tests).

### Task 6: Verify build + tests

Run `npm run build && npm test` to confirm everything compiles and passes.
