<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchGitHubStatus, initiateGitHubDevice, disconnectGitHub } from '../../../lib/api.js';

  interface Props {
    onDisconnect?: () => void;
    needsReauth?: boolean;
    webhookCount?: number;
  }

  let { onDisconnect, needsReauth = false, webhookCount = 0 }: Props = $props();

  let expanded = $state(false);
  let githubStatus = $state<{ connected: boolean; username?: string | undefined; deviceFlowStatus?: string | undefined } | null>(null);
  let deviceCode = $state<{ userCode: string; verificationUri: string; expiresIn: number } | null>(null);
  let deviceFlowError = $state('');
  let loading = $state(true);
  let disconnecting = $state(false);
  let showDisconnectConfirm = $state(false);
  // pollInterval is a plain variable — not reactive state — used only for cleanup
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  onMount(async () => {
    try {
      const status = await fetchGitHubStatus();
      githubStatus = {
        connected: status.connected,
        username: status.username ?? undefined,
        deviceFlowStatus: status.deviceFlowStatus,
      };
    } catch {
      githubStatus = { connected: false };
    } finally {
      loading = false;
    }
  });

  $effect(() => {
    return () => { clearDeviceFlowTimers(); };
  });

  function toggleExpanded() {
    expanded = !expanded;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleExpanded();
    }
  }

  let expiryTimeout: ReturnType<typeof setTimeout> | null = null;

  function clearDeviceFlowTimers() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (expiryTimeout) { clearTimeout(expiryTimeout); expiryTimeout = null; }
  }

  async function connectGitHub() {
    deviceFlowError = '';
    try {
      const code = await initiateGitHubDevice();
      deviceCode = code;

      clearDeviceFlowTimers();
      pollInterval = setInterval(async () => {
        try {
          const status = await fetchGitHubStatus();
          if (status.connected) {
            githubStatus = { connected: true, username: status.username ?? undefined };
            deviceCode = null;
            clearDeviceFlowTimers();
          } else if (status.deviceFlowStatus === 'denied' || status.deviceFlowStatus === 'expired') {
            deviceCode = null;
            deviceFlowError =
              status.deviceFlowStatus === 'denied'
                ? 'Authorization denied. Please try again.'
                : 'Code expired. Please try again.';
            clearDeviceFlowTimers();
          }
        } catch {
          // keep polling on transient errors
        }
      }, 2000);

      // Client-side expiry guard — stop polling if server never reports expired
      expiryTimeout = setTimeout(() => {
        clearDeviceFlowTimers();
        deviceCode = null;
        deviceFlowError = 'Code expired. Please try again.';
      }, code.expiresIn * 1000);
    } catch {
      deviceFlowError = 'Failed to initiate GitHub authorization. Please try again.';
    }
  }

  async function handleDisconnect() {
    disconnecting = true;
    try {
      await disconnectGitHub();
      githubStatus = { connected: false };
      showDisconnectConfirm = false;
      deviceCode = null;
      deviceFlowError = '';
      onDisconnect?.();
    } catch {
      // stay in confirm state so user can retry
    } finally {
      disconnecting = false;
    }
  }

  function copyCode() {
    if (deviceCode) {
      navigator.clipboard.writeText(deviceCode.userCode);
    }
  }
</script>

