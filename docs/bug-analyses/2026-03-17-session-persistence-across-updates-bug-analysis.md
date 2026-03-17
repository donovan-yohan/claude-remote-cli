# Bug Analysis: Sessions Lost After Auto-Update Restart

> **Status**: Confirmed | **Date**: 2026-03-17
> **Severity**: High
> **Affected Area**: `server/sessions.ts`, `server/index.ts` (session lifecycle + update flow)

## Symptoms

- After clicking "Update Now" in the frontend, the server updates and restarts
- All sessions (repos, worktrees, terminals) disappear from the UI
- Sessions are not preserved across the restart despite `serializeAll`/`restoreFromDisk` implementation

## Reproduction Steps

1. Start the server as a background service (`claude-remote-cli --bg`)
2. Open several sessions (repo, worktree, and/or terminal)
3. When an update is available, click "Update Now" in the frontend toast
4. Wait for the server to restart and the page to reload (5 seconds)
5. Observe: all sessions are gone

## Root Cause

Three compounding failures in the session persistence mechanism:

### Failure 1: Tmux orphan cleanup kills restored sessions (critical)

In `restoreFromDisk` (sessions.ts:470), restored sessions are created with `useTmux: false`:

```ts
const createParams: CreateParams = {
  // ...
  useTmux: false, // Don't re-wrap in tmux — either attaching to existing or using plain agent
};
```

This means restored sessions have `tmuxSessionName = ''` (sessions.ts:126), so they aren't included in `activeTmuxSessionNames()`.

Immediately after restore, the orphan cleanup (index.ts:1060-1073) runs:

```ts
const adoptedNames = activeTmuxSessionNames(); // empty — restored sessions have no tmuxSessionName!
const orphanedSessions = stdout.split('\n').filter(name => name.startsWith('crc-') && !adoptedNames.has(name));
for (const name of orphanedSessions) {
  execFileAsync('tmux', ['kill-session', '-t', name]).catch(() => {});
}
```

This kills the tmux sessions that `restoreFromDisk` just attached PTYs to, causing those PTYs to exit, triggering `sessions.delete(id)` in the exit handler.

### Failure 2: Restored PTY processes may exit immediately

For non-tmux sessions, `restoreFromDisk` spawns `claude --continue` or `codex resume --last`. These commands may fail or exit quickly if:
- The old agent process is still running (orphaned from `process.exit(0)` which doesn't call `gracefulShutdown`)
- The agent can't find a session to continue
- The working directory no longer exists

When the PTY exits, the exit handler at sessions.ts:268 fires `sessions.delete(id)`, removing the session before the frontend reloads.

### Failure 3: `gracefulShutdown` doesn't serialize (secondary)

The `gracefulShutdown` handler (index.ts:1075-1083) kills all sessions without calling `serializeAll`. This means:
- CLI `update` command (bin/claude-remote-cli.ts:76-102) — does `service.uninstall()` + `service.install()` which sends SIGTERM, triggering `gracefulShutdown` without serialization
- Any service manager restart outside the HTTP update flow loses all sessions

### Failure 4: No decoupling of session metadata from PTY lifecycle

Sessions only exist in the `Map` while their PTY is alive. The moment a PTY exits (for any reason), the session is deleted. There's no concept of a "disconnected" or "pending reconnect" session that persists in the UI while waiting for its PTY to be re-established.

## Evidence

- **sessions.ts:126**: `tmuxSessionName` is `''` when `useTmux` is false
- **sessions.ts:470**: `useTmux: false` hardcoded in restore
- **sessions.ts:492-498**: `activeTmuxSessionNames()` only returns names from sessions with non-empty `tmuxSessionName`
- **index.ts:1060-1073**: Orphan cleanup runs after restore, kills untracked tmux sessions
- **sessions.ts:268**: PTY exit handler unconditionally deletes session from map
- **index.ts:1075-1083**: `gracefulShutdown` kills sessions without serialization
- **bin/claude-remote-cli.ts:87-96**: CLI update path reinstalls service (SIGTERM) without serializing

## Impact Assessment

- **All sessions lost on every update** — the primary feature of session persistence is completely broken
- **Affects all session types**: repo, worktree, and terminal sessions
- **Both update paths broken**: HTTP `/update` (tmux cleanup race) and CLI `update` (no serialization)
- **User must manually recreate all sessions after every update**

## Recommended Fix Direction

A two-pronged approach:

1. **Decouple session metadata from PTY lifecycle** — Persist session metadata (id, type, agent, paths, display name, scrollback) to disk independently. Sessions should appear in the UI as "reconnecting" even if their PTY hasn't spawned yet. The session list should be driven by persisted state, not just the in-memory Map of live PTYs.

2. **Fix the restore mechanism**:
   - Pass `tmuxSessionName` through to restored sessions so orphan cleanup doesn't kill them
   - Add `serializeAll` to `gracefulShutdown` (before killing PTYs)
   - Add serialization to the CLI update path
   - Handle the case where restored PTYs exit immediately (keep session metadata, show as "disconnected")
