<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchGithubIssues, fetchBranchLinks, fetchJiraIssues } from '../lib/api.js';
  import type { GitHubIssuesResponse, JiraIssuesResponse, BranchLinksResponse, BranchLink, AnyIssue } from '../lib/types.js';
  import TicketCard from './TicketCard.svelte';

  let { onStartWork }: { onStartWork?: (issue: AnyIssue) => void } = $props();

  let activeTab = $state<'github' | 'jira'>('github');

  // Issue queries
  const githubIssuesQuery = createQuery<GitHubIssuesResponse>(() => ({
    queryKey: ['github-issues'],
    queryFn: fetchGithubIssues,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  const jiraIssuesQuery = createQuery<JiraIssuesResponse>(() => ({
    queryKey: ['jira-issues'],
    queryFn: fetchJiraIssues,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  const branchLinksQuery = createQuery<BranchLinksResponse>(() => ({
    queryKey: ['branch-links'],
    queryFn: fetchBranchLinks,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  let branchLinksData = $derived(branchLinksQuery.data ?? {});

  // GitHub derived
  let githubIssuesData = $derived(githubIssuesQuery.data);
  let githubIssues = $derived(githubIssuesData?.issues ?? []);
  let githubOpenCount = $derived(githubIssues.filter(i => i.state === 'OPEN').length);

  // Jira derived
  let jiraIssuesData = $derived(jiraIssuesQuery.data);
  let jiraIssues = $derived(jiraIssuesData?.issues ?? []);

  function getBranchLinksForTicket(ticketId: string): BranchLink[] {
    return branchLinksData[ticketId] ?? [];
  }

  // Active tab state helpers
  let activeQuery = $derived(
    activeTab === 'github' ? githubIssuesQuery : jiraIssuesQuery
  );

  let activeIssues = $derived(
    activeTab === 'github' ? githubIssues : jiraIssues
  );

  let activeError = $derived(
    activeTab === 'github' ? githubIssuesData?.error : jiraIssuesData?.error
  );

  let countLabel = $derived(
    activeTab === 'github'
      ? `${githubOpenCount} open issue${githubOpenCount === 1 ? '' : 's'}`
      : `${jiraIssues.length} issue${jiraIssues.length === 1 ? '' : 's'}`
  );

  function getTicketId(issue: AnyIssue): string {
    if ('number' in issue) return `GH-${issue.number}`;
    return issue.key;
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
    <button
      class="tab-btn"
      class:tab-btn--active={activeTab === 'jira'}
      onclick={() => { activeTab = 'jira'; }}
    >
      Jira
    </button>
  </div>

  <!-- Panel header -->
  <div class="panel-header">
    <span class="panel-title">
      Tickets
      {#if !activeQuery.isLoading && !activeQuery.isError && !activeError}
        <span class="panel-count">· {countLabel}</span>
      {/if}
    </span>
  </div>

  <!-- Content -->
  {#if activeQuery.isLoading}
    <div class="ticket-list">
      {#each [1, 2, 3] as _ (_.toString())}
        <div class="ticket-skeleton">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line skeleton-meta"></div>
        </div>
      {/each}
    </div>

  {:else if activeQuery.isError}
    <div class="state-message state-message--error">
      <span>Failed to load issues.</span>
      <button class="retry-btn" onclick={() => activeQuery.refetch()}>Retry</button>
    </div>

  {:else if activeTab === 'github' && activeError === 'gh_not_in_path'}
    <div class="state-message state-message--info">
      Install GitHub CLI for issue tracking —
      <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer">cli.github.com</a>
    </div>

  {:else if activeTab === 'github' && activeError === 'gh_not_authenticated'}
    <div class="state-message state-message--info">
      Run <code>gh auth login</code> to connect GitHub.
    </div>

  {:else if activeTab === 'jira' && (activeError === 'jira_not_configured' || activeError === 'acli_not_in_path')}
    <div class="state-message state-message--info">
      Install the Atlassian CLI to see your Jira tickets: <code>brew install acli</code> then <code>acli jira auth login --web</code>
    </div>

  {:else if activeTab === 'jira' && (activeError === 'acli_not_authenticated' || activeError === 'jira_auth_failed')}
    <div class="state-message state-message--info">
      Run <code>acli jira auth login --web</code> to connect your Jira account.
    </div>

  {:else if activeError}
    <div class="state-message state-message--error">
      <span>Failed to load issues.</span>
      <button class="retry-btn" onclick={() => activeQuery.refetch()}>Retry</button>
    </div>

  {:else if activeIssues.length === 0}
    <div class="state-message">
      {#if activeTab === 'github'}No open issues assigned to you. Enjoy the quiet.
      {:else}No active Jira issues assigned to you.
      {/if}
    </div>

  {:else}
    <div class="ticket-list">
      {#each activeIssues as issue (getTicketId(issue))}
        <TicketCard {issue} source={activeTab} branchLinks={getBranchLinksForTicket(getTicketId(issue))} {...(onStartWork != null && { onStartWork })} />
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

  /* -- Tab strip -- */
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

  /* -- Panel header -- */
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

  /* -- State messages -- */
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

  /* -- Ticket list -- */
  .ticket-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }

  /* -- Skeletons -- */
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

  /* -- Mobile -- */
  @media (max-width: 600px) {
    .tab-btn {
      padding: 5px 10px;
    }
  }
</style>
