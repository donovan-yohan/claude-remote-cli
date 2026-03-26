<script lang="ts">
  import type { GitHubIssue, JiraIssue, AnyIssue, BranchLink } from '../lib/types.js';
  import { deriveColor } from '../lib/colors.js';
  import StatusDot from './StatusDot.svelte';
  function simpleJiraStatus(status: string): 'in-progress' | 'code-review' | 'ready-for-qa' | 'unmapped' {
    const lower = status.toLowerCase();
    if (lower.includes('progress') || lower.includes('doing') || lower.includes('development')) return 'in-progress';
    if (lower.includes('review') || lower.includes('pr')) return 'code-review';
    if (lower.includes('qa') || lower.includes('test') || lower.includes('done') || lower.includes('resolved')) return 'ready-for-qa';
    return 'unmapped';
  }

  let { issue, source, branchLinks = [], onStartWork }: {
    issue: AnyIssue;
    source: 'github' | 'jira';
    branchLinks?: BranchLink[];
    onStartWork?: (issue: AnyIssue) => void;
  } = $props();

  function isGitHub(i: AnyIssue): i is GitHubIssue { return source === 'github'; }
  function isJira(i: AnyIssue): i is JiraIssue { return source === 'jira'; }

  let linkedBranch = $derived(
    branchLinks.length > 0 ? branchLinks[0] : null
  );
  let hasActiveSession = $derived(linkedBranch?.hasActiveSession ?? false);

  // Priority colors for Jira
  const PRIORITY_COLORS: Record<string, string> = {
    'Highest': '#ff5630',
    'High': '#ff7452',
    'Medium': '#ffab00',
    'Low': '#36b37e',
    'Lowest': '#6b778c',
  };


</script>

<div class="ticket-card">
  <div class="ticket-left">
    <div class="ticket-title-line">
      {#if isGitHub(issue)}
        <StatusDot status={issue.state === 'OPEN' ? 'open' : 'closed'} />
      {:else if isJira(issue)}
        <StatusDot status={simpleJiraStatus(issue.status)} />
      {/if}
      <a class="ticket-title-link" href={issue.url} target="_blank" rel="noopener noreferrer">
        {issue.title}
      </a>
    </div>
    <div class="ticket-meta">
      {#if isGitHub(issue)}
        <span
          class="repo-chip"
          style:background={deriveColor(issue.repoName)}
          title={issue.repoPath ?? issue.repoName}
        >{issue.repoName}</span>
        <span class="ticket-sep">·</span>
        <span class="ticket-number">#{issue.number}</span>
        {#each issue.labels.slice(0, 3) as label (label.name)}
          <span class="label-chip" style:background={'#' + label.color} title={label.name}>
            {label.name}
          </span>
        {/each}
      {:else if isJira(issue)}
        <span class="ticket-key">{issue.key}</span>
        <span class="ticket-sep">·</span>
        <span class="status-badge">{issue.status}</span>
        {#if issue.priority}
          <span class="ticket-sep">·</span>
          <span class="priority-badge" style:color={PRIORITY_COLORS[issue.priority] ?? 'var(--text-muted)'}>{issue.priority}</span>
        {/if}
        {#if issue.sprint}
          <span class="ticket-sep">·</span>
          <span class="sprint-chip">{issue.sprint}</span>
        {/if}
        {#if issue.storyPoints != null}
          <span class="ticket-sep">·</span>
          <span class="points-badge">{issue.storyPoints}pt</span>
        {/if}
      {/if}
      {#if linkedBranch}
        <span class="ticket-sep">·</span>
        <span class="branch-chip">
          {#if hasActiveSession}
            <StatusDot status="running" size={6} />
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
    padding: 12px 12px;
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
    gap: 4px;
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

  .ticket-key {
    font-weight: 600;
    opacity: 0.8;
  }

  .repo-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 0;
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
    padding: 2px 8px;
    border-radius: 0;
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

  .status-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 0;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    white-space: nowrap;
    line-height: 1.4;
  }

  .priority-badge {
    font-weight: 600;
    white-space: nowrap;
  }

  .sprint-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 0;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    white-space: nowrap;
    line-height: 1.4;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .points-badge {
    font-weight: 600;
    opacity: 0.7;
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

  .ticket-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .start-work-btn {
    padding: 4px 12px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    background: none;
    border: 1px solid var(--border);
    border-radius: 0;
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
      padding: 12px 12px;
    }

    .ticket-left {
      width: 100%;
    }

    .ticket-actions {
      align-self: flex-end;
    }
  }
</style>
