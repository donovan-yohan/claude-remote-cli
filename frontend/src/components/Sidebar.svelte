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
  import { getSessionState, getSessionsForWorkspace, reorderWorkspaces } from '../lib/state/sessions.svelte.js';
  import type { Workspace, WorktreeInfo, OrgPrsResponse } from '../lib/types.js';
  import { fetchOrgPrs } from '../lib/api.js';
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

  // Coarse-pointer devices (phones, tablets) need drag gating to preserve scroll
  const isTouchDevice = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  let mobileDragEnabled = $state(false);
  let dragDisabled = $derived(isTouchDevice && !mobileDragEnabled);

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
    mobileDragEnabled = false;
  }

  // ── Org PRs for sidebar enrichment ──
  const orgQuery = createQuery<OrgPrsResponse>(() => ({
    queryKey: ['org-prs'],
    queryFn: fetchOrgPrs,
    staleTime: 60_000,
  }));

  let orgPrs = $derived(orgQuery.data?.prs ?? []);

  // ── Mobile long-press to enable drag ──
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  function handleTouchStart() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      mobileDragEnabled = true;
      longPressTimer = null;
    }, 500);
  }

  function cancelTouch() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    mobileDragEnabled = false;
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
        data-track="sidebar.home"
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
      use:dndzone={{ items: localDndItems, flipDurationMs, type: 'workspaces', dropTargetStyle: {}, dragDisabled }}
      onconsider={handleDndConsider}
      onfinalize={handleDndFinalize}
      ontouchstart={handleTouchStart}
      ontouchend={cancelTouch}
      ontouchmove={cancelTouch}
      ontouchcancel={cancelTouch}
    >
      {#each localDndItems as item (item.id)}
        {@const workspace = item.workspace}
        {@const activeSessions = getSessionsForWorkspace(workspace.path)}
        {@const activeWorktreePaths = new Set(activeSessions.map(s => s.worktreePath).filter(Boolean) as string[])}
        {@const inactiveWorktrees = sessionState.worktrees.filter(wt =>
          wt.repoPath === workspace.path &&
          wt.path.startsWith(workspace.path + '/') &&
          !activeWorktreePaths.has(wt.path)
        )}
        {@const groupedByPath = (() => {
          const groups = new Map<string, typeof activeSessions>();
          groups.set(workspace.path, []);
          for (const s of activeSessions) {
            const groupKey = s.worktreePath ?? s.workspacePath;
            const existing = groups.get(groupKey);
            if (existing) existing.push(s);
            else groups.set(groupKey, [s]);
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
            {onOpenSettings}
            onDeleteSession={(id) => onDeleteSession?.(id)}
            onDeleteWorktree={(wt) => onDeleteWorktree?.(wt)}
            {orgPrs}
          />
        </div>
      {/each}

      {#if sessionState.workspaces.length === 0}
        <div class="empty-state">
          <span>No workspaces</span>
        </div>
      {/if}
    </div>

    <div class="sidebar-footer-row">
      <button class="add-workspace-btn" data-track="sidebar.add-workspace" onclick={onAddWorkspace}>
        + Add Workspace
      </button>
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

  /* Mobile — full-screen overlay */
  @media (max-width: 600px) {
    .sidebar {
      position: fixed;
      inset: 0;
      width: 100vw !important;
      min-width: 100vw !important;
      height: 100vh;
      height: 100dvh;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      box-shadow: none;
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
