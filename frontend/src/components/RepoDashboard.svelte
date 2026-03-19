<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchDashboard } from '../lib/api.js';
  import { derivePrAction, getStatusCssVar, shouldUseDarkText } from '../lib/pr-state.js';
  import { formatRelativeTime } from '../lib/utils.js';
  import type { PullRequest, ActivityEntry, DashboardData } from '../lib/types.js';

  let {
    workspacePath,
    workspaceName,
    onNewSession,
    onNewWorktree,
  }: {
    workspacePath: string;
    workspaceName: string;
    onNewSession: () => void;
    onNewWorktree: () => void;
  } = $props();

  const dashQuery = createQuery<DashboardData>(() => ({
    queryKey: ['dashboard', workspacePath],
    queryFn: () => fetchDashboard(workspacePath),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  let data = $derived(dashQuery.data);
  let isLoading = $derived(dashQuery.isLoading);
  let isError = $derived(dashQuery.isError);

  function prStatusDotClass(pr: PullRequest): string {
    if (pr.state !== 'OPEN') return 'dot dot-muted';
    // Derive from reviewDecision as a proxy for CI state — full CI data not in PullRequest type
    if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'dot dot-error';
    return 'dot dot-success';
  }

  function prActionForRow(pr: PullRequest) {
    // Dashboard doesn't fetch CI status per-PR — derive action from PR state only.
    // CI-aware actions (Fix Errors, Checks Running) are only shown in the PrTopBar
    // which fetches CI data for the active session's branch.
    const prState = pr.state === 'OPEN' ? 'OPEN' : pr.state === 'MERGED' ? 'MERGED' : 'CLOSED';
    return derivePrAction({
      commitsAhead: 1,
      prState,
      ciPassing: 0,
      ciFailing: 0,
      ciPending: 0,
      ciTotal: 0, // No CI data → state machine returns "Code Review" for OPEN PRs
    });
  }

  function prRoleLabel(pr: PullRequest): string {
    return pr.role === 'author' ? 'by you' : 'review requested';
  }

  function activityBranches(entry: ActivityEntry): string {
    if (!entry.branches || entry.branches.length === 0) return '';
    return '(' + entry.branches.join(', ') + ')';
  }
</script>

<div class="repo-dashboard">
  {#if data && !data.isGitRepo}
    <!-- Non-git repo: simplified view, just CTA buttons -->
    <div class="non-git-notice">
      <span class="non-git-msg">Not a git repository</span>
    </div>
  {:else}
    <!-- OPEN PULL REQUESTS section -->
    <section class="dashboard-section">
      <div class="section-heading">OPEN PULL REQUESTS</div>

      {#if isLoading}
        <div class="pr-list">
          {#each [1, 2] as _}
            <div class="pr-row skeleton">
              <div class="skeleton-line skeleton-title"></div>
              <div class="skeleton-line skeleton-meta"></div>
            </div>
          {/each}
        </div>
      {:else if isError}
        <div class="section-message">
          Could not load pull requests
        </div>
      {:else if data && !data.hasGhCli}
        <div class="section-message info">
          Install GitHub CLI for PR tracking —
          <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer">cli.github.com</a>
        </div>
      {:else if data && data.prs.length === 0}
        <div class="section-message">No open pull requests</div>
      {:else if data}
        <div class="pr-list">
          {#each data.prs as pr (pr.number)}
            {@const action = prActionForRow(pr)}
            {@const actionColor = getStatusCssVar(action.color)}
            {@const darkText = shouldUseDarkText(action.color)}
            <div class="pr-row">
              <div class="pr-row-left">
                <div class="pr-row-title-line">
                  <span class={prStatusDotClass(pr)}></span>
                  <span class="pr-title">{pr.title}</span>
                </div>
                <div class="pr-row-meta">
                  <span class="pr-num">#{pr.number}</span>
                  <span class="pr-sep">·</span>
                  <span class="pr-role">{prRoleLabel(pr)}</span>
                  <span class="pr-sep">·</span>
                  <span class="pr-time">{formatRelativeTime(pr.updatedAt)}</span>
                </div>
              </div>
              {#if action.type !== 'none' && action.label}
                <a
                  class="pr-action-pill"
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style:--pill-color={actionColor}
                  class:dark-text={darkText}
                >
                  {action.label}
                </a>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- RECENT ACTIVITY section -->
    <section class="dashboard-section">
      <div class="section-heading">RECENT ACTIVITY</div>

      {#if isLoading}
        <div class="activity-list">
          {#each [1, 2, 3] as _}
            <div class="activity-row skeleton">
              <div class="skeleton-line skeleton-activity"></div>
            </div>
          {/each}
        </div>
      {:else if data && data.activity.length === 0}
        <div class="section-message">No recent commits (24h)</div>
      {:else if data}
        <div class="activity-list">
          {#each data.activity as entry (entry.hash)}
            <div class="activity-row">
              <span class="commit-hash">{entry.shortHash}</span>
              <span class="commit-msg">{entry.message}</span>
              {#if entry.branches.length > 0}
                <span class="commit-branch">{activityBranches(entry)}</span>
              {/if}
              <span class="commit-time">{entry.timeAgo}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  <!-- CTA buttons — always shown -->
  <div class="cta-row">
    <button class="cta-btn" onclick={onNewSession}>+ Start Session</button>
    {#if !data || data.isGitRepo}
      <button class="cta-btn" onclick={onNewWorktree}>+ New Worktree</button>
    {/if}
  </div>
</div>

<style>
  .repo-dashboard {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
    background: var(--bg);
    min-height: 0;
    max-width: none;
  }

  /* ── Section ── */
  .dashboard-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-heading {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  .section-message {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding: 6px 0;
  }

  .section-message.info a {
    color: var(--accent);
    text-decoration: none;
  }

  .section-message.info a:hover {
    text-decoration: underline;
  }

  /* ── PR list ── */
  .pr-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .pr-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .pr-row:last-child {
    border-bottom: none;
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

  .pr-title {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  .pr-row-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .pr-sep {
    opacity: 0.4;
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
  .dot-warning { background: var(--status-warning); }
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
    transition: opacity 0.12s;
  }

  .pr-action-pill:hover {
    opacity: 0.85;
  }

  .pr-action-pill.dark-text {
    color: #1a1a1a;
  }

  /* ── Activity list ── */
  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .activity-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    min-width: 0;
  }

  .commit-hash {
    color: var(--text-muted);
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  .commit-msg {
    color: var(--text);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .commit-branch {
    color: var(--text-muted);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .commit-time {
    color: var(--text-muted);
    flex-shrink: 0;
    white-space: nowrap;
    opacity: 0.6;
  }

  /* ── Non-git notice ── */
  .non-git-notice {
    padding: 8px 0;
  }

  .non-git-msg {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  /* ── CTA buttons ── */
  .cta-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 4px;
  }

  .cta-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 18px;
    min-height: 40px;
    background: transparent;
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--accent);
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    white-space: nowrap;
  }

  .cta-btn:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  /* ── Skeletons ── */
  .skeleton {
    pointer-events: none;
  }

  .skeleton-line {
    background: var(--border);
    border-radius: 3px;
    animation: skeleton-pulse 1.4s ease-in-out infinite;
  }

  .skeleton-title {
    height: 13px;
    width: 60%;
    margin-bottom: 5px;
  }

  .skeleton-meta {
    height: 10px;
    width: 40%;
  }

  .skeleton-activity {
    height: 12px;
    width: 75%;
  }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.4; }
    50%       { opacity: 0.7; }
  }

  /* ── Mobile ── */
  @media (max-width: 600px) {
    .repo-dashboard {
      padding: 14px;
    }

    .pr-row {
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 10px;
      min-height: 44px;
      align-items: flex-start;
    }

    .pr-row-left {
      width: 100%;
    }

    .pr-action-pill {
      align-self: flex-end;
      margin-left: auto;
      padding: 5px 12px;
      min-height: 32px;
    }

    .cta-btn {
      flex: 1;
      min-height: 44px;
    }
  }
</style>
