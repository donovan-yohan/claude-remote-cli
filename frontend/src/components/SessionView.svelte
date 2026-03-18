<script lang="ts">
  import type { SdkEvent, PermissionRequest } from '../lib/types.js';
  import { getSdkState, appendEvent, setPermission, resolvePermission, initSdkState, setStreaming } from '../lib/state/sdk.svelte.js';
  import { sendSdkMessage, sendPermissionResponse, sendOpenCompanion, connectSdkSocket } from '../lib/ws.js';
  import ChatView from './ChatView.svelte';
  import ChatInput from './ChatInput.svelte';
  import QuickReplies from './QuickReplies.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import CostDisplay from './CostDisplay.svelte';
  import Terminal from './Terminal.svelte';
  import type { SdkSocketCallbacks } from '../lib/ws.js';

  let {
    sessionId,
    mode = 'pty',
    sdkFallback = false,
    onImageUpload,
    useTmux = false,
    onCopyModeChange,
  }: {
    sessionId: string | null;
    mode?: 'sdk' | 'pty';
    sdkFallback?: boolean;
    onImageUpload?: ((text: string, showInsert: boolean, path?: string) => void) | undefined;
    useTmux?: boolean;
    onCopyModeChange?: ((active: boolean) => void) | undefined;
  } = $props();

  let activeTab = $state<'chat' | 'terminal'>('chat');
  let terminalRef = $state<Terminal | undefined>();
  let companionConnected = $state(false);
  let companionLoading = $state(false);
  let companionError = $state(false);

  // Track last user message for retry (#13)
  let lastUserMessage = $state('');

  let sdkState = $derived(sessionId ? getSdkState(sessionId) : null);

  // Events are the source of truth — user_message events are appended directly to the event stream
  let displayEvents = $derived(() => {
    if (!sdkState) return [] as SdkEvent[];
    return sdkState.events;
  });

  // Initialize SDK state when session changes
  $effect(() => {
    if (sessionId && mode === 'sdk') {
      initSdkState(sessionId);
      lastUserMessage = '';
      companionConnected = false;
      companionError = false;
      activeTab = 'chat';

      const callbacks: SdkSocketCallbacks = {
        onEvent: (event: SdkEvent) => {
          if (!sessionId) return;
          // Handle permission requests embedded in tool_call events
          if (event.type === 'tool_call' && event.status === 'pending' && event.id && event.toolName) {
            setPermission(sessionId, {
              id: event.id,
              toolName: event.toolName,
              input: event.toolInput ?? {},
              status: 'pending',
            });
          }
          appendEvent(sessionId, event);
        },
        onTerminalData: (data: string) => {
          companionLoading = false;
          companionConnected = true;
          // Terminal component handles its own data writing
        },
        onTerminalExit: () => {
          companionConnected = false;
        },
        onSessionEnd: () => {
          if (sessionId) setStreaming(sessionId, false);
        },
      };

      connectSdkSocket(sessionId, callbacks);
    }
  });

  function handleSend(text: string) {
    if (!sessionId) return;
    lastUserMessage = text;
    // Append user message directly to event stream so it survives reconnect/restore
    appendEvent(sessionId, {
      type: 'user_message',
      text,
      timestamp: new Date().toISOString(),
      id: 'user-' + Date.now(),
    });
    sendSdkMessage(text);
  }

  function handleQuickReply(text: string) {
    handleSend(text);
  }

  function handleApprove(requestId: string) {
    if (sessionId) resolvePermission(sessionId, 'approved');
    sendPermissionResponse(requestId, true);
  }

  function handleDeny(requestId: string) {
    if (sessionId) resolvePermission(sessionId, 'denied');
    sendPermissionResponse(requestId, false);
  }

  function handleRetry() {
    handleSend(lastUserMessage || 'Retry');
  }

  function openCompanionShell() {
    companionLoading = true;
    companionError = false;
    sendOpenCompanion();
    // Timeout after 10s
    setTimeout(() => {
      if (companionLoading) {
        companionLoading = false;
        companionError = true;
      }
    }, 10_000);
  }

  function handleTerminalTabClick() {
    activeTab = 'terminal';
    if (!companionConnected && !companionLoading && mode === 'sdk') {
      openCompanionShell();
    }
  }

  // Expose methods for parent compatibility
  export function focusTerm() {
    terminalRef?.focusTerm();
  }

  export function fitTerm() {
    terminalRef?.fitTerm();
  }

  export function exitCopyMode() {
    terminalRef?.exitCopyMode();
  }

  export function handleImageUpload(blob: Blob, mimeType: string) {
    terminalRef?.handleImageUpload(blob, mimeType);
  }
</script>

{#if mode === 'sdk'}
  <div class="session-view">
    {#if sdkFallback}
      <div class="fallback-banner">
        SDK mode unavailable — fell back to terminal
      </div>
    {/if}

    <div class="tab-bar" role="tablist">
      <button
        class="tab active"
        role="tab"
        aria-selected={true}
      >
        Chat
      </button>
    </div>

    <div class="tab-content">
      <div class="tab-panel chat-panel" style:display={activeTab === 'chat' ? 'flex' : 'none'}>
        <div class="chat-scroll-area">
          <ChatView
            events={displayEvents()}
            isStreaming={sdkState?.isStreaming ?? false}
            onRetry={handleRetry}
          />
        </div>

        {#if sdkState?.activePermission && sdkState.activePermission.status === 'pending'}
          <PermissionCard
            permission={sdkState.activePermission}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />
        {/if}

        <QuickReplies
          suggestions={sdkState?.quickReplies ?? []}
          onSelect={handleQuickReply}
        />

        <CostDisplay usage={sdkState?.tokenUsage ?? { input: 0, output: 0, estimatedCost: 0 }} />

        <ChatInput
          disabled={sdkState?.isStreaming ?? false}
          onSend={handleSend}
        />
      </div>

      <!-- Terminal tab hidden for SDK sessions until companion shell is implemented (open_companion WS handler needed on server) -->
    </div>
  </div>
{:else}
  <!-- PTY mode: just render Terminal directly, no tabs -->
  <Terminal
    bind:this={terminalRef}
    {sessionId}
    onImageUpload={onImageUpload ?? undefined}
    {useTmux}
    onCopyModeChange={onCopyModeChange ?? undefined}
  />
{/if}

<style>
  .session-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .fallback-banner {
    background: var(--warning);
    color: #000;
    font-size: 0.82rem;
    font-weight: 600;
    text-align: center;
    padding: var(--spacing-xs) var(--spacing-md);
  }

  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .tab {
    flex: 1;
    height: 44px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .tab:hover:not(.active) {
    color: var(--text);
  }

  .tab-content {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .tab-panel {
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .chat-scroll-area {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .terminal-panel {
    position: relative;
  }

  .companion-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-md);
    height: 100%;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .spinner {
    display: inline-block;
    width: 24px;
    height: 24px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-text {
    color: var(--error);
    font-weight: 600;
  }

  .retry-shell-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: var(--spacing-xs) var(--spacing-md);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .retry-shell-btn:hover {
    border-color: var(--accent);
  }
</style>
