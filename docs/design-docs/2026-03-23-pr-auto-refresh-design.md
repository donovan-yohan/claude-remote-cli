---
status: implemented
---
# PR Auto-Refresh Design

**Date:** 2026-03-23
**Status:** Implemented

## Problem

The PR top bar shows stale data. PR info (diff stats, CI status, merge state) is fetched from GitHub via `gh` CLI and cached by TanStack Query (60s for PR, 30s for CI). Between cache windows, users have no way to manually refresh and no mechanism detects when a local push or fetch has changed remote state.

Note: This feature covers **local git operations** (push, fetch, pull). GitHub-side changes (teammate pushes, CI completion, review updates) are covered by existing mechanisms: TanStack Query `refetchOnWindowFocus`, cache expiry, and the new manual refresh button.

## Solution

Two complementary features:

1. **Manual refresh button** — small icon in the PR top bar that refetches PR + CI data on click
2. **Automatic ref-change detection** — backend watches git remote tracking refs, frontend auto-refetches when a push or fetch is detected

## Feature 1: Manual Refresh Button (already implemented)

A refresh icon button added to `bar-right` in `PrTopBar.svelte`, before the action buttons. Calls `prQuery.refetch()` and `ciQuery.refetch()` on click. SVG spins while either query is fetching. Disabled during fetch to prevent double-clicks.

## Feature 2: RefWatcher — Automatic PR Data Sync

### Architecture

New `RefWatcher` class in `server/watcher.ts`, following the same pattern as `WorktreeWatcher` and `BranchWatcher`.

### What to watch

Resolve each active session's upstream tracking ref via `git rev-parse --symbolic-full-name @{u}` (e.g. `refs/remotes/origin/feature-x`). This handles non-`origin` remotes correctly. Sessions with no upstream (detached HEAD, unpushed branches) are skipped — no watcher is created for them.

Also watch the upstream remote's ref directory (e.g. `refs/remotes/origin/`) to detect new remote tracking refs being created (first push of a new branch).

### Data flow

```
git push (or fetch/pull)
  → upstream tracking ref file touched (e.g. .git/refs/remotes/origin/<branch>)
  → fs.watch fires
  → 300ms debounce (collapse rapid/spurious events)
  → execFile('git', ['rev-parse', upstreamRef]) (~5ms, local, no shell)
    → if rev-parse fails (ref deleted/pruned): treat as null SHA
  → compare SHA against last-known value for this branch
    → unchanged: swallow silently (spurious fs.watch event)
    → changed (including non-null → null): emit 'ref-changed' with { cwdPath, branch }
  → index.ts receives event, calls broadcastEvent('ref-changed', { cwdPath, branch })
  → frontend App.svelte receives WS message
  → coalesce: replace any pending 5s timer for this workspace
  → after 5000ms, invalidate PR + CI queries
  → PrTopBar silently refetches
```

### RefWatcher class

```typescript
// In server/watcher.ts

export type RefChangeCallback = (cwdPath: string, branch: string) => void;

export class RefWatcher {
  private _watchers: fs.FSWatcher[];
  private _debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  private _lastSha: Map<string, string | null>;  // key: "cwdPath:branch", null = ref deleted
  private _callback: RefChangeCallback;

  constructor(callback: RefChangeCallback);

  /**
   * Rebuild watchers for the given set of active branches.
   * Clears all existing watchers and pending timers before re-watching.
   * Called when sessions are created/deleted or branches switch.
   */
  rebuild(entries: Array<{ cwdPath: string; branch: string }>): void;

  close(): void;
}
```

**`rebuild(entries)`:**
- Close all existing watchers and clear all pending debounce timers
- For each entry:
  - Resolve the upstream ref via `execFile('git', ['rev-parse', '--symbolic-full-name', '@{u}'])` in the entry's `cwdPath`
  - If no upstream exists (command fails), skip this entry
  - Resolve the git dir (handling worktrees — see below)
  - Watch the upstream ref file if it exists as a loose ref
  - Watch the remote's ref directory to catch newly created refs
- Seed `_lastSha` with current SHA via `execFile('git', ['rev-parse', upstreamRef])`

**On `fs.watch` trigger:**
- Debounce 300ms per `cwdPath:branch` key
- Run `execFile('git', ['rev-parse', upstreamRef])` in the entry's `cwdPath`
- If `rev-parse` fails (ref deleted/pruned), treat as `null`
- Compare against `_lastSha`:
  - If same, swallow silently
  - If different (including non-null → null transition), update `_lastSha` and call `_callback(cwdPath, branch)`

