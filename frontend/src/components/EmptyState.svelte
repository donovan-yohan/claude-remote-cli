<script lang="ts">
  import TuiButton from './TuiButton.svelte';

  let {
    icon,
    heading,
    description,
    actionLabel,
    onAction,
  }: {
    icon?: string;
    heading: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
  } = $props();
</script>

<div class="empty-state">
  {#if icon}
    <div class="empty-icon" aria-hidden="true">{icon}</div>
  {/if}

  <div class="empty-heading">{heading}</div>

  {#if description}
    <p class="empty-description">{description}</p>
  {/if}

  {#if actionLabel && onAction}
    <TuiButton variant="primary" onclick={onAction}>{actionLabel}</TuiButton>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    max-width: 320px;
    text-align: center;
    padding: 32px 16px;
    flex: 1;
    margin: 0 auto;
  }

  .empty-icon {
    font-size: 2rem;
    line-height: 1;
    color: var(--text-muted);
    opacity: 0.5;
  }

  .empty-heading {
    font-size: var(--font-size-lg);
    font-family: var(--font-mono);
    color: var(--text);
    font-weight: 600;
    line-height: 1.3;
  }

  .empty-description {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text-muted);
    line-height: 1.5;
  }

</style>
