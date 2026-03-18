<script lang="ts">
  let {
    text,
    onRetry,
    onDismiss,
  }: {
    text: string;
    onRetry?: (() => void) | undefined;
    onDismiss?: (() => void) | undefined;
  } = $props();
</script>

<div class="error-card">
  <div class="error-body">
    <span class="error-text">{text}</span>
    {#if onDismiss}
      <button class="dismiss-btn" onclick={onDismiss} aria-label="Dismiss error">&times;</button>
    {/if}
  </div>
  {#if onRetry}
    <button class="retry-btn" onclick={onRetry}>Retry</button>
  {/if}
</div>

<style>
  .error-card {
    border-left: 3px solid var(--error);
    background: var(--card-bg);
    border-radius: var(--radius-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    margin: var(--spacing-xs) 0;
    width: 100%;
  }

  .error-body {
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-sm);
  }

  .error-text {
    flex: 1;
    color: var(--error);
    font-size: 0.9rem;
    word-break: break-word;
  }

  .dismiss-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .dismiss-btn:hover {
    color: var(--text);
  }

  .retry-btn {
    margin-top: var(--spacing-sm);
    background: none;
    border: 1px solid var(--error);
    color: var(--error);
    border-radius: var(--radius-sm);
    padding: var(--spacing-xs) var(--spacing-md);
    font-size: 0.82rem;
    cursor: pointer;
    font-family: var(--code-font);
  }

  .retry-btn:hover {
    background: var(--error);
    color: #fff;
  }
</style>
