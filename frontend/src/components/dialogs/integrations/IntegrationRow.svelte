<script lang="ts">
  import type { Snippet } from 'svelte';
  import StatusDot from '../../StatusDot.svelte';

  interface Props {
    name: string;
    statusText: string;
    connected: boolean;
    loading?: boolean;
    expanded?: boolean;
    onToggle?: () => void;
    headerActions?: Snippet;
    children: Snippet;
  }

  let {
    name,
    statusText,
    connected,
    loading = false,
    expanded = $bindable(false),
    onToggle,
    headerActions,
    children,
  }: Props = $props();

  function toggle() {
    expanded = !expanded;
    onToggle?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
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
    onclick={toggle}
    onkeydown={handleKeydown}
  >
    <span class="icon-slot">
      <StatusDot status={connected ? 'connected' : 'disconnected'} size={8} />
    </span>
    <div class="integration-label">
      <span class="integration-name">{name}</span>
      <span class="integration-status" class:integration-status--loading={loading}>
        {#if loading}
          <span class="loading-text">loading...</span>
        {:else}
          {statusText}
        {/if}
      </span>
    </div>
    <div class="chevron" aria-hidden="true">{expanded ? '▴' : '▾'}</div>
    {#if headerActions}
      <div
        class="header-actions"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="presentation"
      >
        {@render headerActions()}
      </div>
    {/if}
  </div>

  <!-- Accordion body — grid trick for smooth height transition -->
  <div class="integration-body" class:integration-body--open={expanded} aria-hidden={!expanded}>
    <div class="integration-body-inner">
      {@render children()}
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
    gap: 0;
    padding: var(--row-padding-y, 10px) 0;
    min-height: 44px;
    cursor: pointer;
    user-select: none;
  }

  .integration-header:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .icon-slot {
    width: var(--icon-slot-width, 24px);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
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
    color: var(--text-muted);
  }

  .integration-status--loading .loading-text {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .chevron {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--text-muted);
    flex-shrink: 0;
    margin-left: 8px;
  }

  .header-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 6px;
  }

  /* Accordion body */
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
    padding-left: var(--icon-slot-width, 24px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 0;
    transition: padding-bottom 200ms ease;
  }

  .integration-body--open .integration-body-inner {
    padding-bottom: 12px;
  }
</style>
