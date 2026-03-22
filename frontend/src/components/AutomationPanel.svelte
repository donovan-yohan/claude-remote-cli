<script lang="ts">
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { fetchAutomations, updateAutomations } from '../lib/api.js';
  import type { AutomationSettings } from '../lib/types.js';

  const queryClient = useQueryClient();

  const automationQuery = createQuery<AutomationSettings>(() => ({
    queryKey: ['automations'],
    queryFn: fetchAutomations,
    staleTime: 60_000,
  }));

  const mutation = createMutation<AutomationSettings, Error, Partial<AutomationSettings>>(() => ({
    mutationFn: updateAutomations,
    onSuccess: (data) => {
      queryClient.setQueryData(['automations'], data);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    },
  }));

  let settings = $derived(automationQuery.data ?? {});

  function toggleAutoCheckout() {
    const next = !settings.autoCheckoutReviewRequests;
    mutation.mutate({
      autoCheckoutReviewRequests: next,
      // If disabling checkout, also disable review
      ...(!next ? { autoReviewOnCheckout: false } : {}),
    });
  }

  function toggleAutoReview() {
    mutation.mutate({ autoReviewOnCheckout: !settings.autoReviewOnCheckout });
  }
</script>

<div class="automation-panel">
  <div class="panel-header">
    <span class="panel-title">Automations</span>
  </div>

  {#if automationQuery.isLoading}
    <div class="panel-loading">Loading...</div>
  {:else if automationQuery.isError}
    <div class="panel-error">
      <span>Failed to load settings.</span>
      <button class="retry-btn" onclick={() => automationQuery.refetch()}>Retry</button>
    </div>
  {:else}
    <div class="toggle-list">
      <label class="toggle-row">
        <input
          type="checkbox"
          class="toggle-checkbox"
          checked={settings.autoCheckoutReviewRequests ?? false}
          onchange={toggleAutoCheckout}
          disabled={mutation.isPending}
        />
        <div class="toggle-info">
          <span class="toggle-label">Auto-checkout review requests</span>
          <span class="toggle-desc">Create a worktree when you're requested as a PR reviewer</span>
        </div>
      </label>

      <label class="toggle-row" class:toggle-row--disabled={!settings.autoCheckoutReviewRequests}>
        <input
          type="checkbox"
          class="toggle-checkbox"
          checked={settings.autoReviewOnCheckout ?? false}
          onchange={toggleAutoReview}
          disabled={!settings.autoCheckoutReviewRequests || mutation.isPending}
        />
        <div class="toggle-info">
          <span class="toggle-label">Auto-review on checkout</span>
          <span class="toggle-desc">Run your code review prompt when a review worktree is created</span>
        </div>
      </label>
    </div>
    {#if mutation.isError}
      <div class="panel-error">
        <span>Failed to update settings.</span>
        <button class="retry-btn" onclick={() => mutation.reset()}>Dismiss</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .automation-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px;
    background: var(--bg);
    flex-shrink: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .panel-title {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .panel-loading,
  .panel-error {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .retry-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    cursor: pointer;
    padding: 3px 8px;
    transition: border-color 0.12s, color 0.12s;
  }

  .retry-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .toggle-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    padding: 4px 0;
  }

  .toggle-row--disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .toggle-checkbox {
    margin-top: 2px;
    accent-color: var(--accent);
    flex-shrink: 0;
    cursor: pointer;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toggle-label {
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    color: var(--text);
  }

  .toggle-desc {
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    opacity: 0.7;
  }
</style>
