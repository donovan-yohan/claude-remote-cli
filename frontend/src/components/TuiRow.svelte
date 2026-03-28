<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    icon,
    action,
    children,
    onclick,
    minHeight = 'var(--row-min-height)',
    paddingX = 'var(--sidebar-padding-x)',
    class: className = '',
  }: {
    icon?: Snippet;
    action?: Snippet;
    children: Snippet;
    onclick?: (e: MouseEvent) => void;
    minHeight?: string;
    paddingX?: string;
    class?: string;
  } = $props();

  let isInteractive = $derived(onclick !== undefined);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="tui-row {className}"
  class:tui-row--interactive={isInteractive}
  style:--row-padding-x={paddingX}
  style:--row-min-height-override={minHeight}
  {onclick}
>
  <span class="tui-row__icon-slot">
    {#if icon}
      {@render icon()}
    {/if}
  </span>

  <span class="tui-row__content">
    {@render children()}
  </span>

  {#if action}
    <span class="tui-row__action-slot">
      {@render action()}
    </span>
  {/if}
</div>

<style>
  .tui-row {
    display: flex;
    align-items: center;
    min-height: var(--row-min-height-override, var(--row-min-height, 44px));
    padding-left: var(--row-padding-x, var(--sidebar-padding-x, 16px));
    padding-right: var(--row-padding-x, var(--sidebar-padding-x, 16px));
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text);
  }

  .tui-row--interactive {
    cursor: pointer;
    transition: background 120ms ease-out;
  }

  .tui-row--interactive:hover {
    background: var(--surface-hover);
  }

  /* Icon slot: always 24px, even when empty — preserves column alignment */
  .tui-row__icon-slot {
    flex-shrink: 0;
    width: var(--icon-slot-width, 24px);
    display: flex;
    align-items: center;
  }

  /* Content: flex:1, min-width:0 for text truncation */
  .tui-row__content {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  /* Action slot: fixed 36px width */
  .tui-row__action-slot {
    flex-shrink: 0;
    width: var(--action-slot-width, 36px);
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }
</style>
