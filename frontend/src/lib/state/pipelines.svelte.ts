import type { PipelineSummary, PipelineDetail, PipelineState } from '../types.js';
import * as api from '../api.js';

let pipelines = $state<PipelineSummary[]>([]);
let activePipelineId = $state<string | null>(null);
let activePipelineDetail = $state<PipelineDetail | null>(null);

export function getPipelineState() {
  return {
    get pipelines() { return pipelines; },
    get activePipelineId() { return activePipelineId; },
    set activePipelineId(id: string | null) { activePipelineId = id; },
    get activePipelineDetail() { return activePipelineDetail; },
  };
}

export async function refreshPipelines(): Promise<void> {
  try {
    pipelines = await api.fetchPipelines();
  } catch { /* silent */ }
}

export async function refreshActivePipeline(): Promise<void> {
  if (!activePipelineId) {
    activePipelineDetail = null;
    return;
  }
  try {
    activePipelineDetail = await api.fetchPipeline(activePipelineId);
  } catch {
    activePipelineDetail = null;
  }
}

export function handlePipelineEvent(event: { type: string; id?: string; state?: PipelineState }): void {
  if (event.type === 'pipeline-state-changed') {
    refreshPipelines();
    if (event.id === activePipelineId) {
      refreshActivePipeline();
    }
  } else if (event.type === 'pipeline-verdict') {
    if (event.id === activePipelineId) {
      refreshActivePipeline();
    }
  }
}

export function getPipelineStateLabel(pipelineState: PipelineState): string {
  const labels: Record<PipelineState, string> = {
    intake: 'Starting',
    brainstorming: 'Brainstorming',
    prd_review: 'PRD Review',
    planning: 'Planning',
    plan_review: 'Plan Review',
    executing: 'Executing',
    reviewing: 'Reviewing',
    retry: 'Retrying',
    stuck: 'Stuck',
    pr_created: 'PR Created',
    ci_monitoring: 'CI Running',
    ready_for_review: 'Ready for Review',
    done: 'Done',
    failed: 'Failed',
  };
  return labels[pipelineState] || pipelineState;
}

export function getPipelineStatusColor(pipelineState: PipelineState): string {
  if (pipelineState === 'done') return 'var(--green)';
  if (pipelineState === 'failed') return 'var(--red, #e74c3c)';
  if (pipelineState === 'stuck') return 'var(--amber, #f39c12)';
  if (pipelineState === 'prd_review' || pipelineState === 'plan_review' || pipelineState === 'ready_for_review') return 'var(--amber, #f39c12)';
  return 'var(--blue, #3498db)';
}
