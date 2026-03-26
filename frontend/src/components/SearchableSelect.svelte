<script lang="ts">
  import TuiMenuItem from './TuiMenuItem.svelte';
  import TuiMenuPanel from './TuiMenuPanel.svelte';

  let {
    options,
    value = '',
    placeholder = 'Select...',
    onchange,
  }: {
    options: { value: string; label: string }[];
    value?: string;
    placeholder?: string;
    onchange?: (value: string) => void;
  } = $props();

  let open = $state(false);
  let searchText = $state('');
  let wrapperEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  let selectedLabel = $derived(
    options.find(o => o.value === value)?.label ?? '',
  );

  let filteredOptions = $derived.by(() => {
    if (!searchText.trim()) return options;
    const lower = searchText.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(lower));
  });

  function openDropdown() {
    open = true;
    searchText = '';
    requestAnimationFrame(() => inputEl?.focus());
  }

  function close() {
    open = false;
    searchText = '';
  }

  function select(val: string) {
    close();
    onchange?.(val);
  }

  function onWindowClick(e: MouseEvent) {
    if (open && wrapperEl && document.contains(e.target as Node) && !wrapperEl.contains(e.target as Node)) {
      close();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      close();
      e.stopPropagation();
    }
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="searchable-select" bind:this={wrapperEl}>
  {#if open}
    <input
      bind:this={inputEl}
      type="text"
      class="ss-input"
      placeholder={selectedLabel || placeholder}
      bind:value={searchText}
      onkeydown={onKeydown}
    />
    <div class="ss-dropdown" role="listbox">
      <TuiMenuPanel>
        <TuiMenuItem onmousedown={() => select('')}>
          <span class="ss-option--reset" class:ss-selected={!value}>{placeholder}</span>
        </TuiMenuItem>
        {#each filteredOptions as opt (opt.value)}
          <TuiMenuItem onmousedown={() => select(opt.value)}>
            <span class:ss-selected={opt.value === value}>{opt.label}</span>
          </TuiMenuItem>
        {/each}
        {#if filteredOptions.length === 0}
          <TuiMenuItem disabled>
            <span class="ss-no-results">No matches</span>
          </TuiMenuItem>
        {/if}
      </TuiMenuPanel>
    </div>
  {:else}
    <button
      type="button"
      class="ss-trigger"
      onclick={openDropdown}
    >
      <span class="ss-trigger-text" class:ss-placeholder={!value}>
        {selectedLabel || placeholder}
      </span>
      <svg class="ss-arrow" width="12" height="8" viewBox="0 0 12 8">
        <path d="M1 1l5 5 5-5" stroke="currentColor" fill="none" stroke-width="1.5"/>
      </svg>
    </button>
  {/if}
</div>

<style>
  .searchable-select {
    position: relative;
  }

  .ss-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-size: var(--font-size-xs);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s;
  }

  .ss-trigger:focus {
    border-color: var(--accent);
    outline: none;
  }

  .ss-trigger-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .ss-placeholder {
    color: var(--text-muted);
  }

  .ss-arrow {
    flex-shrink: 0;
    color: var(--text-muted);
    margin-left: 4px;
  }

  .ss-input {
    width: 100%;
    padding: 8px 8px;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 0;
    color: var(--text);
    font-size: var(--font-size-xs);
    outline: none;
    box-sizing: border-box;
  }

  .ss-dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    z-index: 100;
    max-height: 200px;
    overflow-y: auto;
  }

  .ss-option--reset {
    color: var(--text-muted);
  }

  .ss-selected {
    color: var(--accent);
  }

  .ss-no-results {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
