<script lang="ts">
  import { fetchJiraStatuses, fetchLinearStates } from '../lib/api.js';
  import type { JiraStatus, LinearState } from '../lib/types.js';

  let {
    provider,
    open = false,
    onClose,
    onSave,
    projectKey,
    teamId,
  }: {
    provider: 'jira' | 'linear';
    open: boolean;
    onClose: () => void;
    onSave: (mappings: Record<string, string>) => void;
    projectKey?: string;
    teamId?: string;
  } = $props();

  let statuses = $state<Array<{ id: string; name: string }>>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mappings = $state<Record<string, string>>({
    'in-progress': '',
    'code-review': '',
    'ready-for-qa': '',
  });

  $effect(() => {
    if (!open) return;

    loading = true;
    error = null;
    statuses = [];

    if (provider === 'jira') {
      const key = projectKey ?? '';
      if (!key) {
        error = 'Configure a Jira project key first (set integrations.jira.projectKey in config).';
        loading = false;
        return;
      }
      fetchJiraStatuses(key)
        .then((result: JiraStatus[]) => {
          statuses = result;
          loading = false;
        })
        .catch((err: unknown) => {
          error = err instanceof Error ? err.message : 'Failed to load Jira statuses';
          loading = false;
        });
    } else {
      const id = teamId ?? '';
      if (!id) {
        error = 'Configure a Linear team ID first (set integrations.linear.teamId in config).';
        loading = false;
        return;
      }
      fetchLinearStates(id)
        .then((result: LinearState[]) => {
          statuses = result;
          loading = false;
        })
        .catch((err: unknown) => {
          error = err instanceof Error ? err.message : 'Failed to load Linear states';
          loading = false;
        });
    }
  });

  function handleSave() {
    onSave({ ...mappings });
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  const providerLabel = $derived(provider === 'jira' ? 'Jira' : 'Linear');

  const fieldRows: Array<{ key: string; label: string }> = [
    { key: 'in-progress', label: 'In Progress' },
    { key: 'code-review', label: 'Code Review' },
    { key: 'ready-for-qa', label: 'Ready for QA' },
  ];
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onkeydown={handleKeydown} onclick={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <span class="modal-title">Map {providerLabel} Statuses</span>
        <button class="modal-close" onclick={onClose}>&times;</button>
      </div>

      <div class="modal-body">
        {#if loading}
          <div class="loading-msg">Loading statuses...</div>
        {:else if error}
          <div class="error-msg">{error}</div>
        {:else}
          {#each fieldRows as row (row.key)}
            <div class="field">
              <label class="field-label" for="mapping-{row.key}">{row.label}</label>
              <select
                id="mapping-{row.key}"
                class="field-select"
                bind:value={mappings[row.key]}
              >
                <option value="">Not mapped</option>
                {#each statuses as status (status.id)}
                  <option value={status.id}>{status.name}</option>
                {/each}
              </select>
            </div>
          {/each}
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={onClose}>Cancel</button>
        <button class="btn btn-primary" onclick={handleSave} disabled={loading}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    width: 90%;
    max-width: 420px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .modal-title {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text);
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .modal-close:hover {
    color: var(--text);
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .loading-msg {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text-muted);
    text-align: center;
    padding: 8px 0;
  }

  .error-msg {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--status-error);
    padding: 6px 8px;
    background: rgba(255, 100, 100, 0.1);
    border-radius: 4px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .field-select {
    padding: 8px 10px;
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    outline: none;
    cursor: pointer;
    transition: border-color 0.12s;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
  }

  .field-select:focus {
    border-color: var(--accent);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 7px 16px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: none;
    color: var(--text-muted);
  }

  .btn-secondary:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .btn-primary {
    background: var(--accent);
    color: #000;
    border-color: var(--accent);
    font-weight: 600;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
</style>
