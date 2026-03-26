<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    danger = false,
    disabled = false,
    onmousedown,
    icon,
    children,
  }: {
    danger?: boolean;
    disabled?: boolean;
    onmousedown?: (e: MouseEvent) => void;
    icon?: Snippet;
    children: Snippet;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tui-menu-item"
  class:tui-menu-item--danger={danger}
  class:tui-menu-item--disabled={disabled}
  role="menuitem"
  tabindex={disabled ? -1 : 0}
  onmousedown={disabled ? undefined : onmousedown}
>
  <span class="fzf-cursor" aria-hidden="true">&gt;</span>

  {#if icon}
    <span class="tui-menu-item__icon">
      {@render icon()}
    </span>
  {/if}

  <span class="tui-menu-item__content">
    {@render children()}
  </span>
</div>

<style>
  .tui-menu-item {
    position: relative;
    display: flex;
    align-items: center;
    padding: 8px 14px 8px 20px;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    transition: background 120ms ease-out;
  }

  .tui-menu-item:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .tui-menu-item--danger {
    color: var(--status-error);
  }

  .tui-menu-item--danger:hover {
    background: color-mix(in srgb, var(--status-error) 8%, transparent);
  }

  .tui-menu-item--disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* FZF > cursor */
  .fzf-cursor {
    position: absolute;
    left: 8px;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: currentColor;
    transform: translateX(-6px);
    opacity: 0;
    transition: transform 120ms ease-out, opacity 120ms ease-out;
  }

  .tui-menu-item:hover .fzf-cursor {
    transform: translateX(0);
    opacity: 1;
  }

  /* Icon slot */
  .tui-menu-item__icon {
    flex-shrink: 0;
    width: 20px;
    display: flex;
    align-items: center;
    margin-right: 8px;
    color: var(--text-muted);
  }

  /* Content */
  .tui-menu-item__content {
    flex: 1;
    min-width: 0;
  }
</style>
