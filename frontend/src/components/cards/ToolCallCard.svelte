<script lang="ts">
  let {
    toolName,
    toolInput,
    status,
  }: {
    toolName: string;
    toolInput?: Record<string, unknown> | undefined;
    status?: string | undefined;
  } = $props();

  let expanded = $state(false);

  function statusClass(s: string | undefined): string {
    if (!s) return '';
    if (s === 'success' || s === 'completed') return 'status-success';
    if (s === 'error' || s === 'failed') return 'status-error';
    if (s === 'running' || s === 'pending') return 'status-pending';
    return '';
  }
</script>

<div class="tool-call-card">
  <button class="tool-header" onclick={() => expanded = !expanded}>
    <span class="tool-name">{toolName}</span>
    {#if status}
      <span class="tool-status {statusClass(status)}">{status}</span>
    {/if}
    <span class="toggle-icon">{expanded ? '\u25B2' : '\u25BC'}</span>
  </button>
  {#if expanded && toolInput}
    <pre class="tool-input">{JSON.stringify(toolInput, null, 2)}</pre>
  {/if}
</div>

<style>
  .tool-call-card {
    background: var(--card-bg);
    border-radius: var(--radius-sm);
    margin: var(--spacing-xs) 0;
    overflow: hidden;
    width: 100%;
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    width: 100%;
    min-height: 44px;
    padding: var(--spacing-sm) var(--spacing-md);
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    font-size: 0.85rem;
    text-align: left;
  }

  .tool-name {
    font-family: var(--code-font);
    font-weight: 600;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-status {
    flex-shrink: 0;
    font-size: 0.75rem;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    text-transform: uppercase;
  }

  .status-success {
    background: var(--success);
    color: #fff;
  }

  .status-error {
    background: var(--error);
    color: #fff;
  }

  .status-pending {
    background: var(--warning);
    color: #000;
  }

  .toggle-icon {
    flex-shrink: 0;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .tool-input {
    padding: var(--spacing-sm) var(--spacing-md);
    background: var(--bg);
    font-family: var(--code-font);
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
    border-top: 1px solid var(--border);
  }
</style>
