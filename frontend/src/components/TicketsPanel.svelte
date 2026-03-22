<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchGithubIssues, fetchBranchLinks } from '../lib/api.js';
  import type { GitHubIssue, GitHubIssuesResponse, BranchLinksResponse, BranchLink } from '../lib/types.js';
  import TicketCard from './TicketCard.svelte';

  let { onStartWork }: { onStartWork?: (issue: GitHubIssue) => void } = $props();

  const issuesQuery = createQuery<GitHubIssuesResponse>(() => ({
    queryKey: ['github-issues'],
    queryFn: fetchGithubIssues,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  const branchLinksQuery = createQuery<BranchLinksResponse>(() => ({
    queryKey: ['branch-links'],
    queryFn: fetchBranchLinks,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  let activeTab = $state<'github'>('github');

  let issuesData = $derived(issuesQuery.data);
  let isLoading = $derived(issuesQuery.isLoading);
  let isError = $derived(issuesQuery.isError);

  let branchLinksData = $derived(branchLinksQuery.data ?? {});

  let allIssues = $derived(issuesData?.issues ?? []);
  let openCount = $derived(allIssues.filter(i => i.state === 'OPEN').length);

  function getBranchLinksForIssue(issueNumber: number): BranchLink[] {
    const key = `GH-${issueNumber}`;
    return branchLinksData[key] ?? [];
  }
</script>

<div class="tickets-panel">
  <!-- Tab strip -->
  <div class="tab-strip">
    <button
      class="tab-btn"
      class:tab-btn--active={activeTab === 'github'}
      onclick={() => { activeTab = 'github'; }}
    >
      GitHub Issues
    </button>
  </div>

  <!-- Panel header -->
  <div class="panel-header">
    <span class="panel-title">
      Tickets
      {#if !isLoading && !isError && !issuesData?.error}
        <span class="panel-count">· {openCount} open issue{openCount === 1 ? '' : 's'}</span>
      {/if}
    </span>
  </div>

  <!-- Content -->
  {#if isLoading}
    <div class="ticket-list">
      {#each [1, 2, 3] as _ (_.toString())}
        <div class="ticket-skeleton">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line skeleton-meta"></div>
        </div>
      {/each}
    </div>

  {:else if isError}
    <div class="state-message state-message--error">
      <span>Failed to load issues.</span>
      <button class="retry-btn" onclick={() => issuesQuery.refetch()}>Retry</button>
    </div>

  {:else if issuesData?.error === 'gh_not_in_path'}
    <div class="state-message state-message--info">
      Install GitHub CLI for issue tracking —
      <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer">cli.github.com</a>
    </div>

  {:else if issuesData?.error === 'gh_not_authenticated'}
    <div class="state-message state-message--info">
      Run <code>gh auth login</code> to connect GitHub.
    </div>

  {:else if allIssues.length === 0}
    <div class="state-message">
      No open issues assigned to you. Enjoy the quiet.
    </div>

  {:else}
    <div class="ticket-list">
      {#each allIssues as issue (`${issue.repoPath}:${issue.number}`)}
        <TicketCard {issue} branchLinks={getBranchLinksForIssue(issue.number)} {...(onStartWork != null && { onStartWork })} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tickets-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── Tab strip ── */
  .tab-strip {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .tab-btn {
    padding: 6px 14px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    font-weight: 600;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    margin-bottom: -1px;
    transition: color 0.12s, border-color 0.12s;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .tab-btn:hover {
    color: var(--text);
  }

  .tab-btn--active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /* ── Panel header ── */
  .panel-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-shrink: 0;
  }

  .panel-title {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .panel-count {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    opacity: 0.7;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }

  /* ── State messages ── */
  .state-message {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding: 6px 0;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .state-message--info a {
    color: var(--accent);
    text-decoration: none;
  }

  .state-message--info a:hover {
    text-decoration: underline;
  }

  .retry-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    cursor: pointer;
    padding: 4px 10px;
    transition: border-color 0.12s, color 0.12s;
  }

  .retry-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ── Ticket list ── */
  .ticket-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }

  /* ── Skeletons ── */
  .ticket-skeleton {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    min-height: 56px;
    pointer-events: none;
  }

  .ticket-skeleton:last-child {
    border-bottom: none;
  }

  .skeleton-line {
    background: var(--border);
    border-radius: 3px;
    animation: skeleton-pulse 1.4s ease-in-out infinite;
  }

  .skeleton-title {
    height: 13px;
    width: 60%;
  }

  .skeleton-meta {
    height: 10px;
    width: 40%;
  }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.4; }
    50%       { opacity: 0.7; }
  }

  /* ── Mobile ── */
  @media (max-width: 600px) {
    .tab-btn {
      padding: 5px 10px;
    }
  }
</style>
