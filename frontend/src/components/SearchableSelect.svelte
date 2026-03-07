<script lang="ts">
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
  let wrapperEl: HTMLDivElement;
  let inputEl: HTMLInputElement;

  let selectedLabel = $derived(
    options.find(o => o.value === value)?.label ?? '',
  );

  let filteredOptions = $derived.by(() => {
    if (!searchText.trim()) return options;
    const lower = searchText.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(lower));
  });

  function toggle() {
    if (open) {
      close();
    } else {
      openDropdown();
    }
  }

  function openDropdown() {
    open = true;
    searchText = '';
    // Focus input after Svelte renders it
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
    if (open && wrapperEl && !wrapperEl.contains(e.target as Node)) {
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
    <ul class="ss-dropdown" role="listbox">
      <li
        class="ss-option ss-option--reset"
        class:ss-selected={!value}
        onmousedown={() => select('')}
        role="option"
        aria-selected={!value}
      >{placeholder}</li>
      {#each filteredOptions as opt (opt.value)}
        <li
          class="ss-option"
          class:ss-selected={opt.value === value}
          onmousedown={() => select(opt.value)}
          role="option"
          aria-selected={opt.value === value}
        >{opt.label}</li>
      {/each}
      {#if filteredOptions.length === 0}
        <li class="ss-option ss-no-results">No matches</li>
      {/if}
    </ul>
  {:else}
    <button
      type="button"
      class="ss-trigger"
      onclick={toggle}
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
    padding: 6px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.75rem;
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
    padding: 6px 8px;
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.75rem;
    outline: none;
    box-sizing: border-box;
  }

  .ss-dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    z-index: 100;
    max-height: 200px;
    overflow-y: auto;
  }

  .ss-option {
    padding: 6px 10px;
    font-size: 0.75rem;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ss-option:hover {
    background: var(--border);
  }

  .ss-option--reset {
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }

  .ss-selected {
    color: var(--accent);
  }

  .ss-no-results {
    color: var(--text-muted);
    font-style: italic;
    cursor: default;
  }

  .ss-no-results:hover {
    background: transparent;
  }
</style>
