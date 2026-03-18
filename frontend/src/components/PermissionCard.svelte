<script lang="ts">
  import type { PermissionRequest } from '../lib/types.js';

  let {
    permission,
    onApprove,
    onDeny,
  }: {
    permission: PermissionRequest;
    onApprove: (requestId: string) => void;
    onDeny: (requestId: string) => void;
  } = $props();

  let toolDescription = $derived(() => {
    const input = permission.input;
    if (permission.toolName === 'Edit' || permission.toolName === 'Write') {
      const path = input['file_path'] ?? input['path'] ?? '';
      return permission.toolName + ': ' + String(path);
    }
    if (permission.toolName === 'Bash' || permission.toolName === 'Run') {
      const cmd = input['command'] ?? input['cmd'] ?? '';
      return 'Run: ' + String(cmd);
    }
    return permission.toolName;
  });
</script>

<div class="permission-card" class:resolved={permission.status !== 'pending'}>
  <div class="permission-header">
    <span class="permission-tool">{toolDescription()}</span>
  </div>

  {#if permission.status === 'pending'}
    <div class="permission-actions">
      <button
        class="approve-btn"
        onclick={() => onApprove(permission.id)}
        aria-label="Approve: {toolDescription()}"
      >
        Approve
      </button>
      <button
        class="deny-btn"
        onclick={() => onDeny(permission.id)}
        aria-label="Deny: {toolDescription()}"
      >
        Deny
      </button>
    </div>
  {:else if permission.status === 'approved'}
    <div class="permission-badge badge-approved">Approved &#10003;</div>
  {:else if permission.status === 'denied'}
    <div class="permission-badge badge-denied">Denied &#10007;</div>
  {:else if permission.status === 'timed_out'}
    <div class="permission-badge badge-timeout">Timed out</div>
  {/if}
</div>

<style>
  .permission-card {
    border-left: 3px solid var(--accent);
    background: var(--card-bg);
    border-radius: var(--radius-sm);
    padding: var(--spacing-md);
    position: sticky;
    bottom: 0;
    z-index: 10;
    width: 100%;
  }

  .permission-card.resolved {
    opacity: 0.7;
  }

  .permission-header {
    margin-bottom: var(--spacing-sm);
  }

  .permission-tool {
    font-family: var(--code-font);
    font-size: 0.88rem;
    color: var(--text);
    word-break: break-all;
  }

  .permission-actions {
    display: flex;
    gap: var(--spacing-sm);
  }

  .approve-btn, .deny-btn {
    flex: 1;
    height: 48px;
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .approve-btn {
    background: var(--success);
    color: #fff;
  }

  .approve-btn:hover {
    opacity: 0.9;
  }

  .deny-btn {
    background: none;
    border: 1px solid var(--error);
    color: var(--error);
  }

  .deny-btn:hover {
    background: var(--error);
    color: #fff;
  }

  .permission-badge {
    font-size: 0.85rem;
    font-weight: 600;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    display: inline-block;
  }

  .badge-approved {
    color: var(--success);
  }

  .badge-denied {
    color: var(--error);
  }

  .badge-timeout {
    color: var(--text-muted);
  }
</style>
