<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'ghost' | 'danger' | 'success' | 'info';
  type Size = 'default' | 'sm';
  type ButtonType = 'button' | 'submit' | 'reset';

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
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    type?: ButtonType;
    href?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
    [key: string]: unknown;
  } = $props();

  let hovered = $state(false);

  function handleMouseEnter() {
    if (!disabled) hovered = true;
  }

  function handleMouseLeave() {
    hovered = false;
  }
</script>

{#if href}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <a
    class="tui-button tui-button--{variant} tui-button--{size}"
    class:tui-button--disabled={disabled}
    class:tui-button--hovered={hovered}
    {href}
    aria-disabled={disabled || undefined}
    tabindex={disabled ? -1 : undefined}
    onclick={disabled ? undefined : onclick}
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
    {...rest}
  >
    <span class="tui-corner tui-corner--tl">{hovered ? '╔' : '┌'}</span>
    <span class="tui-corner tui-corner--tr">{hovered ? '╗' : '┐'}</span>
    <span class="tui-inner">{@render children()}</span>
    <span class="tui-corner tui-corner--bl">{hovered ? '╚' : '└'}</span>
    <span class="tui-corner tui-corner--br">{hovered ? '╝' : '┘'}</span>
  </a>
{:else}
  <button
    class="tui-button tui-button--{variant} tui-button--{size}"
    class:tui-button--disabled={disabled}
    class:tui-button--hovered={hovered}
    {type}
    {disabled}
    {onclick}
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
    {...rest}
  >
    <span class="tui-corner tui-corner--tl">{hovered ? '╔' : '┌'}</span>
    <span class="tui-corner tui-corner--tr">{hovered ? '╗' : '┐'}</span>
    <span class="tui-inner">{@render children()}</span>
    <span class="tui-corner tui-corner--bl">{hovered ? '╚' : '└'}</span>
    <span class="tui-corner tui-corner--br">{hovered ? '╝' : '┘'}</span>
  </button>
{/if}

<style>
  .tui-button {
    position: relative;
    display: inline-grid;
    grid-template-areas:
      "tl . tr"
      ".  c  ."
      "bl . br";
    grid-template-columns: auto 1fr auto;
    grid-template-rows: auto 1fr auto;
    background: transparent;
    border: none;
    border-top: 1px solid currentColor;
    border-bottom: 1px solid currentColor;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    text-decoration: none;
    padding: 0;
    border-radius: 0;
    line-height: 1;
    transition: background 120ms ease-out, border-style 120ms ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .tui-button {
      transition: none;
    }
  }

  /* Variants — set color; borders and text inherit via currentColor */
  .tui-button--primary {
    color: var(--accent);
  }

  .tui-button--ghost {
    color: var(--text-muted);
  }

  .tui-button--danger {
    color: var(--status-error);
    /* Danger border is 50% opacity at rest per DESIGN.md */
    border-top-color: color-mix(in srgb, var(--status-error) 50%, transparent);
    border-bottom-color: color-mix(in srgb, var(--status-error) 50%, transparent);
  }

  .tui-button--success {
    color: var(--status-success);
  }

  .tui-button--info {
    color: var(--status-info);
  }

  /* Size variants */
  .tui-button--default .tui-inner {
    padding: 8px 12px;
  }

  .tui-button--sm .tui-inner {
    padding: 4px 8px;
  }

  /* Corners */
  .tui-corner {
    font-size: var(--font-size-sm);
    line-height: 1;
    color: currentColor;
  }

  .tui-corner--tl { grid-area: tl; }
  .tui-corner--tr { grid-area: tr; }
  .tui-corner--bl { grid-area: bl; }
  .tui-corner--br { grid-area: br; }

  /* Inner content */
  .tui-inner {
    grid-area: c;
    white-space: nowrap;
  }

  /* Hover state */
  .tui-button--hovered:not(.tui-button--disabled) {
    border-style: double;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }

  /* Danger: full border opacity on hover */
  .tui-button--danger.tui-button--hovered:not(.tui-button--disabled) {
    border-top-color: currentColor;
    border-bottom-color: currentColor;
  }

  /* Disabled */
  .tui-button--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  a.tui-button--disabled {
    pointer-events: none;
  }
</style>
