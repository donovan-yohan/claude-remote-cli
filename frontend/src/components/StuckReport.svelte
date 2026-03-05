<script lang="ts">
  import * as api from '../lib/api.js';
  import { refreshActivePipeline, refreshPipelines } from '../lib/state/pipelines.svelte.js';

  let { pipelineId, report }: { pipelineId: string; report: string } = $props();

  let submitting = $state(false);

  async function handleResume(): Promise<void> {
    submitting = true;
    try {
      await api.resumePipeline(pipelineId);
      await refreshActivePipeline();
      await refreshPipelines();
    } finally {
      submitting = false;
    }
  }

  async function handleAbort(): Promise<void> {
    submitting = true;
    try {
      await api.abortPipeline(pipelineId);
      await refreshActivePipeline();
      await refreshPipelines();
    } finally {
      submitting = false;
    }
  }
</script>

<div class="stuck-report">
  <div class="stuck-header">
    <span class="stuck-title">Stuck Report</span>
  </div>
  <pre class="stuck-content">{report}</pre>
  <div class="stuck-actions">
    <button class="btn btn-resume" onclick={handleResume} disabled={submitting}>
      {submitting ? 'Submitting...' : 'Resume Execution'}
    </button>
    <button class="btn btn-abort" onclick={handleAbort} disabled={submitting}>
      {submitting ? 'Submitting...' : 'Abort'}
    </button>
  </div>
</div>

<style>
  .stuck-report {
    border: 2px solid var(--red, #e74c3c);
    border-radius: 8px;
    overflow: hidden;
  }

  .stuck-header {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    background: var(--surface);
    font-weight: 500;
    font-size: 0.9rem;
  }

  .stuck-title {
    color: var(--red, #e74c3c);
  }

  .stuck-content {
    margin: 0;
    padding: 14px;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
  }

  .stuck-actions {
    display: flex;
    gap: 8px;
    padding: 12px 14px;
    border-top: 1px solid var(--border);
  }

  .btn {
    padding: 6px 16px;
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-resume {
    background: var(--green, #2ecc71);
    color: white;
  }

  .btn-abort {
    background: var(--red, #e74c3c);
    color: white;
  }
</style>