<div class="integration-row">
  <!-- Row header — always visible -->
  <div
    class="integration-header"
    role="button"
    tabindex="0"
    aria-expanded={expanded}
    onclick={toggleExpanded}
    onkeydown={handleKeydown}
  >
    <span class="status-dot" class:status-dot--connected={githubStatus?.connected}></span>
    <div class="integration-label">
      <span class="integration-name">GitHub</span>
      {#if loading}
        <span class="integration-status">Loading...</span>
      {:else if githubStatus?.connected}
        <span class="integration-status">Connected as @{githubStatus.username ?? 'GitHub'}</span>
      {:else}
        <span class="integration-status integration-status--muted">Not connected</span>
      {/if}
    </div>
    <div
      class="integration-actions"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="presentation"
    >
      {#if githubStatus?.connected}
        <button class="btn btn-ghost btn-sm" onclick={toggleExpanded}>
          Manage {expanded ? '▴' : '▾'}
        </button>
      {:else if !loading}
        <button
          class="btn btn-primary btn-sm"
          onclick={(e) => { e.stopPropagation(); expanded = true; connectGitHub(); }}
        >
          Connect
        </button>
      {/if}
    </div>
  </div>

  <!-- Accordion content -->
  <div class="integration-body" class:integration-body--open={expanded} aria-hidden={!expanded}>
    <div class="integration-body-inner">
      {#if needsReauth}
        <p class="reauth-warning">Re-connect to enable webhook management</p>
        <button class="btn btn-primary btn-sm" onclick={connectGitHub}>Re-connect GitHub</button>
      {:else if githubStatus?.connected}
        <p class="body-text">Connected as <strong>@{githubStatus.username ?? 'GitHub'}</strong></p>
        {#if showDisconnectConfirm}
          <p class="body-text body-text--warning">
            {webhookCount > 0
              ? `This will delete ${webhookCount} webhook${webhookCount === 1 ? '' : 's'} on GitHub. Continue?`
              : 'Disconnect your GitHub account. Continue?'}
          </p>
          <div class="action-row">
            <button class="btn btn-ghost btn-sm" onclick={() => (showDisconnectConfirm = false)}>
              Cancel
            </button>
            <button class="btn btn-danger btn-sm" onclick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        {:else}
          <button class="btn btn-danger btn-sm" onclick={() => (showDisconnectConfirm = true)}>
            Disconnect
          </button>
        {/if}
      {:else if deviceCode}
        <div class="device-flow">
          <div class="code-row">
            <span class="body-text">Enter code: <strong class="user-code">{deviceCode.userCode}</strong></span>
            <button class="btn btn-ghost btn-sm" onclick={copyCode}>Copy</button>
          </div>
          <p class="body-text">
            at <a href={deviceCode.verificationUri} target="_blank" rel="noopener noreferrer"
              >{deviceCode.verificationUri}</a
            >
          </p>
          <p class="body-text body-text--muted">Waiting for authorization...</p>
        </div>
      {:else if deviceFlowError}
        <p class="error-text">{deviceFlowError}</p>
        <button class="btn btn-primary btn-sm" onclick={connectGitHub}>Try Again</button>
      {:else}
        <p class="body-text body-text--muted">
          Connect your GitHub account to enable PRs, CI status, and webhook management.
        </p>
        <button class="btn btn-primary btn-sm" onclick={connectGitHub}>Connect GitHub</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .integration-row {
    border-bottom: 1px solid var(--border);
  }

  .integration-row:last-child {
    border-bottom: none;
  }

  /* Header */
  .integration-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    min-height: 44px;
    cursor: pointer;
    user-select: none;
  }

  .integration-header:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border);
    flex-shrink: 0;
  }

  .status-dot--connected {
    background: var(--status-success);
  }

  .integration-label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .integration-name {
    font-size: var(--font-size-base);
    font-weight: 500;
    color: var(--text);
  }

  .integration-status {
    font-size: var(--font-size-sm);
    color: var(--text);
  }

  .integration-status--muted {
    color: var(--text-muted);
  }

  .integration-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Accordion body — grid trick for smooth height transition */
  .integration-body {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 200ms ease;
    overflow: hidden;
  }

  .integration-body--open {
    grid-template-rows: 1fr;
  }

  .integration-body-inner {
    overflow: hidden;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 0;
    transition: padding-bottom 200ms ease;
  }

  .integration-body--open .integration-body-inner {
    padding-bottom: 12px;
  }

  /* Content */
  .body-text {
    font-size: var(--font-size-sm);
    color: var(--text);
    margin: 0;
  }

  .body-text--muted {
    color: var(--text-muted);
  }

  .body-text--warning {
    color: var(--status-warning);
  }

  .error-text {
    font-size: var(--font-size-sm);
    color: var(--status-error);
    margin: 0;
  }

  .reauth-warning {
    font-size: var(--font-size-sm);
    color: var(--status-warning);
    margin: 0;
  }

  .device-flow {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .code-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .user-code {
    font-family: var(--font-mono);
    letter-spacing: 0.1em;
  }

  .action-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
