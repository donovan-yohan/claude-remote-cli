<script lang="ts">
  import { onMount } from 'svelte';
  import { browseFsDirectory, type BrowseEntry } from '../lib/api.js';

  interface BrowseNode {
    name: string;
    path: string;
    isGitRepo: boolean;
    hasChildren: boolean;
    children: BrowseNode[] | null;
    expanded: boolean;
    selected: boolean;
    loading: boolean;
    depth: number;
    truncatedInfo: { shown: number; total: number } | null;
  }

  let {
    selectedPaths = $bindable([]),
  }: {
    selectedPaths: string[];
  } = $props();

  let tree = $state<BrowseNode[]>([]);
  let filterText = $state('');
  let focusIndex = $state(-1);
  let initialLoading = $state(true);
  let rootTruncated = $state<{ shown: number; total: number } | null>(null);
  let treeEl = $state<HTMLElement | undefined>();

  // Load home directory on mount
  onMount(() => { loadRoot(); });

  async function loadRoot() {
    initialLoading = true;
    rootTruncated = null;
    try {
      const data = await browseFsDirectory();
      tree = data.entries.map((e) => entryToNode(e, 0));
      if (data.truncated) {
        rootTruncated = { shown: data.entries.length, total: data.total };
      }
    } catch {
      tree = [];
    } finally {
      initialLoading = false;
    }
  }

  function entryToNode(entry: BrowseEntry, depth: number): BrowseNode {
    return {
      name: entry.name,
      path: entry.path,
      isGitRepo: entry.isGitRepo,
      hasChildren: entry.hasChildren,
      children: null,
      expanded: false,
      selected: false,
      loading: false,
      depth,
      truncatedInfo: null,
    };
  }

  async function toggleExpand(node: BrowseNode) {
    if (node.expanded) {
      node.expanded = false;
      return;
    }

    if (node.children === null) {
      node.loading = true;
      try {
        const data = await browseFsDirectory(node.path);
        node.children = data.entries.map((e) => entryToNode(e, node.depth + 1));
        node.truncatedInfo = data.truncated ? { shown: data.entries.length, total: data.total } : null;
      } catch {
        node.children = [];
      } finally {
        node.loading = false;
      }
    }

    node.expanded = true;
  }

  function toggleSelect(node: BrowseNode) {
    node.selected = !node.selected;
    syncSelectedPaths();
  }

  function syncSelectedPaths() {
    selectedPaths = collectSelected(tree);
  }

  function collectSelected(nodes: BrowseNode[]): string[] {
    const result: string[] = [];
    for (const node of nodes) {
      if (node.selected) result.push(node.path);
      if (node.children) result.push(...collectSelected(node.children));
    }
    return result;
  }

  // Filtering logic
  function nameMatches(name: string, filter: string): boolean {
    return name.toLowerCase().includes(filter.toLowerCase());
  }

  function isVisible(node: BrowseNode, filter: string): boolean {
    if (!filter) return true;
    if (node.expanded) return true;
    if (nameMatches(node.name, filter)) return true;
    if (node.children?.some((c) => isVisible(c, filter))) return true;
    return false;
  }

  // Flatten visible tree for rendering + keyboard nav
  function flattenVisible(nodes: BrowseNode[], filter: string): BrowseNode[] {
    const result: BrowseNode[] = [];
    for (const node of nodes) {
      if (!isVisible(node, filter)) continue;
      result.push(node);
      if (node.expanded && node.children) {
        result.push(...flattenVisible(node.children, filter));
      }
    }
    return result;
  }

  let visibleNodes = $derived(flattenVisible(tree, filterText));

  // Keyboard navigation
  function handleTreeKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusIndex = Math.min(focusIndex + 1, visibleNodes.length - 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusIndex = Math.max(focusIndex - 1, 0);
      return;
    }

    const focused = focusIndex >= 0 ? visibleNodes[focusIndex] : undefined;
    if (!focused) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (focused.hasChildren && !focused.expanded) {
        toggleExpand(focused);
      } else if (focused.expanded && focused.children?.length) {
        // Move to first child
        const childIdx = visibleNodes.indexOf(focused.children[0]!);
        if (childIdx >= 0) focusIndex = childIdx;
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (focused.expanded) {
        focused.expanded = false;
      } else {
        // Move to parent
        const parentDepth = focused.depth - 1;
        for (let i = focusIndex - 1; i >= 0; i--) {
          if (visibleNodes[i]!.depth === parentDepth) {
            focusIndex = i;
            break;
          }
        }
      }
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      toggleSelect(focused);
      return;
    }
  }

  function handleRowClick(node: BrowseNode, e: MouseEvent) {
    const target = e.target as HTMLElement;
    // If clicking the expand arrow or checkbox, those have their own handlers
    if (target.closest('.expand-btn') || target.closest('.node-checkbox')) return;

    // Click row body: expand if collapsed, toggle select if leaf or expanded
    if (node.hasChildren && !node.expanded) {
      toggleExpand(node);
    } else {
      toggleSelect(node);
    }
  }

  export function reset() {
    filterText = '';
    focusIndex = -1;
    // Deselect all
    deselectAll(tree);
    selectedPaths = [];
    // Collapse all
    collapseAll(tree);
  }

  function deselectAll(nodes: BrowseNode[]) {
    for (const node of nodes) {
      node.selected = false;
      if (node.children) deselectAll(node.children);
    }
  }

  function collapseAll(nodes: BrowseNode[]) {
    for (const node of nodes) {
      node.expanded = false;
      if (node.children) collapseAll(node.children);
    }
  }
