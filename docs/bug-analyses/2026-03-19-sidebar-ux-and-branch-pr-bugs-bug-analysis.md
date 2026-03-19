# Bug Analysis: Sidebar UX & Branch/PR Handling — 7 Issues

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: Mixed (High for #3/#4, Medium for rest)
> **Affected Area**: Sidebar UI, branch listener, PR data flow

---

## Issue 1: Context Menu Transparency Makes Options Hard to Read

### Symptoms
- Context menu items (Resume, Resume YOLO, Delete Worktree) are difficult to read
- Screenshot shows text at reduced opacity against dark background

### Root Cause
The context menu trigger lives inside `.session-row-secondary` which has `opacity: 0.7` (WorkspaceItem.svelte). When the menu opens, it inherits the visual context of the reduced-opacity row. The menu itself (`ContextMenu.svelte`) has `background: var(--bg-secondary)` but the overall effect combined with the dark theme makes it hard to read.

### Evidence
- `WorkspaceItem.svelte`: `.session-row-secondary { opacity: 0.7 }`
- `ContextMenu.svelte`: Menu positioned fixed at z-index 1000, but backdrop is transparent (no visual scrim)

### Recommended Fix
Ensure the context menu has a solid, opaque background with sufficient contrast. The menu is already `position: fixed` so it shouldn't inherit row opacity — verify the opacity inheritance chain. May need `opacity: 1` on the menu explicitly or a slight background scrim.

---

## Issue 2: Triple Dots Menu UX — Hover on Web, Long Press on Mobile

### Symptoms
- Triple dots button is always visible inline in the 2nd row
- Touch area of the button causes inconsistent 2nd-line height
- Takes up space even when not needed

### Root Cause
`ContextMenu` trigger is placed inside `.session-row-secondary` as an inline element with a `.context-menu-spacer` pushing it right. The button has a fixed touch target size that inflates the row height. There's no hover-only or long-press logic.

### Evidence
- `WorkspaceItem.svelte` lines 243-253: `<ContextMenu>` inline in secondary row
- `ContextMenu.svelte` line 77-86: Always-rendered trigger button
- Screenshots show inconsistent row heights

### Recommended Fix
**Web**: Remove inline placement. Show triple-dots as an overlay on the entire row on hover, center-right aligned with `position: absolute`. Hide by default, show on `.session-row:hover`.
**Mobile**: Remove visible trigger entirely. Implement long-press (500ms) on the `<li>` element to open the context menu. Reuse existing long-press pattern from sidebar reorder mode (Sidebar.svelte lines 113-135).

---

## Issue 3: Branch Listener Fires Before First Message — Captures Escape Sequences

### Symptoms
- Branch auto-renamed to "i-m-seeing-terminal-escape-sequences"
- Listener captures terminal control codes instead of user's actual message

### Root Cause (3 sub-bugs)

**3a: No agentState gate** — `server/ws.ts:217-235`: The `needsBranchRename` interception runs on every WebSocket message from connection start. It doesn't check `ptySession.agentState === 'waiting-for-input'`. Terminal initialization data (resize, escape sequences) gets buffered as the "first message."

**3b: Raw bytes buffered** — `_renameBuffer` accumulates raw WebSocket strings including ANSI escape sequences from the mobile input pipeline, cursor movement, and terminal handshake.

**3c: `branchRenamePrompt` ignored** — `session.branchRenamePrompt` is stored (sessions.ts:134) but `spawnBranchRename` (ws.ts:64) hardcodes its own prompt, never reading the workspace setting.

### Evidence
- `server/ws.ts:217-235`: No `agentState` check before buffering
- `server/ws.ts:57-96`: Hardcoded prompt, no ANSI stripping
- Screenshot shows "I m seeing terminal escape sequenc..." as the session name
- `server/pty-handler.ts:199`: Output parser tracks `agentState` but branch code ignores it

### Recommended Fix
1. Gate `needsBranchRename` buffer on `ptySession.agentState === 'waiting-for-input'`
2. Strip ANSI escape sequences from `firstMessage` before passing to `spawnBranchRename`
3. Wire up `session.branchRenamePrompt` into the Claude CLI prompt

---

## Issue 4: PR Handling — DRY Violations, Broken Archive CTA, Missing Sidebar Data

### Symptoms
- PR details visible in top bar but NOT in sidebar
- Closed/merged PRs no longer show "Archive" CTA
- No way to see PR state for branches with closed PRs

### Root Cause (3 sub-bugs)

**4a: Missing API routes** — `server/index.ts` imports `getSessionMeta`/`getAllSessionMeta` but never registers `GET /sessions/meta` or `GET /sessions/:id/meta` routes. Frontend calls silently 404, `sessionMeta` map is always empty, sidebar never shows PR badges.

**4b: Closed/merged PR filter breaks archive** — `server/git.ts:297-299` returns `null` for non-OPEN PRs. `PrTopBar` derives `prState` only when PR is non-null, so MERGED/CLOSED states never reach `pr-state.ts` which correctly handles `archive-merged`/`archive-closed` actions (lines 83-91).

**4c: Inactive worktrees excluded** — `sessions.ts:populateMetaCache()` only iterates active sessions. Inactive worktrees (no running session) never get PR data populated.

### Evidence
- `server/index.ts:16`: imports exist but no route registration for meta endpoints
- `server/git.ts:297-299`: `if (data.state !== 'OPEN') return null;`
- `server/sessions.ts:426`: `const allSessions = list()` — only active sessions
- `frontend/src/lib/pr-state.ts:83-91`: Archive states correctly defined but unreachable

### Recommended Fix
**Unify PR data**: Since branch names are now unique, tie PR state directly to branch name rather than session ID. One fetch path, one cache, both top bar and sidebar read from same source.
- Remove the OPEN-only filter; return full PR state and let the UI decide what to show
- For closed PRs on matching branch names, show the closed/merged state to enable Archive CTA
- Sidebar should fetch PR data by branch name (same as top bar) rather than through session meta

---

## Issue 5: Remove Grab Dots — Whole Item Is Draggable

### Symptoms
- Grab dots (`⠿`) take up horizontal space in compact sidebar
- Users can already click-drag anywhere on an item to reorder

### Root Cause
`WorkspaceItem.svelte` renders `.grip-handle` with the braille character `⠿` in each workspace header. It's opacity-0 by default, opacity-1 on hover and in reorder mode. With `svelte-dnd-action` applied to the entire list, the grab handle is redundant visual chrome.

### Evidence
- `WorkspaceItem.svelte` lines 175-176, 388-414: Grip handle rendering and styles
- `Sidebar.svelte` lines 87-107: `dndzone` applied to entire workspace list

### Recommended Fix
Remove the `.grip-handle` element from `WorkspaceItem.svelte`. The `dndzone` action on the list container already makes items draggable anywhere.

---

## Issue 6: Collapse "Add Workspace" and "Settings" Into One Line

### Symptoms
- Two full-width buttons stacked vertically waste vertical space
- Settings is secondary action but takes same visual weight as Add Workspace

### Root Cause
`Sidebar.svelte` lines 225-232: Both buttons rendered as separate full-width block elements.

### Evidence
- Screenshot shows two separate buttons: `+ Add Workspace` (accent outlined) and `⚙ Settings` (muted outlined)
- Both are `width: 100%` block buttons

### Recommended Fix
Single row with flexbox: `+ Add Workspace` as the primary CTA (flex: 1), `⚙` gear icon as a square icon button to its right. Remove the "Settings" text label.

---

## Issue 7: Branch Name Not Shown for Active Repo Sessions + Missing Last Activity

### Symptoms
- Active repo session row does NOT show branch name in the secondary row (display name "default" is fine)
- Inactive sessions don't show when they were last active

### Root Cause
`POST /sessions/repo` (server/index.ts:843) creates repo sessions **without passing `branchName`** — so `session.branchName` is `undefined`. The secondary row template (WorkspaceItem.svelte:245) has `{#if representative.branchName}` which is falsy, so the branch never renders for active repo sessions.

For worktree sessions, `branchName` is passed at creation (index.ts:783), so they show it. The issue is repo-session-specific: the branch exists (e.g. `master`) but is never fetched from git and stored on the session object.

For inactive sessions, `sessionTime()` only renders time for active sessions. There's no `lastActiveAt` timestamp stored or displayed for inactive worktrees.

### Evidence
- `server/index.ts:843-855`: `sessions.create({ type: 'repo', ... })` — no `branchName` field
- `WorkspaceItem.svelte:245`: `{#if representative.branchName}` — falsy for repo sessions
- Screenshots show "default" with no branch on the secondary row when active

### Recommended Fix
- For repo sessions: fetch the current branch (`git rev-parse --abbrev-ref HEAD`) at creation time and pass it to `sessions.create()`, or populate it lazily on first connect
- For inactive sessions: persist `lastActiveAt` timestamp and render "Last active: Xm ago" in the secondary row

---

## Impact Assessment

| # | Issue | Severity | User Impact |
|---|-------|----------|-------------|
| 1 | Menu transparency | Medium | Hard to read menu options |
| 2 | Triple dots UX | Medium | Inconsistent row heights, wasted space |
| 3 | Branch listener | High | Sessions auto-named with garbage, first message captured wrong |
| 4 | PR handling | High | Missing sidebar PR info, broken archive flow, DRY violations |
| 5 | Grab dots | Low | Wasted horizontal space |
| 6 | Bottom buttons | Low | Wasted vertical space |
| 7 | Branch/activity display | Medium | Missing context for repo sessions |
