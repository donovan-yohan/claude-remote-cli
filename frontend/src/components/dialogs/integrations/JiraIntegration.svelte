<script lang="ts">
  import { onMount } from 'svelte';

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

  function toggleExpanded() {
    expanded = !expanded;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleExpanded();
    }
  }
</script>

<div class="integration-row">
  <div
    class="integration-header"
    role="button"
    tabindex="0"
    aria-expanded={expanded}
    onclick={toggleExpanded}
    onkeydown={handleKeydown}
  >
    <span class="status-dot" class:status-dot--connected={configured === true}></span>
    <div class="integration-label">
      <span class="integration-name">Jira</span>
      {#if loading}
        <span class="integration-status integration-status--muted">Checking...</span>
      {:else if configured === null}
        <span class="integration-status integration-status--muted">Not available</span>
      {:else if configured}
        <span class="integration-status">Connected</span>
      {:else}
        <span class="integration-status integration-status--muted">CLI not installed</span>
      {/if}
    </div>
    <span class="integration-description">See your Jira tickets in the sidebar</span>
  </div>

  <div class="integration-body" class:integration-body--open={expanded} aria-hidden={!expanded}>
    <div class="integration-body-inner">
      {#if loading}
        <div class="skeleton-line skeleton-short"></div>
        <div class="skeleton-line skeleton-long"></div>
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
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
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

  .integration-description {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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
    gap: 6px;
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

  .skeleton-short {
    height: 12px;
    width: 120px;
  }

  .skeleton-long {
    height: 12px;
    width: 220px;
  }
</style>
