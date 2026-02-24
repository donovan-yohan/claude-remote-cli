<script lang="ts">
  import type { SessionSummary, WorktreeInfo, RepoInfo, GitStatus } from '../lib/types.js';
  import { formatRelativeTime, rootShortName } from '../lib/utils.js';

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
    onclick,
    oncontextmenu,
    onkill,
    onrename,
  }: {
    variant: ItemVariant;
    gitStatus?: GitStatus;
    onclick: () => void;
    oncontextmenu?: (e: MouseEvent) => void;
    onkill?: () => void;
    onrename?: () => void;
  } = $props();

  let displayName = $derived(
    variant.kind === 'active'
      ? (variant.session.displayName || variant.session.repoName || variant.session.id)
      : variant.kind === 'inactive-worktree'
        ? (variant.worktree.displayName || variant.worktree.name)
        : variant.repo.name,
  );

  let rootName = $derived(
    variant.kind === 'active'
      ? (variant.session.root ? rootShortName(variant.session.root) : '')
      : variant.kind === 'inactive-worktree'
        ? (variant.worktree.root ? rootShortName(variant.worktree.root) : '')
        : (variant.repo.root ? rootShortName(variant.repo.root) : variant.repo.path),
  );

  let repoName = $derived(
    variant.kind === 'active'
      ? (variant.session.repoName || '')
      : variant.kind === 'inactive-worktree'
        ? (variant.worktree.repoName || '')
        : '',
  );

  let lastActivity = $derived(
    variant.kind === 'active'
      ? formatRelativeTime(variant.session.lastActivity)
      : variant.kind === 'inactive-worktree'
        ? formatRelativeTime(variant.worktree.lastActivity)
        : '',
  );

  let statusDotClass = $derived(
    variant.kind === 'active'
      ? 'status-dot status-dot--' + variant.status
      : 'status-dot status-dot--inactive',
  );

  let isSelected = $derived(variant.kind === 'active' && variant.isSelected);
  let isActive = $derived(variant.kind === 'active');

  let prIcon = $derived(
    !gitStatus ? '' :
    gitStatus.prState === 'open' ? '○' :
    gitStatus.prState === 'merged' ? '⬤' :
    gitStatus.prState === 'closed' ? '⊗' : '',
  );

  let prIconClass = $derived(
    !gitStatus ? '' :
    gitStatus.prState === 'open' ? 'pr-icon pr-open' :
    gitStatus.prState === 'merged' ? 'pr-icon pr-merged' :
    gitStatus.prState === 'closed' ? 'pr-icon pr-closed' : '',
  );

  function handleClick() {
    onclick();
  }

  function handleContextMenu(e: MouseEvent) {
    if (oncontextmenu) {
      e.preventDefault();
      e.stopPropagation();
      oncontextmenu(e);
    }
  }

  function handleKill(e: MouseEvent) {
    e.stopPropagation();
    onkill?.();
  }

  function handleRename(e: MouseEvent) {
    e.stopPropagation();
    onrename?.();
  }

  function measureOverflow(node: HTMLElement) {
    const update = () => {
      const overflow = node.scrollWidth - node.clientWidth;
      if (overflow > 0) {
        node.style.setProperty('--scroll-distance', `-${overflow}px`);
        node.classList.add('has-overflow');
      } else {
        node.classList.remove('has-overflow');
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);

    return {
      destroy() { ro.disconnect(); }
    };
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li
  class:active-session={isActive}
  class:inactive-worktree={!isActive}
  class:selected={isSelected}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
>
  <div class="session-info">
    <div class="session-row-1">
      <span class={statusDotClass}></span>
      <span class="session-name" use:measureOverflow>{displayName}</span>
      {#if isActive}
        <div class="session-actions">
          {#if onrename}
            <button class="session-rename-btn" aria-label="Rename session" onclick={handleRename}>✎</button>
          {/if}
          {#if onkill}
            <button class="session-kill" aria-label="Kill session" onclick={handleKill}>×</button>
          {/if}
        </div>
      {/if}
    </div>
    <div class="session-row-2">
      {#if prIcon}
        <span class={prIconClass}>{prIcon}</span>
      {:else}
        <span class="row-2-spacer"></span>
      {/if}
      <span class="session-sub">{rootName}{repoName ? ' · ' + repoName : ''}</span>
    </div>
    {#if lastActivity || (gitStatus && (gitStatus.additions || gitStatus.deletions))}
      <div class="session-row-3">
        <span class="row-3-spacer"></span>
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
</li>

<style>
  li {
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

  .session-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  /* Row 1: dot + name + actions */
  .session-row-1 {
    display: flex;
    align-items: center;
    gap: 0;
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

  /* Fade mask only when text overflows */
  .session-name.has-overflow {
    mask-image: linear-gradient(to right, black calc(100% - 32px), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 32px), transparent);
  }

  /* On hover: remove mask and animate text scroll to reveal full name */
  li:hover .session-name.has-overflow {
    mask-image: none;
    -webkit-mask-image: none;
    animation: text-scroll 4s linear 0.5s forwards;
  }

  @keyframes text-scroll {
    0%, 5% { transform: translateX(0); }
    45%, 55% { transform: translateX(var(--scroll-distance)); }
    95%, 100% { transform: translateX(0); }
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

  .session-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s 0.1s; /* 100ms delay to avoid flash on quick passes */
  }

  li:hover .session-actions {
    opacity: 1;
  }

  /* Mobile: always show actions on touch devices */
  @media (hover: none) {
    .session-actions {
      opacity: 1;
    }
  }

  .session-rename-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    touch-action: manipulation;
    flex-shrink: 0;
    transition: color 0.15s, transform 0.15s;
  }

  .session-rename-btn:hover {
    color: var(--accent);
    transform: scale(1.1);
  }

  .session-kill {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    touch-action: manipulation;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s, transform 0.15s;
  }

  .session-kill:hover,
  .session-kill:active {
    color: var(--accent);
    background: rgba(217, 119, 87, 0.15);
    transform: scale(1.1);
  }

  /* Row 2: pr icon + root · repo */
  .session-row-2 {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-left: 0;
  }

  .row-2-spacer {
    display: inline-block;
    width: 16px; /* aligns with name: dot 8px + margin 8px */
    flex-shrink: 0;
  }

  .pr-icon {
    font-size: 0.65rem;
    flex-shrink: 0;
    width: 16px;
    text-align: center;
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
  }

  .row-3-spacer {
    display: inline-block;
    width: 16px;
    flex-shrink: 0;
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
</style>
