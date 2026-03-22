<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchOrgPrs, fetchBranchLinks } from '../lib/api.js';
  import { derivePrAction, getStatusCssVar, shouldUseDarkText } from '../lib/pr-state.js';
  import { formatRelativeTime } from '../lib/utils.js';
  import type { GitHubIssue, PullRequest, OrgPrsResponse, BranchLinksResponse } from '../lib/types.js';
  import TicketsPanel from './TicketsPanel.svelte';
  import StartWorkModal from './StartWorkModal.svelte';

  let { onOpenWorkspace, onOpenSession }: {
    onOpenWorkspace: (path: string) => void;
    onOpenSession?: (sessionId: string) => void;
  } = $props();

  let activeTab = $state<'prs' | 'tickets'>('prs');
  let startWorkIssue = $state<GitHubIssue | null>(null);

  const orgQuery = createQuery<OrgPrsResponse>(() => ({
    queryKey: ['org-prs'],
    queryFn: fetchOrgPrs,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  const branchLinksQuery = createQuery<BranchLinksResponse>(() => ({
    queryKey: ['branch-links'],
    queryFn: fetchBranchLinks,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  let data = $derived(orgQuery.data);
  let isLoading = $derived(orgQuery.isLoading);
  let isError = $derived(orgQuery.isError);

  // Filter / sort state
  let stateFilter = $state<'open' | 'all'>('open');
  let sortBy = $state<'updated' | 'title' | 'repo'>('updated');

  // Color derivation (same algorithm as WorkspaceItem)
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

  function prStatusDotClass(pr: PullRequest): string {
    if (pr.state !== 'OPEN') return 'dot dot-muted';
    if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'dot dot-error';
    return 'dot dot-success';
  }

  function prActionForRow(pr: PullRequest) {
    const prState = pr.state === 'OPEN' ? 'OPEN' : pr.state === 'MERGED' ? 'MERGED' : 'CLOSED';
    return derivePrAction({
      commitsAhead: 1,
      prState,
      ciPassing: 0,
      ciFailing: 0,
      ciPending: 0,
      ciTotal: 0,
      mergeable: (pr.mergeable as 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null) ?? null,
      unresolvedCommentCount: 0,
    });
  }

  function prRoleLabel(pr: PullRequest): string {
    return pr.role === 'author' ? 'by you' : 'review requested';
  }

  let allPrs = $derived(data?.prs ?? []);

  let filteredPrs = $derived.by((): PullRequest[] => {
    let prs = allPrs;
    if (stateFilter === 'open') {
      prs = prs.filter(pr => pr.state === 'OPEN');
    }
    if (sortBy === 'title') {
      prs = [...prs].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'repo') {
      prs = [...prs].sort((a, b) => (a.repoName ?? '').localeCompare(b.repoName ?? ''));
    } else {
      prs = [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return prs;
  });

  let openCount = $derived(allPrs.filter(pr => pr.state === 'OPEN').length);

  let branchLinksData = $derived(branchLinksQuery.data ?? {});

  // Extract ticket ID from a branch name by looking up branch-links data.
  // Returns the issue number string (e.g. "123") if a match is found.
  function getTicketIdForPr(headRefName: string): string | null {
    for (const [issueNumber, links] of Object.entries(branchLinksData)) {
      for (const link of links) {
        if (link.branchName === headRefName) {
          return issueNumber;
        }
      }
    }
    return null;
  }
</script>

<div class="org-dashboard">
  <div class="org-header">
    <span class="org-title">All Workspaces</span>
    {#if activeTab === 'prs' && !isLoading && !isError && !data?.error}
      <span class="org-subtitle">
        {#if openCount === 1}1 open PR{:else}{openCount} open PRs{/if}
      </span>
    {/if}
  </div>

  <!-- Tab strip -->
  <div class="tab-strip">
    <button
      class="tab-btn"
      class:tab-btn--active={activeTab === 'prs'}
      onclick={() => { activeTab = 'prs'; }}
    >
      PRs
    </button>
    <button
      class="tab-btn"
      class:tab-btn--active={activeTab === 'tickets'}
      onclick={() => { activeTab = 'tickets'; }}
    >
      Tickets
    </button>
  </div>

  {#if activeTab === 'prs'}
    {#if !isLoading && !isError && !data?.error && allPrs.length > 0}
      <div class="filter-bar">
        <select class="filter-select" bind:value={stateFilter}>
          <option value="open">Open</option>
          <option value="all">All</option>
        </select>
        <select class="filter-select" bind:value={sortBy}>
          <option value="updated">Sort: Updated</option>
          <option value="title">Sort: Title</option>
          <option value="repo">Sort: Repo</option>
        </select>
      </div>
    {/if}

    {#if isLoading}
      <div class="pr-list">
        {#each [1, 2, 3] as _ (_.toString())}
          <div class="pr-row skeleton">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line skeleton-meta"></div>
          </div>
        {/each}
      </div>

    {:else if isError}
      <div class="state-message state-message--error">
        <span>Failed to load pull requests.</span>
        <button class="retry-btn" onclick={() => orgQuery.refetch()}>Retry</button>
      </div>

    {:else if data?.error === 'gh_not_in_path'}
      <div class="state-message state-message--info">
        Install GitHub CLI for PR tracking —
        <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer">cli.github.com</a>
      </div>

    {:else if data?.error === 'gh_not_authenticated'}
      <div class="state-message state-message--info">
        Run <code>gh auth login</code> to connect GitHub.
      </div>

    {:else if data?.error === 'gh_timeout'}
      <div class="state-message state-message--error">
        <span>GitHub is taking too long. Try again.</span>
        <button class="retry-btn" onclick={() => orgQuery.refetch()}>Retry</button>
      </div>

    {:else if data?.error === 'no_workspaces'}
      <!-- App.svelte handles the no_workspaces case -->

    {:else if filteredPrs.length === 0}
      <div class="state-message">
        {#if stateFilter === 'open'}No open PRs across your repos. Great work!{:else}No pull requests found.{/if}
      </div>

    {:else}
      <div class="pr-list">
        {#each filteredPrs as pr (`${pr.repoPath ?? ''}:${pr.number}`)}
          {@const action = prActionForRow(pr)}
          {@const actionColor = getStatusCssVar(action.color)}
          {@const darkText = shouldUseDarkText(action.color)}
          {@const repoName = pr.repoName ?? ''}
          {@const chipColor = deriveColor(repoName)}
          {@const ticketId = getTicketIdForPr(pr.headRefName)}
          <div class="pr-row">
            <div class="pr-row-left">
              <div class="pr-row-title-line">
                <span class={prStatusDotClass(pr)}></span>
                <a class="pr-title-link" href={pr.url} target="_blank" rel="noopener noreferrer">
                  {pr.title}
                </a>
              </div>
              <div class="pr-row-meta">
                {#if repoName}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    class="repo-chip"
                    style:background={chipColor}
                    title={pr.repoPath ?? repoName}
                    onclick={() => { if (pr.repoPath) onOpenWorkspace(pr.repoPath); }}
                  >{repoName}</span>
                  <span class="pr-sep">·</span>
                {/if}
                {#if ticketId}
                  <span class="ticket-chip">{ticketId}</span>
                  <span class="pr-sep">·</span>
                {/if}
                <span class="pr-role">{prRoleLabel(pr)}</span>
                <span class="pr-sep">·</span>
                <span class="pr-time">{formatRelativeTime(pr.updatedAt)}</span>
              </div>
            </div>
            <div class="pr-row-actions">
              {#if action.type !== 'none' && action.label}
                <button
                  class="pr-action-pill"
                  style:--pill-color={actionColor}
                  class:dark-text={darkText}
                  title={action.label}
                >
                  {action.label}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {:else if activeTab === 'tickets'}
    <TicketsPanel onStartWork={(issue) => { startWorkIssue = issue; }} />
  {:else}
    <!-- future tabs -->
  {/if}

  {#if startWorkIssue}
    <StartWorkModal
      issue={startWorkIssue}
      open={true}
      onClose={() => { startWorkIssue = null; }}
      onSessionCreated={(id) => { startWorkIssue = null; onOpenSession?.(id); }}
    />
  {/if}
</div>

<style>
  .org-dashboard {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    background: var(--bg);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* ── Header ── */
  .org-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .org-title {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .org-subtitle {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    opacity: 0.7;
  }

  /* ── Tab strip ── */
  .tab-strip {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    margin-top: -4px;
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

  /* ── Filter bar ── */
  .filter-bar {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .filter-select {
    padding: 6px 10px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    cursor: pointer;
    outline: none;
    transition: border-color 0.12s;
  }

  .filter-select:focus {
    border-color: var(--accent);
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

  /* ── PR list ── */
  .pr-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .pr-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    transition: background 0.1s;
  }

  .pr-row:last-child {
    border-bottom: none;
  }

  .pr-row:hover {
    background: var(--surface);
  }

  .pr-row-left {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .pr-row-title-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .pr-title-link {
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

  .pr-title-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  .pr-row-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .pr-row-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    flex-wrap: wrap;
  }

  .pr-sep {
    opacity: 0.4;
  }

  /* Repo chip */
  .repo-chip {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    font-weight: 700;
    color: #000;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.12s;
    line-height: 1.4;
  }

  .repo-chip:hover {
    opacity: 0.8;
  }

  /* Ticket chip */
  .ticket-chip {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    white-space: nowrap;
    line-height: 1.4;
  }

  /* Status dot */
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
  }

  .dot-success { background: var(--status-success); }
  .dot-error   { background: var(--status-error); }
  .dot-muted   { background: var(--border); }

  /* Action pill */
  .pr-action-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 6px 12px;
    min-height: 32px;
    border-radius: 20px;
    border: none;
    background: var(--pill-color, var(--border));
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: #fff;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .pr-action-pill:hover {
    opacity: 0.85;
  }

  .pr-action-pill.dark-text {
    color: #1a1a1a;
  }

  /* ── Skeletons ── */
  .skeleton {
    pointer-events: none;
    min-height: 56px;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
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

  /* ── Mobile: card-style rows ── */
  @media (max-width: 600px) {
    .org-dashboard {
      padding: 14px;
    }

    .pr-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 12px 10px;
    }

    .pr-row-left {
      width: 100%;
    }

    .pr-row-actions {
      align-self: flex-end;
    }

    .pr-action-pill {
      padding: 5px 12px;
      min-height: 32px;
    }

    .filter-bar {
      flex-wrap: wrap;
    }
  }
</style>
