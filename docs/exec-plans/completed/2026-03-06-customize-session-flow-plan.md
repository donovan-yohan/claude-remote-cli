# Customize Session Flow — Execution Plan

## Goal
Inactive worktrees and idle repos "Customize" action opens NewSessionDialog pre-filled with available item data (root, repo, branch, agent, args).

## Steps

| # | Step | File(s) | Status |
|---|------|---------|--------|
| 1 | Extend `open()` options type and apply overrides | `frontend/src/components/dialogs/NewSessionDialog.svelte` | done |
| 2 | Update `onOpenNewSession` callback type in Sidebar | `frontend/src/components/Sidebar.svelte` | done |
| 3 | Thread options through `handleOpenNewSession` in App | `frontend/src/App.svelte` | done |
| 4 | Pass worktree data in `inactiveWorktreeMenu` | `frontend/src/components/SessionList.svelte` | done |
| 5 | Build and verify no type errors | CLI | done |
| 6 | Run tests | CLI | done |

## Step Details

### Step 1: Extend `open()` in NewSessionDialog
- Add `branchName?: string`, `agent?: AgentType`, `claudeArgs?: string` to options type
- After `selectedAgent = await fetchDefaultAgent()`, apply: `if (options?.agent) selectedAgent = options.agent`
- After pre-selection block, apply: `if (options?.branchName) branchInput = options.branchName`
- Apply: `if (options?.claudeArgs) claudeArgsInput = options.claudeArgs`

### Step 2: Update Sidebar callback type
- Change `onOpenNewSession: (repo?: RepoInfo) => void` to `onOpenNewSession: (repo?: RepoInfo, options?: { tab?: 'repos' | 'worktrees'; branchName?: string; agent?: AgentType; claudeArgs?: string }) => void`
- Thread options in SessionList binding

### Step 3: Thread options in App
- `handleOpenNewSession(repo?: RepoInfo, options?: ...)` → `newSessionDialogRef?.open(repo, options)`

### Step 4: Pass worktree data in SessionList
- `inactiveWorktreeMenu`: change customize action from `onOpenNewSession(repo)` to `onOpenNewSession(repo, { tab: 'worktrees', branchName: wt.branchName })`
