# Implementation Plan: Branch Auto-Rename on First Message

> **Status**: Complete | **Created**: 2026-03-19
> **Source**: `docs/bug-analyses/2026-03-18-branch-auto-rename-not-implemented-bug-analysis.md`
> **Scope**: Implement branch auto-rename using the Conductor pattern (inject rename instruction into first message)

## Summary

When a new worktree session starts with a default mountain name, the first user message should be prepended with an instruction telling Claude to rename the branch to match the task. This is the minimum viable implementation — per-repo settings UI is deferred.

## Design Decisions

1. **Mountain names**: Replace `mobile-{name}-{timestamp}` default naming with cycling mountain names from a fixed list, tracked per-repo via config
2. **Rename prompt**: Hardcoded default prompt (not per-repo configurable yet) — users can customize later when settings UI is built
3. **First-message injection**: Server-side — both PTY and SDK paths get the rename instruction prepended/injected
4. **Branch change detection**: Poll git HEAD in session cwd after first message, update session metadata + worktree metadata when branch changes
5. **Scope boundary**: No per-repo settings UI, no settings API endpoints — those are future work

## Progress

- [x] Task 1: Add mountain name list and cycling counter to config
- [x] Task 2: Add `needsBranchRename` flag to session types
- [x] Task 3: Implement first-message interception in PTY and SDK paths
- [x] Task 4: Implement branch change detection and metadata update
- [x] Task 5: Add tests for branch rename flow

---

### Task 1: Mountain name list and cycling counter
**Files:** `server/types.ts`, `server/config.ts`, `server/index.ts`
**What:**
- Add `MOUNTAIN_NAMES` constant array to `server/config.ts` (the 30 mountain names from the design doc)
- Add optional `nextMountainIndex?: number` field to `Config` interface
- In `POST /sessions` (server/index.ts line 747), when no `branchName` is provided, pick `MOUNTAIN_NAMES[config.nextMountainIndex % MOUNTAIN_NAMES.length]`, increment counter, save config
- Check if the mountain name branch already exists (local or remote) — if so, skip to next mountain name

### Task 2: Add `needsBranchRename` flag to session types
**Files:** `server/types.ts`, `server/sessions.ts`
**What:**
- Add `needsBranchRename?: boolean` to `BaseSession` interface
- Add `needsBranchRename?: boolean` to `CreateParams` in `sessions.ts`
- Pass through to session creation — set `true` when session is a new worktree with a mountain name (not user-specified branch)
- Add to `SessionSummary` so the frontend can know (for future UI)
- Add to `SerializedPtySession` and `PendingSessionsFile` for persistence

### Task 3: First-message interception (PTY + SDK)
**Files:** `server/ws.ts`, `server/sessions.ts`, `server/sdk-handler.ts`
**What:**
- **PTY path** (`server/ws.ts` line 131-142): In the `ws.on('message')` handler, before writing to PTY:
  1. Check `ptySession.needsBranchRename`
  2. If true, skip JSON messages (resize commands)
  3. For text input: prepend the branch rename instruction, then write the combined string
  4. Set `needsBranchRename = false`
  5. The rename instruction format:
     ```
     Before responding to my message, first rename the current git branch using `git branch -m <new-name>` to a short, descriptive kebab-case name based on the task I'm asking about. Do not include any ticket numbers or prefixes. After renaming, proceed with my request normally.

     {user's actual message}
     ```
- **SDK path** (`server/sessions.ts` line 83-109): When calling `createSdkSession()`, if `needsBranchRename` is true, pass the rename instruction as the `prompt` parameter. But this won't work because the user's first message hasn't been sent yet. Instead:
  - In `server/ws.ts` SDK message handler (line 195-198), intercept the first `type: 'message'` and prepend the rename instruction to the text
  - Set `needsBranchRename = false` on the session

### Task 4: Branch change detection and metadata update
**Files:** `server/ws.ts`, `server/config.ts`
**What:**
- After the first message is sent (when `needsBranchRename` was just set to false), start a simple polling mechanism:
  - Run `git rev-parse --abbrev-ref HEAD` in the session's cwd every 3 seconds, up to 10 attempts (30 seconds max)
  - When the branch name changes from the original mountain name, update:
    - `session.branchName` and `session.displayName`
    - `WorktreeMetadata` via `writeMeta()`
    - Broadcast `session-renamed` event via WebSocket events channel so the sidebar updates
  - Stop polling after detecting a change or after max attempts
- Import `writeMeta` from config.ts, `broadcastEvent` needs to be accessible (pass as parameter or export)

### Task 5: Tests
**Files:** `test/branch-rename.test.ts` (new)
**What:**
- Test mountain name cycling: picks next name, wraps around, skips existing branches
- Test `needsBranchRename` flag set correctly on new worktree sessions
- Test first-message prepending logic (unit test the prepend function)
- Test branch detection polling (mock `execFile` to simulate branch change)

## Architecture Notes

- The rename instruction is intentionally simple and hardcoded. Per-repo customization (prefix, naming style) will come with the settings UI later.
- The polling approach for branch detection is pragmatic — git doesn't have a reliable cross-platform filesystem watch for refs. 10 polls × 3 seconds = 30 seconds is enough for Claude to rename a branch.
- The `broadcastEvent` function in ws.ts needs to be accessible from the polling code. The cleanest approach is to have the polling happen in `ws.ts` itself (where `broadcastEvent` is already available) or pass a callback.
