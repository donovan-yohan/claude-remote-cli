<script lang="ts">
  import { getPipelineState } from '../lib/state/pipelines.svelte.js';

  let { pipelineId }: { pipelineId: string } = $props();

  const pipelineState = getPipelineState();
  let outputEl: HTMLPreElement | undefined = $state();

  $effect(() => {
    // Auto-scroll when output changes
    if (pipelineState.pipelineOutput && outputEl) {
      requestAnimationFrame(() => {
        if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
      });
    }
  });
</script>

<div class="execution-monitor">
  <div class="monitor-header">
    <span class="pulse-dot"></span>
    <span class="monitor-title">Execution Output</span>
    <span class="pipeline-id">{pipelineId}</span>
  </div>
  <pre class="monitor-output" bind:this={outputEl}>{pipelineState.pipelineOutput || 'Waiting for output...'}</pre>
</div>

<style>
  .execution-monitor {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .monitor-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--surface);
    font-size: 0.9rem;
    font-weight: 500;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green, #2ecc71);
    animation: pulse 1.5s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .monitor-title {
    flex: 1;
  }

  .pipeline-id {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: monospace;
  }

  .monitor-output {
    margin: 0;
    padding: 14px;
    font-family: monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg, #1a1a2e);
    color: var(--text, #e0e0e0);
  }
</style>
