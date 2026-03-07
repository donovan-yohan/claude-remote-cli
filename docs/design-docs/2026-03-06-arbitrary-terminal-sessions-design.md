# Arbitrary Terminal Sessions

## Problem

Users need to run ad-hoc shell commands (git operations, package installs, file management) without starting a full coding agent session. Currently, every session spawns either Claude or Codex, which is overkill for simple terminal tasks.

## Design

### New Session Type: `'terminal'`

Add `'terminal'` to the `SessionType` union. Terminal sessions spawn `$SHELL` (user's default shell) with no agent wrappers, starting in `~` (home directory).

### Backend Changes

**`server/types.ts`** - Extend `SessionType`:
```typescript
export type SessionType = 'repo' | 'worktree' | 'terminal';
```

**`server/sessions.ts`** - The `create()` function already accepts a `command` parameter that overrides the agent command. Terminal sessions will pass:
- `command`: `process.env.SHELL || '/bin/sh'`
- `args`: `[]` (no agent args)
- `type`: `'terminal'`
- `repoPath`: `os.homedir()` (used as cwd)
- No metadata persistence (no `configPath`, no `worktreeName`)
- No retry logic (no `--continue` args to retry without)

**`server/index.ts`** - New endpoint `POST /sessions/terminal`:
- No required parameters (starts at `~` with default shell)
- Optional `cols`/`rows` for initial terminal size
- Returns standard session summary
- No uniqueness constraints (multiple terminals allowed)

### Frontend Changes

**`frontend/src/lib/state/ui.svelte.ts`** - Add `'terminals'` to `TabId`:
```typescript
export type TabId = 'repos' | 'worktrees' | 'terminals' | 'prs';
```

**`frontend/src/lib/types.ts`** - Extend `SessionSummary.type` to include `'terminal'`.

**`frontend/src/lib/api.ts`** - Add `createTerminalSession()` function.

**`frontend/src/components/SessionList.svelte`** - Add "Terminals" tab between "Worktrees" and "PRs":
- Tab shows count of active terminal sessions
- "+" button to create a new terminal session
- List of active terminal sessions only (no "Available" section)
- Terminal sessions filtered from repo/worktree tabs

**`frontend/src/components/SessionItem.svelte`** - Terminal sessions use the `active` variant with:
- A shell icon indicator (">_") instead of agent badge
- Display name: "Terminal" with incrementing counter ("Terminal 1", "Terminal 2", etc.)
- No git status, no branch info, no repo info
- Context menu: Rename, Kill

### What Terminal Sessions Are NOT

- No persistence of inactive terminals. When killed, they disappear completely.
- No resume/continue functionality.
- No worktree or git integration.
- No metadata storage.
- No idle attention tracking (terminal idle is expected behavior).

## Decisions

1. **Tab placement**: "Terminals" between "Worktrees" and "PRs" — it's a different concern from coding sessions, so it gets its own tab rather than mixing into Repos/Worktrees.
2. **No filters**: Terminal sessions don't have root/repo associations, so SessionFilters hides root/repo dropdowns when the Terminals tab is active.
3. **Display naming**: Auto-name as "Terminal 1", "Terminal 2", etc. based on creation order within the current server lifetime. Rename via context menu.
4. **Terminal counter**: Simple incrementing counter maintained in `sessions.ts` (not persisted — resets on server restart). Good enough since terminals are ephemeral.
5. **Shell resolution**: Use `$SHELL` from server process environment, fall back to `/bin/sh`. This matches what users expect from "open a terminal".
6. **No `CLAUDECODE` stripping**: Terminal sessions don't run Claude, so the env stripping is harmless but not necessary. Keep it for simplicity (same code path).
7. **Idle tracking**: Keep idle tracking enabled for terminals — it doesn't hurt and maintains consistency. But don't add terminal sessions to the attention set (no orange dot for idle terminals).

## Files Changed

| File | Change |
|------|--------|
| `server/types.ts` | Add `'terminal'` to `SessionType` |
| `server/sessions.ts` | Add terminal counter, export helper |
| `server/index.ts` | Add `POST /sessions/terminal` endpoint |
| `frontend/src/lib/types.ts` | Add `'terminal'` to `SessionSummary.type` |
| `frontend/src/lib/state/ui.svelte.ts` | Add `'terminals'` to `TabId` |
| `frontend/src/lib/api.ts` | Add `createTerminalSession()` |
| `frontend/src/components/SessionList.svelte` | Add Terminals tab, "+" button, terminal list |
| `frontend/src/components/SessionItem.svelte` | Handle terminal variant display |
| `frontend/src/components/SessionFilters.svelte` | Hide root/repo filters on Terminals tab |
| `frontend/src/lib/state/sessions.svelte.ts` | Filter terminals from attention tracking |
