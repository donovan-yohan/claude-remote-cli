<script lang="ts">
  import { onMount } from 'svelte';
  import { getAuth, checkExistingAuth } from './lib/state/auth.svelte.js';
  import { getUi, openSidebar, closeSidebar } from './lib/state/ui.svelte.js';
  import { getSessionState, refreshAll, setAttention, clearAttention, initSessionNotification, getNotificationSessionIds, getSessionsForWorkspace } from './lib/state/sessions.svelte.js';
  import { connectEventSocket, sendPtyData } from './lib/ws.js';
  import { initNotifications, initPushNotifications, resubscribeIfNeeded } from './lib/notifications.js';
  import { getConfigState } from './lib/state/config.svelte.js';
  import { isMobileDevice } from './lib/utils.js';
  import type { WorktreeInfo, OpenSessionOptions, Workspace } from './lib/types.js';
  import PinGate from './components/PinGate.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Terminal from './components/Terminal.svelte';
  import PrTopBar from './components/PrTopBar.svelte';
  import SessionTabBar from './components/SessionTabBar.svelte';
  import RepoDashboard from './components/RepoDashboard.svelte';
  import EmptyState from './components/EmptyState.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import MobileHeader from './components/MobileHeader.svelte';
  import UpdateToast from './components/UpdateToast.svelte';
  import ImageToast from './components/ImageToast.svelte';
  import NewSessionDialog from './components/dialogs/NewSessionDialog.svelte';
  import SettingsDialog from './components/dialogs/SettingsDialog.svelte';
  import DeleteWorktreeDialog from './components/dialogs/DeleteWorktreeDialog.svelte';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: true,
      },
    },
  });

  const auth = getAuth();
  const ui = getUi();
  const sessionState = getSessionState();
  const configState = getConfigState();

  function navigateToSession(sessionId: string, _sessionType: string) {
    sessionState.activeSessionId = sessionId;
    // Set active workspace from session's repoPath
    const session = sessionState.sessions.find(s => s.id === sessionId);
    if (session) {
      ui.activeWorkspacePath = session.repoPath;
    }
    clearAttention(sessionId);
    closeSidebar();
  }

  initNotifications(navigateToSession);

  let terminalRef = $state<Terminal | undefined>();
  let imageToastRef = $state<ImageToast | undefined>();
  let newSessionDialogRef = $state<NewSessionDialog | undefined>();
  let settingsDialogRef = $state<SettingsDialog | undefined>();
  let deleteWorktreeDialogRef = $state<DeleteWorktreeDialog | undefined>();
  let mainAppEl = $state<HTMLDivElement | undefined>();

  let keyboardOpen = $state(false);

  onMount(() => {
    checkExistingAuth();

    let cleanupViewport: (() => void) | undefined;
    let cleanupSwipe: (() => void) | undefined;

    if (isMobileDevice && window.visualViewport) {
      const vv = window.visualViewport;
      let fitTimer: ReturnType<typeof setTimeout> | null = null;

      const onViewportResize = () => {
        const kbHeight = window.innerHeight - vv.height;
        keyboardOpen = kbHeight > 50;
        if (mainAppEl) {
          mainAppEl.style.height = keyboardOpen ? vv.height + 'px' : '';
        }
        window.scrollTo(0, 0);
        if (fitTimer) clearTimeout(fitTimer);
        fitTimer = setTimeout(() => terminalRef?.fitTerm(), 100);
      };
      vv.addEventListener('resize', onViewportResize);
      vv.addEventListener('scroll', onViewportResize);
      cleanupViewport = () => {
        vv.removeEventListener('resize', onViewportResize);
        vv.removeEventListener('scroll', onViewportResize);
        if (fitTimer) clearTimeout(fitTimer);
      };
    }

    // Keyboard shortcuts for tab navigation (desktop only)
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    let cleanupKeydown: (() => void) | undefined;

    {
      const onKeydown = (e: KeyboardEvent) => {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (!mod) return;

        // Cmd/Ctrl+T — new session tab
        if (e.key === 't' && !e.shiftKey) {
          e.preventDefault();
          handleOpenNewSession();
          return;
        }

        // Cmd/Ctrl+W — close current session tab
        if (e.key === 'w' && !e.shiftKey) {
          e.preventDefault();
          if (sessionState.activeSessionId) {
            handleCloseSession(sessionState.activeSessionId);
          }
          return;
        }

        // Cmd/Ctrl+1–9 — switch to tab N (9 = last)
        if (!e.shiftKey && e.key >= '1' && e.key <= '9') {
          const sessions = workspaceSessions;
          if (sessions.length === 0) return;
          e.preventDefault();
          const n = parseInt(e.key, 10);
          const target = n === 9 ? sessions[sessions.length - 1] : sessions[n - 1];
          if (target) handleSelectSession(target.id);
          return;
        }

        // Cmd/Ctrl+Shift+[ — previous tab (cycle)
        if (e.shiftKey && e.key === '[') {
          const sessions = workspaceSessions;
          if (sessions.length === 0) return;
          e.preventDefault();
          const idx = sessions.findIndex(s => s.id === sessionState.activeSessionId);
          const prev = idx <= 0 ? sessions[sessions.length - 1] : sessions[idx - 1];
          if (prev) handleSelectSession(prev.id);
          return;
        }

        // Cmd/Ctrl+Shift+] — next tab (cycle)
        if (e.shiftKey && e.key === ']') {
          const sessions = workspaceSessions;
          if (sessions.length === 0) return;
          e.preventDefault();
          const idx = sessions.findIndex(s => s.id === sessionState.activeSessionId);
          const next = idx === -1 || idx === sessions.length - 1 ? sessions[0] : sessions[idx + 1];
          if (next) handleSelectSession(next.id);
          return;
        }
      };

      document.addEventListener('keydown', onKeydown);
      cleanupKeydown = () => document.removeEventListener('keydown', onKeydown);
    }

    if (isMobileDevice) {
      const EDGE_ZONE = 30;
      const SWIPE_THRESHOLD = 50;
      let swipeStartX = 0;
      let swipeStartY = 0;
      let swipeTracking = false;

      const onSwipeTouchStart = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        if (touch.clientX <= EDGE_ZONE && !ui.sidebarOpen) {
          swipeStartX = touch.clientX;
          swipeStartY = touch.clientY;
          swipeTracking = true;
        }
      };

      const onSwipeTouchMove = (e: TouchEvent) => {
        if (!swipeTracking) return;
        const touch = e.touches[0];
        if (!touch) return;
        const dx = touch.clientX - swipeStartX;
        const dy = Math.abs(touch.clientY - swipeStartY);
        if (dy > dx && (dy > 8 || dx > 8)) {
          swipeTracking = false;
          return;
        }
        if (dx >= SWIPE_THRESHOLD) {
          swipeTracking = false;
          openSidebar();
        }
      };

      const onSwipeTouchEnd = () => { swipeTracking = false; };

      document.addEventListener('touchstart', onSwipeTouchStart, { passive: true });
      document.addEventListener('touchmove', onSwipeTouchMove, { passive: true });
      document.addEventListener('touchend', onSwipeTouchEnd);
      cleanupSwipe = () => {
        document.removeEventListener('touchstart', onSwipeTouchStart);
        document.removeEventListener('touchmove', onSwipeTouchMove);
        document.removeEventListener('touchend', onSwipeTouchEnd);
      };
    }

    return () => {
      cleanupKeydown?.();
      cleanupViewport?.();
      cleanupSwipe?.();
    };
  });

  // Refresh when authenticated
  $effect(() => {
    if (auth.authenticated) {
      refreshAll().then(() => {
        const params = new URLSearchParams(window.location.search);
        const sessionParam = params.get('session');
        if (sessionParam) {
          window.history.replaceState({}, '', '/');
          navigateToSession(sessionParam, 'repo');
        }

        for (const s of sessionState.sessions) {
          initSessionNotification(s.id, configState.defaultNotifications);
        }

        initPushNotifications().then(() => {
          resubscribeIfNeeded(getNotificationSessionIds());
        });
      });
    }
  });

  // Event socket
  $effect(() => {
    if (auth.authenticated) {
      connectEventSocket((msg) => {
        if (msg.type === 'worktrees-changed') {
          refreshAll();
        } else if (msg.type === 'session-idle-changed' && msg.sessionId) {
          setAttention(msg.sessionId, msg.idle ?? false);
        }
      });
    }
  });

  // Derived state
  let activeWorkspace = $derived<Workspace | undefined>(
    ui.activeWorkspacePath
      ? sessionState.workspaces.find(w => w.path === ui.activeWorkspacePath)
      : undefined
  );

  let workspaceSessions = $derived(
    ui.activeWorkspacePath
      ? getSessionsForWorkspace(ui.activeWorkspacePath)
      : []
  );

  let activeSession = $derived(
    sessionState.activeSessionId
      ? sessionState.sessions.find(s => s.id === sessionState.activeSessionId)
      : undefined
  );

  let hasActiveSession = $derived(!!activeSession && activeSession.repoPath === ui.activeWorkspacePath);

  let sessionTitle = $derived(
    activeSession?.displayName || activeWorkspace?.name || 'Claude Remote CLI'
  );

  let activeSessionUseTmux = $derived(activeSession?.useTmux ?? false);
  let copyModeActive = $state(false);

  // View state: which main area content to show
  let viewMode = $derived<'empty' | 'dashboard' | 'session'>(
    !activeWorkspace ? 'empty' :
    !hasActiveSession ? 'dashboard' :
    'session'
  );

  // Handlers
  function handleSelectWorkspace(path: string) {
    ui.activeWorkspacePath = path;
    // If workspace has sessions, select the first one
    const sessions = getSessionsForWorkspace(path);
    if (sessions.length > 0 && sessions[0]) {
      sessionState.activeSessionId = sessions[0].id;
    } else {
      sessionState.activeSessionId = null;
    }
    closeSidebar();
  }

  function handleSelectSession(id: string) {
    sessionState.activeSessionId = id;
    const session = sessionState.sessions.find(s => s.id === id);
    if (session) {
      ui.activeWorkspacePath = session.repoPath;
    }
    clearAttention(id);
    closeSidebar();
    terminalRef?.focusTerm();
  }

  function handleOpenNewSession(workspace?: Workspace, options?: OpenSessionOptions) {
    if (workspace) {
      newSessionDialogRef?.open({ name: workspace.name, path: workspace.path }, options);
    } else if (activeWorkspace) {
      newSessionDialogRef?.open({ name: activeWorkspace.name, path: activeWorkspace.path }, options);
    } else {
      newSessionDialogRef?.open(undefined, options);
    }
  }

  function handleOpenSettings() {
    settingsDialogRef?.open();
  }

  function handleNewWorktree(workspace: Workspace) {
    newSessionDialogRef?.open({ name: workspace.name, path: workspace.path });
  }

  function handleDeleteWorktree(wt: WorktreeInfo) {
    deleteWorktreeDialogRef?.open(wt);
  }

  function handleNewSessionCreated(sessionId: string) {
    sessionState.activeSessionId = sessionId;
    initSessionNotification(sessionId, configState.defaultNotifications);
    closeSidebar();
    terminalRef?.focusTerm();
  }

  function handleCloseSession(sessionId: string) {
    // Kill session via API, then refresh
    fetch(`/sessions/${sessionId}`, { method: 'DELETE' }).then(() => refreshAll());
    if (sessionState.activeSessionId === sessionId) {
      // Select next available session in this workspace
      const remaining = workspaceSessions.filter(s => s.id !== sessionId);
      sessionState.activeSessionId = remaining[0]?.id ?? null;
    }
  }

  function handleImageUpload(text: string, showInsert: boolean, path?: string) {
    imageToastRef?.show(text, showInsert, path);
    if (!showInsert) {
      imageToastRef?.autoDismiss(3000);
    }
  }

  function handleSendKey(key: string) { sendPtyData(key); }
  function handleFlushComposedText() { /* xterm.js handles natively */ }
  function handleClearInput() { /* xterm.js manages textarea */ }

  function handleUploadImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) terminalRef?.handleImageUpload(file, file.type);
    };
    input.click();
  }

  function handleRefocusMobileInput() { terminalRef?.focusTerm(); }
  function handleCopyModeChange(active: boolean) { copyModeActive = active; }
  function handleExitCopyMode() { terminalRef?.exitCopyMode(); }

  function handleAddWorkspace() {
    // TODO: implement add workspace dialog with path autocomplete
    const path = prompt('Enter workspace folder path:');
    if (path) {
      fetch('/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }).then(() => refreshAll());
    }
  }
</script>

{#if auth.checking}
  <!-- Loading -->
{:else if !auth.authenticated}
  <PinGate />
{:else}
  <QueryClientProvider client={queryClient}>
  <div class="main-app" bind:this={mainAppEl}>
    <!-- Sidebar overlay (mobile) -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {#if ui.sidebarOpen}
      <div class="sidebar-overlay" onclick={closeSidebar}></div>
    {/if}

    <Sidebar
      onSelectSession={handleSelectSession}
      onOpenSettings={handleOpenSettings}
      onNewWorktree={handleNewWorktree}
      onNewSession={(w) => handleOpenNewSession(w)}
      onNewTerminal={(w) => handleOpenNewSession(w, { agent: 'claude' })}
      onAddWorkspace={handleAddWorkspace}
    />

    <div class="terminal-area">
      <MobileHeader
        title={sessionTitle}
        onMenuClick={openSidebar}
        hidden={keyboardOpen}
      />

      {#if viewMode === 'empty'}
        <EmptyState
          heading="Add a workspace to get started"
          description="Point to any folder on your machine. Git repos get PR tracking and branch management."
          actionLabel="+ Add Workspace"
          onAction={handleAddWorkspace}
        />

      {:else if viewMode === 'dashboard'}
        <RepoDashboard
          workspacePath={ui.activeWorkspacePath ?? ''}
          workspaceName={activeWorkspace?.name ?? ''}
          onNewSession={() => handleOpenNewSession()}
          onNewWorktree={() => { if (activeWorkspace) handleNewWorktree(activeWorkspace); }}
        />

      {:else if viewMode === 'session'}
        <PrTopBar
          workspacePath={ui.activeWorkspacePath ?? ''}
          branchName={activeSession?.branchName ?? ''}
          sessionId={sessionState.activeSessionId}
        />

        <SessionTabBar
          sessions={workspaceSessions}
          activeSessionId={sessionState.activeSessionId}
          onSelectSession={handleSelectSession}
          onCloseSession={handleCloseSession}
          onNewSession={() => handleOpenNewSession()}
          onNewTerminal={() => handleOpenNewSession(undefined, { agent: 'claude' })}
        />

        <Terminal
          bind:this={terminalRef}
          sessionId={sessionState.activeSessionId}
          onImageUpload={handleImageUpload}
          useTmux={activeSessionUseTmux}
          onCopyModeChange={handleCopyModeChange}
        />

        <Toolbar
          onSendKey={handleSendKey}
          onFlushComposedText={handleFlushComposedText}
          onClearInput={handleClearInput}
          onUploadImage={handleUploadImage}
          onRefocusMobileInput={handleRefocusMobileInput}
          useTmux={activeSessionUseTmux}
          inCopyMode={copyModeActive}
          onExitCopyMode={handleExitCopyMode}
        />
      {/if}
    </div>
  </div>

  <!-- Dialogs & overlays -->
  <NewSessionDialog
    bind:this={newSessionDialogRef}
    onSessionCreated={handleNewSessionCreated}
  />
  <SettingsDialog bind:this={settingsDialogRef} />
  <DeleteWorktreeDialog bind:this={deleteWorktreeDialogRef} />

  <!-- Toasts -->
  <UpdateToast />
  <ImageToast bind:this={imageToastRef} />
  </QueryClientProvider>
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

  /* Mobile */
  @media (max-width: 600px) {
    .main-app {
      position: fixed;
      inset: 0;
      width: 100%;
    }

    .sidebar-overlay {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 99;
    }

    .terminal-area {
      width: 100%;
    }
  }
</style>
