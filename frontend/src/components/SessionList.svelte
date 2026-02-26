<script lang="ts">
  import { getUi } from '../lib/state/ui.svelte.js';
  import { getSessionState, getSessionStatus, clearAttention, refreshAll, setLoading, clearLoading, isItemLoading } from '../lib/state/sessions.svelte.js';
  import * as api from '../lib/api.js';
  import { ConflictError } from '../lib/api.js';
  import type { SessionSummary, WorktreeInfo, RepoInfo, PullRequest } from '../lib/types.js';
  import { rootShortName } from '../lib/utils.js';
  import SessionItem from './SessionItem.svelte';
  import SessionFilters from './SessionFilters.svelte';
  import PrRepoGroup from './PrRepoGroup.svelte';

  const ui = getUi();
  const sessionState = getSessionState();

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

  // Split sessions by type
  let repoSessions = $derived(sessionState.sessions.filter(s => s.type === 'repo'));
  let worktreeSessions = $derived(sessionState.sessions.filter(s => s.type !== 'repo'));

  // Repos that have an active session
  let activeRepoPaths = $derived(new Set(repoSessions.map(s => s.repoPath)));

  // Worktrees that have an active session
  let activeWorktreePaths = $derived(new Set(worktreeSessions.map(s => s.repoPath).filter(Boolean)));

  function compareAlpha(a: string | undefined, b: string | undefined): number {
    return (a || '').localeCompare(b || '');
  }

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

  // Compare by most recent activity (descending — newest first), falling back to 0 (epoch)
  function compareRecent(a: string | undefined, b: string | undefined): number {
    return new Date(b || 0).getTime() - new Date(a || 0).getTime();
  }

  // Repos tab
  let filteredRepoSessions = $derived(
    repoSessions
      .filter(s => matchesFilters(s.root, s.repoName, s.displayName || s.repoName || s.id))
      .sort((a, b) => compareAlpha(a.root, b.root) || compareAlpha(a.repoName, b.repoName) || compareRecent(a.lastActivity, b.lastActivity)),
  );

  let filteredIdleRepos = $derived(
    sessionState.repos
      .filter(r => !activeRepoPaths.has(r.path) && matchesFilters(r.root, r.name, r.name))
      .sort((a, b) => compareAlpha(a.root, b.root) || compareAlpha(a.name, b.name)),
  );

  // Worktrees tab — filtered lists
  let filteredWorktreeSessions = $derived(
    worktreeSessions
      .filter(s => matchesFilters(s.root, s.repoName, s.displayName || s.repoName || s.worktreeName || s.id))
      .sort((a, b) => compareAlpha(a.root, b.root) || compareAlpha(a.repoName, b.repoName) || compareRecent(a.lastActivity, b.lastActivity)),
  );

  let filteredWorktrees = $derived(
    sessionState.worktrees
      .filter(wt => !activeWorktreePaths.has(wt.path) && matchesFilters(wt.root, wt.repoName, wt.name))
      .sort((a, b) => compareAlpha(a.root, b.root) || compareAlpha(a.repoName, b.repoName) || compareRecent(a.lastActivity, b.lastActivity)),
  );

  // Worktrees tab — idle worktrees grouped by repo (keyed on root:repoName to handle same name across roots)
  let worktreeRepoGroups = $derived((() => {
    const groups = new Map<string, { key: string; repoName: string; root: string; worktrees: WorktreeInfo[] }>();

    for (const wt of filteredWorktrees) {
      const repoName = wt.repoName || wt.name;
      const key = (wt.root || '') + ':' + repoName;
      if (!groups.has(key)) {
        groups.set(key, { key, repoName, root: wt.root, worktrees: [] });
      }
      groups.get(key)!.worktrees.push(wt);
    }

    return [...groups.values()].sort((a, b) => compareAlpha(a.root, b.root) || compareAlpha(a.repoName, b.repoName));
  })());

  // Derive a RepoInfo from a worktree group (for opening the New Worktree modal)
  function repoForGroup(group: { repoName: string; root: string; worktrees: WorktreeInfo[] }): RepoInfo {
    const repoPath = group.worktrees[0]?.repoPath || '';
    return { name: group.repoName, path: repoPath, root: group.root };
  }

  // Worktree repo collapse state (all expanded by default)
  let collapsedWorktreeRepos = $state(new Set<string>());

  function toggleWorktreeRepo(key: string) {
    const next = new Set(collapsedWorktreeRepos);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    collapsedWorktreeRepos = next;
  }

  // PRs tab — repos to show as collapsible groups
  let prRepos = $derived(
    sessionState.repos
      .filter(r => {
        if (ui.rootFilter && r.root !== ui.rootFilter) return false;
        if (ui.repoFilter && r.name !== ui.repoFilter) return false;
        return true;
      })
      .sort((a, b) => compareAlpha(a.root, b.root) || compareAlpha(a.name, b.name))
  );

  // Active session (for PR selected highlighting)
  let activeSession = $derived(
    sessionState.activeSessionId ? sessionState.sessions.find(s => s.id === sessionState.activeSessionId) : undefined,
  );

  // Tab counts
  let reposCount = $derived(filteredRepoSessions.length + filteredIdleRepos.length);
  let worktreesCount = $derived(filteredWorktreeSessions.length + filteredWorktrees.length);
  let prsCount = $derived(prRepos.length);

  // PR click cascade helpers — match by git branch name
  function findSessionForBranch(branchName: string): SessionSummary | undefined {
    return sessionState.sessions.find(s =>
      s.type === 'worktree' && s.branchName === branchName
    );
  }

  function findWorktreeForBranch(branchName: string): WorktreeInfo | undefined {
    return sessionState.worktrees.find(wt => wt.branchName === branchName);
  }

  async function handlePRClick(pr: PullRequest, repo: RepoInfo, yolo = false) {
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
      const key = existingWorktree.path;
      setLoading(key);
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
      } catch { /* user can retry */ } finally {
        clearLoading(key);
      }
      return;
    }

    // Step 3: No local worktree → create new worktree + session
    const key = repo.path + ':' + pr.headRefName;
    setLoading(key);
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
    } catch { /* user can retry */ } finally {
      clearLoading(key);
    }
  }

  async function handleKillSession(session: SessionSummary) {
    const key = session.id;
    setLoading(key);
    try {
      await api.killSession(session.id);
      await refreshAll();
      if (sessionState.activeSessionId === session.id) {
        sessionState.activeSessionId = null;
      }
    } finally {
      clearLoading(key);
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
    const key = wt.path;
    if (isItemLoading(key)) return;
    setLoading(key);
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
      clearLoading(key);
    }
  }

  async function handleStartRepoSession(repo: RepoInfo, yolo = false) {
    const key = repo.path;
    setLoading(key);
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
    } finally {
      clearLoading(key);
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
    {#if filteredRepoSessions.length > 0}
      <li class="session-divider">Active</li>
    {/if}
    {#each filteredRepoSessions as session (session.id)}
      <SessionItem
        variant={{ kind: 'active', session, status: getSessionStatus(session), isSelected: sessionState.activeSessionId === session.id }}
        gitStatus={sessionState.gitStatuses[session.repoPath + ':' + session.worktreeName]}
        isLoading={isItemLoading(session.id)}
        onclick={() => handleSelectSession(session)}
        onkill={() => handleKillSession(session)}
        onrename={() => handleRenameSession(session)}
      />
    {/each}
    {#if filteredIdleRepos.length > 0}
      <li class="session-divider">Available</li>
    {/if}
    {#each filteredIdleRepos as repo (repo.path)}
      <SessionItem
        variant={{ kind: 'idle-repo', repo }}
        isLoading={isItemLoading(repo.path)}
        onclick={() => handleStartRepoSession(repo)}
        onresumeYolo={() => handleStartRepoSession(repo, true)}
        onNewWorktree={() => onNewWorktree(repo)}
      />
    {/each}
  {:else if ui.activeTab === 'worktrees'}
    {#if filteredWorktreeSessions.length > 0}
      <li class="session-divider">Active</li>
      {#each filteredWorktreeSessions as session (session.id)}
        <SessionItem
          variant={{ kind: 'active', session, status: getSessionStatus(session), isSelected: sessionState.activeSessionId === session.id }}
          gitStatus={sessionState.gitStatuses[session.repoPath + ':' + session.worktreeName]}
          isLoading={isItemLoading(session.id)}
          onclick={() => handleSelectSession(session)}
          onkill={() => handleKillSession(session)}
          onrename={() => handleRenameSession(session)}
        />
      {/each}
    {/if}
    {#if worktreeRepoGroups.length > 0}
      <li class="session-divider">Available</li>
    {/if}
    {#each worktreeRepoGroups as group (group.key)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <li class="repo-group-header" onclick={() => toggleWorktreeRepo(group.key)}>
        <span class="chevron" class:expanded={!collapsedWorktreeRepos.has(group.key)}>&#9654;</span>
        <span class="repo-group-name">{group.repoName}</span>
        <span class="repo-group-root">{rootShortName(group.root)}</span>
        <span class="repo-group-count">{group.worktrees.length}</span>
        <button
          class="repo-group-add"
          onclick={(e: MouseEvent) => { e.stopPropagation(); onNewWorktree(repoForGroup(group)); }}
          aria-label="New worktree for {group.repoName}"
        >+</button>
      </li>
      {#if !collapsedWorktreeRepos.has(group.key)}
        {#each group.worktrees as wt (wt.path)}
          <SessionItem
            variant={{ kind: 'inactive-worktree', worktree: wt }}
            gitStatus={sessionState.gitStatuses[wt.repoPath + ':' + wt.name]}
            isLoading={isItemLoading(wt.path)}
            onclick={() => handleStartWorktreeSession(wt)}
            onresumeYolo={() => handleStartWorktreeSession(wt, true)}
            ondelete={() => onDeleteWorktree(wt)}
          />
        {/each}
      {/if}
    {/each}
  {:else}
    {#if prRepos.length === 0}
      <li class="pr-hint">No repos found</li>
    {:else}
      {#each prRepos as repo (repo.path)}
        <PrRepoGroup
          {repo}
          {findSessionForBranch}
          {activeSession}
          onPRClick={handlePRClick}
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

  :global(.repo-group-header) {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    cursor: pointer;
    list-style: none;
    transition: background 0.15s;
    border-radius: 4px;
    margin: 2px 6px;
  }

  :global(.repo-group-header:hover) {
    background: var(--border);
  }

  :global(.chevron) {
    display: inline-block;
    font-size: 0.55rem;
    transition: transform 0.15s;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  :global(.chevron.expanded) {
    transform: rotate(90deg);
  }

  :global(.repo-group-name) {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  :global(.repo-group-root) {
    font-size: 0.6rem;
    color: var(--text-muted);
    opacity: 0.6;
    flex-shrink: 0;
  }

  :global(.repo-group-count) {
    font-size: 0.6rem;
    color: var(--text-muted);
    opacity: 0.5;
    margin-left: auto;
    flex-shrink: 0;
  }

  :global(.repo-group-add) {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0 4px;
    flex-shrink: 0;
    line-height: 1;
    transition: color 0.15s;
    opacity: 0;
  }

  :global(.repo-group-header:hover .repo-group-add) {
    opacity: 1;
  }

  :global(.repo-group-add:hover),
  :global(.repo-group-add:focus-visible) {
    color: var(--accent);
    opacity: 1;
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
