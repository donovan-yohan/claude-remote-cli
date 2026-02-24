<script lang="ts">
  import { getUi } from '../lib/state/ui.svelte.js';
  import { getSessionState, getSessionStatus, clearAttention } from '../lib/state/sessions.svelte.js';
  import * as api from '../lib/api.js';
  import { refreshAll } from '../lib/state/sessions.svelte.js';
  import type { SessionSummary, WorktreeInfo, RepoInfo } from '../lib/types.js';
  import SessionItem from './SessionItem.svelte';

  const ui = getUi();
  const state = getSessionState();

  let {
    onSelectSession,
    onOpenNewSession,
    onContextMenu,
  }: {
    onSelectSession: (id: string) => void;
    onOpenNewSession: (repo?: RepoInfo) => void;
    onContextMenu: (e: MouseEvent, wt: WorktreeInfo) => void;
  } = $props();

  let startingWorktreePathPath: string | null = null;

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

  // Tab counts
  let reposCount = $derived(filteredRepoSessions.length + filteredIdleRepos.length);
  let worktreesCount = $derived(filteredWorktreeSessions.length + filteredWorktrees.length);

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

  async function handleStartWorktreeSession(wt: WorktreeInfo) {
    if (startingWorktreePath) return;
    startingWorktreePath = wt.path;
    try {
      const session = await api.createSession({
        repoPath: wt.repoPath,
        repoName: wt.repoName,
        worktreePath: wt.path,
      });
      await refreshAll();
      if (session?.id) {
        onSelectSession(session.id);
      }
    } catch {
      // Ignore — user can retry
    } finally {
      startingWorktreePath = null;
    }
  }

  function handleStartRepoSession(repo: RepoInfo) {
    onOpenNewSession(repo);
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
</div>

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
      />
    {/each}
  {:else}
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
        oncontextmenu={(e) => onContextMenu(e, wt)}
      />
    {/each}
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
</style>
