<script lang="ts">
  import type { GitHubIssue, BranchLink } from '../lib/types.js';

  let { issue, branchLinks = [], onStartWork }: {
    issue: GitHubIssue;
    branchLinks?: BranchLink[];
    onStartWork?: (issue: GitHubIssue) => void;
  } = $props();

  const INITIAL_COLORS = [
    '#d97757',
    '#4ade80',
    '#60a5fa',
    '#a78bfa',
    '#f472b6',
    '#fb923c',
    '#34d399',
    '#f87171',
  ];

  function deriveColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    return INITIAL_COLORS[Math.abs(hash) % INITIAL_COLORS.length] ?? '#d97757';
  }

  let chipColor = $derived(deriveColor(issue.repoName));
  let visibleLabels = $derived(issue.labels.slice(0, 3));
  let linkedBranch = $derived(branchLinks.length > 0 ? branchLinks[0] : null);
  let hasActiveSession = $derived(linkedBranch?.hasActiveSession ?? false);
</script>

<div class="ticket-card">
  <div class="ticket-left">
    <div class="ticket-title-line">
      <span class="dot {issue.state === 'OPEN' ? 'dot-success' : 'dot-muted'}"></span>
      <a class="ticket-title-link" href={issue.url} target="_blank" rel="noopener noreferrer">
        {issue.title}
      </a>
    </div>
    <div class="ticket-meta">
      <span
        class="repo-chip"
        style:background={chipColor}
        title={issue.repoPath ?? issue.repoName}
      >{issue.repoName}</span>
      <span class="ticket-sep">·</span>
      <span class="ticket-number">#{issue.number}</span>
      {#each visibleLabels as label (label.name)}
        <span class="label-chip" style:background={'#' + label.color} title={label.name}>
          {label.name}
        </span>
      {/each}
      {#if linkedBranch}
        <span class="ticket-sep">·</span>
        <span class="branch-chip">
          {#if hasActiveSession}
            <span class="dot dot-active dot-inline"></span>
          {/if}
          {linkedBranch.branchName}
        </span>
      {/if}
    </div>
  </div>
  <div class="ticket-actions">
    <button
      class="start-work-btn"
      class:start-work-btn--active={!!onStartWork}
      onclick={() => onStartWork?.(issue)}
      disabled={!onStartWork}
    >
      Start Work
    </button>
  </div>
</div>

<style>
  .ticket-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    transition: background 0.1s;
  }

  .ticket-card:last-child {
    border-bottom: none;
  }

  .ticket-card:hover {
    background: var(--surface);
  }

  .ticket-left {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .ticket-title-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .ticket-title-link {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  .ticket-title-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  .ticket-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    flex-wrap: wrap;
  }

  .ticket-sep {
    opacity: 0.4;
  }

  .ticket-number {
    opacity: 0.6;
  }

  .repo-chip {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    font-weight: 700;
    color: #000;
    white-space: nowrap;
    line-height: 1.4;
  }

  .label-chip {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    font-weight: 600;
    color: #000;
    white-space: nowrap;
    line-height: 1.4;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .branch-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    opacity: 0.8;
  }

  /* Status dot */
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
  }

  .dot-inline {
    width: 6px;
    height: 6px;
  }

  .dot-success { background: var(--status-success); }
  .dot-muted   { background: var(--border); }
  .dot-active  { background: var(--accent); }

  .ticket-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .start-work-btn {
    padding: 5px 12px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: not-allowed;
    opacity: 0.45;
    white-space: nowrap;
    transition: border-color 0.12s, color 0.12s, opacity 0.12s;
  }

  .start-work-btn--active {
    cursor: pointer;
    opacity: 1;
  }

  .start-work-btn--active:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Mobile: card layout */
  @media (max-width: 600px) {
    .ticket-card {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 12px 10px;
    }

    .ticket-left {
      width: 100%;
    }

    .ticket-actions {
      align-self: flex-end;
    }
  }
</style>
