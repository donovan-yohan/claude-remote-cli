<script lang="ts">
  import type { Snippet } from 'svelte';

  export type TuiButtonVariant = 'primary' | 'ghost' | 'danger' | 'success' | 'info';

  let {
    variant = 'primary',
    size = 'default',
    disabled = false,
    type = 'button',
    href,
    onclick,
    children,
    ...rest
  }: {
    variant?: TuiButtonVariant;
    size?: 'default' | 'sm' | 'icon';
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    href?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

{#if href}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <a
    class="tui-btn tui-btn--{variant}"
    class:tui-btn--sm={size === 'sm'}
    class:tui-btn--icon={size === 'icon'}
    class:tui-btn--disabled={disabled}
    {href}
    aria-disabled={disabled || undefined}
    tabindex={disabled ? -1 : undefined}
    onclick={disabled ? undefined : onclick}
    {...rest}
  >
    {@render children()}
  </a>
{:else}
  <button
    class="tui-btn tui-btn--{variant}"
    class:tui-btn--sm={size === 'sm'}
    class:tui-btn--icon={size === 'icon'}
    class:tui-btn--disabled={disabled}
    {type}
    {disabled}
    {onclick}
    {...rest}
  >
    {@render children()}
  </button>
{/if}

<style>
  .tui-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid currentColor;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    text-decoration: none;
    padding: 8px 16px;
    line-height: 1.4;
    white-space: nowrap;
    transition: border-style 0.1s, filter 0.1s, background 0.1s;
  }

  /* Hover: double border + lighten color */
  .tui-btn:hover:not(.tui-btn--disabled) {
    border-width: 3px;
    border-style: double;
    padding: 6px 14px;
    filter: brightness(1.3);
    background: color-mix(in srgb, currentColor 6%, transparent);
  }

  /* Variants */
  .tui-btn--primary { color: var(--accent); }
  .tui-btn--ghost { color: var(--text-muted); }
  .tui-btn--danger { color: color-mix(in srgb, var(--status-error) 70%, transparent); }
  .tui-btn--danger:hover:not(.tui-btn--disabled) { color: var(--status-error); }
  .tui-btn--success { color: var(--status-success); }
  .tui-btn--info { color: var(--status-info); }

  /* Small — toolbar text buttons */
  .tui-btn--sm {
    padding: 4px 8px;
    font-size: var(--font-size-xs);
  }

  .tui-btn--sm:hover:not(.tui-btn--disabled) {
    padding: 2px 6px;
  }

  /* Icon — square button with border, same hover treatment */
  .tui-btn--icon {
    padding: 8px;
  }

  .tui-btn--icon:hover:not(.tui-btn--disabled) {
    padding: 6px;
  }

  /* Disabled */
  .tui-btn--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  a.tui-btn--disabled {
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .tui-btn { transition: none; }
  }
</style>
