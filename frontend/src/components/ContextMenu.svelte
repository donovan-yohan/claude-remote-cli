<script lang="ts">
  import TuiMenuItem from './TuiMenuItem.svelte';
  import TuiMenuPanel from './TuiMenuPanel.svelte';

  export interface MenuItem {
    label: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
  }

  let {
    items,
    hideTrigger = false,
  }: {
    items: MenuItem[];
    hideTrigger?: boolean;
  } = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let anchorRect = $state<DOMRect | null>(null);

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
    anchorRect = null;
  }

  /** Open the menu programmatically, anchored to the given element */
  export function openAt(anchor: HTMLElement) {
    anchorRect = anchor.getBoundingClientRect();
    open = true;
    requestAnimationFrame(positionMenu);
  }

  function positionMenu() {
    if (!menuEl) return;
    const rect = anchorRect || triggerEl?.getBoundingClientRect();
    if (!rect) return;
    const menuRect = menuEl.getBoundingClientRect();

    // Right-align to anchor, open below by default
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

  function handleItemSelect(item: MenuItem, e: MouseEvent) {
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

{#if !hideTrigger}
  <button
    class="context-menu-trigger"
    bind:this={triggerEl}
    data-track="context-menu.open"
    onclick={toggle}
    aria-label="Actions"
    aria-haspopup="true"
    aria-expanded={open}
  >
    &middot;&middot;&middot;
  </button>
{/if}

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="context-menu-backdrop" onclick={handleBackdropClick}></div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="context-menu"
    role="menu"
    bind:this={menuEl}
    onclick={(e) => e.stopPropagation()}
  >
    <TuiMenuPanel>
      {#each items as item}
        <TuiMenuItem
          danger={item.danger ?? false}
          disabled={item.disabled ?? false}
          onmousedown={(e) => handleItemSelect(item, e)}
        >
          {item.label}
        </TuiMenuItem>
      {/each}
    </TuiMenuPanel>
  </div>
{/if}

<style>
  .context-menu-trigger {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: var(--font-size-lg);
    font-weight: 700;
    cursor: pointer;
    padding: 0 6px;
    border-radius: 0;
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
    z-index: 1000;
    min-width: 175px;
  }
</style>
