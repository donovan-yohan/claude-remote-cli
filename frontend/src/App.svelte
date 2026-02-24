<script lang="ts">
  import { onMount } from 'svelte';
  import { getAuth, checkExistingAuth } from './lib/state/auth.svelte.js';
  import { getUi, openSidebar, closeSidebar } from './lib/state/ui.svelte.js';
  import { getSessionState, refreshAll, setAttention, clearAttention } from './lib/state/sessions.svelte.js';
  import { connectEventSocket, sendPtyData } from './lib/ws.js';
  import { isMobileDevice } from './lib/utils.js';
  import type { RepoInfo, WorktreeInfo } from './lib/types.js';
  import PinGate from './components/PinGate.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Terminal from './components/Terminal.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import MobileHeader from './components/MobileHeader.svelte';
  import MobileInput from './components/MobileInput.svelte';
  import UpdateToast from './components/UpdateToast.svelte';
  import ImageToast from './components/ImageToast.svelte';
  import NewSessionDialog from './components/dialogs/NewSessionDialog.svelte';
  import SettingsDialog from './components/dialogs/SettingsDialog.svelte';
  import DeleteWorktreeDialog from './components/dialogs/DeleteWorktreeDialog.svelte';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const auth = getAuth();
  const ui = getUi();
  const sessionState = getSessionState();

  // Component refs
  let terminalRef: Terminal;
  let mobileInputRef: MobileInput;
  let imageToastRef: ImageToast;
  let newSessionDialogRef: NewSessionDialog;
  let settingsDialogRef: SettingsDialog;
  let deleteWorktreeDialogRef: DeleteWorktreeDialog;
  let mainAppEl: HTMLDivElement;

  // Mobile keyboard state
  let keyboardOpen = $state(false);

  onMount(() => {
    checkExistingAuth();

    // Mobile: track virtual keyboard via visualViewport API
    if (isMobileDevice && window.visualViewport) {
      const vv = window.visualViewport;
      const onViewportResize = () => {
        const kbHeight = window.innerHeight - vv.height;
        keyboardOpen = kbHeight > 50;
        if (mainAppEl) {
          if (keyboardOpen) {
            mainAppEl.style.height = vv.height + 'px';
          } else {
            mainAppEl.style.height = '';
          }
        }
        // Prevent iOS from scrolling the viewport when keyboard opens
        window.scrollTo(0, 0);
        terminalRef?.fitTerm();
      };
      vv.addEventListener('resize', onViewportResize);
      vv.addEventListener('scroll', onViewportResize);
      return () => {
        vv.removeEventListener('resize', onViewportResize);
        vv.removeEventListener('scroll', onViewportResize);
      };
    }
  });

  // Refresh sessions when authenticated
  $effect(() => {
    if (auth.authenticated) {
      refreshAll();
    }
  });

  // Connect event socket when authenticated
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

  // Wire MobileInput ref into Terminal after both are mounted
  $effect(() => {
    if (terminalRef && mobileInputRef) {
      terminalRef.setMobileInputRef(mobileInputRef.getInputEl());
    }
  });

  function handleSelectSession(id: string) {
    sessionState.activeSessionId = id;
    clearAttention(id);
    closeSidebar();
    terminalRef?.focusTerm();
    mobileInputRef?.onSessionChange?.();
  }

  function handleOpenNewSession(repo?: RepoInfo) {
    newSessionDialogRef?.open(repo);
  }

  function handleOpenSettings() {
    settingsDialogRef?.open();
  }

  function handleNewWorktree(repo: RepoInfo) {
    newSessionDialogRef?.open(repo, { tab: 'worktrees' });
  }

  function handleDeleteWorktree(wt: WorktreeInfo) {
    deleteWorktreeDialogRef?.open(wt);
  }

  function handleNewSessionCreated(sessionId: string) {
    sessionState.activeSessionId = sessionId;
    closeSidebar();
    terminalRef?.focusTerm();
  }

  // Image upload handlers
  function handleImageUpload(text: string, showInsert: boolean, path?: string) {
    imageToastRef?.show(text, showInsert, path);
    if (!showInsert) {
      imageToastRef?.autoDismiss(3000);
    }
  }

  // Mobile toolbar handlers
  function handleSendKey(key: string) {
    sendPtyData(key);
  }

  function handleFlushComposedText() {
    mobileInputRef?.flushComposedText?.();
  }

  function handleClearInput() {
    mobileInputRef?.clearInput?.();
  }

  function handleUploadImage() {
    // Trigger file input for image upload
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        terminalRef?.handleImageUpload(file, file.type);
      }
    };
    input.click();
  }

  function handleRefocusMobileInput() {
    mobileInputRef?.focus?.();
  }

  let sessionTitle = $derived(
    sessionState.activeSessionId
      ? (sessionState.sessions.find(s => s.id === sessionState.activeSessionId)?.displayName || 'Session')
      : 'Claude Remote CLI'
  );
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
      onOpenNewSession={handleOpenNewSession}
      onOpenSettings={handleOpenSettings}
      onNewWorktree={handleNewWorktree}
      onDeleteWorktree={handleDeleteWorktree}
    />

    <div class="terminal-area">
      <MobileHeader
        title={sessionTitle}
        onMenuClick={openSidebar}
        hidden={keyboardOpen}
      />

      <Terminal
        bind:this={terminalRef}
        sessionId={sessionState.activeSessionId}
        onImageUpload={handleImageUpload}
      />

      <Toolbar
        onSendKey={handleSendKey}
        onFlushComposedText={handleFlushComposedText}
        onClearInput={handleClearInput}
        onUploadImage={handleUploadImage}
        onRefocusMobileInput={handleRefocusMobileInput}
      />

      <MobileInput
        bind:this={mobileInputRef}
        onTerminalTouchFocus={() => mobileInputRef?.focus()}
      />

      <div class="no-session-msg">
        {#if !sessionState.activeSessionId}
          <p>Select or create a session</p>
        {/if}
      </div>
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
