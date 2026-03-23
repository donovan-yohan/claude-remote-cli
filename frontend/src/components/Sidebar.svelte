<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getUi,
    closeSidebar,
    saveSidebarWidth,
    toggleSidebarCollapsed,
    enterReorderMode,
    exitReorderMode,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH,
    COLLAPSED_SIDEBAR_WIDTH,
  } from '../lib/state/ui.svelte.js';
  import { getSessionState, getSessionsForWorkspace, reorderWorkspaces } from '../lib/state/sessions.svelte.js';
  import type { Workspace, WorktreeInfo, OrgPrsResponse } from '../lib/types.js';
  import { fetchWorkspaceGroups, fetchOrgPrs } from '../lib/api.js';
  import { createQuery } from '@tanstack/svelte-query';
  import { dndzone } from 'svelte-dnd-action';
  import WorkspaceItem from './WorkspaceItem.svelte';

  const ui = getUi();
  const sessionState = getSessionState();

  let {
    onSelectSession,
    onOpenSettings,
    onNewWorktree,
    onAddWorkspace,
    onDeleteSession,
    onDeleteWorktree,
  }: {
    onSelectSession: (id: string) => void;
    onOpenSettings: (workspace?: Workspace) => void;
    onNewWorktree: (workspace: Workspace) => void;
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

  // ── Drag-and-drop reorder ──
  const flipDurationMs = 200;

  // svelte-dnd-action requires items with `id` property
  let dndItems = $derived(
    sessionState.workspaces.map(w => ({ id: w.path, workspace: w }))
  );

  // Local mutable copy for DnD updates
  let localDndItems = $state<Array<{ id: string; workspace: Workspace }>>([]);
  $effect(() => { localDndItems = dndItems; });

  function handleDndConsider(e: CustomEvent<{ items: typeof localDndItems }>) {
    localDndItems = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent<{ items: typeof localDndItems }>) {
    localDndItems = e.detail.items;
    const newOrder = localDndItems.map(item => item.id);
    reorderWorkspaces(newOrder);
  }

  function handleDoneReorder() {
    exitReorderMode();
  }

  // ── Org PRs for sidebar enrichment ──
  const orgQuery = createQuery<OrgPrsResponse>(() => ({
    queryKey: ['org-prs'],
    queryFn: fetchOrgPrs,
    staleTime: 60_000,
  }));

  let orgPrs = $derived(orgQuery.data?.prs ?? []);

  // ── Workspace groups ──
  let workspaceGroups = $state<Record<string, string[]>>({});

  onMount(() => {
    fetchWorkspaceGroups().then(groups => { workspaceGroups = groups; }).catch(() => {});
  });

  // Build group → workspace list mapping for rendering
  let groupedWorkspaces = $derived.by((): Array<{ groupName: string | null; items: Array<{ id: string; workspace: Workspace }> }> => {
    if (ui.reorderMode || Object.keys(workspaceGroups).length === 0) {
      return [{ groupName: null, items: localDndItems }];
    }
    // Build reverse map: path → group name
    const pathToGroup = new Map<string, string>();
    for (const [groupName, paths] of Object.entries(workspaceGroups)) {
      for (const p of paths) pathToGroup.set(p, groupName);
    }
    const groups: Array<{ groupName: string | null; items: Array<{ id: string; workspace: Workspace }> }> = [];
    const groupOrder = Object.keys(workspaceGroups);
    for (const groupName of groupOrder) {
      const items = localDndItems.filter(item => pathToGroup.get(item.id) === groupName);
      if (items.length > 0) groups.push({ groupName, items });
    }
    // Ungrouped at the bottom
    const ungrouped = localDndItems.filter(item => !pathToGroup.has(item.id));
    if (ungrouped.length > 0) groups.push({ groupName: null, items: ungrouped });
    return groups;
  });

  // ── Mobile long-press to enter reorder mode ──
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  function handleTouchStart() {
    longPressTimer = setTimeout(() => {
      enterReorderMode();
      longPressTimer = null;
    }, 500);
  }

  function handleTouchEnd() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleTouchMove() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
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
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="sidebar-brand"
        onclick={() => {
          ui.activeWorkspacePath = null;
          sessionState.activeSessionId = null;
          closeSidebar();
        }}
      >Relay</span>
    {/if}
    <button class="icon-btn" aria-label="Close sidebar" onclick={closeSidebar}>✕</button>
  </div>

  {#if !ui.sidebarCollapsed}

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="workspace-list"
      use:dndzone={{ items: localDndItems, flipDurationMs, type: 'workspaces', dropTargetStyle: {} }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
      ontouchstart={handleTouchStart}
      ontouchend={handleTouchEnd}
      ontouchmove={handleTouchMove}
    >
      {#if ui.reorderMode}
        {#each localDndItems as item (item.id)}
          {@const workspace = item.workspace}
          {@const activeSessions = getSessionsForWorkspace(workspace.path)}
          {@const activeWorktreePaths = new Set(activeSessions.map(s => s.repoPath))}
          {@const inactiveWorktrees = sessionState.worktrees.filter(wt =>
            wt.repoPath === workspace.path &&
            wt.path.startsWith(workspace.path + '/') &&
            !activeWorktreePaths.has(wt.path)
          )}
          {@const groupedByPath = (() => {
            const groups = new Map<string, typeof activeSessions>();
            groups.set(workspace.path, []);
            for (const s of activeSessions) {
              const existing = groups.get(s.repoPath);
              if (existing) existing.push(s);
              else groups.set(s.repoPath, [s]);
            }
            return groups;
          })()}
          <div>
            <WorkspaceItem
              {workspace}
              sessionGroups={groupedByPath}
              {inactiveWorktrees}
              isActive={ui.activeWorkspacePath === workspace.path && !sessionState.activeSessionId}
              onSelectWorkspace={handleSelectWorkspace}
              {onSelectSession}
              onNewWorktree={onNewWorktree}
              onOpenSettings={(ws) => onOpenSettings(ws)}
              onDeleteSession={(id) => onDeleteSession?.(id)}
              onDeleteWorktree={(wt) => onDeleteWorktree?.(wt)}
              {orgPrs}
            />
          </div>
        {/each}
      {:else}
        {#each groupedWorkspaces as group (group.groupName ?? '__ungrouped__')}
          {#if group.groupName}
            <div class="group-header">{group.groupName}</div>
          {/if}
          {#each group.items as item (item.id)}
            {@const workspace = item.workspace}
            {@const activeSessions = getSessionsForWorkspace(workspace.path)}
            {@const activeWorktreePaths = new Set(activeSessions.map(s => s.repoPath))}
            {@const inactiveWorktrees = sessionState.worktrees.filter(wt =>
              wt.repoPath === workspace.path &&
              wt.path.startsWith(workspace.path + '/') &&
              !activeWorktreePaths.has(wt.path)
            )}
            {@const groupedByPath = (() => {
              const groups = new Map<string, typeof activeSessions>();
              groups.set(workspace.path, []);
              for (const s of activeSessions) {
                const existing = groups.get(s.repoPath);
                if (existing) existing.push(s);
                else groups.set(s.repoPath, [s]);
              }
              return groups;
            })()}
            <div>
              <WorkspaceItem
                {workspace}
                sessionGroups={groupedByPath}
                {inactiveWorktrees}
                isActive={ui.activeWorkspacePath === workspace.path && !sessionState.activeSessionId}
                onSelectWorkspace={handleSelectWorkspace}
                {onSelectSession}
                onNewWorktree={onNewWorktree}
                onOpenSettings={(ws) => onOpenSettings(ws)}
                onDeleteSession={(id) => onDeleteSession?.(id)}
                onDeleteWorktree={(wt) => onDeleteWorktree?.(wt)}
                {orgPrs}
              />
            </div>
          {/each}
        {/each}
      {/if}

      {#if sessionState.workspaces.length === 0}
        <div class="empty-state">
          <span>No workspaces</span>
        </div>
      {/if}
    </div>

    {#if ui.reorderMode}
      <button class="done-reorder-btn" onclick={handleDoneReorder}>
        Done reordering
      </button>
    {/if}

    <div class="sidebar-footer-row">
      {#if !ui.reorderMode}
        <button class="add-workspace-btn" data-track="sidebar.add-workspace" onclick={onAddWorkspace}>
          + Add Workspace
        </button>
      {/if}
      <button class="settings-icon-btn" data-track="sidebar.settings" onclick={() => onOpenSettings()} aria-label="Settings">
        ⚙
      </button>
    </div>

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

  .sidebar-brand {
    flex: 1;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text);
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color 0.12s;
  }

  .sidebar-brand:hover {
    color: var(--accent);
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

  /* Group headers */
  .group-header {
    padding: 10px 10px 4px 10px;
    font-size: 10px;
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
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

  /* Bottom footer row */
  .sidebar-footer-row {
    display: flex;
    gap: 8px;
    margin: 8px;
    align-items: stretch;
    flex-shrink: 0;
  }

  .add-workspace-btn {
    flex: 1;
    padding: 10px 12px;
    min-height: 40px;
    background: none;
    border: 1px solid var(--accent);
    border-radius: 0;
    color: var(--accent);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    cursor: pointer;
    touch-action: manipulation;
    text-align: center;
    transition: background 0.1s;
  }

  .add-workspace-btn:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .add-workspace-btn:active {
    background: var(--border);
  }

  /* Done reordering button */
  .done-reorder-btn {
    margin: 8px;
    padding: 10px 12px;
    min-height: 40px;
    background: none;
    border: 1px solid var(--accent);
    border-radius: 0;
    color: var(--accent);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    cursor: pointer;
    touch-action: manipulation;
    text-align: center;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .done-reorder-btn:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .done-reorder-btn:active {
    background: var(--border);
  }

  .settings-icon-btn {
    width: 40px;
    min-height: 40px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    touch-action: manipulation;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.1s, color 0.1s;
  }

  .settings-icon-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .settings-icon-btn:active {
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
