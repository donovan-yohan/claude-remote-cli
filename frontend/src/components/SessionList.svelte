<script lang="ts">
  import { getUi } from '../lib/state/ui.svelte.js';
  import { getSessionState, getSessionStatus, clearAttention, refreshAll } from '../lib/state/sessions.svelte.js';
  import * as api from '../lib/api.js';
  import { ConflictError } from '../lib/api.js';
  import type { SessionSummary, WorktreeInfo, RepoInfo, PullRequest, PullRequestsResponse } from '../lib/types.js';
  import { createQuery } from '@tanstack/svelte-query';
  import SessionItem from './SessionItem.svelte';
  import SessionFilters from './SessionFilters.svelte';
  import PullRequestItem from './PullRequestItem.svelte';

  const ui = getUi();
  const state = getSessionState();

  let {
    onSelectSession,
    onOpenNewSession,
    onNewWorktree,
    onDeleteWorktree,
  }: {
    onSelectSession: (id: string) => void;
    onOpenNewSession: (repo?: RepoInfo) => void;
    onNewWorktree: (repo: RepoInfo) => void;
    onDeleteWorktree: (wt: WorktreeInfo) => void;
  } = $props();

  let startingWorktreePath: string | null = null;

  // Split sessions by type
  let repoSessions = $derived(state.sessions.filter(s => s.type === 'repo'));
  let worktreeSessions = $derived(state.sessions.filter(s => s.type !== 'repo'));

  // Repos that have an active session
  let activeRepoPaths = $derived(new Set(repoSessions.map(s => s.repoPath)));

  // Worktrees that have an active session
  let activeWorktreePaths = $derived(new Set(worktreeSessions.map(s => s.repoPath).filter(Boolean)));

  function matchesFilters(
    root: string | undefined,
    repoName: string | undefined,
    name: string,
  ): boolean {
    if (ui.rootFilter && root !== ui.rootFilter) return false;
    if (ui.repoFilter && repoName !== ui.repoFilter) return false;
    if (ui.searchFilter) {
      if (name.toLowerCase().indexOf(ui.searchFilter.toLowerCase()) === -1) return false;
    }
    return true;
  }

  // Repos tab
  let filteredRepoSessions = $derived(
    repoSessions.filter(s =>
      matchesFilters(s.root, s.repoName, s.displayName || s.repoName || s.id),
    ),
  );

  let filteredIdleRepos = $derived(
    state.repos
      .filter(r => !activeRepoPaths.has(r.path) && matchesFilters(r.root, r.name, r.name))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  );

  // Worktrees tab
  let filteredWorktreeSessions = $derived(
    worktreeSessions.filter(s =>
      matchesFilters(s.root, s.repoName, s.displayName || s.repoName || s.worktreeName || s.id),
    ),
  );

  let filteredWorktrees = $derived(
    state.worktrees
      .filter(wt => !activeWorktreePaths.has(wt.path) && matchesFilters(wt.root, wt.repoName, wt.name))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  );

  // PR fetching via svelte-query
  let prRepoPath = $derived((() => {
    if (ui.activeTab !== 'prs' || !ui.repoFilter) return null;
    const repo = state.repos.find(r => r.name === ui.repoFilter);
    return repo?.path ?? null;
  })());

  const prQuery = createQuery<PullRequestsResponse>(() => ({
    queryKey: ['pull-requests', prRepoPath],
    queryFn: () => prRepoPath ? api.fetchPullRequests(prRepoPath) : Promise.resolve({ prs: [] } as PullRequestsResponse),
    enabled: !!prRepoPath,
  }));

  let prData = $derived(prQuery.data);
  let prError = $derived(prData?.error ?? null);
  let prList = $derived(prData?.prs ?? []);

  let filteredPullRequests = $derived(
    prList.filter((pr: PullRequest) => {
      if (ui.prRoleFilter !== 'all' && pr.role !== ui.prRoleFilter) return false;
      if (ui.searchFilter && pr.title.toLowerCase().indexOf(ui.searchFilter.toLowerCase()) === -1) return false;
      return true;
    })
  );

  // Active session (for PR selected highlighting)
  let activeSession = $derived(
    state.activeSessionId ? state.sessions.find(s => s.id === state.activeSessionId) : undefined,
  );

  // Tab counts
  let reposCount = $derived(filteredRepoSessions.length + filteredIdleRepos.length);
  let worktreesCount = $derived(filteredWorktreeSessions.length + filteredWorktrees.length);
  let prsCount = $derived(filteredPullRequests.length);

  // PR click cascade helpers — match by git branch name
  function findSessionForBranch(branchName: string): SessionSummary | undefined {
    return state.sessions.find(s =>
      s.type === 'worktree' && s.branchName === branchName
    );
  }

  function findWorktreeForBranch(branchName: string): WorktreeInfo | undefined {
    return state.worktrees.find(wt => wt.branchName === branchName);
  }

  async function handlePRClick(pr: PullRequest, yolo = false) {
    const claudeArgs = yolo ? ['--dangerously-skip-permissions'] : undefined;

    // Step 1: Active session for this branch? → route to it
    const existingSession = findSessionForBranch(pr.headRefName);
    if (existingSession) {
      clearAttention(existingSession.id);
      onSelectSession(existingSession.id);
      return;
    }

    // Step 2: Inactive worktree for this branch? → resume it
    const existingWorktree = findWorktreeForBranch(pr.headRefName);
    if (existingWorktree) {
      try {
        const session = await api.createSession({
          repoPath: existingWorktree.repoPath,
          repoName: existingWorktree.repoName,
          worktreePath: existingWorktree.path,
          claudeArgs,
        });
        await refreshAll();
        if (session?.id) {
          onSelectSession(session.id);
        }
      } catch { /* user can retry */ }
      return;
    }

    // Step 3: No local worktree → create new worktree + session
    const repo = state.repos.find(r => r.name === ui.repoFilter);
    if (!repo) return;

    try {
      const session = await api.createSession({
        repoPath: repo.path,
        repoName: repo.name,
        branchName: pr.headRefName,
        claudeArgs,
      });
      await refreshAll();
      if (session?.id) {
        onSelectSession(session.id);
      }
    } catch { /* user can retry */ }
  }

  async function handleKillSession(session: SessionSummary) {
    await api.killSession(session.id);
    await refreshAll();
    if (state.activeSessionId === session.id) {
      state.activeSessionId = null;
    }
  }

  async function handleRenameSession(session: SessionSummary) {
    const newName = prompt('Rename session:', session.displayName || session.repoName || session.id);
    if (newName && newName.trim() && newName.trim() !== (session.displayName || session.repoName || session.id)) {
      await api.renameSession(session.id, newName.trim());
      await refreshAll();
    }
  }

  function handleSelectSession(session: SessionSummary) {
    clearAttention(session.id);
    onSelectSession(session.id);
  }

  async function handleStartWorktreeSession(wt: WorktreeInfo, yolo = false) {
    if (startingWorktreePath) return;
    startingWorktreePath = wt.path;
    try {
      const session = await api.createSession({
        repoPath: wt.repoPath,
        repoName: wt.repoName,
        worktreePath: wt.path,
        ...(yolo && { claudeArgs: ['--dangerously-skip-permissions'] }),
      });
      await refreshAll();
      if (session?.id) onSelectSession(session.id);
    } catch {
      // Ignore — user can retry
    } finally {
      startingWorktreePath = null;
    }
  }

  async function handleStartRepoSession(repo: RepoInfo, yolo = false) {
    try {
      const session = await api.createRepoSession({
        repoPath: repo.path,
        repoName: repo.name,
        continue: true,
        ...(yolo && { claudeArgs: ['--dangerously-skip-permissions'] }),
      });
      await refreshAll();
      if (session?.id) onSelectSession(session.id);
    } catch (err: unknown) {
      if (err instanceof ConflictError && err.sessionId) {
        await refreshAll();
        onSelectSession(err.sessionId);
      }
    }
  }
