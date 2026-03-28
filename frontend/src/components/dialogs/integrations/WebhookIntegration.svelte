<script lang="ts">
  import { onMount } from 'svelte';
  import CipherText from '../../CipherText.svelte';
  import StatusDot from '../../StatusDot.svelte';
  import TuiButton from '../../TuiButton.svelte';
  import IntegrationRow from './IntegrationRow.svelte';
  import TuiCheckbox from '../../TuiCheckbox.svelte';
  import {
    fetchWebhookStatus,
    setupWebhooks,
    removeWebhookSetup,
    pingWebhook,
    backfillWebhooks,
    reloadWebhooks,
    updateConfigAutoProvision,
  } from '../../../lib/api.js';
  import type { WebhookStatus, BackfillResult } from '../../../lib/api.js';

  interface Props {
    githubConnected: boolean;
  }

  let { githubConnected }: Props = $props();

  let expanded = $state(false);
  let status = $state<WebhookStatus | null>(null);
  let loading = $state(true);
  let settingUp = $state(false);
  let removing = $state(false);
  let testing = $state(false);
  let testResult = $state<'success' | 'error' | 'no_webhook' | null>(null);
  let backfilling = $state(false);
  let backfillResults = $state<BackfillResult | null>(null);
  let showBackfillBanner = $state(false);
  let showRemoveConfirm = $state(false);
  let error = $state('');

  let testResultTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    await loadStatus();
  });

  $effect(() => {
    return () => {
      if (testResultTimer) clearTimeout(testResultTimer);
    };
  });

  async function loadStatus() {
    loading = true;
    error = '';
    try {
      status = await fetchWebhookStatus();
    } catch {
      error = 'Failed to load webhook status.';
    } finally {
      loading = false;
    }
  }

  let webhookConnected = $derived(status?.configured ? status.smeeConnected : false);

  async function handleSetup() {
    settingUp = true;
    error = '';
    try {
      const result = await setupWebhooks();
      if (result.ok) {
        await loadStatus();
        showBackfillBanner = true;
      } else {
        error = result.error ?? 'Setup failed. Could not reach smee.io.';
      }
    } catch {
      error = 'Setup failed. Could not reach smee.io.';
    } finally {
      settingUp = false;
    }
  }

  async function handleRemove() {
    removing = true;
    error = '';
    try {
      await removeWebhookSetup();
      status = null;
      showRemoveConfirm = false;
      showBackfillBanner = false;
      backfillResults = null;
    } catch {
      error = 'Removal failed. Some webhooks may not have been deleted.';
    } finally {
      removing = false;
    }
  }

  async function handleTest() {
    testing = true;
    testResult = null;
    if (testResultTimer) clearTimeout(testResultTimer);
    try {
      const result = await pingWebhook();
      if (result.ok) {
        testResult = 'success';
      } else if (result.error === 'no_webhook') {
        testResult = 'no_webhook';
      } else {
        testResult = 'error';
      }
    } catch {
      testResult = 'error';
    } finally {
      testing = false;
      testResultTimer = setTimeout(() => { testResult = null; }, 5000);
    }
  }

  async function handleAutoProvisionToggle() {
    if (!status) return;
    const next = !status.autoProvision;
    status = { ...status, autoProvision: next };
    try {
      await updateConfigAutoProvision(next);
    } catch {
      status = { ...status, autoProvision: !next };
      error = 'Failed to update auto-provision setting.';
    }
  }

  async function handleBackfill() {
    backfilling = true;
    error = '';
    try {
      backfillResults = await backfillWebhooks();
      showBackfillBanner = false;
    } catch {
      error = 'Backfill failed.';
    } finally {
      backfilling = false;
    }
  }

  function relativeTime(isoString: string | null): string {
    if (!isoString) return 'never';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  let headerStatus = $derived(
    loading
      ? 'Loading...'
      : status?.configured
        ? status.smeeConnected
          ? 'Connected via smee.io'
          : 'Reconnecting...'
        : 'Not configured'
  );

  let healthDotStatus = $derived<'connected' | 'warning' | 'disconnected'>(
    status?.configured
      ? status.smeeConnected
        ? 'connected'
        : 'warning'
      : 'disconnected'
  );
</script>

<IntegrationRow name="Webhooks" statusText={headerStatus} connected={webhookConnected} {loading} bind:expanded>
  {#snippet headerActions()}
    {#if !githubConnected}
      <span class="status-hint">Connect GitHub first</span>
    {:else if !loading && status?.configured}
      <TuiButton variant="ghost" size="sm" onclick={() => expanded = !expanded}>
        Manage {expanded ? '▴' : '▾'}
      </TuiButton>
    {:else if !loading}
      <TuiButton
        variant="primary"
        size="sm"
        onclick={(e) => { e.stopPropagation(); expanded = true; }}
        disabled={settingUp}
      >
        Setup
      </TuiButton>
    {/if}
  {/snippet}

  {#if !githubConnected}
    <p class="body-text body-text--muted">Connect your GitHub account above to enable webhook setup.</p>
  {:else if loading}
    <CipherText loading={true} text="Loading..." />
  {:else if !status?.configured}
    <p class="body-text body-text--muted">Get real-time CI and PR updates instead of polling every 30s.</p>
    {#if error}
      <p class="error-text">{error}</p>
    {/if}
    <TuiButton variant="primary" size="sm" onclick={handleSetup} disabled={settingUp}>
      {settingUp ? 'Setting up...' : 'Setup Webhooks'}
    </TuiButton>
  {:else}
    <div class="health-row">
      <StatusDot status={healthDotStatus} size={8} />
      <span class="body-text">
        {status.smeeConnected ? 'Connected via smee.io' : 'Reconnecting... (using polling fallback)'}
      </span>
    </div>
    <p class="body-text body-text--muted">Last event: {relativeTime(status.lastEventAt)}</p>
    <TuiCheckbox checked={status.autoProvision} onchange={handleAutoProvisionToggle}>Auto-add webhooks for new repos</TuiCheckbox>
    {#if error}
      <p class="error-text">{error}</p>
    {/if}
    {#if showBackfillBanner && !backfillResults}
      <div class="backfill-banner">
        <p class="body-text">Create webhooks for all your existing repos?</p>
        <div class="action-row">
          <TuiButton variant="primary" size="sm" onclick={handleBackfill} disabled={backfilling}>
            {backfilling ? 'Setting up repos...' : 'Setup All Repos'}
          </TuiButton>
          <TuiButton variant="ghost" size="sm" onclick={() => showBackfillBanner = false}>
            Skip
          </TuiButton>
        </div>
      </div>
    {/if}
    {#if backfillResults}
      <div class="backfill-results">
        <p class="body-text">
          Created webhooks for {backfillResults.success}/{backfillResults.total} repos.
          {#if backfillResults.failed > 0}
            {backfillResults.failed} failed:
          {/if}
        </p>
        {#if backfillResults.failed > 0}
          <ul class="results-list">
            {#each backfillResults.results.filter(r => !r.ok) as repo (repo.path)}
              <li class="result-item result-item--fail">
                <span class="result-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
                <span class="result-label">{repo.ownerRepo}</span>
                {#if repo.error}
                  <span class="result-error">({repo.error})</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
    <div class="action-row">
      {#if showRemoveConfirm}
        <p class="body-text body-text--warning">
          This will delete webhooks from GitHub repos and disable real-time updates.
        </p>
      {/if}
    </div>
    <div class="action-row">
      {#if showRemoveConfirm}
        <TuiButton variant="ghost" size="sm" onclick={() => showRemoveConfirm = false}>Cancel</TuiButton>
        <TuiButton variant="danger" size="sm" onclick={handleRemove} disabled={removing}>
          {removing ? 'Removing...' : 'Remove'}
        </TuiButton>
      {:else}
        <TuiButton variant="ghost" size="sm" onclick={handleTest} disabled={testing}>
          {testing ? 'Testing...' : 'Test Connection'}
        </TuiButton>
        <TuiButton variant="danger" size="sm" onclick={() => showRemoveConfirm = true}>
          Remove Setup
        </TuiButton>
      {/if}
    </div>
    {#if testResult}
      <p class="test-result" class:test-result--success={testResult === 'success'} class:test-result--error={testResult === 'error' || testResult === 'no_webhook'}>
        {#if testResult === 'success'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg> Event received
        {:else if testResult === 'no_webhook'}
          No webhook to ping
        {:else}
          Timed out
        {/if}
      </p>
    {/if}
  {/if}
</IntegrationRow>

<style>
  .status-hint {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
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

  .health-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .action-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  /* Backfill */
  .backfill-banner {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    background: var(--surface-hover);
  }

  .backfill-results {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .results-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  .result-item--fail .result-icon {
    color: var(--status-error);
  }

  .result-label {
    color: var(--text);
  }

  .result-error {
    color: var(--text-muted);
  }

  /* Test result */
  .test-result {
    font-size: var(--font-size-sm);
    margin: 0;
  }

  .test-result--success {
    color: var(--status-success);
  }

  .test-result--error {
    color: var(--status-error);
  }
</style>
