<script lang="ts">
  import { fetchBranches, createSession, createRepoSession, fetchRepos } from '../../lib/api.js';
  import { getSessionState, refreshAll } from '../../lib/state/sessions.svelte.js';
  import { getUi } from '../../lib/state/ui.svelte.js';
  import { rootShortName } from '../../lib/utils.js';
  import type { RepoInfo } from '../../lib/types.js';

  let {
    preselectedRepo = null,
    onSessionCreated,
  }: {
    preselectedRepo?: RepoInfo | null;
    onSessionCreated?: (sessionId: string) => void;
  } = $props();

  const ui = getUi();

  let dialogEl: HTMLDialogElement;

  // Tab state — mirrors sidebar's activeTab
  let activeTab = $state<'repos' | 'worktrees'>('repos');

  // Repo data
  let allRepos = $state<RepoInfo[]>([]);

  // Form state
  let selectedRoot = $state('');
  let selectedRepoPath = $state('');
  let branchInput = $state('');
  let claudeArgsInput = $state('');
  let yoloMode = $state(false);
  let continueExisting = $state(false);

  // Branch autocomplete
  let allBranches = $state<string[]>([]);
  let branchDropdownVisible = $state(false);

  // Derived
  let roots = $derived.by(() => {
    const r = new Set<string>();
    allRepos.forEach(repo => { if (repo.root) r.add(repo.root); });
    return Array.from(r).sort();
  });

  let filteredRepos = $derived.by(() => {
    if (!selectedRoot) return [];
    return allRepos.filter(r => r.root === selectedRoot).sort((a, b) => a.name.localeCompare(b.name));
  });

  let filteredBranches = $derived.by(() => {
    if (!branchInput.trim()) return [];
    const lower = branchInput.toLowerCase();
    return allBranches.filter(b => b.toLowerCase().includes(lower)).slice(0, 10);
  });

  let hasExactBranchMatch = $derived(
    allBranches.some(b => b === branchInput),
  );

  async function loadBranchesForRepo(repoPath: string) {
    allBranches = [];
    if (!repoPath) return;
    try {
      allBranches = await fetchBranches(repoPath);
    } catch {
      allBranches = [];
    }
  }

  function onRootChange() {
    selectedRepoPath = '';
    branchInput = '';
    allBranches = [];
  }

  function onRepoChange() {
    branchInput = '';
    allBranches = [];
    if (selectedRepoPath) {
      loadBranchesForRepo(selectedRepoPath);
    }
  }

  function onBranchInput() {
    branchDropdownVisible = branchInput.trim().length > 0;
  }

  function selectBranch(branch: string) {
    branchInput = branch;
    branchDropdownVisible = false;
  }

  function reset() {
    selectedRoot = '';
    selectedRepoPath = '';
    branchInput = '';
    claudeArgsInput = '';
    yoloMode = false;
    continueExisting = false;
    allBranches = [];
    branchDropdownVisible = false;
  }

  export async function open(repo?: RepoInfo | null, options?: { yolo?: boolean; tab?: 'repos' | 'worktrees' }) {
    reset();
    if (options?.yolo) yoloMode = true;
    activeTab = options?.tab ?? (ui.activeTab === 'prs' ? 'repos' : ui.activeTab);

    // Load repos fresh
    try {
      allRepos = await fetchRepos();
    } catch {
      allRepos = [];
    }

    // Pre-select from explicit repo argument, prop, or sidebar filters
    const target = repo ?? preselectedRepo;
    if (target?.root) {
      selectedRoot = target.root;
      // Wait a tick so filtered repos are derived
      await Promise.resolve();
      selectedRepoPath = target.path;
      await loadBranchesForRepo(target.path);
    } else {
      // No explicit repo — pre-fill from sidebar filters
      if (ui.repoFilter) {
        // Find matching repo by name (optionally scoped to root filter)
        const matchingRepo = allRepos.find(r =>
          r.name === ui.repoFilter && (!ui.rootFilter || r.root === ui.rootFilter)
        );
        if (matchingRepo?.root) {
          selectedRoot = matchingRepo.root;
          await Promise.resolve();
          selectedRepoPath = matchingRepo.path;
          if (activeTab === 'worktrees') {
            await loadBranchesForRepo(matchingRepo.path);
          }
        }
      } else if (ui.rootFilter) {
        selectedRoot = ui.rootFilter;
      }
    }

    dialogEl.showModal();
  }

  export function close() {
    dialogEl.close();
  }

  async function handleSubmit() {
    const repoPath = selectedRepoPath;
    if (!repoPath) return;

    const claudeArgs: string[] = [];
    if (yoloMode) claudeArgs.push('--dangerously-skip-permissions');
    if (claudeArgsInput.trim()) {
      claudeArgsInput.trim().split(/\s+/).forEach(arg => {
        if (arg) claudeArgs.push(arg);
      });
    }

    try {
      let session;
      if (activeTab === 'repos') {
        session = await createRepoSession({
          repoPath,
          repoName: repoPath.split('/').filter(Boolean).pop(),
          continue: continueExisting,
          claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
        });
      } else {
        session = await createSession({
          repoPath,
          repoName: repoPath.split('/').filter(Boolean).pop(),
          branchName: branchInput.trim() || undefined,
          claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
        });
      }
      dialogEl.close();
      await refreshAll();
      if (session?.id) {
        // If backend redirected a worktree request to a repo session,
        // switch to the repos tab so the user can see it
        if (activeTab === 'worktrees' && session.type === 'repo') {
          ui.activeTab = 'repos';
        }
        onSessionCreated?.(session.id);
      }
    } catch (err: unknown) {
      // Handle 409 conflict (existing session for repo)
      if (err instanceof Error && 'sessionId' in err) {
        const conflictErr = err as Error & { sessionId?: string };
        dialogEl.close();
        await refreshAll();
        if (conflictErr.sessionId) {
          onSessionCreated?.(conflictErr.sessionId);
        }
      }
    }
  }

  function onDialogClick(e: MouseEvent) {
    // Close when clicking on the backdrop
    if (e.target === dialogEl) {
      dialogEl.close();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (!branchDropdownVisible) return;
    if (e.key === 'Escape') {
      branchDropdownVisible = false;
      e.stopPropagation();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogEl}
  onclick={onDialogClick}
  onkeydown={onKeydown}
  class="dialog"
>
  <div class="dialog-content">
    <h2 class="dialog-title">
      {activeTab === 'repos' ? 'New Session' : 'New Worktree'}
    </h2>

    <!-- Tabs -->
    <div class="dialog-tabs">
      <button
        class="dialog-tab"
        class:active={activeTab === 'repos'}
        onclick={() => { activeTab = 'repos'; }}
      >Repos</button>
      <button
        class="dialog-tab"
        class:active={activeTab === 'worktrees'}
        onclick={() => { activeTab = 'worktrees'; }}
      >Worktrees</button>
    </div>

    <div class="dialog-body">
      <!-- Root select -->
      <div class="dialog-field">
        <label class="dialog-label" for="ns-root">Root directory</label>
        <select
          id="ns-root"
          class="dialog-select"
          bind:value={selectedRoot}
          onchange={onRootChange}
        >
          <option value="">Select a root...</option>
          {#each roots as root (root)}
            <option value={root}>{rootShortName(root)}</option>
          {/each}
        </select>
      </div>

      <!-- Repo select -->
      <div class="dialog-field">
        <label class="dialog-label" for="ns-repo">Repository</label>
        <select
          id="ns-repo"
          class="dialog-select"
          bind:value={selectedRepoPath}
          onchange={onRepoChange}
          disabled={!selectedRoot}
        >
          <option value="">Select a repo...</option>
          {#each filteredRepos as repo (repo.path)}
            <option value={repo.path}>{repo.name}</option>
          {/each}
        </select>
      </div>

      <!-- Branch input (worktrees only) -->
      {#if activeTab === 'worktrees'}
        <div class="dialog-field">
          <label class="dialog-label" for="ns-branch">Branch name</label>
          <div class="branch-input-wrap">
            <input
              id="ns-branch"
              type="text"
              class="dialog-input"
              placeholder="e.g. feat/my-feature"
              bind:value={branchInput}
              oninput={onBranchInput}
              onfocus={() => { if (branchInput.trim()) branchDropdownVisible = true; }}
              autocomplete="off"
            />
            {#if branchDropdownVisible && (filteredBranches.length > 0 || (branchInput.trim() && !hasExactBranchMatch))}
              <ul class="branch-dropdown">
                {#if !hasExactBranchMatch && branchInput.trim()}
                  <li
                    class="branch-create-new"
                    onmousedown={() => selectBranch(branchInput.trim())}
                    role="option"
                    aria-selected="false"
                  >
                    Create new: {branchInput.trim()}
                  </li>
                {/if}
                {#each filteredBranches as branch (branch)}
                  <li
                    onmousedown={() => selectBranch(branch)}
                    role="option"
                    aria-selected="false"
                  >{branch}</li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Continue existing (repos only) -->
      {#if activeTab === 'repos'}
        <div class="dialog-field dialog-field--inline">
          <input
            id="ns-continue"
            type="checkbox"
            class="dialog-checkbox"
            bind:checked={continueExisting}
          />
          <label for="ns-continue" class="dialog-label-inline">Continue existing session</label>
        </div>
      {/if}

      <!-- Yolo mode -->
      <div class="dialog-field dialog-field--inline">
        <input
          id="ns-yolo"
          type="checkbox"
          class="dialog-checkbox"
          bind:checked={yoloMode}
        />
        <label for="ns-yolo" class="dialog-label-inline">Yolo mode (skip permission checks)</label>
      </div>

      <!-- Extra claude args -->
      <div class="dialog-field">
        <label class="dialog-label" for="ns-args">Extra claude args (optional)</label>
        <input
          id="ns-args"
          type="text"
          class="dialog-input"
          placeholder="e.g. --model claude-3-5-sonnet"
          bind:value={claudeArgsInput}
          autocomplete="off"
        />
      </div>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-ghost" onclick={() => dialogEl.close()}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleSubmit}
        disabled={!selectedRepoPath}
      >
        {activeTab === 'repos' ? 'Start Session' : 'Create Worktree'}
      </button>
    </div>
  </div>
</dialog>

<style>
  .dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0;
    width: min(480px, 95vw);
    max-height: 90vh;
    overflow: hidden;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.6);
  }

  .dialog-content {
    display: flex;
    flex-direction: column;
    max-height: 90vh;
    overflow: hidden;
  }

  .dialog-title {
    font-size: 1.1rem;
    font-weight: 600;
    padding: 16px 20px 12px;
    margin: 0;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dialog-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .dialog-tab {
    flex: 1;
    padding: 10px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.9rem;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }

  .dialog-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .dialog-tab:hover:not(.active) {
    color: var(--text);
  }

  .dialog-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .dialog-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .dialog-field--inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .dialog-label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .dialog-label-inline {
    font-size: 0.9rem;
    cursor: pointer;
  }

  .dialog-select,
  .dialog-input {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
    padding: 7px 10px;
    width: 100%;
    box-sizing: border-box;
  }

  .dialog-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dialog-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }

  .branch-input-wrap {
    position: relative;
  }

  .branch-dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    z-index: 100;
    max-height: 180px;
    overflow-y: auto;
  }

  .branch-dropdown li {
    padding: 7px 12px;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .branch-dropdown li:hover {
    background: var(--border);
  }

  .branch-create-new {
    color: var(--accent);
    border-bottom: 1px solid var(--border);
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .btn {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    border: 1px solid transparent;
    font-weight: 500;
    transition: opacity 0.15s;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border);
  }

  .btn-ghost:hover {
    background: var(--border);
    color: var(--text);
  }
</style>
