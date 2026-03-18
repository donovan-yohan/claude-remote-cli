<script lang="ts">
  import type { Workspace } from '../lib/types.js';

  let {
    workspaces,
    onSelect,
  }: {
    workspaces: Workspace[];
    onSelect: (path: string) => void;
  } = $props();

  let query = $state('');
  let focusedIndex = $state(0);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  let matches = $derived.by((): Workspace[] => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return workspaces.filter(w => w.name.toLowerCase().includes(q));
  });

  let isOpen = $derived(query.trim().length > 0 && matches.length > 0);

  // Reset focused index when matches change
  $effect(() => {
    // Access matches.length to track reactively
    void matches.length;
    focusedIndex = 0;
  });

  function handleInput(e: Event) {
    query = (e.target as HTMLInputElement).value;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      query = '';
      inputEl?.blur();
      return;
    }
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIndex = Math.min(focusedIndex + 1, matches.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIndex = Math.max(focusedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const match = matches[focusedIndex];
      if (match) {
        selectMatch(match);
      }
    }
  }

  function selectMatch(workspace: Workspace) {
    onSelect(workspace.path);
    query = '';
    inputEl?.blur();
  }

  // Highlight matching characters in a name
  function highlightMatch(name: string, q: string): Array<{ text: string; bold: boolean }> {
    if (!q) return [{ text: name, bold: false }];
    const lower = name.toLowerCase();
    const lowerQ = q.toLowerCase();
    const idx = lower.indexOf(lowerQ);
    if (idx === -1) return [{ text: name, bold: false }];
    return [
      { text: name.slice(0, idx), bold: false },
      { text: name.slice(idx, idx + lowerQ.length), bold: true },
      { text: name.slice(idx + lowerQ.length), bold: false },
    ].filter(p => p.text.length > 0);
  }
</script>

<div class="smart-search">
  <div class="input-row">
    <span class="prompt">&gt;</span>
    <input
      bind:this={inputEl}
      type="text"
      class="search-input"
      placeholder="search workspaces..."
      autocomplete="off"
      spellcheck={false}
      value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
  </div>

  {#if isOpen}
    <ul class="dropdown" role="listbox">
      {#each matches as workspace, i (workspace.path)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          class="dropdown-item"
          class:focused={i === focusedIndex}
          role="option"
          aria-selected={i === focusedIndex}
          onclick={() => selectMatch(workspace)}
          onmouseenter={() => { focusedIndex = i; }}
        >
          {#each highlightMatch(workspace.name, query) as part}
            {#if part.bold}
              <strong>{part.text}</strong>
            {:else}
              <span>{part.text}</span>
            {/if}
          {/each}
          <span class="dropdown-path">{workspace.path}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .smart-search {
    position: relative;
    flex-shrink: 0;
  }

  .input-row {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    gap: 6px;
  }

  .prompt {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--accent);
    flex-shrink: 0;
    line-height: 1;
    user-select: none;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    caret-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
  }

  /* Dropdown */
  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-top: none;
    list-style: none;
    z-index: 200;
    max-height: 240px;
    overflow-y: auto;
  }

  .dropdown-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 8px 10px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    transition: background 0.1s;
    white-space: nowrap;
    overflow: hidden;
  }

  .dropdown-item:hover,
  .dropdown-item.focused {
    background: var(--surface-hover);
    color: var(--text);
  }

  .dropdown-item strong {
    color: var(--text);
    font-weight: 700;
  }

  .dropdown-path {
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    opacity: 0.5;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex-shrink: 1;
  }
</style>
