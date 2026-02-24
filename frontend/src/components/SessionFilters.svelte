<script lang="ts">
  import { getUi } from '../lib/state/ui.svelte.js';
  import { getSessionState } from '../lib/state/sessions.svelte.js';
  import { rootShortName } from '../lib/utils.js';

  const ui = getUi();
  const state = getSessionState();

  let availableRoots = $derived((() => {
    const roots = new Set<string>();
    for (const s of state.sessions) { if (s.root) roots.add(s.root); }
    for (const wt of state.worktrees) { if (wt.root) roots.add(wt.root); }
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
    return [...repos].sort();
  })());
</script>

<div class="sidebar-filters">
  <select
    value={ui.rootFilter}
    onchange={(e) => { ui.rootFilter = (e.target as HTMLSelectElement).value; ui.repoFilter = ''; }}
  >
    <option value="">All roots</option>
    {#each availableRoots as root}
      <option value={root}>{rootShortName(root)}</option>
    {/each}
  </select>

  <select
    value={ui.repoFilter}
    onchange={(e) => { ui.repoFilter = (e.target as HTMLSelectElement).value; }}
  >
    <option value="">All repos</option>
    {#each availableRepos as repo}
      <option value={repo}>{repo}</option>
    {/each}
  </select>

  <input
    type="text"
    placeholder="Search..."
    value={ui.searchFilter}
    oninput={(e) => { ui.searchFilter = (e.target as HTMLInputElement).value; }}
  />
</div>

<style>
  .sidebar-filters {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    flex-shrink: 0;
  }

  select {
    padding: 6px 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.75rem;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23aaa' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    cursor: pointer;
  }

  select:focus {
    border-color: var(--accent);
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
</style>
