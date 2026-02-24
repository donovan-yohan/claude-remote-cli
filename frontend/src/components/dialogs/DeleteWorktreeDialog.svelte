<script lang="ts">
  import { deleteWorktree } from '../../lib/api.js';
  import { refreshAll } from '../../lib/state/sessions.svelte.js';
  import type { WorktreeInfo } from '../../lib/types.js';

  let dialogEl: HTMLDialogElement;

  let worktree = $state<WorktreeInfo | null>(null);
  let error = $state('');
  let deleting = $state(false);

  export function open(wt: WorktreeInfo) {
    worktree = wt;
    error = '';
    deleting = false;
    dialogEl.showModal();
  }

  export function close() {
    dialogEl.close();
  }

  async function handleConfirm() {
    if (!worktree || deleting) return;
    deleting = true;
    error = '';
    try {
      await deleteWorktree(worktree.path, worktree.repoPath);
      dialogEl.close();
      await refreshAll();
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Failed to delete worktree.';
      deleting = false;
    }
  }

  function handleCancel() {
    dialogEl.close();
  }

  function onDialogClick(e: MouseEvent) {
    if (e.target === dialogEl) {
      dialogEl.close();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  onclick={onDialogClick}
  class="dialog"
>
  <div class="dialog-content">
    <h2 class="dialog-title">Delete Worktree</h2>

    <div class="dialog-body">
      {#if worktree}
        <p class="confirm-msg">
          Are you sure you want to delete the worktree
          <strong class="wt-name">{worktree.displayName || worktree.name}</strong>?
        </p>
        <p class="wt-path">{worktree.path}</p>
        <p class="warning-msg">This action cannot be undone.</p>
      {/if}

      {#if error}
        <p class="error-msg">{error}</p>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-ghost" onclick={handleCancel} disabled={deleting}>Cancel</button>
      <button
        class="btn btn-danger"
        onclick={handleConfirm}
        disabled={deleting}
      >
        {deleting ? 'Deleting...' : 'Delete'}
      </button>
    </div>
  </div>
</dialog>

<style>
  .dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0;
    width: min(400px, 95vw);
    overflow: hidden;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.6);
  }

  .dialog-content {
    display: flex;
    flex-direction: column;
  }

  .dialog-title {
    font-size: 1.1rem;
    font-weight: 600;
    padding: 16px 20px 12px;
    margin: 0;
    border-bottom: 1px solid var(--border);
  }

  .dialog-body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .confirm-msg {
    font-size: 0.95rem;
    margin: 0;
    line-height: 1.5;
  }

  .wt-name {
    color: var(--text);
  }

  .wt-path {
    font-size: 0.82rem;
    color: var(--text-muted);
    font-family: monospace;
    margin: 0;
    word-break: break-all;
  }

  .warning-msg {
    font-size: 0.82rem;
    color: #e74c3c;
    margin: 0;
  }

  .error-msg {
    font-size: 0.85rem;
    color: #e74c3c;
    margin: 0;
    padding: 8px 10px;
    background: rgba(231, 76, 60, 0.1);
    border-radius: 6px;
    border: 1px solid rgba(231, 76, 60, 0.3);
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 500;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-danger {
    background: #e74c3c;
    color: #fff;
  }

  .btn-danger:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border);
  }

  .btn-ghost:hover:not(:disabled) {
    background: var(--border);
    color: var(--text);
  }
</style>
