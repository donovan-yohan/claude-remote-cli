<script lang="ts">
  import type { Workspace, SessionSummary, WorktreeInfo } from '../lib/types.js';
  import { getSessionState, getSessionStatus, refreshAll, getSessionMetaById, setLoading, clearLoading, isItemLoading } from '../lib/state/sessions.svelte.js';
  import { toggleWorkspaceCollapse, isWorkspaceCollapsed, getTimeTick, getUi } from '../lib/state/ui.svelte.js';
  import { formatRelativeTimeCompact } from '../lib/utils.js';
  import { createSession } from '../lib/api.js';
  import ContextMenu from './ContextMenu.svelte';
  import type { MenuItem } from './ContextMenu.svelte';

  const sessionState = getSessionState();
  const ui = getUi();

  let {
    workspace,
    sessionGroups,
    inactiveWorktrees = [],
    isActive,
    onSelectWorkspace,
    onSelectSession,
    onNewWorktree,
    onOpenSettings,
    onDeleteSession,
    onDeleteWorktree,
  }: {
    workspace: Workspace;
    sessionGroups: Map<string, SessionSummary[]>;
    inactiveWorktrees?: WorktreeInfo[];
    isActive: boolean;
    onSelectWorkspace: (path: string) => void;
    onSelectSession: (id: string) => void;
    onNewWorktree: (workspace: Workspace) => void;
    onOpenSettings: (workspace: Workspace) => void;
    onDeleteSession?: (id: string) => void;
    onDeleteWorktree?: (wt: WorktreeInfo) => void;
  } = $props();

  // Flatten all sessions for attention detection
  let allSessions = $derived([...sessionGroups.values()].flat());

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
  let collapsed = $derived(isWorkspaceCollapsed(workspace.path));
  let totalItems = $derived(allSessions.length + inactiveWorktrees.length);

  function statusDotClass(session: SessionSummary): string {
    const st = getSessionStatus(session);
    return 'status-dot status-dot--' + st;
  }

  function sessionDisplayName(session: SessionSummary): string {
    return session.displayName || session.branchName || session.repoName || session.id;
  }

  let hasAttention = $derived(allSessions.some(s => getSessionStatus(s) === 'attention'));
  let creatingWorktree = $derived(isItemLoading(`new-worktree:${workspace.path}`));
  let inReorderMode = $derived(ui.reorderMode);

  // Force re-derive on time tick
  let _tick = $derived(getTimeTick());

  function sessionTime(session: SessionSummary): string {
    void _tick;
    return formatRelativeTimeCompact(session.lastActivity);
  }

  function worktreeTime(wt: WorktreeInfo): string {
    void _tick;
    return formatRelativeTimeCompact(wt.lastActivity);
  }

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
          if (isItemLoading(wt.path)) return;
          setLoading(wt.path);
          try {
            const session = await createSession({
              repoPath: workspace.path,
              repoName: workspace.name,
              worktreePath: wt.path,
              branchName: wt.branchName || wt.name,
            });
            await refreshAll();
            onSelectSession(session.id);
          } catch { /* silent */ } finally {
            clearLoading(wt.path);
          }
        },
      },
      {
        label: 'Resume (YOLO)',
        action: async () => {
          if (isItemLoading(wt.path)) return;
          setLoading(wt.path);
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
          } catch { /* silent */ } finally {
            clearLoading(wt.path);
          }
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
    class:reorder-mode={inReorderMode}
    onclick={() => { if (!inReorderMode) onSelectWorkspace(workspace.path); }}
  >
    <div class="workspace-left">
      {#if inReorderMode}
        <span class="grip-handle grip-visible">⠿</span>
      {:else}
        <span class="grip-handle">⠿</span>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="collapse-chevron"
          class:collapsed
          onclick={(e) => { e.stopPropagation(); toggleWorkspaceCollapse(workspace.path); }}
        >{collapsed ? '›' : '⌄'}</span>
      {/if}
      <span class="initial-block" style:background={initialColor}>{initial}</span>
      <span class="workspace-name">{workspace.name}</span>
      {#if collapsed && totalItems > 0 && !inReorderMode}
        <span class="collapse-count">{totalItems}</span>
      {/if}
    </div>
    {#if !inReorderMode}
      <div class="workspace-actions">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="action-btn"
          title="Settings"
          onclick={(e) => { e.stopPropagation(); onOpenSettings(workspace); }}
        >⚙</span>
      </div>
    {/if}
  </div>

  {#if !collapsed && !inReorderMode && (allSessions.length > 0 || inactiveWorktrees.length > 0)}
    <ul class="session-list">
      {#each [...sessionGroups.entries()] as [groupPath, groupSessions] (groupPath)}
        {@const representative = groupSessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))[0]}
        {@const sessionCount = groupSessions.length}
        {@const isRepoRoot = groupPath === workspace.path}
        {@const hasActiveSessions = sessionCount > 0}
        {@const groupHasAttention = groupSessions.some(s => getSessionStatus(s) === 'attention')}
        {#if hasActiveSessions && representative}
          {@const meta = getSessionMetaById(representative.id)}
          {@const hasDiff = meta && (meta.additions > 0 || meta.deletions > 0)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="session-row"
            class:terminal={representative.type === 'terminal'}
            class:selected={groupSessions.some(s => sessionState.activeSessionId === s.id)}
            class:attention={groupHasAttention}
            onclick={() => onSelectSession(representative.id)}
          >
            <div class="session-row-primary">
              {#if representative.type === 'terminal'}
                <span class="terminal-icon">&gt;_</span>
              {:else}
                <span class={statusDotClass(representative)}></span>
              {/if}
              <span class="session-name" class:bold={groupHasAttention}>{sessionDisplayName(representative)}</span>
              {#if sessionCount > 1}
                <span class="session-count-badge">{sessionCount}</span>
              {/if}
              {#if hasDiff}
                <span class="diff-badge">
                  <span class="diff-add">+{meta.additions}</span>
                  <span class="diff-del">-{meta.deletions}</span>
                </span>
              {/if}
            </div>
            <div class="session-row-secondary">
              {#if representative.worktreeName && representative.worktreeName !== sessionDisplayName(representative)}
                <span class="secondary-worktree">{representative.worktreeName}</span>
              {/if}
              {#if meta?.prNumber}
                <span class="secondary-pr">PR #{meta.prNumber}</span>
              {/if}
              <span class="secondary-time">{sessionTime(representative)}</span>
              <ContextMenu items={sessionMenuItems(representative)} />
            </div>
          </li>
        {:else if isRepoRoot}
          <!-- Persistent repo root entry — always shown even with no active sessions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          {@const repoLoadingKey = `repo-session:${workspace.path}`}
          <li
            class="session-row inactive"
            class:loading={isItemLoading(repoLoadingKey)}
            onclick={async () => {
              if (isItemLoading(repoLoadingKey)) return;
              setLoading(repoLoadingKey);
              try {
                const session = await createSession({
                  repoPath: workspace.path,
                  repoName: workspace.name,
                });
                await refreshAll();
                onSelectSession(session.id);
              } catch { /* silent */ } finally {
                clearLoading(repoLoadingKey);
              }
            }}
          >
            <div class="session-row-primary">
              <span class="dot dot-inactive"></span>
              <span class="session-name">{isItemLoading(repoLoadingKey) ? 'starting...' : workspace.name}</span>
            </div>
          </li>
        {/if}
      {/each}
      {#each inactiveWorktrees as wt (wt.path)}
        {@const meta = getSessionMetaById(wt.path)}
        {@const hasDiff = meta && (meta.additions > 0 || meta.deletions > 0)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="session-row inactive"
          class:loading={isItemLoading(wt.path)}
          onclick={async () => {
            if (isItemLoading(wt.path)) return;
            setLoading(wt.path);
            try {
              const session = await createSession({
                repoPath: workspace.path,
                repoName: workspace.name,
                worktreePath: wt.path,
                branchName: wt.branchName || wt.name,
              });
              await refreshAll();
              onSelectSession(session.id);
            } catch { /* silent */ } finally {
              clearLoading(wt.path);
            }
          }}
        >
          <div class="session-row-primary">
            <span class="dot dot-inactive"></span>
            <span class="session-name">{isItemLoading(wt.path) ? 'resuming...' : wt.branchName || wt.displayName || wt.name}</span>
            {#if hasDiff}
              <span class="diff-badge">
                <span class="diff-add">+{meta.additions}</span>
                <span class="diff-del">-{meta.deletions}</span>
              </span>
            {/if}
          </div>
          <div class="session-row-secondary">
            {#if meta?.prNumber}
              <span class="secondary-pr">PR #{meta.prNumber}</span>
            {/if}
            <span class="secondary-time">{worktreeTime(wt)}</span>
            <ContextMenu items={worktreeMenuItems(wt)} />
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !collapsed && !inReorderMode}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="add-worktree-row" class:disabled={creatingWorktree} onclick={() => { if (!creatingWorktree) onNewWorktree(workspace); }}>
      <span class="add-worktree-btn">{creatingWorktree ? 'creating...' : '+ new worktree'}</span>
    </div>
  {/if}

  {#if !inReorderMode}
    <div class="workspace-divider"></div>
  {/if}
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

  /* Grip handle for drag reorder */
  .grip-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    font-size: 0.8rem;
    color: var(--text-muted);
    cursor: grab;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
    user-select: none;
  }

  .workspace-header:hover .grip-handle {
    opacity: 1;
  }

  .grip-handle.grip-visible {
    opacity: 1;
  }

  .workspace-header.reorder-mode {
    cursor: grab;
  }

  .workspace-header.reorder-mode:active {
    cursor: grabbing;
  }

  .collapse-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    font-size: 0.7rem;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.12s;
  }

  .collapse-chevron:hover {
    color: var(--text);
  }

  .collapse-count {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    background: var(--border);
    border-radius: 8px;
    padding: 1px 6px;
    flex-shrink: 0;
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
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px 6px 36px;
    cursor: pointer;
    min-height: 44px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    transition: background 0.1s;
    border-left: 3px solid transparent;
    justify-content: center;
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

  /* Two-line row layout */
  .session-row-primary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .session-row-secondary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 15px;
    font-size: 0.65rem;
    color: var(--text-muted);
    opacity: 0.7;
    min-width: 0;
  }

  .secondary-worktree {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  .secondary-pr {
    white-space: nowrap;
    flex-shrink: 0;
    color: var(--accent);
  }

  .secondary-time {
    white-space: nowrap;
    flex-shrink: 0;
    opacity: 0.7;
  }

  /* Session count badge */
  .session-count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    border-radius: 8px;
    background: var(--border);
    color: var(--text-muted);
    font-size: 0.55rem;
    font-family: var(--font-mono);
    font-weight: 600;
    padding: 0 4px;
    flex-shrink: 0;
  }

  /* Diff badge */
  .diff-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.6rem;
    flex-shrink: 0;
    margin-left: auto;
  }

  .diff-add { color: var(--status-success); }
  .diff-del { color: var(--status-error); }

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
  .dot-inactive        { width: 7px; height: 7px; border-radius: 50%; background: #555; flex-shrink: 0; }
  .session-row.inactive .session-name { color: var(--text-muted); }
  .session-row.inactive:hover .session-name { color: var(--text); }
  .session-row.loading { pointer-events: none; opacity: 0.7; }
  .session-row.loading .session-name { color: var(--accent); }
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

  .add-worktree-row.disabled {
    pointer-events: none;
  }

  .add-worktree-row.disabled .add-worktree-btn {
    opacity: 0.7;
    color: var(--accent);
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

    /* Always show grip in reorder mode on mobile */
    .grip-handle.grip-visible {
      opacity: 1;
    }
  }
</style>
