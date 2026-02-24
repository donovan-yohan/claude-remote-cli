<script lang="ts">
  import type { PullRequest } from '../lib/types.js';
  import { formatRelativeTime } from '../lib/utils.js';
  import { scrollOnHover, createLongpressClick } from '../lib/actions.js';

  let {
    pr,
    isActiveSession,
    isSelected = false,
    onclick,
    onYolo,
  }: {
    pr: PullRequest;
    isActiveSession: boolean;
    isSelected?: boolean;
    onclick: () => void;
    onYolo?: () => void;
  } = $props();

  let stateIcon = $derived.by(() => {
    switch (pr.state) {
      case 'OPEN': return '○';
      case 'MERGED': return '⬤';
      default: return '⊗';
    }
  });

  let stateClass = $derived.by(() => {
    switch (pr.state) {
      case 'OPEN': return 'pr-state pr-open';
      case 'MERGED': return 'pr-state pr-merged';
      default: return 'pr-state pr-closed';
    }
  });

  let roleBadge = $derived(pr.role === 'author' ? 'Author' : 'Reviewer');

  let reviewIcon = $derived.by(() => {
    switch (pr.reviewDecision) {
      case 'APPROVED': return '✓';
      case 'CHANGES_REQUESTED': return '✗';
      case 'REVIEW_REQUIRED': return '⏳';
      default: return '';
    }
  });

  let reviewClass = $derived.by(() => {
    switch (pr.reviewDecision) {
      case 'APPROVED': return 'review-approved';
      case 'CHANGES_REQUESTED': return 'review-changes';
      default: return 'review-pending';
    }
  });

  let relativeTime = $derived(formatRelativeTime(pr.updatedAt));

  const { action: longpressAction, handleClick } = createLongpressClick(() => onclick());

  function handleExternalClick(e: MouseEvent) {
    e.stopPropagation();
    window.open(pr.url, '_blank', 'noopener');
  }

  function handleYolo(e: MouseEvent) {
    e.stopPropagation();
    onYolo?.();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li
  class="pr-item"
  class:active-session={isActiveSession}
  class:selected={isSelected}
  onclick={handleClick}
  use:longpressAction
>
  <div class="pr-info">
    <div class="pr-row-1">
      <span class={stateClass}>{stateIcon}</span>
      <span class="pr-title" use:scrollOnHover>
        <span class="pr-title-text">{pr.title}</span>
      </span>
    </div>
    <div class="pr-row-2">
      <span class="pr-meta">#{pr.number} · {pr.author}</span>
      <span class="role-badge role-{pr.role}">{roleBadge}</span>
    </div>
    {#if relativeTime || pr.additions || pr.deletions}
      <div class="pr-row-3">
        <span class="pr-time">{relativeTime}</span>
        {#if pr.additions || pr.deletions}
          <span class="git-diff">
            {#if pr.additions}<span class="diff-add">+{pr.additions}</span>{/if}
            {#if pr.deletions}<span class="diff-del">-{pr.deletions}</span>{/if}
          </span>
        {/if}
      </div>
    {/if}
  </div>
  <div class="pr-actions">
    {#if reviewIcon}
      <span class="review-badge {reviewClass}" title={pr.reviewDecision ?? ''}>{reviewIcon}</span>
    {/if}
    {#if onYolo}
      <button class="action-pill action-pill--mono" aria-label="Start in yolo mode" onclick={handleYolo}>YOLO</button>
    {/if}
    <button class="external-link-btn" aria-label="Open in GitHub" onclick={handleExternalClick}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </button>
  </div>
</li>

<style>
  li.pr-item {
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
    background: transparent;
    border: 1px solid var(--border);
    opacity: 0.8;
  }

  li.pr-item:hover,
  li.pr-item:global(.longpress) {
    opacity: 1;
    border-color: var(--accent);
  }

  li.pr-item.active-session {
    background: var(--bg);
    border-color: var(--accent);
    opacity: 1;
  }

  li.pr-item.selected {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    opacity: 1;
  }

  li.pr-item.selected .pr-title {
    color: #fff;
  }

  li.pr-item.selected .pr-meta,
  li.pr-item.selected .pr-time {
    color: rgba(255, 255, 255, 0.7);
  }

  li.pr-item.selected .role-badge {
    background: rgba(255, 255, 255, 0.2);
    color: #fff;
  }

  .pr-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .pr-row-1 {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  :global(.pr-state) {
    font-size: 0.65rem;
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    margin-right: 4px;
  }

  :global(.pr-open) { color: #4ade80; }
  :global(.pr-merged) { color: #a78bfa; }
  :global(.pr-closed) { color: #f87171; }

  .pr-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-weight: 500;
    color: var(--text);
  }

  .pr-title-text {
    display: inline-block;
    white-space: nowrap;
    will-change: transform;
  }

  .pr-title.has-overflow {
    mask-image: linear-gradient(to right, black calc(100% - 32px), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 32px), transparent);
  }

  /* On hover/longpress: remove mask — JS handles the scroll */
  li:hover .pr-title.has-overflow,
  li:global(.longpress) .pr-title.has-overflow {
    mask-image: none;
    -webkit-mask-image: none;
  }

  .pr-actions {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s 0.1s, visibility 0.15s 0.1s;
  }

  li:hover .pr-actions,
  li:focus-within .pr-actions,
  li:global(.longpress) .pr-actions {
    opacity: 1;
    visibility: visible;
  }

  .action-pill {
    background: var(--border);
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
    background: #505050;
  }

  .action-pill--mono {
    font-family: monospace;
    font-size: 0.65rem;
    letter-spacing: 0.02em;
  }

  li.pr-item.selected .action-pill {
    background: #b35a3a;
    color: #fff;
  }

  li.pr-item.selected .action-pill:hover {
    background: #9a4d32;
  }

  .external-link-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    touch-action: manipulation;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    transition: color 0.15s, transform 0.15s;
  }

  .external-link-btn:hover {
    color: var(--accent);
    transform: scale(1.1);
  }

  li.pr-item.selected .external-link-btn {
    color: rgba(255, 255, 255, 0.7);
  }

  li.pr-item.selected .external-link-btn:hover {
    color: #fff;
  }

  .review-badge {
    font-size: 0.7rem;
    padding: 0 3px;
  }

  .review-approved { color: #4ade80; }
  .review-changes { color: #f87171; }
  .review-pending { color: #f59e0b; }

  .pr-row-2 {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-left: 20px;
  }

  .pr-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .role-badge {
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .role-author {
    background: rgba(96, 165, 250, 0.15);
    color: #60a5fa;
  }

  .role-reviewer {
    background: rgba(167, 139, 250, 0.15);
    color: #a78bfa;
  }

  .pr-row-3 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding-left: 20px;
  }

  .pr-time {
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
