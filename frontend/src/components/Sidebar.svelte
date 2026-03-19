<script lang="ts">
  import {
    getUi,
    closeSidebar,
    saveSidebarWidth,
    toggleSidebarCollapsed,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH,
    COLLAPSED_SIDEBAR_WIDTH,
  } from '../lib/state/ui.svelte.js';
  import { getSessionState, getSessionsForWorkspace } from '../lib/state/sessions.svelte.js';
  import type { Workspace, WorktreeInfo } from '../lib/types.js';
  import WorkspaceItem from './WorkspaceItem.svelte';
  import SmartSearch from './SmartSearch.svelte';

  const ui = getUi();
  const sessionState = getSessionState();

  let {
    onSelectSession,
    onOpenSettings,
    onNewWorktree,
    onNewSession,
    onNewTerminal,
    onAddWorkspace,
    onDeleteSession,
    onDeleteWorktree,
  }: {
    onSelectSession: (id: string) => void;
    onOpenSettings: (workspace?: Workspace) => void;
    onNewWorktree: (workspace: Workspace) => void;
    onNewSession: (workspace: Workspace) => void;
    onNewTerminal: (workspace: Workspace) => void;
    onAddWorkspace: () => void;
    onDeleteSession?: (id: string) => void;
    onDeleteWorktree?: (wt: WorktreeInfo) => void;
  } = $props();

  let effectiveWidth = $derived(
    ui.sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : ui.sidebarWidth,
  );

  function handleSelectWorkspace(path: string) {
    ui.activeWorkspacePath = path;
    // Clear active session so the main area shows the dashboard
    sessionState.activeSessionId = null;
  }

  function handleSmartSearchSelect(path: string) {
    ui.activeWorkspacePath = path;
    closeSidebar();
  }

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = ui.sidebarWidth;

    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, startWidth + (e.clientX - startX)),
      );
      ui.sidebarWidth = newWidth;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveSidebarWidth();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function resetWidth(e: MouseEvent) {
    e.preventDefault();
    ui.sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
    saveSidebarWidth();
  }
</script>

<aside
  class="sidebar"
  class:open={ui.sidebarOpen}
  class:collapsed={ui.sidebarCollapsed}
  style:width="{effectiveWidth}px"
  style:min-width="{effectiveWidth}px"
>
  <div class="sidebar-header">
    <button
      class="collapse-btn"
      aria-label={ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      onclick={toggleSidebarCollapsed}
    >
      {ui.sidebarCollapsed ? '»' : '«'}
    </button>
    {#if !ui.sidebarCollapsed}
      <span class="sidebar-label">Workspaces</span>
    {/if}
    <button class="icon-btn" aria-label="Close sidebar" onclick={closeSidebar}>✕</button>
  </div>

  {#if !ui.sidebarCollapsed}
    <SmartSearch
      workspaces={sessionState.workspaces}
      onSelect={handleSmartSearchSelect}
    />

    <div class="workspace-list">
      {#each sessionState.workspaces as workspace (workspace.path)}
        {@const activeSessions = getSessionsForWorkspace(workspace.path)}
        {@const activeWorktreePaths = new Set(activeSessions.map(s => s.repoPath))}
        {@const inactiveWorktrees = sessionState.worktrees.filter(wt =>
          wt.repoPath === workspace.path &&
          wt.path.startsWith(workspace.path + '/') &&
          !activeWorktreePaths.has(wt.path)
        )}
        {@const groupedByPath = (() => {
          const groups = new Map<string, typeof activeSessions>();
          // Always include repo root as first entry
          groups.set(workspace.path, []);
          for (const s of activeSessions) {
            const existing = groups.get(s.repoPath);
            if (existing) existing.push(s);
            else groups.set(s.repoPath, [s]);
          }
          return groups;
        })()}
        <WorkspaceItem
          {workspace}
          sessionGroups={groupedByPath}
          {inactiveWorktrees}
          isActive={ui.activeWorkspacePath === workspace.path && !sessionState.activeSessionId}
          onSelectWorkspace={handleSelectWorkspace}
          {onSelectSession}
          onNewWorktree={onNewWorktree}
          onNewSession={onNewSession}
          onNewTerminal={onNewTerminal}
          onOpenSettings={(ws) => onOpenSettings(ws)}
          onDeleteSession={(id) => onDeleteSession?.(id)}
          onDeleteWorktree={(wt) => onDeleteWorktree?.(wt)}
        />
      {/each}

      {#if sessionState.workspaces.length === 0}
        <div class="empty-state">
          <span>No workspaces</span>
        </div>
      {/if}
    </div>

    <button class="add-workspace-btn" onclick={onAddWorkspace}>
      + Add Workspace
    </button>
    <button class="settings-btn" onclick={() => onOpenSettings()}>
      ⚙ Settings
    </button>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resize-handle" onmousedown={startResize} ondblclick={resetWidth}></div>
  {/if}
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-right: 1px solid var(--border);
    overflow: hidden;
    transition: transform 0.25s ease, width 0.2s ease, min-width 0.2s ease;
    z-index: 100;
  }

  /* Resize handle */
  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: col-resize;
    z-index: 10;
    transition: background 0.15s;
  }

  .resize-handle:hover {
    background: var(--accent);
  }

  /* Header */
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sidebar-label {
    flex: 1;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-muted);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .collapse-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 8px 10px;
    border-radius: 4px;
    flex-shrink: 0;
    line-height: 1;
    font-family: var(--font-mono);
    min-width: 36px;
    min-height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .collapse-btn:hover {
    color: var(--text);
    background: var(--border);
  }

  .sidebar.collapsed .sidebar-header {
    justify-content: center;
    padding: 12px 4px;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--text);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    touch-action: manipulation;
    display: none; /* shown on mobile only */
  }

  .icon-btn:active {
    background: var(--border);
  }

  /* Workspace list */
  .workspace-list {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .empty-state {
    padding: 16px 10px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    opacity: 0.5;
    text-align: center;
  }

  /* Bottom buttons */
  .add-workspace-btn {
    margin: 8px;
    padding: 10px 12px;
    min-height: 40px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    cursor: pointer;
    touch-action: manipulation;
    text-align: center;
    flex-shrink: 0;
    transition: background 0.1s, border-color 0.1s;
  }

  .add-workspace-btn {
    border-color: var(--accent);
    color: var(--accent);
  }

  .add-workspace-btn:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .add-workspace-btn:active {
    background: var(--border);
  }

  .settings-btn {
    margin: 0 8px 8px;
    padding: 10px 12px;
    min-height: 40px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    cursor: pointer;
    touch-action: manipulation;
    text-align: center;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .settings-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .settings-btn:active {
    background: var(--border);
  }

  /* Mobile */
  @media (max-width: 600px) {
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      height: 100%;
      transform: translateX(-100%);
      box-shadow: 2px 0 12px rgba(0, 0, 0, 0.5);
      transition: transform 0.25s ease;
    }

    .sidebar.open {
      transform: translateX(0);
    }

    .collapse-btn {
      display: none;
    }

    .icon-btn {
      display: block;
      font-size: 1.4rem;
      padding: 4px 8px;
    }

    .resize-handle {
      display: none;
    }
  }
</style>
