<script lang="ts">
  let {
    suggestions,
    onSelect,
  }: {
    suggestions: string[];
    onSelect: (text: string) => void;
  } = $props();
</script>

{#if suggestions.length > 0}
  <div class="quick-replies" role="group" aria-label="Quick replies">
    {#each suggestions as suggestion}
      <button
        class="quick-reply-btn"
        onclick={() => onSelect(suggestion)}
      >
        {suggestion}
      </button>
    {/each}
  </div>
{/if}

<style>
  .quick-replies {
    display: flex;
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) var(--spacing-md);
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .quick-replies::-webkit-scrollbar {
    display: none;
  }

  .quick-reply-btn {
    flex-shrink: 0;
    height: 36px;
    padding: 0 var(--spacing-md);
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--code-font);
    font-size: 0.82rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s;
  }

  .quick-reply-btn:hover {
    background: var(--surface);
    border-color: var(--accent);
  }

  .quick-reply-btn:active {
    background: var(--card-bg);
  }
</style>
