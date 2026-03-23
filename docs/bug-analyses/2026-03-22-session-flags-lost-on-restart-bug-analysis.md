# Bug Analysis: Session Flags Lost on Auto-Update Restart

> **Status**: Confirmed | **Date**: 2026-03-22
> **Severity**: Medium
> **Affected Area**: `server/sessions.ts` (serialization/restoration), `server/types.ts` (Session type)

## Symptoms
- After auto-update and restart, sessions that were running with `--dangerously-skip-permissions` (yolo mode) lose that flag — the restored session runs without yolo
- Custom `claudeArgs` configured per-workspace or passed at creation time are also lost
- The `continue` flag is coincidentally preserved (hardcoded in restore logic), but not because it was actually saved
- Terminal session state (shell history, running processes, environment) is lost entirely on non-tmux sessions

## Reproduction Steps
1. Start a worktree session with yolo mode enabled (either via workspace default or explicit toggle)
2. Confirm the session is running with `--dangerously-skip-permissions`
3. Trigger an auto-update (`POST /update`)
4. Wait for server restart and session restoration
5. Observe: the restored session no longer has yolo mode — it restarts with only `--continue`

## Root Cause

**The original session creation args are ephemeral — consumed once to spawn the PTY process and never stored on the Session object or serialized to disk.**

### Data flow trace:

1. **Frontend sends** `POST /sessions` with `yolo: true`, `claudeArgs: [...]`, `agent`, `useTmux`
2. **`resolveSessionSettings()`** (`config.ts:137-150`) merges request overrides with workspace defaults and global config
3. **Route handler** (`index.ts:848-851`) converts semantic flags to CLI args:
   ```ts
   const baseArgs = [
     ...(resolved.claudeArgs),
     ...(resolved.yolo ? AGENT_YOLO_ARGS[resolvedAgent] : []),
   ];
   ```
4. **`create()`** passes `args` to `createPtySession()` (`pty-handler.ts:86`)
5. **`createPtySession()`** uses `args` to spawn the PTY process (`pty-handler.ts:151`), but **does not store them on the Session object**

### Serialization gap (`sessions.ts:15-31`):

`SerializedPtySession` saves: `id, type, agent, root, repoName, repoPath, worktreeName, branchName, displayName, createdAt, lastActivity, useTmux, tmuxSessionName, customCommand, cwd`

**Missing fields**: No `args`, no `yolo`, no `claudeArgs`, no `continue`.

### Restoration gap (`sessions.ts:336-375`):

When restoring, only `AGENT_CONTINUE_ARGS[s.agent]` is added (hardcoded `--continue` for Claude). The original yolo flag, custom claudeArgs, and any other creation-time args are silently dropped:

```ts
// Non-tmux agent session — respawn with continue args ONLY
args = [...AGENT_CONTINUE_ARGS[s.agent]];
```

### Session type gap (`types.ts:49-66`):

The `PtySession` interface has no fields for `args`, `yolo`, or `claudeArgs`. The semantic flags are converted to CLI args at the route handler level and never flow into the session object.

### Terminal session state (secondary issue):

Terminal sessions (`customCommand` set) have their shell command serialized and re-spawned on restore, but the shell's runtime state (history, env vars, running processes) exists only in the PTY buffer. For non-tmux terminals, this state is irrecoverably lost. For tmux-wrapped terminals, tmux preserves it if the tmux server survives the restart. **This is an inherent limitation of non-tmux terminal sessions** — there's no mechanism to serialize a running shell's state.

## Evidence

- **`types.ts:49-66`**: `PtySession` has no `args`, `yolo`, or `claudeArgs` fields
- **`sessions.ts:15-31`**: `SerializedPtySession` omits all creation-time flags
- **`sessions.ts:286-302`**: `serializeAll()` doesn't save args
- **`sessions.ts:370-374`**: `restoreFromDisk()` only adds `--continue`, not original flags
- **`index.ts:848-851`**: Route handler converts flags to args then discards the semantic values
- **`pty-handler.ts:105,117`**: `rawArgs` is destructured from params and used for spawn but not stored on session

## Impact Assessment

- **Yolo sessions silently downgrade** — user thinks session is in auto-approve mode but it's actually requiring permission prompts after restart
- **Custom claudeArgs lost** — workspace-specific CLI args (e.g., `--model`, `--verbose`) are dropped
- **Terminal sessions lose all state** on non-tmux restarts (inherent limitation)
- **Affects every auto-update** where sessions have non-default flags
- **Security implication is benign** — losing yolo is a fail-safe direction, but confusing UX

## Recommended Fix Direction

### Issue 1: Preserve session creation flags (fixable)

1. **Add semantic flag fields to `PtySession`**: Store `yolo: boolean`, `claudeArgs: string[]`, and the raw `args: string[]` on the session object at creation time
2. **Add corresponding fields to `SerializedPtySession`**: Include `yolo`, `claudeArgs`, and `args` in the serialization interface
3. **Update `serializeAll()`**: Write these fields to `pending-sessions.json`
4. **Update `restoreFromDisk()`**: When restoring, reconstruct the full args array from the saved semantic flags (yolo → `AGENT_YOLO_ARGS`, claudeArgs → passed through) plus `--continue`
5. **Bump `PendingSessionsFile.version`** to 2 for backward compatibility

### Issue 2: Terminal session state loss (inherent limitation)

- For **tmux-wrapped** terminals: state is preserved if tmux server survives — this already works
- For **non-tmux** terminals: scrollback is saved and replayed, but runtime state (processes, env) is lost. The only mitigation would be to **auto-wrap terminal sessions in tmux** when persistence is desired, which would be a separate feature decision
- Consider adding a UI indicator showing "Terminal state was not preserved" after restore
