<script lang="ts">
  import { onMount } from 'svelte';
  import CipherText from '../../CipherText.svelte';
  import IntegrationRow from './IntegrationRow.svelte';

  interface Props {}

  let {}: Props = $props();

  let expanded = $state(false);
  let configured = $state<boolean | null>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      const res = await fetch('/integration-jira/configured');
      if (res.status === 404) {
        configured = null;
        loading = false;
        return;
      }
      const data = await res.json();
      configured = data.configured ?? false;
    } catch {
      configured = false;
    } finally {
      loading = false;
    }
  });

  let statusText = $derived(
    loading
      ? 'Checking...'
      : configured === null
        ? 'Not available'
        : configured
          ? 'Connected'
          : 'CLI not installed'
  );
</script>

<IntegrationRow name="Jira" {statusText} connected={configured === true} {loading} bind:expanded>
  {#if loading}
    <CipherText loading={true} text="Loading tickets..." />
  {:else if configured === null}
    <p class="body-text body-text--muted">Jira integration is not available on this server.</p>
  {:else if configured}
    <p class="body-text body-text--success">Connected via Atlassian CLI</p>
    <p class="body-text body-text--muted">Jira tickets appear automatically in the sidebar.</p>
  {:else}
    <p class="body-text body-text--muted">Install the Atlassian CLI to see your Jira tickets.</p>
    <ol class="steps">
      <li class="step">
        <span class="step-number">1.</span>
        <code class="code-block">brew tap atlassian/tap && brew install acli</code>
      </li>
      <li class="step">
        <span class="step-number">2.</span>
        <code class="code-block">acli jira auth login --web</code>
      </li>
      <li class="step">
        <span class="step-number">3.</span>
        <code class="code-block">Refresh this page</code>
      </li>
    </ol>
    <p class="body-text body-text--muted">The CLI handles authentication — no API tokens needed.</p>
  {/if}
</IntegrationRow>

<style>
  .body-text {
    font-size: var(--font-size-sm);
    color: var(--text);
    margin: 0;
  }

  .body-text--muted {
    color: var(--text-muted);
  }

  .body-text--success {
    color: var(--status-success);
  }

  .steps {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .step-number {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    flex-shrink: 0;
    width: 16px;
  }

  .code-block {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    background: var(--bg);
    color: var(--text);
    padding: 8px 12px;
    display: block;
    flex: 1;
    min-width: 0;
  }

</style>
