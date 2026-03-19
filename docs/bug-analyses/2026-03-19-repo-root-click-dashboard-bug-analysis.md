# Bug Analysis: Clicking Inactive Repo Root Goes to Dashboard Instead of Opening Session

> **Status**: Confirmed | **Date**: 2026-03-19
> **Severity**: High
> **Affected Area**: `frontend/src/components/WorkspaceItem.svelte` — persistent repo root click handler

## Symptoms
- Clicking on the default repo branch (repo root entry) in the sidebar navigates to the dashboard instead of opening a new Claude session at that repo's folder level
- The entry appears as an inactive row when no sessions exist for the repo root
- Inactive worktrees correctly create sessions on click; only the repo root is broken

## Reproduction Steps
1. Add a workspace (e.g. `claude-remote-cli`)
2. If a session exists at the repo root, kill it — the repo root entry now shows as inactive (gray dot)
3. Click the inactive repo root entry
4. **Expected**: A new session is created at the repo folder, and the terminal opens
5. **Actual**: The view switches to the dashboard (workspace overview), no session is created

## Root Cause

Introduced in commit `2a99318 fix: sidebar shows one row per folder instead of per session`.

The fix added a persistent repo root entry in the `{:else if isRepoRoot}` branch at **WorkspaceItem.svelte:248-261**. When the repo root has zero active sessions, this branch renders an inactive row with the click handler:

```svelte
onclick={() => onSelectWorkspace(workspace.path)}
```

`onSelectWorkspace` maps to `handleSelectWorkspace` in **Sidebar.svelte:44-48**:

```typescript
function handleSelectWorkspace(path: string) {
    ui.activeWorkspacePath = path;
    sessionState.activeSessionId = null; // clears session → shows dashboard
}
```

This **clears the active session** and shows the dashboard. It's the correct behavior for clicking a workspace header, but wrong for clicking an inactive session row that should launch a new session.

Compare with inactive worktree rows (**WorkspaceItem.svelte:270-280**), which correctly create a session:

```svelte
onclick={async () => {
    const session = await createSession({ repoPath: workspace.path, ... });
    await refreshAll();
    onSelectSession(session.id);
}}
```

The repo root entry should use the same pattern.

## Evidence
- **WorkspaceItem.svelte:254**: `onclick={() => onSelectWorkspace(workspace.path)}` — calls dashboard navigation
- **WorkspaceItem.svelte:270-280**: Inactive worktree handler correctly calls `createSession()` + `onSelectSession()` — this is the correct pattern
- **Sidebar.svelte:44-48**: `handleSelectWorkspace` explicitly sets `activeSessionId = null` (dashboard view)
- `createSession` is already imported in WorkspaceItem.svelte (line 6)

## Impact Assessment
- **High severity**: The repo root is the most common entry point — users expect clicking it to start working in that repo
- **UX confusion**: Clicking what looks like a session row navigates away from sessions entirely
- **Regression**: Introduced by the sidebar fix in `2a99318`

## Recommended Fix Direction

Replace the `onSelectWorkspace` call in the inactive repo root handler with a `createSession` + `onSelectSession` call, mirroring the inactive worktree pattern:

```svelte
{:else if isRepoRoot}
  <li
    class="session-row inactive"
    onclick={async () => {
      try {
        const session = await createSession({
          repoPath: workspace.path,
          repoName: workspace.name,
        });
        await refreshAll();
        onSelectSession(session.id);
      } catch { /* silent */ }
    }}
  >
```

This is a ~5-line change in a single file. No architectural changes needed.
