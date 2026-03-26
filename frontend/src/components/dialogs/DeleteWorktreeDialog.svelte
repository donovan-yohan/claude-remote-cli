<script lang="ts">
  import { deleteWorktree } from '../../lib/api.js';
  import { refreshAll, setLoading, clearLoading } from '../../lib/state/sessions.svelte.js';
  import type { WorktreeInfo } from '../../lib/types.js';
  import DialogShell from './DialogShell.svelte';
  import TuiButton from '../TuiButton.svelte';

  let shellRef = $state<DialogShell | undefined>(undefined);

  let worktree = $state<WorktreeInfo | null>(null);
  let error = $state('');
  let deleting = $state(false);

  export function open(wt: WorktreeInfo) {
    worktree = wt;
    error = '';
    deleting = false;
    shellRef?.open();
  }

  export function close() {
    shellRef?.close();
  }

  async function handleConfirm() {
    if (!worktree || deleting) return;
    deleting = true;
    error = '';
    setLoading(worktree.path);
    try {
      await deleteWorktree(worktree.path, worktree.repoPath);
      shellRef?.close();
      await refreshAll();
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Failed to delete worktree.';
      deleting = false;
    } finally {
      if (worktree) clearLoading(worktree.path);
    }
  }

  function handleCancel() {
    shellRef?.close();
  }
</script>

<DialogShell
  bind:this={shellRef}
  width="400px"
  title="Delete Worktree"
>
  {#snippet footer()}
    <div class="footer-row">
      <TuiButton variant="ghost" onclick={handleCancel} disabled={deleting}>Cancel</TuiButton>
      <TuiButton
        variant="danger"
        onclick={handleConfirm}
        disabled={deleting}
      >
        {deleting ? 'Deleting...' : 'Delete'}
      </TuiButton>
    </div>
  {/snippet}

  <div class="body-content">
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
</DialogShell>

<style>
  .footer-row {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .body-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .confirm-msg {
    font-size: var(--font-size-base);
    margin: 0;
    line-height: 1.5;
  }

  .wt-name {
    color: var(--text);
  }

  .wt-path {
    font-size: var(--font-size-sm);
    color: var(--text-muted);
    font-family: var(--font-mono);
    margin: 0;
    word-break: break-all;
  }

  .warning-msg {
    font-size: var(--font-size-sm);
    color: var(--status-error);
    margin: 0;
  }

  .error-msg {
    font-size: var(--font-size-sm);
    color: var(--status-error);
    margin: 0;
    padding: 8px 10px;
    background: rgba(231, 76, 60, 0.1);
    border-radius: 0;
    border: 1px solid rgba(231, 76, 60, 0.3);
  }
</style>
