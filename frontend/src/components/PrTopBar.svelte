<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchPrForBranch, fetchCiStatus, fetchCurrentBranch } from '../lib/api.js';
  import { sendPtyData } from '../lib/ws.js';
  import {
    derivePrAction,
    deriveSecondaryAction,
    getActionPrompt,
    getStatusCssVar,
    shouldUseDarkText,
  } from '../lib/pr-state.js';
  import type { PrAction } from '../lib/pr-state.js';
  import type { PrInfo, CiStatus } from '../lib/types.js';
  import BranchSwitcher from './BranchSwitcher.svelte';

  let {
    workspacePath,
    branchName,
    sessionId,
    onArchive,
  }: {
    workspacePath: string;
    branchName: string;
    sessionId: string | null;
    onArchive?: () => void;
  } = $props();

  // currentBranch starts from the prop but can diverge when user switches locally.
  // Re-sync when the parent prop changes (e.g. workspace navigation).
  // svelte-ignore state_referenced_locally
  let currentBranch = $state(branchName);
  $effect(() => { currentBranch = branchName; });

  // If branchName is empty (repo sessions), detect the current branch from git
  $effect(() => {
    if (!branchName && workspacePath) {
      fetchCurrentBranch(workspacePath).then(branch => {
        if (branch) currentBranch = branch;
      });
    }
  });

  const prQuery = createQuery<PrInfo | null>(() => ({
    queryKey: ['pr', workspacePath, currentBranch],
    queryFn: () => fetchPrForBranch(workspacePath, currentBranch),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  }));

  const ciQuery = createQuery<CiStatus | null>(() => ({
    queryKey: ['ci-status', workspacePath, currentBranch],
    queryFn: () => fetchCiStatus(workspacePath, currentBranch),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: prQuery.data?.state === 'OPEN',
  }));

  // Refetch PR and CI data when session changes (e.g. workspace navigation)
  $effect(() => {
    if (sessionId) {
      prQuery.refetch();
      ciQuery.refetch();
    }
  });

  let pr = $derived(prQuery.data ?? null);
  let ci = $derived(ciQuery.data ?? null);

  let prStateInput = $derived({
    commitsAhead: pr ? 1 : 0,
    prState: pr ? (pr.isDraft ? 'DRAFT' : pr.state) : null as 'OPEN' | 'CLOSED' | 'MERGED' | 'DRAFT' | null,
    ciPassing: ci?.passing ?? 0,
    ciFailing: ci?.failing ?? 0,
    ciPending: ci?.pending ?? 0,
    ciTotal: ci?.total ?? 0,
    mergeable: pr?.mergeable ?? null,
    unresolvedCommentCount: pr?.unresolvedCommentCount ?? 0,
  });

  let prAction = $derived(derivePrAction(prStateInput));
  let secondaryAction = $derived(deriveSecondaryAction(prAction, prStateInput));

  let actionColor = $derived(getStatusCssVar(prAction.color));
  let actionDark = $derived(shouldUseDarkText(prAction.color));
  let showAction = $derived(prAction.type !== 'none');

  function handleActionClick(action: PrAction = prAction) {
    const ctx = {
      branchName: currentBranch,
      baseBranch: pr?.baseRefName ?? '',
      prNumber: pr?.number ?? 0,
      unresolvedCommentCount: pr?.unresolvedCommentCount ?? 0,
    };
    const prompt = getActionPrompt(action, ctx);
    if (prompt !== null) {
      if (sessionId) {
        sendPtyData(prompt + '\r');
      }
    } else {
      // archive actions
      onArchive?.();
    }
  }

  function handleBranchSwitch(branch: string) {
    currentBranch = branch;
  }
</script>

