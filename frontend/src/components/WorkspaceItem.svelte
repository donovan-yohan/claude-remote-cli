<script lang="ts">
  import type { Workspace, SessionSummary, WorktreeInfo } from '../lib/types.js';
  import { getSessionState, getSessionStatus, refreshAll } from '../lib/state/sessions.svelte.js';
  import { createSession } from '../lib/api.js';
  import ContextMenu from './ContextMenu.svelte';
  import type { MenuItem } from './ContextMenu.svelte';

  const sessionState = getSessionState();

  let {
    workspace,
    sessions,
    inactiveWorktrees = [],
    isActive,
    onSelectWorkspace,
    onSelectSession,
    onNewWorktree,
    onNewSession,
    onNewTerminal,
    onOpenSettings,
    onDeleteSession,
    onDeleteWorktree,
  }: {
    workspace: Workspace;
    sessions: SessionSummary[];
    inactiveWorktrees?: WorktreeInfo[];
    isActive: boolean;
    onSelectWorkspace: (path: string) => void;
    onSelectSession: (id: string) => void;
    onNewWorktree: (workspace: Workspace) => void;
    onNewSession: (workspace: Workspace) => void;
    onNewTerminal: (workspace: Workspace) => void;
    onOpenSettings: (workspace: Workspace) => void;
    onDeleteSession?: (id: string) => void;
    onDeleteWorktree?: (wt: WorktreeInfo) => void;
  } = $props();

  // Derive a consistent color for the workspace letter initial
  const INITIAL_COLORS = [
    '#d97757', // accent/orange
    '#4ade80', // green
    '#60a5fa', // blue
    '#a78bfa', // purple
    '#f472b6', // pink
    '#fb923c', // amber-orange
    '#34d399', // teal
    '#f87171', // red
  ];

  function deriveColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    return INITIAL_COLORS[Math.abs(hash) % INITIAL_COLORS.length] ?? '#d97757';
  }

  let initialColor = $derived(deriveColor(workspace.name));
  let initial = $derived(workspace.name.charAt(0).toUpperCase());

  function statusLabel(session: SessionSummary): string {
    const st = getSessionStatus(session);
    if (st === 'attention') return 'attention';
    if (st === 'running') return 'running';
    return 'idle';
  }

  function statusDotClass(session: SessionSummary): string {
    const st = getSessionStatus(session);
    return 'status-dot status-dot--' + st;
  }

  function sessionDisplayName(session: SessionSummary): string {
    return session.displayName || session.branchName || session.repoName || session.id;
  }

  let hasAttention = $derived(sessions.some(s => getSessionStatus(s) === 'attention'));

  async function handleRename(session: SessionSummary) {
    const newName = prompt('Rename session:', sessionDisplayName(session));
    if (newName && newName.trim()) {
      await fetch(`/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newName.trim() }),
      });
      await refreshAll();
    }
  }

  function sessionMenuItems(session: SessionSummary): MenuItem[] {
    return [
      { label: 'Rename', action: () => handleRename(session) },
      { label: 'Kill', action: () => onDeleteSession?.(session.id), danger: true },
    ];
  }

  function worktreeMenuItems(wt: WorktreeInfo): MenuItem[] {
    return [
      {
        label: 'Resume',
        action: async () => {
          try {
            const session = await createSession({
              repoPath: workspace.path,
              repoName: workspace.name,
              worktreePath: wt.path,
              branchName: wt.branchName || wt.name,
            });
            await refreshAll();
            onSelectSession(session.id);
          } catch { /* silent */ }
        },
      },
      {
        label: 'Resume (YOLO)',
        action: async () => {
          try {
            const session = await createSession({
              repoPath: workspace.path,
              repoName: workspace.name,
              worktreePath: wt.path,
              branchName: wt.branchName || wt.name,
              yolo: true,
            });
            await refreshAll();
            onSelectSession(session.id);
          } catch { /* silent */ }
        },
      },
      {
        label: 'Delete Worktree',
        action: () => onDeleteWorktree?.(wt),
        danger: true,
      },
    ];
  }
</script>

<div class="workspace-item" class:active={isActive}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="workspace-header"
    class:attention={hasAttention}
    onclick={() => onSelectWorkspace(workspace.path)}
  >
    <div class="workspace-left">
      <span class="initial-block" style:background={initialColor}>{initial}</span>
      <span class="workspace-name">{workspace.name}</span>
    </div>
    <div class="workspace-actions">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="action-btn"
        title="New session"
        onclick={(e) => { e.stopPropagation(); onNewSession(workspace); }}
      >+</span>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="action-btn"
        title="New terminal"
        onclick={(e) => { e.stopPropagation(); onNewTerminal(workspace); }}
      >&gt;_</span>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="action-btn"
        title="Settings"
        onclick={(e) => { e.stopPropagation(); onOpenSettings(workspace); }}
      >⚙</span>
    </div>
  </div>

  {#if sessions.length > 0 || inactiveWorktrees.length > 0}
    <ul class="session-list">
      {#each sessions as session (session.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="session-row"
          class:terminal={session.type === 'terminal'}
          class:selected={sessionState.activeSessionId === session.id}
          class:attention={getSessionStatus(session) === 'attention'}
          onclick={() => onSelectSession(session.id)}
        >
          {#if session.type === 'terminal'}
            <span class="terminal-icon">&gt;_</span>
          {:else}
            <span class={statusDotClass(session)}></span>
          {/if}
          <span class="session-name" class:bold={getSessionStatus(session) === 'attention'}>{sessionDisplayName(session)}</span>
          <ContextMenu items={sessionMenuItems(session)} />
        </li>
      {/each}
      {#each inactiveWorktrees as wt (wt.path)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="session-row inactive"
          onclick={async () => {
            try {
              const session = await createSession({
                repoPath: workspace.path,
                repoName: workspace.name,
                worktreePath: wt.path,
                branchName: wt.branchName || wt.name,
              });
              await refreshAll();
              onSelectSession(session.id);
            } catch { /* silent */ }
          }}
        >
          <span class="dot dot-inactive"></span>
          <span class="session-name">{wt.branchName || wt.displayName || wt.name}</span>
          <ContextMenu items={worktreeMenuItems(wt)} />
        </li>
      {/each}
    </ul>
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="add-worktree-row" onclick={() => onNewWorktree(workspace)}>
    <span class="add-worktree-btn">+ new worktree</span>
  </div>

  <div class="workspace-divider"></div>
</div>

<style>
  .workspace-item {
    display: flex;
    flex-direction: column;
  }

  /* Header row */
  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    cursor: pointer;
    min-height: 44px;
    transition: background 0.12s;
  }

  .workspace-header:hover {
    background: var(--surface-hover);
  }

  .workspace-item.active .workspace-header {
    background: var(--surface-hover);
  }

  .workspace-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .initial-block {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    font-size: var(--font-size-xs);
    font-weight: 700;
    color: #000;
    font-family: var(--font-mono);
    flex-shrink: 0;
    line-height: 1;
  }

  .workspace-name {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* Quick-action buttons — only visible on hover */
  .workspace-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
    flex-shrink: 0;
  }

  .workspace-header:hover .workspace-actions {
    opacity: 1;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 3px;
    font-size: var(--font-size-xs);
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    transition: background 0.1s, color 0.1s;
  }

  .action-btn:hover {
    background: var(--border);
    color: var(--text);
  }

  /* Session list */
  .session-list {
    list-style: none;
  }

  .session-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 36px;
    cursor: pointer;
    min-height: 44px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    transition: background 0.1s;
  }

  .session-row {
    border-left: 3px solid transparent;
  }

  .session-row:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .session-row.selected {
    border-left-color: var(--accent);
    background: var(--surface-hover);
    color: var(--text);
  }

  .session-row.attention .session-name {
    font-weight: 700;
    color: var(--text);
  }

  /* Status dot */
  .status-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot--running { background: var(--status-success); }
  .status-dot--idle    { background: var(--status-info); }
  .dot-inactive        { width: 7px; height: 7px; border-radius: 50%; background: var(--border); flex-shrink: 0; }
  .session-row.inactive { opacity: 0.6; }
  .session-row.inactive:hover { opacity: 1; }
  .status-dot--attention {
    background: var(--status-warning);
    box-shadow: 0 0 5px 1px rgba(251, 191, 36, 0.45);
    animation: attention-glow 2s ease-in-out infinite;
  }

  @keyframes attention-glow {
    0%, 100% { box-shadow: 0 0 3px 1px rgba(251, 191, 36, 0.3); }
    50%       { box-shadow: 0 0 7px 2px rgba(251, 191, 36, 0.6); }
  }

  /* Terminal icon */
  .terminal-icon {
    font-size: 0.6rem;
    font-weight: 700;
    color: var(--text-muted);
    flex-shrink: 0;
    font-family: var(--font-mono);
    line-height: 1;
  }

  .session-name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .session-name.bold {
    font-weight: 700;
  }

  .session-status {
    font-size: 0.65rem;
    color: var(--text-muted);
    opacity: 0.6;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .session-row.terminal .session-status {
    display: none;
  }

  /* Add worktree row */
  .add-worktree-row {
    padding: 4px 10px 6px 36px;
  }

  .add-worktree-btn {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    opacity: 0.5;
    cursor: pointer;
    transition: opacity 0.1s, color 0.1s;
  }

  .add-worktree-btn:hover {
    opacity: 1;
    color: var(--text);
  }

  /* Solid divider */
  .workspace-divider {
    height: 1px;
    background: var(--border);
    margin: 0;
  }

  /* Mobile: ensure 44px touch targets */
  @media (max-width: 600px) {
    .workspace-header {
      min-height: 48px;
    }

    .session-row {
      min-height: 48px;
    }

    /* Always show actions on mobile (no hover) */
    .workspace-actions {
      opacity: 1;
    }
  }
</style>
