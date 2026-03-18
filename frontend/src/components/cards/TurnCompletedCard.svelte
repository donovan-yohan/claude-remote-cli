<script lang="ts">
  import { formatTokenCount, formatCost } from '../../lib/pricing.js';

  let {
    usage,
  }: {
    usage?: { input_tokens: number; output_tokens: number } | undefined;
  } = $props();
</script>

<div class="turn-completed">
  <div class="separator-line"></div>
  {#if usage}
    <div class="usage-info">
      {formatTokenCount(usage.input_tokens + usage.output_tokens)} tokens
    </div>
  {/if}
</div>

<style>
  .turn-completed {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin: var(--spacing-sm) 0;
    width: 100%;
  }

  .separator-line {
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .usage-info {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: var(--code-font);
    padding: 0 var(--spacing-sm);
  }
</style>
