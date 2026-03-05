<script lang="ts">
  import { getSessionState } from '../../lib/state/sessions.svelte.js';
  import * as api from '../../lib/api.js';
  import { refreshPipelines } from '../../lib/state/pipelines.svelte.js';
  import type { RepoInfo } from '../../lib/types.js';

  let {
    onPipelineCreated,
  }: {
    onPipelineCreated: (id: string) => void;
  } = $props();

  const sessionState = getSessionState();

  let dialogEl: HTMLDialogElement;
  let input = $state('');
  let selectedRepo = $state('');
  let baseBranch = $state('main');
  let creating = $state(false);
  let errorMsg = $state('');

  export function open(repo?: RepoInfo) {
    input = '';
    errorMsg = '';
    creating = false;
    baseBranch = 'main';
    if (repo) {
      selectedRepo = repo.path;
    } else if (sessionState.repos.length > 0) {
      selectedRepo = sessionState.repos[0]!.path;
    }
    dialogEl.showModal();
  }

  export function close() {
    dialogEl.close();
  }

  async function handleSubmit() {
    if (!input.trim() || !selectedRepo) return;
    creating = true;
    errorMsg = '';
    try {
      const pipeline = await api.createPipeline({
        input: input.trim(),
        targetRepo: selectedRepo,
        baseBranch,
      });
      await refreshPipelines();
      dialogEl.close();
      onPipelineCreated(pipeline.id);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Failed to create pipeline';
    } finally {
      creating = false;
    }
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
    <h2 class="dialog-title">New Pipeline</h2>

    <div class="dialog-body">
      <div class="dialog-field">
        <label class="dialog-label" for="intake-input">Task description</label>
        <textarea
          id="intake-input"
          class="dialog-textarea"
          bind:value={input}
          rows="5"
          placeholder="Describe the task..."
        ></textarea>
      </div>

      <div class="dialog-field">
        <label class="dialog-label" for="intake-repo">Target repo</label>
        <select
          id="intake-repo"
          class="dialog-select"
          bind:value={selectedRepo}
        >
          {#each sessionState.repos as repo (repo.path)}
            <option value={repo.path}>{repo.name}</option>
          {/each}
        </select>
      </div>

      <div class="dialog-field">
        <label class="dialog-label" for="intake-branch">Base branch</label>
        <input
          id="intake-branch"
          type="text"
          class="dialog-input"
          bind:value={baseBranch}
          placeholder="main"
          autocomplete="off"
        />
      </div>

      {#if errorMsg}
        <p class="error">{errorMsg}</p>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-ghost" onclick={() => dialogEl.close()}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleSubmit}
        disabled={creating || !input.trim() || !selectedRepo}
      >
        {creating ? 'Creating...' : 'Start Pipeline'}
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
    width: min(480px, 95vw);
    max-height: 90vh;
    overflow: hidden;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.6);
  }

  .dialog-content {
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    overflow: hidden;
  }

  .dialog-title {
    font-size: 1.1rem;
    font-weight: 600;
    padding: 16px 20px 12px;
    margin: 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dialog-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .dialog-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .dialog-label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .dialog-select,
  .dialog-input,
  .dialog-textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
    padding: 7px 10px;
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
  }

  .dialog-textarea {
    resize: vertical;
  }

  .error {
    color: var(--red, #e74c3c);
    font-size: 0.85rem;
    margin: 0;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .btn {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 500;
    transition: opacity 0.15s;
  }

  .btn:disabled {
    opacity: 0.4;
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
