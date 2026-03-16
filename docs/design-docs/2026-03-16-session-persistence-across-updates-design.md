# Session Persistence Across Updates

**Created:** 2026-03-16
**Status:** Draft

## Problem

When the server auto-updates via `POST /update`, it calls `process.exit(0)` and launchd/systemd restarts it. All active sessions are lost — PTY processes die, scrollback buffers vanish, and users must manually restart their agent conversations.

## Goal

Restore all active sessions after an auto-update so users experience minimal disruption. Agents in progress will be interrupted but can resume their conversations.

## Design

### Pre-Exit Serialization

When `POST /update` triggers a restart, before calling `process.exit(0)`:

1. Serialize all active sessions to `~/.config/claude-remote-cli/pending-sessions.json`
2. Persist each session's scrollback buffer to `~/.config/claude-remote-cli/scrollback/<sessionId>.buf`
3. Respond to client with `{ ok: true, restarting: true }`
4. Exit after 1 second (existing behavior)

#### Serialized Session Schema

```json
{
  "version": 1,
  "timestamp": "2026-03-16T...",
  "sessions": [
    {
      "id": "a1b2c3d4e5f6g7h8",
      "type": "worktree" | "repo",
      "agent": "claude" | "codex" | null,
      "repoPath": "/path/to/repo",
      "name": "session name",
      "useTmux": true,
      "tmuxSessionName": "claude-remote-a1b2c3d4",
      "cwd": "/path/to/working/dir",
      "customCommand": "bash" | null
    }
  ]
}
```

`agent: null` with `customCommand` indicates a plain terminal session.

### Post-Startup Restoration

On server boot, check for `pending-sessions.json`. If present:

| Session Type | Restoration Strategy |
|---|---|
| **Tmux agent** | Re-attach to surviving tmux session by name |
| **Non-tmux agent** | Re-spawn with `--continue` (Claude) / `resume --last` (Codex) |
| **Tmux terminal** | Re-attach to surviving tmux session by name |
| **Non-tmux terminal** | Re-spawn shell in same cwd |

For each session:

1. Recreate the session entry in the `sessions` Map using the **original session ID**
2. Load scrollback from `scrollback/<sessionId>.buf` into the session's scrollback array
3. Attach PTY event handlers (idle detection, scrollback accumulation, cleanup on exit)
4. Delete the scrollback file after loading

After all sessions are restored, delete `pending-sessions.json`.

### Session ID Preservation

Restored sessions keep their original IDs. The frontend auto-reloads after an update and reconnects to `/ws/:sessionId` — same ID means seamless reconnection with no mapping logic.

### Scrollback Persistence

Each session's scrollback buffer (capped at 256KB) is written to disk as a plain text file before exit. On restore, the buffer is loaded back into memory and replayed to reconnecting WebSocket clients via the existing scrollback replay mechanism in `ws.ts`.

### Tmux Session Discovery

For tmux-wrapped sessions, the tmux server process survives the Node.js exit. On restore:

1. Check if the tmux session still exists (`tmux has-session -t <name>`)
2. If yes: create a new PTY that attaches to it (`tmux attach-session -t <name>`)
3. If no (tmux server also died): fall back to the non-tmux restoration strategy

### Edge Cases

- **Stale pending file:** If the server crashes during restore, `pending-sessions.json` could persist. Add a `timestamp` field and ignore files older than 5 minutes.
- **Scrollback file missing:** Restore the session anyway with empty scrollback. Log a warning.
- **Tmux session gone:** Fall back to re-spawning with continue args (agent) or fresh shell (terminal).
- **Multiple rapid updates:** Each update overwrites the pending file — only the latest state matters.
- **Manual restart (no update):** The pending file is only written during the update flow, not on normal shutdown. Normal `kill`/restart loses sessions as before. A future enhancement could add graceful shutdown persistence.

## Affected Modules

| Module | Changes |
|---|---|
| `server/sessions.ts` | Add `serializeAll()` and `restoreFromDisk()` functions |
| `server/index.ts` | Call `restoreFromDisk()` on startup; call `serializeAll()` before update exit |
| `server/config.ts` | May need helper for scrollback directory path |

## Non-Goals

- Keeping agents running uninterrupted during updates (tmux sessions achieve this naturally, but non-tmux sessions will be interrupted)
- Persisting sessions across manual server restarts (only update-triggered restarts)
- Persisting session history long-term (scrollback files are ephemeral, deleted after restore)
