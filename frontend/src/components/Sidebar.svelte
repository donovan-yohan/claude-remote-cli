<script lang="ts">
  import { getUi, closeSidebar } from '../lib/state/ui.svelte.js';
  import type { RepoInfo, WorktreeInfo } from '../lib/types.js';
  import SessionList from './SessionList.svelte';

  const ui = getUi();

  let {
    onSelectSession,
    onOpenNewSession,
    onOpenSettings,
    onResumeYolo,
    onDeleteWorktree,
  }: {
    onSelectSession: (id: string) => void;
    onOpenNewSession: (repo?: RepoInfo) => void;
    onOpenSettings: () => void;
    onResumeYolo: (wt: WorktreeInfo) => void;
    onDeleteWorktree: (wt: WorktreeInfo) => void;
  } = $props();

  let newSessionLabel = $derived(
    ui.activeTab === 'repos' ? '+ New Session' :
    ui.activeTab === 'prs' ? '+ New Session' :
    '+ New Worktree'
  );
</script>

<aside class="sidebar" class:open={ui.sidebarOpen}>
  <div class="sidebar-header">
    <span class="sidebar-label">Sessions</span>
    <button class="icon-btn" aria-label="Close sidebar" onclick={closeSidebar}>✕</button>
  </div>

  <SessionList
    {onSelectSession}
    {onOpenNewSession}
    {onResumeYolo}
    {onDeleteWorktree}
  />

  <button class="new-session-btn" onclick={() => onOpenNewSession()}>
    {newSessionLabel}
  </button>
  <button class="settings-btn" onclick={onOpenSettings}>
    ⚙ Settings
  </button>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: var(--sidebar-width);
    min-width: var(--sidebar-width);
    background: var(--surface);
    border-right: 1px solid var(--border);
    overflow: hidden;
    transition: transform 0.25s ease;
    z-index: 100;
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
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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
    }

    .sidebar.open {
      transform: translateX(0);
    }

    .icon-btn {
      display: block;
      font-size: 1.4rem;
      padding: 4px 8px;
    }
  }
</style>
