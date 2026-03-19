<script lang="ts">
  import { addWorkspacesBulk } from '../../lib/api.js';
  import FileBrowser from '../FileBrowser.svelte';

  let {
    onWorkspacesAdded,
  }: {
    onWorkspacesAdded: (paths: string[]) => void;
  } = $props();

  let dialogEl: HTMLDialogElement;
  let fileBrowserRef = $state<FileBrowser | undefined>();
  let selectedPaths = $state<string[]>([]);
  let error = $state('');
  let submitting = $state(false);

  export function open() {
    selectedPaths = [];
    error = '';
    submitting = false;
    fileBrowserRef?.reset();
    dialogEl.showModal();
  }

  export function close() {
    dialogEl.close();
  }

  async function handleSubmit() {
    if (selectedPaths.length === 0) return;

    submitting = true;
    error = '';

    try {
      const result = await addWorkspacesBulk(selectedPaths);

      if (result.errors.length > 0 && result.added.length === 0) {
        error = result.errors.map((e) => `${e.path}: ${e.error}`).join('; ');
        submitting = false;
        return;
      }

      if (result.added.length > 0) {
        onWorkspacesAdded(result.added.map((a) => a.path));
      }

      if (result.errors.length > 0) {
        // Partial success — still close but log
        console.warn('Some workspaces failed to add:', result.errors);
      }

      close();
    } catch {
      error = 'Failed to add workspaces.';
    } finally {
      submitting = false;
    }
  }

  function onDialogClick(e: MouseEvent) {
    if (e.target === dialogEl) close();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialogEl} onclick={onDialogClick} class="dialog">
  <div class="dialog-content">
    <div class="dialog-header">
      <h2 class="dialog-title">Add Workspace</h2>
      <button class="close-btn" aria-label="Close" onclick={close}>&#10005;</button>
    </div>

    <div class="dialog-body">
      <p class="dialog-desc">
        Browse for folders on your machine. Git repos get PR tracking and branch management.
      </p>

      <FileBrowser bind:this={fileBrowserRef} bind:selectedPaths />

      {#if error}
        <p class="error-msg">{error}</p>
      {/if}
    </div>

    <div class="dialog-footer">
      <span class="selected-count">
        {#if selectedPaths.length > 0}
          {selectedPaths.length} selected
        {/if}
      </span>
      <div class="footer-actions">
        <button class="btn btn-ghost" onclick={close}>Cancel</button>
        <button
          class="btn btn-primary"
          onclick={handleSubmit}
          disabled={selectedPaths.length === 0 || submitting}
        >
          {#if submitting}
            Adding...
          {:else}
            Add Workspace{selectedPaths.length > 1 ? 's' : ''}
          {/if}
        </button>
      </div>
    </div>
  </div>
</dialog>

<style>
  .dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0;
    width: min(520px, 95vw);
    max-height: 85vh;
    overflow: hidden;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.7);
  }

  .dialog-content {
    display: flex;
    flex-direction: column;
    max-height: 85vh;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dialog-title {
    font-size: var(--font-size-lg, 1.1rem);
    font-weight: 600;
    font-family: var(--font-mono, monospace);
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  .dialog-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dialog-desc {
    font-size: var(--font-size-sm, 0.85rem);
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
    margin: 0;
    line-height: 1.5;
  }

  .error-msg {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--status-error, #e57373);
    font-family: var(--font-mono, monospace);
    margin: 0;
  }

  .dialog-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .selected-count {
    font-size: var(--font-size-sm, 0.85rem);
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
  }

  .footer-actions {
    display: flex;
    gap: 10px;
  }

  .btn {
    padding: 8px 18px;
    border-radius: 0;
    font-size: var(--font-size-sm, 0.85rem);
    font-family: var(--font-mono, monospace);
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 500;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border);
  }

  .btn-ghost:hover {
    background: var(--border);
    color: var(--text);
  }
</style>
