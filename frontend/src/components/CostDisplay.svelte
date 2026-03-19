<script lang="ts">
  import type { TokenUsage } from '../lib/types.js';
  import { formatTokenCount, formatCost } from '../lib/pricing.js';

  let {
    usage,
  }: {
    usage: TokenUsage;
  } = $props();

  let display = $derived(
    usage.input > 0 || usage.output > 0
      ? formatTokenCount(usage.input + usage.output) + ' tokens \u00B7 ' + formatCost(usage.estimatedCost)
      : '\u2014'
  );
</script>

<div class="cost-display">
  {display}
</div>

<style>
  .cost-display {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: var(--code-font);
    text-align: center;
    padding: var(--spacing-xs) var(--spacing-md);
  }
</style>