</script>

<div class="session-list-tabs">
  <button
    class="sidebar-tab"
    class:active={ui.activeTab === 'repos'}
    onclick={() => { ui.activeTab = 'repos'; }}
  >
    Repos <span class="tab-count">{reposCount}</span>
  </button>
  <button
    class="sidebar-tab"
    class:active={ui.activeTab === 'worktrees'}
    onclick={() => { ui.activeTab = 'worktrees'; }}
  >
    Worktrees <span class="tab-count">{worktreesCount}</span>
  </button>
  <button
    class="sidebar-tab"
    class:active={ui.activeTab === 'prs'}
    onclick={() => { ui.activeTab = 'prs'; }}
  >
    PRs <span class="tab-count">{prsCount}</span>
  </button>
</div>

<SessionFilters />

<ul class="session-list">
  {#if ui.activeTab === 'repos'}
    {#each filteredRepoSessions as session (session.id)}
      <SessionItem
        variant={{ kind: 'active', session, status: getSessionStatus(session), isSelected: state.activeSessionId === session.id }}
        gitStatus={state.gitStatuses[session.repoPath + ':' + session.worktreeName]}
        onclick={() => handleSelectSession(session)}
        onkill={() => handleKillSession(session)}
        onrename={() => handleRenameSession(session)}
      />
    {/each}
    {#if filteredRepoSessions.length > 0 && filteredIdleRepos.length > 0}
      <li class="session-divider">Available</li>
    {/if}
    {#each filteredIdleRepos as repo (repo.path)}
      <SessionItem
        variant={{ kind: 'idle-repo', repo }}
        onclick={() => handleStartRepoSession(repo)}
        onresumeYolo={() => handleStartRepoSession(repo, true)}
        onNewWorktree={() => onNewWorktree(repo)}
      />
    {/each}
  {:else if ui.activeTab === 'worktrees'}
    {#each filteredWorktreeSessions as session (session.id)}
      <SessionItem
        variant={{ kind: 'active', session, status: getSessionStatus(session), isSelected: state.activeSessionId === session.id }}
        gitStatus={state.gitStatuses[session.repoPath + ':' + session.worktreeName]}
        onclick={() => handleSelectSession(session)}
        onkill={() => handleKillSession(session)}
        onrename={() => handleRenameSession(session)}
      />
    {/each}
    {#if filteredWorktreeSessions.length > 0 && filteredWorktrees.length > 0}
      <li class="session-divider">Available</li>
    {/if}
    {#each filteredWorktrees as wt (wt.path)}
      <SessionItem
        variant={{ kind: 'inactive-worktree', worktree: wt }}
        gitStatus={state.gitStatuses[wt.repoPath + ':' + wt.name]}
        onclick={() => handleStartWorktreeSession(wt)}
        onresumeYolo={() => handleStartWorktreeSession(wt, true)}
        ondelete={() => onDeleteWorktree(wt)}
      />
    {/each}
  {:else}
    {#if ui.repoFilter}
      <div class="pr-toolbar">
        <button
          class="refresh-btn"
          onclick={() => prQuery.refetch()}
          disabled={prQuery.isFetching}
          aria-label="Refresh pull requests"
        >
          <span class:spinning={prQuery.isFetching}>↻</span>
        </button>
      </div>
    {/if}
    {#if !ui.repoFilter}
      <li class="pr-hint">Select a repo to view pull requests</li>
    {:else if prQuery.isLoading}
      <li class="pr-hint">Loading pull requests...</li>
    {:else if prError === 'gh_not_authenticated'}
      <li class="pr-hint">GitHub CLI not authenticated<br /><span class="pr-hint-sub">Run <code>gh auth login</code> on the host</span></li>
    {:else if prError}
      <li class="pr-hint">Could not fetch pull requests</li>
    {:else if filteredPullRequests.length === 0}
      <li class="pr-hint">No open pull requests</li>
    {:else}
      {#each filteredPullRequests as pr (pr.number)}
        <PullRequestItem
          {pr}
          isActiveSession={!!findSessionForBranch(pr.headRefName)}
          isSelected={activeSession?.type === 'worktree' && activeSession?.branchName === pr.headRefName && activeSession?.repoName === ui.repoFilter}
          onclick={() => handlePRClick(pr)}
          onYolo={() => handlePRClick(pr, true)}
        />
      {/each}
    {/if}
  {/if}
</ul>

<style>
  .session-list-tabs {
    display: flex;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
  }

  .sidebar-tab {
    flex: 1;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: 0.7rem;
    padding: 6px 4px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    text-align: center;
  }

  .sidebar-tab:hover {
    color: var(--text);
  }

  .sidebar-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-count {
    opacity: 0.7;
  }

  .session-list {
    list-style: none;
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  :global(.session-divider) {
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px 4px;
    opacity: 0.6;
    list-style: none;
  }

  .pr-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 4px 10px 0;
  }

  .refresh-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.85rem;
    cursor: pointer;
    padding: 2px 6px;
    transition: color 0.15s, border-color 0.15s;
  }

  .refresh-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .refresh-btn:disabled {
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

  :global(.pr-hint) {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
    padding: 20px 12px;
    opacity: 0.6;
    list-style: none;
  }

  :global(.pr-hint-sub) {
    font-size: 0.65rem;
    opacity: 0.8;
    display: block;
    margin-top: 4px;
  }

  :global(.pr-hint code) {
    background: var(--bg);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.65rem;
  }
</style>
