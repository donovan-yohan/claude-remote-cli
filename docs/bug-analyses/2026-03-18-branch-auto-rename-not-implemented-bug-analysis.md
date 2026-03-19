# Bug Analysis: Branch Auto-Rename Not Happening on Initial Prompt

> **Status**: Confirmed | **Date**: 2026-03-18
> **Severity**: Medium
> **Affected Area**: server/ws.ts, server/types.ts, frontend settings

## Symptoms
- When a new worktree session starts and the user sends their first message, the branch is not automatically renamed to a descriptive name based on the task.
- The branch stays as the default mountain name (e.g., "denali") instead of being renamed.

## Reproduction Steps
1. Click "+ new worktree" in the sidebar
2. A worktree is created with a mountain name branch (e.g., "denali")
3. Type a first message and send it
4. Branch remains "denali" — no rename occurs

## Root Cause
The branch auto-rename feature was **designed but never implemented**. The design (documented in project memory `project_v3_worktree_names_and_settings.md`) specifies:

1. Per-repo settings with custom prompts including a "Branch rename preferences" text area
2. First-message interception that prepends a branch rename instruction to the user's input
3. Session metadata updating when the branch name changes

None of these components exist in the codebase:

- **No per-repo settings fields** — `Config` and `WorktreeMetadata` types (`server/types.ts:103-108, 110-127`) have no fields for custom prompts
- **No settings UI** — `SettingsDialog.svelte` is global-only with no per-workspace prompt configuration
- **No prompt prepending logic** — `server/ws.ts:141` writes user input directly to PTY: `ptySession.pty.write(str)` with no interception
- **No first-message tracking** — No state to know whether a session has received its first message for one-time injection
- **SDK path also missing** — `server/sdk-handler.ts:428-436` has an `initialPrompt` mechanism but it's not wired to branch rename preferences

## Evidence
- `grep -r "promptBranchRename\|branchRename\|renamePrompt" *.{ts,svelte}` → zero matches
- `grep -r "prepend\|firstMessage\|initialPrompt" server/*.ts` → only SDK handler has `initialPrompt`, unrelated to branch rename
- `WorktreeMetadata` interface has only: `worktreePath`, `displayName`, `lastActivity`, `branchName?`
- No per-repo settings API endpoints exist

## Impact Assessment
- New worktrees keep default mountain names, requiring manual branch rename
- The "Conductor pattern" workflow (inject rename as system prompt) is not functional
- Per-repo custom prompts (code review, PR, general preferences) are also unimplemented — same missing infrastructure

## Recommended Fix Direction
Implement the feature end-to-end:

1. **Data model**: Add per-repo settings fields to types (`promptBranchRename`, `promptCodeReview`, `promptCreatePR`, `promptGeneral`, `branchPrefix`)
2. **Storage**: Extend `WorktreeMetadata` or create a new `RepoSettings` type with file-based storage keyed by repo path
3. **API**: Add GET/PUT `/repos/:path/settings` endpoints
4. **Settings UI**: Add per-workspace settings page with collapsible text areas for each prompt type
5. **PTY path**: In `server/ws.ts` message handler, track first-message state per session; if branch rename prompt is configured and this is the first message, prepend the instruction
6. **SDK path**: Wire branch rename prompt into the `initialPrompt` parameter in `sdk-handler.ts`
7. **Branch change detection**: Watch git refs or poll to detect when Claude renames the branch, then update session metadata
