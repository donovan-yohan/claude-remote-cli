<script lang="ts">
  import * as api from '../lib/api.js';
  import { refreshActivePipeline, refreshPipelines } from '../lib/state/pipelines.svelte.js';

  let { pipelineId, content }: { pipelineId: string; content: string } = $props();

  let editing = $state(false);
  let editedContent = $state('');
  let submitting = $state(false);

  function startEdit() {
    editedContent = content;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
  }

  async function approve() {
    submitting = true;
    try {
      await api.approvePrd(pipelineId, editing ? editedContent : undefined);
      await Promise.all([refreshActivePipeline(), refreshPipelines()]);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="review-card">
  <div class="review-header">
    <h3>PRD Review</h3>
    <span class="review-hint">Review the PRD, then approve to proceed with planning.</span>
  </div>

  {#if editing}
    <textarea class="review-editor" bind:value={editedContent} rows="20"></textarea>
    <div class="review-actions">
      <button class="btn-secondary" onclick={cancelEdit} disabled={submitting}>Cancel</button>
      <button class="btn-primary" onclick={approve} disabled={submitting}>
        {submitting ? 'Submitting...' : 'Approve & Plan'}
      </button>
    </div>
  {:else}
    <pre class="review-content">{content}</pre>
    <div class="review-actions">
      <button class="btn-secondary" onclick={startEdit}>Edit</button>
      <button class="btn-primary" onclick={approve} disabled={submitting}>
        {submitting ? 'Submitting...' : 'Approve & Plan'}
      </button>
    </div>
  {/if}
</div>

<style>
  .review-card {
    border: 2px solid var(--amber, #f39c12);
    border-radius: 8px;
    overflow: hidden;
  }

  .review-header {
    padding: 12px 14px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .review-header h3 {
    margin: 0 0 4px;
    font-size: 0.95rem;
  }

  .review-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .review-content {
    padding: 14px;
    margin: 0;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
  }

  .review-editor {
    width: 100%;
    box-sizing: border-box;
    padding: 14px;
    margin: 0;
    font-size: 0.8rem;
    font-family: inherit;
    background: var(--bg, #1a1a1a);
    color: var(--text);
    border: none;
    border-bottom: 1px solid var(--border);
    resize: vertical;
    min-height: 200px;
  }

  .review-editor:focus {
    outline: none;
  }

  .review-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 10px 14px;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }

  .btn-primary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.8rem;
    border: none;
    background: var(--accent, #3498db);
    color: #fff;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.8rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
