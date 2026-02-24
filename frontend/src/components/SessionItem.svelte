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
    onkill,
    onrename,
    onresumeYolo,
    ondelete,
  }: {
    variant: ItemVariant;
    gitStatus?: GitStatus | undefined;
    onclick: () => void;
    onkill?: () => void;
    onrename?: () => void;
    onresumeYolo?: () => void;
    ondelete?: () => void;
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

  let isLongpressActive = false;

  function handleClick() {
    if (isLongpressActive) return;
    onclick();
  }

  function longpressable(node: HTMLElement) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let deactivateTimer: ReturnType<typeof setTimeout> | null = null;

    const activate = () => {
      isLongpressActive = true;
      node.classList.add('longpress');
      node.dispatchEvent(new CustomEvent('longpressstart'));
    };

    const deactivate = () => {
      isLongpressActive = false;
      node.classList.remove('longpress');
      node.dispatchEvent(new CustomEvent('longpressend'));
    };

    const onTouchStart = () => {
      if (deactivateTimer) { clearTimeout(deactivateTimer); deactivateTimer = null; }
      timer = setTimeout(activate, 500);
    };

    const onTouchMove = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    const onTouchEnd = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (isLongpressActive) {
        deactivateTimer = setTimeout(deactivate, 3000);
      }
    };

    const onTouchCancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (isLongpressActive) deactivate();
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: true });
    node.addEventListener('touchend', onTouchEnd, { passive: true });
    node.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return {
      destroy() {
        if (timer) clearTimeout(timer);
        if (deactivateTimer) clearTimeout(deactivateTimer);
        node.removeEventListener('touchstart', onTouchStart);
        node.removeEventListener('touchmove', onTouchMove);
        node.removeEventListener('touchend', onTouchEnd);
        node.removeEventListener('touchcancel', onTouchCancel);
      }
    };
  }

  function handleKill(e: MouseEvent) {
    e.stopPropagation();
    onkill?.();
  }

  function handleRename(e: MouseEvent) {
    e.stopPropagation();
    onrename?.();
  }

  function handleResumeYolo(e: MouseEvent) {
    e.stopPropagation();
    onresumeYolo?.();
  }

  function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    ondelete?.();
  }

  function handleNewWorktree(e: MouseEvent) {
    e.stopPropagation();
    onclick();
  }

  function scrollOnHover(node: HTMLElement) {
    const textEl = node.firstElementChild as HTMLElement;
    const li = node.closest('li') as HTMLElement;
    if (!textEl || !li) return;

    let overflow = 0;

    const measure = () => {
      overflow = node.scrollWidth - node.clientWidth;
      if (overflow > 0) {
        node.classList.add('has-overflow');
      } else {
        node.classList.remove('has-overflow');
        textEl.style.transform = '';
        textEl.style.transition = '';
      }
    };

    const onEnter = () => {
      if (overflow <= 0) return;
      const duration = Math.max(0.6, overflow / 80);
      textEl.style.transition = `transform ${duration}s linear 0.3s`;
      textEl.style.transform = `translateX(-${overflow}px)`;
    };

    const onLeave = () => {
      if (overflow <= 0) return;
      const duration = Math.max(0.4, overflow / 100);
      textEl.style.transition = `transform ${duration}s linear`;
      textEl.style.transform = 'translateX(0)';
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);

    li.addEventListener('mouseenter', onEnter);
    li.addEventListener('mouseleave', onLeave);
    li.addEventListener('longpressstart', onEnter);
    li.addEventListener('longpressend', onLeave);

    return {
      destroy() {
        ro.disconnect();
        li.removeEventListener('mouseenter', onEnter);
        li.removeEventListener('mouseleave', onLeave);
        li.removeEventListener('longpressstart', onEnter);
        li.removeEventListener('longpressend', onLeave);
      }
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
  use:longpressable
>
  <div class="session-info">
    <div class="session-row-1">
      <span class={statusDotClass}></span>
      <span class="session-name" use:scrollOnHover>
        <span class="session-name-text">{displayName}</span>
      </span>
    </div>
    <div class="session-row-2">
      {#if prIcon}
        <span class={prIconClass}>{prIcon}</span>
      {/if}
      <span class="session-sub">{rootName}{repoName ? ' · ' + repoName : ''}</span>
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
  <div class="session-actions">
    {#if variant.kind === 'active'}
      {#if onrename}
        <button class="action-pill" aria-label="Rename session" onclick={handleRename}>✎</button>
      {/if}
      {#if onkill}
        <button class="action-pill action-pill--danger" aria-label="Kill session" onclick={handleKill}>×</button>
      {/if}
    {:else if variant.kind === 'inactive-worktree'}
      {#if onresumeYolo}
        <button class="action-pill action-pill--mono" aria-label="Resume in yolo mode" onclick={handleResumeYolo}>YOLO</button>
      {/if}
      {#if ondelete}
        <button class="action-pill action-pill--danger" aria-label="Delete worktree" onclick={handleDelete}>🗑</button>
      {/if}
    {:else if variant.kind === 'idle-repo'}
      <button class="action-pill action-pill--mono" aria-label="New worktree" onclick={handleNewWorktree}>+ worktree</button>
    {/if}
  </div>
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

  li.active-session:hover,
  li.active-session:global(.longpress) {
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

  li.inactive-worktree:hover,
  li.inactive-worktree:global(.longpress) {
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

  /* Row 1: dot + name */
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

  /* On hover/longpress: remove mask — JS handles the scroll */
  li:hover .session-name.has-overflow,
  li:global(.longpress) .session-name.has-overflow {
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

  li.active-session.selected:hover .session-name.has-overflow,
  li.active-session.selected:global(.longpress) .session-name.has-overflow {
    mask-image: none;
    -webkit-mask-image: none;
  }

  /* Pill action buttons */
  .action-pill {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: var(--text);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 2px 8px;
    border-radius: 12px;
    touch-action: manipulation;
    flex-shrink: 0;
    min-height: 24px;
    display: inline-flex;
    align-items: center;
    transition: background 0.15s, color 0.15s;
    line-height: 1;
  }

  .action-pill:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .action-pill--mono {
    font-family: monospace;
    font-size: 0.65rem;
    letter-spacing: 0.02em;
  }

  .action-pill--danger:hover {
    background: rgba(231, 76, 60, 0.15);
    color: #e74c3c;
  }

  /* Selected card overrides */
  li.active-session.selected .action-pill {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  li.active-session.selected .action-pill:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  li.active-session.selected .action-pill--danger:hover {
    background: rgba(231, 76, 60, 0.25);
    color: #fca5a5;
  }

  .session-actions {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s 0.1s, visibility 0.15s 0.1s;
  }

  li:hover .session-actions,
  li:focus-within .session-actions,
  li:global(.longpress) .session-actions {
    opacity: 1;
    visibility: visible;
  }

  /* Row 2: pr icon + root · repo */
  .session-row-2 {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-left: 16px;
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
</style>
