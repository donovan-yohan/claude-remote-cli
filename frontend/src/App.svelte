<script lang="ts">
  import { onMount } from 'svelte';
  import { getAuth, checkExistingAuth } from './lib/state/auth.svelte.js';
  import { getUi, openSidebar, closeSidebar } from './lib/state/ui.svelte.js';
  import { getSessionState, refreshAll, setAttention, setAgentState, clearAttention, renameSession, initSessionNotification, getNotificationSessionIds, getSessionsForWorkspace, refreshSessionMeta, setLoading, clearLoading, isItemLoading } from './lib/state/sessions.svelte.js';
  import { connectEventSocket, sendPtyData } from './lib/ws.js';
  import { initNotifications, initPushNotifications, resubscribeIfNeeded } from './lib/notifications.js';
  import { getConfigState } from './lib/state/config.svelte.js';
  import { isMobileDevice } from './lib/utils.js';
  import type { WorktreeInfo, OpenSessionOptions, Workspace, PullRequest } from './lib/types.js';
  import { createWorktree, createSession, fetchWorkspaceSettings, killSession, deleteWorktree } from './lib/api.js';
  import { derivePrAction, getActionPrompt } from './lib/pr-state.js';
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
  import AddWorkspaceDialog from './components/dialogs/AddWorkspaceDialog.svelte';
  import WorkspaceSettingsDialog from './components/dialogs/WorkspaceSettingsDialog.svelte';
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

  // Component refs — must be $state() so $effect can track bind:this assignments
  let terminalRef = $state<Terminal | undefined>();
  let imageToastRef = $state<ImageToast | undefined>();
  let newSessionDialogRef = $state<NewSessionDialog | undefined>();
  let settingsDialogRef = $state<SettingsDialog | undefined>();
  let deleteWorktreeDialogRef = $state<DeleteWorktreeDialog | undefined>();
  let workspaceSettingsDialogRef = $state<WorkspaceSettingsDialog | undefined>();
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

        // Auto-select if exactly one session exists and none is selected
        if (!sessionState.activeSessionId && !sessionParam && sessionState.sessions.length === 1) {
          handleSelectSession(sessionState.sessions[0]!.id);
        }

        // Auto-select if exactly one session exists and none is selected
        if (!sessionState.activeSessionId && !sessionParam && sessionState.sessions.length === 1) {
          handleSelectSession(sessionState.sessions[0]!.id);
        }

        // Initialize notifications for existing sessions
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
        } else if (msg.type === 'session-state-changed' && msg.sessionId && msg.state) {
          setAgentState(msg.sessionId, msg.state as import('./lib/types.js').AgentState);
        } else if (msg.type === 'session-idle-changed' && msg.sessionId) {
          setAttention(msg.sessionId, msg.idle ?? false);
        } else if (msg.type === 'session-renamed' && msg.sessionId) {
          renameSession(msg.sessionId, msg.branchName ?? '', msg.displayName ?? '');
        } else if (msg.type === 'session-ended') {
          queryClient.invalidateQueries({ queryKey: ['pr'] });
          queryClient.invalidateQueries({ queryKey: ['ci-status'] });
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

  let allWorkspaceSessions = $derived(
    ui.activeWorkspacePath
      ? getSessionsForWorkspace(ui.activeWorkspacePath)
      : []
  );

  let activeSession = $derived(
    sessionState.activeSessionId
      ? sessionState.sessions.find(s => s.id === sessionState.activeSessionId)
      : undefined
  );

  // Tab bar shows only sessions in the SAME worktree/directory as the active session
  // (not all sessions across all worktrees in the workspace)
  let workspaceSessions = $derived(
    activeSession
      ? allWorkspaceSessions.filter(s => s.repoPath === activeSession.repoPath)
      : allWorkspaceSessions
  );

  let hasActiveSession = $derived(!!activeSession && !!ui.activeWorkspacePath && (
    activeSession.repoPath === ui.activeWorkspacePath || activeSession.repoPath.startsWith(ui.activeWorkspacePath + '/')
  ));

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
    if (ui.activeWorkspacePath === path) {
      // Already viewing this workspace — return to dashboard
      sessionState.activeSessionId = null;
    } else {
      ui.activeWorkspacePath = path;
      sessionState.activeSessionId = null;
    }
    closeSidebar();
  }

  function handleSelectSession(id: string) {
    sessionState.activeSessionId = id;
    const session = sessionState.sessions.find(s => s.id === id);
    if (session) {
      // For worktree sessions, find the parent workspace path
      const workspace = sessionState.workspaces.find(w =>
        session.repoPath === w.path || session.repoPath.startsWith(w.path + '/')
      );
      ui.activeWorkspacePath = workspace?.path ?? session.repoPath;
    }
    clearAttention(id);
    closeSidebar();
    terminalRef?.focusTerm();
    refreshSessionMeta(id);
  }

  function handleOpenNewSession(workspace?: Workspace, options?: OpenSessionOptions) {
    if (workspace) {
      newSessionDialogRef?.open({ name: workspace.name, path: workspace.path, root: '' }, options);
    } else if (activeWorkspace) {
      newSessionDialogRef?.open({ name: activeWorkspace.name, path: activeWorkspace.path, root: '' }, options);
    } else {
      newSessionDialogRef?.open(undefined, options);
    }
  }

  function handleOpenSettings(workspace?: Workspace) {
    if (workspace) {
      workspaceSettingsDialogRef?.open(workspace.path, workspace.name);
    } else {
      settingsDialogRef?.open();
    }
  }

  async function handleNewWorktree(workspace: Workspace) {
    // Instant worktree creation — no dialog.
    // 1. Create git worktree with next mountain name via POST /workspaces/worktree
    // 2. Start a session in the new worktree with workspace default settings
    // 3. Session is flagged needsBranchRename — first message triggers auto-rename
    const loadingKey = `new-worktree:${workspace.path}`;
    if (isItemLoading(loadingKey)) return;
    setLoading(loadingKey);
    try {
      const { branchName, worktreePath } = await createWorktree(workspace.path);
      const session = await createSession({
        repoPath: workspace.path,
        repoName: workspace.name,
        worktreePath,
        branchName,
        needsBranchRename: true,
      });
      await refreshAll();
      sessionState.activeSessionId = session.id;
      ui.activeWorkspacePath = workspace.path;
      initSessionNotification(session.id, configState.defaultNotifications);
      closeSidebar();
      terminalRef?.focusTerm();
    } catch (e) {
      // Fall back to dialog on error
      newSessionDialogRef?.open({ name: workspace.name, path: workspace.path, root: '' });
    } finally {
      clearLoading(loadingKey);
    }
  }

  async function handleFixConflicts(pr: PullRequest) {
    if (!activeWorkspace) return;

    const workspacePath = activeWorkspace.path;

    const existingSession = sessionState.sessions.find(s => s.branchName === pr.headRefName && s.repoPath.startsWith(workspacePath));
    const existingWorktree = sessionState.worktrees.find(w => w.branchName === pr.headRefName && w.repoPath === workspacePath);

    let prompt = `Merge the branch "${pr.baseRefName}" into this branch and resolve all merge conflicts. Use \`git merge ${pr.baseRefName}\` and fix any conflicts in the working tree. After resolving, verify the build passes.`;
    try {
      const settings = await fetchWorkspaceSettings(workspacePath);
      if (settings.promptFixConflicts) {
        prompt = settings.promptFixConflicts
          .replace(/\{baseRefName\}/g, pr.baseRefName)
          .replace(/\{headRefName\}/g, pr.headRefName);
      }
    } catch {
      // fall through with default prompt
    }

    try {
      let worktreePath: string;
      let branchName: string;

      if (existingSession) {
        // Active session exists in this branch's worktree — open a new tab there
        worktreePath = existingSession.repoPath;
        branchName = existingSession.branchName;
      } else if (existingWorktree) {
        // Inactive worktree exists for this branch — reuse it
        worktreePath = existingWorktree.path;
        branchName = existingWorktree.branchName;
      } else {
        // No worktree yet — create one from the existing branch
        const wt = await createWorktree(workspacePath, pr.headRefName);
        worktreePath = wt.worktreePath;
        branchName = wt.branchName;
      }

      const session = await createSession({
        repoPath: workspacePath,
        repoName: activeWorkspace.name,
        worktreePath,
        branchName,
        allowMultiple: true,
      });
      await refreshAll();
      sessionState.activeSessionId = session.id;
      ui.activeWorkspacePath = workspacePath;
      initSessionNotification(session.id, configState.defaultNotifications);
      closeSidebar();

      // Delay sending the prompt to allow the terminal WebSocket connection to establish
      setTimeout(() => {
        sendPtyData(prompt + '\r');
      }, 1500);
    } catch (e) {
      console.error('Failed to start conflict resolution:', e);
    }
  }

  async function handleOpenPrBranch(pr: PullRequest, prompt?: string) {
    if (!activeWorkspace) return;
    const workspacePath = activeWorkspace.path;

    const existingSession = sessionState.sessions.find(s => s.branchName === pr.headRefName && s.repoPath.startsWith(workspacePath));
    const existingWorktree = sessionState.worktrees.find(w => w.branchName === pr.headRefName && w.repoPath === workspacePath);

    try {
      let worktreePath: string;
      let branchName: string;

      if (existingSession) {
        worktreePath = existingSession.repoPath;
        branchName = existingSession.branchName;
      } else if (existingWorktree) {
        worktreePath = existingWorktree.path;
        branchName = existingWorktree.branchName;
      } else {
        const wt = await createWorktree(workspacePath, pr.headRefName);
        worktreePath = wt.worktreePath;
        branchName = wt.branchName;
      }

      const session = await createSession({
        repoPath: workspacePath,
        repoName: activeWorkspace.name,
        worktreePath,
        branchName,
        allowMultiple: true,
      });
      await refreshAll();
      sessionState.activeSessionId = session.id;
      ui.activeWorkspacePath = workspacePath;
      initSessionNotification(session.id, configState.defaultNotifications);
      closeSidebar();

      if (prompt) {
        setTimeout(() => {
          sendPtyData(prompt + '\r');
        }, 1500);
      }
    } catch (e) {
      console.error('Failed to open PR branch session:', e);
    }
  }

  function handlePrAction(pr: PullRequest) {
    const prState = pr.state === 'OPEN' ? 'OPEN' : pr.state === 'MERGED' ? 'MERGED' : 'CLOSED';
    const action = derivePrAction({
      commitsAhead: 1,
      prState,
      ciPassing: 0,
      ciFailing: 0,
      ciPending: 0,
      ciTotal: 0,
      mergeable: (pr.mergeable as 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null) ?? null,
      unresolvedCommentCount: 0,
    });
    const prompt = getActionPrompt(action, {
      branchName: pr.headRefName,
      baseBranch: pr.baseRefName,
      prNumber: pr.number,
    });
    if (prompt) {
      handleOpenPrBranch(pr, prompt);
    }
  }

  function handleOpenPrSession(pr: PullRequest) {
    handleOpenPrBranch(pr);
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

  let addWorkspaceDialogRef = $state<AddWorkspaceDialog | undefined>();

  function handleAddWorkspace() {
    addWorkspaceDialogRef?.open();
  }

  async function handleWorkspacesAdded(paths: string[]) {
    await refreshAll();
    // Auto-select the first newly added workspace
    if (paths.length > 0) {
      ui.activeWorkspacePath = paths[0]!;
    }
  }

  async function handleArchive() {
    const sessionId = sessionState.activeSessionId;
    if (!sessionId) return;
    const session = sessionState.sessions.find(s => s.id === sessionId);
    if (!session) return;

    // Kill the session
    await killSession(sessionId);

    // If worktree session, delete the worktree too
    if (session.type === 'worktree') {
      const workspace = sessionState.workspaces.find(w =>
        session.repoPath === w.path || session.repoPath.startsWith(w.path + '/')
      );
      if (workspace && session.repoPath !== workspace.path) {
        try {
          await deleteWorktree(session.repoPath, workspace.path);
        } catch {
          // Best effort — worktree may already be gone
        }
      }
    }

    // Clear active session and refresh
    sessionState.activeSessionId = null;
    await refreshAll();
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
      onAddWorkspace={handleAddWorkspace}
      onDeleteSession={handleCloseSession}
      onDeleteWorktree={handleDeleteWorktree}
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
          creatingWorktree={isItemLoading(`new-worktree:${ui.activeWorkspacePath ?? ''}`)}
          onNewSession={() => handleOpenNewSession()}
          onNewWorktree={() => { if (activeWorkspace) handleNewWorktree(activeWorkspace); }}
          onFixConflicts={handleFixConflicts}
          onPrAction={handlePrAction}
          onOpenPrSession={handleOpenPrSession}
        />

      {:else if viewMode === 'session'}
        <PrTopBar
          workspacePath={ui.activeWorkspacePath ?? ''}
          branchName={activeSession?.branchName ?? ''}
          sessionId={sessionState.activeSessionId}
          onArchive={handleArchive}
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
  <AddWorkspaceDialog bind:this={addWorkspaceDialogRef} onWorkspacesAdded={handleWorkspacesAdded} />
  <WorkspaceSettingsDialog
    bind:this={workspaceSettingsDialogRef}
    onRemoveWorkspace={async (p) => {
      await fetch('/workspaces', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) });
      await refreshAll();
      if (ui.activeWorkspacePath === p) ui.activeWorkspacePath = null;
    }}
  />

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
