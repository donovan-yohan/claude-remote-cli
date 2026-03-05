<script lang="ts">
  import { getPipelineState, getPipelineStateLabel, getPipelineStatusColor } from '../lib/state/pipelines.svelte.js';
  import type { PipelineSummary } from '../lib/types.js';

  let {
    onSelectPipeline,
  }: {
    onSelectPipeline: (id: string) => void;
  } = $props();

  const pipelineState = getPipelineState();

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }
</script>

{#if pipelineState.pipelines.length === 0}
  <div class="empty-state">
    <p>No pipelines yet</p>
  </div>
{:else}
  {#each pipelineState.pipelines as pipeline (pipeline.id)}
    <button class="pipeline-item" class:active={pipelineState.activePipelineId === pipeline.id} onclick={() => onSelectPipeline(pipeline.id)}>
      <div class="row-1">
        <span class="status-dot" style:background={getPipelineStatusColor(pipeline.state)}></span>
        <span class="title">{pipeline.task.title}</span>
      </div>
      <div class="row-2">
        <span class="state-label">{getPipelineStateLabel(pipeline.state)}</span>
        {#if pipeline.attempts > 0}
          <span class="attempts">Attempt {pipeline.attempts}/{pipeline.maxAttempts}</span>
        {/if}
      </div>
      <div class="row-3">
        <span class="time">{relativeTime(pipeline.updatedAt)}</span>
      </div>
    </button>
  {/each}
{/if}

<style>
  .empty-state {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .pipeline-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 10px 12px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    color: var(--text);
    font-size: 0.85rem;
  }

  .pipeline-item:hover {
    background: var(--surface-hover, rgba(255, 255, 255, 0.05));
  }

  .pipeline-item.active {
    background: var(--surface-active, rgba(255, 255, 255, 0.1));
  }

  .row-1 {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .row-2 {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 16px;
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .state-label {
    font-weight: 500;
  }

  .attempts {
    opacity: 0.7;
  }

  .row-3 {
    padding-left: 16px;
    color: var(--text-muted);
    font-size: 0.75rem;
    opacity: 0.7;
  }
</style>
