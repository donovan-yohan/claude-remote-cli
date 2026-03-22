# Bug Analysis: Sidenav entry changes name/icon when adding a new tab

> **Status**: Confirmed | **Date**: 2026-03-22
> **Severity**: Medium
> **Affected Area**: `WorkspaceItem.svelte` sidebar rendering

## Symptoms
- Adding a new terminal tab renames the sidenav entry from the worktree/branch name (e.g., "claude-remote-cli") to the tab name (e.g., "Terminal 2")
- The sidenav icon changes from a status dot to a terminal icon (`>_`)
- The sidenav entry should always reflect the worktree/group identity, not individual tab identity
- The tab bar and sidenav are leaking into each other: tabs should be purely local to the main area

## Reproduction Steps
1. Open a workspace with an active agent session (e.g., "claude-remote-cli")
2. Observe the sidenav shows the workspace name with a status dot icon
3. Click "+" in the tab bar and select "New Terminal"
4. Observe the sidenav entry now shows "Terminal 2" with a `>_` terminal icon

## Root Cause

In `WorkspaceItem.svelte`, each session group in the sidebar picks a single **representative** session — the most recently active one — and uses its type and name for the entire row:

**Line 238**: Representative selection picks newest session:
```svelte
{@const representative = groupSessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))[0]}
```

**Lines 258-262**: Icon is derived from representative's type:
```svelte
{#if representative.type === 'terminal'}
  <span class="terminal-icon">&gt;_</span>
{:else}
  <span class={statusDotClass(representative)}></span>
{/if}
```

**Line 263**: Name is derived from representative's display name:
```svelte
<span class="session-name">{sessionDisplayName(representative)}</span>
```

**`sessionDisplayName()` (lines 70-77)**: For non-repo sessions, returns `session.displayName || session.branchName || session.repoName || session.id` — for a terminal, this becomes the terminal's auto-generated name like "Terminal 2".

When a new terminal tab is created, it gets the newest `lastActivity` timestamp, making it the representative. Since it's type `'terminal'`, the sidebar row switches to a terminal icon and terminal name.

## Evidence
- `WorkspaceItem.svelte:238` — representative = most recent session by `lastActivity`
- `WorkspaceItem.svelte:258-262` — icon conditional on `representative.type`
- `WorkspaceItem.svelte:263` — name from `sessionDisplayName(representative)`
- `WorkspaceItem.svelte:70-77` — `sessionDisplayName()` returns the session's own name, not the group's identity
- `SessionTabBar.svelte:30-48` — tab bar independently assigns names like "Agent 1", "Terminal 2" — these are tab-local names that should never leak to sidebar

## Impact Assessment
- Every workspace with multiple tabs (agent + terminal) shows the wrong name/icon in the sidenav
- The sidenav becomes unreliable for workspace navigation since the name changes based on which tab was last active
- Confusing UX: the user cannot tell which workspace a sidenav entry refers to

## Recommended Fix Direction

The sidebar row should show the **group/worktree identity**, not the individual tab's identity:

1. **Name**: Use the worktree branch name or workspace name for the group, not the representative session's displayName. For repo-root groups, show "default". For worktree groups, show the branch name (from any session in the group, since they all share the same worktree path)
2. **Icon**: Show the aggregate status across all sessions in the group. Use the "most important" status (attention > permission-prompt > running > idle). Never show a terminal icon for the group — terminal sessions just contribute to the count badge
3. **Count badge**: Keep the circle count badge showing total number of sessions/tabs in the group (user confirmed)
4. The representative should still be used for click targeting (selecting which tab to activate) and for the secondary row metadata (time, branch)
