<script lang="ts">
  import { onMount } from 'svelte';
  import { getAuth, checkExistingAuth } from './lib/state/auth.svelte.js';
  import { getUi, openSidebar, closeSidebar } from './lib/state/ui.svelte.js';
  import { getSessionState, refreshAll } from './lib/state/sessions.svelte.js';
  import type { RepoInfo, WorktreeInfo } from './lib/types.js';
  import PinGate from './components/PinGate.svelte';
  import Sidebar from './components/Sidebar.svelte';

  const auth = getAuth();
  const ui = getUi();
  const state = getSessionState();

  onMount(() => {
    checkExistingAuth();
  });

  $effect(() => {
    if (auth.authenticated) {
      refreshAll();
    }
  });

  function handleSelectSession(id: string) {
    state.activeSessionId = id;
    closeSidebar();
  }

  function handleOpenNewSession(_repo?: RepoInfo) {
    // Stub — dialog components added in Task 6
  }

  function handleOpenSettings() {
    // Stub — dialog components added in Task 6
  }

  function handleContextMenu(_e: MouseEvent, _wt: WorktreeInfo) {
    // Stub — context menu added in Task 6
  }
</script>

{#if auth.checking}
  <!-- Loading -->
{:else if !auth.authenticated}
  <PinGate />
{:else}
  <div class="main-app">
    <!-- Sidebar overlay (mobile) -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {#if ui.sidebarOpen}
      <div class="sidebar-overlay" onclick={closeSidebar}></div>
    {/if}

    <Sidebar
      onSelectSession={handleSelectSession}
      onOpenNewSession={handleOpenNewSession}
      onOpenSettings={handleOpenSettings}
      onContextMenu={handleContextMenu}
    />

    <div class="terminal-area">
      <!-- Mobile header -->
      <div class="mobile-header">
        <button class="icon-btn" aria-label="Open sidebar" onclick={openSidebar}>☰</button>
        <span class="mobile-title">
          {state.activeSessionId
            ? (state.sessions.find(s => s.id === state.activeSessionId)?.displayName || 'Session')
            : 'Claude Remote CLI'}
        </span>
      </div>

      <div class="no-session-msg">
        {#if !state.activeSessionId}
          <p>Select or create a session</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .main-app {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .sidebar-overlay {
    display: none;
  }

  .terminal-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    position: relative;
  }

  .mobile-header {
    display: none;
  }

  .no-session-msg {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: var(--text-muted);
    font-size: 0.95rem;
    text-align: center;
    pointer-events: none;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--text);
    font-size: 1.4rem;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    touch-action: manipulation;
  }

  .icon-btn:active {
    background: var(--border);
  }

  .mobile-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  /* Mobile */
  @media (max-width: 600px) {
    .sidebar-overlay {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 99;
    }

    .mobile-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .terminal-area {
      width: 100%;
    }
  }
</style>
