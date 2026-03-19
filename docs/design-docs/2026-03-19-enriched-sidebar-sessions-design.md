# Design: Enriched Sidebar Session Rows

> **Date**: 2026-03-19
> **Status**: Draft
> **Scope**: Frontend (WorkspaceItem, Sidebar, session state, ui state) + Server (new metadata endpoint, git.ts additions)

## Problem

Sidebar session rows are single-line items showing only a status dot and display name. Users must click into a session to see its branch, PR status, diff stats, or last activity. The Conductor-style sidebar shows this metadata inline, making workspace navigation faster and more informed.

## Design

### Enriched Row Layout

Each session and inactive worktree row becomes two lines:

```
● session-display-name              +55 -12
  worktree-name · PR #123 · 5m        ···
```

**Line 1 (primary):** Status dot + display name + diff stats badge (right-aligned)
**Line 2 (secondary):** Worktree name + PR number (if applicable) + relative time + context menu

- Diff stats badge: green `+N` and red `-N` in a compact inline badge. Only rendered when data is available (non-zero additions or deletions). Omitted entirely when no data cached or all zeros.
- PR number: shown as `PR #123` when a PR exists for the branch. Omitted otherwise.
- Worktree name: `session.worktreeName` — the mountain name or branch shortname. Omitted for repo sessions where it would duplicate the display name.
- Relative time: derived from `lastActivity` timestamp.
- All line 2 items use CSS `text-overflow: ellipsis` — worktree name truncates first since it's the flexible element; PR# and time are fixed-width and never truncate.

### Diff Stats Source

Two-tier fallback:
1. **PR exists** → use `additions`/`deletions` from `gh pr view` (already available via `getPrForBranch` in `git.ts`)
2. **No PR** → use uncommitted working tree changes via `git diff --shortstat`
3. **Both fail** (not a git repo, git unavailable, permission error) → omit diff badge entirely. `SessionMeta.additions`/`deletions` default to `0`; badge only renders when either is non-zero.

### Relative Time Format

Modify existing `formatRelativeTime()` in `utils.ts` to use the shorter sidebar-friendly format:

| Condition | Format | Example |
|-----------|--------|---------|
| < 60 seconds | `Ns` | `10s` |
| < 60 minutes | `Nm` | `5m` |
| < 24 hours | `Nh` | `2h` |
| >= 1 day | `DD/MM/YYYY` | `19/03/2026` |

The existing function returns `"just now"`, `"5m ago"`, `"yesterday"`, etc. Update it to use the compact format above. Check all existing callers — if any depend on the verbose format, extract a `formatRelativeTimeCompact()` variant instead.

A shared 30-second interval timer in `ui.svelte.ts` increments a reactive tick counter. Components reference `getTimeTick()` in `$derived` expressions so all displayed times re-derive together without per-row timers. Timer created once at module load, never cleaned up (lives for app lifetime). Acceptable performance for sidebar sizes (<100 items).

### Collapsible Workspaces

- Chevron indicator (`›` collapsed / `⌄` expanded) on the workspace header, left of the workspace name
- Clicking the header toggles collapse state
- When collapsed: session list, inactive worktrees, and "+ new worktree" are hidden; a muted count badge appears showing total items (sessions + inactive worktrees)
- Default: expanded

**Collapse state**: New `collapsedWorkspaces` Set in `ui.svelte.ts` — separate from the existing `sidebarCollapsed` boolean (which controls sidebar open/closed). Persisted to `localStorage` under a single key `claude-remote-collapsed-workspaces` as a JSON array of workspace paths.

### Inactive Worktrees

Same enriched two-line layout as active sessions. They have `branchName` and `lastActivity` already. PR/diff data included in the bulk metadata fetch on page load (keyed by worktree path instead of session ID). Not auto-refreshed since they're dormant — only refreshed when the user resumes the worktree (creating a new session).

## Data Flow

### Server: Session Metadata Cache

Cache lives in `sessions.ts` (session registry owns session-adjacent state, per ADR-001). Git operations delegated to `git.ts`.

```typescript
interface SessionMeta {
  prNumber: number | null;
  additions: number;   // 0 if unavailable
  deletions: number;   // 0 if unavailable
  fetchedAt: string;   // ISO timestamp; no TTL; refresh only on user action
}
```

**Cache**: In-memory `Map<string, SessionMeta>` keyed by session ID (active sessions) or worktree path (inactive worktrees). Populated lazily.

**New endpoint**: `GET /sessions/:id/meta` — returns cached `SessionMeta`. If cache miss, fetches synchronously (first call), caches, and returns. Returns `null` fields gracefully if git/gh commands fail (never throws to client).

