<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchBranches } from '../lib/api.js';
  import type { BranchInfo } from '../lib/types.js';

  let {
    workspacePath,
    currentBase,
    prNumber,
    disabled = false,
    onBaseChanged,
  }: {
    workspacePath: string;
    currentBase: string;
    prNumber: number;
    disabled?: boolean;
    onBaseChanged?: (newBase: string) => void;
  } = $props();

  let open = $state(false);
  let filterText = $state('');
  let wrapperEl = $state<HTMLDivElement | null>(null);
  let filterInputEl = $state<HTMLInputElement | null>(null);
  let switching = $state<string | null>(null);
  let switchError = $state<string | null>(null);

  // Fetch branches (remote only) -- lazy, only when dropdown opens
  const branchQuery = createQuery<BranchInfo[]>(() => ({
    queryKey: ['branches', workspacePath],
    queryFn: () => fetchBranches(workspacePath),
    staleTime: 30_000,
    enabled: open,
  }));

  // Filter to remote-only branches, strip origin/ prefix
  let filteredBranches = $derived.by(() => {
    const branches = (branchQuery.data ?? [])
      .filter(b => b.isRemote)
      .map(b => ({ ...b, name: b.name.replace(/^origin\//, '') }));

    // Deduplicate by name
    const seen = new Set<string>();
    const deduped = branches.filter(b => {
      if (seen.has(b.name)) return false;
      seen.add(b.name);
      return true;
    });

    if (!filterText.trim()) return deduped;
    const lower = filterText.toLowerCase();
    return deduped.filter(b => b.name.toLowerCase().includes(lower));
  });

  function openDropdown() {
    if (disabled) return;
    open = true;
    filterText = '';
    switchError = null;
    requestAnimationFrame(() => filterInputEl?.focus());
  }

  function closeDropdown() {
    open = false;
    filterText = '';
  }

  async function handleSelect(branchName: string) {
    if (branchName === currentBase) {
      closeDropdown();
      return;
    }
    switching = branchName;
    switchError = null;
    try {
      const res = await fetch('/workspaces/pr-base?path=' + encodeURIComponent(workspacePath), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prNumber, baseBranch: branchName }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        closeDropdown();
        onBaseChanged?.(branchName);
      } else {
        switchError = data.error ?? 'Failed to change base branch';
      }
    } catch {
      switchError = 'Failed to change base branch';
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

<div class="target-switcher" bind:this={wrapperEl}>
  <button
    class="target-trigger"
    class:target-disabled={disabled}
    onclick={openDropdown}
    aria-label="Change target branch"
    aria-expanded={open}
    aria-haspopup="listbox"
    title={disabled ? 'Unavailable while agent is running' : 'Change target branch'}
  >
    <span class="target-name">{currentBase}</span>
    <svg class="target-caret" width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
      <path d="M1 1l3 3 3-3" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linecap="round"/>
    </svg>
  </button>

  {#if open}
    <div class="target-dropdown" role="listbox" tabindex="-1" aria-label="Target branches" onkeydown={onKeydown}>
      <div class="target-filter-wrap">
        <input
          bind:this={filterInputEl}
          type="text"
          class="target-filter"
          placeholder="Filter branches..."
          bind:value={filterText}
          onkeydown={onKeydown}
          aria-label="Filter target branches"
        />
      </div>

      {#if switchError}
        <div class="target-error">{switchError}</div>
      {/if}

      {#if branchQuery.isLoading}
        <div class="target-loading">Loading...</div>
      {:else if filteredBranches.length === 0}
        <div class="target-empty">No branches match</div>
      {:else}
        <ul class="target-list">
          {#each filteredBranches as branch (branch.name)}
            <li
              class="target-option"
              class:target-current={branch.name === currentBase}
              class:target-switching={switching === branch.name}
              role="option"
              aria-selected={branch.name === currentBase}
              onmousedown={() => handleSelect(branch.name)}
            >
              {#if branch.name === currentBase}
                <span class="target-check">&#10003;</span>
              {:else}
                <span class="target-check target-check--empty"></span>
              {/if}
              <span class="target-option-name">{branch.name}</span>
              {#if switching === branch.name}
                <span class="target-spinner">&hellip;</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .target-switcher {
    position: relative;
  }

  .target-trigger {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    transition: background 0.12s;
    white-space: nowrap;
    min-width: 0;
  }

  .target-trigger:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .target-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .target-disabled:hover {
    background: none;
    color: var(--text-muted);
  }

  .target-name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .target-caret {
    flex-shrink: 0;
    color: var(--text-muted);
    margin-left: 1px;
  }

  .target-dropdown {
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

  .target-filter-wrap {
    padding: 6px 6px 4px;
    border-bottom: 1px solid var(--border);
  }

  .target-filter {
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

  .target-filter:focus {
    border-color: var(--accent);
  }

  .target-error {
    font-size: var(--font-size-xs);
    color: var(--status-error);
    padding: 4px 10px;
  }

  .target-loading,
  .target-empty {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    padding: 8px 10px;
    font-style: italic;
  }

  .target-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 240px;
    overflow-y: auto;
  }

  .target-option {
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

  .target-option:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .target-current {
    color: var(--accent);
  }

  .target-current:hover {
    color: var(--accent);
  }

  .target-switching {
    opacity: 0.6;
    pointer-events: none;
  }

  .target-check {
    font-size: 0.65rem;
    width: 10px;
    flex-shrink: 0;
    color: var(--accent);
  }

  .target-check--empty {
    display: inline-block;
  }

  .target-option-name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .target-spinner {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    flex-shrink: 0;
  }
</style>