<div class="pr-top-bar" class:bar-merged={pr?.state === 'MERGED'} class:bar-conflicts={pr?.mergeable === 'CONFLICTING'}>
  <!-- Left section: branch switcher + target branch -->
  <div class="bar-left">
    <BranchSwitcher
      {workspacePath}
      currentBranch={currentBranch}
      onSwitch={handleBranchSwitch}
    />
    {#if pr?.baseRefName}
      <span class="target-branch" aria-label="target branch">
        <span class="target-sep">›</span>
        <span class="target-name">{pr.baseRefName}</span>
      </span>
    {/if}
  </div>

  <!-- Middle: PR link + diff stats -->
  {#if pr}
    <div class="bar-middle" aria-label="pull request">
      <a
        class="pr-link"
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        data-track="pr-top-bar.open-pr"
        aria-label="PR #{pr.number}: {pr.title}"
      >
        PR #{pr.number}
        <svg class="pr-ext-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 9L9 1M9 1H4M9 1V6" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </a>
    </div>
    <span class="diff-stats">
      <span class="diff-add">+{pr.additions}</span>
      <span class="diff-del">-{pr.deletions}</span>
    </span>
  {/if}

  <!-- Right: action buttons -->
  <div class="bar-right">
    {#if prQuery.isLoading}
      <span class="bar-loading">…</span>
    {:else}
      {#if secondaryAction}
        <button
          class="action-btn action-btn--secondary"
          data-track="pr-top-bar.secondary-action"
          onclick={() => handleActionClick(secondaryAction!)}
          aria-label={secondaryAction.label}
        >
          {secondaryAction.label}
        </button>
      {/if}
      {#if showAction}
        <button
          class="action-btn"
          style:--action-color={actionColor}
          class:action-btn--dark-text={actionDark}
          class:action-btn--disabled={prAction.type === 'checks-running'}
          data-track="pr-top-bar.primary-action"
          onclick={() => handleActionClick()}
          disabled={prAction.type === 'checks-running'}
          aria-label={prAction.label}
        >
          {prAction.label}
        </button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .pr-top-bar {
    display: flex;
    align-items: center;
    height: 36px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 0 8px;
    gap: 0;
    flex-shrink: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }

  /* ── Left ─────────────────────────── */
  .bar-left {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding-right: 8px;
    border-right: 1px solid var(--border);
  }

  .target-branch {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .target-sep {
    color: var(--border);
    font-size: 0.75rem;
  }

  .target-name {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100px;
  }

  /* ── Middle ────────────────────────── */
  .bar-middle {
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .pr-link {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: var(--font-size-xs);
    transition: color 0.12s;
  }

  .pr-link:hover {
    color: var(--accent);
  }

  .pr-ext-icon {
    flex-shrink: 0;
    opacity: 0.6;
  }

  /* ── Right ─────────────────────────── */
  .bar-right {
    display: flex;
    align-items: center;
    padding-left: 10px;
    flex-shrink: 0;
  }

  .bar-loading {
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    padding: 0 4px;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    padding: 0 10px;
    border-radius: 11px;
    border: none;
    background: var(--action-color, var(--border));
    color: #fff;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.12s, filter 0.12s;
    letter-spacing: 0.01em;
  }

  .action-btn:hover:not(:disabled) {
    filter: brightness(1.15);
  }

  .action-btn:active:not(:disabled) {
    filter: brightness(0.9);
  }

  .action-btn--dark-text {
    color: #000;
  }

  .action-btn--disabled {
    cursor: default;
    opacity: 0.7;
  }

  .bar-merged {
    background: color-mix(in srgb, var(--status-merged) 8%, var(--surface));
  }

  .bar-conflicts {
    background: color-mix(in srgb, var(--status-error) 8%, var(--surface));
  }

  .diff-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    padding: 0 8px;
    flex-shrink: 0;
  }

  .diff-add { color: var(--status-success); }
  .diff-del { color: var(--status-error); }

  .action-btn--secondary {
    background: var(--border) !important;
    color: var(--text) !important;
    margin-right: 6px;
  }

  /* ── Mobile: hide target branch + pr link ─── */
  @media (max-width: 600px) {
    .target-branch,
    .bar-middle,
    .diff-stats {
      display: none;
    }

    .bar-left {
      border-right: none;
      padding-right: 4px;
    }
  }
</style>
