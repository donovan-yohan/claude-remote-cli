<script lang="ts">
  export interface MenuItem {
    label: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
  }

  let {
    items,
  }: {
    items: MenuItem[];
  } = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLUListElement | null>(null);

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (open) {
      close();
    } else {
      open = true;
      requestAnimationFrame(positionMenu);
    }
  }

  function close() {
    open = false;
  }

  function positionMenu() {
    if (!triggerEl || !menuEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();

    // Right-align to trigger, open below by default
    let top = rect.bottom + 4;
    let left = rect.right - menuRect.width;

    // If overflows bottom, open above
    if (top + menuRect.height > window.innerHeight - 8) {
      top = rect.top - menuRect.height - 4;
    }

    // Ensure doesn't overflow left
    if (left < 8) {
      left = 8;
    }

    menuEl.style.top = top + 'px';
    menuEl.style.left = left + 'px';
  }

  function handleItemClick(item: MenuItem, e: Event) {
    e.stopPropagation();
    if (item.disabled) return;
    close();
    item.action();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open || e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  }

  function handleBackdropClick(e: MouseEvent) {
    e.stopPropagation();
    close();
  }
</script>

<svelte:document onkeydown={handleKeydown} />

<button
  class="context-menu-trigger"
  bind:this={triggerEl}
  onclick={toggle}
  aria-label="Actions"
  aria-haspopup="true"
  aria-expanded={open}
>
  &middot;&middot;&middot;
</button>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="context-menu-backdrop" onclick={handleBackdropClick}></div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul
    class="context-menu"
    role="menu"
    bind:this={menuEl}
    onclick={(e) => e.stopPropagation()}
  >
    {#each items as item}
      <li
        class="context-menu-item"
        class:context-menu-item--danger={item.danger}
        class:context-menu-item--disabled={item.disabled}
        role="menuitem"
        tabindex={item.disabled ? -1 : 0}
        onclick={(e) => handleItemClick(item, e)}
        onkeydown={(e) => e.key === 'Enter' && handleItemClick(item, e)}
      >
        {item.label}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .context-menu-trigger {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0 6px;
    border-radius: 4px;
    touch-action: manipulation;
    flex-shrink: 0;
    line-height: 1;
    letter-spacing: 1px;
    min-height: 24px;
    display: inline-flex;
    align-items: center;
    transition: color 0.15s, background 0.15s;
  }

  .context-menu-trigger:hover {
    color: var(--text);
    background: var(--border);
  }

  .context-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }

  .context-menu {
    position: fixed;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    min-width: 175px;
  }

  .context-menu-item {
    padding: 9px 14px;
    font-size: 0.85rem;
    cursor: pointer;
    color: var(--text);
    white-space: nowrap;
  }

  .context-menu-item:hover {
    background: var(--border);
  }

  .context-menu-item:focus {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .context-menu-item--danger {
    color: #e74c3c;
  }

  .context-menu-item--danger:hover {
    background: rgba(231, 76, 60, 0.12);
  }

  .context-menu-item--disabled {
    opacity: 0.4;
    cursor: default;
  }

  .context-menu-item--disabled:hover {
    background: none;
  }
</style>
