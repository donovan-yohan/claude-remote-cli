<script lang="ts">
  import type { RepoInfo, PullRequest, PullRequestsResponse, SessionSummary } from '../lib/types.js';
  import { createQuery } from '@tanstack/svelte-query';
  import * as api from '../lib/api.js';
  import { getUi } from '../lib/state/ui.svelte.js';
  import { rootShortName } from '../lib/utils.js';
  import PullRequestItem from './PullRequestItem.svelte';

  const ui = getUi();

  let {
    repo,
    findSessionForBranch,
    activeSession,
    onPRClick,
  }: {
    repo: RepoInfo;
    findSessionForBranch: (branchName: string) => SessionSummary | undefined;
    activeSession: SessionSummary | undefined;
    onPRClick: (pr: PullRequest, repo: RepoInfo, yolo?: boolean) => void;
  } = $props();

  let expanded = $state(false);

  const prQuery = createQuery<PullRequestsResponse>(() => ({
    queryKey: ['pull-requests', repo.path],
    queryFn: () => api.fetchPullRequests(repo.path),
    enabled: expanded,
  }));

  let prData = $derived(prQuery.data);
  let prError = $derived(prData?.error ?? null);
  let prList = $derived(prData?.prs ?? []);

  let filteredPRs = $derived(
    prList.filter((pr: PullRequest) => {
      if (ui.prRoleFilter !== 'all' && pr.role !== ui.prRoleFilter) return false;
      if (ui.searchFilter && pr.title.toLowerCase().indexOf(ui.searchFilter.toLowerCase()) === -1) return false;
      return true;
    })
  );

  function toggle() {
    expanded = !expanded;
  }

  function handleRefresh(e: MouseEvent) {
    e.stopPropagation();
    prQuery.refetch();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li class="repo-group-header" onclick={toggle}>
  <span class="chevron" class:expanded>▶</span>
  <span class="repo-group-name">{repo.name}</span>
  <span class="repo-group-root">{rootShortName(repo.root)}</span>
  <span class="repo-group-count">{prData ? prList.length : '-'}</span>
  {#if expanded}
    <button
      class="repo-group-refresh"
      onclick={handleRefresh}
      disabled={prQuery.isFetching}
      aria-label="Refresh pull requests"
    >
      <span class:spinning={prQuery.isFetching}>&#8635;</span>
    </button>
  {/if}
</li>
{#if expanded}
  {#if prQuery.isLoading}
    <li class="pr-hint">Loading...</li>
  {:else if prError === 'gh_not_authenticated'}
    <li class="pr-hint">GitHub CLI not authenticated<br /><span class="pr-hint-sub">Run <code>gh auth login</code> on the host</span></li>
  {:else if prError}
    <li class="pr-hint">Could not fetch pull requests</li>
  {:else if filteredPRs.length === 0}
    <li class="pr-hint">No open pull requests</li>
  {:else}
    {#each filteredPRs as pr (pr.number)}
      <PullRequestItem
        {pr}
        isActiveSession={!!findSessionForBranch(pr.headRefName)}
        isSelected={activeSession?.type === 'worktree' && activeSession?.branchName === pr.headRefName && activeSession?.repoName === repo.name}
        onclick={() => onPRClick(pr, repo)}
        onYolo={() => onPRClick(pr, repo, true)}
      />
    {/each}
  {/if}
{/if}

<style>
  .repo-group-refresh {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0 4px;
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .repo-group-refresh:hover {
    color: var(--accent);
  }

  .repo-group-refresh:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinning {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
