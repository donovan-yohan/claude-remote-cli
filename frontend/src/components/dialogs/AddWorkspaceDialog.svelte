<script lang="ts">
  import { addWorkspacesBulk } from '../../lib/api.js';
  import FileBrowser from '../FileBrowser.svelte';
  import TuiButton from '../TuiButton.svelte';
  import DialogShell from './DialogShell.svelte';

  let {
    onWorkspacesAdded,
  }: {
    onWorkspacesAdded: (paths: string[]) => void;
  } = $props();

  let shellRef = $state<DialogShell | undefined>(undefined);
  let fileBrowserRef = $state<FileBrowser | undefined>();
  let selectedPaths = $state<string[]>([]);
  let error = $state('');
  let submitting = $state(false);

  export function open() {
    selectedPaths = [];
    error = '';
    submitting = false;
    fileBrowserRef?.reset();
    shellRef?.open();
  }

  export function close() {
    shellRef?.close();
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
</script>

<DialogShell
  bind:this={shellRef}
  width="520px"
  title="Add Workspace"
>
  {#snippet footer()}
    <div class="footer-row">
      <span class="selected-count">
        {#if selectedPaths.length > 0}
          {selectedPaths.length} selected
        {/if}
      </span>
      <div class="footer-actions">
        <TuiButton variant="ghost" onclick={close}>Cancel</TuiButton>
        <TuiButton
          variant="primary"
          onclick={handleSubmit}
          disabled={selectedPaths.length === 0 || submitting}
        >
          {#if submitting}
            Adding...
          {:else}
            Add Workspace{selectedPaths.length > 1 ? 's' : ''}
          {/if}
        </TuiButton>
      </div>
    </div>
  {/snippet}

  <div class="body-content">
    <p class="dialog-desc">
      Browse for folders on your machine. Git repos get PR tracking and branch management.
    </p>

    <FileBrowser bind:this={fileBrowserRef} bind:selectedPaths />

    {#if error}
      <p class="error-msg">{error}</p>
    {/if}
  </div>
</DialogShell>

<style>
  .footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
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

  .body-content {
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
    color: var(--status-error);
    font-family: var(--font-mono, monospace);
    margin: 0;
  }
</style>
