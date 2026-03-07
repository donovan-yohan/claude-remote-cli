<script lang="ts">
  import type { SessionSummary, WorktreeInfo, RepoInfo, GitStatus } from '../lib/types.js';
  import type { MenuItem } from './ContextMenu.svelte';
  import { formatRelativeTime, rootShortName } from '../lib/utils.js';
  import { scrollOnHover } from '../lib/actions.js';
  import AgentBadge from './AgentBadge.svelte';
  import ContextMenu from './ContextMenu.svelte';

  type ActiveVariant = {
    kind: 'active';
    session: SessionSummary;
    status: 'running' | 'idle' | 'attention';
    isSelected: boolean;
  };
  type InactiveWorktreeVariant = { kind: 'inactive-worktree'; worktree: WorktreeInfo };
  type IdleRepoVariant = { kind: 'idle-repo'; repo: RepoInfo };
  type ItemVariant = ActiveVariant | InactiveWorktreeVariant | IdleRepoVariant;

  let {
    variant,
    gitStatus,
    isLoading = false,
    onclick,
    menuItems = [],
  }: {
    variant: ItemVariant;
    gitStatus?: GitStatus | undefined;
    isLoading?: boolean;
    onclick: () => void;
    menuItems?: MenuItem[];
  } = $props();

  let displayName = $derived.by(() => {
    switch (variant.kind) {
      case 'active': return variant.session.displayName || variant.session.repoName || variant.session.id;
      case 'inactive-worktree': return variant.worktree.displayName || variant.worktree.name;
      case 'idle-repo': return variant.repo.name;
    }
  });

  let rootName = $derived.by(() => {
    switch (variant.kind) {
      case 'active': return variant.session.root ? rootShortName(variant.session.root) : '';
      case 'inactive-worktree': return variant.worktree.root ? rootShortName(variant.worktree.root) : '';
      case 'idle-repo': return variant.repo.root ? rootShortName(variant.repo.root) : variant.repo.path;
    }
  });

  let repoName = $derived.by(() => {
    switch (variant.kind) {
      case 'active': return variant.session.repoName || '';
      case 'inactive-worktree': return variant.worktree.repoName || '';
      case 'idle-repo': return '';
    }
  });

  let lastActivity = $derived.by(() => {
    switch (variant.kind) {
      case 'active': return formatRelativeTime(variant.session.lastActivity);
      case 'inactive-worktree': return formatRelativeTime(variant.worktree.lastActivity);
      case 'idle-repo': return '';
    }
  });

  let statusDotClass = $derived(
    variant.kind === 'active'
      ? 'status-dot status-dot--' + variant.status
      : 'status-dot status-dot--inactive',
  );

  let isTerminal = $derived(variant.kind === 'active' && variant.session.type === 'terminal');
  let agentType = $derived(variant.kind === 'active' && !isTerminal ? variant.session.agent : undefined);

  let isSelected = $derived(variant.kind === 'active' && variant.isSelected);
  let isActive = $derived(variant.kind === 'active');

  let prIcon = $derived.by(() => {
    if (!gitStatus) return '';
    switch (gitStatus.prState) {
      case 'open': return '○';
      case 'merged': return '⬤';
      case 'closed': return '⊗';
      default: return '';
    }
  });

  let prIconClass = $derived.by(() => {
    if (!gitStatus) return '';
    switch (gitStatus.prState) {
      case 'open': return 'pr-icon pr-open';
      case 'merged': return 'pr-icon pr-merged';
      case 'closed': return 'pr-icon pr-closed';
      default: return '';
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li
  class:active-session={isActive}
  class:inactive-worktree={!isActive}
  class:selected={isSelected}
  class:loading={isLoading}
  onclick={onclick}
>
  <div class="session-info">
    <div class="session-row-1">
      <span class={statusDotClass}></span>
      <span class="session-name" use:scrollOnHover>
        <span class="session-name-text">{displayName}</span>
      </span>
    </div>
    <div class="session-row-2" class:has-badge={!!agentType || isTerminal}>
      {#if isTerminal}
        <span class="shell-badge">&gt;_</span>
      {:else if agentType}
        <AgentBadge agent={agentType} />
      {/if}
      {#if prIcon}
        <span class={prIconClass}>{prIcon}</span>
      {/if}
      {#if !isTerminal}
        <span class="session-sub">{rootName}{repoName ? ' · ' + repoName : ''}</span>
      {:else}
        <span class="session-sub">Shell</span>
      {/if}
    </div>
    {#if lastActivity || (gitStatus && (gitStatus.additions || gitStatus.deletions))}
      <div class="session-row-3">
        <span class="session-time">{lastActivity}</span>
        {#if gitStatus && (gitStatus.additions || gitStatus.deletions)}
          <span class="git-diff">
            {#if gitStatus.additions}<span class="diff-add">+{gitStatus.additions}</span>{/if}
            {#if gitStatus.deletions}<span class="diff-del">-{gitStatus.deletions}</span>{/if}
          </span>
        {/if}
      </div>
    {/if}
  </div>
  {#if menuItems.length > 0}
    <ContextMenu items={menuItems} />
  {/if}
</li>

<style>
  li {
    position: relative;
    display: flex;
    align-items: flex-start;
    padding: 8px 10px;
    cursor: pointer;
    border-radius: 6px;
    margin: 2px 6px;
    font-size: 0.8rem;
    color: var(--text-muted);
    touch-action: manipulation;
    transition: background 0.15s, border-color 0.15s;
  }

  li.active-session {
    background: var(--bg);
  }

  li.active-session:hover {
    background: var(--border);
  }

  li.active-session.selected {
    background: var(--accent);
    color: #fff;
  }

  li.active-session.selected .session-sub,
  li.active-session.selected .session-time {
    color: rgba(255, 255, 255, 0.7);
  }

  li.active-session.selected .session-name {
    color: #fff;
  }

  li.inactive-worktree {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    opacity: 0.7;
  }

  li.inactive-worktree:hover {
    opacity: 1;
    border-color: var(--accent);
  }

  li.loading {
    pointer-events: none;
    opacity: 0.5;
  }

  li.loading::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.04) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    li.loading::after {
      animation: none;
    }
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .session-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  /* Row 1: dot + name */
  .session-row-1 {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-right: 8px;
  }

  .status-dot--running { background: #4ade80; }
  .status-dot--idle { background: #60a5fa; }
  .status-dot--attention {
    background: #f59e0b;
    box-shadow: 0 0 6px 2px rgba(245, 158, 11, 0.5);
    animation: attention-glow 2s ease-in-out infinite;
  }
  .status-dot--inactive { background: #6b7280; }

  @keyframes attention-glow {
    0%, 100% { box-shadow: 0 0 4px 1px rgba(245, 158, 11, 0.3); }
    50% { box-shadow: 0 0 8px 3px rgba(245, 158, 11, 0.6); }
  }

  .session-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-weight: 500;
    color: var(--text);
  }

  .session-name-text {
    display: inline-block;
    white-space: nowrap;
    will-change: transform;
  }

  /* Fade mask only when text overflows */
  .session-name.has-overflow {
    mask-image: linear-gradient(to right, black calc(100% - 32px), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 32px), transparent);
  }

  /* On hover: remove mask — JS handles the scroll */
  li:hover .session-name.has-overflow {
    mask-image: none;
    -webkit-mask-image: none;
  }

  /* Selected state: use white mask for overflow fade */
  li.active-session.selected .session-name {
    color: #fff;
  }

  li.active-session.selected .session-name.has-overflow {
    mask-image: linear-gradient(to right, white calc(100% - 32px), transparent);
    -webkit-mask-image: linear-gradient(to right, white calc(100% - 32px), transparent);
  }

  li.active-session.selected:hover .session-name.has-overflow {
    mask-image: none;
    -webkit-mask-image: none;
  }

  /* Row 2: agent badge + pr icon + root + repo */
  .session-row-2 {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-left: 16px;
  }

  .session-row-2.has-badge {
    padding-left: 2px;
  }

  .shell-badge {
    font-size: 0.55rem;
    font-family: monospace;
    font-weight: 700;
    color: var(--text-muted);
    flex-shrink: 0;
    line-height: 1;
  }

  li.active-session.selected .shell-badge {
    color: rgba(255, 255, 255, 0.7);
  }

  .pr-icon {
    font-size: 0.65rem;
    flex-shrink: 0;
  }

  .pr-open { color: #4ade80; }
  .pr-merged { color: #a78bfa; }
  .pr-closed { color: #f87171; }

  .session-sub {
    font-size: 0.7rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Row 3: time + diff stats */
  .session-row-3 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding-left: 16px;
  }

  .session-time {
    font-size: 0.65rem;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .git-diff {
    display: flex;
    gap: 4px;
    font-size: 0.65rem;
    font-family: monospace;
  }

  .diff-add { color: #4ade80; }
  .diff-del { color: #f87171; }

  /* Context menu trigger styling when selected */
  li.active-session.selected :global(.context-menu-trigger) {
    color: rgba(255, 255, 255, 0.7);
  }

  li.active-session.selected :global(.context-menu-trigger:hover) {
    color: #fff;
    background: rgba(255, 255, 255, 0.15);
  }
</style>
