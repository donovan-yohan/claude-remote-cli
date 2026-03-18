<script lang="ts">
  let { text }: { text: string } = $props();

  let expanded = $state(false);
</script>

<div class="reasoning-panel">
  <button
    class="reasoning-header"
    onclick={() => expanded = !expanded}
    aria-expanded={expanded}
    aria-controls="reasoning-content"
  >
    <span class="reasoning-label">
      {#if expanded}Thinking{:else}Thinking<span class="dots">...</span>{/if}
    </span>
    <span class="toggle-icon">{expanded ? '\u25B2' : '\u25BC'}</span>
  </button>
  {#if expanded}
    <div class="reasoning-content" id="reasoning-content">{text}</div>
  {/if}
</div>

<style>
  .reasoning-panel {
    margin: var(--spacing-xs) 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
    width: 100%;
  }

  .reasoning-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    width: 100%;
    min-height: 44px;
    padding: var(--spacing-xs) var(--spacing-md);
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    text-align: left;
  }

  .reasoning-label {
    flex: 1;
    font-style: italic;
  }

  .dots {
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .toggle-icon {
    flex-shrink: 0;
    font-size: 0.7rem;
  }

  .reasoning-content {
    padding: var(--spacing-sm) var(--spacing-md);
    color: var(--text-muted);
    font-family: var(--code-font);
    font-size: 0.82rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
