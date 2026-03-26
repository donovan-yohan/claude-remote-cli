<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchGithubIssues, fetchBranchLinks, fetchJiraIssues } from '../lib/api.js';
  import type { GitHubIssuesResponse, JiraIssuesResponse, BranchLinksResponse, BranchLink, AnyIssue } from '../lib/types.js';
  import TicketCard from './TicketCard.svelte';
  import DataTable from './DataTable.svelte';
  import type { Column } from './DataTable.svelte';

  let { onStartWork }: { onStartWork?: (issue: AnyIssue) => void } = $props();

  let activeTab = $state<'github' | 'jira'>('jira');

  let searchQuery = $state('');
  let sortBy = $state('title');
  let sortDir = $state<'asc' | 'desc'>('asc');

  const ticketColumns: Column[] = [
    { key: 'status', label: 'St', sortable: false, width: '36px' },
    { key: 'title', label: 'Title', sortable: true },
    { key: 'action', label: '', sortable: false, width: '100px' },
  ];

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

  let activeIssues = $derived<AnyIssue[]>(
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

  function branchLinksForIssue(issue: AnyIssue): BranchLink[] {
    return getBranchLinksForTicket(getTicketId(issue));
  }

  let processedIssues = $derived.by((): AnyIssue[] => {
    let issues = activeIssues;
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      issues = issues.filter(issue => {
        const title = 'title' in issue ? issue.title : (issue as any).summary ?? '';
        const key = 'key' in issue ? issue.key : `#${(issue as any).number}`;
        return title.toLowerCase().includes(q) || key.toLowerCase().includes(q);
      });
    }
    if (sortBy === 'title') {
      const getTitle = (i: AnyIssue) => ('title' in i ? i.title : (i as any).summary ?? '');
      issues = [...issues].sort((a, b) => sortDir === 'asc' ? getTitle(a).localeCompare(getTitle(b)) : getTitle(b).localeCompare(getTitle(a)));
    }
    return issues;
  });
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

  <!-- Tool-specific config/auth errors: shown instead of the table -->
  {#if activeTab === 'github' && activeError === 'gh_not_in_path'}
    <div class="state-message state-message--info">
      Install GitHub CLI for issue tracking —
      <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer">cli.github.com</a>
    </div>
  {:else if activeTab === 'github' && activeError === 'gh_not_authenticated'}
    <div class="state-message state-message--info">
      Run <code>gh auth login</code> to connect GitHub.
    </div>
  {:else if activeTab === 'jira' && activeError === 'acli_not_in_path'}
    <div class="state-message state-message--info">
      Install the Atlassian CLI to see your Jira tickets: <code>brew install acli</code> then <code>acli jira auth login --web</code>
    </div>
  {:else if activeTab === 'jira' && activeError === 'acli_not_authenticated'}
    <div class="state-message state-message--info">
      Run <code>acli jira auth login --web</code> to connect your Jira account.
    </div>
  {:else}
    <!-- DataTable handles loading, network errors, empty, and data states -->
    <DataTable
      columns={ticketColumns}
      rows={processedIssues}
      sortBy={sortBy}
      sortDir={sortDir}
      onSort={(col) => {
        if (col === sortBy) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortBy = col; sortDir = 'asc'; }
      }}
      loading={activeQuery.isLoading}
      error={activeQuery.isError || activeError ? 'Failed to load issues.' : undefined}
      emptyMessage="No assigned tickets."
      filteredEmptyMessage="No tickets match search."
      hasActiveFilters={searchQuery.length > 0}
      onClearFilters={() => searchQuery = ''}
    >
      {#snippet row(issue, index)}
        <TicketCard
          {issue}
          source={activeTab}
          branchLinks={branchLinksForIssue(issue)}
          {...(onStartWork != null && { onStartWork })}
        />
      {/snippet}
      {#snippet mobileCard(issue, index)}
        <TicketCard
          {issue}
          source={activeTab}
          branchLinks={branchLinksForIssue(issue)}
          {...(onStartWork != null && { onStartWork })}
        />
      {/snippet}
    </DataTable>
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

  /* -- Mobile -- */
  @media (max-width: 600px) {
    .tab-btn {
      padding: 5px 10px;
    }
  }
</style>
