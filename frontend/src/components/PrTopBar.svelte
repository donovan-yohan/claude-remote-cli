<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchPrForBranch, fetchCiStatus } from '../lib/api.js';
  import { sendPtyData } from '../lib/ws.js';
  import {
    derivePrAction,
    getActionPrompt,
    getStatusCssVar,
    shouldUseDarkText,
  } from '../lib/pr-state.js';
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

  let pr = $derived(prQuery.data ?? null);
  let ci = $derived(ciQuery.data ?? null);

  let prAction = $derived.by(() => {
    const prState = pr
      ? (pr.isDraft ? 'DRAFT' : pr.state)
      : null;
    return derivePrAction({
      commitsAhead: pr ? 1 : 0,
      prState,
      ciPassing: ci?.passing ?? 0,
      ciFailing: ci?.failing ?? 0,
      ciPending: ci?.pending ?? 0,
      ciTotal: ci?.total ?? 0,
    });
  });

  let actionColor = $derived(getStatusCssVar(prAction.color));
  let actionDark = $derived(shouldUseDarkText(prAction.color));
  let showAction = $derived(prAction.type !== 'none');

  function handleActionClick() {
    const prompt = getActionPrompt(prAction, currentBranch);
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

<div class="pr-top-bar">
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

  <!-- Middle: PR link -->
  {#if pr}
    <div class="bar-middle" aria-label="pull request">
      <a
        class="pr-link"
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="PR #{pr.number}: {pr.title}"
      >
        PR #{pr.number}
        <svg class="pr-ext-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 9L9 1M9 1H4M9 1V6" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </a>
    </div>
  {/if}

  <!-- Right: action button -->
  <div class="bar-right">
    {#if prQuery.isLoading}
      <span class="bar-loading">…</span>
    {:else if showAction}
      <button
        class="action-btn"
        style:--action-color={actionColor}
        class:action-btn--dark-text={actionDark}
        class:action-btn--disabled={prAction.type === 'checks-running'}
        onclick={handleActionClick}
        disabled={prAction.type === 'checks-running'}
        aria-label={prAction.label}
      >
        {prAction.label}
      </button>
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

  /* ── Mobile: hide target branch + pr link ─── */
  @media (max-width: 600px) {
    .target-branch,
    .bar-middle {
      display: none;
    }

    .bar-left {
      border-right: none;
      padding-right: 4px;
    }
  }
</style>
