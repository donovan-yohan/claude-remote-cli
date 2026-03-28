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
  class="toc-drawer"
  class:open
  aria-label="Settings navigation"
>
  <div class="toc-items">
    {#each sections as section (section.id)}
      <button
        class="toc-item"
        onclick={() => scrollToSection(section.id)}
      >
        {section.label}
      </button>

      {#if section.children}
        {#each section.children as child (child.id)}
          <button
            class="toc-item toc-child"
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

  @media (min-width: 601px) {
    .toc-backdrop { display: none; }
  }

  .toc-drawer {
    width: 180px;
    background: var(--bg);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
  }

  @media (max-width: 600px) {
    .toc-drawer {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 220px;
      z-index: 101;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
    }

    .toc-drawer.open {
      transform: translateX(0);
    }
  }

  .toc-items {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0 8px;
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
    transition: background 0.1s, color 0.1s;
  }

  .toc-item:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .toc-child {
    padding-left: 32px;
    font-size: var(--font-size-xs);
  }
</style>
