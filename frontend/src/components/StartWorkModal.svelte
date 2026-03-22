<script lang="ts">
  import type { GitHubIssue } from '../lib/types.js';
  import { createSession, ConflictError } from '../lib/api.js';

  let {
    issue,
    open = false,
    onClose,
    onSessionCreated,
  }: {
    issue: GitHubIssue;
    open: boolean;
    onClose: () => void;
    onSessionCreated: (sessionId: string) => void;
  } = $props();

  let branchName = $state(`gh-${issue.number}`);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function handleStart() {
    if (loading) return;
    loading = true;
    error = null;

    try {
      // POST /sessions with branchName — server handles worktree creation
      // and existing-branch redirect internally (409 conflict).
      const session = await createSession({
        repoPath: issue.repoPath,
        repoName: issue.repoName,
        branchName,
        ticketContext: {
          ticketId: `GH-${issue.number}`,
          title: issue.title,
          url: issue.url,
          source: 'github',
          repoPath: issue.repoPath,
          repoName: issue.repoName,
        },
      });

      onSessionCreated(session.id);
      onClose();
    } catch (err) {
      if (err instanceof ConflictError) {
        // Branch already exists with an active session — open it directly
        onSessionCreated(err.sessionId);
        onClose();
        return;
      }
      error = err instanceof Error ? err.message : 'Failed to start work';
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && !loading) handleStart();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onkeydown={handleKeydown} onclick={onClose}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <span class="modal-title">Start Work</span>
        <button class="modal-close" onclick={onClose}>&times;</button>
      </div>

      <div class="modal-body">
        <div class="ticket-info">
          <span class="ticket-info-label">Ticket</span>
          <span class="ticket-info-value">#{issue.number} — {issue.title}</span>
        </div>

        <div class="ticket-info">
          <span class="ticket-info-label">Repo</span>
          <span class="ticket-info-value">{issue.repoName}</span>
        </div>

        <div class="field">
          <label class="field-label" for="branch-name">Branch Name</label>
          <input
            id="branch-name"
            class="field-input"
            type="text"
            bind:value={branchName}
            placeholder="gh-{issue.number}"
          />
        </div>

        {#if error}
          <div class="error-msg">{error}</div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={onClose} disabled={loading}>Cancel</button>
        <button class="btn btn-primary" onclick={handleStart} disabled={loading}>
          {#if loading}Starting...{:else}Start Work{/if}
        </button>
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

  .ticket-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ticket-info-label {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .ticket-info-value {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text);
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

  .field-input {
    padding: 8px 10px;
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    outline: none;
    transition: border-color 0.12s;
  }

  .field-input:focus {
    border-color: var(--accent);
  }

  .error-msg {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--status-error);
    padding: 6px 8px;
    background: rgba(255, 100, 100, 0.1);
    border-radius: 4px;
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