### Wiring in `index.ts`

```typescript
const refWatcher = new RefWatcher((cwdPath, branch) => {
  broadcastEvent('ref-changed', { cwdPath, branch });
});

// Build watch list from active sessions
function rebuildRefWatcher() {
  const entries = sessions.list()
    .filter(s => s.branchName)
    .map(s => ({ cwdPath: s.cwd, branch: s.branchName }));
  refWatcher.rebuild(entries);
}

rebuildRefWatcher();

// Rebuild when sessions are created or destroyed
sessions.onSessionCreate(() => rebuildRefWatcher());
sessions.onSessionEnd(() => rebuildRefWatcher());

// Also rebuild inside the existing branchWatcher callback (after updating session branchName)
```

All subprocess calls use `execFile` (not `exec` or shell interpolation). Branch names are passed as array arguments, never interpolated into shell strings.

### Frontend handling in `App.svelte`

Add a new case to the event socket handler with per-workspace timer coalescing:

```typescript
const refChangedTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ... inside event socket handler:
} else if (msg.type === 'ref-changed' && msg.cwdPath) {
  const key = msg.cwdPath as string;
  // Coalesce: cancel any pending timer for this workspace
  const existing = refChangedTimers.get(key);
  if (existing) clearTimeout(existing);
  refChangedTimers.set(key, setTimeout(() => {
    refChangedTimers.delete(key);
    queryClient.invalidateQueries({ queryKey: ['pr'] });
    queryClient.invalidateQueries({ queryKey: ['ci-status'] });
  }, 5000));
}
```

This ensures bursty pushes to the same workspace produce only one refetch (the timer resets on each event). Different workspaces get independent timers.

### Git dir resolution for worktrees

Worktree checkouts have a `.git` *file* (not directory) pointing to the actual git dir. The RefWatcher must handle this:

```typescript
function resolveGitDir(cwdPath: string): string | null {
  const dotGit = path.join(cwdPath, '.git');
  const stat = fs.statSync(dotGit, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isDirectory()) return dotGit;
  // Worktree: .git is a file containing "gitdir: <path>"
  const content = fs.readFileSync(dotGit, 'utf-8').trim();
  const match = content.match(/^gitdir:\s*(.+)$/);
  return match ? path.resolve(cwdPath, match[1]) : null;
}
```

For worktrees, remote refs live in the *main* repo's `.git/refs/remotes/`, not in the worktree's git dir. The watcher must resolve up to the main repo's git dir to find the right ref files. This can be done by following the `commondir` file in the worktree's git dir.

### Cleanup

`refWatcher.close()` called alongside `branchWatcher.close()` during server shutdown. The `close()` method clears all `fs.watch` handles and all pending debounce timers.

### Out of scope (v1)

- **Watching base branch refs** — base branch changes can affect mergeability, but adds complexity. Manual refresh covers this.
- **Packed refs fallback** — `git push` always writes a loose ref. Packed-refs-only branches are rare and would add significant parsing complexity.
- **CI polling while checks are pending** — CI status changes happen on GitHub's side, not locally. Existing cache TTL (30s) and manual refresh cover this.
- **GitHub webhook integration** — would cover teammate pushes and CI completion but requires webhook infrastructure. Future consideration.

## Rate limiting analysis

- `fs.watch` events debounced at 300ms → collapses rapid ref writes
- SHA comparison via local `git rev-parse` filters spurious `fs.watch` events (macOS is noisy)
- Frontend coalesces per-workspace timers → bursty pushes produce one refetch
- 5s frontend delay prevents hitting GitHub before data propagates
- Only remote ref changes trigger API calls (local commits filtered out)
- Sessions with no upstream tracking ref are skipped entirely
- Worst case: 1 push per branch × (1 `gh pr view` + 1 `gh pr checks` + 1 GraphQL) = 3 API calls per push
- GitHub rate limit: 5,000 requests/hour — would need ~1,600 pushes/hour to approach

## Files to modify

| File | Change |
|------|--------|
| `server/watcher.ts` | Add `RefWatcher` class and `resolveGitDir` helper |
| `server/index.ts` | Instantiate RefWatcher, wire to broadcastEvent, rebuild on session/branch changes |
| `frontend/src/App.svelte` | Handle `ref-changed` WS event with 5s coalesced query invalidation |
| `frontend/src/components/PrTopBar.svelte` | Already done — refresh button |
