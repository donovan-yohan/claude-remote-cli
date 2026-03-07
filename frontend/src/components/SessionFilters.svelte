<script lang="ts">
  import { getUi } from '../lib/state/ui.svelte.js';
  import { getSessionState } from '../lib/state/sessions.svelte.js';
  import { rootShortName } from '../lib/utils.js';
  import SearchableSelect from './SearchableSelect.svelte';

  const ui = getUi();
  const state = getSessionState();

  let availableRoots = $derived((() => {
    const roots = new Set<string>();
    for (const s of state.sessions) { if (s.root) roots.add(s.root); }
    for (const wt of state.worktrees) { if (wt.root) roots.add(wt.root); }
    for (const r of state.repos) { if (r.root) roots.add(r.root); }
    return [...roots].sort();
  })());

  let availableRepos = $derived((() => {
    const repos = new Set<string>();
    for (const s of state.sessions) {
      if ((!ui.rootFilter || s.root === ui.rootFilter) && s.repoName) repos.add(s.repoName);
    }
    for (const wt of state.worktrees) {
      if ((!ui.rootFilter || wt.root === ui.rootFilter) && wt.repoName) repos.add(wt.repoName);
    }
    for (const r of state.repos) {
      if ((!ui.rootFilter || r.root === ui.rootFilter) && r.name) repos.add(r.name);
    }
    return [...repos].sort();
  })());

  let rootOptions = $derived(
    availableRoots.map(r => ({ value: r, label: rootShortName(r) })),
  );

  let repoOptions = $derived(
    availableRepos.map(r => ({ value: r, label: r })),
  );
</script>

<div class="sidebar-filters">
  {#if ui.activeTab !== 'terminals'}
    <SearchableSelect
      options={rootOptions}
      value={ui.rootFilter}
      placeholder="All roots"
      onchange={(v) => { ui.rootFilter = v; ui.repoFilter = ''; }}
    />

    <SearchableSelect
      options={repoOptions}
      value={ui.repoFilter}
      placeholder="All repos"
      onchange={(v) => { ui.repoFilter = v; }}
    />
  {/if}

  <input
    type="text"
    placeholder="Search..."
    value={ui.searchFilter}
    oninput={(e) => { ui.searchFilter = (e.target as HTMLInputElement).value; }}
  />

  {#if ui.activeTab === 'prs'}
    <div class="role-filter">
      <button
        class="role-btn"
        class:active={ui.prRoleFilter === 'all'}
        onclick={() => { ui.prRoleFilter = 'all'; }}
      >All</button>
      <button
        class="role-btn"
        class:active={ui.prRoleFilter === 'author'}
        onclick={() => { ui.prRoleFilter = 'author'; }}
      >Author</button>
      <button
        class="role-btn"
        class:active={ui.prRoleFilter === 'reviewer'}
        onclick={() => { ui.prRoleFilter = 'reviewer'; }}
      >Reviewer</button>
    </div>
  {/if}
</div>

<style>
  .sidebar-filters {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    flex-shrink: 0;
  }

  input {
    padding: 6px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.75rem;
    outline: none;
    -webkit-appearance: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .role-filter {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .role-btn {
    flex: 1;
    padding: 5px 8px;
    background: var(--bg);
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.7rem;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .role-btn:last-child {
    border-right: none;
  }

  .role-btn:hover {
    color: var(--text);
  }

  .role-btn.active {
    background: var(--accent);
    color: #fff;
  }
</style>
