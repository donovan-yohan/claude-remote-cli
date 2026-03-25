<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    name: string;
    description?: string;
    children: Snippet;
  }

  let { name, description, children }: Props = $props();
</script>

<div class="setting-row">
  <div class="setting-label">
    <p class="setting-name">{name}</p>
    {#if description}
      <p class="setting-description">{description}</p>
    {/if}
  </div>
  <div class="setting-action">
    {@render children()}
  </div>
</div>

<style>
  .setting-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 10px 0;
  }

  .setting-label {
    flex: 1;
    min-width: 0;
  }

  .setting-name {
    font-size: var(--font-size-base);
    color: var(--text);
    font-weight: 500;
    margin: 0;
  }

  .setting-description {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    margin: 2px 0 0;
  }

  .setting-action {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  /* Opt-in stacked layout for wide action elements on mobile.
     Parents apply the class="setting-row-stacked" attribute to the component
     element, so :global() is required to match it from within scoped styles. */
  @media (max-width: 600px) {
    :global(.setting-row-stacked) .setting-row {
      flex-direction: column;
      align-items: flex-start;
    }

    :global(.setting-row-stacked) .setting-action {
      width: 100%;
    }
  }
</style>
