<script lang="ts">
  import { getPipelineState, getPipelineStateLabel, getPipelineStatusColor, refreshActivePipeline } from '../lib/state/pipelines.svelte.js';
  import type { PipelineState } from '../lib/types.js';
  import { onMount } from 'svelte';
  import PRDReview from './PRDReview.svelte';
  import PlanReview from './PlanReview.svelte';
  import ExecutionMonitor from './ExecutionMonitor.svelte';
  import StuckReport from './StuckReport.svelte';

  const pipelineState = getPipelineState();

  const STATE_ORDER: PipelineState[] = [
    'intake', 'brainstorming', 'prd_review', 'planning', 'plan_review',
    'executing', 'reviewing', 'pr_created', 'ci_monitoring', 'ready_for_review', 'done',
  ];

  let stateIndex = $derived(
    pipelineState.activePipelineDetail
      ? STATE_ORDER.indexOf(pipelineState.activePipelineDetail.state)
      : -1,
  );

  onMount(() => {
    refreshActivePipeline();
  });

  function getStepClass(idx: number, currentState: PipelineState): string {
    const currentIdx = STATE_ORDER.indexOf(currentState);
    if (currentState === 'failed' || currentState === 'stuck') {
      if (idx <= currentIdx || currentIdx === -1) return 'step-error';
      return 'step-pending';
    }
    if (idx < currentIdx) return 'step-done';
    if (idx === currentIdx) return 'step-active';
    return 'step-pending';
  }
</script>

{#if pipelineState.activePipelineDetail}
  {@const detail = pipelineState.activePipelineDetail}
  <div class="pipeline-view">
    <div class="header">
      <h2>{detail.task.title}</h2>
      <span class="state-badge" style:background={getPipelineStatusColor(detail.state)}>
        {getPipelineStateLabel(detail.state)}
      </span>
      {#if detail.attempts > 0}
        <span class="attempts">Attempt {detail.attempts}/{detail.maxAttempts}</span>
      {/if}
    </div>

    <div class="progress-bar">
      {#each STATE_ORDER as step, i (step)}
        <div class="step {getStepClass(i, detail.state)}" title={getPipelineStateLabel(step)}>
          <div class="step-dot"></div>
          {#if i < STATE_ORDER.length - 1}
            <div class="step-line"></div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="sections">
      {#if detail.state === 'prd_review' && detail.prdContent}
        <PRDReview pipelineId={detail.id} content={detail.prdContent} />
      {:else if detail.prdContent}
        <details class="artifact">
          <summary>PRD</summary>
          <pre class="artifact-content">{detail.prdContent}</pre>
        </details>
      {/if}

      {#if detail.state === 'plan_review' && detail.planContent}
        <PlanReview pipelineId={detail.id} content={detail.planContent} />
      {:else if detail.planContent}
        <details class="artifact">
          <summary>Plan</summary>
          <pre class="artifact-content">{detail.planContent}</pre>
        </details>
      {/if}

      {#if detail.verdicts.length > 0}
        <details class="artifact" open>
          <summary>Verdicts ({detail.verdicts.length})</summary>
          {#each detail.verdicts as verdict, i (i)}
            <div class="verdict" class:pass={verdict.pass} class:fail={!verdict.pass}>
              <div class="verdict-header">
                Attempt {i + 1}: {verdict.pass ? 'PASS' : 'FAIL'}
              </div>
              <p>{verdict.summary}</p>
              {#each verdict.criteriaResults as cr (cr.criterion)}
                <div class="criterion" class:met={cr.met}>
                  <span>{cr.met ? '\u2713' : '\u2717'}</span>
                  <span>{cr.criterion}</span>
                  {#if cr.reason}
                    <span class="reason">{cr.reason}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </details>
      {/if}

      {#if detail.error}
        <div class="error-block">
          <strong>Error:</strong> {detail.error}
        </div>
      {/if}

      {#if detail.stuckReport}
        <details class="artifact" open>
          <summary>Stuck Report</summary>
          <pre class="artifact-content">{detail.stuckReport}</pre>
        </details>
      {/if}

      {#if detail.prUrl}
        <div class="pr-link">
          <a href={detail.prUrl} target="_blank" rel="noopener">View PR #{detail.prNumber}</a>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <div class="no-pipeline">
    <p>Select a pipeline from the sidebar</p>
  </div>
{/if}

<style>
  .pipeline-view {
    padding: 24px;
    overflow-y: auto;
    height: 100%;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }

  .header h2 {
    margin: 0;
    font-size: 1.2rem;
    flex: 1;
  }

  .state-badge {
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
  }

  .attempts {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .progress-bar {
    display: flex;
    align-items: center;
    margin-bottom: 24px;
    overflow-x: auto;
  }

  .step {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .step-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border);
  }

  .step-line {
    width: 20px;
    height: 2px;
    background: var(--border);
  }

  .step-done .step-dot { background: var(--green, #2ecc71); }
  .step-done .step-line { background: var(--green, #2ecc71); }
  .step-active .step-dot { background: var(--blue, #3498db); box-shadow: 0 0 6px var(--blue, #3498db); }
  .step-error .step-dot { background: var(--red, #e74c3c); }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .artifact {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .artifact summary {
    padding: 10px 14px;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.9rem;
    background: var(--surface);
  }

  .artifact-content {
    padding: 14px;
    margin: 0;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
  }

  .verdict {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .verdict.pass { border-left: 3px solid var(--green, #2ecc71); }
  .verdict.fail { border-left: 3px solid var(--red, #e74c3c); }

  .verdict-header {
    font-weight: 600;
    font-size: 0.85rem;
    margin-bottom: 6px;
  }

  .verdict p {
    margin: 0 0 8px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .criterion {
    display: flex;
    gap: 8px;
    font-size: 0.8rem;
    padding: 2px 0;
  }

  .criterion.met { color: var(--green, #2ecc71); }
  .criterion:not(.met) { color: var(--red, #e74c3c); }

  .reason {
    color: var(--text-muted);
    font-style: italic;
  }

  .error-block {
    padding: 12px 14px;
    background: rgba(231, 76, 60, 0.1);
    border: 1px solid var(--red, #e74c3c);
    border-radius: 8px;
    font-size: 0.85rem;
    color: var(--red, #e74c3c);
  }

  .pr-link {
    padding: 12px;
  }

  .pr-link a {
    color: var(--accent, #3498db);
    text-decoration: none;
    font-weight: 500;
  }

  .no-pipeline {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-muted);
  }
</style>
