<script lang="ts">
  import { getUi, closeSidebar, saveSidebarWidth, toggleSidebarCollapsed, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH, COLLAPSED_SIDEBAR_WIDTH } from '../lib/state/ui.svelte.js';
  import type { RepoInfo, WorktreeInfo } from '../lib/types.js';
  import SessionList from './SessionList.svelte';

  const ui = getUi();

  let {
    onSelectSession,
    onOpenNewSession,
    onOpenSettings,
    onNewWorktree,
    onDeleteWorktree,
  }: {
    onSelectSession: (id: string) => void;
    onOpenNewSession: (repo?: RepoInfo) => void;
    onOpenSettings: () => void;
    onNewWorktree: (repo: RepoInfo) => void;
    onDeleteWorktree: (wt: WorktreeInfo) => void;
  } = $props();

  let newSessionLabel = $derived(ui.activeTab === 'worktrees' ? '+ New Worktree' : '+ New Session');
  let effectiveWidth = $derived(ui.sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : ui.sidebarWidth);

  function startResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = ui.sidebarWidth;

    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + (e.clientX - startX)));
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

<aside class="sidebar" class:open={ui.sidebarOpen} class:collapsed={ui.sidebarCollapsed} style:width="{effectiveWidth}px" style:min-width="{effectiveWidth}px">
  <div class="sidebar-header">
    <button class="collapse-btn" aria-label={ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onclick={toggleSidebarCollapsed}>
      {ui.sidebarCollapsed ? '»' : '«'}
    </button>
    {#if !ui.sidebarCollapsed}
      <span class="sidebar-label">Sessions</span>
    {/if}
    <button class="icon-btn" aria-label="Close sidebar" onclick={closeSidebar}>✕</button>
  </div>

  {#if !ui.sidebarCollapsed}
    <SessionList
      {onSelectSession}
      {onOpenNewSession}
      {onNewWorktree}
      {onDeleteWorktree}
    />

    <button class="new-session-btn" onclick={() => onOpenNewSession()}>
      {newSessionLabel}
    </button>
    <button class="settings-btn" onclick={onOpenSettings}>
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
    /* width and min-width set via inline style (effectiveWidth) */
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow: hidden;
    transition: transform 0.25s ease, width 0.2s ease, min-width 0.2s ease;
    z-index: 100;
  }

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
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .collapse-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    flex-shrink: 0;
    line-height: 1;
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
    display: none; /* shown on mobile */
  }

  .icon-btn:active {
    background: var(--border);
  }

  .new-session-btn {
    margin: 8px;
    padding: 10px 12px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.875rem;
    cursor: pointer;
    touch-action: manipulation;
    text-align: center;
    flex-shrink: 0;
  }

  .new-session-btn:active {
    background: var(--border);
  }

  .settings-btn {
    margin: 0 8px 8px;
    padding: 10px 12px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    touch-action: manipulation;
    text-align: center;
    flex-shrink: 0;
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
