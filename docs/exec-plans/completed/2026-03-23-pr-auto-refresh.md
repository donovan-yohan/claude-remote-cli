# PR Auto-Refresh Implementation Plan

> **Status**: Completed | **Created**: 2026-03-23
> **Design**: `docs/design-docs/2026-03-23-pr-auto-refresh-design.md`

## Progress

- [x] Task 1: Add `resolveGitDir` helper to `server/watcher.ts`
- [x] Task 2: Add `RefWatcher` class to `server/watcher.ts`
- [x] Task 3: Wire `RefWatcher` in `server/index.ts`
- [x] Task 4: Handle `ref-changed` event in `frontend/src/App.svelte`
- [x] Task 5: Build and verify (371 tests pass, clean build)

Note: Task 1 (refresh button in PrTopBar.svelte) is already implemented.

---

### Task 1: Add `resolveGitDir` helper to `server/watcher.ts`

**File:** `server/watcher.ts`
**What:** Add an exported `resolveGitDir(cwdPath)` function that handles both regular repos (`.git` is a directory) and worktrees (`.git` is a file pointing to the git dir). For worktrees, also follow the `commondir` file to find the main repo's git dir where remote refs live.

**Acceptance:**
- Returns the git dir path for regular repos
- Returns the main repo's git dir for worktrees (following `commondir`)
- Returns `null` if no `.git` found

### Task 2: Add `RefWatcher` class to `server/watcher.ts`

**File:** `server/watcher.ts`
**What:** New class following the `BranchWatcher` pattern. Key behaviors:
- `rebuild(entries: Array<{cwdPath, branch}>)`: clears all watchers/timers, then for each entry:
  - Resolve upstream ref via `execFile('git', ['rev-parse', '--symbolic-full-name', '@{u}'], {cwd})` — skip if no upstream
  - Use `resolveGitDir` to find the correct git dir (handling worktrees via `commondir`)
  - Watch the upstream ref file (loose ref) if it exists
  - Watch the remote's ref directory (e.g. `refs/remotes/origin/`) for new ref creation
  - Seed `_lastSha` via `execFile('git', ['rev-parse', upstreamRef], {cwd})`
- On `fs.watch` trigger: debounce 300ms per key, run `git rev-parse`, compare SHA (treating failures as `null`), emit callback if changed
- `close()`: close all watchers, clear all timers

**Acceptance:**
- Follows same patterns as `BranchWatcher` (debounce, error swallowing, `close()` cleanup)
- Uses `execFile` exclusively (no shell interpolation)
- Skips entries with no upstream tracking ref
- Handles ref deletion (rev-parse failure → null SHA)

### Task 3: Wire `RefWatcher` in `server/index.ts`

**File:** `server/index.ts`
**What:**
- Import `RefWatcher` from `./watcher.js`
- Instantiate with callback that calls `broadcastEvent('ref-changed', { cwdPath, branch })`
- Create `rebuildRefWatcher()` function that builds entries from `sessions.list()`
- Call `rebuildRefWatcher()` on init
- Wire to `sessions.onSessionCreate()` and `sessions.onSessionEnd()`
- Also call `rebuildRefWatcher()` inside the existing `branchWatcher` callback
- Add `refWatcher.close()` to the shutdown handler alongside `branchWatcher.close()`

**Acceptance:**
- RefWatcher rebuilds when sessions are created/destroyed/branch-switched
- `ref-changed` events are broadcast to all connected WS clients
- Clean shutdown

### Task 4: Handle `ref-changed` event in `frontend/src/App.svelte`

**File:** `frontend/src/App.svelte`
**What:**
- Add a `refChangedTimers` Map outside the event socket handler
- In the event socket handler, add a case for `msg.type === 'ref-changed'`
- On receipt: coalesce by `cwdPath` key — cancel any existing timer, set new 5000ms timer
- When timer fires: `queryClient.invalidateQueries({ queryKey: ['pr'] })` and `queryClient.invalidateQueries({ queryKey: ['ci-status'] })`

**Acceptance:**
- Multiple rapid `ref-changed` events for the same workspace produce only one refetch
- Different workspaces get independent timers
- PR and CI queries are invalidated after 5s delay

### Task 5: Build and verify

**What:** Run `npm run build` to ensure TypeScript compilation and Vite frontend build succeed with no errors.

**Acceptance:**
- Clean build with no type errors
- No new warnings (existing chunk size warning is acceptable)
