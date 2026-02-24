<script lang="ts">
  import type { WorktreeInfo } from '../lib/types.js';

  let {
    onResumeYolo,
    onDeleteWorktree,
  }: {
    onResumeYolo?: (wt: WorktreeInfo) => void;
    onDeleteWorktree?: (wt: WorktreeInfo) => void;
  } = $props();

  let visible = $state(false);
  let x = $state(0);
  let y = $state(0);
  let target = $state<WorktreeInfo | null>(null);

  export function show(cx: number, cy: number, wt: WorktreeInfo) {
    x = Math.min(cx, window.innerWidth - 185);
    y = Math.min(cy, window.innerHeight - 80);
    target = wt;
    visible = true;
  }

  export function hide() {
    visible = false;
    target = null;
  }

  function handleResumeYolo() {
    const wt = target;
    hide();
    if (wt) onResumeYolo?.(wt);
  }

  function handleDeleteWorktree() {
    const wt = target;
    hide();
    if (wt) onDeleteWorktree?.(wt);
  }
</script>

<svelte:document
  onclick={() => { if (visible) hide(); }}
  onkeydown={(e) => { if (e.key === 'Escape' && visible) hide(); }}
/>

{#if visible}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul
    class="context-menu"
    style:left={x + 'px'}
    style:top={y + 'px'}
    role="menu"
    onclick={(e) => e.stopPropagation()}
  >
    <li
      class="context-menu-item"
      role="menuitem"
      onclick={handleResumeYolo}
      onkeydown={(e) => e.key === 'Enter' && handleResumeYolo()}
      tabindex="0"
    >
      Resume in yolo mode
    </li>
    <li
      class="context-menu-item context-menu-item--danger"
      role="menuitem"
      onclick={handleDeleteWorktree}
      onkeydown={(e) => e.key === 'Enter' && handleDeleteWorktree()}
      tabindex="0"
    >
      Delete worktree
    </li>
  </ul>
{/if}

<style>
  .context-menu {
    position: fixed;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    z-index: 1000;
    min-width: 175px;
  }

  .context-menu-item {
    padding: 9px 14px;
    font-size: 0.9rem;
    cursor: pointer;
    color: var(--text);
  }

  .context-menu-item:hover {
    background: var(--border);
  }

  .context-menu-item:focus {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .context-menu-item--danger {
    color: #e74c3c;
  }

  .context-menu-item--danger:hover {
    background: rgba(231, 76, 60, 0.12);
  }
</style>
