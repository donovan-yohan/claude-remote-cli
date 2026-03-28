<script lang="ts">
  import { onMount } from 'svelte';
  import CipherText from '../../CipherText.svelte';
  import TuiButton from '../../TuiButton.svelte';
  import IntegrationRow from './IntegrationRow.svelte';
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

  let statusText = $derived(
    loading
      ? 'Checking connection...'
      : githubStatus?.connected
        ? `Connected as @${githubStatus.username ?? 'GitHub'}`
        : 'Not connected'
  );

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

<IntegrationRow name="GitHub" {statusText} connected={githubStatus?.connected ?? false} {loading} bind:expanded>
  {#snippet headerActions()}
    {#if githubStatus?.connected}
      <TuiButton variant="ghost" size="sm" onclick={() => expanded = !expanded}>
        Manage {expanded ? '▴' : '▾'}
      </TuiButton>
    {:else if !loading}
      <TuiButton
        variant="primary"
        size="sm"
        onclick={(e) => { e.stopPropagation(); expanded = true; connectGitHub(); }}
      >
        Connect
      </TuiButton>
    {/if}
  {/snippet}

  {#if loading}
    <CipherText loading={true} text="Checking connection..." />
  {:else if needsReauth}
    <p class="reauth-warning">Re-connect to enable webhook management</p>
    <TuiButton variant="primary" size="sm" onclick={connectGitHub}>Re-connect GitHub</TuiButton>
  {:else if githubStatus?.connected}
    <p class="body-text">Connected as <strong>@{githubStatus.username ?? 'GitHub'}</strong></p>
    {#if showDisconnectConfirm}
      <p class="body-text body-text--warning">
        {webhookCount > 0
          ? `This will delete ${webhookCount} webhook${webhookCount === 1 ? '' : 's'} on GitHub. Continue?`
          : 'Disconnect your GitHub account. Continue?'}
      </p>
      <div class="action-row">
        <TuiButton variant="ghost" size="sm" onclick={() => (showDisconnectConfirm = false)}>
          Cancel
        </TuiButton>
        <TuiButton variant="danger" size="sm" onclick={handleDisconnect} disabled={disconnecting}>
          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
        </TuiButton>
      </div>
    {:else}
      <TuiButton variant="danger" size="sm" onclick={() => (showDisconnectConfirm = true)}>
        Disconnect
      </TuiButton>
    {/if}
  {:else if deviceCode}
    <div class="device-flow">
      <div class="code-row">
        <span class="body-text">Enter code: <strong class="user-code">{deviceCode.userCode}</strong></span>
        <TuiButton variant="ghost" size="sm" onclick={copyCode}>Copy</TuiButton>
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
    <TuiButton variant="primary" size="sm" onclick={connectGitHub}>Try Again</TuiButton>
  {:else}
    <p class="body-text body-text--muted">
      Connect your GitHub account to enable PRs, CI status, and webhook management.
    </p>
    <TuiButton variant="primary" size="sm" onclick={connectGitHub}>Connect GitHub</TuiButton>
  {/if}
</IntegrationRow>

<style>
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
    gap: 8px;
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
