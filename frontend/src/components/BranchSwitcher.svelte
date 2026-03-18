<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchBranches, switchBranch } from '../lib/api.js';

  let {
    workspacePath,
    currentBranch,
    onSwitch,
  }: {
    workspacePath: string;
    currentBranch: string;
    onSwitch: (branch: string) => void;
  } = $props();

  let open = $state(false);
  let filterText = $state('');
  let wrapperEl = $state<HTMLDivElement | null>(null);
  let filterInputEl = $state<HTMLInputElement | null>(null);
  let switching = $state<string | null>(null);
  let switchError = $state<string | null>(null);

  const branchQuery = createQuery<string[]>(() => ({
    queryKey: ['branches', workspacePath],
    queryFn: () => fetchBranches(workspacePath),
    staleTime: 30_000,
    enabled: open,
  }));

  let filteredBranches = $derived.by(() => {
    const branches = branchQuery.data ?? [];
    if (!filterText.trim()) return branches;
    const lower = filterText.toLowerCase();
    return branches.filter(b => b.toLowerCase().includes(lower));
  });

  function openDropdown() {
    open = true;
    filterText = '';
    switchError = null;
    requestAnimationFrame(() => filterInputEl?.focus());
  }

  function closeDropdown() {
    open = false;
    filterText = '';
  }

  async function handleSelect(branch: string) {
    if (branch === currentBranch) {
      closeDropdown();
      return;
    }
    switching = branch;
    switchError = null;
    try {
      const result = await switchBranch(workspacePath, branch);
      if (result.success) {
        closeDropdown();
        onSwitch(branch);
      } else {
        switchError = result.error ?? 'Failed to switch branch';
      }
    } catch {
      switchError = 'Failed to switch branch';
    } finally {
      switching = null;
    }
  }

  function onWindowClick(e: MouseEvent) {
    if (open && wrapperEl && document.contains(e.target as Node) && !wrapperEl.contains(e.target as Node)) {
      closeDropdown();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      closeDropdown();
      e.stopPropagation();
    }
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="branch-switcher" bind:this={wrapperEl}>
  <button
    class="branch-trigger"
    onclick={openDropdown}
    aria-label="Switch branch"
    aria-expanded={open}
    aria-haspopup="listbox"
  >
    <span class="branch-icon">⑂</span>
    <span class="branch-name">{currentBranch}</span>
    <svg class="branch-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
      <path d="M1 1l4 4 4-4" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  </button>

  {#if open}
    <div class="branch-dropdown" role="listbox" tabindex="-1" aria-label="Branches" onkeydown={onKeydown}>
      <div class="branch-filter-wrap">
        <input
          bind:this={filterInputEl}
          type="text"
          class="branch-filter"
          placeholder="Filter branches..."
          bind:value={filterText}
          onkeydown={onKeydown}
          aria-label="Filter branches"
        />
      </div>

      {#if switchError}
        <div class="branch-error">{switchError}</div>
      {/if}

      {#if branchQuery.isLoading}
        <div class="branch-loading">Loading...</div>
      {:else if filteredBranches.length === 0}
        <div class="branch-empty">No branches match</div>
      {:else}
        <ul class="branch-list">
          {#each filteredBranches as branch (branch)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
              class="branch-option"
              class:branch-current={branch === currentBranch}
              class:branch-switching={switching === branch}
              role="option"
              aria-selected={branch === currentBranch}
              onmousedown={() => handleSelect(branch)}
            >
              {#if branch === currentBranch}
                <span class="branch-check">✓</span>
              {:else}
                <span class="branch-check branch-check--empty"></span>
              {/if}
              <span class="branch-option-name">{branch}</span>
              {#if switching === branch}
                <span class="branch-spinner">…</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .branch-switcher {
    position: relative;
  }

  .branch-trigger {
    display: flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    transition: background 0.12s;
    white-space: nowrap;
    min-width: 0;
  }

  .branch-trigger:hover {
    background: var(--surface-hover);
  }

  .branch-icon {
    color: var(--text-muted);
    font-size: 0.9rem;
    flex-shrink: 0;
  }

  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  }

  .branch-caret {
    flex-shrink: 0;
    color: var(--text-muted);
    margin-left: 1px;
  }

  .branch-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 220px;
    max-width: 340px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    z-index: 200;
    overflow: hidden;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .branch-filter-wrap {
    padding: 6px 6px 4px;
    border-bottom: 1px solid var(--border);
  }

  .branch-filter {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    padding: 4px 8px;
    outline: none;
    box-sizing: border-box;
  }

  .branch-filter:focus {
    border-color: var(--accent);
  }

  .branch-error {
    font-size: var(--font-size-xs);
    color: var(--status-error);
    padding: 4px 10px;
  }

  .branch-loading,
  .branch-empty {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    padding: 8px 10px;
    font-style: italic;
  }

  .branch-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 240px;
    overflow-y: auto;
  }

  .branch-option {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    font-size: var(--font-size-xs);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    color: var(--text-muted);
    transition: background 0.1s, color 0.1s;
  }

  .branch-option:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .branch-current {
    color: var(--accent);
  }

  .branch-current:hover {
    color: var(--accent);
  }

  .branch-switching {
    opacity: 0.6;
    pointer-events: none;
  }

  .branch-check {
    font-size: 0.65rem;
    width: 10px;
    flex-shrink: 0;
    color: var(--accent);
  }

  .branch-check--empty {
    display: inline-block;
  }

  .branch-option-name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .branch-spinner {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    flex-shrink: 0;
  }
</style>
