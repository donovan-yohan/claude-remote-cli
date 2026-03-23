<script module lang="ts">
  export interface FilterChip {
    id: string;
    label: string;
    count?: number;
  }
</script>

<script lang="ts">
  let { chips, activeChips, onToggle, onClearAll, searchQuery = '', onSearch }: {
    chips: FilterChip[];
    activeChips: string[];
    onToggle: (id: string) => void;
    onClearAll?: () => void;
    searchQuery?: string;
    onSearch?: (query: string) => void;
  } = $props();

  let hasActiveFilters = $derived(activeChips.length > 0 || searchQuery.length > 0);
</script>

<div class="filter-chip-bar" role="group" aria-label="Filters">
  <div class="chip-row">
    {#each chips as chip (chip.id)}
      <button
        class="filter-chip"
        class:active={activeChips.includes(chip.id)}
        onclick={() => onToggle(chip.id)}
        aria-pressed={activeChips.includes(chip.id)}
      >
        {chip.label}
        {#if chip.count !== undefined}
          <span class="chip-count">{chip.count}</span>
        {/if}
      </button>
    {/each}
    {#if hasActiveFilters && onClearAll}
      <button class="filter-chip clear-chip" onclick={onClearAll}>
        Clear
      </button>
    {/if}
  </div>
  {#if onSearch}
    <input
      type="text"
      class="filter-search"
      placeholder="Search..."
      value={searchQuery}
      oninput={(e) => onSearch?.(e.currentTarget.value)}
      aria-label="Search within filtered results"
    />
  {/if}
</div>

<style>
  .filter-chip-bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 0;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .filter-chip {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    padding: 3px 8px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .filter-chip:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }
  .filter-chip.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .clear-chip {
    color: var(--text-muted);
    opacity: 0.7;
  }
  .clear-chip:hover {
    opacity: 1;
  }
  .chip-count {
    font-size: 0.65rem;
    opacity: 0.6;
    margin-left: 3px;
  }
  .filter-search {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 4px 8px;
    width: 100%;
    outline: none;
  }
  .filter-search:focus {
    border-color: var(--accent);
  }
  .filter-search::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
  }
</style>
