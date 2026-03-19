<script lang="ts">
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
    <button class="empty-action" onclick={onAction}>{actionLabel}</button>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
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

  .empty-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 18px;
    min-height: 40px;
    background: transparent;
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--accent);
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    cursor: pointer;
    margin-top: 4px;
    transition: background 0.12s, color 0.12s;
    white-space: nowrap;
  }

  .empty-action:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
</style>
