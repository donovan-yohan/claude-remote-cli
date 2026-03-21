<script lang="ts">
  import { createRepoSession } from '../../lib/api.js';
  import { estimateTerminalDimensions } from '../../lib/utils.js';
  import { refreshAll } from '../../lib/state/sessions.svelte.js';
  import { getConfigState, refreshConfig } from '../../lib/state/config.svelte.js';
  import type { AgentType, Workspace } from '../../lib/types.js';

  let {
    onSessionCreated,
  }: {
    onSessionCreated?: (sessionId: string) => void;
  } = $props();

  const config = getConfigState();

  let dialogEl: HTMLDialogElement;

  // Workspace info
  let workspacePath = $state('');
  let workspaceName = $state('');

  // Form state
  let claudeArgsInput = $state('');
  let selectedAgent = $state<AgentType>('claude');
  let yoloMode = $state(false);
  let continueExisting = $state(false);
  let useTmux = $state(false);
  let creating = $state(false);

  function reset() {
    claudeArgsInput = '';
    yoloMode = false;
    continueExisting = false;
    useTmux = false;
  }

  export async function open(workspace: Pick<Workspace, 'name' | 'path'>) {
    reset();
    workspacePath = workspace.path;
    workspaceName = workspace.name;

    await refreshConfig();
    selectedAgent = config.defaultAgent as AgentType;
    yoloMode = config.defaultYolo;
    continueExisting = config.defaultContinue;
    useTmux = config.launchInTmux;

    dialogEl.showModal();
  }

  export function close() {
    dialogEl.close();
  }

  async function handleSubmit() {
    if (!workspacePath || creating) return;
    creating = true;

    const claudeArgs = claudeArgsInput.trim().split(/\s+/).filter(Boolean);
    const { cols, rows } = estimateTerminalDimensions();

    try {
      const session = await createRepoSession({
        repoPath: workspacePath,
        repoName: workspaceName || workspacePath.split('/').filter(Boolean).pop(),
        continue: continueExisting,
        yolo: yoloMode,
        claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
        agent: selectedAgent,
        useTmux,
        cols,
        rows,
      });
      dialogEl.close();
      await refreshAll();
      if (session?.id) {
        onSessionCreated?.(session.id);
      }
    } catch (err: unknown) {
      if (err instanceof Error && 'sessionId' in err) {
        const conflictErr = err as Error & { sessionId?: string };
        dialogEl.close();
        await refreshAll();
        if (conflictErr.sessionId) {
          onSessionCreated?.(conflictErr.sessionId);
        }
      }
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
    <h2 class="dialog-title">
      New Agent Session
      {#if workspaceName}
        <span class="dialog-title-repo">— {workspaceName}</span>
      {/if}
    </h2>

    <div class="dialog-body">
      <!-- Coding agent select -->
      <div class="dialog-field">
        <label class="dialog-label" for="cs-agent">Coding agent</label>
        <select
          id="cs-agent"
          class="dialog-select"
          data-track="dialog.customize-session.agent"
          bind:value={selectedAgent}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </div>

      <!-- Continue existing -->
      <div class="dialog-field dialog-field--inline">
        <input
          id="cs-continue"
          type="checkbox"
          class="dialog-checkbox"
          bind:checked={continueExisting}
        />
        <label for="cs-continue" class="dialog-label-inline">Continue existing session</label>
      </div>

      <!-- Yolo mode -->
      <div class="dialog-field dialog-field--inline">
        <input
          id="cs-yolo"
          type="checkbox"
          class="dialog-checkbox"
          bind:checked={yoloMode}
        />
        <label for="cs-yolo" class="dialog-label-inline">Yolo mode (skip permission checks)</label>
      </div>

      <!-- Launch in tmux -->
      <div class="dialog-field dialog-field--inline">
        <input
          id="cs-tmux"
          type="checkbox"
          class="dialog-checkbox"
          bind:checked={useTmux}
        />
        <label for="cs-tmux" class="dialog-label-inline">Launch in tmux</label>
      </div>

      <!-- Extra args -->
      <div class="dialog-field">
        <label class="dialog-label" for="cs-args">Extra args (optional)</label>
        <input
          id="cs-args"
          type="text"
          class="dialog-input"
          placeholder="e.g. --verbose"
          bind:value={claudeArgsInput}
          autocomplete="off"
        />
      </div>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-ghost" onclick={() => dialogEl.close()} disabled={creating}>Cancel</button>
      <button
        class="btn btn-primary"
        data-track="dialog.customize-session.create"
        onclick={handleSubmit}
        disabled={!workspacePath || creating}
      >
        {creating ? 'Creating...' : 'Start Session'}
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

  .dialog-title-repo {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 1rem;
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

  .dialog-field--inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .dialog-label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .dialog-label-inline {
    font-size: 0.9rem;
    cursor: pointer;
  }

  .dialog-select,
  .dialog-input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
    padding: 7px 10px;
    width: 100%;
    box-sizing: border-box;
  }

  .dialog-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dialog-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
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
