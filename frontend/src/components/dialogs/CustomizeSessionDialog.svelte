<script lang="ts">
  import { createSession } from '../../lib/api.js';
  import { estimateTerminalDimensions } from '../../lib/utils.js';
  import { refreshAll } from '../../lib/state/sessions.svelte.js';
  import { getConfigState, refreshConfig } from '../../lib/state/config.svelte.js';
  import type { AgentType, Workspace } from '../../lib/types.js';
  import DialogShell from './DialogShell.svelte';

  let {
    onSessionCreated,
  }: {
    onSessionCreated?: (sessionId: string) => void;
  } = $props();

  const config = getConfigState();

  let shellRef = $state<DialogShell | undefined>(undefined);

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

    shellRef?.open();
  }

  export function close() {
    shellRef?.close();
  }

  async function handleSubmit() {
    if (!workspacePath || creating) return;
    creating = true;

    const claudeArgs = claudeArgsInput.trim().split(/\s+/).filter(Boolean);
    const { cols, rows } = estimateTerminalDimensions();

    try {
      const session = await createSession({
        workspacePath,
        worktreePath: null,
        type: 'agent',
        continue: continueExisting,
        yolo: yoloMode,
        claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
        agent: selectedAgent,
        useTmux,
        cols,
        rows,
      });
      shellRef?.close();
      await refreshAll();
      if (session?.id) {
        onSessionCreated?.(session.id);
      }
    } catch (err: unknown) {
      if (err instanceof Error && 'sessionId' in err) {
        const conflictErr = err as Error & { sessionId?: string };
        shellRef?.close();
        await refreshAll();
        if (conflictErr.sessionId) {
          onSessionCreated?.(conflictErr.sessionId);
        }
      }
    } finally {
      creating = false;
    }
  }
</script>

<DialogShell
  bind:this={shellRef}
  width="480px"
  title="Customize Session"
>
  {#snippet footer()}
    <div class="footer-row">
      <button class="btn btn-ghost" onclick={() => shellRef?.close()} disabled={creating}>Cancel</button>
      <button
        class="btn btn-primary"
        data-track="dialog.customize-session.create"
        onclick={handleSubmit}
        disabled={!workspacePath || creating}
      >
        {creating ? 'Creating...' : 'Start Session'}
      </button>
    </div>
  {/snippet}

  <div class="body-fields">
    {#if workspaceName}
      <p class="workspace-name">— {workspaceName}</p>
    {/if}

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
</DialogShell>

<style>
  .footer-row {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .workspace-name {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 0.95rem;
    margin: 0 0 4px;
  }

  .body-fields {
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
    border-radius: 0;
    color: var(--text);
    font-size: 0.9rem;
    font-family: var(--font-mono);
    padding: 7px 10px;
    width: 100%;
    box-sizing: border-box;
  }

  .dialog-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
