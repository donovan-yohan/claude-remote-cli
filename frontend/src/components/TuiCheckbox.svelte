<script lang="ts">
  import type { Snippet } from 'svelte';

  let { checked = $bindable(false), disabled = false, children, ...rest }: {
    checked: boolean;
    disabled?: boolean;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

<label class="tui-checkbox" class:disabled>
  <input type="checkbox" bind:checked {disabled} {...rest}>
  <span class="tui-check">{checked ? '[x]' : '[ ]'}</span>
  {#if children}{@render children()}{/if}
</label>

<style>
  .tui-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text);
  }
  .tui-checkbox.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .tui-checkbox input {
    display: none;
  }
  .tui-check {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    line-height: 1;
  }
  .tui-checkbox input:checked + .tui-check {
    color: var(--accent);
  }
</style>
