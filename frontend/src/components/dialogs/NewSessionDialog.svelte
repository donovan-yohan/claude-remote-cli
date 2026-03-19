<script lang="ts">
  import { fetchBranches, createSession, createRepoSession } from '../../lib/api.js';
  import { refreshAll } from '../../lib/state/sessions.svelte.js';
  import { getConfigState, refreshConfig } from '../../lib/state/config.svelte.js';
  import type { RepoInfo, AgentType, OpenSessionOptions } from '../../lib/types.js';

  let {
    preselectedRepo = null,
    onSessionCreated,
  }: {
    preselectedRepo?: RepoInfo | null;
    onSessionCreated?: (sessionId: string) => void;
  } = $props();

  const config = getConfigState();

  let dialogEl: HTMLDialogElement;

  // Tab state — 'repos' = repo session, 'worktrees' = worktree session
  let activeTab = $state<'repos' | 'worktrees'>('repos');

  // Selected workspace/repo
  let selectedRepoPath = $state('');
  let selectedRepoName = $state('');

  // Form state
  let branchInput = $state('');
  let claudeArgsInput = $state('');
  let selectedAgent = $state<AgentType>('claude');
  let yoloMode = $state(false);
  let continueExisting = $state(false);
  let useTmux = $state(false);

  // Branch autocomplete
  let allBranches = $state<string[]>([]);
  let branchDropdownVisible = $state(false);
  let branchesLoading = $state(false);
  let branchesRefreshing = $state(false);
  let creating = $state(false);
  let branchRequestId = 0;

  // Derived
  let filteredBranches = $derived.by(() => {
    if (!branchInput.trim()) return [];
    const lower = branchInput.toLowerCase();
    return allBranches.filter(b => b.toLowerCase().includes(lower)).slice(0, 10);
  });

  let hasExactBranchMatch = $derived(
    allBranches.some(b => b === branchInput),
  );

  async function loadBranchesForRepo(repoPath: string, options: { refresh?: boolean; preserveExisting?: boolean } = {}) {
    const requestId = ++branchRequestId;
    if (!repoPath) return;
    if (!options.preserveExisting) {
      allBranches = [];
    }
    if (options.refresh) {
      branchesRefreshing = true;
    } else {
      branchesLoading = true;
    }
    try {
      const branches = await fetchBranches(repoPath, options.refresh ? { refresh: true } : {});
      if (requestId !== branchRequestId || repoPath !== selectedRepoPath) return;
      allBranches = branches;
      if (branchInput.trim()) {
        branchDropdownVisible = true;
      }
    } catch {
      if (requestId !== branchRequestId || repoPath !== selectedRepoPath) return;
      if (!options.preserveExisting) {
        allBranches = [];
      }
    } finally {
      if (requestId === branchRequestId) {
        branchesLoading = false;
        branchesRefreshing = false;
      }
    }
  }

  async function refreshBranches() {
    if (!selectedRepoPath || branchesRefreshing) return;
    await loadBranchesForRepo(selectedRepoPath, { refresh: true, preserveExisting: true });
  }

  function resetBranchState() {
    branchRequestId += 1;
    branchInput = '';
    allBranches = [];
    branchDropdownVisible = false;
    branchesLoading = false;
    branchesRefreshing = false;
  }

  function onBranchInput() {
    branchDropdownVisible = branchInput.trim().length > 0;
  }

  function selectBranch(branch: string) {
    branchInput = branch;
    branchDropdownVisible = false;
  }

  function reset() {
    selectedRepoPath = '';
    selectedRepoName = '';
    claudeArgsInput = '';
    yoloMode = false;
    continueExisting = false;
    useTmux = false;
    resetBranchState();
  }

  export async function open(repo?: RepoInfo | null, options?: OpenSessionOptions) {
    reset();
    activeTab = 'repos';

    await refreshConfig();
    selectedAgent = config.defaultAgent as AgentType;
    if (options?.agent) selectedAgent = options.agent;

    yoloMode = config.defaultYolo;
    continueExisting = config.defaultContinue;
    useTmux = config.launchInTmux;

    if (options?.yolo !== undefined) yoloMode = options.yolo;
    if (options?.useTmux !== undefined) useTmux = options.useTmux;

    // Pre-select repo from explicit argument or prop
    const target = repo ?? preselectedRepo;
    if (target) {
      selectedRepoPath = target.path;
      selectedRepoName = target.name;
      if (options?.branchName) {
        activeTab = 'worktrees';
        await loadBranchesForRepo(target.path);
      }
    }

    // Apply pre-fill overrides
    if (options?.branchName) branchInput = options.branchName;
    if (options?.claudeArgs) claudeArgsInput = options.claudeArgs;

    dialogEl.showModal();
  }

  export function close() {
    dialogEl.close();
  }

  async function handleSubmit() {
    const repoPath = selectedRepoPath;
    if (!repoPath || creating) return;
    creating = true;

    const claudeArgs = claudeArgsInput.trim().split(/\s+/).filter(Boolean);

    // Estimate terminal dimensions from window size so PTY starts at correct size
    const cols = Math.max(80, Math.floor((window.innerWidth - 60) / 8));
    const rows = Math.max(24, Math.floor((window.innerHeight - 120) / 17));

    try {
      let session;
      if (activeTab === 'repos') {
        session = await createRepoSession({
          repoPath,
          repoName: selectedRepoName || repoPath.split('/').filter(Boolean).pop(),
          continue: continueExisting,
          yolo: yoloMode,
          claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
          agent: selectedAgent,
          useTmux,
          cols,
          rows,
          allowMultiple: true,
        });
      } else {
        session = await createSession({
          repoPath,
          repoName: selectedRepoName || repoPath.split('/').filter(Boolean).pop(),
          branchName: branchInput.trim() || undefined,
          yolo: yoloMode,
          claudeArgs: claudeArgs.length > 0 ? claudeArgs : undefined,
          agent: selectedAgent,
          useTmux,
          cols,
          rows,
        });
      }
      dialogEl.close();
      await refreshAll();
      if (session?.id) {
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
    } finally {
      creating = false;
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
      {#if selectedRepoName}
        <span class="dialog-title-repo">— {selectedRepoName}</span>
      {/if}
    </h2>

    <!-- Tabs -->
    <div class="dialog-tabs">
      <button
        class="dialog-tab"
        class:active={activeTab === 'repos'}
        onclick={() => { activeTab = 'repos'; }}
      >Repo Session</button>
      <button
        class="dialog-tab"
        class:active={activeTab === 'worktrees'}
        onclick={() => {
          activeTab = 'worktrees';
          if (selectedRepoPath && allBranches.length === 0) {
            loadBranchesForRepo(selectedRepoPath);
          }
        }}
      >Worktree</button>
    </div>

    <div class="dialog-body">
      <!-- Coding agent select -->
      <div class="dialog-field">
        <label class="dialog-label" for="ns-agent">Coding agent</label>
        <select
          id="ns-agent"
          class="dialog-select"
          bind:value={selectedAgent}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </div>

      <!-- Branch input (worktrees only) -->
      {#if activeTab === 'worktrees'}
        <div class="dialog-field">
          <div class="dialog-label-row">
            <label class="dialog-label" for="ns-branch">Branch name</label>
            <button
              type="button"
              class="branch-refresh"
              onclick={refreshBranches}
              disabled={!selectedRepoPath || branchesLoading || branchesRefreshing}
              aria-label="Fetch latest remote branches"
              title="Fetch latest remote branches"
            >
              <svg
                class:spinning={branchesLoading || branchesRefreshing}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M20 12a8 8 0 0 1-13.66 5.66M4 12a8 8 0 0 1 13.66-5.66M17 3.5v4h-4M7 20.5v-4h4"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.8"
                />
              </svg>
            </button>
          </div>
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

      <!-- Launch in tmux -->
      <div class="dialog-field dialog-field--inline">
        <input
          id="ns-tmux"
          type="checkbox"
          class="dialog-checkbox"
          bind:checked={useTmux}
        />
        <label for="ns-tmux" class="dialog-label-inline">Launch in tmux</label>
      </div>

      <!-- Extra claude args -->
      <div class="dialog-field">
        <label class="dialog-label" for="ns-args">Extra args (optional)</label>
        <input
          id="ns-args"
          type="text"
          class="dialog-input"
          placeholder="e.g. --verbose"
          bind:value={claudeArgsInput}
          autocomplete="off"
        />
      </div>
    </div>

    <div class="dialog-footer">
      <button class="btn btn-ghost" onclick={() => dialogEl.close()} disabled={creating}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleSubmit}
        disabled={!selectedRepoPath || creating}
      >
        {creating ? 'Creating...' : activeTab === 'repos' ? 'Start Session' : 'Create Worktree'}
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

  .dialog-title-repo {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 1rem;
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

  .dialog-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
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

  .branch-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }

  .branch-refresh:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }

  .branch-refresh:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .branch-refresh svg {
    width: 15px;
    height: 15px;
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

  .spinning {
    animation: spin 1s linear infinite;
    transform-origin: center;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