</script>

<div class="file-browser">
  <div class="filter-row">
    <input
      type="text"
      class="filter-input"
      placeholder="Filter..."
      bind:value={filterText}
      aria-label="Filter directories"
      autocomplete="off"
      spellcheck="false"
    />
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="tree-container"
    role="tree"
    aria-label="File browser"
    bind:this={treeEl}
    onkeydown={handleTreeKeydown}
    tabindex="0"
  >
    {#if initialLoading}
      <div class="loading-placeholder">Loading...</div>
    {:else if visibleNodes.length === 0}
      <div class="empty-placeholder">
        {#if filterText}
          No matches for "{filterText}"
        {:else}
          No directories found
        {/if}
      </div>
    {:else}
      {#each visibleNodes as node, i (node.path)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="tree-row"
          class:focused={i === focusIndex}
          class:selected={node.selected}
          style="padding-left: {12 + node.depth * 20}px"
          role="treeitem"
          aria-expanded={node.hasChildren ? node.expanded : undefined}
          aria-selected={node.selected}
          aria-level={node.depth + 1}
          onclick={(e) => handleRowClick(node, e)}
        >
          {#if node.hasChildren}
            <button
              class="expand-btn"
              data-track="file-browser.expand"
              aria-label={node.expanded ? 'Collapse' : 'Expand'}
              onclick={() => toggleExpand(node)}
            >
              {#if node.loading}
                <span class="spinner">...</span>
              {:else}
                <span class="arrow" class:expanded={node.expanded}>&#9654;</span>
              {/if}
            </button>
          {:else}
            <span class="expand-spacer"></span>
          {/if}

          <input
            type="checkbox"
            class="node-checkbox"
            data-track="file-browser.select"
            checked={node.selected}
            onchange={() => toggleSelect(node)}
            aria-label="Select {node.name}"
            onclick={(e) => e.stopPropagation()}
          />

          <span class="node-name">{node.name}</span>

          {#if node.isGitRepo}
            <span class="git-badge" aria-label="Git repository">git</span>
          {/if}
        </div>
      {/each}

      {#if rootTruncated}
        <div class="truncated-notice">
          Showing {rootTruncated.shown} of {rootTruncated.total} directories. Use the filter to narrow results.
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .file-browser {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .filter-row {
    display: flex;
    gap: 8px;
  }

  .filter-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    padding: 8px 10px;
    outline: none;
  }

  .filter-input:focus {
    border-color: var(--accent);
  }

  .filter-input::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
  }

  .tree-container {
    background: var(--bg);
    border: 1px solid var(--border);
    max-height: 50vh;
    overflow-y: auto;
    outline: none;
  }

  .tree-container:focus-visible {
    border-color: var(--accent);
  }

  .loading-placeholder,
  .empty-placeholder {
    padding: 20px 16px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    text-align: center;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 4px;
    padding-bottom: 4px;
    padding-right: 12px;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;
    min-height: 32px;
  }

  .tree-row:hover {
    background: var(--border);
  }

  .tree-row.focused {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .tree-row.selected {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .expand-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 10px;
    border-radius: 2px;
  }

  .expand-btn:hover {
    background: var(--surface);
    color: var(--text);
  }

  .expand-spacer {
    width: 18px;
    flex-shrink: 0;
  }

  .arrow {
    display: inline-block;
    transition: transform 0.15s;
  }

  .arrow.expanded {
    transform: rotate(90deg);
  }

  .spinner {
    animation: blink 1s infinite;
    font-size: 10px;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .node-checkbox {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
    margin: 0;
  }

  .node-name {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .git-badge {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    text-transform: lowercase;
  }

  .truncated-notice {
    padding: 8px 12px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    text-align: center;
  }
</style>