**Refresh trigger**: When frontend selects/resumes a session, it calls `GET /sessions/:id/meta?refresh=true` which re-fetches from git/GitHub and updates cache.

**Git diff fallback**: New function in `git.ts`:
```typescript
export async function getWorkingTreeDiff(repoPath: string): Promise<{ additions: number; deletions: number }>
```
Runs `git diff --shortstat` and parses output. Returns `{ additions: 0, deletions: 0 }` on any error (does not throw).

### Server: Bulk Metadata for Sidebar

To avoid N+1 requests on page load:

`GET /sessions/meta` — returns all cached metadata for active sessions and inactive worktrees.

Response format:
```json
{
  "session-abc123": { "prNumber": 123, "additions": 55, "deletions": 12, "fetchedAt": "..." },
  "session-def456": { "prNumber": null, "additions": 8, "deletions": 3, "fetchedAt": "..." },
  "/path/to/worktree": { "prNumber": 42, "additions": 100, "deletions": 20, "fetchedAt": "..." }
}
```

Called once during `refreshAll()`. Uses cached values — does not trigger fresh git/gh fetches (those happen on individual session select).

### Frontend: State

Extend session state in `sessions.svelte.ts` with a new reactive map:

```typescript
let sessionMeta = $state<Map<string, SessionMeta>>(new Map());
```

Populated by `fetchAllSessionMeta()` called as the last step of `refreshAll()`. Individual entries refreshed on session select.

Exported: `getSessionMeta(id: string): SessionMeta | undefined` as a standalone function (same pattern as `getSessionStatus()`).

### Frontend: Collapse State

New in `ui.svelte.ts`:

```typescript
let collapsedWorkspaces = $state<Set<string>>(loadFromLocalStorage());
```

Functions: `toggleWorkspaceCollapse(path)`, `isWorkspaceCollapsed(path)`.
Persisted to `localStorage` on every toggle.

### Frontend: App Integration

- `refreshAll()` in `sessions.svelte.ts`: append `fetchAllSessionMeta()` call at the end
- `handleSelectSession()` in `App.svelte`: call `fetchSessionMeta(id, { refresh: true })` after setting active session ID (non-blocking, fires and forgets)

## Component Changes

### WorkspaceItem.svelte

- Workspace header: add chevron left of initial block + count badge when collapsed
- Session rows: restructure from single-line flex to two-line layout (primary row + secondary row)
- Import `getSessionMeta` for diff stats and PR number
- Import `formatRelativeTime` + `getTimeTick` for reactive time display
- Import collapse state from UI store
- Inactive worktree rows: same two-line layout, keyed by worktree path for meta lookup

### Sidebar.svelte

- No structural changes — WorkspaceItem handles rendering
- Pass collapse callbacks through to WorkspaceItem

## Edge Cases

- **No git repo**: Workspaces with `isGitRepo: false` skip diff stats and PR number entirely. Only time is shown.
- **GitHub CLI not installed**: `getPrForBranch` already handles this (returns null). Diff stats fall back to `git diff --shortstat`.
- **Long worktree names**: CSS `text-overflow: ellipsis` on the worktree name span. PR# and time are flex-shrink: 0.
- **Multiple sessions same branch**: Each gets its own meta entry keyed by session ID, but they share the same underlying git data.
- **Stale cache**: No TTL eviction — cache only refreshes on user action (session select) or page load. Intentional to avoid background GitHub API calls.
- **Both diff sources fail**: Badge omitted. `additions`/`deletions` stay at 0.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/WorkspaceItem.svelte` | Two-line rows, collapse chevron, diff badge, relative time |
| `frontend/src/lib/state/sessions.svelte.ts` | `sessionMeta` map, `getSessionMeta()`, `fetchAllSessionMeta()` in `refreshAll()` |
| `frontend/src/lib/state/ui.svelte.ts` | `collapsedWorkspaces` Set + localStorage persistence, `getTimeTick()` counter |
| `frontend/src/lib/utils.ts` | Update `formatRelativeTime()` to compact format (or add variant) |
| `frontend/src/lib/api.ts` | `fetchAllSessionMeta()`, `fetchSessionMeta()` |
| `frontend/src/lib/types.ts` | `SessionMeta` interface |
| `server/git.ts` | `getWorkingTreeDiff()` function |
| `server/sessions.ts` | Meta cache map, `getSessionMeta()`, `getAllSessionMeta()` |
| `server/index.ts` | `GET /sessions/meta`, `GET /sessions/:id/meta` routes |
| `frontend/src/App.svelte` | Call `fetchSessionMeta(id, refresh)` on session select |
