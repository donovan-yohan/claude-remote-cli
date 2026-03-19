# Execution Plan: Fix Repo Root Click → Dashboard Bug

> **Status**: Active | **Created**: 2026-03-19
> **Source**: `docs/bug-analyses/2026-03-19-repo-root-click-dashboard-bug-analysis.md`
> **Branch**: `kangchenjunga`

## Goal

When clicking the inactive repo root entry in the sidebar, create a new session at the repo folder level instead of navigating to the dashboard.

## Progress

- [ ] Task 1: Fix the click handler for the inactive repo root entry
- [ ] Task 2: Build and verify

---

### Task 1: Fix click handler for inactive repo root entry

**File:** `frontend/src/components/WorkspaceItem.svelte`
**Lines:** 248-261

**What:** Replace `onSelectWorkspace(workspace.path)` with `createSession()` + `onSelectSession()`, mirroring the inactive worktree pattern at lines 270-280.

**Change:**
```svelte
<!-- Before -->
<li class="session-row inactive"
    onclick={() => onSelectWorkspace(workspace.path)}>

<!-- After -->
<li class="session-row inactive"
    onclick={async () => {
      try {
        const session = await createSession({
          repoPath: workspace.path,
          repoName: workspace.name,
        });
        await refreshAll();
        onSelectSession(session.id);
      } catch { /* silent */ }
    }}>
```

**Dependencies:** `createSession` and `refreshAll` are already imported (lines 3, 6).

### Task 2: Build and verify

Run `npm run build` to confirm no TypeScript or Svelte compilation errors.
