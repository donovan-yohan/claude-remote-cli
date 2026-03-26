<script lang="ts">
  interface Section {
    id: string;
    label: string;
    children?: Array<{ id: string; label: string }>;
  }

  interface Props {
    sections: Section[];
    contentEl?: HTMLElement;
    open: boolean;
    onclose: () => void;
  }

  let { sections, contentEl, open, onclose }: Props = $props();

  let drawerEl = $state<HTMLElement | undefined>(undefined);
  let activeId = $state('');
  let highlightTop = $state(0);
  let highlightHeight = $state(32);

  // Set up IntersectionObserver to track which section is in view
  $effect(() => {
    if (!contentEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            activeId = entry.target.id;
          }
        }
      },
      { root: contentEl, threshold: 0.1 },
    );

    for (const section of sections) {
      const el = contentEl.querySelector(`#${section.id}`);
      if (el) observer.observe(el);
      if (section.children) {
        for (const child of section.children) {
          const childEl = contentEl.querySelector(`#${child.id}`);
          if (childEl) observer.observe(childEl);
        }
      }
    }

    return () => observer.disconnect();
  });

  // Move the highlight bar to track the active item
  $effect(() => {
    if (!activeId || !drawerEl) return;
    const activeEl = drawerEl.querySelector(`[data-section-id="${activeId}"]`);
    if (activeEl) {
      const rect = activeEl.getBoundingClientRect();
      const drawerRect = drawerEl.getBoundingClientRect();
      highlightTop = rect.top - drawerRect.top;
      highlightHeight = rect.height;
    }
  });

  // Focus the first item when the drawer opens
  $effect(() => {
    if (open && drawerEl) {
      const firstItem = drawerEl.querySelector<HTMLElement>('.toc-item');
      firstItem?.focus();
    }
  });

  function scrollToSection(id: string) {
    const el = contentEl?.querySelector(`#${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
    onclose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="toc-backdrop" onclick={onclose}></div>
{/if}

<nav
  bind:this={drawerEl}
  class="toc-drawer"
  class:open
  aria-label="Settings navigation"
>
  <div class="toc-header">
    <span class="toc-title">contents</span>
  </div>

  <div class="toc-items">
    <!-- Highlight bar (decorative) -->
    <div
      class="toc-highlight"
      aria-hidden="true"
      style:top="{highlightTop}px"
      style:height="{highlightHeight}px"
    ></div>

    {#each sections as section (section.id)}
      <button
        class="toc-item"
        class:active={activeId === section.id}
        data-section-id={section.id}
        onclick={() => scrollToSection(section.id)}
      >
        {section.label}
      </button>

      {#if section.children}
        {#each section.children as child (child.id)}
          <button
            class="toc-item toc-child"
            class:active={activeId === child.id}
            data-section-id={child.id}
            onclick={() => scrollToSection(child.id)}
          >
            {child.label}
          </button>
        {/each}
      {/if}
    {/each}
  </div>
</nav>

<style>
  .toc-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .toc-drawer {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 220px;
    background: var(--bg);
    border-right: 1px solid var(--border);
    z-index: 101;
    display: flex;
    flex-direction: column;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    overflow: hidden;
  }

  .toc-drawer.open {
    transform: translateX(0);
  }

  .toc-header {
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .toc-title {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }

  .toc-items {
    position: relative;
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .toc-highlight {
    position: absolute;
    left: 0;
    width: 3px;
    background: var(--accent);
    transition: top 150ms ease, height 150ms ease;
    border-radius: 0;
    pointer-events: none;
  }

  .toc-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 8px 16px;
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;
  }

  .toc-item:hover {
    background: var(--surface-hover);
  }

  .toc-item.active {
    color: var(--text);
  }

  .toc-child {
    padding-left: 32px;
    font-size: var(--font-size-xs);
  }
</style>
